import { type Nanometres } from './length.ts';
import { type Point, area, corners, runLength } from './room.ts';
import { type Floor, type Placed, layout, turnPoint } from './floor.ts';

/**
 * A floor, ready to draw, with every door on it findable.
 *
 * `floor.ts` places the rooms; this turns a placement into the handful of things
 * a screen needs — outlines to fill, walls to stroke, and doorways as points
 * somebody can tap. It is the same boundary `render.ts` keeps: exact integers in,
 * things to draw out, and nothing produced here ever travels back into the model.
 *
 * The doorways are the interesting part. Joining two rooms is somebody saying
 * *"this door is that door"*, and the only way to say it without a form is to
 * tap one and then tap the other. So every opening on the floor needs a position
 * a finger can reach, in the floor's own coordinates, and it needs to know which
 * room and which wall it belongs to so the join can be written down.
 */

export interface DrawnOpening {
  readonly roomId: string;
  readonly wallId: string;
  readonly openingId: string;
  readonly kind: 'door' | 'window' | 'cased';
  /** The middle of the opening, on the floor. What a finger aims at. */
  readonly at: Point;
  /** Along the wall, so a screen can draw the opening rather than a dot. */
  readonly along: Point;
  readonly width: Nanometres;
  /** True when a join already accounts for this one. */
  readonly joined: boolean;
}

export interface DrawnWall {
  readonly roomId: string;
  readonly wallId: string;
  readonly from: Point;
  readonly to: Point;
  readonly open: boolean;
  readonly measured: boolean;
}

export interface DrawnRoom {
  readonly roomId: string;
  readonly name: string;
  readonly outline: readonly Point[];
  /** The middle of the room, for its label. */
  readonly at: Point;
  readonly area: bigint;
  /**
   * False for a room nothing joins to the floor yet.
   *
   * Such a room is still **drawn**, off to one side, and this is why. Joining
   * is two taps — a door in one room, the same door in the other — and a room
   * that is not on the screen has no door to tap. So an unjoined room was
   * unjoinable: the very first join on any floor was impossible, and the screen
   * said "nothing connects the kitchen" beside a drawing with no kitchen in it.
   *
   * They are laid out in a row past the edge of the floor, so nothing overlaps
   * anything real and it is obvious at a glance which rooms are still loose.
   */
  readonly placed: boolean;
}

export interface FloorPlan {
  readonly rooms: readonly DrawnRoom[];
  readonly walls: readonly DrawnWall[];
  readonly openings: readonly DrawnOpening[];
  readonly bounds: { readonly lo: Point; readonly hi: Point };
  readonly unplaced: readonly string[];
  readonly notes: ReturnType<typeof layout>['notes'];
}

/** The centre of a polygon's bounding box. Good enough for a label. */
function middle(outline: readonly Point[]): Point {
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  const lo = { x: xs.reduce((a, b) => (a < b ? a : b)), y: ys.reduce((a, b) => (a < b ? a : b)) };
  const hi = { x: xs.reduce((a, b) => (a > b ? a : b)), y: ys.reduce((a, b) => (a > b ? a : b)) };
  return { x: (lo.x + hi.x) / 2n, y: (lo.y + hi.y) / 2n };
}

/** How far apart to stand the rooms nothing has joined yet. */
const WAITING_GAP: Nanometres = 6n * 304_800_000n;

function placedOpenings(placed: Placed, joinedIds: ReadonlySet<string>): DrawnOpening[] {
  const local = corners(placed.room);
  const out: DrawnOpening[] = [];

  for (const [i, wall] of placed.room.walls.entries()) {
    const from = local[i]!;
    const to = local[(i + 1) % local.length]!;
    const length = runLength(wall);
    if (length === 0n) continue;

    for (const opening of wall.openings ?? []) {
      const centre = opening.offsetFromStart.value + opening.width.value / 2n;
      const at: Point = {
        x: from.x + ((to.x - from.x) * centre) / length,
        y: from.y + ((to.y - from.y) * centre) / length,
      };
      const turned = turnPoint(at, placed.placement.turn);
      const along = turnPoint({ x: to.x - from.x, y: to.y - from.y }, placed.placement.turn);
      out.push({
        roomId: placed.room.id,
        wallId: wall.id,
        openingId: opening.id,
        kind: opening.kind,
        at: { x: turned.x + placed.placement.offset.x, y: turned.y + placed.placement.offset.y },
        along,
        width: opening.width.value,
        joined: joinedIds.has(`${placed.room.id}|${wall.id}|${opening.id}`),
      });
    }
  }
  return out;
}

