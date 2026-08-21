import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NM_PER_MM, abs, hypotenuse, parseLength } from '../length.ts';
import { scanned, verified } from '../measurement.ts';
import {
  type Direction,
  type Room,
  type Wall,
  ClosureConflict,
  DIAGONAL_SLACK,
  RoomError,
  area,
  axisOf,
  closes,
  closure,
  corners,
  diagonal,
  diagonalFromRun,
  formatSquareFeet,
  isDiagonal,
  perimeter,
  runLength,
  runOf,
  solve,
  validate,
} from '../room.ts';
import { splitByBoundary, type Boundary } from '../zone.ts';
import { readiness, unseenError } from '../issue.ts';
import { toRenderModel } from '../render.ts';
import { cutAt, insidePlan, outwardNormals } from '../section.ts';

const T0 = '2026-08-19T14:00:00Z';
const T1 = '2026-08-19T15:30:00Z';

function w(id: string, heading: Direction, length: string, tol = `1"`): Wall {
  return { id, heading, length: scanned(parseLength(length), parseLength(tol), T0, 'roomplan') };
}

function taped(id: string, heading: Direction, length: string): Wall {
  return { id, heading, length: verified(parseLength(length), 'sam', T1, 'tape') };
}

/* -------------------------------------------------------------- building */

test('a diagonal runs the length it was given, in the direction it was given', () => {
  // A 3-4-5 triangle: 5 metres of wall going 3 east and 4 north, exactly.
  const d = diagonal(parseLength(`5000mm`), { x: 3n, y: 4n });
  assert.deepEqual(d.run, { x: 3000n * NM_PER_MM, y: 4000n * NM_PER_MM });
  assert.equal(hypotenuse(d.run.x, d.run.y), parseLength(`5000mm`));
});

test('the direction is a ratio, not a distance', () => {
  const small = diagonal(parseLength(`5000mm`), { x: 3n, y: 4n });
  const large = diagonal(parseLength(`5000mm`), { x: 300_000n, y: 400_000n });
  assert.deepEqual(small.run, large.run, 'same direction, same wall');
});

test('an angle with no exact representation still lands within four nanometres', () => {
  // Sam's kitchen chamfer: 203.3 mm at 70.441 degrees, which RoomPlan gives as a
  // run of 68 mm by 191.6 mm. Neither the angle nor the length is a round number
  // in any unit, which is the case this design exists for.
  const length = parseLength(`203.3mm`);
  const d = diagonal(length, { x: 680n, y: 1916n });
  const actual = hypotenuse(d.run.x, d.run.y);
  assert.ok(abs(actual - length) <= DIAGONAL_SLACK, `off by ${actual - length} nm`);
  assert.equal(DIAGONAL_SLACK, 4n, 'four billionths of a metre');
});

test('a run straight along an axis is refused, because a heading stays exact', () => {
  assert.throws(() => diagonal(parseLength(`3'`), { x: 1n, y: 0n }), RoomError);
  assert.throws(() => diagonal(parseLength(`3'`), { x: 0n, y: 1n }), RoomError);
  assert.throws(() => diagonal(parseLength(`3'`), { x: 0n, y: 0n }), RoomError);
  assert.throws(() => diagonal(0n, { x: 1n, y: 1n }), RoomError);
  assert.throws(() => diagonalFromRun(0n, 5n), RoomError);
});

test('an importer with two known corners builds the run straight from them', () => {
  const d = diagonalFromRun(-68n * NM_PER_MM, -1916n * NM_PER_MM / 10n);
  assert.ok(isDiagonal(d));
  assert.equal(d.run.x, -68n * NM_PER_MM);
});

/* --------------------------------------------------------------- a room */

/**
 * The chamfer itself: 5 feet of wall going 3 west and 4 north. A 3-4-5 triangle,
 * so every number in the room below is exact and any failure is the model's
 * rather than the arithmetic's.
 */
function chamferWall(length = `5'`, measurement = scanned(parseLength(`5'`), parseLength(`1"`), T0, 'roomplan')): Wall {
  return { id: 'chamfer', heading: diagonal(parseLength(length), { x: -3n, y: 4n }), length: measurement };
}

/**
 * A 12' x 10' room with its north-east corner cut off by that chamfer:
 * (0,0) - (12,0) - (12,6) - (9,10) - (0,10).
 */
function chamfered(walls?: Wall[]): Room {
  return {
    id: 'r1',
    name: 'kitchen',
    walls: walls ?? [
      w('south', 'east', `12'`),
      w('east', 'north', `6'`),
      chamferWall(),
      w('north', 'west', `9'`),
      w('west', 'south', `10'`),
    ],
    ceilingHeight: verified(parseLength(`8'`), 'sam', T1, 'tape'),
  };
}

