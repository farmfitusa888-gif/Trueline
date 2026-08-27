import { test } from 'node:test';
import assert from 'node:assert/strict';
import { money } from '../price.ts';
import { importForVendor, parseList } from '../pricelist.ts';
import {
  type Sighting,
  type VendorBook,
  NO_FILTER,
  NO_STORES,
  VendorError,
  acrossStores,
  addStore,
  ageInDays,
  asRate,
  chipsFor,
  howOld,
  listings,
  movement,
  percent,
  photoNameFor,
  readVendorBook,
  recordPrice,
  recordPrices,
  removeStore,
  storeById,
  storeId,
  whereFrom,
  writeVendorBook,
} from '../vendor.ts';

/**
 * The stores a contractor buys at, and what each one charged him.
 *
 * Every test here is a way this feature could put a number on a screen that
 * nobody ever saw at that shop. That is the only failure that matters: a price
 * list somebody mistrusts is useless, and a price list somebody trusts and
 * should not is worse than useless.
 */

const NOW = '2026-08-27T09:00:00Z';

function tag(by = 'sam'): Sighting['evidence'] {
  return { kind: 'tag', photo: 'shelf-1.jpg', by };
}
function fromList(file = 'miller.csv'): Sighting['evidence'] {
  return { kind: 'list', file, by: 'sam' };
}

function twoStores(): VendorBook {
  return addStore(addStore(NO_STORES, 'Miller Lumber'), 'Floor & Decor');
}

/** The book every filtering test reads. Five things across two stores. */
function stocked(): VendorBook {
  const rows: Sighting[] = [
    {
      storeId: 'miller-lumber', item: '1/2 in drywall, 4x8', unit: 'sq ft', cents: 42n,
      seenAt: '2026-03-12', evidence: fromList(), code: 'DW12', category: 'Drywall',
    },
    {
      storeId: 'miller-lumber', item: '1/2 in drywall, 4x8', unit: 'sq ft', cents: 45n,
      seenAt: '2026-08-20', evidence: tag(), code: 'DW12', category: 'Drywall',
    },
    {
      storeId: 'miller-lumber', item: '3-1/4 in base, primed', unit: 'lf', cents: 118n,
      seenAt: '2026-08-20', evidence: fromList(), category: 'Trim',
    },
    {
      storeId: 'miller-lumber', item: 'R-15 batts', unit: 'sq ft', cents: 87n,
      seenAt: '2026-01-05', evidence: fromList(), category: 'Insulation',
    },
    {
      storeId: 'floor-decor', item: '12x24 porcelain', unit: 'sq ft', cents: 355n,
      seenAt: '2026-08-25', evidence: fromList('fd.csv'), code: 'T-1', category: 'Tile',
    },
    {
      storeId: 'floor-decor', item: '1/2 in drywall, 4x8', unit: 'sq ft', cents: 39n,
      seenAt: '2026-08-25', evidence: { kind: 'counter', by: 'sam' },
    },
  ];
  return recordPrices(twoStores(), rows, NOW).book;
}

/* ------------------------------------------------------------------ stores */

test('a store is the same store however it was typed', () => {
  // Two books under one name is one book with half the answer in each, and
  // nothing on the screen would say why.
  assert.equal(storeId('Floor & Decor'), 'floor-decor');
  assert.equal(storeId('  floor & decor  '), 'floor-decor');
  assert.equal(storeId("Miller Lumber, Route 9"), 'miller-lumber-route-9');
});

test('a store cannot be added twice, and says so in words', () => {
  const book = addStore(NO_STORES, 'Floor & Decor');
  // A different name is a different store, and that is how somebody keeps two
  // branches apart: "Miller Lumber" and "Miller Lumber, Route 9".
  assert.equal(addStore(book, 'Floor & Decor, Route 9').stores.length, 2);
  assert.throws(
    () => addStore(book, 'FLOOR & DECOR'),
    (error: unknown) => error instanceof VendorError && /already have a store/.test(error.message)
  );
});

test('a store with no name, and one with nothing but punctuation, are refused', () => {
  assert.throws(() => addStore(NO_STORES, '   '), VendorError);
  assert.throws(() => addStore(NO_STORES, '???'), VendorError);
});

test('removing a store takes its prices with it, and says how many', () => {
  // A price whose store is gone is a price from nowhere.
  const gone = removeStore(stocked(), 'miller-lumber');
  assert.equal(gone.dropped, 4, 'four sightings at Miller');
  assert.equal(storeById(gone.book, 'miller-lumber'), undefined);
  assert.equal(gone.book.sightings.every((s) => s.storeId === 'floor-decor'), true);
});

