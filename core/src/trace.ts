import { type Nanometres, abs, formatFeetInches, formatMetric, hypotenuse } from './length.ts';
import { type Measurement, scanned, toleranceOf } from './measurement.ts';
import {
  type Direction,
  type Point,
  type Room,
  type Wall,
  RoomError,
  axisOf,
  closure,
  diagonalFromRun,
  runLength,
  solve,
} from './room.ts';

/**
 * A room from corners somebody pointed at.
 *
 * Two capture modes end up here, and that is the reason this is one file rather
 * than two. **AR measure** on a phone with no LiDAR: aim a reticle at the foot
 * of each corner, tap, walk to the next one. **Tracing an existing plan**: put a
 * drawing on the screen and tap its corners. Different hands, different sensors,
 * identical output — an ordered list of points on the floor.
 *
 * What comes out is the same `Room` a LiDAR scan produces, which means the same
 * plan, the same solver, the same correction screen and the same refusal to be
 * issued until somebody has put a tape on it. **How a room was captured changes
 * nothing about how it is corrected.** That is a promise the product makes, and
 * this file is where it is kept for two of the four modes.
 *
 * ## Where the tolerance comes from
 *
 * Nobody publishes how accurately a person can place a point in AR by eye, and
 * this file will not invent a figure. So the number comes from the person's own
 * session: **walk back to where you started and tap that corner again.** The gap
 * between the first tap and the last is a measurement of how badly the placing
 * went, taken with the same hand, the same phone and the same room.
 *
 * That gap becomes the tolerance on every wall — the whole gap, not a share of
 * it, because any one corner could account for all of it. It is a bound rather
 * than an average, which is how tolerances already add everywhere else here.
 *
 * A trace with no closing re-tap has no such evidence, and then the caller has
 * to say what the tolerance is. There is no default, because a default would be
 * a number nobody measured.
 */

export class TraceError extends RoomError {}

/** A point somebody put down, in metres, in whatever frame the session used. */
export interface TracedCorner {
  readonly id: string;
  readonly x: number;
  /** The plan's second axis. On a phone this is ARKit's z. */
  readonly y: number;
  readonly placedAt: string;
}

export type TraceSource = 'ar' | 'plan';

export interface TraceOptions {
  readonly name: string;
  readonly at: string;
  readonly ceilingHeight: Measurement;
  readonly source: TraceSource;
  /**
   * True when the last corner is the first one tapped again.
   *
   * That re-tap is the only honest source of a tolerance, so it is worth asking
   * for. Without it, `tolerance` is required.
   */
  readonly closingRetap?: boolean;
  /** Required when there is no closing re-tap. No default: see the note above. */
  readonly tolerance?: Nanometres;
}

/**
 * How square a run has to be before it is called square.
 *
 * Deliberately looser than the importer's, and for a reason that is not a
 * guess: RoomPlan snaps its walls to a grid before anyone sees them, so a
 * scanned wall arrives square to a thousandth of a degree. A person aiming a
 * phone at a skirting board does not. Tapping two corners of a twelve foot wall
 * and being an inch out sideways is 0.4 degrees, and calling that a diagonal
 * would fill a plan with angles nobody built.
 *
 * A ratio rather than an angle, so the test stays exact integer arithmetic:
 * square when the smaller component is at most a twentieth of the larger, which
 * is 2.86 degrees. Over a twelve foot wall that is seven inches of sideways
 * error before it stops being a straight wall — wider than anybody's aim, and
 * far tighter than a real corner cut.
 */
export const TRACE_SQUARE_RATIO = 20n;

function nm(metres: number, what: string): Nanometres {
  if (!Number.isFinite(metres)) {
    throw new TraceError(`A corner was placed at ${metres}, which is not a position (${what}).`);
  }
  return BigInt(Math.round(metres * 1e9));
}

/** The direction the longest edge runs, so the plan comes out straight on screen. */
function datumOf(points: readonly Point[]): { x: number; y: number } {
  let best = { x: 1, y: 0 };
  let longest = -1;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const dx = Number(b.x - a.x);
    const dy = Number(b.y - a.y);
    const length = Math.hypot(dx, dy);
    if (length > longest) {
      longest = length;
      best = { x: dx / length, y: dy / length };
    }
  }
  return best;
}

