import type { Action } from './state.ts';
import { setEntitlement } from './entitlementStore.ts';
import { loadProject } from '../../core/src/persist.ts';
import { isCorrectionOf } from '../../core/src/import-roomplan.ts';
import { STORAGE_PREFIX } from './state.ts';

/**
 * How the scanner hands a room over.
 *
 * The iOS app is native where it has to be — capture is a native problem — and
 * everything after the scan is these screens, running in a web view inside the
 * same app. One measurement engine, one set of tests, one place a length is
 * formatted. The alternative was writing the model twice in two languages and
 * keeping them in step forever, which is how a small product dies.
 *
 * So the app calls `window.trueline.open(...)` once, with the same
 * `CapturedRoom` JSON Apple's RoomPlan produces and the photo manifest taken
 * alongside it. Nothing is uploaded and nothing is fetched: the payload arrives
 * as an argument.
 *
 * The same page still works with nothing attached to it. A browser with no app
 * around it never sees this hook fire, and the file picker is what opens a scan.
 */

/**
 * Everything the app hands over at start-up.
 *
 * Every field is optional because every one of them is genuinely absent
 * sometimes: the Floor tab has no room, the Business tab has no rooms, a phone
 * that has never crashed has no reports, and a browser has none of it.
 */
export interface HandOver {
  /** The contractor's own details, as `company.ts` writes them. */
  company?: string;
  /** Whether StoreKit says this person has paid. */
  subscribed?: boolean;
  /**
   * The seed this phone's browser unlock code is made from.
   *
   * Not the code — the seed. The arithmetic is `makeUnlockCode` in
   * `roomLink.ts`, one implementation, and the phone hands across the thing it
   * owns rather than reimplementing the hashing in Swift and having the two
   * quietly disagree the day one of them changes.
   *
   * It is Apple's original transaction identifier where there is a purchase,
   * and a UUID the app keeps to itself where there is not. Either way it is
   * hashed before anybody sees it, and nothing about the purchase can be read
   * back out of the code.
   *
   * Absent in a browser, which is the whole point: a browser has no phone to
   * ask and is offered somewhere to paste the answer instead.
   */
  unlockSeed?: string;
  /**
   * Whether this phone can write a sentence for somebody.
   *
   * True only when the app was built against an SDK that has Apple's
   * Foundation Models framework, the phone is on iOS 26, the hardware supports
   * Apple Intelligence and the model has finished downloading — `Draftsman`
   * asks all four at once.
   *
   * A screen offers a draft only when this is true. Not greyed, not explained:
   * absent. Somebody whose phone cannot do it never learns the button exists,
   * which is the only version that does not read as a missing feature.
   */
  draftable?: boolean;
  /**
   * Whether this phone can record somebody talking at a wall.
   *
   * The microphone and a place to put the file — `VoiceRecorder.canRecord` asks
   * both. False in a browser, which has neither a scan folder nor a way to
   * write into one, and false on a screen with no room open.
   */
  recordable?: boolean;
  /**
   * And whether it can write down what it heard, which is a separate question.
   *
   * `SFSpeechRecognizer` needs a recogniser for the phone's language and an
   * on-device model for it. A phone that has one gets a transcript; a phone that
   * does not still records perfectly well and says plainly that there is no
   * transcript — because the recording is the record, and the text is what makes
   * it convenient.
   *
   * Two flags rather than one, because the two failures are genuinely different
   * and collapsing them would either hide a working microphone behind a missing
   * language model, or promise a transcript that never comes.
   */
  transcribes?: boolean;
  /** What has gone wrong on this phone, as `Diagnostics.asJSON` writes it. */
  reports?: string;
  /** Every corrected room on the phone, for the floor. */
  rooms?: readonly string[];
  /** A corrected room. Outranks `trace` and `room` — it is the same room with
   *  somebody's tape readings already in it. */
  saved?: string;
  /** A room walked with AR or traced off a drawing. */
  trace?: unknown;
  /** RoomPlan's own JSON. */
  room?: unknown;
  /** The photo manifest taken alongside a scan. */
  photos?: unknown;
  /** What somebody pointed at while walking. */
  pins?: unknown;
  /** What to call it. */
  fileName?: string;
}

