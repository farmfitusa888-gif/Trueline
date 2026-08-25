import { type Nanometres, NM_PER_FOOT } from './length.ts';
import { type Opening, type Point, type Room, corners, runLength, validate } from './room.ts';
import { type Footprint } from './obstruction.ts';
import { outwardNormals } from './section.ts';

/**
 * The room as a picture of a room, rather than a plan of one.
 *
 * Sam asked for a toggle: the blueprint, and the three-dimensional thing the
 * scanner produced, with the walls still tappable so a tape reading can be
 * typed on either. The scanner does write a `room.usdz`, and Apple's own viewer
 * will show it — but a usdz is a mesh. You cannot tap a wall in it and have the
 * room re-solve, because it has no idea which triangle is which wall. It is a
 * picture of the room; it is not the room.
 *
 * So this draws the model instead. Every face that comes out of here still
 * carries the id of the wall it belongs to, which means the 3D view is the same
 * screen as the plan: tap a wall, type what the tape says, watch the room move.
 * One measurement engine, two ways of looking at it.
 *
 * Floats live here and nowhere else. A projection is presentation — it decides
 * where ink goes on a screen, never what a wall measures — so it is the one
 * place in this package where an exact integer buys nothing. Every number it
 * starts from is exact; every number it produces is a pixel.
 */

export class ProjectionError extends Error {}

export interface Camera {
  /** Degrees clockwise around the room. 0 looks along the plan's +y axis. */
  readonly turn: number;
  /**
   * Degrees above the floor plane. 0 is standing on the floor looking level,
   * 90 is directly overhead, which is the plan.
   */
  readonly tilt: number;
}

/** A flat face of the room, ready to be drawn. */
export interface Facet {
  /** The wall this face belongs to, so tapping it selects that wall. */
  readonly wallId: string;
  readonly kind: 'wall' | 'floor' | 'opening' | 'object';
  /** For an opening, which one — so a door can be told from a window. */
  readonly openingKind?: Opening['kind'];
  /** Screen coordinates, in the box the projection was asked for. */
  readonly points: readonly { readonly x: number; readonly y: number }[];
  /**
   * How far from the viewer, for painter's-algorithm ordering. Larger is
   * further away, so drawing in descending order puts the near faces on top.
   */
  readonly depth: number;
  /**
   * How lit this face is, 0 to 1. Flat shading off the face's own direction —
   * enough to read the room as a solid rather than a tangle of outlines.
   */
  readonly shade: number;
}

export interface Projection {
  /** Furthest first, so drawing them in order is correct. */
  readonly facets: readonly Facet[];
  /** Walls left out because the viewer is on their outside — the dollhouse. */
  readonly hidden: readonly string[];
}

const DEGREE = Math.PI / 180;

/** Nanometres to feet, as a float, at the boundary where drawing begins. */
function feet(value: Nanometres): number {
  return Number(value) / Number(NM_PER_FOOT);
}

/**
 * A wall's outward normal points away from the room. A viewer standing outside
 * that wall sees its back, and drawing it would put a wall between them and the
 * room they are looking into — so it comes off, exactly as a dollhouse has no
 * near wall.
 */
function facing(normal: { x: bigint; y: bigint }, turn: number): number {
  const c = Math.cos(turn * DEGREE);
  const s = Math.sin(turn * DEGREE);
  const nx = Number(normal.x);
  const ny = Number(normal.y);
  const length = Math.hypot(nx, ny) || 1;
  // The viewer looks along +y after the turn, so a normal with a negative
  // rotated y component is pointing back at them.
  return (nx * s + ny * c) / length;
}

/**
 * Where the room's walls land on a screen, and in what order to draw them.
 *
 * `size` is the side of the square box to fit the room into. The projection is
 * axonometric — parallel, no vanishing point — because a plan-accurate drawing
 * that somebody is about to take measurements off should not have perspective
 * making the far end of a wall shorter than the near end.
 */
