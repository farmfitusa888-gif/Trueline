import { type Nanometres, NM_PER_METRE } from './length.ts';
import { type Photo, type Vec2, PhotoError } from './photo.ts';
import { type Point } from './room.ts';

/**
 * Photographs taken during the scan, and where each one was standing.
 *
 * This is the feature nothing else has. Every scanning app hands back a room;
 * some hand back photographs beside it. None hands back a photograph that knows
 * which walls are in it — because that needs the camera's pose at the instant
 * the shutter fired, tied to the same coordinate system the finished room is in.
 *
 * The composition is already proven against real data: 292 camera poses out of a
 * kitchen scan all land inside the room model, between 1.29 m and 2.01 m above
 * the floor, once `referenceOriginTransform` is inverted. So this is not a new
 * idea to be tried — it is arithmetic that has been checked.
 *
 * Everything here is the same boundary as `import-roomplan.ts`: ARKit speaks
 * float metres and 4x4 transforms, and every one of them becomes an exact
 * integer before it goes any further. `photo.ts` does the geometry afterwards
 * with cross products only, so no trigonometry ever touches the room model.
 */

/* --------------------------------------------------------------- the format */

export interface CapturedPhoto {
  readonly id: string;
  readonly takenAt: string;
  /** Automatic while walking, or because somebody pressed the button. */
  readonly trigger: 'automatic' | 'manual';
  /** The image beside this manifest. */
  readonly fileName: string;
  /** The ARFrame camera transform, column-major 16, in ARKit world space. */
  readonly cameraPoseARFrame: readonly number[];
  /** `fx 0 cx  0 fy cy  0 0 1`, as ARKit reports it. */
  readonly intrinsics: readonly number[];
  readonly imageWidth: number;
  readonly imageHeight: number;
  /** ARKit's own opinion of how well it was tracking. Carried, never overridden. */
  readonly trackingQuality?: string;
}

/** Where north was, and how well the phone knew, at one instant of the walk. */
export interface CapturedNorth {
  /** Degrees clockwise from true north, as Core Location reported it. */
  readonly trueHeading: number;
  /** Core Location's own estimate of how wrong that is, in degrees. */
  readonly accuracy: number;
  /** The camera transform at the same moment, column-major sixteen. */
  readonly atPose: readonly number[];
}

export interface PhotoManifest {
  readonly schema: string;
  readonly capturedAt: string;
  readonly device: string;
  readonly photos: readonly CapturedPhoto[];
  /** Absent on a phone with no compass, or one that did not trust its own. */
  readonly north?: CapturedNorth;
}

/** Which way north points on the plan, and how much to doubt it. */
export interface NorthOnPlan {
  /** A unit vector in plan coordinates. */
  readonly x: number;
  readonly y: number;
  /** Degrees of doubt, straight from Core Location. Never hidden. */
  readonly accuracy: number;
}

/**
 * Turns a heading and the pose taken beside it into north on the plan.
 *
 * A compass reading alone says nothing about a room: it says where north is
 * relative to a phone, and the phone was pointing somewhere. Pairing it with
 * the camera pose from the same instant is what ties the two together — the
 * pose says which way the phone faced in the room, the heading says what
 * bearing that was, and the difference is the room's own orientation.
 *
 * **One assumption, stated because it is not verified on hardware yet.** Core
 * Location reports a heading for the direction the device points, and this
 * treats that as the direction the camera looks. If the two are a quarter turn
 * apart on a real phone, every arrow this draws is a quarter turn out — which
 * is exactly the kind of wrong that is obvious the first time somebody holds a
 * real compass next to it, and a single constant to correct. Nothing measured
 * depends on it: not a length, not an area, not a quantity.
 */
