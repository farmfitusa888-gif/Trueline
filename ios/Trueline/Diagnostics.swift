import Combine
import Foundation
import MessageUI
import MetricKit
import SwiftUI
import UIKit

/// What went wrong, kept where somebody can send it.
///
/// ## The thing this fixes
///
/// `docs/BUSINESS.md` §6 lists four ways this business fails and marks one of
/// them **certain**, because it was not a risk — it was the state of the app:
///
/// > There is no analytics and no crash reporting in the codebase. When
/// > somebody stops using it you will not know they stopped; when it crashes
/// > you will not know it crashed.
///
/// That is what a privacy architecture with no server actually costs, and the
/// cost is real. A scan that fails in a stranger's basement is invisible from
/// here, and the only signal is whether that stranger can be bothered to write
/// an email.
///
/// ## Why MetricKit and not a crash SDK
///
/// Every third-party crash reporter — Crashlytics, Sentry, Bugsnag — works by
/// shipping a payload off the device to somebody else's server. Bolting one on
/// would make the privacy nutrition label a lie in the same week it is written,
/// and "no data collected, nothing leaves the device" is the one claim on the
/// App Store listing nobody else in this category can make.
///
/// `MetricKit` is Apple's own, ships with iOS, and collects nothing personal.
/// Crash and hang reports go to **App Store Connect**, where they are already
/// aggregated and anonymised by Apple, with no code at all.
///
/// So why this file, if Apple does it for free? Because App Store Connect only
/// has anything **after there is an App Store listing**, and there is not one.
/// The next six months are TestFlight builds on Gilbert's phone and five
/// restoration contractors', and during exactly the period when a crash matters
/// most, Apple's own pipe is empty. This writes the same payloads to a folder
/// on the device so they can be read and sent in the meantime.
///
/// ## What is honest about the timing
///
/// **MetricKit is not instant and nothing here pretends otherwise.** Apple
/// delivers diagnostic payloads at most once every 24 hours, and a crash
/// arrives on a *later launch*, not at the moment of the crash. So the report
/// for this morning's crash is normally there tomorrow. The screen says that,
/// rather than showing an empty list and letting somebody conclude nothing
/// broke.
///
/// The web errors below have no such delay: they are written the moment they
/// happen, which matters because most of this app is the web bundle.
///
/// ## Nothing leaves the phone on its own
///
/// Every report is a file in `Documents/Reports`, visible in the Files app.
/// Nothing is uploaded, nothing is posted, and there is no network call in this
/// file. The only way one leaves the device is somebody tapping **Send them**,
/// which opens the mail composer with the file attached and their finger on the
/// send button. That is the same rule the rest of the app keeps about the
/// customer's own data, and it applies to the app's own laundry too.
final class Diagnostics: NSObject, ObservableObject, MXMetricManagerSubscriber {

    /// Where reports go if somebody taps Send them.
    ///
    /// The domain rather than a personal inbox: an address inside a shipped app
    /// is permanent in a way a Gmail account is not, and the App Store listing
    /// needs a support URL on that domain anyway.
    static let sendTo = "support@trueline.tools"

    /// One report on disk.
    struct Report: Identifiable, Equatable {
        let file: URL
        /// `crash`, `hang`, `launch`, `disk`, `cpu`, `daily`, or `screen` for
        /// something the web half caught.
        let kind: String
        let when: Date
        /// The first line of the file — written to be readable on its own.
        let summary: String

        var id: URL { file }
    }

    @Published private(set) var reports: [Report] = []

    /// How many to keep. A report is a few kilobytes and they arrive daily, so
    /// this is a housekeeping cap rather than a space one: a list of two hundred
    /// is a list nobody reads, and the useful ones are always the recent ones.
    private static let keep = 40

    /// The most a single report may be. MetricKit's daily payload with several
    /// diagnostics in it can run long; a crash report nobody can open in a mail
    /// client is a report that does not do its job.
    private static let biggest = 400_000

    private let folder: URL

    override init() {
        folder = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Reports", isDirectory: true)
        super.init()
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    }

    /// Starts listening, and picks up anything Apple has already collected.
    ///
    /// `pastDiagnosticPayloads` is the reason a crash from before this build
    /// existed can still be read: iOS holds the last few payloads whether or not
    /// anybody was subscribed at the time. Without this call the first crash a
    /// TestFlight user hits would be delivered to a subscriber that had not been
    /// registered yet and would simply be gone.
    func start() {
        MXMetricManager.shared.add(self)
        let manager = MXMetricManager.shared
        write(diagnostics: manager.pastDiagnosticPayloads)
        write(metrics: manager.pastPayloads)
        refresh()
    }

