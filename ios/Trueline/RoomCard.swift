import Foundation

/// What this room is called, whose job it belongs to, and whether it is finished.
///
/// ## Why there is a file for this at all
///
/// > "ALSO MAKE A WAY TO MANAGE THE ROOM TAB, ONCE PEOPLE GET SCANNING THERES
/// >  NO WAY TO MANAGE IT EXCEPT DELETE"
///
/// Four things were wrong with the list at once, and they are all the same
/// thing: the list knew nothing about a room except its folder's name and the
/// date the folder was touched.
///
///   - Every row said `Room 2026-08-26 0927`, including rooms somebody had
///     renamed. The name went into `corrected.json` and the list never read it.
///   - Six rooms from one house sat in a flat list beside six rooms from six
///     other houses, with nothing saying which was which.
///   - There was no search and one order, newest first, forever.
///   - A job finished in March stayed on the first screen of the app until
///     somebody deleted the work.
///
/// ## Why it is a file per folder and not one index
///
/// A scan is a folder. That has been true since the first build and it is why
/// a scan can be AirDropped, copied out of the Files app, or restored from
/// iCloud on its own. A single `rooms.json` listing every scan would be a
/// second source of truth that has to be kept in step with the folders — and
/// the first thing that goes wrong is a folder restored from iCloud that the
/// index has never heard of, which then shows up as nothing at all.
///
/// So the card lives **inside the folder it describes**, next to `room.json`
/// and `corrected.json`. Copy the folder anywhere and the name, the job and
/// the archive flag go with it. Delete the folder and nothing is left behind
/// pointing at it. There is no index to rebuild, because there is no index.
///
/// It is a few hundred bytes, and `refresh()` reads one per folder — the same
/// order of work as the `fileExists` checks that were already there.
struct RoomCard: Codable, Equatable {
    static let schema = "trueline.card.v1"
    static let file = "card.json"

    var schema: String = RoomCard.schema
    /// What to call this room. Empty means "no name given" and the folder's own
    /// name is used, which is what every room looked like before this existed.
    var name: String = ""
    /// The property this room belongs to — "118 Willow St".
    ///
    /// A property rather than a free label, because the address is already
    /// typed on the proposal and on the claim: it is a thing that exists rather
    /// than a new one to invent, and two rooms of the same house agree on it
    /// without anybody remembering how they spelled it last time.
    var job: String = ""
    /// Finished. Off the first screen, still on the phone, still in iCloud.
    var archived: Bool = false
    /// When any of the above last changed, so a second device can tell which
    /// copy is newer without opening the room.
    var updatedAt: String = ""

    /// What the correction screens called this room.
    ///
    /// `persist.ts` writes `fileName` at the top of every saved project, which
    /// is the name typed on the room. Read rather than guessed at, and falling
    /// back to `Room` — the same fallback `CaptureWriter.folderName` uses —
    /// when a build writes something this one cannot read.
    ///
    /// Lives here rather than on a screen because two very different callers
    /// need it: `DrawScreen`, to name the folder a hand-drawn room lands in,
    /// and `ProjectStore.writeCorrected`, to keep the list's name in step with
    /// the room's.
    static func name(inside project: Data) -> String {
        guard
            let top = try? JSONSerialization.jsonObject(with: project) as? [String: Any],
            let name = top["fileName"] as? String,
            !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return "Room" }
        return name
    }

    /// Reads the card beside a scan, or the blank one every folder starts with.
    ///
    /// Never throws and never refuses: a folder with no card is the ordinary
    /// case for every scan taken before this existed, and a card this build
    /// cannot read is not a reason to hide somebody's room from the list.
    static func read(in folder: URL) -> RoomCard {
        guard
            let data = try? Data(contentsOf: folder.appendingPathComponent(file)),
            let card = try? JSONDecoder().decode(RoomCard.self, from: data)
        else { return RoomCard() }
        return card
    }

    /// Writes it back, stamped.
    @discardableResult
    func write(in folder: URL) -> Bool {
        var stamped = self
        stamped.schema = RoomCard.schema
        stamped.updatedAt = ISO8601DateFormatter().string(from: Date())
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(stamped) else { return false }
        do {
            try data.write(to: folder.appendingPathComponent(RoomCard.file), options: .atomic)
            return true
        } catch {
            // A full disk. The room is still there and still openable; what is
            // lost is the rename, and the caller says so rather than pretending.
            return false
        }
    }
}