export function northOnPlan(
  north: CapturedNorth,
  datum: RoomFrame['datum']
): NorthOnPlan | null {
  if (north.accuracy < 0 || !Number.isFinite(north.accuracy)) return null;
  const m = north.atPose;
  if (m.length !== 16) return null;

  // Where the camera looked, on the plan — through the same drop as everything
  // else, so the compass cannot end up in a different frame from the walls.
  const [fx, fy] = planFromWorld(-at(m, 2, 0), -at(m, 2, 2), datum);
  const length = Math.hypot(fx, fy);
  // Pointing straight up or down: the phone had no bearing worth the name.
  if (length < 0.15) return null;

  // That direction sits `trueHeading` degrees clockwise of north, so north is
  // the same direction turned back anticlockwise by the same amount.
  const turn = (north.trueHeading * Math.PI) / 180;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const ux = fx / length;
  const uy = fy / length;
  return {
    x: ux * cos - uy * sin,
    y: ux * sin + uy * cos,
    accuracy: north.accuracy,
  };
}

export const PHOTO_MANIFEST_SCHEMA = 'trueline.photos.v1';

/**
 * The room's own frame, as the importer established it.
 *
 * A photo is only meaningful in the same coordinates as the walls, so this has
 * to come from the import rather than be worked out again — two independent
 * derivations of the same datum is two chances to disagree.
 */
export interface RoomFrame {
  /** The unit direction the importer made "east". */
  readonly datum: { readonly x: number; readonly y: number };
  /**
   * Where the room's first corner sits in the datum frame.
   *
   * A `Room` is a shape, not a place: `corners()` walks the wall chain from
   * (0, 0), because a chain of headings and lengths has no opinion about where
   * it starts. Everything else read out of a scan — furniture, camera poses —
   * arrives in the scanner's own coordinates, metres from wherever the person
   * pressed start.
   *
   * Those two frames are not the same one, and in Gilbert's kitchen they were
   * 7.93 ft apart in x and 8.38 ft in y. Anything comparing a photograph or a
   * sofa against a wall was comparing it against a wall eight feet from where
   * it is. Subtracting this puts everything in the frame the plan is drawn in.
   */
  readonly origin: Point;
}

export class CaptureError extends PhotoError {}

/* ------------------------------------------------------------------ reading */

/**
 * How far the picture has to turn, clockwise, to put the world the right way up.
 *
 * ARKit reports every frame in the device's **landscape** frame regardless of
 * how the phone is being held, and it writes the JPEG that way too, with no
 * orientation tag on it. So a walk done in portrait — every walk anybody
 * actually does — produces a folder of photographs lying on their side.
 *
 * The pose already knows. The camera's own X axis is the image's left-to-right
 * direction in the world, so where that axis points relative to up says how the
 * phone was held. Measured across all 55 photographs of Sam's garage it sits at
 * a median of -0.978 against world up — the image's right-hand edge pointing at
 * the floor, which is a phone held upright in the ordinary way. Turning the
 * picture a quarter clockwise brings its left edge to the top, and the world
 * with it.
 *
 * A threshold rather than an angle, because a picture can only be hung one of
 * four ways round and there is no such thing as a photograph 37 degrees out.
 * Below it, the phone was genuinely on its side and the frame is already level.
 */
const HELD_UPRIGHT = 0.5;

function uprightTurn(right: readonly number[]): 0 | 90 | 180 | 270 {
  const length = Math.hypot(right[0]!, right[1]!, right[2]!);
  if (length === 0) return 0;
  const againstUp = right[1]! / length;
  if (againstUp <= -HELD_UPRIGHT) return 90;
  if (againstUp >= HELD_UPRIGHT) return 270;
  return 0;
}

function at(m: readonly number[], column: number, row: number): number {
  const value = m[column * 4 + row];
  if (value === undefined) {
    throw new CaptureError(`A transform in the capture has ${m.length} entries; it needs 16.`);
  }
  return value;
}

function nm(metres: number): Nanometres {
  if (!Number.isFinite(metres)) {
    throw new CaptureError(`The capture holds ${metres} where a position should be.`);
  }
  return BigInt(Math.round(metres * 1e9));
}

