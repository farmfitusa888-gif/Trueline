import Combine
import Foundation

/// The scans on this device.
///
/// A folder each, in the app's Documents directory, which means two useful
/// things without any code: they survive the app being killed, and they show up
/// in the Files app where somebody can get at them, copy them off, or send one
/// to a client without ScanToBid having a server at all.
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
        /// What this room is called, whose job it is, and whether it is done.
        ///
        /// Read off `card.json` in the folder. Every scan taken before that
        /// file existed has a blank one, which reads exactly as the list read
        /// before: no name, no job, not archived.
        let card: RoomCard
        /// The name to show: what somebody called it, or the folder's own name.
        ///
        /// Rooms were all called `Room 2026-08-26 0927` on this list, including
        /// the ones somebody had renamed — the name went into `corrected.json`
        /// and nothing on the list ever read it. `writeCorrected` copies it onto
        /// the card now, so there is one name and every screen shows it.
        var title: String { card.name.isEmpty ? name : card.name }
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

    /// A folder for a new capture that is not already somebody else's.
    ///
    /// `root` is private, and rightly so, so the rule lives in `CaptureWriter`
    /// where it can be read beside the writer it protects and this hands it the
    /// one thing it cannot reach. See `CaptureWriter.freeFolder`.
    func freeFolder(named name: String) -> URL {
        CaptureWriter.freeFolder(under: root, named: name)
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
                    card: RoomCard.read(in: folder),
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
            // And the name onto the card, so the list says what the room is
            // called rather than when it was captured. Renaming a room used to
            // change `corrected.json` and nothing else, so every row on the
            // first screen of the app went on saying "Room 2026-08-26 0927"
            // forever -- including the ones somebody had renamed.
            //
            // The job and the archive flag are NOT touched here: they are the
            // list's own, and a save from inside a room must not undo them.
            // "Room" is what `name(inside:)` hands back when there is no name
            // anywhere, and writing that onto a card would replace a real name
            // with a placeholder.
            //
            // This is the ONLY place in the app that writes a room's name onto
            // a card. There used to be a second -- `rename(_:to:)`, from the
            // Rooms list -- and the two could not agree: the correction screens
            // save the moment a room is opened, before anybody has touched
            // anything, so the name typed on the list was quietly overwritten
            // by the room's own the very next time somebody opened it. A name
            // that lives in two places is a name that will disagree, and in
            // this app that has already cost a scan with 53 photographs in it.
            let named = RoomCard.name(inside: project)
            if named != "Room" {
                var card = RoomCard.read(in: folder)
                if card.name != named {
                    card.name = named
                    card.write(in: folder)
                    refresh()
                }
            }
            return true
        } catch {
            return false
        }
    }

    /* ------------------------------------------------------ managing the list */

    /// What the room in this folder is called.
    ///
    /// ## Why this is a reader and there is no writer beside it
    ///
    /// There used to be `rename(_:to:)` here, which wrote a name of its own
    /// onto the card from the Rooms list. It could not work, and the way it
    /// failed is the most expensive bug this project has had.
    ///
    /// A room's name lives in `room.name` inside `corrected.json`. The
    /// correction screens own it, they put it on every drawing, proposal and
    /// claim document, and they hand the whole saved room back on the `saved`
    /// channel **every time a room is opened** -- before anybody has edited
    /// anything. `writeCorrected` copies that name onto the card. So a name
    /// typed on the list survived exactly until the next time somebody opened
    /// the room, and then the list silently went back to saying
    /// "Room 2026-08-26 0927" while the room's own screen said UPSTAIRS.
    ///
    /// That is the disagreement that made Sam delete a scan with 53
    /// photographs in it, believing it was a duplicate. So there is one name,
    /// it is the room's, it is changed on the room's own screen, and this
    /// screen-facing lookup is how every list and every title bar reads it.
    ///
    /// The **folder** keeps its timestamped name and never moves. It is the
    /// record name in iCloud and the path every photograph already sits under:
    /// renaming it means moving a directory and renaming a CloudKit record
    /// together, and a failure halfway through leaves the room in two places at
    /// once. A name is a label; a folder is an address.
    ///
    /// Falls back to the card on disk for a folder this list has not refreshed
    /// yet -- a room opened straight after a capture -- and to the folder's own
    /// name when nothing has named it, which is exactly what the list shows.
    func name(of folder: URL) -> String {
        if let entry = scans.first(where: { $0.folder == folder }) { return entry.title }
        let card = RoomCard.read(in: folder)
        return card.name.isEmpty ? folder.lastPathComponent : card.name
    }

    /// Puts a room in a job, or takes it out of one when the name is empty.
    @discardableResult
    func file(_ entry: Entry, under job: String) -> Bool {
        var card = entry.card
        card.job = job.trimmingCharacters(in: .whitespacesAndNewlines)
        let written = card.write(in: entry.folder)
        refresh()
        return written
    }

    /// Finished, or back on the list.
    ///
    /// Nothing is deleted and nothing leaves iCloud. The only thing archiving
    /// does is take a job off the screen somebody looks at every morning, which
    /// is the whole complaint: a house finished in March does not stop being
    /// work you did.
    @discardableResult
    func archive(_ entry: Entry, _ archived: Bool) -> Bool {
        var card = entry.card
        card.archived = archived
        let written = card.write(in: entry.folder)
        refresh()
        return written
    }

    /// Every job name in use, most recently touched first.
    ///
    /// Offered when somebody is filing a room, so the second room of a house
    /// is picked from a list rather than typed again and spelled differently.
    func jobs() -> [String] {
        var seen: [String] = []
        for entry in scans where !entry.card.job.isEmpty {
            if !seen.contains(entry.card.job) { seen.append(entry.card.job) }
        }
        return seen
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
    func restore(name: String, capture: Data, kind: String, card: Data?, corrected: Data?) {
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
        if let card {
            try? card.write(to: folder.appendingPathComponent(RoomCard.file), options: .atomic)
        }
        refresh()
    }

    /* ------------------------------------------------------ bringing one in */

    /// What happened when somebody handed the app a file or a folder.
    enum Brought {
        case took(name: String)
        case alreadyHere(name: String)
        case notARoom(String)
    }

    /// Takes a scan folder, or a bare `room.json`, and makes it a room here.
    ///
    /// ## Why this exists
    ///
    /// A scan is a folder, which is what makes it possible to AirDrop one, text
    /// one to yourself, or copy one out of the Files app. Getting one BACK had
    /// no path at all: the only way was to move a folder into
    /// `On My iPhone → ScanToBid → Scans` by hand, and iOS will not let you open
    /// a zip straight out of Messages, so the actual sequence was save to
    /// Files, tap to unzip, long-press, move, and get the nesting exactly
    /// right. Sam ended up with `room.json` loose in `Scans` and no room.
    ///
    /// An export with no import is half a feature.
    ///
    /// ## What it accepts
    ///
    ///   * A **folder** from a scan — `room.json` or `trace.json` or
    ///     `corrected.json` inside it, and whatever else it carries: the card,
    ///     the photographs, the USDZ. Copied whole.
    ///   * A bare **`room.json`** or **`trace.json`** — a folder is made around
    ///     it, named the way a capture on this phone would be.
    ///
    /// A folder already here under the same name is left completely alone and
    /// said so, rather than merged: merging two versions of one room silently
    /// is how somebody loses the half they wanted.
    /// Several files at once, reassembled into one scan folder.
    ///
    /// ## Why this exists as well as `bringIn`
    ///
    /// iOS will not let you SELECT a folder in the Files picker. Tapping one
    /// opens it. There is a way -- a long press, or the Open button on some
    /// screens -- and it is not a way anybody finds while standing on a job
    /// with a phone in one hand. Sam went through it and came out with only
    /// `room.json`, so the room came back and 53 photographs did not.
    ///
    /// Selecting many files IS easy: tap Select, tap Select All, Open. So the
    /// picker takes as many as you like and this puts them back where they
    /// belong -- the room, the trace, the corrections and the card at the top
    /// of the folder, and every photograph into `photos/`, which is where the
    /// rest of the app looks for them.
    func bringIn(_ picked: [URL]) -> Brought {
        if picked.count == 1 { return bringIn(picked[0]) }
        let manager = FileManager.default

        // What names the folder, and what proves these files are a scan.
        let roomish = ["room.json", "trace.json", Self.correctedFile]
        guard let spine = picked.first(where: { roomish.contains($0.lastPathComponent.lowercased()) })
        else {
            return .notARoom(
                "None of those files is a room.json, a trace.json or a corrected.json, so they "
                + "are not a scan. Select everything inside the scan's folder, including the "
                + "photos.")
        }

        let reachable = spine.startAccessingSecurityScopedResource()
        defer { if reachable { spine.stopAccessingSecurityScopedResource() } }
        let named = (try? Data(contentsOf: spine)).map { RoomCard.name(inside: $0) } ?? "Room"
        let folderName = CaptureWriter.folderName(
            for: named == "Room" ? spine.deletingLastPathComponent().lastPathComponent : named,
            at: Date())
        let into = folder(named: folderName)
        if manager.fileExists(atPath: into.path) { return .alreadyHere(name: folderName) }

        let pictures = into.appendingPathComponent("photos", isDirectory: true)
        let recordings = into.appendingPathComponent(
            VoiceRecorder.folderName, isDirectory: true)
        do {
            try manager.createDirectory(at: pictures, withIntermediateDirectories: true)
            try manager.createDirectory(at: recordings, withIntermediateDirectories: true)
        } catch {
            return .notARoom("A folder for it could not be made: \(error.localizedDescription)")
        }

        var took = 0
        for file in picked {
            let open = file.startAccessingSecurityScopedResource()
            defer { if open { file.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: file), !data.isEmpty else { continue }
            let name = file.lastPathComponent
            let kind = file.pathExtension.lowercased()
            let isPicture = ["jpg", "jpeg", "png", "heic"].contains(kind)
            // A recording has to go back into `voice/` and not to the top of the
            // folder, because that is the one place `WebBundle` will serve it
            // from. A note dropped a level up is a play button that never plays
            // -- and unlike a photograph, nobody can take it again.
            let isRecording = ["m4a", "mp4", "caf", "wav"].contains(kind)
            let where_ = isPicture ? pictures : isRecording ? recordings : into
            if (try? data.write(to: where_.appendingPathComponent(name), options: .atomic)) != nil {
                took += 1
            }
        }
        guard took > 0 else {
            try? manager.removeItem(at: into)
            return .notARoom("None of those files could be read.")
        }
        refresh()
        return .took(name: folderName)
    }

    func bringIn(_ picked: URL) -> Brought {
        let reachable = picked.startAccessingSecurityScopedResource()
        defer { if reachable { picked.stopAccessingSecurityScopedResource() } }

        let manager = FileManager.default
        var isFolder: ObjCBool = false
        guard manager.fileExists(atPath: picked.path, isDirectory: &isFolder) else {
            return .notARoom("That file is not there any more.")
        }

        if isFolder.boolValue {
            let holds = ["room.json", "trace.json", Self.correctedFile]
                .contains { manager.fileExists(atPath: picked.appendingPathComponent($0).path) }
            guard holds else {
                return .notARoom(
                    "There is no room.json, trace.json or corrected.json in that folder, so it "
                    + "is not a scan. If you unzipped one, the folder you want is the one those "
                    + "files are inside.")
            }
            let name = picked.lastPathComponent
            let into = folder(named: name)
            if manager.fileExists(atPath: into.path) {
                return .alreadyHere(name: name)
            }
            do {
                try manager.copyItem(at: picked, to: into)
            } catch {
                return .notARoom("That folder could not be copied in: \(error.localizedDescription)")
            }
            refresh()
            return .took(name: name)
        }

        let file = picked.lastPathComponent.lowercased()
        guard file == "room.json" || file == "trace.json" || file == Self.correctedFile else {
            return .notARoom(
                "\(picked.lastPathComponent) is not part of a scan. Pick the folder a scan is "
                + "in, or the room.json inside it.")
        }
        guard let data = try? Data(contentsOf: picked), !data.isEmpty else {
            return .notARoom("\(picked.lastPathComponent) is empty.")
        }
        // Named from the room inside it where there is one, so a room brought
        // back does not arrive called after the minute it was brought back.
        let inside = RoomCard.name(inside: data)
        let name = CaptureWriter.folderName(
            for: inside == "Room" ? picked.deletingLastPathComponent().lastPathComponent : inside,
            at: Date())
        let into = folder(named: name)
        if manager.fileExists(atPath: into.path) { return .alreadyHere(name: name) }
        do {
            try manager.createDirectory(at: into, withIntermediateDirectories: true)
            try data.write(to: into.appendingPathComponent(file), options: .atomic)
        } catch {
            return .notARoom("It could not be written: \(error.localizedDescription)")
        }
        refresh()
        return .took(name: name)
    }
}
