import { type Nanometres, NM_PER_INCH, formatFeetInches } from './length.ts';
import { type Measurement, drawnOn } from './measurement.ts';
import { type Direction, type Room, type Wall, RoomError } from './room.ts';

/**
 * A room drawn by tapping its corners.
 *
 * ## What this replaces, and why
 *
 * `draft.ts` asks for a room one wall at a time: a compass direction and a
 * typed length, over and over, with the app announcing what is "still to come
 * back". It is exact and it is the only way to draw a room whose numbers are
 * all measured — and it is miserable to use:
 *
 * > "THIS WAY MAKES IT SO HARD TO DRAW THE ROOM, AND EVEN THEN YOU ARE SO
 * >  RESTRICTED TO A DESIGN, MAYBE HAVE SOME WAY TO MAKE POINTS AND LINES AND
 * >  A WAY TO LABEL THE WALL AFTER CLICKING, AND CHANGE THINGS"
 *
 * Right on every count. Nobody thinks about a room as a sequence of compass
 * headings; they think about its shape. So this takes the shape first — tap the
 * corners, they join up, close the loop — and leaves naming and measuring for
 * afterwards, on whichever wall somebody cares about.
 *
 * `draft.ts` stays. A room typed wall by wall is measured from the first
 * keystroke and this one is not, and that difference is worth keeping both for.
 *
 * ## The rule that makes it safe
 *
 * **A tapped corner is not a measurement.** Every wall this produces is
 * `drawnOn` — derived, with an honest tolerance of one grid square — so a room
 * drawn in ten seconds says "drawn, not measured" and the app still refuses to
 * call it measured until a tape has been on one wall running each way. Typing a
 * length on a wall afterwards is what makes that wall verified, exactly as it
 * is everywhere else in this app.
 *
 * Nothing here rounds a measurement. Corners are whole nanometres on a grid of
 * whole nanometres, and every length is worked out from them by integer
 * arithmetic.
 */

export interface Corner {
  readonly x: Nanometres;
  readonly y: Nanometres;
}

export interface Sketch {
  readonly id: string;
  readonly name: string;
  /** In the order they were tapped. The last joins the first when `closed`. */
  readonly corners: readonly Corner[];
  readonly closed: boolean;
  /** What one tap is worth. Half of this is how far a corner may be out. */
  readonly grid: Nanometres;
  readonly ceilingHeight: Measurement;
  readonly drawnBy: string;
  readonly drawnAt: string;
}

export class SketchError extends RoomError {}

/** Six inches. Fine enough for a real room, coarse enough for a thumb. */
export const DEFAULT_GRID: Nanometres = 6n * NM_PER_INCH;

/**
 * How far off an axis a run may be and still be treated as square.
 *
 * Twenty degrees, as a ratio of the short side to the long one:
 * `tan(20°) ≈ 0.36397`. Most rooms are square and a thumb is not, so a corner
 * that is nearly square is meant to be square. Past twenty degrees somebody is
 * plainly drawing an angle — a bay window, a cut corner — and the app takes the
 * angle they drew rather than flattening it into a shape the room does not
 * have.
 */
const SQUARE_WITHIN = { short: 36_397n, long: 100_000n };

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/**
 * The nearest grid line, in whole nanometres.
 *
 * Rounds half away from zero, so a corner exactly between two lines does not
 * drift toward the origin — which over a dozen taps would pull a room's far
 * corner in by a grid square.
 */
export function snap(value: Nanometres, grid: Nanometres): Nanometres {
  if (grid <= 0n) throw new SketchError('A grid has to have a size.');
  const half = grid / 2n;
  return value >= 0n
    ? ((value + half) / grid) * grid
    : -(((-value + half) / grid) * grid);
}

export interface StartOptions {
  readonly id: string;
  readonly name: string;
  readonly drawnBy: string;
  readonly drawnAt: string;
  readonly ceilingHeight: Measurement;
  readonly grid?: Nanometres;
}

export function startSketch(options: StartOptions): Sketch {
  return {
    id: options.id,
    name: options.name,
    corners: [],
    closed: false,
    grid: options.grid ?? DEFAULT_GRID,
    ceilingHeight: options.ceilingHeight,
    drawnBy: options.drawnBy,
    drawnAt: options.drawnAt,
  };
}