/**
 * Direction vectors become integers by scaling.
 *
 * Only the direction matters — every test in `photo.ts` is a cross product, and
 * a cross product does not care how long its arguments are. So the scale is
 * chosen large enough that a rounded component still points where it did, and
 * then forgotten about.
 */
const DIRECTION_SCALE = 1e9;

function direction(x: number, y: number, what: string): Vec2 {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new CaptureError(`The capture holds a ${what} that is not a finite direction.`);
  }
  const magnitude = Math.hypot(x, y);
  if (magnitude === 0) {
    throw new CaptureError(`A ${what} of zero length points nowhere.`);
  }
  return {
    x: BigInt(Math.round((x / magnitude) * DIRECTION_SCALE)),
    y: BigInt(Math.round((y / magnitude) * DIRECTION_SCALE)),
  };
}

function cross(a: Vec2, b: Vec2): bigint {
  return a.x * b.y - a.y * b.x;
}

/**
 * How much of a ray has to be horizontal before its bearing means anything.
 *
 * 0.15 is about 8.6 degrees off vertical. Below that a corner of the frame is
 * pointing at the floor or the ceiling, and which way it "faces" on a plan is
 * decided by hand tremor. On the two real scans this refuses 0 of 292
 * photographs in the kitchen and 7 of 314 in the garage, where somebody was
 * looking down at the slab.
 */
const MIN_HORIZONTAL_RAY = 0.15;

/**
 * ARKit's world onto the plan, dropping the vertical axis.
 *
 * The one line the whole drawing hangs from, and it is worth naming because it
 * answers a question no length or area or closure check can: is the plan a view
 * from above the room, or from underneath the floor? Both are self-consistent.
 * Both close exactly. Only one of them is a plan.
 *
 * ARKit is right-handed with +y up, so looking DOWN the +y axis at the floor,
 * screen-up is **-z**. Taking `y = z` and drawing it upward reflects the room —
 * every wall the right length, every corner in the right place, and the whole
 * thing flipped. Hence the negation, and hence the test beside it that states
 * the physical fact rather than the arithmetic.
 */
export function planFromWorld(
  x: number,
  z: number,
  datum: RoomFrame['datum']
): [number, number] {
  const px = x;
  const py = -z;
  return [px * datum.x + py * datum.y, -px * datum.y + py * datum.x];
}

/* ---------------------------------------------------------------- the work */

/**
 * Turns one captured frame into a `Photo` the room model can reason about.
 *
 * ARKit's camera looks down its own negative Z, and its origin is where the
 * photographer stood. The lens angles come from the intrinsics — `cx / fx`
 * across the image and `cy / fy` up it, as tangents — so there is no lens table
 * and no assumed field of view, and they are read per photo because they change
 * as the camera refocuses.
 *
 * **The image's axes are not the world's.** This is where it went wrong for a
 * long time. ARKit reports the camera in its own landscape frame whatever way
 * the phone is being held, so for somebody scanning a room in portrait — which
 * is everybody — the image's "right" points at the ceiling. Both of Sam's scans
 * say so plainly: the world-y component of the camera's X axis has a median of
 * **0.978** in the kitchen and **0.946** in the garage. Straight up.
 *
 * Sweeping `forward ± tan(cx/fx) × cameraX` therefore swept the *vertical* field
 * of view, and its shadow on the plan was a **4.5 degree** slit where the
 * photograph really covers **62 degrees**. Every answer about which walls a
 * photograph showed came out of that slit.
 *
 * So the wedge is built from the frustum itself: the four corner rays,
 * `forward ± tan(hx)·right ± tan(hy)·up`, projected onto the plan, and the
 * widest wedge that contains all four. That is correct for a phone held any way
 * up and tilted at any angle, because it never assumes which image axis is
 * horizontal — it works out what the pyramid actually covers.
 *
 * A photograph aimed too steeply has no honest answer: point at your feet and
 * the direction you are facing is barely a direction at all. Those are refused
 * rather than guessed at, and `importPhotos` reports them.
 */
