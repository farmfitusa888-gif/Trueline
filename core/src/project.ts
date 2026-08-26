import { type Nanometres, NM_PER_FOOT } from './length.ts';
import { type Opening, type Point, type Room, corners, runLength, validate } from './room.ts';
import { type Footprint } from './obstruction.ts';
import { type SectionView, outwardNormals } from './section.ts';

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

/**
 * How tall a scanned object is drawn.
 *
 * A footprint is a plan rectangle. RoomPlan knows how tall a fridge is and the
 * importer does not carry it, so every box is drawn to one waist height: enough
 * to read as a thing standing on the floor, and never mistakable for a
 * measurement of the thing. The legend and the toggle both say what it is.
 *
 * One number for both projections. It was declared inside `project` and the
 * interior view needed the same figure, which is exactly how two views of one
 * room start disagreeing about how tall a sofa is.
 */
const OBJECT_HEIGHT_FEET = 2.5;

/** Nanometres to feet, as a float, at the boundary where drawing begins. */
export function feet(value: Nanometres): number {
  return Number(value) / Number(NM_PER_FOOT);
}

/**
 * A wall's outward normal points away from the room. A viewer standing outside
 * that wall sees its back, and drawing it would put a wall between them and the
 * room they are looking into — so it comes off, exactly as a dollhouse has no
 * near wall.
 */
