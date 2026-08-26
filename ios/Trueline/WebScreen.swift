import SwiftUI

/// A tab that is one of the web screens, with no scan open.
///
/// ## Why this exists
///
/// The floor and the contractor's own business details are written once, in
/// `web/`, and they were only ever reachable through a scan — the links to them
/// lived at the top of a room's page. So they were behind a room, and if you
/// had no rooms you could not reach them at all:
///
/// > "have to go through a project to get to the options"
///
/// They are tabs now. This is what a tab shows: the same bundle, the same
/// storage, the same measurement engine, opened on a named screen instead of on
/// a room. Nothing is written twice — a second Swift copy of the floor would be
/// a second thing to keep in step with the first, and small products die of
/// that.
///
/// ## What a tab does NOT get
///
/// No scan folder, so nothing can be saved into one and no folder of
/// photographs is readable. No thumbnail, no damage photograph, no room save:
/// there is no room open to be the subject of any of them. Each of those is a
/// closure that does nothing, and each says why rather than being an empty
/// brace somebody has to guess at.
///
/// The profile IS saved, because that is what the Business tab is for.
struct WebScreen: View {
    let opensOn: CorrectView.Opening
    let title: String
    @ObservedObject var store: ProjectStore
    @ObservedObject var backup: Backup
    /// What went wrong, for the Business tab to list. Nil on the Floor tab:
    /// the floor is a drawing of rooms and has nothing to say about crashes.
    var diagnostics: Diagnostics?

    /// The file of reports, once somebody has asked to send it. Held here
    /// rather than inside `CorrectView` because presenting a mail composer is a
    /// SwiftUI job and `CorrectView` is a web view — it can only say that
    /// somebody tapped the button.
    @State private var sending: ReportsFile?
    /// Set when Send them was tapped and there was nothing to send, so the
    /// screen says that rather than opening an empty mail.
    @State private var nothingToSend = false

    var body: some View {
        CorrectView(
            opensOn: opensOn,
            roomJSON: Data(),
            photosJSON: Data(),
            pinsJSON: Data(),
            traceJSON: Data(),
            correctedJSON: Data(),
            // Nothing here is behind the paywall — the floor is a view of rooms
            // already on the phone and a licence number is not a feature. What
            // the page does with this is decided in `entitlement.ts`, and this
            // hands it the truth rather than a convenient answer.
            subscribed: true,
            onVisits: { _, _ in
                // Scheduling belongs to a job, and there is no job open here.
            },
            title: title,
            folder: nil,
            onSave: { _ in
                // No room is open, so there is nothing to save into a scan's
                // folder. The floor's own joins are the page's to keep and it
                // keeps them in its own storage, where they belong: a join is a
                // statement about two rooms rather than part of either one.
            },
            onThumbnail: { _ in
                // A thumbnail is a picture of one room's plan, for the list of
                // scans. No room, no picture.
            },
            onDamagePhoto: { _, _ in
                // Damage is marked on a room, and there is none open.
            },
            onCompany: { json in
                // The one thing a tab here really does write, and the reason
                // the Business tab exists: a licence number should be typed
                // once in a lifetime, not once per job.
                store.writeCompany(json)
                Task { await backup.pushCompany(json) }
            },
            companyJSON: store.company,
            // Only the floor needs every room. Handing them to the business
            // screen would be filling storage for a screen that never looks.
            everyRoom: opensOn == .floor ? store.correctedRooms() : [],
            // Only the Business tab, and empty everywhere else: the list of
            // reports belongs on the one screen that has somewhere to put it.
            reportsJSON: diagnostics?.asJSON() ?? Data(),
            onTrouble: act,
            onWebError: { message, place, stack in
                diagnostics?.record(webError: message, at: place, stack: stack)
            }
        )
            // Deliberately NOT `.ignoresSafeArea(.container, edges: .bottom)`.
            //
            // It used to be, and that is what put a strip of nothing between the
            // room's own bar and the phone's tab bar. Extending the web view
            // under the tab bar does not tell the PAGE the tab bar is there:
            // inside a web view `env(safe-area-inset-bottom)` reports the home
            // indicator, 34pt, and the tab bar is about 83pt. So the page put
            // its bar 34pt up from the bottom of a view that ran 83pt lower
            // than the visible area, and the 49pt difference was the gap.
            //
            // > "AND PIC 2: FIX THE SPACING BETWEEN THE BOTTOM BAR AND THE
            // >  SMALL ONE."
            //
            // Ending the web view where the tab bar starts makes the page's own
            // bottom the tab bar's top, and the two sit flush with no arithmetic
            // shared between Swift and CSS.
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { HandbookButton() }
            .onAppear { store.refresh() }
            // Mail when the phone has an account set up, and the share sheet
            // when it does not. Not a fallback pretending to be the same thing:
            // the screen names the address either way, so somebody sending it
            // from a webmail app knows where it goes.
            .sheet(item: $sending) { ready in
                if MailReports.canSend {
                    MailReports(file: ready.file) { sending = nil }
                } else {
                    TroubleShareSheet(items: [ready.file])
                }
            }
            .alert("Nothing has gone wrong yet", isPresented: $nothingToSend) {
                Button("All right", role: .cancel) {}
            } message: {
                Text(
                    "There are no reports on this phone. Apple delivers crash reports on a "
                    + "later launch rather than at the moment of the crash, so one from today "
                    + "usually appears tomorrow."
                )
            }
    }

    /// What the Business screen asked for.
    ///
    /// Two words rather than a free-form command, checked here: a web view is a
    /// program, and a screen that could name any file to mail would be a screen
    /// that could mail any file on the phone.
    private func act(_ what: String) {
        guard let diagnostics else { return }
        switch what {
        case "send":
            if let file = diagnostics.bundleUp() {
                sending = ReportsFile(file: file)
            } else {
                nothingToSend = true
            }
        case "clear":
            diagnostics.clear()
        default:
            return
        }
    }
}

/// The file of reports, once there is one, so it can drive `.sheet(item:)`.
///
/// `sheet(isPresented:)` with a separate `@State` for the file has a frame in it
/// where the sheet is up and the file is still nil, and the composer would be
/// built in that frame. Tying the two together means there is a sheet exactly
/// when there is a file.
///
/// A wrapper rather than making `URL` itself `Identifiable`: a retroactive
/// conformance on a standard-library type is visible to every file in the
/// target and collides the moment anything else does the same. This is four
/// lines and belongs to this screen.
struct ReportsFile: Identifiable {
    let file: URL
    var id: String { file.absoluteString }
}
