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
    /// What somebody pointed at while walking. Empty for most scans.
    let pinsJSON: Data
    /// The corners somebody tapped, when the room was walked rather than scanned.
    let traceJSON: Data
    /// The room as somebody already corrected it, if they have. Outranks the
    /// capture: it is the same room with tape readings in it.
    let correctedJSON: Data
    /// Whether this person has paid.
    ///
    /// Handed across rather than asked for by the web half: StoreKit lives on
    /// this side and a web view has no way to ask it. The list of what that
    /// unlocks is shared -- `Entitlement.swift` is generated from the same
    /// TypeScript the web screens import -- so both halves gate on one list.
    let subscribed: Bool

    /// Days to put in the phone's own calendar.
    let onVisits: ([JobCalendar.Visit], String) -> Void

    let title: String
    /// Where this scan lives, so a save can land beside the capture it came from.
    let folder: URL
    /// Called on every save, with the whole saved project.
    let onSave: (Data) -> Void
    /// Called once when the plan is drawn, with a small PNG of it for the list.
    let onThumbnail: (Data) -> Void
    /// Called with a photograph of damage, and the name to file it under.
    ///
    /// The one thing this app handles that cannot be recreated. A dimension can
    /// be measured again — that is the whole product. A water line that has been
    /// cut out and boarded over cannot be photographed by anybody, ever again,
    /// and six weeks later that photograph is the argument.
    let onDamagePhoto: (String, Data) -> Void
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
        // Photographs of damage. They go into the scan's own `photos` folder,
        // which is the folder this same web view is already allowed to read
        // back — so a picture taken on the claim screen is visible on the claim
        // screen, on this phone and on the next one.
        configuration.userContentController.add(context.coordinator, name: "photo")
        // The days somebody has scheduled, on their way to the calendar app.
        configuration.userContentController.add(context.coordinator, name: "calendar")
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

            case "calendar":
                // Handed over as JSON rather than as a dictionary, so the shape
                // is decoded once, by Codable, against a type -- rather than
                // pulled apart key by key with a cast per field, which is how a
                // renamed field becomes a visit that silently never appears.
                guard
                    let json = body["visits"] as? String,
                    let data = json.data(using: .utf8),
                    let visits = try? JSONDecoder().decode([JobCalendar.Visit].self, from: data)
                else { return }
                let company = (body["company"] as? String) ?? ""
                parent.onVisits(visits, company)

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

            case "photo":
                // A data URL, and only a JPEG one, under a name this app
                // chooses the shape of rather than the page. A web view is a
                // program, and this is it handing the app a file to keep:
                // "it said it was a picture" is not a reason to believe it is,
                // and "it said where to put it" is not a reason to put it there.
                let jpeg = "data:image/jpeg;base64,"
                guard
                    let name = body["photoName"] as? String,
                    Self.isSafePhotoName(name),
                    let url = body["photo"] as? String,
                    url.hasPrefix(jpeg),
                    let data = Data(base64Encoded: String(url.dropFirst(jpeg.count))),
                    // A photograph off a phone, capped at a size no camera
                    // exceeds after the page has shrunk it. Bigger than this is
                    // not a photograph of a wall.
                    data.count < 12_000_000,
                    // JPEG's own first bytes, so what lands on disk with a
                    // .jpg on the end really is one.
                    data.starts(with: [0xFF, 0xD8, 0xFF])
                else { return }
                parent.onDamagePhoto(name, data)

            default:
                return
            }
        }

        /// Whether a name the page chose may be used as a file name.
        ///
        /// Letters, digits, dash and underscore, then exactly `.jpg`. No dots
        /// in the stem, so `..` cannot appear; no slashes, so nothing can be
        /// written outside the folder; a length cap, because some filesystems
        /// refuse long names and a refusal here is silent data loss.
        ///
        /// Rejecting rather than sanitising is deliberate. A name that had to
        /// be cleaned up is a name that no longer matches the one the damage is
        /// carrying, and the photograph would be on disk under a name nothing
        /// can find — which looks exactly like a photograph that was lost.
        static func isSafePhotoName(_ name: String) -> Bool {
            guard name.count > 4, name.count <= 120, name.hasSuffix(".jpg") else { return false }
            let stem = name.dropLast(4)
            guard !stem.isEmpty else { return false }
            return stem.allSatisfy { character in
                character.isASCII
                    && (character.isLetter || character.isNumber || character == "-" || character == "_")
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

            // Then whether anything is paid for, before the room: a screen that
            // draws itself locked and then unlocks a frame later has shown
            // somebody who paid a paywall, which is the worst thing this app
            // can do to the person funding it.
            run(
                on: webView,
                """
                (function () {
                  if (window.trueline && window.trueline.setSubscribed) {
                    window.trueline.setSubscribed(\(parent.subscribed ? "true" : "false"));
                  }
                })();
                """
            )

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

            // `null` rather than an omitted argument when nothing was marked:
            // the far side reads a missing `pins` as "nothing was marked",
            // which is the truth for most scans and needs no special case.
            let pins = String(data: parent.pinsJSON, encoding: .utf8)
            let pinsLiteral = pins.map { "JSON.parse(\(quoted($0)))" } ?? "null"

            let script = """
            (function () {
              var room = JSON.parse(\(quoted(room)));
              var photos = JSON.parse(\(quoted(photos)));
              var pins = \(pinsLiteral);
              var name = \(quoted(parent.title));
              if (window.trueline && window.trueline.open) {
                window.trueline.open(room, photos, name, pins);
              } else {
                window.truelinePayload = {
                  room: room, photos: photos, pins: pins, fileName: name
                };
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
