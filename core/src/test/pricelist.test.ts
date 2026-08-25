import { test } from 'node:test';
import assert from 'node:assert/strict';
import { money } from '../price.ts';
import {
  PriceListError,
  importList,
  merge,
  parseList,
  readCoverage,
  readPrice,
  readUnit,
  splitCsv,
} from '../pricelist.ts';

/**
 * A supplier's price list, into the contractor's own book.
 *
 * There is no format to code against. A real list is whatever the lumberyard's
 * system exports — columns in an order nobody agreed, dollar signs in the
 * prices, units written six ways — so these tests are built out of the shapes
 * real exports actually have, and every one of them is a thing that would
 * otherwise be found by a quote coming out wrong.
 */

const AT = '2026-08-26T09:00:00Z';

/* ------------------------------------------------------------------- CSV */

test('a quoted comma is part of the cell, not a new column', () => {
  // Every real export has one: "2x4 STUD, 8FT, KD".
  const rows = splitCsv('code,item,price\nA1,"2x4 STUD, 8FT, KD",4.18\n');
  assert.deepEqual(rows[1], ['A1', '2x4 STUD, 8FT, KD', '4.18']);
});

test('doubled quotes are one quote, and CRLF is one line break', () => {
  const rows = splitCsv('a,b\r\n1,"say ""half"" inch"\r\n');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], ['1', 'say "half" inch']);
});

test('the byte-order mark Excel writes does not break the first heading', () => {
  // It does, silently, and the first column becomes unmatchable.
  const list = parseList('﻿Item,Unit,Price\nboard,SF,1.35\n');
  assert.equal(list.headers[0], 'Item');
  assert.equal(list.guess.item, 0);
});

test('blank lines at the bottom of a file are not rows', () => {
  const rows = splitCsv('a,b\n1,2\n\n\n');
  assert.equal(rows.length, 2);
});

/* --------------------------------------------------------- guessing columns */

test('the columns are guessed from whatever the supplier called them', () => {
  const list = parseList('SKU,Description,U/M,Unit Price\nA1,drywall 1/2,SF,0.42\n');
  assert.equal(list.headers[list.guess.item!], 'Description');
  assert.equal(list.headers[list.guess.unit!], 'U/M');
  assert.equal(list.headers[list.guess.price!], 'Unit Price');
  assert.equal(list.headers[list.guess.code!], 'SKU');
});

test('an exact heading beats a longer one that merely contains the word', () => {
  // "List Price Basis" must not win over "Price".
  const list = parseList('Item,List Price Basis,Price\nx,per sheet,4.18\n');
  assert.equal(list.headers[list.guess.price!], 'Price');
});

test('a file with headings this does not recognise still parses, and guesses nothing', () => {
  // The screen shows the table and asks. Guessing wrong silently is the failure
  // this whole two-step exists to prevent.
  const list = parseList('col1,col2,col3\na,b,c\n');
  assert.equal(list.guess.item, undefined);
  assert.equal(list.guess.price, undefined);
  assert.equal(list.rows.length, 1);
});

test('a file with no rows under its headings is refused', () => {
  assert.throws(() => parseList('Item,Unit,Price\n'), PriceListError);
});

/* ------------------------------------------------------------------ units */

test('the units a supplier writes, in the three this book prices in', () => {
  for (const said of ['SF', 'sq ft', 'SQ. FT.', 'ft2', 'per sq ft']) {
    assert.deepEqual(readUnit(said), { kind: 'direct', unit: 'sq ft' }, said);
  }
  for (const said of ['LF', 'lin ft', 'LINEAL FOOT', 'ft']) {
    assert.deepEqual(readUnit(said), { kind: 'direct', unit: 'lf' }, said);
  }
  for (const said of ['EA', 'each', 'PC', 'pieces']) {
    assert.deepEqual(readUnit(said), { kind: 'direct', unit: 'ea' }, said);
  }
});