export interface ScanToBidBridge {
  /**
   * Called by the native scanner when a capture is finished.
   *
   * `room` is `CapturedRoom` as `JSONEncoder` writes it. `photos` is the
   * manifest from `capture.ts`, or omitted when a scan carries none. `pins` is
   * what somebody pointed at while walking, as `pins.ts` reads it, and is
   * omitted by the scans -- most of them -- where nothing was marked.
   */
  open(room: unknown, photos?: unknown, fileName?: string, pins?: unknown): void;
  /**
   * Called when the room was walked with AR or traced off a drawing rather than
   * scanned. Different capture, same everything afterwards.
   */
  openTrace(trace: unknown, fileName?: string): void;
  /**
   * Called with a corrected room the app kept from last time.
   *
   * Corrections used to live only in this page's `localStorage`, which is a web
   * view's cache: the operating system may take it back, and it does not travel
   * to a second device. The app now keeps a copy in the scan's own folder and in
   * the owner's iCloud, and hands it straight back here.
   */
  openSaved(project: string): void;
  /** Called with the contractor's profile, when the app is keeping one. */
  openCompany(company: string): void;
  /**
   * Every corrected room the app is holding, for the floor.
   *
   * The floor is built out of rooms in this page's `localStorage`, which only
   * ever held a room somebody had actually opened in a web view. So a phone
   * with six scans on it showed an empty floor until each one had been visited
   * — "the floor/wall (doesn't work)", and it was right.
   *
   * The app has every corrected room on disk already. On the Floor tab it
   * hands them all across, and they are written into the same storage the
   * floor already reads. Nothing here overwrites a room that is newer in the
   * browser than on disk: a correction typed a moment ago and not yet written
   * back must not be undone by the copy it came from.
   */
  putRooms(projects: readonly string[]): number;
  /**
   * Whether this person has paid.
   *
   * Handed in by the app rather than asked for: StoreKit is on the Swift side
   * and a web view cannot reach it. What it unlocks comes from
   * `core/src/entitlement.ts`, which the Swift half is generated from, so the
   * gate is one list rather than two.
   *
   * A browser that is not inside the app never receives this call, which is
   * why the default has to be honest about being unknown rather than being
   * `false` -- see `entitlementStore.ts`.
   */
  setSubscribed(paid: boolean): void;
  /**
   * Every report the app is holding, for the Business screen to list.
   *
   * Handed across rather than read: these screens have no filesystem, and the
   * reports are files in the app's own Documents folder. `Diagnostics.asJSON`
   * builds it; nothing here can produce one.
   */
  openReports(reports: string): void;
  /**
   * Everything the app has to say, in one call.
   *
   * ## Why this exists, and it is not tidiness
   *
   * The app used to make five separate calls on `didFinish`, each guarded like
   * this:
   *
   *     if (window.trueline && window.trueline.setSubscribed) { ... }
   *
   * `open` and `openSaved` had an `else` that parked the payload on
   * `window.truelinePayload` for the page to pick up when it was ready.
   * **`setSubscribed`, `openCompany`, `putRooms` and `openReports` had no
   * `else` at all** — if the page was not ready, they were dropped silently and
   * for good.
   *
   * The bundle is served through a `WKURLSchemeHandler`, and `didFinish` can
   * fire before a module fetched through that handler has run. So on a real
   * phone `setSubscribed` never landed, `waiting()` stayed true forever, and
   * every gated screen — Takeoff, Price, Agreement, Work, Insurance — drew
   * itself as **nothing at all**. Not a paywall, not an error. A blank panel.
   * Which is exactly how it looked to the first person who ever used this app:
   *
   * > "WHAT IS TAKEOFF? WHAT DOES IT DO?"
   * > "AND HOW ARE JOBS COSTED OUT WHEN THERES NO PRICING ANYWHERE?"
   *
   * The pricing was there. It had been there for weeks. It was behind a
   * component returning `null`.
   *
   * So there is one call now, with one fallback, and one function that knows
   * what order to apply things in — used both when the page is ready and when
   * it drains what was parked. Two copies of that order was the bug.
   */
  take(payload: HandOver): void;
  /**
   * One draft, back from the phone.
   *
   * The only call in this contract that the app makes *in answer to* something
   * the page asked, rather than to tell it something. `text` is null when the
   * model was busy, unavailable, or would not answer — an ordinary outcome,
   * not an error.
   */
  drafted(id: string, text: string | null): void;
  /** A barcode the phone read off a shelf tag, or nothing when it was given up on. */
  scanned(id: string, code: string | null): void;
  /**
   * How a recording is going, and how it ended.
   *
   * The second call the app makes in answer to something the page asked, and
   * unlike `drafted` it arrives more than once for one question. Recording is
   * not one act: it starts, it runs for as long as somebody talks, it stops, and
   * only then does the phone try to write down what it heard.
   *
   * So the answers come as they are known — see `VoiceAnswer`. The one that
   * matters most arrives first: **the recording is written to disk and reported
   * before transcription is even attempted**, so a recogniser that hangs, is
   * missing, or refuses cannot take somebody's own voice down with it.
   */
  heard(id: string, answer: VoiceAnswer): void;
  /** Version of this contract, so a mismatched app build can say so. */
  readonly version: 1;
}

/**
 * Handing a corrected room back to the app that scanned it.
 *
 * Corrections live in this page's `localStorage`, which is a web view's data
 * store — the operating system may evict it when the device is short of space,
 * and it goes nowhere near the scan's own folder. So somebody could type twenty
 * tape readings into a room and have the only copy of them be a browser cache
 * inside an app. That is not a place to keep work somebody did standing up with
 * a tape in their hand.
 *
 * So every save is also posted back to the app, which writes it into the scan's
 * folder next to the capture it came from and backs it up. It is a few kilobytes
 * — a corrected garage is about 5.5 kB and a kitchen 8.4 kB, measured — so this
 * costs nothing to do on every keystroke's worth of change.
 *
 * A browser with no app around it has no message handler, and nothing here
 * fails when there is none. The page is the same page either way.
 */

/**
 * A picture of the plan, for the app's own list of scans.
 *
 * The list of scans on the phone showed three folders called "Room 2026-08-24
 * 1819" and left somebody to remember which was the kitchen. This is the
 * drawing, small, so the list shows the room rather than the timestamp. Sent
 * once when a room opens rather than on every keystroke: it is a picture of a
 * room, and a room does not change shape while somebody types.
 */
export function handBackThumbnail(fileName: string, dataUrl: string): void {
  const post = handler('thumbnail');
  if (!post) return;
  try {
    post.postMessage({ fileName, thumbnail: dataUrl, version: BRIDGE_VERSION });
  } catch {
    // A list without a picture is a list. Nothing depends on this.
  }
}

/**
 * The contractor's own details, back to the app that keeps them.
 *
 * A licence number should be typed once in a lifetime, not once per phone, so
 * it goes in the scan folder's neighbour and into iCloud with everything else.
 * Tiny — a few hundred bytes plus whatever a logo weighs.
 */
export function handBackCompany(company: string): void {
  const post = handler('company');
  if (!post) return;
  try {
    post.postMessage({ company, version: BRIDGE_VERSION });
  } catch {
    // The copy in this browser's storage is still there.
  }
}

/**
 * A photograph of the damage, back to the app that can keep it properly.
 *
 * The bytes are in this web view's IndexedDB, which is a cache: the operating
 * system may take it back when the device is short of space, and it does not
 * travel to a second phone. A photograph of a water line six weeks after the
 * wall was closed up cannot be recreated — unlike a measurement, nobody can go
 * back and take it again — so it is the one thing in this app that must not
 * live only in a cache.
 *
 * So every damage photograph is also posted to the app, which writes it into
 * the scan's own folder beside the capture and backs it up to the owner's
 * iCloud. This is the expensive message on the bridge — a couple of hundred
 * kilobytes — so it is sent once, when the picture is taken, and never again.
 *
 * A browser with no app around it has no handler. The picture is still in this
 * device's store and the screen still shows it; what it does not get is a
 * backup, and the claim screen says so rather than implying one.
 */
