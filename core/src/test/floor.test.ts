import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatFeetInches, parseLength } from '../length.ts';
import { scanned, verified } from '../measurement.ts';
import { type Heading, type Opening, type Point, type Room, type Wall, area, runLength } from '../room.ts';
import {
  type Floor,
  type Join,
  type Placed,
  FloorError,
  floorExtent,
  floorQuantities,
  layout,
  overlaps,
  turnPoint,
} from '../floor.ts';

/**
 * Two rooms, and the place every scanner in the field gives up.
 *
 * Apple's own limit is one floor and one plane, each room arriving in its own
 * coordinate system, and a merge that "optimises the final model's appearance at
 * the expense of accuracy". Nothing here guesses how rooms fit together — a
 * person says which door is which door, and from there the placement is
 * arithmetic rather than a fit.
 */

const T0 = '2026-08-25T14:00:00Z';
const scan = (text: string) => scanned(parseLength(text), parseLength(`50mm`), T0, 'roomplan');
const said = (text: string) => verified(parseLength(text), 'sam', T0, 'stated');

function w(id: string, heading: Heading, length: string, openings?: Opening[]): Wall {
  return { id, heading, length: scan(length), ...(openings ? { openings } : {}) };
}

function door(id: string, at: string, width = `3'`): Opening {
  return {
    id,
    kind: 'door',
    width: scan(width),
    height: scan(`6' 8"`),
    offsetFromStart: scan(at),
  };
}

function makeRoom(id: string, name: string, walls: Wall[], thickness = `4 1/2"`): Room {
  return {
    id,
    name,
    walls,
    ceilingHeight: verified(parseLength(`8'`), 'sam', T0, 'tape'),
    wallThickness: said(thickness),
  };
}

/**
 * A kitchen 20 x 12, walked anticlockwise from its south-west corner, with a
 * door 8 ft along its north wall.
 *
 * The door's middle is therefore 20 - 8 - 1.5 = 10.5 ft from the west end of
 * that wall, which is the number the placements below are checked against.
 */
const kitchen = makeRoom('k', 'kitchen', [
  w('k-south', 'east', `20'`),
  w('k-east', 'north', `12'`),
  w('k-north', 'west', `20'`, [door('k-door', `8'`)]),
  w('k-west', 'south', `12'`),
]);

/** A hall 20 x 8 with a door 9 ft along its south wall — the same door. */
const hall = makeRoom('h', 'hall', [
  w('h-south', 'east', `20'`, [door('h-door', `9'`)]),
  w('h-east', 'north', `8'`),
  w('h-north', 'west', `20'`),
  w('h-west', 'south', `8'`),
]);

const join = (id: string, from: Join['from'], to: Join['to']): Join => ({
  id,
  declaredBy: 'sam',
  declaredAt: T0,
  from,
  to,
});

const floor: Floor = {
  id: 'f1',
  name: 'ground floor',
  rooms: [kitchen, hall],
  joins: [
    join(
      'front-door',
      { roomId: 'k', wallId: 'k-north', openingId: 'k-door' },
      { roomId: 'h', wallId: 'h-south', openingId: 'h-door' }
    ),
  ],
};

const FT = parseLength(`1'`);

/* ------------------------------------------------------------ turning */

test('a quarter turn is exact and four of them come back', () => {
  const p = { x: 3n, y: 7n };
  assert.deepEqual(turnPoint(p, 1), { x: -7n, y: 3n });
  assert.deepEqual(turnPoint(turnPoint(p, 1), 1), turnPoint(p, 2));
  assert.deepEqual(turnPoint(turnPoint(turnPoint(turnPoint(p, 1), 1), 1), 1), p);
});

/* ------------------------------------------------------------ placing */

