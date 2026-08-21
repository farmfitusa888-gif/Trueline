import ARKit
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
    private let recorder: PhotoRecorder
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

        timer = Timer.scheduledTimer(withTimeInterval: Self.automaticInterval, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.takePhoto(trigger: .automatic) }
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        captureSession.stop()
        isRunning = false
    }

    /// The shutter. Same machinery as the automatic one; only the label differs,
    /// and the label is what tells somebody later that a person meant this shot.
    func takePhoto(trigger: PhotoRecorder.Trigger) {
        guard let frame = captureSession.arSession.currentFrame else { return }
        do {
            try recorder.record(frame: frame, trigger: trigger)
            photoCount = recorder.count
        } catch {
            // One missed photograph is not worth ending a scan over, and it is
            // not worth hiding either.
            failure = "A photograph could not be saved: \(error.localizedDescription)"
        }
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
