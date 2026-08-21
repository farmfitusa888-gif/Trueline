import Foundation
import SwiftUI
import UIKit

/// Owns an AR measure from the first tap to the folder on disk.
@MainActor
final class ARMeasureModel: ObservableObject {

    @Published var finished: SavedScan?
    @Published var name: String = "Room"

    let session = ARMeasureSession()
    private let store: ProjectStore
    private let startedAt = Date()

    init(store: ProjectStore) {
        self.store = store
    }

    var showingFailure: Binding<Bool> {
        Binding(get: { self.session.failure != nil }, set: { _ in })
    }

    /// What to do next, in one sentence.
    var instruction: String {
        if !session.floorFound {
            return "Move the phone slowly across the floor until it finds it"
        }
        switch session.corners.count {
        case 0: return "Point at the foot of a corner and tap"
        case 1, 2: return "Walk to the next corner and tap"
        default:
            if let back = session.distanceToStart, back < 0.6 {
                return "You are back at the first corner — tap it again to finish"
            }
            return "Keep going round. Tap the first corner again when you get back to it"
        }
    }

    func begin() {
        session.start()
    }

    /// Writes the walk out in the same shape a scan produces.
    ///
    /// The corners go across as they were placed; turning them into a room —
    /// straightening what is straight, folding out the taps that landed
    /// mid-wall, taking the tolerance off the closing tap — happens in `core`,
    /// where it is tested. None of that arithmetic is repeated here.
    func finish() {
        session.stop()
        let folder = store.folder(named: CaptureWriter.folderName(for: name, at: startedAt))
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)

            // A closing tap only counts if they really came back to the corner
            // they started at. Half a metre is the width of a doorway, and it is
            // the app's judgement rather than the person's word for it.
            let closed = (session.distanceToStart ?? .greatestFiniteMagnitude) < 0.6
                && session.corners.count >= 4

            let trace: [String: Any] = [
                "schema": "trueline.trace.v1",
                "source": "ar",
                "capturedAt": ISO8601DateFormatter().string(from: startedAt),
                "device": UIDevice.current.model,
                "closingRetap": closed,
                "corners": session.traced(),
            ]
            let data = try JSONSerialization.data(withJSONObject: trace, options: [.prettyPrinted])
            try data.write(to: folder.appendingPathComponent("trace.json"), options: .atomic)

            store.refresh()
            finished = SavedScan(
                folder: folder,
                title: name,
                roomJSON: Data(),
                photosJSON: Data(),
                traceJSON: data
            )
        } catch {
            session.reportFailure(error.localizedDescription)
        }
    }
}