test('a unit that IS a number of square feet by definition converts itself', () => {
  // A roofing square is 100 square feet. That is what the word means, not an
  // estimate, so nobody has to be asked anything.
  const square = readUnit('SQ');
  assert.equal(square.kind, 'definitional');
  if (square.kind !== 'definitional') throw new Error('unreachable');
  assert.equal(square.per, 100n);
  assert.equal(square.unit, 'sq ft');

  const definitional = (said: string) => {
    const read = readUnit(said);
    assert.equal(read.kind, 'definitional', said);
    return read as Extract<typeof read, { kind: 'definitional' }>;
  };
  assert.equal(definitional('MSF').per, 1000n);
  assert.equal(definitional('MLF').unit, 'lf');
  assert.equal(definitional('dozen').per, 12n);
});

test('a unit that covers an area says so, and does not guess how much', () => {
  // The number is printed on the box and carried in a column on any flooring
  // price list. It can be read; it cannot be assumed.
  for (const said of ['box', 'CTN', 'carton', 'sheet', 'pallet', 'roll']) {
    assert.equal(readUnit(said).kind, 'coverage', said);
  }
});

test('a unit that is neither is refused rather than guessed at', () => {
  // A board foot is a volume and a hundredweight is a mass. Neither becomes an
  // area without a thickness or a density this app was never told.
  for (const said of ['MBF', 'BF', 'CWT', 'ton', 'gallon', 'lb', '']) {
    assert.equal(readUnit(said).kind, 'unknown', said);
  }
});

/* ------------------------------------------------------------- coverage */

test('a coverage is read exactly, to two places, or refused', () => {
  assert.equal(readCoverage('15.5'), 1550n);
  assert.equal(readCoverage(' 15.53 sq ft '), 1553n);
  assert.equal(readCoverage('32'), 3200n);
  // Three places is a number nobody wrote down that way, and rounding it moves
  // every rate derived from it.
  assert.throws(() => readCoverage('15.533'), PriceListError);
  assert.throws(() => readCoverage('a box'), PriceListError);
});

/* ----------------------------------------------------------------- prices */

test('the wrapping real lists put round a price comes off', () => {
  assert.equal(readPrice('$1,234.56'), 123_456n);
  assert.equal(readPrice(' 0.42 '), 42n);
  assert.equal(readPrice('$8.75/SF'), 875n);
});

test('a fraction of a cent is refused rather than rounded into the book', () => {
  // A list quoting $0.4375 is quoting four places, and rounding here puts a
  // number in the book the supplier never quoted.
  assert.throws(() => readPrice('0.4375'), Error);
  assert.throws(() => readPrice(''), PriceListError);
});

/* ---------------------------------------------------------------- the import */

const file = [
  'SKU,Description,U/M,Unit Price',
  'DW12,"1/2 in drywall, 4x8",SF,0.42',
  'BASE3,"3-1/4 in base, primed",LF,1.18',
  'DOOR30,"30 in hollow core, prehung",EA,68.00',
  'INS15,"R-15 batts",sheet,42.00',
  'MUD5,"all purpose compound",,18.75',
  'TAPE,"drywall tape",LF,not priced',
  'DW12,"1/2 in drywall, 4x8",SF,0.45',
  ',"",EA,4.00',
].join('\n');

test('the rows that can be read become rates, exactly', () => {
  const list = parseList(file);
  const { rates } = importList(list, list.guess as never, 'sam', AT, 'Miller Lumber');
  assert.equal(rates.length, 3);
  assert.equal(money(rates.find((r) => r.item.startsWith('1/2'))!.cents), '$0.42');
  assert.equal(rates.find((r) => r.item.startsWith('3-1/4'))!.unit, 'lf');
  assert.equal(money(rates.find((r) => r.item.startsWith('30 in'))!.cents), '$68.00');
});

