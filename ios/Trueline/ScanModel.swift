import Combine
import Foundation
import RoomPlan
import SwiftUI
import UIKit

/// Owns a scan from the moment it starts to the moment it is on disk.
///
/// Deliberately the only place that knows the order of things — start the
/// session, take photographs while it runs, stop it, wait for RoomPlan to settle,
/// write the folder. A view that knew that order would be a view that could get
/// it wrong.
@MainActor
final class ScanModel: ObservableObject {

    @Published var finished: SavedScan?
    @Published var name: String = "Room"

    /// What the app is doing between the last frame and a room on disk.
    ///
    /// RoomPlan does not hand back a room when the session stops. It hands back
    /// raw data, and `RoomBuilder` turns that into walls, doors and windows —
    /// which for a living room walked with a hundred photographs takes a good
    /// while longer than it does for a bathroom.
    ///
    /// This used to be a silent eight-second wait that then **saved whatever
    /// was there, including nothing**. So a big room produced a folder with no
    /// room in it, the list said "Nothing to show for this one", and a
    /// completely successful scan looked like a failed one:
    ///
    /// > "AFTER THE SCAN, ITLL FLASH THE 3D SCAN AND THEN GO AWAY, AND AFTER
    /// >  THAT I DIDNT SEE ANY BLUEPRINTS OR 3D SCAN"
    ///
    /// It waits as long as it takes now, says so on screen, and if the build
    /// genuinely fails it says that instead of writing an empty folder.
    enum Stage: Equatable {
        case walking
        case building
        case failed(String)
    }

    @Published private(set) var stage: Stage = .walking

    /// The folder of a room that already exists, when this is a marking pass.
    ///
    /// ## What a marking pass is, and why it is not a second scan
    ///
    /// > "Yes, and let it re-open the scanner too" — for the Claim screen.
    /// > "Marks onto the room you already have."
    ///
    /// Damage turns up on the second visit. A water line behind a cabinet, a
    /// stain that only shows once the lights are on. Until now the only way to
    /// mark it was to walk the whole room again, which produces a **second
    /// room** — a second set of walls, a second folder, and every tape reading
    /// typed against the first one left behind on it.
    ///
    /// So a marking pass runs the same capture session, for the same reason
    /// (Mark needs a tracked camera and a ray to cast), and then throws the
    /// walls away. Nothing RoomPlan builds is written. What is written is the
    /// pins and the photographs, merged into the folder the room is already in.
    ///
    /// The room, its measurements, and everything typed against it are
    /// untouched by definition: this never opens `room.json` and never calls
    /// `CaptureWriter.write`.
    var markingInto: URL?

    let session: ScanSession
    private let store: ProjectStore
    /// All four are remade by `reset`, so a second scan on the same tab is a
    /// genuinely new scan rather than the last one written over.
    private var recorder: PhotoRecorder
    private var startedAt = Date()
    private var scratch: URL
    private var relay: AnyCancellable?
    private var begun = false

    /// Passes the session's changes on as our own.
    ///
    /// This is the bug that made both capture screens look broken. SwiftUI watches
    /// exactly one publisher per `@StateObject` — this model's. `session` is a
    /// separate `ObservableObject`, so every `@Published` on it changed in
    /// silence: the reticle stayed hollow, the instruction stayed on its first
    /// sentence, the wall lengths never appeared, and **the shutter stayed disabled and the
    /// trailing button still read "Close"**, because `.disabled(!session.canClose)` was evaluated once at
    /// first render and never again. The camera feed was live because UIKit
    /// draws itself, so it looked like an app that had simply given up.
    ///
    /// One subscription fixes all of it.
    init(store: ProjectStore) {
        self.store = store
        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("scan-\(UUID().uuidString)", isDirectory: true)
        self.scratch = folder
        self.recorder = PhotoRecorder(directory: folder.appendingPathComponent("photos"))
        self.session = ScanSession(recorder: recorder)
        relay = session.objectWillChange.sink { [weak self] _ in
            self?.objectWillChange.send()
        }
    }

