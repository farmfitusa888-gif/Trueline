import { type Nanometres, NM_PER_METRE, abs, formatFeetInches, formatMetric, hypotenuse } from './length.ts';
import { type Measurement, scanned } from './measurement.ts';
import { type Footprint } from './obstruction.ts';
import { type RoomFrame } from './capture.ts';
import {
  type Direction,
  type Heading,
  type Opening,
  type Point,
  type Room,
  type Wall,
  RoomError,
  closure,
  diagonalFromRun,
  solve,
} from './room.ts';

/**
 * Turning a RoomPlan scan into a Trueline room.
 *
 * Written against two real exports off Sam's phone — a kitchen and a garage —
 * rather than against Apple's documentation, because the two disagree in ways
 * that matter. What the scans showed, and what this file therefore does:
 *
 * **The floor polygon says what the outline is. The walls say where it is.**
 * The polygon is the only source that has every edge of the room, including the
 * ones with no wall across them; but RoomPlan snaps the walls to a right-angle
 * grid and does not snap the polygon, so one garage floor edge sits 0.335 degrees
 * off square — 28 mm over 4.8 metres — while every wall in the same room is
 * square to within a thousandth of a degree. So the polygon supplies the order
 * and the shape, and the wall on each edge supplies the geometry.
 *
 * **An edge with no wall is an opening, not a hole in the data.** The garage has
 * one 4.8144 m edge with nothing across it; the kitchen has two, totalling
 * 3.5243 m, turning a corner out into the next room. In both cases the wall-less
 * edges account for the gap between two dangling wall ends exactly. They come in
 * as open spans: on the outline, bounding floor and ceiling, carrying no drywall.
 *
 * **A wall on no edge is not this room's.** The kitchen scan contains a 1.3167 m
 * wall with both ends meeting nothing and no matching floor edge — a fragment of
 * the space next door, seen through a doorway. It is dropped, and the report says
 * so, with its length, so the decision is visible and can be argued with.
 *
 * **Nothing that comes out of here is a measurement anybody has checked.** Every
 * length is `scanned`, with Apple's own documented tolerance on it. A scan closes
 * perfectly whether it is right or wrong, so the room this produces will not pass
 * `assertIssuable()` until a person puts a tape on it. See `issue.ts`.
 *
 * The float-to-exact boundary is here, in `nm()`, and only here. RoomPlan speaks
 * float metres; everything downstream of this file is whole nanometres.
 */

/* --------------------------------------------------------------- the format */

/** A 4x4 transform, flattened column-major, exactly as RoomPlan writes it. */
export type RoomPlanTransform = readonly number[];

export interface RoomPlanSurface {
  readonly identifier: string;
  /** A single-key object — `{"wall": {}}` — never a plain string. */
  readonly category?: Record<string, unknown>;
  readonly confidence?: Record<string, unknown>;
  /** Length, height, thickness. Thickness is always zero; RoomPlan does not export it. */
  readonly dimensions: readonly number[];
  readonly transform: RoomPlanTransform;
  readonly parentIdentifier?: string | null;
  readonly polygonCorners?: readonly (readonly number[])[];
}

export interface RoomPlanExport {
  readonly version?: number;
  /** Maps the room's own coordinates into the ARKit world the photos were taken in. */
  readonly referenceOriginTransform?: readonly number[];
  readonly walls: readonly RoomPlanSurface[];
  readonly doors?: readonly RoomPlanSurface[];
  readonly windows?: readonly RoomPlanSurface[];
  readonly openings?: readonly RoomPlanSurface[];
  readonly objects?: readonly RoomPlanSurface[];
  readonly floors?: readonly RoomPlanSurface[];
  readonly sections?: readonly { readonly label?: string }[];
}

export class ImportError extends RoomError {}

/* ------------------------------------------------------------- the settings */

export interface ImportOptions {
  /** Overrides the section label from the file. */
  readonly name?: string;
  /** Stamped on every measurement. Defaults to the caller's clock at the boundary. */
  readonly at: string;
  /**
   * How wrong a scanned wall may be, per wall. Apple documents ±5 cm of drift
   * for RoomPlan, and that is what this defaults to. It is not a guess: it is
   * the vendor's own published figure, and it is what makes every dimension on
   * the drawing carry a band until somebody replaces it with a tape.
   */
  readonly tolerance?: Nanometres;
  /**
   * Two points closer than this are the same corner. RoomPlan's own wall ends
   * met to within 0.001 mm on both real scans, so this is loose by three orders
   * of magnitude on purpose — it is here to absorb a rounding, not to glue
   * things together that do not meet.
   */
  readonly weldTolerance?: Nanometres;
}

