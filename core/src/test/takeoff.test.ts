import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength } from '../length.ts';
import { scanned, verified } from '../measurement.ts';
import { type Heading, type Opening, type Room, type Wall } from '../room.ts';
import { roomQuantities, wholeRoom } from '../zone.ts';

/**
 * The four numbers a contractor prices off.
 *
 * Floor and ceiling area, baseboard run, and the wall face that takes drywall
 * and paint. All four have been computable since `quantities()` was written and
 * unreachable, because it wanted a `Zone` and nothing could make one out of a
 * plain room.
 *
 * The arithmetic that matters is what comes *off*: a door takes its width out
 * of the baseboard and its whole opening out of the wall face; a window takes
 * nothing off the baseboard, because the baseboard runs underneath it.
 */

const T0 = '2026-08-24T23:19:00Z';
const FT = 304_800_000n;

function w(id: string, heading: Heading, length: string, openings?: Opening[]): Wall {
  return {
    id,
    heading,
    length: scanned(parseLength(length), parseLength(`50mm`), T0, 'roomplan'),
    ...(openings ? { openings } : {}),
  };
}

function opening(id: string, kind: Opening['kind'], width: string, height: string, at: string): Opening {
  const m = (text: string) => scanned(parseLength(text), parseLength(`50mm`), T0, 'roomplan');
  return { id, kind, width: m(width), height: m(height), offsetFromStart: m(at) };
}

/** 20 ft by 10 ft, 8 ft to the ceiling. Round numbers so the sums are checkable by hand. */
function room(walls: Wall[]): Room {
  return {
    id: 'r1',
    name: 'test room',
    walls,
    ceilingHeight: verified(parseLength(`8'`), 'sam', T0, 'tape'),
  };
}

const plain = room([
  w('south', 'east', `20'`),
  w('east', 'north', `10'`),
  w('north', 'west', `20'`),
  w('west', 'south', `10'`),
]);

/** Square feet from the half-square-nanometre unit areas are kept in. */
const sqFeet = (halfNm2: bigint) => Number(halfNm2) / Number(2n * FT * FT);
/** Linear feet. */
const feet = (nm: bigint) => Number(nm) / Number(FT);

test('an empty box takes the numbers you would work out on paper', () => {
  const q = roomQuantities(plain);
  assert.equal(Math.round(sqFeet(q.floorArea)), 200, 'floor: 20 x 10');
  assert.equal(Math.round(sqFeet(q.ceilingArea)), 200, 'ceiling follows the floor');
  assert.equal(Math.round(feet(q.baseboardRun)), 60, 'baseboard: the whole 60 ft perimeter');
  // 60 ft of wall, 8 ft high.
  assert.equal(Math.round(Number(q.wallFaceArea) / Number(FT * FT)), 480, 'wall face: 60 x 8');
});

test('a door comes off the baseboard; a window does not', () => {
  const withDoor = room([
    w('south', 'east', `20'`, [opening('d1', 'door', `3'`, `6' 8"`, `5'`)]),
    w('east', 'north', `10'`),
    w('north', 'west', `20'`, [opening('w1', 'window', `4'`, `3'`, `8'`)]),
    w('west', 'south', `10'`),
  ]);
  const q = roomQuantities(withDoor);

  // 60 ft less the 3 ft door. The window is above the baseboard, which runs
  // underneath it — take it off and every trim quantity in the product is short.
  assert.equal(Math.round(feet(q.baseboardRun)), 57);

  // 480 sq ft less the door (3 x 6.667 = 20) and the window (4 x 3 = 12).
  assert.equal(Math.round(Number(q.wallFaceArea) / Number(FT * FT)), 448);
});

test('a garage door is a gap, not something to paint', () => {
  // A side of the room with nothing built across it takes no drywall, no paint
  // and no baseboard, and it must not be quietly priced as though it did.
  const open = room([
    w('south', 'east', `20'`),
    w('east', 'north', `10'`),
    w('north', 'west', `20'`),
    { ...w('west', 'south', `10'`), open: true },
  ]);
  const q = roomQuantities(open);

  assert.equal(Math.round(sqFeet(q.floorArea)), 200, 'the floor is still the whole floor');
  assert.equal(Math.round(feet(q.baseboardRun)), 50, 'the open side takes no baseboard');
  assert.equal(Math.round(Number(q.wallFaceArea) / Number(FT * FT)), 400, 'and no paint');
  assert.equal(Math.round(feet(q.openRun)), 10, 'it is reported as a gap, priced separately');
});

test('the whole room becomes a zone with one edge per wall', () => {
  const zone = wholeRoom(plain);
  assert.equal(zone.edges.length, plain.walls.length);
  assert.deepEqual(
    zone.edges.map((e) => e.kind),
    ['built', 'built', 'built', 'built']
  );
  // Every edge spans its whole wall: a room is not a split of anything.
  for (const [i, edge] of zone.edges.entries()) {
    if (edge.kind === 'virtual') continue;
    assert.equal(edge.spanStart, 0n);
    assert.equal(edge.spanEnd, plain.walls[i]!.length.value);
  }
});
