import { type Nanometres, add, hypotenuse } from './length.ts';
import { type Measurement, toleranceOf } from './measurement.ts';
import { type Point, type Room, type Wall, RoomError, area, corners, validate } from './room.ts';

/**
 * Open plans, and the reason every competitor's numbers go wrong on them.
 *
 * A kitchen that runs into a dining area that runs into a living room is one
 * continuous space with no walls in it, but a contractor has to price it as
 * three rooms — different flooring, different paint, different scope. The advice
 * people are actually given today is to lay a strip of painter's tape on the
 * customer's floor so the scanner sees a corner. That is a symptom, not a feature.
 *
 * The mistake to avoid is splitting the space with a *wall*. Do that and the
 * estimate carries drywall, paint and baseboard for a surface nobody will ever
 * build. So a divider here is its own thing:
 *
 *   built    — a real wall. Carries drywall, paint, baseboard, and cost.
 *   virtual  — a line somebody drew. Bounds floor area and nothing else.
 *
 * A pony wall or a breakfast bar is *built*, at its own height rather than the
 * room's, because it genuinely gets finished and genuinely costs money.
 *
 * And a virtual boundary is not a measurement, it is a decision — so it records
 * who declared it and when, and carries no tolerance, because nobody measured
 * anything.
 */

export interface Boundary {
  readonly id: string;
  readonly name?: string;
  readonly declaredBy: string;
  readonly declaredAt: string;
  /** Both endpoints must lie on the room's outline. */
  readonly from: Point;
  readonly to: Point;
}

export interface BuiltEdge {
  readonly kind: 'built';
  readonly wallId: string;
  readonly from: Point;
  readonly to: Point;
  /** Where this edge starts and ends along its wall, measured from the wall's first corner. */
  readonly spanStart: Nanometres;
  readonly spanEnd: Nanometres;
}

export interface VirtualEdge {
  readonly kind: 'virtual';
  readonly boundaryId: string;
  readonly from: Point;
  readonly to: Point;
}

export type ZoneEdge = BuiltEdge | VirtualEdge;

export interface Zone {
  readonly id: string;
  readonly name: string;
  readonly edges: readonly ZoneEdge[];
}

export class ZoneError extends RoomError {}

/* ------------------------------------------------------------------ helpers */

/**
 * How long a segment is.
 *
 * Axis-aligned segments — nearly all of them — are exact subtraction. A segment
 * that runs at an angle takes the integer square root, which is the same
 * rounding the wall it lies on already carries.
 */
function len(a: Point, b: Point): Nanometres {
  const dx = a.x > b.x ? a.x - b.x : b.x - a.x;
  const dy = a.y > b.y ? a.y - b.y : b.y - a.y;
  if (dx === 0n || dy === 0n) return dx + dy;
  return hypotenuse(dx, dy);
}

function same(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * Is the point on the segment?
 *
 * Exact, and exact for angled segments too: the cross product is zero only when
 * the three points are truly collinear, and the bounding-box test then decides
 * whether the point is between the ends rather than out along the line. No
 * division, so no rounding, so a corner is never "nearly" on a wall.
 */
function onSegment(p: Point, a: Point, b: Point): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (cross !== 0n) return false;
  const withinX = p.x >= (a.x < b.x ? a.x : b.x) && p.x <= (a.x < b.x ? b.x : a.x);
  const withinY = p.y >= (a.y < b.y ? a.y : b.y) && p.y <= (a.y < b.y ? b.y : a.y);
  return withinX && withinY;
}

interface Outline {
  readonly from: Point;
  readonly to: Point;
  readonly wall: Wall;
}

function outline(room: Room): Outline[] {
  validate(room);
  const points = corners(room);
  return room.walls.map((wall, i) => ({
    from: points[i]!,
    to: points[(i + 1) % points.length]!,
    wall,
  }));
}

function edgeIndexFor(p: Point, edges: Outline[], what: string): number {
  const i = edges.findIndex((e) => onSegment(p, e.from, e.to));
  if (i === -1) {
    throw new ZoneError(
      `The boundary's ${what} point (${p.x}, ${p.y}) is not on the room's outline. ` +
        `A divider has to start and finish on something real.`
    );
  }
  return i;
}

