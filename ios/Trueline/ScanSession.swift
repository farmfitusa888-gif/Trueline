import ARKit
import Combine
import Foundation
import RoomPlan
import UIKit

/// Running a scan, and photographing the room while it runs.
///
/// Two things happen at once here, and the second is the one nothing else does.
///
/// RoomPlan walks the room and reports a `CapturedRoom` as it goes — walls
/// appearing, lengths settling down. That is shown live, so the numbers are on
/// screen while the person is standing in front of the wall rather than after
/// they have left.
///
/// Alongside it, photographs. Every couple of seconds, and whenever the shutter
/// is pressed, the current `ARFrame` is grabbed: the image, the camera's
/// transform, and its intrinsics. That pose is what turns a photograph of a
/// kitchen into a photograph that knows which walls are in it — and it has to be
/// taken at the instant the shutter fires, which is why this cannot be bolted on
/// afterwards by any app that only stores pictures.
///
/// **On not stealing the delegate.** `ARSession` has exactly one delegate and
/// RoomPlan is using it. Setting ourselves there would break the thing we are
/// trying to photograph. So frames are read from `arSession.currentFrame`, which
/// is a published property and safe to poll. A timer at a few frames a second is
/// plenty: photographs are for evidence, not for tracking.
@MainActor
final class ScanSession: NSObject, ObservableObject {

    /// What the scan has found so far, for the live readout.
    @Published private(set) var walls: [LiveWall] = []
    @Published private(set) var photoCount: Int = 0
    @Published private(set) var isRunning = false
    /// RoomPlan's own coaching, passed through untouched. It reads the session; we do not.
    @Published private(set) var instruction: String?
    @Published private(set) var failure: String?
    /// A tap that has a place and is waiting for words. Non-nil puts the sheet
    /// asking what it is on screen.
    @Published var pending: PinRecorder.Pending?
    @Published private(set) var pinCount = 0
    /// What the last tap did, in words, for a second or two. A tap that found
    /// nothing has to say so on the spot: the person is still pointing at it.
    @Published var pinTrouble: String?

    struct LiveWall: Identifiable {
        let id: UUID
        let lengthMetres: Float
        let heightMetres: Float
        let confidence: String
    }

    /// How often a photograph is taken while walking, in seconds.
    ///
    /// Two seconds at a normal walking pace is a photograph every metre and a
    /// half or so, which covers a wall without filling the phone. It is a
    /// starting point rather than a finding — the first real captures should
    /// move it.
    static let automaticInterval: TimeInterval = 2.0

    let captureView: RoomCaptureView
    private var captureSession: RoomCaptureSession { captureView.captureSession }
    /// Where photographs go. Replaced by `take(_:)` between scans, so a second
    /// room's pictures never land in the first room's folder.
    private var recorder: PhotoRecorder
    /// What was marked while walking. Kept beside the photographs rather than
    /// inside them: a pin is evidence about a place, a photograph is evidence
    /// about a moment, and they are written to the capture as two files.
    let pins = PinRecorder()
    /// Reads the magnetometer alongside the scan, so the finished plan can carry
    /// a north arrow. Nothing measured depends on it — see `Compass`.
    private let compass = Compass()
    private var timer: Timer?
    private var finished: CapturedRoom?

    init(recorder: PhotoRecorder) {
        self.captureView = RoomCaptureView(frame: .zero)
        self.recorder = recorder
        super.init()
        captureView.captureSession.delegate = self
    }

    func start() {
        guard RoomCaptureSession.isSupported else {
            failure = "This device cannot scan a room. RoomPlan needs a LiDAR sensor — "
                + "an iPhone or iPad Pro."
            return
        }
        var configuration = RoomCaptureSession.Configuration()
        configuration.isCoachingEnabled = true
        captureSession.run(configuration: configuration)
        isRunning = true
        compass.start()

        timer = Timer.scheduledTimer(withTimeInterval: Self.automaticInterval, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.takePhoto(trigger: .automatic) }
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        captureSession.stop()
        compass.stop()
        isRunning = false
    }

    /// Everything about the last scan, forgotten.
    ///
    /// `finished` is the one that mattered. `capturedRoom` reads it, and
    /// `ScanModel.finish()` waits for it to appear — so with the previous
    /// room still sitting in it, a second scan on the same tab "finished"
    /// instantly, with the first room's walls, before the phone had built
    /// anything at all.
    ///
    /// The pins and the instruction go with it: a mark made in one room has no
    /// business appearing in the next, and "Move closer to the wall" left over
    /// from a finished scan is an instruction about a room nobody is standing
    /// in.
    func reset() {
        stop()
        finished = nil
        failure = nil
        instruction = nil
        pinTrouble = nil
        pins.forgetEverything()
        pinCount = 0
        pending = nil
    }

    /// Where the next scan's photographs go.
    func take(_ next: PhotoRecorder) {
        recorder = next
    }

    /// Clears a refusal once it has been read.
    ///
    /// Without this the alert could not be dismissed: its binding asked whether
    /// `failure` was set and had no way to unset it, so one dropped photograph
    /// pinned the alert on screen for the rest of the scan.
    func dismissFailure() { failure = nil }

    /// The shutter. Same machinery as the automatic one; only the label differs,
    /// and the label is what tells somebody later that a person meant this shot.
    func takePhoto(trigger: PhotoRecorder.Trigger) {
        guard let frame = captureSession.arSession.currentFrame else { return }

        // A heading is only worth anything paired with the pose taken at the
        // same instant, and here is the one place both are in hand at once.
        // `offer` keeps the first it can trust and ignores the rest.
        if let heading = compass.latest, heading.usable {
            recorder.offer(
                heading: heading.trueNorth,
                accuracy: heading.accuracy,
                pose: frame.camera.transform
            )
        }

        do {
            try recorder.record(frame: frame, trigger: trigger)
            photoCount = recorder.count
        } catch {
            // One missed photograph is not worth ending a scan over, and it is
            // not worth hiding either.
            failure = "A photograph could not be saved: \(error.localizedDescription)"
        }
    }

