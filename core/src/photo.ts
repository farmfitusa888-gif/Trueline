import { type Nanometres, hypotenuse } from './length.ts';
import { type Point, type Room, RoomError, corners, validate } from './room.ts';

/**
 * A photo that knows where it was taken from, and therefore which walls it shows.
 *
 * During a capture every ARFrame carries the camera's transform and intrinsics,
 * and `arFrameReferenceOriginTransform` puts them in the same coordinate space as
 * the finished room. So a photo stops being "a photo of the kitchen" and becomes
 * "taken from here, looking that way, at these walls".
 *
 * What that turns on:
 *   - tap a wall, get every photo that shows it, best first
 *   - a disputed dimension has the frame it was read from attached to it
 *   - a wall marked low confidence because furniture was in the way can prove it
 *
 * The direction vectors arrive as floats from ARKit and are quantised to integers
 * once, on the device, at the same boundary where metres become nanometres. Past
 * that everything here is exact integer arithmetic: every test below is a cross
 * product, so no trigonometry and no floating point enters the room model.
 *
 * This module answers "what is in frame". It deliberately does not answer "what
 * is hidden behind something else" — occlusion is its own problem with its own
 * function, not a missing half of this one.
 */

export interface Vec2 {
  readonly x: bigint;
  readonly y: bigint;
}

export interface CameraPose {
  /** Where the camera stood, in the room's own plan coordinates. */
  readonly at: Point;
  /** Direction of view. Need not be unit length; only its direction is used. */
  readonly forward: Vec2;
  /** The two edges of the horizontal field of view, left and right of forward. */
  readonly leftEdge: Vec2;
  readonly rightEdge: Vec2;
}

export interface Photo {
  readonly id: string;
  readonly takenAt: string;
  readonly pose: CameraPose;
  /** How it was triggered — the app captures on a new viewpoint, and on a tap. */
  readonly trigger: 'automatic' | 'manual';
  /**
   * What the file is called in the capture's own folder.
   *
   * Carried so a screen can actually show the picture. This module has been able
   * to say which walls a photo shows since it was written, and nothing could put
   * one in front of a person, because the model knew where a photo was taken
   * from and not where it *is*. The image itself never enters the model — only
   * its name, so whoever is holding the folder can find it.
   */
  readonly fileName?: string;
  /**
   * How far to turn the picture, clockwise, to put the world the right way up.
   *
   * **ARKit hands back every frame in the device's landscape frame, whatever
   * way the phone was actually being held.** So a walk done in portrait — which
   * is every walk anybody does — produces a folder of pictures lying on their
   * side, and a contractor looking at his own garage sees it sideways.
   *
   * It is not guessed and it is not read off an EXIF tag that is not there. The
   * camera's own X axis is in the pose: measured across all 55 photographs of
   * Sam's garage, it points at the floor with a median dot product of -0.978
   * against world up, which is a phone held upright. That is the number this is
   * derived from, per photograph, so a phone turned sideways halfway through a
   * walk comes out right too.
   *
   * A display quantity, never a measurement — the same boundary rule `render.ts`
   * keeps. Nothing on the plan depends on it.
   */
  readonly upright?: 0 | 90 | 180 | 270;
}

export class PhotoError extends RoomError {}

/* --------------------------------------------------------------- exact math */

function cross(a: Vec2, b: Vec2): bigint {
  return a.x * b.y - a.y * b.x;
}

function minus(p: Point, q: Point): Vec2 {
  return { x: p.x - q.x, y: p.y - q.y };
}

/**
 * Inside the wedge means left of the right edge and right of the left edge.
 * Boundaries count as inside — a wall exactly on the edge of frame is in the frame.
 */
function insideWedge(pose: CameraPose, p: Point): boolean {
  const v = minus(p, pose.at);
  return cross(pose.rightEdge, v) >= 0n && cross(pose.leftEdge, v) <= 0n;
}

/**
 * Where a segment crosses a ray from the camera, as an exact fraction along the
 * segment. Returns null when they do not cross within the segment.
 *
 * Kept as a numerator and denominator rather than a number, so the caller can
 * decide where to round rather than having it rounded here.
 */
function crossingFraction(
  from: Point,
  to: Point,
  origin: Point,
  direction: Vec2
): { numerator: bigint; denominator: bigint } | null {
  const seg = minus(to, from);
  const denominator = cross(direction, seg);
  if (denominator === 0n) return null; // parallel
  const numerator = cross(direction, minus(origin, from));
  // The crossing must land within the segment, and ahead of the camera.
  const t = { numerator, denominator };
  const inRange =
    denominator > 0n
      ? numerator >= 0n && numerator <= denominator
      : numerator <= 0n && numerator >= denominator;
  if (!inRange) return null;
  // How far along the ray the crossing sits: s = cross(seg, d) / denominator.
  // It has to be non-negative, so the two must share a sign — a crossing behind
  // the camera is a wall it is facing away from, not one it can see.
  const along = cross(seg, minus(origin, from));
  const ahead = denominator > 0n ? along >= 0n : along <= 0n;
  return ahead ? t : null;
}

/** Rounds a point a fraction of the way along a segment, to the nearest nanometre. */
function along(from: Point, to: Point, f: { numerator: bigint; denominator: bigint }): Point {
  const seg = minus(to, from);
  const half = f.denominator / 2n;
  const sign = f.denominator < 0n ? -1n : 1n;
  return {
    x: from.x + (seg.x * f.numerator + half * sign) / f.denominator,
    y: from.y + (seg.y * f.numerator + half * sign) / f.denominator,
  };
}

