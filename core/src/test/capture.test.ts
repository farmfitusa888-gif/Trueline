import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ImportReport, importRoomPlan } from '../import-roomplan.ts';
import { checkCapture } from '../health.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NM_PER_METRE, parseLength } from '../length.ts';
import { scanned, verified } from '../measurement.ts';
import { type Heading, type Room, type Wall } from '../room.ts';
import { photosOfWall, shows, unphotographedWalls, wallsInFrame } from '../photo.ts';
import {
  type CapturedNorth,
  type CapturedPhoto,
  type PhotoManifest,
  type RoomFrame,
  CaptureError,
  PHOTO_MANIFEST_SCHEMA,
  PLAUSIBLE_CAMERA_HEIGHT,
  heightsAboveFloor,
  importPhotos,
  northOnPlan,
  planFromWorld,
  toPhoto,
} from '../capture.ts';

const T0 = '2026-08-20T17:12:09Z';

function w(id: string, heading: Heading, length: string): Wall {
  return { id, heading, length: scanned(parseLength(length), parseLength(`50mm`), T0, 'roomplan') };
}

/** 6 m x 4 m, corners (0,0) (6,0) (6,4) (0,4). */
const room: Room = {
  id: 'r1',
  name: 'kitchen',
  walls: [
    w('south', 'east', `6000mm`),
    w('east', 'north', `4000mm`),
    w('north', 'west', `6000mm`),
    w('west', 'south', `4000mm`),
  ],
  ceilingHeight: verified(parseLength(`2400mm`), 'sam', T0, 'tape'),
};

/** Metres to the nanometre integers the plan is kept in. */
const nm = (metres: number) => BigInt(Math.round(metres * Number(NM_PER_METRE)));

/** A room whose first corner is already at the plan origin, so nothing shifts. */
const NOWHERE = { x: 0n, y: 0n };

/** A floor at ARKit's own zero, so a height is the pose's y unchanged. */
const FLOOR_AT_ZERO = 0n;

/** No rotation and no reference transform: ARKit's axes are the room's. */
const PLAIN: RoomFrame = { datum: { x: 1, y: 0 }, origin: NOWHERE, floor: FLOOR_AT_ZERO };
const room2frame = PLAIN;

/**
 * A camera standing somewhere, looking along a heading in the plan.
 *
 * ARKit's camera looks down its own negative Z and its positive X is the
 * photographer's right, so a camera pointing along the world's +Z has its
 * columns arranged as below. `turn` rotates it about the world's Y axis, which
 * is how a person turns on the spot.
 */
function camera(
  position: [number, number, number],
  turn: number,
  { fx = 1400, cx = 960 }: { fx?: number; cx?: number } = {}
): CapturedPhoto {
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  // Columns: right, up, back (the camera looks down -Z).
  return {
    id: 'p1',
    takenAt: T0,
    trigger: 'automatic',
    fileName: 'p1.heic',
    cameraPoseARFrame: [
      c, 0, -s, 0,
      0, 1, 0, 0,
      s, 0, c, 0,
      position[0], position[1], position[2], 1,
    ],
    intrinsics: [fx, 0, cx, 0, fx, 720, 0, 0, 1],
    imageWidth: 1920,
    imageHeight: 1440,
  };
}

/* ------------------------------------------------------------- placement */

test('a camera lands where it was standing, to the nanometre', () => {
  const photo = toPhoto(camera([1.5, 1.6, 2.0], 0), PLAIN);
  // The plan looks down at the floor, so the scan's +z runs down the page and
  // a camera 2 m along it is 2 m down. See the handedness test below.
  assert.deepEqual(photo.pose.at, { x: 1500n * NM_PER_METRE / 1000n, y: -2n * NM_PER_METRE });
  assert.equal(photo.id, 'p1');
  assert.equal(photo.trigger, 'automatic');
});

test('the frame edges are oriented so the camera is always inside its own view', () => {
  // Every quarter turn, and a few in between: forward must be in the wedge.
  for (let i = 0; i < 16; i += 1) {
    const photo = toPhoto(camera([3, 1.6, 2], (i * Math.PI) / 8), PLAIN);
    const { forward, leftEdge, rightEdge } = photo.pose;
    const rightToForward = rightEdge.x * forward.y - rightEdge.y * forward.x;
    const leftToForward = leftEdge.x * forward.y - leftEdge.y * forward.x;
    assert.ok(rightToForward >= 0n, `turn ${i}: forward is not left of the right edge`);
    assert.ok(leftToForward <= 0n, `turn ${i}: forward is not right of the left edge`);
  }
});

