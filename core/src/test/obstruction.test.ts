import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength } from '../length.ts';
import { scanned, verified } from '../measurement.ts';
import { type Heading, type Room, type Wall } from '../room.ts';
import {
  type Footprint,
  DEFAULT_REACH,
  ObstructionError,
  describe as describeObstruction,
  obstructions,
  punchList,
} from '../obstruction.ts';

const T0 = '2026-08-19T14:00:00Z';
const T1 = '2026-08-19T15:30:00Z';

function w(id: string, heading: Heading, length: string, tol = `1"`): Wall {
  return { id, heading, length: scanned(parseLength(length), parseLength(tol), T0, 'roomplan') };
}

/** 20' x 12'. Corners (0,0) (20,0) (20,12) (0,12). North wall runs along y = 0. */
function room(walls?: Wall[]): Room {
  return {
    id: 'r1',
    name: 'living',
    walls: walls ?? [
      w('north', 'east', `20'`), w('east', 'north', `12'`),
      w('south', 'west', `20'`), w('west', 'south', `12'`),
    ],
    ceilingHeight: verified(parseLength(`8'`), 'sam', T1, 'tape'),
  };
}

function box(id: string, category: string, x0: string, y0: string, x1: string, y1: string): Footprint {
  return {
    id, category,
    min: { x: parseLength(x0), y: parseLength(y0) },
    max: { x: parseLength(x1), y: parseLength(y1) },
  };
}

test('a sofa against a wall blocks the stretch it covers', () => {
  // An 8' sofa hard against the north wall, from 4' to 12' along it.
  const sofa = box('sofa', 'sofa', `4'`, `0'`, `12'`, `3'`);
  const north = obstructions(room(), [sofa]).find((o) => o.wallId === 'north')!;

  assert.equal(north.blockedLength, parseLength(`8'`));
  assert.equal(north.blockedPerMille, 400n); // 8' of 20'
  assert.deepEqual(north.by, ['sofa']);
});

test('an empty room blocks nothing', () => {
  for (const o of obstructions(room(), [])) {
    assert.equal(o.blockedLength, 0n);
    assert.equal(o.blockedPerMille, 0n);
    assert.deepEqual(o.by, []);
    assert.equal(describeObstruction(o), 'Nothing against this wall.');
  }
});

test('furniture out in the room does not count as against a wall', () => {
  // A table in the middle, nowhere near anything.
  const table = box('table', 'table', `8'`, `5'`, `12'`, `8'`);
  for (const o of obstructions(room(), [table])) {
    assert.equal(o.blockedLength, 0n, `${o.wallId} should be clear`);
  }
});

test('the reach is what decides "against", and it is a parameter not a fact', () => {
  // A bookcase standing 4" off the north wall.
  const shelf = box('shelf', 'storage', `2'`, `4"`, `8'`, `2'`);
  const withDefault = obstructions(room(), [shelf]).find((o) => o.wallId === 'north')!;
  assert.equal(withDefault.blockedLength, parseLength(`6'`)); // 4" is inside the 6" default

  const strict = obstructions(room(), [shelf], parseLength(`2"`)).find((o) => o.wallId === 'north')!;
  assert.equal(strict.blockedLength, 0n); // at 2" reach it no longer counts
  assert.ok(DEFAULT_REACH > parseLength(`2"`));
});

test('two things side by side against one wall are counted once, not twice', () => {
  const sofa = box('sofa', 'sofa', `2'`, `0'`, `10'`, `3'`);
  const shelf = box('shelf', 'storage', `8'`, `0'`, `14'`, `1'`); // overlaps the sofa by 2'
  const north = obstructions(room(), [sofa, shelf]).find((o) => o.wallId === 'north')!;

  // 2' to 14' is twelve feet of wall, not the fourteen you get by adding them up.
  assert.equal(north.blockedLength, parseLength(`12'`));
  assert.equal(north.blocked.length, 1);
  assert.deepEqual([...north.by].sort(), ['shelf', 'sofa']);
});

test('two things apart on the same wall stay two separate stretches', () => {
  const a = box('a', 'storage', `1'`, `0'`, `4'`, `2'`);
  const b = box('b', 'storage', `12'`, `0'`, `16'`, `2'`);
  const north = obstructions(room(), [a, b]).find((o) => o.wallId === 'north')!;
  assert.equal(north.blocked.length, 2);
  assert.equal(north.blockedLength, parseLength(`7'`));
});

