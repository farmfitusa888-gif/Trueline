import CloudKit
import Combine
import Foundation

/// A copy of the work, in the owner's own iCloud.
///
/// Until this existed, a scan lived in one place: a folder on one phone. Drop
/// the phone down a stairwell and a morning of measuring is gone, with no copy
/// anywhere and nothing that could have made one. That is the failure that loses
/// a contractor for good, and every other risk in this product is recoverable.
///
/// It goes into the **user's own iCloud private database**, which is the whole
/// reason it costs nothing to run. Apple's own words for it: *"Store private
/// data securely in your users' iCloud accounts."* There is no Trueline server,
/// no account to create, no password to reset and no monthly bill — and the
/// sentence on the screen stays honest: it is not "our cloud", it is theirs.
///
/// **The room model only, and that is a size decision, not a shyness.** A
/// corrected room is measured at 5.5 kB for Sam's garage and 8.4 kB for
/// Gilbert's kitchen. The photographs from one 55-shot garage scan are 26 MB.
/// A free iCloud account is 5 GB and it already has the owner's own photos in
/// it: at 6 kB a room that is hundreds of thousands of rooms, and at 26 MB a
/// scan it is under two hundred before somebody's phone stops backing up. So
/// the model goes, always and silently, and the photographs stay on the phone
/// until somebody asks — which is a decision about a customer's kitchen that
/// belongs to the person standing in it.
///
/// Nothing here is the only copy of anything. The folder on the phone remains
/// the source of truth; this is a copy that survives the phone.
@MainActor
final class Backup: ObservableObject {

    /// What the screen is allowed to say about the state of the copy.
    ///
    /// `unavailable` is a state and not an error: a phone with no iCloud account
    /// signed in is a perfectly good phone, and the app has to say plainly that
    /// there is no copy rather than showing a tick it has not earned.
    enum State: Equatable {
        case unknown
        case unavailable(String)
        case working
        /// `count` is nil when the copy went up but counting what is there
        /// failed — a count is a second round trip and it can fail on its own.
        /// Printing "0 scans copied" after a successful push would be a lie
        /// about somebody's work, and a worse one than saying nothing.
        case upToDate(count: Int?, at: Date)
        case failed(String)

        var isBackedUp: Bool {
            if case .upToDate = self { return true }
            return false
        }
    }

    @Published private(set) var state: State = .unknown

    /// The record type. One per scan, keyed by the scan's folder name, so the
    /// same scan corrected twice replaces its own record rather than making a
    /// second one.
    private static let recordType = "Scan"
    /// Photographs are their own record type: one per photograph, so a failed
    /// upload costs that photograph and not the room it belongs to.
    private static let photoRecordType = "DamagePhoto"

    private let container: CKContainer
    private var database: CKDatabase { container.privateCloudDatabase }

    init(container: CKContainer = .default()) {
        self.container = container
    }

    // MARK: - Whether there is anywhere to put it

    /// Asks iCloud whether this phone has an account, and says so either way.
    ///
    /// Called before anything is pushed. An app that quietly fails to back up is
    /// worse than one that never claimed to, so every reason it cannot is turned
    /// into a sentence somebody can act on rather than a silent no-op.
    func check() async {
        do {
            switch try await container.accountStatus() {
            case .available:
                if case .unknown = state { state = .working }
            case .noAccount:
                state = .unavailable(
                    "No iCloud account is signed in on this phone, so nothing is backed up. "
                        + "Settings → Sign in to your iPhone."
                )
            case .restricted:
                state = .unavailable(
                    "iCloud is restricted on this phone — usually Screen Time or a device "
                        + "policy — so nothing is backed up."
                )
            case .couldNotDetermine:
                state = .unavailable("iCloud could not be reached, so nothing is backed up yet.")
            case .temporarilyUnavailable:
                state = .unavailable(
                    "iCloud is temporarily unavailable. Your work is on this phone; the copy "
                        + "will go up when it comes back."
                )
            @unknown default:
                state = .unavailable("iCloud is in a state this app does not recognise.")
            }
        } catch {
            state = .unavailable(Self.explain(error))
        }
    }

    // MARK: - Up

