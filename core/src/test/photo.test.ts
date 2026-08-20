import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength } from '../length.ts';
import { scanned, verified } from '../measurement.ts';
import { type Heading, type Room, type Wall } from '../room.ts';
import {
  type CameraPose,
  type Photo,
  PhotoError,
  photosOfWall,
  shows,
  unphotographedWalls,
  wallsInFrame,
} from '../photo.ts';

const T0 = '2026-08-19T14:00:00Z';

function w(id: string, heading: Heading, length: string): Wall {
  return { id, heading, length: scanned(parseLength(length), parseLength(`1"`), T0, 'roomplan') };
}

/** 20' x 12'. Corners: (0,0) (20,0) (20,12) (0,12). */
const room: Room = {
  id: 'r1',
  name: 'living',
  walls: [w('north', 'east', `20'`), w('east', 'north', `12'`), w('south', 'west', `20'`), w('west', 'south', `12'`)],
  ceilingHeight: verified(parseLength(`8'`), 'sam', T0, 'tape'),
};

/**
 * A pose standing at `at`, looking along `forward`, with a wedge of roughly
 * ±45 degrees expressed as two integer edge vectors — the same way the device
 * hands them over once quantised.
 */
function pose(
  at: [string, string],
  forward: [bigint, bigint],
  right: [bigint, bigint],
  left: [bigint, bigint]
): CameraPose {
  // The wedge sweeps counter-clockwise from the right edge to the left edge, so
  // the right edge comes first. Facing south down the plan, the camera's left
  // hand points east — which is why these read the opposite way round to instinct.
  return {
    at: { x: parseLength(at[0]), y: parseLength(at[1]) },
    forward: { x: forward[0], y: forward[1] },
    rightEdge: { x: right[0], y: right[1] },
    leftEdge: { x: left[0], y: left[1] },
  };
}

function photo(id: string, p: CameraPose, trigger: Photo['trigger'] = 'automatic'): Photo {
  return { id, takenAt: T0, pose: p, trigger };
}

// Standing mid-room looking south (-y) at the north wall, wedge +/- 45 degrees.
const atNorthWall = photo('p-north', pose([`10'`, `6'`], [0n, -1n], [-1n, -1n], [1n, -1n]));

test('a photo knows which wall it is pointed at', () => {
  const framed = wallsInFrame(atNorthWall, room);
  assert.equal(framed.length, 1);
  assert.equal(framed[0]?.wallId, 'north');
  assert.equal(shows(atNorthWall, room, 'north'), true);
  assert.equal(shows(atNorthWall, room, 'south'), false);
});

test('it reports how much of the wall is actually in shot', () => {
  // From 6' back with a 45-degree half-angle, the wedge reaches 6' either side.
  const framed = wallsInFrame(atNorthWall, room);
  assert.equal(framed[0]?.visibleLength, parseLength(`12'`));
  assert.equal(framed[0]?.fractionPerMille, 600n); // 12' of a 20' wall
});

test('backing off puts more of the wall in frame', () => {
  const close = photo('close', pose([`10'`, `2'`], [0n, -1n], [-1n, -1n], [1n, -1n]));
  const far = photo('far', pose([`10'`, `10'`], [0n, -1n], [-1n, -1n], [1n, -1n]));
  const closeLen = wallsInFrame(close, room).find((x) => x.wallId === 'north')!.visibleLength;
  const farLen = wallsInFrame(far, room).find((x) => x.wallId === 'north')!.visibleLength;
  assert.equal(closeLen, parseLength(`4'`));
  assert.equal(farLen, parseLength(`20'`)); // the whole wall, clipped at the corners
  assert.ok(farLen > closeLen);
});

test('a wall is clipped at the frame edge, never reported longer than it is', () => {
  const far = photo('far', pose([`10'`, `10'`], [0n, -1n], [-1n, -1n], [1n, -1n]));
  const framed = wallsInFrame(far, room).find((x) => x.wallId === 'north')!;
  assert.equal(framed.visibleLength, parseLength(`20'`));
  assert.equal(framed.fractionPerMille, 1000n);
  assert.ok(framed.visibleLength <= room.walls[0]!.length.value);
});

