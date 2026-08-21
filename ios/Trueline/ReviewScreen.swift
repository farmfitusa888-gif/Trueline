import SwiftUI

/// The scan, in the app, with everything the web screens do.
///
/// The plan, every dimension marked scanned or measured, what the scanner could
/// not see, and a box to type a real measurement into — all of it the same code
/// the tests run against, none of it written twice.
struct ReviewScreen: View {
    let scan: SavedScan
    @State private var sharing = false

    var body: some View {
        CorrectView(
            roomJSON: scan.roomJSON,
            photosJSON: scan.photosJSON,
            traceJSON: scan.traceJSON,
            title: scan.title
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
