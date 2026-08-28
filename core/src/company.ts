import { type Nanometres, NM_PER_MM, formatFeetInches, parseLength } from './length.ts';
import { type Measurement, verified } from './measurement.ts';
import { RoomError } from './room.ts';
import { type AssemblyId, assemblyById } from './thickness.ts';
import { type JobRecord, type PriceBook, type Rate, learn } from './price.ts';
import { NO_TRADE } from './trade.ts';

/**
 * Whose business this is, and how they like their numbers.
 *
 * Two things live here and they are together because they are both "the same
 * for every job": the contractor's own details, which go on everything a client
 * ever sees, and the handful of preferences that decide what a new scan starts
 * as.
 *
 * The details are not decoration. A homeowner handed a drawing with somebody
 * else's brand on it is being handed a tool their contractor is borrowing. With
 * his name, his number and his licence on it, it is his drawing, made by his
 * business, and Trueline is a line at the bottom. That difference is the whole
 * reason a contractor pays for a thing like this.
 *
 * Nothing here is ever a measurement. A default ceiling height is a starting
 * point somebody typed once, and it arrives in a room carrying `stated`
 * provenance saying exactly that — never `scanned`, and never silently exact.
 */

export class CompanyError extends RoomError {}

export type Units = 'imperial' | 'metric';

export interface Company {
  /** What goes at the top of a drawing. Empty until somebody fills it in. */
  readonly name: string;
  readonly phone: string;
  readonly email: string;
  /**
   * A licence number, and insurance, for the states that require them on
   * anything handed to a homeowner. Free text, because the format is different
   * in every state and inventing a validator would refuse real licences.
   */
  readonly licence: string;
  readonly insurance: string;
  /**
   * Where the business actually is. The street address of the place of
   * business, as it would be written on an envelope.
   *
   * ## Why it is here and not on a job
   *
   * It was asked for once per proposal, in a box on the Agreement screen, and
   * that was the wrong place for it. It is the same on every job, so a
   * contractor retyped it on every proposal, and a field somebody retypes is a
   * field somebody eventually leaves blank. The document it was blank on is the
   * federal cancellation form — the one whose entire purpose is telling a buyer
   * where to send a cancellation. 16 CFR 429.1(c) makes filling that in the
   * seller's own job, so a blank there is a defect in the seller's paperwork,
   * not the buyer's problem.
   *
   * ## Why it is optional and must stay optional
   *
   * Every profile already saved on a phone and in iCloud was written before
   * this field existed and has no address in it. `undefined` is what that
   * looks like and it has to keep looking like that: absent must read as
   * absent. The one thing this must never become is an empty string, because
   * an empty string is an address as far as any `if (address)` is concerned,
   * and it prints as a hole on a legal form. Everything that reads this goes
   * through `addressLines` or `postalAddress`, and both of them answer
   * "nobody has said" rather than handing back nothing that looks like
   * something.
   *
   * Free text over several lines, because an address is several lines and
   * every country writes them differently. `addressLines` is the only thing
   * that decides what a line is.
   */
  readonly address?: string;
  /**
   * The logo, as a `data:` URL, so it travels inside the saved file and inside
   * anything sent to a client. Never a link to somewhere — a drawing that has
   * to fetch its own letterhead is a drawing that is blank on a job site.
   */
  readonly logo?: string;

  /** Feet and inches, or metric. Display only; nothing stored ever changes. */
  readonly units: Units;

  /**
   * What this company does, so the app says their words.
   *
   * Presentation only, exactly like `units`: it changes which takeoff lines
   * come first and what they are called, and never what any of them is. A rate
   * is stored against the app's own item name whatever trade is selected, so
   * changing trade cannot orphan a price somebody has set.
   */
  readonly trade: string;

  /**
   * Whether to start a new room at the height below rather than the scanner's.
   *
   * A toggle rather than a value that is always used, deliberately. A scanner
   * measuring the ceiling from a wall it could actually see is better than
   * anybody's default, and quietly overriding it would replace a measurement
   * with a habit. On when somebody knows their houses are all 8 ft and is tired
   * of typing it; off when they want what was found.
   */
  readonly useDefaultCeiling: boolean;
  /** What that height is. Only consulted when the toggle is on. */
  readonly defaultCeiling: string;

  /** What the walls are, unless a job says otherwise. */
  readonly defaultAssembly?: AssemblyId;

  /**
   * What this business charges.
   *
   * Here rather than in its own store because it belongs to the business and
   * not to a job — the same reason the licence number is here. Empty until
   * somebody fills it in, and an empty book prices nothing rather than
   * pricing everything at zero.
   */
  readonly prices?: PriceBook;