    /// Puts one scan's model into iCloud, replacing whatever was there for it.
    ///
    /// `corrected` is the whole saved project as the correction screens write
    /// it — the room with everybody's tape readings in it, not the raw capture.
    /// `capture` is what the scanner produced, kept alongside so a second device
    /// can rebuild the scan from nothing.
    func push(scan name: String, capture: Data, corrected: Data?) async {
        // A phone with no iCloud account has nowhere to put it, and saying so
        // once is enough — retrying on every keystroke would only spend the
        // battery. A *failure* is different: a lost signal comes back, and the
        // next save is exactly when to try again.
        if case .unavailable = state { return }
        state = .working
        let id = CKRecord.ID(recordName: Self.recordName(for: name))
        do {
            // Fetch-then-modify rather than blind save: CloudKit refuses a save
            // that would overwrite a record the server has a newer change tag
            // for, and a refusal on every save after the first is exactly what a
            // blind save produces.
            let record: CKRecord
            if let existing = try? await database.record(for: id) {
                record = existing
            } else {
                record = CKRecord(recordType: Self.recordType, recordID: id)
            }
            record["name"] = name as CKRecordValue
            record["capture"] = capture as CKRecordValue
            if let corrected {
                record["corrected"] = corrected as CKRecordValue
            }
            record["savedAt"] = Date() as CKRecordValue
            // The version of the saved format, so a phone running an older build
            // can refuse a record it would half-understand rather than opening a
            // room it has misread.
            record["format"] = Self.format as CKRecordValue

            _ = try await database.modifyRecords(
                saving: [record],
                deleting: [],
                savePolicy: .changedKeys
            )
            await refreshCount()
        } catch {
            state = .failed(Self.explain(error))
        }
    }

    /// A photograph of damage, into the owner's iCloud.
    ///
    /// Its own record rather than a field on the scan, and a `CKAsset` rather
    /// than `Data`, for three reasons that all point the same way:
    ///
    ///   - CloudKit caps a record's own fields at a megabyte and an asset at
    ///     far more. A photograph does not fit in a field.
    ///   - An asset is uploaded as a file, so a photograph does not have to be
    ///     re-sent every time a tape reading changes the room it belongs to.
    ///   - One record per photograph means a failed upload loses that
    ///     photograph and not the room, which is the right way round.
    ///
    /// The bytes are written to a temporary file because that is the only thing
    /// `CKAsset` accepts, and removed afterwards whether or not the upload
    /// worked. The copy that matters is already on disk in the scan's folder —
    /// this is the backup, and it fails without taking anything with it.
    func pushDamagePhoto(scan name: String, photo photoName: String, jpeg: Data) async {
        if case .unavailable = state { return }
        let temporary = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("jpg")
        defer { try? FileManager.default.removeItem(at: temporary) }
        do {
            try jpeg.write(to: temporary, options: .atomic)
            let id = CKRecord.ID(recordName: Self.photoRecordName(scan: name, photo: photoName))
            let record = (try? await database.record(for: id))
                ?? CKRecord(recordType: Self.photoRecordType, recordID: id)
            record["scan"] = name as CKRecordValue
            record["photoName"] = photoName as CKRecordValue
            record["image"] = CKAsset(fileURL: temporary)
            record["savedAt"] = Date() as CKRecordValue
            _ = try await database.modifyRecords(saving: [record], deleting: [], savePolicy: .changedKeys)
        } catch {
            state = .failed(Self.explain(error))
        }
    }

    /// Every damage photograph iCloud holds for one scan.
    ///
    /// For the second phone: it pulls the room out of iCloud and then has a
    /// claim document referring to photographs it has never seen. Returned as
    /// name-and-bytes so the caller writes them into the scan's own folder,
    /// where everything else already looks for them.
    func fetchDamagePhotos(scan name: String) async -> [(name: String, jpeg: Data)] {
        let query = CKQuery(
            recordType: Self.photoRecordType,
            predicate: NSPredicate(format: "scan == %@", name)
        )
        var out: [(name: String, jpeg: Data)] = []
        var cursor: CKQueryOperation.Cursor?
        repeat {
            do {
                let page: (matchResults: [(CKRecord.ID, Result<CKRecord, Error>)], queryCursor: CKQueryOperation.Cursor?)
                if let cursor {
                    page = try await database.records(continuingMatchFrom: cursor)
                } else {
                    page = try await database.records(matching: query)
                }
                for (_, result) in page.matchResults {
                    guard
                        let record = try? result.get(),
                        let photoName = record["photoName"] as? String,
                        let asset = record["image"] as? CKAsset,
                        let url = asset.fileURL,
                        let data = try? Data(contentsOf: url)
                    else { continue }
                    out.append((name: photoName, jpeg: data))
                }
                cursor = page.queryCursor
            } catch {
                // Whatever came back before the failure is still worth having,
                // and the room itself is already down. A claim missing one
                // photograph is a claim; a claim that refused to open is not.
                state = .failed(Self.explain(error))
                return out
            }
        } while cursor != nil
        return out
    }

