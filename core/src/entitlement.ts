/**
 * What is free, what is paid, and the sentence said when something is locked.
 *
 * One list, shared by the Swift that owns the subscription and the web screens
 * that draw the app. A gate implemented twice is a gate that disagrees with
 * itself, and the disagreement is always in the direction of somebody paying
 * for something they already had, or getting something they did not.
 *
 * ## Where the line is, and why
 *
 * **Free measures. Paid sells.**
 *
 * Everything that turns a room into a drawing is free, forever, with no account
 * and no card: scan it, walk it, correct it, look at it in 3D, read its
 * dimensions and its floor area. That is a genuinely useful tape measure and it
 * is meant to be used by people who never pay a penny.
 *
 * Everything that turns a drawing into money is paid: the quantities, the
 * pricing, the proposal, the signature, the change orders, the insurance
 * paperwork and every export.
 *
 * That line is not arbitrary. It is the line a contractor himself would draw:
 * measuring is what he does for nothing while deciding whether to bid, and the
 * proposal is the thing that wins the job. Charging for the first would be
 * charging him to consider you.
 *
 * It is also the line the App Store cares about. Guideline 4.2 rejects an app
 * that is a login wall with no standalone value; an app that measures a room
 * properly and for free is not that, whatever it charges for afterwards.
 *
 * ## Free until launch — and where that switch is NOT
 *
 * Everything is on for everybody until Trueline goes on sale on the App Store.
 * That switch is deliberately **not** in this file. It is one `let` in
 * `ios/Trueline/Subscription.swift` — `Subscription.onSale` — because that is
 * the one place in this app where the question "is this person entitled?" is
 * decided, and the giveaway is an answer to that question rather than a
 * different question. Everything downstream, these screens included, gets the
 * answer handed to it across the bridge and needs to know nothing about why.
 *
 * Putting the switch here as well would have put it in two languages, which is
 * the exact failure the rest of this file exists to prevent, and it would have
 * broken the web half's own gate: `web/audit/a10-gate.mjs` proves the takeoff
 * is shut when the app says nobody has paid, and it has to keep proving that
 * on the day the giveaway ends.
 *
 * `core/tools/check-paywall.py --release` refuses to let a build go on sale
 * with the giveaway still on.
 */

export type Feature =
  /* ------------------------------------------------------------ free */
  | 'scan'
  | 'measure'
  | 'plan'
  | 'room3d'
  | 'edit'
  | 'dimensions'
  /* ------------------------------------------------------------ paid */
  | 'takeoff'
  | 'pricing'
  | 'proposal'
  | 'signature'
  | 'changeOrders'
  | 'insurance'
  | 'exports'
  | 'priceList'
  | 'unlimitedRooms';

/** What anybody gets, forever, without an account. */
export const FREE: readonly Feature[] = [
  'scan',
  'measure',
  'plan',
  'room3d',
  'edit',
  'dimensions',
];

/**
 * How many rooms are kept at once without a subscription.
 *
 * One, and Sam decided it in those words: *"CHANGE IT TO 1 FREE ROOM
 * EVERYWHERE AND BUILD IT!"*
 *
 * One room is the whole product on one room. Scan it, walk it, correct it,
 * look at it in 3D, read its dimensions — and, with a subscription, take it
 * off, price it, propose it and get it signed. Nothing about the app is hidden
 * from somebody holding one room, which is also the answer to an App Store
 * reviewer asking what the free app is for.
 *
 * ## What this number does NOT mean
 *
 * It is not a cap on how many rooms a phone may hold, and it must never become
 * one. See `mayKeepRoom` below: this limits KEEPING A NEW ROOM, and nothing
 * else, ever. Somebody who scanned five rooms while everything was free keeps
 * all five, opens all five and exports all five for as long as the app is on
 * the phone. A limit that reached backwards and took work away would be theft
 * of somebody's afternoon, and this project has already lost a contractor 53
 * photographs once.
 */
export const FREE_ROOMS = 1;

/**
 * A small count in the words a person says, because "1 room" reads as a form.
 *
 * Only the handful of numbers this is ever asked for. Anything larger falls
 * back to the digits, which is right — nobody says "twenty-three rooms" in a
 * sentence about a limit they are about to hit.
 */
const COUNTED = ['no', 'one', 'two', 'three', 'four', 'five', 'six'] as const;

function inWords(count: number): string {
  return COUNTED[count] ?? String(count);
}

/**
 * Whether one more room may be written down on this device, and why not.
 *
 * ## The only thing this is allowed to stop
 *
 * Keeping a room that is not already kept. That is the entire gate. Reading,
 * opening, correcting, drawing, exporting and re-saving a room that is already
 * on the device are never refused by this function and never will be — a room
 * on somebody's phone is their record of a building they stood in, and no
 * billing decision gets to take it.
 *
 * So there are three ways past it and each one matters:
 *
 *   1. A subscription. The obvious one.
 *   2. The room is already kept. Re-saving is how corrections are written
 *      down; refusing it would lose ten minutes of work at a tape measure and
 *      would fire on the FIRST room of somebody who has never paid.
 *   3. Fewer than `FREE_ROOMS` rooms are kept.
 *
 * The refusal says what is still true — the rooms already there are untouched
 * — because a person meeting this has just measured a building and needs to
 * know, in the same sentence, that nothing has been taken from him.
 */
