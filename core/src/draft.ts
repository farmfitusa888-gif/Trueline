import { type Nanometres, type Unit, parseLength } from './length.ts';
import { type Measurement, verified } from './measurement.ts';
import { type Heading, type Room, type Wall, RoomError, closure, solve } from './room.ts';

/**
 * A room being drawn by hand, wall by wall.
 *
 * This is the capture mode that needs no camera, no LiDAR and no hardware in a
 * test — somebody with a tape and a phone, or somebody working from an old
 * drawing for a building they cannot get into. It is also the mode that drives
 * the solver end to end, which is why it is built first.
 *
 * Two things make it worth using rather than a drawing tool:
 *
 *   - **Typed, not dragged.** Hitting an exact fraction by dragging on a phone
 *     with gloves on is miserable. A wall is a heading and a number.
 *   - **The last wall is worked out, not asked for.** In a rectilinear room the
 *     final run on each axis is determined by the others, so the app should say
 *     what it must be rather than making somebody measure a wall the geometry
 *     already knows.
 *
 * Every dimension entered here is `verified` — a person typed it, and the record
 * says who and when. Nothing in this file guesses a length.
 */

export interface DraftWall {
  readonly id: string;
  readonly heading: Heading;
  readonly length: Measurement;
}

export interface Draft {
  readonly id: string;
  readonly name: string;
  readonly walls: readonly DraftWall[];
  readonly ceilingHeight: Measurement;
  readonly enteredBy: string;
}

export class DraftError extends RoomError {}

const AXIS: Record<Heading, 'x' | 'y'> = {
  east: 'x', west: 'x', north: 'y', south: 'y',
};
const SIGN: Record<Heading, 1n | -1n> = {
  east: 1n, north: 1n, west: -1n, south: -1n,
};

export interface StartOptions {
  readonly id: string;
  readonly name: string;
  readonly enteredBy: string;
  readonly at: string;
  /** Typed, like everything else here. */
  readonly ceilingHeight: string;
  readonly defaultUnit?: Unit;
}

export function startDraft(options: StartOptions): Draft {
  return {
    id: options.id,
    name: options.name,
    enteredBy: options.enteredBy,
    walls: [],
    ceilingHeight: verified(
      parseLength(options.ceilingHeight, { defaultUnit: options.defaultUnit ?? 'ft' }),
      options.enteredBy,
      options.at,
      'stated'
    ),
  };
}

/**
 * Adds a wall from what somebody typed.
 *
 * The heading must turn a corner from the wall before it. Two walls running the
 * same way are one wall, and two running opposite double back — neither is a
 * room, and both are refused here rather than at the end when the whole thing
 * fails to close and nobody knows which entry was wrong.
 */
export function addWall(
  draft: Draft,
  id: string,
  heading: Heading,
  length: string,
  at: string,
  options: { readonly defaultUnit?: Unit; readonly method?: 'tape' | 'laser' | 'plans' | 'stated' } = {}
): Draft {
  if (draft.walls.some((w) => w.id === id)) {
    throw new DraftError(`This room already has a wall called "${id}".`);
  }
  const previous = draft.walls[draft.walls.length - 1];
  if (previous && AXIS[previous.heading] === AXIS[heading]) {
    throw new DraftError(
      `"${id}" runs ${AXIS[heading] === 'x' ? 'east-west' : 'north-south'}, and so does the wall ` +
        `before it. Each wall turns a corner into the next one.`
    );
  }
  const value = parseLength(length, { defaultUnit: options.defaultUnit ?? 'ft' });
  if (value <= 0n) throw new DraftError(`A wall cannot be ${length}.`);

  return {
    ...draft,
    walls: [
      ...draft.walls,
      { id, heading, length: verified(value, draft.enteredBy, at, options.method ?? 'tape') },
    ],
  };
}

/** Corrects a wall already entered. The previous value is kept on the record. */
export function reviseWall(
  draft: Draft,
  id: string,
  length: string,
  at: string,
  options: { readonly defaultUnit?: Unit; readonly note?: string } = {}
): Draft {
  const index = draft.walls.findIndex((w) => w.id === id);
  if (index === -1) throw new DraftError(`This room has no wall called "${id}".`);
  const value = parseLength(length, { defaultUnit: options.defaultUnit ?? 'ft' });
  if (value <= 0n) throw new DraftError(`A wall cannot be ${length}.`);

  const walls = [...draft.walls];
  const existing = walls[index]!;
  walls[index] = {
    ...existing,
    length: {
      value,
      provenance: {
        kind: 'verified',
        verifiedBy: draft.enteredBy,
        verifiedAt: at,
        method: 'tape',
        ...(options.note === undefined ? {} : { note: options.note }),
        supersedes: existing.length,
      },
    },
  };
  return { ...draft, walls };
}

