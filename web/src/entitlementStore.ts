/**
 * Whether the person using this has paid, on the web side.
 *
 * The app hands it across at start-up through the bridge. Nothing here asks:
 * StoreKit lives in Swift and a web view has no way to reach it, so this is a
 * value that arrives rather than one that is fetched.
 *
 * ## Three states, not two
 *
 * `unknown` matters as much as the other two. These screens run in three
 * places: inside the iPhone app, in a browser during development, and in a
 * browser somebody opened the client file in. Only the first will ever call
 * `setSubscribed`, and treating silence as "not paid" would put a paywall in
 * front of every developer and every test — while treating it as "paid" would
 * put the whole product behind a door anybody could walk through by opening it
 * in Safari.
 *
 * So silence stays silent, and `insideApp()` decides which way it resolves: in
 * the app, unknown means not yet answered and the screen waits; outside it,
 * there is no store, no purchase and nobody to charge, so everything is open
 * and the gate is the app's job.
 */
import { type Keeping, mayKeepRoom } from '../../core/src/entitlement.ts';
import { insideApp } from './bridge.ts';
import { unlockedByCode } from './roomLink.ts';

type Known = boolean | 'unknown';

let paid: Known = 'unknown';
const listeners = new Set<(paid: Known) => void>();

export function setEntitlement(next: boolean): void {
  if (paid === next) return;
  paid = next;
  for (const listen of listeners) listen(paid);
}

export function entitlement(): Known {
  return paid;
}

/**
 * Whether a paid feature should work right now.
 *
 * ## The hole this closed
 *
 * This used to answer `true` for every browser, on the reasoning that outside
 * the app there is nothing to buy and nobody to charge. That was true while the
 * browser was a development server and a client file. It stopped being true the
 * day the app was published at a public address: scan a room on the phone, open
 * the same screens in Safari, and every paid document was free. Sam saw it
 * first and said so.
 *
 * So the browser is gated on exactly the line the phone draws — `FREE` and
 * `PAID` in `core/src/entitlement.ts`, one list, read by both — and a
 * contractor who already pays says so with a code his phone makes. There is no
 * login here and there never will be: on the phone Apple says who paid, and in
 * a browser the code does.
 *
 * `unlockedByCode` is a **courtesy lock** and says so on the screen it is
 * offered on. A code can be forwarded, and anybody determined to make one can
 * read how in the page they have already downloaded. What it is for is narrow
 * and worth having: a man who has paid must not meet a paywall in his own
 * browser.
 */
export function unlocked(): boolean {
  if (!insideApp()) return unlockedByCode();
  return paid === true;
}

/** Whether the answer is still on its way, so a screen can wait rather than lie. */
export function waiting(): boolean {
  return insideApp() && paid === 'unknown';
}

export function onEntitlement(listen: (paid: Known) => void): () => void {
  listeners.add(listen);
  return () => listeners.delete(listen);
}

/**
 * Whether one more room may be written down in this browser, and why not.
 *
 * The room names are passed in rather than read here on purpose: the code that
 * saves a room already knows what is on this device and under which keys, and a
 * second copy of that knowledge in this file is a second thing to get wrong the
 * day the storage key changes.
 *
 * What this adds is the only part that belongs here — who is asking. Outside
 * the app there is nothing to buy and nobody to charge, so `unlocked()` is true
 * and nothing is ever refused; inside it, the answer is whatever the app said.
 *
 * **This can refuse to keep a NEW room and nothing else.** Re-saving a room
 * that is already on the device always goes through, so a correction made
 * standing in a half-built kitchen is never the thing that hits a paywall. See
 * `mayKeepRoom` in `core/src/entitlement.ts` for the rule and for why it is
 * written the way round it is.
 */
export function mayKeepRoomHere(alreadyKept: readonly string[], fileName: string): Keeping {
  return mayKeepRoom(alreadyKept, fileName, unlocked());
}