  /**
   * What was quoted and what happened to it.
   *
   * The record the learning needs, and useful on its own: what went out last
   * month and what came back. Nothing is learned from it until three won jobs
   * agree — see `price.ts`.
   */
  readonly jobs?: readonly JobRecord[];
}

export const EMPTY_COMPANY: Company = {
  name: '',
  phone: '',
  email: '',
  licence: '',
  insurance: '',
  units: 'imperial',
  trade: NO_TRADE,
  useDefaultCeiling: false,
  defaultCeiling: `8'`,
};

/**
 * The book to price with, and what history would say instead.
 *
 * Learned rates never overwrite typed ones. A typed rate is something a person
 * decided, and this hands back what the won jobs say **beside** it so they can
 * decide again — which is the difference between a tool and a tool that quietly
 * changes somebody's prices.
 */
export function pricing(company: Company): {
  readonly book: PriceBook;
  readonly suggestions: readonly Rate[];
} {
  const book = company.prices ?? { rates: [] };
  const learned = learn(company.jobs ?? []);
  const typed = new Set(book.rates.map((r) => `${r.item}|${r.unit}`));
  return {
    book,
    // Only where history has something to say that the book does not already
    // say the same way. A suggestion identical to the typed rate is noise.
    suggestions: learned.filter((r) => {
      const existing = book.rates.find((x) => x.item === r.item && x.unit === r.unit);
      return !typed.has(`${r.item}|${r.unit}`) || existing?.cents !== r.cents;
    }),
  };
}

/** True when there is enough here to put on something a client will see. */
export function isPresentable(company: Company): boolean {
  return company.name.trim() !== '';
}

/* --------------------------------------------------------------- the address */

/**
 * The address, as the lines it is written on, or no lines at all.
 *
 * The single place that decides what a line of an address is, so that a
 * document, a screen and a legal form cannot each decide differently. Blank
 * lines are dropped and every line is trimmed, because somebody typing an
 * address into a phone leaves a trailing return behind and a document that
 * prints an empty line where a town should be looks like a mistake.
 *
 * Hands back `[]` — never `['']` — when nobody has filled one in. That is the
 * whole point of it: a caller that asks "how many lines is this address" gets
 * zero and can say so, instead of getting one empty line and printing it.
 */
