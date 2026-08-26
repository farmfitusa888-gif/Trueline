import ARKit
import Foundation
import UIKit

/// What somebody pointed at during the walk, and where it was.
///
/// ## The gesture this keeps
///
/// A restoration contractor walks a flooded basement once. Everything he
/// notices on that walk -- the stain behind the boiler, the swollen base at the
/// bottom of the stair, the black spotting inside the closet -- he records today
/// by taking a photograph and remembering. Back at the truck he has ninety
/// photographs and no idea which wall any of them was on.
///
/// A pin is the same gesture, kept. He points at it, taps, says what it is, and
/// the tap has a place in the room attached to it before he has left the room.
///
/// ## Why the geometry is not done here
///
/// This writes the tap down in ARKit's own metres and stops. Turning that into
/// a point on the plan needs the datum the importer chose and the room's own
/// origin, and both of those are decided on the other side of the bridge in
/// `core/src/pins.ts`, where the photographs are already turned the same way by
/// the same function. Doing the arithmetic twice, in two languages, is two
/// chances to disagree about where somebody was standing.
///
/// So the phone's job is: raycast, record, and never guess.
///
/// ## Not `@MainActor`, and that is deliberate
///
/// `PhotoRecorder` -- this one's twin, doing the same job for pictures -- is
/// not isolated either, and both are written to only from `ScanSession`, which
/// is. Isolating one of a matched pair is not caution, it is an inconsistency,
/// and this one had a cost: `CaptureWriter.write` is a plain static function
/// that writes files, and a main-actor property cannot be read from it.
///
///     CaptureWriter.swift:83: main actor-isolated property 'isEmpty' can not
///     be referenced from a nonisolated context
///
/// The fix is to take the isolation off rather than to spread it onto the file
/// writer: what this holds is a list of records, and nothing about writing a
/// list of records to disk belongs on the main thread.
final class PinRecorder {

    /// What ARKit found under the finger, in its own words.
    ///
    /// Not translated into a scale invented here. `planeGeometry` is a surface
    /// the phone actually mapped; `planeInfinite` is that surface's plane out
    /// past the mapped part; `estimated` is a guess from feature points and is
    /// refused on the far side. Which one it was decides how much a claim can
    /// lean on the pin, so it travels with it.
    enum Found: String, Encodable {
        case planeGeometry
        case planeInfinite
        case estimated
    }

    struct Record: Encodable {
        let id: String
        /// ARKit world position: x, y up, z. Metres.
        let at: [Float]
        let droppedAt: String
        /// One of `core/src/damage.ts`'s DamageKind. Written as its own word.
        let kind: String
        let note: String
        let photoId: String?
        let found: Found
    }

    struct Manifest: Encodable {
        let schema: String
        let pins: [Record]
    }

    static let schema = "trueline.pins.v1"

    private(set) var records: [Record] = []
    var count: Int { records.count }
    var isEmpty: Bool { records.isEmpty }

    /// A tap that has a place but does not yet have any words.
    ///
    /// The two halves are deliberately separate. Pointing at the stain and
    /// saying what it is happen a second apart, and the position has to be
    /// taken at the instant of the tap -- a second later the phone has moved and
    /// the ray points somewhere else. So the place is captured immediately and
    /// held here while somebody types, and nothing is written until they do.
    struct Pending {
        let at: SIMD3<Float>
        let found: Found
        let photoId: String?
        let droppedAt: String
    }

    /// Writes a held tap down, once there are words to go with it.
    ///
    /// Returns the id, so a screen can say what it just added.
    @discardableResult
    func keep(_ pending: Pending, kind: String, note: String) -> String {
        let id = "pin-\(records.count + 1)"
        records.append(
            Record(
                id: id,
                at: [pending.at.x, pending.at.y, pending.at.z],
                droppedAt: pending.droppedAt,
                kind: kind,
                note: note,
                photoId: pending.photoId,
                found: pending.found
            )
        )
        return id
    }

    /// Throws away the last pin. For the one that went on the wrong wall.
    /// Everything marked, forgotten — between one room and the next.
    ///
    /// A pin is a place in the room that was being walked. Carrying one into
    /// the next scan would put a mark somewhere nobody stood, on a wall that
    /// does not exist, in a room it says nothing true about.
    func forgetEverything() {
        records.removeAll()
    }

    func undo() {
        guard !records.isEmpty else { return }
        records.removeLast()
    }

    func manifest() -> Manifest {
        Manifest(schema: Self.schema, pins: records)
    }

    static let stamp: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()
}

extension PinRecorder {

    /// Where a tap on the screen lands in the room.
    ///
    /// ## The two conversions this has to get right
    ///
    /// A tap arrives in the view's own points, with the origin at its top left.
    /// `ARFrame.raycastQuery` wants a point in **normalized image coordinates**,
    /// which is neither of those things -- and the mapping between them depends
    /// on how the phone is being held, because ARKit keeps the camera image in
    /// the sensor's landscape frame whatever the person is doing.
    ///
    /// `displayTransform(for:viewportSize:)` is exactly the matrix that takes
    /// image coordinates to view coordinates for a given orientation, so its
    /// inverse takes the tap back. Doing this by hand -- dividing x and y by the
    /// view's width and height -- works only in landscape, and every scan is
    /// walked in portrait.
    ///
    /// ## Why the nearest hit and not the first
    ///
    /// ARKit returns results sorted nearest first, but it mixes mapped surfaces
    /// with their infinite extensions, and the first result is not always the
    /// one with the most behind it. What is wanted is the best evidence: a hit
    /// on a surface the phone has actually seen beats an extrapolation, and both
    /// beat a guess. So the results are ranked by that and the nearest of the
    /// best kind wins.
    static func hit(
        _ frame: ARFrame,
        at point: CGPoint,
        in viewport: CGSize,
        orientation: UIInterfaceOrientation,
        session: ARSession
    ) -> (position: SIMD3<Float>, found: Found)? {
        guard viewport.width > 0, viewport.height > 0 else { return nil }

        let display = frame.displayTransform(for: orientation, viewportSize: viewport)
        let toImage = display.inverted()
        // The view's own coordinates, as a fraction of it, then back through the
        // display transform into the image's.
        let asFraction = CGPoint(x: point.x / viewport.width, y: point.y / viewport.height)
        let inImage = asFraction.applying(toImage)

        // Both targets are asked for in one query each rather than one query for
        // `.any`: the answer needs to say WHICH it was, and `.any` does not.
        let ranked: [(ARRaycastQuery.Target, Found)] = [
            (.existingPlaneGeometry, .planeGeometry),
            (.existingPlaneInfinite, .planeInfinite),
            (.estimatedPlane, .estimated),
        ]
        for (target, found) in ranked {
            let query = frame.raycastQuery(from: inImage, allowing: target, alignment: .any)
            if let result = session.raycast(query).first {
                let m = result.worldTransform
                return (SIMD3<Float>(m.columns.3.x, m.columns.3.y, m.columns.3.z), found)
            }
        }
        return nil
    }
}
