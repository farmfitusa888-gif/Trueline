import SwiftUI

/// The scan, in the app, with everything the web screens do.
///
/// The plan, every dimension marked scanned or measured, what the scanner could
/// not see, and a box to type a real measurement into — all of it the same code
/// the tests run against, none of it written twice.
struct ReviewScreen: View {
    let scan: SavedScan
    @ObservedObject var store: ProjectStore
    @ObservedObject var backup: Backup
    @ObservedObject var subscription: Subscription
    @ObservedObject var calendar: JobCalendar
    /// Where a JavaScript error from these screens goes.
    ///
    /// This is the screen that matters most for it: the takeoff, the plan, the
    /// proposal and the claim document all run in the web view below, and
    /// MetricKit cannot see a single thing that happens inside one. A blank
    /// panel in a basement is invisible without this.
    @ObservedObject var diagnostics: Diagnostics
    /// The Claim screen asked to open the camera again, for marks only.
    ///
    /// Handed in rather than done here, for the same reason `ScanScreen.onClose`
    /// is: this screen does not own the stack it is in, and a screen cannot push
    /// onto a stack it does not hold.
    var onMarkAgain: () -> Void = {
        // A build with nowhere to push. The button is only shown when the
        // handler exists, so this is the case where it exists and there is
        // still nothing to do.
    }
    @State private var sharing = false

    var body: some View {
        // The order here is CorrectView's own declaration order, and it has to
        // be: a struct's memberwise initialiser takes its arguments in the
        // order the properties are declared, and Swift refuses a call that
        // reorders them. This call had `subscribed` and `onVisits` first for
        // as long as it has existed -- "Incorrect argument labels in call" --
        // and nothing found it, because until today nothing had compiled.
        CorrectView(
            roomJSON: scan.roomJSON,
            photosJSON: scan.photosJSON,
            pinsJSON: scan.pinsJSON,
            traceJSON: scan.traceJSON,
            correctedJSON: scan.correctedJSON,
            subscribed: subscription.subscribed,
            onVisits: { visits, company in
                Task { await calendar.put(visits, company: company) }
            },
            title: scan.title,
            folder: scan.folder,
            onSave: { project in
                // Disk first. It is the copy that is true whether or not there
                // is a signal, an iCloud account, or a second device — and it
                // is the one already visible in the Files app.
                store.writeCorrected(project, into: scan.folder)
                Task {
                    await backup.push(
                        scan: scan.title,
                        capture: scan.isTrace ? scan.traceJSON : scan.roomJSON,
                        corrected: project,
                        kind: scan.kind
                    )
                }
            },
            onThumbnail: { png in
                store.writeThumbnail(png, into: scan.folder)
            },
            onDamagePhoto: { name, jpeg in
                // Disk first, same as a save: it is the copy that is true with
                // no signal and no iCloud account, and it is the one the web
                // view reads back to put the picture on the claim document.
                guard store.writeDamagePhoto(jpeg, named: name, into: scan.folder) else { return }
                Task { await backup.pushDamagePhoto(scan: scan.title, photo: name, jpeg: jpeg) }
            },
            onCompany: { json in
                store.writeCompany(json)
                Task { await backup.pushCompany(json) }
            },
            companyJSON: store.company,
            // Skipping `everyRoom`, `reportsJSON` and `onTrouble`, which have
            // defaults: this screen has one room open rather than all of them,
            // and the reports are listed on the Business tab. Named arguments
            // may be omitted but not reordered -- the comment at the top of
            // this call is about exactly that.
            onMarkAgain: onMarkAgain,
            onWebError: { message, place, stack in
                diagnostics.record(webError: message, at: place, stack: stack)
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
            .navigationTitle(scan.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { sharing = true } label: {
                        Image(systemName: "square.and.arrow.up")
                    }
                    .accessibilityLabel("Send this scan")
                }
                // Beside it, on every screen in the app. The web page's own
                // "How to use it" link is hidden inside the app now -- a row of
                // small underlined links along the top was a second,
                // different-looking navigation over the top of this one.
                HandbookButton()
            }
            // Sharing the folder is how a scan leaves this phone: AirDrop it,
            // put it in Files, mail it. No account and no server involved.
            .sheet(isPresented: $sharing) {
                ShareSheet(items: [scan.folder])
            }
    }
}

private struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