test('a room with an angled wall closes exactly, like any other', () => {
  const r = chamfered();
  assert.deepEqual(closure(r), { x: 0n, y: 0n });
  assert.equal(closes(r), true);

  const pts = corners(r);
  assert.deepEqual(pts[0], { x: 0n, y: 0n });
  assert.deepEqual(pts[2], { x: parseLength(`12'`), y: parseLength(`6'`) });
  assert.deepEqual(pts[3], { x: parseLength(`9'`), y: parseLength(`10'`) }, 'the chamfer lands on the grid');
});

test('the walk reports a diagonal as belonging to neither axis', () => {
  const r = chamfered();
  assert.equal(axisOf(r.walls[0]!), 'x');
  assert.equal(axisOf(r.walls[2]!), null);
  assert.deepEqual(runOf(r.walls[2]!), { x: parseLength(`-3'`), y: parseLength(`4'`) });
  assert.equal(runLength(r.walls[2]!), parseLength(`5'`));
});

test('two square walls in a row are still refused; a diagonal beside anything is fine', () => {
  assert.doesNotThrow(() => validate(chamfered()));
  assert.throws(
    () =>
      validate(
        chamfered([
          w('a', 'east', `12'`),
          w('b', 'east', `1'`),
          w('c', 'north', `10'`),
          w('d', 'west', `13'`),
          w('e', 'south', `10'`),
        ])
      ),
    (e: unknown) => e instanceof RoomError && /both run east-west/.test((e as Error).message)
  );

  // Two diagonals back to back: allowed, because two different angles in a row
  // is a bay, not a mistake. (0,0) - (12,0) - (12,3) - (9,7) - (5,10) - (0,10).
  const five = scanned(parseLength(`5'`), parseLength(`1"`), T0, 'roomplan');
  const bay: Room = {
    ...chamfered(),
    walls: [
      w('south', 'east', `12'`),
      w('east', 'north', `3'`),
      { id: 'bay-a', heading: diagonal(parseLength(`5'`), { x: -3n, y: 4n }), length: five },
      { id: 'bay-b', heading: diagonal(parseLength(`5'`), { x: -4n, y: 3n }), length: five },
      w('north', 'west', `5'`),
      w('west', 'south', `10'`),
    ],
  };
  assert.doesNotThrow(() => validate(bay));
  assert.deepEqual(closure(bay), { x: 0n, y: 0n });
});

test('a diagonal whose run and length disagree is refused, not quietly believed', () => {
  const wrong: Room = {
    ...chamfered(),
    walls: [
      w('south', 'east', `12'`),
      w('east', 'north', `6'`),
      // The run says 5', the label says 6'.
      { id: 'chamfer', heading: diagonal(parseLength(`5'`), { x: -3n, y: 4n }), length: verified(parseLength(`6'`), 'sam', T1, 'tape') },
      w('north', 'west', `9'`),
      w('west', 'south', `10'`),
    ],
  };
  assert.throws(
    () => validate(wrong),
    (e: unknown) => e instanceof RoomError && /run and its length have to agree/.test((e as Error).message)
  );
});

/* -------------------------------------------------------------- solving */

test('the square walls absorb the error and the angled wall keeps its angle', () => {
  // Stretch the south wall by 2": the room no longer closes east-west.
  const off = chamfered([
    w('south', 'east', `12' 2"`),
    w('east', 'north', `6'`),
    chamferWall(),
    w('north', 'west', `9'`),
    w('west', 'south', `10'`),
  ]);
  assert.equal(closure(off).x, parseLength(`2"`));

  const { room: solved, adjustments } = solve(off);
  assert.equal(closes(solved), true);

  const chamfer = solved.walls.find((x) => x.id === 'chamfer')!;
  assert.deepEqual(runOf(chamfer), { x: parseLength(`-3'`), y: parseLength(`4'`) }, 'unmoved');
  assert.ok(!adjustments.some((a) => a.wallId === 'chamfer'), 'and not even listed as adjusted');

  // The two east-west walls took the whole 2" between them.
  const moved = adjustments.filter((a) => a.by !== 0n).map((a) => a.wallId).sort();
  assert.deepEqual(moved, ['north', 'south']);
});