    /* ------------------------------------------------------------- marking */

    /// Somebody pointed at something and tapped.
    ///
    /// Two things have to happen at the instant of the tap and cannot happen a
    /// second later: the ray has to be cast from where the phone is **now**, and
    /// the photograph has to be of what is in front of it **now**. A second
    /// later the person has lowered the phone to type and both are of the floor.
    ///
    /// So the place and the picture are taken here and held. The words come
    /// afterwards, and `keep` writes the pin only once there are some.
    func markWhereTapped(at point: CGPoint, in viewport: CGSize, orientation: UIInterfaceOrientation) {
        pinTrouble = nil
        guard isRunning else { return }
        guard let frame = captureSession.arSession.currentFrame else {
            pinTrouble = "The camera is not tracking yet, so there is nothing to point at."
            return
        }
        guard let landed = PinRecorder.hit(
            frame,
            at: point,
            in: viewport,
            orientation: orientation,
            session: captureSession.arSession
        ) else {
            pinTrouble = "Nothing there yet. Point at a wall the phone has already covered."
            return
        }
        // A hit with no mapped surface behind it used to be REFUSED here, and
        // on the far side as well. It sounded careful and it meant Mark never
        // worked:
        //
        // > "MARK STILL DOES NOT WORK DURING THE SCAN."
        //
        // RoomPlan maps walls and floors. It does not map ceilings, and a water
        // stain on a ceiling is the most common thing an adjuster is ever
        // shown -- so the one surface this feature exists for was the one
        // surface it turned down, every time, with nothing the person could do
        // about it.
        //
        // The pin lands now and carries WHICH kind of hit it was, all the way
        // through `pins.json` to `Damage.found` and onto the claim document,
        // where `certainty()` puts it in a sentence an adjuster can read. The
        // uncertainty is still recorded; it is recorded somewhere useful rather
        // than in a refusal that stopped anything being recorded at all.
        //
        // The note under the reticle says so at the moment of the tap, so
        // somebody who can walk two steps and get a better hit still can.
        if landed.found == .estimated {
            pinTrouble = "Marked from depth — the phone has not mapped that surface. "
                + "Good enough for a ceiling; scan across it first if you want it on the plan."
        }

        // The evidence. A pin without a photograph is a dot with a note on it;
        // an adjuster wants the picture.
        let photoId = try? recorder.record(frame: frame, trigger: .manual)
        photoCount = recorder.count

        pending = PinRecorder.Pending(
            at: landed.position,
            found: landed.found,
            photoId: photoId,
            droppedAt: PinRecorder.stamp.string(from: Date())
        )
    }

    /// Writes the held tap down, now that there are words for it.
    func keep(kind: String, note: String) {
        guard let waiting = pending else { return }
        let said = note.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !said.isEmpty else {
            pinTrouble = "Say what is wrong with it — a pin with no words is a dot on a drawing."
            return
        }
        pins.keep(waiting, kind: kind, note: said)
        pinCount = pins.count
        pending = nil
    }

    /// Drops the held tap without writing anything.
    func forgetPending() { pending = nil }

    /// Takes the last pin back off, for the one that went on the wrong wall.
    func undoPin() {
        pins.undo()
        pinCount = pins.count
    }

    /// The finished room, once the scan has stopped and RoomPlan has settled.
    var capturedRoom: CapturedRoom? { finished }

    /// Something outside the session went wrong and the person should know.
    /// Kept here so there is one place a failure is shown from, rather than two
    /// alerts that can both be on screen at once.
    func reportFailure(_ message: String) {
        failure = message
    }
}

extension ScanSession: RoomCaptureSessionDelegate {

    nonisolated func captureSession(_ session: RoomCaptureSession, didUpdate room: CapturedRoom) {
        Task { @MainActor in
            self.walls = room.walls.map { wall in
                LiveWall(
                    id: wall.identifier,
                    lengthMetres: wall.dimensions.x,
                    heightMetres: wall.dimensions.y,
                    confidence: String(describing: wall.confidence)
                )
            }
        }
    }

    nonisolated func captureSession(
        _ session: RoomCaptureSession,
        didProvide instruction: RoomCaptureSession.Instruction
    ) {
        Task { @MainActor in
            // RoomPlan is reading the actual session and this app is not, so
            // whatever it says wins and is shown as it was said.
            self.instruction = Self.wording(for: instruction)
        }
    }

    nonisolated func captureSession(
        _ session: RoomCaptureSession,
        didEndWith data: CapturedRoomData,
        error: Error?
    ) {
        Task { @MainActor in
            if let error {
                self.failure = "The scan ended early: \(error.localizedDescription)"
                return
            }
            do {
                self.finished = try await RoomBuilder(options: [.beautifyObjects]).capturedRoom(from: data)
            } catch {
                self.failure = "The scan finished but could not be turned into a room: "
                    + error.localizedDescription
            }
        }
    }

    private static func wording(for instruction: RoomCaptureSession.Instruction) -> String {
        switch instruction {
        case .moveCloseToWall: return "Move closer to the wall"
        case .moveAwayFromWall: return "Move further back"
        case .slowDown: return "Slow down"
        case .turnOnLight: return "Turn the light on"
        case .normal: return "Keep going"
        case .lowTexture: return "Not enough detail here — try a different angle"
        @unknown default: return "Keep going"
        }
    }
}