test('a camera in the middle of the room sees the wall it is pointing at', () => {
  // ARKit's camera looks down its own negative Z, and the plan is a view from
  // above, so the scan's -z runs UP the page: an unturned camera faces north.
  // The camera stands at the scan's z = -2, which is 2 m up the plan and inside
  // this room.
  const photo = toPhoto(camera([3, 1.6, -2], 0), PLAIN);
  assert.deepEqual(photo.pose.forward, { x: 0n, y: 1_000_000_000n }, 'facing north');
  assert.equal(shows(photo, room, 'north'), true);
  assert.equal(shows(photo, room, 'south'), false, 'the wall behind is not in shot');

  // Turned around, it sees the other one, from the same spot.
  const around = toPhoto(camera([3, 1.6, -2], Math.PI), PLAIN);
  assert.equal(around.pose.at.y, 2n * NM_PER_METRE, 'it did not move, only turned');
  assert.equal(shows(around, room, 'south'), true);
  assert.equal(shows(around, room, 'north'), false);
});

test('a wider lens takes in more of the wall it is pointing at', () => {
  // cx/fx is the tangent of the half angle, read per photo because it changes as
  // the camera refocuses. From the middle of a room the side walls stay edge-on
  // however wide the lens is, so what grows is how much of the facing wall fits.
  const seen = ([fx, cx]: [number, number]) =>
    wallsInFrame(toPhoto(camera([3, 1.6, 2], 0, { fx, cx }), room2frame), room)
      .find((x) => x.wallId === 'south')!.fractionPerMille;

  assert.equal(seen([4000, 960]), 159n, '13.5 degrees either side');
  assert.equal(seen([1400, 960]), 457n, '34.4 degrees');
  assert.equal(seen([700, 960]), 914n, '53.9 degrees');
  assert.equal(seen([400, 960]), 1000n, 'the whole wall');
});

/* ------------------------------------------------------------- the frames */

test('the room datum is applied, so photos and walls share one set of axes', () => {
  // A datum of (0, -1) is what the importer picks when the longest wall runs
  // along the scan's -z. The plan drop makes (x, z) into (x, -z), and the datum
  // then turns that: (2, 3) becomes (2, -3) becomes (3, 2).
  const turned: RoomFrame = { datum: { x: 0, y: -1 }, origin: NOWHERE, floor: FLOOR_AT_ZERO };
  const photo = toPhoto(camera([2, 1.6, 3], 0), turned);
  assert.deepEqual(photo.pose.at, { x: 3n * NM_PER_METRE, y: 2n * NM_PER_METRE });
});

test('a camera pose and a wall are read in the same space', () => {
  // This used to invert `referenceOriginTransform` before placing a pose, on
  // the reasoning that RoomPlan surfaces are in the room's frame while ARFrames
  // are in the world's. The importer reads surface transforms as world
  // coordinates, so that rotated the photographer and not the room, and put
  // them through the wall.
  //
  // Two real scans measured it. Counting camera positions that land inside the
  // floor polygon: Gilbert's kitchen 172 of 292 with the transform applied and
  // 292 of 292 without it; Sam's garage 145 of 314 with and 250 of 314 without,
  // and that garage has a 15 ft opening somebody stands in to scan it.
  //
  // So a pose gets the datum rotation and the origin shift, and nothing else.
  const photo = toPhoto(camera([2, 1.6, 3], 0), PLAIN);
  assert.deepEqual(photo.pose.at, { x: 2n * NM_PER_METRE, y: -3n * NM_PER_METRE });
});

/* ------------------------------------------------------------------ heights */

test('camera height above the floor is reported, as the sanity check it is', () => {
  const manifest: PhotoManifest = {
    schema: PHOTO_MANIFEST_SCHEMA,
    capturedAt: T0,
    device: 'iPhone14,3',
    photos: [camera([3, 1.55, 2], 0), { ...camera([3, 1.7, 2], 0), id: 'p2' }],
  };
  const heights = heightsAboveFloor(manifest, 0n);
  assert.deepEqual(heights, [1550n * NM_PER_METRE / 1000n, 1700n * NM_PER_METRE / 1000n]);
  assert.ok(heights.every((h) => h >= PLAUSIBLE_CAMERA_HEIGHT.low && h <= PLAUSIBLE_CAMERA_HEIGHT.high));

  // A pose in a different coordinate system to the room shows up here and
  // nowhere else — which is the point of measuring it.
  const wrong = heightsAboveFloor({ ...manifest, photos: [camera([3, 40, 2], 0)] }, 0n);
  assert.ok(wrong[0]! > PLAUSIBLE_CAMERA_HEIGHT.high);
});