/* ------------------------------------------------------------- writing one down */

test('a price with nowhere to have come from is refused', () => {
  const one: Sighting = {
    storeId: 'nowhere', item: 'drywall', unit: 'sq ft', cents: 42n,
    seenAt: '2026-08-20', evidence: tag(),
  };
  assert.throws(() => recordPrice(twoStores(), one, NOW), VendorError);
});

test('a photographed price tag with no photograph is refused, and names the honest option', () => {
  // Without the picture this is a typed number wearing a better word, and the
  // difference matters on the day somebody asks where the figure came from.
  const book = twoStores();
  const one: Sighting = {
    storeId: 'miller-lumber', item: 'drywall', unit: 'sq ft', cents: 42n,
    seenAt: '2026-08-20', evidence: { kind: 'tag', photo: '  ', by: 'sam' },
  };
  assert.throws(
    () => recordPrice(book, one, NOW),
    (error: unknown) => error instanceof VendorError && /needs the photograph/.test(error.message)
  );
});

test('no name, no price and no date are each refused on their own', () => {
  const book = twoStores();
  const base: Sighting = {
    storeId: 'miller-lumber', item: 'drywall', unit: 'sq ft', cents: 42n,
    seenAt: '2026-08-20', evidence: tag(),
  };
  assert.throws(() => recordPrice(book, { ...base, item: '  ' }, NOW), VendorError);
  assert.throws(() => recordPrice(book, { ...base, cents: 0n }, NOW), VendorError);
  assert.throws(() => recordPrice(book, { ...base, cents: -5n }, NOW), VendorError);
  assert.throws(() => recordPrice(book, { ...base, seenAt: 'March' }, NOW), VendorError);
  assert.throws(
    () => recordPrice(book, { ...base, evidence: { kind: 'counter', by: '' } }, NOW),
    VendorError
  );
});

test('a price seen tomorrow is refused', () => {
  // It would sit at the top of the list of what things cost for ever, and it
  // would never go stale.
  const book = twoStores();
  const one: Sighting = {
    storeId: 'miller-lumber', item: 'drywall', unit: 'sq ft', cents: 42n,
    seenAt: '2026-08-28', evidence: tag(),
  };
  assert.throws(
    () => recordPrice(book, one, NOW),
    (error: unknown) => error instanceof VendorError && /has not happened yet/.test(error.message)
  );
});

test('photographing the same tag twice in one trip is one price, not two', () => {
  const book = twoStores();
  const one: Sighting = {
    storeId: 'miller-lumber', item: 'drywall', unit: 'sq ft', cents: 42n,
    seenAt: '2026-08-20T09:00:00Z', evidence: tag(),
  };
  const twice = recordPrice(
    recordPrice(book, one, NOW),
    { ...one, cents: 44n, seenAt: '2026-08-20T16:30:00Z' },
    NOW
  );
  assert.equal(twice.sightings.length, 1);
  assert.equal(twice.sightings[0]!.cents, 44n, 'the second reading of the same tag wins');
});

test('the same price seen on two different days is two sightings', () => {
  const book = stocked();
  const drywall = book.sightings.filter(
    (s) => s.storeId === 'miller-lumber' && s.item === '1/2 in drywall, 4x8'
  );
  assert.equal(drywall.length, 2);
});

test('a bulk import refuses row by row rather than stopping dead', () => {
  // A list of four hundred rows that stops on row nine is a list nobody
  // imports, and a list that swallows nine is a list nobody should trust.
  const { book, refused } = recordPrices(
    twoStores(),
    [
      { storeId: 'miller-lumber', item: 'good', unit: 'ea', cents: 100n, seenAt: '2026-08-20', evidence: fromList() },
      { storeId: 'nowhere', item: 'orphan', unit: 'ea', cents: 100n, seenAt: '2026-08-20', evidence: fromList() },
      { storeId: 'miller-lumber', item: 'free', unit: 'ea', cents: 0n, seenAt: '2026-08-20', evidence: fromList() },
    ],
    NOW
  );
  assert.equal(book.sightings.length, 1);
  assert.equal(refused.length, 2);
  assert.deepEqual(refused.map((r) => r.item), ['orphan', 'free']);
});

/* -------------------------------------------------------- what is in there */

