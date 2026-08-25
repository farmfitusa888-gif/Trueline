import { RoomError } from './room.ts';
import { type TakeoffLine } from './takeoff.ts';

/**
 * Turning quantities into a number somebody can put their name on.
 *
 * The rule this whole product is built on, applied to money: **nothing here
 * invents a price.** The quantities come from the geometry, the rates come from
 * a book the contractor typed himself, and the arithmetic between them is
 * multiplication. There is no market data, no regional average, no model
 * guessing what drywall costs in Ohio. A number a contractor cannot defend line
 * by line to a client is worse than no number, and it is worse in exactly the
 * way an unchecked scan is worse than an honest "I have not measured it yet".
 *
 * Money is held the way the ledger in Plumbline holds it: **integer cents, never
 * a float.** A rate is cents per unit and a total is cents, and the only place a
 * decimal point appears is where a person reads one.
 *
 * A rate carries who set it and when, and whether it was typed or learned. That
 * is the same provenance discipline as a length, for the same reason: a price a
 * contractor typed last March and a price the app worked out from three accepted
 * jobs are different claims, and an estimate that showed them identically would
 * be the first place this product lied.
 */

export class PriceError extends RoomError {}

/** Cents. Always an integer, never a float, exactly like the ledger. */
export type Cents = bigint;

/** What a rate is charged against. Matches the takeoff's own units. */
export type PriceUnit = 'sq ft' | 'lf' | 'ea';

export type RateSource =
  /** Somebody typed it. The only kind that exists until there is history. */
  | { readonly kind: 'typed'; readonly by: string; readonly at: string }
  /**
   * Worked out from jobs that were actually won.
   *
   * Never from jobs that were quoted — a price nobody accepted is evidence of
   * nothing except what was asked. `from` names the jobs so a contractor can go
   * and look at the ones the number came from.
   */
  | { readonly kind: 'learned'; readonly from: readonly string[]; readonly at: string };

export interface Rate {
  /** Matches a takeoff line's `what`, so a sheet prices itself. */
  readonly item: string;
  readonly unit: PriceUnit;
  /** Cents per unit. `1250n` is $12.50. */
  readonly cents: Cents;
  readonly source: RateSource;
  /** What it covers, in the contractor's own words, for the client to read. */
  readonly note?: string;
}

export interface PriceBook {
  readonly rates: readonly Rate[];
  /** The mark-up applied to the whole job, in basis points. 1500 is 15%. */
  readonly marginBasisPoints?: number;
}

export const EMPTY_BOOK: PriceBook = { rates: [] };

/* --------------------------------------------------------------- reading */