/**
 * Hands the scheduled days to the app, for the phone's own calendar.
 *
 * Nothing happens outside the app, and that is right rather than a limitation:
 * a browser has no calendar to write to. The `.ics` file is what serves
 * everybody else, including the client.
 */
export function handBackVisits(visits: unknown, company: string): boolean {
  const post = handler('calendar');
  if (!post) return false;
  try {
    post.postMessage({ visits: JSON.stringify(visits), company });
    return true;
  } catch {
    return false;
  }
}

export function handBackDamagePhoto(
  fileName: string,
  photoName: string,
  dataUrl: string
): boolean {
  const post = handler('photo');
  if (!post) return false;
  try {
    post.postMessage({ fileName, photoName, photo: dataUrl, version: BRIDGE_VERSION });
    return true;
  } catch {
    // Then this device's own store is the only copy, and the screen says so.
    return false;
  }
}

/**
 * Something these screens threw, to the app that can keep it.
 *
 * ## Why this exists at all
 *
 * MetricKit — which is what the app subscribes to for crashes — sees native
 * code and nothing else. Most of this product is not native code. The takeoff,
 * the plan, the proposal, the change order and the claim document all run in
 * here, and every one of them can throw, render a blank panel, and be
 * completely invisible to Apple's pipe.
 *
 * `docs/BUSINESS.md` §6 lists being blind as the one risk marked *certain*.
 * This is the half of the fix that MetricKit cannot do.
 *
 * ## What it does not do
 *
 * It does not send anything anywhere. The app writes it to a file on the
 * device, and it leaves only if somebody taps Send them on the Business screen.
 * A browser with no app around it has no handler and nothing here fails — the
 * console still has the error, which is where a browser's errors belong.
 */
export function reportTrouble(error: unknown, where_: string): void {
  const post = handler('trouble');
  if (!post) return;
  const problem = error instanceof Error ? error : new Error(String(error));
  try {
    post.postMessage({
      message: `${problem.name}: ${problem.message}`,
      where: where_,
      stack: problem.stack ?? '(no stack)',
      version: BRIDGE_VERSION,
    });
  } catch {
    // Reporting a failure must never be a second failure. If the channel will
    // not take it, the console still has it and the screen is unaffected.
  }
}

/**
 * Send the reports, or throw them away.
 *
 * Two words and nothing else: the app checks them again on its side. A screen
 * that could name a file to mail would be a screen that could mail any file on
 * the phone, and this one runs whatever HTML it is given.
 *
 * Returns whether there was an app to hear it, so the button can say "not in
 * the app" rather than appearing to work.
 */
export function askAbout(reports: 'send' | 'clear'): boolean {
  const post = handler('trouble');
  if (!post) return false;
  try {
    post.postMessage({ action: reports, version: BRIDGE_VERSION });
    return true;
  } catch {
    return false;
  }
}

/**
 * Asks the app to open the scanner again, for marks only.
 *
 * ## Why a room needs this at all
 *
 * Damage turns up on the second visit — a water line behind a cabinet, a stain
 * that only shows with the lights on. Until now the only way to mark it was to
 * walk the whole room again, which produces a **second room**: a second set of
 * walls, a second folder, and every tape reading typed against the first one
 * left behind on it.
 *
 * So this asks for a marking pass instead. The app runs the same capture
 * session — Mark needs a tracked camera and a ray to cast — and throws the
 * walls away, merging only the pins and photographs into the folder this room
 * is already in. Nothing measured changes, by construction: that path never
 * opens `room.json`.
 *
 * No payload. The app knows which room is open; a screen that could name a
 * folder would be a screen that could name any folder on the phone, and this
 * one runs whatever HTML it is given.
 *
 * Returns whether there was an app to hear it, so the button can be absent in
 * a browser rather than appearing to work.
 */
export function markAgain(): boolean {
  const post = handler('mark');
  if (!post) return false;
  try {
    post.postMessage({ version: BRIDGE_VERSION });
    return true;
  } catch {
    return false;
  }
}

/** Whether this build of the app can open a marking pass. */
export function canMarkAgain(): boolean {
  return handler('mark') !== undefined;
}

/* -------------------------------------------------------------- the skin */

/**
 * Asks the phone to tap the finger that just did something.
 *
 * ## Why the web half needs this at all
 *
 * > "WHEN YOU SELECT THE WALL TO MAKE CHANGES TO … YOU DONT EVEN KNOW THAT YOU
 * >  CLICKED IT."
 *
 * The native half has had haptics since the first capture screen — putting a
 * corner down in `ARMeasureScreen` and marking damage in `ScanScreen` both tap
 * the hand. Everything after the scan is these pages, and they had no way to
 * ask. So the one moment in this app where a thumb is physically covering the
 * thing that changed had the least feedback of anywhere in it.
 *
 * ## Why there is no payload and no style on the wire
 *
 * The app decides what a tap feels like, the same way it decides where a
 * recording is written and what a marking pass captures. A channel that carried
 * its own intensity would be a channel a page could use to buzz a phone in a
 * pocket, and this web view runs whatever HTML it is given. One message, one
 * meaning: *that landed on something*.
 *
 * ## Outside the app
 *
 * A browser has no phone to ask, so there is no handler and this returns
 * `false` having done nothing. It is deliberately not an error and deliberately
 * not something a caller has to guard: a wall on a laptop is picked exactly as
 * well as a wall on a phone, it just does not buzz. The return value is there
 * for a screen that wants to say so, and every current caller ignores it.
 */
export function tapBack(): boolean {
  const post = handler('haptic');
  if (!post) return false;
  try {
    post.postMessage({ version: BRIDGE_VERSION });
    return true;
  } catch {
    // A feeling that did not happen is not a failure worth interrupting a tap
    // for. The wall is still selected and the screen still says so.
    return false;
  }
}

/* --------------------------------- a correction that was not of this room */

