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
  plannedDeletion,
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

/* ------------------------------------------- taking photographs off a mark */

/**
 * The 53 photographs, in test form.
 *
 * Every one of these is the same question: does the person get told, in words
 * and before anything happens, exactly what is going and what goes with it.
 */

const strip = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg', 'f.jpg'];

function ask(over: Partial<Parameters<typeof plannedDeletion>[0]> = {}) {
  return plannedDeletion({
    onMark: strip,
    picked: ['b.jpg', 'd.jpg'],
    held: strip,
    filedWithScan: false,
    ...over,
  });
}

test('the count is said in words, from the set that is actually going', () => {
  assert.equal(ask().headline, 'Delete 2 photographs.');
  assert.equal(ask({ picked: ['c.jpg'] }).headline, 'Delete 1 photograph.');
  assert.equal(ask({ picked: strip }).headline, 'Delete 6 photographs.');
});

test('exactly the ones picked go, and everything else stays, in the strip order', () => {
  const plan = ask({ picked: ['e.jpg', 'a.jpg'] });
  // Ticked in the other order on purpose: what the sentence says and what the
  // record shows must be one list, read the way the strip reads.
  assert.deepEqual(plan.going, ['a.jpg', 'e.jpg']);
  assert.deepEqual(plan.staying, ['b.jpg', 'c.jpg', 'd.jpg', 'f.jpg']);
  assert.equal(plan.going.length + plan.staying.length, strip.length);
});

test('a photograph on the claim is named before it goes', () => {
  const plan = ask({ picked: ['a.jpg', 'b.jpg', 'c.jpg'], onClaim: strip });
  assert.ok(
    plan.inUse.some((line) => line.startsWith('3 of these are on the claim.')),
    plan.inUse.join(' | ')
  );
  assert.ok(plan.inUse.some((line) => /off the claim document/.test(line)));
});

test('one photograph on the claim is named singly, not as "1 of these are"', () => {
  const plan = ask({ picked: ['a.jpg'], onClaim: ['a.jpg'] });
  assert.ok(
    plan.inUse.some((line) => line === '1 of these is on the claim. It comes off the claim ' +
      'document with them.'),
    plan.inUse.join(' | ')
  );
});

test('only the picked ones are counted as on the claim', () => {
  // The whole mark is on the claim; two are going. Saying "6 are on the claim"
  // in front of a delete of two is the count somebody has to work out again.
  const plan = ask({ picked: ['b.jpg', 'd.jpg'], onClaim: strip });
  assert.ok(plan.inUse.some((line) => line.startsWith('2 of these are on the claim.')));
});

test('a caller that does not know about the claim is never told there is none', () => {
  const plan = ask();
  assert.ok(!plan.inUse.some((line) => /on the claim\./.test(line)), plan.inUse.join(' | '));
  // But the consequence for documents is still said, because it is always true.
  assert.ok(plan.inUse.some((line) => /already gone out keeps the photographs/.test(line)));
});

test('emptying a mark says so, rather than leaving it to be discovered', () => {
  const plan = ask({ picked: strip });
  assert.ok(
    plan.inUse.some((line) => line.startsWith('That is every photograph on this mark.')),
    plan.inUse.join(' | ')
  );
  assert.ok(plan.inUse.some((line) => /nothing on it to look at/.test(line)));
});

test('a delete that leaves some says how many are left', () => {
  assert.ok(ask().inUse.includes('4 photographs stay on this mark.'));
  assert.ok(ask({ picked: strip.slice(0, 5) }).inUse.includes('1 photograph stays on this mark.'));
});

test('a browser with no app behind it says nothing else has a copy', () => {
  const plan = ask({ picked: ['a.jpg', 'b.jpg'] });
  assert.ok(
    plan.inUse.includes('2 of them are on this browser only. Nothing else has a copy.'),
    plan.inUse.join(' | ')
  );
});

test('a phone with the app behind it says the scan folder keeps its copy', () => {
  const plan = ask({ filedWithScan: true });
  assert.ok(
    plan.inUse.some((line) => /copy stays in the scan's folder/.test(line)),
    plan.inUse.join(' | ')
  );
  // And it does not also claim this browser holds the only copy, which would be
  // two answers to one question.
  assert.ok(!plan.inUse.some((line) => /Nothing else has a copy/.test(line)));
});

test('a photograph this device never had is named as such', () => {
  // Opened on a second phone: the mark names the picture, the bytes are in the
  // scan's folder on the phone that took it.
  const plan = ask({ picked: ['a.jpg', 'b.jpg'], held: ['a.jpg'] });
  assert.ok(
    plan.inUse.some((line) => /1 photograph is not on this device at all/.test(line)),
    plan.inUse.join(' | ')
  );
});

test('what can be taken back is stated, and what cannot', () => {
  const plan = ask();
  assert.match(plan.finality, /put them back until you leave this screen/);
  assert.match(plan.finality, /dropped for good/);
});

test('a delete aimed at a photograph the mark does not have is refused', () => {
  // The 53 photographs: the thing on screen was not the thing that went.
  assert.throws(
    () => ask({ picked: ['b.jpg', 'ghost.jpg'] }),
    (error: unknown) =>
      error instanceof PhotoError && /not on this mark/.test((error as Error).message)
  );
});

test('a photograph ticked twice is refused rather than silently counted once', () => {
  assert.throws(
    () => ask({ picked: ['b.jpg', 'b.jpg'] }),
    (error: unknown) =>
      error instanceof PhotoError && /ticked twice/.test((error as Error).message)
  );
});

test('a delete of nothing is refused', () => {
  assert.throws(() => ask({ picked: [] }), PhotoError);
});

test('nothing is ever taken that was not picked, over every subset of a strip', () => {
  // Exhaustive rather than illustrative. The one failure that matters here is
  // an off-by-one that takes a neighbour, and it hides in exactly one subset.
  for (let bits = 1; bits < 1 << strip.length; bits += 1) {
    const picked = strip.filter((_, i) => (bits >> i) & 1);
    const plan = plannedDeletion({
      onMark: strip,
      picked,
      held: strip,
      filedWithScan: false,
    });
    assert.deepEqual(plan.going, picked, `bits ${bits}`);
    assert.deepEqual(
      plan.staying,
      strip.filter((name) => !picked.includes(name)),
      `bits ${bits}`
    );
    assert.equal(plan.headline, `Delete ${picked.length === 1 ? '1 photograph' : `${picked.length} photographs`}.`);
  }
});
