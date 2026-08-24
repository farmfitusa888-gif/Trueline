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

export interface PhotoManifest {
  readonly schema: string;
  readonly capturedAt: string;
  readonly device: string;
  readonly photos: readonly CapturedPhoto[];
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

/* ---------------------------------------------------------------- the work */

/**
 * Turns one captured frame into a `Photo` the room model can reason about.
 *
 * Three things come out of the camera transform. ARKit's camera looks down its
 * own **negative Z**, its **positive X** is the photographer's right, and its
 * origin is where they were standing. The horizontal half-angle of the lens is
 * `cx / fx` as a tangent, straight out of the intrinsics — no lens table, no
 * assumed field of view, and it changes shot to shot as the camera refocuses,
 * which is why it is read per photo rather than once.
 *
 * The two edges of the frame are then `forward ± tan(half) x right`. Which of
 * those is `leftEdge` is decided by **testing**, not by reasoning about
 * handedness: the plan flips one axis relative to ARKit, and getting that sign
 * wrong once already cost a day. Whichever assignment puts the camera's own
 * forward direction inside its own wedge is the correct one, and that is
 * checkable in two cross products.
 */
export function toPhoto(captured: CapturedPhoto, frame: RoomFrame): Photo {
  const m = captured.cameraPoseARFrame;
  const fx = captured.intrinsics[0];
  const cx = captured.intrinsics[2];
  if (fx === undefined || cx === undefined || fx <= 0) {
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

  // Y is up, so the plan is x and z. Then the datum rotation the importer
  // chose, so photos and walls share one set of axes.
  const d = frame.datum;
  const plan = (x: number, z: number): [number, number] => [x * d.x + z * d.y, -x * d.y + z * d.x];

  const [px, py] = plan(position[0]!, position[2]!);
  const [fxp, fyp] = plan(forward[0]!, forward[2]!);
  const [rxp, ryp] = plan(right[0]!, right[2]!);

  // Into the frame the plan is drawn in — see `RoomFrame.origin`. Only the
  // position moves; a direction is unchanged by a translation.
  const atPoint: Point = { x: nm(px) - frame.origin.x, y: nm(py) - frame.origin.y };
  const forwardVec = direction(fxp, fyp, 'view direction');

  const tanHalf = cx / fx;
  const edgeA = direction(fxp + tanHalf * rxp, fyp + tanHalf * ryp, 'frame edge');
  const edgeB = direction(fxp - tanHalf * rxp, fyp - tanHalf * ryp, 'frame edge');

  // `insideWedge` sweeps counter-clockwise from the right edge to the left edge.
  // The camera's own forward is always inside its own frame, so whichever
  // assignment satisfies that is the one.
  const aIsRight = cross(edgeA, forwardVec) >= 0n && cross(edgeB, forwardVec) <= 0n;
  const bIsRight = cross(edgeB, forwardVec) >= 0n && cross(edgeA, forwardVec) <= 0n;
  if (aIsRight === bIsRight) {
    throw new CaptureError(
      `Photo "${captured.id}" has a field of view that does not contain the direction it was ` +
        `pointing. Its camera intrinsics and its transform disagree.`
    );
  }

  return {
    id: captured.id,
    takenAt: captured.takenAt,
    trigger: captured.trigger,
    pose: {
      at: atPoint,
      forward: forwardVec,
      rightEdge: aIsRight ? edgeA : edgeB,
      leftEdge: aIsRight ? edgeB : edgeA,
    },
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
