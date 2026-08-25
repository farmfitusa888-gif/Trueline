import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { money } from '../price.ts';
import { importList, parseList } from '../pricelist.ts';

/**
 * Every sample supplier list, through the importer, with what comes out pinned.
 *
 * **Every price in those files is invented and none of them is any retailer's.**
 * Every retailer domain is blocked by this build environment, and writing
 * numbers that look like Home Depot's and are not would be worse than having
 * none. What these prove is the part that *can* be verified without a price
 * feed: that the shapes real supplier files arrive in are read correctly, and
 * that every row which cannot be read says why.
 *
 * The shapes are not invented. Researched in August 2026: Home Depot has no
 * native spreadsheet export, Menards has a transaction report, Floor & Decor's
 * Pro app shares quotes by email. So what reaches a phone is a quote, a
 * transaction report or a typed spreadsheet — and the units on them are the
 * trade's own, which is the thing this fixes.
 */

const LISTS = join(dirname(fileURLToPath(import.meta.url)), '../../../web/audit/lists');
const AT = '2026-08-26T09:00:00Z';

function bring(file: string) {
  const list = parseList(readFileSync(join(LISTS, file), 'utf8'));
  return { list, ...importList(list, list.guess as never, 'sam', AT, file) };
}

const rate = (r: ReturnType<typeof bring>, startsWith: string) =>
  r.rates.find((x) => x.item.startsWith(startsWith));

/* ------------------------------------------------------- the counter stores */

test('a Home Depot pro-desk quote: dollar signs, commas in descriptions, mixed units', () => {
  const hd = bring('home-depot-pro-desk.csv');
  check(hd);
  // The description has commas inside quotes and the price has a dollar sign.
  assert.equal(money(rate(hd, '1/2 in. x 4 ft.')!.cents), '$12.98');
  assert.equal(rate(hd, '3-1/4 in.')!.unit, 'lf');
  assert.equal(rate(hd, 'Fiberglass')!.unit, 'sq ft');
  assert.equal(hd.converted.length, 0, 'nothing on this one needed working out');
});

test('a Menards transaction report: a price column not called price, and two trade units', () => {
  const m = bring('menards-transaction-report.csv');
  check(m);
  assert.equal(m.list.headers[m.list.guess.price!], 'Amount');
  // MSF is 1,000 sq ft by definition, so $412.00 is $0.41 a square foot.
  assert.equal(money(rate(m, 'Blown-In')!.cents), '$0.41');
  assert.equal(rate(m, 'Blown-In')!.unit, 'sq ft');
  assert.match(m.converted.find((c) => c.item.startsWith('Blown-In'))!.workings, /an MSF is 1,000 sq ft/);
  // A hundredweight is a mass. It is refused, and the reason says why.
  assert.match(m.refused.find((r) => r.what.startsWith('Roofing Nails'))!.why, /a hundredweight is a mass/);
});

/* -------------------------------------------- the one that needs coverage */

test('a Floor & Decor list is priced by the box, and only imports because of coverage', () => {
  const fd = bring('floor-and-decor-pro.csv');
  check(fd);
  assert.equal(fd.list.headers[fd.list.guess.coverage!], 'Coverage (sq ft)');
  // $54.99 over 15.5 sq ft is $3.5477, which rounds to $3.55.
  assert.equal(money(rate(fd, '12 in. x 24 in.')!.cents), '$3.55');
  // $71.40 over 24 sq ft is exactly $2.975, which rounds to $2.98.
  assert.equal(money(rate(fd, '6 in. x 36 in.')!.cents), '$2.98');
  // $63.12 over 23.64 sq ft is $2.6700..., which is $2.67.
  assert.equal(money(rate(fd, 'Luxury Vinyl')!.cents), '$2.67');
  // And the ones already in a unit the book prices in are untouched.
  assert.equal(money(rate(fd, 'Unsanded Grout')!.cents), '$18.99');
  assert.equal(rate(fd, 'Natural Stone Sill')!.unit, 'lf');
  assert.equal(fd.converted.length, 4, 'four rows priced by the box or the roll');
});

