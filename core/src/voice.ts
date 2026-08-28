import { type Room, RoomError, validate } from './room.ts';
import { surfaceKey, surfacesOf } from './work.ts';

/**
 * What somebody said, standing in front of the wall, and what the phone made of it.
 *
 * ## Why a recording and a transcript, rather than one or the other
 *
 * A contractor in a half-gutted bathroom has a tape in one hand and a phone in
 * the other, and typing is the thing he is least able to do. Talking is free.
 * So the note gets spoken — and then two different things have to be true about
 * it at once:
 *
 *   - **The recording is the record.** It is his voice, on the day, in the room.
 *     Nothing derived from it can contradict it, and six weeks later in an
 *     argument about what was agreed it is the only artefact that settles
 *     anything.
 *   - **The transcript is what makes it usable.** A folder of audio clips is a
 *     folder nobody opens. Text goes on a sheet, into a scope, into a search.
 *
 * Keeping only the audio makes the note unusable; keeping only the text throws
 * away the evidence. So both are kept, side by side, and the transcript is
 * marked as machine-written until a person has touched it.
 *
 * ## Why the transcript is editable, and why that does not weaken the record
 *
 * Speech recognition is trained on ordinary speech, and a remodeler's vocabulary
 * is not ordinary. *Jamb*, *soffit*, *kerf*, *R-13*, *bullnose*, *sill plate* —
 * these are exactly where a recogniser slips, and a claim or a field sheet
 * carrying "gym" where somebody said "jamb" is worse than carrying nothing.
 *
 * So the text can be corrected. The recording cannot: it is a file, written once
 * and never rewritten. Correcting the words changes what is printed and leaves
 * what was said untouched, which is the only arrangement where editing is safe.
 * `Transcript.by` says which of the two anybody is reading.
 *
 * ## What is deliberately not recorded
 *
 * **No confidence number.** `SFSpeechRecognizer` exposes a per-segment
 * confidence, and on an on-device recognition it is very often exactly zero —
 * not because the phone was unsure, but because the on-device path does not
 * fill it in. A field showing "0% confident" on a transcript that is word for
 * word correct is worse than no field, and a number this app cannot vouch for
 * has no business on a document. What is said instead is the thing that is
 * true: a machine wrote this, read it.
 *
 * ## Where the bytes are
 *
 * Not here. This module holds the *name* of the recording in the scan's own
 * folder, the same arrangement `photo.ts` keeps for photographs and for the same
 * reason: a scan is a folder, and a folder is what gets AirDropped, copied out
 * of the Files app, and restored. An audio clip that lived in a web view's cache
 * would be a recording somebody could lose by running low on storage.
 */

export class VoiceError extends RoomError {}

/**
 * Which surface a recording is about, whichever key it was written under.
 *
 * The one reader of both. `surface` is what is written now; `wallId` is what
 * every file saved before 2026-08-28 carries and what a second phone restoring
 * from iCloud will hand back for as long as those files exist.
 *
 * Refuses rather than guesses when a note carries neither. A recording filed
 * against nothing is not a recording about a wall that happens to be unnamed —
 * it is a note nobody can ever find again, and returning `''` for it would
 * quietly file it against a wall called `''`.
 */
export function surfaceOf(note: { readonly surface?: string; readonly wallId?: string }): string {
  const on = note.surface ?? note.wallId;
  if (on === undefined || on === '') {
    throw new VoiceError(
      'This recording does not say which wall or surface it is about, so there is nowhere to ' +
        'put it. It is still on the phone; nothing has been deleted.'
    );
  }
  return on;
}

/**
 * The same recording, about a different surface.
 *
 * Drops `wallId` rather than leaving it beside the new `surface`. Two keys
 * disagreeing about which wall a recording belongs to is exactly the state
 * `surfaceOf` would have to arbitrate for ever, and the arbitration would be
 * invisible: `surface` wins, and the stale key sits in the file looking like an
 * answer.
 */
export function onSurface(note: VoiceNote, surface: string): VoiceNote {
  const { wallId, ...rest } = note;
  void wallId;
  return { ...rest, surface };
}

/**
 * The words, and who is responsible for them.
 *
 * `phone` means the recogniser wrote it and nobody has read it. `person` means
 * somebody has, and what is on the screen is now their sentence. The difference
 * is printed wherever the text is, because a contractor putting a note in front
 * of an adjuster should know which of the two he is signing.
 */
export interface Transcript {
  readonly text: string;
  readonly by: 'phone' | 'person';
  /** When it was written or last corrected. */
  readonly at: string;
}

