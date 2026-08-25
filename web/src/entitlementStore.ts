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
import { insideApp } from './bridge.ts';

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
 * Outside the app there is nothing to buy and nobody to charge, so nothing is
 * gated: the drawing opened from a client file, and the development server,
 * both show everything. Inside the app, only a `true` from StoreKit opens it.
 */
export function unlocked(): boolean {
  if (!insideApp()) return true;
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
