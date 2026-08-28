import { type Cents, money } from './price.ts';
import { RoomError } from './room.ts';

/**
 * The three-day right to cancel, and the notice a seller owes for it.
 *
 * ## Why a remodeler of all people needs this
 *
 * The FTC's Cooling-Off Rule — 16 CFR Part 429, "Rule Concerning Cooling-off
 * Period for Sales Made at Homes or at Certain Other Locations" — is usually
 * explained with a story about a vacuum cleaner salesman. It is not about
 * vacuum cleaners. It bites on **where the buyer's agreement is made**, and a
 * contractor who writes a proposal at a kitchen table and gets it signed there
 * has made exactly the kind of sale the rule covers. The definition in
 * § 429.0(a) is:
 *
 * > "A sale, lease, or rental of consumer goods or services in which the seller
 * > or his representative personally solicits the sale, including those in
 * > response to or following an invitation by the buyer, and the buyer's
 * > agreement or offer to purchase is made at a place other than the place of
 * > business of the seller (such as sales at the buyer's residence or at
 * > facilities rented on a temporary or short-term basis like hotel or motel
 * > rooms, convention centers, fairgrounds and restaurants, or sales at the
 * > buyer's workplace or in dormitory lounges), and which has a purchase price
 * > of $25 or more if the sale is made at the buyer's residence or a purchase
 * > price of $130 or more if the sale is made at locations other than the
 * > buyer's residence, whether under single or multiple contracts."
 *
 * Two things follow, and they are the whole reason this module exists rather
 * than a checkbox somewhere.
 *
 * **"Following an invitation by the buyer" is inside the definition, not
 * outside it.** The homeowner ringing up and asking for a quote does not take
 * the sale out of the rule. Contractors believe the opposite almost
 * universally, because "door-to-door" sounds like cold calling.
 *
 * **The exclusion for repairs does not save a remodeler.** § 429.0(a) excludes
 * a buyer-initiated visit "for the purpose of repairing or performing
 * maintenance upon the buyer's **personal property**"; a kitchen is real
 * property. It also excludes transactions "pertaining to the sale or rental of
 * real property" — selling a house, not remodelling one. A home improvement
 * contract is a sale of services, and it is covered.
 *
 * ## What the rule requires the seller to hand over
 *
 * § 429.1(a): a fully completed receipt or copy of the contract at the time of
 * its execution, in the same language as the sales presentation, showing the
 * date of the transaction, the name and address of the seller, and — in bold
 * face type of a minimum size of 10 points, in immediate proximity to the space
 * for the buyer's signature —
 *
 * > "You, the buyer, may cancel this transaction at any time prior to midnight
 * > of the third business day after the date of this transaction."
 *
 * § 429.1(b): a completed form **in duplicate**, captioned either "NOTICE OF
 * RIGHT TO CANCEL" or "NOTICE OF CANCELLATION", attached to the contract and
 * easily detachable, in ten point bold face type. Two copies, because the buyer
 * sends one and keeps one; a single copy means a buyer who cancels has kept no
 * evidence that he did.
 *
 * § 429.1(c): it is the seller's job to **complete both copies** before handing
 * them over — "by entering the name of the seller, the address of the seller's
 * place of business, the date of the transaction, and the date, not earlier
 * than the third business day following the date of the transaction, by which
 * the buyer may give notice of cancellation."
 *
 * That last clause is why the deadline in this file is computed and never
 * typed. A contractor filling the date in by hand at a kitchen table, at the
 * end of a two-hour sales call, gets it wrong in the direction that voids his
 * own contract — and the failure is invisible until the buyer cancels on day
 * three and the seller says he was too late.
 *
 * ## Business days are not the business days anybody means
 *
 * § 429.0 defines it, and it is not Monday to Friday:
 *
 * > "Business Day means any calendar day except Sunday or any federal holiday
 * > (e.g., New Year's Day, Presidents' Day, Martin Luther King's Birthday,
 * > Memorial Day, Independence Day, Labor Day, Columbus Day, Veterans' Day,
 * > Thanksgiving Day, and Christmas Day.)"
 *
 * **Saturday is a business day.** Sunday is not. Federal holidays are not, and
 * the rule says "any federal holiday" and then gives examples — so the list is
 * the federal holidays, not those ten words. Juneteenth became one in 2021 and
 * is therefore excluded here even though it is not in the rule's own
 * parenthesis, which was written before it existed.
 *
 * Getting this backwards is the obvious bug and it is the dangerous one: treat
 * Saturday as a non-business day and the deadline lands a day late, which is
 * harmless; treat Sunday as a business day and it lands a day early, which
 * shortens a right the buyer has by law and is exactly what § 429.1(c) forbids
 * with the words "not earlier than".
 *
 * Sources relied on: the text of 16 CFR §§ 429.0, 429.1, 429.2 and 429.3 as
 * published at https://www.ecfr.gov/current/title-16/chapter-I/subchapter-D/part-429
 * and in the annual print edition at
 * https://www.govinfo.gov/content/pkg/CFR-2025-title16-vol1/pdf/CFR-2025-title16-vol1-part429.pdf,
 * and the FTC's own page for the rule at
 * https://www.ftc.gov/legal-library/browse/rules/cooling-period-sales-made-home-or-other-locations.
 *
 * ## What this module refuses to pretend
 *
 * It is not legal advice, it says so on every document it produces, and it does
 * not name a single state's own rule. Many states have home-solicitation
 * statutes of their own, several give longer than three days, and some cover
 * home improvement contracts specifically. § 429.2 says the Commission did not
 * set out to preempt them. This app does not know which state a job is in or
 * what that state requires, so it says that in plain words on the notice rather
 * than staying quiet — a contractor who reads a three-day notice and never
 * learns his state gives five is worse off than one who was told to go and
 * look.
 */

