import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NM_PER_METRE, formatMetric, parseLength } from '../length.ts';
import { isVerified, verify } from '../measurement.ts';
import { area, closes, corners, formatSquareFeet, isDiagonal, runLength, runOf } from '../room.ts';
import { assertIssuable, readiness } from '../issue.ts';
import {
  type ImportReport,
  type RoomPlanExport,
  type RoomPlanSurface,
  ImportError,
  SQUARE_RATIO,
  importRoomPlan,
} from '../import-roomplan.ts';
import { DEFAULT_REACH, describe, obstructions, punchList } from '../obstruction.ts';

const AT = '2026-08-20T17:12:09Z';

/* ------------------------------------------------------------- a fake scan */

/**
 * A synthetic RoomPlan export, built to reproduce every structural feature the
 * two real scans showed, so the importer is tested against all of them without
 * checking a person's house into a repository.
 *
 * In plan, with RoomPlan's own axes (x across, z away, y up):
 *
 *     G(0,11) ------------- F(6,11)
 *        |                     \
 *        |                      \  chamfer, 45 degrees
 *        |                       E(8.02,9)
 *        |                       |  a 2 m stub of wall, true but 20 mm out of
 *        |                       D(8.02,7)  line with the stub below it
 *        |                       :  a 4 m opening, which is therefore the one
 *        |                       :  edge that is not quite square
 *        |                       C(8,3)
 *        |                       |  a 3 m stub of wall
 *     A(0,0) --------------- B(8,0)
 *
 * plus a 2 m wall out at x = 10 that belongs to the space next door, and a door
 * and a window in the south wall.
 *
 * The longest wall is G-A, running due north in RoomPlan's frame, so the datum
 * rotation is a real 90 degrees rather than nothing — the importer must not
 * assume the scan arrives aligned to anything.
 */
const FLOOR_Y = -1.2;

function wallSurface(
  identifier: string,
  from: readonly [number, number],
  to: readonly [number, number],
  height = 2.4
): RoomPlanSurface {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const dx = (to[0] - from[0]) / length;
  const dz = (to[1] - from[1]) / length;
  const cx = (from[0] + to[0]) / 2;
  const cz = (from[1] + to[1]) / 2;
  return {
    identifier,
    category: { wall: {} },
    confidence: { high: {} },
    dimensions: [length, height, 0],
    // Column-major: the wall's own long axis, up, across, then its centre.
    transform: [dx, 0, dz, 0, 0, 1, 0, 0, -dz, 0, dx, 0, cx, FLOOR_Y + height / 2, cz, 1],
  };
}

function openingSurface(
  identifier: string,
  parentIdentifier: string,
  along: readonly [number, number],
  direction: readonly [number, number],
  width: number,
  height: number,
  sill: number
): RoomPlanSurface {
  return {
    identifier,
    category: { door: {} },
    confidence: { high: {} },
    dimensions: [width, height, 0],
    parentIdentifier,
    transform: [
      direction[0], 0, direction[1], 0,
      0, 1, 0, 0,
      -direction[1], 0, direction[0], 0,
      along[0], FLOOR_Y + sill + height / 2, along[1], 1,
    ],
  };
}

/** Maps the floor's local (px, py) straight onto the world's (x, z). */
const FLOOR_TRANSFORM = [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, FLOOR_Y, 0, 1];

function scan(overrides: Partial<RoomPlanExport> = {}): RoomPlanExport {
  return {
    version: 2,
    sections: [{ label: 'workshop' }],
    walls: [
      wallSurface('south', [0, 0], [8, 0]),
      wallSurface('east-lower', [8, 0], [8, 3]),
      // True in itself, but 20 mm out of line with the stub below it, so the
      // opening between them is the edge that is not quite square. This is the
      // garage: two wall stubs either side of a garage door, not quite in line.
      wallSurface('east-upper', [8.02, 7], [8.02, 9], 2.1),
      wallSurface('chamfer', [8.02, 9], [6, 11]),
      wallSurface('north', [6, 11], [0, 11]),
      wallSurface('west', [0, 11], [0, 0]),
      // Next door, seen through the opening.
      wallSurface('next-door', [10, 5], [10, 7]),
    ],
    doors: [openingSurface('front-door', 'south', [2, 0], [1, 0], 0.9, 2.0, 0)],
    windows: [openingSurface('kitchen-window', 'south', [5, 0], [1, 0], 1.2, 1.1, 0.9)],
    openings: [],
    objects: [
      {
        identifier: 'bench',
        category: { storage: {} },
        confidence: { low: {} },
        dimensions: [2, 0.9, 0.6],
        transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, FLOOR_Y + 0.45, 0.3, 1],
      },
    ],
    floors: [
      {
        identifier: 'floor-1',
        category: { floor: {} },
        dimensions: [8, 11, 0],
        transform: FLOOR_TRANSFORM,
        polygonCorners: [
          [0, 0],
          [8, 0],
          [8, 3],
          // The corners are the wall ends, exactly, as they are in both real
          // scans. What is off square is the edge between these two.
          [8.02, 7],
          [8.02, 9],
          [6, 11],
          [0, 11],
        ],
      },
    ],
    ...overrides,
  };
}

