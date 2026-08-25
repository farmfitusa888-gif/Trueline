import Combine
import Foundation
import SwiftUI
import UIKit
import simd

/// Owns an AR measure from the first tap to the folder on disk.
@MainActor
final class ARMeasureModel: ObservableObject {

    @Published var finished: SavedScan?
    @Published var name: String = "Room"

    let session = ARMeasureSession()
    private let store: ProjectStore
    private let startedAt = Date()
    private var relay: AnyCancellable?
    private var begun = false

    /// Passes the session's changes on as our own.
    ///
    /// This is the bug that made "Measure a room" look broken. SwiftUI watches
    /// exactly one publisher per `@StateObject` — this model's. `session` is a
    /// separate `ObservableObject`, so every `@Published` on it changed in
    /// silence: the reticle stayed hollow, the instruction stayed on its first
    /// sentence, the wall lengths never appeared, and **Done stayed disabled
    /// forever**, because `.disabled(!session.canClose)` was evaluated once at
    /// first render and never again. The camera feed was live because UIKit
    /// draws itself, so it looked like an app that had simply given up.
    ///
    /// One subscription fixes all of it.
    init(store: ProjectStore) {
        self.store = store
        relay = session.objectWillChange.sink { [weak self] _ in
            self?.objectWillChange.send()
        }
    }

    var showingFailure: Binding<Bool> {
        Binding(
            get: { self.session.failure != nil },
            // A refusal that cannot be dismissed is a refusal that ends the
            // session, so the setter clears it rather than doing nothing.
            set: { if !$0 { self.session.dismissFailure() } }
        )
    }

    /// What to do next, in one sentence.
    var instruction: String {
        // Whatever the tracker is unhappy about comes first, because it is the
        // reason nothing else is happening. A screen that says "point at a
        // corner and tap" while the tracker cannot see anything is a screen
        // that looks broken.
        // A finger on a corner is the most specific thing happening, so it is
        // what the sentence is about while it lasts.
        if session.held != nil { return "Moving that corner — let go to drop it" }
        if let note = session.trackingNote { return note }

        if session.mode == .distance {
            if !session.floorFound {
                return "Lay the phone flat on the floor and tap Set floor"
            }
            switch session.span.count {
            case 0: return "Touch one end of what you are measuring"
            case 1: return "Now touch the other end"
            default: return "Touch anywhere to measure something else"
            }
        }

        if !session.floorFound {
            // Said as a thing to do rather than a thing to wait for. The old
            // sentence — "move the phone slowly across the floor until it finds
            // it" — asked somebody to wait for a detector that may never fire,
            // with nothing to do about it and no way to tell.
            return "Lay the phone flat on the floor and tap Set floor"
        }
        switch session.corners.count {
        // "Touch", not "point and tap": the picture is the control now. The
        // shutter still aims down the crosshair, for a hand on a ladder.
        case 0: return "Touch the foot of a corner — anywhere on the picture"
        case 1, 2: return "Walk to the next corner and touch it"
        default:
            if let back = session.distanceToStart, back < 0.6 {
                return "You are back at the first corner — touch it again to finish"
            }
            return "Keep going round. Touch the first corner again when you get back to it"
        }
    }

    /// What Undo takes back, said as a count.
    ///
    /// Undo used to be the word on its own, and taking a corner back changed
    /// nothing anybody could see: the instruction for two corners and for one
    /// is the same sentence, and the wall chips are small and at the bottom.
    /// A button that says "Undo 4" and then "Undo 3" has visibly done something.
    var undoTitle: String {
        let count = session.mode == .room ? session.corners.count : session.span.count
        return count > 0 ? "Undo \(count)" : "Undo"
    }



    func begin() {
        // `onAppear` fires again when somebody comes back from the review
        // screen, and starting again resets the world origin underneath corners
        // that are already placed — every one of them silently moves.
        guard !begun else { return }
        begun = true
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
            // Measured between the first corner and the last one *tapped*, not
            // from the live reticle. The reticle is wherever the phone happens
            // to be pointing when Done is pressed — usually at the floor by the
            // person's feet, and `stop()` has already been called, so it is
            // often nothing at all. The tolerance on every wall in the room
            // came off that number.
            let closed: Bool = {
                guard session.corners.count >= 4,
                      let first = session.corners.first,
                      let last = session.corners.last
                else { return false }
                return simd_distance(
                    SIMD2(first.position.x, first.position.z),
                    SIMD2(last.position.x, last.position.z)
                ) < 0.6
            }()

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
