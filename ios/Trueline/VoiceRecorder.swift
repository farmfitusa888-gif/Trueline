import AVFoundation
import Foundation
import Speech

/// Somebody talking at a wall, kept as a recording and written down on the phone.
///
/// ## Why this is native at all
///
/// A damage photograph goes through an `<input type="file" capture>`, because
/// iOS hands a web view the camera through one. It hands it nothing useful for
/// the microphone. `MediaRecorder` inside a `WKWebView` would leave the audio in
/// the web view's own storage — a cache the operating system may reclaim — and
/// it cannot reach `SFSpeechRecognizer` at all. Both are disqualifying:
///
///   * **The recording has to land in the scan's folder.** A scan is a folder,
///     and a folder is what gets AirDropped, copied out of the Files app and
///     brought back in. A recording that lived anywhere else would be the one
///     thing in a job that does not travel with it.
///   * **The transcript has to be free, keyless and offline.** The person using
///     this is standing in an unfinished basement with no signal. On-device
///     speech recognition costs nothing, needs no account and no API key, and
///     nothing said in somebody's house leaves their phone.
///
/// So it is done the way `Draftsman` is done: the page asks, this does it, the
/// answer goes back through `window.trueline`.
///
/// ## The rule the whole file is arranged around
///
/// **The recording is the record.** It is written to disk and reported to the
/// page *before* transcription is attempted, so a recogniser that is missing,
/// refused, or slow costs a transcript and never somebody's own voice. That
/// ordering is not a detail — it is the reason the file is safe to edit the text
/// of afterwards.
///
/// ## What it does when it cannot run
///
/// It says which of three things happened, in a sentence somebody can act on,
/// and never leaves a button that does nothing:
///
///   * **No folder** — the Floor and Business tabs, where no room is open.
///     There is nowhere to put a recording, so the page is never told it can
///     record and no button appears.
///   * **The microphone refused** — the one that has to be recoverable. The
///     sentence names Settings, because that is the only place it can be
///     changed, and every other control on the screen goes on working.
///   * **No transcription** — an older iOS, no on-device model for the language,
///     or speech recognition refused. The recording is kept and the screen says
///     plainly that there is no transcript rather than showing an empty box that
///     looks like a failure.
@MainActor
final class VoiceRecorder {

    /// How a start went. Two answers, because the page draws a different screen
    /// for each and a boolean would throw away the sentence.
    enum Started {
        case running
        case refused(String)
    }

    /// A finished recording, on disk.
    struct Kept {
        /// Inside the scan's own `voice` folder. Chosen here rather than by the
        /// page: this side is what writes the file, and a name the page could
        /// choose would be a name the page could point anywhere.
        let fileName: String
        /// Read off the recorder rather than off a clock the page was running.
        let milliseconds: Int
    }

    /// What came of trying to write it down.
    enum Written {
        case words(String)
        /// Why not, in a sentence. Never an error code: it goes on the screen.
        case cannot(String)
    }

    /// What the app is allowed to record into, so nothing runs longer than this.
    ///
    /// Five minutes is far past any note anybody dictates about a wall, and it
    /// is the backstop for the one failure that has no other end: a phone put in
    /// a pocket with the recorder running. The page's Stop button is the normal
    /// way this ends; this is what happens when there is no page left to press
    /// it.
    static let longest: TimeInterval = 5 * 60

    /// Where recordings live inside a scan's folder. `WebBundle` serves this
    /// same folder back to the page, so a note recorded on the wall panel plays
    /// on the wall panel with no second path and no second permission.
    static let folderName = "voice"

    private var recorder: AVAudioRecorder?
    private var cap: Task<Void, Never>?
    private var writingInto: URL?

    /// Whether this phone can write down what it hears.
    ///
    /// Three things at once, the way `Draftsman.isAvailable` asks its four:
    /// there is a recogniser for the phone's own language, it is available right
    /// now, and it can do the work **on the device**. That last one is not a
    /// nicety — a recogniser without it sends audio to Apple's servers, and
    /// nothing said inside somebody's house is going anywhere off this phone.
    ///
    /// Asked before anybody talks, so the screen can say there will be no
    /// transcript rather than producing that news a minute later, where it reads
    /// as a failure instead of as what the phone is.
    static var canTranscribe: Bool {
        guard let recogniser = SFSpeechRecognizer(locale: Locale.current) else { return false }
        return recogniser.isAvailable && recogniser.supportsOnDeviceRecognition
    }