/* ---------------------------------------------------------------- manifests */

test('a whole manifest comes through, and every wall knows its photos', () => {
  const manifest: PhotoManifest = {
    schema: PHOTO_MANIFEST_SCHEMA,
    capturedAt: T0,
    device: 'iPhone14,3',
    photos: [
      { ...camera([3, 1.6, 2], 0), id: 'north-shot' },
      { ...camera([3, 1.6, 2], Math.PI), id: 'south-shot' },
      { ...camera([3, 1.6, 2], Math.PI / 2), id: 'side-shot-a', trigger: 'manual' as const },
      { ...camera([3, 1.6, 2], -Math.PI / 2), id: 'side-shot-b' },
    ],
  };

  const { photos, rejected } = importPhotos(manifest, PLAIN);
  assert.equal(photos.length, 4);
  assert.deepEqual(rejected, []);
  assert.equal(photos.find((p) => p.id === 'side-shot-a')!.trigger, 'manual');
  assert.deepEqual(unphotographedWalls(photos, room), [], 'four quarter turns cover the room');
});

test('one unusable photo does not lose the rest, and is not dropped quietly', () => {
  const manifest: PhotoManifest = {
    schema: PHOTO_MANIFEST_SCHEMA,
    capturedAt: T0,
    device: 'iPhone14,3',
    photos: [
      { ...camera([3, 1.6, 2], 0), id: 'good' },
      { ...camera([3, 1.6, 2], 0), id: 'no-intrinsics', intrinsics: [] },
      { ...camera([3, 1.6, 2], 0), id: 'short-transform', cameraPoseARFrame: [1, 0, 0] },
    ],
  };

  const { photos, rejected } = importPhotos(manifest, PLAIN);
  assert.deepEqual(photos.map((p) => p.id), ['good']);
  assert.deepEqual(rejected.map((r) => r.id), ['no-intrinsics', 'short-transform']);
  assert.match(rejected[0]!.reason, /no usable camera intrinsics/);
  assert.match(rejected[1]!.reason, /it needs 16/);
});

test('a manifest from a different version is refused rather than guessed at', () => {
  assert.throws(
    () =>
      importPhotos(
        { schema: 'trueline.photos.v2', capturedAt: T0, device: 'x', photos: [] },
        PLAIN
      ),
    (e: unknown) => e instanceof CaptureError && /Rather than guess at what changed/.test((e as Error).message)
  );
});

test('a pose that is not a finite number is refused, never rounded to something', () => {
  assert.throws(
    () => toPhoto({ ...camera([Number.NaN, 1.6, 2], 0) }, PLAIN),
    CaptureError
  );
});

/* ------------------------------------------------------- a wall in the middle */

test('a wall wider than the frame is still seen, corners and all outside it', () => {
  // Standing 2 m off a 6 m wall with a 34 degree half-angle: neither end of the
  // wall is in shot, only the middle. Both clipped points land exactly on a
  // frustum edge, and each is rounded to the nearest nanometre — which used to
  // put one of them a fraction of a nanometre outside its own edge and throw the
  // entire wall away. Every direction has to behave the same way.
  const facings: [string, number, string][] = [
    ['north', 0, 'north'],
    ['south', Math.PI, 'south'],
    ['west', Math.PI / 2, 'west'],
    ['east', -Math.PI / 2, 'east'],
  ];
  for (const [name, turn, wallId] of facings) {
    const photo = toPhoto(camera([3, 1.6, -2], turn), PLAIN);
    const inFrame = wallsInFrame(photo, room).find((x) => x.wallId === wallId);
    assert.ok(inFrame, `facing ${name}, the wall in front of the camera was not found`);
    assert.ok(inFrame.visibleLength > 0n, `facing ${name}, nothing of it was visible`);
  }

  // The two long walls are 2 m away and 6 m across, so neither end fits in the
  // frame and the middle is what comes back. That is the case that used to fail.
  for (const [turn, wallId] of [[0, 'north'], [Math.PI, 'south']] as [number, string][]) {
    const inFrame = wallsInFrame(toPhoto(camera([3, 1.6, -2], turn), PLAIN), room).find(
      (x) => x.wallId === wallId
    )!;
    assert.ok(inFrame.fractionPerMille > 0n && inFrame.fractionPerMille < 1000n, wallId);
  }
});