export const ROOMPLAN_WALL_TOLERANCE: Nanometres = 50n * NM_PER_METRE / 1000n;
const DEFAULT_WELD: Nanometres = 5n * NM_PER_METRE / 1000n;

/**
 * How square a run has to be before it is called square.
 *
 * A ratio rather than an angle, so the test is exact integer arithmetic with no
 * trigonometry: a run counts as axis-aligned when its smaller component is at
 * most a hundredth of its larger one. That is 0.573 degrees.
 *
 * The number is chosen against the two things it has to separate. RoomPlan's own
 * square walls come in at 0.001 degrees — five hundred times inside this. The
 * garage's unsnapped floor edge is 0.335 degrees, still inside, which is the
 * point: it is sensor noise and gets straightened. The kitchen's real chamfer is
 * 19.6 degrees off square, thirty times outside, and survives as a diagonal.
 */
export const SQUARE_RATIO = 100n;

/* ------------------------------------------------------------------ reading */

/** The one place float metres become exact nanometres. Nothing past here is float. */
function nm(metres: number): Nanometres {
  if (!Number.isFinite(metres)) {
    throw new ImportError(`The scan contains ${metres} where a length should be.`);
  }
  return BigInt(Math.round(metres * 1e9));
}

/** Column-major index: entry for row r of column c. */
function at(m: RoomPlanTransform, column: number, row: number): number {
  const value = m[column * 4 + row];
  if (value === undefined) {
    throw new ImportError(`A transform in the scan has ${m.length} entries; it needs 16.`);
  }
  return value;
}

/** RoomPlan is y-up, so the plan lives in x and z. Trueline's plan is x and y. */
interface PlanPoint {
  readonly x: number;
  readonly y: number;
}

function planOrigin(m: RoomPlanTransform): PlanPoint {
  return { x: at(m, 3, 0), y: at(m, 3, 2) };
}

/** The surface's own long axis, projected onto the plan. */
function planDirection(m: RoomPlanTransform): PlanPoint {
  return { x: at(m, 0, 0), y: at(m, 0, 2) };
}

function surfaceEnds(s: RoomPlanSurface): [PlanPoint, PlanPoint] {
  const length = s.dimensions[0];
  if (length === undefined) throw new ImportError(`Surface ${s.identifier} has no dimensions.`);
  const d = planDirection(s.transform);
  const c = planOrigin(s.transform);
  return [
    { x: c.x - (d.x * length) / 2, y: c.y - (d.y * length) / 2 },
    { x: c.x + (d.x * length) / 2, y: c.y + (d.y * length) / 2 },
  ];
}

/** Height of the floor plane, read off any wall: its centre less half its height. */
function floorLevel(scan: RoomPlanExport): number {
  const wall = scan.walls[0];
  if (!wall) throw new ImportError('The scan has no walls.');
  const height = wall.dimensions[1];
  if (height === undefined) throw new ImportError(`Wall ${wall.identifier} has no height.`);
  return at(wall.transform, 3, 1) - height / 2;
}

function onlyKey(enumObject: Record<string, unknown> | undefined, fallback: string): string {
  if (!enumObject) return fallback;
  const keys = Object.keys(enumObject);
  return keys.length === 1 ? keys[0]! : fallback;
}

/* ------------------------------------------------------------------- datum */

/**
 * Rotates the scan so its longest wall runs due east.
 *
 * RoomPlan's own axes mean nothing — they come from wherever the phone was
 * pointing when the session started, which in the kitchen was 49.885 degrees off
 * the building. Picking the longest wall as the datum is what a person does with
 * a tape: measure off the longest straight thing in the room, because an error in
 * the datum's direction costs the least there.
 *
 * This is the last calculation done in floating point. Its output is quantised
 * immediately and never revisited.
 */
function datumRotation(walls: readonly RoomPlanSurface[]): PlanPoint {
  let longest = walls[0];
  for (const wall of walls) {
    if ((wall.dimensions[0] ?? 0) > (longest?.dimensions[0] ?? 0)) longest = wall;
  }
  if (!longest) throw new ImportError('The scan has no walls to take a datum from.');
  const d = planDirection(longest.transform);
  const magnitude = Math.hypot(d.x, d.y);
  if (magnitude === 0) throw new ImportError(`Wall ${longest.identifier} has no direction.`);
  return { x: d.x / magnitude, y: d.y / magnitude };
}