/**
 * Where a tap actually lands, given where the last corner is.
 *
 * On the grid first, then square to the previous corner when it is within
 * twenty degrees of an axis. Exported because the screen draws the corner under
 * the finger before it is committed, and the preview has to be the same
 * arithmetic as the commit — a preview that lands somewhere else than the tap
 * is worse than no preview.
 */
export function wouldLand(sketch: Sketch, at: Corner): Corner {
  const on: Corner = { x: snap(at.x, sketch.grid), y: snap(at.y, sketch.grid) };
  const last = sketch.corners[sketch.corners.length - 1];
  if (!last) return on;

  const dx = on.x - last.x;
  const dy = on.y - last.y;
  if (dx === 0n || dy === 0n) return on;

  const short = abs(dx) < abs(dy) ? abs(dx) : abs(dy);
  const long = abs(dx) < abs(dy) ? abs(dy) : abs(dx);
  const nearlySquare = short * SQUARE_WITHIN.long < long * SQUARE_WITHIN.short;
  if (!nearlySquare) return on;

  // Flatten the short side. The long one is the wall somebody meant to draw.
  return abs(dx) < abs(dy) ? { x: last.x, y: on.y } : { x: on.x, y: last.y };
}

/** Whether a tap here would close the loop rather than add a corner. */
export function wouldClose(sketch: Sketch, at: Corner): boolean {
  const first = sketch.corners[0];
  if (!first || sketch.closed || sketch.corners.length < 3) return false;
  const on: Corner = { x: snap(at.x, sketch.grid), y: snap(at.y, sketch.grid) };
  return abs(on.x - first.x) <= sketch.grid && abs(on.y - first.y) <= sketch.grid;
}

/**
 * One more corner.
 *
 * A tap on top of the last corner is ignored rather than refused: on a phone
 * that is a double tap, and a room with two corners in the same place has a
 * wall of no length in it.
 */
export function addCorner(sketch: Sketch, at: Corner): Sketch {
  if (sketch.closed) {
    throw new SketchError('That room is closed. Move a corner, or open it again.');
  }
  const landed = wouldLand(sketch, at);
  const last = sketch.corners[sketch.corners.length - 1];
  if (last && last.x === landed.x && last.y === landed.y) return sketch;
  return { ...sketch, corners: [...sketch.corners, landed] };
}

/** Somebody dragged a corner. Snapped, but never squared — they are aiming. */
export function moveCorner(sketch: Sketch, index: number, to: Corner): Sketch {
  if (index < 0 || index >= sketch.corners.length) {
    throw new SketchError(`There is no corner ${index} to move.`);
  }
  const landed: Corner = { x: snap(to.x, sketch.grid), y: snap(to.y, sketch.grid) };
  return {
    ...sketch,
    corners: sketch.corners.map((corner, i) => (i === index ? landed : corner)),
  };
}

export function removeCorner(sketch: Sketch, index: number): Sketch {
  if (index < 0 || index >= sketch.corners.length) {
    throw new SketchError(`There is no corner ${index} to take out.`);
  }
  if (sketch.closed && sketch.corners.length <= 3) {
    throw new SketchError(
      'A closed room needs at least three corners. Open it first, or move this one instead.'
    );
  }
  return { ...sketch, corners: sketch.corners.filter((_, i) => i !== index) };
}

/** Joins the last corner back to the first. */
export function close(sketch: Sketch): Sketch {
  if (sketch.closed) return sketch;
  if (sketch.corners.length < 3) {
    throw new SketchError(
      `A room needs at least three corners and this one has ${sketch.corners.length}.`
    );
  }
  return { ...sketch, closed: true };
}

export function open(sketch: Sketch): Sketch {
  return sketch.closed ? { ...sketch, closed: false } : sketch;
}

/** The runs a closed sketch makes, first corner to second and round. */
export function runs(sketch: Sketch): { from: Corner; to: Corner }[] {
  const out: { from: Corner; to: Corner }[] = [];
  const n = sketch.corners.length;
  const last = sketch.closed ? n : n - 1;
  for (let i = 0; i < last; i += 1) {
    out.push({ from: sketch.corners[i]!, to: sketch.corners[(i + 1) % n]! });
  }
  return out;
}