export function removeWall(draft: Draft, id: string): Draft {
  if (!draft.walls.some((w) => w.id === id)) {
    throw new DraftError(`This room has no wall called "${id}".`);
  }
  return { ...draft, walls: draft.walls.filter((w) => w.id !== id) };
}

/* ------------------------------------------------------- what is still needed */

export interface Remaining {
  /** How far east the walk still has to come back. Negative means west. */
  readonly x: Nanometres;
  readonly y: Nanometres;
  readonly closes: boolean;
}

/** How far the walk so far is from returning to where it started. */
export function remaining(draft: Draft): Remaining {
  let x = 0n;
  let y = 0n;
  for (const wall of draft.walls) {
    const step = SIGN[wall.heading] * wall.length.value;
    if (AXIS[wall.heading] === 'x') x += step;
    else y += step;
  }
  return { x: -x, y: -y, closes: x === 0n && y === 0n };
}

export interface SuggestedWall {
  readonly heading: Heading;
  readonly length: Nanometres;
}

/**
 * The wall the geometry already knows about.
 *
 * When exactly one run is outstanding, its heading and length are determined —
 * so the app states it rather than asking somebody to go and measure a wall it
 * can work out. Returns nothing when two runs are still open, because then there
 * are many rooms that would close and choosing one would be inventing a
 * dimension.
 */
export function suggestClosingWall(draft: Draft): SuggestedWall | null {
  if (draft.walls.length < 2) return null;
  const left = remaining(draft);
  if (left.closes) return null;
  if (left.x !== 0n && left.y !== 0n) return null;

  const last = draft.walls[draft.walls.length - 1]!;
  if (left.x !== 0n) {
    if (AXIS[last.heading] === 'x') return null; // would not turn a corner
    return { heading: left.x > 0n ? 'east' : 'west', length: left.x > 0n ? left.x : -left.x };
  }
  if (AXIS[last.heading] === 'y') return null;
  return { heading: left.y > 0n ? 'north' : 'south', length: left.y > 0n ? left.y : -left.y };
}

/* ------------------------------------------------------------------ finishing */

/**
 * Turns a finished draft into a room.
 *
 * Refuses a draft that does not close, and says by how much and in which
 * direction rather than reporting that something is wrong. Every wall here was
 * typed by a person, so there is nothing for the solver to move — if the numbers
 * do not add up, one of them is wrong and only the person who measured it can
 * say which.
 */
export function finish(draft: Draft): Room {
  if (draft.walls.length < 4) {
    throw new DraftError(
      `"${draft.name}" has ${draft.walls.length} wall${draft.walls.length === 1 ? '' : 's'}. ` +
        `A closed room needs at least four.`
    );
  }
  const first = draft.walls[0]!;
  const last = draft.walls[draft.walls.length - 1]!;
  if (AXIS[first.heading] === AXIS[last.heading]) {
    throw new DraftError(
      `The last wall of "${draft.name}" runs the same way as the first, so they do not turn a ` +
        `corner into each other.`
    );
  }

  const room: Room = {
    id: draft.id,
    name: draft.name,
    walls: draft.walls.map((w): Wall => ({ id: w.id, heading: w.heading, length: w.length })),
    ceilingHeight: draft.ceilingHeight,
  };

  const gap = closure(room);
  if (gap.x !== 0n || gap.y !== 0n) {
    throw new DraftError(
      `"${draft.name}" does not close. Walking these walls ends up ` +
        `${describeGap(gap.x, 'east', 'west')}${gap.x !== 0n && gap.y !== 0n ? ' and ' : ''}` +
        `${describeGap(gap.y, 'north', 'south')} of where it started. ` +
        `Every one of these lengths was typed by a person, so one of them is wrong — ` +
        `the app cannot choose which.`
    );
  }

  // Closes exactly, so solving is a formality that also proves it.
  return solve(room).room;
}

function describeGap(value: Nanometres, positive: string, negative: string): string {
  if (value === 0n) return '';
  const abs = value < 0n ? -value : value;
  return `${abs}nm ${value > 0n ? positive : negative}`;
}