    /// Ready for the next room.
    ///
    /// ## The report this answers
    ///
    /// > "THE SCAN SCREEN DOESNT EVER CLOSE OUT TRULY AFTER A SCAN... WHEN YOU
    /// >  GO BACK INTO SCAN IT GOES BACK INTO THE SAME PROJECT"
    ///
    /// And it did, because nothing ever put this back. Scan is a **tab** now,
    /// so its `@StateObject` lives for as long as the app does: `finished`
    /// stayed set from the last scan, `begun` stayed true so `begin()` returned
    /// without starting the camera — a black screen that only closing the app
    /// could clear — and `name` still said what the last room was called.
    ///
    /// Everything that belongs to one scan is remade here: a fresh scratch
    /// folder, a fresh photo recorder, a fresh start time (which is what the
    /// folder is named after, so the old one cannot be written over), and a
    /// session that has not been stopped.
    func reset() {
        session.reset()
        stage = .walking
        finished = nil
        name = "Room"
        begun = false
        startedAt = Date()
        scratch = FileManager.default.temporaryDirectory
            .appendingPathComponent("scan-\(UUID().uuidString)", isDirectory: true)
        recorder = PhotoRecorder(directory: scratch.appendingPathComponent("photos"))
        session.take(recorder)
    }

    var showingFailure: Binding<Bool> {
        Binding(
            get: { self.session.failure != nil },
            set: { if !$0 { self.session.dismissFailure() } }
        )
    }

    /// The camera, on and ready to walk a room.
    ///
    /// ## What `begun` used to mean, and why it broke the tab
    ///
    /// It meant "this model has ever started a session", and it was never put
    /// back. That was right when Scan was a screen you pushed and popped: the
    /// model died with the screen. It is a **tab** now, so the model lives as
    /// long as the app — and the second time anybody opened Scan this returned
    /// without starting anything:
    ///
    /// > "THE SCANNER DOESNT ALWAYS LOAD, NEEDING TO CLOSE THE APP AND GO BACK
    /// >  INTO IT"
    ///
    /// Closing the app was the only way, because that was the only thing that
    /// built a new model.
    ///
    /// It means "a session is up right now" instead. Which is the question that
    /// was actually being asked, and it answers itself correctly however many
    /// times somebody comes back.
    func begin() {
        guard !session.isRunning, stage == .walking, finished == nil else { return }
        begun = true
        session.start()
    }

    /// Switching to another tab.
    ///
    /// The camera goes off, because a LiDAR session running behind the Rooms
    /// list is a phone that gets hot and flat while somebody reads a takeoff.
    ///
    /// And the half-built room goes with it. `captureSession.stop()` makes
    /// RoomPlan deliver whatever it has, so without this the session sat
    /// holding a room from an interrupted walk — and the next press of Done
    /// would have found it instantly and saved *that*, with none of the walls
    /// somebody had just walked.
    func stepAway() {
        guard stage == .walking, finished == nil else { return }
        session.reset()
        begun = false
    }

    /// Stop, wait for the room, write it down.
    ///
    /// RoomPlan does its final pass after the session stops, so the room is not
    /// there the instant the button is pressed. Waiting for it is not a spinner
    /// for the sake of one — the room genuinely does not exist yet.
    func finish() {
        if let folder = markingInto {
            // No room is being built, so there is nothing to wait for. Stop the
            // session so the last frames are in, then merge.
            stage = .building
            session.stop()
            keepMarks(in: folder)
            return
        }
        // Read before the session is told to stop, because stopping is what
        // makes it false.
        //
        // The wait below has no deadline on purpose, and a wait with no
        // deadline needs to know that an answer is actually coming. It comes
        // from `didEndWith`, and `didEndWith` only fires for a session that was
        // running. Pressing Done on a session that had already been stopped by
        // something else -- a phone call, a tab switch that raced the tap --
        // would otherwise leave "Building the room from your scan" on the
        // screen for ever, which is the shape of every "IT GETS STUCK" report
        // this app has ever had.
        let wasRunning = session.isRunning
        stage = .building
        session.stop()
        Task {
            guard wasRunning || session.capturedRoom != nil || session.failure != nil else {
                stage = .failed(
                    "The camera had already stopped before Done was pressed, so there is no "
                    + "scan to build a room from. Nothing has been thrown away — any "
                    + "photographs taken are still on this phone. Walk it again."
                )
                return
            }
            // Until it is there, or until RoomPlan says it cannot be done.
            //
            // Not a deadline. There was an eight-second one, and what it did
            // when it ran out was call `save()` anyway -- with
            // `session.capturedRoom` still nil, which wrote a folder with no
            // room in it. A living room walked with a hundred photographs takes
            // longer than eight seconds to build, so the bigger the scan the
            // more certain it was to be thrown away.
            //
            // There is nothing to guard against by giving up: `didEndWith` is
            // called exactly once by RoomPlan after `stop()`, and it either
            // sets the room or sets a failure. Waiting for one of those two is
            // waiting for an answer that is coming.
            //
            // And it is an answer about THIS walk. `session.capturedRoom` used
            // to be able to hold a room built from a session that had been
            // stopped minutes earlier, so this loop could finish before it
            // started and save a room nobody had just walked -- the square
            // blueprint and the half box. `ScanSession.isLive(_:)` is what
            // makes that impossible now.
            while session.capturedRoom == nil && session.failure == nil {
                try? await Task.sleep(for: .milliseconds(150))
            }
            guard session.capturedRoom != nil else {
                // RoomPlan itself could not make a room of it. The photographs
                // are still in the scratch folder and the message says so --
                // this is the one case where there is genuinely nothing to
                // write, and it must not be written as if there were.
                stage = .failed(session.failure ?? "The scan could not be turned into a room.")
                return
            }
            save()
        }
    }