    // MARK: - MetricKit

    /// Crashes, hangs, launch stalls, runaway disk writes and CPU exceptions.
    ///
    /// Not on the main thread. Everything below writes files and then hops to
    /// main for the one `@Published` change, rather than doing file I/O there.
    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        write(diagnostics: payloads)
        refresh()
    }

    /// The daily aggregate: launch times, hang rate, memory, battery.
    ///
    /// Kept as well as the crashes, and labelled `daily` so it never gets
    /// mistaken for something breaking. A hang rate creeping up over a fortnight
    /// is the signal that arrives before the one-star review does.
    func didReceive(_ payloads: [MXMetricPayload]) {
        write(metrics: payloads)
        refresh()
    }

    private func write(diagnostics payloads: [MXDiagnosticPayload]) {
        for payload in payloads {
            // What is in it decides what it is called, so the list reads
            // "crash" rather than "diagnostic payload". A payload can carry
            // more than one kind; the worst one names it, because that is the
            // one somebody needs to look at first.
            let kind: String
            if payload.crashDiagnostics?.isEmpty == false { kind = "crash" }
            else if payload.hangDiagnostics?.isEmpty == false { kind = "hang" }
            else if payload.cpuExceptionDiagnostics?.isEmpty == false { kind = "cpu" }
            else if payload.diskWriteExceptionDiagnostics?.isEmpty == false { kind = "disk" }
            else if payload.appLaunchDiagnostics?.isEmpty == false { kind = "launch" }
            else { continue }  // An empty payload is not a report. Apple sends them.

            let counts = [
                ("crash", payload.crashDiagnostics?.count ?? 0),
                ("hang", payload.hangDiagnostics?.count ?? 0),
                ("CPU exception", payload.cpuExceptionDiagnostics?.count ?? 0),
                ("disk write exception", payload.diskWriteExceptionDiagnostics?.count ?? 0),
                ("slow launch", payload.appLaunchDiagnostics?.count ?? 0),
            ]
            .filter { $0.1 > 0 }
            .map { "\($0.1) \($0.0)\($0.1 == 1 ? "" : "s")" }
            .joined(separator: ", ")

            save(
                kind: kind,
                when: payload.timeStampEnd,
                summary: counts,
                body: payload.jsonRepresentation()
            )
        }
    }

    private func write(metrics payloads: [MXMetricPayload]) {
        for payload in payloads {
            save(
                kind: "daily",
                when: payload.timeStampEnd,
                summary: "Apple’s daily measurements — launch times, hangs, memory, battery",
                body: payload.jsonRepresentation()
            )
        }
    }

    // MARK: - The web half

    /// Something the correction screens threw.
    ///
    /// MetricKit sees native crashes and nothing else, and most of this app is
    /// the web bundle in a web view: the takeoff, the plan, the proposal and the
    /// claim document can every one of them fail with a JavaScript error, show a
    /// blank panel, and be completely invisible to Apple's pipe. `main.tsx`
    /// catches those and posts them here.
    ///
    /// Nothing about the message is trusted. It arrived from a web view, which
    /// is a program, and this writes a file: every field is capped and the file
    /// name is chosen here rather than there.
    func record(webError message: String, at where_: String, stack: String) {
        let body = """
        \(cut(message, to: 2_000))

        Where: \(cut(where_, to: 500))

        \(cut(stack, to: 20_000))
        """
        save(
            kind: "screen",
            when: Date(),
            summary: cut(message.replacingOccurrences(of: "\n", with: " "), to: 160),
            body: Data(body.utf8)
        )
        refresh()
    }

    private func cut(_ text: String, to limit: Int) -> String {
        text.count <= limit ? text : String(text.prefix(limit)) + "…"
    }

    // MARK: - On disk

    private static let stamp: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd-HHmmss"
        // Fixed locale and zone, so a file name means the same thing on a phone
        // in Arizona as it does on one set to Hebrew — the name is an
        // identifier, not something anybody reads a date off.
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter
    }()

    /// Writes one report, first line first.
    ///
    /// The first line is the summary and the rest is the detail, so the list can
    /// be built by reading one line per file rather than parsing every payload
    /// again — and so a report opened in Mail says what it is before somebody
    /// scrolls into a wall of JSON.
    private func save(kind: String, when: Date, summary: String, body: Data) {
        let name = "\(Self.stamp.string(from: when))-\(kind).txt"
        let file = folder.appendingPathComponent(name)
        // Same payload delivered twice — which happens, because `start()` reads
        // the past payloads on every launch and Apple keeps them for a few days.
        // The name is derived from the payload's own end timestamp and kind, so
        // the second copy lands on the first and there is one file, not five.
        let head = "\(summary)\n\nTrueline \(Self.version), \(Self.device), iOS \(UIDevice.current.systemVersion)\n\n"
        var text = Data(head.utf8)
        text.append(body.prefix(Self.biggest))
        try? text.write(to: file, options: .atomic)
    }

    /// Re-reads the folder. Hops to main because `reports` is `@Published` and
    /// MetricKit does not call back on the main thread.
    private func refresh() {
        let found = read()
        if Thread.isMainThread {
            reports = found
        } else {
            DispatchQueue.main.async { self.reports = found }
        }
    }

    private func read() -> [Report] {
        let files = (try? FileManager.default.contentsOfDirectory(
            at: folder,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: [.skipsHiddenFiles]
        )) ?? []

        var found: [Report] = []
        for file in files where file.pathExtension == "txt" {
            // The kind is the last dash-separated piece of the stem, which this
            // file chose when it wrote it.
            let stem = file.deletingPathExtension().lastPathComponent
            guard let kind = stem.split(separator: "-").last.map(String.init) else { continue }
            let when = (try? file.resourceValues(forKeys: [.contentModificationDateKey])
                .contentModificationDate) ?? Date.distantPast
            // One line, not the whole file: a folder of forty reports must not
            // cost forty payloads' worth of reading to draw a list.
            let summary = (try? String(contentsOf: file, encoding: .utf8))?
                .split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false)
                .first
                .map(String.init) ?? ""
            found.append(Report(file: file, kind: kind, when: when, summary: summary))
        }

        found.sort { $0.when > $1.when }
        // Over the cap, the oldest go. Deleted here rather than on a timer, so
        // the folder is trimmed by the same code that knows what order they are
        // in and there is nowhere else for the rule to drift to.
        if found.count > Self.keep {
            for old in found[Self.keep...] { try? FileManager.default.removeItem(at: old.file) }
            found = Array(found[..<Self.keep])
        }
        return found
    }

    /// Everything, as one file to attach.
    ///
    /// One file rather than forty attachments: a mail with forty attachments is
    /// a mail nobody opens, and the reports only make sense read in order
    /// anyway. Returns nil when there is nothing to send, so the caller can say
    /// so rather than sending an empty file.
    func bundleUp() -> URL? {
        let all = read()
        guard !all.isEmpty else { return nil }

        var text = """
        Trueline reports
        \(all.count) report\(all.count == 1 ? "" : "s") from this phone.
        Trueline \(Self.version), \(Self.device), iOS \(UIDevice.current.systemVersion).

        Nothing in this file was sent automatically. It is here because somebody
        tapped Send them.

        """

        for report in all {
            text += "\n\n" + String(repeating: "=", count: 60) + "\n"
            text += "\(report.kind.uppercased())  \(report.when.formatted(date: .abbreviated, time: .shortened))\n"
            text += String(repeating: "=", count: 60) + "\n\n"
            text += (try? String(contentsOf: report.file, encoding: .utf8)) ?? "(unreadable)"
        }

        let out = FileManager.default.temporaryDirectory
            .appendingPathComponent("Trueline-reports-\(Self.stamp.string(from: Date())).txt")
        guard (try? Data(text.utf8).write(to: out, options: .atomic)) != nil else { return nil }
        return out
    }

    /// Throws them all away.
    func clear() {
        for report in read() { try? FileManager.default.removeItem(at: report.file) }
        refresh()
    }

    /// What the web half is handed, so the Business tab can list them.
    ///
    /// Built here rather than in the page because the page has no filesystem —
    /// and shaped as JSON rather than as five parallel arrays, so a renamed
    /// field is a compile-time change on one side and a visible absence on the
    /// other, instead of a list that silently comes out in the wrong order.
    func asJSON() -> Data {
        let iso = ISO8601DateFormatter()
        let rows: [[String: String]] = reports.map { report in
            [
                "name": report.file.lastPathComponent,
                "kind": report.kind,
                "when": iso.string(from: report.when),
                "summary": report.summary,
            ]
        }
        return (try? JSONSerialization.data(withJSONObject: rows, options: [])) ?? Data("[]".utf8)
    }

    // MARK: - Which build this is

    /// Read off the bundle rather than written down here. A version number typed
    /// into two places is a version number that is wrong in one of them, and the
    /// whole value of a report is knowing which build produced it.
    static let version: String = {
        let info = Bundle.main.infoDictionary
        let short = (info?["CFBundleShortVersionString"] as? String) ?? "unversioned"
        let build = (info?["CFBundleVersion"] as? String) ?? "0"
        return "\(short) (\(build))"
    }()

    /// The model identifier — `iPhone15,3` and so on. Which phone, not whose:
    /// LiDAR generation and chip are the two things that actually change how a
    /// scan behaves, and both are in this string.
    static let device: String = {
        var info = utsname()
        uname(&info)
        // `withUnsafeBytes(of:)` by value, and NOT `withUnsafePointer(to: &...)`.
        //
        // The inout form opens an exclusive access to `info.machine` for as long
        // as the closure runs, and the first version of this read
        // `MemoryLayout.size(ofValue: info.machine)` from inside that closure --
        // a second access to the same storage while the first is still open.
        // Xcode, on 2026-08-26: "overlapping accesses to 'info.machine', but
        // modification requires exclusive access". It is a compile error, not a
        // warning, and no grammar check can see it.
        //
        // The by-value overload takes a copy, so there is no access to overlap
        // with and no capacity to work out: the buffer knows its own length.
        let machine = withUnsafeBytes(of: info.machine) { bytes in
            // Up to the first NUL. `utsname.machine` is a fixed 256-byte field
            // and the model identifier is a dozen characters, so the rest is
            // zeroes -- decoding the whole field would give a string with 240
            // NULs on the end of it.
            String(decoding: bytes.prefix { $0 != 0 }, as: UTF8.self)
        }
        return machine.isEmpty ? "unknown iPhone" : machine
    }()
}