test('a store dropdown shows that store and never another store’s number', () => {
  // The one thing this feature must never do. Floor & Decor sells drywall at
  // 39 cents in this book and Miller at 45; picking one must not show the other
  // and must not average them.
  const book = stocked();
  const fd = listings(book, { ...NO_FILTER, store: 'floor-decor' }, NOW);
  assert.equal(fd.length, 2);
  assert.equal(fd.every((l) => l.store.id === 'floor-decor'), true);
  const drywall = fd.find((l) => l.price.item === '1/2 in drywall, 4x8')!;
  assert.equal(money(drywall.price.cents), '$0.39');
});

test('the newest price is the price, and the older one is kept behind it', () => {
  const [drywall] = listings(
    stocked(),
    { ...NO_FILTER, store: 'miller-lumber', query: 'DW12' },
    NOW
  );
  assert.equal(money(drywall!.price.cents), '$0.45');
  assert.equal(drywall!.price.seenAt, '2026-08-20');
  assert.equal(drywall!.before.length, 1);
  assert.equal(money(drywall!.before[0]!.cents), '$0.42');
  assert.equal(drywall!.days, 7);
});

test('the search bar wants every word, not any of them', () => {
  // "1/2 drywall" typed into a bar that ORs returns every screw with a 1/2 in
  // it, and the feature is dead on its first use.
  const book = stocked();
  assert.equal(listings(book, { ...NO_FILTER, query: 'drywall' }, NOW).length, 2);
  assert.equal(listings(book, { ...NO_FILTER, query: '1/2 drywall' }, NOW).length, 2);
  assert.equal(listings(book, { ...NO_FILTER, query: 'drywall porcelain' }, NOW).length, 0);
});

test('the search bar finds a thing by the store’s own code and by its aisle', () => {
  const book = stocked();
  assert.equal(listings(book, { ...NO_FILTER, query: 'dw12' }, NOW).length, 1);
  assert.equal(listings(book, { ...NO_FILTER, query: 'Tile' }, NOW).length, 1);
});

test('the chips are counted off the data, and one with nothing behind it is not offered', () => {
  const chips = chipsFor(stocked(), NO_FILTER, NOW);
  const at = (id: string) => chips.find((c) => c.id === id);
  assert.equal(at('unit:sq ft')!.count, 4);
  assert.equal(at('unit:lf')!.count, 1);
  assert.equal(at('from:list')!.count, 3);
  assert.equal(at('from:tag')!.count, 1);
  assert.equal(at('from:counter')!.count, 1);
  assert.equal(at('category:Tile')!.count, 1);
  // Nothing in this book was priced per each, so no such chip exists at all.
  assert.equal(at('unit:ea'), undefined);
});

test('a chip that says twelve produces twelve, because it counts against the others', () => {
  // The bug this exists for: counting every chip against the unfiltered book
  // puts a number on a chip that produces nothing when it is tapped, which is
  // the screen lying about its own contents.
  const book = stocked();
  const filter = { ...NO_FILTER, chips: ['unit:lf'] };
  const chips = chipsFor(book, filter, NOW);
  const at = (id: string) => chips.find((c) => c.id === id);
  // Its own group is still counted across everything — that is what lets
  // somebody see there are four square-foot lines to switch to.
  assert.equal(at('unit:sq ft')!.count, 4);
  // Every other group is counted against the linear-foot line only.
  assert.equal(at('from:list')!.count, 1);
  assert.equal(at('category:Trim')!.count, 1);
  assert.equal(at('category:Tile'), undefined);
  assert.equal(listings(book, filter, NOW).length, 1);
});

test('chips are AND across groups and OR inside one', () => {
  const book = stocked();
  const both = listings(book, { ...NO_FILTER, chips: ['unit:sq ft', 'unit:lf'] }, NOW);
  assert.equal(both.length, 5, 'either unit');
  const neither = listings(book, { ...NO_FILTER, chips: ['unit:lf', 'category:Tile'] }, NOW);
  assert.equal(neither.length, 0, 'no linear-foot tile in this book');
});

test('a price nobody has looked at since January is chipped as old', () => {
  const book = stocked();
  const old = listings(book, { ...NO_FILTER, chips: [`age:old`] }, NOW);
  assert.equal(old.length, 1);
  assert.equal(old[0]!.price.item, 'R-15 batts');
  assert.equal(old[0]!.days, 234);
  assert.equal(howOld(old[0]!.days), 'about 8 months ago');
});

/* ------------------------------------------------------------- how old it is */