    /// Adds this pass's marks and photographs to a room that already exists.
    ///
    /// Both files are **merged, never replaced**. A marking pass that overwrote
    /// `pins.json` would delete every mark made during the original walk, which
    /// is the opposite of what somebody pressing "mark more" is asking for.
    ///
    /// The photographs are moved rather than copied, and only the ones this
    /// pass took: the recorder writes into its own scratch folder, so there is
    /// nothing of the original walk in it to collide with.
    ///
    /// **They used to collide, and the collision won.** Both walks named their
    /// photographs `photo_00001.jpg` upward, so the second pass arrived at a
    /// name the first had already used, the loop skipped it as "already there",
    /// and the mark somebody had just stood in front of and typed a sentence
    /// about ended up pointing at a picture of a different wall. The names
    /// carry the recorder's own series now — see `PhotoRecorder.series` — so
    /// two walks in one folder cannot meet.
    private func keepMarks(in folder: URL) {
        do {
            let lost = CaptureWriter.placePhotographs(
                from: scratch.appendingPathComponent("photos", isDirectory: true),
                into: folder,
                listed: recorder.records.map { $0.fileName }
            )
            if !lost.isEmpty {
                session.reportFailure(CaptureWriter.saying(lost: lost, stillIn: scratch))
            }

            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

            try Self.merge(
                encoder.encode(session.pins.manifest()),
                into: folder.appendingPathComponent("pins.json"),
                under: "pins"
            )
            try Self.merge(
                encoder.encode(recorder.manifest(device: UIDevice.current.model)),
                into: folder.appendingPathComponent("photos.json"),
                under: "photos"
            )

            store.refresh()
            let name = folder.lastPathComponent
            finished = SavedScan(
                folder: folder,
                title: name,
                roomJSON: (try? Data(contentsOf: folder.appendingPathComponent("room.json"))) ?? Data(),
                photosJSON: (try? Data(contentsOf: folder.appendingPathComponent("photos.json"))) ?? Data(),
                pinsJSON: (try? Data(contentsOf: folder.appendingPathComponent("pins.json"))) ?? Data(),
                traceJSON: (try? Data(contentsOf: folder.appendingPathComponent("trace.json"))) ?? Data(),
                correctedJSON: (try? Data(contentsOf: folder.appendingPathComponent(ProjectStore.correctedFile))) ?? Data()
            )
        } catch {
            stage = .failed(error.localizedDescription)
            session.reportFailure(error.localizedDescription)
        }
    }

    /// Appends one manifest's list to the list already in a file.
    ///
    /// Both files are `{"schema": "...", "<under>": [...]}`, so this reads the
    /// two arrays, joins them, and writes the incoming manifest's own schema
    /// back — the two passes are the same build, so the schemas match.
    ///
    /// A file that is not there yet is the ordinary case for `pins.json`: most
    /// scans mark nothing, so most rooms have no pins file at all until the
    /// first marking pass writes one.
    private static func merge(_ incoming: Data, into file: URL, under key: String) throws {
        guard var top = try JSONSerialization.jsonObject(with: incoming) as? [String: Any] else {
            return
        }
        let mine = (top[key] as? [Any]) ?? []
        if mine.isEmpty && !FileManager.default.fileExists(atPath: file.path) { return }
        var all: [Any] = []
        if
            let there = try? Data(contentsOf: file),
            let was = try? JSONSerialization.jsonObject(with: there) as? [String: Any],
            let already = was[key] as? [Any]
        {
            all = already
        }
        all.append(contentsOf: mine)
        top[key] = all
        let data = try JSONSerialization.data(withJSONObject: top, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: file, options: .atomic)
    }

