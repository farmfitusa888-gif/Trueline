import { RoomError } from './room.ts';

/**
 * The record that a document left this phone.
 *
 * ## The gap this closes
 *
 * Nothing in this app wrote down that a document went out. `sheet.ts` built a
 * file, handed it to the phone, and forgot it. Three consequences were already
 * shipped and visible:
 *
 *   - `photo.ts` has to warn in generalities — "a claim document or an archive
 *     that has already gone out keeps the photographs that went with it" —
 *     because it cannot say *three of these are already with the adjuster*. Its
 *     own comment admits why: "it keeps no record of what was sent, to whom, or
 *     when, so it must not pretend it can reach one back."
 *   - A proposal could go out, be signed, and come back, and nothing knew when
 *     it left or which version of it did.
 *   - A contractor could not answer "did I send that estimate?" from the app,
 *     which is a question he is asked on the phone, standing in somebody's
 *     driveway, with the app open.
 *
 * ## Why nothing here says "sent"
 *
 * This is the design decision the whole module turns on, so it is written down
 * rather than left in the naming.
 *
 * The app hands a file to the phone's own share sheet. **After that it is
 * blind.** iOS gives the page back nothing: `navigator.share` resolves with
 * `undefined` whether the person sent a message, saved the file to Files,
 * printed it, or picked an app and then backed out inside it. There is no
 * recipient, no delivery receipt, no read receipt, and `bridge.ts` — every
 * message the native half of this app can send the page — has no channel that
 * would carry one either. Nothing comes back. That is the honest state of it
 * and there is no hopeful field here waiting for it to change.
 *
 * So the word "sent" is refused everywhere a person can read it. In a dispute,
 * "sent 24 August" is a claim about what reached somebody else, and this app
 * cannot stand behind it: the contractor may have opened the share sheet and
 * changed his mind in Messages. A record that overstates is worse than no
 * record, because he would rely on it in the one conversation where it matters.
 *
 * What the app can stand behind, and what this records:
 *
 *   - the document **left this phone** at a stated moment,
 *   - **how** it left — handed to the share sheet, or written to this device,
 *   - **which version** left, by SHA-256 of the exact bytes that went.
 *
 * The one thing the phone does tell us is taken: cancelling out of the share
 * sheet raises `AbortError`, and `sendFile` records nothing in that case. A
 * cancelled share is the app's only honest negative and it is used.
 *
 * ## Why every sending is kept
 *
 * The same document goes out more than once — a proposal re-sent after a price
 * change, a claim re-sent because the adjuster lost it — and the versions
 * differ. Keeping only the last one loses the fact that matters most: the copy
 * somebody is holding may not be the document on this phone. `versionGap` is
 * that check, and it is the same tamper-evidence spine as `signature.ts`: a
 * document has one fingerprint, and it is how you know which one is in
 * somebody's hand.
 *
 * ## What this is not
 *
 * It is not a mail client, a CRM or a delivery tracker, and it must not grow
 * into one. It records a fact about a document at a moment, and nothing else.
 */

export class HandoverError extends RoomError {}

/**
 * How a document left, as far as the app can honestly know.
 *
 * Two values because there are exactly two paths through `sendFile` that end
 * with a file leaving, and they are genuinely different facts. Collapsing them
 * into one would let a screen say the same sentence about a file the contractor
 * saved to his own downloads folder and a file he pushed at the share sheet.
 */
export type HowItLeft =
  /**
   * Handed to the phone's own share sheet. The app knows the sheet took the
   * file. It does not know what the person did with it after that.
   */
  | 'handed'
  /**
   * Written to this device as a file, because there was no share sheet — a
   * desktop browser, or an older web view. Where it went next is off the app.
   */
  | 'saved';