test('it works on walls running the other way too', () => {
  // A refrigerator against the east wall, which runs along x = 20'.
  const fridge = box('fridge', 'refrigerator', `17'`, `2'`, `20'`, `5'`);
  const east = obstructions(room(), [fridge]).find((o) => o.wallId === 'east')!;
  assert.equal(east.blockedLength, parseLength(`3'`));
  assert.equal(east.blockedPerMille, 250n); // 3' of 12'
});

test('a corner unit blocks both walls it touches', () => {
  const corner = box('corner', 'storage', `17'`, `0'`, `20'`, `3'`);
  const all = obstructions(room(), [corner]);
  assert.equal(all.find((o) => o.wallId === 'north')!.blockedLength, parseLength(`3'`));
  assert.equal(all.find((o) => o.wallId === 'east')!.blockedLength, parseLength(`3'`));
});

test('a wall behind something is ranked above one merely uncertain', () => {
  const r = room([
    w('north', 'east', `20'`, `1"`),
    w('east', 'north', `12'`, `1"`),
    w('south', 'west', `20'`, `1"`),
    w('west', 'south', `12'`, `1"`),
  ]);
  // North and south are the same length and the same tolerance. Only north is blocked.
  const wall = box('wall-unit', 'storage', `0'`, `0'`, `20'`, `2'`);
  const list = punchList(r, [wall]);

  assert.equal(list[0]?.wallId, 'north');
  assert.equal(list[0]?.blockedPerMille, 1000n);
  assert.deepEqual(list[0]?.blockedBy, ['wall-unit']);

  const south = list.find((i) => i.wallId === 'south')!;
  assert.equal(south.blockedPerMille, 0n);
  assert.ok(list[0]!.weight > south.weight);
  // Fully blocked counts double against an otherwise identical wall.
  assert.equal(list[0]!.weight, south.weight * 2n);
});

test('once a person has signed for a wall it leaves the list, blocked or not', () => {
  const r = room([
    { id: 'north', heading: 'east', length: verified(parseLength(`20'`), 'sam', T1, 'tape') },
    w('east', 'north', `12'`),
    w('south', 'west', `20'`),
    w('west', 'south', `12'`),
  ]);
  const wall = box('wall-unit', 'storage', `0'`, `0'`, `20'`, `2'`);
  assert.equal(punchList(r, [wall]).some((i) => i.wallId === 'north'), false);
});

test('the punch list is ranked, and honours its limit', () => {
  const r = room([
    w('north', 'east', `20'`, `2"`),
    w('east', 'north', `12'`, `1"`),
    w('south', 'west', `20'`, `1/4"`),
    w('west', 'south', `12'`, `1/8"`),
  ]);
  const list = punchList(r, []);
  assert.equal(list[0]?.wallId, 'north'); // longest and least certain
  const weights = list.map((i) => i.weight);
  assert.deepEqual(weights, [...weights].sort((a, b) => (a === b ? 0 : a > b ? -1 : 1)));
  assert.equal(punchList(r, [], DEFAULT_REACH, 2).length, 2);
});

test('it says something a contractor would actually read', () => {
  const all = obstructions(room(), [box('sofa', 'sofa', `0'`, `0'`, `19'`, `3'`)]);
  const north = all.find((o) => o.wallId === 'north')!;
  assert.match(describeObstruction(north), /Almost all of this wall was behind sofa/);

  const part = obstructions(room(), [box('sofa', 'sofa', `0'`, `0'`, `5'`, `3'`)])
    .find((o) => o.wallId === 'north')!;
  assert.match(describeObstruction(part), /Part of this wall/);

  const two = obstructions(room(), [
    box('a', 'sofa', `0'`, `0'`, `6'`, `3'`),
    box('b', 'storage', `10'`, `0'`, `18'`, `2'`),
  ]).find((o) => o.wallId === 'north')!;
  assert.match(describeObstruction(two), /behind 2 things/);
});

test('a negative reach is refused rather than quietly treated as zero', () => {
  assert.throws(() => obstructions(room(), [], -1n), ObstructionError);
});

test('nothing is ever reported as more blocked than the wall is long', () => {
  // A single object far longer than the wall it stands against.
  const huge = box('huge', 'storage', `-50'`, `0'`, `80'`, `4'`);
  const north = obstructions(room(), [huge]).find((o) => o.wallId === 'north')!;
  assert.equal(north.blockedLength, parseLength(`20'`));
  assert.equal(north.blockedPerMille, 1000n);
});