/**
 * The importer gives walls readable ids — `wall-1`, `opening-1` — because a
 * refusal that names `373288F9-2F3C-4E65-AB0D-FD2EE8C3727E` is not something to
 * put in front of somebody standing in a kitchen. The RoomPlan identifier is
 * kept in the report, and this is how the tests get back to it.
 */
function idFor(report: ImportReport, sourceIdentifier: string): string {
  const row = report.sourceIds.find((x) => x.sourceIdentifier === sourceIdentifier);
  assert.ok(row, `no imported wall came from "${sourceIdentifier}"`);
  return row.id;
}

/* ------------------------------------------------------------------ shape */

test('the outline comes from the floor polygon, in its order', () => {
  const { room, report } = importRoomPlan(scan(), { at: AT });
  assert.equal(room.name, 'workshop');
  assert.equal(room.walls.length, 7, 'six walls and the opening between two of them');
  assert.deepEqual(
    room.walls.map((w) => w.id),
    ['wall-1', 'wall-2', 'opening-1', 'wall-3', 'wall-4', 'wall-5', 'wall-6']
  );
  // Numbered in outline order, and each one still traceable to what it came from.
  assert.equal(idFor(report, 'south'), 'wall-1');
  assert.equal(idFor(report, 'east-upper'), 'wall-3');
  assert.equal(idFor(report, 'west'), 'wall-6');
  assert.ok(!report.sourceIds.some((x) => x.sourceIdentifier === 'next-door'), 'dropped walls get no id');
});

test('the imported room closes', () => {
  const { room } = importRoomPlan(scan(), { at: AT });
  assert.equal(closes(room), true);
});

test('the datum is the longest wall, whichever way the scan happened to be pointing', () => {
  const { room, report } = importRoomPlan(scan(), { at: AT });
  // The 11 m west wall is the longest, so it is the one that runs true.
  const west = room.walls.find((w) => w.id === idFor(report, 'west'))!;
  assert.equal(west.heading, 'east');
  assert.equal(runLength(west), 11n * NM_PER_METRE);
});

test('lengths survive the trip, to the nanometre', () => {
  const { room, report } = importRoomPlan(scan(), { at: AT });
  const byId = new Map(room.walls.map((w) => [w.id, runLength(w)]));
  // The east-west walls are untouched: nothing had to move on that axis.
  assert.equal(byId.get(idFor(report, 'east-lower')), 3n * NM_PER_METRE);
  assert.equal(byId.get(idFor(report, 'east-upper')), 2n * NM_PER_METRE);
  assert.equal(byId.get(idFor(report, 'west')), 11n * NM_PER_METRE);

  // The two north-south walls did move, by half the 20 mm the straightening left
  // behind, because their tolerances are equal. One runs north and one runs
  // south, so closing the gap means one grows and the other shrinks. That is the
  // solver working, not the import failing, and the report says how much.
  assert.equal(byId.get(idFor(report, 'south')), 8n * NM_PER_METRE + 10n * NM_PER_METRE / 1000n);
  assert.equal(byId.get(idFor(report, 'north')), 6n * NM_PER_METRE - 10n * NM_PER_METRE / 1000n);
});

test('the area matches the outline it came from', () => {
  const { room, report } = importRoomPlan(scan(), { at: AT });
  // 8 x 11 less the 2 x 2 triangle the chamfer cuts off is 86.0 square metres,
  // or 925.7 sq ft. The room comes in a foot over that because straightening the
  // opening lengthened the room by 20 mm, which the solver then shared out. That
  // is one part in a thousand, it is reported, and every dimension still carries
  // a 50 mm band until somebody puts a tape on it.
  assert.equal(formatSquareFeet(area(room).value), '926.7 sq ft');
});

/* ------------------------------------------------------------ open spans */

