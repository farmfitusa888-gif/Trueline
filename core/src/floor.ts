import { type Nanometres, abs, add, formatFeetInches, hypotenuse } from './length.ts';
import {
  type Opening,
  type Point,
  type Room,
  type Wall,
  RoomError,
  corners,
  isDiagonal,
  runLength,
  runOf,
  validate,
} from './room.ts';
import { thicknessOf } from './thickness.ts';
import { roomQuantities } from './zone.ts';

/**
 * More than one room, and the part every scanner in the field gives up on.
 *
 * Apple's own words for the limit: a merge is *"a single floor, a single
 * horizontal plane"*, each scanned room arrives **in its own coordinate
 * system**, and the merge "optimises the final model's appearance at the
 * expense of accuracy". Every consumer app inherits that, and it is why the
 * second room is where they visibly fall apart.
 *
 * This does not try to guess how rooms fit together. It cannot be done honestly
 * from two captures — there is nothing in either one that says which door is
 * which — and an app that guessed would produce a floor plan that looked right
 * and was wrong, which is this product's definition of the worst possible
 * output.
 *
 * So **a person says how they connect**, once, in the only terms that are not
 * ambiguous: *this door in the kitchen is that door in the hall.* From there
 * the placement is not a fit, it is arithmetic:
 *
 *   - The two walls are back to back, so walking each room in order traverses
 *     the shared wall in opposite directions. That fixes the rotation, and in a
 *     rectilinear room it is a quarter turn — exact, no trigonometry, no drift.
 *   - The two openings are the same hole, so their midpoints are the same place.
 *     That fixes the translation, in whole nanometres.
 *   - The two rooms are separated by the thickness of the wall between them,
 *     because each outline is its own room's inside face.
 *
 * And the thing nobody else offers: **when the rooms come back round in a
 * loop**, the two ways of reaching the last one have to agree. Kitchen to hall
 * to dining to kitchen either closes or it does not, and by how much is the
 * accumulated error of three separate scans. That number is reported rather
 * than smoothed away — it is the most honest measure of a scan's quality this
 * product can produce, and it is exactly what a merge that "optimises
 * appearance" hides.
 */

export class FloorError extends RoomError {}

/** Which door, in which wall, in which room. */
export interface Doorway {
  readonly roomId: string;
  readonly wallId: string;
  readonly openingId: string;
}

/**
 * One person's statement that two openings are the same opening.
 *
 * A declaration, not a measurement, so it records who said it and when and
 * carries no tolerance of its own. It is the same shape as a zone boundary and
 * for the same reason: nobody measured anything, somebody decided something.
 */
export interface Join {
  readonly id: string;
  readonly declaredBy: string;
  readonly declaredAt: string;
  readonly from: Doorway;
  readonly to: Doorway;
}

export interface Floor {
  readonly id: string;
  readonly name: string;
  readonly rooms: readonly Room[];
  readonly joins: readonly Join[];
}

/** Quarter turns anticlockwise. Exact: a rectilinear room only ever needs these. */
export type Quarter = 0 | 1 | 2 | 3;

export interface Placement {
  readonly roomId: string;
  readonly turn: Quarter;
  readonly offset: Point;
}

export interface Placed {
  readonly room: Room;
  readonly placement: Placement;
  /** The room's corners on the floor, in the floor's own coordinates. */
  readonly outline: readonly Point[];
}

/** Something worth saying about a floor that is not an error. */
export interface FloorNote {
  readonly kind: 'no-thickness' | 'loop' | 'overlap' | 'unreachable';
  readonly what: string;
  /** How far out, where that is a number. Zero when the note is not about a gap. */
  readonly by: Nanometres;
}

export interface Layout {
  readonly placed: readonly Placed[];
  /** Rooms no chain of joins reaches from the first one. */
  readonly unplaced: readonly string[];
  readonly notes: readonly FloorNote[];
}

/* ------------------------------------------------------------ turning */

export function turnPoint(p: Point, turn: Quarter): Point {
  switch (turn) {
    case 0:
      return p;
    case 1:
      return { x: -p.y, y: p.x };
    case 2:
      return { x: -p.x, y: -p.y };
    case 3:
      return { x: p.y, y: -p.x };
  }
}

/** The quarter turn that takes `from` onto `to`, or nothing when none does. */
function quarterFrom(from: Point, to: Point): Quarter | undefined {
  for (const turn of [0, 1, 2, 3] as const) {
    const t = turnPoint(from, turn);
    // Directions, so compare by cross and dot rather than by equality: the two
    // walls are the same wall measured twice and their lengths differ by
    // whatever the scanner was out by.
    if (t.x * to.y - t.y * to.x !== 0n) continue;
    if (t.x * to.x + t.y * to.y > 0n) return turn;
  }
  return undefined;
}

