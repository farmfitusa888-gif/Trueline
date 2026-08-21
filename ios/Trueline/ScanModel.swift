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

    init(store: ProjectStore) {
        self.store = store
        self.scratch = FileManager.default.temporaryDirectory
            .appendingPathComponent("scan-\(UUID().uuidString)", isDirectory: true)
        self.recorder = PhotoRecorder(directory: scratch.appendingPathComponent("photos"))
        self.session = ScanSession(recorder: recorder)
    }

    var showingFailure: Binding<Bool> {
        Binding(
            get: { self.session.failure != nil },
            set: { _ in }
        )
    }

    func begin() {
        guard !session.isRunning else { return }
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
                photosJSON: written.photosJSON
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
    /// The corners somebody tapped. Empty for a LiDAR scan.
    let traceJSON: Data

    init(folder: URL, title: String, roomJSON: Data, photosJSON: Data, traceJSON: Data = Data()) {
        self.folder = folder
        self.title = title
        self.roomJSON = roomJSON
        self.photosJSON = photosJSON
        self.traceJSON = traceJSON
    }

    var id: URL { folder }
    var isTrace: Bool { !traceJSON.isEmpty }
}
