import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength } from '../length.ts';
import { isVerified, scanned, toleranceOf, verified } from '../measurement.ts';
import { area, closes, formatSquareFeet, isDiagonal, runLength } from '../room.ts';
import { verifyWall } from '../edit.ts';
import { isIssuable, readiness } from '../issue.ts';
import { TRACE_SQUARE_RATIO, TraceError, areaInDoubt, roomFromCorners } from '../trace.ts';

const AT = '2026-08-21T15:00:00Z';
const FT = 0.3048;

function corner(id: string, x: number, y: number) {
  return { id, x, y, placedAt: AT };
}

const CEILING = scanned(parseLength(`8'`), parseLength(`2"`), AT, 'arkit');

/** A 20' x 12' room walked corner to corner, ending back where it started. */
function walked(retapOffsetFeet = 0.25) {
  return [
    corner('c1', 0, 0),
    corner('c2', 20 * FT, 0),
    corner('c3', 20 * FT, 12 * FT),
    corner('c4', 0, 12 * FT),
    // The closing tap: back at the first corner, and out by however much.
    corner('c5', retapOffsetFeet * FT, 0),
  ];
}

const OPTIONS = { name: 'kitchen', at: AT, ceilingHeight: CEILING, source: 'ar' as const };

/* ------------------------------------------------------------- the shape */

test('four taps and a closing tap make a room', () => {
  const { room } = roomFromCorners(walked(), { ...OPTIONS, closingRetap: true });

  assert.equal(room.name, 'kitchen');
  assert.equal(room.walls.length, 4, 'the closing tap is evidence, not a fifth wall');
  assert.equal(closes(room), true);
  assert.equal(formatSquareFeet(area(room).value), '240.0 sq ft');
});

test('the plan comes out straight, whichever way the room was walked', () => {
  // The same room walked starting from a corner and heading off at 30 degrees:
  // the longest wall still becomes the one that runs true.
  const angle = Math.PI / 6;
  const turn = (x: number, y: number) =>
    [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)] as const;

  const skewed = walked().map((c) => {
    const [x, y] = turn(c.x, c.y);
    return { ...c, x, y };
  });

  const { room } = roomFromCorners(skewed, { ...OPTIONS, closingRetap: true });
  assert.equal(room.walls.length, 4);
  assert.ok(room.walls.every((w) => !isDiagonal(w.heading)), 'a square room stays square');
  assert.equal(formatSquareFeet(area(room).value), '240.0 sq ft');
});

/* ------------------------------------------------------- where the band comes from */

