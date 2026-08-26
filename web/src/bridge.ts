import type { Action } from './state.ts';
import { setEntitlement } from './entitlementStore.ts';
import { loadProject } from '../../core/src/persist.ts';
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

export interface TruelineBridge {
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

export function handBack(fileName: string, project: string): void {
  const saved = handler('saved');
  if (!saved) return;
  try {
    saved.postMessage({ fileName, project, version: BRIDGE_VERSION });
  } catch {
    // A web view that will not take the message is one more reason the copy in
    // localStorage still exists. Nothing here is the only copy.
  }
}

declare global {
  interface Window {
    trueline?: TruelineBridge;
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
    if (typeof payload.reports === 'string') {
      openReports(payload.reports);
    }
    if (Array.isArray(payload.rooms) && payload.rooms.length > 0) {
      putRooms(payload.rooms);
    }

    if (typeof payload.saved === 'string' && payload.saved !== '') {
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
