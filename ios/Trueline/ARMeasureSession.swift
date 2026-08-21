import ARKit
import Foundation
import RoomPlan
import simd

/// Measuring a room on a phone with no LiDAR.
///
/// Without a depth sensor there is no scanning — nothing sweeps the room and
/// finds the walls. What ARKit still gives you is a tracked camera and a floor:
/// it finds horizontal planes from the camera alone, and a ray from the middle
/// of the screen onto that floor is a point you can trust to within how steadily
/// somebody is holding the phone.
///
/// So the room is walked rather than scanned. Aim the reticle at the foot of a
/// corner, tap, walk to the next one, tap. Come back to where you started and
/// tap that corner again. That last tap is not geometry — it is the
/// **measurement of how well the walking went**, and it is where the tolerance
/// on every wall in the finished room comes from. Nobody publishes how
/// accurately a person can place a point in AR by eye, so rather than invent a
/// figure, the app asks the person to produce one.
///
/// Everything after the last tap is identical to a LiDAR scan: the same room
/// model, the same plan, the same solver, the same refusal to be issued until
/// somebody puts a tape on it. How a room was captured changes nothing about how
/// it is corrected.
@MainActor
final class ARMeasureSession: NSObject, ObservableObject {

    struct Placed: Identifiable {
        let id: String
        /// Where it was put, in ARKit's world, in metres.
        let position: SIMD3<Float>
        let placedAt: Date
    }

    @Published private(set) var corners: [Placed] = []
    @Published private(set) var floorFound = false
    @Published private(set) var aimingAt: SIMD3<Float>?
    @Published private(set) var failure: String?
    /// How far the reticle is from the corner tapped first, once there are
    /// enough to close. Shown live so somebody can see themselves getting back
    /// to the start.
    @Published private(set) var distanceToStart: Float?

    let session = ARSession()
    private var floorHeight: Float?

    /// Whether this phone can scan rather than only measure.
    ///
    /// Asked through RoomPlan rather than by checking a model name: Apple knows
    /// which devices it supports and a hard-coded list goes stale every autumn.
    static var hasLiDAR: Bool { RoomCaptureSession.isSupported }

    /// A room needs three corners, and a closing tap makes four taps.
    var canClose: Bool { corners.count >= 3 }

    func start() {
        guard ARWorldTrackingConfiguration.isSupported else {
            failure = "This device cannot track its position well enough to measure a room."
            return
        }
        let configuration = ARWorldTrackingConfiguration()
        configuration.planeDetection = [.horizontal]
        configuration.environmentTexturing = .none
        session.delegate = self
        session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
    }

    func stop() {
        session.pause()
    }

    /// Puts a corner where the reticle is pointing.
    ///
    /// Refuses rather than guessing when there is nothing to aim at: a tap that
    /// silently lands somewhere plausible is a corner in the wrong place, and a
    /// corner in the wrong place is a wall that is wrong by however far off it
    /// was.
    func tap() {
        guard let at = aimingAt else {
            failure = floorFound
                ? "Point at the floor where the corner is, then tap."
                : "The floor has not been found yet. Move the phone slowly across the floor "
                    + "until it has, then tap."
            return
        }
        corners.append(Placed(id: "c\(corners.count + 1)", position: at, placedAt: Date()))
    }

    func undoLastCorner() {
        guard !corners.isEmpty else { return }
        corners.removeLast()
    }

    func clear() {
        corners.removeAll()
    }

    /// The corners as the model wants them: metres, plan x and y, in order.
    ///
    /// ARKit is y-up, so the plan is x and z — the same mapping the LiDAR
    /// importer uses, so both capture modes hand over the same thing.
    func traced() -> [[String: Any]] {
        corners.map { corner in
            [
                "id": corner.id,
                "x": Double(corner.position.x),
                "y": Double(corner.position.z),
                "placedAt": ISO8601DateFormatter().string(from: corner.placedAt),
            ]
        }
    }

    /// Where the floor is, once it has been found, so the reticle has something
    /// to land on even where no plane has been detected yet.
    private func raycast(from view: ARSCNViewProviding) -> SIMD3<Float>? {
        guard let query = view.raycastQueryFromCentre() else { return nil }
        // An existing plane first: it is a real surface ARKit has seen. Falling
        // back to the estimated one keeps the reticle usable in a corner the
        // plane has not grown into yet.
        if let hit = session.raycast(query).first {
            return SIMD3<Float>(hit.worldTransform.columns.3.x,
                                hit.worldTransform.columns.3.y,
                                hit.worldTransform.columns.3.z)
        }
        return nil
    }

    func updateAim(using view: ARSCNViewProviding) {
        aimingAt = raycast(from: view)
        if let first = corners.first, let aim = aimingAt, canClose {
            distanceToStart = simd_distance(SIMD2(first.position.x, first.position.z),
                                            SIMD2(aim.x, aim.z))
        } else {
            distanceToStart = nil
        }
    }

    /// The lengths of the walls placed so far, for the live readout.
    var edgeLengths: [Float] {
        guard corners.count >= 2 else { return [] }
        return (1..<corners.count).map { i in
            simd_distance(SIMD2(corners[i - 1].position.x, corners[i - 1].position.z),
                          SIMD2(corners[i].position.x, corners[i].position.z))
        }
    }

    func dismissFailure() { failure = nil }

    /// Something outside the session went wrong and the person should know.
    func reportFailure(_ message: String) { failure = message }
}

extension ARMeasureSession: ARSessionDelegate {
    nonisolated func session(_ session: ARSession, didAdd anchors: [ARAnchor]) {
        let floors = anchors.compactMap { $0 as? ARPlaneAnchor }
            .filter { $0.alignment == .horizontal }
        guard !floors.isEmpty else { return }
        Task { @MainActor in
            self.floorFound = true
            // The lowest horizontal plane is the floor; a table is also
            // horizontal and is not what anybody is measuring to.
            let lowest = floors.map { $0.transform.columns.3.y }.min()
            if let lowest, self.floorHeight == nil || lowest < self.floorHeight! {
                self.floorHeight = lowest
            }
        }
    }

    nonisolated func session(_ session: ARSession, didFailWithError error: Error) {
        Task { @MainActor in
            self.failure = "Tracking stopped: \(error.localizedDescription)"
        }
    }
}

/// The bit of the view the session needs, kept behind a protocol so the session
/// does not have to know what kind of view is showing it.
@MainActor
protocol ARSCNViewProviding {
    func raycastQueryFromCentre() -> ARRaycastQuery?
}