/** One document leaving this phone once. */
export interface Handover {
  /**
   * The file name it left under.
   *
   * This is also the identity of the document across sendings: `fileNameFor`
   * builds it from the room or the claim number and the kind of document, so
   * the same proposal sent twice carries the same name and two different
   * documents on the same job do not.
   */
  readonly document: string;
  /**
   * What the screen called it when it handed it over — "Dining — proposal",
   * "Change order CO-1 — Dining". The contractor's own words rather than a
   * category invented here, so the record reads the way the screen did.
   */
  readonly says: string;
  readonly mediaType: string;
  readonly bytes: number;
  /**
   * SHA-256, lowercase hex, of exactly the bytes that left.
   *
   * Not of the model the file was built from — of the file. It is the only
   * value that answers "is this the copy they are holding", and it answers it
   * about the thing that actually travelled.
   */
  readonly fingerprint: string;
  /** ISO 8601 with the offset. See `handoverTime` for why it is local. */
  readonly at: string;
  readonly how: HowItLeft;
}

export interface HandoverRequest {
  readonly document: string;
  readonly says: string;
  readonly mediaType: string;
  readonly bytes: number;
  readonly fingerprint: string;
  readonly at: string;
  readonly how: HowItLeft;
}

/**
 * How many sendings this keeps.
 *
 * A cap, because the log lives in `localStorage` and an unbounded one
 * eventually refuses a write — and the write it refuses would be the newest
 * record, which is the one somebody is about to ask about. At roughly 300 bytes
 * a record this is under 150 kB, and 500 sendings is years of a contractor's
 * work. The oldest go first and that is a real loss of evidence, which is why
 * the number is high rather than tidy.
 */
export const MOST_KEPT = 500;

const HEX = /^[0-9a-f]{64}$/;

/**
 * ISO 8601 with the offset actually in force on this phone.
 *
 * `toISOString()` would be shorter and it is what the rest of the app uses for
 * times inside the model. This one is different on purpose: it is read by a
 * person, in an argument, about when something left. A contractor in Arizona
 * who handed a proposal over at 19:04 must not find a record saying 02:04 the
 * next day — he will read it as the wrong evening and say so out loud, and the
 * record stops being the thing that settles it. The offset is carried so the
 * instant is still exact and still sortable.
 */
export function handoverTime(when: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  // `getTimezoneOffset` counts minutes *behind* UTC, so its sign is the
  // opposite of the one ISO 8601 prints. Getting this backwards is the classic
  // version of this bug and it is silent for anybody east of Greenwich.
  const behind = when.getTimezoneOffset();
  const ahead = -behind;
  const size = Math.abs(ahead);
  return (
    `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}` +
    `T${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}` +
    `${ahead < 0 ? '-' : '+'}${pad(Math.floor(size / 60))}:${pad(size % 60)}`
  );
}

/**
 * The fingerprint of what actually went, as lowercase hex.
 *
 * `signature.ts` hashes a *document object* through a canonical text form,
 * which is the right thing when what is being sealed is a model. This hashes
 * bytes, because what leaves here is a file — a PDF, a PNG, a zip — and there
 * is no object to canonicalise. Same algorithm, same `crypto.subtle`, so a
 * value from either can be read the same way by anybody checking it.
 *
 * `Uint8Array<ArrayBuffer>` rather than a bare `Uint8Array`: a view onto a
 * `SharedArrayBuffer` is not something `crypto.subtle` will digest, and the
 * bare type admits one. Both callers — a blob read back in the browser, and an
 * encoder in a test — already produce this exact type.
 */
export async function handoverFingerprint(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new HandoverError(
      'This device has no cryptography available, so there is no way to fingerprint the ' +
        'file that went. Nothing was recorded about it.'
    );
  }
  const digest = await subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Writes one sending down, or refuses and says which part is missing.
 *
 * Every refusal here is a refusal to keep a record that would be read as
 * evidence and would not hold. A record with no fingerprint cannot answer the
 * only question worth asking of it; a time with no offset is a time in an
 * unknown zone, which in a dispute is not a time at all.
 */