/** Rotate a plan point into the datum frame, then quantise it. Floats stop here. */
function toDatum(p: PlanPoint, datum: PlanPoint): Point {
  return {
    x: nm(p.x * datum.x + p.y * datum.y),
    y: nm(-p.x * datum.y + p.y * datum.x),
  };
}

/* ---------------------------------------------------------------- matching */

function near(a: Point, b: Point, weld: Nanometres): boolean {
  return abs(a.x - b.x) <= weld && abs(a.y - b.y) <= weld;
}

/**
 * A run, snapped to the grid when it is within a whisker of it.
 *
 * Returns a heading and a length when the run is square, or an exact diagonal
 * when it genuinely is not. The comparison is integer: no angle is ever computed.
 */
function classify(run: Point): { direction: Direction; length: Nanometres } {
  const ax = abs(run.x);
  const ay = abs(run.y);
  const larger = ax > ay ? ax : ay;
  const smaller = ax > ay ? ay : ax;

  if (smaller * SQUARE_RATIO <= larger) {
    if (ax >= ay) {
      return { direction: run.x >= 0n ? 'east' : 'west', length: ax };
    }
    return { direction: run.y >= 0n ? 'north' : 'south', length: ay };
  }
  return { direction: diagonalFromRun(run.x, run.y), length: hypotenuse(run.x, run.y) };
}

/* ------------------------------------------------------------------ report */

export interface DroppedWall {
  readonly identifier: string;
  readonly length: Nanometres;
  readonly reason: string;
}

export interface SnappedEdge {
  readonly wallId: string;
  /** How far the end of this edge moved when it was straightened, at right angles to it. */
  readonly by: Nanometres;
}

export interface ImportReport {
  readonly sourceVersion: number | undefined;
  /** Wall ids that came in as walls. */
  readonly walls: readonly string[];
  /** Edges of the outline with nothing built across them. */
  readonly openSpans: readonly { readonly wallId: string; readonly length: Nanometres }[];
  /** Walls in the file that are not on this room's outline, and why they were left out. */
  readonly dropped: readonly DroppedWall[];
  /** Edges straightened onto the grid, and by how much. Empty when nothing was off. */
  readonly snapped: readonly SnappedEdge[];
  /** Walls that survived as genuine angles rather than being straightened. */
  readonly diagonals: readonly string[];
  /** How far the room failed to close before the solver was run, after snapping. */
  readonly closureBeforeSolving: Point;
  readonly openings: readonly { readonly id: string; readonly wallId: string; readonly kind: string }[];
  /** Windows whose sill height was recovered rather than read; the file never states one. */
  readonly recoveredSills: readonly string[];
  /**
   * Which RoomPlan identifier each readable id came from. Nothing on screen says
   * `373288F9-2F3C-4E65-AB0D-FD2EE8C3727E`, and nothing is lost either — a
   * re-scan of the same room can still be matched against this one.
   */
  readonly sourceIds: readonly { readonly id: string; readonly sourceIdentifier: string }[];
  /** Everything above, as lines to put in front of a person. */
  readonly notes: readonly string[];
}

export interface ImportResult {
  readonly room: Room;
  readonly report: ImportReport;
  /** Detected objects as axis-aligned boxes, for `obstruction.ts`. */
  readonly footprints: readonly Footprint[];
  /**
   * The coordinate frame this room ended up in.
   *
   * Photographs taken during the same scan have to land in the same one, and the
   * datum is a choice this importer made — the longest wall — not something that
   * can be recovered from the room afterwards. So it comes out with the room
   * rather than being worked out a second time. Two independent derivations of
   * one datum is two chances to disagree.
   */
  readonly frame: RoomFrame;
}

/* ------------------------------------------------------------------ import */

