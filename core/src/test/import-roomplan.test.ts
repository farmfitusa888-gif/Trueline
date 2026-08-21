import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NM_PER_METRE, formatMetric, parseLength } from '../length.ts';
import { isVerified, verify } from '../measurement.ts';
import { area, closes, formatSquareFeet, isDiagonal, runLength } from '../room.ts';
import { assertIssuable, readiness } from '../issue.ts';
import {
  type RoomPlanExport,
  type RoomPlanSurface,
  ImportError,
  SQUARE_RATIO,
  importRoomPlan,
} from '../import-roomplan.ts';

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

/* ------------------------------------------------------------------ shape */

test('the outline comes from the floor polygon, in its order', () => {
  const { room } = importRoomPlan(scan(), { at: AT });
  assert.equal(room.name, 'workshop');
  assert.equal(room.walls.length, 7, 'six walls and the opening between two of them');
  assert.deepEqual(
    room.walls.map((w) => w.id),
    ['south', 'east-lower', 'open-1', 'east-upper', 'chamfer', 'north', 'west']
  );
});

test('the imported room closes', () => {
  const { room } = importRoomPlan(scan(), { at: AT });
  assert.equal(closes(room), true);
});

test('the datum is the longest wall, whichever way the scan happened to be pointing', () => {
  const { room } = importRoomPlan(scan(), { at: AT });
  // The 11 m west wall is the longest, so it is the one that runs true.
  const west = room.walls.find((w) => w.id === 'west')!;
  assert.equal(west.heading, 'east');
  assert.equal(runLength(west), 11n * NM_PER_METRE);
});

test('lengths survive the trip, to the nanometre', () => {
  const { room } = importRoomPlan(scan(), { at: AT });
  const byId = new Map(room.walls.map((w) => [w.id, runLength(w)]));
  // The east-west walls are untouched: nothing had to move on that axis.
  assert.equal(byId.get('east-lower'), 3n * NM_PER_METRE);
  assert.equal(byId.get('east-upper'), 2n * NM_PER_METRE);
  assert.equal(byId.get('west'), 11n * NM_PER_METRE);

  // The two north-south walls did move, by half the 20 mm the straightening left
  // behind, because their tolerances are equal. One runs north and one runs
  // south, so closing the gap means one grows and the other shrinks. That is the
  // solver working, not the import failing, and the report says how much.
  assert.equal(byId.get('south'), 8n * NM_PER_METRE + 10n * NM_PER_METRE / 1000n);
  assert.equal(byId.get('north'), 6n * NM_PER_METRE - 10n * NM_PER_METRE / 1000n);
});

test('the area matches the outline it came from', () => {
  const { room } = importRoomPlan(scan(), { at: AT });
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
  assert.equal(open.id, 'open-1');
  assert.equal(runLength(open), 4n * NM_PER_METRE, 'straightened onto the grid');
  assert.deepEqual(report.openSpans.map((s) => s.wallId), ['open-1']);
  assert.ok(report.notes.some((n) => /has no wall across it \("open-1"\)/.test(n)));
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
  const wall = room.walls.find((w) => w.id === 'east-upper')!;
  assert.equal(wall.heading, 'west');
  assert.equal(runLength(wall), 2n * NM_PER_METRE, 'exactly 2 m, not 2 m and a bit');
  assert.ok(!report.snapped.some((s) => s.wallId === 'east-upper'), 'nothing to straighten');
});

test('the polygon is straightened where it is the only source, and by how much is reported', () => {
  const { report } = importRoomPlan(scan(), { at: AT });
  const snap = report.snapped.find((s) => s.wallId === 'open-1')!;
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
  const chamfer = room.walls.find((w) => w.id === 'chamfer')!;
  assert.ok(isDiagonal(chamfer.heading), 'a 45 degree wall is not noise');
  assert.deepEqual(report.diagonals, ['chamfer']);
  assert.ok(report.notes.some((n) => /came in at a genuine angle rather than being straightened/.test(n)));
});

/* -------------------------------------------------------------- openings */

test('openings land on their wall, at the right offset', () => {
  const { room } = importRoomPlan(scan(), { at: AT });
  const south = room.walls.find((w) => w.id === 'south')!;
  assert.equal(south.openings?.length, 2);

  const [door, window_] = south.openings!;
  assert.equal(door!.id, 'front-door');
  assert.equal(door!.kind, 'door');
  // Centred 2 m along an 8 m wall, 0.9 m wide, so it starts at 1.55 m.
  assert.equal(door!.offsetFromStart.value, 1550n * NM_PER_METRE / 1000n);
  assert.equal(door!.width.value, 900n * NM_PER_METRE / 1000n);

  assert.equal(window_!.id, 'kitchen-window');
  assert.equal(window_!.offsetFromStart.value, 4400n * NM_PER_METRE / 1000n);
});

test('a window sill is recovered, not read, and says so', () => {
  const { room, report } = importRoomPlan(scan(), { at: AT });
  const window_ = room.walls.find((w) => w.id === 'south')!.openings!.find((o) => o.id === 'kitchen-window')!;
  assert.equal(window_.sillHeight?.value, 900n * NM_PER_METRE / 1000n);
  assert.deepEqual(report.recoveredSills, ['kitchen-window']);
  assert.ok(report.notes.some((n) => /worked out from the scan rather than read from it/.test(n)));
});

test('a door needs no sill, because a door starts at the floor', () => {
  const { room } = importRoomPlan(scan(), { at: AT });
  const door = room.walls.find((w) => w.id === 'south')!.openings!.find((o) => o.id === 'front-door')!;
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
  assert.ok(!report.openings.some((o) => o.id === 'orphan'));
  assert.ok(!room.walls.some((w) => w.openings?.some((o) => o.id === 'orphan')));
});

/* --------------------------------------------------------------- heights */

test('the ceiling is the tallest wall, so a low one is a soffit and not the room', () => {
  const { room } = importRoomPlan(scan(), { at: AT });
  assert.equal(room.ceilingHeight.value, 2400n * NM_PER_METRE / 1000n);
  const low = room.walls.find((w) => w.id === 'east-upper')!;
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
  const { room } = importRoomPlan(scan(), { at: AT });
  const checked = {
    ...room,
    walls: room.walls.map((w) => {
      if (w.id !== 'south' && w.id !== 'west') return w;
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
