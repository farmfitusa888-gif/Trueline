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

    let session: ScanSession
    private let store: ProjectStore
    private let recorder: PhotoRecorder
    private let startedAt = Date()
    private let scratch: URL
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
        self.scratch = FileManager.default.temporaryDirectory
            .appendingPathComponent("scan-\(UUID().uuidString)", isDirectory: true)
        self.recorder = PhotoRecorder(directory: scratch.appendingPathComponent("photos"))
        self.session = ScanSession(recorder: recorder)
        relay = session.objectWillChange.sink { [weak self] _ in
            self?.objectWillChange.send()
        }
    }

    var showingFailure: Binding<Bool> {
        Binding(
            get: { self.session.failure != nil },
            set: { if !$0 { self.session.dismissFailure() } }
        )
    }

    func begin() {
        // Coming back from the review screen fires `onAppear` again, and
        // starting again reuses the same scratch folder and the same started-at
        // stamp — which means the same folder name, written over the scan that
        // was just saved.
        guard !begun else { return }
        begun = true
        session.start()
    }

    /// Stop, wait for the room, write it down.
    ///
    /// RoomPlan does its final pass after the session stops, so the room is not
    /// there the instant the button is pressed. Waiting for it is not a spinner
    /// for the sake of one — the room genuinely does not exist yet.
    func finish() {
        session.stop()
        Task {
            for _ in 0..<40 {                       // up to about eight seconds
                if session.capturedRoom != nil { break }
                try? await Task.sleep(for: .milliseconds(200))
            }
            save()
        }
    }

    private func save() {
        let folder = store.folder(named: CaptureWriter.folderName(for: name, at: startedAt))
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
            try? FileManager.default.moveItem(
                at: scratch.appendingPathComponent("photos"),
                to: folder.appendingPathComponent("photos")
            )
            store.refresh()
            finished = SavedScan(
                folder: written.folder,
                title: name,
                roomJSON: written.roomJSON,
                photosJSON: written.photosJSON,
                pinsJSON: written.pinsJSON
            )
        } catch {
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
}
