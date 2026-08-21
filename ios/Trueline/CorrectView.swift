import SwiftUI
import WebKit

/// Everything after the scan.
///
/// The correction screens are the web app in `web/`, running here in a web view
/// inside the same app. That is a deliberate architectural choice and the
/// alternative was worse: writing the measurement model twice, in Swift and in
/// TypeScript, and keeping the two in step forever. Nanometre integers, the
/// provenance rules, the solver, zones, obstruction, the issue guard — every one
/// of those would have had to be maintained in two languages, and every bug
/// fixed in both. Small products die of that.
///
/// So there is one measurement engine. It is the one with 267 tests against it,
/// and it is the one that runs here.
///
/// Nothing is fetched. The bundle is files inside the app, loaded from disk, and
/// the scan is handed across as an argument rather than uploaded anywhere.
struct CorrectView: UIViewRepresentable {

    /// The scan to hand over: RoomPlan's own JSON, and the photo manifest.
    let roomJSON: Data
    let photosJSON: Data
    let title: String

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        // Nothing on the page needs to reach the network, so nothing on the page
        // is given a way to. A scan is somebody's house.
        configuration.websiteDataStore = .nonPersistent()

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.scrollView.contentInsetAdjustmentBehavior = .always
        webView.isOpaque = false

        guard let index = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Web") else {
            // A build with no web bundle in it is a broken build, and saying so
            // beats a blank white screen that looks like a hang.
            webView.loadHTMLString(missingBundleMessage, baseURL: nil)
            return webView
        }
        webView.loadFileURL(index, allowingReadAccessTo: index.deletingLastPathComponent())
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.parent = self
    }

    private var missingBundleMessage: String {
        """
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <body style="font:16px -apple-system;padding:24px;color:#0f172a">
        <h2>The web bundle is missing from this build.</h2>
        <p>Xcode's build step copies <code>web/dist</code> into <code>Trueline/Web</code>.
        Run <code>npm run build</code> at the top of the repository and build again.</p>
        </body>
        """
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var parent: CorrectView

        init(_ parent: CorrectView) {
            self.parent = parent
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            hand(over: webView)
        }

        /// Hands the scan across once the page is up.
        ///
        /// The payload goes in as JSON text and is parsed on the other side, so
        /// nothing has to be escaped into a JavaScript literal by hand — which is
        /// the classic way this breaks, on the first room somebody names with an
        /// apostrophe in it.
        private func hand(over webView: WKWebView) {
            guard
                let room = String(data: parent.roomJSON, encoding: .utf8),
                let photos = String(data: parent.photosJSON, encoding: .utf8)
            else { return }

            let script = """
            (function () {
              var room = JSON.parse(\(quoted(room)));
              var photos = JSON.parse(\(quoted(photos)));
              var name = \(quoted(parent.title));
              if (window.trueline && window.trueline.open) {
                window.trueline.open(room, photos, name);
              } else {
                window.truelinePayload = { room: room, photos: photos, fileName: name };
              }
            })();
            """
            webView.evaluateJavaScript(script) { _, error in
                if let error {
                    // Worth a line in the console: a scan that does not arrive
                    // looks exactly like a scan that produced nothing.
                    print("Trueline: the scan did not reach the web view — \(error)")
                }
            }
        }

        /// A JavaScript string literal of arbitrary text, without hand-escaping.
        private func quoted(_ text: String) -> String {
            let data = try? JSONSerialization.data(withJSONObject: [text], options: [])
            guard let data, let array = String(data: data, encoding: .utf8) else { return "\"\"" }
            // JSONSerialization gives `["..."]`; the literal is what is inside.
            return String(array.dropFirst().dropLast())
        }
    }
}