/* -------------------------------------------------------- looking things up */

function room(floor: Floor, id: string): Room {
  const found = floor.rooms.find((r) => r.id === id);
  if (!found) throw new FloorError(`"${floor.name}" has no room with the id "${id}".`);
  return found;
}

function wallOf(r: Room, wallId: string): { wall: Wall; index: number } {
  const index = r.walls.findIndex((w) => w.id === wallId);
  if (index === -1) throw new FloorError(`Room "${r.name}" has no wall called "${wallId}".`);
  return { wall: r.walls[index]!, index };
}

function openingOf(wall: Wall, openingId: string): Opening {
  const found = (wall.openings ?? []).find((o) => o.id === openingId);
  if (!found) {
    throw new FloorError(`Wall "${wall.id}" has nothing in it called "${openingId}".`);
  }
  return found;
}

/**
 * Where an opening's middle sits in its own room's coordinates, and which way
 * the wall it is in runs.
 *
 * The midpoint rather than an edge, on purpose: the same door scanned from
 * either side comes back a little different in width, and the two edges would
 * disagree by that difference while the middles agree.
 */
function doorway(
  floor: Floor,
  where: Doorway
): { at: Point; along: Point; outward: Point; thickness?: Nanometres } {
  const r = room(floor, where.roomId);
  validate(r);
  const { wall, index } = wallOf(r, where.wallId);
  const opening = openingOf(wall, where.openingId);
  if (isDiagonal(wall.heading)) {
    throw new FloorError(
      `"${wall.id}" in ${r.name} runs at an angle. Joining rooms through an angled wall needs ` +
        `a rotation that is not a quarter turn, and every placement in this model is exact ` +
        `integers because it is. Join these two through a square wall instead.`
    );
  }

  const points = corners(r);
  const start = points[index]!;
  const run = runOf(wall);
  const length = runLength(wall);
  const middle = opening.offsetFromStart.value + opening.width.value / 2n;

  // Along the wall, scaled to the opening's middle. Exact: one of the two
  // components is zero on a square wall, so this is a single integer product.
  const at: Point = {
    x: start.x + (run.x * middle) / length,
    y: start.y + (run.y * middle) / length,
  };

  // Walking a room's outline keeps its inside on one hand the whole way round,
  // so the outward normal is the run turned the same way at every wall — and
  // which way that is depends on which way round the outline was walked. The
  // importer promises nothing about that, so it is worked out rather than
  // assumed. Getting it wrong puts the next room inside this one.
  const hand = winding(r) > 0n ? 1n : -1n;
  const outward: Point = { x: hand * run.y, y: -hand * run.x };

  const t = thicknessOf(wall, r);
  return { at, along: run, outward, ...(t ? { thickness: t.value } : {}) };
}

/** Twice the signed area — positive when the outline is walked anticlockwise. */
function winding(r: Room): bigint {
  const points = corners(r);
  let twice = 0n;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    twice += a.x * b.y - b.x * a.y;
  }
  return twice;
}

/* --------------------------------------------------------------- placing */

/**
 * Where the second room goes, given that one of its doors is one of the first
 * room's doors.
 *
 * The whole placement in six lines of arithmetic, and every one of them exact.
 */
function place(floor: Floor, anchor: Placement, join: Join, forwards: boolean): Placement {
  const here = forwards ? join.from : join.to;
  const there = forwards ? join.to : join.from;

  const a = doorway(floor, here);
  const b = doorway(floor, there);

  // The two rooms are on **opposite sides** of the wall they share, so the wall's
  // outward normal points at the other room from either side. That is the
  // constraint, and it is the right one to state: "the walls run opposite ways"
  // is only true when both outlines happen to be walked the same way round, and
  // a room scanned starting from a different corner is not. Stating it as
  // normals instead makes the placement independent of how either room was
  // walked — which is exactly what a second scan cannot be relied on to match.
  const outward = turnPoint(a.outward, anchor.turn);
  const turn = quarterFrom(b.outward, { x: -outward.x, y: -outward.y });
  if (turn === undefined) {
    throw new FloorError(
      `The walls either side of "${join.id}" do not line up. "${here.wallId}" in ` +
        `${room(floor, here.roomId).name} and "${there.wallId}" in ` +
        `${room(floor, there.roomId).name} would have to be back to back, and no quarter turn ` +
        `puts them there. One of the two openings is probably in the wrong wall.`
    );
  }

  // The two openings are the same hole, so their middles are the same place —
  // give or take the thickness of the wall between them, because each outline
  // is its own room's *inside* face.
  const t = a.thickness ?? b.thickness ?? 0n;
  const length = hypotenuse(outward.x, outward.y);
  const gap: Point =
    t === 0n || length === 0n
      ? { x: 0n, y: 0n }
      : { x: (outward.x * t) / length, y: (outward.y * t) / length };

  const anchored = turnPoint(a.at, anchor.turn);
  const mine = turnPoint(b.at, turn);
  return {
    roomId: there.roomId,
    turn,
    offset: {
      x: anchor.offset.x + anchored.x + gap.x - mine.x,
      y: anchor.offset.y + anchored.y + gap.y - mine.y,
    },
  };
}

