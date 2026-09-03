import SwiftUI
import WebKit

/// The handbook, one tap from anywhere in the app.
///
/// ## Why it is a button and not a tab
///
/// iOS folds anything past the fifth tab into a "More" list, which is where
/// features go to be forgotten — the exact failure `Sections.tsx` was built to
/// end one level down. Five tabs is a real budget, and Rooms, Scan, Measure,
/// Floor and Business each name a place somebody works.
///
/// A handbook is not a place you work. It is a thing you reach for, in the
/// middle of doing something else, and then put down. So it is in the
/// navigation bar of every screen instead — which reaches it from more places
/// than a tab would, without spending one.
///
/// ## Why it is a sheet
///
/// Because you are reading it *about* something. Pushing it would take the
/// screen away and make somebody find their way back to what they were doing;
/// a sheet slides over, and pulling it down puts them exactly where they were,
/// mid-correction, with nothing lost.
///
/// The handbook itself is 54 cards with a search box, built by
/// `docs/build/check-guide.py`'s subject and shipped inside the app — because
/// the person who needs it is standing in an unfinished basement with no
/// signal.
struct HandbookButton: ToolbarContent {
    @State private var reading = false

    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button {
                reading = true
            } label: {
                Image(systemName: "book")
            }
            // Named for what it opens. The icon alone announces as "book",
            // which is what it looks like rather than what it does.
            .accessibilityLabel("How to use it")
            .sheet(isPresented: $reading) {
                NavigationStack {
                    HandbookScreen()
                        .navigationTitle("How to use it")
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .topBarTrailing) {
                                Button("Done") { reading = false }
                            }
                        }
                }
            }
        }
    }
}

/// The handbook page out of the app's own bundle.
///
/// Its own view rather than `CorrectView` with another route: `CorrectView`
/// carries five message handlers, a scan, a folder of photographs and a
/// subscription, and the handbook is a page that reads. Handing a document all
/// of that so it can use none of it would be the kind of reuse that costs more
/// than it saves.
struct HandbookScreen: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        // Same scheme as the rest of the bundle. See `WebBundle`: a page loaded
        // from `file://` has an opaque origin and its modules never run, which
        // looks exactly like a hang.
        configuration.setURLSchemeHandler(context.coordinator.bundle, forURLScheme: WebBundle.scheme)
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        guard context.coordinator.bundle.isPresent else {
            webView.loadHTMLString(
                """
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <body style="font:16px -apple-system;padding:24px;color:#0f172a">
                <h2>The handbook is missing from this build.</h2>
                <p>Xcode's build step copies <code>web/dist</code> into
                <code>ScanToBid/Web</code>, and the handbook is copied in beside it.
                Run <code>npm run ship-web</code> and build again.</p>
                </body>
                """,
                baseURL: nil
            )
            return webView
        }
        webView.load(URLRequest(url: HandbookScreen.page))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    static let page = URL(string: "trueline://app/handbook.html")!

    final class Coordinator: NSObject {
        /// Held here because the configuration does not retain it.
        let bundle = WebBundle()
    }
}