export interface VoiceNote {
  readonly id: string;
  /**
   * The surface it is about: a wall, or the ceiling, or the floor.
   *
   * ## Why this is not called `wallId`
   *
   * It was, and it stopped being true the day a ceiling could be talked at.
   * `noteBelongs` below has always accepted a surface as readily as a wall —
   * the check is `surfaces.has(note.wallId) || room.walls.some(...)` — so the
   * name was describing one of the two things the field actually held. A
   * contractor recording "this ceiling is stained the whole way along" was
   * filing it under something called a wall id.
   *
   * A field name is not cosmetic here. It is what the next person reads before
   * writing the code that decides which recordings a deleted wall takes with
   * it, and a name that lies about half its values is how that gets written
   * wrong.
   *
   * **This is a migration, not a rename.** Every job file already on a phone
   * carries `wallId` and none of them can be reached to be rewritten, so
   * `surfaceOf` reads either and everything written from now on carries
   * `surface`. The old key stays readable for as long as there are files with
   * it in them, which is for ever. See `readMarkup` in `price.ts`, which is the
   * same shape for the same reason.
   */
  readonly surface?: string;
  /**
   * What it was called before there was a ceiling to talk at.
   *
   * Kept readable, never written. `surfaceOf` is the only thing that should
   * touch it.
   */
  readonly wallId?: string;
  /**
   * The mark it was recorded on, when it was recorded on one.
   *
   * A note with no mark is about the wall itself: "this is the one that is out
   * of plumb at the top". A note with one is about that observation and travels
   * with it, so deleting a mark takes its own recordings and leaves the wall's
   * alone.
   */
  readonly markId?: string;
  /** What the recording is called inside the scan's own `voice` folder. */
  readonly fileName: string;
  readonly recordedAt: string;
  readonly recordedBy: string;
  /**
   * How long it runs, in whole milliseconds.
   *
   * An integer, quantised on the device at the same boundary where every other
   * float coming off Apple's frameworks is quantised. It is a display quantity
   * and nothing but — it labels a play button and it is never a measurement of
   * a building.
   */
  readonly milliseconds: number;
  readonly transcript?: Transcript;
  /**
   * Why there is no transcript, in a sentence somebody can act on.
   *
   * Present only when the phone tried and could not: an older iOS, speech
   * recognition switched off, no on-device model for the language. It is a
   * sentence rather than a code because it goes straight onto the screen, and
   * "the recording is fine, this phone just cannot write it down" is the whole
   * message.
   */
  readonly noTranscript?: string;
}

/**
 * Refuses a note that does not belong to the room it claims to be in.
 *
 * The same discipline the damage model keeps. A recording pointing at a wall
 * that does not exist is a recording nothing will ever show — it is not on the
 * wall panel, it is not on the sheet, and the only sign of it is a file in a
 * folder. Silent loss of somebody's own voice is not an acceptable failure, so
 * it is refused at the door instead.
 */
export function validateVoiceNote(room: Room, note: VoiceNote): void {
  validate(room);
  // A note is about a surface, and most surfaces are walls. The ceiling is the
  // one that is not, and it is where the water stain is -- see `work.ts` for
  // the key, which is the same one that surface's scope, its phone readings and
  // its marks are filed under, so one ceiling has one name everywhere.
  const surfaces = new Set(surfacesOf(room).map(surfaceKey));
  const on = surfaceOf(note);
  if (!surfaces.has(on) && !room.walls.some((wall) => wall.id === on)) {
    throw new VoiceError(`"${room.name}" has no wall or surface called "${on}".`);
  }
  if (note.fileName.trim() === '') {
    throw new VoiceError('That recording has no file name, so nothing could ever play it back.');
  }
  if (!Number.isInteger(note.milliseconds) || note.milliseconds < 0) {
    throw new VoiceError(
      `That recording says it runs ${note.milliseconds} ms, which is not a length of time.`
    );
  }
  if (note.transcript !== undefined && note.transcript.text.trim() === '') {
    throw new VoiceError(
      'A transcript with nothing in it is not a transcript. Leave it off and the recording ' +
        'still stands on its own.'
    );
  }
}

/**
 * The recordings about a wall itself, oldest first.
 *
 * Oldest first on purpose: this is somebody thinking out loud across a visit,
 * and reading it in the order it was said is the only order it makes sense in.
 * Newest-first is right for a list of files and wrong for a train of thought.
 */
export function notesOnWall(
  notes: readonly VoiceNote[],
  wallId: string
): readonly VoiceNote[] {
  return notes
    .filter((note) => surfaceOf(note) === wallId && note.markId === undefined)
    .sort(byWhenSaid);
}

/** The recordings about one mark, oldest first. */
export function notesOnMark(notes: readonly VoiceNote[], markId: string): readonly VoiceNote[] {
  return notes.filter((note) => note.markId === markId).sort(byWhenSaid);
}

function byWhenSaid(a: VoiceNote, b: VoiceNote): number {
  if (a.recordedAt !== b.recordedAt) return a.recordedAt < b.recordedAt ? -1 : 1;
  return a.id.localeCompare(b.id);
}

/**
 * How long it runs, as a person reads a clock: `0:14`, `1:07`.
 *
 * Rounded down to the second, because a button that says a clip is 15 seconds
 * long and then stops at 14 reads as a fault, and rounding the other way is the
 * one direction that can lie about a recording being longer than it is.
 */
export function spokenLength(milliseconds: number): string {
  const whole = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * What one recording says, on a sheet of paper.
 *
 * Three different sentences, because there are three genuinely different
 * situations and printing the same words for all of them would hide the one
 * that matters:
 *
 *   - a transcript somebody has read and corrected — their sentence, printed
 *     plainly;
 *   - a transcript nobody has read — printed, and marked as the phone's;
 *   - a recording with no transcript at all — said out loud, with how long it
 *     runs, so whoever is holding the sheet knows there is something to listen
 *     to rather than assuming the note was never made.
 *
 * The last of those is the reason this is a function and not a field. A blank
 * where a note should be is indistinguishable from no note.
 */
export function whatWasSaid(note: VoiceNote): string {
  if (note.transcript === undefined) {
    return (
      `A ${spokenLength(note.milliseconds)} recording, with no transcript` +
      (note.noTranscript ? ` — ${note.noTranscript}` : '') +
      '. Open the scan to listen to it.'
    );
  }
  return note.transcript.by === 'person'
    ? `"${note.transcript.text}"`
    : `"${note.transcript.text}" (written by the phone, not yet read)`;
}