export function recordHandover(request: HandoverRequest): Handover {
  const document = request.document.trim();
  if (!document) {
    throw new HandoverError(
      'A record of a document going out needs the name it went out under, or it cannot be ' +
        'told from any other document on the job.'
    );
  }
  const says = request.says.trim();
  if (!says) {
    throw new HandoverError(
      'A record of a document going out needs to say what it was, in the words the screen ' +
        'used. A line that cannot say what left is not worth keeping.'
    );
  }
  if (!HEX.test(request.fingerprint)) {
    throw new HandoverError(
      `"${request.fingerprint}" is not a SHA-256 fingerprint. Without one there is no way ` +
        'to tell later whether the copy somebody is holding is this document or another one.'
    );
  }
  if (!Number.isInteger(request.bytes) || request.bytes < 0) {
    throw new HandoverError('The size of the file that went has to be a whole number of bytes.');
  }
  if (Number.isNaN(Date.parse(request.at))) {
    throw new HandoverError(`"${request.at}" is not a time this can record.`);
  }
  // The offset is required, not merely accepted. `Date.parse` is happy with
  // "2026-08-28T14:03:22", and so is every screen that prints it -- and it
  // means a different instant on every phone that reads it back.
  if (!/(?:Z|[+-]\d\d:\d\d)$/.test(request.at)) {
    throw new HandoverError(
      `"${request.at}" carries no time zone, so it does not say when anything happened. ` +
        'Times are written with the offset.'
    );
  }
  if (request.how !== 'handed' && request.how !== 'saved') {
    throw new HandoverError(
      `"${String(request.how)}" is not something this app can say about how a file left.`
    );
  }
  const mediaType = request.mediaType.trim() || 'application/octet-stream';
  return {
    document,
    says,
    mediaType,
    bytes: request.bytes,
    fingerprint: request.fingerprint,
    at: request.at,
    how: request.how,
  };
}

function isHandover(value: unknown): value is Handover {
  if (typeof value !== 'object' || value === null) return false;
  const one = value as Record<string, unknown>;
  return (
    typeof one.document === 'string' &&
    typeof one.says === 'string' &&
    typeof one.mediaType === 'string' &&
    typeof one.bytes === 'number' &&
    typeof one.fingerprint === 'string' &&
    HEX.test(one.fingerprint) &&
    typeof one.at === 'string' &&
    (one.how === 'handed' || one.how === 'saved')
  );
}

/**
 * Reads the log back, or refuses out loud.
 *
 * Refuses rather than dropping what it cannot read, and that is deliberate. A
 * log that quietly skips the records it does not understand answers "did this
 * go out?" with "no" when the truth is "this device cannot tell you" — and
 * those two answers lead a contractor to do opposite things. Nothing here may
 * turn missing evidence into a clean negative.
 *
 * An absent log is not a broken one: a phone that has never sent anything has
 * no record, and that is an empty list rather than a refusal.
 */
export function readHandovers(text: string | null | undefined): readonly Handover[] {
  if (text === null || text === undefined || text.trim() === '') return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new HandoverError(
      'The record of what has gone out from this phone cannot be read. It is not being ' +
        'overwritten, so nothing in it is lost — but nothing on screen can be based on it.'
    );
  }
  if (!Array.isArray(raw)) {
    throw new HandoverError('The record of what has gone out from this phone is not a list.');
  }
  const kept: Handover[] = [];
  for (const [index, one] of raw.entries()) {
    if (!isHandover(one)) {
      throw new HandoverError(
        `Entry ${index + 1} in the record of what has gone out is not a hand-over this ` +
          'version understands, so the record is not being read at all rather than read in part.'
      );
    }
    kept.push({
      document: one.document,
      says: one.says,
      mediaType: one.mediaType,
      bytes: one.bytes,
      fingerprint: one.fingerprint,
      at: one.at,
      how: one.how,
    });
  }
  return kept;
}

/** The log as it is stored. One place writes the format, so one place changes it. */
export function writeHandovers(records: readonly Handover[]): string {
  return JSON.stringify(records);
}

/** The log with one more sending on it, oldest dropped once it is full. */
export function addHandover(
  records: readonly Handover[],
  one: Handover
): readonly Handover[] {
  const all = [...records, one];
  return all.length <= MOST_KEPT ? all : all.slice(all.length - MOST_KEPT);
}