function built(e: Outline, from: Point, to: Point): BuiltEdge {
  return {
    kind: 'built',
    wallId: e.wall.id,
    from,
    to,
    spanStart: len(e.from, from),
    spanEnd: len(e.from, to),
  };
}

/* -------------------------------------------------------------------- split */

/**
 * Cuts a room in two along a boundary, and hands back the two zones.
 *
 * Walking the outline forward from one end of the boundary to the other, then
 * closing with the boundary itself, gives one zone; walking the rest gives the
 * other. Every edge remembers whether it is a wall or a line somebody drew, and
 * which stretch of which wall it covers — so a door in a wall that straddles the
 * boundary is credited to each side by how much of it is actually on that side,
 * rather than to whichever zone got looked at first.
 */
export function splitByBoundary(
  room: Room,
  boundary: Boundary,
  names: readonly [string, string]
): [Zone, Zone] {
  const edges = outline(room);
  const a = edgeIndexFor(boundary.from, edges, 'first');
  const b = edgeIndexFor(boundary.to, edges, 'second');

  if (same(boundary.from, boundary.to)) {
    throw new ZoneError('A boundary needs two different endpoints.');
  }
  if (a === b) {
    throw new ZoneError(
      `Both ends of the boundary sit on wall "${edges[a]!.wall.id}". A divider has to cross the ` +
        `space, not run along one side of it.`
    );
  }

  const n = edges.length;
  const walk = (startEdge: number, startPoint: Point, endEdge: number, endPoint: Point): ZoneEdge[] => {
    const out: ZoneEdge[] = [];
    const first = edges[startEdge]!;
    if (!same(startPoint, first.to)) out.push(built(first, startPoint, first.to));
    for (let k = (startEdge + 1) % n; k !== endEdge; k = (k + 1) % n) {
      const e = edges[k]!;
      out.push(built(e, e.from, e.to));
    }
    const last = edges[endEdge]!;
    if (!same(last.from, endPoint)) out.push(built(last, last.from, endPoint));
    return out;
  };

  const zoneA: Zone = {
    id: `${boundary.id}:a`,
    name: names[0],
    edges: [
      ...walk(a, boundary.from, b, boundary.to),
      { kind: 'virtual', boundaryId: boundary.id, from: boundary.to, to: boundary.from },
    ],
  };
  const zoneB: Zone = {
    id: `${boundary.id}:b`,
    name: names[1],
    edges: [
      ...walk(b, boundary.to, a, boundary.from),
      { kind: 'virtual', boundaryId: boundary.id, from: boundary.from, to: boundary.to },
    ],
  };

  // The two halves must account for the whole floor, exactly. A split that loses
  // a square inch is a split that will lose a box of tile.
  const whole = area(room).value;
  const parts = zoneArea(zoneA) + zoneArea(zoneB);
  if (parts !== whole) {
    throw new ZoneError(
      `Splitting "${room.name}" along "${boundary.id}" produced zones totalling ${parts} of ` +
        `${whole} square nanometres. The boundary does not cleanly cross the room.`
    );
  }

  return [zoneA, zoneB];
}

/* ---------------------------------------------------------------- questions */

export function zoneArea(zone: Zone): bigint {
  let twice = 0n;
  const pts = zone.edges.map((e) => e.from);
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    twice += p.x * q.y - q.x * p.y;
  }
  return (twice < 0n ? -twice : twice) / 2n;
}

/** The part of the zone's outline that is actually built. Baseboard runs here. */
export function builtPerimeter(zone: Zone): Nanometres {
  return add(...zone.edges.filter((e) => e.kind === 'built').map((e) => len(e.from, e.to)));
}

/** The part somebody drew. Costs nothing, finishes nothing. */
export function virtualPerimeter(zone: Zone): Nanometres {
  return add(...zone.edges.filter((e) => e.kind === 'virtual').map((e) => len(e.from, e.to)));
}

/* --------------------------------------------------------------- quantities */