test('what the camera sees is the same whichever way the room was walked', () => {
  // The same box with its walls listed the other way round. A photo of the
  // middle of a wall must find it either way: the clipping used to depend on
  // which direction the wall ran in.
  const reversed: Room = {
    ...room,
    walls: [
      w('west', 'north', `4000mm`),
      w('north', 'east', `6000mm`),
      w('east', 'south', `4000mm`),
      w('south', 'west', `6000mm`),
    ],
  };
  const photo = toPhoto(camera([3, 1.6, 2], 0), PLAIN);
  const forwards = wallsInFrame(photo, room).find((x) => x.wallId === 'south')!;
  const backwards = wallsInFrame(photo, reversed).find((x) => x.wallId === 'south')!;
  assert.equal(
    forwards.visibleLength,
    backwards.visibleLength,
    'the same photo of the same wall sees the same amount of it'
  );
  assert.ok(forwards.visibleLength > 0n);
});

test('a photo is placed against the room, not against where the scan began', () => {
  // The same camera, in the same place in the same kitchen, from two captures
  // that started in different corners of it. RoomPlan counts metres from
  // wherever somebody pressed start, so the numbers in the two files differ by
  // however far apart those two corners are. The plan must not.
  const startedAtTheDoor = toPhoto(camera([2, 1.5, 3], 0), PLAIN);
  const startedAtTheSink = toPhoto(camera([2 + 9.4, 1.5, 3 - 6.1], 0), {
    ...PLAIN,
    // The scan started 9.4 m along x and 6.1 m back along z, and the plan drop
    // turns that -6.1 into +6.1 up the page.
    origin: { x: nm(9.4), y: nm(6.1) },
  });

  assert.equal(startedAtTheSink.pose.at.x, startedAtTheDoor.pose.at.x);
  assert.equal(startedAtTheSink.pose.at.y, startedAtTheDoor.pose.at.y);
  // A translation turns nothing, so the view direction is untouched by it.
  assert.deepEqual(startedAtTheSink.pose.forward, startedAtTheDoor.pose.forward);
});

/* --------------------------------------------------- how the phone is held */

/**
 * The same camera, held in portrait.
 *
 * ARKit reports the camera in its own landscape frame however the phone is
 * being held, so holding it upright rolls the image axes 90 degrees about the
 * view direction: the image's "right" now points at the ceiling and the image's
 * "up" points along the wall. Both of Sam's scans are like this — the world-y
 * component of the camera's X axis has a median of 0.978 in the kitchen.
 */
function portrait(position: [number, number, number]): CapturedPhoto {
  return {
    ...camera(position, 0),
    // Columns: right = world up, up = world -x, back = world +z.
    cameraPoseARFrame: [
      0, 1, 0, 0,
      -1, 0, 0, 0,
      0, 0, 1, 0,
      position[0], position[1], position[2], 1,
    ],
  };
}

/**
 * The same viewpoint with the phone rolled about the direction it is pointing.
 *
 * `right` is the camera's own X axis — the image's left-to-right direction — in
 * the world. Everything else is held: the camera stands in the same place
 * looking the same way, so which walls it shows cannot change and only which
 * way up the picture is can.
 */
function rolled(right: [number, number, number]): CapturedPhoto {
  // Looking along world -z, so the roll axis is z and `up` is right x forward.
  const forward: [number, number, number] = [0, 0, -1];
  const up: [number, number, number] = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];
  return {
    ...camera([2, 1.6, 2], 0),
    cameraPoseARFrame: [
      right[0], right[1], right[2], 0,
      up[0], up[1], up[2], 0,
      -forward[0], -forward[1], -forward[2], 0,
      2, 1.6, 2, 1,
    ],
  };
}

/** The angle between the two edges of a photo's wedge, in degrees. */
function spread(photo: ReturnType<typeof toPhoto>): number {
  const { rightEdge: r, leftEdge: l } = photo.pose;
  const dot = Number(r.x * l.x + r.y * l.y);
  const det = Number(r.x * l.y - r.y * l.x);
  return (Math.atan2(det, dot) * 180) / Math.PI;
}

test('a photo taken in portrait covers the room, not a slit through it', () => {
  // The bug: the wedge was `forward ± tan(cx/fx) × cameraX`, and cameraX points
  // at the ceiling when the phone is upright. Its shadow on the plan was 4.5
  // degrees wide on real scans, where the photograph covers 62. Every answer
  // about which walls a photograph showed came out of that slit.
  const held = toPhoto(portrait([3, 1.6, 2]), PLAIN);
  assert.ok(
    spread(held) > 40,
    `a portrait photo should cover tens of degrees, not ${spread(held).toFixed(1)}`
  );

  // And it is the same pyramid either way up, so a level landscape shot of the
  // same scene covers a comparable amount of the room.
  const flat = toPhoto(camera([3, 1.6, 2], 0), PLAIN);
  assert.ok(spread(flat) > 40);
});