/** Cents as a person reads them. `125000n` becomes `$1,250.00`. */
export function money(cents: Cents): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const dollars = abs / 100n;
  const rest = (abs % 100n).toString().padStart(2, '0');
  const grouped = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${grouped}.${rest}`;
}

/**
 * Dollars as somebody types them, into exact cents.
 *
 * `12.5`, `$12.50`, `1,250` all work. A third of a cent does not, and it is
 * refused rather than rounded: a rate that quietly lost a fraction would be off
 * by a few dollars across a house, and nobody would ever find out why.
 */
export function parseMoney(text: string): Cents {
  const cleaned = text.trim().replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    throw new PriceError(`"${text}" is not an amount of money.`);
  }
  const negative = cleaned.startsWith('-');
  const [whole, fraction = ''] = cleaned.replace('-', '').split('.');
  if (fraction.length > 2) {
    throw new PriceError(
      `"${text}" is a fraction of a cent. Rates are cents, exactly — round it yourself rather ` +
        `than letting the app do it where nobody can see.`
    );
  }
  const cents = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
  return negative ? -cents : cents;
}

/* -------------------------------------------------------------- pricing */

export interface PricedLine {
  readonly item: string;
  /** The quantity as the takeoff wrote it, unchanged. */
  readonly quantity: string;
  readonly unit: PriceUnit;
  readonly cents: Cents;
  /** Rate × quantity, exact. */
  readonly total: Cents;
  readonly source: RateSource;
  /** `measured` only when the quantity behind it was. Carried straight through. */
  readonly provenance: TakeoffLine['provenance'];
  readonly note?: string;
}

export interface Quote {
  readonly lines: readonly PricedLine[];
  readonly subtotal: Cents;
  /** Zero when no margin is set. */
  readonly margin: Cents;
  readonly total: Cents;
  /**
   * Takeoff lines with no rate against them.
   *
   * Named, never silently dropped and never zero-priced. A quote missing the
   * flooring because nobody set a flooring rate is a quote that adds up
   * perfectly and is short by a floor.
   */
  readonly unpriced: readonly string[];
  /** True when every quantity behind the money has had a tape on it. */
  readonly measured: boolean;
}

/**
 * A quantity string back into an exact number of hundredths.
 *
 * The takeoff writes `411.8` and `78.84` — its own rounding, already decided and
 * already on the screen. Pricing re-parses that rather than reaching behind it
 * for the exact value, deliberately: the client is looking at `411.8 sq ft` and
 * the line has to multiply the number they can see. A quote that priced 411.75
 * while the sheet said 411.8 would be a quote nobody could check by hand.
 */
function hundredths(quantity: string): bigint {
  if (!/^-?\d+(\.\d{1,2})?$/.test(quantity.trim())) {
    throw new PriceError(`"${quantity}" is not a quantity this can price.`);
  }
  const [whole, fraction = ''] = quantity.trim().split('.');
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
}

/**
 * The least a line has to say to be priced.
 *
 * A takeoff line satisfies this and so does a damage scope line, which is the
 * point: a remodel and a restoration are two different sheets going to two
 * different payers, and they price through one function so a rate can never
 * mean one thing on one of them and something else on the other.
 */
export interface Priceable {
  readonly what: string;
  readonly quantity: string;
  readonly unit: PriceUnit | 'in';
  readonly provenance: 'measured' | 'scanned';
}

/**
 * A sheet of quantities, priced.
 *
 * Every line is a rate the contractor set times a quantity the geometry
 * produced. Rounding happens once per line, half away from zero, so a client
 * adding the column up by hand gets the total on the page.
 */
export function quote(lines: readonly Priceable[], book: PriceBook): Quote {
  const byItem = new Map(book.rates.map((r) => [`${r.item}|${r.unit}`, r]));
  const priced: PricedLine[] = [];
  const unpriced: string[] = [];

  for (const line of lines) {
    const rate = byItem.get(`${line.what}|${line.unit}`);
    if (!rate) {
      // A line with no rate is named rather than priced at nothing. A quote
      // that adds up perfectly and is short by a floor is the worst kind.
      if (line.unit !== 'in') unpriced.push(line.what);
      continue;
    }
    const amount = hundredths(line.quantity);
    // rate (cents per unit) x quantity (hundredths of a unit), rounded to the
    // cent once, half away from zero.
    const raw = rate.cents * amount;
    const total = raw < 0n ? (raw - 50n) / 100n : (raw + 50n) / 100n;
    priced.push({
      item: line.what,
      quantity: line.quantity,
      unit: rate.unit,
      cents: rate.cents,
      total,
      source: rate.source,
      provenance: line.provenance,
      ...(rate.note ? { note: rate.note } : {}),
    });
  }

  const subtotal = priced.reduce((sum, l) => sum + l.total, 0n);
  const points = BigInt(book.marginBasisPoints ?? 0);
  const rawMargin = subtotal * points;
  const margin = rawMargin < 0n ? (rawMargin - 5000n) / 10_000n : (rawMargin + 5000n) / 10_000n;

  return {
    lines: priced,
    subtotal,
    margin,
    total: subtotal + margin,
    unpriced,
    // One word for the whole quote. Money resting on a scan nobody has checked
    // is money resting on a guess, and it says so.
    measured: priced.length > 0 && priced.every((l) => l.provenance === 'measured'),
  };
}

/* ---------------------------------------------------- learning from history */

/** A job that was quoted, and what happened to it. */
export type Outcome = 'quoted' | 'won' | 'lost';

export interface JobRecord {
  readonly id: string;
  readonly name: string;
  readonly outcome: Outcome;
  readonly at: string;
  /** What was charged, per unit, on the job as it went out. */
  readonly rates: readonly { readonly item: string; readonly unit: PriceUnit; readonly cents: Cents }[];
}

/**
 * How many jobs have to agree before the app says anything.
 *
 * Two is a coincidence. Three is the smallest number that is evidence, and it
 * is small enough that a remodeler reaches it inside a season.
 */
export const ENOUGH_JOBS = 3;

/**
 * What this contractor actually charges, from the jobs that were won.
 *
 * Won only. A price nobody accepted is evidence of what was asked and nothing
 * else, and an app that learned from rejected quotes would walk a contractor's
 * prices steadily upwards until he stopped winning work.
 *
 * The median rather than the mean, because one emergency job at triple rate
 * should not move a whole price book — and because a contractor can look at the
 * middle number of five and recognise it.
 *
 * It suggests; it never overwrites. A typed rate is something a person decided,
 * and this returns what history says beside it so they can decide again.
 */
export function learn(history: readonly JobRecord[]): Rate[] {
  const won = history.filter((job) => job.outcome === 'won');
  const gathered = new Map<string, { item: string; unit: PriceUnit; cents: Cents[]; from: string[] }>();

  for (const job of won) {
    for (const rate of job.rates) {
      const key = `${rate.item}|${rate.unit}`;
      const entry = gathered.get(key) ?? { item: rate.item, unit: rate.unit, cents: [], from: [] };
      entry.cents.push(rate.cents);
      entry.from.push(job.name);
      gathered.set(key, entry);
    }
  }

  const at = won.reduce((latest, job) => (job.at > latest ? job.at : latest), '');
  return [...gathered.values()]
    .filter((entry) => entry.cents.length >= ENOUGH_JOBS)
    .map((entry) => ({
      item: entry.item,
      unit: entry.unit,
      cents: median(entry.cents),
      source: { kind: 'learned' as const, from: entry.from, at },
    }));
}

/** The middle of an odd list; the lower of the two middles of an even one. */
function median(values: readonly Cents[]): Cents {
  const sorted = [...values].sort((a, b) => (a === b ? 0 : a < b ? -1 : 1));
  // The lower middle rather than the average of the two, so the answer is always
  // a rate this contractor has actually charged rather than one nobody has.
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}


/** What a rate reads as on a line: `$12.50 / sq ft`. */
export function rateLabel(rate: Rate): string {
  return `${money(rate.cents)} / ${rate.unit}`;
}