export interface Quantities {
  /** Floor and ceiling both follow the zone outline, virtual edges included. */
  readonly floorArea: bigint;
  readonly ceilingArea: bigint;
  /** Baseboard follows built edges only, less doors and cased openings. */
  readonly baseboardRun: Nanometres;
  /** Drywall and paint follow built edges only, less every opening. */
  readonly wallFaceArea: bigint;
  /** How much of the zone's outline is a line somebody drew rather than a wall. */
  readonly virtualRun: Nanometres;
}

/** How much of an opening falls inside this stretch of wall. Zero if none of it does. */
function overlap(
  openStart: Nanometres,
  openEnd: Nanometres,
  spanStart: Nanometres,
  spanEnd: Nanometres
): Nanometres {
  const lo = openStart > spanStart ? openStart : spanStart;
  const hi = openEnd < spanEnd ? openEnd : spanEnd;
  return hi > lo ? hi - lo : 0n;
}

export function quantities(zone: Zone, room: Room): Quantities {
  const byId = new Map(room.walls.map((w) => [w.id, w]));
  let baseboard = 0n;
  let face = 0n;

  for (const edge of zone.edges) {
    if (edge.kind !== 'built') continue;
    const wall = byId.get(edge.wallId);
    if (!wall) throw new ZoneError(`Zone "${zone.id}" names wall "${edge.wallId}", which is not in the room.`);

    const lo = edge.spanStart < edge.spanEnd ? edge.spanStart : edge.spanEnd;
    const hi = edge.spanStart < edge.spanEnd ? edge.spanEnd : edge.spanStart;
    const run = hi - lo;
    const height = (wall.height ?? room.ceilingHeight).value;

    baseboard += run;
    face += run * height;

    for (const opening of wall.openings ?? []) {
      const oStart = opening.offsetFromStart.value;
      const oEnd = oStart + opening.width.value;
      const shared = overlap(oStart, oEnd, lo, hi);
      if (shared === 0n) continue;
      // A window leaves the baseboard alone; a door or a cased opening does not.
      if (opening.kind !== 'window') baseboard -= shared;
      face -= shared * opening.height.value;
    }
  }

  const floor = zoneArea(zone);
  return {
    floorArea: floor,
    ceilingArea: floor,
    baseboardRun: baseboard,
    wallFaceArea: face,
    virtualRun: virtualPerimeter(zone),
  };
}

/**
 * Zones plus the whole, always together, and the whole always equal to the sum.
 * Nobody should have to add up a list of rooms to find out whether it reconciles.
 */
export interface ZoneReport {
  readonly zones: readonly { readonly zone: Zone; readonly quantities: Quantities }[];
  readonly total: Quantities;
}

export function report(room: Room, zones: readonly Zone[]): ZoneReport {
  if (zones.length === 0) throw new ZoneError('A report needs at least one zone.');
  const rows = zones.map((zone) => ({ zone, quantities: quantities(zone, room) }));

  const total: Quantities = {
    floorArea: rows.reduce((t, r) => t + r.quantities.floorArea, 0n),
    ceilingArea: rows.reduce((t, r) => t + r.quantities.ceilingArea, 0n),
    baseboardRun: add(...rows.map((r) => r.quantities.baseboardRun)),
    wallFaceArea: rows.reduce((t, r) => t + r.quantities.wallFaceArea, 0n),
    virtualRun: add(...rows.map((r) => r.quantities.virtualRun)),
  };

  const whole = area(room).value;
  if (total.floorArea !== whole) {
    throw new ZoneError(
      `The zones of "${room.name}" total ${total.floorArea} square nanometres but the room is ` +
        `${whole}. Every square inch of floor belongs to exactly one zone.`
    );
  }
  return { zones: rows, total };
}

/**
 * A virtual boundary bounds area and nothing else, so it never inherits a
 * tolerance from the walls it lands between. This is asserted rather than
 * assumed, because the day it silently starts carrying one is the day a zone
 * area quietly gains a band it has no business having.
 */
export function boundaryContributesNoUncertainty(m: Measurement): boolean {
  return toleranceOf(m) === 0n;
}
