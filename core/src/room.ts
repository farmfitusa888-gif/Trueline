import {
  type Nanometres,
  LengthError,
  NM_PER_FOOT,
  abs,
  add,
  formatFeetInches,
  hypotenuse,
  isqrt,
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
 * Rooms here are rectilinear with named exceptions. Almost every wall runs square
 * to the ones either side of it, which reduces closure to two exact equations
 * rather than a numerical fit: the east-west runs must cancel, and so must the
 * north-south ones. That is not a simplification — it is what a real scan looks
 * like. Seven of the eight walls in Sam's kitchen are square to within a
 * thousandth of a degree, and all five of the garage's are.
 *
 * The eighth is a 203 mm corner chamfer at 70.4 degrees, and it is ordinary
 * rather than exotic, so a wall may also be a `Diagonal`: an exact run in x and
 * y, held fixed while the square walls absorb the room's error. That keeps both
 * halves honest. The square walls stay exactly solvable, and the chamfer stays a
 * chamfer instead of being quietly absorbed into its neighbours.
 *
 * Curved walls still need a different solver and do not pretend to work here.
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
 * A wall that does not run along an axis.
 *
 * The run is the truth. A direction like 70.441 degrees has no exact
 * representation in any number of decimal places, so storing an angle and a
 * length would mean the room's corners depended on a rounding. Storing the run —
 * the exact whole-nanometre offset from this wall's first corner to its second —
 * means the closure sum stays exact integers, which is the one property the
 * whole model rests on.
 *
 * The length on the drawing is then derived from the run, to the nearest
 * nanometre. That is a rounding, and it is the honest place to put one: a number
 * shown to a person, at a precision five thousand times finer than the best tape.
 */
export interface Diagonal {
  readonly kind: 'diagonal';
  readonly run: { readonly x: Nanometres; readonly y: Nanometres };
}

export type Direction = Heading | Diagonal;

export function isDiagonal(direction: Direction): direction is Diagonal {
  return typeof direction !== 'string';
}

/**
 * How far a run's length may sit from the `length` recorded against it.
 *
 * Building a diagonal from a length and a direction rounds twice — once turning
 * the direction into whole nanometres, once taking the square root — so the two
 * can disagree by a few nanometres. Four nanometres is four billionths of a
 * metre, about one six-millionth of an inch. Anything larger is a real
 * disagreement and `validate()` refuses it.
 */
export const DIAGONAL_SLACK: Nanometres = 4n;

/**
 * A diagonal of a given length pointing a given way.
 *
 * `towards` is a direction, not a distance: any two integers with the right
 * ratio will do, and the length decides how far it actually goes. That is what
 * lets a person tape a chamfer, type 8 inches, and keep the angle the scan
 * measured.
 *
 * The arithmetic stays in integers throughout. Each component is
 * `sqrt(length^2 * towards^2 / (towards.x^2 + towards.y^2))`, taken with the
 * integer root, which is the same on every machine and never drifts.
 */
export function diagonal(length: Nanometres, towards: { x: bigint; y: bigint }): Diagonal {
  if (length <= 0n) {
    throw new RoomError(`A diagonal wall of ${formatFeetInches(length)} runs nowhere.`);
  }
  if (towards.x === 0n && towards.y === 0n) {
    throw new RoomError('A diagonal wall needs a direction; (0, 0) is not one.');
  }
  if (towards.x === 0n || towards.y === 0n) {
    throw new RoomError(
      `That direction runs straight ${towards.x === 0n ? 'north-south' : 'east-west'}, so it is a ` +
        `plain wall with a heading, not a diagonal. Use the heading — it stays exact.`
    );
  }
  const squared = towards.x * towards.x + towards.y * towards.y;
  const component = (towards_: bigint): Nanometres => {
    const magnitude = isqrt((length * length * towards_ * towards_) / squared);
    return towards_ < 0n ? -magnitude : magnitude;
  };
  return { kind: 'diagonal', run: { x: component(towards.x), y: component(towards.y) } };
}

/** A diagonal straight from two known corners — what an importer has. */
export function diagonalFromRun(x: Nanometres, y: Nanometres): Diagonal {
  if (x === 0n || y === 0n) {
    throw new RoomError(
      `A run of (${x}, ${y}) is axis-aligned, so it is a plain wall with a heading, not a diagonal.`
    );
  }
  return { kind: 'diagonal', run: { x, y } };
}

/** The exact offset a wall adds to the walk, whichever kind it is. */
export function runOf(wall: Wall): Point {
  if (isDiagonal(wall.heading)) return wall.heading.run;
  const step = SIGN[wall.heading] * wall.length.value;
  return AXIS[wall.heading] === 'x' ? { x: step, y: 0n } : { x: 0n, y: step };
}

/** The axis a wall runs along, or null when it runs along neither. */
export function axisOf(wall: Wall): 'x' | 'y' | null {
  return isDiagonal(wall.heading) ? null : AXIS[wall.heading];
}

/** How long a wall's run actually is, to the nearest nanometre. */
export function runLength(wall: Wall): Nanometres {
  const run = runOf(wall);
  return isDiagonal(wall.heading) ? hypotenuse(run.x, run.y) : wall.length.value;
}

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
  /**
   * How far the bottom of the opening sits above the finished floor.
   *
   * Doors and cased openings start at the floor, so they leave this unset. A
   * window does not, and RoomPlan does not tell you: its export gives a window a
   * centre and a height in the room's own frame and nothing that names a sill.
   * The number is recoverable — Sam's kitchen window works out at 927 mm, a
   * normal sill — but it is recovered, not read, so it carries provenance like
   * any other measurement rather than arriving as a bare number.
   *
   * A window without one cannot be cut by a section plane honestly, so the
   * section view names it and asks rather than guessing. See `section.ts`.
   */
  readonly sillHeight?: Measurement;
}

