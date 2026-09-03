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

    /// The capture folder whose photographs this page may show.
    ///
    /// One folder, the one being looked at. `photo.ts` has been able to say
    /// which walls a photograph shows since it was written and nothing could put
    /// one on a screen, because the pictures are files on the phone and the page
    /// is a web view. Serving them under the page's own scheme is what closes
    /// that — and scoping it to a single folder, set by the screen that opened
    /// the scan, is what stops the page being a reader of the whole disk.
    var photos: URL?

    /// And the folder its recordings are in.
    ///
    /// Separate from `photos` rather than one media folder holding both,
    /// because they are written by different things at different times: the
    /// scanner writes photographs during a walk, and `VoiceRecorder` writes
    /// recordings while somebody is looking at one wall. Two folders is also
    /// what makes `bringIn` able to put a scan back together from a pile of
    /// files somebody selected in the Files app.
    var voice: URL?

    override init() {
        root = Bundle.main.url(forResource: "Web", withExtension: nil)
        super.init()
    }

    /// The path prefix the page asks for a photograph under. Must match
    /// `PHOTO_BASE` in `WallPhotos.tsx`.
    private static let photoPrefix = "/photos/"

    /// And for a recording. Must match `VOICE_BASE` in `Voice.tsx`.
    private static let voicePrefix = "/voice/"

    /// Whether there is a bundle to serve at all, so a build missing its web
    /// step can say so instead of looking like a hang.
    var isPresent: Bool { root != nil }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let root else {
            fail(task, "The web bundle is missing from this build.")
            return
        }

        // A photograph out of the capture being looked at, rather than a file
        // from the app bundle. Same resolution rule, different root — and the
        // root is one folder somebody opened, never the disk.
        let path = task.request.url?.path ?? ""
        let wantsPhoto = path.hasPrefix(Self.photoPrefix)
        let wantsVoice = path.hasPrefix(Self.voicePrefix)
        if wantsPhoto && photos == nil {
            fail(task, "This scan's photographs are not available.")
            return
        }
        if wantsVoice && voice == nil {
            fail(task, "This scan's recordings are not available.")
            return
        }
        let base = wantsPhoto ? photos! : wantsVoice ? voice! : root
        let prefix = wantsPhoto ? Self.photoPrefix : wantsVoice ? Self.voicePrefix : nil

        guard let file = resolve(task.request.url, under: base, stripping: prefix) else {
            fail(task, "Not part of this app: \(task.request.url?.path ?? "—")")
            return
        }

        guard let data = try? Data(contentsOf: file) else {
            fail(task, "Could not read \(file.lastPathComponent) out of the app bundle.")
            return
        }

        // Every response, and every response to a range request, carries these.
        let common = [
            "Content-Type": Self.contentType(for: file.pathExtension),
            // The page has no business reaching the network, and this says
            // so to the engine rather than relying on it not trying.
            //
            // `media-src` is deliberately not written out: it falls back to
            // `default-src 'self'`, which is this same origin, so a recording
            // served from here plays. The website's own policy had exactly this
            // gap the other way round -- `default-src 'none'` with no
            // `media-src` -- and its two films would have worked on a laptop
            // and been blocked in production.
            "Content-Security-Policy":
                "default-src 'self' 'unsafe-inline' data: blob:; connect-src 'self'",
            // The built page tags its module script `crossorigin`, which
            // puts the fetch in CORS mode even though it is same-origin.
            // Spec says that passes; a custom scheme is exactly where an
            // engine might decide otherwise, and this costs nothing —
            // no origin outside the app can reach this scheme to ask.
            "Access-Control-Allow-Origin": "*",
            // What makes an <audio> element work at all.
            //
            // WebKit asks a media resource for a byte range rather than for the
            // whole file, and a handler that answers 200 with everything is a
            // handler some builds refuse to play from and none can seek in. A
            // fifteen-second note is small enough that the whole file is a fine
            // answer -- but only if the range that was ASKED for is what comes
            // back, which is what the branch below does.
            "Accept-Ranges": "bytes",
        ]

        if let asked = Self.range(task.request.value(forHTTPHeaderField: "Range"), of: data.count) {
            var headers = common
            headers["Content-Length"] = String(asked.count)
            headers["Content-Range"] = "bytes \(asked.lowerBound)-\(asked.upperBound)/\(data.count)"
            let response = HTTPURLResponse(
                url: task.request.url!,
                statusCode: 206,
                httpVersion: "HTTP/1.1",
                headerFields: headers
            )!
            task.didReceive(response)
            task.didReceive(data.subdata(in: asked.lowerBound..<(asked.upperBound + 1)))
            task.didFinish()
            return
        }

        var headers = common
        headers["Content-Length"] = String(data.count)
        let response = HTTPURLResponse(
            url: task.request.url!,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: headers
        )!

        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    /// The bytes a `Range:` header is asking for, or nothing.
    ///
    /// Only the one form that matters — `bytes=start-end`, with the end
    /// optional, which is what WebKit sends for a media element. A multi-range
    /// request, or anything this cannot read confidently, returns nothing and
    /// the caller answers with the whole file, which is always a legal answer.
    ///
    /// The range is clamped rather than trusted. A start past the end of the
    /// file would otherwise be a crash on a `subdata` in somebody's kitchen.
    static func range(_ header: String?, of length: Int) -> ClosedRange<Int>? {
        guard
            length > 0,
            let header,
            header.hasPrefix("bytes="),
            !header.contains(",")
        else { return nil }

        let parts = header.dropFirst("bytes=".count).split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 2, let start = Int(parts[0]), start >= 0, start < length else {
            return nil
        }
        let end = parts[1].isEmpty ? length - 1 : (Int(parts[1]) ?? length - 1)
        return start...min(end, length - 1)
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
    private func resolve(_ url: URL?, under root: URL, stripping prefix: String? = nil) -> URL? {
        guard let url else { return nil }
        var path = url.path
        if let prefix, path.hasPrefix(prefix) {
            path = "/" + String(path.dropFirst(prefix.count))
        }
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appendingPathComponent(path).standardizedFileURL
        let base = root.standardizedFileURL
        guard file.path == base.path || file.path.hasPrefix(base.path + "/") else { return nil }
        return file
    }

    private func fail(_ task: WKURLSchemeTask, _ reason: String) {
        task.didFailWithError(
            NSError(
                domain: "ScanToBid.WebBundle",
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
        // AAC in an MPEG-4 container, which is what `VoiceRecorder` writes and
        // what every browser and messaging app already plays.
        case "m4a": return "audio/mp4"
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
