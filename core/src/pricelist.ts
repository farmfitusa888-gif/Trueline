import { RoomError } from './room.ts';
import { type Cents, type PriceUnit, type Rate, parseMoney } from './price.ts';

/**
 * A supplier's price list, into the contractor's own book.
 *
 * The thing nobody can build blind, and this is built to admit that. A real
 * price list is whatever the lumberyard's system exports: columns in an order
 * nobody agreed, headers in a language nobody standardised, prices with dollar
 * signs and thousands separators in them, units written six ways. There is no
 * format to code against, so this codes against *shapes* and then asks.
 *
 * Three things follow from that, and they are the design:
 *
 *   - **The columns are guessed and then confirmed, never assumed.** The guess
 *     is shown, the person fixes it, and nothing is imported until they say so.
 *     A silent mis-mapping puts a price per sheet against a rate per square
 *     foot, and the first anybody knows is a quote that is out by a factor of
 *     thirty-two.
 *   - **Every row that cannot be read is named, with its line number and what
 *     was wrong.** A list of four hundred rows that imports "381 rates" and
 *     says nothing about the other nineteen is a list somebody trusts.
 *   - **Nothing is converted.** A price per sheet is not turned into a price
 *     per square foot by dividing by 32, because a sheet is 32 square feet only
 *     if it is 4x8, and the app has no way to know. Rows in a unit the book
 *     does not use are named and left out.
 *
 * CSV rather than a spreadsheet format, because every system that produces a
 * price list can produce CSV and no library has to be trusted with somebody's
 * money. A supplier who sends xlsx gets one "save as CSV" step, which is a
 * smaller ask than a parser this app would have to maintain forever.
 */

export class PriceListError extends RoomError {}

/** Which column holds what. Indexes into the row, so order never matters. */
export interface Mapping {
  readonly item: number;
  readonly unit: number;
  readonly price: number;
  /** Optional: a supplier's own code, kept so a rate can be found again. */
  readonly code?: number;
}

export interface ParsedList {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
  /** The best guess at which column is which, for the person to correct. */
  readonly guess: Partial<Mapping>;
}

/**
 * Splits CSV, including the quoted-comma case every real export contains.
 *
 * Hand-written rather than taken from a library on purpose: this is four rules
 * and it is the boundary where somebody's prices enter the app. A dependency
 * here is a dependency that can change how a number parses in a patch release.
 */
export function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  // A leading byte-order mark makes the first header unmatchable, and Excel
  // writes one every time.
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < source.length; i += 1) {
    const c = source[i]!;
    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += c;
      }
      continue;
    }
    if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      // \r\n is one break, not two empty rows.
      if (c === '\r' && source[i + 1] === '\n') i += 1;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else {
      cell += c;
    }
  }
  row.push(cell);
  rows.push(row);

  // Trailing newline leaves one empty row, and a file of blank lines at the
  // bottom is normal. Only genuinely empty rows go.
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const ITEM_WORDS = ['item', 'description', 'product', 'name', 'material', 'desc'];
const UNIT_WORDS = ['unit', 'uom', 'u/m', 'per', 'measure'];
const PRICE_WORDS = ['price', 'cost', 'rate', 'each', 'amount', 'unit price', 'net'];
const CODE_WORDS = ['sku', 'code', 'part', 'item #', 'item no', 'number', 'id'];

function guessColumn(headers: readonly string[], words: readonly string[]): number | undefined {
  const lower = headers.map((h) => h.trim().toLowerCase());
  // Exact first, so a "price" column beats a "list price basis" one.
  for (const word of words) {
    const exact = lower.indexOf(word);
    if (exact !== -1) return exact;
  }
  for (const word of words) {
    const near = lower.findIndex((h) => h.includes(word));
    if (near !== -1) return near;
  }
  return undefined;
}

/**
 * Reads the file far enough to show somebody what is in it.
 *
 * Deliberately two steps. This one never produces a rate — it produces the
 * table and a guess, so the screen can show four rows with the guessed columns
 * highlighted and the person can say "no, price is that one" before a single
 * number reaches the book.
 */
export function parseList(text: string): ParsedList {
  const rows = splitCsv(text);
  if (rows.length < 2) {
    throw new PriceListError(
      'That file has no rows in it under its headings. A price list is a heading row and then ' +
        'one row per thing.'
    );
  }
  const headers = rows[0]!.map((h) => h.trim());
  const body = rows.slice(1);

  const guess: Partial<Mapping> = {};
  const item = guessColumn(headers, ITEM_WORDS);
  const unit = guessColumn(headers, UNIT_WORDS);
  const price = guessColumn(headers, PRICE_WORDS);
  const code = guessColumn(headers, CODE_WORDS);
  if (item !== undefined) (guess as { item?: number }).item = item;
  if (unit !== undefined) (guess as { unit?: number }).unit = unit;
  if (price !== undefined) (guess as { price?: number }).price = price;
  if (code !== undefined) (guess as { code?: number }).code = code;

  return { headers, rows: body, guess };
}

/**
 * A supplier's unit, in the three this book prices in.
 *
 * Nothing is converted. "sheet", "each 4x8", "bundle" and "roll" are all real
 * units on real price lists and none of them can become square feet without
 * knowing a size the app was never told. Those rows are named and left out —
 * an import that quietly turned $42 a sheet into $1.31 a square foot would be
 * out by whatever the sheet actually measures, and nothing would say so.
 */
