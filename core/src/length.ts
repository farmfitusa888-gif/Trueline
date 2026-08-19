/**
 * A length is a bigint count of nanometres. Nothing in this codebase stores or
 * arithmetics a dimension as a JavaScript number, for the same reason the ledger
 * refuses to store money as one: binary floats do not represent 0.1 exactly, and
 * a measuring tool that rounds wrong is worse than no tool.
 *
 * Nanometres are chosen because both systems a contractor uses land on whole
 * numbers of them, exactly and without remainder:
 *
 *   1 inch  = 25,400,000 nm   (the inch is *defined* as exactly 25.4 mm)
 *   1/64 in =    396,875 nm   — every binary fraction down to 1/64 is exact
 *   1 mm    =  1,000,000 nm
 *
 * So `12' 4 1/2"` and `3.7592 m` are both stored without loss, and converting
 * between them never accumulates error. A 100 m building is 1e11 nm, which is
 * five orders of magnitude inside bigint's comfort and would still be exact if
 * it were not.
 *
 * The boundary rules, mirroring the ledger's:
 *   - JSON has no bigint, so the API serialises nanometres as a decimal string.
 *   - Formatting to `12' 4 1/2"` happens once, at display time, and the result
 *     never feeds back into arithmetic.
 *   - Display may round to a fraction the reader can use. Storage never does.
 */

export type Nanometres = bigint;

export class LengthError extends Error {}

export const NM_PER_MM: Nanometres = 1_000_000n;
export const NM_PER_CM: Nanometres = 10n * NM_PER_MM;
export const NM_PER_METRE: Nanometres = 1000n * NM_PER_MM;
/** The inch is defined as exactly 25.4 mm, so this conversion is exact, not approximate. */
export const NM_PER_INCH: Nanometres = 25_400_000n;
export const NM_PER_FOOT: Nanometres = 12n * NM_PER_INCH;

export type Unit = 'nm' | 'mm' | 'cm' | 'm' | 'in' | 'ft';

const NM_PER_UNIT: Record<Unit, Nanometres> = {
  nm: 1n,
  mm: NM_PER_MM,
  cm: NM_PER_CM,
  m: NM_PER_METRE,
  in: NM_PER_INCH,
  ft: NM_PER_FOOT,
};

/* ------------------------------------------------------------------ parsing */

/**
 * Multiplies a decimal written as a string by a whole number of nanometres,
 * exactly. "4.5" × NM_PER_INCH becomes 114,300,000n with no float in the path.
 *
 * Throws when the result would not be a whole number of nanometres, rather than
 * rounding silently. A dimension that cannot be represented is a fact the caller
 * needs to know about, not one to paper over.
 */
function decimalTimes(decimal: string, nmPerUnit: Nanometres, original: string): Nanometres {
  const [whole = '0', frac = ''] = decimal.split('.');
  const scale = 10n ** BigInt(frac.length);
  const scaled = (BigInt(whole || '0') * scale + BigInt(frac || '0')) * nmPerUnit;
  if (scaled % scale !== 0n) {
    throw new LengthError(
      `"${original}" is not a whole number of nanometres and would have to be rounded. ` +
        `Enter it to fewer decimal places, or as a fraction.`
    );
  }
  return scaled / scale;
}

/** "1/2" -> exactly half of nmPerUnit, or an error naming why it cannot be exact. */
function fractionTimes(
  numerator: string,
  denominator: string,
  nmPerUnit: Nanometres,
  original: string
): Nanometres {
  const den = BigInt(denominator);
  if (den === 0n) throw new LengthError(`"${original}" divides by zero.`);
  const product = BigInt(numerator) * nmPerUnit;
  if (product % den !== 0n) {
    throw new LengthError(
      `"${original}" cannot be held exactly — ${numerator}/${denominator} of an inch is not a ` +
        `whole number of nanometres. Trades use halves down to 1/64, all of which are exact.`
    );
  }
  return product / den;
}

/**
 * The inch part is a mixed number ("4 1/2", "4-1/2"), a bare fraction ("1/2"),
 * or a plain number ("4", "4.5").
 *
 * The two fraction forms are separate alternatives on purpose. Written as one
 * optional-whole-then-optional-fraction pattern, the whole-number group eats the
 * first digit of a two-digit numerator and `11/16"` silently becomes `1 1/16"` —
 * a quarter-inch error in the direction nobody checks. A mixed number therefore
 * *requires* a separator between the whole and the fraction, which is how one is
 * written anyway.
 */
