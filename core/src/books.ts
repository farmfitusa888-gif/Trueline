import { type Cents, money } from './price.ts';
import {
  type Books,
  type Grant,
  type HowGiven,
  type Takings,
  type Tester,
  type TesterStage,
  type Trouble,
  OwnerError,
} from './owner.ts';

/**
 * What the owner's dashboard actually does, over the types in `owner.ts`.
 *
 * ## The two rules, restated as code
 *
 * `owner.ts` states them in prose and this file is where they either hold or
 * quietly stop holding, so both are written out again here as things the
 * functions below refuse to do.
 *
 * **A contractor's work never appears here.** Nothing in this module reads a
 * room, a wall, a photograph or a price anybody quoted. It imports `Cents` and
 * `money` from `price.ts` for the arithmetic and the reading, and nothing else
 * from the measurement half of this codebase -- which is a line you can check
 * by looking at the imports above rather than by trusting a paragraph.
 *
 * **Say who is claiming what.** `Grant.given` is Sam's note and
 * `Grant.redeemedAt` is Apple's fact, and every sentence produced below keeps
 * them in separate clauses with the claimant named. There is exactly one place
 * a grant is turned into words -- `describeGrant` -- because two places is how
 * a screen and an export end up wording the same fact differently, and the one
 * that gets it wrong is always the one nobody is looking at.
 *
 * ## Why the sentences are in the model and not on the screen
 *
 * The screen is not the only reader. Sam will paste one of these lines into a
 * message to somebody, and the day there is an export it will write the same
 * lines to a file. A sentence written twice is a sentence that disagrees with
 * itself, and the disagreement is always about the thing that matters: whether
 * Apple said it or Sam did.
 *
 * ## Time
 *
 * Every function that needs to know what today is takes it as an argument. Not
 * a style preference: a list of grants on screen over midnight would otherwise
 * show two different "todays" in one column, and a test that reads the clock
 * fails once a year for reasons nobody can reproduce. `at` is always ISO 8601
 * **with an offset**, and a string without one is refused rather than assumed
 * to be anywhere in particular.
 */

/* ------------------------------------------------------------------ time */

/**
 * ISO 8601 with an offset, and nothing else.
 *
 * A bare `2026-07-02T14:00:00` is not an instant -- it is an instant in a place
 * nobody named, and JavaScript will happily read it as the local time of
 * whichever machine is running, which means the same grant runs out on two
 * different days on two different phones. `Z` or `+05:30`, or it is refused.
 */
const MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function moment(at: string, what: string): string {
  if (!MOMENT.test(at) || Number.isNaN(Date.parse(at))) {
    throw new OwnerError(
      `${what} is "${at}", which is not a time this can keep. It wants ISO 8601 with an ` +
        'offset - 2026-07-02T14:00:00Z, or 2026-07-02T14:00:00-07:00. A time with no offset ' +
        'is a time in a place nobody named, and it would run out on a different day on every ' +
        'phone that read it.'
    );
  }
  return at;
}

/** The date as it was written, not as UTC re-reads it. */
function dateOf(at: string): string {
  return at.slice(0, 10);
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

function partsOf(date: string): { readonly y: number; readonly m: number; readonly d: number } {
  const [y, m, d] = date.split('-').map(Number);
  return { y: y ?? 0, m: m ?? 0, d: d ?? 0 };
}

/**
 * A date a person reads. `2026-07-02` becomes `2 July 2026`.
 *
 * Written out here rather than through `toLocaleDateString`, which returns
 * whatever the machine's ICU data feels like -- a different string on a phone,
 * on a laptop and in a test, for the same day. Every sentence this module
 * produces has to be the same sentence everywhere it is read.
 */
export function readDay(date: string): string {
  const { y, m, d } = partsOf(date);
  return `${d} ${MONTHS[m - 1] ?? '?'} ${y}`;
}

/** `2026-07` becomes `July 2026`. Apple reports in months, so the screen does. */
export function readMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[(m ?? 0) - 1] ?? '?'} ${y ?? '?'}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * N whole months on from a date, with the end of the month clamped.
 *
 * 31 January plus one month is 28 February, because there is no 31 February
 * and the alternative -- rolling into March -- would hand somebody three days
 * of a subscription he was not given. The clamp is stated here because it is
 * the kind of arithmetic that is silently wrong twelve times a year and only
 * ever noticed by the one person it shortchanges.
 */