test('the first room keeps its own coordinates, so one room is itself', () => {
  const one: Floor = { ...floor, rooms: [kitchen], joins: [] };
  const { placed } = layout(one);
  assert.equal(placed.length, 1);
  assert.equal(placed[0]!.placement.turn, 0);
  assert.deepEqual(placed[0]!.placement.offset, { x: 0n, y: 0n });
});

test('two rooms through one door land back to back, separated by the wall', () => {
  const { placed, unplaced, notes } = layout(floor);
  assert.equal(unplaced.length, 0);
  assert.deepEqual(notes, [], `unexpected: ${notes.map((n) => n.what).join('; ')}`);

  const put = placed.find((p) => p.room.id === 'h')!;
  // The kitchen's north wall runs west; the hall's south wall runs east. Back to
  // back already, so no turn at all.
  assert.equal(put.placement.turn, 0);

  // The hall sits directly north of the kitchen, 12 ft of kitchen plus the
  // 4 1/2 inch wall between them.
  const northmost = Math.max(...put.outline.map((p) => Number(p.y)));
  const southmost = Math.min(...put.outline.map((p) => Number(p.y)));
  assert.equal(BigInt(southmost), 12n * FT + parseLength(`4 1/2"`));
  assert.equal(BigInt(northmost) - BigInt(southmost), 8n * FT);
});

/**
 * Where a join's two door middles actually end up on the floor.
 *
 * Computed the long way — walk the placed outline to the wall, step along it to
 * the middle of the opening — so this is checking the placement rather than
 * restating it.
 */
function doorMiddleOnFloor(placed: readonly Placed[], where: Join['from']): Point {
  const p = placed.find((x) => x.room.id === where.roomId)!;
  const index = p.room.walls.findIndex((x) => x.id === where.wallId);
  const wall = p.room.walls[index]!;
  const opening = wall.openings!.find((o) => o.id === where.openingId)!;
  const from = p.outline[index]!;
  const to = p.outline[(index + 1) % p.outline.length]!;
  const middle = opening.offsetFromStart.value + opening.width.value / 2n;
  const length = runLength(wall);
  return {
    x: from.x + ((to.x - from.x) * middle) / length,
    y: from.y + ((to.y - from.y) * middle) / length,
  };
}

test('the two doorways end up in the same place, one wall thickness apart', () => {
  // This is the whole placement in one assertion. The two openings are the same
  // hole, so their middles are the same point — except across the thickness of
  // the wall between them, because each outline is its own room's inside face.
  const { placed } = layout(floor);
  const j = floor.joins[0]!;
  const a = doorMiddleOnFloor(placed, j.from);
  const b = doorMiddleOnFloor(placed, j.to);
  assert.equal(a.x, b.x, 'the two doorways are not over each other');
  assert.equal(b.y - a.y, parseLength(`4 1/2"`), 'not separated by the wall between them');
});

test('with no wall between them the two doorways land exactly on top of each other', () => {
  const thin: Floor = {
    ...floor,
    rooms: floor.rooms.map((r) => {
      const { wallThickness: _dropped, ...bare } = r;
      return bare;
    }),
  };
  const { placed } = layout(thin);
  const j = thin.joins[0]!;
  assert.deepEqual(doorMiddleOnFloor(placed, j.from), doorMiddleOnFloor(placed, j.to));
});