export function importRoomPlan(scan: RoomPlanExport, options: ImportOptions): ImportResult {
  if (!scan.walls || scan.walls.length === 0) throw new ImportError('The scan has no walls.');
  const floor = scan.floors?.[0];
  if (!floor || !floor.polygonCorners || floor.polygonCorners.length < 3) {
    throw new ImportError(
      'The scan has no floor outline. Without it there is no way to tell which walls belong to ' +
        'this room, or where the openings between them are.'
    );
  }

  const tolerance = options.tolerance ?? ROOMPLAN_WALL_TOLERANCE;
  const weld = options.weldTolerance ?? DEFAULT_WELD;
  const datum = datumRotation(scan.walls);
  const measured = (value: Nanometres): Measurement => scanned(value, tolerance, options.at, 'roomplan');

  // The floor polygon's corners are in the floor surface's own frame. Lift them
  // into the room's frame, then into the datum frame, in one step.
  const m = floor.transform;
  const outline: Point[] = floor.polygonCorners.map((corner) => {
    const px = corner[0] ?? 0;
    const py = corner[1] ?? 0;
    const pz = corner[2] ?? 0;
    const world = (row: number) =>
      at(m, 0, row) * px + at(m, 1, row) * py + at(m, 2, row) * pz + at(m, 3, row);
    return toDatum({ x: world(0), y: world(2) }, datum);
  });

  const wallEnds = new Map<string, [Point, Point]>();
  for (const wall of scan.walls) {
    const [a, b] = surfaceEnds(wall);
    wallEnds.set(wall.identifier, [toDatum(a, datum), toDatum(b, datum)]);
  }

  const usedWalls = new Set<string>();
  const walls: Wall[] = [];
  const openSpans: { wallId: string; length: Nanometres }[] = [];
  const snapped: SnappedEdge[] = [];
  const diagonals: string[] = [];
  const sourceIds: { id: string; sourceIdentifier: string }[] = [];
  // Ids a person can read. RoomPlan's own are UUIDs, and a refusal that says
  // "no north-south dimension has been measured: 373288F9-2F3C-4E65-AB0D-..."
  // is not something to put in front of somebody standing in a kitchen. The
  // UUIDs are not lost — they go in the report, so a re-scan can still be
  // matched against this one.
  let wallCount = 0;
  let openCount = 0;

  for (let i = 0; i < outline.length; i += 1) {
    const from = outline[i]!;
    const to = outline[(i + 1) % outline.length]!;

    // Which wall, if any, spans exactly this edge? Either way round: the polygon
    // and the wall need not agree about which end is the start.
    let matched: string | undefined;
    for (const [id, [a, b]] of wallEnds) {
      if (usedWalls.has(id)) continue;
      if ((near(a, from, weld) && near(b, to, weld)) || (near(b, from, weld) && near(a, to, weld))) {
        matched = id;
        break;
      }
    }

    // Geometry comes from the wall when there is one — RoomPlan snapped those to
    // the grid and did not snap the polygon — and from the polygon when there is
    // not.
    let run: Point;
    if (matched) {
      const [a, b] = wallEnds.get(matched)!;
      const forward = near(a, from, weld);
      run = forward ? { x: b.x - a.x, y: b.y - a.y } : { x: a.x - b.x, y: a.y - b.y };
    } else {
      run = { x: to.x - from.x, y: to.y - from.y };
    }

    const { direction, length } = classify(run);
    const id = matched ? `wall-${(wallCount += 1)}` : `opening-${(openCount += 1)}`;
    if (matched) sourceIds.push({ id, sourceIdentifier: matched });

    if (typeof direction === 'string') {
      // Anything the straightening moved is worth naming, however small.
      const across = direction === 'east' || direction === 'west' ? abs(run.y) : abs(run.x);
      if (across > 0n) snapped.push({ wallId: id, by: across });
    } else {
      diagonals.push(id);
    }

    const scanWall = matched ? scan.walls.find((w) => w.identifier === matched) : undefined;
    const heightMetres = scanWall?.dimensions[1];

    walls.push({
      id,
      heading: direction,
      length: measured(length),
      ...(heightMetres !== undefined ? { height: measured(nm(heightMetres)) } : {}),
      ...(matched ? {} : { open: true as const }),
    });

    if (matched) usedWalls.add(matched);
    else openSpans.push({ wallId: id, length });
  }

  const dropped: DroppedWall[] = scan.walls
    .filter((w) => !usedWalls.has(w.identifier))
    .map((w) => ({
      identifier: w.identifier,
      length: nm(w.dimensions[0] ?? 0),
      reason:
        'No edge of the floor outline runs between this wall\'s two ends, so it is not part of ' +
        'this room. On a real scan that is a fragment of the space next door, seen through a doorway.',
    }));

  // Ceiling height: the tallest wall in the scan, because a lower one is a pony
  // wall or a soffit rather than the room getting shorter. Sam's kitchen has one
  // wall at 2.13 m among seven at 2.4257 m.
  const tallest = scan.walls.reduce((best, w) => Math.max(best, w.dimensions[1] ?? 0), 0);
  if (tallest <= 0) throw new ImportError('No wall in the scan has a height, so the room has no ceiling.');

  const name = options.name ?? scan.sections?.[0]?.label ?? 'Room';
  const idOf = new Map(sourceIds.map((s) => [s.sourceIdentifier, s.id]));
  const withOpenings = attachOpenings(scan, walls, outline, datum, weld, measured, options.at, tolerance, idOf);

  const draft: Room = {
    id: `roomplan:${floor.identifier}`,
    name,
    walls: withOpenings.walls,
    ceilingHeight: measured(nm(tallest)),
  };

  const before = closure(draft);
  const { room } = solve(draft);

  const notes = describe({
    dropped,
    openSpans,
    snapped,
    diagonals,
    before,
    recoveredSills: withOpenings.recoveredSills,
  });

  return {
    room,
    report: {
      sourceVersion: scan.version,
      walls: walls.filter((w) => !w.open).map((w) => w.id),
      openSpans,
      dropped,
      snapped,
      diagonals,
      closureBeforeSolving: before,
      openings: withOpenings.openings,
      recoveredSills: withOpenings.recoveredSills,
      sourceIds,
      notes,
    },
    footprints: readObjects(scan, datum),
    frame: {
      datum,
      referenceOriginTransform: (scan as { referenceOriginTransform?: readonly number[] })
        .referenceOriginTransform ?? null,
    },
  };
}