    /// The contractor's own details, in their iCloud with everything else.
    ///
    /// One record, not one per scan: it belongs to the business rather than to
    /// a job, and it is what stops somebody retyping a licence number on a new
    /// phone.
    func pushCompany(_ json: Data) async {
        if case .unavailable = state { return }
        let id = CKRecord.ID(recordName: "company")
        do {
            let record = (try? await database.record(for: id))
                ?? CKRecord(recordType: "Company", recordID: id)
            record["profile"] = json as CKRecordValue
            record["savedAt"] = Date() as CKRecordValue
            _ = try await database.modifyRecords(saving: [record], deleting: [], savePolicy: .changedKeys)
        } catch {
            state = .failed(Self.explain(error))
        }
    }

    /// The details as iCloud holds them, for a phone that has none yet.
    func fetchCompany() async -> Data? {
        let id = CKRecord.ID(recordName: "company")
        guard let record = try? await database.record(for: id) else { return nil }
        return record["profile"] as? Data
    }

    /// Removes a scan's copy, for a scan somebody deleted on purpose.
    ///
    /// Deleting on the phone has to delete the copy, or the next device to sync
    /// puts it back and somebody has to delete a room twice.
    func forget(scan name: String) async {
        let id = CKRecord.ID(recordName: Self.recordName(for: name))
        _ = try? await database.modifyRecords(saving: [], deleting: [id])
        await refreshCount()
    }

    // MARK: - Down

    /// One scan as iCloud holds it.
    struct Restored {
        let name: String
        let capture: Data
        let corrected: Data?
        let savedAt: Date
    }

    /// Everything in the owner's iCloud that is not already on this phone.
    ///
    /// This is the second half of the point. A backup nobody can get back is a
    /// receipt, not a backup — and it is also how the same person's second
    /// device gets the job they scanned on the first one.
    func fetchMissing(have: Set<String>) async -> [Restored] {
        do {
            // No sort descriptor. Sorting server-side would need `savedAt`
            // marked Sortable in the CloudKit console on top of the one index
            // this already needs, and there are never enough scans on one phone
            // for the sort to be worth a second setup step somebody can forget.
            let query = CKQuery(recordType: Self.recordType, predicate: NSPredicate(value: true))
            var out: [Restored] = []
            var cursor: CKQueryOperation.Cursor?
            repeat {
                let page: (matchResults: [(CKRecord.ID, Result<CKRecord, Error>)], queryCursor: CKQueryOperation.Cursor?)
                if let cursor {
                    page = try await database.records(continuingMatchFrom: cursor)
                } else {
                    page = try await database.records(matching: query)
                }
                for (_, result) in page.matchResults {
                    guard
                        let record = try? result.get(),
                        let name = record["name"] as? String,
                        let capture = record["capture"] as? Data,
                        !have.contains(name)
                    else { continue }
                    // A record written by a newer build of the app may hold a
                    // room this one would misread. Refused rather than guessed
                    // at — the same rule the saved-file reader follows.
                    guard (record["format"] as? Int ?? Self.format) <= Self.format else { continue }
                    out.append(
                        Restored(
                            name: name,
                            capture: capture,
                            corrected: record["corrected"] as? Data,
                            savedAt: record["savedAt"] as? Date ?? .distantPast
                        )
                    )
                }
                cursor = page.queryCursor
            } while cursor != nil
            return out.sorted { $0.savedAt > $1.savedAt }
        } catch {
            state = .failed(Self.explain(error))
            return []
        }
    }

    // MARK: - Counting