test('a photo of the floor is refused rather than pointed somewhere', () => {
  // Straight down: every corner of the frame is within a few degrees of
  // vertical, and which way it "faces" on a plan is hand tremor. 20 of the
  // garage's 314 frames are like this — somebody looking at the slab.
  const down: CapturedPhoto = {
    ...camera([3, 1.6, 2], 0),
    // Columns: right = world +x, up = world +z, back = world +y (looking down).
    cameraPoseARFrame: [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 3, 1.6, 2, 1],
  };
  assert.throws(() => toPhoto(down, PLAIN), /too steeply|half the compass/);
});

/* -------------------------------------------------------------- the compass */

/**
 * A heading reading taken beside the camera pose from the same instant.
 *
 * The turn is derived from the bearing rather than passed in beside it, and
 * that is deliberate: `camera(_, turn)` turns the phone anticlockwise seen from
 * above, while a compass bearing counts clockwise from north. Handing both in
 * separately let a test pair a left turn with a right bearing, and the mirror
 * cancelled out — which is how the whole plan stayed reflected with a green
 * suite. One argument, one direction, no way to pair them wrong.
 */
function heading(bearing: number, accuracy = 8): CapturedNorth {
  const turn = (-bearing * Math.PI) / 180;
  return {
    trueHeading: bearing,
    accuracy,
    atPose: camera([0, 1.6, 0], turn).cameraPoseARFrame,
  };
}

test('a phone facing north puts north up the plan', () => {
  // camera(_, 0) looks along the world's -z, which the plan drop puts up the
  // page. If the compass says that direction is due north, north on the plan is
  // straight up — which is what a person expects a north arrow to do.
  const north = northOnPlan(heading(0), PLAIN.datum);
  assert.ok(north);
  assert.ok(Math.abs(north.x - 0) < 1e-6, `x was ${north.x}`);
  assert.ok(Math.abs(north.y - 1) < 1e-6, `y was ${north.y}`);
  assert.equal(north.accuracy, 8);
});

test('a quarter turn of the phone turns the arrow a quarter turn', () => {
  const facingNorth = northOnPlan(heading(0), PLAIN.datum)!;
  // Same room, but the reading was taken while facing east. North on the plan
  // has to come out in the same place either way — that is the whole point.
  const facingEast = northOnPlan(heading(90), PLAIN.datum)!;
  assert.ok(Math.abs(facingEast.x - facingNorth.x) < 1e-6, `${facingEast.x} vs ${facingNorth.x}`);
  assert.ok(Math.abs(facingEast.y - facingNorth.y) < 1e-6, `${facingEast.y} vs ${facingNorth.y}`);
});

test('a heading the phone does not trust draws no arrow at all', () => {
  // Core Location reports a negative accuracy for a reading it will not stand
  // behind. An arrow drawn off that is worse than no arrow.
  assert.equal(northOnPlan({ ...heading(0), accuracy: -1 }, PLAIN.datum), null);
});

test('a heading taken pointing at the floor draws no arrow', () => {
  const down = { ...heading(0), atPose: [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1.6, 0, 1] };
  assert.equal(northOnPlan(down, PLAIN.datum), null);
});

/* ------------------------------------------------------- which way round */

test('a photographer holds their right hand clockwise from where they look', () => {
  // This is a fact about people seen from above, not about code. Look down at
  // somebody walking toward the bottom of a map: their right hand points to the
  // left of the page. Turn to face the right of the page and their right hand
  // points down it. Right is always CLOCKWISE of forward in a plan view.
  //
  // The plan is built by dropping the vertical axis: (x, y, z) becomes (x, z).
  // Whether that is a view from above or a view from underneath the floor is
  // exactly this question, and getting it wrong mirrors every drawing the
  // product makes while leaving every length, every area and every closure
  // check perfectly intact — which is why nothing caught it for so long.
  //
  // `camera(_, 0)` looks along the world's -z, and a right-handed camera basis
  // puts its +x on the photographer's right.
  //
  // Asked of the mapping itself, not of `toPhoto`'s wedge: that labels whichever
  // edge is clockwise of forward as `rightEdge`, so asking it this question only
  // gets its own convention back.
  const [fx, fy] = planFromWorld(0, -1, PLAIN.datum); // looking along world -z
  const [rx, ry] = planFromWorld(1, 0, PLAIN.datum); // right hand along world +x
  const clockwise = fx * ry - fy * rx;
  assert.ok(
    clockwise < 0,
    `the photographer's right hand came out anticlockwise of their view, which means the plan ` +
      `is drawn from underneath the floor: cross was ${clockwise}`
  );
});

