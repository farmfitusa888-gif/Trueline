import { loadProject } from '../../core/src/persist.ts';

/**
 * Getting a room out of this browser, and back into one.
 *
 * ## Why this file exists at all
 *
 * On a phone the room never has to travel: the app writes it into the scan's
 * own folder and into the owner's iCloud, and both of those are places it is
 * still there tomorrow. A browser has neither. What a browser has is
 * `localStorage`, which the browser is entitled to take back — see
 * `KEPT_UNTIL` below for the actual rule rather than the folklore — and which
 * belongs to one browser on one machine.
 *
 * So somebody who draws a room in a browser needs two things this app did not
 * have: a way to put the job somewhere that is not a cache, and a way to get a
 * room from the phone into a browser without a server standing in the middle.
 *
 * ## The two shapes, and why they are one file
 *
 * **A file.** `persist.ts` already writes the whole job as one string —
 * measurements, scope, prices, the proposal, what was signed. Saving that
 * string to disk and reading it back is the durable copy, and until this file
 * existed the app could do neither. Handed its own saved job through the file
 * picker it said *"The scan has no walls."*, which is a wrong sentence about a
 * perfectly good file.
 *
 * **A link.** The same string, deflated and written into a URL's **fragment**.
 * The fragment is the one part of a URL a browser never puts on the wire: it is
 * not in the request line, it is not in `Referer`, and a static host never sees
 * it. So a room can be sent from a phone to a laptop through a text message
 * without any server anywhere holding a customer's house.
 *
 * They are one file because they are one problem — a room leaving this browser
 * — and because the rules about what may leave are the same rules for both.
 *
 * ## What a link refuses, and why refusing is the feature
 *
 * A link that half-works is worse than no link. Three refusals, in this order,
 * each with the reason in it:
 *
 * 1. **A picture inside the job.** A signature is stored as a `data:` image, so
 *    a signed job carries real image bytes. Those bytes would go into the URL,
 *    and the URL would go into somebody's message history.
 * 2. **Too long.** Measured, not guessed — see `LINK_LIMIT`.
 * 3. **Photographs.** Their bytes are not in the job: the model carries a
 *    photograph's *name* and the file lives in the scan's folder or in this
 *    browser's own picture store. A link would arrive with every picture
 *    missing and nothing on screen to say why.
 */

export class RoomLinkError extends Error {}

/**
 * The longest link this will make, in characters, counting the whole URL.
 *
 * ## What is measured, and what is judgement
 *
 * **Measured.** Chromium 141.0.7390.37 was driven to a real navigation with
 * fragments of growing length until one stopped arriving whole, and the
 * boundary is exact: a URL of **2,097,152 characters** — 2 MiB — round-trips,
 * and 2,097,153 does not. That is the browser's own ceiling and nothing this
 * app can produce comes near it. Measured the same day: a corrected garage
 * makes a payload of **1,168** characters, Sam's nine-wall dining and living
 * room **3,764**, and the same room walked with 54 photographs **8,808**.
 *
 * **Judgement.** 8,000 is not measured and this comment will not pretend it is.
 * The browser is not what breaks a long link — a person is, and so is whatever
 * app the link is pasted into on the way. What could not be measured from the
 * machine this was written on is what a text message or a mail client will
 * carry intact, so no number is claimed for that.
 *
 * 8,000 is where those two facts meet: every room measured here that has no
 * photographs in it fits inside it twice over, and the one that does not fit is
 * a room with 54 photographs — which is a room that should be sent as a file
 * anyway, because a link was never going to carry the pictures.
 */
export const LINK_LIMIT = 8000;

/** What the fragment is called, so nothing else has to know the spelling. */
export const LINK_KEY = 'room=';