export function floorPlan(floor: Floor): FloorPlan {
  const laid = layout(floor);

  const joined = new Set<string>();
  for (const join of floor.joins) {
    for (const end of [join.from, join.to]) {
      joined.add(`${end.roomId}|${end.wallId}|${end.openingId}`);
    }
  }

  // Rooms nothing has joined yet, stood in a row past the east edge of the
  // floor. They have to be on the screen: joining is two taps, and a room that
  // is not drawn has no door to tap — which made the *first* join on any floor
  // impossible, because the only placed room had nothing to be joined to.
  const east = laid.placed.flatMap((p) => p.outline).reduce((most, p) => (p.x > most ? p.x : most), 0n);
  let waitingAt = laid.placed.length === 0 ? 0n : east + WAITING_GAP;
  const waiting: Placed[] = [];
  for (const id of laid.unplaced) {
    const room = floor.rooms.find((r) => r.id === id)!;
    const own = corners(room);
    const lo = own.reduce((least, p) => (p.x < least ? p.x : least), own[0]!.x);
    const hi = own.reduce((most, p) => (p.x > most ? p.x : most), own[0]!.x);
    const bottom = own.reduce((least, p) => (p.y < least ? p.y : least), own[0]!.y);
    const placement = {
      roomId: id,
      turn: 0 as const,
      offset: { x: waitingAt - lo, y: -bottom },
    };
    waiting.push({
      room,
      placement,
      outline: own.map((p) => ({ x: p.x + placement.offset.x, y: p.y + placement.offset.y })),
    });
    waitingAt += hi - lo + WAITING_GAP;
  }

  const everything = [...laid.placed, ...waiting];
  const isPlaced = new Set(laid.placed.map((p) => p.room.id));

  const rooms: DrawnRoom[] = everything.map((p) => ({
    roomId: p.room.id,
    name: p.room.name,
    outline: p.outline,
    at: middle(p.outline),
    area: area(p.room).value,
    placed: isPlaced.has(p.room.id),
  }));

  const walls: DrawnWall[] = everything.flatMap((p) =>
    p.room.walls.map((wall, i) => ({
      roomId: p.room.id,
      wallId: wall.id,
      from: p.outline[i]!,
      to: p.outline[(i + 1) % p.outline.length]!,
      open: wall.open === true,
      measured: wall.length.provenance.kind === 'verified',
    }))
  );

  const openings = everything.flatMap((p) => placedOpenings(p, joined));

  const points = everything.flatMap((p) => p.outline);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const bounds =
    points.length === 0
      ? { lo: { x: 0n, y: 0n }, hi: { x: 0n, y: 0n } }
      : {
          lo: {
            x: xs.reduce((a, b) => (a < b ? a : b)),
            y: ys.reduce((a, b) => (a < b ? a : b)),
          },
          hi: {
            x: xs.reduce((a, b) => (a > b ? a : b)),
            y: ys.reduce((a, b) => (a > b ? a : b)),
          },
        };

  return { rooms, walls, openings, bounds, unplaced: laid.unplaced, notes: laid.notes };
}

/**
 * Whether two openings could be the same door.
 *
 * Asked before a join is written down, so somebody tapping two doors that cannot
 * possibly be the same one is told immediately rather than watching a room fly
 * across the screen. Deliberately generous: it refuses only what is definitely
 * wrong — the same room, or two openings whose widths are so far apart they
 * cannot be one hole seen from either side.
 *
 * The scanner is bad at opening widths, so the tolerance is wide. Half of the
 * narrower one is far beyond any scanner error and still catches a 3 ft door
 * being joined to a 16 ft garage opening.
 */
export function couldBeTheSame(a: DrawnOpening, b: DrawnOpening): string | null {
  if (a.roomId === b.roomId) {
    return 'Those are both in the same room. A join goes between two rooms.';
  }
  const narrow = a.width < b.width ? a.width : b.width;
  const wide = a.width < b.width ? b.width : a.width;
  if (wide - narrow > narrow / 2n) {
    return (
      'Those two openings are very different widths, so they are unlikely to be the same one ' +
      'seen from either side. Check you tapped the right pair.'
    );
  }
  return null;
}

/** How far the floor reaches each way, once everything is placed. */
export function extentOf(plan: FloorPlan): { x: Nanometres; y: Nanometres } {
  return { x: plan.bounds.hi.x - plan.bounds.lo.x, y: plan.bounds.hi.y - plan.bounds.lo.y };
}

/** Total floor area of everything placed, in the doubled unit. */
export function placedArea(plan: FloorPlan): bigint {
  return plan.rooms.reduce((total, room) => total + room.area, 0n);
}