test('an edge with no wall across it comes in as an open span, not a wall', () => {
  const { room, report } = importRoomPlan(scan(), { at: AT });
  const open = room.walls.find((w) => w.open)!;
  assert.equal(open.id, 'opening-1');
  assert.equal(runLength(open), 4n * NM_PER_METRE, 'straightened onto the grid');
  assert.deepEqual(report.openSpans.map((s) => s.wallId), ['opening-1']);
  assert.ok(report.notes.some((n) => /has no wall across it \("opening-1"\)/.test(n)));
  assert.ok(report.notes.some((n) => /takes no drywall, paint or baseboard/.test(n)));
});

test('an open span carries nothing, so nothing may be hung in it', () => {
  const { room } = importRoomPlan(scan(), { at: AT });
  assert.equal(room.walls.find((w) => w.open)!.openings, undefined);
});

/* -------------------------------------------------------------- straying */

test('a wall on no edge of the outline is left out, and named', () => {
  const { room, report } = importRoomPlan(scan(), { at: AT });
  assert.ok(!room.walls.some((w) => w.id === 'next-door'));
  assert.equal(report.dropped.length, 1);
  assert.equal(report.dropped[0]!.identifier, 'next-door');
  assert.equal(report.dropped[0]!.length, 2n * NM_PER_METRE);
  assert.ok(report.notes.some((n) => /Left out a 6' 6 3\/4" wall \(next-door\)/.test(n)));
});

/* -------------------------------------------------------------- snapping */

test('the walls win: a wall runs true even where the polygon beside it does not', () => {
  const { room, report } = importRoomPlan(scan(), { at: AT });
  const wall = room.walls.find((w) => w.id === idFor(report, 'east-upper'))!;
  assert.equal(wall.heading, 'west');
  assert.equal(runLength(wall), 2n * NM_PER_METRE, 'exactly 2 m, not 2 m and a bit');
  assert.ok(!report.snapped.some((s) => s.wallId === idFor(report, 'east-upper')), 'nothing to straighten');
});

test('the polygon is straightened where it is the only source, and by how much is reported', () => {
  const { report } = importRoomPlan(scan(), { at: AT });
  const snap = report.snapped.find((s) => s.wallId === 'opening-1')!;
  assert.equal(snap.by, 20n * NM_PER_METRE / 1000n, '20 mm, which is what the polygon was out by');
  assert.ok(report.notes.some((n) => /Straightened 1 edge onto the grid; the largest moved 20 mm/.test(n)));
  assert.ok(report.notes.some((n) => /squares up its walls and not its floor outline/.test(n)));
});

test('straightening leaves a residual, and the solver absorbs it rather than hiding it', () => {
  const { room, report } = importRoomPlan(scan(), { at: AT });
  assert.notDeepEqual(report.closureBeforeSolving, { x: 0n, y: 0n });
  assert.equal(closes(room), true);
  assert.ok(report.notes.some((n) => /the room was 20 mm from closing/.test(n)));
});

test('the squareness test is a ratio, so it separates noise from a real angle', () => {
  assert.equal(SQUARE_RATIO, 100n, '0.573 degrees');
  const { room, report } = importRoomPlan(scan(), { at: AT });
  const chamfer = room.walls.find((w) => w.id === idFor(report, 'chamfer'))!;
  assert.ok(isDiagonal(chamfer.heading), 'a 45 degree wall is not noise');
  assert.deepEqual(report.diagonals, [idFor(report, 'chamfer')]);
  assert.ok(report.notes.some((n) => /came in at a genuine angle rather than being straightened/.test(n)));
});

/* -------------------------------------------------------------- openings */

test('openings land on their wall, at the right offset', () => {
  const { room, report } = importRoomPlan(scan(), { at: AT });
  const south = room.walls.find((w) => w.id === idFor(report, 'south'))!;
  assert.equal(south.openings?.length, 2);

  const [door, window_] = south.openings!;
  assert.equal(door!.id, 'door-1', 'numbered by kind, in the order the scan listed them');
  assert.equal(door!.kind, 'door');
  // Centred 2 m along an 8 m wall, 0.9 m wide, so it starts at 1.55 m.
  assert.equal(door!.offsetFromStart.value, 1550n * NM_PER_METRE / 1000n);
  assert.equal(door!.width.value, 900n * NM_PER_METRE / 1000n);

  assert.equal(window_!.id, 'window-1');
  assert.equal(window_!.offsetFromStart.value, 4400n * NM_PER_METRE / 1000n);
});

test('a window sill is recovered, not read, and says so', () => {
  const { room, report } = importRoomPlan(scan(), { at: AT });
  const window_ = room.walls.find((w) => w.id === idFor(report, 'south'))!.openings!.find((o) => o.id === 'window-1')!;
  assert.equal(window_.sillHeight?.value, 900n * NM_PER_METRE / 1000n);
  assert.deepEqual(report.recoveredSills, ['window-1']);
  assert.ok(report.notes.some((n) => /worked out from the scan rather than read from it/.test(n)));
});

test('a door needs no sill, because a door starts at the floor', () => {
  const { room, report } = importRoomPlan(scan(), { at: AT });
  const door = room.walls.find((w) => w.id === idFor(report, 'south'))!.openings!.find((o) => o.id === 'door-1')!;
  assert.equal(door.sillHeight, undefined);
});

test('an opening whose wall was dropped goes with it', () => {
  const base = scan();
  const withOrphan: RoomPlanExport = {
    ...base,
    doors: [
      ...(base.doors ?? []),
      openingSurface('orphan', 'next-door', [10, 6], [0, 1], 0.9, 2.0, 0),
    ],
  };
  const { room, report } = importRoomPlan(withOrphan, { at: AT });
  // Two doors were listed; only the one whose wall survived came through.
  assert.deepEqual(report.openings.map((o) => o.kind), ['door', 'window']);
  assert.equal(room.walls.flatMap((w) => w.openings ?? []).length, 2);
});

/* --------------------------------------------------------------- heights */

test('the ceiling is the tallest wall, so a low one is a soffit and not the room', () => {
  const { room, report } = importRoomPlan(scan(), { at: AT });
  assert.equal(room.ceilingHeight.value, 2400n * NM_PER_METRE / 1000n);
  const low = room.walls.find((w) => w.id === idFor(report, 'east-upper'))!;
  assert.equal(low.height?.value, 2100n * NM_PER_METRE / 1000n);
});

/* -------------------------------------------------------------- objects */

test('detected objects come out as footprints for the obstruction check', () => {
  const { footprints } = importRoomPlan(scan(), { at: AT });
  assert.equal(footprints.length, 1);
  assert.equal(footprints[0]!.category, 'storage');
  assert.equal(footprints[0]!.id, 'bench');
  // 2 m long by 0.6 m deep, so the box is 2 m by 0.6 m whichever way it is turned.
  const box = footprints[0]!;
  assert.equal(box.max.x - box.min.x, 600n * NM_PER_METRE / 1000n);
  assert.equal(box.max.y - box.min.y, 2n * NM_PER_METRE);
});

/* ----------------------------------------------------------- provenance */

test('nothing that comes out of an import is a measurement anybody has checked', () => {
  const { room } = importRoomPlan(scan(), { at: AT });
  assert.ok(room.walls.every((w) => !isVerified(w.length)));
  assert.ok(!isVerified(room.ceilingHeight));
  assert.equal(room.walls[0]!.length.provenance.kind, 'scanned');
});

test('the room closes and is still refused as a drawing, which is the whole point', () => {
  const { room, report } = importRoomPlan(scan(), { at: AT });
  assert.equal(closes(room), true);
  const state = readiness(room);
  assert.equal(state.trust, 'scanned');
  assert.throws(() => assertIssuable(room));
  assert.ok(
    report.notes.some((n) => /means nothing at all until somebody has measured one wall on each axis/.test(n))
  );
});

test('two tapes, one per axis, and the same room may be issued', () => {
  const { room, report } = importRoomPlan(scan(), { at: AT });
  const checked = {
    ...room,
    walls: room.walls.map((w) => {
      if (w.id !== idFor(report, 'south') && w.id !== idFor(report, 'west')) return w;
      return { ...w, length: verify(w.length, runLength(w), 'sam', '2026-08-21T09:00:00Z', 'laser') };
    }),
  };
  assert.doesNotThrow(() => assertIssuable(checked));
  assert.equal(readiness(checked).trust, 'partly-verified');
});

test("Apple's own published tolerance is what every dimension carries", () => {
  const { room } = importRoomPlan(scan(), { at: AT });
  const wall = room.walls[0]!;
  assert.equal(wall.length.provenance.kind === 'scanned' ? wall.length.provenance.tolerance : -1n, parseLength(`50mm`));
  assert.equal(formatMetric(parseLength(`50mm`), 'mm'), '50 mm');

  const tighter = importRoomPlan(scan(), { at: AT, tolerance: parseLength(`10mm`) });
  const t = tighter.room.walls[0]!.length.provenance;
  assert.equal(t.kind === 'scanned' ? t.tolerance : -1n, parseLength(`10mm`));
});

/* ------------------------------------------------------------- refusals */

test('a scan with no floor outline is refused, with the reason', () => {
  assert.throws(
    () => importRoomPlan(scan({ floors: [] }), { at: AT }),
    (e: unknown) =>
      e instanceof ImportError && /no way to tell which walls belong to this room/.test((e as Error).message)
  );
});

test('a scan with no walls is refused', () => {
  assert.throws(() => importRoomPlan(scan({ walls: [] }), { at: AT }), ImportError);
});

/* ------------------------------------------------- through to obstruction */

/**
 * The kitchen scan is the reason this section exists. It has six detected
 * objects — two runs of storage, a stove, an oven, a sink and a chair — and run
 * end to end it says the counter wall is 995/1000 hidden and the corner chamfer
 * is 1000/1000 hidden. Those numbers are in `DECISIONS.md`; the fixture below
 * reproduces the same shapes so the path stays tested without the house in it.
 */
function withCounter(): RoomPlanExport {
  const base = scan();
  return {
    ...base,
    objects: [
      ...(base.objects ?? []),
      {
        // A run of base cabinets the full length of the north wall.
        identifier: 'cabinets',
        category: { storage: {} },
        confidence: { low: {} },
        dimensions: [6, 0.9, 0.6],
        transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, FLOOR_Y + 0.45, 10.7, 1],
      },
      {
        // A fridge tucked into the cut corner, against the chamfer.
        identifier: 'fridge',
        category: { refrigerator: {} },
        confidence: { medium: {} },
        dimensions: [0.8, 1.8, 0.7],
        transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 6.9, FLOOR_Y + 0.9, 9.9, 1],
      },
    ],
  };
}

