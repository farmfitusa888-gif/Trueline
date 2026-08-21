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
                    hasRoom: FileManager.default.fileExists(
                        atPath: folder.appendingPathComponent("room.json").path
                    ) || FileManager.default.fileExists(
                        atPath: folder.appendingPathComponent("trace.json").path
                    ),
                    kind: FileManager.default.fileExists(
                        atPath: folder.appendingPathComponent("room.json").path
                    ) ? "scanned" : "walked"
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
        guard !room.isEmpty || !trace.isEmpty else { return nil }
        let photos = (try? Data(contentsOf: entry.folder.appendingPathComponent("photos.json")))
            ?? Data(#"{"schema":"trueline.photos.v1","capturedAt":"","device":"","photos":[]}"#.utf8)
        return SavedScan(
            folder: entry.folder,
            title: entry.name,
            roomJSON: room,
            photosJSON: photos,
            traceJSON: trace
        )
    }
}