/**
 * How much of a wall a clipped span covers.
 *
 * Square segments are exact subtraction. One that runs at an angle takes the
 * integer square root, the same rounding the wall it lies on already carries.
 * This used to refuse angled walls outright, and 292 real camera poses walked
 * into a kitchen with a 203 mm chamfer in it and found out.
 */
function segmentLength(a: Point, b: Point): Nanometres {
  const dx = a.x > b.x ? a.x - b.x : b.x - a.x;
  const dy = a.y > b.y ? a.y - b.y : b.y - a.y;
  if (dx === 0n || dy === 0n) return dx + dy;
  return hypotenuse(dx, dy);
}

/* ------------------------------------------------------------------ in frame */

export interface WallInFrame {
  readonly wallId: string;
  /** The stretch of that wall which is actually inside the frame. */
  readonly from: Point;
  readonly to: Point;
  /** How much of the wall is in shot. Used to rank photos, never as a dimension. */
  readonly visibleLength: Nanometres;
  /** How much of the whole wall that is, in thousandths, so 1000 means all of it. */
  readonly fractionPerMille: bigint;
}

/**
 * Which walls this photo has in frame, and how much of each.
 *
 * The clipped span is a ranking quantity — it decides which photo to show first
 * for a given wall — and is explicitly not a measurement. Nothing here ever
 * becomes a dimension on a plan.
 */
export function wallsInFrame(photo: Photo, room: Room): WallInFrame[] {
  validate(room);
  if (cross(photo.pose.rightEdge, photo.pose.leftEdge) <= 0n) {
    throw new PhotoError(
      `Photo "${photo.id}" has a field of view that is not a wedge opening to the left of its ` +
        `right edge. The frustum edges are the wrong way round, or it spans half a turn or more.`
    );
  }

  const points = corners(room);
  const found: WallInFrame[] = [];

  room.walls.forEach((wall, i) => {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;

    const aIn = insideWedge(photo.pose, a);
    const bIn = insideWedge(photo.pose, b);

    let from = a;
    let to = b;

    if (!aIn || !bIn) {
      // Clip against whichever frustum edges the wall crosses.
      //
      // A point produced by clipping against one edge lies *on* that edge, so
      // checking it against that same edge asks whether a rounded number is
      // exactly zero — and it is not. The crossing is rounded to the nearest
      // nanometre, which lands it a fraction of a nanometre to one side, and
      // that fraction used to throw the whole wall away. Found by pointing a
      // camera at a wall it plainly could see and getting nothing back. Each hit
      // is therefore tested against the *other* edge only.
      const clipped = (edge: Vec2, keep: (v: Vec2) => boolean): Point | null => {
        const f = crossingFraction(a, b, photo.pose.at, edge);
        if (f === null) return null;
        const p = along(a, b, f);
        return keep(minus(p, photo.pose.at)) ? p : null;
      };
      const hits = [
        clipped(photo.pose.leftEdge, (v) => cross(photo.pose.rightEdge, v) >= 0n),
        clipped(photo.pose.rightEdge, (v) => cross(photo.pose.leftEdge, v) <= 0n),
      ]
        .filter((p): p is Point => p !== null)
        // In the order they appear walking the wall, so `from` and `to` mean
        // what they say and the length is measured across the right stretch.
        .sort((p, q) => {
          const along = (r: Point) => (r.x - a.x) * (b.x - a.x) + (r.y - a.y) * (b.y - a.y);
          const dp = along(p);
          const dq = along(q);
          return dp === dq ? 0 : dp < dq ? -1 : 1;
        });

      if (aIn && hits[0]) { from = a; to = hits[0]; }
      else if (bIn && hits[0]) { from = hits[0]; to = b; }
      else if (hits.length >= 2) { from = hits[0]!; to = hits[1]!; }
      else return; // nothing of this wall is in frame
    }

    const visible = segmentLength(from, to);
    if (visible === 0n) return;
    const whole = wall.length.value;
    found.push({
      wallId: wall.id,
      from,
      to,
      visibleLength: visible,
      fractionPerMille: whole === 0n ? 0n : (visible * 1000n) / whole,
    });
  });

  return found;
}

/** Does this photo show any part of that wall? */
export function shows(photo: Photo, room: Room, wallId: string): boolean {
  return wallsInFrame(photo, room).some((w) => w.wallId === wallId);
}

/**
 * The photos of a given wall, the one showing most of it first. This is what
 * comes up when somebody taps a wall on the plan and asks what it looked like.
 */
export function photosOfWall(
  photos: readonly Photo[],
  room: Room,
  wallId: string
): { photo: Photo; inFrame: WallInFrame }[] {
  return photos
    .flatMap((photo) => {
      const inFrame = wallsInFrame(photo, room).find((w) => w.wallId === wallId);
      return inFrame ? [{ photo, inFrame }] : [];
    })
    .sort((p, q) =>
      p.inFrame.visibleLength === q.inFrame.visibleLength
        ? p.photo.id.localeCompare(q.photo.id)
        : p.inFrame.visibleLength > q.inFrame.visibleLength
          ? -1
          : 1
    );
}

/**
 * Walls no photo shows any part of.
 *
 * A wall nobody photographed is the wall that gets argued about, so this is a
 * finishing check on a capture rather than a report: it is what the app uses to
 * say "go back and shoot the north wall" before somebody leaves the site.
 */
export function unphotographedWalls(photos: readonly Photo[], room: Room): string[] {
  validate(room);
  const seen = new Set<string>();
  for (const photo of photos) {
    for (const w of wallsInFrame(photo, room)) seen.add(w.wallId);
  }
  return room.walls.map((w) => w.id).filter((id) => !seen.has(id));
}