test('objects from the import land against the walls they are actually against', () => {
  const { room, report, footprints } = importRoomPlan(withCounter(), { at: AT });
  const blocked = new Map(obstructions(room, footprints).map((o) => [o.wallId, o]));

  // The bench is 2 m of the south wall, which the solver stretched to 8.01 m
  // when it absorbed the straightening — so 249 thousandths, not a round quarter.
  // The blocked share is measured against the wall as it now stands, not as the
  // scanner first reported it.
  assert.equal(blocked.get(idFor(report, 'south'))!.blockedLength, 2n * NM_PER_METRE);
  assert.equal(blocked.get(idFor(report, 'south'))!.blockedPerMille, 249n);
  assert.deepEqual(blocked.get(idFor(report, 'south'))!.by, ['bench']);

  // The cabinets run the whole 6 m north wall.
  assert.equal(blocked.get(idFor(report, 'north'))!.blockedPerMille, 1000n);
  assert.equal(describe(blocked.get(idFor(report, 'north'))!), 'Almost all of this wall was behind cabinets — the scan could not see it properly.');

  // The cabinet run reaches the corner, so it butts into the west wall too and
  // hides its last 600 mm. That is not a false positive: the scanner could not
  // see that stretch of the west wall either.
  assert.equal(blocked.get(idFor(report, 'west'))!.blockedLength, 600n * NM_PER_METRE / 1000n);
  assert.deepEqual(blocked.get(idFor(report, 'west'))!.by, ['cabinets']);

  // Nothing is near the lower east stub.
  assert.equal(blocked.get(idFor(report, 'east-lower'))!.blockedLength, 0n);
  assert.equal(describe(blocked.get(idFor(report, 'east-lower'))!), 'Nothing against this wall.');
});

