import Combine
import Foundation

/// The scans on this device.
///
/// A folder each, in the app's Documents directory, which means two useful
/// things without any code: they survive the app being killed, and they show up
/// in the Files app where somebody can get at them, copy them off, or send one
/// to a client without Trueline having a server at all.
@MainActor
final class ProjectStore: ObservableObject {

    @Published private(set) var scans: [Entry] = []

    struct Entry: Identifiable, Hashable {
        let folder: URL
        let name: String
        let modified: Date
        /// True when the folder holds something openable — a scanned room or a
        /// walked trace. A folder with neither is a capture that failed, and it
        /// is listed as that rather than hidden.
        let hasRoom: Bool
        /// Which way it was captured, for the line under its name.
        let kind: String
        /// A small picture of the plan, once one has been drawn.
        ///
        /// A list of folders called "Room 2026-08-24 1819" tells nobody which
        /// one was the kitchen. The drawing does, and the drawing already
        /// exists — the correction screens hand a small PNG of it back when
        /// they open a room, so the picture on this list cannot show a room the
        /// app does not have.
        let thumbnail: URL?

        var id: URL { folder }
    }

    private let root: URL

    init() {
        root = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Scans", isDirectory: true)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        refresh()
    }

    func folder(named name: String) -> URL {
        root.appendingPathComponent(name, isDirectory: true)
    }