test('a room walked the other way round still lands outside the first one', () => {
  // The same hall, scanned starting from a different corner, which also walks
  // its outline the other way round. This is the case that broke the first
  // version: it placed the two rooms by requiring the shared wall to be
  // traversed in opposite directions, which is only true when both outlines
  // happen to be walked the same way — and a second scan is not obliged to
  // match. The hall landed inside the kitchen and the loop check caught it,
  // 9 inches out, which is twice the wall thickness.
  //
  // The constraint that is actually true is about the rooms, not the walking:
  // they are on opposite sides of the wall, so its outward normal points at the
  // other room from either side.
  const sideways = makeRoom('h2', 'hall', [
    w('h-west', 'north', `20'`, [door('h-door', `9'`)]),
    w('h-north', 'east', `8'`),
    w('h-east', 'south', `20'`),
    w('h-south', 'west', `8'`),
  ]);
  const turned: Floor = {
    ...floor,
    rooms: [kitchen, sideways],
    joins: [
      join(
        'front-door',
        { roomId: 'k', wallId: 'k-north', openingId: 'k-door' },
        { roomId: 'h2', wallId: 'h-west', openingId: 'h-door' }
      ),
    ],
  };
  const { placed, notes } = layout(turned);
  assert.deepEqual(notes, []);
  const put = placed.find((p) => p.room.id === 'h2')!;
  assert.ok([1, 3].includes(put.placement.turn), `turned by ${put.placement.turn} quarters`);
  // However it was scanned, it ends up north of the kitchen with the wall
  // between them — outside it, not inside it.
  const southmost = Math.min(...put.outline.map((p) => Number(p.y)));
  assert.equal(BigInt(southmost), 12n * FT + parseLength(`4 1/2"`));
  assert.deepEqual(overlaps(placed), [], 'the hall was placed inside the kitchen');

  // And the doorways still meet, which is the thing the placement is for.
  const j = turned.joins[0]!;
  const a = doorMiddleOnFloor(placed, j.from);
  const b = doorMiddleOnFloor(placed, j.to);
  assert.equal(a.x, b.x);
  assert.equal(b.y - a.y, parseLength(`4 1/2"`));
});

/* ---------------------------------------------------------- what it refuses */

test('two openings that cannot be back to back are refused, and it says why', () => {
  const wrong: Floor = {
    ...floor,
    joins: [
      join(
        'wrong',
        { roomId: 'k', wallId: 'k-north', openingId: 'k-door' },
        // The hall's *east* wall, which runs north — no quarter turn puts it
        // back to back with a wall running west.
        { roomId: 'h', wallId: 'h-east', openingId: 'h-door' }
      ),
    ],
  };
  assert.throws(() => layout(wrong), FloorError);
});

test('a join naming a door that is not there is refused', () => {
  const wrong: Floor = {
    ...floor,
    joins: [
      join(
        'wrong',
        { roomId: 'k', wallId: 'k-north', openingId: 'nope' },
        { roomId: 'h', wallId: 'h-south', openingId: 'h-door' }
      ),
    ],
  };
  assert.throws(() => layout(wrong), FloorError);
});

/* ------------------------------------------------------- what it reports */

test('a room nothing connects to is named rather than dropped', () => {
  const lonely = makeRoom('b', 'bathroom', [
    w('b-south', 'east', `8'`),
    w('b-east', 'north', `6'`),
    w('b-north', 'west', `8'`),
    w('b-west', 'south', `6'`),
  ]);
  const { placed, unplaced, notes } = layout({ ...floor, rooms: [...floor.rooms, lonely] });
  assert.deepEqual(unplaced, ['b']);
  assert.equal(placed.length, 2);
  assert.match(notes.find((n) => n.kind === 'unreachable')!.what, /bathroom/);
});

test('a wall nobody has given a thickness draws the rooms touching, and says so', () => {
  const thin: Floor = {
    ...floor,
    rooms: floor.rooms.map((r) => {
      const { wallThickness: _dropped, ...bare } = r;
      return bare;
    }),
  };
  const { placed, notes } = layout(thin);
  const note = notes.find((n) => n.kind === 'no-thickness');
  assert.ok(note, 'a floor drawn short by a wall thickness must say so');
  assert.match(note.what, /drawn touching/);
  // And the hall really is touching: no gap at all.
  const put = placed.find((p) => p.room.id === 'h')!;
  assert.equal(BigInt(Math.min(...put.outline.map((p) => Number(p.y)))), 12n * FT);
});