/** Integer square root, so a diagonal's length is exact to the nanometre. */
function root(value: bigint): bigint {
  if (value < 0n) throw new SketchError('No square root of a negative length.');
  if (value < 2n) return value;
  let guess = value;
  let next = (guess + 1n) / 2n;
  while (next < guess) {
    guess = next;
    next = (guess + value / guess) / 2n;
  }
  return guess;
}

/** Which way a run goes, as a heading when it is square and a run when not. */
export function directionOf(from: Corner, to: Corner): Direction {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dy === 0n) return dx >= 0n ? 'east' : 'west';
  if (dx === 0n) return dy >= 0n ? 'north' : 'south';
  return { kind: 'diagonal', run: { x: dx, y: dy } };
}

/** How long a run is, in whole nanometres. */
export function lengthOf(from: Corner, to: Corner): Nanometres {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dy === 0n) return abs(dx);
  if (dx === 0n) return abs(dy);
  return root(dx * dx + dy * dy);
}

/**
 * The room a sketch draws.
 *
 * Every wall's length is `drawnOn` — derived, with a tolerance of one grid
 * square, because a corner may be half a square out at each end. **Not one of
 * them is verified**, so the room says "drawn, not measured" and the app goes
 * on asking for a tape on one wall running each way. Typing a length on a wall
 * afterwards is what verifies that wall, exactly as it does on a scan.
 */
export function sketchToRoom(sketch: Sketch): Room {
  if (!sketch.closed) {
    throw new SketchError('Close the room before turning it into a drawing.');
  }
  const made = runs(sketch);
  if (made.length < 3) {
    throw new SketchError(`A closed room needs at least three walls; this has ${made.length}.`);
  }

  const walls: Wall[] = made.map((run, i) => {
    const length = lengthOf(run.from, run.to);
    if (length === 0n) {
      throw new SketchError(
        `Two corners are in the same place, so wall ${i + 1} has no length. Move one of them.`
      );
    }
    return {
      id: `wall-${i + 1}`,
      heading: directionOf(run.from, run.to),
      length: drawnOn(length, sketch.grid),
    };
  });

  return {
    id: sketch.id,
    name: sketch.name,
    walls,
    ceilingHeight: sketch.ceilingHeight,
  };
}

/** What the screen says about a sketch as it is being drawn. */
export interface Progress {
  readonly corners: number;
  /** Whether tapping near the first corner would close it. */
  readonly canClose: boolean;
  readonly closed: boolean;
  /** Each run so far, for the lengths drawn along the lines. */
  readonly walls: readonly { readonly length: Nanometres; readonly label: string }[];
  /** What to say next, in the words a person would use. */
  readonly saying: string;
}

export function progress(sketch: Sketch): Progress {
  const walls = runs(sketch).map((run) => {
    const length = lengthOf(run.from, run.to);
    return { length, label: formatFeetInches(length) };
  });

  const saying = sketch.closed
    ? 'Tap a wall to name it or put a tape reading on it.'
    : sketch.corners.length === 0
      ? 'Tap a corner of the room to start.'
      : sketch.corners.length < 3
        ? 'Keep tapping corners, the way you would walk round the room.'
        : 'Tap the first corner again to close it, or keep going.';

  return {
    corners: sketch.corners.length,
    canClose: sketch.corners.length >= 3 && !sketch.closed,
    closed: sketch.closed,
    walls,
    saying,
  };
}

/*
 * There is deliberately no `measureWall` here.
 *
 * One was written — a tape reading typed onto one wall of a drawn room — and
 * `check-reachable.py` caught it before it shipped: tested, and nothing else
 * calling it. Which was correct, because the app already has exactly one way to
 * put a tape on a wall, and it works on a drawn room the same as on a scanned
 * one: tap the wall, "It has had a tape on it", and the reducer's `verify`
 * does the rest.
 *
 * A second path to the same thing is two things to keep in step, and the one
 * that drifts is always the one nobody is looking at.
 */
