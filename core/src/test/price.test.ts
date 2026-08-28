import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength } from '../length.ts';
import { scanned, verified, verify } from '../measurement.ts';
import type { Heading, Room, Wall } from '../room.ts';
import { takeoff } from '../takeoff.ts';
import {
  type JobRecord,
  type PriceBook,
  type Rate,
  ENOUGH_JOBS,
  PriceError,
  learn,
  money,
  parseMoney,
  quote,
} from '../price.ts';

/**
 * Money, under the same rule as everything else here: **nothing invents a
 * price.**
 *
 * Quantities come from the geometry, rates come from a book the contractor
 * typed, and the arithmetic between them is multiplication. No market data, no
 * regional average, no model guessing what drywall costs. A number a contractor
 * cannot defend line by line to a client is worse than no number, in exactly the
 * way an unchecked scan is worse than an honest "I have not measured it yet".
 *
 * And integer cents throughout, never a float — the same rule the ledger in
 * Plumbline runs on.
 */

const T0 = '2026-08-25T20:00:00Z';
const scan = (text: string) => scanned(parseLength(text), parseLength(`50mm`), T0, 'roomplan');

function w(id: string, heading: Heading, length: string): Wall {
  return { id, heading, length: scan(length) };
}

/** 20 x 10, 8 ft. Round numbers so every total below is checkable by hand. */
const room: Room = {
  id: 'r1',
  name: 'kitchen',
  walls: [
    w('south', 'east', `20'`),
    w('east', 'north', `10'`),
    w('north', 'west', `20'`),
    w('west', 'south', `10'`),
  ],
  ceilingHeight: verified(parseLength(`8'`), 'sam', T0, 'tape'),
};

const typed = (item: string, unit: Rate['unit'], cents: bigint): Rate => ({
  item,
  unit,
  cents,
  source: { kind: 'typed', by: 'gilbert', at: T0 },
});

const book: PriceBook = {
  rates: [
    typed('Floor', 'sq ft', 875n),
    typed('Ceiling', 'sq ft', 340n),
    typed('Wall face', 'sq ft', 285n),
    typed('Baseboard', 'lf', 640n),
  ],
};

/* -------------------------------------------------------------- the money */

test('money is cents, and reads back the way a person writes it', () => {
  assert.equal(money(125_000n), '$1,250.00');
  assert.equal(money(5n), '$0.05');
  assert.equal(money(0n), '$0.00');
  assert.equal(money(-125_000n), '-$1,250.00');
  assert.equal(money(1_234_567_890n), '$12,345,678.90');
});

test('typing an amount gives exact cents, whatever punctuation somebody used', () => {
  assert.equal(parseMoney('12.50'), 1250n);
  assert.equal(parseMoney('$12.50'), 1250n);
  assert.equal(parseMoney('1,250'), 125_000n);
  assert.equal(parseMoney(' 8.7 '), 870n);
  assert.equal(parseMoney('0.05'), 5n);
});

test('a fraction of a cent is refused rather than rounded out of sight', () => {
  // A rate that quietly lost a third of a cent is off by a few dollars across a
  // house, and nobody would ever find out why.
  assert.throws(() => parseMoney('12.505'), PriceError);
  assert.throws(() => parseMoney('twelve fifty'), PriceError);
  assert.throws(() => parseMoney(''), PriceError);
});

/* ------------------------------------------------------------- the quote */

test('every line is a rate times a quantity, and the arithmetic is checkable by hand', () => {
  const sheet = takeoff(room, T0);
  const q = quote(sheet.lines, book);

  // 200.0 sq ft at $8.75 is $1,750.00 exactly.
  const floor = q.lines.find((l) => l.item === 'Floor')!;
  assert.equal(floor.total, 175_000n);
  assert.equal(money(floor.total), '$1,750.00');

  // 480.0 sq ft of wall face at $2.85 is $1,368.00.
  assert.equal(q.lines.find((l) => l.item === 'Wall face')!.total, 136_800n);
  // 60.00 lf of base at $6.40 is $384.00.
  assert.equal(q.lines.find((l) => l.item === 'Baseboard')!.total, 38_400n);

  // And the subtotal is the column added up, to the cent.
  assert.equal(q.subtotal, q.lines.reduce((sum, l) => sum + l.total, 0n));
});

test('a takeoff line with no rate is named, never priced at nothing', () => {
  // A quote missing the flooring because nobody set a flooring rate is a quote
  // that adds up perfectly and is short by a floor.
  const sheet = takeoff(room, T0);
  const q = quote(sheet.lines, { rates: [typed('Floor', 'sq ft', 875n)] });
  assert.equal(q.lines.length, 1);
  assert.deepEqual(q.unpriced, ['Ceiling', 'Wall face', 'Baseboard']);
  assert.equal(q.subtotal, 175_000n);
});

test('a rate against the wrong unit does not silently apply', () => {
  // $6.40 per square foot of baseboard is not a thing, and matching on the name
  // alone would have charged it.
  const sheet = takeoff(room, T0);
  const q = quote(sheet.lines, { rates: [typed('Baseboard', 'sq ft', 640n)] });
  assert.equal(q.lines.length, 0);
  assert.ok(q.unpriced.includes('Baseboard'));
});

test('the margin is basis points and rounds once, to the cent', () => {
  const sheet = takeoff(room, T0);
  const q = quote(sheet.lines, { ...book, marginBasisPoints: 1500 });
  assert.equal(q.margin, (q.subtotal * 1500n + 5000n) / 10_000n);
  assert.equal(q.total, q.subtotal + q.margin);
  // And with no margin set there is none, rather than a default somebody did
  // not choose.
  assert.equal(quote(sheet.lines, book).margin, 0n);
  assert.equal(quote(sheet.lines, book).total, quote(sheet.lines, book).subtotal);
});

