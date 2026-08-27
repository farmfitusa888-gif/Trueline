import Foundation

#if canImport(FoundationModels)
import FoundationModels
#endif

/// Sentences, written on the phone, from figures the phone already has.
///
/// ## The rule this is built inside, and it is not negotiable
///
/// From `CLAUDE.md`:
///
/// > **AI is language, never facts and never money.** Facts and figures come
/// > from SQL; a provider orders and phrases them.
///
/// For this app that reads: **a model may never produce a measurement, a
/// quantity, a rate or a total.** Those come out of `core/`, in `bigint`
/// nanometres and cents, and they are what the product is. A model writes the
/// sentences around them and nothing else.
///
/// Which is why every request here is a **fact sheet plus a job**, never a free
/// prompt. The caller hands over lines it has already worked out; the
/// instruction that goes with them is written *here*, in Swift, one per kind of
/// job, and cannot be supplied from outside. That is not tidiness — the
/// correction screens run in a web view, and a web view runs whatever HTML it
/// is given. A channel that let the page send its own instruction would be a
/// channel that let a page send any instruction.
///
/// ## Why Apple's model and nothing else
///
/// `docs/AI.md` has the whole comparison. The short version: it is free, it
/// needs no API key and no account, there is no per-token bill, and **it runs
/// on the phone with no signal** — which matters more here than almost
/// anywhere, because the person using this app is standing in an unfinished
/// basement. Nothing a client said, and no address, leaves the device.
///
/// ## What it does when it cannot run
///
/// Nothing, silently. The model needs Apple Intelligence hardware (A17 Pro, M1
/// or later), iOS 26, the feature switched on, and the model downloaded.
/// `isAvailable` answers all of that at once, and every screen that could offer
/// a draft simply does not offer one when it is false — no greyed button, no
/// "your phone cannot do this". Somebody who cannot have it never learns it
/// exists, which is the only version that does not read as a missing feature.
///
/// `#if canImport(FoundationModels)` so the project still builds on an Xcode
/// without the iOS 26 SDK in it. On that build `isAvailable` is false and every
/// screen is exactly as it was.
@MainActor
final class Draftsman {

    /// What somebody wants written. A closed set, deliberately: each case owns
    /// its instruction below, and there is no case that means "whatever the
    /// caller says".
    enum Job: String {
        /// The one line under an option on a proposal, saying what it covers.
        case scope
        /// The loss description at the top of a claim document.
        case loss
        /// What a mark on the wall says, from somebody talking at a phone.
        case mark
        /// Which column of a supplier's CSV is which.
        case columns

        /// What the model is told to do, and what it is told never to do.
        ///
        /// Every one of these ends the same way, and that repetition is on
        /// purpose: it is the single most important sentence in this file.
        var instruction: String {
            let never = "Use only the figures given. Never invent, change, round or add a "
                + "number, a measurement, a price or a date. If a figure is not in the notes, "
                + "do not mention it. Write plainly, no marketing, no adjectives about quality."

            switch self {
            case .scope:
                return "You are helping a remodelling contractor describe a job to a homeowner. "
                    + "From the notes below, write ONE short paragraph — three sentences at "
                    + "most — saying what the work covers, in the order somebody would do it. "
                    + never
            case .loss:
                return "You are helping a contractor write the loss description on an insurance "
                    + "claim, for an adjuster to read first. From the notes below, write two "
                    + "short paragraphs: what was damaged and where, then what condition it is "
                    + "in. " + never
            case .mark:
                return "A contractor is standing in a damaged room and has just said what is "
                    + "wrong out loud. Turn what they said into ONE clear sentence for a claim "
                    + "document. Keep their own words where you can. " + never
            case .columns:
                return "A contractor is importing a supplier's price list. Below are the "
                    + "column headings from their file and the item names this app prices "
                    + "against. For each app item, answer with the heading that matches it, or "
                    + "the word none. One per line, as `item = heading`. " + never
            }
        }
    }

    /// Whether a draft can be asked for at all, right now, on this phone.
    ///
    /// Four separate things have to be true and this is the one place that asks:
    /// the app was built against an SDK that has the framework, the phone is on
    /// iOS 26, the hardware supports Apple Intelligence, and the model has
    /// finished downloading.
    static var isAvailable: Bool {
        #if canImport(FoundationModels)
        guard #available(iOS 26.0, *) else { return false }
        if case .available = SystemLanguageModel.default.availability { return true }
        return false
        #else
        return false
        #endif
    }

    /// Writes one draft, or returns nothing.
    ///
    /// Nothing is thrown. A model that is busy, unavailable, or refuses is a
    /// screen that offers no draft — never a screen that fails. The box
    /// somebody types in was already there and is still there.
    func draft(_ job: Job, from notes: String) async -> String? {
        #if canImport(FoundationModels)
        guard #available(iOS 26.0, *), Self.isAvailable else { return nil }
        let trimmed = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        // Capped because the on-device model's context is small and because a
        // fact sheet longer than this is a sign something is being sent that is
        // not a fact sheet.
        let facts = String(trimmed.prefix(4000))
        do {
            let session = LanguageModelSession(instructions: job.instruction)
            let answer = try await session.respond(to: facts)
            let written = answer.content.trimmingCharacters(in: .whitespacesAndNewlines)
            return written.isEmpty ? nil : written
        } catch {
            // Guardrails, a busy model, a model that unloaded mid-answer. None
            // of them is worth a message: the person is looking at a box they
            // can type in, which is what they had before.
            return nil
        }
        #else
        _ = job
        _ = notes
        return nil
        #endif
    }
}
