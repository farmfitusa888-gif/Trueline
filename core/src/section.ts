import { type Nanometres, NM_PER_FOOT, formatFeetInches } from './length.ts';
import { type Measurement } from './measurement.ts';
import { type Opening, type Point, type Room, RoomError, corners, validate } from './room.ts';

/**
 * Seeing inside the model.
 *
 * Every scan-to-3D app hands back a room with a ceiling on it, and then the
 * ceiling is the only thing you can see. Orbit to the top view and you get a
 * grey lid; the plan you actually wanted is underneath it. Sam hit this on his
 * own kitchen scan and asked the obvious question — is there a way to get at the
 * inside from the top?
 *
 * The wrong fix is to scan without a ceiling. Ceiling height is wanted: it
 * prices drywall, paint and crown, and it is the number a soffit or a dropped
 * bulkhead shows up in. So the ceiling stays in the model and this file decides
 * when to *draw* it.
 *
 * Three decisions live here, and all three are geometry rather than rendering:
 *
 *   1. **Auto-hide the ceiling** once the eye is above it. Nobody has ever
 *      wanted to look at the top of a lid they are floating over.
 *   2. **A cut plane at any height.** Slide it down and the walls are drawn
 *      only up to it — the architectural section, which by convention is taken
 *      at 4'0" so it passes through windows and above the counters.
 *   3. **Dollhouse.** The ceiling goes, and so do the walls standing between the
 *      eye and the room, so an oblique view looks into the box rather than at
 *      the outside of it.
 *
 * Everything here is exact. Heights are nanometres and the visibility tests are
 * sign-of-a-bigint, so the same eye position gives the same answer on every
 * device, and a wall exactly level with the cut is decided by a rule rather than
 * by which way a float happened to round.
 *
 * What this file will not do is guess a height it was not given. A window with
 * no sill height recorded cannot be sectioned honestly — the plane either passes
 * through the glass or under it, and there is no way to know which. Rather than
 * pick, the view names those openings so the app can ask for the number.
 */

/* ------------------------------------------------------------------- eye */

/**
 * Where somebody is looking from.
 *
 * `x` and `y` are in the room's own plan coordinates, the ones `corners()`
 * returns. `height` is measured up from the floor, so it is negative only if the
 * eye is below the slab.
 *
 * This is a viewpoint, not a measurement. It has no provenance and no tolerance
 * because nobody measured it — an orbit camera invented it. It must never end up
 * in a dimension, and nothing in this file returns it as one.
 */
export interface Viewpoint {
  readonly x: Nanometres;
  readonly y: Nanometres;
  readonly height: Nanometres;
}

/**
 * The conventional height of an architectural section: 4'0" above the finished
 * floor. High enough to cut through windows and doors, low enough to pass over
 * base cabinets and counters, which is exactly why the convention exists.
 */
export const CONVENTIONAL_CUT_HEIGHT: Nanometres = 4n * NM_PER_FOOT;

export type ViewMode = 'plan' | 'cut' | 'dollhouse' | 'walkthrough';

export class SectionError extends RoomError {}

/* -------------------------------------------------------------- geometry */

/**
 * Which way each wall faces out of the room, as a plan-direction sign pair.
 *
 * Walking the corners can go either way round, so the winding is read off the
 * signed shoelace rather than assumed. For a counter-clockwise ring the outward
 * side of the edge a→b is to its right, `(dy, -dx)`; clockwise flips it. Only
 * the sign of each component matters here — these are used in a dot product
 * whose sign is the whole answer — so no normalising, and no floats.
 */
export function outwardNormals(room: Room): { x: bigint; y: bigint }[] {
  const points = corners(room);
  let twice = 0n;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    twice += a.x * b.y - b.x * a.y;
  }
  if (twice === 0n) {
    throw new SectionError(
      `"${room.name}" encloses no area, so its walls have no inside and no outside.`
    );
  }
  const counterClockwise = twice > 0n;
  return points.map((a, i) => {
    const b = points[(i + 1) % points.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return counterClockwise ? { x: dy, y: -dx } : { x: -dy, y: dx };
  });
}

/** The plan midpoint of each wall, in corner order. */
export function wallMidpoints(room: Room): Point[] {
  const points = corners(room);
  return points.map((a, i) => {
    const b = points[(i + 1) % points.length]!;
    return { x: (a.x + b.x) / 2n, y: (a.y + b.y) / 2n };
  });
}

/**
 * Is the eye outside this wall — that is, is the wall standing between the
 * viewer and the room?
 *
 * Exactly on the wall's plane counts as inside, so a camera sitting flush
 * against a wall does not make it vanish.
 */
function eyeIsOutside(normal: { x: bigint; y: bigint }, midpoint: Point, eye: Viewpoint): boolean {
  return normal.x * (eye.x - midpoint.x) + normal.y * (eye.y - midpoint.y) > 0n;
}