/* ---------------------------------------------------------------- openings */

function attachOpenings(
  scan: RoomPlanExport,
  walls: readonly Wall[],
  outline: readonly Point[],
  datum: PlanPoint,
  weld: Nanometres,
  measured: (v: Nanometres) => Measurement,
  at_: string,
  tolerance: Nanometres,
  idOf: ReadonlyMap<string, string>
): {
  walls: Wall[];
  openings: { id: string; wallId: string; kind: string }[];
  recoveredSills: string[];
} {
  const level = floorLevel(scan);
  const byWall = new Map<string, Opening[]>();
  const listed: { id: string; wallId: string; kind: string }[] = [];
  const recoveredSills: string[] = [];

  const kinds: [readonly RoomPlanSurface[], Opening['kind']][] = [
    [scan.doors ?? [], 'door'],
    [scan.windows ?? [], 'window'],
    [scan.openings ?? [], 'cased'],
  ];

  const counts: Record<string, number> = { door: 0, window: 0, cased: 0 };

  for (const [surfaces, kind] of kinds) {
    for (const surface of surfaces) {
      const parent = surface.parentIdentifier ? idOf.get(surface.parentIdentifier) : undefined;
      if (!parent) continue; // Its wall was dropped, so the opening goes with it.
      const wallIndex = walls.findIndex((w) => w.id === parent);
      if (wallIndex === -1) continue;

      const start = outline[wallIndex]!;
      const end = outline[(wallIndex + 1) % outline.length]!;
      const run = { x: end.x - start.x, y: end.y - start.y };
      const span = hypotenuse(run.x, run.y);
      if (span === 0n) continue;

      const centre = toDatum(planOrigin(surface.transform), datum);
      // Project onto the wall. Scaled by the run rather than a unit vector, so
      // there is one division at the end instead of a rounding at the start.
      const along = ((centre.x - start.x) * run.x + (centre.y - start.y) * run.y) / span;
      const width = nm(surface.dimensions[0] ?? 0);
      const height = nm(surface.dimensions[1] ?? 0);
      const offset = along - width / 2n;
      if (offset < -weld || offset + width > span + weld) continue;

      const sillMetres = at(surface.transform, 3, 1) - (surface.dimensions[1] ?? 0) / 2 - level;
      const sill = nm(sillMetres);
      const id = `${kind}-${(counts[kind] = (counts[kind] ?? 0) + 1)}`;
      const opening: Opening = {
        id,
        kind,
        width: measured(width),
        height: measured(height),
        offsetFromStart: measured(offset < 0n ? 0n : offset),
        // Recovered, never read: RoomPlan states a centre and a height and no
        // sill. Doors come out at the floor, which is what a door is; a window's
        // sill is a real number that only exists because it was worked out here,
        // so it carries the same provenance as everything else.
        ...(kind === 'window' ? { sillHeight: scanned(sill, tolerance, at_, 'roomplan') } : {}),
      };
      if (kind === 'window') recoveredSills.push(id);

      byWall.set(parent, [...(byWall.get(parent) ?? []), opening]);
      listed.push({ id, wallId: parent, kind });
    }
  }

  return {
    walls: walls.map((wall) => {
      const openings = byWall.get(wall.id);
      if (!openings || openings.length === 0) return wall;
      return { ...wall, openings: [...openings].sort((a, b) => (a.offsetFromStart.value < b.offsetFromStart.value ? -1 : 1)) };
    }),
    openings: listed,
    recoveredSills,
  };
}