const FEET_INCHES_RE = new RegExp(
  String.raw`^(?:(?<feet>\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot)\s*)?` +
    String.raw`(?:` +
    String.raw`(?:(?<mixed>\d+)[\s-]+)?(?<num>\d+)\s*/\s*(?<den>\d+)` +
    String.raw`|(?<plain>\d+(?:\.\d+)?)` +
    String.raw`)?` +
    String.raw`\s*(?:"|''|in|inch|inches)?$`,
  'i'
);

const METRIC_RE = /^(\d+(?:\.\d+)?)\s*(nm|mm|cm|m|metres?|meters?)$/i;

const METRIC_UNIT: Record<string, Unit> = {
  nm: 'nm', mm: 'mm', cm: 'cm', m: 'm',
  metre: 'm', metres: 'm', meter: 'm', meters: 'm',
};

export interface ParseOptions {
  /**
   * What a bare number means. A contractor typing `12` into a field labelled
   * "wall length" may mean twelve feet or twelve inches, and only the field
   * knows which — so the screen states it rather than this parser guessing.
   */
  defaultUnit?: Unit;
}

/**
 * Parses what a person actually types on a job site:
 *
 *   12' 4 1/2"   12'4-1/2"   12' 4.5"   12'   4 1/2"   98"   12.5'
 *   3050mm       3.05m       305cm
 *
 * Rejects anything it cannot hold exactly, with a message saying why.
 */