function classify(run: Point): { direction: Direction; length: Nanometres } {
  const ax = abs(run.x);
  const ay = abs(run.y);
  const larger = ax > ay ? ax : ay;
  const smaller = ax > ay ? ay : ax;

  if (smaller * TRACE_SQUARE_RATIO <= larger) {
    if (ax >= ay) return { direction: run.x >= 0n ? 'east' : 'west', length: ax };
    return { direction: run.y >= 0n ? 'north' : 'south', length: ay };
  }
  return { direction: diagonalFromRun(run.x, run.y), length: hypotenuse(run.x, run.y) };
}

export interface TraceReport {
  readonly source: TraceSource;
  /**
   * How far the closing re-tap missed the first corner. This is the measurement
   * the tolerance is taken from — see the note at the top of this file.
   */
  readonly closingGap: Nanometres | null;
  /** What every wall ended up carrying, and where that number came from. */
  readonly tolerance: Nanometres;
  readonly toleranceSource: 'the closing re-tap' | 'given by the caller';
  /** Corners folded away because the wall ran straight through them. */
  readonly merged: readonly string[];
  readonly diagonals: readonly string[];
  /** How far the room failed to close before the solver ran. */
  readonly closureBeforeSolving: Point;
  readonly notes: readonly string[];
}

export interface TraceResult {
  readonly room: Room;
  readonly report: TraceReport;
}

/**
 * Builds the room.
 *
 * Consecutive edges running the same way are folded into one wall. That is not
 * tidying: a person walking a long wall taps an extra point halfway along it,
 * and two walls in a row on one axis is one wall written twice — which the model
 * refuses, and rightly, because the solver would move both to correct one error.
 */
export function roomFromCorners(
  corners: readonly TracedCorner[],
  options: TraceOptions
): TraceResult {
  const retap = options.closingRetap === true;
  const wanted = retap ? 4 : 3;
  if (corners.length < wanted) {
    throw new TraceError(
      `A room needs at least ${retap ? 'three corners and a closing tap' : 'three corners'}; ` +
        `${corners.length} ${corners.length === 1 ? 'was' : 'were'} placed.`
    );
  }

  const placed = corners.map((c) => ({
    id: c.id,
    at: { x: nm(c.x, c.id), y: nm(c.y, c.id) },
  }));

  // The closing re-tap is evidence, not geometry: it says how far out the
  // placing was and is then dropped, because the room closes on the first
  // corner rather than on a second copy of it.
  let closingGap: Nanometres | null = null;
  const ring = [...placed];
  if (retap) {
    const first = ring[0]!;
    const last = ring.pop()!;
    closingGap = hypotenuse(last.at.x - first.at.x, last.at.y - first.at.y);
  }

  const tolerance = closingGap ?? options.tolerance ?? null;
  if (tolerance === null) {
    throw new TraceError(
      'This trace has no closing re-tap, so there is nothing measured to take a tolerance from. ' +
        'Either walk back and tap the first corner again, or say what the tolerance is — it will ' +
        'not be invented here.'
    );
  }
  if (tolerance < 0n) throw new TraceError('A tolerance cannot be negative.');

  const datum = datumOf(ring.map((p) => p.at));
  const toDatum = (p: Point): Point => ({
    x: BigInt(Math.round(Number(p.x) * datum.x + Number(p.y) * datum.y)),
    y: BigInt(Math.round(-Number(p.x) * datum.y + Number(p.y) * datum.x)),
  });
  const outline = ring.map((p) => ({ id: p.id, at: toDatum(p.at) }));

  const measured = (value: Nanometres): Measurement =>
    scanned(value, tolerance, options.at, options.source === 'ar' ? 'arkit' : 'traced');

  const walls: Wall[] = [];
  const diagonals: string[] = [];
  const merged: string[] = [];

  for (let i = 0; i < outline.length; i += 1) {
    const from = outline[i]!;
    const to = outline[(i + 1) % outline.length]!;
    const run = { x: to.at.x - from.at.x, y: to.at.y - from.at.y };
    if (run.x === 0n && run.y === 0n) {
      throw new TraceError(
        `Corners "${from.id}" and "${to.id}" are in the same place, so there is no wall between ` +
          `them. Remove one of them.`
      );
    }

    const { direction, length } = classify(run);
    const previous = walls[walls.length - 1];
    // Same heading as the wall before it: one wall, tapped twice.
    if (previous && axisOf(previous) !== null && previous.heading === direction) {
      merged.push(from.id);
      walls[walls.length - 1] = {
        ...previous,
        length: measured(previous.length.value + length),
      };
      continue;
    }

    walls.push({ id: `wall-${walls.length + 1}`, heading: direction, length: measured(length) });
    if (typeof direction !== 'string') diagonals.push(`wall-${walls.length}`);
  }

  // And the ring can close onto its own first wall the same way.
  if (walls.length > 3) {
    const first = walls[0]!;
    const last = walls[walls.length - 1]!;
    if (axisOf(first) !== null && first.heading === last.heading) {
      walls[0] = { ...first, length: measured(first.length.value + last.length.value) };
      walls.pop();
    }
  }

  if (walls.length < 4) {
    throw new TraceError(
      `Those corners make a shape with ${walls.length} side${walls.length === 1 ? '' : 's'}. ` +
        `A room needs four. Two of the corners may be in line with each other.`
    );
  }

  const draft: Room = {
    id: `${options.source}:${options.at}`,
    name: options.name,
    walls,
    ceilingHeight: options.ceilingHeight,
  };

  const before = closure(draft);
  const { room } = solve(draft);

  return {
    room,
    report: {
      source: options.source,
      closingGap,
      tolerance,
      toleranceSource: closingGap === null ? 'given by the caller' : 'the closing re-tap',
      merged,
      diagonals,
      closureBeforeSolving: before,
      notes: describe({ closingGap, tolerance, merged, diagonals, before, source: options.source }),
    },
  };
}