/**
 * Every recorded sending of one document, newest first.
 *
 * Newest first because that is the order the question is asked in: "did I send
 * that estimate?" is about the last time, and everything before it is history.
 * Sorted on the recorded time rather than on the order they were appended, so a
 * log that came back from two devices still reads in the right order.
 */
export function sendingsOf(
  records: readonly Handover[],
  document: string
): readonly Handover[] {
  const wanted = document.trim();
  return records
    .filter((one) => one.document === wanted)
    .map((one, index) => ({ one, index }))
    .sort((a, b) => {
      const gap = Date.parse(b.one.at) - Date.parse(a.one.at);
      // Two sendings in the same second keep the order they were written in,
      // reversed, so "newest first" stays true rather than becoming arbitrary.
      return gap !== 0 ? gap : b.index - a.index;
    })
    .map(({ one }) => one);
}

/**
 * Whether the copy somebody is holding is this document, or an older one.
 *
 * Null when they match, and null when nothing has gone out — there is no gap to
 * report in either case. The sentence is the one thing a screen shows when a
 * price changed after a proposal went out and nobody noticed, which is a real
 * thing that happens on a job and is worth catching before the client does.
 */
export function versionGap(
  records: readonly Handover[],
  document: string,
  fingerprintNow: string
): string | null {
  const last = sendingsOf(records, document)[0];
  if (!last) return null;
  if (last.fingerprint === fingerprintNow) return null;
  return (
    `The copy that left this phone on ${last.at.slice(0, 10)} is not this document. ` +
    'Something in it has changed since, so what they are holding and what is on this ' +
    'phone are two different versions.'
  );
}

/**
 * One sending, written out for a person.
 *
 * Plain sentences for the same reason `describeSignature` is: a record is only
 * worth keeping if it can be produced and understood by somebody who was not
 * there. The last line of a hand-over is the limit of what the app knows, and
 * it is on every one of them rather than in a footnote somebody scrolls past.
 */
export function describeHandover(one: Handover): string[] {
  const said = [
    one.how === 'handed'
      ? `“${one.document}” was handed to this phone to send at ${one.at}.`
      : `“${one.document}” was saved to this device at ${one.at}.`,
    `What went: ${one.says}.`,
    `${one.bytes} bytes, ${one.mediaType}. It fingerprints to ` +
      `${one.fingerprint.slice(0, 16)}… (SHA-256). Any change to it produces a different one.`,
  ];
  said.push(
    one.how === 'handed'
      ? 'The app can say the file was handed over. It cannot say it arrived, who received ' +
          'it, or whether anybody opened it — none of that happens where the app can see it.'
      : 'Where the file went after it was saved is not something the app can see.'
  );
  return said;
}

/**
 * The one line a screen puts under a document.
 *
 * The empty case is the careful one. "Not sent" would be a claim, and a wrong
 * one: the log lives on this device, and a phone in a private window, out of
 * storage, or restored from a backup can have lost it while the document went
 * out perfectly well. So the sentence is about the record, not about the
 * document, and a contractor reading it knows to check rather than to re-send.
 *
 * `fingerprintNow` is null where the screen has not built the current version
 * of the document — the count is still true, and no claim is made about which
 * version is out there.
 */
export function sayHandovers(
  records: readonly Handover[],
  document: string,
  fingerprintNow: string | null
): string {
  const sendings = sendingsOf(records, document);
  const last = sendings[0];
  if (!last) return 'Nothing on this phone records this document leaving it.';
  const when = last.at.slice(0, 10);
  const count =
    sendings.length === 1
      ? `This left this phone once, on ${when}.`
      : `This left this phone ${sendings.length} times, the last on ${when}.`;
  if (fingerprintNow === null) return count;
  const gap = versionGap(records, document, fingerprintNow);
  return gap ? `${count} ${gap}` : `${count} The copy that went is this document.`;
}