/* ------------------------------------------------------------- ceiling */

function ceilingOf(room: Room): Nanometres {
  return room.ceilingHeight.value;
}

/**
 * True once the eye has risen above the ceiling plane.
 *
 * Level with the ceiling counts as above: at that height the lid is edge-on and
 * hiding it is what the viewer wants, not a surprise.
 */
export function aboveCeiling(room: Room, eye: Viewpoint): boolean {
  validate(room);
  return eye.height >= ceilingOf(room);
}

/* ------------------------------------------------------------- openings */

function sillOf(opening: Opening): Nanometres | null {
  if (opening.sillHeight) return opening.sillHeight.value;
  // A door or a cased opening starts at the floor. That is not an assumption
  // dressed up as a fact: it is what a door is. Confirmed against the RoomPlan
  // export of Sam's kitchen, where both detected doors sat within 0.1 mm of the
  // floor plane, while the window sat 927 mm above it and nothing in the file
  // said so.
  return opening.kind === 'window' ? null : 0n;
}

function headOf(opening: Opening, sill: Nanometres): Nanometres {
  return sill + opening.height.value;
}

/* ---------------------------------------------------------------- section */

export interface WallSection {
  readonly wallId: string;
  readonly visible: boolean;
  /** Why it is not drawn, when it is not. Phrased for a person, not a log. */
  readonly hiddenBecause?: 'the viewer is outside it' | 'it stops below the cut';
  /** Bottom of the drawn band, above the floor. Always zero today; named so a raised floor can move it. */
  readonly drawnFrom: Nanometres;
  /** Top of the drawn band: the wall's own height, or the cut, whichever is lower. */
  readonly drawnTo: Nanometres;
  /** True when the cut plane passes through this wall rather than over or under it. */
  readonly cut: boolean;
  /** Openings the plane passes through, so the section shows a hole and not a solid. */
  readonly openingsCut: readonly string[];
  /**
   * Windows on this wall whose sill height nobody recorded. The plane cannot be
   * told whether it crosses them, so they are named rather than assumed either
   * way.
   */
  readonly openingsOfUnknownSill: readonly string[];
}

export interface SectionView {
  readonly mode: ViewMode;
  /** Where the plane sits. Equal to the ceiling height when nothing is being cut. */
  readonly cutHeight: Nanometres;
  readonly ceilingVisible: boolean;
  readonly floorVisible: boolean;
  readonly walls: readonly WallSection[];
  /** Every unknown-sill window in the room, gathered for one prompt rather than many. */
  readonly needsSillHeight: readonly string[];
}

function wallTop(wall: { height?: Measurement }, room: Room): Nanometres {
  return (wall.height ?? room.ceilingHeight).value;
}

export interface CutOptions {
  /** Where to put the plane. Defaults to the ceiling, which cuts nothing. */
  readonly height?: Nanometres;
  /** The eye, when walls in front of the viewer should be dropped as well. */
  readonly eye?: Viewpoint;
  readonly mode?: ViewMode;
}

/**
 * Cut the room at a height and say what is left to draw.
 *
 * A wall shorter than the plane — the 7'0" partition in Sam's kitchen scan, a
 * pony wall, a breakfast bar — is not cut. It is drawn whole, and `cut` says so,
 * which is what lets the renderer put a section poché on the walls the plane
 * actually passes through and leave the others alone.
 */
export function cutAt(room: Room, options: CutOptions = {}): SectionView {
  validate(room);
  const ceiling = ceilingOf(room);
  const height = options.height ?? ceiling;
  if (height <= 0n) {
    throw new SectionError(
      `A cut at ${formatFeetInches(height)} is at or below the floor, which leaves nothing to look at.`
    );
  }
  if (height > ceiling) {
    throw new SectionError(
      `A cut at ${formatFeetInches(height)} is above the ${formatFeetInches(ceiling)} ceiling of ` +
        `"${room.name}". Raise the ceiling height or lower the cut; the plane cannot float over the room.`
    );
  }

  const eye = options.eye;
  const normals = eye ? outwardNormals(room) : null;
  const midpoints = eye ? wallMidpoints(room) : null;
  const dropNearWalls = options.mode === 'dollhouse' && eye !== undefined;

  const needsSillHeight: string[] = [];
  const walls: WallSection[] = room.walls.map((wall, i) => {
    const top = wallTop(wall, room);
    const drawnTo = top < height ? top : height;
    const cut = top > height;

    const openingsCut: string[] = [];
    const unknown: string[] = [];
    for (const opening of wall.openings ?? []) {
      const sill = sillOf(opening);
      if (sill === null) {
        unknown.push(opening.id);
        needsSillHeight.push(opening.id);
        continue;
      }
      // Half-open at the head so a plane exactly level with a door head reads as
      // over it, matching the way the ceiling test treats level-with as above.
      if (sill <= height && height < headOf(opening, sill)) openingsCut.push(opening.id);
    }

    let visible = true;
    let hiddenBecause: WallSection['hiddenBecause'];
    if (dropNearWalls && eyeIsOutside(normals![i]!, midpoints![i]!, eye!)) {
      visible = false;
      hiddenBecause = 'the viewer is outside it';
    }

    return {
      wallId: wall.id,
      visible,
      ...(hiddenBecause ? { hiddenBecause } : {}),
      drawnFrom: 0n,
      drawnTo,
      cut,
      openingsCut,
      openingsOfUnknownSill: unknown,
    };
  });

  return {
    mode: options.mode ?? (height < ceiling ? 'cut' : 'walkthrough'),
    cutHeight: height,
    ceilingVisible: height >= ceiling,
    floorVisible: true,
    walls,
    needsSillHeight,
  };
}