export function toPhoto(captured: CapturedPhoto, frame: RoomFrame): Photo {
  const m = captured.cameraPoseARFrame;
  const fx = captured.intrinsics[0];
  const cx = captured.intrinsics[2];
  const fy = captured.intrinsics[4];
  const cy = captured.intrinsics[5];
  if (fx === undefined || cx === undefined || fy === undefined || cy === undefined || fx <= 0 || fy <= 0) {
    throw new CaptureError(
      `Photo "${captured.id}" has no usable camera intrinsics, so there is no way to know how ` +
        `wide a view it took in. It cannot be placed against a wall.`
    );
  }

  // A camera pose and a wall are already in the same space.
  //
  // This used to invert `referenceOriginTransform` first, on the reasoning that
  // RoomPlan surfaces are in the room's frame and ARFrames are in the world's.
  // That reasoning was wrong, and two real scans say so: the importer reads
  // wall and floor transforms as world coordinates, so rotating only the
  // cameras by 86 degrees put the photographer through the wall. Counting how
  // many camera positions land inside the floor polygon settles it —
  //
  //     Gilbert's kitchen   172 of 292 with the transform, 292 of 292 without
  //     Sam's garage        145 of 314 with it,            250 of 314 without
  //
  // — and the 64 left outside the garage are a garage: it has a 15 ft opening
  // across the front and somebody scanning it stands in the doorway.
  //
  // `checkCapture` now counts this on every scan, so if a capture ever does
  // arrive in a different frame, it says so instead of quietly mislocating
  // every photograph in it.
  const position = [at(m, 3, 0), at(m, 3, 1), at(m, 3, 2)];
  const forward = [-at(m, 2, 0), -at(m, 2, 1), -at(m, 2, 2)];
  const right = [at(m, 0, 0), at(m, 0, 1), at(m, 0, 2)];
  const up = [at(m, 1, 0), at(m, 1, 1), at(m, 1, 2)];

  // Y is up, so the plan is x and z. Then the datum rotation the importer
  // chose, so photos and walls share one set of axes.
  const plan = (x: number, z: number) => planFromWorld(x, z, frame.datum);

  const [px, py] = plan(position[0]!, position[2]!);
  const [fxp, fyp] = plan(forward[0]!, forward[2]!);

  // Into the frame the plan is drawn in — see `RoomFrame.origin`. Only the
  // position moves; a direction is unchanged by a translation.
  const atPoint: Point = { x: nm(px) - frame.origin.x, y: nm(py) - frame.origin.y };
  // Too steep to have a bearing at all. Checked before anything is built from
  // it, so a photograph of the floor says it is a photograph of the floor
  // rather than failing later as a vector of zero length.
  const steep = (ray: readonly number[]): boolean => {
    const length = Math.hypot(ray[0]!, ray[1]!, ray[2]!);
    return length === 0 || Math.hypot(ray[0]!, ray[2]!) / length < MIN_HORIZONTAL_RAY;
  };
  const refuseSteep = (): never => {
    throw new CaptureError(
      `Photo "${captured.id}" was taken pointing too steeply up or down to say which walls it ` +
        `shows. It is within ` +
        `${Math.round(Math.asin(MIN_HORIZONTAL_RAY) * (180 / Math.PI))} degrees of vertical, and ` +
        `a direction that steep is not a direction on a plan.`
    );
  };
  if (steep(forward)) refuseSteep();

  const forwardVec = direction(fxp, fyp, 'view direction');

  // The four corners of the frustum, in the world, then on the plan.
  const hx = cx / fx;
  const hy = cy / fy;
  const corners: Vec2[] = [];
  for (const u of [1, -1]) {
    for (const v of [1, -1]) {
      const ray = [0, 1, 2].map((i) => forward[i]! + u * hx * right[i]! + v * hy * up[i]!);
      if (steep(ray)) refuseSteep();
      const [x, y] = plan(ray[0]!, ray[2]!);
      corners.push(direction(x, y, 'frame corner'));
    }
  }

  // The wedge that holds all four. `insideWedge` sweeps counter-clockwise from
  // the right edge to the left edge, so the right edge is the corner every
  // other corner is counter-clockwise of, and the left edge is the one every
  // other corner is clockwise of. Exact integer cross products, no angles.
  const rightEdge = corners.find((a) => corners.every((b) => cross(a, b) >= 0n));
  const leftEdge = corners.find((a) => corners.every((b) => cross(b, a) >= 0n));
  if (!rightEdge || !leftEdge) {
    throw new CaptureError(
      `Photo "${captured.id}" covers half the compass or more once flattened onto the plan, ` +
        `which means it was pointed nearly along the floor or the ceiling. There is no wedge ` +
        `that describes what it shows.`
    );
  }
  if (cross(rightEdge, forwardVec) < 0n || cross(forwardVec, leftEdge) < 0n) {
    throw new CaptureError(
      `Photo "${captured.id}" has a field of view that does not contain the direction it was ` +
        `pointing. Its camera intrinsics and its transform disagree.`
    );
  }

  return {
    id: captured.id,
    takenAt: captured.takenAt,
    trigger: captured.trigger,
    ...(captured.fileName ? { fileName: captured.fileName } : {}),
    upright: uprightTurn(right),
    pose: { at: atPoint, forward: forwardVec, rightEdge, leftEdge },
  };
}

