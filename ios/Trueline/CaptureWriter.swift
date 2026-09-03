import Foundation
import RoomPlan

/// Writing a finished scan to disk, in the format the rest of ScanToBid reads.
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

    /// Puts a walk's photographs beside the room they belong to.
    ///
    /// ## The report this is the answer to
    ///
    /// > "WHEN I HIT DONE, IT BUILDS IT, BUT THERES NO PICS THERE"
    ///
    /// The photographs are taken into a scratch folder while somebody walks,
    /// because the room has no folder yet — it has no name and no time on it
    /// until Done is pressed. Moving them across afterwards was one line:
    ///
    ///     try? FileManager.default.moveItem(at: scratch, to: folder)
    ///
    /// and that `try?` is the whole problem. `photos.json` is already written
    /// by then, listing every photograph by name. If the move fails for any
    /// reason at all — the folder is already there, the disk is full, the file
    /// is locked — the question mark eats it, the save reports success, and the
    /// room says it holds ninety photographs while its `photos` folder is
    /// empty. There is no way for anybody downstream to tell that from a walk
    /// where nobody took any.
    ///
    /// ## What it does instead
    ///
    /// One photograph at a time, and never over the top of one that is already
    /// there. Anything that will not move is **copied** instead, and anything
    /// that will not copy either is left exactly where it is and its name comes
    /// back in the list. Nothing is deleted on any path through this function:
    /// a photograph still sitting in the scratch folder is a photograph that
    /// can still be recovered, and Sam has lost a scan with 53 pictures in it
    /// once already.
    ///
    /// The names that came back are what the caller has to say out loud.
    static func placePhotographs(
        from taken: URL,
        into folder: URL,
        listed: [String]
    ) -> [String] {
        let manager = FileManager.default
        let landing = folder.appendingPathComponent("photos", isDirectory: true)
        do {
            try manager.createDirectory(at: landing, withIntermediateDirectories: true)
        } catch {
            // Nowhere to put any of them, so all of them are missing. Said as a
            // list rather than as a thrown error, because the room itself is
            // already written and is worth keeping.
            return listed
        }

        var lost: [String] = []
        for name in listed {
            let from = taken.appendingPathComponent(name)
            let to = landing.appendingPathComponent(name)
            if manager.fileExists(atPath: to.path) { continue }
            guard manager.fileExists(atPath: from.path) else {
                lost.append(name)
                continue
            }
            do {
                try manager.moveItem(at: from, to: to)
            } catch {
                // A copy leaves the original where it is, which is the right
                // way round to fail: two copies of a photograph costs space,
                // and none costs the evidence.
                do {
                    try manager.copyItem(at: from, to: to)
                } catch {
                    lost.append(name)
                }
            }
        }
        return lost
    }

    /// What to tell somebody when photographs did not make it across.
    ///
    /// Plain words and a real number, and it names the one thing that matters:
    /// the pictures still exist. A message that only said "some photographs
    /// could not be saved" would read like they were gone.
    static func saying(lost: [String], stillIn scratch: URL) -> String {
        let many = lost.count == 1 ? "photograph" : "photographs"
        return "\(lost.count) \(many) from this scan could not be moved in beside the room. "
            + "They have not been thrown away — they are still on this phone, at "
            + "\(scratch.path). The room itself saved normally."
    }

    /// A folder name somebody can find again: what it is, and when.
    static func folderName(for name: String, at date: Date) -> String {
        let formatter = DateFormatter()
        // Seconds, not minutes. Two scans a contractor walks back to back can
        // land in the same minute -- a garage and the bay beside it, or one
        // walk abandoned and immediately re-walked -- and the folder name was
        // the only thing keeping them apart. `createDirectory` with
        // `withIntermediateDirectories: true` succeeds on a folder that is
        // already there, so the second scan wrote its `room.json` on top of the
        // first and INHERITED its `corrected.json`, which outranks a capture
        // everywhere. The screen then showed the older room, corrections and
        // all, for a walk somebody had just finished.
        formatter.dateFormat = "yyyy-MM-dd HHmmss"
        // Fixed, so a phone set to a 24-hour clock and a phone set to a 12-hour
        // one name their folders the same way. `HH` follows the locale
        // otherwise, and a folder called "Garage 2026-08-28 0224 PM" sorts and
        // reads differently from one called "Garage 2026-08-28 1424".
        formatter.locale = Locale(identifier: "en_US_POSIX")
        let cleaned = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let safe = cleaned.isEmpty ? "Room" : cleaned.replacingOccurrences(of: "/", with: "-")
        return "\(safe) \(formatter.string(from: date))"
    }

    /// A folder for a scan that is not already somebody else's.
    ///
    /// Seconds make a collision unlikely and do not make it impossible: a
    /// device restored from a backup, a clock that went backwards, two walks
    /// that genuinely start in the same second. What a collision costs is not a
    /// tidiness problem -- the arriving scan inherits the resident folder's
    /// `corrected.json`, and a corrected room outranks a capture on the way to
    /// the web view, so the new walk is never shown at all.
    ///
    /// So this refuses to hand back a folder that already holds a capture, and
    /// counts up until it finds one that does not.
    static func freeFolder(under root: URL, named wanted: String) -> URL {
        var name = wanted
        var next = 2
        while FileManager.default.fileExists(
            atPath: root.appendingPathComponent(name, isDirectory: true).path
        ) {
            name = "\(wanted) (\(next))"
            next += 1
            // A hundred folders of the same name in the same second is not a
            // real state; it is a filesystem that is lying about `fileExists`.
            // Stop rather than spin, and let the write fail with a reason.
            if next > 100 { break }
        }
        return root.appendingPathComponent(name, isDirectory: true)
    }
}