test('a wall at an angle is checked the same way as one running square', () => {
  const { room, report, footprints } = importRoomPlan(withCounter(), { at: AT });
  const chamfer = obstructions(room, footprints).find((o) => o.wallId === idFor(report, 'chamfer'))!;
  assert.ok(chamfer.blockedPerMille > 0n, 'the fridge is in the cut corner');
  assert.ok(chamfer.by.includes('fridge'));
});

test('the punch list ranks by what is at stake, and says what was in the way', () => {
  const { room, report, footprints } = importRoomPlan(withCounter(), { at: AT });
  const list = punchList(room, footprints, DEFAULT_REACH, 10);

  assert.equal(list.length, room.walls.length, 'nothing is verified yet, so every edge is on it');
  // Sorted by weight, and every weight is positive because every wall carries a band.
  for (let i = 1; i < list.length; i += 1) {
    assert.ok(list[i - 1]!.weight >= list[i]!.weight, 'out of order');
  }
  const north = list.find((x) => x.wallId === idFor(report, 'north'))!;
  assert.deepEqual(north.blockedBy, ['cabinets']);
  assert.equal(north.blockedPerMille, 1000n);
});

test('a taped wall leaves the punch list however much is piled against it', () => {
  const { room, report, footprints } = importRoomPlan(withCounter(), { at: AT });
  const taped = {
    ...room,
    walls: room.walls.map((w) =>
      w.id === idFor(report, 'north') ? { ...w, length: verify(w.length, runLength(w), 'sam', '2026-08-21T09:00:00Z', 'laser') } : w
    ),
  };
  assert.ok(!punchList(taped, footprints, DEFAULT_REACH, 10).some((x) => x.wallId === idFor(report, 'north')));
});