function monthsOn(date: string, months: number): string {
  const { y, m, d } = partsOf(date);
  const target = m - 1 + months;
  const ty = y + Math.floor(target / 12);
  const tm = ((target % 12) + 12) % 12;
  const day = Math.min(d, daysInMonth(ty, tm + 1));
  return (
    `${String(ty).padStart(4, '0')}-${String(tm + 1).padStart(2, '0')}-` +
    `${String(day).padStart(2, '0')}`
  );
}

/** Whole days from one date to another, both read as dates rather than instants. */
function daysBetween(from: string, to: string): number {
  const a = partsOf(from);
  const b = partsOf(to);
  return (Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000;
}

/* ------------------------------------------------------------ free months */

/**
 * A free run about to be given, before it is one.
 *
 * A separate type from `Grant` on purpose: a `Grant` carries `madeAt`, and
 * `madeAt` is not something a caller should be able to hand in. It is when the
 * grant was made, and a screen that could set it could write one into last
 * week.
 */
export interface Giving {
  /** The offer code as generated in App Store Connect. */
  readonly code: string;
  readonly how: HowGiven;
  /** Which marketing push this belongs to. On a batch one, and only there. */
  readonly batch?: string;
  /** Who Sam says he gave it to. On a named one, and only there. */
  readonly given?: string;
  /** How many months it is worth. A whole number, at least one. */
  readonly months: number;
}

/**
 * Give one free run of the subscription away.
 *
 * ## What it refuses, and why each one is a refusal rather than a repair
 *
 * **A code already in the books.** Two grants with one code is two rows that
 * Apple will only ever report one redemption against, and there is then no way
 * to say which of them Gilbert used. Refused rather than replacing the first,
 * because the first one might already be redeemed.
 *
 * **A month count that is not a whole number of months, at least one.** Apple
 * gives free runs in whole months. `0` is not a gift, `1.5` is not a thing App
 * Store Connect can make, and `-3` is a number that would then be added to a
 * redemption date and produce an end date in the past.
 *
 * **A named grant with nobody named.** The whole point of a named grant is the
 * name -- "is Gilbert still inside his three months" is not answerable by a row
 * that says somebody was. An empty name is worse than a batch code, because it
 * looks like it has an answer in it.
 *
 * **A batch grant carrying a name.** A batch code went to a room of people at a
 * trade night. Writing a name on one is a claim about who used it, which is
 * precisely the claim Apple's reports cannot support, and this refuses to let
 * it be made by accident.
 *
 * The code is trimmed, because a code pasted out of App Store Connect brings a
 * newline with it and a code with a newline on the end will never match the one
 * Apple reports redeemed.
 */
export function giveGrant(books: Books, giving: Giving, at: string): Books {
  const madeAt = moment(at, 'The time a grant was made');
  const code = giving.code.trim();
  if (code === '') {
    throw new OwnerError(
      'A free run needs the offer code from App Store Connect. This one is blank.'
    );
  }
  if (books.grants.some((one) => one.code === code)) {
    throw new OwnerError(
      `${code} is already in the books. Apple only ever reports one redemption against a code, ` +
        'so two rows sharing one would leave no way to say which of them was used.'
    );
  }
  if (!Number.isInteger(giving.months) || giving.months < 1) {
    throw new OwnerError(
      `${giving.months} is not a number of free months. Apple gives them in whole months, ` +
        'one or more.'
    );
  }

  const given = giving.given?.trim();
  const batch = giving.batch?.trim();
  if (giving.how === 'named') {
    if (!given) {
      throw new OwnerError(
        'A named free run needs the name of whoever it went to. That name is the only thing it ' +
          'answers that a batch code does not - and it is your note, not something Apple reports.'
      );
    }
    if (batch) {
      throw new OwnerError(
        `A named free run cannot also belong to the "${batch}" batch. One asks whether the trade ` +
          'night worked and the other asks whether Gilbert is still inside his three months.'
      );
    }
  } else {
    if (!batch) {
      throw new OwnerError(
        'A batch of free runs needs a name for the batch, so it can be counted later.'
      );
    }
    if (given) {
      throw new OwnerError(
        `A batch code cannot be given to "${given}". A batch code went to a room of people, and ` +
          'Apple never reports who redeemed one - writing a name on it would be claiming to know.'
      );
    }
  }

  const grant: Grant = {
    code,
    how: giving.how,
    months: giving.months,
    madeAt,
    ...(batch ? { batch } : {}),
    ...(given ? { given } : {}),
  };
  return { ...books, grants: [...books.grants, grant] };
}

/**
 * A batch of free runs, for a marketing push.
 *
 * Every code goes through `giveGrant`, so there is one set of refusals rather
 * than two -- and the whole batch is refused if any one code is, rather than
 * half of it landing. A batch half in the books is worse than none of it: the
 * codes are printed on something by then, and nobody knows which half.
 */
export function giveBatch(
  books: Books,
  batch: string,
  codes: readonly string[],
  months: number,
  at: string
): Books {
  const named = batch.trim();
  if (named === '') {
    throw new OwnerError(
      'A batch of free runs needs a name for the batch, so it can be counted later.'
    );
  }
  if (codes.length === 0) {
    throw new OwnerError(`The "${named}" batch has no codes in it. There is nothing to give away.`);
  }
  const seen = new Set<string>();
  for (const code of codes) {
    const tidy = code.trim();
    if (seen.has(tidy)) {
      throw new OwnerError(`${tidy} is in this batch twice. Nothing has been written down.`);
    }
    seen.add(tidy);
  }
  let out = books;
  for (const code of codes) {
    out = giveGrant(out, { code, how: 'batch', batch: named, months }, at);
  }
  return out;
}

/**
 * Withdraw a code before anybody uses it, and write down why.
 *
 * ## Why a redeemed code cannot be withdrawn
 *
 * Because withdrawing it here would not withdraw it there. Somebody is already
 * inside those free months; the only thing this would change is what Sam's own
 * screen says about them. A record that disagrees with the thing it records is
 * worse than no record.
 *
 * ## Why the reason is required and never erased
 *
 * `Grant.pulled` keeps the reason for ever, and this refuses to write an empty
 * one. A withdrawn code with no reason is a code Sam will find in six months
 * and have to guess about, and the guess will be "it must have been a mistake"
 * -- which is exactly what it would be if it were not.
 */
export function pullGrant(books: Books, code: string, because: string, at: string): Books {
  const pulledAt = moment(at, 'The time a code was withdrawn');
  const wanted = code.trim();
  const grant = books.grants.find((one) => one.code === wanted);
  if (!grant) {
    throw new OwnerError(`${wanted} is not in the books, so there is nothing to withdraw.`);
  }
  if (grant.redeemedAt) {
    throw new OwnerError(
      `Apple reported ${wanted} redeemed on ${readDay(dateOf(grant.redeemedAt))}. Somebody is ` +
        'inside those free months already, and withdrawing it here would only change what this ' +
        'screen says about them.'
    );
  }
  if (grant.pulled) {
    throw new OwnerError(
      `${wanted} was already withdrawn on ${readDay(dateOf(grant.pulled.at))}: ` +
        `${grant.pulled.because}`
    );
  }
  const why = because.trim();
  if (why === '') {
    throw new OwnerError(
      'Say why the code is being withdrawn. It is kept for ever, and a withdrawn code with no ' +
        'reason on it is one you will find in six months and have to guess about.'
    );
  }
  return {
    ...books,
    grants: books.grants.map((one) =>
      one.code === wanted ? { ...one, pulled: { at: pulledAt, because: why } } : one
    ),
  };
}

/**
 * A day, on its own, as Apple's offer-code page shows one.
 *
 * `2026-07-02`, and nothing else. Apple reports a redemption as a **day**, not
 * as an instant, so a day is what is kept -- padded to midnight UTC only
 * because `Grant.redeemedAt` is a moment and something has to go in the rest of
 * it. Nothing ever shows that midnight, because Apple never said it.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Write down that Apple has reported a code redeemed.
 *
 * ## Why this is typed at all, when everything else on this screen is read
 *
 * Because neither report Apple produces carries the offer **code**. The
 * Subscriber Report knows an offer was used and what it was called; it does not
 * know which of forty codes printed for a trade night the person had. So the
 * redemption of a particular code is read off App Store Connect's own
 * offer-code page and typed here.
 *
 * It is still Apple's fact rather than Sam's claim, and the distinction the
 * whole module turns on is untouched: **Apple says a code was redeemed, and
 * never who redeemed it.** Typing the date it said does not turn it into a
 * claim about a person, and `describeGrant` goes on keeping the two apart.
 *
 * ## What it refuses
 *
 * A code that is not in the books, and a date that is not a day. And a second
 * redemption of a code that already has one: `redeemedAt` is *when the report
 * first showed it*, and overwriting it with a later reading would quietly move
 * the day the free months are counted from -- which moves the day they end.
 *
 * A **withdrawn** code is not refused, and that is deliberate. It is exactly
 * the case the lag is about: the code was pulled because nobody appeared to
 * have used it, and Apple then reported that somebody had. Refusing would leave
 * the books saying something that is no longer true; `describeGrant` says both
 * halves out loud instead.
 */
export function markRedeemed(books: Books, code: string, day: string): Books {
  const wanted = code.trim();
  const grant = books.grants.find((one) => one.code === wanted);
  if (!grant) {
    throw new OwnerError(`${wanted} is not in the books, so there is nothing to mark redeemed.`);
  }
  if (grant.redeemedAt) {
    throw new OwnerError(
      `Apple already reported ${wanted} redeemed on ${readDay(dateOf(grant.redeemedAt))}. That is ` +
        'the day the free months are counted from, and moving it would move the day they end.'
    );
  }
  const on = day.trim();
  if (!DAY.test(on) || Number.isNaN(Date.parse(`${on}T00:00:00Z`)) || dateOf(new Date(`${on}T00:00:00Z`).toISOString()) !== on) {
    throw new OwnerError(
      `"${day}" is not a day. Apple reports a redemption as a date - 2026-07-02 - and that is ` +
        'what this keeps.'
    );
  }
  return {
    ...books,
    grants: books.grants.map((one) =>
      one.code === wanted ? { ...one, redeemedAt: `${on}T00:00:00Z` } : one
    ),
  };
}

/** When a free run ends, and how much of it is left. */
export interface RunsOut {
  /** The day the free months end, `YYYY-MM-DD`. */
  readonly on: string;
  /** Whole days from `at` to that day. Negative once it is behind. */
  readonly daysLeft: number;
  /** Whether the free months are already up. */
  readonly over: boolean;
}

/**
 * When a redeemed free run's months end -- or nothing at all.
 *
 * `null` for a grant Apple has not reported redeemed, and that is the whole
 * point of the function. The months run from the redemption, and the redemption
 * is Apple's fact; with no redemption there is no start, and any end date this
 * produced would be a guess dressed as a date. A screen showing "runs out
 * 2 October" for a code nobody has used is worse than a screen showing nothing,
 * because somebody will act on it.
 *
 * A withdrawn code is never redeemed -- `pullGrant` refuses to withdraw one
 * that is -- so it returns `null` for the same reason.
 *
 * `at` is passed in rather than read off the clock so a list of grants cannot
 * show two different "todays" if it is on screen over midnight.
 */
export function runsOut(grant: Grant, at: string): RunsOut | null {
  if (!grant.redeemedAt) return null;
  const on = monthsOn(dateOf(grant.redeemedAt), grant.months);
  const daysLeft = daysBetween(dateOf(moment(at, 'The day to count the free months against')), on);
  return { on, daysLeft, over: daysLeft <= 0 };
}

/* ------------------------------------------------------------- the takings */

/** Everything Apple's own reports add up to, and nothing beyond them. */
export interface Summed {
  /** How many month lines were summed. */
  readonly months: number;
  /** The first and last month, `YYYY-MM`, or nothing when there are none. */
  readonly from?: string;
  readonly to?: string;
  /** What customers were charged, in cents. */
  readonly charged: Cents;
  /** What Apple says it will pay out, in cents. */
  readonly proceeds: Cents;
  /** Refunds Apple gave back, in cents, as a positive number. */
  readonly refunded: Cents;
  /**
   * Charged less proceeds: Apple's commission plus the tax it collected.
   *
   * Subtracted rather than worked out from a rate, because the rate changes and
   * the tax changes and this has to be right on the day one of them does.
   */
  readonly appleAndTax: Cents;
  readonly started: number;
  readonly cancelled: number;
  readonly renewed: number;
}

/**
 * Add up the months Apple has reported, and nothing else.
 *
 * ## What it will not do
 *
 * Annualise, forecast, average, or project. Not one of those numbers has a
 * report behind it, and this is the screen Sam runs a business off. "Nine
 * months came to $4,230.00" is a fact; "that is $5,640.00 a year" is a story
 * about a year that has not happened.
 *
 * ## Why a month twice is a refusal
 *
 * Because it is silently a double. Reading July's report in twice produces a
 * total that is larger and looks exactly like a total that is right, and there
 * is nothing on a screen that could tell somebody which one they are looking
 * at. So it stops, and names the month.
 *
 * ## Why refunds sit beside the money rather than inside it
 *
 * `owner.ts` keeps `charged`, `proceeds` and `refunded` as three separate
 * things Apple reported, and this keeps them that way. Whether Apple's proceeds
 * figure for a month is already net of that month's refunds depends on which
 * report it came out of, and subtracting on a guess would be wrong by exactly
 * the refunds -- twice over, on the months where it was already netted.
 */
export function readTakings(takings: readonly Takings[]): Summed {
  const seen = new Set<string>();
  for (const line of takings) {
    if (seen.has(line.month)) {
      throw new OwnerError(
        `${readMonth(line.month)} is in the takings twice. Adding it up would quietly double ` +
          'that month, and the total would look exactly like a total that is right.'
      );
    }
    seen.add(line.month);
  }
  const months = [...seen].sort();
  let charged = 0n;
  let proceeds = 0n;
  let refunded = 0n;
  let started = 0;
  let cancelled = 0;
  let renewed = 0;
  for (const line of takings) {
    charged += line.charged;
    proceeds += line.proceeds;
    refunded += line.refunded;
    started += line.started;
    cancelled += line.cancelled;
    renewed += line.renewed;
  }
  return {
    months: months.length,
    ...(months.length > 0 ? { from: months[0], to: months[months.length - 1] } : {}),
    charged,
    proceeds,
    refunded,
    appleAndTax: charged - proceeds,
    started,
    cancelled,
    renewed,
  };
}

/* --------------------------------------------------------------- trouble */

/**
 * The same fault reported by six phones, as one line.
 *
 * ## Why it folds on the text and the place and not on the version
 *
 * A fault is the same fault whichever build it happened in, and a list that
 * showed it three times because three versions hit it would put the loudest
 * thing on the phones at the bottom of the page in three quiet pieces. So the
 * version is kept only where every report that folded together agreed on it,
 * and dropped where they did not -- an absent version reads as "several", which
 * is true, rather than as one build's name on another build's crashes.
 *
 * Commonest first, because that is the order the work is in. Ties break on the
 * most recent, then on the text, so the same reports always produce the same
 * list -- a list that reorders itself between two looks is a list nobody
 * trusts.
 */
/** The separator the fold uses. Never in an error's text or a file's name. */
const APART = '\u0000';

export function gatherTroubles(troubles: readonly Trouble[]): readonly Trouble[] {
  const folded = new Map<string, { one: Trouble; versions: Set<string> }>();
  for (const said of troubles) {
    // A separator that cannot appear in either half. A space would fold two
    // different faults together the moment one error's text ended in the
    // next one's file name, and written as an escape rather than as a
    // literal so there is no control byte sitting in this source.
    const key = [said.what, said.where].join(APART);
    const already = folded.get(key);
    if (!already) {
      folded.set(key, {
        one: { what: said.what, where: said.where, times: said.times, firstAt: said.firstAt, lastAt: said.lastAt },
        versions: new Set(said.version ? [said.version] : []),
      });
      continue;
    }
    already.one = {
      what: said.what,
      where: said.where,
      times: already.one.times + said.times,
      firstAt: already.one.firstAt < said.firstAt ? already.one.firstAt : said.firstAt,
      lastAt: already.one.lastAt > said.lastAt ? already.one.lastAt : said.lastAt,
    };
    if (said.version) already.versions.add(said.version);
  }
  const out: Trouble[] = [];
  for (const { one, versions } of folded.values()) {
    const only = versions.size === 1 ? [...versions][0] : undefined;
    out.push(only ? { ...one, version: only } : one);
  }
  return out.sort(
    (a, b) => b.times - a.times || b.lastAt.localeCompare(a.lastAt) || a.what.localeCompare(b.what)
  );
}

/* ------------------------------------------------------- before they pay */

/** One step of the TestFlight funnel, and what it cost to get there. */
export interface Step {
  readonly stage: TesterStage;
  /** How many people have got at least this far. */
  readonly reached: number;
  /** How many did not get from the step before to this one. Zero on the first. */
  readonly lost: number;
}

/** In order, and the order is the whole point. */
export const STAGES: readonly TesterStage[] = ['asked', 'invited', 'installed', 'opened'];

/**
 * Where everybody got to, between hearing about it and using it.
 *
 * ## Why every stage counts everybody past it
 *
 * Somebody who has opened the app has plainly been asked, been invited and has
 * installed it. Counting only the people sitting exactly on a stage would put
 * `asked: 1` under `opened: 40` and read as a funnel almost nobody entered,
 * which is the opposite of what happened.
 *
 * ## Why the gap is a number and not a percentage
 *
 * Before launch the numbers are small. "40% did not install" out of five people
 * is two people, and the percentage makes it sound like a problem with the
 * funnel rather than two blokes to ring. The number is the thing to act on;
 * work the percentage out later, when there are enough of them for one to mean
 * anything.
 */
export function whereTheyGotTo(testers: readonly Tester[]): readonly Step[] {
  const out: Step[] = [];
  let before: number | null = null;
  for (const stage of STAGES) {
    const floor = STAGES.indexOf(stage);
    const reached = testers.filter((one) => STAGES.indexOf(one.stage) >= floor).length;
    out.push({ stage, reached, lost: before === null ? 0 : before - reached });
    before = reached;
  }
  return out;
}

/* ------------------------------------------------------------- the words */

/**
 * One free run, in a sentence, with every claim attributed.
 *
 * ## The rule this function exists to keep
 *
 * Apple reports that a code was redeemed. It does not report who redeemed it.
 * So a redemption is written as *"Apple reported it redeemed on..."* and a name
 * is written as *"you say you gave it to..."*, in separate clauses, every time.
 * There is no arrangement of those two facts that reads as one fact.
 *
 * ## And the thing an empty field must never be allowed to mean
 *
 * A grant with no `redeemedAt` is **not** a grant that was not used. It is a
 * grant Apple's report has not shown redeemed *yet*, and Apple's reports lag by
 * days. The sentence says that out loud rather than leaving somebody to read a
 * blank as an answer -- a blank presented as an answer is the failure this
 * whole codebase is built against.
 */
export function describeGrant(grant: Grant, at: string): string {
  const worth = `${grant.months} free month${grant.months === 1 ? '' : 's'}`;
  const made = `Made ${readDay(dateOf(grant.madeAt))}`;
  const whose =
    grant.how === 'named'
      ? `you say you gave it to ${grant.given}`
      : `part of the ${grant.batch} batch, so it went to nobody in particular`;

  if (grant.pulled) {
    const withdrawn =
      `${grant.code} - ${worth}, ${whose}. ${made}, withdrawn ` +
      `${readDay(dateOf(grant.pulled.at))}: ${grant.pulled.because}.`;
    // Withdrawn and then reported redeemed is not a contradiction, it is the
    // lag. The code was pulled because nobody appeared to have used it and
    // Apple's report caught up afterwards, which means somebody was inside
    // those free months the whole time. Saying only the first half would leave
    // the screen quietly wrong about a live subscriber.
    if (!grant.redeemedAt) return `${withdrawn} Apple had not reported it redeemed.`;
    const ran = runsOut(grant, at);
    return (
      `${withdrawn} Apple has since reported it redeemed on ` +
      `${readDay(dateOf(grant.redeemedAt))}, so somebody was already inside those free months ` +
      `when it was withdrawn` +
      (ran ? `, and they run to ${readDay(ran.on)}.` : '.')
    );
  }

  const ends = runsOut(grant, at);
  if (!ends) {
    return (
      `${grant.code} - ${worth}, ${whose}. ${made}. Apple has not reported it redeemed, which ` +
      'is not the same as knowing it was unused: a report lags by days, so it may already be in ' +
      "somebody's hands."
    );
  }
  const left = ends.over
    ? ends.daysLeft === 0
      ? 'the free months are up today'
      : `the free months were up ${-ends.daysLeft} day${ends.daysLeft === -1 ? '' : 's'} ago`
    : `${ends.daysLeft} day${ends.daysLeft === 1 ? '' : 's'} left`;
  return (
    `${grant.code} - ${worth}, ${whose}. ${made}. Apple reported it redeemed on ` +
    `${readDay(dateOf(grant.redeemedAt as string))}, so it runs out ${readDay(ends.on)} - ` +
    `${left}.`
  );
}

/**
 * The whole business in a paragraph, out of Apple's reports and Sam's notes.
 *
 * Every figure in it is summed from something already in `Books`, and the two
 * kinds are kept in separate sentences: the money and the counts came out of
 * Apple's reports, the grants and the notes were typed. Nothing is annualised,
 * nothing is averaged, and books with nothing in them say so rather than
 * printing a row of zeroes that reads like a bad month.
 */
export function describeBooks(books: Books, at: string): string {
  const said: string[] = [];
  const sum = readTakings(books.takings);
  if (sum.months === 0) {
    said.push('No report from Apple has been read in yet, so there is no money on this screen.');
  } else {
    const span =
      sum.from === sum.to
        ? readMonth(sum.from as string)
        : `${readMonth(sum.from as string)} to ${readMonth(sum.to as string)}`;
    said.push(
      `${sum.months} month${sum.months === 1 ? '' : 's'} of Apple's reports, ${span}: ` +
        `${money(sum.charged)} charged, ${money(sum.proceeds)} to be paid out, ` +
        `${money(sum.appleAndTax)} to Apple and tax, ${money(sum.refunded)} refunded.`
    );
    said.push(
      `${sum.started} started, ${sum.renewed} renewed, ${sum.cancelled} cancelled. Those are the ` +
        'months Apple has reported and nothing beyond them - no year is worked out from them ' +
        'here.'
    );
  }

  const grants = books.grants;
  const redeemed = grants.filter((one) => one.redeemedAt).length;
  const pulled = grants.filter((one) => one.pulled).length;
  const live = grants.filter((one) => {
    const ends = runsOut(one, at);
    return ends !== null && !ends.over;
  }).length;
  said.push(
    grants.length === 0
      ? 'No free months have been given away.'
      : `${grants.length} free run${grants.length === 1 ? '' : 's'} given away. Apple has ` +
        `reported ${redeemed} of them redeemed, ${live} still inside the free months, ` +
        `${pulled} withdrawn. What Apple has not reported redeemed is not the same as unused.`
  );

  const funnel = whereTheyGotTo(books.testers);
  const asked = funnel[0]?.reached ?? 0;
  const opened = funnel[funnel.length - 1]?.reached ?? 0;
  said.push(
    books.testers.length === 0
      ? 'Nobody is on the TestFlight list yet.'
      : `${asked} asked for TestFlight, ${opened} have opened it.`
  );

  const troubles = gatherTroubles(books.troubles);
  const reports = troubles.reduce((sum, one) => sum + one.times, 0);
  said.push(
    troubles.length === 0
      ? 'Nothing has been reported broken.'
      : `${reports} report${reports === 1 ? '' : 's'} of something going wrong, ` +
        `${troubles.length} separate fault${troubles.length === 1 ? '' : 's'}.`
  );

  const open = books.contacts.filter((one) => !one.settled).length;
  said.push(
    books.contacts.length === 0
      ? 'Nobody has been in touch.'
      : `${books.contacts.length} contractor${books.contacts.length === 1 ? '' : 's'} in touch, ` +
        `${open} not dealt with.`
  );

  return said.join(' ');
}
