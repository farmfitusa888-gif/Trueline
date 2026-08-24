import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NM_PER_METRE, parseLength } from '../length.ts';
import { scanned, verified } from '../measurement.ts';
import { type Heading, type Room, type Wall } from '../room.ts';
import { shows, unphotographedWalls, wallsInFrame } from '../photo.ts';
import {
  type CapturedPhoto,
  type PhotoManifest,
  type RoomFrame,
  CaptureError,
  PHOTO_MANIFEST_SCHEMA,
  PLAUSIBLE_CAMERA_HEIGHT,
  heightsAboveFloor,
  importPhotos,
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

/** No rotation and no reference transform: ARKit's axes are the room's. */
const PLAIN: RoomFrame = { datum: { x: 1, y: 0 }, origin: NOWHERE };
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
  assert.deepEqual(photo.pose.at, { x: 1500n * NM_PER_METRE / 1000n, y: 2n * NM_PER_METRE });
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
  // ARKit's camera looks down its own negative Z, so an untur​ned camera faces
  // the scan's -z, which is south once it is in the plan.
  const photo = toPhoto(camera([3, 1.6, 2], 0), PLAIN);
  assert.deepEqual(photo.pose.forward, { x: 0n, y: -1_000_000_000n }, 'facing south');
  assert.equal(shows(photo, room, 'south'), true);
  assert.equal(shows(photo, room, 'north'), false, 'the wall behind is not in shot');

  // Turned around, it sees the other one, from the same spot.
  const around = toPhoto(camera([3, 1.6, 2], Math.PI), PLAIN);
  assert.equal(around.pose.at.y, 2n * NM_PER_METRE, 'it did not move, only turned');
  assert.equal(shows(around, room, 'north'), true);
  assert.equal(shows(around, room, 'south'), false);
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
  // along the scan's -z. It maps (x, z) to (-z, x).
  const turned: RoomFrame = { datum: { x: 0, y: -1 }, origin: NOWHERE };
  const photo = toPhoto(camera([2, 1.6, 3], 0), turned);
  assert.deepEqual(photo.pose.at, { x: -3n * NM_PER_METRE, y: 2n * NM_PER_METRE });
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
  assert.deepEqual(photo.pose.at, { x: 2n * NM_PER_METRE, y: 3n * NM_PER_METRE });
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
    ['south', 0, 'south'],
    ['north', Math.PI, 'north'],
    ['west', Math.PI / 2, 'west'],
    ['east', -Math.PI / 2, 'east'],
  ];
  for (const [name, turn, wallId] of facings) {
    const photo = toPhoto(camera([3, 1.6, 2], turn), PLAIN);
    const inFrame = wallsInFrame(photo, room).find((x) => x.wallId === wallId);
    assert.ok(inFrame, `facing ${name}, the wall in front of the camera was not found`);
    assert.ok(inFrame.visibleLength > 0n, `facing ${name}, nothing of it was visible`);
  }

  // The two long walls are 2 m away and 6 m across, so neither end fits in the
  // frame and the middle is what comes back. That is the case that used to fail.
  for (const [turn, wallId] of [[0, 'south'], [Math.PI, 'north']] as [number, string][]) {
    const inFrame = wallsInFrame(toPhoto(camera([3, 1.6, 2], turn), PLAIN), room).find(
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
    origin: { x: nm(9.4), y: nm(-6.1) },
  });

  assert.equal(startedAtTheSink.pose.at.x, startedAtTheDoor.pose.at.x);
  assert.equal(startedAtTheSink.pose.at.y, startedAtTheDoor.pose.at.y);
  // A translation turns nothing, so the view direction is untouched by it.
  assert.deepEqual(startedAtTheSink.pose.forward, startedAtTheDoor.pose.forward);
});
