import { type Cents } from './price.ts';

/**
 * The owner's side of the business: members, free months, takings, and trouble.
 *
 * ## What this is, and the line it must not cross
 *
 * Every other module here is about a room. This one is about the *business* —
 * it is what Sam looks at, and nobody else ever does. He asked for it in these
 * words: *"a dashboard to manage members and be able to give free months of the
 * subscription and for how long, and for other back end needs."*
 *
 * **A contractor's work never appears here.** Not a room, not a measurement,
 * not a client's name, not a photograph, not a price he quoted. Those live on
 * his phone and in his own iCloud and they are the whole promise of the
 * product; the moment any of them reach a server this stops being an app that
 * works in a basement with no signal and starts being one that needs a privacy
 * policy, a breach plan and somebody's trust. What is here is only ever:
 *
 *   1. what Apple already tells Sam, out of App Store Connect's own reports, and
 *   2. what Sam types himself.
 *
 * That line is not a style preference. It is what makes a dashboard safe to put
 * on a server at all, and every type below is shaped by it.
 *
 * ## The second rule: say who is claiming what
 *
 * Apple will tell you a code was redeemed. It will **not** tell you who
 * redeemed it. So a named grant carries two different kinds of fact — the
 * redemption, which is Apple's, and the name, which is Sam's own note about who
 * he handed it to — and this module never lets the second masquerade as the
 * first. `Grant.given` is a claim. `Grant.redeemedAt` is a fact. A screen that
 * showed them in the same colour would be lying quietly, which is the failure
 * this whole codebase is built against.
 *
 * ## Money
 *
 * `Cents` as `bigint`, like everywhere else, and every figure comes out of a
 * report Apple produced. Nothing here estimates, forecasts, or annualises.
 * A number nobody can point at a report for does not go on the screen.
 */

/* ------------------------------------------------------------ free months */

/**
 * How a free run reaches somebody.
 *
 * Both, because Sam asked for both: *"batches for marketing, named ones for
 * people you know."* They are kept apart because they answer different
 * questions — a batch asks "did the trade night work", a named one asks "is
 * Gilbert still inside his three months".
 */
export type HowGiven = 'batch' | 'named';

/** A free run of the subscription, given away. */
export interface Grant {
  /** The offer code itself, as generated in App Store Connect. */
  readonly code: string;
  readonly how: HowGiven;
  /** Which batch this belongs to, for a marketing push. Absent on a named one. */
  readonly batch?: string;
  /**
   * Who Sam says he gave it to. **His note, not Apple's fact** — Apple does not
   * report who redeemed a code, and this must never be shown as though it did.
   * Absent on a batch code, which by definition went to nobody in particular.
   */
  readonly given?: string;
  /** How many months it is worth. A whole number, at least one. */
  readonly months: number;
  /** When it was made, ISO 8601 with an offset. */
  readonly madeAt: string;
  /**
   * When Apple's report first showed it redeemed. **Apple's fact.** Absent
   * means the report has not shown it — which is not the same as knowing it was
   * not used, because a report can lag, and `describeGrant` says so.
   */
  readonly redeemedAt?: string;
  /** When Sam withdrew it before anybody used it, and why. Never erased. */
  readonly pulled?: { readonly at: string; readonly because: string };
}

export class OwnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OwnerError';
  }
}

/* ------------------------------------------------------------ the takings */

/**
 * One line of what Apple actually paid, out of one of its own reports.
 *
 * Deliberately not a computed total: `proceeds` is what Apple says lands in the
 * bank after its cut, `charged` is what the customer paid, and the difference
 * is Apple's commission plus tax it collected. Working any of the three out
 * from the other two produces a number that is right until the day a tax rate
 * changes, and then it is wrong on the screen Sam runs the business off.
 */
export interface Takings {
  /** The month this line covers, as `YYYY-MM`. */
  readonly month: string;
  /** What customers were charged, in cents. */
  readonly charged: Cents;
  /** What Apple says it will pay out, in cents. */
  readonly proceeds: Cents;
  /** Refunds Apple gave back, in cents, as a positive number. */
  readonly refunded: Cents;
  /** Subscriptions that started in this month. */
  readonly started: number;
  /** Subscriptions that were cancelled in this month. */
  readonly cancelled: number;
  /** Subscriptions that renewed in this month. */
  readonly renewed: number;
  /** Which of Apple's reports this line was read out of. */
  readonly from: string;
}

/* ------------------------------------------------- people, before they pay */

/** Where somebody has got to between hearing about it and using it. */
export type TesterStage = 'asked' | 'invited' | 'installed' | 'opened';

/**
 * One person on the TestFlight list.
 *
 * The gap between `asked` and `opened` is the number worth watching before
 * launch, and it is why the stage is a stage rather than a boolean.
 */
export interface Tester {
  /** How Sam refers to them. An email only if they gave one to be contacted on. */
  readonly who: string;
  readonly stage: TesterStage;
  /** When they reached that stage, ISO 8601 with an offset. */
  readonly at: string;
  /** Where they came from: the website form, a trade night, a text message. */
  readonly from?: string;
}

/* -------------------------------------------------------------- trouble */

/**
 * Something that went wrong on somebody's phone and was sent in.
 *
 * The app already gathers its own errors and sends nothing unless a person
 * presses the button — see `Trouble` in the web half. This is the receiving
 * end: what actually arrived, gathered so the commonest is at the top.
 *
 * `what` is the error's own text and `where` is the file it came from. There is
 * no room, no file name and no measurement, because none of those are sent.
 */
export interface Trouble {
  readonly what: string;
  readonly where: string;
  /** How many separate reports said this. */
  readonly times: number;
  /** The first and last time it was reported, ISO 8601 with an offset. */
  readonly firstAt: string;
  readonly lastAt: string;
  /** The app version it came from, if the report carried one. */
  readonly version?: string;
}

/* -------------------------------------------------------------- support */

/**
 * A note about one contractor, kept so the next message is not started cold.
 *
 * Typed by Sam. A contractor may send him a room file to look at, and that file
 * is opened in the app like any other — it is **not** stored here, and `sent`
 * records only that something arrived and what it was called.
 */
export interface Contact {
  readonly who: string;
  /** When they got in touch, ISO 8601 with an offset. */
  readonly at: string;
  /** What it was about, in Sam's words. */
  readonly about: string;
  /** The app version they said they were on. */
  readonly version?: string;
  /** What they sent, by name only. Never the contents. */
  readonly sent?: readonly string[];
  /** Whether it is dealt with, and what was done. */
  readonly settled?: { readonly at: string; readonly did: string };
}

/* ----------------------------------------------------------- the whole lot */

/**
 * Everything the dashboard holds.
 *
 * One value, so it can be written to a file, synced, exported and diffed as a
 * whole. Nothing in it is derived: every list is something Apple reported or
 * something Sam typed, and the figures on screen are worked out from this at
 * the moment they are shown rather than stored alongside it — a stored total is
 * a total that goes stale without saying so.
 */
export interface Books {
  readonly grants: readonly Grant[];
  readonly takings: readonly Takings[];
  readonly testers: readonly Tester[];
  readonly troubles: readonly Trouble[];
  readonly contacts: readonly Contact[];
}

export const NO_BOOKS: Books = {
  grants: [],
  takings: [],
  testers: [],
  troubles: [],
  contacts: [],
};
