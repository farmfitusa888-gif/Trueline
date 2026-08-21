import { type Nanometres, NM_PER_INCH, add } from './length.ts';
import { type Point, type Room, RoomError, corners, validate } from './room.ts';
import { isVerified, toleranceOf } from './measurement.ts';

/**
 * Which walls the sensor could not actually see, and how much of each.
 *
 * A wall with a sofa against it does not come back wrong in a way anybody
 * notices — it comes back plausible. Apple names furniture occlusion as a known
 * RoomPlan limitation, and on iOS 17 walls could be pulled in to the face of
 * whatever sat against them. So a dimension taken across a blocked wall is worth
 * less than one taken across a clear wall, and the app should say so without
 * being asked.
 *
 * RoomPlan already hands back detected objects — sofa, storage, table, bed,
 * refrigerator, stove and the rest — as records separate from the walls, with
 * positions. Everything below falls out of data that is already in every scan.
 *
 * The footprints arrive as axis-aligned boxes computed on the device. An object
 * sitting at an angle gets a box larger than itself, which over-reports how much
 * of a wall it blocks. That is the safe direction to be wrong in: it sends
 * somebody to check a wall that turned out fine, rather than leaving a bad
 * dimension unflagged.
 */

export interface Footprint {
  readonly id: string;
  /** What RoomPlan called it — sofa, storage, refrigerator, and so on. */
  readonly category: string;
  readonly min: Point;
  readonly max: Point;
}

export class ObstructionError extends RoomError {}

/**
 * How close an object has to be to a wall before it counts as blocking it.
 *
 * Six inches, because that is roughly where a piece of furniture stops leaving
 * the wall-floor joint visible to a scanner walking past. It is a default rather
 * than a fact, and it is a parameter so it can be replaced the moment real
 * captures say otherwise.
 */
export const DEFAULT_REACH: Nanometres = 6n * NM_PER_INCH;

interface Span {
  readonly from: Nanometres;
  readonly to: Nanometres;
}

function overlapSpan(a: Span, b: Span): Span | null {
  const from = a.from > b.from ? a.from : b.from;
  const to = a.to < b.to ? a.to : b.to;
  return to > from ? { from, to } : null;
}

/** Merges overlapping stretches so a sofa and a bookcase side by side count once. */
function merge(spans: Span[]): Span[] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((p, q) => (p.from === q.from ? 0 : p.from > q.from ? 1 : -1));
  const out: Span[] = [sorted[0]!];
  for (const span of sorted.slice(1)) {
    const last = out[out.length - 1]!;
    if (span.from <= last.to) {
      if (span.to > last.to) out[out.length - 1] = { from: last.from, to: span.to };
    } else {
      out.push(span);
    }
  }
  return out;
}

export interface WallObstruction {
  readonly wallId: string;
  /** The stretches of the wall something is standing against. */
  readonly blocked: readonly Span[];
  readonly blockedLength: Nanometres;
  /** Thousandths of the wall that are blocked, so 1000 means all of it. */
  readonly blockedPerMille: bigint;
  /** What is doing the blocking, so the app can say "the sofa and the bookcase". */
  readonly by: readonly string[];
}

/**
 * What is standing against each wall, and how much of it that hides.
 *
 * A wall runs along one axis, so an object blocks it when its box comes within
 * `reach` of the wall's line and overlaps the wall's run. Both tests are exact
 * integer comparisons — nothing here estimates.
 */
export function obstructions(
  room: Room,
  footprints: readonly Footprint[],
  reach: Nanometres = DEFAULT_REACH
): WallObstruction[] {
  validate(room);
  if (reach < 0n) throw new ObstructionError(`Reach cannot be negative (got ${reach}nm).`);
  const points = corners(room);

  return room.walls.map((wall, i) => {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const horizontal = a.y === b.y;

    // The wall's line, and its run along the axis it occupies.
    const line = horizontal ? a.y : a.x;
    const lo = horizontal ? (a.x < b.x ? a.x : b.x) : (a.y < b.y ? a.y : b.y);
    const hi = horizontal ? (a.x < b.x ? b.x : a.x) : (a.y < b.y ? b.y : a.y);

    const spans: Span[] = [];
    const by: string[] = [];

    for (const f of footprints) {
      // Distance from the wall's line to the nearest face of the box.
      const near = horizontal ? f.min.y : f.min.x;
      const far = horizontal ? f.max.y : f.max.x;
      const gap = line < near ? near - line : line > far ? line - far : 0n;
      if (gap > reach) continue;

      const across = horizontal
        ? { from: f.min.x, to: f.max.x }
        : { from: f.min.y, to: f.max.y };
      const shared = overlapSpan(across, { from: lo, to: hi });
      if (!shared) continue;

      spans.push(shared);
      if (!by.includes(f.id)) by.push(f.id);
    }

    const blocked = merge(spans);
    const blockedLength = add(...blocked.map((s) => s.to - s.from));
    const whole = wall.length.value;
    return {
      wallId: wall.id,
      blocked,
      blockedLength,
      blockedPerMille: whole === 0n ? 0n : (blockedLength * 1000n) / whole,
      by,
    };
  });
}

/**
 * The walls worth putting a tape on, worst first — now aware of what was in the way.
 *
 * The ranking is how much floor area each wall's uncertainty puts in doubt, the
 * same measure the plain punch list uses, multiplied up by the share of the wall
 * that something was standing against. A long wall the sensor was unsure about
 * and could not see properly outranks a short one it merely guessed at.
 *
 * A wall somebody has already verified never appears here, whatever is in front
 * of it — the number is settled, and what the sensor could see stopped mattering
 * the moment a person signed for it.
 */
export interface PunchListItem {
  readonly wallId: string;
  readonly areaAtStake: bigint;
  readonly blockedPerMille: bigint;
  readonly blockedBy: readonly string[];
  /** What the ranking is on. Higher goes first. */
  readonly weight: bigint;
}

export function punchList(
  room: Room,
  footprints: readonly Footprint[],
  reach: Nanometres = DEFAULT_REACH,
  limit = 5
): PunchListItem[] {
  const blocking = new Map(obstructions(room, footprints, reach).map((o) => [o.wallId, o]));

  return room.walls
    .filter((w) => !isVerified(w.length))
    .map((wall) => {
      const o = blocking.get(wall.id);
      // Half square nanometres, matching `area()`, so the two rank on one scale.
      const areaAtStake = 2n * wall.length.value * toleranceOf(wall.length);
      const blockedPerMille = o?.blockedPerMille ?? 0n;
      return {
        wallId: wall.id,
        areaAtStake,
        blockedPerMille,
        blockedBy: o?.by ?? [],
        // A clear wall keeps its own weight; a fully blocked one counts double.
        weight: areaAtStake * (1000n + blockedPerMille),
      };
    })
    .filter((item) => item.weight > 0n)
    .sort((p, q) => (p.weight === q.weight ? p.wallId.localeCompare(q.wallId) : p.weight > q.weight ? -1 : 1))
    .slice(0, limit);
}

/**
 * A plain sentence for the screen, because "blockedPerMille: 640" is not
 * something to put in front of a contractor.
 */
export function describe(o: WallObstruction): string {
  if (o.blockedLength === 0n) return 'Nothing against this wall.';
  const share =
    o.blockedPerMille >= 900n ? 'Almost all' :
    o.blockedPerMille >= 500n ? 'More than half' :
    o.blockedPerMille >= 200n ? 'Part' : 'A little';
  const what = o.by.length === 1 ? o.by[0]! : `${o.by.length} things`;
  return `${share} of this wall was behind ${what} — the scan could not see it properly.`;
}
