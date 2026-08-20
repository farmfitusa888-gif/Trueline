import { type Nanometres, NM_PER_FOOT, NM_PER_INCH, NM_PER_METRE, NM_PER_MM } from './length.ts';
import { type Measurement, confidenceLabel, toleranceOf } from './measurement.ts';
import { type Point, type Room, corners, validate } from './room.ts';
import { type Zone } from './zone.ts';

/**
 * The one place Trueline's exact model becomes floating point, for drawing.
 *
 * Nothing needs exact arithmetic to put a wall on a screen, and every renderer
 * worth using — Three.js included — is float throughout. So this is a boundary
 * in the same family as metres becoming nanometres on the device: quantise once,
 * deliberately, in a named place, and never let the result travel back.
 *
 * The rule that makes it safe: **nothing produced here is ever a measurement.**
 * These numbers are for drawing. A dimension shown on screen is formatted from
 * the exact model, not read back off a rendered coordinate.
 *
 * The shape below is deliberately close to what a conventional floor-plan
 * renderer expects — walls as start and end points with a thickness and a
 * height — so an existing renderer can be driven with a thin translation rather
 * than a rewrite. What it adds, and what no such renderer has of its own, is
 * `confidence` on every wall, so the drawing can show which numbers a person
 * stood behind.
 */

export type RenderUnit = 'm' | 'cm' | 'mm' | 'in' | 'ft';

const PER_UNIT: Record<RenderUnit, Nanometres> = {
  m: NM_PER_METRE,
  cm: 10n * NM_PER_MM,
  mm: NM_PER_MM,
  in: NM_PER_INCH,
  ft: NM_PER_FOOT,
};

/**
 * Nanometres to a float in the chosen unit.
 *
 * Divided as a rational rather than by converting the bigint to a number first,
 * so a building-sized coordinate cannot lose its last digits on the way through.
 */
function toUnit(nm: Nanometres, unit: RenderUnit): number {
  const per = PER_UNIT[unit];
  const whole = nm / per;
  const rest = nm % per;
  return Number(whole) + Number(rest) / Number(per);
}

export interface RenderPoint {
  readonly x: number;
  readonly y: number;
}

export interface RenderWall {
  readonly id: string;
  readonly start: RenderPoint;
  readonly end: RenderPoint;
  readonly thickness: number;
  readonly height: number;
  /** Ours, and the reason this adapter exists rather than a straight port. */
  readonly confidence: 'scanned' | 'verified' | 'derived';
  /** Half-width of the band this wall's length lives in, in the same unit. Zero once verified. */
  readonly tolerance: number;
}

export interface RenderZone {
  readonly id: string;
  readonly name: string;
  /** Closed ring, first point not repeated at the end. */
  readonly outline: readonly RenderPoint[];
  /** Which edges are real walls and which are lines somebody drew, in outline order. */
  readonly edgeKinds: readonly ('built' | 'virtual')[];
}

export interface RenderModel {
  readonly unit: RenderUnit;
  readonly walls: readonly RenderWall[];
  readonly zones: readonly RenderZone[];
  readonly ceilingHeight: number;
}

export interface RenderOptions {
  readonly unit?: RenderUnit;
  /**
   * What to draw a wall as when RoomPlan did not measure its thickness. Marked
   * assumed in the model, so the renderer can hatch it differently rather than
   * present a guess as a fact.
   */
  readonly assumedThickness?: Nanometres;
}

/** RoomPlan reports every wall at roughly this, whatever the wall really is. */
export const ROOMPLAN_ASSUMED_THICKNESS: Nanometres = 160n * NM_PER_MM;

function wallHeight(wall: { height?: Measurement }, room: Room): Measurement {
  return wall.height ?? room.ceilingHeight;
}

/**
 * Turns a room into something a floor-plan renderer can draw.
 *
 * Walls come out as start and end points by walking the corners the model
 * already computes, so nothing here re-derives geometry that the solver has
 * already closed exactly.
 */
export function toRenderModel(
  room: Room,
  zones: readonly Zone[] = [],
  options: RenderOptions = {}
): RenderModel {
  validate(room);
  const unit = options.unit ?? 'm';
  const assumed = options.assumedThickness ?? ROOMPLAN_ASSUMED_THICKNESS;
  const points = corners(room);
  const at = (p: Point): RenderPoint => ({ x: toUnit(p.x, unit), y: toUnit(p.y, unit) });

  const walls: RenderWall[] = room.walls.map((wall, i) => ({
    id: wall.id,
    start: at(points[i]!),
    end: at(points[(i + 1) % points.length]!),
    thickness: toUnit(assumed, unit),
    height: toUnit(wallHeight(wall, room).value, unit),
    confidence: confidenceLabel(wall.length),
    tolerance: toUnit(toleranceOf(wall.length), unit),
  }));

  const renderZones: RenderZone[] = zones.map((zone) => ({
    id: zone.id,
    name: zone.name,
    outline: zone.edges.map((e) => at(e.from)),
    edgeKinds: zone.edges.map((e) => e.kind),
  }));

  return {
    unit,
    walls,
    zones: renderZones,
    ceilingHeight: toUnit(room.ceilingHeight.value, unit),
  };
}

/**
 * How far a rendered coordinate may sit from the exact one it came from, in the
 * render unit. Used by the tests to hold this boundary honest rather than by
 * anything at runtime — if this number ever needs raising, the conversion is
 * wrong, not the tolerance.
 */
export const RENDER_EPSILON = 1e-9;
