import {
  type Nanometres,
  LengthError,
  NM_PER_FOOT,
  abs,
  add,
  formatFeetInches,
} from './length.ts';
import {
  type Measurement,
  MeasurementError,
  derive,
  isVerified,
  toleranceOf,
} from './measurement.ts';

/**
 * A room, and the thing that makes this app worth building: when somebody types
 * the real length of one wall, every other wall moves to accommodate it.
 *
 * Every scanning app lets you edit a number. None of them re-solves the room
 * around it, so the plan quietly stops closing and the error surfaces later as a
 * cabinet that does not fit. Here a room is a set of walls plus the arithmetic
 * fact that walking them must return you to where you started, and a correction
 * is a change to that system rather than to one field.
 *
 * This solver handles rectilinear rooms — every wall running square to the ones
 * either side of it. That is the overwhelming majority of interior rooms, and
 * the constraint reduces to two exact equations rather than a numerical fit:
 * the east-west runs must cancel, and so must the north-south ones. Angled and
 * curved walls need a different solver and do not pretend to work here.
 *
 * Who absorbs the error is the whole point:
 *
 *   - A wall a person put a tape on does not move. Ever. No threshold.
 *   - The rest share the discrepancy in proportion to how unsure the sensor was
 *     about each of them, so the least trustworthy wall gives the most ground.
 *   - If every wall on an axis is verified and they still do not add up, that is
 *     a contradiction between two human statements, and it is raised rather than
 *     split the difference.
 */

export type Heading = 'east' | 'north' | 'west' | 'south';

const AXIS: Record<Heading, 'x' | 'y'> = {
  east: 'x', west: 'x', north: 'y', south: 'y',
};

/** Which way a wall pushes the running position along its axis. */
const SIGN: Record<Heading, 1n | -1n> = {
  east: 1n, north: 1n, west: -1n, south: -1n,
};

/**
 * A hole in a wall. Doors and cased openings interrupt the baseboard; windows do
 * not. All three interrupt the wall face that gets drywall and paint.
 *
 * `offsetFromStart` is measured from the wall's first corner, walking the room
 * in order. It is what makes an opening attributable to a zone when a wall is
 * split between two of them — without it, a door in an open plan belongs to
 * whichever zone the code happened to check first, which is not an answer.
 */
export interface Opening {
  readonly id: string;
  readonly kind: 'door' | 'window' | 'cased';
  readonly width: Measurement;
  readonly height: Measurement;
  readonly offsetFromStart: Measurement;
}

export interface Wall {
  readonly id: string;
  readonly heading: Heading;
  readonly length: Measurement;
  /**
   * Set only when this wall is not full height — a pony wall, a breakfast bar,
   * the half wall round a stair. It is genuinely built, so it carries drywall,
   * paint and a cap, and it divides the space. Left unset, the room's ceiling
   * height applies.
   */
  readonly height?: Measurement;
  readonly openings?: readonly Opening[];
}

export interface Room {
  readonly id: string;
  readonly name: string;
  readonly walls: readonly Wall[];
  readonly ceilingHeight: Measurement;
}

export interface Point {
  readonly x: Nanometres;
  readonly y: Nanometres;
}

export class RoomError extends Error {}

/** Raised when verified walls contradict each other and no honest fit exists. */
export class ClosureConflict extends RoomError {
  // Declared and assigned rather than written as constructor parameter properties:
  // Node strips types without transforming, and a parameter property is a
  // transform. The tests run on the same files the app does, so the source stays
  // inside what `node --experimental-strip-types` can execute.
  readonly axis: 'x' | 'y';
  readonly residual: Nanometres;
  readonly wallIds: readonly string[];

  constructor(axis: 'x' | 'y', residual: Nanometres, wallIds: readonly string[]) {
    super(
      `The ${axis === 'x' ? 'east-west' : 'north-south'} walls do not add up: they are out by ` +
        `${formatFeetInches(abs(residual))} and every one of them (${wallIds.join(', ')}) has been ` +
        `verified by a person. Two of these measurements disagree — re-check them rather than ` +
        `letting the room close on a number nobody stands behind.`
    );
    this.axis = axis;
    this.residual = residual;
    this.wallIds = wallIds;
  }
}

/* -------------------------------------------------------------- validation */