/// The mail composer, with the reports already attached.
///
/// `MFMailComposeViewController` and not a `mailto:` URL, for one reason that
/// decides it: a `mailto:` cannot carry an attachment. A link that opens Mail
/// with an empty body and asks somebody to go and find a file in the Files app
/// is a link nobody follows, and the report might as well not exist.
///
/// It needs a mail account set up on the phone. When there is not one,
/// `TroubleShareSheet` below is what gets presented instead — not as a fallback
/// that pretends to be the same thing, but with the address shown on the screen
/// so somebody can send it however they actually send things.
struct MailReports: UIViewControllerRepresentable {
    let file: URL
    /// Called when the composer closes, whichever way it closed.
    let done: () -> Void

    static var canSend: Bool { MFMailComposeViewController.canSendMail() }

    func makeCoordinator() -> Coordinator { Coordinator(done: done) }

    func makeUIViewController(context: Context) -> MFMailComposeViewController {
        let composer = MFMailComposeViewController()
        composer.mailComposeDelegate = context.coordinator
        composer.setToRecipients([Diagnostics.sendTo])
        composer.setSubject("Trueline reports — \(Diagnostics.version), \(Diagnostics.device)")
        composer.setMessageBody(
            """
            The reports are attached.

            If you know what you were doing when it went wrong, one line about it
            is worth more than the whole attachment.
            """,
            isHTML: false
        )
        if let data = try? Data(contentsOf: file) {
            composer.addAttachmentData(data, mimeType: "text/plain", fileName: file.lastPathComponent)
        }
        return composer
    }

    func updateUIViewController(_ controller: MFMailComposeViewController, context: Context) {}

    final class Coordinator: NSObject, MFMailComposeViewControllerDelegate {
        let done: () -> Void

        init(done: @escaping () -> Void) {
            self.done = done
        }

        func mailComposeController(
            _ controller: MFMailComposeViewController,
            didFinishWith result: MFMailComposeResult,
            error: Error?
        ) {
            done()
        }
    }
}

/// The share sheet, for a phone with no mail account on it.
///
/// Its own type rather than the one in `ReviewScreen`: that one is private to
/// the file it is in, and making it internal so this could borrow it would put
/// a type every screen can reach inside a file about reviewing a scan. Two
/// four-line wrappers around `UIActivityViewController` is the cheaper of the
/// two.
struct TroubleShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
