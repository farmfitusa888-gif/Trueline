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
    /// The corners somebody tapped, when the room was walked rather than scanned.
    let traceJSON: Data
    /// The room as somebody already corrected it, if they have. Outranks the
    /// capture: it is the same room with tape readings in it.
    let correctedJSON: Data
    let title: String
    /// Where this scan lives, so a save can land beside the capture it came from.
    let folder: URL
    /// Called on every save, with the whole saved project.
    let onSave: (Data) -> Void
    /// Called once when the plan is drawn, with a small PNG of it for the list.
    let onThumbnail: (Data) -> Void
    /// Called when the contractor edits their own details. A licence number
    /// should be typed once in a lifetime, not once per phone.
    let onCompany: (Data) -> Void
    /// The details this app is already keeping, handed over on load.
    let companyJSON: Data

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        // Which capture's photographs this page may show — one folder, the one
        // being looked at, and nothing else on the disk.
        context.coordinator.bundle.photos = folder.appendingPathComponent("photos", isDirectory: true)

        let configuration = WKWebViewConfiguration()
        // The channel the correction screens save through. Without it a room
        // somebody corrected exists only in this web view's `localStorage`,
        // which is a cache the operating system is allowed to reclaim.
        configuration.userContentController.add(context.coordinator, name: "saved")
        // And a picture of the plan, for the list of scans. The list showed
        // three folders called "Room 2026-08-24 1819" and left somebody to
        // remember which was the kitchen.
        configuration.userContentController.add(context.coordinator, name: "thumbnail")
        configuration.userContentController.add(context.coordinator, name: "company")
        // The bundle is served under its own scheme rather than from `file://`.
        // See `WebBundle` for why: modules do not load from an opaque origin,
        // and the failure looks exactly like a hang.
        configuration.setURLSchemeHandler(context.coordinator.bundle, forURLScheme: WebBundle.scheme)
        // The default, persistent data store, deliberately: the correction
        // screens write the room to `localStorage` after every edit, and ten
        // minutes of typing tape readings in a half-built kitchen must survive
        // the app being closed. Nothing reaches the network — the handler above
        // serves the only origin the page has, under a content security policy
        // that allows nothing else.
        configuration.websiteDataStore = .default()

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.scrollView.contentInsetAdjustmentBehavior = .always
        webView.isOpaque = false

        guard context.coordinator.bundle.isPresent else {
            // A build with no web bundle in it is a broken build, and saying so
            // beats a blank white screen that looks like a hang.
            webView.loadHTMLString(missingBundleMessage, baseURL: nil)
            return webView
        }
        webView.load(URLRequest(url: WebBundle.start))
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

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        var parent: CorrectView
        /// Held here because the configuration does not retain it.
        let bundle = WebBundle()

        init(_ parent: CorrectView) {
            self.parent = parent
        }

        /// A save coming back out of the correction screens.
        ///
        /// The payload is the whole saved project as `persist.ts` writes it —
        /// exact integers tagged as strings, so nothing has been through a
        /// float on the way here. It is handed straight to the caller, which
        /// writes it into the scan's folder and puts a copy in iCloud.
        ///
        /// Everything about the message is checked before anything is written.
        /// A web view is a program, and this is the one place it can hand this
        /// app bytes to keep.
        func userContentController(
            _ controller: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard let body = message.body as? [String: Any] else { return }

            switch message.name {
            case "saved":
                guard
                    let project = body["project"] as? String,
                    !project.isEmpty,
                    let data = project.data(using: .utf8)
                else { return }
                parent.onSave(data)

            case "company":
                guard
                    let json = body["company"] as? String,
                    !json.isEmpty,
                    json.utf8.count < 1_000_000,
                    let data = json.data(using: .utf8),
                    // It has to be an object before it is written. A file this
                    // app will hand back to the page later must be something
                    // the page can read.
                    (try? JSONSerialization.jsonObject(with: data)) is [String: Any]
                else { return }
                parent.onCompany(data)

            case "thumbnail":
                // A data URL, and only a PNG one. Everything about it is
                // checked before a byte is written: this is a web view handing
                // the app a file to keep, and "it said it was a picture" is not
                // a reason to believe it is one.
                let prefix = "data:image/png;base64,"
                guard
                    let url = body["thumbnail"] as? String,
                    url.hasPrefix(prefix),
                    let data = Data(base64Encoded: String(url.dropFirst(prefix.count))),
                    // A thumbnail is a few kilobytes. Anything the size of a
                    // photograph is not a thumbnail and is not written.
                    data.count < 2_000_000,
                    // PNG's own first eight bytes, so what lands on disk with a
                    // .png on the end really is one.
                    data.starts(with: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
                else { return }
                parent.onThumbnail(data)

            default:
                return
            }
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
            // The profile first, so the letterhead is on the drawing the moment
            // it appears rather than a frame later.
            if !parent.companyJSON.isEmpty,
               let company = String(data: parent.companyJSON, encoding: .utf8) {
                run(
                    on: webView,
                    """
                    (function () {
                      var company = \(quoted(company));
                      if (window.trueline && window.trueline.openCompany) {
                        window.trueline.openCompany(company);
                      }
                    })();
                    """
                )
            }

            // A walked room and a scanned room go across the same hook and come
            // out the same on the other side. Which one this is, is the only
            // difference, and it stops here.
            // A corrected room outranks the capture it was made from: it is the
            // same room with somebody's tape readings already in it, and opening
            // the capture instead would silently throw them away.
            if !parent.correctedJSON.isEmpty,
               let saved = String(data: parent.correctedJSON, encoding: .utf8) {
                run(
                    on: webView,
                    """
                    (function () {
                      var saved = \(quoted(saved));
                      if (window.trueline && window.trueline.openSaved) {
                        window.trueline.openSaved(saved);
                      } else {
                        window.truelinePayload = { saved: saved };
                      }
                    })();
                    """
                )
                return
            }

            if !parent.traceJSON.isEmpty {
                guard let trace = String(data: parent.traceJSON, encoding: .utf8) else { return }
                run(
                    on: webView,
                    """
                    (function () {
                      var trace = JSON.parse(\(quoted(trace)));
                      var name = \(quoted(parent.title));
                      if (window.trueline && window.trueline.openTrace) {
                        window.trueline.openTrace(trace, name);
                      } else {
                        window.truelinePayload = { trace: trace, fileName: name };
                      }
                    })();
                    """
                )
                return
            }

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
            run(on: webView, script)
        }

        private func run(on webView: WKWebView, _ script: String) {
            webView.evaluateJavaScript(script) { _, error in
                if let error {
                    // Worth a line in the console: a capture that does not
                    // arrive looks exactly like one that produced nothing.
                    print("Trueline: the capture did not reach the web view — \(error)")
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