test('the quote prices the number on the sheet, not one behind it', () => {
  // The client is looking at "411.8 sq ft". A quote that priced 411.75 while the
  // sheet said 411.8 is a quote nobody can check by hand, and being right to a
  // hundredth is worth less than being addable.
  const odd: Room = {
    ...room,
    walls: [
      w('south', 'east', `20' 1 1/2"`),
      w('east', 'north', `10'`),
      w('north', 'west', `20' 1 1/2"`),
      w('west', 'south', `10'`),
    ],
  };
  const sheet = takeoff(odd, T0);
  const line = sheet.lines.find((l) => l.what === 'Floor')!;
  const priced = quote(sheet.lines, book).lines.find((l) => l.item === 'Floor')!;
  assert.equal(priced.quantity, line.quantity);
  // Exactly the number on the sheet times the rate.
  const shown = Math.round(Number(line.quantity) * 100);
  assert.equal(priced.total, (875n * BigInt(shown) + 50n) / 100n);
});

test('money resting on a scan says so, and stops saying it once a tape has been on it', () => {
  const sheet = takeoff(room, T0);
  assert.equal(quote(sheet.lines, book).measured, false);

  const measured: Room = {
    ...room,
    walls: room.walls.map((wall) => ({
      ...wall,
      length: verify(wall.length, wall.length.value, 'sam', T0, 'tape'),
    })),
  };
  assert.equal(quote(takeoff(measured, T0).lines, book).measured, true);
});

test('an empty book prices nothing and claims nothing', () => {
  const q = quote(takeoff(room, T0).lines, { rates: [] });
  assert.equal(q.total, 0n);
  assert.equal(q.measured, false, 'a quote with no lines has not been measured, it is empty');
  assert.ok(q.unpriced.length > 0);
});

/* ---------------------------------------------------------- the learning */

const job = (name: string, outcome: JobRecord['outcome'], floor: bigint): JobRecord => ({
  id: name,
  name,
  outcome,
  at: T0,
  rates: [{ item: 'Floor', unit: 'sq ft', cents: floor }],
});

test('nothing is learned until enough jobs agree', () => {
  assert.deepEqual(learn([job('a', 'won', 800n), job('b', 'won', 900n)]), []);
  assert.equal(learn([job('a', 'won', 800n), job('b', 'won', 900n), job('c', 'won', 850n)]).length, 1);
  assert.equal(ENOUGH_JOBS, 3);
});

test('only jobs that were won teach anything', () => {
  // A price nobody accepted is evidence of what was asked and nothing else. An
  // app that learned from rejected quotes would walk a contractor's prices
  // steadily upward until he stopped winning work.
  const mixed = [
    job('a', 'won', 800n),
    job('b', 'lost', 2000n),
    job('c', 'quoted', 2000n),
    job('d', 'won', 850n),
    job('e', 'won', 900n),
  ];
  const [learned] = learn(mixed);
  assert.equal(learned!.cents, 850n, 'the lost job at $20 moved the number');
  assert.equal(learned!.source.kind, 'learned');
  assert.deepEqual(
    learned!.source.kind === 'learned' ? learned!.source.from : [],
    ['a', 'd', 'e'],
    'the jobs it came from have to be nameable'
  );
});

test('the middle, not the average, so one emergency job does not move the book', () => {
  const wild = [
    job('a', 'won', 800n),
    job('b', 'won', 820n),
    job('c', 'won', 840n),
    job('d', 'won', 860n),
    job('e', 'won', 9000n),
  ];
  const [learned] = learn(wild);
  assert.equal(learned!.cents, 840n);
  // And it is a rate this contractor has actually charged, rather than an
  // average of two he never has.
  assert.ok(wild.some((j) => j.rates[0]!.cents === learned!.cents));
});

test('a learned rate and a typed one are different claims and say which they are', () => {
  const [learned] = learn([job('a', 'won', 800n), job('b', 'won', 800n), job('c', 'won', 800n)]);
  assert.equal(learned!.source.kind, 'learned');
  assert.equal(typed('Floor', 'sq ft', 800n).source.kind, 'typed');
});

test('a price book saved under the old name still carries its mark-up', () => {
  // `marginBasisPoints` was never a margin: it is added on top of the subtotal,
  // which makes it a mark-up. It was renamed, and every price book already on a
  // phone and inside every saved job file carries the old key. Dropping it
  // would take a contractor's mark-up to zero on the quiet, which is money.
  const sheet = takeoff(room, T0);
  const was = quote(sheet.lines, { ...book, marginBasisPoints: 1500 });
  const now = quote(sheet.lines, { ...book, markupBasisPoints: 1500 });
  assert.equal(was.total, now.total);
  assert.notEqual(was.margin, 0n);
});

test('and the new name wins where a book somehow carries both', () => {
  // Only one is ever written, so this is a book that has been edited by hand
  // or by a half-finished migration. The one this version writes is the one to
  // believe; guessing between them is how a total goes wrong in silence.
  const sheet = takeoff(room, T0);
  const both = quote(sheet.lines, {
    ...book,
    marginBasisPoints: 9900,
    markupBasisPoints: 1500,
  });
  const plain = quote(sheet.lines, { ...book, markupBasisPoints: 1500 });
  assert.equal(both.total, plain.total);
});