test('one room, three readings, one north', () => {
  // The reading can be taken at any moment of the walk, facing anywhere. If the
  // arrow moves when the photographer turns, the pairing between the heading
  // and the pose is wrong — and that is exactly what a mirrored plan does,
  // silently, by putting the arrow out by twice the bearing.
  const norths = [0, 90, 210].map((bearing) => northOnPlan(heading(bearing), PLAIN.datum)!);
  for (const north of norths) {
    assert.ok(Math.abs(north.x - norths[0]!.x) < 1e-6, `x drifted to ${north.x}`);
    assert.ok(Math.abs(north.y - norths[0]!.y) < 1e-6, `y drifted to ${north.y}`);
  }
});

/* --------------------------------------------- which way up the picture is */

test('a phone held upright produces a picture that has to be turned a quarter clockwise', () => {
  // ARKit hands every frame back in the device's landscape frame however the
  // phone is held, and writes the JPEG that way with no orientation tag. Across
  // all 55 photographs of the real garage the camera's X axis sits at a median
  // of -0.978 against world up: the image's right-hand edge pointing at the
  // floor. That is a phone held the ordinary way, and the picture is on its side.
  const held = toPhoto(rolled([0, -0.978, 0.208]), PLAIN);
  assert.equal(held.upright, 90);
});

test('a phone genuinely on its side needs no turn', () => {
  const flat = toPhoto(rolled([1, 0.006, 0]), PLAIN);
  assert.equal(flat.upright, 0);
});

test('a phone held upside down turns the other way', () => {
  const other = toPhoto(rolled([0, 0.98, 0.2]), PLAIN);
  assert.equal(other.upright, 270);
});

test('which way up is a display decision and moves nothing on the plan', () => {
  // The same viewpoint, the phone rolled. Which walls it shows cannot change,
  // because rolling a camera about the direction it points changes nothing about
  // where it is or what is in front of it.
  const a = toPhoto(rolled([0, -0.978, 0.208]), PLAIN);
  const b = toPhoto(rolled([0, 0.978, -0.208]), PLAIN);
  assert.notEqual(a.upright, b.upright);
  assert.deepEqual(a.pose.at, b.pose.at);
  assert.deepEqual(a.pose.forward, b.pose.forward);
});

/* ------------------------------------------- the alarm, actually connected */

/**
 * The frame alarm, from a real scan to a finding.
 *
 * `heightsAboveFloor` and the finding it feeds both existed, both were tested,
 * and **nothing ever called the first one** -- so the alarm that catches the
 * worst silent failure in this product could not fire. Found by
 * `core/tools/check-reachable.py`, which lists every function nothing outside a
 * test calls.
 *
 * This is the round trip: a real scan in, the floor read off it, a camera at a
 * believable height, and no alarm; the same camera two metres out, and an
 * alarm. Both halves matter. An alarm that never fires is the bug that was
 * here; an alarm that fires on every scan teaches people to close alarms,
 * which is the same bug wearing a hat.
 */
test('a believable camera height raises nothing, and an unbelievable one does', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const scan = JSON.parse(
    readFileSync(join(here, '..', '..', '..', 'web', 'audit', 'garage.json'), 'utf8')
  );
  const { room, report, frame } = importRoomPlan(scan, { at: T0, name: 'garage' });

  // The garage's floor sits 1.2 m BELOW the origin of its own scan session,
  // which is the whole reason the floor has to be carried rather than assumed
  // to be zero: a phone at chest height reads as y = 0.2 in this capture.
  const floor = Number(frame.floor) / 1e9;
  assert.ok(floor < 0, `expected a floor below the session origin, got ${floor}`);

  // The same `camera` fixture the rest of this file uses, so a change to what
  // a captured photo looks like reaches this test too rather than leaving a
  // hand-rolled copy quietly out of date.
  const at = (metresAboveFloor: number[]): PhotoManifest => ({
    schema: PHOTO_MANIFEST_SCHEMA,
    capturedAt: T0,
    device: 'test',
    photos: metresAboveFloor.map((h, i) => ({
      ...camera([3, floor + h, 2], 0),
      id: `p${i}`,
    })),
  });

  const alarms = (manifest: PhotoManifest) =>
    checkCapture({
      room,
      report,
      cameraHeights: heightsAboveFloor(manifest, frame.floor),
    }).filter((f) => /same room as the walls/.test(f.what));

  assert.equal(alarms(at([1.3, 1.4, 1.55])).length, 0, 'a person holding a phone is not an alarm');
  assert.equal(alarms(at([3.3, 3.4, 3.55])).length, 1, 'two metres out has to be one');
});