export class CoolingError extends RoomError {}

/**
 * Where the buyer's agreement is made. The one answer the rule turns on.
 *
 * Three of them rather than two, because the rule has three cases and the money
 * is different in each. There is deliberately no fourth value meaning "not
 * asked": an unanswered question is the absence of one of these, held by
 * whatever is asking, so that no code path can ever read a default and act on
 * it. Defaulting this is choosing an answer for a contractor, and the only
 * answer worth defaulting to is the one that says he owes nothing.
 */
export type SaleVenue =
  /** At the buyer's home. § 429.0(a)'s "sales at the buyer's residence". */
  | 'buyer-home'
  /**
   * Away from both: a coffee shop, a job trailer, the buyer's workplace, a home
   * show stand. § 429.0(a)'s "locations other than the buyer's residence" that
   * are still not the seller's own place of business.
   */
  | 'away-from-both'
  /**
   * At the seller's own place of business — § 429.0(b)'s "main or permanent
   * branch office or local address of a seller". Not a door-to-door sale.
   */
  | 'seller-place';

/** The purchase price at or above which the rule bites, per venue. */
const THRESHOLD: Record<SaleVenue, Cents> = {
  // "$25 or more if the sale is made at the buyer's residence".
  'buyer-home': 2500n,
  // "$130 or more if the sale is made at locations other than the buyer's
  // residence". Raised from $25 by the FTC in 2015; the old figure is still
  // printed in a great deal of contractor advice.
  'away-from-both': 13000n,
  // Never reached. Present so the map is total and a new venue cannot be added
  // without somebody deciding what its threshold is.
  'seller-place': 0n,
};

/** Whether the federal notice is owed on this sale, and why. */
export interface CoolingRead {
  readonly applies: boolean;
  readonly venue: SaleVenue;
  /** Said in a sentence, for the screen and for the record. */
  readonly why: string;
}

/**
 * Whether 16 CFR Part 429 requires a notice on this sale.
 *
 * Answers only what the two facts it is given can answer: where the agreement
 * is made and what the job costs. It cannot see the exclusions that depend on
 * how the sale came about — a deal negotiated at the contractor's own showroom
 * and merely signed later, a genuine emergency where the buyer has written and
 * signed a waiver in his own hand, a job arranged entirely by post or telephone
 * with no other contact. Those are in § 429.0(a), they are real, and this says
 * so rather than answering as though they did not exist.
 */