export function project(
  room: Room,
  camera: Camera,
  size = 1000,
  /**
   * What the scan found standing in the room, drawn as boxes.
   *
   * The 3D view showed the empty shell and nothing else, so a room somebody
   * had just walked came back looking like a room they had never been in. A
   * footprint is a plan rectangle with no height in it -- RoomPlan's height is
   * not carried through the importer -- so every box is drawn to one waist
   * height and says so. It is a marker for where something stands, not a model
   * of the thing.
   *
   * None of this touches a measurement: an object contributes no facet the
   * takeoff reads and no wall the solver sees.
   */
  footprints: readonly Footprint[] = []
): Projection {
  validate(room);
  if (!Number.isFinite(camera.turn) || !Number.isFinite(camera.tilt)) {
    throw new ProjectionError('A camera needs a turn and a tilt, in degrees.');
  }

  const points = corners(room);
  const normals = outwardNormals(room);

  const turn = camera.turn * DEGREE;
  // Straight down is the plan, and at exactly 90 degrees the walls collapse to
  // lines. Held a little short of it so a "top" view still shows the room has
  // height.
  const tilt = Math.max(2, Math.min(88, camera.tilt)) * DEGREE;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);

  /** Plan point plus a height, into the viewer's frame. */
  const view = (p: Point, height: number) => {
    const x = feet(p.x);
    const y = feet(p.y);
    // Turn about the vertical axis, then tip the whole thing back.
    const across = x * cos - y * sin;
    const into = x * sin + y * cos;
    return {
      x: across,
      y: into * Math.sin(tilt) - height * Math.cos(tilt),
      depth: into * Math.cos(tilt) + height * Math.sin(tilt),
    };
  };

  interface Raw {
    wallId: string;
    kind: Facet['kind'];
    openingKind?: Opening['kind'];
    points: { x: number; y: number }[];
    depth: number;
    shade: number;
  }
  const raw: Raw[] = [];
  const hidden: string[] = [];

  // The floor, always. It is what makes the room read as a room rather than
  // four rectangles standing in the dark.
  const floor = points.map((p) => view(p, 0));
  raw.push({
    wallId: 'floor',
    kind: 'floor',
    points: floor.map((v) => ({ x: v.x, y: v.y })),
    depth: Math.max(...floor.map((v) => v.depth)) + 1e6,
    shade: 0.92,
  });

  room.walls.forEach((wall, i) => {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const normal = normals[i]!;
    const towardsViewer = facing(normal, camera.turn);
    if (towardsViewer < 0) {
      // Its outside is what faces us; it is between the viewer and the room.
      hidden.push(wall.id);
      return;
    }

    const top = feet((wall.height ?? room.ceilingHeight).value);
    const quad = [view(a, 0), view(b, 0), view(b, top), view(a, top)];
    // A wall square to the viewer is brightest; one seen edge-on is darkest.
    const shade = 0.55 + 0.35 * Math.abs(towardsViewer);
    raw.push({
      wallId: wall.id,
      kind: 'wall',
      points: quad.map((v) => ({ x: v.x, y: v.y })),
      depth: quad.reduce((sum, v) => sum + v.depth, 0) / 4,
      shade: wall.open ? 0.97 : shade,
    });

    // Doors and windows, on the face of the wall they belong to. They carry the
    // wall's id too: tapping one is tapping the wall it is in.
    const length = Number(runLength(wall));
    for (const opening of wall.openings ?? []) {
      const from = Number(opening.offsetFromStart.value) / length;
      const to = from + Number(opening.width.value) / length;
      const sill = feet(opening.sillHeight?.value ?? 0n);
      const head = sill + feet(opening.height.value);
      const along = (t: number): Point => ({
        x: a.x + ((b.x - a.x) * BigInt(Math.round(t * 1e6))) / 1_000_000n,
        y: a.y + ((b.y - a.y) * BigInt(Math.round(t * 1e6))) / 1_000_000n,
      });
      const [left, right] = [along(from), along(to)];
      const hole = [view(left, sill), view(right, sill), view(right, head), view(left, head)];
      raw.push({
        wallId: wall.id,
        kind: 'opening',
        openingKind: opening.kind,
        points: hole.map((v) => ({ x: v.x, y: v.y })),
        // Nudged toward the viewer so it lands on its own wall rather than
        // fighting it for the same depth.
        depth: hole.reduce((sum, v) => sum + v.depth, 0) / 4 - 0.01,
        shade: opening.kind === 'window' ? 0.99 : 0.8,
      });
    }
  });

  // Fit whatever came out into the box asked for, keeping the shape.
  const xs = raw.flatMap((f) => f.points.map((p) => p.x));
  const ys = raw.flatMap((f) => f.points.map((p) => p.y));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 1e-9);
  const scale = (size * 0.92) / span;
  const offsetX = (size - (maxX - minX) * scale) / 2;
  const offsetY = (size - (maxY - minY) * scale) / 2;

  // An opening lies in the plane of the wall it is a hole in, so no depth
  // comparison can separate the two honestly: they are the same distance away.
  /* -------------------------------------------------------------- objects */

  // A footprint is a plan rectangle. RoomPlan knows how tall a fridge is and
  // the importer does not carry it, so every box is drawn to one waist height:
  // enough to read as a thing standing on the floor, and never mistakable for a
  // measurement of the thing. The legend and the toggle both say what it is.
  const OBJECT_HEIGHT_FEET = 2.5;
  for (const item of footprints) {
    const x0 = feet(item.min.x);
    const x1 = feet(item.max.x);
    const y0 = feet(item.min.y);
    const y1 = feet(item.max.y);
    const base: Point[] = [
      { x: item.min.x, y: item.min.y },
      { x: item.max.x, y: item.min.y },
      { x: item.max.x, y: item.max.y },
      { x: item.min.x, y: item.max.y },
    ];
    // Degenerate boxes come out of a scan that saw something edge-on. A face
    // with no width is a line, and a line drawn as a polygon is a stray mark.
    if (Math.abs(x1 - x0) < 0.02 || Math.abs(y1 - y0) < 0.02) continue;

    const top = base.map((p) => view(p, OBJECT_HEIGHT_FEET));
    raw.push({
      wallId: `object:${item.id}`,
      kind: 'object',
      points: top.map((v) => ({ x: v.x, y: v.y })),
      depth: top.reduce((sum, v) => sum + v.depth, 0) / 4,
      shade: 0.88,
    });

    for (let i = 0; i < base.length; i += 1) {
      const a = base[i]!;
      const b = base[(i + 1) % base.length]!;
      const quad = [view(a, 0), view(b, 0), view(b, OBJECT_HEIGHT_FEET), view(a, OBJECT_HEIGHT_FEET)];
      raw.push({
        wallId: `object:${item.id}`,
        kind: 'object',
        points: quad.map((v) => ({ x: v.x, y: v.y })),
        depth: quad.reduce((sum, v) => sum + v.depth, 0) / 4,
        // Alternating faces so a box reads as a box rather than a flat blob.
        shade: i % 2 === 0 ? 0.74 : 0.66,
      });
    }
  }

  // Sorting by depth alone got it backwards on Sam's own garage — the window on
  // wall-4 averaged 7.15 to the wall's 6.46, because it covers a different part
  // of the wall, so it was drawn first and the wall painted over it.
  //
  // So the solid faces are ordered by depth, and each wall's openings follow it
  // immediately. An opening is always drawn on its own wall and never on
  // anybody else's, whatever the arithmetic says.
  const solids = raw.filter((f) => f.kind !== 'opening').sort((a, b) => b.depth - a.depth);
  const ordered: Raw[] = [];
  for (const solid of solids) {
    ordered.push(solid);
    if (solid.kind === 'wall') {
      ordered.push(...raw.filter((f) => f.kind === 'opening' && f.wallId === solid.wallId));
    }
  }

  const facets: Facet[] = ordered.map((f) => ({
    wallId: f.wallId,
    kind: f.kind,
    ...(f.openingKind ? { openingKind: f.openingKind } : {}),
    points: f.points.map((p) => ({
      x: offsetX + (p.x - minX) * scale,
      y: offsetY + (p.y - minY) * scale,
    })),
    depth: f.depth,
    shade: f.shade,
  }));

  return { facets, hidden };
}

/**
 * A sensible place to stand when the 3D view first opens.
 *
 * Over one corner, high enough to see the floor, low enough that the walls
 * still have height in them. Not straight down — that is the plan, and there is
 * already a plan.
 */
export const DEFAULT_CAMERA: Camera = { turn: 30, tilt: 38 };