test('how old a price is, in the words somebody would say', () => {
  assert.equal(howOld(0), 'today');
  assert.equal(howOld(1), 'yesterday');
  assert.equal(howOld(9), '9 days ago');
  assert.equal(howOld(60), 'about 2 months ago');
  assert.equal(howOld(400), 'over a year ago');
  assert.equal(ageInDays('2026-08-20', NOW), 7);
  assert.equal(ageInDays('2026-08-27T23:00:00Z', NOW), 0);
});

/* ------------------------------------------------------- what the price did */

test('what a store’s price did is arithmetic on two numbers he wrote down', () => {
  // Not an index, not a regional average, not a forecast. $10.00 to $10.82 is
  // 8.2%, and both figures are his own.
  const book = recordPrices(
    twoStores(),
    [
      { storeId: 'miller-lumber', item: 'stud', unit: 'ea', cents: 1000n, seenAt: '2026-03-01', evidence: fromList() },
      { storeId: 'miller-lumber', item: 'stud', unit: 'ea', cents: 1082n, seenAt: '2026-08-01', evidence: tag() },
    ],
    NOW
  ).book;
  const [stud] = listings(book, { ...NO_FILTER, query: 'stud' }, NOW);
  const moved = movement(stud!)!;
  assert.equal(moved.was, 1000n);
  assert.equal(moved.now, 1082n);
  assert.equal(moved.basisPoints, 820);
  assert.equal(moved.days, 153);
  assert.equal(percent(moved.basisPoints), 'up 8.2%');
});

test('one price is not a trend, and the app says nothing rather than drawing a line', () => {
  const [tile] = listings(stocked(), { ...NO_FILTER, query: 'porcelain' }, NOW);
  assert.equal(movement(tile!), null);
});

test('a price that went down says down, and one that did not move says so', () => {
  assert.equal(percent(-758), 'down 7.6%');
  assert.equal(percent(0), 'no change');
  assert.equal(percent(4), 'no change', 'four hundredths of a percent is not a change');
});

/* --------------------------------------------------- across the stores */

test('the same thing at every store that quoted it, cheapest first', () => {
  const both = acrossStores(stocked(), '1/2 in drywall, 4x8', 'sq ft', NOW);
  assert.deepEqual(both.map((l) => l.store.name), ['Floor & Decor', 'Miller Lumber']);
  assert.deepEqual(both.map((l) => money(l.price.cents)), ['$0.39', '$0.45']);
});

test('a store that never quoted it does not appear at all', () => {
  // Not with a blank, not with somebody else's number, not with an average.
  const only = acrossStores(stocked(), '12x24 porcelain', 'sq ft', NOW);
  assert.equal(only.length, 1);
  assert.equal(only[0]!.store.name, 'Floor & Decor');
  assert.deepEqual(acrossStores(stocked(), 'a thing nobody sells', 'ea', NOW), []);
});

/* ------------------------------------------------- into the contractor's book */

test('a store’s price becomes a rate dated when it was seen, not when it was copied', () => {
  // A tag photographed in March is a March price whatever day the button is
  // pressed, and dating it today would quietly make a stale rate look fresh.
  const [drywall] = listings(stocked(), { ...NO_FILTER, store: 'miller-lumber', query: 'dw12' }, NOW);
  const rate = asRate(drywall!);
  assert.equal(rate.item, '1/2 in drywall, 4x8');
  assert.equal(rate.unit, 'sq ft');
  assert.equal(money(rate.cents), '$0.45');
  assert.equal(rate.source.kind, 'typed');
  assert.equal(rate.source.at, '2026-08-20');
  assert.match(rate.source.kind === 'typed' ? rate.source.by : '', /^Miller Lumber — photographed on the shelf/);
  assert.match(rate.note ?? '', /their code DW12/);
  assert.match(rate.note ?? '', /Drywall/);
});

test('where a price came from reads as a sentence, for all three ways in', () => {
  assert.match(whereFrom(fromList('miller.csv')), /price list, miller\.csv/);
  assert.match(whereFrom(tag('Sam')), /photographed on the shelf, confirmed by Sam/);
  assert.match(whereFrom({ kind: 'counter', by: 'Sam' }), /off the counter, written down by Sam/);
});

/* ---------------------------------------------------------- shelf-tag photos */

