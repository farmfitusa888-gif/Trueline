import SwiftUI

@main
struct TruelineApp: App {
    @StateObject private var store = ProjectStore()

    var body: some Scene {
        WindowGroup {
            NavigationStack {
                ProjectsScreen(store: store)
            }
        }
    }
}