export function validate(room: Room): void {
  if (room.walls.length < 4) {
    throw new RoomError(`A closed room needs at least four walls; "${room.name}" has ${room.walls.length}.`);
  }
  const seen = new Set<string>();
  for (const wall of room.walls) {
    if (seen.has(wall.id)) throw new RoomError(`Two walls share the id "${wall.id}".`);
    seen.add(wall.id);
    if (wall.length.value <= 0n) {
      throw new RoomError(`Wall "${wall.id}" has a length of ${wall.length.value}nm. Walls run positive.`);
    }
  }
  for (let i = 0; i < room.walls.length; i += 1) {
    const here = room.walls[i]!;
    const next = room.walls[(i + 1) % room.walls.length]!;
    if (AXIS[here.heading] === AXIS[next.heading]) {
      throw new RoomError(
        `Walls "${here.id}" and "${next.id}" both run ${AXIS[here.heading] === 'x' ? 'east-west' : 'north-south'}. ` +
          `In a rectilinear room every wall turns a corner into the next one. If this room has an ` +
          `angled wall, it needs the general solver, which does not exist yet.`
      );
    }
  }
}

/* ----------------------------------------------------------------- walking */

/** The corner positions, starting at the origin and walking the walls in order. */
export function corners(room: Room): Point[] {
  validate(room);
  const points: Point[] = [];
  let x = 0n;
  let y = 0n;
  for (const wall of room.walls) {
    points.push({ x, y });
    const step = SIGN[wall.heading] * wall.length.value;
    if (AXIS[wall.heading] === 'x') x += step;
    else y += step;
  }
  return points;
}

/**
 * How far the walk misses its starting point by. Zero on both axes means the
 * room closes; anything else is the error the solver has to place somewhere.
 */
export function closure(room: Room): { x: Nanometres; y: Nanometres } {
  validate(room);
  let x = 0n;
  let y = 0n;
  for (const wall of room.walls) {
    const step = SIGN[wall.heading] * wall.length.value;
    if (AXIS[wall.heading] === 'x') x += step;
    else y += step;
  }
  return { x, y };
}

export function closes(room: Room): boolean {
  const c = closure(room);
  return c.x === 0n && c.y === 0n;
}

/* ------------------------------------------------------------------ solving */

export interface Adjustment {
  readonly wallId: string;
  /** How far the wall moved. Negative means it got shorter. */
  readonly by: Nanometres;
  /**
   * True when the wall had to move further than the sensor's own stated
   * tolerance to make the room close. That is not an error — it is the room
   * telling you which wall to go and put a tape on first.
   */
  readonly beyondTolerance: boolean;
}

export interface Solution {
  readonly room: Room;
  readonly adjustments: readonly Adjustment[];
}

/**
 * Distributes `total` across `weights` in proportion, in whole nanometres that
 * sum to exactly `total`. Leftovers go to the largest fractional parts first —
 * the same largest-remainder rule the ledger splits money by — so the room
 * closes to the nanometre rather than to a rounding.
 *
 * Weights that are all zero split the total evenly: every wall was called
 * perfect and one of them is wrong, so none has a claim to absorb less.
 */
function allocate(total: Nanometres, weights: readonly Nanometres[]): Nanometres[] {
  const n = weights.length;
  if (n === 0) return [];
  const negative = total < 0n;
  const magnitude = negative ? -total : total;

  let effective = weights.map((w) => (w < 0n ? 0n : w));
  let sum = add(...effective);
  if (sum === 0n) {
    effective = weights.map(() => 1n);
    sum = BigInt(n);
  }

  const shares = effective.map((w) => (magnitude * w) / sum);
  const remainders = effective.map((w, i) => (magnitude * w) % sum);
  let leftover = magnitude - add(...shares);

  const order = remainders
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));

  for (const { i } of order) {
    if (leftover === 0n) break;
    shares[i] = shares[i]! + 1n;
    leftover -= 1n;
  }

  return shares.map((s) => (negative ? -s : s));
}

function solveAxis(room: Room, axis: 'x' | 'y', residual: Nanometres): Adjustment[] {
  if (residual === 0n) return [];

  const onAxis = room.walls.filter((w) => AXIS[w.heading] === axis);
  const movable = onAxis.filter((w) => !isVerified(w.length));

  if (movable.length === 0) {
    throw new ClosureConflict(axis, residual, onAxis.map((w) => w.id));
  }

  // Each movable wall takes a share of the correction, weighted by how unsure
  // the sensor was about it. A wall with no stated tolerance still moves — it
  // just has no stronger claim than any other.
  const weights = movable.map((w) => toleranceOf(w.length));
  const shares = allocate(-residual, weights);

  return movable.map((wall, i) => {
    // Lengthening an east wall pushes the walk east; lengthening a west wall
    // pushes it west. The share is a correction to the walk, so it turns into a
    // change of length through the wall's own sign.
    const by = SIGN[wall.heading] * shares[i]!;
    return {
      wallId: wall.id,
      by,
      beyondTolerance: abs(by) > toleranceOf(wall.length),
    };
  });
}