test('a photograph name is never handed out twice', () => {
  // A collision here shows one price's tag against another price's number,
  // which is the worst single thing this feature could do.
  let book = twoStores();
  const names: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    const photo = photoNameFor(book);
    names.push(photo);
    book = recordPrice(
      book,
      {
        storeId: 'miller-lumber', item: `thing ${i}`, unit: 'ea', cents: 100n,
        seenAt: '2026-08-20', evidence: { kind: 'tag', photo, by: 'sam' },
      },
      NOW
    );
  }
  assert.deepEqual(names, ['shelf-1.jpg', 'shelf-2.jpg', 'shelf-3.jpg', 'shelf-4.jpg']);
  assert.equal(new Set(names).size, 4);
});

/* ------------------------------------------------------------------ storage */

test('the book comes back out of storage with its money still money', () => {
  // `JSON.stringify` throws on a bigint and `JSON.parse` gives an object back.
  // A price that came back as an object would print $NaN against a shop's name.
  const book = stocked();
  const back = readVendorBook(writeVendorBook(book));
  assert.deepEqual(back, book);
  assert.equal(typeof back.sightings[0]!.cents, 'bigint');
});

test('a saved book that does not hold what a book holds comes back empty rather than wrong', () => {
  assert.deepEqual(readVendorBook(null), NO_STORES);
  assert.deepEqual(readVendorBook('not json at all'), NO_STORES);
  assert.deepEqual(readVendorBook('{"stores":"nope"}'), NO_STORES);
});

test('a saved price that lost its money, or its store, is dropped and the rest are kept', () => {
  const text = JSON.stringify({
    stores: [{ id: 'miller-lumber', name: 'Miller Lumber' }],
    sightings: [
      { storeId: 'miller-lumber', item: 'good', unit: 'ea', cents: { $nm: '100' }, seenAt: '2026-08-20', evidence: { kind: 'counter', by: 'sam' } },
      { storeId: 'miller-lumber', item: 'no money', unit: 'ea', cents: 100, seenAt: '2026-08-20', evidence: { kind: 'counter', by: 'sam' } },
      { storeId: 'a-shop-that-was-deleted', item: 'orphan', unit: 'ea', cents: { $nm: '100' }, seenAt: '2026-08-20', evidence: { kind: 'counter', by: 'sam' } },
    ],
  });
  const back = readVendorBook(text);
  assert.equal(back.sightings.length, 1);
  assert.equal(back.sightings[0]!.item, 'good');
});

/* -------------------------------------------- a supplier's list, into a store */

test('a supplier’s CSV becomes prices seen at a named store, on a stated day', () => {
  const list = parseList(
    [
      'SKU,Description,U/M,Category,Price',
      'DW12,"1/2 in drywall, 4x8",SF,Drywall,0.42',
      'SH-30,"architectural shingle",SQ,Roofing,248.00',
      'BAD,"lead-free solder",CWT,Plumbing,412.00',
    ].join('\n')
  );
  assert.equal(list.headers[list.guess.category!], 'Category', 'the aisle column is guessed');

  const { sightings, refused, converted } = importForVendor(
    list, list.guess as never, 'miller-lumber', 'sam', '2026-08-20', 'miller.csv'
  );
  assert.equal(sightings.length, 2);
  assert.equal(refused.length, 1, 'a hundredweight is a mass and stays refused');

  const drywall = sightings.find((s) => s.item.startsWith('1/2'))!;
  assert.equal(drywall.storeId, 'miller-lumber');
  assert.equal(drywall.seenAt, '2026-08-20');
  assert.equal(drywall.category, 'Drywall');
  assert.equal(drywall.code, 'DW12');
  assert.deepEqual(drywall.evidence, { kind: 'list', file: 'miller.csv', by: 'sam' });

  // A square is 100 square feet, so $248.00 a square is $2.48 — and the sum
  // travels with it, because it will not match the list in his hand.
  const shingle = sightings.find((s) => s.item.startsWith('architectural'))!;
  assert.equal(money(shingle.cents), '$2.48');
  assert.match(shingle.note ?? '', /÷ 100/);
  assert.equal(converted.length, 1);
});

test('importing the same list twice does not double the store’s book', () => {
  // A supplier who re-sends an unchanged list must not turn one price into two.
  const list = parseList('SKU,Description,U/M,Price\nDW12,"1/2 in drywall",SF,0.42\n');
  const once = importForVendor(list, list.guess as never, 'miller-lumber', 'sam', '2026-08-20', 'miller.csv');
  const first = recordPrices(twoStores(), once.sightings, NOW).book;
  const again = recordPrices(first, once.sightings, NOW).book;
  assert.equal(first.sightings.length, 1);
  assert.equal(again.sightings.length, 1);
});
