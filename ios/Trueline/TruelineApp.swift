import SwiftUI

@main
struct TruelineApp: App {
    @StateObject private var store = ProjectStore()
    @StateObject private var backup = Backup()

    var body: some Scene {
        WindowGroup {
            NavigationStack {
                ProjectsScreen(store: store, backup: backup)
            }
            .task {
                // Ask iCloud whether there is anywhere to put a copy, once, at
                // start-up. Everything else waits on the answer, and the answer
                // is shown on the list rather than kept quiet.
                await backup.check()
                let missing = await backup.fetchMissing(have: store.names)
                for scan in missing {
                    store.restore(name: scan.name, capture: scan.capture, corrected: scan.corrected)
                }
                // And the contractor's own details, for a phone that has none.
                // Only when there are none: a copy from elsewhere must never
                // overwrite something typed on this device.
                if store.company.isEmpty, let profile = await backup.fetchCompany() {
                    store.writeCompany(profile)
                }
            }
        }
    }
}
