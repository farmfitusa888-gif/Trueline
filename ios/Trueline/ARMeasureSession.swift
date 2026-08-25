import ARKit
import Combine
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

    /// How the floor's height came to be known.
    enum FloorFrom: Equatable {
        /// ARKit's plane detector found one. Free when it happens.
        case plane
        /// Somebody put the phone on the floor and said so. Always available.
        case device
    }

    /// What this screen is being used for.
    ///
    /// Walking a room and measuring the gap between two things are the same
    /// raycast and different products: one ends in a saved room, the other ends
    /// in a number somebody reads off the screen and writes on a pad. Keeping
    /// them apart stops a countertop being recorded as a wall.
    enum Mode: String, CaseIterable, Identifiable {
        case room
        case distance
        var id: String { rawValue }
        var title: String { self == .room ? "Room" : "Distance" }
    }

    @Published var mode: Mode = .room
    @Published private(set) var corners: [Placed] = []
    /// The two ends of a one-off measurement, in `.distance` mode.
    @Published private(set) var span: [Placed] = []
    /// Which corner a finger is dragging, if any.
    @Published private(set) var held: Int?
    @Published private(set) var floorFrom: FloorFrom?
    var floorFound: Bool { floorFrom != nil }
    @Published private(set) var aimingAt: SIMD3<Float>?
    @Published private(set) var failure: String?
    /// What the tracker is complaining about, in words, or nothing when it is
    /// happy. Without this a screen that cannot see the floor looks like a
    /// screen that has stopped working.
    @Published private(set) var trackingNote: String?
    /// How far the reticle is from the corner tapped first, once there are
    /// enough to close. Shown live so somebody can see themselves getting back
    /// to the start.
    @Published private(set) var distanceToStart: Float?

    let session = ARSession()
    private var floorHeight: Float?

    /// Whatever can turn the middle of the screen into a ray.
    ///
    /// Held here so **tapping does not depend on the display link having run**.
    /// It used to: the shutter read `aimingAt`, which only the link ever set,
    /// so anything that stopped the link — and there is no way to tell from a
    /// phone whether one is running — made every tap refuse over a live camera
    /// picture. Now the link only moves the reticle, and the tap does its own
    /// raycast. The reticle is cosmetic; the tap is the product.
    weak var aimer: ARSCNViewProviding?

    /// Whether this phone can scan rather than only measure.
    ///
    /// Asked through RoomPlan rather than by checking a model name: Apple knows
    /// which devices it supports and a hard-coded list goes stale every autumn.
    static var hasLiDAR: Bool { RoomCaptureSession.isSupported }

    /// A room needs three corners, and the fourth tap is the one that closes
    /// it. Enabling Done at three let somebody record a triangle they did not
    /// mean, with no closing gap and so no tolerance on anything in it.
    var canClose: Bool { corners.count >= 4 }

    func start() {
        guard ARWorldTrackingConfiguration.isSupported else {
            failure = "This device cannot track its position well enough to measure a room."
            return
        }
        let configuration = ARWorldTrackingConfiguration()
        configuration.planeDetection = [.horizontal]
        configuration.environmentTexturing = .none
        // North, for free and without a convention to get wrong: with this
        // alignment ARKit defines the world's -Z as true north itself, so a
        // room walked here arrives already oriented. It costs a location
        // authorisation — heading needs one on iOS even though no position is
        // wanted — and it falls back cleanly if the magnetometer is unusable,
        // because ARKit simply aligns to gravity alone and the room is no worse
        // off than it was yesterday.
        configuration.worldAlignment = .gravityAndHeading
        session.delegate = self
        session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
    }

    func stop() {
        session.pause()
    }

    /// The floor is where the phone is, because somebody put it there.
    ///
    /// **This exists because plane detection cannot be relied on and there is
    /// no way to find out from a phone why it did not fire.** Three builds have
    /// now tried to make "the app finds the floor" work, and the third
    /// screenshot still said "move the phone slowly across the floor" over a
    /// picture of a well-lit tiled floor. So the app stops requiring it.
    ///
    /// A person laying the phone face-up on the floor states the floor's height
    /// exactly — the camera is then a few millimetres above it, which is inside
    /// the noise of everything else here — and it takes two seconds. Every
    /// raycast afterwards meets that height, which is arithmetic this file
    /// already does and `meetFloor` already refuses when the ray cannot reach.
    ///
    /// Plane detection still runs and still counts when it works. This is the
    /// path that always works.
    func setFloorFromDevice() {
        guard let camera = session.currentFrame?.camera else {
            failure = "The camera is not tracking yet. Give it a moment and try again."
            return
        }
        // Level enough to be lying on the floor rather than being held. A phone
        // pointed at a wall would set the floor at chest height and every
        // corner after it would land in the air.
        let up = SIMD3<Float>(camera.transform.columns.1.x,
                              camera.transform.columns.1.y,
                              camera.transform.columns.1.z)
        guard abs(up.y) > 0.85 else {
            failure = "Lay the phone flat on the floor, screen up, then tap Set floor. "
                + "It is not flat enough to tell where the floor is."
            return
        }
        floorHeight = camera.transform.columns.3.y
        floorFrom = .device
    }

    /// Forgets the floor, for a room on a different level.
    func clearFloor() {
        floorHeight = nil
        floorFrom = nil
    }

    /// How high the phone is above the floor right now, for the readout.
    var heightAboveFloor: Float? {
        guard let floorHeight, let camera = session.currentFrame?.camera else { return nil }
        return camera.transform.columns.3.y - floorHeight
    }

    /// Puts a corner where the reticle is pointing.
    ///
    /// Refuses rather than guessing when there is nothing to aim at: a tap that
    /// silently lands somewhere plausible is a corner in the wrong place, and a
    /// corner in the wrong place is a wall that is wrong by however far off it
    /// was.
    func tap() {
        // Raycast now rather than trusting whatever the display link last
        // wrote. See `aimer`.
        let at = aimer.flatMap(raycast(from:)) ?? aimingAt
        guard let at else {
            // Whatever the tracker is unhappy about is the actual reason, so it
            // is what gets said. "The floor has not been found" over a picture
            // of a floor is an app arguing with its own screen.
            failure = trackingNote
                ?? (floorFound
                    ? "Point further down — the middle of the screen has to be on the floor for "
                        + "the app to work out where it is."
                    : "Lay the phone flat on the floor, screen up, and tap Set floor. Then point "
                        + "at the foot of a corner and tap.")
            return
        }
        record(at)
    }

    /// Puts a point where somebody touched, rather than where the phone was
    /// aimed.
    ///
    /// The shutter aims down the middle of the screen, which is right for one
    /// hand on a ladder and wrong for everything else: the corner you want is
    /// almost never in the centre of the picture, so the app was choosing the
    /// point and the person was left arguing with it. A touch is a choice.
    func place(at point: CGPoint) {
        guard let query = aimer?.raycastQuery(at: point),
              let at = resolve(query) else {
            failure = whyNothingLanded()
            return
        }
        record(at)
    }

    private func record(_ at: SIMD3<Float>) {
        switch mode {
        case .room:
            corners.append(Placed(id: "c\(corners.count + 1)", position: at, placedAt: Date()))
        case .distance:
            // A third touch starts a new measurement rather than making a
            // triangle nobody asked for.
            if span.count >= 2 { span.removeAll() }
            span.append(Placed(id: "s\(span.count + 1)", position: at, placedAt: Date()))
        }
        // A tap that landed is proof the floor is known, whatever set it.
        if floorFrom == nil { floorFrom = .plane }
    }

    /// How far a finger may be from a corner and still be taken to mean it.
    ///
    /// A finger pad covers about 44 points, which is why every button on this
    /// phone is at least that. Half of that either side is the smallest target
    /// somebody can hit deliberately and the largest they can hit by accident.
    private let grabRadius: CGFloat = 44

    /// Takes hold of the nearest corner to a touch, if one is near enough.
    ///
    /// - Returns: whether anything was taken hold of. When nothing is, the
    ///   caller lets the gesture go, so dragging empty picture does not silently
    ///   move a corner somewhere across the room.
    @discardableResult
    func grab(at point: CGPoint) -> Bool {
        guard mode == .room, let aimer else { return false }
        var best: (index: Int, distance: CGFloat)?
        for (index, corner) in corners.enumerated() {
            guard let on = aimer.screenPoint(for: corner.position) else { continue }
            let away = hypot(on.x - point.x, on.y - point.y)
            if away <= grabRadius && (best == nil || away < best!.distance) {
                best = (index, away)
            }
        }
        guard let best else { return false }
        held = best.index
        return true
    }

    /// Moves the corner being held to wherever the finger is now.
    func dragHeld(to point: CGPoint) {
        guard let held, corners.indices.contains(held),
              let query = aimer?.raycastQuery(at: point),
              let at = resolve(query) else { return }
        let was = corners[held]
        corners[held] = Placed(id: was.id, position: at, placedAt: was.placedAt)
    }

    func release() {
        held = nil
    }

    /// Why a touch produced no point, said as the reason it actually was.
    private func whyNothingLanded() -> String {
        trackingNote
            ?? (floorFound
                ? "Nothing there to measure — that part of the picture is not on a surface "
                    + "the phone has worked out yet. Try a spot nearer the floor."
                : "Lay the phone flat on the floor, screen up, and tap Set floor. Then touch "
                    + "the foot of a corner.")
    }

    func undoLastCorner() {
        switch mode {
        case .room:
            guard !corners.isEmpty else { return }
            corners.removeLast()
            // Holding an index that no longer exists is how a drag ends up
            // moving the wrong corner, or crashing.
            held = nil
        case .distance:
            guard !span.isEmpty else { return }
            span.removeLast()
        }
    }

    /// Whether there is anything for Undo to take back, in whichever mode.
    var canUndo: Bool { mode == .room ? !corners.isEmpty : !span.isEmpty }

    /// The one-off measurement, once both ends are down.
    var spanLength: Float? {
        guard span.count == 2 else { return nil }
        return simd_distance(span[0].position, span[1].position)
    }

    func clear() {
        corners.removeAll()
        span.removeAll()
        held = nil
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
        return resolve(query)
    }

    /// Turns a ray into a point in the room, or refuses.
    private func resolve(_ query: ARRaycastQuery) -> SIMD3<Float>? {
        // An existing plane first: it is a real surface ARKit has seen. Falling
        // back to the estimated one keeps the point usable in a corner the
        // plane has not grown into yet.
        if let hit = session.raycast(query).first {
            return SIMD3<Float>(hit.worldTransform.columns.3.x,
                                hit.worldTransform.columns.3.y,
                                hit.worldTransform.columns.3.z)
        }
        // Nothing along that ray. If the floor's height is known, meet the ray
        // at that height instead: the far corner of a room is often beyond
        // where any plane has grown to, and refusing there means refusing the
        // corners that are hardest to walk to.
        //
        // The ray meant is **the query's own**, not the camera's. When a touch
        // anywhere on the picture became a point, using the camera's centre ray
        // here would have put every fallback corner in the middle of the screen
        // instead of under the finger -- a wrong answer that looks like a right
        // one, which is the worst kind this app can give.
        guard let height = floorHeight else { return nil }
        return Self.meet(floorAt: height,
                         origin: query.origin,
                         direction: query.direction)
    }

    /// Where the middle of the screen meets a floor at a known height.
    ///
    /// The camera's own transform gives the ray: its third column is the
    /// direction it looks away from, so the view direction is that negated.
    /// One division, and it is refused when the ray is pointing up or level,
    /// because a ray that never reaches the floor has no answer and a made-up
    /// one would be a corner in the wrong place.
    static func meetFloor(at height: Float, from camera: ARCamera) -> SIMD3<Float>? {
        let m = camera.transform
        let eye = SIMD3<Float>(m.columns.3.x, m.columns.3.y, m.columns.3.z)
        let look = -SIMD3<Float>(m.columns.2.x, m.columns.2.y, m.columns.2.z)
        return meet(floorAt: height, origin: eye, direction: look)
    }

    /// Where a ray meets a level floor at a known height.
    ///
    /// Refused when the ray points up or runs level, because a ray that never
    /// reaches the floor has no answer and a made-up one is a corner in the
    /// wrong place. Refused past thirty metres for the same reason: a ray a
    /// fraction below level meets the floor in the next county.
    static func meet(
        floorAt height: Float,
        origin: SIMD3<Float>,
        direction: SIMD3<Float>
    ) -> SIMD3<Float>? {
        let look = simd_length(direction) > 0 ? simd_normalize(direction) : direction
        guard look.y < -0.05 else { return nil }
        let distance = (height - origin.y) / look.y
        guard distance > 0, distance < 30 else { return nil }
        return origin + look * distance
    }

    /// Everything the screen needs, read straight off the current frame.
    ///
    /// Called about twenty times a second by the display link.
    ///
    /// **The floor is found here rather than in the session delegate**, and
    /// that is the fix rather than a preference. `ARSCNView` takes the session's
    /// delegate for itself the moment a session is assigned to it, so the
    /// delegate this class installs may or may not survive depending on the
    /// order SwiftUI happens to bring the view up in — and when it does not,
    /// `didAdd anchors` never fires, `floorFound` stays false, the instruction
    /// never moves past "move the phone slowly across the floor", and every tap
    /// is refused. Which is exactly what "Measure a room does not work" looks
    /// like, on a screen with a live camera picture on it because UIKit draws
    /// that itself.
    ///
    /// The current frame is not anybody's to take. Reading the anchors from it
    /// cannot be silently disconnected, so this cannot come back.
    func updateAim(using view: ARSCNViewProviding) {
        let frame = session.currentFrame

        if let camera = frame?.camera {
            switch camera.trackingState {
            case .normal:
                trackingNote = nil
            case .notAvailable:
                trackingNote = "Starting up…"
            case .limited(let why):
                switch why {
                case .initializing:
                    trackingNote = "Move the phone slowly from side to side to start tracking"
                case .excessiveMotion:
                    trackingNote = "Slow down — the phone is moving too fast to track"
                case .insufficientFeatures:
                    trackingNote = "Not enough detail to track. More light, or point at "
                        + "something with a pattern on it"
                case .relocalizing:
                    trackingNote = "Finding where it is again — hold still a moment"
                @unknown default:
                    trackingNote = "Tracking is limited"
                }
            }
        }

        // A horizontal plane anywhere in the session, read off the frame rather
        // than waited for through a delegate. See the note above.
        if let anchors = frame?.anchors {
            let floors = anchors.compactMap { $0 as? ARPlaneAnchor }
                .filter { $0.alignment == .horizontal }
            if !floors.isEmpty {
                let lowest = floors.map { $0.transform.columns.3.y }.min()
                // A plane never overrides a floor somebody stated. They put the
                // phone on it; a detector that then finds a table top lower
                // than it is wrong, and the person is not.
                if let lowest, floorFrom != .device, floorHeight == nil || lowest < floorHeight! {
                    floorHeight = lowest
                    floorFrom = .plane
                }
            }
        }

        aimingAt = raycast(from: view)
        // Something to put a corner on *is* a floor, whatever the plane
        // detector has got round to naming. A person aiming at a spot and being
        // told the floor has not been found, while the reticle sits solid on
        // it, is the app arguing with its own screen.
        if aimingAt != nil && floorFrom == nil { floorFrom = .plane }
        // Three corners is enough to be walking back to the first one, so the
        // live distance appears then — a tap earlier than `canClose` allows.
        if let first = corners.first, let aim = aimingAt, corners.count >= 3 {
            distanceToStart = simd_distance(SIMD2(first.position.x, first.position.z),
                                            SIMD2(aim.x, aim.z))
        } else {
            distanceToStart = nil
        }
    }

    /// The lengths of the walls placed so far, for the live readout.
    var edgeLengths: [Float] {
        guard corners.count >= 2 else { return [] }
        // Once there are three, the run from the last corner back to the first
        // is a wall of the room like any other. Leaving it out made a
        // rectangular room read as three walls.
        let closing = corners.count >= 3 ? 1 : 0
        return (0..<(corners.count - 1 + closing)).map { i in
            let a = corners[i].position
            let b = corners[(i + 1) % corners.count].position
            return simd_distance(SIMD2(a.x, a.z), SIMD2(b.x, b.z))
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
            // The lowest horizontal plane is the floor; a table is also
            // horizontal and is not what anybody is measuring to. And nothing
            // here overrides a floor somebody stated by putting the phone on it.
            let lowest = floors.map { $0.transform.columns.3.y }.min()
            if let lowest, self.floorFrom != .device,
               self.floorHeight == nil || lowest < self.floorHeight! {
                self.floorHeight = lowest
                self.floorFrom = .plane
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
/// Class-bound, because `aimer` above is `weak` and Swift will not make a
/// weak reference to something that might be a struct -- there would be
/// nothing to zero out. The only conformer is `ARMeasureScreen.Coordinator`,
/// a final class holding the view, so the bound costs nothing and says what
/// was always true.
///
/// Xcode: "'weak' must not be applied to non-class-bound 'any
/// ARSCNViewProviding'". The first error a compiler ever gave this project.
@MainActor
protocol ARSCNViewProviding: AnyObject {
    func raycastQueryFromCentre() -> ARRaycastQuery?
    /// A ray through a point somebody touched, so the point measured is the
    /// point they chose rather than whatever the middle of the screen was on.
    func raycastQuery(at point: CGPoint) -> ARRaycastQuery?
    /// Where a placed corner is on screen right now, so a finger can find it.
    func screenPoint(for world: SIMD3<Float>) -> CGPoint?
}