    /// Starts recording into the scan's own folder.
    ///
    /// Permission is asked here rather than at launch, at the moment somebody
    /// presses Record, which is the only moment the request makes sense to
    /// anybody. A refusal comes back as a sentence and the screen carries on.
    func start(into scan: URL) async -> Started {
        // A second Record while one is running. The page refuses this too; this
        // is the half that cannot be got round by a page.
        if recorder != nil {
            return .refused("Something is already recording. Stop that first.")
        }

        guard await Self.mayListen() else {
            return .refused(
                "ScanToBid is not allowed to use the microphone, so nothing was recorded. "
                + "Settings › ScanToBid › Microphone turns it back on. Everything else on this "
                + "screen works either way."
            )
        }

        let folder = scan.appendingPathComponent(Self.folderName, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        } catch {
            return .refused(
                "There was nowhere to put the recording: \(error.localizedDescription)"
            )
        }

        let session = AVAudioSession.sharedInstance()
        do {
            // `playAndRecord` rather than `record`, because the next thing
            // somebody does is play it back in the web view above. Switching
            // categories between the two would deactivate the session under a
            // player that is already running.
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            try session.setActive(true)
        } catch {
            return .refused(
                "The microphone could not be started: \(error.localizedDescription)"
            )
        }

        let name = Self.nameForNow()
        let file = folder.appendingPathComponent(name)
        // AAC in an m4a. Small enough that a folder of notes does not weigh more
        // than the photographs, and the one format every Apple device, every
        // browser and every messaging app already plays -- which matters,
        // because this folder gets AirDropped to people who do not have the app.
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44_100.0,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ]

        do {
            let made = try AVAudioRecorder(url: file, settings: settings)
            guard made.record() else {
                try? session.setActive(false, options: .notifyOthersOnDeactivation)
                return .refused("The microphone would not start. Nothing was recorded.")
            }
            recorder = made
            writingInto = file
        } catch {
            try? session.setActive(false, options: .notifyOthersOnDeactivation)
            return .refused("The recording could not be started: \(error.localizedDescription)")
        }