/**
 * Whether the room on screen came up because its saved corrections were not
 * its own.
 *
 * Set once, when the app speaks, and read by the screen so it can say so. A
 * capture drawn in place of a correction with nothing said about it is the
 * same silence this whole guard exists to end.
 */
let strayed = false;

const strayListeners = new Set<() => void>();

export function onStrayCorrection(listen: () => void): () => void {
  strayListeners.add(listen);
  return () => strayListeners.delete(listen);
}

/** Whether the corrections in this room's folder belonged to another room. */
export function correctionsWereStrays(): boolean {
  return strayed;
}

/* -------------------------------------------------- the code for a browser */

/**
 * The seed the phone handed across, or nothing.
 *
 * Nothing is the ordinary state: this file runs in a browser as often as it
 * runs in the app, and a browser has no phone to ask. The screen that shows
 * the code draws nothing at all rather than an empty box — somebody looking at
 * `Your business` in a browser is not being told about a code his phone would
 * have made if he had opened it on his phone.
 */
let seed = '';

const seedListeners = new Set<() => void>();

export function onUnlockSeed(listen: () => void): () => void {
  seedListeners.add(listen);
  return () => seedListeners.delete(listen);
}

/** What to make this phone's browser code out of, or nothing. */
export function unlockSeed(): string {
  return seed;
}

/* ------------------------------------------------------------ drafting */

/**
 * Whether the app said it can write a sentence. Set once, when the app speaks.
 */
let canWrite = false;

/** Whoever is showing a screen when the answer arrives. */
const draftListeners = new Set<() => void>();

export function onDraftable(listen: () => void): () => void {
  draftListeners.add(listen);
  return () => draftListeners.delete(listen);
}

/**
 * Whether to offer a draft at all.
 *
 * Two things, both required: an app to ask (`handler`) and a phone that can
 * answer (`canWrite`). A browser has neither and shows nothing extra, which is
 * also what an older phone gets.
 */
export function canDraft(): boolean {
  return canWrite && handler('draft') !== undefined;
}

/** Asks in flight, by id, so an answer can find the question it belongs to. */
const waitingForDraft = new Map<string, (written: string | null) => void>();
let nextDraft = 0;

/**
 * Asks the phone to write one thing, from figures this page already has.
 *
 * ## What may and may not go in `notes`
 *
 * Facts. Lines this page worked out from `core/` — quantities, room names,
 * damage kinds, meter readings. **Never an instruction**: what the model is
 * told to do lives in `Draftsman.Job` on the Swift side, one per job, and
 * cannot be supplied from here. These screens run in a web view, a web view
 * runs whatever HTML it is given, and a channel that carried its own
 * instruction would be a channel that carried any instruction.
 *
 * Resolves to `null` rather than rejecting when there is no app, no model, or
 * the model would not answer. Every caller treats that the same way: the box
 * somebody types in was already there and is still there.
 */
let nextBarcode = 0;
const waitingForBarcode = new Map<string, (code: string | null) => void>();

/**
 * Asks the phone to read the barcode on a shelf tag.
 *
 * ## Why this exists rather than a price feed
 *
 * Sam: *"WHY ARE THERE NO LIVE VENDOR PRICES? HOME DEPOT? FLOOR AND DECOR?
 * JUST PULL THEM LIVE FROM THE SITE."*
 *
 * Checked on 2026-08-28 rather than remembered: **Home Depot publishes no
 * official public API.** What exists is third-party scraping services, which
 * cost money per request, break when the site changes, and hand back the
 * *retail catalogue* price — which is not what a contractor with a Pro account
 * pays, and quoting off it is either giving margin away or charging a client a
 * number he can look up and undercut.
 *
 * The barcode is the honest version of the same wish. He is standing at the
 * shelf anyway; the phone reads the store's own code off the tag exactly, with
 * no typing and nothing to get wrong, and he enters the price he can actually
 * see. It costs nothing, breaks nothing, and the number is his.
 *
 * Resolves to `null` when there is no app, no camera, or nobody scanned
 * anything. Every caller treats that the same way: the box was already there to
 * type into and it still is. A barcode is never a price and never a quantity —
 * it is a name for a thing, and `vendor.ts` files it as `code`.
 */
export function askForBarcode(): Promise<string | null> {
  const post = handler('barcode');
  if (!post) return Promise.resolve(null);
  nextBarcode += 1;
  const id = `barcode-${nextBarcode}`;
  return new Promise((resolve) => {
    // No deadline on the read itself — somebody lining a phone up with a tag on
    // a bottom shelf is not on a clock — but the app must answer eventually,
    // even to say it was cancelled. Two minutes, and then the box is just a box
    // again rather than a control that says "Scanning…" for ever.
    const timer = window.setTimeout(() => {
      if (waitingForBarcode.delete(id)) resolve(null);
    }, 120_000);
    waitingForBarcode.set(id, (code) => {
      window.clearTimeout(timer);
      resolve(code);
    });
    try {
      post.postMessage({ id, version: BRIDGE_VERSION });
    } catch {
      window.clearTimeout(timer);
      waitingForBarcode.delete(id);
      resolve(null);
    }
  });
}

/** Whether this device can read a barcode at all. */
export function canReadBarcodes(): boolean {
  return handler('barcode') !== undefined;
}

export function askForDraft(
  job: 'scope' | 'loss' | 'mark' | 'columns',
  notes: string
): Promise<string | null> {
  const post = handler('draft');
  if (!post || !canWrite) return Promise.resolve(null);
  nextDraft += 1;
  const id = `draft-${nextDraft}`;
  return new Promise((resolve) => {
    // Nothing here waits forever. A model that never answers -- an app killed
    // mid-draft, a build whose Swift half does not know this message -- would
    // otherwise leave a button saying "Writing..." for as long as the page is
    // open.
    const timer = window.setTimeout(() => {
      if (waitingForDraft.delete(id)) resolve(null);
    }, 30_000);
    waitingForDraft.set(id, (written) => {
      window.clearTimeout(timer);
      resolve(written);
    });
    try {
      post.postMessage({ id, job, notes, version: BRIDGE_VERSION });
    } catch {
      window.clearTimeout(timer);
      waitingForDraft.delete(id);
      resolve(null);
    }
  });
}