test('a loop that does not close reports by how much, and does not smooth it away', () => {
  // Three rooms in a ring. The third is deliberately a foot short, which is
  // exactly what three separate scans of the same corridor look like.
  const a = makeRoom('a', 'A', [
    w('a-s', 'east', `10'`, [door('a-e', `8'`, `2'`)]),
    w('a-e', 'north', `10'`, [door('a-n', `4'`, `2'`)]),
    w('a-n', 'west', `10'`),
    w('a-w', 'south', `10'`),
  ]);
  const b = makeRoom('b', 'B', [
    w('b-s', 'east', `10'`),
    w('b-e', 'north', `10'`),
    w('b-n', 'west', `10'`, [door('b-n', `2'`, `2'`)]),
    w('b-w', 'south', `10'`, [door('b-w', `4'`, `2'`)]),
  ]);
  const ring: Floor = {
    id: 'ring',
    name: 'ring',
    rooms: [a, b],
    joins: [
      join('one', { roomId: 'a', wallId: 'a-e', openingId: 'a-n' }, { roomId: 'b', wallId: 'b-w', openingId: 'b-w' }),
      // The same two rooms joined a second way, through doors that do not agree
      // about where they are. This is a loop that does not close.
      join('two', { roomId: 'a', wallId: 'a-s', openingId: 'a-e' }, { roomId: 'b', wallId: 'b-n', openingId: 'b-n' }),
    ],
  };
  const { notes } = layout(ring);
  const loop = notes.find((n) => n.kind === 'loop');
  assert.ok(loop, 'a loop that does not close has to be reported');
  assert.ok(loop.by > 0n || /different angle/.test(loop.what));
  assert.match(loop.what, /not corrected here/);
});

test('two rooms drawn on top of each other is reported, not drawn quietly', () => {
  const stacked = [
    { room: kitchen, placement: { roomId: 'k', turn: 0 as const, offset: { x: 0n, y: 0n } },
      outline: [{ x: 0n, y: 0n }, { x: 20n * FT, y: 0n }, { x: 20n * FT, y: 12n * FT }, { x: 0n, y: 12n * FT }] },
    { room: hall, placement: { roomId: 'h', turn: 0 as const, offset: { x: 0n, y: 0n } },
      outline: [{ x: 0n, y: 0n }, { x: 20n * FT, y: 0n }, { x: 20n * FT, y: 8n * FT }, { x: 0n, y: 8n * FT }] },
  ];
  const clashes = overlaps(stacked);
  assert.equal(clashes.length, 1);
  assert.equal(clashes[0]!.a, 'kitchen');
});

/* ------------------------------------------------------------ quantities */

test('a floor totals its rooms, and every room is listed so the sum can be checked', () => {
  const q = floorQuantities(floor);
  assert.equal(q.floorArea, area(kitchen).value + area(hall).value);
  assert.deepEqual(
    q.rooms.map((r) => r.name),
    ['kitchen', 'hall']
  );
  // A shared wall is counted from both sides, which is right: both faces take
  // drywall, both take paint, and both take base.
  assert.ok(q.wallFaceArea > 0n);
});

test('a room nobody could place is left out of the total rather than quietly added', () => {
  const lonely = makeRoom('b', 'bathroom', [
    w('b-south', 'east', `8'`),
    w('b-east', 'north', `6'`),
    w('b-north', 'west', `8'`),
    w('b-west', 'south', `6'`),
  ]);
  const q = floorQuantities({ ...floor, rooms: [...floor.rooms, lonely] });
  assert.equal(q.rooms.length, 2);
  assert.equal(q.floorArea, area(kitchen).value + area(hall).value);
});

test('the floor measures what a person would measure across the outside of it', () => {
  const e = floorExtent(floor);
  assert.equal(formatFeetInches(e.x), `20'`);
  // 12 ft of kitchen, a 4 1/2 inch wall, and 8 ft of hall.
  assert.equal(formatFeetInches(e.y), `20' 4 1/2"`);
});
