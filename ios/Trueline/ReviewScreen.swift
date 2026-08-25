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
        CorrectView(
            subscribed: subscription.subscribed,
            onVisits: { visits, company in
                Task { await calendar.put(visits, company: company) }
            },
            roomJSON: scan.roomJSON,
            photosJSON: scan.photosJSON,
            traceJSON: scan.traceJSON,
            correctedJSON: scan.correctedJSON,
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
                }
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
