import { test } from 'node:test';
import assert from 'node:assert/strict';
import { money } from '../price.ts';
import {
  PriceListError,
  importList,
  merge,
  parseList,
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
    assert.equal(readUnit(said), 'sq ft', said);
  }
  for (const said of ['LF', 'lin ft', 'LINEAL FOOT', 'ft']) {
    assert.equal(readUnit(said), 'lf', said);
  }
  for (const said of ['EA', 'each', 'PC', 'pieces']) assert.equal(readUnit(said), 'ea', said);
});

test('a unit that cannot become one of the three is not guessed at', () => {
  // A price per sheet only becomes a price per square foot if you know how big
  // the sheet is, and the app does not.
  for (const said of ['sheet', 'bundle', 'roll', 'M', 'CWT', '']) {
    assert.equal(readUnit(said), undefined, said);
  }
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

test('every row that was not imported is named, with its line and the reason', () => {
  // A list of four hundred rows that imports "381 rates" and says nothing about
  // the other nineteen is a list somebody trusts.
  const list = parseList(file);
  const { refused } = importList(list, list.guess as never, 'sam', AT, 'Miller Lumber');
  assert.equal(refused.length, 5);

  const at = (line: number) => refused.find((r) => r.line === line)!;
  assert.match(at(5).why, /priced per "sheet"/);
  assert.match(at(5).why, /Nothing is converted/);
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