/* ----------------------- the room from one walk, the photographs from the next */

/**
 * What Sam's phone actually handed back, written down as data.
 *
 * > "WHEN I HIT DONE, IT BUILDS IT, BUT THERES NO PICS THERE AND THE BLUEPRINT
 * >  IS JUST A SQUARE AND THE 3D IS HALF A BOX"
 *
 * Those are one fault and not two, and these tests are here to say so. The
 * scanner saved a `CapturedRoom` that had been built from a session stopped
 * minutes earlier — a few seconds of looking around before the real walk —
 * while the photographs came from the walk that followed it. Two ARKit
 * sessions, two world origins, metres apart.
 *
 * Nothing about the photographs is wrong. Every pose is finite, every set of
 * intrinsics is usable, not one of them is refused. They are simply somewhere
 * else — and what that looks like on the phone is a photo strip with nothing
 * in it under every single wall, which reads exactly like a walk where nobody
 * took a picture.
 *
 * The fix is on the phone: `ScanSession.isLive(_:)` refuses a room built from a
 * session that is no longer the live one, and `core/tools/check-scan.py` refuses
 * a callback that stores one without asking. These are here so that if it ever
 * comes back, it comes back as a red test rather than as a contractor standing
 * in somebody's kitchen.
 */

const REPORT: ImportReport = {
  sourceVersion: 2,
  walls: room.walls.map((wall) => wall.id),
  openSpans: [],
  dropped: [],
  snapped: [],
  diagonals: [],
  closureBeforeSolving: { x: 0n, y: 0n },
  openings: [],
  recoveredSills: [],
  sourceIds: [],
  notes: [],
};

/**
 * One walk of the kitchen: four quarter turns from the middle of the floor.
 *
 * `startedAt` is where the ARKit session had its origin, in metres. Zero is the
 * walk that produced this room. Anything else is a walk that produced a
 * different one — the photographs are identical in every other respect, which
 * is the whole point.
 */
function walk(startedAt: [number, number, number]): PhotoManifest {
  const [ox, oy, oz] = startedAt;
  const turns = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  // World z is negated onto the plan, so standing at plan (3, 2) -- the middle
  // of a 6 by 4 kitchen -- is world z of -2. Getting that backwards puts the
  // photographer two metres outside their own room, which is the very thing
  // these tests are here to tell apart.
  return {
    schema: PHOTO_MANIFEST_SCHEMA,
    capturedAt: T0,
    device: 'iPhone14,3',
    photos: turns.map((turn, i) => ({
      ...camera([3 + ox, 1.6 + oy, -2 + oz], turn),
      id: `shot-${i}`,
    })),
  };
}

test('photographs from a different walk than the room show nothing on any wall', () => {
  const own = importPhotos(walk([0, 0, 0]), PLAIN);
  assert.deepEqual(own.rejected, []);
  assert.deepEqual(
    unphotographedWalls(own.photos, room),
    [],
    'four quarter turns from the middle of the room cover all four walls'
  );

  // The same four photographs, from a session that started thirty metres away.
  const elsewhere = importPhotos(walk([30, 0, 30]), PLAIN);
  assert.deepEqual(elsewhere.rejected, [], 'not one of them is malformed, and that is the trouble');
  assert.equal(elsewhere.photos.length, 4);

  assert.deepEqual(
    [...unphotographedWalls(elsewhere.photos, room)].sort(),
    room.walls.map((wall) => wall.id).sort(),
    'not one wall has a photograph against it'
  );
  for (const wall of room.walls) {
    assert.deepEqual(
      photosOfWall(elsewhere.photos, room, wall.id),
      [],
      `the strip under ${wall.id} is empty, which on the phone reads as "theres no pics there"`
    );
  }
});