    private func save() {
        // Never on top of a folder that is already there. See `freeFolder`: an
        // arriving scan that lands in a resident folder inherits its
        // `corrected.json`, which outranks a capture on the way to the web
        // view -- so the walk somebody had just finished was never shown.
        let folder = store.freeFolder(named: CaptureWriter.folderName(for: name, at: startedAt))
        do {
            let written = try CaptureWriter.write(
                room: session.capturedRoom,
                photos: recorder,
                pins: session.pins,
                device: UIDevice.current.model,
                to: folder
            )
            // The photographs were written to scratch while walking; move them
            // in beside the room rather than copying, so a large scan does not
            // need twice the space to be saved.
            //
            // One at a time, and the ones that did not make it come back by
            // name. `photos.json` has already been written by the line above
            // and it lists every photograph the walk took, so a move that
            // failed silently was a room claiming evidence it did not have.
            // See `CaptureWriter.placePhotographs`.
            let lost = CaptureWriter.placePhotographs(
                from: scratch.appendingPathComponent("photos", isDirectory: true),
                into: folder,
                listed: recorder.records.map { $0.fileName }
            )
            if !lost.isEmpty {
                session.reportFailure(CaptureWriter.saying(lost: lost, stillIn: scratch))
            }
            store.refresh()
            finished = SavedScan(
                folder: written.folder,
                // The FOLDER's name, not the one typed into the box.
                //
                // `title` is what crosses the bridge as `fileName`, and
                // `fileName` is the key the web half files the room under --
                // in this browser's storage and in the Rooms list. The typed
                // name has no date on it, so every scan a contractor called
                // "Garage" shared one key and one room: the second walk
                // overwrote the first, and re-opening either one gave whichever
                // was written last.
                //
                // Worse, the same folder opened from the Rooms list came over
                // as `folder.lastPathComponent` -- `ProjectStore.load` and
                // `keepMarks` both do that -- so one scan had two different
                // names depending on which screen you reached it from, and
                // corrections made one way were invisible the other way.
                //
                // One name, from the folder, everywhere.
                title: written.folder.lastPathComponent,
                roomJSON: written.roomJSON,
                photosJSON: written.photosJSON,
                pinsJSON: written.pinsJSON
            )
        } catch {
            stage = .failed(error.localizedDescription)
            session.reportFailure(error.localizedDescription)
        }
    }
}

/// A capture that is on disk, and therefore safe to look at.
///
/// One type for all the capture modes on purpose. A LiDAR scan carries a room
/// and photographs; an AR measure carries a trace. What happens next — the plan,
/// the corrections, the tape — is identical, so nothing downstream has to ask
/// which it was.
struct SavedScan: Identifiable, Hashable {
    let folder: URL
    let title: String
    /// RoomPlan's CapturedRoom. Empty for a walked room.
    let roomJSON: Data
    /// The photo manifest. Empty for a walked room.
    let photosJSON: Data
    /// What was pointed at during the walk. Empty when nothing was.
    let pinsJSON: Data
    /// The corners somebody tapped. Empty for a LiDAR scan.
    let traceJSON: Data
    /// The room as somebody corrected it, if they have.
    ///
    /// Kept beside the capture rather than instead of it. The capture is what
    /// the sensor said and never changes; this is what a person said afterwards,
    /// and it outranks the capture everywhere it exists. Empty until somebody
    /// has typed something.
    let correctedJSON: Data

    init(
        folder: URL,
        title: String,
        roomJSON: Data,
        photosJSON: Data,
        pinsJSON: Data = Data(),
        traceJSON: Data = Data(),
        correctedJSON: Data = Data()
    ) {
        self.folder = folder
        self.title = title
        self.roomJSON = roomJSON
        self.photosJSON = photosJSON
        self.pinsJSON = pinsJSON
        self.traceJSON = traceJSON
        self.correctedJSON = correctedJSON
    }

    var id: URL { folder }
    var isTrace: Bool { !traceJSON.isEmpty }

    /// How this room got into the app: `scanned`, `walked` or `drawn`.
    ///
    /// The same three words `ProjectStore.kind(of:)` reads off a folder, worked
    /// out here from what the scan is actually carrying — so a room that has
    /// just been made and one read back off disk answer this the same way.
    /// iCloud stores it, because the capture field is one field and the three
    /// formats are not interchangeable.
    var kind: String {
        if !roomJSON.isEmpty { return "scanned" }
        if !traceJSON.isEmpty { return "walked" }
        return "drawn"
    }
}
