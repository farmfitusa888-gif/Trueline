import ARKit
import CoreImage
import Foundation
import simd

/// Photographs, and the pose each one was taken from.
///
/// The pose is the whole point. A photograph on its own is a photograph of a
/// kitchen; a photograph with the camera's transform and intrinsics attached is
/// a photograph that knows which walls are in it, because the room and the
/// camera are then in the same coordinate system. Every claim Trueline makes
/// about what the scanner could and could not see rests on this file writing
/// down the right sixteen numbers at the right instant.
///
/// Both are captured together, from one `ARFrame`, so they cannot drift apart.
/// Taking the picture and then asking where the camera is would be a different
/// answer by a step and a half.
final class PhotoRecorder {

    enum Trigger: String, Encodable {
        case automatic
        case manual
    }

    enum RecorderError: Error, LocalizedError {
        case cannotEncode
        case notFinite(String)

        var errorDescription: String? {
            switch self {
            case .cannotEncode:
                return "The camera image could not be turned into a file."
            case .notFinite(let what):
                return "ARKit gave a \(what) that is not a finite number, so this photograph "
                     + "cannot be placed in the room."
            }
        }
    }

    /// One line of the manifest `capture.ts` reads.
    ///
    /// The names and the shapes are that file's, not this one's: a transform is
    /// sixteen numbers column-major, intrinsics are the nine of the camera
    /// matrix, and both go across as they came out of ARKit rather than being
    /// pre-digested. Whatever rounding has to happen happens once, on the other
    /// side, in the one place that is allowed to do it.
    struct Record: Encodable {
        let id: String
        let takenAt: String
        let trigger: Trigger
        let fileName: String
        let cameraPoseARFrame: [Float]
        let intrinsics: [Float]
        let imageWidth: Int
        let imageHeight: Int
        let trackingQuality: String
    }

    /// Where north was, and how well the phone knew.
    ///
    /// Recorded raw and paired with the camera pose taken at the same instant,
    /// because the two together are what fixes the room's bearing and either one
    /// alone fixes nothing. No interpretation happens here — turning a heading
    /// and a pose into "north is that way on the plan" is arithmetic, and
    /// arithmetic belongs in `core` where it can be tested.
    struct North: Encodable {
        /// Degrees clockwise from true north, as Core Location reported it.
        let trueHeading: Double
        /// Core Location's own estimate of how wrong that is, in degrees.
        let accuracy: Double
        /// The camera transform at the same moment, column-major sixteen.
        let atPose: [Float]
    }

    struct Manifest: Encodable {
        let schema = "trueline.photos.v1"
        let capturedAt: String
        let device: String
        let photos: [Record]
        /// Absent on a phone with no compass, or one that could not trust it.
        let north: North?
    }

    private(set) var records: [Record] = []
    var count: Int { records.count }

    private let directory: URL
    private let context = CIContext()
    private let started = Date()
    private static let stamp: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    init(directory: URL) {
        self.directory = directory
    }

    /// Made on the first photograph rather than at start-up.
    ///
    /// A recorder that could not be built would have to be replaced by
    /// something that pretends to be one, and a fake recorder silently drops
    /// every photograph in the scan. This way the first failure is a real error
    /// with a real reason, at the moment it happens.
    private var directoryReady = false

    private func ensureDirectory() throws {
        guard !directoryReady else { return }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        directoryReady = true
    }

    /// Writes one frame's image and remembers where it was taken from.
    ///
    /// JPEG at 0.8 rather than HEIC: a scan is a few hundred photographs and
    /// they are evidence, not portraits — and a JPEG opens on anything a
    /// contractor might forward it to.
    func record(frame: ARFrame, trigger: Trigger) throws {
        try ensureDirectory()
        let index = records.count + 1
        let fileName = String(format: "photo_%05d.jpg", index)

        let image = CIImage(cvPixelBuffer: frame.capturedImage)
        guard let data = context.jpegRepresentation(
            of: image,
            colorSpace: CGColorSpaceCreateDeviceRGB(),
            options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.8]
        ) else {
            throw RecorderError.cannotEncode
        }
        try data.write(to: directory.appendingPathComponent(fileName), options: .atomic)

        let transform = try flatten(frame.camera.transform, "camera transform")
        let intrinsics = try intrinsicsRow(frame.camera.intrinsics)

        records.append(
            Record(
                id: "photo-\(index)",
                takenAt: Self.stamp.string(from: Date()),
                trigger: trigger,
                fileName: fileName,
                cameraPoseARFrame: transform,
                intrinsics: intrinsics,
                imageWidth: CVPixelBufferGetWidth(frame.capturedImage),
                imageHeight: CVPixelBufferGetHeight(frame.capturedImage),
                trackingQuality: String(describing: frame.camera.trackingState)
            )
        )
    }

    /// Set once, the first time a usable heading and a pose land together.
    private(set) var north: North?

    /// Offered every heading update; keeps the first one it can trust.
    ///
    /// The first, not the best: a heading taken at the start of the walk is
    /// paired with a pose from the same instant, and both are then fixed. Taking
    /// a later one would mean re-pairing, and a compass that changes its mind
    /// halfway through a room is not a better compass.
    func offer(heading: Double, accuracy: Double, pose: simd_float4x4) {
        guard north == nil, accuracy >= 0, accuracy <= 40 else { return }
        guard let flat = try? flatten(pose, "north pose") else { return }
        north = North(trueHeading: heading, accuracy: accuracy, atPose: flat)
    }

    func manifest(device: String) -> Manifest {
        Manifest(
            capturedAt: Self.stamp.string(from: started),
            device: device,
            photos: records,
            north: north
        )
    }

    // MARK: - Flattening

    /// simd matrices are column-major and so is the JSON, so this is a copy
    /// rather than a transpose. Getting that backwards is a photograph pointing
    /// at the wrong wall, so it is stated here rather than assumed.
    private func flatten(_ m: simd_float4x4, _ what: String) throws -> [Float] {
        let columns = [m.columns.0, m.columns.1, m.columns.2, m.columns.3]
        let flat = columns.flatMap { [$0.x, $0.y, $0.z, $0.w] }
        guard flat.allSatisfy({ $0.isFinite }) else { throw RecorderError.notFinite(what) }
        return flat
    }

    /// Intrinsics go across **row-major**, and that is not an oversight.
    ///
    /// The transform above is column-major because that is how RoomPlan's own
    /// export writes it. The intrinsics in the same files are the other way
    /// round — `[fx, 0, cx, 0, fy, cy, 0, 0, 1]` — checked against two real
    /// exports rather than assumed, and that is the layout `capture.ts` reads.
    /// So rather than flatten a matrix and hope, the four numbers that matter
    /// are named and placed by hand. Getting this wrong is every photograph
    /// claiming the wrong field of view.
    private func intrinsicsRow(_ k: simd_float3x3) throws -> [Float] {
        let fx = k.columns.0.x
        let fy = k.columns.1.y
        let cx = k.columns.2.x
        let cy = k.columns.2.y
        let flat: [Float] = [fx, 0, cx, 0, fy, cy, 0, 0, 1]
        guard flat.allSatisfy({ $0.isFinite }) else {
            throw RecorderError.notFinite("camera intrinsics")
        }
        guard fx > 0 else { throw RecorderError.notFinite("focal length") }
        return flat
    }
}