        // The backstop. Deliberately a task that calls `stop()` rather than
        // `record(forDuration:)`: a recorder that stops itself needs a delegate
        // to say so, and one stop path is one place for the length of a
        // recording to be read.
        cap = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(Self.longest * 1_000_000_000))
            guard !Task.isCancelled else { return }
            _ = self?.stop()
        }
        return .running
    }

    /// Stops, and says what is on disk.
    ///
    /// Nothing here can fail in a way worth reporting: either there was a
    /// recording, in which case it is now a file, or there was not.
    @discardableResult
    func stop() -> Kept? {
        cap?.cancel()
        cap = nil
        guard let made = recorder, let file = writingInto else { return nil }
        // Read BEFORE stopping. `currentTime` is how long has been recorded and
        // it is only meaningful while the recorder is running; afterwards it is
        // zero, and a note that says 0:00 next to fourteen seconds of audio
        // reads as a broken recording.
        let seconds = made.currentTime
        made.stop()
        recorder = nil
        writingInto = nil
        try? AVAudioSession.sharedInstance().setActive(
            false, options: .notifyOthersOnDeactivation)

        // A file that is not there, or is empty, is not a recording. Saying so
        // beats handing the page a name it will draw a play button for.
        let attributes = try? FileManager.default.attributesOfItem(atPath: file.path)
        let bytes = (attributes?[.size] as? NSNumber)?.intValue ?? 0
        guard bytes > 0 else { return nil }

        return Kept(
            fileName: file.lastPathComponent,
            milliseconds: Int((seconds * 1000).rounded())
        )
    }

    /// Writes down what is in one recording, or says why it could not.
    ///
    /// On the device, always: `requiresOnDeviceRecognition` is set and the
    /// recogniser is refused if it cannot honour it. A contractor's recording of
    /// somebody's kitchen does not leave the phone to become a transcript, and
    /// the alternative -- letting it fall back to Apple's servers when the local
    /// model is missing -- would be a promise this app makes on its own screens
    /// quietly broken.
    func transcribe(_ fileName: String, in scan: URL) async -> Written {
        guard Self.canTranscribe, let recogniser = SFSpeechRecognizer(locale: Locale.current)
        else {
            return .cannot("this phone has no on-device model for its language.")
        }
        guard await Self.mayWriteDown() else {
            return .cannot(
                "ScanToBid is not allowed to use speech recognition. Settings › ScanToBid › "
                + "Speech Recognition turns it back on."
            )
        }

        let file = scan
            .appendingPathComponent(Self.folderName, isDirectory: true)
            .appendingPathComponent(fileName)
        guard FileManager.default.fileExists(atPath: file.path) else {
            return .cannot("the recording could not be read back.")
        }

        let request = SFSpeechURLRecognitionRequest(url: file)
        request.requiresOnDeviceRecognition = true
        // One answer, not a stream of guesses that get better. Nothing here is
        // shown while somebody talks -- the transcription happens after the
        // recording is already safe on disk -- so partial results would be work
        // done for nobody.
        request.shouldReportPartialResults = false

        let written: String? = await withCheckedContinuation { finish in
            let once = Once()
            _ = recogniser.recognitionTask(with: request) { result, error in
                // A checked continuation resumed twice traps the process. The
                // handler is called once for a final result and once for an
                // error, and a cancelled task can produce both -- so the guard
                // is not defensive, it is the difference between a missing
                // transcript and a crash on somebody's phone.
                if let result, result.isFinal {
                    if once.take() { finish.resume(returning: result.bestTranscription.formattedString) }
                    return
                }
                if error != nil {
                    if once.take() { finish.resume(returning: nil) }
                }
            }
        }

        guard let said = written?.trimmingCharacters(in: .whitespacesAndNewlines), !said.isEmpty
        else {
            return .cannot("nothing could be made out of it.")
        }
        return .words(said)
    }

    /* ------------------------------------------------------------ permission */

    /// Whether the microphone may be used, asked the way each iOS asks it.
    ///
    /// Two spellings because Apple moved it: `AVAudioApplication` is iOS 17 and
    /// later, and `AVAudioSession` is what every phone before that has. Both are
    /// written out rather than the older one used everywhere, because the older
    /// one is deprecated and a deprecation is a warning today and a removal
    /// later.
    private static func mayListen() async -> Bool {
        if #available(iOS 17.0, *) {
            return await AVAudioApplication.requestRecordPermission()
        }
        return await withCheckedContinuation { finish in
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                finish.resume(returning: granted)
            }
        }
    }

    /// And whether speech recognition may be used, which is a separate switch in
    /// Settings and a separate refusal on the screen.
    private static func mayWriteDown() async -> Bool {
        let status: SFSpeechRecognizerAuthorizationStatus = await withCheckedContinuation {
            finish in
            SFSpeechRecognizer.requestAuthorization { answer in
                finish.resume(returning: answer)
            }
        }
        return status == .authorized
    }

    /// What to call a recording.
    ///
    /// Letters, digits and dashes only, with the second it was taken in it so a
    /// folder of them sorts into the order they were said. Nothing from the page
    /// goes into it — a name is a place on a disk, and this side is the side
    /// that decides where things are written.
    private static func nameForNow() -> String {
        let second = Int(Date().timeIntervalSince1970)
        let unique = UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(8)
        return "voice-\(second)-\(unique).m4a"
    }
}

/// A gate that opens once.
///
/// Its own type, at file scope, rather than a captured `var` inside the closure
/// it guards: what it protects against is a `CheckedContinuation` resumed twice,
/// which does not return an error — it traps, and takes the app with it. That is
/// worth four lines that say what they are for.
private final class Once {
    private var taken = false

    func take() -> Bool {
        if taken { return false }
        taken = true
        return true
    }
}
