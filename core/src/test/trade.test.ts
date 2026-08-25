import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NO_TRADE,
  TRADES,
  describeTrade,
  itemFor,
  order,
  tradeOf,
  wordFor,
} from '../trade.ts';

/**
 * The rule this file exists to hold: a trade changes what is **said** and what
 * comes **first**, and nothing else. It never changes a number, never drops a
 * line, and never orphans a rate somebody has already set.
 */

const LINES = [
  { what: 'Floor' },
  { what: 'Ceiling' },
  { what: 'Wall face' },
  { what: 'Baseboard' },
  { what: 'Opening wrap' },
  { what: 'Studs' },
];

test('every trade leads with lines the takeoff actually produces', () => {
  const known = new Set(LINES.map((l) => l.what));
  // Two more the takeoff produces that this fixture does not carry.
  known.add('Plates');
  known.add('Headers');
  known.add('Outside footprint');
  known.add('Reveal run');
  for (const trade of TRADES) {
    for (const lead of trade.leads) {
      assert.ok(known.has(lead), `${trade.id} leads with "${lead}", which nothing produces`);
    }
  }
});

test('every word a trade uses maps back to a line it renames', () => {
  for (const trade of TRADES) {
    for (const item of Object.keys(trade.says)) {
      // A rename for a line nothing produces is a rename nobody will ever see.
      assert.ok(
        trade.leads.includes(item) ||
          ['Floor', 'Ceiling', 'Wall face', 'Baseboard', 'Opening wrap', 'Reveal run',
           'Studs', 'Plates', 'Headers', 'Outside footprint'].includes(item),
        `${trade.id} renames "${item}", which nothing produces`
      );
    }
  }
});

test('choosing a trade never drops a line', () => {
  for (const trade of TRADES) {
    const sorted = order(trade, LINES);
    assert.equal(sorted.length, LINES.length, trade.id);
    for (const line of LINES) {
      assert.ok(sorted.includes(line), `${trade.id} dropped ${line.what}`);
    }
  }
});

test('a trade leads with its own lines, in its own order', () => {
  const painter = tradeOf('painting');
  const sorted = order(painter, LINES).map((l) => l.what);
  assert.deepEqual(sorted.slice(0, 4), ['Wall face', 'Ceiling', 'Baseboard', 'Opening wrap']);
  // And the rest keep the order the takeoff produced them in.
  assert.deepEqual(sorted.slice(4), ['Floor', 'Studs']);
});

test('a painter and a drywaller say different words for the same number', () => {
  const painter = tradeOf('painting');
  const drywall = tradeOf('drywall');
  assert.equal(wordFor(painter, 'Wall face'), 'Wall paint area');
  assert.equal(wordFor(drywall, 'Wall face'), 'Board area, walls');
  // And a line neither has an opinion about keeps the app's own word.
  assert.equal(wordFor(painter, 'Studs'), 'Studs');
});

test('a rate set under one trade is the same rate under another', () => {
  // This is the one that would quietly cost somebody money. A rate is stored
  // against the app's own item name; if changing trade changed the key, every
  // rate a contractor had set would silently stop applying.
  const painter = tradeOf('painting');
  const drywall = tradeOf('drywall');
  assert.equal(itemFor(painter, wordFor(painter, 'Wall face')), 'Wall face');
  assert.equal(itemFor(drywall, wordFor(drywall, 'Wall face')), 'Wall face');
  assert.equal(
    itemFor(painter, 'Wall paint area'),
    itemFor(drywall, 'Board area, walls'),
    'two trades must resolve their own words to the same underlying line'
  );
});

test('a word nobody renamed resolves to itself', () => {
  const painter = tradeOf('painting');
  assert.equal(itemFor(painter, 'Floor'), 'Floor');
});

test('a trade this version does not know opens in plain words rather than refusing', () => {
  // A saved company from a version that had a trade this one dropped must still
  // open. Refusing to load somebody's work over a vocabulary is not a trade-off
  // worth making.
  const fallback = tradeOf('underwater-basket-weaving');
  assert.equal(fallback.id, NO_TRADE);
  assert.equal(wordFor(fallback, 'Wall face'), 'Wall face');
});

test('what a trade leads with can be said in a sentence', () => {
  const said = describeTrade(tradeOf('flooring'));
  assert.match(said, /Finished floor area/);
  assert.match(said, /Everything else is still there/);
});

test('no two trades share an id', () => {
  const ids = TRADES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});