test('an open span is checked too: something can stand in a garage door opening', () => {
  const base = withCounter();
  const inTheOpening: RoomPlanExport = {
    ...base,
    objects: [
      ...(base.objects ?? []),
      {
        identifier: 'pallet',
        category: { storage: {} },
        confidence: { low: {} },
        dimensions: [1.2, 0.5, 1.2],
        transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 7.9, FLOOR_Y + 0.25, 5, 1],
      },
    ],
  };
  const { room, report, footprints } = importRoomPlan(inTheOpening, { at: AT });
  const open = obstructions(room, footprints).find((o) => o.wallId === 'opening-1')!;
  assert.ok(open.by.includes('pallet'));
  assert.ok(open.blockedPerMille > 0n);
});

/* ------------------------------------------------- where the scan started */

/**
 * The same scan, with the whole building moved somewhere else in the scanner's
 * world.
 *
 * RoomPlan's coordinates are metres from wherever the person pressed start, so
 * two captures of the same kitchen have different numbers in them for the same
 * corner. Nothing about the finished plan may depend on that.
 */
function movedBy(source: RoomPlanExport, dx: number, dz: number): RoomPlanExport {
  const move = (m: readonly number[]): number[] => {
    const out = [...m];
    out[12] = (out[12] ?? 0) + dx;
    out[14] = (out[14] ?? 0) + dz;
    return out;
  };
  const surfaces = (list: readonly RoomPlanSurface[] | undefined) =>
    (list ?? []).map((s) => ({ ...s, transform: move(s.transform) }));
  return {
    ...source,
    walls: surfaces(source.walls),
    doors: surfaces(source.doors),
    windows: surfaces(source.windows),
    openings: surfaces(source.openings),
    objects: surfaces(source.objects),
    floors: (source.floors ?? []).map((f) => ({ ...f, transform: move(f.transform) })),
  };
}

test('where somebody started the scan changes nothing on the plan', () => {
  const here = importRoomPlan(scan(), { at: AT });
  const there = importRoomPlan(movedBy(scan(), 37.4, -18.25), { at: AT });

  const shape = (r: typeof here) =>
    r.room.walls.map((w) => {
      const run = runOf(w);
      return `${w.id} ${formatMetric(runLength(w))} ${run.x},${run.y}`;
    });
  assert.deepEqual(shape(there), shape(here), 'the room changed shape when the scan moved');

  // The one that was wrong: furniture came back in the scanner's own metres
  // while the walls were laid out from the plan origin, so every footprint sat
  // however far the person had walked before pressing start. In Gilbert's
  // kitchen that was eight feet, and it silently moved which walls the app
  // called blocked.
  assert.deepEqual(there.footprints, here.footprints, 'furniture moved with the scanner');
});

test('furniture lands inside the room it was scanned in', () => {
  const { room, footprints } = importRoomPlan(movedBy(scan(), 37.4, -18.25), { at: AT });
  const outline = corners(room);
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  const low = { x: xs.reduce((a, b) => (a < b ? a : b)), y: ys.reduce((a, b) => (a < b ? a : b)) };
  const high = { x: xs.reduce((a, b) => (a > b ? a : b)), y: ys.reduce((a, b) => (a > b ? a : b)) };

  const bench = footprints[0];
  assert.ok(bench, 'the bench should have been read');
  assert.ok(
    bench.min.x >= low.x && bench.max.x <= high.x && bench.min.y >= low.y && bench.max.y <= high.y,
    `the bench is outside the room: x ${bench.min.x}..${bench.max.x} in ${low.x}..${high.x}, ` +
      `y ${bench.min.y}..${bench.max.y} in ${low.y}..${high.y}`
  );
});
