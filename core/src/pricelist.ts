import { RoomError } from './room.ts';
import { type Cents, type PriceUnit, type Rate, money, parseMoney } from './price.ts';
import { type Sighting } from './vendor.ts';

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
  /**
   * Optional: how much one of the priced things covers.
   *
   * The column that makes a flooring list importable at all. Tile is priced by
   * the box and laid by the square foot, and the two are only connected by a
   * number printed on the box — "15.5 sq ft" — which real flooring price lists
   * carry in a column of their own. Mapped, a box price becomes a square-foot
   * rate exactly; unmapped, those rows are refused rather than guessed at.
   */
  readonly coverage?: number;
  /**
   * Optional: whatever the store calls the aisle.
   *
   * The column that turns a flat list of four hundred rows into something a
   * person can narrow down. It is never invented: a file with no such column
   * offers no category chips at all, rather than the app sorting somebody's
   * materials into trades it made up.
   */
  readonly category?: number;
}

export interface ParsedList {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
  /** The best guess at which column is which, for the person to correct. */
  readonly guess: Partial<Mapping>;
  /**
   * True when the file had no heading row and one was made up for the screen.
   *
   * **Three of the four real price bases tested had no headings at all.** They
   * begin on the first row with the first item, which is normal for a published
   * price base — SINAPI, PMSP and SEINFRA all do it — and it made the first
   * item's price disappear into a heading row and the whole file unimportable,
   * because there was nothing called "price" to find.
   *
   * So a file whose first row does not look like headings keeps every row as
   * data, and the columns are named "column 1", "column 2" for the screen. The
   * guess cannot help there, and it does not pretend to: the person picks.
   */
  readonly headless: boolean;
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
const COVERAGE_WORDS = ['coverage', 'sq ft per', 'sqft per', 'covers', 'per box', 'per carton', 'yield'];
// Deliberately short, and deliberately without "type": a heading called
// "Item Type" is a category and a value called "Type X" is a kind of drywall,
// and a word that matches both is a word that files gypsum board under itself.
const CATEGORY_WORDS = ['category', 'class', 'group', 'department', 'dept', 'trade', 'aisle', 'family'];

function guessColumn(
  headers: readonly string[],
  words: readonly string[],
  /** Headers that look like this are passed over unless nothing else matches. */
  notLike: readonly string[] = []
): number | undefined {
  const lower = headers.map((h) => h.trim().toLowerCase());
  const looksWrong = (h: string) => notLike.some((word) => h.includes(word));

  const find = (allowWrong: boolean): number | undefined => {
    // Exact first, so a "price" column beats a "list price basis" one.
    for (const word of words) {
      const exact = lower.findIndex((h) => h === word && (allowWrong || !looksWrong(h)));
      if (exact !== -1) return exact;
    }
    for (const word of words) {
      const near = lower.findIndex((h) => h.includes(word) && (allowWrong || !looksWrong(h)));
      if (near !== -1) return near;
    }
    return undefined;
  };

  // A real Menards transaction report has "Item Number" AND "Item Description",
  // in that order. Taking the first thing containing "item" gave a price book
  // full of SKUs instead of descriptions — every rate correctly priced and
  // named 1950128, which is useless to the person reading the quote. So a
  // column that also looks like a code is passed over while anything else
  // matches.
  return find(false) ?? find(true);
}

/**
 * Reads the file far enough to show somebody what is in it.
 *
 * Deliberately two steps. This one never produces a rate — it produces the
 * table and a guess, so the screen can show four rows with the guessed columns
 * highlighted and the person can say "no, price is that one" before a single
 * number reaches the book.
 */
/**
 * Whether the first row is headings or the first thing on the list.
 *
 * The test is what a person's eye does: headings are words, and a row with a
 * price in it has a number where the price goes. So a first row containing a
 * cell that reads as money, next to a cell that reads as a unit, is data.
 *
 * Wrong in the safe direction. Calling a heading row data costs one junk row
 * that gets refused by name; calling a data row headings loses that item AND
 * leaves nothing for the guess to match, which is what made three real files
 * import nothing at all.
 */
function looksLikeData(row: readonly string[]): boolean {
  let money = false;
  let unit = false;
  for (const cell of row) {
    const t = cell.trim();
    if (t === '') continue;
    if (/^[$€£]?\s*\d[\d,]*(\.\d+)?$/.test(t)) money = true;
    else if (readUnit(t).kind !== 'unknown') unit = true;
  }
  return money && unit;
}

/**
 * Which column is which, worked out from the cells rather than the headings.
 *
 * For a file with no headings there is nothing to match a word against, and
 * leaving the person to count across nineteen columns of a published price base
 * is how a feature goes unused. But the columns still announce themselves: one
 * of them is nearly all money, one is nearly all units, and of what is left the
 * descriptions are the long text and the codes are the short ones.
 *
 * Still a guess, and still shown for confirmation before anything is imported —
 * the same two steps, just with the first one done from the data.
 */
function guessFromRows(rows: readonly (readonly string[])[]): Partial<Mapping> {
  const width = Math.max(0, ...rows.map((r) => r.length));
  if (width === 0) return {};
  // A sample rather than the whole file: a published base runs to tens of
  // thousands of rows and the first few hundred say the same thing.
  const sample = rows.slice(0, 400);

  const moneyLike: number[] = [];
  const unitLike: number[] = [];
  const length: number[] = [];
  const filled: number[] = [];
  for (let c = 0; c < width; c += 1) {
    let money = 0;
    let unit = 0;
    let chars = 0;
    let seen = 0;
    for (const row of sample) {
      const cell = (row[c] ?? '').trim();
      if (cell === '') continue;
      seen += 1;
      chars += cell.length;
      if (/^[$€£]?\s*\d[\d,]*(\.\d+)?$/.test(cell)) money += 1;
      else if (readUnit(cell).kind !== 'unknown') unit += 1;
    }
    moneyLike.push(seen === 0 ? 0 : money / seen);
    unitLike.push(seen === 0 ? 0 : unit / seen);
    length.push(seen === 0 ? 0 : chars / seen);
    filled.push(seen);
  }

  const best = (score: readonly number[], floor: number, taken: readonly number[]) => {
    let at: number | undefined;
    let top = floor;
    for (let c = 0; c < width; c += 1) {
      if (taken.includes(c) || filled[c] === 0) continue;
      if (score[c]! > top) {
        top = score[c]!;
        at = c;
      }
    }
    return at;
  };

  const guess: Partial<Mapping> = {};
  // Two thirds, so a column of mostly-numbers is the price and a stray numeric
  // description does not win.
  const unit = best(unitLike, 0.66, []);
  if (unit !== undefined) (guess as { unit?: number }).unit = unit;
  const price = best(moneyLike, 0.66, unit === undefined ? [] : [unit]);
  if (price !== undefined) (guess as { price?: number }).price = price;

  const spoken = [unit, price].filter((c): c is number => c !== undefined);
  // The longest text left is the description; the shortest is the code.
  const item = best(length, 0, spoken);
  if (item !== undefined) (guess as { item?: number }).item = item;
  if (item !== undefined) {
    const rest = [...spoken, item];
    let code: number | undefined;
    let shortest = Infinity;
    for (let c = 0; c < width; c += 1) {
      if (rest.includes(c) || filled[c] === 0) continue;
      if (length[c]! < shortest) {
        shortest = length[c]!;
        code = c;
      }
    }
    if (code !== undefined) (guess as { code?: number }).code = code;
  }
  return guess;
}

export function parseList(text: string): ParsedList {
  const rows = splitCsv(text);
  if (rows.length === 0) {
    throw new PriceListError('That file is empty.');
  }

  const headless = looksLikeData(rows[0]!);
  if (!headless && rows.length < 2) {
    throw new PriceListError(
      'That file has one row in it and it looks like headings. A price list is a heading row ' +
        'and then one row per thing.'
    );
  }

  // Named rather than left blank, so the dropdowns on the screen have something
  // to say and the person can count across to the column they mean.
  const headers = headless
    ? rows[0]!.map((_, i) => `column ${i + 1}`)
    : rows[0]!.map((h) => h.trim());
  const body = headless ? rows : rows.slice(1);

  // With no headings there are no words to match, so the columns are read off
  // the cells instead. Either way the person confirms before anything imports.
  if (headless) return { headers, rows: body, guess: guessFromRows(body), headless };

  const guess: Partial<Mapping> = {};
  const item = guessColumn(headers, ITEM_WORDS, CODE_WORDS);
  const unit = guessColumn(headers, UNIT_WORDS);
  const price = guessColumn(headers, PRICE_WORDS);
  const code = guessColumn(headers, CODE_WORDS);
  const coverage = guessColumn(headers, COVERAGE_WORDS);
  const category = guessColumn(headers, CATEGORY_WORDS);
  if (item !== undefined) (guess as { item?: number }).item = item;
  if (unit !== undefined) (guess as { unit?: number }).unit = unit;
  if (price !== undefined) (guess as { price?: number }).price = price;
  if (code !== undefined) (guess as { code?: number }).code = code;
  if (coverage !== undefined) (guess as { coverage?: number }).coverage = coverage;
  if (category !== undefined) (guess as { category?: number }).category = category;

  return { headers, rows: body, guess, headless };
}

/**
 * What a supplier's unit means, in the three this book prices in.
 *
 * Real building-materials price lists are not written in square feet and linear
 * feet. Roofing is priced by the **square**, panel goods by the **MSF**, tile by
 * the **box**, lumber by the **MBF**. Three different things are going on and
 * they are not the same at all:
 *
 *   - **Definitional.** A roofing square *is* 100 square feet and an MSF *is*
 *     1000 — those are what the words mean, not estimates, so the price divides
 *     exactly and nobody has to be asked anything.
 *   - **Coverage.** A box of tile covers whatever the box says it covers. That
 *     number is printed on the box and carried in a column on any flooring price
 *     list, so it can be read — but it cannot be assumed, and 4x8 sheets being
 *     32 square feet is true of sheets that are 4x8 and of nothing else.
 *   - **Neither.** A board foot is a volume and a hundredweight is a mass.
 *     Nothing turns those into an area without knowing a thickness or a density
 *     the app was never told, and the rows are refused.
 *
 * The old version of this collapsed all three into "not one of the three units,
 * refused". That was safe and it made a Floor & Decor list — which is priced
 * entirely by the box — import as zero rows.
 */
export type UnitReading =
  /** Already one of the three. */
  | { readonly kind: 'direct'; readonly unit: PriceUnit }
  /**
   * One of the three, times a number the word itself means.
   *
   * `per` is how many of `unit` one of these is, so the price divides by it.
   */
  | { readonly kind: 'definitional'; readonly unit: PriceUnit; readonly per: bigint; readonly said: string }
  /**
   * A metric unit, converted by a factor that is exact as a fraction.
   *
   * A metre is 1/0.3048 feet *by definition* — the international foot has been
   * exactly 0.3048 m since 1959 — so a square metre is exactly 1/0.09290304
   * square feet. That is a ratio of two integers, not a rounded constant, and
   * the price divides by `per` and multiplies by `of` in one step so it is
   * rounded once at the end rather than twice on the way.
   */
  | {
      readonly kind: 'metric';
      readonly unit: PriceUnit;
      readonly per: bigint;
      readonly of: bigint;
      readonly said: string;
    }
  /** Priced by something that covers an area the file has to state. */
  | { readonly kind: 'coverage'; readonly unit: PriceUnit; readonly said: string }
  /** Nothing here can turn it into an area or a length. */
  | { readonly kind: 'unknown'; readonly said: string };

/** Definitional only: each of these is exactly this many of its unit, by name. */
const DEFINITIONAL: readonly {
  readonly words: readonly string[];
  readonly unit: PriceUnit;
  readonly per: bigint;
  readonly said: string;
}[] = [
  // A roofing square is 100 square feet. That is what the word means.
  { words: ['sq', 'square', 'sqs', 'squares', 'roofingsquare'], unit: 'sq ft', per: 100n, said: 'a square is 100 sq ft' },
  // M is the Roman thousand, C the Roman hundred — the old paper and panel
  // trade's units, still on lumberyard price files.
  { words: ['msf', 'msqft', 'thousandsquarefeet'], unit: 'sq ft', per: 1000n, said: 'an MSF is 1,000 sq ft' },
  { words: ['csf', 'hundredsquarefeet'], unit: 'sq ft', per: 100n, said: 'a CSF is 100 sq ft' },
  { words: ['mlf', 'thousandlinealfeet', 'thousandlinearfeet'], unit: 'lf', per: 1000n, said: 'an MLF is 1,000 lf' },
  { words: ['clf', 'hundredlinealfeet'], unit: 'lf', per: 100n, said: 'a CLF is 100 lf' },
  { words: ['dz', 'doz', 'dozen'], unit: 'ea', per: 12n, said: 'a dozen is 12' },
];

/**
 * Metric units, with the exact fractions that convert them.
 *
 * A price per square metre becomes a price per square foot by multiplying by
 * 0.09290304 — which is 9,290,304 over 100,000,000 exactly, because the foot
 * has been exactly 0.3048 m since 1959. Nothing here is a rounded constant.
 *
 * These exist because the metric toggle was a lie about half the app: a
 * contractor reading in millimetres could import nothing, since every published
 * metric price base is in M and M2 and the book prices in feet. Now the price
 * converts on the way in and reads back out in whatever he set.
 */
const METRIC: readonly {
  readonly words: readonly string[];
  readonly unit: PriceUnit;
  /** Divide by this... */
  readonly per: bigint;
  /** ...then multiply by this. One rounding, at the end. */
  readonly of: bigint;
  readonly said: string;
}[] = [
  {
    words: ['m2', 'sqm', 'm²', 'squaremetre', 'squaremeter'],
    unit: 'sq ft',
    per: 100_000_000n,
    of: 9_290_304n,
    said: 'a square metre is 10.7639… sq ft, exactly',
  },
  {
    words: ['m', 'lm', 'lin m', 'metre', 'meter', 'linealmetre', 'linearmeter'],
    unit: 'lf',
    per: 10_000n,
    of: 3_048n,
    said: 'a metre is 3.2808… ft, exactly',
  },
  {
    words: ['cm', 'centimetre', 'centimeter'],
    unit: 'lf',
    per: 1_000_000n,
    of: 3_048n,
    said: 'a centimetre is a hundredth of a metre',
  },
  {
    words: ['mm', 'millimetre', 'millimeter'],
    unit: 'lf',
    per: 10_000_000n,
    of: 3_048n,
    said: 'a millimetre is a thousandth of a metre',
  },
];

/** Priced by a thing that covers an area: how much is on the file, not in here. */
const COVERS_AREA = [
  'box', 'bx', 'carton', 'ctn', 'case', 'sheet', 'sht', 'panel', 'pallet', 'plt',
  'bundle', 'bdl', 'roll', 'pack', 'pk',
];

export function readUnit(text: string): UnitReading {
  const said = text.trim();
  const t = said.toLowerCase().replace(/[.\s()-]/g, '');
  if (t === '') return { kind: 'unknown', said };

  if (['sqft', 'sf', 'ft2', 'squarefoot', 'squarefeet', 'persqft', 'sqfeet'].includes(t)) {
    return { kind: 'direct', unit: 'sq ft' };
  }
  if (['lf', 'linft', 'linealfoot', 'linearfoot', 'linearfeet', 'linealfeet', 'ft', 'foot', 'feet']
    .includes(t)) {
    return { kind: 'direct', unit: 'lf' };
  }
  // `un` is unidade and it is the commonest unit in every published price base
  // tested — 17,511 rows of 35,000. It was not recognised, and every one of
  // them was refused.
  if (['ea', 'each', 'unit', 'un', 'und', 'unid', 'pc', 'pce', 'piece', 'pieces', 'pcs']
    .includes(t)) {
    return { kind: 'direct', unit: 'ea' };
  }

  for (const one of DEFINITIONAL) {
    if (one.words.includes(t)) {
      return { kind: 'definitional', unit: one.unit, per: one.per, said: one.said };
    }
  }
  for (const one of METRIC) {
    if (one.words.includes(t)) {
      return { kind: 'metric', unit: one.unit, per: one.per, of: one.of, said: one.said };
    }
  }
  if (COVERS_AREA.includes(t)) return { kind: 'coverage', unit: 'sq ft', said };
  return { kind: 'unknown', said };
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
  /**
   * Every price that was not the number in the file, and the arithmetic.
   *
   * A rate the app worked out rather than read is a rate somebody has to be
   * able to check — and it is the first one they will query, because it does
   * not match the price list in their hand. So the sum is kept and shown:
   * "$248.00 per square ÷ 100 = $2.48 / sq ft".
   */
  readonly converted: readonly {
    readonly line: number;
    readonly item: string;
    readonly workings: string;
  }[];
}

/**
 * One row, read and checked, before anything decides what to make of it.
 *
 * Split out because there are now two things a confirmed row can become — a
 * rate in the contractor's own book, and a price seen at a named store — and
 * they must be read by the same code. Two readers is two sets of rules about
 * what a square is, and they diverge on the day somebody fixes one of them.
 */
interface ReadRow {
  readonly line: number;
  readonly item: string;
  readonly unit: PriceUnit;
  readonly cents: Cents;
  /** The supplier's own code, or empty. */
  readonly code: string;
  /** Whatever the file called the aisle, or empty. Never invented. */
  readonly category: string;
  /** The arithmetic, when the price was worked out rather than read. Else ''. */
  readonly workings: string;
}

interface ReadRows {
  readonly rows: readonly ReadRow[];
  readonly refused: readonly { readonly line: number; readonly what: string; readonly why: string }[];
  readonly converted: readonly {
    readonly line: number;
    readonly item: string;
    readonly workings: string;
  }[];
}

function readRows(list: ParsedList, mapping: Mapping): ReadRows {
  const rows: ReadRow[] = [];
  const refused: { line: number; what: string; why: string }[] = [];
  const converted: { line: number; item: string; workings: string }[] = [];
  const seen = new Set<string>();

  for (const [i, row] of list.rows.entries()) {
    // +2: one for the heading row, one because people count from one.
    const line = i + 2;
    const name = (row[mapping.item] ?? '').trim();
    const rawUnit = (row[mapping.unit] ?? '').trim();
    const rawPrice = (row[mapping.price] ?? '').trim();
    const code = mapping.code === undefined ? '' : (row[mapping.code] ?? '').trim();
    const category = mapping.category === undefined ? '' : (row[mapping.category] ?? '').trim();
    const rawCoverage =
      mapping.coverage === undefined ? '' : (row[mapping.coverage] ?? '').trim();
    const what = name || code || `line ${line}`;

    if (name === '') {
      refused.push({ line, what, why: 'no name in the item column' });
      continue;
    }

    const reading = readUnit(rawUnit);
    if (reading.kind === 'unknown') {
      refused.push({
        line,
        what,
        why:
          rawUnit === ''
            ? 'no unit'
            : `priced per "${rawUnit}", and nothing here turns that into an area or a length. ` +
              `A board foot is a volume and a hundredweight is a mass; neither becomes square ` +
              `feet without a thickness or a density this app was never told.`,
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

    // How many of the book's unit one priced thing is. Definitional units know
    // their own number; a box knows nothing until the file says so.
    let per: bigint | null = null;
    let hundredths = 100n;
    let workings = '';
    if (reading.kind === 'definitional') {
      per = reading.per * 100n;
      workings = `${money(cents)} per ${rawUnit} ÷ ${reading.per} (${reading.said})`;
    } else if (reading.kind === 'metric') {
      // Divide by `per` and multiply by `of` in one step, so the rounding
      // happens once at the end rather than twice on the way through.
      per = reading.per;
      hundredths = reading.of;
      workings = `${money(cents)} per ${rawUnit} × ${reading.of}/${reading.per} (${reading.said})`;
    } else if (reading.kind === 'coverage') {
      if (rawCoverage === '') {
        refused.push({
          line,
          what,
          why:
            `priced per ${rawUnit}, and the file does not say how much one ${rawUnit} covers. ` +
            `That number is on the box and on any flooring price list — map the column that ` +
            `holds it and this row comes in. It is not assumed: a 4x8 sheet is 32 sq ft and a ` +
            `box of tile is whatever the box says.`,
        });
        continue;
      }
      let covers: bigint;
      try {
        covers = readCoverage(rawCoverage);
      } catch (error) {
        refused.push({
          line,
          what,
          why: `"${rawCoverage}" is not a coverage: ${error instanceof Error ? error.message : String(error)}`,
        });
        continue;
      }
      per = covers;
      hundredths = 100n;
      workings =
        `${money(cents)} per ${rawUnit} ÷ ${rawCoverage} sq ft per ${rawUnit}`;
    }

    let priced = cents;
    if (per !== null) {
      if (per <= 0n) {
        refused.push({ line, what, why: `a ${rawUnit} that covers nothing cannot be priced by area` });
        continue;
      }
      // Exact integer division, rounded half away from zero, once. A derived
      // rate is arithmetic on a quoted price rather than a quoted price itself,
      // so rounding it is honest — and the sum is kept so it can be checked.
      const scaled = cents * hundredths;
      priced = (scaled + per / 2n) / per;
      if (priced <= 0n) {
        refused.push({
          line,
          what,
          why:
            `${money(cents)} spread over ${rawCoverage || rawUnit} comes to less than a cent, ` +
            `so there is no rate to put in the book.`,
        });
        continue;
      }
      workings = `${workings} = ${money(priced)} / ${reading.unit}`;
      converted.push({ line, item: name, workings });
    }

    const key = `${name}|${reading.unit}`;
    if (seen.has(key)) {
      refused.push({
        line,
        what,
        why: `"${name}" per ${reading.unit} is already in this file further up. The first one is ` +
          `kept — two prices for one thing is a question for the supplier, not something to pick ` +
          `between.`,
      });
      continue;
    }
    seen.add(key);

    rows.push({ line, item: name, unit: reading.unit, cents: priced, code, category, workings });
  }

  return { rows, refused, converted };
}

/**
 * What a row's supplier code and arithmetic read as on the rate it becomes.
 *
 * A derived rate has to carry its sum or nobody can check it, and a rate with a
 * supplier code on it can be found again on the supplier's own system. Both,
 * neither, or either — one place, so the two importers cannot disagree.
 */
function noteFor(row: ReadRow): string {
  return [row.code === '' ? '' : `supplier code ${row.code}`, row.workings]
    .filter((part) => part !== '')
    .join(' · ');
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
  const { rows, refused, converted } = readRows(list, mapping);
  return {
    rates: rows.map((row) => {
      const note = noteFor(row);
      return {
        item: row.item,
        unit: row.unit,
        cents: row.cents,
        source: { kind: 'typed' as const, by: `${supplier} price list, imported by ${by}`, at },
        ...(note === '' ? {} : { note }),
      };
    }),
    refused,
    converted,
  };
}

/**
 * The same rows, as prices seen at a named store.
 *
 * The other half of the same file, and the reason `readRows` exists. A price
 * list is a store's prices on the day the store sent it — so what comes out of
 * here is a **sighting**: this item, this store, this day, and the file it came
 * out of as its evidence. Nothing about it is a rate the contractor charges,
 * and putting it in his book is a separate, deliberate tap.
 *
 * `seenAt` is passed in rather than read off a clock for the same reason `at`
 * is above, and it matters more here: a sighting's day is its identity, so a
 * clock inside this function would make re-importing the same list produce a
 * second copy of every price in it.
 */
export function importForVendor(
  list: ParsedList,
  mapping: Mapping,
  storeId: string,
  by: string,
  seenAt: string,
  file: string
): {
  readonly sightings: readonly Sighting[];
  readonly refused: ReadRows['refused'];
  readonly converted: ReadRows['converted'];
} {
  const { rows, refused, converted } = readRows(list, mapping);
  return {
    sightings: rows.map((row) => ({
      storeId,
      item: row.item,
      unit: row.unit,
      cents: row.cents,
      seenAt,
      evidence: { kind: 'list' as const, file, by },
      ...(row.code === '' ? {} : { code: row.code }),
      ...(row.category === '' ? {} : { category: row.category }),
      ...(row.workings === '' ? {} : { note: row.workings }),
    })),
    refused,
    converted,
  };
}

/**
 * How much one priced thing covers, in hundredths of a square foot.
 *
 * Kept in hundredths so "15.5" and "15.53" both divide exactly rather than
 * going through a float. A coverage with more than two places is refused for
 * the same reason a price with four is: it is a number nobody wrote down that
 * way, and rounding it silently moves every rate derived from it.
 */
export function readCoverage(text: string): bigint {
  const cleaned = text.trim().replace(/[\s,]/g, '').replace(/(sq\.?ft\.?|sf|ft2)$/i, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new PriceListError(
      `"${text}" is not a coverage. It should be how many square feet one of them covers — ` +
        `"15.5", the number printed on the box.`
    );
  }
  const [whole, fraction = ''] = cleaned.split('.');
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
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
