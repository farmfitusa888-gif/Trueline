import { type Nanometres, NM_PER_MM, formatFeetInches, parseLength } from './length.ts';
import { type Measurement, verified } from './measurement.ts';
import { RoomError } from './room.ts';
import { type AssemblyId, assemblyById } from './thickness.ts';

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
   * The logo, as a `data:` URL, so it travels inside the saved file and inside
   * anything sent to a client. Never a link to somewhere — a drawing that has
   * to fetch its own letterhead is a drawing that is blank on a job site.
   */
  readonly logo?: string;

  /** Feet and inches, or metric. Display only; nothing stored ever changes. */
  readonly units: Units;

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
}

export const EMPTY_COMPANY: Company = {
  name: '',
  phone: '',
  email: '',
  licence: '',
  insurance: '',
  units: 'imperial',
  useDefaultCeiling: false,
  defaultCeiling: `8'`,
};

/** True when there is enough here to put on something a client will see. */
export function isPresentable(company: Company): boolean {
  return company.name.trim() !== '';
}

/**
 * The lines that go under a drawing, in the order they are read.
 *
 * Blank fields are left out rather than printed empty. A drawing with
 * "Licence:" and nothing after it looks like a mistake, and on a document a
 * homeowner may show to somebody else, it is one.
 */
export function letterhead(company: Company): string[] {
  const contact = [company.phone.trim(), company.email.trim()].filter((x) => x !== '');
  const credentials = [
    company.licence.trim() === '' ? '' : `Licence ${company.licence.trim()}`,
    company.insurance.trim() === '' ? '' : `Insured — ${company.insurance.trim()}`,
  ].filter((x) => x !== '');
  return [company.name.trim(), contact.join(' · '), credentials.join(' · ')].filter(
    (line) => line !== ''
  );
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