export interface Keeping {
  /** Whether this room may be written down on this device. */
  readonly keep: boolean;
  /** Why not, in plain words. Empty when it may be kept. */
  readonly because: string;
}

export function mayKeepRoom(
  alreadyKept: readonly string[],
  fileName: string,
  subscribed: boolean
): Keeping {
  const open = { keep: true, because: '' };
  if (subscribed) return open;
  // Already on this device. Saving it again is a correction, not a new room,
  // and this is the branch that stops the gate eating somebody's work.
  if (alreadyKept.includes(fileName)) return open;
  if (alreadyKept.length < FREE_ROOMS) return open;

  const kept = alreadyKept.length;
  return {
    keep: false,
    because:
      `Keeping more than ${inWords(FREE_ROOMS)} room at once is part of the subscription. ` +
      `The ${inWords(kept)} ${kept === 1 ? 'room' : 'rooms'} already on this phone ` +
      `${kept === 1 ? 'is' : 'are'} untouched — open, read, correct and send ` +
      `${kept === 1 ? 'it' : 'any of them'} as usual. This is about writing down a new one.`,
  };
}

export function isFree(feature: Feature): boolean {
  return FREE.includes(feature);
}

export function allowed(feature: Feature, subscribed: boolean): boolean {
  return subscribed || isFree(feature);
}

/** What each one is called, short enough for a row on a phone. */
export const TITLE: Readonly<Record<Feature, string>> = {
  scan: 'Scan a room',
  measure: 'Measure by hand',
  plan: 'The drawing',
  room3d: 'The 3D view',
  edit: 'Correcting the room',
  dimensions: 'Dimensions and floor area',

  takeoff: 'The takeoff',
  pricing: 'Your rates, applied',
  proposal: 'Proposals',
  signature: 'Signatures',
  changeOrders: 'Change orders',
  insurance: 'Insurance mode',
  exports: 'Every export',
  priceList: "Your supplier's prices",
  unlimitedRooms: 'Unlimited rooms',
};

/**
 * What a locked thing is, and what it does, in the words a contractor uses.
 *
 * Never "upgrade to unlock". A person who has just measured his own kitchen has
 * earned a straight sentence about what he would be buying. Each of these says
 * what the feature *does*, because that is the only honest reason to pay for
 * it.
 */
export const WHAT_IT_DOES: Readonly<Record<Feature, string>> = {
  scan: 'Scan a room with the phone.',
  measure: 'Walk a room and place its corners by hand.',
  plan: 'The drawing, with its dimensions, doors and windows.',
  room3d: 'The same room in three dimensions.',
  edit: 'Rename, move, split and correct anything on the plan.',
  dimensions: 'How far the room reaches each way, and its floor area.',

  takeoff:
    'Every quantity in the room — floor, ceiling, wall face, baseboard, framing, ' +
    'openings — worked out from the measurements, with every door and window taken off.',
  pricing:
    'Your rates against those quantities, so the room prices itself. Set a rate once ' +
    'and every room you measure afterwards uses it.',
  proposal:
    'A document a homeowner says yes to: the work in sentences, the price, what is ' +
    'not included, and options to choose between.',
  signature:
    'Signed in the kitchen, with the record that makes it stand up — who signed, when, ' +
    'what they agreed to, and a fingerprint of the document.',
  changeOrders:
    'The signed scope freezes. Everything that changes afterwards comes back as a ' +
    'priced line, so scope creep stops being an argument and becomes a list.',
  insurance:
    'Mark the damage on the wall, log the moisture readings, attach the photographs, ' +
    'and send the adjuster one document.',
  exports:
    'The drawing, the client file, CAD, the field sheet, the claim PDF and the whole ' +
    'job in one archive.',
  priceList:
    "Import a supplier's price list and price against what you actually pay.",
  unlimitedRooms:
    `More than ${inWords(FREE_ROOMS)} room kept at once. Every room already on the ` +
    `phone stays there and stays readable — this is about writing down a new one, ` +
    `never about taking away work somebody has already done.`,
};

/**
 * The one line shown where a locked thing would have been.
 *
 * Says what it does first and that it is paid second, in that order, because
 * the order is the difference between an offer and a toll gate.
 */
export function describeLock(feature: Feature): string {
  return WHAT_IT_DOES[feature];
}

/**
 * Everything paid, in the order it would be explained to somebody.
 *
 * Used by the paywall so the list on that screen cannot drift out of step with
 * the list the gate enforces — the two being different is how an app ends up
 * advertising something it does not unlock.
 */
export const PAID: readonly Feature[] = (
  [
    'takeoff',
    'pricing',
    'proposal',
    'signature',
    'changeOrders',
    'insurance',
    'exports',
    'priceList',
    'unlimitedRooms',
  ] as const
).filter((feature) => !isFree(feature));