    private func refreshCount() async {
        do {
            let query = CKQuery(recordType: Self.recordType, predicate: NSPredicate(value: true))
            // Only the keys needed to count them. Pulling every capture back
            // down to say "3 scans" would move megabytes to draw a line of text.
            let page = try await database.records(matching: query, desiredKeys: ["name"])
            state = .upToDate(count: page.matchResults.count, at: Date())
        } catch {
            // The push itself succeeded; failing to count is not failing to back
            // up. Report it as up to date with no number rather than as zero,
            // which would read as "nothing is copied" over work that is.
            state = .upToDate(count: nil, at: Date())
        }
    }

    // MARK: - Details

    /// The saved-format version this build writes and will read.
    static let format = 1

    /// The one thing that has to be done by hand, once, and what happens if it is not.
    ///
    /// CloudKit builds its schema from the first record an app saves, so pushing
    /// works with no setup at all. **Querying does not.** A field is not
    /// searchable until it is marked Queryable in the CloudKit console, and the
    /// query in `fetchMissing` needs `recordName` on the `Scan` type marked
    /// Queryable — which means a fresh container backs work up correctly and
    /// then finds nothing when a second device looks for it.
    ///
    /// That failure is silent and it looks exactly like "the backup did not
    /// work", so it is written down here rather than left to be rediscovered:
    ///
    ///   1. icloud.developer.apple.com -> the `iCloud.com.sunnyacres.trueline`
    ///      container -> Schema -> Indexes.
    ///   2. On record type `Scan`, add a **Queryable** index on `recordName`.
    ///   3. Deploy the development schema to production before any App Store
    ///      release. A container's development and production schemas are
    ///      separate, and a build from the App Store talks to production.
    ///
    /// Nothing on the phone can do this, and nothing on the phone can tell the
    /// difference between "the index is missing" and "there is nothing there" —
    /// so `explain` names it when CloudKit refuses the query.
    static let setupNote =
        "mark recordName Queryable on the Scan record type and the scan field Queryable on "
        + "DamagePhoto, then deploy the schema."

    /// A record name from a folder name.
    ///
    /// CloudKit record names allow a limited character set and a scan is named
    /// after a room, which can be anything somebody types. Percent-encoding
    /// keeps it reversible; a hash would not, and the name is worth reading in
    /// the CloudKit console when something goes wrong.
    static func recordName(for scan: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
        return scan.addingPercentEncoding(withAllowedCharacters: allowed)?
            .replacingOccurrences(of: "%", with: "_") ?? scan
    }

    /// One photograph's record name: its scan and its own name, together.
    ///
    /// A CloudKit record name may hold ASCII letters, digits, `-`, `_` and `.`
    /// and nothing else. `recordName(for:)` escapes down to the first four, so
    /// a dot is a separator that escaping can never produce — which is what
    /// makes two scans with a photograph of the same name impossible to
    /// collide.
    static func photoRecordName(scan: String, photo: String) -> String {
        "\(recordName(for: scan)).\(recordName(for: photo))"
    }

    /// A CloudKit error as a sentence, not a code.
    ///
    /// Every one of these is somebody's work, so every message says what
    /// happened to it and what is still true — the copy on this phone.
    static func explain(_ error: Error) -> String {
        guard let ck = error as? CKError else {
            return "iCloud returned an error: \(error.localizedDescription)"
        }
        switch ck.code {
        case .quotaExceeded:
            return "This iCloud account is full, so the copy could not go up. "
                + "Your work is still on this phone."
        case .networkUnavailable, .networkFailure:
            return "No connection, so the copy has not gone up yet. It will when there is one."
        case .notAuthenticated:
            return "No iCloud account is signed in, so nothing is backed up."
        case .zoneBusy, .serviceUnavailable, .requestRateLimited:
            return "iCloud is busy. Your work is on this phone; the copy will go up shortly."
        case .permissionFailure:
            return "iCloud would not accept the copy — check that iCloud Drive is on for Trueline."
        case .invalidArguments:
            // Nearly always the missing Queryable index. Naming it beats
            // "invalid arguments", which tells nobody anything.
            return "iCloud refused the query. In the CloudKit console, " + setupNote
        default:
            return "iCloud could not take the copy (\(ck.code.rawValue)). Your work is on this phone."
        }
    }
}
