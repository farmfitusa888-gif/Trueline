import SwiftUI

@main
struct TruelineApp: App {
    @StateObject private var store = ProjectStore()
    @StateObject private var backup = Backup()
    /// Whether this person has paid. Asked once at launch, corrected whenever
    /// StoreKit says anything, and read by every screen that gates on it.
    @StateObject private var subscription = Subscription()
    /// The phone's own calendar, written into and never read.
    @StateObject private var calendar = JobCalendar()
    /// What went wrong, kept where somebody can send it. See `Diagnostics`:
    /// until there is an App Store listing, Apple's own crash pipe has nothing
    /// in it, and the six months before that listing exists are the six months
    /// when a crash on Gilbert's phone matters most.
    @StateObject private var diagnostics = Diagnostics()
    var body: some Scene {
        WindowGroup {
            // The tab bar, and everything under it. The navigation stack used
            // to be here and is now one per tab, inside `RootTabs` -- pushing a
            // room on Rooms must not disturb where somebody was on Floor, which
            // is most of the reason to have tabs at all.
            RootTabs(
                store: store,
                backup: backup,
                subscription: subscription,
                calendar: calendar,
                diagnostics: diagnostics
            )
            .task {
                // First, and not inside the awaits below: `start()` picks up
                // the payloads iOS has already collected, and a crash from the
                // previous launch is exactly the thing that must not be lost
                // behind an iCloud round trip that may never come back.
                diagnostics.start()
                // Before anything else: what has been paid for. A screen that
                // draws a paywall over somebody who has already subscribed,
                // even for a moment, is the worst first impression this app
                // could make on the person who has paid for it.
                await subscription.refresh()
                // Ask iCloud whether there is anywhere to put a copy, once, at
                // start-up. Everything else waits on the answer, and the answer
                // is shown on the list rather than kept quiet.
                await backup.check()
                let missing = await backup.fetchMissing(have: store.names)
                for scan in missing {
                    store.restore(
                        name: scan.name, capture: scan.capture, kind: scan.kind,
                        card: scan.card, corrected: scan.corrected
                    )
                    // And the photographs of damage that go with it. Without
                    // these, a claim pulled down onto a second phone opens with
                    // a document referring to evidence the phone has never
                    // seen — and the evidence is the one part of a claim that
                    // cannot be produced again by going back to the building.
                    let folder = store.folder(named: scan.name)
                    for photo in await backup.fetchDamagePhotos(scan: scan.name) {
                        store.writeDamagePhoto(photo.jpeg, named: photo.name, into: folder)
                    }
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
