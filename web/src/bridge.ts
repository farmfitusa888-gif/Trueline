import type { Action } from './state.ts';

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

export interface TruelineBridge {
  /**
   * Called by the native scanner when a capture is finished.
   *
   * `room` is `CapturedRoom` as `JSONEncoder` writes it. `photos` is the
   * manifest from `capture.ts`, or omitted when a scan carries none.
   */
  open(room: unknown, photos?: unknown, fileName?: string): void;
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
function handler(name: string): { postMessage(body: unknown): void } | undefined {
  return (
    window as unknown as {
      webkit?: { messageHandlers?: Record<string, { postMessage(body: unknown): void }> };
    }
  ).webkit?.messageHandlers?.[name];
}

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
     * Set by the native app before the page loads, for a capture that is ready
     * at start-up rather than arriving later. Read once and then forgotten.
     */
    truelinePayload?: {
      room?: unknown;
      photos?: unknown;
      trace?: unknown;
      fileName?: string;
      /** A corrected room the app kept. Outranks the capture it came from. */
      saved?: string;
    };
  }
}

export const BRIDGE_VERSION = 1;

/**
 * Wires the hook up, and hands back whatever was already waiting.
 *
 * Returns the payload the app left on the window before the page loaded, if
 * there was one, so a capture handed over at start-up is not missed in the gap
 * between the script running and React mounting.
 */
export function installBridge(dispatch: (action: Action) => void): Window['truelinePayload'] {
  const open = (room: unknown, photos?: unknown, fileName?: string) => {
    dispatch({
      type: 'open',
      json: room,
      photos,
      fileName: fileName ?? 'scan from this device',
      at: new Date().toISOString(),
    });
  };

  const openSaved = (project: string) => {
    dispatch({ type: 'openSaved', project });
  };

  const openTrace = (trace: unknown, fileName?: string) => {
    dispatch({
      type: 'openTrace',
      trace,
      fileName: fileName ?? 'room walked on this device',
      at: new Date().toISOString(),
    });
  };

  window.trueline = { open, openTrace, openSaved, version: BRIDGE_VERSION };

  const waiting = window.truelinePayload;
  delete window.truelinePayload;
  return waiting;
}