function outlineOf(r: Room, placement: Placement): Point[] {
  return corners(r).map((p) => {
    const t = turnPoint(p, placement.turn);
    return { x: t.x + placement.offset.x, y: t.y + placement.offset.y };
  });
}

/**
 * Lays the floor out, and says what it could not do.
 *
 * The first room is the anchor: it keeps its own coordinates, so a floor of one
 * room is that room and nothing has moved. Every other room is reached across a
 * join from one already placed.
 *
 * Reaching the same room two different ways is the interesting case and it is
 * not an error — it is the loop closing, or not. Three rooms scanned separately
 * and joined in a ring have three separate scans' worth of error in them, and
 * how far the ring misses by is reported rather than smoothed away. That figure
 * is the most honest thing this product can say about the quality of a set of
 * scans, and it is precisely what a merge that "optimises appearance" hides.
 */
export function layout(floor: Floor): Layout {
  if (floor.rooms.length === 0) throw new FloorError(`"${floor.name}" has no rooms in it.`);
  for (const r of floor.rooms) validate(r);

  const ids = new Set<string>();
  for (const r of floor.rooms) {
    if (ids.has(r.id)) throw new FloorError(`Two rooms on "${floor.name}" share the id "${r.id}".`);
    ids.add(r.id);
  }

  const notes: FloorNote[] = [];
  const first = floor.rooms[0]!;
  const placements = new Map<string, Placement>();
  placements.set(first.id, { roomId: first.id, turn: 0, offset: { x: 0n, y: 0n } });

  // Breadth first, so a room is placed from the shortest chain of joins that
  // reaches it. A shorter chain has fewer scans' worth of error in it.
  const queue: string[] = [first.id];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const current = placements.get(currentId)!;
    for (const join of floor.joins) {
      for (const forwards of [true, false] as const) {
        const from = forwards ? join.from : join.to;
        const to = forwards ? join.to : join.from;
        if (from.roomId !== currentId) continue;

        const found = place(floor, current, join, forwards);
        const already = placements.get(to.roomId);
        if (!already) {
          placements.set(to.roomId, found);
          queue.push(to.roomId);
          const t = doorway(floor, from).thickness ?? doorway(floor, to).thickness;
          if (t === undefined) {
            notes.push({
              kind: 'no-thickness',
              what:
                `Nobody has said how thick the wall between ${room(floor, from.roomId).name} and ` +
                `${room(floor, to.roomId).name} is, so they are drawn touching. The floor is ` +
                `short by that thickness across "${join.id}".`,
              by: 0n,
            });
          }
          continue;
        }

        // Reached twice. The two answers have to agree, and how far they do not
        // is the accumulated error of every scan round the loop.
        const off = hypotenuse(
          already.offset.x - found.offset.x,
          already.offset.y - found.offset.y
        );
        if (already.turn !== found.turn) {
          notes.push({
            kind: 'loop',
            what:
              `Going round through "${join.id}" puts ${room(floor, to.roomId).name} at a ` +
              `different angle from the way it was reached first. Two of these joins disagree ` +
              `about which wall is which.`,
            by: off,
          });
        } else if (off > 0n) {
          notes.push({
            kind: 'loop',
            what:
              `The rooms come back round to ${room(floor, to.roomId).name} ` +
              `${formatFeetInches(off)} away from where they started. That is every scan in the ` +
              `loop's error added up — it is not corrected here, because correcting it would ` +
              `mean moving walls nobody measured.`,
            by: off,
          });
        }
      }
    }
  }

  const placed: Placed[] = floor.rooms
    .filter((r) => placements.has(r.id))
    .map((r) => {
      const placement = placements.get(r.id)!;
      return { room: r, placement, outline: outlineOf(r, placement) };
    });

  const unplaced = floor.rooms.filter((r) => !placements.has(r.id)).map((r) => r.id);
  for (const id of unplaced) {
    notes.push({
      kind: 'unreachable',
      what:
        `Nothing connects ${room(floor, id).name} to the rest of the floor. Say which of its ` +
        `doors is which door in another room and it will find its place.`,
      by: 0n,
    });
  }

  for (const clash of overlaps(placed)) {
    notes.push({
      kind: 'overlap',
      what:
        `${clash.a} and ${clash.b} are drawn on top of each other. Two rooms cannot be in the ` +
        `same place — one of the joins names the wrong door, or one of the scans is of a room ` +
        `that was already scanned.`,
      by: 0n,
    });
  }

  return { placed, unplaced, notes };
}