test('a capture whose photographs are from another walk is caught, not drawn', () => {
  const elsewhere = importPhotos(walk([30, 0, 30]), PLAIN);

  const quiet = checkCapture({ room, report: REPORT, photos: importPhotos(walk([0, 0, 0]), PLAIN).photos })
    .filter((f) => f.what.includes('standing outside this room'));
  assert.deepEqual(quiet, [], 'the walk that made this room says nothing');

  const findings = checkCapture({ room, report: REPORT, photos: elsewhere.photos });
  const caught = findings.filter((f) => f.what.includes('standing outside this room'));
  assert.equal(caught.length, 1, 'and the walk that did not has to be a finding');
  assert.equal(caught[0]!.severity, 'stop', 'nothing may be drawn from a capture in two frames');
  assert.match(caught[0]!.detail, /4 of 4 photographs/);
});

test('the floor of the wrong walk puts every photograph at an impossible height', () => {
  // The other half of the same fault, and the one that does not need the plan
  // at all. A room built from a session that started on a different storey
  // carries that session's floor, so subtracting it from this session's poses
  // gives heights nobody has ever held a phone at.
  const manifest = walk([0, 0, 0]);
  const own = heightsAboveFloor(manifest, FLOOR_AT_ZERO);
  assert.ok(
    own.every((h) => h >= PLAUSIBLE_CAMERA_HEIGHT.low && h <= PLAUSIBLE_CAMERA_HEIGHT.high),
    'a phone at 1.6 m is a person holding a phone'
  );

  // The same photographs against a floor read off a room from another walk,
  // three metres lower.
  const foreign = heightsAboveFloor(manifest, nm(-3));
  assert.ok(
    foreign.every((h) => h > PLAUSIBLE_CAMERA_HEIGHT.high),
    'and 4.6 m is not'
  );

  const findings = checkCapture({ room, report: REPORT, cameraHeights: foreign })
    .filter((f) => f.what.includes('same room as the walls'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.severity, 'stop');
});

/* ------------------------------------------ what a half-written capture is */

/**
 * The law this file exists to keep: **a photograph is placed or it is
 * reported, and it is never neither.**
 *
 * A scan is minutes of somebody's day and a folder of a few hundred pictures.
 * One of them arriving unusable is ordinary — a frame taken while the phone was
 * pointed at the floor, a record written as the app was being killed. Losing it
 * without saying so is not, and it is the failure that hides: the manifest says
 * ninety, the screen shows eighty-six, and nothing anywhere says which four
 * went or why.
 *
 * So this counts them. Every id in the manifest comes out exactly once, on one
 * side or the other, whatever shape the record was in.
 */
test('every photograph in a manifest is either placed or reported, never lost', () => {
  const half: PhotoManifest = {
    schema: PHOTO_MANIFEST_SCHEMA,
    capturedAt: T0,
    device: 'iPhone14,3',
    photos: [
      { ...camera([3, 1.6, 2], 0), id: 'whole' },
      // A transform cut off part-way, which is what a record written while the
      // app was being torn down looks like.
      { ...camera([3, 1.6, 2], 0), id: 'cut-short', cameraPoseARFrame: [1, 0, 0, 0, 0, 1] },
      { ...camera([3, 1.6, 2], 0), id: 'no-lens', intrinsics: [] },
      // Finite, complete, and pointed straight down at the slab.
      {
        ...camera([3, 1.6, 2], 0),
        id: 'at-the-floor',
        cameraPoseARFrame: [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 3, 1.6, 2, 1],
      },
      { ...camera([3, 1.6, 2], Math.PI), id: 'whole-too' },
    ],
  };

  const { photos, rejected } = importPhotos(half, PLAIN);

  const accounted = [...photos.map((p) => p.id), ...rejected.map((r) => r.id)].sort();
  assert.deepEqual(
    accounted,
    half.photos.map((p) => p.id).sort(),
    'every id in the manifest comes out on one side or the other'
  );
  assert.equal(
    photos.length + rejected.length,
    half.photos.length,
    'and exactly once — nothing is counted twice and nothing is dropped'
  );

  assert.deepEqual(photos.map((p) => p.id), ['whole', 'whole-too']);
  // Each refusal says which photograph and why, in words, because that list is
  // what the correction screen shows somebody who is asking where their
  // pictures went.
  for (const one of rejected) {
    assert.ok(one.reason.length > 20, `"${one.id}" was refused without a reason`);
    // Named in the sentence, not only in the record beside it. `checkCapture`
    // puts `rejectedPhotos[0].reason` on the screen and nothing else, so a
    // reason that does not say which photograph it is about leaves somebody
    // reading "could not be placed" with no way to find out which one.
    assert.match(one.reason, new RegExp(one.id), 'a reason has to name its own photograph');
  }
  assert.deepEqual(rejected.map((r) => r.id).sort(), ['at-the-floor', 'cut-short', 'no-lens']);
});
