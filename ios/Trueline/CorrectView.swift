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

    /// Which screen the page opens on.
    ///
    /// The app used to have one way in — open a scan — so the floor, the
    /// handbook and the contractor's own business details all lived behind
    /// links inside some room's page. Setting a licence number meant first
    /// picking a room you did not want to look at. Floor and Business are tabs
    /// now, and both load this same bundle with nothing scanned; the route is
    /// how they say where to land.
    ///
    /// It goes across on the URL fragment, which is the one part of a URL the
    /// scheme handler never sees and never has to serve.
    /// And `draw`, which is the door a finished screen did not have.
    ///
    /// Tapping a room's corners on a grid is built, tested and audited in
    /// `Sketch.tsx`, and on a phone there was no way to open it. The page shows
    /// it when it is loaded with no room in it, and the app never loads it that
    /// way except on Floor and Business — so the only route to the grid was to
    /// start a scan, fail it, open the dead capture and take the way out.
    /// A way out is not a way in.
    enum Opening: String {
        case room = ""
        case floor = "floor"
        case business = "business"
        case draw = "draw"
        /// The worked example, and the same example with the tour running over
        /// it. Both load a finished kitchen the app itself produced, so every
        /// screen has real numbers on it before anybody has scanned anything.
        case demo = "demo"
        case tour = "tour"

        var url: URL {
            self == .room
                ? WebBundle.start
                : URL(string: WebBundle.start.absoluteString + "#" + rawValue)!
        }
    }

    var opensOn: Opening = .room

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
    ///
    /// Nothing on the Floor and Business tabs: there is no scan open there, so
    /// there is no folder to save into and no folder of photographs the page
    /// may read. `WebBundle` already refuses a photograph request when it has
    /// no folder, and says so, which is the right answer rather than a blank.
    var folder: URL?
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

    /// Every corrected room on this phone, as `persist.ts` wrote them.
    ///
    /// Only on the Floor tab, and empty everywhere else. The floor is built out
    /// of rooms in the page's own storage, which until now only ever held a
    /// room somebody had actually opened — so a phone with six scans showed an
    /// empty floor until each had been visited one at a time. The app has all
    /// six on disk; this hands them over.
    var everyRoom: [Data] = []

    /// What has gone wrong on this phone, for the Business screen to list.
    ///
    /// Built by `Diagnostics.asJSON()` and handed across like everything else:
    /// a web view has no filesystem, so the list of files has to come from this
    /// side or not exist. Empty on every screen but Business.
    var reportsJSON: Data = Data()

    /// What the Business screen asked to do about them — `send` or `clear`.
    ///
    /// The page cannot send anything itself: there is no mail composer in a web
    /// view and no network in this bundle. It says which of two things somebody
    /// tapped, and `WebScreen` does it.
    /// The Claim screen asked to open the camera again, for marks only.
    ///
    /// Nothing on the Floor, Business or Draw screens: there is no room open
    /// there to add a mark to, so the button is not shown and this is never
    /// called.
    var onMarkAgain: () -> Void = {
        // No room open, so there is nothing to mark. The web half hides the
        // button when this handler is absent; this default is for the screens
        // where the handler exists and the answer is still nothing.
    }

    var onTrouble: (String) -> Void = { _ in
        // Every screen but Business. There are no reports listed there to act
        // on, so there is nothing for a tap to mean.
    }

    /// A JavaScript error the correction screens threw: message, where, stack.
    ///
    /// Every screen, not just Business — a takeoff that goes blank in a
    /// basement is exactly the failure nothing else in this app can see, and it
    /// has to be caught where it happens rather than where it is read.
    var onWebError: (String, String, String) -> Void = { _, _, _ in
        // A build with no diagnostics attached. Nothing is written and nothing
        // fails; the console still has it.
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        // Which capture's photographs this page may show — one folder, the one
        // being looked at, and nothing else on the disk.
        context.coordinator.bundle.photos = folder?.appendingPathComponent("photos", isDirectory: true)

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
        // Two directions on one channel: an error the page threw, which gets
        // written into the reports folder, and a tap on Send them or Delete
        // them, which `WebScreen` acts on. Most of this app is these screens,
        // and MetricKit cannot see a single thing that happens in here.
        configuration.userContentController.add(context.coordinator, name: "trouble")
        // "Open the camera again, for marks only." One word on the wire and no
        // payload: the app already knows which room is open, and a screen that
        // could name a folder would be a screen that could name any folder on
        // the phone. This one runs whatever HTML it is given.
        configuration.userContentController.add(context.coordinator, name: "mark")
        // A fact sheet, and which of four jobs to do with it. The answer goes
        // back through `window.trueline.drafted`. See `Draftsman` for why the
        // instruction is written in Swift rather than sent from the page: a web
        // view runs whatever HTML it is given, and a channel that carried its
        // own instruction would be a channel that carried any instruction.
        configuration.userContentController.add(context.coordinator, name: "draft")
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
        webView.load(URLRequest(url: opensOn.url))
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

            case "mark":
                parent.onMarkAgain()

            case "draft":
                guard
                    let id = body["id"] as? String,
                    let job = (body["job"] as? String).flatMap(Draftsman.Job.init(rawValue:)),
                    let notes = body["notes"] as? String,
                    let webView = message.webView
                else { return }
                Task { @MainActor [weak self] in
                    // Built here rather than held as a property: `Draftsman` is
                    // @MainActor and this coordinator is not, so a stored one
                    // could not be constructed. It carries no state between
                    // asks -- each draft is its own session, so one job cannot
                    // see another job's notes.
                    let written = await Draftsman().draft(job, from: notes)
                    guard let self else { return }
                    // Back through the same hook everything else arrives on.
                    // `null` is an ordinary answer -- the model was busy, or
                    // refused -- and the far side turns it into "no draft this
                    // time" rather than into an error.
                    let quotedText = written.map { self.quoted($0) } ?? "null"
                    webView.evaluateJavaScript(
                        "window.trueline && window.trueline.drafted"
                        + "(\(self.quoted(id)), \(quotedText))"
                    )
                }

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

            case "trouble":
                // Two shapes, and the one that is present decides which. Both
                // are capped and neither names a file: `Diagnostics` chooses
                // every file name it writes, and `WebScreen` accepts exactly
                // two words. A web view is a program, and this is the channel
                // that can put bytes on disk and open a mail.
                if let action = body["action"] as? String {
                    parent.onTrouble(action)
                    return
                }
                guard let message = body["message"] as? String, !message.isEmpty else { return }
                parent.onWebError(
                    message,
                    (body["where"] as? String) ?? "",
                    (body["stack"] as? String) ?? ""
                )

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
            // Everything, in one call, with one fallback.
            //
            // ## The bug this replaced
            //
            // There were five calls here, each guarded like this:
            //
            //     if (window.trueline && window.trueline.setSubscribed) { ... }
            //
            // `open` and `openSaved` had an `else` that parked the payload on
            // `window.truelinePayload` for the page to pick up when it was
            // ready. `setSubscribed`, `openCompany`, `putRooms` and
            // `openReports` had no `else` at all -- if the page was not ready,
            // they were dropped silently and permanently.
            //
            // The bundle is served through `WebBundle`, a `WKURLSchemeHandler`,
            // and `didFinish` can fire before a module fetched through that
            // handler has run. So on a real phone `setSubscribed` never landed,
            // the web side's `waiting()` stayed true forever, and every gated
            // screen -- Takeoff, Price, Agreement, Work, Insurance -- drew
            // itself as a blank panel. Not a paywall. Nothing.
            //
            // Reproduced in a browser on 2026-08-26 by installing the message
            // handlers and never calling `setSubscribed`: the Takeoff panel
            // came back with `innerText` of `""`, which is exactly what the
            // first person to use this app photographed and sent back.
            //
            // So: one payload, one `else`, and the order it is applied in lives
            // on the far side in `installBridge`'s `take` -- one copy, used by
            // both the live call and the drained one. Two copies of that order
            // was the bug.
            var payload: [String: String] = [:]

            if let company = String(data: parent.companyJSON, encoding: .utf8), !company.isEmpty {
                payload["company"] = quoted(company)
            }
            payload["subscribed"] = parent.subscribed ? "true" : "false"
            // Whether this phone can write a sentence for somebody. Handed
            // across rather than asked for, like the subscription and for the
            // same reason: `SystemLanguageModel` is on this side and a web view
            // cannot reach it.
            //
            // It decides whether a screen offers a draft AT ALL. On a phone
            // that cannot run the model there is no button, no greyed control
            // and no explanation -- see `Draftsman`. Somebody who cannot have
            // it never learns it exists, which is the only version that does
            // not read as a missing feature.
            payload["draftable"] = Draftsman.isAvailable ? "true" : "false"
            if let reports = String(data: parent.reportsJSON, encoding: .utf8), !reports.isEmpty {
                payload["reports"] = quoted(reports)
            }
            if !parent.everyRoom.isEmpty {
                let rooms = parent.everyRoom
                    .compactMap { String(data: $0, encoding: .utf8) }
                    .map { quoted($0) }
                    .joined(separator: ", ")
                payload["rooms"] = "[\(rooms)]"
            }

            // Which room, if any. A corrected one outranks a walked one
            // outranks a scanned one: the same room with progressively more of
            // somebody's work in it, and opening an earlier one would throw the
            // later work away.
            payload["fileName"] = quoted(parent.title)
            if let saved = String(data: parent.correctedJSON, encoding: .utf8), !saved.isEmpty {
                payload["saved"] = quoted(saved)
            } else if let trace = String(data: parent.traceJSON, encoding: .utf8), !trace.isEmpty {
                payload["trace"] = "JSON.parse(\(quoted(trace)))"
            } else if let room = String(data: parent.roomJSON, encoding: .utf8), !room.isEmpty {
                payload["room"] = "JSON.parse(\(quoted(room)))"
                if let photos = String(data: parent.photosJSON, encoding: .utf8), !photos.isEmpty {
                    payload["photos"] = "JSON.parse(\(quoted(photos)))"
                }
                // `pins` is simply absent when nothing was marked, which is the
                // truth for most scans and needs no special case on the far
                // side.
                if let pins = String(data: parent.pinsJSON, encoding: .utf8), !pins.isEmpty {
                    payload["pins"] = "JSON.parse(\(quoted(pins)))"
                }
            }

            // Sorted so the script is the same bytes for the same payload,
            // which makes it something a person can read in a log and compare.
            let fields = payload.keys.sorted()
                .map { "  \($0): \(payload[$0]!)" }
                .joined(separator: ",\n")

            run(
                on: webView,
                """
                (function () {
                  var payload = {
                \(fields)
                  };
                  if (window.trueline && window.trueline.take) {
                    window.trueline.take(payload);
                  } else {
                    window.truelinePayload = payload;
                  }
                })();
                """
            )
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