/* ------------------------------------------------------------- overlapping */

function bounds(outline: readonly Point[]): { lo: Point; hi: Point } {
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  return {
    lo: { x: xs.reduce((a, b) => (a < b ? a : b)), y: ys.reduce((a, b) => (a < b ? a : b)) },
    hi: { x: xs.reduce((a, b) => (a > b ? a : b)), y: ys.reduce((a, b) => (a > b ? a : b)) },
  };
}

/**
 * Rooms sitting on top of each other.
 *
 * A bounding-box test, and it is deliberately the loose one: an L-shaped room
 * beside a rectangle can have boxes that touch without either room being inside
 * the other, so this reports where two rooms *substantially* share ground
 * rather than where their boxes graze. It is a check on the joins somebody
 * declared, not a geometry engine.
 */
export function overlaps(
  placed: readonly Placed[]
): readonly { a: string; b: string; area: bigint }[] {
  const out: { a: string; b: string; area: bigint }[] = [];
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const p = bounds(placed[i]!.outline);
      const q = bounds(placed[j]!.outline);
      const wide = min(p.hi.x, q.hi.x) - max(p.lo.x, q.lo.x);
      const tall = min(p.hi.y, q.hi.y) - max(p.lo.y, q.lo.y);
      if (wide <= 0n || tall <= 0n) continue;
      const shared = wide * tall;
      // A tenth of the smaller room. Below that it is two boxes grazing at a
      // corner, which is what an L beside a rectangle looks like.
      const smaller = min(
        (p.hi.x - p.lo.x) * (p.hi.y - p.lo.y),
        (q.hi.x - q.lo.x) * (q.hi.y - q.lo.y)
      );
      if (shared * 10n < smaller) continue;
      out.push({ a: placed[i]!.room.name, b: placed[j]!.room.name, area: shared });
    }
  }
  return out;
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);
const max = (a: bigint, b: bigint) => (a > b ? a : b);

/* -------------------------------------------------------------- the whole */

export interface FloorQuantities {
  readonly floorArea: bigint;
  readonly ceilingArea: bigint;
  readonly baseboardRun: Nanometres;
  readonly wallFaceArea: bigint;
  readonly openRun: Nanometres;
  /** Per room, so nobody has to add a list up to see whether it reconciles. */
  readonly rooms: readonly { readonly name: string; readonly floorArea: bigint }[];
}

/**
 * What a whole floor takes.
 *
 * Rooms that could not be placed are **left out and named by `layout`**, not
 * quietly added in. A total that silently includes a room nobody could place is
 * a total nobody can check.
 *
 * A shared wall is counted once from each side, which is right: both faces get
 * drywall, both get paint, and both get baseboard.
 */
export function floorQuantities(floor: Floor): FloorQuantities {
  const { placed } = layout(floor);
  const each = placed.map((p) => ({ name: p.room.name, q: roomQuantities(p.room) }));
  return {
    floorArea: each.reduce((t, r) => t + r.q.floorArea, 0n),
    ceilingArea: each.reduce((t, r) => t + r.q.ceilingArea, 0n),
    baseboardRun: add(...each.map((r) => r.q.baseboardRun)),
    wallFaceArea: each.reduce((t, r) => t + r.q.wallFaceArea, 0n),
    openRun: add(...each.map((r) => r.q.openRun)),
    rooms: each.map((r) => ({ name: r.name, floorArea: r.q.floorArea })),
  };
}

/** How far the floor reaches each way, once everything is placed. */
export function floorExtent(floor: Floor): { x: Nanometres; y: Nanometres } {
  const { placed } = layout(floor);
  const all = placed.flatMap((p) => p.outline);
  if (all.length === 0) return { x: 0n, y: 0n };
  const b = bounds(all);
  return { x: abs(b.hi.x - b.lo.x), y: abs(b.hi.y - b.lo.y) };
}