/* ------------------------------------------------------------------- notes */

function describe(parts: {
  closingGap: Nanometres | null;
  tolerance: Nanometres;
  merged: readonly string[];
  diagonals: readonly string[];
  before: Point;
  source: TraceSource;
}): string[] {
  const notes: string[] = [];

  if (parts.closingGap !== null) {
    notes.push(
      `Your closing tap missed the corner you started at by ${formatFeetInches(parts.closingGap)}. ` +
        `That is the only measurement of how well the pointing went, so it is what every wall ` +
        `here carries as its band — not a share of it, because any one corner could account for ` +
        `all of it.`
    );
  } else {
    notes.push(
      `No closing tap, so nothing here measured how well the pointing went. Every wall carries ` +
        `the ${formatFeetInches(parts.tolerance)} that was supplied. Walking back and tapping the ` +
        `first corner again is worth doing next time — it is the only honest source of that number.`
    );
  }

  if (parts.merged.length > 0) {
    notes.push(
      `${parts.merged.length} corner${parts.merged.length === 1 ? '' : 's'} had the wall running ` +
        `straight through, so ${parts.merged.length === 1 ? 'it was' : 'they were'} folded into ` +
        `the wall rather than becoming a corner that is not there.`
    );
  }
  if (parts.diagonals.length > 0) {
    notes.push(
      `${parts.diagonals.length} wall${parts.diagonals.length === 1 ? '' : 's'} came out at a real ` +
        `angle rather than being straightened onto the grid.`
    );
  }

  const drift = hypotenuse(parts.before.x, parts.before.y);
  if (drift > 0n) {
    notes.push(
      `After straightening, the room was ${formatMetric(drift, 'mm')} from closing. The walls ` +
        `absorbed it between them.`
    );
  }

  notes.push(
    parts.source === 'ar'
      ? 'Every dimension here was pointed at, not measured. The room closes, and that means ' +
        'nothing until somebody has put a tape on one wall running each way.'
      : 'Every dimension here came off a drawing. It is only as right as the drawing was, and ' +
        'the drawing is not the building.'
  );
  return notes;
}

/**
 * How much better a tape would make this room.
 *
 * The difference between the band it carries now and nothing at all, expressed
 * as the floor area currently in doubt. It is the argument for spending two
 * minutes with a tape, in the units the argument is actually about.
 */
export function areaInDoubt(room: Room): bigint {
  return room.walls.reduce((total, wall) => total + 2n * runLength(wall) * toleranceOf(wall.length), 0n);
}