export function coolingApplies(venue: SaleVenue, price: Cents): CoolingRead {
  if (venue === 'seller-place') {
    return {
      applies: false,
      venue,
      why:
        'Signed at your own place of business, so this is not a door-to-door sale under ' +
        '16 CFR 429 and no federal three-day notice is required. Your state may still ' +
        'require one — this app does not know your state’s rule.',
    };
  }
  const floor = THRESHOLD[venue];
  const where = venue === 'buyer-home' ? 'at the client’s home' : 'away from your office';
  if (price < floor) {
    return {
      applies: false,
      venue,
      why:
        `${money(price)} is under the ${money(floor)} that the rule sets for a sale signed ` +
        `${where}, so no federal three-day notice is required. Your state may still ` +
        'require one — this app does not know your state’s rule.',
    };
  }
  return {
    applies: true,
    venue,
    why:
      `Signed ${where} for ${money(price)}, which is ${money(floor)} or more. Federal law ` +
      '(16 CFR 429) gives the buyer until midnight of the third business day to cancel, ' +
      'and requires you to hand over the notice and two cancellation forms when they sign.',
  };
}

/* ------------------------------------------------------- business days */

const DAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const;
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/**
 * A calendar date, as a number of days, with no clock and no time zone in it.
 *
 * Dates here are `YYYY-MM-DD` and are handled as UTC midnights throughout. A
 * cancellation deadline worked out from a local `Date` is a deadline that
 * changes when the phone crosses a time zone, and the whole value of computing
 * it is that it does not move.
 */
function dayNumber(day: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new CoolingError(
      `"${day}" is not a date this can count from. A cancellation deadline is worked out ` +
        'from the date of the transaction, written as 2026-08-31.'
    );
  }
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const date = Number(day.slice(8, 10));
  const stamp = Date.UTC(year, month - 1, date);
  // Round-trips, so 2026-02-30 is refused rather than quietly becoming March.
  if (dayString(stamp / 86400000) !== day) {
    throw new CoolingError(`"${day}" is not a date on any calendar.`);
  }
  return stamp / 86400000;
}