test('without the coverage column that same list imports almost nothing', () => {
  // The check that coverage is load-bearing rather than decorative.
  const list = parseList(readFileSync(join(LISTS, 'floor-and-decor-pro.csv'), 'utf8'));
  const { coverage: _dropped, ...blind } = list.guess as { coverage?: number } & Record<string, number>;
  const without = importList(list, blind as never, 'sam', AT, 'Floor & Decor');
  assert.equal(without.rates.length, 2, 'only the grout and the sill, which were already priced by unit');
  const lost = without.refused.filter((r) => /does not say how much one/.test(r.why));
  assert.equal(lost.length, 4, 'three boxes and a roll, all of them the money on a flooring job');
});

/* --------------------------------------------- definitional, and refusals */

test('a roofing list converts the square by definition and refuses the rest honestly', () => {
  const abc = bring('abc-supply-roofing.csv');
  check(abc);
  // A square is 100 sq ft, so $248.00 a square is $2.48 a square foot.
  assert.equal(money(rate(abc, 'Architectural')!.cents), '$2.48');
  assert.equal(money(rate(abc, 'Three-Tab')!.cents), '$1.87', '$186.50 / 100 rounds up');
  // A 10-square roll covering 1000 sq ft: $142.00 / 1000 = $0.14.
  assert.equal(money(rate(abc, 'Synthetic')!.cents), '$0.14');
  assert.equal(rate(abc, 'Drip Edge')!.unit, 'lf');
  // A bundle with no coverage, and nails by the hundredweight.
  assert.match(abc.refused.find((r) => r.what.startsWith('Ice and Water'))!.why, /how much one BUNDLE covers/);
  assert.match(abc.refused.find((r) => r.what.startsWith('Roofing Coil'))!.why, /hundredweight is a mass/);
});

test('a plumbing list: dozens divide, copper is already linear feet, solder is refused', () => {
  const f = bring('ferguson-plumbing.csv');
  check(f);
  // $74.16 a dozen is exactly $6.18 each.
  assert.equal(money(rate(f, '16 in. Braided')!.cents), '$6.18');
  assert.equal(rate(f, '16 in. Braided')!.unit, 'ea');
  assert.equal(rate(f, '3/4 in. Type L')!.unit, 'lf');
  assert.match(f.refused.find((r) => r.what.startsWith('Lead-Free'))!.why, /hundredweight is a mass/);
});

test('paint by the gallon is refused, because a gallon is not an area or a length', () => {
  const sw = bring('sherwin-williams-paint.csv');
  check(sw);
  // Three gallons refused; the caulk and the tape come in as each.
  assert.equal(sw.rates.length, 2);
  assert.equal(rate(sw, "Painter's Caulk")!.unit, 'ea');
  for (const gallon of ['ProMar 200 Zero VOC Eggshell', 'PVA Drywall Primer']) {
    assert.match(sw.refused.find((r) => r.what === gallon)!.why, /nothing here turns that into an area/);
  }
});

/* ------------------------------------------------ true of every one of them */

/**
 * What must hold whatever the file looks like.
 *
 * Run against every sample rather than written out six times: a rule that only
 * holds for the file somebody remembered to check it against is not a rule.
 */
function check(brought: ReturnType<typeof bring>): void {
  const { rates, refused, converted, list } = brought;
  assert.ok(rates.length + refused.length >= list.rows.length - 1,
    'every row either became a rate or was named as refused');
  for (const r of rates) {
    assert.ok(r.cents > 0n, `${r.item} priced at nothing`);
    assert.ok(['sq ft', 'lf', 'ea'].includes(r.unit), `${r.item} in ${r.unit}`);
    assert.ok(r.item.trim() !== '');
  }
  for (const r of refused) {
    assert.ok(r.why.trim().length > 20, `line ${r.line} refused with barely a reason: ${r.why}`);
    assert.ok(r.line >= 2, 'line numbers count the heading row and start at one');
  }
  // Every derived rate carries its arithmetic; nothing read straight off the
  // file pretends to have been worked out.
  for (const c of converted) assert.match(c.workings, /÷.*=/);
  for (const r of rates) {
    const derived = converted.some((c) => c.item === r.item);
    assert.equal(/÷/.test(r.note ?? ''), derived, `${r.item}`);
  }
  // The first row of every sample says what it is. It must not become a rate.
  assert.equal(rates.some((r) => /NOT REAL PRICES/.test(r.item)), false,
    'the "these are not real prices" line imported as a rate');
}