/* ----------------------------------------------------------------- objects */

/**
 * Detected objects as axis-aligned boxes in the room's frame.
 *
 * The box is the object's own extent rotated into the datum frame and then
 * bounded. For an object square to the room — which every object in Sam's
 * kitchen was, being built-in — that is exact. For one at an angle it is larger
 * than the object, and that is the safe direction to be wrong in: these feed
 * `obstruction.ts`, where the question is what the scanner could not see, and
 * over-reporting a blocked wall sends somebody to look at it.
 */
function readObjects(scan: RoomPlanExport, datum: PlanPoint): Footprint[] {
  return (scan.objects ?? []).map((object) => {
    const length = object.dimensions[0] ?? 0;
    const depth = object.dimensions[2] ?? 0;
    const centre = planOrigin(object.transform);
    const alongX = at(object.transform, 0, 0);
    const alongY = at(object.transform, 0, 2);
    const acrossX = at(object.transform, 2, 0);
    const acrossY = at(object.transform, 2, 2);

    const corners = [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ].map(([u, v]) =>
      toDatum(
        {
          x: centre.x + ((u! * length) / 2) * alongX + ((v! * depth) / 2) * acrossX,
          y: centre.y + ((u! * length) / 2) * alongY + ((v! * depth) / 2) * acrossY,
        },
        datum
      )
    );

    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    return {
      id: object.identifier,
      category: onlyKey(object.category, 'object'),
      min: { x: xs.reduce((a, b) => (a < b ? a : b)), y: ys.reduce((a, b) => (a < b ? a : b)) },
      max: { x: xs.reduce((a, b) => (a > b ? a : b)), y: ys.reduce((a, b) => (a > b ? a : b)) },
    };
  });
}

/* ------------------------------------------------------------------- notes */

function describe(parts: {
  dropped: readonly DroppedWall[];
  openSpans: readonly { wallId: string; length: Nanometres }[];
  snapped: readonly SnappedEdge[];
  diagonals: readonly string[];
  before: Point;
  recoveredSills: readonly string[];
}): string[] {
  const notes: string[] = [];

  for (const span of parts.openSpans) {
    notes.push(
      `${formatFeetInches(span.length)} of the outline has no wall across it ("${span.wallId}"). ` +
        `It bounds the floor and the ceiling and takes no drywall, paint or baseboard. ` +
        `If that is really a wall, or a cased opening, change it here.`
    );
  }
  for (const wall of parts.dropped) {
    notes.push(
      `Left out a ${formatFeetInches(wall.length)} wall (${wall.identifier}): ${wall.reason}`
    );
  }
  if (parts.diagonals.length > 0) {
    notes.push(
      `${parts.diagonals.length} wall${parts.diagonals.length === 1 ? '' : 's'} ` +
        `(${parts.diagonals.join(', ')}) came in at a genuine angle rather than being straightened.`
    );
  }
  const worst = parts.snapped.reduce((most, s) => (s.by > most ? s.by : most), 0n);
  if (worst > 0n) {
    notes.push(
      `Straightened ${parts.snapped.length} edge${parts.snapped.length === 1 ? '' : 's'} onto the ` +
        `grid; the largest moved ${formatMetric(worst, 'mm')}. RoomPlan squares up its walls and ` +
        `not its floor outline, so this is the two disagreeing rather than the room being crooked.`
    );
  }
  const drift = hypotenuse(parts.before.x, parts.before.y);
  if (drift > 0n) {
    notes.push(
      `After straightening, the room was ${formatMetric(drift, 'mm')} from closing. The scanned ` +
        `walls absorbed it in proportion to how unsure the sensor was about each of them.`
    );
  }
  if (parts.recoveredSills.length > 0) {
    notes.push(
      `${parts.recoveredSills.length} window sill height${parts.recoveredSills.length === 1 ? '' : 's'} ` +
        `worked out from the scan rather than read from it — RoomPlan never states one. Worth a tape.`
    );
  }
  notes.push(
    'Every dimension here is the scanner\'s. The room closes, and on an imported scan that means ' +
      'nothing at all until somebody has measured one wall on each axis.'
  );
  return notes;
}

export type { Heading };
