import { type Room, RoomError, validate } from './room.ts';

/**
 * Saving a corrected room, exactly.
 *
 * Somebody spends ten minutes correcting a scan on a tablet in a half-built
 * kitchen, the phone rings, the browser drops the tab, and the work is gone.
 * That is not acceptable for work somebody did standing up with a tape.
 *
 * The hard part is the only part: **every length in this model is a bigint, and
 * `JSON.stringify` throws on one.** Converting them to `Number` would silently
 * make the whole thing approximate, which is the one thing this codebase does
 * not do. So bigints are written as `{"$nm": "3657600000"}` — a tagged decimal
 * string, exact in both directions and obvious in a file somebody opens.
 *
 * The codec is general rather than a hand-written mapper per type, and that is
 * deliberate: a hand-written one silently drops the field somebody forgot to add
 * to it. This one cannot lose a field, and `loadProject` runs the saved room
 * through `validate()` before handing it back, so a payload from an older or
 * corrupted version is refused loudly instead of half-loading.
 */

export class PersistError extends RoomError {}

/**
 * The saved-format version.
 *
 * Bump it whenever the shape of what is saved changes in a way an older file
 * cannot satisfy. A file from a different version is refused, not guessed at —
 * a half-understood room is worse than no room, because a person would trust it.
 */
export const SAVE_FORMAT = 1;

const TAG = '$nm';

interface Tagged {
  readonly [TAG]: string;
}

function isTagged(value: unknown): value is Tagged {
  return typeof value === 'object' && value !== null && TAG in value;
}

/** Exact, in both directions, and readable by a person who opens the file. */
export function encode(value: unknown): string {
  return JSON.stringify(value, (_key, raw: unknown) =>
    typeof raw === 'bigint' ? { [TAG]: raw.toString() } : raw
  );
}

export function decode(text: string): unknown {
  return JSON.parse(text, (_key, raw: unknown) => {
    if (!isTagged(raw)) return raw;
    const digits = raw[TAG];
    if (typeof digits !== 'string' || !/^-?\d+$/.test(digits)) {
      throw new PersistError(`Saved file holds "${String(digits)}" where a length should be.`);
    }
    return BigInt(digits);
  });
}

export interface SavedProject {
  readonly formatVersion: number;
  /** When it was saved, so two tabs open on the same room can be told apart. */
  readonly savedAt: string;
  /** The file the scan came from, for the line at the bottom of the screen. */
  readonly fileName: string;
  readonly room: Room;
  /** Whatever the caller wants kept alongside — the import report, the objects. */
  readonly extras: Record<string, unknown>;
}

export function saveProject(project: Omit<SavedProject, 'formatVersion'>): string {
  validate(project.room);
  return encode({ ...project, formatVersion: SAVE_FORMAT });
}

/**
 * Reads a saved project back, or refuses.
 *
 * Every failure here is somebody's work, so every message says what was wrong
 * with the file rather than what was wrong with the parser.
 */
export function loadProject(text: string): SavedProject {
  let raw: unknown;
  try {
    raw = decode(text);
  } catch (error) {
    throw new PersistError(
      `That saved room could not be read: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (typeof raw !== 'object' || raw === null) {
    throw new PersistError('That saved room is not a room.');
  }
  const project = raw as Partial<SavedProject>;

  if (project.formatVersion !== SAVE_FORMAT) {
    throw new PersistError(
      `That room was saved by a different version of ScanToBid (format ` +
        `${String(project.formatVersion)}, this one reads ${SAVE_FORMAT}). Rather than guess at ` +
        `what changed, it is being refused — open the scan again.`
    );
  }
  if (!project.room) throw new PersistError('That saved file has no room in it.');

  // The real check. A file that parses is not a file that holds a valid room,
  // and a room that fails validation must never reach a screen that would draw
  // dimensions from it.
  validate(project.room);

  return {
    formatVersion: SAVE_FORMAT,
    savedAt: typeof project.savedAt === 'string' ? project.savedAt : '',
    fileName: typeof project.fileName === 'string' ? project.fileName : '',
    room: project.room,
    extras: (project.extras ?? {}) as Record<string, unknown>,
  };
}