/* --------------------------------------------------------------- recording */

/**
 * Talking at a wall, and getting back both the recording and the words.
 *
 * ## Why this is native, and shaped like `Draftsman` rather than like the camera
 *
 * A damage photograph goes through an `<input type="file" capture>`, because iOS
 * gives a web view the camera through one. It gives it nothing for the
 * microphone that is any use here: `MediaRecorder` in a `WKWebView` would leave
 * the audio inside the web view, in a store the operating system may reclaim,
 * and it cannot reach `SFSpeechRecognizer` at all. Both of those are
 * disqualifying. The recording has to land in the scan's own folder — the folder
 * that gets AirDropped, copied out of Files and restored — and the transcript
 * has to be free, keyless and offline, which on-device speech recognition is and
 * nothing in a browser is.
 *
 * So it goes the way `Draftsman` goes: the page asks, the Swift side does it,
 * the answer comes back through `window.trueline`.
 *
 * ## Why it answers more than once
 *
 * Drafting is one question and one answer. Recording is four moments: it starts,
 * it runs, it stops, and afterwards the phone tries to write down what it heard.
 * Each of those can fail on its own and each failure means something different
 * to the person holding the phone, so each is reported when it is known rather
 * than collapsed into one late answer.
 *
 * The ordering is the important part. **The file is written and reported before
 * transcription is attempted.** A recogniser that is missing, refused or simply
 * slow can then cost a transcript and never the recording, which is the one
 * thing here that cannot be made again.
 */

export interface Recording {
  /** What it is called in the scan's own `voice` folder. Chosen by the app. */
  readonly fileName: string;
  /** How long it runs, read off the finished file rather than off a timer. */
  readonly milliseconds: number;
}

export interface VoiceAnswer {
  /** The microphone is live. Nothing else is known yet. */
  readonly started?: boolean;
  /**
   * Why there is no recording at all, in a sentence somebody can act on.
   *
   * A refused microphone is the main one, and it must leave a screen that works
   * and says why — never a button that does nothing. So the sentence names the
   * switch to turn back on rather than reporting a status code.
   */
  readonly refused?: string;
  /** The finished recording, on disk, before anything has been transcribed. */
  readonly kept?: Recording;
  /** What the phone heard. */
  readonly transcript?: string;
  /** Or why it wrote nothing, which is not a failure of the recording. */
  readonly noTranscript?: string;
}

/** What the app said this phone can do. Set once, when it speaks. */
let canHear = false;
let canWriteDown = false;

const voiceListeners = new Set<() => void>();

export function onVoiceable(listen: () => void): () => void {
  voiceListeners.add(listen);
  return () => voiceListeners.delete(listen);
}

/**
 * Whether to offer recording at all.
 *
 * Two things, both required, exactly as `canDraft` needs two: an app to ask, and
 * a phone that said yes. A browser has neither and shows nothing extra — no
 * greyed button and no sentence about a feature it cannot have.
 */
export function canRecord(): boolean {
  return canHear && handler('voice') !== undefined;
}

/**
 * And whether a transcript is coming.
 *
 * Asked separately by the screen so it can say, before somebody talks for a
 * minute, that this phone will keep the recording and not write it down. Being
 * told afterwards is worse: it reads as a failure rather than as what the phone
 * is.
 */
export function canTranscribe(): boolean {
  return canRecord() && canWriteDown;
}

/**
 * The one recording in flight, if any.
 *
 * One, not a map by id: there is one microphone. Two recordings at once is not a
 * thing a phone can do, and modelling it as though it were would be inventing a
 * state that cannot exist in order to look general.
 */
let recording: { id: string; hear: (answer: VoiceAnswer) => void; timer: number } | null = null;
let nextRecording = 0;

/** Nothing waits forever, for the same reason `askForDraft` does not. */
const WAITING_TO_START = 8_000;
const WAITING_FOR_WORDS = 90_000;

function stopWaiting(): void {
  if (recording) window.clearTimeout(recording.timer);
  recording = null;
}

function giveUp(after: number, say: VoiceAnswer): number {
  return window.setTimeout(() => {
    const waiting = recording;
    if (!waiting) return;
    stopWaiting();
    waiting.hear(say);
  }, after);
}

/**
 * Asks the app to start recording, and to keep saying how it is going.
 *
 * Returns whether there was an app to ask. The caller uses that to be absent
 * rather than to look broken — the same rule the draft button keeps.
 */
export function startRecording(hear: (answer: VoiceAnswer) => void): boolean {
  const post = handler('voice');
  if (!post || !canRecord()) return false;
  // A second Record tap while one is running. Refused here rather than sent,
  // because the answer would come back on the first recording's id and the
  // screen would show one clip twice.
  if (recording) return false;

  nextRecording += 1;
  const id = `voice-${nextRecording}`;
  recording = {
    id,
    hear,
    timer: giveUp(WAITING_TO_START, {
      refused:
        'The app did not answer. Nothing has been recorded — try again, and if it keeps ' +
        'happening, close ScanToBid and open it back up.',
    }),
  };
  try {
    post.postMessage({ id, action: 'start', version: BRIDGE_VERSION });
    return true;
  } catch {
    stopWaiting();
    return false;
  }
}

/**
 * Asks it to stop.
 *
 * Says nothing about what happens next: the app answers with the finished
 * recording, and then with the words or with the reason there are none.
 */
export function stopRecording(): void {
  const post = handler('voice');
  if (!post || !recording) return;
  try {
    post.postMessage({ id: recording.id, action: 'stop', version: BRIDGE_VERSION });
  } catch {
    const waiting = recording;
    stopWaiting();
    waiting.hear({
      refused: 'The app stopped answering part way through. Nothing was kept.',
    });
  }
}

