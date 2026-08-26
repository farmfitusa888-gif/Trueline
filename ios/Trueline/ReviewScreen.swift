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
                        corrected: project
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
            companyJSON: store.company
        )
            .ignoresSafeArea(.container, edges: .bottom)
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
