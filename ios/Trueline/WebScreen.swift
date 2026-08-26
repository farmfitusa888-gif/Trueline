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
            everyRoom: opensOn == .floor ? store.correctedRooms() : []
        )
            .ignoresSafeArea(.container, edges: .bottom)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { HandbookButton() }
            .onAppear { store.refresh() }
    }
}