test('the closing tap is the measurement the tolerance is taken from', () => {
  const { room, report } = roomFromCorners(walked(0.25), { ...OPTIONS, closingRetap: true });

  assert.equal(report.closingGap, parseLength(`3"`));
  assert.equal(report.tolerance, parseLength(`3"`));
  assert.equal(report.toleranceSource, 'the closing re-tap');
  assert.ok(room.walls.every((w) => toleranceOf(w.length) === parseLength(`3"`)));
  assert.ok(report.notes.some((n) => /missed the corner you started at by 3"/.test(n)));
  assert.ok(report.notes.some((n) => /any one corner could account for all of it/.test(n)));
});

test('a steadier hand earns a tighter band, because it is the same measurement', () => {
  const steady = roomFromCorners(walked(1 / 12), { ...OPTIONS, closingRetap: true });
  const shaky = roomFromCorners(walked(1), { ...OPTIONS, closingRetap: true });

  assert.equal(steady.report.tolerance, parseLength(`1"`));
  assert.equal(shaky.report.tolerance, parseLength(`1'`));
  assert.ok(areaInDoubt(shaky.room) > areaInDoubt(steady.room) * 10n);
});

test('no closing tap and no tolerance is refused, never invented', () => {
  assert.throws(
    () => roomFromCorners(walked().slice(0, 4), OPTIONS),
    (e: unknown) => e instanceof TraceError && /it will not be invented here/.test((e as Error).message)
  );
});

test('a tolerance the caller supplies is used, and the report says it was not measured', () => {
  const { room, report } = roomFromCorners(walked().slice(0, 4), {
    ...OPTIONS,
    tolerance: parseLength(`2"`),
  });
  assert.equal(report.toleranceSource, 'given by the caller');
  assert.equal(report.closingGap, null);
  assert.ok(room.walls.every((w) => toleranceOf(w.length) === parseLength(`2"`)));
  assert.ok(report.notes.some((n) => /nothing here measured how well the pointing went/.test(n)));
});

/* --------------------------------------------------------------- the aim */

test('a hand that is an inch out over twenty feet still drew a straight wall', () => {
  assert.equal(TRACE_SQUARE_RATIO, 20n, '2.86 degrees');
  const wobbly = [
    corner('c1', 0, 0),
    corner('c2', 20 * FT, 1 / 12 * FT),   // an inch sideways over twenty feet
    corner('c3', 20 * FT, 12 * FT),
    corner('c4', 0, 12 * FT),
    corner('c5', 0, 0),
  ];
  const { room } = roomFromCorners(wobbly, { ...OPTIONS, closingRetap: true });
  assert.ok(room.walls.every((w) => !isDiagonal(w.heading)), 'aim is not architecture');
  assert.equal(closes(room), true);
});

test('a real corner cut survives, because it is not aim', () => {
  // A 3-4-5 chamfer across the north-east corner: 36.9 degrees off square,
  // thirteen times outside the line.
  const chamfered = [
    corner('c1', 0, 0),
    corner('c2', 12 * FT, 0),
    corner('c3', 12 * FT, 6 * FT),
    corner('c4', 9 * FT, 10 * FT),
    corner('c5', 0, 10 * FT),
    corner('c6', 0, 0),
  ];
  const { room, report } = roomFromCorners(chamfered, { ...OPTIONS, closingRetap: true });

  assert.equal(room.walls.length, 5);
  assert.equal(report.diagonals.length, 1);
  const chamfer = room.walls.find((w) => isDiagonal(w.heading))!;
  assert.equal(runLength(chamfer), parseLength(`5'`));
  assert.equal(formatSquareFeet(area(room).value), '114.0 sq ft', '12 x 10 less the 3 x 4 triangle');
});

/* ------------------------------------------------------------- extra taps */

test('a tap halfway along a wall is folded in, not turned into a corner that is not there', () => {
  const extra = [
    corner('c1', 0, 0),
    corner('midway', 10 * FT, 0),
    corner('c2', 20 * FT, 0),
    corner('c3', 20 * FT, 12 * FT),
    corner('c4', 0, 12 * FT),
    corner('c5', 0, 0),
  ];
  const { room, report } = roomFromCorners(extra, { ...OPTIONS, closingRetap: true });

  assert.equal(room.walls.length, 4);
  assert.deepEqual(report.merged, ['midway']);
  assert.equal(runLength(room.walls[0]!), parseLength(`20'`), '10 and 10 is one wall of 20');
  assert.ok(report.notes.some((n) => /folded into the wall rather than becoming a corner/.test(n)));
});

/* -------------------------------------------------------------- refusals */

test('two taps in the same place are refused, with both names', () => {
  const doubled = [
    corner('c1', 0, 0),
    corner('twice', 20 * FT, 0),
    corner('again', 20 * FT, 0),
    corner('c3', 20 * FT, 12 * FT),
    corner('c4', 0, 12 * FT),
    corner('c5', 0, 0),
  ];
  assert.throws(
    () => roomFromCorners(doubled, { ...OPTIONS, closingRetap: true }),
    (e: unknown) =>
      e instanceof TraceError && /"twice" and "again" are in the same place/.test((e as Error).message)
  );
});

test('too few corners is refused, and it says how many are needed', () => {
  assert.throws(
    () => roomFromCorners(walked().slice(0, 3), { ...OPTIONS, closingRetap: true }),
    (e: unknown) => e instanceof TraceError && /three corners and a closing tap/.test((e as Error).message)
  );
});

test('three corners in a line do not make a room', () => {
  const flat = [
    corner('c1', 0, 0),
    corner('c2', 10 * FT, 0),
    corner('c3', 20 * FT, 0),
    corner('c4', 30 * FT, 0),
    corner('c5', 0, 0),
  ];
  assert.throws(() => roomFromCorners(flat, { ...OPTIONS, closingRetap: true }), TraceError);
});

/* ------------------------------------- the same room, however it was captured */

test('a pointed room is corrected exactly like a scanned one', () => {
  const { room } = roomFromCorners(walked(), { ...OPTIONS, closingRetap: true });

  // Refused as a drawing, for the same reason and in the same words.
  assert.equal(isIssuable(room), false);
  assert.match(readiness(room).blocking.join(' '), /No east-west dimension has been measured/);

  // One tape per axis, and the whole room re-solves around it. Same function,
  // same rules: how it was captured changes nothing about how it is corrected.
  const first = verifyWall(room, room.walls[0]!.id, parseLength(`20' 2"`), 'sam', AT, 'tape').room;
  const second = verifyWall(first, first.walls[1]!.id, parseLength(`12' 1"`), 'sam', AT, 'laser').room;

  assert.equal(closes(second), true);
  assert.equal(isIssuable(second), true);
  assert.equal(readiness(second).trust, 'partly-verified');
  assert.equal(second.walls[0]!.length.value, parseLength(`20' 2"`));
  assert.equal(toleranceOf(second.walls[0]!.length), 0n);
  assert.ok(isVerified(second.walls[1]!.length));
});

test('the area in doubt is the argument for spending two minutes with a tape', () => {
  const { room } = roomFromCorners(walked(0.5), { ...OPTIONS, closingRetap: true });
  const before = areaInDoubt(room);
  assert.ok(before > 0n);

  const taped = room.walls.reduce(
    (r, wall) => verifyWall(r, wall.id, runLength(wall), 'sam', AT, 'tape').room,
    room
  );
  assert.equal(areaInDoubt(taped), 0n, 'nothing is in doubt once every wall is measured');
  assert.ok(taped.walls.every((w) => isVerified(w.length)));
});

/* ---------------------------------------------------------- tracing a plan */

test('a traced drawing says what it is: only as right as the drawing', () => {
  const { room, report } = roomFromCorners(walked().slice(0, 4), {
    ...OPTIONS,
    source: 'plan',
    tolerance: parseLength(`6"`),
  });
  assert.equal(report.source, 'plan');
  assert.ok(report.notes.some((n) => /the drawing is not the building/.test(n)));
  assert.equal(
    room.walls[0]!.length.provenance.kind === 'scanned'
      ? room.walls[0]!.length.provenance.sensor
      : '',
    'traced'
  );
});

test('a ceiling height somebody measured comes through as measured', () => {
  const { room } = roomFromCorners(walked(), {
    ...OPTIONS,
    closingRetap: true,
    ceilingHeight: verified(parseLength(`8' 1"`), 'sam', AT, 'laser'),
  });
  assert.equal(isVerified(room.ceilingHeight), true);
  assert.equal(room.ceilingHeight.value, parseLength(`8' 1"`));
});