/**
 * How long a browser is obliged to keep what this app writes: not at all.
 *
 * The sentence on screen comes from here rather than from memory, because the
 * rule is specific and getting it slightly wrong is how a promise becomes a
 * lie. Two separate mechanisms, both real, neither of them a guess:
 *
 * - **Safari and every browser on iOS**, since Safari 13.1 and iOS 13.4, delete
 *   *all* of a site's script-written storage — `localStorage`, `sessionStorage`,
 *   IndexedDB, service workers — after **seven days of Safari use** in which
 *   nobody interacted with that site. It is part of Intelligent Tracking
 *   Prevention and it is not an error condition: it is the documented policy.
 * - **Every browser** may evict a site's storage under storage pressure, taking
 *   the least recently used origin first. Storage is "best-effort" by default;
 *   an origin is exempt only once its mode is persistent, which is granted by
 *   the browser on its own criteria and cannot be relied on.
 *
 * So "it is in this browser" is a true statement about today and no statement at
 * all about next month. Hence `KeepACopy` in `Welcome.tsx`, and hence this file.
 */
export const KEPT_UNTIL = {
  /** Days of Safari use with no interaction, after which the storage is gone. */
  safariDays: 7,
} as const;

/* ========================================================================== */
/*  The file                                                                  */
/* ========================================================================== */

/**
 * Whether this text is a job this app saved, rather than a scan.
 *
 * Asked by trying to load it, which is the only honest test: `loadProject`
 * checks the format version and runs the room through `validate()`, so anything
 * that gets past it is a job this build can actually open. A cheaper sniff on a
 * key name would say yes to a file from a version that cannot be read, and the
 * screen would then fail somewhere further in with a worse message.
 */
export function isJobFile(text: string): boolean {
  try {
    loadProject(text);
    return true;
  } catch {
    return false;
  }
}

/** What to call the saved job, from the name the room is filed under. */
export function jobFileName(fileName: string): string {
  const stem = fileName.replace(/\.json$/i, '').replace(/[^\w \-.]/g, '').trim();
  return `${stem === '' ? 'room' : stem} job.json`;
}

/**
 * Writes the job to a file on this device.
 *
 * A plain download rather than `sendFile` from `sheet.ts`, and the difference
 * matters: `sendFile` writes a handover note, because everything that goes
 * through it is a document going to somebody else and the record of that is
 * evidence. This is a person keeping a copy of their own work. Recording it as
 * a sending would put a line in the handover history that never happened.
 *
 * Returns the name it was saved as, so the screen can say it rather than
 * claiming something it did not check.
 */