/**
 * Re-solves the room so it closes, and reports which walls moved and by how much.
 *
 * Call this after every correction. It is the whole product in one function:
 * a person types one number, and the room rearranges itself around what they
 * said while leaving alone everything else a person has said.
 */
export function solve(room: Room): Solution {
  validate(room);
  const residual = closure(room);
  const adjustments = [
    ...solveAxis(room, 'x', residual.x),
    ...solveAxis(room, 'y', residual.y),
  ];

  const byId = new Map(adjustments.map((a) => [a.wallId, a.by]));
  const walls = room.walls.map((wall) => {
    const by = byId.get(wall.id);
    if (by === undefined || by === 0n) return wall;
    const moved = wall.length.value + by;
    if (moved <= 0n) {
      throw new RoomError(
        `Closing "${room.name}" would shrink wall "${wall.id}" to ${formatFeetInches(moved)}. ` +
          `The measurements it is being closed against cannot all be right.`
      );
    }
    return { ...wall, length: { ...wall.length, value: moved } };
  });

  const solved: Room = { ...room, walls };
  const check = closure(solved);
  if (check.x !== 0n || check.y !== 0n) {
    // Unreachable if allocate() is exact. Asserted rather than trusted, because a
    // room that silently fails to close is the bug this whole module exists to stop.
    throw new RoomError(
      `Solver failed to close "${room.name}": left ${formatFeetInches(check.x)} east-west and ` +
        `${formatFeetInches(check.y)} north-south. This is a bug in the solver, not in the room.`
    );
  }
  return { room: solved, adjustments };
}

/* ------------------------------------------------------------- what it adds up to */

export function perimeter(room: Room): Measurement {
  validate(room);
  return derive(
    room.walls.map((w) => ({ name: w.id, measurement: w.length })),
    add(...room.walls.map((w) => w.length.value))
  );
}

export const NM2_PER_SQ_FOOT: bigint = NM_PER_FOOT * NM_PER_FOOT;

/**
 * Floor area, in square nanometres, by the shoelace formula over the corners.
 *
 * The tolerance is a real bound rather than a gesture: moving a wall outward by
 * its tolerance adds at most its own length times that tolerance to the area, so
 * the band is the sum of those products. Verify a wall and its term drops out —
 * which is why the punch list asks for a tape on the longest uncertain wall
 * first, and why the number on screen visibly tightens when you give it one.
 */
export function area(room: Room): Measurement {
  const points = corners(room);
  let twiceArea = 0n;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    twiceArea += a.x * b.y - b.x * a.y;
  }
  const magnitude = twiceArea < 0n ? -twiceArea : twiceArea;
  if (magnitude % 2n !== 0n) {
    throw new RoomError(`"${room.name}" has an area that is not a whole number of square nanometres.`);
  }

  const tolerance = add(
    ...room.walls.map((w) => w.length.value * toleranceOf(w.length))
  );
  return {
    value: magnitude / 2n,
    provenance: { kind: 'derived', tolerance, from: room.walls.map((w) => w.id) },
  };
}

/** Renders square nanometres as square feet, rounded for reading only. */
export function formatSquareFeet(nm2: bigint, decimals = 1): string {
  const scale = 10n ** BigInt(decimals);
  const scaled = (nm2 * scale + NM2_PER_SQ_FOOT / 2n) / NM2_PER_SQ_FOOT;
  const whole = scaled / scale;
  const frac = (scaled % scale).toString().padStart(decimals, '0');
  return decimals === 0 ? `${whole} sq ft` : `${whole}.${frac} sq ft`;
}

/**
 * The walls worth putting a tape on, worst first.
 *
 * This is the verification punch list. Rather than asking somebody to re-measure
 * a whole house, it names the handful of walls whose uncertainty is actually
 * costing the plan its accuracy — ranked by how much area each one's tolerance
 * puts in doubt, because that is what a quantity is priced off.
 */
export function verificationPunchList(room: Room, limit = 5): { wallId: string; areaAtStake: bigint }[] {
  validate(room);
  return room.walls
    .filter((w) => !isVerified(w.length))
    .map((w) => ({ wallId: w.id, areaAtStake: w.length.value * toleranceOf(w.length) }))
    .filter((w) => w.areaAtStake > 0n)
    .sort((a, b) => (a.areaAtStake === b.areaAtStake ? 0 : a.areaAtStake > b.areaAtStake ? -1 : 1))
    .slice(0, limit);
}

export { LengthError, MeasurementError };