test('a person who tapes every square wall gets told the angled one is the disagreement', () => {
  const stuck = chamfered([
    taped('south', 'east', `12' 2"`),
    w('east', 'north', `6'`),
    chamferWall(`5'`, verified(parseLength(`5'`), 'sam', T1, 'tape')),
    taped('north', 'west', `9'`),
    w('west', 'south', `10'`),
  ]);

  assert.throws(
    () => solve(stuck),
    (e: unknown) => {
      assert.ok(e instanceof ClosureConflict);
      assert.deepEqual(e.heldDiagonals, ['chamfer']);
      assert.match(e.message, /held\s+rather than stretched, because stretching one changes its angle/);
      return true;
    }
  );
});

/* ------------------------------------------------------ what it adds up to */

test('area and perimeter both take the chamfer into account', () => {
  const r = chamfered();
  // 12 x 10 less the 3 x 4 triangle cut off the corner: 120 - 6 = 114 sq ft.
  assert.equal(formatSquareFeet(area(r).value), '114.0 sq ft');
  // 12 + 6 + 5 + 9 + 10 = 42 feet round.
  assert.equal(perimeter(r).value, parseLength(`42'`));
});

/* --------------------------------------------------------- the rest of core */

test('zones split a room that has an angled wall in it', () => {
  const r = chamfered();
  const boundary: Boundary = {
    id: 'b1',
    declaredBy: 'sam',
    declaredAt: T1,
    from: { x: parseLength(`6'`), y: 0n },
    to: { x: parseLength(`6'`), y: parseLength(`10'`) },
  };
  const [a, b] = splitByBoundary(r, boundary, ['cooking', 'eating']);
  assert.ok(a.edges.length > 0 && b.edges.length > 0);
  // The halves still account for every square nanometre; splitByBoundary asserts
  // it internally, so reaching here at all is the proof.
  assert.ok(a.edges.some((e) => e.kind === 'built' && e.wallId === 'chamfer'));
});

test('a point on the chamfer itself is recognised as being on the outline', () => {
  const r = chamfered();
  // Halfway along the 3-4-5 chamfer, which runs from (12,6) to (9,10).
  const boundary: Boundary = {
    id: 'b2',
    declaredBy: 'sam',
    declaredAt: T1,
    from: { x: parseLength(`10' 6"`), y: parseLength(`8'`) },
    to: { x: parseLength(`0'`), y: parseLength(`8'`) },
  };
  assert.doesNotThrow(() => splitByBoundary(r, boundary, ['a', 'b']));
});

test('the section and dollhouse geometry handles the chamfer', () => {
  const r = chamfered();
  const normals = outwardNormals(r);
  assert.equal(normals.length, 5);
  // The chamfer faces out to the north-east, so both components point positive.
  assert.ok(normals[2]!.x > 0n && normals[2]!.y > 0n);

  assert.equal(insidePlan(r, { x: parseLength(`2'`), y: parseLength(`2'`), height: 0n }), true);
  assert.equal(
    insidePlan(r, { x: parseLength(`11' 6"`), y: parseLength(`9' 6"`), height: 0n }),
    false,
    'the cut-off corner is outside the room'
  );

  const view = cutAt(r, { height: parseLength(`4'`) });
  assert.equal(view.walls.length, 5);
  assert.ok(view.walls.every((x) => x.cut));
});

test('the renderer draws the chamfer as a wall like any other', () => {
  const model = toRenderModel(chamfered(), [], { unit: 'ft' });
  const chamfer = model.walls.find((x) => x.id === 'chamfer')!;
  assert.equal(chamfer.start.x, 12);
  assert.equal(chamfer.start.y, 6);
  assert.equal(chamfer.end.x, 9);
  assert.equal(chamfer.end.y, 10);
  assert.equal(chamfer.confidence, 'scanned');
});

test('an unverified angled wall puts both axes in doubt, and the guard counts it twice', () => {
  const r = chamfered();
  // Four square walls at 1" each: two east-west, two north-south. Plus the
  // chamfer's 1", which is unchecked in both directions.
  assert.equal(unseenError(r, 'x'), parseLength(`3"`));
  assert.equal(unseenError(r, 'y'), parseLength(`3"`));

  const state = readiness(r);
  assert.equal(state.trust, 'scanned');
  assert.equal(state.nextTape.length, 5, 'the chamfer is on the punch list too');
});

test('taping the chamfer does not open the gate on either axis', () => {
  const r = chamfered([
    w('south', 'east', `12'`),
    w('east', 'north', `6'`),
    chamferWall(`5'`, verified(parseLength(`5'`), 'sam', T1, 'tape')),
    w('north', 'west', `9'`),
    w('west', 'south', `10'`),
  ]);
  const state = readiness(r);
  assert.equal(state.blocking.length, 2, 'one line per axis, both still unmeasured');
  assert.equal(state.trust, 'scanned', 'a corner cut is not a room dimension');
});
