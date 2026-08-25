import Combine
import EventKit
import Foundation

/// Putting the work in the contractor's own calendar.
///
/// ## Why his and not ours
///
/// Every platform this competes with runs a scheduling service and charges for
/// it. There is nothing one does for a two-man crew that the calendar already
/// on this phone does not: it is synced to every device he owns, shared with
/// whoever he has already shared it with, backed up by somebody else, and it
/// still works when this app is deleted.
///
/// So Trueline writes into it and gets out of the way. No server, no account,
/// no monthly bill, and nothing of his held hostage.
///
/// ## Write-only, deliberately
///
/// iOS 17 added a permission for exactly this: an app that adds events without
/// reading what is already there. Trueline has no business knowing about
/// somebody's doctor's appointments, so it asks for the narrower one. On older
/// systems there is only the full permission, and the app says what it is for
/// in `Info.plist` either way.
///
/// ## Its own calendar, not the default one
///
/// Events go into a calendar called after the business, created once. A job
/// dropped into somebody's personal calendar is a job they cannot switch off
/// without switching off their own life, and a contractor who wants his work
/// out of sight on a Sunday should be able to untick one box.
@MainActor
final class JobCalendar: ObservableObject {

    enum Standing: Equatable {
        case unknown
        case allowed
        /// Refused, or never asked. `why` is what the screen says.
        case refused(why: String)
    }

    @Published private(set) var standing: Standing = .unknown
    /// What went wrong on the last write, in words, or nothing.
    @Published private(set) var trouble: String?

    private let store = EKEventStore()

    /// What the calendar is called in the Calendar app.
    ///
    /// The business name when there is one, so a contractor with two businesses
    /// gets two calendars rather than one confusing one.
    private func calendarName(for company: String) -> String {
        let trimmed = company.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "Trueline" : trimmed
    }

    /// Asks, once, and remembers what was said.
    func ask() async {
        do {
            let granted: Bool
            if #available(iOS 17.0, *) {
                // Write-only: this app adds events and has no business reading
                // what else is in somebody's calendar.
                granted = try await store.requestWriteOnlyAccessToEvents()
            } else {
                granted = try await store.requestAccess(to: .event)
            }
            standing = granted
                ? .allowed
                : .refused(
                    why: "Trueline cannot add to your calendar until you allow it: "
                        + "Settings → Privacy & Security → Calendars → Trueline. "
                        + "Everything else in the app works without this."
                )
        } catch {
            standing = .refused(why: "The calendar could not be reached: \(error.localizedDescription)")
        }
    }

    /// The calendar to write into, making it the first time.
    ///
    /// Returns nothing when there is nowhere to write -- a device with no
    /// writable calendar at all, which happens on a phone signed into nothing.
    private func calendar(named name: String) throws -> EKCalendar {
        let existing = store.calendars(for: .event).first {
            $0.title == name && $0.allowsContentModifications
        }
        if let existing { return existing }

        guard let source = writableSource() else {
            throw NSError(
                domain: "Trueline", code: 1,
                userInfo: [
                    NSLocalizedDescriptionKey:
                        "This phone has no calendar that can be written to. Adding an iCloud "
                        + "or Google account in Settings gives it one."
                ]
            )
        }
        let made = EKCalendar(for: .event, eventStore: store)
        made.title = name
        made.source = source
        try store.saveCalendar(made, commit: true)
        return made
    }

    /// Where a new calendar can live.
    ///
    /// iCloud first, so it follows him to the iPad and the Mac. A local source
    /// second, which is better than refusing. Subscribed and birthday sources
    /// are read-only and are never candidates.
    private func writableSource() -> EKSource? {
        let usable = store.sources.filter { source in
            source.sourceType != .subscribed && source.sourceType != .birthdays
        }
        return usable.first { $0.sourceType == .calDAV && $0.title == "iCloud" }
            ?? usable.first { $0.sourceType == .calDAV }
            ?? usable.first { $0.sourceType == .local }
            ?? store.defaultCalendarForNewEvents?.source
    }

    /// One visit, as it comes across from the web half.
    struct Visit: Decodable {
        let id: String
        let what: String
        let where_: String
        let starts: String
        let ends: String
        let note: String

        enum CodingKeys: String, CodingKey {
            case id, what, starts, ends, note
            case where_ = "where"
        }
    }

    /// Which visits have already been written, so none is written twice.
    ///
    /// Kept here rather than found by searching the calendar, and that is a
    /// consequence of asking for **write-only** access: the app cannot read
    /// what is in there, so it cannot look for its own events. Keeping the list
    /// is what makes de-duplication possible without asking to see somebody's
    /// doctor's appointments, and that trade is the right way round.
    ///
    /// What it costs, said plainly rather than papered over: if a visit is
    /// deleted in the Calendar app, Trueline does not know and will not put it
    /// back. Taking it off the list in Trueline and adding it again does.
    private static let writtenKey = "trueline.calendar.written"

    private var written: Set<String> {
        get { Set(UserDefaults.standard.stringArray(forKey: Self.writtenKey) ?? []) }
        set { UserDefaults.standard.set(Array(newValue), forKey: Self.writtenKey) }
    }

    /// Forgets what has been written, so everything is put in again.
    ///
    /// For the person who deleted the Trueline calendar and wants it back.
    func forget() {
        UserDefaults.standard.removeObject(forKey: Self.writtenKey)
    }

    /// Writes in every visit that has not been written before.
    func put(_ visits: [Visit], company: String) async {
        trouble = nil
        if standing == .unknown { await ask() }
        guard standing == .allowed else {
            if case .refused(let why) = standing { trouble = why }
            return
        }

        do {
            let name = calendarName(for: company)
            let target = try calendar(named: name)

            var done = written
            var added = 0
            for visit in visits where !done.contains(visit.id) {
                guard
                    let starts = Self.time(visit.starts),
                    let ends = Self.time(visit.ends),
                    ends > starts
                else { continue }

                let event = EKEvent(eventStore: store)
                event.calendar = target
                event.title = visit.what
                event.startDate = starts
                event.endDate = ends
                if !visit.where_.isEmpty { event.location = visit.where_ }
                // The marker is what makes a re-write an update rather than a
                // second copy of the same day.
                // The marker is for a person reading the event later and
                // wondering where it came from. It is not used to find the
                // event again -- write-only access means it cannot be.
                event.notes = visit.note.isEmpty
                    ? "Added by Trueline [\(visit.id)]"
                    : "\(visit.note)\n\nAdded by Trueline [\(visit.id)]"
                try store.save(event, span: .thisEvent, commit: false)
                done.insert(visit.id)
                added += 1
            }
            // Committed before the list is updated. The other order would mark
            // visits as written and then fail to write them, and they would
            // never be tried again.
            try store.commit()
            written = done
            if added == 0 && !visits.isEmpty {
                trouble = nil
            }
        } catch {
            trouble = "Could not write to the calendar: \(error.localizedDescription)"
        }
    }
}

extension JobCalendar {
    /// Parses a time, with or without fractional seconds.
    ///
    /// Both are needed and neither formatter does both: one configured for
    /// fractional seconds **refuses** a time without them, and the plain one
    /// refuses a time with them. The web half writes `.000Z` today, so a single
    /// formatter would work today and break silently the first time anything
    /// wrote a time from anywhere else -- and the failure looks exactly like a
    /// visit that was never added, which is the worst shape a bug can take here.
    static func time(_ text: String) -> Date? {
        Self.withFraction.date(from: text) ?? Self.plain.date(from: text)
    }

    private static let withFraction: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let plain: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()
}