/**
 * Hands the corrected room to the app, to be written into the scan's own folder
 * and into iCloud.
 *
 * ## Why this returns something now
 *
 * It used to swallow the failure. The catch said the copy in `localStorage`
 * still existed, which is true and is not the point: a web view's store is
 * cleared by the system whenever it feels like it, and the copy in the scan's
 * folder is the one that survives. So a room could be corrected, look saved,
 * and exist nowhere but a cache — and the app said nothing at all.
 *
 * That is the last silent catch on the path between a correction and the
 * phone's disk, and it is the one remaining mechanism that explains a room
 * whose new name never appeared in the list. Sam: **"Stop and say it plainly."**
 *
 * Three outcomes, and only one of them is a failure:
 *
 *   - **No app.** A browser, or the development server. There is nothing to
 *     hand it to, nothing was promised, and `null` says so.
 *   - **Taken.** `null`.
 *   - **Refused.** The app is here and would not take it. A sentence, which the
 *     screen puts in front of the person in red and does not take down until a
 *     save actually goes through.
 *
 * It does not retry. A retry that succeeds quietly on the third go teaches
 * somebody that the red line means nothing, and the thing it is protecting is
 * the only durable copy of a room.
 */
export function handBack(fileName: string, project: string): string | null {
  const saved = handler('saved');
  if (!saved) return null;
  try {
    saved.postMessage({ fileName, project, version: BRIDGE_VERSION });
    return null;
  } catch (error) {
    return error instanceof Error && error.message ? error.message : 'the app gave no reason';
  }
}

declare global {
  interface Window {
    trueline?: ScanToBidBridge;
    /**
     * What the app had to say before this page was ready to hear it.
     *
     * Parked here by the native side when `window.trueline` does not exist
     * yet, and drained by `installBridge` through the same `take` the live
     * call uses. One order, one place.
     */
    truelinePayload?: HandOver;
  }
}

function handler(name: string): { postMessage(body: unknown): void } | undefined {
  return (
    window as unknown as {
      webkit?: { messageHandlers?: Record<string, { postMessage(body: unknown): void }> };
    }
  ).webkit?.messageHandlers?.[name];
}

export const BRIDGE_VERSION = 1;

/** Whoever wants to know when the app hands a profile over. */
const companyListeners = new Set<(company: string) => void>();

/**
 * The last profile the app handed over, kept for a listener that was late.
 *
 * ## The same bug as the blank paid screens, one level down
 *
 * `installBridge` runs in an effect inside `App`. `UnitsProvider` — the one
 * thing that listens for a profile — is `App`'s **parent**, and React runs
 * effects children-first. So the hand-over was always drained before the only
 * subscriber existed, and `openCompany` fired into an empty set.
 *
 * On a phone that had been used before, nothing looked wrong: the profile is
 * also in this web view's `localStorage`, which every tab shares, so the rates
 * were there anyway. It breaks exactly where the hand-over is the *only* copy —
 * a new phone restoring from iCloud, or a web view whose storage the operating
 * system reclaimed. Then a contractor opens a room and his own rates, licence
 * number and insurance are simply gone, and the takeoff prices nothing.
 *
 * That is the identical failure that drew five paid screens as blank
 * rectangles: something handed across before anybody was listening for it.
 * There the fix was one `take` with one fallback. Here it is this — the profile
 * is kept, and a listener that subscribes afterwards is given it immediately,
 * so the order the two effects happen to run in stops mattering.
 */
let lastCompany: string | undefined;

export function onCompany(listen: (company: string) => void): () => void {
  companyListeners.add(listen);
  // Whatever the app already said, said again to whoever just arrived.
  if (lastCompany !== undefined) listen(lastCompany);
  return () => companyListeners.delete(listen);
}

/**
 * Whoever is drawing a floor when the app hands more rooms over.
 *
 * The floor reads storage once, when it mounts. The app's rooms arrive after
 * that -- the hand-over runs when the page has finished loading, by which time
 * React has already asked and been told what was there. Without this the Floor
 * tab would be handed six rooms and go on showing none of them until somebody
 * left the tab and came back.
 */
const roomListeners = new Set<() => void>();

export function onRoomsArrived(listen: () => void): () => void {
  roomListeners.add(listen);
  return () => roomListeners.delete(listen);
}

/** One report the app is holding, as `Diagnostics.asJSON` writes it. */
export interface TroubleReport {
  /** The file name on the device. Shown so a report can be named out loud. */
  name: string;
  /** `crash`, `hang`, `launch`, `cpu`, `disk`, `daily`, or `screen`. */
  kind: string;
  /** ISO 8601, from the app. */
  when: string;
  /** The first line of the report, written to be readable on its own. */
  summary: string;
}

/**
 * Whoever is showing the reports when the app hands them over.
 *
 * Same shape as the profile, and for the same reason: the hand-over runs once
 * the page has finished loading, by which time React has already mounted and
 * asked. Without a listener the Business screen would be handed the list and go
 * on showing none of it until somebody left the tab and came back.
 */
const reportListeners = new Set<(reports: readonly TroubleReport[]) => void>();

export function onReports(
  listen: (reports: readonly TroubleReport[]) => void
): () => void {
  reportListeners.add(listen);
  return () => reportListeners.delete(listen);
}

/**
 * Whether these screens are running inside the app or in a browser.
 *
 * It changes what to offer when there is no room on screen. In a browser the
 * answer is a file picker, because a scan is a file somebody drops on the page.
 * On a phone it is not: there is no filesystem to pick from, and offering one
 * is how somebody whose capture would not open ended up looking at a
 * drag-and-drop box with nothing on the device to drag into it.
 */
export function insideApp(): boolean {
  return handler('saved') !== undefined;
}

/**
 * Writes rooms the app is holding into the storage the floor reads.
 *
 * ## Why this is not a plain overwrite
 *
 * The app's copy of a room is written on every save, so it is normally the same
 * bytes the browser has. Normally is not always: a correction typed thirty
 * seconds ago is in `localStorage` before the app has finished writing it to
 * disk, and on a phone that ran out of room to write, it may never get there.
 * Overwriting unconditionally would take somebody's tape readings back off a
 * room while they were looking at it.
 *
 * So each room is written only when the browser has nothing under that name, or
 * when what the app is holding was saved LATER than what the browser has. A tie
 * leaves the browser's copy alone, because the two are then the same room and
 * writing achieves nothing.
 *
 * Returns how many were actually written, so the caller can say so rather than
 * claim a number it did not check.
 */
