import SwiftUI

/// Where you are in the app, along the bottom, at all times.
///
/// ## The report this answers
///
/// > "weird opening screen again and no navigation tabs on the bottom. have to
/// > go through a project to get to the options."
///
/// And that was exactly true. The whole app was one list of scans inside one
/// navigation stack, and everything that was not a scan — the floor, the
/// handbook, the contractor's own business details — lived behind small text
/// links at the top of a *scan's* page. So setting your licence number meant
/// first opening some room you did not want to look at, and if you had no scans
/// at all you could not reach any of it.
///
/// The correction screens already learned this lesson once, in `Sections.tsx`:
/// work that is finished and unreachable is indistinguishable from work that
/// was never done. This is the same lesson one level up.
///
/// ## Why these five
///
/// iOS collapses anything past the fifth tab into a "More" list, which is where
/// features go to be forgotten — so five is a real budget and not a style
/// choice. Rooms is home. Scan and Measure are the two ways a room gets into
/// the app and both were asked for by name. Floor is every room at once, flat
/// or as a dollhouse. Business is what goes on the paperwork.
///
/// The handbook is the sixth thing and it is not a tab. It is a book icon in
/// the navigation bar of every screen, which makes it reachable from more
/// places than a tab would and costs nothing: a handbook is a thing you reach
/// for, not a place you work.
struct RootTabs: View {
    @ObservedObject var store: ProjectStore
    @ObservedObject var backup: Backup
    @ObservedObject var subscription: Subscription
    @ObservedObject var calendar: JobCalendar
    /// What went wrong. Only the Business tab shows it — see `Diagnostics` and
    /// `Settings.tsx`: it is the one tab that is about the app rather than
    /// about a room, and a diagnostics icon in front of a contractor every time
    /// he opens the app is a product apologising before it has done anything.
    @ObservedObject var diagnostics: Diagnostics

    /// Which tab is showing. Held here so finishing a capture can put the
    /// review on the Rooms tab and then switch to it, rather than leaving the
    /// finished scan on the Scan tab where the camera is still warm.
    @State private var tab: Tab = .rooms
    /// One stack per tab. Separate on purpose: pushing a room on Rooms must not
    /// disturb where somebody was on Floor, which is the whole reason a tab bar
    /// beats a single stack.
    @State private var roomsPath: [ProjectsScreen.Route] = []

    enum Tab: Hashable {
        case rooms, scan, measure, floor, business
    }

    var body: some View {
        TabView(selection: $tab) {
            NavigationStack(path: $roomsPath) {
                ProjectsScreen(
                    store: store,
                    backup: backup,
                    subscription: subscription,
                    calendar: calendar,
                    diagnostics: diagnostics,
                    path: $roomsPath
                )
            }
            .tabItem { Label("Rooms", systemImage: "square.grid.2x2") }
            .tag(Tab.rooms)

            // Scan and Measure are actions rather than places, and they are
            // tabs anyway because that is where a thumb looks for them. Each
            // owns a stack of one screen; finishing a capture hands the scan
            // to the Rooms tab and switches to it, so nobody is left holding a
            // finished room on top of a live camera.
            NavigationStack {
                ScanScreen(store: store, backup: backup, onFinished: finished)
            }
            .tabItem { Label("Scan", systemImage: "camera.viewfinder") }
            .tag(Tab.scan)

            NavigationStack {
                ARMeasureScreen(store: store, backup: backup, onFinished: finished)
            }
            .tabItem { Label("Measure", systemImage: "ruler") }
            .tag(Tab.measure)

            NavigationStack {
                WebScreen(opensOn: .floor, title: "The floor", store: store, backup: backup)
            }
            .tabItem { Label("Floor", systemImage: "square.split.bottomrightquarter") }
            .tag(Tab.floor)

            NavigationStack {
                WebScreen(
                    opensOn: .business,
                    title: "Your business",
                    store: store,
                    backup: backup,
                    diagnostics: diagnostics
                )
            }
            .tabItem { Label("Business", systemImage: "building.2") }
            .tag(Tab.business)
        }
        // The same amber the web screens use for a control that acts, out of
        // the same generated token file. Before this the tab bar was iOS blue
        // and the room inside it was Trueline amber, which is the seam this
        // whole pass exists to close.
        .tint(Ink.accent)
        .onAppear(perform: Self.dressTheBars)
    }

    /// The bars, painted from the tokens.
    ///
    /// `UITabBar` and `UINavigationBar` are UIKit underneath and SwiftUI's
    /// modifiers reach only part of them, so their appearance is set once,
    /// here, from the same values everything else reads. `UIColor` closures
    /// rather than fixed colours: these resolve per trait, so the bars follow
    /// the phone from a driveway into a basement like the rest of the app.
    private static func dressTheBars() {
        let ground = UIColor { $0.userInterfaceStyle == .dark
            ? UIColor(red: 27/255, green: 33/255, blue: 38/255, alpha: 1)
            : UIColor(red: 1, green: 1, blue: 1, alpha: 1) }

        let tabs = UITabBarAppearance()
        tabs.configureWithOpaqueBackground()
        tabs.backgroundColor = ground
        UITabBar.appearance().standardAppearance = tabs
        UITabBar.appearance().scrollEdgeAppearance = tabs

        let bar = UINavigationBarAppearance()
        bar.configureWithOpaqueBackground()
        bar.backgroundColor = ground
        UINavigationBar.appearance().standardAppearance = bar
        UINavigationBar.appearance().scrollEdgeAppearance = bar
        UINavigationBar.appearance().compactAppearance = bar
    }

    /// A finished capture goes to the Rooms tab, and the app goes with it.
    ///
    /// One route, replacing whatever was there — so back from the review is
    /// back to the list, with no live camera screen left underneath waiting to
    /// push the review on again. That bug is written up in `ProjectsScreen`;
    /// this keeps the fix while moving the capture screens onto their own tabs.
    private func finished(_ scan: SavedScan) {
        store.refresh()
        roomsPath = [.review(scan)]
        tab = .rooms
    }
}