test('a wall only partly in frame is reported as the part that is', () => {
  // Standing in the corner looking at the north wall: only half of it is in the wedge.
  const corner = photo('corner', pose([`2'`, `6'`], [0n, -1n], [-1n, -1n], [1n, -1n]));
  const framed = wallsInFrame(corner, room).find((x) => x.wallId === 'north');
  assert.ok(framed, 'the north wall should be partly in frame');
  assert.ok(framed!.visibleLength > 0n);
  assert.ok(framed!.visibleLength < room.walls[0]!.length.value);
  assert.ok(framed!.fractionPerMille < 1000n);
});

test('turning to face a corner puts two walls in frame', () => {
  // Looking north-east from the middle: the east and north walls both fall in.
  const diagonal = photo('diag', pose([`10'`, `6'`], [1n, -1n], [0n, -1n], [1n, 0n]));
  const ids = wallsInFrame(diagonal, room).map((x) => x.wallId).sort();
  assert.deepEqual(ids, ['east', 'north']);
});

test('the photo showing most of a wall comes first', () => {
  const close = photo('close', pose([`10'`, `2'`], [0n, -1n], [-1n, -1n], [1n, -1n]));
  const far = photo('far', pose([`10'`, `10'`], [0n, -1n], [-1n, -1n], [1n, -1n]));
  const ranked = photosOfWall([close, far], room, 'north');
  assert.deepEqual(ranked.map((r) => r.photo.id), ['far', 'close']);
  assert.ok(ranked[0]!.inFrame.visibleLength > ranked[1]!.inFrame.visibleLength);
});

test('a wall nobody photographed is named before anyone leaves site', () => {
  const missing = unphotographedWalls([atNorthWall], room);
  assert.deepEqual(missing.sort(), ['east', 'south', 'west']);
});

test('four photos from the middle cover every wall', () => {
  const middle: [string, string] = [`10'`, `6'`];
  const all = [
    photo('n', pose(middle, [0n, -1n], [-1n, -1n], [1n, -1n])),
    photo('s', pose(middle, [0n, 1n], [1n, 1n], [-1n, 1n])),
    photo('e', pose(middle, [1n, 0n], [1n, -1n], [1n, 1n])),
    photo('w', pose(middle, [-1n, 0n], [-1n, 1n], [-1n, -1n])),
  ];
  assert.deepEqual(unphotographedWalls(all, room), []);
});

test('a manual shutter tap is recorded as such', () => {
  const tapped = photo('tap', atNorthWall.pose, 'manual');
  assert.equal(tapped.trigger, 'manual');
  assert.equal(shows(tapped, room, 'north'), true);
});

test('a field of view with its edges the wrong way round is refused', () => {
  const backwards = photo('bad', pose([`10'`, `6'`], [0n, -1n], [1n, -1n], [-1n, -1n]));
  assert.throws(() => wallsInFrame(backwards, room), PhotoError);
});

test('nothing here is ever exact enough to be mistaken for a dimension', () => {
  // The clipped span ranks photos; it must never exceed the wall it clips from.
  for (let x = 1; x <= 19; x += 2) {
    for (let y = 1; y <= 11; y += 2) {
      const p = photo(`p${x}-${y}`, pose([`${x}'`, `${y}'`], [0n, -1n], [-1n, -1n], [1n, -1n]));
      for (const framed of wallsInFrame(p, room)) {
        const wall = room.walls.find((wl) => wl.id === framed.wallId)!;
        assert.ok(
          framed.visibleLength <= wall.length.value,
          `${framed.wallId} reported ${framed.visibleLength} of ${wall.length.value} from ${x},${y}`
        );
        assert.ok(framed.fractionPerMille <= 1000n);
      }
    }
  }
});