export function saveJobFile(project: string, fileName: string): string {
  const name = jobFileName(fileName);
  const url = URL.createObjectURL(new Blob([project], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
  return name;
}

/* ========================================================================== */
/*  The link                                                                  */
/* ========================================================================== */

/** Base64url — the URL-safe alphabet, and no padding, so nothing needs escaping. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  // In chunks, because `String.fromCharCode(...bytes)` on a long room is an
  // argument list long enough to overflow the call stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Deflate, where the browser has it, and plain bytes where it does not.
 *
 * Both are real paths and the payload says which one it is, because a reader
 * that guessed would be a reader that silently produced rubbish. `deflate-raw`
 * is in every browser this app targets; the plain path is what an older one
 * gets, and it is not a stub — it produces a working link, just a longer one,
 * and `LINK_LIMIT` judges it the same way.
 */
async function squeeze(text: string): Promise<{ mark: string; bytes: Uint8Array }> {
  const raw = new TextEncoder().encode(text);
  const Compression = (globalThis as { CompressionStream?: typeof CompressionStream })
    .CompressionStream;
  if (!Compression) return { mark: '0', bytes: raw };
  const packed = await new Response(
    new Blob([raw as BlobPart]).stream().pipeThrough(new Compression('deflate-raw'))
  ).arrayBuffer();
  return { mark: '1', bytes: new Uint8Array(packed) };
}

async function unsqueeze(mark: string, bytes: Uint8Array): Promise<string> {
  if (mark === '0') return new TextDecoder().decode(bytes);
  if (mark !== '1') {
    throw new RoomLinkError(
      `This link was made by a newer version of Trueline than this one — it is marked "${mark}" ` +
        'and this build only reads 0 and 1. Ask for the job file instead.'
    );
  }
  const Decompression = (globalThis as { DecompressionStream?: typeof DecompressionStream })
    .DecompressionStream;
  if (!Decompression) {
    throw new RoomLinkError(
      'This link is packed, and this browser cannot unpack it. Open it in an up-to-date ' +
        'Safari, Chrome or Firefox, or ask for the job file instead.'
    );
  }
  const out = await new Response(
    new Blob([bytes as BlobPart]).stream().pipeThrough(new Decompression('deflate-raw'))
  ).arrayBuffer();
  return new TextDecoder().decode(out);
}

/** How many photographs are in this job, of either kind. */
export function photographsIn(project: string): number {
  try {
    const extras = (JSON.parse(project) as { extras?: Record<string, unknown> }).extras ?? {};
    const scan = Array.isArray(extras.photos) ? extras.photos.length : 0;
    const damages = Array.isArray(extras.damages) ? extras.damages : [];
    const marked = damages.reduce(
      (total: number, one: unknown) =>
        total + (Array.isArray((one as { photos?: unknown[] }).photos)
          ? (one as { photos: unknown[] }).photos.length
          : 0),
      0
    );
    return scan + marked;
  } catch {
    // A job this cannot read is a job `roomLink` is about to refuse anyway.
    return 0;
  }
}

/**
 * The room, inside a link.
 *
 * `base` is where the app is served from — `location.origin + location.pathname`
 * — and is passed in rather than read here so this can be checked against a
 * length without a browser being involved in deciding it.
 *
 * Throws `RoomLinkError` with a sentence a person can act on. It never returns
 * a link it is unsure about: a link that opens a room with the pictures missing
 * is the failure this refuses to ship.
 */
export async function roomLink(project: string, base: string): Promise<string> {
  if (project.includes('data:image/')) {
    throw new RoomLinkError(
      'This job has a picture inside it — a signature is stored as one. A link would carry ' +
        'those bytes into somebody’s message history, and it would be too long to send. ' +
        'Save the job file and send that instead.'
    );
  }

  const { mark, bytes } = await squeeze(project);
  const link = `${base}#${LINK_KEY}${mark}.${toBase64Url(bytes)}`;

  if (link.length > LINK_LIMIT) {
    throw new RoomLinkError(
      `This room makes a link ${link.length.toLocaleString()} characters long, and ${LINK_LIMIT.toLocaleString()} ` +
        'is as far as this will go — past that a link stops being something anybody can paste ' +
        'into a message. Save the job file and send that instead.'
    );
  }

  const pictures = photographsIn(project);
  if (pictures > 0) {
    throw new RoomLinkError(
      `This room has ${pictures} photograph${pictures === 1 ? '' : 's'} in it. The job carries ` +
        'what each one is called and never its bytes — the picture itself is in the scan’s own ' +
        'folder, or in this browser’s picture store. A link cannot take those, so it would open ' +
        'a room with every photograph missing and nothing on screen to say why. Save the job ' +
        'file and send that instead.'
    );
  }

  return link;
}

/** A room that arrived in a link, and whether it had to be renamed to land. */
export interface Arrived {
  readonly project: string;
  /**
   * What it was called in the link, when a room of that name was already here.
   *
   * A job is filed under its name, and `persist` writes to that name on the
   * next keystroke. Opening a link onto a name this browser already holds would
   * quietly overwrite somebody else's room with somebody else's house. So the
   * arriving one is given a name of its own and the screen says so — the one
   * thing that must never happen here is the silent version.
   */
  readonly renamedFrom: string | null;
}

/**
 * The room out of a link, or nothing when the link carries no room.
 *
 * `taken` answers whether a name is already filed in this browser, so the
 * renaming can be checked without a `localStorage` to check against.
 */
export async function roomFromLink(
  hash: string,
  taken: (fileName: string) => boolean
): Promise<Arrived | null> {
  const at = hash.indexOf(LINK_KEY);
  if (at === -1) return null;
  const payload = hash.slice(at + LINK_KEY.length);
  const dot = payload.indexOf('.');
  if (dot === -1) {
    throw new RoomLinkError(
      'This link has a room in it that got cut short on the way — there is no version mark on ' +
        'it. Whatever carried it truncated it. Ask for the job file instead.'
    );
  }

  let text: string;
  try {
    text = await unsqueeze(payload.slice(0, dot), fromBase64Url(payload.slice(dot + 1)));
  } catch (error) {
    if (error instanceof RoomLinkError) throw error;
    throw new RoomLinkError(
      'This link has a room in it and it did not survive the journey — it is cut short or has ' +
        'been altered. Ask whoever sent it for the job file instead.'
    );
  }

  // Refused here as well as at `openSaved`, so the message is about the link
  // rather than about a file nobody chose.
  if (!isJobFile(text)) {
    throw new RoomLinkError(
      'This link carries something this build of Trueline cannot read as a room. It may have ' +
        'been made by a newer version. Ask for the job file instead.'
    );
  }

  const saved = JSON.parse(text) as { fileName?: unknown };
  const came = typeof saved.fileName === 'string' ? saved.fileName : '';
  if (came === '' || !taken(came)) return { project: text, renamedFrom: null };

  // A name of its own. Numbered rather than timestamped so two links from the
  // same room read as what they are — the same room, twice.
  let n = 2;
  const stem = came.replace(/\.json$/i, '');
  let fresh = `${stem} (${n}).json`;
  while (taken(fresh)) {
    n += 1;
    fresh = `${stem} (${n}).json`;
  }
  return { project: JSON.stringify({ ...saved, fileName: fresh }), renamedFrom: came };
}

/* ========================================================================== */
/*  Whether the work is anywhere but here                                     */
/* ========================================================================== */

/**
 * What this browser answered when asked to keep the storage.
 *
 * Three answers and not two, because "there is no such thing here" and "I said
 * no" are different facts about a person's machine and telling somebody the
 * wrong one of them is telling them something false.
 */
export type Persistence = 'granted' | 'refused' | 'unavailable';

/**
 * Asks the browser to stop treating this site's storage as disposable.
 *
 * `navigator.storage.persist()` is the only lever there is, and it is a
 * request: the browser decides on its own criteria and returns what it decided.
 * Chromium grants it off signals like a bookmark or an installed app; WebKit
 * grants it to an installed web app. Nothing here can make it say yes.
 *
 * Whatever it says is what the screen says. A "granted" printed without asking,
 * or an answer quietly swallowed, is exactly the failure `SaveTrouble` exists to
 * stop one level down: a person believing their work is somewhere it is not.
 *
 * And "granted" is still not a guarantee. WebKit's own description of the
 * storage policy is that eviction is skipped for a persistent origin — it is a
 * rule the browser keeps, not a promise the site holds, and it can change. So
 * even the good answer is reported as *what the browser said*, and the file is
 * still asked for.
 */
export async function askToKeep(): Promise<Persistence> {
  try {
    const store = navigator.storage as StorageManager | undefined;
    if (!store || typeof store.persist !== 'function') return 'unavailable';
    if (typeof store.persisted === 'function' && (await store.persisted())) return 'granted';
    return (await store.persist()) ? 'granted' : 'refused';
  } catch {
    // A browser that throws on being asked is a browser that has not granted
    // anything, and saying "unavailable" is the true statement about it.
    return 'unavailable';
  }
}

/** Where the record of the last file copy is filed, per room. */
const COPY_PREFIX = 'trueline.jobfile.v1:';

/**
 * A cheap fingerprint of a job, ignoring when it was written down.
 *
 * `savedAt` moves on every keystroke, so comparing the whole text would call a
 * job changed when nothing about it changed. What is wanted is whether the
 * *work* is different from the work in the file, and that is everything except
 * the clock.
 *
 * It is not a checksum against tampering and it is not used as one — it decides
 * whether to nag. A 32-bit rolling hash beside the length is more than enough
 * for that, and it costs nothing on a keystroke.
 */
export function markOf(project: string): string {
  let text = project;
  try {
    const { savedAt: _dropped, ...rest } = JSON.parse(project) as Record<string, unknown>;
    text = JSON.stringify(rest);
  } catch {
    // Unparseable: fingerprint it whole rather than not at all.
  }
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length}.${(hash >>> 0).toString(36)}`;
}

/** When a job was last written to a file, and what was in it. */
export interface FileCopy {
  readonly at: string;
  readonly mark: string;
}

export function lastFileCopy(fileName: string): FileCopy | null {
  try {
    const text = window.localStorage.getItem(COPY_PREFIX + fileName);
    if (text === null) return null;
    const copy = JSON.parse(text) as Partial<FileCopy>;
    if (typeof copy.at !== 'string' || typeof copy.mark !== 'string') return null;
    return { at: copy.at, mark: copy.mark };
  } catch {
    return null;
  }
}

/**
 * Whoever is showing where the work is when a file gets written.
 *
 * ## The bug this is the answer to
 *
 * `KeepACopy` is on the screen twice — loud above the room while there is work
 * in no file, quiet below it once there is not — and only one of the two draws
 * at a time. Writing the file happens in whichever one the button was pressed
 * in, and React re-renders **that** one: the other goes on believing what it
 * believed a moment ago, so the loud one vanished and the quiet one never
 * appeared. Measured: no panel on the screen at all after saving.
 *
 * It is the same shape as `onUnlockChanged` above and for the same reason. A
 * fact kept in `localStorage` and read during render is a fact nothing is
 * subscribed to.
 */
const copyListeners = new Set<() => void>();

export function onFileCopied(listen: () => void): () => void {
  copyListeners.add(listen);
  return () => copyListeners.delete(listen);
}

export function noteFileCopy(fileName: string, project: string, at: string): void {
  try {
    window.localStorage.setItem(
      COPY_PREFIX + fileName,
      JSON.stringify({ at, mark: markOf(project) })
    );
  } catch {
    // The record of the copy living in the store that may be cleared is not the
    // hazard it looks like: if that store goes, the room goes with it and there
    // is nothing left for this to be a record of.
  }
  for (const listen of copyListeners) listen();
}

/**
 * What somebody actually put into this job.
 *
 * ## Why this is not "has anything changed"
 *
 * A job's text moves on every keystroke, so a nag driven by change alone fires
 * on a scan that has been opened and nothing else — and a warning that is on
 * screen before there is anything to lose is a warning nobody reads on the day
 * it is right. That is the same rule `a37` states about photograph warnings and
 * the same rule the room limit follows.
 *
 * So this counts work, and work means a person did it: a wall that stopped
 * being scanned because somebody put a tape on it or moved it, a room that was
 * never scanned at all, a scope, prices, a proposal, a claim, damage, a
 * recording, an invoice, a payment. A pristine import has none of these and can
 * be imported again from the file it came from; everything here cannot.
 */
export interface Work {
  /** How many separate things a person put in. Zero means nothing to lose. */
  readonly count: number;
  /** The biggest of them, named, for the sentence on screen. */
  readonly says: string;
}

export function workIn(project: string): Work {
  let saved: {
    room?: { walls?: { length?: { provenance?: { kind?: string } } }[] };
    extras?: Record<string, unknown>;
  };
  try {
    saved = JSON.parse(project) as typeof saved;
  } catch {
    return { count: 0, says: '' };
  }
  const walls = Array.isArray(saved.room?.walls) ? saved.room.walls : [];
  const byHand = walls.filter((w) => {
    const kind = w?.length?.provenance?.kind;
    return kind !== undefined && kind !== 'scanned';
  }).length;
  const extras = saved.extras ?? {};
  const size = (key: string): number => {
    const value = extras[key];
    return Array.isArray(value) ? value.length : 0;
  };

  const parts: string[] = [];
  if (byHand === walls.length && walls.length > 0) {
    parts.push(`a room of ${walls.length} walls that was never scanned`);
  } else if (byHand > 0) {
    parts.push(`${byHand} wall${byHand === 1 ? '' : 's'} you measured yourself`);
  }
  if (extras.scope) parts.push('what is being done to each surface');
  if (extras.proposal) parts.push('a proposal');
  if ((extras.claim as { on?: boolean } | undefined)?.on) parts.push('a claim');
  if (size('damages') > 0) parts.push(`${size('damages')} marked damage`);
  if (size('voice') > 0) parts.push(`${size('voice')} recording${size('voice') === 1 ? '' : 's'}`);
  if (size('overrides') > 0) parts.push('prices you set by hand');
  if (size('invoices') > 0) parts.push(`${size('invoices')} invoice${size('invoices') === 1 ? '' : 's'}`);
  if (size('payments') > 0) parts.push('payments taken');
  if (size('agreedChanges') > 0) parts.push('agreed changes');

  const last = parts.at(-1) ?? '';
  const said =
    parts.length === 0
      ? ''
      : parts.length === 1
        ? last
        : `${parts.slice(0, -1).join(', ')} and ${last}`;
  return { count: parts.length, says: said };
}

/** How long ago, in the words a person would use. Never a bare timestamp. */
export function howLongAgo(then: string, now: Date): string {
  const gap = now.getTime() - new Date(then).getTime();
  if (!Number.isFinite(gap) || gap < 0) return 'just now';
  const minutes = Math.floor(gap / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/* ========================================================================== */
/*  The other thing that has to cross the gap: who has paid                   */
/* ========================================================================== */

/**
 * The unlock code — a courtesy lock, and this file says so in as many words.
 *
 * ## Why it is in this file
 *
 * This module is about what crosses the gap between a phone and a browser with
 * no server in the middle. There are two such things and they have the same
 * shape: **the room**, which travels as a file or as a link, and **the fact
 * that somebody has paid**, which travels as a code. Neither can be looked up,
 * because there is nothing to look it up in — no account, no login, no server,
 * and that is settled.
 *
 * ## What it is, exactly, with nothing dressed up
 *
 * A code is twelve characters and a four-character check derived from them. The
 * derivation is in this file, in a bundle anybody can read. So:
 *
 *   - **A code can be forwarded**, and the browser it is forwarded to will take
 *     it. Nothing here can tell one browser from another.
 *   - **Anybody who wants to make one can work out how**, by reading this.
 *
 * That is not a flaw to be fixed by making it cleverer — a stronger scheme in a
 * page the user's browser downloads is the same thing with more arithmetic in
 * front of it, and it would let the screen imply a guarantee the design cannot
 * keep. What it is for is narrow and worth saying plainly: **a contractor who
 * has paid should not meet a paywall in his own browser**, and a code stops the
 * casual "just open it in Safari" from being the whole product for nothing.
 *
 * The alphabet is Crockford's: no I, L, O or U, so nothing is misread off a
 * phone screen or turned into a different code by being read aloud.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Where the code is kept once it has been accepted. */
const UNLOCK_KEY = 'trueline.unlock.v1';

/** How many characters of body, and how many of check. */
const BODY = 12;
const CHECK = 4;

function scramble(text: string, salt: number): number {
  let hash = 0x811c9dc5 ^ salt;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function inAlphabet(value: number, length: number): string {
  let out = '';
  let left = value;
  for (let i = 0; i < length; i += 1) {
    out = ALPHABET[left % ALPHABET.length] + out;
    left = Math.floor(left / ALPHABET.length);
  }
  return out;
}

/** The check characters for a body. One place, so both halves agree. */
function checkFor(body: string): string {
  // Two rounds with different salts, so the four characters are not simply the
  // low bits of one hash — a body and a body with two characters swapped would
  // otherwise collide far more often than four characters ought to.
  return (
    inAlphabet(scramble(body, 0x5eed), 2) + inAlphabet(scramble(body, 0x1eaf), 2)
  );
}

/**
 * A code for one purchase.
 *
 * `seed` is whatever the phone has that is stable and its own — Apple's
 * original transaction identifier is the obvious one. It is hashed, so nothing
 * about the purchase can be read back out of the code, and the same phone
 * always produces the same code rather than a new one every time it is asked.
 *
 * This is the half the Swift side has to mirror exactly. It is here rather than
 * in `core/src` only because `core/src` is not this session's to write; the
 * arithmetic is deliberately trivial to reimplement — two FNV-1a rounds and a
 * base-32 rendering — and `docs/the-browser-version.md` writes the format out
 * so it can be copied without reading this.
 */
export function makeUnlockCode(seed: string): string {
  let body = '';
  for (let round = 0; body.length < BODY; round += 1) {
    body += inAlphabet(scramble(seed, round), 6);
  }
  body = body.slice(0, BODY);
  return say(body + checkFor(body));
}

/** Grouped in fours, which is how a person reads a code back off a screen. */
function say(raw: string): string {
  return `TL-${(raw.match(/.{1,4}/g) ?? []).join('-')}`;
}

/** Everything that is not a code character, taken out. Paste is forgiving. */
function tidy(text: string): string {
  return text.toUpperCase().replace(/^TL/, '').replace(/[^0-9A-Z]/g, '');
}

export interface CodeVerdict {
  readonly ok: boolean;
  /** Why not, in words for the person who just pasted it. Empty when it is fine. */
  readonly why: string;
}

export function checkUnlockCode(text: string): CodeVerdict {
  const raw = tidy(text);
  if (raw === '') {
    return { ok: false, why: 'There is nothing in the box. Paste the code from the phone — it ' +
      'starts TL- and has sixteen characters after it.' };
  }
  if (raw.length !== BODY + CHECK) {
    return {
      ok: false,
      why:
        `That is ${raw.length} character${raw.length === 1 ? '' : 's'} long and a code is ` +
        `${BODY + CHECK}, not counting the dashes. Something was cut off on the way, or part of ` +
        'the line was left behind when it was copied.',
    };
  }
  if ([...raw].some((c) => !ALPHABET.includes(c))) {
    return {
      ok: false,
      why:
        'There is a character in that which is not in a code. Codes never contain I, L, O or U, ' +
        'because those are the ones that get misread — check for a 1 written as an l, or a 0 ' +
        'written as an O.',
    };
  }
  if (raw.slice(BODY) !== checkFor(raw.slice(0, BODY))) {
    return {
      ok: false,
      why:
        'That is the right shape but it is not a code this app made. Check it against the phone ' +
        'a character at a time — one wrong character is all it takes.',
    };
  }
  return { ok: true, why: '' };
}

/**
 * Whoever needs to know when the answer changes.
 *
 * ## The bug this is the answer to
 *
 * `Gate` in `Locked.tsx` re-renders when `onEntitlement` fires, which is how
 * five screens unlock the moment the app says somebody has paid. In a browser
 * the answer now comes from a code instead — and pasting one changed
 * `localStorage` and told nobody. Measured: the code was accepted, the panel
 * said "This browser is unlocked", and the takeoff went on showing the lock
 * until the page was reloaded. A gate that only opens on a reload is a gate
 * that looks broken.
 *
 * So the code has a channel of its own, and `entitlementStore.ts` joins it to
 * the one the gates already listen on. One notification, one set of listeners.
 */
const unlockListeners = new Set<() => void>();

export function onUnlockChanged(listen: () => void): () => void {
  unlockListeners.add(listen);
  return () => unlockListeners.delete(listen);
}

function sayItChanged(): void {
  for (const listen of unlockListeners) listen();
}

/** Keeps an accepted code, so it is pasted once rather than every visit. */
export function rememberUnlock(text: string): boolean {
  if (!checkUnlockCode(text).ok) return false;
  try {
    window.localStorage.setItem(UNLOCK_KEY, say(tidy(text)));
    sayItChanged();
    return true;
  } catch {
    // A browser that will not keep it is a browser that will ask again. Said on
    // screen rather than swallowed -- see `Welcome.tsx`.
    return false;
  }
}

export function forgetUnlock(): void {
  try {
    window.localStorage.removeItem(UNLOCK_KEY);
  } catch {
    // Nothing to do, and nothing worth saying: the code is not a secret.
  }
  sayItChanged();
}

/** The code this browser is holding, or nothing. */
export function unlockHere(): string | null {
  try {
    return window.localStorage.getItem(UNLOCK_KEY);
  } catch {
    return null;
  }
}

/**
 * Whether this browser has been shown a code that checks out.
 *
 * Read on every ask rather than cached, because the answer changes the moment
 * somebody pastes one and every gate on the screen has to change with it.
 */
export function unlockedByCode(): boolean {
  const kept = unlockHere();
  return kept !== null && checkUnlockCode(kept).ok;
}
