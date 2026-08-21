import Foundation
import WebKit

/// Serves the web bundle to the web view under a scheme of its own.
///
/// The obvious way to show a local page is `loadFileURL`, and it does not work
/// for this bundle. A page loaded from `file://` has an opaque origin, and an
/// ES module script is fetched under CORS rules — an opaque origin fails that
/// check, so the module never runs and the app opens on a white screen with
/// nothing in the log to say why. The screens in `web/` are a Vite build, which
/// is ES modules.
///
/// So the bundle gets a scheme: `trueline://app/index.html`. A custom scheme
/// has a real origin, modules load normally, and relative paths inside the
/// bundle resolve the way they do on a web server. Nothing leaves the device —
/// this handler only ever reads files inside the app.
final class WebBundle: NSObject, WKURLSchemeHandler {

    static let scheme = "trueline"
    static let start = URL(string: "trueline://app/index.html")!

    /// Where the built web app lives inside the app bundle.
    private let root: URL?

    override init() {
        root = Bundle.main.url(forResource: "Web", withExtension: nil)
        super.init()
    }

    /// Whether there is a bundle to serve at all, so a build missing its web
    /// step can say so instead of looking like a hang.
    var isPresent: Bool { root != nil }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let root else {
            fail(task, "The web bundle is missing from this build.")
            return
        }

        guard let file = resolve(task.request.url, under: root) else {
            fail(task, "Not part of this app: \(task.request.url?.path ?? "—")")
            return
        }

        guard let data = try? Data(contentsOf: file) else {
            fail(task, "Could not read \(file.lastPathComponent) out of the app bundle.")
            return
        }

        let response = HTTPURLResponse(
            url: task.request.url!,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Content-Type": Self.contentType(for: file.pathExtension),
                "Content-Length": String(data.count),
                // The page has no business reaching the network, and this says
                // so to the engine rather than relying on it not trying.
                "Content-Security-Policy":
                    "default-src 'self' 'unsafe-inline' data: blob:; connect-src 'self'",
            ]
        )!

        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        // Every response is produced synchronously above, so by the time a stop
        // could arrive there is nothing left in flight to cancel.
    }

    /// The file a request names, or nothing when it points outside the bundle.
    ///
    /// Standardising before the check is the point: `..` segments are resolved
    /// first, so a path that climbs out of the bundle fails the prefix test
    /// rather than sneaking through it.
    private func resolve(_ url: URL?, under root: URL) -> URL? {
        guard let url else { return nil }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appendingPathComponent(path).standardizedFileURL
        let base = root.standardizedFileURL
        guard file.path == base.path || file.path.hasPrefix(base.path + "/") else { return nil }
        return file
    }

    private func fail(_ task: WKURLSchemeTask, _ reason: String) {
        task.didFailWithError(
            NSError(
                domain: "Trueline.WebBundle",
                code: 404,
                userInfo: [NSLocalizedDescriptionKey: reason]
            )
        )
    }

    static func contentType(for extension: String) -> String {
        switch `extension`.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "webp": return "image/webp"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        case "ttf": return "font/ttf"
        case "map": return "application/json; charset=utf-8"
        case "ico": return "image/vnd.microsoft.icon"
        default: return "application/octet-stream"
        }
    }
}
