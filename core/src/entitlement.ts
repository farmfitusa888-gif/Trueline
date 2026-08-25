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
 * How many rooms are kept without a subscription.
 *
 * Two rather than one, deliberately. One is a demonstration; two is enough to
 * measure a kitchen and the hall beside it and see that the app is real. It is
 * also the number at which somebody pricing a whole house discovers they need
 * the subscription, which is the honest moment to ask.
 */
export const FREE_ROOMS = 2;

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
  unlimitedRooms: `More than ${FREE_ROOMS} rooms kept at once.`,
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
