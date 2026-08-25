import Foundation
import RoomPlan

/// Writing a finished scan to disk, in the format the rest of Trueline reads.
///
/// The room goes out as `CapturedRoom` encoded by `JSONEncoder` — which is to
/// say, the exact same shape RoomPlan's own exports have. That is deliberate and
/// it is worth a paragraph.
///
/// The importer on the other side was written against two real RoomPlan exports
/// and is tested against them: nine edges out of a kitchen with a chamfer in it,
/// six out of a garage with a door opening, both landing on the area of the
/// outline they came from. Writing a different format here would throw all of
/// that away and start the verification again. So this app writes what the
/// importer already knows how to read, and everything proven stays proven.
///
/// One scan is one folder:
///
///     Kitchen 21 Aug 2026/
///       room.json         the CapturedRoom
///       photos.json       the manifest, one line per photograph
///       photos/           the photographs themselves
///       room.usdz         Apple's own 3D model, for anything that wants it
enum CaptureWriter {

    enum WriterError: Error, LocalizedError {
        case noRoom
        case noWalls

        var errorDescription: String? {
            switch self {
            case .noRoom:
                return "The scan did not produce a room. Nothing has been saved, because a "
                     + "half-saved scan is worse than none."
            case .noWalls:
                return "The scan finished without finding a single wall, so there is nothing to "
                     + "measure. Nothing has been saved. Walk the room again slowly with the "
                     + "lights on, standing back from each wall and keeping the phone pointed "
                     + "where the wall meets the floor."
            }
        }
    }

    struct Written {
        let folder: URL
        let roomJSON: Data
        let photosJSON: Data
        /// What was marked during the walk. Empty when nothing was.
        let pinsJSON: Data
    }

    @discardableResult
    static func write(
        room: CapturedRoom?,
        photos: PhotoRecorder,
        pins: PinRecorder,
        device: String,
        to folder: URL
    ) throws -> Written {
        guard let room else { throw WriterError.noRoom }
        // A room with no walls in it was being written, listed as "scanned",
        // and then refused by the importer one screen later — so the app told
        // somebody their scan was saved and then would not open it. Refused
        // here instead, before the folder is created, so nothing is left behind.
        guard !room.walls.isEmpty else { throw WriterError.noWalls }

        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

        let roomJSON = try encoder.encode(room)
        try roomJSON.write(to: folder.appendingPathComponent("room.json"), options: .atomic)

        let photosJSON = try encoder.encode(photos.manifest(device: device))
        try photosJSON.write(to: folder.appendingPathComponent("photos.json"), options: .atomic)

        // What somebody pointed at while walking. Its own file rather than a
        // field inside photos.json: a pin is evidence about a place and a
        // photograph is evidence about a moment, and a capture with no pins
        // should have no pins file rather than an empty list inside another one.
        var pinsJSON = Data()
        if !pins.isEmpty {
            pinsJSON = try encoder.encode(pins.manifest())
            try pinsJSON.write(to: folder.appendingPathComponent("pins.json"), options: .atomic)
        }

        // Apple's own 3D model alongside. It is not what any measurement comes
        // from — the measurements come from room.json — but it is what opens in
        // Quick Look when somebody taps the file, and that is worth having.
        do {
            try room.export(to: folder.appendingPathComponent("room.usdz"), exportOptions: .parametric)
        } catch {
            // A missing usdz costs a preview. It does not cost the scan, so it
            // does not stop the save.
        }

        return Written(
            folder: folder,
            roomJSON: roomJSON,
            photosJSON: photosJSON,
            pinsJSON: pinsJSON
        )
    }

    /// A folder name somebody can find again: what it is, and when.
    static func folderName(for name: String, at date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HHmm"
        let cleaned = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let safe = cleaned.isEmpty ? "Room" : cleaned.replacingOccurrences(of: "/", with: "-")
        return "\(safe) \(formatter.string(from: date))"
    }
}