export function readUnit(text: string): PriceUnit | undefined {
  const t = text.trim().toLowerCase().replace(/[.\s]/g, '');
  if (['sqft', 'sf', 'ft2', 'squarefoot', 'squarefeet', 'persqft'].includes(t)) return 'sq ft';
  if (['lf', 'linft', 'linealfoot', 'linearfoot', 'linearfeet', 'ft', 'foot', 'feet'].includes(t)) {
    return 'lf';
  }
  if (['ea', 'each', 'unit', 'pc', 'pce', 'piece', 'pieces', 'pcs'].includes(t)) return 'ea';
  return undefined;
}

/**
 * A price as a supplier writes it, into exact cents.
 *
 * Dollar signs, thousands separators and a trailing "/sf" all appear on real
 * lists. What is refused is a fraction of a cent: a list quoting $0.4375 a
 * square foot is quoting four decimal places, and rounding it here would put a
 * number in the book that the supplier never quoted. `parseMoney` already
 * refuses that, and this only cleans the wrapping off before handing it over.
 */
export function readPrice(text: string): Cents {
  const cleaned = text
    .trim()
    .replace(/[$\s]/g, '')
    .replace(/,/g, '')
    .replace(/\/.*$/, '');
  if (cleaned === '') throw new PriceListError('no price in that cell');
  return parseMoney(cleaned);
}

export interface ImportResult {
  readonly rates: readonly Rate[];
  /** Every row that did not become a rate, with its line number and why. */
  readonly refused: readonly { readonly line: number; readonly what: string; readonly why: string }[];
}

/**
 * The rows, as rates, once somebody has confirmed the columns.
 *
 * `at` and `by` are passed in rather than taken from a clock, so a re-import of
 * the same file produces the same rates — and so a test can check one.
 */
export function importList(
  list: ParsedList,
  mapping: Mapping,
  by: string,
  at: string,
  supplier: string
): ImportResult {
  const rates: Rate[] = [];
  const refused: { line: number; what: string; why: string }[] = [];
  const seen = new Set<string>();

  for (const [i, row] of list.rows.entries()) {
    // +2: one for the heading row, one because people count from one.
    const line = i + 2;
    const name = (row[mapping.item] ?? '').trim();
    const rawUnit = (row[mapping.unit] ?? '').trim();
    const rawPrice = (row[mapping.price] ?? '').trim();
    const code = mapping.code === undefined ? '' : (row[mapping.code] ?? '').trim();
    const what = name || code || `line ${line}`;

    if (name === '') {
      refused.push({ line, what, why: 'no name in the item column' });
      continue;
    }
    const unit = readUnit(rawUnit);
    if (!unit) {
      refused.push({
        line,
        what,
        why:
          rawUnit === ''
            ? 'no unit'
            : `priced per "${rawUnit}", which this book does not price in. Nothing is converted — ` +
              `a price per sheet only becomes a price per square foot if you know how big the ` +
              `sheet is, and this app does not.`,
      });
      continue;
    }
    let cents: Cents;
    try {
      cents = readPrice(rawPrice);
    } catch (error) {
      refused.push({
        line,
        what,
        why: `"${rawPrice}" is not a price: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    if (cents <= 0n) {
      refused.push({ line, what, why: `priced at ${rawPrice}, which is not a price` });
      continue;
    }

    const key = `${name}|${unit}`;
    if (seen.has(key)) {
      refused.push({
        line,
        what,
        why: `"${name}" per ${unit} is already in this file further up. The first one is kept — ` +
          `two prices for one thing is a question for the supplier, not something to pick between.`,
      });
      continue;
    }
    seen.add(key);

    rates.push({
      item: name,
      unit,
      cents,
      source: { kind: 'typed', by: `${supplier} price list, imported by ${by}`, at },
      ...(code === '' ? {} : { note: `supplier code ${code}` }),
    });
  }

  return { rates, refused };
}

/**
 * Merging an import into a book that already has rates in it.
 *
 * The imported ones win on a collision, because that is what importing a price
 * list means — but what was there before is handed back so the screen can say
 * which rates changed and by how much. A contractor whose drywall rate moved
 * 14% overnight should find out from the app rather than from a job.
 */
export function merge(
  existing: readonly Rate[],
  incoming: readonly Rate[]
): {
  readonly rates: readonly Rate[];
  readonly changed: readonly {
    readonly item: string;
    readonly unit: PriceUnit;
    readonly was: Cents;
    readonly now: Cents;
  }[];
} {
  const key = (r: Rate) => `${r.item}|${r.unit}`;
  const before = new Map(existing.map((r) => [key(r), r]));
  const changed: { item: string; unit: PriceUnit; was: Cents; now: Cents }[] = [];

  for (const rate of incoming) {
    const had = before.get(key(rate));
    if (had && had.cents !== rate.cents) {
      changed.push({ item: rate.item, unit: rate.unit, was: had.cents, now: rate.cents });
    }
    before.set(key(rate), rate);
  }
  return { rates: [...before.values()], changed };
}