export function addressLines(company: Company): readonly string[] {
  if (company.address === undefined) return [];
  return company.address
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * The address on one line, or nothing at all when nobody has typed one.
 *
 * `undefined` rather than `''`, deliberately and every time. An empty string
 * would satisfy every truthiness check between here and the paper, and the
 * paper is a cancellation form that has to tell a buyer where to post a
 * cancellation. A form that says "at ," has been handed over defective; one
 * that says the address is missing at least tells the buyer something is
 * wrong. Nothing here may hand back the first of those.
 *
 * Joined with commas rather than kept as lines because the two places that
 * need one string — a letterhead line and the sentence § 429.1(b) puts the
 * address inside — are both a single run of text. Flattening it here also
 * means the line breaks somebody typed never reach an HTML document at all,
 * which is one of the two things standing between a typed address and an
 * injected tag; the other is that the documents escape it anyway.
 */
export function postalAddress(company: Company): string | undefined {
  const lines = addressLines(company);
  return lines.length === 0 ? undefined : lines.join(', ');
}

/**
 * Whether this business has said where it is.
 *
 * Its own function because "is there an address" is asked by screens that must
 * not each write their own version of it — one of them writing
 * `company.address !== undefined` would call a profile with a single space in
 * the box addressed, and the form would print a space.
 */
export function hasAddress(company: Company): boolean {
  return addressLines(company).length > 0;
}

/**
 * The lines that go under a drawing, in the order they are read.
 *
 * Blank fields are left out rather than printed empty. A drawing with
 * "Licence:" and nothing after it looks like a mistake, and on a document a
 * homeowner may show to somebody else, it is one.
 *
 * ## The address belongs here, and this is why
 *
 * A letterhead is the business saying who it is on something it hands to
 * somebody, and "who it is" includes where it is. A homeowner holding a
 * drawing, a client file or a proposal with a name, a phone number and a
 * licence number on it but no address is holding a document that cannot be
 * replied to on paper, and the states that require a licence number on
 * anything given to a homeowner generally want the contractor's business
 * address beside it. It also means the address is on the page for the same
 * reason the licence number is: typed once, on every document, forever.
 *
 * It is one line rather than several because a letterhead is a stack of
 * one-line strings and every caller — a drawing, an HTML document, a PDF —
 * lays it out as one. `postalAddress` does the flattening, so the line breaks
 * somebody typed never travel into a renderer that would have to decide what
 * to do with them.
 *
 * A profile with no address simply has no address line, exactly as a profile
 * with no licence has no licence line. That is what keeps this safe for every
 * profile already saved before the field existed: nothing appears, rather than
 * an empty line where an address should be.
 */
export function letterhead(company: Company): string[] {
  const contact = [company.phone.trim(), company.email.trim()].filter((x) => x !== '');
  const credentials = [
    company.licence.trim() === '' ? '' : `Licence ${company.licence.trim()}`,
    company.insurance.trim() === '' ? '' : `Insured — ${company.insurance.trim()}`,
  ].filter((x) => x !== '');
  return [
    company.name.trim(),
    postalAddress(company) ?? '',
    contact.join(' · '),
    credentials.join(' · '),
  ].filter((line) => line !== '');
}

/**
 * The ceiling height a new room should start at, or nothing to keep the
 * scanner's.
 *
 * Carries `stated` provenance and the name of whoever set the preference, so a
 * room that starts at eight foot because of a setting can never be mistaken for
 * a room somebody measured. That distinction is the product.
 */
export function startingCeiling(
  company: Company,
  by: string,
  at: string
): Measurement | undefined {
  if (!company.useDefaultCeiling) return undefined;
  let value: Nanometres;
  try {
    value = parseLength(company.defaultCeiling, { defaultUnit: 'ft' });
  } catch (error) {
    throw new CompanyError(
      `The default ceiling height is set to "${company.defaultCeiling}", which is not a length: ` +
        `${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (value <= 0n) {
    throw new CompanyError(`A default ceiling of ${company.defaultCeiling} is not a height.`);
  }
  return verified(value, by, at, 'stated');
}

/** The wall build-up a new room should start at, or nothing. */
export function startingThickness(
  company: Company,
  by: string,
  at: string
): Measurement | undefined {
  if (!company.defaultAssembly) return undefined;
  return verified(assemblyById(company.defaultAssembly).thickness, by, at, 'stated');
}

/* ------------------------------------------------------------------- units */

/**
 * One length, formatted the way this company reads them.
 *
 * The single place the preference is applied, so a screen cannot accidentally
 * print feet while its neighbour prints millimetres. Everything downstream of
 * here is a string for a person to read; nothing is ever parsed back.
 */
export function showLength(value: Nanometres, units: Units): string {
  if (units !== 'metric') return formatFeetInches(value);
  // Whole millimetres. `formatMetric` keeps every digit the model holds, which
  // is right for a report on a rounding and absurd on a drawing: a wall came
  // out "6497.87802 mm", which is a tenth of a micron on somebody's garage.
  // A millimetre is finer than any tape ever made.
  const rounded = (value + (value < 0n ? -NM_PER_MM : NM_PER_MM) / 2n) / NM_PER_MM;
  return `${rounded} mm`;
}

const SQ_FT = 304_800_000n * 304_800_000n;
const SQ_M = 1_000_000_000n * 1_000_000_000n;

/**
 * An area from the doubled unit `area()` keeps, in whatever this company reads.
 *
 * Doubled in, halved once, at the end — the same rule the rest of the codebase
 * follows, because halving early rounds a room with an angled wall in it.
 */
export function showArea(halfSquareNanometres: bigint, units: Units, places = 1): string {
  const per = units === 'metric' ? 2n * SQ_M : 2n * SQ_FT;
  const scale = 10n ** BigInt(places);
  const scaled = (halfSquareNanometres * scale + per / 2n) / per;
  const whole = scaled / scale;
  const frac = (scaled % scale).toString().padStart(places, '0');
  const number = places === 0 ? `${whole}` : `${whole}.${frac}`;
  return `${number} ${units === 'metric' ? 'm²' : 'sq ft'}`;
}

/** A run of something, for a takeoff line. Linear feet, or metres. */
export function showRun(value: Nanometres, units: Units, places = 2): string {
  const per = units === 'metric' ? 1_000_000_000n : 304_800_000n;
  const scale = 10n ** BigInt(places);
  const scaled = (value * scale + per / 2n) / per;
  const whole = scaled / scale;
  const frac = (scaled % scale).toString().padStart(places, '0');
  return `${whole}.${frac} ${units === 'metric' ? 'm' : 'lf'}`;
}