export function facing(normal: { x: bigint; y: bigint }, turn: number): number {
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
 * A plan point and a height, as the axonometric camera sees it.
 *
 * Not `Seen`, which is this file's name for a point in the *perspective*
 * viewer's frame and means something else entirely -- right, up and ahead
 * rather than screen x, screen y and painter's depth. Two names, because they
 * are two things.
 */
export interface Placed2D {
  readonly x: number;
  readonly y: number;
  /** Larger is further away. Painter's algorithm orders on this. */
  readonly depth: number;
}

/**
 * The camera, as a function from a plan point and a height to a screen point.
 *
 * Lifted out of `project` when the floor grew a three-dimensional view of its
 * own. Both views turn about the vertical axis and then tip the whole thing
 * back, and they have to do it identically: a floor whose rooms sat at a
 * different angle from the room screen's would read as two drawings of two
 * buildings. One transform, used twice, is the only way that stays true.
 */
export function viewer(camera: Camera): (p: Point, height: number) => Placed2D {
  const turn = camera.turn * DEGREE;
  // Straight down is the plan, and at exactly 90 degrees the walls collapse to
  // lines. Held a little short of it so a "top" view still shows the room has
  // height.
  const tilt = Math.max(2, Math.min(88, camera.tilt)) * DEGREE;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const sinTilt = Math.sin(tilt);
  const cosTilt = Math.cos(tilt);
  return (p: Point, height: number) => {
    const x = feet(p.x);
    const y = feet(p.y);
    const across = x * cos - y * sin;
    const into = x * sin + y * cos;
    return {
      x: across,
      y: into * sinTilt - height * cosTilt,
      depth: into * cosTilt + height * sinTilt,
    };
  };
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
  footprints: readonly Footprint[] = [],
  /**
   * A cut plane, from `section.ts`, or nothing for the whole room.
   *
   * The horizontal section is the oldest drawing convention there is and the
   * one a remodeler reads without being taught: slice the room at four foot,
   * look down, and everything above the counters and below the heads of the
   * doors is gone. It is how you see the base cabinets, the pony wall, the
   * opening that is not a door.
   *
   * `section.ts` has produced this since early on and nothing ever drew it.
   * All the arithmetic -- which walls the plane passes through, which openings
   * it crosses, which windows have no recorded sill so it cannot say -- is
   * decided there. This only draws what it was handed.
   */
  section?: SectionView
): Projection {
  validate(room);
  if (!Number.isFinite(camera.turn) || !Number.isFinite(camera.tilt)) {
    throw new ProjectionError('A camera needs a turn and a tilt, in degrees.');
  }

  const points = corners(room);
  const normals = outwardNormals(room);

  const view = viewer(camera);

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

  const cutBy = section
    ? new Map(section.walls.map((w) => [w.wallId, w]))
    : null;

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

    const cut = cutBy?.get(wall.id);
    if (cut && !cut.visible) {
      hidden.push(wall.id);
      return;
    }

    // The plane's own answer for this wall, which is not simply the cut
    // height: a wall that stops below the plane is drawn whole, and
    // `section.ts` has already worked out which is which.
    const top = cut
      ? feet(cut.drawnTo)
      : feet((wall.height ?? room.ceilingHeight).value);
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
      let head = sill + feet(opening.height.value);
      // Under the plane entirely, so there is nothing of it left to draw; or
      // crossing it, so it is drawn up to the cut and no further. A window
      // whose head is drawn above a plane the plane went through is the thing
      // that makes a section look like a mistake.
      if (cut) {
        const plane = feet(cut.drawnTo);
        if (sill >= plane) continue;
        if (head > plane) head = plane;
      }
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

/* ------------------------------------------------------- standing inside */

/**
 * Where somebody is standing, and which way they are looking.
 *
 * A different thing from `Camera`, which orbits the room from outside and has
 * no position at all. This has one, because from inside a room the answer to
 * "what can I see" depends on where you are and nothing else.
 *
 * Like `section.ts`'s `Viewpoint` it is a viewpoint and not a measurement: no
 * provenance, no tolerance, because nobody measured it. It must never end up in
 * a dimension and nothing here returns it as one.
 */
export interface Standing {
  /** In the room's own plan coordinates. */
  readonly at: Point;
  /** Above the finished floor. Eye height, not floor height. */
  readonly height: Nanometres;
  /** Degrees clockwise. 0 looks along the plan's +y axis, as `Camera` does. */
  readonly turn: number;
  /** Degrees above level. Positive looks up at the ceiling. */
  readonly tilt: number;
}

/**
 * Eye height for somebody of ordinary height holding still.
 *
 * 5'4" rather than a person's full height: the eye is a few inches below the
 * top of the head. It is a starting point that can be dragged, not a finding.
 */
export const STANDING_EYE: Nanometres = (64n * NM_PER_FOOT) / 12n;

/** How wide the view is, across the screen, in degrees. */
const FIELD_OF_VIEW = 72;

/**
 * How close something can be before it is clipped away.
 *
 * Not zero. A vertex exactly at the eye divides by zero, and one a hair in
 * front of it projects to somewhere near infinity and drags the whole wall off
 * the screen with it. Six inches is closer than anybody stands to a wall.
 */
const NEAREST_FEET = 0.5;

interface Seen {
  /** Across the view: positive is to the right. */
  readonly right: number;
  /** Up the view: positive is up. */
  readonly up: number;
  /** How far in front. Always the depth, and always positive after clipping. */
  readonly ahead: number;
}

/**
 * Sutherland–Hodgman against the near plane, and nothing else.
 *
 * The one clip a first-person view cannot do without. A wall you are standing
 * against runs from in front of you to behind you, and the part behind has no
 * projection at all -- left alone it comes out mirrored on the far side of the
 * screen and paints over the room. Cutting the polygon at the near plane is
 * what makes standing close to a wall look like standing close to a wall.
 *
 * The sides and the top are deliberately not clipped: they cost a fifth of the
 * arithmetic and the SVG viewport already discards what falls outside it.
 */
function clipToFront(polygon: readonly Seen[]): Seen[] {
  const out: Seen[] = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const now = polygon[i]!;
    const next = polygon[(i + 1) % polygon.length]!;
    const nowIn = now.ahead >= NEAREST_FEET;
    const nextIn = next.ahead >= NEAREST_FEET;
    if (nowIn) out.push(now);
    if (nowIn !== nextIn) {
      const t = (NEAREST_FEET - now.ahead) / (next.ahead - now.ahead);
      out.push({
        right: now.right + (next.right - now.right) * t,
        up: now.up + (next.up - now.up) * t,
        ahead: NEAREST_FEET,
      });
    }
  }
  return out;
}

/**
 * The room from inside it.
 *
 * ## Why this is a second projection and not an option on the first
 *
 * `project` is an orthographic orbit: it turns the room and tips it back, and
 * every parallel line in the room stays parallel on the screen. That is the
 * right way to draw a building from outside and it is the wrong way to draw one
 * from inside, where the whole sensation of being in a room comes from the
 * walls converging. An orthographic interior view looks like a diagram of a box
 * you are somehow inside, which is worse than no interior view.
 *
 * So this is perspective, with an eye, and the two share nothing but their
 * output type -- which is the part that matters, because everything downstream
 * (tapping a wall, selecting it, typing a tape reading into it) works on
 * `Facet` and does not care which one drew it.
 *
 * ## What it is for
 *
 * Standing where the person stood. A client looking at a plan sees a diagram; a
 * client standing in the middle of their own kitchen sees their kitchen. And
 * for the contractor it answers the question a plan cannot: what does it
 * actually look like from the door.
 *
 * Every face still carries its wall's id. Tap a wall from inside the room and
 * it is the same wall the tape box re-solves -- which is the whole reason this
 * is drawn from the model rather than from the scanner's mesh.
 */
export function projectFrom(
  room: Room,
  standing: Standing,
  size = 1000,
  footprints: readonly Footprint[] = []
): Projection {
  validate(room);
  if (!Number.isFinite(standing.turn) || !Number.isFinite(standing.tilt)) {
    throw new ProjectionError('Standing somewhere needs a turn and a tilt, in degrees.');
  }

  const points = corners(room);
  const eyeX = feet(standing.at.x);
  const eyeY = feet(standing.at.y);
  const eyeZ = feet(standing.height);

  const turn = standing.turn * DEGREE;
  // Straight up and straight down are both legal from in here -- looking at the
  // ceiling is a thing people do in a room -- but not past them, where the
  // picture would turn over.
  const tilt = Math.max(-85, Math.min(85, standing.tilt)) * DEGREE;
  const sinTurn = Math.sin(turn);
  const cosTurn = Math.cos(turn);
  const sinTilt = Math.sin(tilt);
  const cosTilt = Math.cos(tilt);

  /** A plan point at a height, into what the eye sees. */
  const seen = (p: Point, height: number): Seen => {
    const dx = feet(p.x) - eyeX;
    const dy = feet(p.y) - eyeY;
    const dz = height - eyeZ;
    // Turn about the vertical. At turn 0 this looks along +y with +x on the
    // right, which is the same convention `project` uses.
    const ahead = dx * sinTurn + dy * cosTurn;
    const right = dx * cosTurn - dy * sinTurn;
    // Then tip. Looking up swings the ceiling down into view.
    return {
      right,
      up: dz * cosTilt - ahead * sinTilt,
      ahead: ahead * cosTilt + dz * sinTilt,
    };
  };

  // How far to push the picture back from the eye so the field of view is what
  // it says it is.
  const focal = size / 2 / Math.tan((FIELD_OF_VIEW * DEGREE) / 2);
  const flatten = (v: Seen) => ({
    x: size / 2 + (v.right / v.ahead) * focal,
    y: size / 2 - (v.up / v.ahead) * focal,
  });

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

  /** Clips, flattens, and files one face. Nothing that survives is dropped. */
  const put = (
    wallId: string,
    kind: Facet['kind'],
    corners3d: readonly Seen[],
    shade: number,
    nudge = 0,
    openingKind?: Opening['kind']
  ): boolean => {
    const clipped = clipToFront(corners3d);
    if (clipped.length < 3) return false;
    raw.push({
      wallId,
      kind,
      ...(openingKind ? { openingKind } : {}),
      points: clipped.map(flatten),
      depth: clipped.reduce((sum, v) => sum + v.ahead, 0) / clipped.length + nudge,
      shade,
    });
    return true;
  };

  const ceiling = feet(room.ceilingHeight.value);

  // The floor and the ceiling, both. From inside a room the ceiling is part of
  // the room -- leaving it off is what makes an interior view feel like a set.
  put('floor', 'floor', points.map((p) => seen(p, 0)), 0.88);
  put('ceiling', 'floor', points.map((p) => seen(p, ceiling)), 0.97);

  room.walls.forEach((wall, i) => {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const top = feet((wall.height ?? room.ceilingHeight).value);
    // Which way this wall faces relative to the way we are looking, for shading
    // only. From inside, every wall's inside faces us -- there is no hiding a
    // wall for being on the wrong side, only for being behind the eye.
    const along = Math.atan2(feet(b.x) - feet(a.x), feet(b.y) - feet(a.y));
    const shade = wall.open ? 0.99 : 0.5 + 0.4 * Math.abs(Math.cos(along - turn));

    const drawn = put(
      wall.id,
      'wall',
      [seen(a, 0), seen(b, 0), seen(b, top), seen(a, top)],
      shade
    );
    if (!drawn) {
      // Behind the eye entirely. Named rather than silently absent, because the
      // screen says how many walls are out of view and a wrong count reads as a
      // missing wall.
      hidden.push(wall.id);
      return;
    }

    const length = Number(runLength(wall));
    for (const opening of wall.openings ?? []) {
      const from = Number(opening.offsetFromStart.value) / length;
      const to = from + Number(opening.width.value) / length;
      const sill = feet(opening.sillHeight?.value ?? 0n);
      const head = sill + feet(opening.height.value);
      const at = (t: number): Point => ({
        x: a.x + ((b.x - a.x) * BigInt(Math.round(t * 1e6))) / 1_000_000n,
        y: a.y + ((b.y - a.y) * BigInt(Math.round(t * 1e6))) / 1_000_000n,
      });
      const [left, right] = [at(from), at(to)];
      put(
        wall.id,
        'opening',
        [seen(left, sill), seen(right, sill), seen(right, head), seen(left, head)],
        opening.kind === 'window' ? 0.99 : 0.78,
        // Toward the eye, so it lands on its own wall rather than fighting it
        // for the same depth. Same reason as the orbit view's nudge.
        -0.01,
        opening.kind
      );
    }
  });

  for (const item of footprints) {
    const box: Point[] = [
      { x: item.min.x, y: item.min.y },
      { x: item.max.x, y: item.min.y },
      { x: item.max.x, y: item.max.y },
      { x: item.min.x, y: item.max.y },
    ];
    if (
      Math.abs(feet(item.max.x) - feet(item.min.x)) < 0.02 ||
      Math.abs(feet(item.max.y) - feet(item.min.y)) < 0.02
    ) {
      continue;
    }
    put(`object:${item.id}`, 'object', box.map((p) => seen(p, OBJECT_HEIGHT_FEET)), 0.86);
    for (let i = 0; i < box.length; i += 1) {
      const a = box[i]!;
      const b = box[(i + 1) % box.length]!;
      put(
        `object:${item.id}`,
        'object',
        [seen(a, 0), seen(b, 0), seen(b, OBJECT_HEIGHT_FEET), seen(a, OBJECT_HEIGHT_FEET)],
        i % 2 === 0 ? 0.72 : 0.64
      );
    }
  }

  // Furthest first, and each wall's openings straight after it -- the same
  // ordering the orbit view needs, for the same reason: an opening lies in the
  // plane of its wall, so no depth comparison can separate the two honestly.
  const solids = raw.filter((f) => f.kind !== 'opening').sort((a, b) => b.depth - a.depth);
  const ordered: Raw[] = [];
  for (const solid of solids) {
    ordered.push(solid);
    if (solid.kind === 'wall') {
      ordered.push(...raw.filter((f) => f.kind === 'opening' && f.wallId === solid.wallId));
    }
  }

  return {
    facets: ordered.map((f) => ({
      wallId: f.wallId,
      kind: f.kind,
      ...(f.openingKind ? { openingKind: f.openingKind } : {}),
      points: f.points,
      depth: f.depth,
      shade: f.shade,
    })),
    hidden,
  };
}

/**
 * The middle of the room, at eye height, facing the longest wall.
 *
 * Where somebody would stand to look at a room they have just walked into: far
 * enough back to see it, turned toward the wall most of it happens on. The
 * centroid rather than the average of the corners, so an L-shaped room does not
 * put the viewer in the part that is not there.
 */
export function standingInside(room: Room): Standing {
  const points = corners(room);
  let twiceArea = 0n;
  let cx = 0n;
  let cy = 0n;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const cross = a.x * b.y - b.x * a.y;
    twiceArea += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  const middle: Point =
    twiceArea === 0n
      ? points[0]!
      : { x: cx / (3n * twiceArea), y: cy / (3n * twiceArea) };

  // Face the longest wall. It is the one the room is about, and it is the same
  // wall the punch list ranks first for exactly the same reason.
  let longest = 0;
  let best = -1n;
  room.walls.forEach((wall, i) => {
    const run = runLength(wall);
    if (run > best) {
      best = run;
      longest = i;
    }
  });
  const a = points[longest]!;
  const b = points[(longest + 1) % points.length]!;
  const towards: Point = { x: (a.x + b.x) / 2n, y: (a.y + b.y) / 2n };
  const dx = feet(towards.x - middle.x);
  const dy = feet(towards.y - middle.y);
  // The inverse of the turn used above: turn 0 looks along +y.
  const turn = (Math.atan2(dx, dy) / DEGREE + 360) % 360;

  return { at: middle, height: STANDING_EYE, turn, tilt: 0 };
}