export function putRooms(projects: readonly string[]): number {
  let written = 0;
  for (const text of projects) {
    let saved: ReturnType<typeof loadProject>;
    try {
      saved = loadProject(text);
    } catch {
      // A room this build cannot read. Skipped rather than taking the floor
      // down -- the same rule `savedRooms` already keeps for the same reason.
      continue;
    }
    const key = STORAGE_PREFIX + saved.fileName;
    try {
      const here = window.localStorage.getItem(key);
      if (here !== null) {
        let mine = '';
        try {
          mine = loadProject(here).savedAt;
        } catch {
          // Unreadable here and readable there: the app's copy is the better
          // one, so let it through.
        }
        if (mine !== '' && mine >= saved.savedAt) continue;
      }
      window.localStorage.setItem(key, text);
      written += 1;
    } catch {
      // Storage full or refused. The room stays as it was, which is the safe
      // half of this, and the floor shows what it can.
    }
  }
  if (written > 0) for (const listen of roomListeners) listen();
  return written;
}

/**
 * Wires the hook up, and applies whatever the app already said.
 *
 * It used to hand the parked payload back for `App.tsx` to unpack, which meant
 * the order things are applied in lived in two places -- here for the live
 * call, there for the parked one -- and only one of them knew about the
 * profile, the subscription, the reports and the rooms. `take` is now the only
 * one that knows, and both paths go through it.
 */