/**
 * The dollhouse: no ceiling, and no walls in the way.
 *
 * This is the view Sam was asking for. The lid comes off and the two or three
 * walls the viewer is standing outside of come off with it, so an oblique orbit
 * looks down into the room instead of at the outside of a closed box. Walls
 * still stand full height on the far side, which is what keeps it readable as a
 * room rather than a plan with edges.
 */
export function dollhouse(room: Room, eye: Viewpoint): SectionView {
  const view = cutAt(room, { eye, mode: 'dollhouse' });
  return { ...view, ceilingVisible: false };
}

/**
 * What to draw, given only where the viewer is.
 *
 * This is the auto behaviour, and it is deliberately a small number of rules
 * rather than a mode picker the user has to find:
 *
 *   - Eye above the ceiling → the ceiling goes. Looking down at a lid is never
 *     what was wanted.
 *   - Eye above the ceiling *and* outside the room's footprint in plan → an
 *     oblique overhead orbit, so the near walls go too: the dollhouse.
 *   - Eye inside → a walkthrough. Everything stands, because from in here the
 *     ceiling is part of the room.
 *
 * An explicit cut height always wins; somebody dragging the slider has said what
 * they want and should not have it taken back by a rule.
 */
export function sectionFor(room: Room, eye: Viewpoint, options: { height?: Nanometres } = {}): SectionView {
  validate(room);
  if (options.height !== undefined) {
    return { ...cutAt(room, { height: options.height, eye }), mode: 'cut' };
  }
  if (!aboveCeiling(room, eye)) return cutAt(room, { eye, mode: 'walkthrough' });
  return insidePlan(room, eye) ? { ...cutAt(room, { eye }), ceilingVisible: false, mode: 'plan' } : dollhouse(room, eye);
}

/**
 * Is the eye over the room's footprint?
 *
 * Ray casting on exact integers: count the edges a ray due east from the point
 * crosses. Horizontal edges are skipped and each edge is half-open at its upper
 * end, so a ray that grazes a corner is counted once rather than twice or none.
 */
export function insidePlan(room: Room, eye: Viewpoint): boolean {
  const points = corners(room);
  let inside = false;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const lower = a.y <= b.y ? a : b;
    const upper = a.y <= b.y ? b : a;
    if (eye.y < lower.y || eye.y >= upper.y) continue;
    // Cross product rather than a division, so the comparison stays exact.
    const side = (upper.x - lower.x) * (eye.y - lower.y) - (upper.y - lower.y) * (eye.x - lower.x);
    if (side > 0n) inside = !inside;
  }
  return inside;
}

/**
 * The heights worth offering on the cut slider, tallest first.
 *
 * Not a fixed list. A slider is only useful if it stops where the room has
 * something to show, so the stops are the room's own features: the conventional
 * 4'0" section, the top of every part-height wall, and the sill and head of
 * every opening whose sill is known. Duplicates and anything at or above the
 * ceiling are dropped.
 */
export function cutStops(room: Room): Nanometres[] {
  validate(room);
  const ceiling = ceilingOf(room);
  const stops = new Set<Nanometres>();
  if (CONVENTIONAL_CUT_HEIGHT < ceiling) stops.add(CONVENTIONAL_CUT_HEIGHT);
  for (const wall of room.walls) {
    const top = wallTop(wall, room);
    if (top > 0n && top < ceiling) stops.add(top);
    for (const opening of wall.openings ?? []) {
      const sill = sillOf(opening);
      if (sill === null) continue;
      const head = headOf(opening, sill);
      if (sill > 0n && sill < ceiling) stops.add(sill);
      if (head > 0n && head < ceiling) stops.add(head);
    }
  }
  return [...stops].sort((a, b) => (a === b ? 0 : a > b ? -1 : 1));
}