    func refresh() {
        let contents = (try? FileManager.default.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.contentModificationDateKey, .isDirectoryKey],
            options: [.skipsHiddenFiles]
        )) ?? []

        scans = contents
            .filter { (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true }
            .map { folder in
                Entry(
                    folder: folder,
                    name: folder.lastPathComponent,
                    modified: (try? folder.resourceValues(forKeys: [.contentModificationDateKey])
                        .contentModificationDate) ?? .distantPast,
                    hasRoom: Self.holdsARoom(folder),
                    kind: Self.kind(of: folder),
                    thumbnail: {
                        let picture = folder.appendingPathComponent(Self.thumbnailFile)
                        return FileManager.default.fileExists(atPath: picture.path) ? picture : nil
                    }()
                )
            }
            .sorted { $0.modified > $1.modified }
    }

    func delete(_ entry: Entry) {
        try? FileManager.default.removeItem(at: entry.folder)
        refresh()
    }

    /// Reads a capture back off disk. Returns nil rather than half of one.
    func load(_ entry: Entry) -> SavedScan? {
        let room = (try? Data(contentsOf: entry.folder.appendingPathComponent("room.json"))) ?? Data()
        let trace = (try? Data(contentsOf: entry.folder.appendingPathComponent("trace.json"))) ?? Data()
        let corrected = (try? Data(contentsOf: entry.folder.appendingPathComponent(Self.correctedFile))) ?? Data()
        // A drawn room has neither a capture nor a walk — the room came off a
        // grid somebody tapped, and the corrected file IS the room. It outranks
        // both of the others on the way over anyway (`CorrectView`), so a folder
        // holding only that one opens exactly like a folder holding all three.
        guard !room.isEmpty || !trace.isEmpty || !corrected.isEmpty else { return nil }
        let photos = (try? Data(contentsOf: entry.folder.appendingPathComponent("photos.json")))
            ?? Data(#"{"schema":"trueline.photos.v1","capturedAt":"","device":"","photos":[]}"#.utf8)
        // Empty when nothing was marked, which is most scans. The far side
        // reads an empty manifest as "nothing was marked during the walk"
        // rather than as a missing file it has to explain.
        let pins = (try? Data(contentsOf: entry.folder.appendingPathComponent("pins.json"))) ?? Data()
        return SavedScan(
            folder: entry.folder,
            title: entry.name,
            roomJSON: room,
            photosJSON: photos,
            pinsJSON: pins,
            traceJSON: trace,
            correctedJSON: corrected
        )
    }

    /// Whether this folder holds something that will actually open.
    ///
    /// It used to be enough that `room.json` existed. It is not: a capture from
    /// before the writer refused wall-less rooms leaves a `room.json` with an
    /// empty `walls` array in it, and the list offered that scan like any other.
    /// Tapping it got "The scan has no walls" and a file-picker with nothing on
    /// this phone to pick — a dead end reached from a list that said the scan
    /// was fine.
    ///
    /// The writer stopped making new ones. It could not repair the ones already
    /// on somebody's phone, and this is what does: the same question the
    /// importer asks, asked before the scan is offered rather than after it is
    /// opened.
    ///
    /// Deliberately cheap — the array's emptiness, not a parse of the whole
    /// capture — because it runs for every folder every time the list refreshes.
    static func holdsARoom(_ folder: URL) -> Bool {
        if FileManager.default.fileExists(atPath: folder.appendingPathComponent("trace.json").path) {
            return true
        }
        // A room drawn by tapping its corners has no capture at all -- there was
        // no sensor and no walk, so there is no `room.json` and no `trace.json`
        // to write. What it has is the corrected room itself, which is the same
        // file every other kind of room also ends up with. Without this line a
        // hand-drawn room is listed as a capture that failed, on the first
        // screen of the app, with a "nothing was captured" page behind it.
        if FileManager.default.fileExists(atPath: folder.appendingPathComponent(correctedFile).path) {
            return true
        }
        guard
            let data = try? Data(contentsOf: folder.appendingPathComponent("room.json")),
            let top = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return false }
        let walls = top["walls"] as? [Any]
        return (walls?.isEmpty == false)
    }

    /// How this room got into the app, for the line under its name.
    ///
    /// Three ways in and three words, rather than two words and a room that has
    /// to be one of them. A drawn room is not "walked" — nobody walked it — and
    /// calling it that on the list is the kind of small lie that makes somebody
    /// stop believing the rest of the screen.
    static func kind(of folder: URL) -> String {
        let there = { FileManager.default.fileExists(atPath: folder.appendingPathComponent($0).path) }
        if there("room.json") { return "scanned" }
        if there("trace.json") { return "walked" }
        return "drawn"
    }

    /// What a corrected room is called inside a scan's folder.
    static let correctedFile = "corrected.json"

    /// And the picture of its plan.
    static let thumbnailFile = "plan.png"

    /// Where the contractor's own details live.
    ///
    /// Beside the scans rather than inside one, because they belong to the
    /// business and not to a job. A few hundred bytes plus whatever a logo
    /// weighs, and it goes to iCloud with everything else so a licence number
    /// is typed once in a lifetime rather than once per phone.
    var companyFile: URL { root.appendingPathComponent("company.json") }

    var company: Data { (try? Data(contentsOf: companyFile)) ?? Data() }

    func writeCompany(_ json: Data) {
        try? json.write(to: companyFile, options: .atomic)
    }

    /// Writes a corrected room into the scan's own folder.
    ///
    /// Until this existed, corrections lived only in the correction screens'
    /// `localStorage` — a web view's cache, which the operating system may take
    /// back when the device is short of space, and which never travelled
    /// anywhere. Somebody could type twenty tape readings into a room and have
    /// the only copy of them be a browser cache inside an app.
    ///
    /// Now they land next to the capture they came from, in the folder that is
    /// already visible in the Files app and already what gets AirDropped.
    /// Returns whether it landed, because a caller about to tell somebody their
    /// work is safe should know.
    @discardableResult
    func writeCorrected(_ project: Data, into folder: URL) -> Bool {
        do {
            try project.write(to: folder.appendingPathComponent(Self.correctedFile), options: .atomic)
            return true
        } catch {
            return false
        }
    }

    /// Writes the picture of a scan's plan into its folder.
    ///
    /// Not backed up and not worth backing up: it is derived from the room, and
    /// any device holding the room can draw it again in a few hundred
    /// milliseconds. Sending it to iCloud would be spending somebody's storage
    /// on something regenerable.
    func writeThumbnail(_ png: Data, into folder: URL) {
        try? png.write(to: folder.appendingPathComponent(Self.thumbnailFile), options: .atomic)
        refresh()
    }

    /// A photograph of damage, into the scan's own photo folder.
    ///
    /// The same folder the scanner's own photographs go in and the same one the
    /// web view is already allowed to serve from, so a picture taken on the
    /// claim screen is visible on the claim screen without a second path, a
    /// second permission or a second bug.
    ///
    /// Returns whether it was written. A photograph that silently failed to
    /// save is the worst outcome available here — the wall gets closed up on
    /// the strength of a backup that does not exist.
    @discardableResult
    func writeDamagePhoto(_ jpeg: Data, named name: String, into folder: URL) -> Bool {
        let photos = folder.appendingPathComponent("photos", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: photos, withIntermediateDirectories: true)
            try jpeg.write(to: photos.appendingPathComponent(name), options: .atomic)
            return true
        } catch {
            return false
        }
    }

    /// The names of every scan on this phone, for working out what iCloud has
    /// that this device does not.
    var names: Set<String> { Set(scans.map(\.name)) }

    /// Every corrected room on this phone, as `persist.ts` wrote them.
    ///
    /// For the Floor tab. The floor is built out of rooms in the web view's own
    /// storage, which only ever held a room somebody had opened there -- so six
    /// scans on a phone drew an empty floor until each had been visited one at
    /// a time. This is what the phone actually holds.
    ///
    /// Only rooms somebody has corrected. A capture nobody has opened has no
    /// corrected file, and it is left out rather than guessed at: a floor is
    /// made of rooms, and an uncorrected capture is not yet a room.
    func correctedRooms() -> [Data] {
        scans.compactMap { entry in
            guard entry.hasRoom else { return nil }
            return try? Data(contentsOf: entry.folder.appendingPathComponent(Self.correctedFile))
        }
    }

    /// Writes a scan that came back from iCloud into a folder of its own.
    ///
    /// Only ever called for a name this phone does not already have, so it
    /// cannot overwrite work in progress with an older copy from somewhere else.
    ///
    /// `kind` decides which file the capture is written into, and it has to:
    /// a scan, a walk and a drawing are three different formats and every one
    /// of them used to be written to `room.json`. A walked room came back onto
    /// a second phone as a RoomPlan capture no importer could read, and a drawn
    /// room — which has no capture at all — would have come back as an empty
    /// `room.json`, which is exactly the shape `holdsARoom` calls a failed one.
    func restore(name: String, capture: Data, kind: String, corrected: Data?) {
        let folder = self.folder(named: name)
        guard !FileManager.default.fileExists(atPath: folder.path) else { return }
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        // Nothing is written for a drawn room: there is no capture behind it,
        // and an empty file is not the same as no file to everything that reads
        // this folder afterwards.
        if !capture.isEmpty {
            let into = kind == "walked" ? "trace.json" : "room.json"
            try? capture.write(to: folder.appendingPathComponent(into), options: .atomic)
        }
        if let corrected {
            try? corrected.write(to: folder.appendingPathComponent(Self.correctedFile), options: .atomic)
        }
        refresh()
    }
}