export function installBridge(dispatch: (action: Action) => void): void {
  const open = (room: unknown, photos?: unknown, fileName?: string, pins?: unknown) => {
    dispatch({
      type: 'open',
      json: room,
      photos,
      pins,
      fileName: fileName ?? 'scan from this device',
      at: new Date().toISOString(),
    });
  };

  const openSaved = (project: string) => {
    dispatch({ type: 'openSaved', project });
  };

  /**
   * Whether the saved room in this payload is a correction of the capture in it.
   *
   * Answers `true` whenever it cannot tell — no capture beside it, a project
   * that will not parse, a capture with no floor in it. A guard that guessed
   * would throw away real work, and real work is the thing it exists to
   * protect. See `isCorrectionOf` in `core/src/import-roomplan.ts`.
   */
  const theSavedRoomBelongsHere = (payload: HandOver): boolean => {
    if (payload.room === undefined || payload.room === null) return true;
    if (typeof payload.saved !== 'string' || payload.saved === '') return true;
    try {
      return isCorrectionOf(loadProject(payload.saved).room, payload.room);
    } catch {
      // A corrected file that will not parse is a different failure, and
      // `openSaved` already says so properly through the reducer.
      return true;
    }
  };

  /**
   * The capture, and a sentence saying its corrections were somebody else's.
   *
   * The stray file is not deleted and not repaired — it is one screen's guess
   * that it does not belong, and a guess does not get to delete a room. It is
   * left on disk, and what changes is which of the two is drawn.
   */
  const openStrayCorrection = (payload: HandOver) => {
    open(payload.room, payload.photos, payload.fileName, payload.pins);
    strayed = true;
    for (const listen of strayListeners) listen();
  };

  // The profile is not part of the room, so it does not go through the reducer.
  // The provider that owns it subscribes here instead.
  const openCompany = (company: string) => {
    lastCompany = company;
    for (const listen of companyListeners) listen(company);
  };

  const openReports = (reports: string) => {
    let rows: TroubleReport[] = [];
    try {
      const parsed: unknown = JSON.parse(reports);
      // Checked rather than cast. This arrives from the app, which is the same
      // side of the wall as this code -- but a list drawn from a shape nobody
      // verified is how one renamed field becomes a screen of `undefined`.
      if (Array.isArray(parsed)) {
        rows = parsed.filter(
          (row): row is TroubleReport =>
            typeof row === 'object' &&
            row !== null &&
            typeof (row as TroubleReport).name === 'string' &&
            typeof (row as TroubleReport).kind === 'string' &&
            typeof (row as TroubleReport).when === 'string' &&
            typeof (row as TroubleReport).summary === 'string'
        );
      }
    } catch {
      // A build whose app half writes something this one cannot read. An empty
      // list is the honest answer; the screen says how many it has either way.
      rows = [];
    }
    for (const listen of reportListeners) listen(rows);
  };

  const openTrace = (trace: unknown, fileName?: string) => {
    dispatch({
      type: 'openTrace',
      trace,
      fileName: fileName ?? 'room walked on this device',
      at: new Date().toISOString(),
    });
  };

  const setSubscribed = (paid: boolean) => {
    setEntitlement(paid === true);
  };

  const scanned = (id: string, code: string | null) => {
    const waiting = waitingForBarcode.get(id);
    if (!waiting) return;
    waitingForBarcode.delete(id);
    // An empty string is not a barcode. It is what a cancelled scan looks like
    // if the far side is careless, and filing it would put an item in the price
    // book under a code of `''`.
    waiting(typeof code === 'string' && code.trim() !== '' ? code.trim() : null);
  };

  const drafted = (id: string, text: string | null) => {
    const waiting = waitingForDraft.get(id);
    if (!waiting) return;
    waitingForDraft.delete(id);
    waiting(typeof text === 'string' && text.trim() !== '' ? text : null);
  };

  /**
   * How the recording is going, and how it ended.
   *
   * Every field is checked rather than trusted, for the same reason
   * `openReports` checks its rows: this comes from the app, which is the same
   * side of the wall — and a screen drawn from a shape nobody verified is how a
   * renamed field becomes a play button pointing at `undefined.m4a`.
   *
   * An answer whose id nobody is waiting on is dropped. That happens for real:
   * somebody leaves the wall panel while the phone is still writing down what
   * they said, and the answer arrives with nothing to tell.
   */
  const heard = (id: string, answer: VoiceAnswer) => {
    const waiting = recording;
    if (!waiting || waiting.id !== id) return;
    if (typeof answer !== 'object' || answer === null) return;

    const refused = typeof answer.refused === 'string' ? answer.refused : undefined;
    const transcript =
      typeof answer.transcript === 'string' && answer.transcript.trim() !== ''
        ? answer.transcript
        : undefined;
    const noTranscript =
      typeof answer.noTranscript === 'string' ? answer.noTranscript : undefined;
    const kept =
      typeof answer.kept === 'object' &&
      answer.kept !== null &&
      typeof answer.kept.fileName === 'string' &&
      answer.kept.fileName !== '' &&
      Number.isFinite(answer.kept.milliseconds)
        ? {
            fileName: answer.kept.fileName,
            // Rounded here, once, at the boundary the app's own float crosses
            // into this model -- the same rule every other quantity coming off
            // a framework obeys.
            milliseconds: Math.max(0, Math.round(answer.kept.milliseconds)),
          }
        : undefined;

    // Anything that ends the conversation clears the wait.
    if (refused !== undefined || transcript !== undefined || noTranscript !== undefined) {
      window.clearTimeout(waiting.timer);
      recording = null;
      waiting.hear({
        ...(refused !== undefined ? { refused } : {}),
        ...(kept !== undefined ? { kept } : {}),
        ...(transcript !== undefined ? { transcript } : {}),
        ...(noTranscript !== undefined ? { noTranscript } : {}),
      });
      return;
    }

    if (kept !== undefined) {
      // The file is on disk. Whatever the recogniser does now, this part is
      // safe -- so the wait that remains is only for words, and it gives up
      // with a sentence rather than leaving a spinner on the screen.
      window.clearTimeout(waiting.timer);
      waiting.timer = giveUp(WAITING_FOR_WORDS, {
        noTranscript: 'the phone did not finish writing it down. The recording is kept.',
      });
      waiting.hear({ kept });
      return;
    }

    if (answer.started === true) {
      // No timer while somebody is talking. How long a person talks is not
      // something this page gets to time out on; the app caps the length of a
      // recording and answers when it does.
      window.clearTimeout(waiting.timer);
      waiting.timer = 0;
      waiting.hear({ started: true });
    }
  };

  /**
   * Everything the app has to say, applied in the one order that is correct.
   *
   * The order is the whole content of this function and every line of it was
   * paid for by a bug:
   *
   * - **The profile first**, so the letterhead is on the drawing the moment it
   *   appears rather than a frame later.
   * - **Then whether anything is paid for**, before the room. A screen that
   *   draws itself locked and unlocks a frame later has shown a paywall to
   *   somebody who has already paid, which is the worst thing this app can do
   *   to the person funding it.
   * - **Then the reports and every room**, both of which write to storage.
   * - **Then the one room being looked at, last**, so it is the one on screen.
   *   A corrected room outranks a walked one outranks a scanned one: they are
   *   the same room with progressively more of somebody's work in it, and
   *   opening the earlier one would throw the later away.
   */
  const take = (payload: HandOver) => {
    if (typeof payload.company === 'string' && payload.company !== '') {
      openCompany(payload.company);
    }
    if (typeof payload.subscribed === 'boolean') {
      setSubscribed(payload.subscribed);
    }
    if (typeof payload.unlockSeed === 'string' && payload.unlockSeed !== '') {
      seed = payload.unlockSeed;
      for (const listen of seedListeners) listen();
    }
    if (typeof payload.draftable === 'boolean') {
      canWrite = payload.draftable;
      for (const listen of draftListeners) listen();
    }
    // Two answers, one listener: a screen asks both questions together, and
    // telling it twice would draw it twice for no reason.
    if (typeof payload.recordable === 'boolean' || typeof payload.transcribes === 'boolean') {
      if (typeof payload.recordable === 'boolean') canHear = payload.recordable;
      if (typeof payload.transcribes === 'boolean') canWriteDown = payload.transcribes;
      for (const listen of voiceListeners) listen();
    }
    if (typeof payload.reports === 'string') {
      openReports(payload.reports);
    }
    if (Array.isArray(payload.rooms) && payload.rooms.length > 0) {
      putRooms(payload.rooms);
    }

    if (typeof payload.saved === 'string' && payload.saved !== '') {
      // A corrected room outranks a capture -- unless it is a correction of
      // some OTHER room, which is a thing that has actually happened on a
      // contractor's phone and looked exactly like a broken scanner.
      //
      // Sam's garage folder held a real capture, six walls and a garage door,
      // and beside it a `corrected.json` holding a four-walled 15-by-11 room he
      // had drawn on a grid two days before. The drawing won, every time, and
      // the garage was never on the screen. `isCorrectionOf` is exact about it:
      // a correction of a capture carries that capture's own identifier, and a
      // room that was drawn or walked cannot be one. See `import-roomplan.ts`.
      //
      // Where there is no capture to compare against, nothing is claimed and
      // this behaves exactly as it always did.
      if (!theSavedRoomBelongsHere(payload)) {
        openStrayCorrection(payload);
        return;
      }
      openSaved(payload.saved);
      return;
    }
    if (payload.trace !== undefined && payload.trace !== null) {
      openTrace(payload.trace, payload.fileName);
      return;
    }
    if (payload.room !== undefined && payload.room !== null) {
      open(payload.room, payload.photos, payload.fileName, payload.pins);
      return;
    }
    // Nothing being looked at -- the Floor and Business tabs, and a browser
    // opened with no capture. Whatever this page had last time is what to
    // show, and `restore` is a no-op when there is nothing.
    dispatch({ type: 'restore' });
  };

  window.trueline = {
    open,
    openTrace,
    openSaved,
    openCompany,
    openReports,
    putRooms,
    setSubscribed,
    drafted,
    scanned,
    heard,
    take,
    version: BRIDGE_VERSION,
  };

  // Whatever the app said before this page could hear it. Through the same
  // `take`, because two copies of that order is what caused the bug it exists
  // to fix.
  const parked = window.truelinePayload;
  delete window.truelinePayload;
  take(parked ?? {});
}
