import SwiftUI

/// Drawing a room by tapping its corners, opened on purpose rather than by accident.
///
/// ## The door that was not there
///
/// Tapping a room's corners onto a grid is `Sketch.tsx`: built, unit-tested,
/// audited in a real browser, and documented in the handbook. On a phone it
/// could not be opened.
///
/// The page shows the grid when it is loaded with **no room in it**, and the app
/// only ever loads it that way on the Floor and Business tabs — both of which
/// route themselves somewhere else. So the single path to the grid ran: start a
/// scan, let it fail, find the dead capture in the list, and take one of the
/// ways out of it. A way out is not a way in, and a feature reachable only by
/// breaking something first is not reachable.
///
/// That is the third time this product has produced a finished, unreachable
/// screen — `Sections.tsx` for the room's own parts, `RootTabs.swift` for the
/// floor and the business details, and now this. The lesson each time is the
/// same: **work that is finished and unreachable is indistinguishable from work
/// that was never done.**
///
/// ## Why it is a capture screen and not a place
///
/// Scan, Measure and this are the three ways a room gets into the app, and all
/// three end the same way: a folder on disk, and the room opened properly in
/// `ReviewScreen` on the Rooms tab. That matters for more than tidiness — the
/// review screen is where a room has a folder, so it is the only place a
/// photograph of damage can be written next to the room it belongs to, a plan
/// thumbnail can be kept, and a save can reach iCloud. A drawing that stayed on
/// this screen would have all of that quietly doing nothing.
///
/// So this screen's whole job is: show the grid, wait for a room to come back
/// out of it, write it down, and hand it on.
///
/// ## What a drawn room has in its folder
///
/// `corrected.json`, and nothing else. There was no sensor, so there is no
/// `room.json`; there was no walk, so there is no `trace.json`. The room came
/// off a grid somebody tapped and the corrected file **is** the room —
/// `ProjectStore.holdsARoom` and `load` both know that, and `kind(of:)` calls
/// such a folder `drawn` rather than squeezing it into one of the other two
/// words.
struct DrawScreen: View {
    @ObservedObject var store: ProjectStore
    @ObservedObject var backup: Backup
    @ObservedObject var diagnostics: Diagnostics
    /// Handed the finished room, so the screen holding the stack can put the
    /// review in this screen's place rather than on top of it — the same
    /// contract `ScanScreen` and `ARMeasureScreen` have, for the same reason.
    let onFinished: (SavedScan) -> Void

    /// When this drawing was started, so the folder it lands in is named after
    /// the moment somebody opened the grid rather than the moment they finished
    /// tapping. Fixed once, here, because `Date()` read inside `body` is a new
    /// answer on every redraw.
    @State private var startedAt = Date()
    /// Set once the room has been written, so a second save — the page saves
    /// after every change — does not make a second folder.
    @State private var written = false
    /// Why nothing was saved, when nothing was. Shown rather than swallowed:
    /// somebody who has just tapped out a kitchen and been told nothing has
    /// lost the work and does not know it.
    @State private var trouble: String?

    var body: some View {
        CorrectView(
            opensOn: .draw,
            roomJSON: Data(),
            photosJSON: Data(),
            pinsJSON: Data(),
            traceJSON: Data(),
            correctedJSON: Data(),
            // Nothing on this screen is behind the paywall — drawing a room is
            // how somebody with no LiDAR uses this app at all, and the free
            // tier is decided in `entitlement.ts` rather than here.
            subscribed: true,
            onVisits: { _, _ in
                // Scheduling belongs to a job. There is no job yet; the room is
                // still being drawn.
            },
            title: "Draw a room",
            // No folder yet, and that is the point of this screen being brief:
            // the moment there is a room there is a folder, and the review
            // screen it hands off to has it.
            folder: nil,
            onSave: keep,
            onThumbnail: { _ in
                // A thumbnail is a picture of a room's plan, for the list. The
                // room is one frame old here and has no folder to keep it in;
                // the review screen this hands off to draws and keeps it.
            },
            onDamagePhoto: { _, _ in
                // Damage is marked on a job, and there is no job here yet. The
                // Insurance section is not reachable while the grid is up.
            },
            onCompany: { json in
                // A licence number typed on the way past still belongs to the
                // business rather than to this drawing.
                store.writeCompany(json)
                Task { await backup.pushCompany(json) }
            },
            companyJSON: store.company,
            onWebError: { message, place, stack in
                diagnostics.record(webError: message, at: place, stack: stack)
            }
        )
        .ignoresSafeArea(.container, edges: .bottom)
        .navigationTitle("Draw a room")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { HandbookButton() }
        .alert(
            "This room could not be saved",
            isPresented: .init(get: { trouble != nil }, set: { if !$0 { trouble = nil } })
        ) {
            Button("All right", role: .cancel) { trouble = nil }
        } message: {
            Text(trouble ?? "")
        }
    }

    /// Writes the drawn room down, once, and hands it on.
    ///
    /// The page saves after every change, so this fires again while somebody is
    /// still typing tape readings into the room they have just drawn. Only the
    /// first one does anything here: by then the room is on the Rooms tab and
    /// `ReviewScreen` owns every save after it.
    private func keep(_ project: Data) {
        guard !written else { return }
        // The name comes out of the project itself rather than being asked for
        // twice: the grid already asked what the room is called, and a second
        // box on this side would be the same question in a different place.
        let name = Self.name(inside: project)
        let folder = store.folder(named: CaptureWriter.folderName(for: name, at: startedAt))
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try project.write(
                to: folder.appendingPathComponent(ProjectStore.correctedFile),
                options: .atomic
            )
        } catch {
            trouble = error.localizedDescription
            return
        }
        written = true
        store.refresh()
        Task { await backup.push(scan: folder.lastPathComponent, capture: Data(), corrected: project, kind: "drawn") }
        onFinished(
            SavedScan(
                folder: folder,
                title: folder.lastPathComponent,
                roomJSON: Data(),
                photosJSON: Data(),
                correctedJSON: project
            )
        )
    }

    /// What the page called this room.
    ///
    /// `persist.ts` writes `fileName` at the top of every saved project, which
    /// is the name typed on the grid. Read rather than guessed at, and falling
    /// back to `Room` — the same fallback `CaptureWriter.folderName` uses — when
    /// a build writes something this one cannot read.
    static func name(inside project: Data) -> String {
        guard
            let top = try? JSONSerialization.jsonObject(with: project) as? [String: Any],
            let name = top["fileName"] as? String,
            !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return "Room" }
        return name
    }
}