test('a roofing square becomes a square-foot rate, exactly, with the sum kept', () => {
  // $248.00 per square is $2.48 a square foot, because a square is 100 sq ft.
  const roofing = parseList(
    ['Item,UOM,Price', '"architectural shingle, 30 yr",SQ,248.00'].join('\n')
  );
  const { rates, converted } = importList(roofing, roofing.guess as never, 'sam', AT, 'ABC Supply');
  assert.equal(rates.length, 1);
  assert.equal(rates[0]!.unit, 'sq ft');
  assert.equal(money(rates[0]!.cents), '$2.48');
  assert.match(converted[0]!.workings, /\$248\.00 per SQ ÷ 100 \(a square is 100 sq ft\) = \$2\.48 \/ sq ft/);
});

test('a box of tile becomes a square-foot rate from the coverage on the file', () => {
  // $54.99 a box over 15.5 sq ft is $3.5477..., which rounds to $3.55. The sum
  // is kept because it is the first number anybody queries — it does not match
  // the price list in their hand.
  const tile = parseList(
    ['SKU,Description,UOM,Coverage,Price', 'T-1,"12x24 porcelain",BOX,15.5,54.99'].join('\n')
  );
  assert.equal(tile.headers[tile.guess.coverage!], 'Coverage');
  const { rates, converted } = importList(tile, tile.guess as never, 'sam', AT, 'Floor & Decor');
  assert.equal(rates.length, 1);
  assert.equal(rates[0]!.unit, 'sq ft');
  assert.equal(money(rates[0]!.cents), '$3.55');
  assert.match(converted[0]!.workings, /\$54\.99 per BOX ÷ 15\.5 sq ft per BOX = \$3\.55 \/ sq ft/);
  assert.match(rates[0]!.note ?? '', /supplier code T-1/);
});

test('a box with no coverage on the file is refused, and says where to find it', () => {
  const tile = parseList(['Description,UOM,Price', '"12x24 porcelain",BOX,54.99'].join('\n'));
  const { rates, refused } = importList(tile, tile.guess as never, 'sam', AT, 'Floor & Decor');
  assert.equal(rates.length, 0);
  assert.match(refused[0]!.why, /does not say how much one BOX covers/);
  assert.match(refused[0]!.why, /map the column that holds it/);
});

test('nothing that was converted is left looking like a quoted price', () => {
  // Every derived rate carries its arithmetic. A rate the app worked out rather
  // than read has to be checkable, because it will be checked.
  const mixed = parseList(
    [
      'Description,UOM,Coverage,Price',
      '"shingle",SQ,,248.00',
      '"12x24 porcelain",BOX,15.5,54.99',
      '"base, primed",LF,,1.18',
    ].join('\n')
  );
  const { rates, converted } = importList(mixed, mixed.guess as never, 'sam', AT, 'yard');
  assert.equal(rates.length, 3);
  assert.equal(converted.length, 2, 'the linear foot one was already a rate');
  for (const rate of rates) {
    const wasConverted = converted.some((c) => c.item === rate.item);
    assert.equal(
      /÷/.test(rate.note ?? ''),
      wasConverted,
      `${rate.item} must ${wasConverted ? '' : 'not '}carry its arithmetic`
    );
  }
});

test('every row that was not imported is named, with its line and the reason', () => {
  // A list of four hundred rows that imports "381 rates" and says nothing about
  // the other nineteen is a list somebody trusts.
  const list = parseList(file);
  const { refused } = importList(list, list.guess as never, 'sam', AT, 'Miller Lumber');
  assert.equal(refused.length, 5);

  const at = (line: number) => refused.find((r) => r.line === line)!;
  // "sheet" covers an area; the file just does not say how much. That is a
  // different answer from "nothing turns this into an area", and it names the
  // fix rather than closing the door.
  assert.match(at(5).why, /does not say how much one sheet covers/);
  assert.match(at(5).why, /It is not assumed/);
  assert.equal(at(6).why, 'no unit');
  assert.match(at(7).why, /"not priced" is not a price/);
  assert.match(at(8).why, /already in this file further up/);
  assert.equal(at(9).why, 'no name in the item column');
});