export interface PhotoImport {
  readonly photos: readonly Photo[];
  /** Photos that could not be placed, and why. Never silently dropped. */
  readonly rejected: readonly { readonly id: string; readonly reason: string }[];
}

/**
 * Reads a whole manifest.
 *
 * One unusable photo does not lose the rest — a scan is minutes of somebody's
 * day — but nothing is dropped quietly either: every rejection comes back with
 * the reason, for the same screen that shows what the import decided.
 */
export function importPhotos(manifest: PhotoManifest, frame: RoomFrame): PhotoImport {
  if (manifest.schema !== PHOTO_MANIFEST_SCHEMA) {
    throw new CaptureError(
      `That photo manifest says it is "${manifest.schema}"; this reads ` +
        `"${PHOTO_MANIFEST_SCHEMA}". Rather than guess at what changed, it is being refused.`
    );
  }

  const photos: Photo[] = [];
  const rejected: { id: string; reason: string }[] = [];
  for (const captured of manifest.photos) {
    try {
      photos.push(toPhoto(captured, frame));
    } catch (error) {
      rejected.push({
        id: captured.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { photos, rejected };
}

/**
 * How high above the floor the camera was, for each photo.
 *
 * Not used by any geometry — it is a sanity check with a real answer. On both of
 * Sam's scans every frame lands between roughly 0.8 m and 2.0 m, which is a
 * person holding a phone. A capture where they do not is a capture where the
 * poses and the room are not in the same coordinate system, and that is worth
 * catching before anything is drawn from it.
 */
export function heightsAboveFloor(
  manifest: PhotoManifest,
  floorLevel: Nanometres
): Nanometres[] {
  return manifest.photos.map((captured) => {
    const m = captured.cameraPoseARFrame;
    // Y is up in ARKit and in the room alike, and the plan's origin shift is a
    // move across the floor, so height is the pose's own y and nothing else.
    return nm(at(m, 3, 1)) - floorLevel;
  });
}

/** A person holding a phone, on the evidence of two real scans. */
export const PLAUSIBLE_CAMERA_HEIGHT = {
  low: 600n * NM_PER_METRE / 1000n,
  high: 2200n * NM_PER_METRE / 1000n,
};