function dayString(days: number): string {
  const at = new Date(days * 86400000);
  const y = `${at.getUTCFullYear()}`.padStart(4, '0');
  const m = `${at.getUTCMonth() + 1}`.padStart(2, '0');
  const d = `${at.getUTCDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 0 for Sunday, through 6 for Saturday. */
function weekday(days: number): number {
  return new Date(days * 86400000).getUTCDay();
}

/** The day number of the nth given weekday of a month, e.g. 3rd Monday. */
function nthWeekdayOf(year: number, month: number, wanted: number, nth: number): number {
  const first = Date.UTC(year, month - 1, 1) / 86400000;
  const shift = (wanted - weekday(first) + 7) % 7;
  return first + shift + (nth - 1) * 7;
}

/** The day number of the last given weekday of a month. */
function lastWeekdayOf(year: number, month: number, wanted: number): number {
  const nextMonth = Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1) / 86400000;
  const last = nextMonth - 1;
  return last - ((weekday(last) - wanted + 7) % 7);
}

/**
 * Every federal holiday in a year, as `YYYY-MM-DD`, including the weekday a
 * fixed-date one is observed on when it lands on a weekend.
 *
 * The eleven in 5 U.S.C. 6103. The in-lieu days are included on purpose and it
 * is a decision rather than an accident: 5 U.S.C. 6103(b) shifts a fixed-date
 * holiday falling on a Saturday to the Friday before and one falling on a
 * Sunday to the Monday after, and whether the *rule*'s "any federal holiday"
 * reaches that observed day is not obvious from its text. Counting it is the
 * safe side of the ambiguity in the only direction that matters: § 429.1(c)
 * requires a date "not earlier than the third business day", so a deadline
 * printed one day late is compliant and one printed a day early is not — and
 * the early one is the one that costs a buyer his right to cancel.
 */
function federalHolidays(year: number): Set<string> {
  const days = new Set<number>();
  const fixed = [
    Date.UTC(year, 0, 1),   // New Year's Day
    Date.UTC(year, 5, 19),  // Juneteenth National Independence Day
    Date.UTC(year, 6, 4),   // Independence Day
    Date.UTC(year, 10, 11), // Veterans Day
    Date.UTC(year, 11, 25), // Christmas Day
  ].map((stamp) => stamp / 86400000);
  for (const day of fixed) {
    days.add(day);
    if (weekday(day) === 6) days.add(day - 1); // Saturday, observed Friday.
    if (weekday(day) === 0) days.add(day + 1); // Sunday, observed Monday.
  }
  days.add(nthWeekdayOf(year, 1, 1, 3));   // Birthday of Martin Luther King, Jr.
  days.add(nthWeekdayOf(year, 2, 1, 3));   // Washington's Birthday
  days.add(lastWeekdayOf(year, 5, 1));     // Memorial Day
  days.add(nthWeekdayOf(year, 9, 1, 1));   // Labor Day
  days.add(nthWeekdayOf(year, 10, 1, 2));  // Columbus Day
  days.add(nthWeekdayOf(year, 11, 4, 4));  // Thanksgiving Day
  return new Set([...days].map(dayString));
}

/**
 * Whether a date is a business day as § 429.0 defines one.
 *
 * Saturday counts. Sunday does not. Federal holidays do not. That is the whole
 * definition, and it is not the definition anybody expects, which is why it is
 * one small function with its own tests rather than three lines inside a
 * bigger one.
 */
export function isBusinessDay(day: string): boolean {
  const number = dayNumber(day);
  if (weekday(number) === 0) return false;
  return !federalHolidays(Number(day.slice(0, 4))).has(day);
}

/**
 * The date that is `count` business days after a date.
 *
 * Counts forward from the day *after* the transaction date, because the rule
 * says "the third business day after the date of this transaction" — the day of
 * the sale is not one of the three, whatever day of the week it falls on.
 */
export function addBusinessDays(from: string, count: number): string {
  if (!Number.isInteger(count) || count < 1) {
    throw new CoolingError('A cancellation period is a whole number of business days.');
  }
  let day = dayNumber(from);
  let left = count;
  // Bounded rather than open: three business days can never be more than about
  // a fortnight away, and a loop that cannot end is worse than a wrong answer.
  for (let step = 0; step < 60 && left > 0; step += 1) {
    day += 1;
    if (isBusinessDay(dayString(day))) left -= 1;
  }
  if (left > 0) {
    throw new CoolingError('The cancellation deadline could not be worked out from that date.');
  }
  return dayString(day);
}

/** How long the buyer gets. Three, from § 429.1(a). Named, not sprinkled. */
export const BUSINESS_DAYS_TO_CANCEL = 3;

/**
 * Midnight of the third business day after the transaction.
 *
 * The one number on the notice that a contractor must never type himself.
 */
export function cancellationDeadline(transactionDate: string): string {
  return addBusinessDays(transactionDate, BUSINESS_DAYS_TO_CANCEL);
}

/**
 * A date said the way it goes on a document a homeowner reads.
 *
 * Written out here rather than left to `toLocaleDateString`, which answers
 * differently on different phones. A legal deadline that reads 08/09/2026 to
 * one person and 09/08/2026 to another is a deadline nobody can rely on.
 */
export function sayDate(day: string): string {
  const number = dayNumber(day);
  const at = new Date(number * 86400000);
  return (
    `${DAY_NAMES[weekday(number)]}, ${MONTH_NAMES[at.getUTCMonth()]} ` +
    `${at.getUTCDate()}, ${at.getUTCFullYear()}`
  );
}

/* --------------------------------------------------------- the notice */

/** Who the buyer sends the cancellation to. § 429.1(c) requires both. */
export interface Seller {
  readonly name: string;
  /**
   * The address of the seller's place of business, in § 429.1(c)'s own words.
   *
   * `string | undefined` rather than `string`, because a business profile
   * written before there was anywhere to put an address has no address, and
   * that absence has to survive all the way to here. A caller forced to hand
   * over a string would hand over `''`, and an empty string is the failure
   * this whole module exists to refuse: it satisfies every truthiness check
   * between the profile and the paper and then prints as a hole on the one
   * form whose purpose is telling a buyer where to send a cancellation.
   */
  readonly address: string | undefined;
}

/**
 * The statement § 429.1(a) requires beside the buyer's signature, word for
 * word. Not paraphrased, and not softened: the rule says "a statement in
 * substantially the following form", and the safest reading of "substantially"
 * is the actual sentence.
 */
export const RIGHT_TO_CANCEL_STATEMENT =
  'You, the buyer, may cancel this transaction at any time prior to midnight of the ' +
  'third business day after the date of this transaction.';

/** The completed § 429.1(b) form, ready to print twice. */
export interface CancellationNotice {
  /** § 429.0's date of the transaction — the day the buyer's agreement is made. */
  readonly transactionDate: string;
  /** Computed. § 429.1(c)'s "date ... by which the buyer may give notice". */
  readonly deadline: string;
  /** The same date, spelled out, for the line a homeowner actually reads. */
  readonly deadlineSaid: string;
  readonly sellerName: string;
  readonly sellerAddress: string;
  /** The § 429.1(a) statement. */
  readonly statement: string;
  /** The § 429.1(b) form, filled in. One paragraph per line, in the rule's order. */
  readonly form: readonly string[];
  /** How many copies the rule wants handed over. Two, and it matters. */
  readonly copies: 2;
}

/**
 * Fills in the cancellation form.
 *
 * Refuses rather than printing a form with a hole in it. A notice with no
 * seller address tells a buyer to post his cancellation to nowhere, and a
 * notice with no date makes the deadline unprovable — both are defects in the
 * seller's own paperwork, and both are the kind that are discovered by a lawyer
 * rather than by the person who made them.
 */
export function cancellationNotice(
  seller: Seller,
  transactionDate: string
): CancellationNotice {
  if (!seller.name.trim()) {
    throw new CoolingError(
      'The cancellation notice needs your business name on it. Put it on your business ' +
        'profile. 16 CFR 429.1(c) makes filling it in the seller’s job, and a form with ' +
        'nobody’s name on it is one the buyer cannot use.'
    );
  }
  // `?? ''` and then a trim, so that "nobody has said" and "somebody typed a
  // space" are refused by the same line. They are the same thing on paper.
  if (!(seller.address ?? '').trim()) {
    throw new CoolingError(
      'The cancellation notice needs the address of your place of business. Put it on your ' +
        'business profile — it is the same on every job. That is where the buyer has to ' +
        'send a cancellation, and 16 CFR 429.1(c) makes putting it there your job, not ' +
        'theirs.'
    );
  }
  const deadline = cancellationDeadline(transactionDate);
  const said = sayDate(deadline);
  const name = seller.name.trim();
  const address = (seller.address ?? '').trim();
  return {
    transactionDate,
    deadline,
    deadlineSaid: said,
    sellerName: name,
    sellerAddress: address,
    statement: RIGHT_TO_CANCEL_STATEMENT,
    // The paragraphs of the § 429.1(b) form, in the rule's own words, with the
    // four blanks § 429.1(c) requires the seller to fill filled in. The words
    // are the regulation's; only the bracketed blanks are this app's.
    form: [
      `Date of transaction: ${sayDate(transactionDate)}`,
      'You may CANCEL this transaction, without any Penalty or Obligation, within THREE ' +
        'BUSINESS DAYS from the above date.',
      'If you cancel, any property traded in, any payments made by you under the contract ' +
        'or sale, and any negotiable instrument executed by you will be returned within TEN ' +
        'BUSINESS DAYS following receipt by the seller of your cancellation notice, and any ' +
        'security interest arising out of the transaction will be cancelled.',
      'If you cancel, you must make available to the seller at your residence, in ' +
        'substantially as good condition as when received, any goods delivered to you under ' +
        'this contract or sale, or you may, if you wish, comply with the instructions of the ' +
        'seller regarding the return shipment of the goods at the seller’s expense and risk.',
      'If you do make the goods available to the seller and the seller does not pick them up ' +
        'within 20 days of the date of your Notice of Cancellation, you may retain or dispose ' +
        'of the goods without any further obligation.',
      'If you fail to make the goods available to the seller, or if you agree to return the ' +
        'goods to the seller and fail to do so, then you remain liable for performance of all ' +
        'obligations under the contract.',
      `To cancel this transaction, mail or deliver a signed and dated copy of this ` +
        `Cancellation Notice or any other written notice, or send a telegram, to ${name}, ` +
        `at ${address}, NOT LATER THAN MIDNIGHT OF ${said}.`,
      'I HEREBY CANCEL THIS TRANSACTION.',
    ],
    copies: 2,
  };
}

/**
 * What a document has to say when the rule applies and the form could not be
 * completed.
 *
 * ## The failure this closes
 *
 * `cancellationNotice` refuses rather than printing a form with a hole in it,
 * which is right, and for a while it was the whole story: the screen showed the
 * refusal to the contractor and the proposal simply went out with no
 * cancellation forms on it and nothing said. That is worse than it sounds. The
 * buyer is handed a document that looks complete, on a sale the FTC rule
 * covers, with no notice, no forms and no hint that any of it was owed. He
 * cannot tell that something is missing, so he cannot ask for it.
 *
 * A form with a blank where the address goes is a defective notice. A document
 * that says, in the same ten point bold the forms are set in, that the notice
 * could not be completed and why, is at least a document that tells the truth
 * to both of the people holding it — and it is the one a contractor notices
 * before he hands it over, which is the point.
 *
 * It is deliberately not a form. Nothing here is captioned "NOTICE OF
 * CANCELLATION", because a buyer must never be able to fill this in and post
 * it believing he has cancelled.
 */
export const NOTICE_NOT_COMPLETED: readonly string[] = [
  'THIS NOTICE COULD NOT BE COMPLETED.',
  'Federal law (16 CFR Part 429) gives the buyer of a sale like this one three business ' +
    'days to cancel, and it requires the seller to hand over a notice and two completed ' +
    'cancellation forms at the time of signing. Those forms are not on this document ' +
    'because the seller’s details needed to complete them are missing.',
  '16 CFR 429.1(c) makes completing the forms the seller’s job — the seller’s name, the ' +
    'address of the seller’s place of business, the date of the transaction, and the date ' +
    'by which the buyer may cancel. Without the address there is nowhere for a ' +
    'cancellation to be sent, so a form printed with that blank left empty would be worse ' +
    'than none: it would look like a notice and could not be used as one.',
  'Seller: fill in your business address on your business profile and send this again. ' +
    'Buyer: the right to cancel does not depend on this paperwork existing — ask the ' +
    'seller for the notice and the two forms the rule requires.',
];

/**
 * What this app does not know, said out loud on every notice it prints.
 *
 * Silence here is the failure. A contractor handed a clean three-day notice
 * reasonably concludes three days is the answer; in a good many states it is
 * not, and the state's period is the one that governs his job. Naming states
 * would be worse — a list assembled from memory is exactly the kind of invented
 * fact that ends up quoted back at somebody in a dispute — so this says which
 * question it has not answered and sends him to find out.
 */
export const WHAT_THIS_DOES_NOT_KNOW: readonly string[] = [
  'This is not legal advice. Trueline works out a date from a federal rule; it does not ' +
    'advise anybody on a contract.',
  'This is the federal rule only — 16 CFR Part 429. Many states have their own ' +
    'home-solicitation or home-improvement contract laws, several give the buyer longer ' +
    'than three days, and some require wording of their own. Trueline does not know which ' +
    'state this job is in or what that state requires, and it has not checked. Whichever ' +
    'period is longer is the one that protects the buyer, so check your state before you ' +
    'rely on three days.',
  'The federal rule has exclusions this app cannot see — a deal negotiated at your own ' +
    'permanent premises and only signed later, a genuine emergency where the buyer has ' +
    'written and signed a waiver in their own hand, a sale arranged entirely by post or ' +
    'telephone. If one of those fits, the notice may not be required at all.',
];

/**
 * The whole answer, for the screen the contractor is standing in front of.
 *
 * Plain sentences rather than a verdict, because the contractor is the one who
 * has to act on it and "yes/no" tells him nothing about what to hand over.
 */
export function describeCooling(
  read: CoolingRead,
  notice: CancellationNotice | null
): string[] {
  if (!read.applies || !notice) return [read.why];
  return [
    read.why,
    `The transaction date is ${sayDate(notice.transactionDate)}. Counting business days ` +
      'the federal way — Saturdays count, Sundays and federal holidays do not — the buyer ' +
      `can cancel until midnight on ${notice.deadlineSaid}.`,
    `The proposal carries the notice and two cancellation forms, filled in with your name, ` +
      `${notice.sellerAddress}, the date and that deadline. Hand both copies over when ` +
      'they sign: one to send back, one to keep.',
  ];
}