test('the first price for a thing is kept when a file lists it twice', () => {
  // Two prices for one thing is a question for the supplier, not something for
  // an app to pick between.
  const list = parseList(file);
  const { rates } = importList(list, list.guess as never, 'sam', AT, 'Miller Lumber');
  assert.equal(money(rates.find((r) => r.item.startsWith('1/2'))!.cents), '$0.42');
});

test('a rate remembers which list it came from and which supplier code', () => {
  const list = parseList(file);
  const { rates } = importList(list, list.guess as never, 'sam', AT, 'Miller Lumber');
  const drywall = rates.find((r) => r.item.startsWith('1/2'))!;
  assert.match(
    drywall.source.kind === 'typed' ? drywall.source.by : '',
    /Miller Lumber price list, imported by sam/
  );
  assert.equal(drywall.note, 'supplier code DW12');
});

test('the same file imported twice produces the same rates', () => {
  // Nothing reads a clock inside the import, so a re-import is not a change.
  const list = parseList(file);
  const once = importList(list, list.guess as never, 'sam', AT, 'Miller Lumber');
  const twice = importList(parseList(file), list.guess as never, 'sam', AT, 'Miller Lumber');
  assert.deepEqual(once.rates, twice.rates);
});

/* ------------------------------------------------------------------ merging */

test('an import wins on a collision, and says what changed and by how much', () => {
  // A contractor whose drywall rate moved overnight should find out from the
  // app rather than from a job.
  const list = parseList(file);
  const { rates } = importList(list, list.guess as never, 'sam', AT, 'Miller Lumber');
  const { rates: merged, changed } = merge(
    [
      { item: '1/2 in drywall, 4x8', unit: 'sq ft', cents: 38n, source: { kind: 'typed', by: 'sam', at: AT } },
      { item: 'Floor', unit: 'sq ft', cents: 875n, source: { kind: 'typed', by: 'sam', at: AT } },
    ],
    rates
  );
  assert.equal(changed.length, 1);
  assert.equal(changed[0]!.was, 38n);
  assert.equal(changed[0]!.now, 42n);
  // The contractor's own rate for a line the list says nothing about is untouched.
  assert.equal(merged.find((r) => r.item === 'Floor')!.cents, 875n);
  assert.equal(merged.length, 4);
});

test('a re-import of an unchanged list reports nothing changed', () => {
  const list = parseList(file);
  const { rates } = importList(list, list.guess as never, 'sam', AT, 'Miller Lumber');
  assert.deepEqual(merge(rates, rates).changed, []);
});

test('a column called "Item Number" is not mistaken for the description', () => {
  // A real Menards transaction report has "Item Number" AND "Item Description",
  // in that order, and taking the first thing containing "item" gave a price
  // book full of SKUs — every rate correctly priced and named 1950128, which
  // is useless to whoever reads the quote.
  const list = parseList('Date,Item Number,Item Description,U/M,Amount\n2026-08-04,1950128,"5/8 Type X",EA,14.29\n');
  assert.equal(list.headers[list.guess.item!], 'Item Description');
  assert.equal(list.headers[list.guess.code!], 'Item Number');
  const { rates } = importList(list, list.guess as never, 'sam', AT, 'Menards');
  assert.equal(rates[0]!.item, '5/8 Type X');
  assert.equal(rates[0]!.note, 'supplier code 1950128');
});

test('a file with only a code column still finds it rather than giving up', () => {
  // The fallback: when nothing but a code-shaped header exists, use it. A rate
  // named by its SKU beats no rate at all.
  const list = parseList('Item Number,UOM,Price\n1950128,EA,14.29\n');
  assert.equal(list.headers[list.guess.item!], 'Item Number');
});