export function parseLength(input: string, options: ParseOptions = {}): Nanometres {
  const raw = input.trim();
  if (raw === '') throw new LengthError('Empty length.');

  const negative = raw.startsWith('-');
  const body = negative ? raw.slice(1).trim() : raw;

  const metric = METRIC_RE.exec(body);
  if (metric) {
    const [, amount, suffix] = metric;
    const unit = METRIC_UNIT[(suffix ?? '').toLowerCase()];
    if (!unit || amount === undefined) throw new LengthError(`"${input}" is not a length.`);
    const value = decimalTimes(amount, NM_PER_UNIT[unit], input);
    return negative ? -value : value;
  }

  const imperial = FEET_INCHES_RE.exec(body);
  if (!imperial) {
    throw new LengthError(
      `"${input}" is not a length. Try 12' 4 1/2", 98", 12.5', 3050mm or 3.05m.`
    );
  }

  const { feet, mixed, num: fracNum, den: fracDen, plain } = imperial.groups ?? {};
  const inchWhole = mixed ?? plain;
  if (feet === undefined && inchWhole === undefined && fracNum === undefined) {
    throw new LengthError(`"${input}" has no number in it.`);
  }

  let total = 0n;
  if (feet !== undefined) total += decimalTimes(feet, NM_PER_FOOT, input);

  // With no feet and no inch mark, a bare number means whatever the field says it means.
  const bareUnit: Nanometres =
    feet === undefined && !/["']|in\b|inch/i.test(body)
      ? NM_PER_UNIT[options.defaultUnit ?? 'in']
      : NM_PER_INCH;

  if (inchWhole !== undefined) total += decimalTimes(inchWhole, bareUnit, input);
  if (fracNum !== undefined && fracDen !== undefined) {
    total += fractionTimes(fracNum, fracDen, bareUnit, input);
  }

  return negative ? -total : total;
}

/** Builds a length from a whole number of units: `of(12, 'ft')`. */
export function of(count: number | bigint, unit: Unit): Nanometres {
  if (typeof count === 'number' && !Number.isInteger(count)) {
    throw new LengthError(
      `Refusing to build a length from the non-integer number ${count}. ` +
        `Pass a string like "12.5" to parseLength so no binary-float rounding can occur.`
    );
  }
  return BigInt(count) * NM_PER_UNIT[unit];
}

/* --------------------------------------------------------------- formatting */

/** The fraction of an inch a reader is asked to work to. Trades stop at 1/64. */
export type Denominator = 2 | 4 | 8 | 16 | 32 | 64;

export interface FormatOptions {
  /** Round the displayed inches to this fraction. Storage is never rounded. */
  denominator?: Denominator;
  /** Show `12' 0"` rather than `12'` when the inches come out to nothing. */
  keepZeroInches?: boolean;
}

/**
 * Renders `12' 4 1/2"` — the way it is written on a cut list.
 *
 * This rounds to the nearest `denominator`th of an inch for display. That is a
 * reading convenience and it is one-way: the rounded string is never parsed back
 * into storage. `isExactAt()` says whether a value survives the round trip.
 */
export function formatFeetInches(nm: Nanometres, options: FormatOptions = {}): string {
  const denominator = options.denominator ?? 16;
  const sign = nm < 0n ? '-' : '';
  const abs = nm < 0n ? -nm : nm;

  const perTick = NM_PER_INCH / BigInt(denominator);
  // Round half away from zero, so 1/32 shown at 1/16 goes up rather than vanishing.
  const ticks = (abs + perTick / 2n) / perTick;

  const ticksPerFoot = BigInt(denominator) * 12n;
  const feet = ticks / ticksPerFoot;
  const restTicks = ticks % ticksPerFoot;
  const inches = restTicks / BigInt(denominator);
  let num = restTicks % BigInt(denominator);
  let den = BigInt(denominator);
  while (num !== 0n && num % 2n === 0n && den % 2n === 0n) {
    num /= 2n;
    den /= 2n;
  }

  const parts: string[] = [];
  if (feet !== 0n) parts.push(`${feet}'`);

  const hasInches = inches !== 0n || num !== 0n;
  if (hasInches) {
    const whole = inches !== 0n ? `${inches}` : num !== 0n && inches === 0n ? '' : '0';
    const frac = num !== 0n ? `${whole === '' ? '' : ' '}${num}/${den}` : '';
    parts.push(`${whole}${frac}"`);
  } else if (feet === 0n || options.keepZeroInches) {
    parts.push('0"');
  }

  return `${sign}${parts.join(' ')}`;
}

/** Renders metric: `formatMetric(x, 'mm')` -> "3050 mm". Trailing zeros trimmed. */
export function formatMetric(nm: Nanometres, unit: Exclude<Unit, 'in' | 'ft'> = 'mm'): string {
  const per = NM_PER_UNIT[unit];
  const sign = nm < 0n ? '-' : '';
  const abs = nm < 0n ? -nm : nm;
  const whole = abs / per;
  const rem = abs % per;
  if (rem === 0n) return `${sign}${whole} ${unit}`;
  const frac = rem.toString().padStart(per.toString().length - 1, '0').replace(/0+$/, '');
  return `${sign}${whole}.${frac} ${unit}`;
}

/** True when the value lands exactly on a `denominator`th of an inch — no display rounding. */
export function isExactAt(nm: Nanometres, denominator: Denominator): boolean {
  return nm % (NM_PER_INCH / BigInt(denominator)) === 0n;
}

/* --------------------------------------------------------------- arithmetic */

export function add(...lengths: Nanometres[]): Nanometres {
  let total = 0n;
  for (const l of lengths) total += l;
  return total;
}

export function subtract(a: Nanometres, b: Nanometres): Nanometres {
  return a - b;
}

export function abs(nm: Nanometres): Nanometres {
  return nm < 0n ? -nm : nm;
}

/**
 * Scales exactly by a ratio, or refuses. Used wherever a dimension is divided —
 * stud spacing across a wall, a run split into equal treads — so the parts add
 * back up to the whole with nothing lost.
 */
export function scale(nm: Nanometres, numerator: bigint, denominator: bigint): Nanometres {
  if (denominator === 0n) throw new LengthError('Cannot scale a length by a zero denominator.');
  const product = nm * numerator;
  if (product % denominator !== 0n) {
    throw new LengthError(
      `Scaling ${nm}nm by ${numerator}/${denominator} does not land on a whole nanometre. ` +
        `Use divideEvenly() if the remainder should be spread across the parts.`
    );
  }
  return product / denominator;
}

/**
 * Splits a length into `parts` pieces that sum back to exactly the original.
 * The leftover nanometres go one each to the earliest pieces — the same
 * largest-remainder rule the ledger uses to split money — so a run of joists
 * never ends up a nanometre short of the wall it has to reach.
 */
export function divideEvenly(nm: Nanometres, parts: number): Nanometres[] {
  if (!Number.isInteger(parts) || parts < 1) {
    throw new LengthError(`Cannot divide a length into ${parts} parts.`);
  }
  const n = BigInt(parts);
  const negative = nm < 0n;
  const magnitude = negative ? -nm : nm;
  const base = magnitude / n;
  const remainder = magnitude % n;
  return Array.from({ length: parts }, (_, i) => {
    const share = base + (BigInt(i) < remainder ? 1n : 0n);
    return negative ? -share : share;
  });
}

/* ----------------------------------------------------------------- boundary */

/** JSON has no bigint. Nanometres cross the wire as a decimal string. */
export function toJSON(nm: Nanometres): string {
  return nm.toString();
}

export function fromJSON(value: string): Nanometres {
  if (!/^-?\d+$/.test(value)) {
    throw new LengthError(`"${value}" is not a whole number of nanometres.`);
  }
  return BigInt(value);
}
