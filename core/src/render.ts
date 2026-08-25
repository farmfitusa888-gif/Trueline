import { type Nanometres, NM_PER_FOOT, NM_PER_INCH, NM_PER_METRE, NM_PER_MM } from './length.ts';
import { type Measurement, confidenceLabel, toleranceOf } from './measurement.ts';
import { type Point, type Room, corners, validate } from './room.ts';
import { type SectionView } from './section.ts';
import { type Trust, readiness } from './issue.ts';
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
  /**
   * True when `thickness` is the fallback rather than something somebody said.
   *
   * RoomPlan reports a thickness for every wall and it is zero, so a drawing has
   * to fall back to a figure to have any width at all. A renderer that hatches
   * an assumed wall differently from a stated one is telling the truth; one that
   * draws them identically is presenting a guess as a fact.
   */
  readonly thicknessAssumed: boolean;
  readonly height: number;
  /** Ours, and the reason this adapter exists rather than a straight port. */
  readonly confidence: 'scanned' | 'verified' | 'derived' | 'adjusted';
  /**
   * True when there is no wall here — a garage door opening, a wide span to the
   * next room. The edge is on the outline and it was measured; the renderer
   * draws the floor and ceiling across it and nothing standing up.
   */
  readonly open: boolean;
  /** Half-width of the band this wall's length lives in, in the same unit. Zero once verified. */
  readonly tolerance: number;
}

export interface RenderZone {
  readonly id: string;
  readonly name: string;
  /** Closed ring, first point not repeated at the end. */
  readonly outline: readonly RenderPoint[];
  /**
   * What each edge is, in outline order: a wall, a real gap with nothing built
   * across it, or a line somebody drew.
   */
  readonly edgeKinds: readonly ('built' | 'open' | 'virtual')[];
}

export interface RenderModel {
  readonly unit: RenderUnit;
  readonly walls: readonly RenderWall[];
  readonly zones: readonly RenderZone[];
  readonly ceilingHeight: number;
  /**
   * Whether anybody has stood behind these numbers, so the badge is on the
   * screen and not only on the export. A scan closes perfectly whether it is
   * right or wrong, so this is the only thing on the drawing that distinguishes
   * the two. See `issue.ts`.
   */
  readonly trust: Trust;
  /** True when this room may go out as a dimensioned drawing. */
  readonly issuable: boolean;
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

  const walls: RenderWall[] = room.walls.map((wall, i) => {
    // A thickness somebody actually said beats the fallback. Until `thickness.ts`
    // existed there was nothing to say it, so every wall in every drawing was
    // 160 mm — which is what the market research file lists as complaint number
    // nine about the tools already on sale.
    const stated = wall.open ? undefined : (wall.thickness ?? room.wallThickness);
    return {
    id: wall.id,
    start: at(points[i]!),
    end: at(points[(i + 1) % points.length]!),
    thickness: toUnit(stated?.value ?? assumed, unit),
    thicknessAssumed: stated === undefined,
    height: toUnit(wallHeight(wall, room).value, unit),
    confidence: confidenceLabel(wall.length),
    tolerance: toUnit(toleranceOf(wall.length), unit),
    open: wall.open === true,
    };
  });

  const renderZones: RenderZone[] = zones.map((zone) => ({
    id: zone.id,
    name: zone.name,
    outline: zone.edges.map((e) => at(e.from)),
    edgeKinds: zone.edges.map((e) => e.kind),
  }));

  const state = readiness(room);
  return {
    unit,
    walls,
    zones: renderZones,
    ceilingHeight: toUnit(room.ceilingHeight.value, unit),
    trust: state.trust,
    issuable: state.blocking.length === 0,
  };
}

/**
 * How far a rendered coordinate may sit from the exact one it came from, in the
 * render unit. Used by the tests to hold this boundary honest rather than by
 * anything at runtime — if this number ever needs raising, the conversion is
 * wrong, not the tolerance.
 */
export const RENDER_EPSILON = 1e-9;

/* ---------------------------------------------------------------- section */

export interface RenderWallSection {
  readonly id: string;
  readonly visible: boolean;
  /** Bottom and top of the band to draw, above the floor, in the render unit. */
  readonly drawnFrom: number;
  readonly drawnTo: number;
  /** True when the plane passes through this wall, so the renderer can poché the cut face. */
  readonly cut: boolean;
  readonly openingsCut: readonly string[];
}

export interface RenderSection {
  readonly unit: RenderUnit;
  readonly ceilingVisible: boolean;
  readonly floorVisible: boolean;
  readonly cutHeight: number;
  readonly walls: readonly RenderWallSection[];
}

/**
 * Carries a section view across the same boundary the rest of this file guards.
 *
 * `section.ts` decides what is visible in exact nanometres, because the decision
 * has to be the same on every device. This turns that decision into the floats a
 * renderer needs, and like everything else here the numbers it produces are for
 * drawing — a wall clipped to 4'0" for a section is still an 8'0" wall on the
 * take-off.
 */
export function toRenderSection(view: SectionView, unit: RenderUnit = 'm'): RenderSection {
  return {
    unit,
    ceilingVisible: view.ceilingVisible,
    floorVisible: view.floorVisible,
    cutHeight: toUnit(view.cutHeight, unit),
    walls: view.walls.map((w) => ({
      id: w.wallId,
      visible: w.visible,
      drawnFrom: toUnit(w.drawnFrom, unit),
      drawnTo: toUnit(w.drawnTo, unit),
      cut: w.cut,
      openingsCut: w.openingsCut,
    })),
  };
}