export interface Wall {
  readonly id: string;
  /** A compass heading for a square wall, or an exact run for one that is not. */
  readonly heading: Direction;
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
  /** Diagonal walls the solver refused to stretch, if any were in the way. */
  readonly heldDiagonals: readonly string[];

  constructor(
    axis: 'x' | 'y',
    residual: Nanometres,
    wallIds: readonly string[],
    heldDiagonals: readonly string[] = []
  ) {
    super(
      `The ${axis === 'x' ? 'east-west' : 'north-south'} walls do not add up: they are out by ` +
        `${formatFeetInches(abs(residual))} and every one of them (${wallIds.join(', ')}) has been ` +
        `verified by a person. Two of these measurements disagree — re-check them rather than ` +
        `letting the room close on a number nobody stands behind.` +
        (heldDiagonals.length > 0
          ? ` The angled wall${heldDiagonals.length === 1 ? '' : 's'} ` +
            `(${heldDiagonals.join(', ')}) ${heldDiagonals.length === 1 ? 'was' : 'were'} held ` +
            `rather than stretched, because stretching one changes its angle. If the disagreement ` +
            `is there, re-measure it.`
          : '')
    );
    this.axis = axis;
    this.residual = residual;
    this.wallIds = wallIds;
    this.heldDiagonals = heldDiagonals;
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
  for (const wall of room.walls) {
    if (!isDiagonal(wall.heading)) continue;
    const { x, y } = wall.heading.run;
    if (x === 0n || y === 0n) {
      throw new RoomError(
        `Wall "${wall.id}" is marked diagonal but runs (${x}, ${y}), which is along an axis. ` +
          `Give it a heading instead; a heading stays exact.`
      );
    }
    const actual = hypotenuse(x, y);
    const stated = wall.length.value;
    if (abs(actual - stated) > DIAGONAL_SLACK) {
      throw new RoomError(
        `Wall "${wall.id}" says it is ${formatFeetInches(stated)} long, but its run is ` +
          `${formatFeetInches(actual)}. A diagonal's run and its length have to agree; ` +
          `re-make it with diagonal() rather than editing one of the two.`
      );
    }
  }
  for (let i = 0; i < room.walls.length; i += 1) {
    const here = room.walls[i]!;
    const next = room.walls[(i + 1) % room.walls.length]!;
    // A diagonal may sit beside anything — that is what it is for. Two square
    // walls in a row on the same axis are still a mistake: they are one wall
    // written twice, and the solver would move both to fix one error.
    const hereAxis = axisOf(here);
    if (hereAxis !== null && hereAxis === axisOf(next)) {
      throw new RoomError(
        `Walls "${here.id}" and "${next.id}" both run ${hereAxis === 'x' ? 'east-west' : 'north-south'}. ` +
          `In a rectilinear room every wall turns a corner into the next one. If there is a real ` +
          `angle between them, the wall carrying it is a diagonal — build it with diagonal().`
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
    const step = runOf(wall);
    x += step.x;
    y += step.y;
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
    const step = runOf(wall);
    x += step.x;
    y += step.y;
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

  // Diagonals are held. Stretching one along a single axis would change its
  // angle, and the angle is a measurement too — a 70-degree chamfer that quietly
  // becomes a 68-degree one to make the arithmetic work is exactly the silent
  // drift this module exists to stop. A diagonal changes only when a person
  // re-measures it.
  const onAxis = room.walls.filter((w) => axisOf(w) === axis);
  const movable = onAxis.filter((w) => !isVerified(w.length));

  if (movable.length === 0) {
    const held = room.walls.filter((w) => isDiagonal(w.heading)).map((w) => w.id);
    throw new ClosureConflict(axis, residual, onAxis.map((w) => w.id), held);
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
    const by = SIGN[wall.heading as Heading] * shares[i]!;
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
    add(...room.walls.map((w) => runLength(w)))
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
    .map((w) => ({ wallId: w.id, areaAtStake: runLength(w) * toleranceOf(w.length) }))
    .filter((w) => w.areaAtStake > 0n)
    .sort((a, b) => (a.areaAtStake === b.areaAtStake ? 0 : a.areaAtStake > b.areaAtStake ? -1 : 1))
    .slice(0, limit);
}

export { LengthError, MeasurementError };
