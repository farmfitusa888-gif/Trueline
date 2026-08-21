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
  /** Version of this contract, so a mismatched app build can say so. */
  readonly version: 1;
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

  const openTrace = (trace: unknown, fileName?: string) => {
    dispatch({
      type: 'openTrace',
      trace,
      fileName: fileName ?? 'room walked on this device',
      at: new Date().toISOString(),
    });
  };

  window.trueline = { open, openTrace, version: BRIDGE_VERSION };

  const waiting = window.truelinePayload;
  delete window.truelinePayload;
  return waiting;
}
