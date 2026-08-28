import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength } from '../length.ts';
import { scanned, verified } from '../measurement.ts';
import { type Heading, type Room, type Wall } from '../room.ts';
import {
  type CameraPose,
  type Photo,
  PhotoError,
  onlyPhotographOf,
  photosOfWall,
  plannedDeletion,
  plannedScanDeletion,
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
  assert.ok(plan.inUse.some((line) => /keeps the photographs that went with it/.test(line)));
});

test('with no hand-over record it says "if", and never that nothing went out', () => {
  // The record is on this device and a device can lose it. Silence in the log
  // is not knowledge that nothing was sent, so the sentence makes no claim.
  const plan = ask();
  const said = plan.inUse.join(' | ');
  assert.ok(/^If a claim document or an archive has already gone out/m.test(
    plan.inUse.find((line) => /gone out/.test(line)) ?? ''
  ), said);
  assert.ok(!/nothing has been sent|has not been sent/i.test(said), said);
});

test('when the record has a date, the sentence names it', () => {
  const one = ask({ wentOutOn: ['2026-08-27'] });
  assert.ok(
    one.inUse.some((line) => line.startsWith(
      'A claim document or an archive left this phone on 2026-08-27.'
    )),
    one.inUse.join(' | ')
  );

  // More than one, and it says how many and which was last -- newest first, as
  // the field is documented to arrive.
  const twice = ask({ wentOutOn: ['2026-08-27', '2026-08-24'] });
  assert.ok(
    twice.inUse.some((line) => line.startsWith(
      'A claim document or an archive left this phone 2 times, last on 2026-08-27.'
    )),
    twice.inUse.join(' | ')
  );
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

/* ------------------------------- taking photographs out of the scan itself */

/**
 * The other batch delete, and the one Sam was actually describing.
 *
 * The tests above are the photographs somebody takes of a damage. These are the
 * fifty-odd frames the walk itself takes, which had no delete anywhere in the
 * app at all. The question they exist to answer is the one a strip of
 * near-identical pictures cannot: which of these is the only thing that ever
 * saw a wall.
 *
 * Five frames in the 20' x 12' room above, from poses whose coverage is
 * asserted here rather than assumed:
 *
 *     n1  north                 n2  north
 *     e1  north, east, south    s1  south
 *     w1  north, south, west
 *
 * So `e1` is the only photograph of the east wall and `w1` the only one of the
 * west, and no frame is the last one of north or south. That is what makes it
 * possible to test the difference between a delete that blinds a wall and one
 * that only looks like it might.
 */

const middleOfRoom: [string, string] = [`10'`, `6'`];
const n1 = photo('n1', pose(middleOfRoom, [0n, -1n], [-1n, -1n], [1n, -1n]));
const n2 = photo('n2', pose([`10'`, `2'`], [0n, -1n], [-1n, -1n], [1n, -1n]));
const e1 = photo('e1', pose(middleOfRoom, [1n, 0n], [1n, -1n], [1n, 1n]));
const s1 = photo('s1', pose(middleOfRoom, [0n, 1n], [1n, 1n], [-1n, 1n]));
const w1 = photo('w1', pose(middleOfRoom, [-1n, 0n], [-1n, 1n], [-1n, -1n]));
const scan = [n1, n2, e1, s1, w1];

function scanAsk(over: Partial<Parameters<typeof plannedScanDeletion>[0]> = {}) {
  return plannedScanDeletion({
    inScan: scan,
    picked: ['e1'],
    room,
    filedWithScan: true,
    ...over,
  });
}

test('the five frames cover what these tests say they cover', () => {
  // Stated rather than trusted. Every assertion below about "the only
  // photograph of a wall" is worthless if the poses do not see what is claimed.
  const seen = (p: Photo) => wallsInFrame(p, room).map((x) => x.wallId).sort();
  assert.deepEqual(seen(n1), ['north']);
  assert.deepEqual(seen(n2), ['north']);
  assert.deepEqual(seen(e1), ['east', 'north', 'south']);
  assert.deepEqual(seen(s1), ['south']);
  assert.deepEqual(seen(w1), ['north', 'south', 'west']);
  assert.deepEqual(unphotographedWalls(scan, room), []);
});

test('the only photograph of a wall is named, and a frame with a twin is not', () => {
  const sole = onlyPhotographOf(scan, room);
  assert.deepEqual([...sole.keys()].sort(), ['e1', 'w1']);
  assert.deepEqual(sole.get('e1'), ['east']);
  assert.deepEqual(sole.get('w1'), ['west']);
  // North was shot four times over and south three. Nothing there is anybody's
  // last picture, and calling one of them irreplaceable would be crying wolf.
  assert.equal(sole.has('n1'), false);
  assert.equal(sole.has('n2'), false);
  assert.equal(sole.has('s1'), false);
});

test('a photograph that is the last one of a wall says so before it goes', () => {
  const plan = scanAsk({ picked: ['e1'] });
  assert.equal(plan.headline, 'Delete 1 photograph.');
  assert.deepEqual(plan.soleWitnesses, ['e1']);
  assert.deepEqual(plan.wallsLeftBlind, ['east']);
  assert.ok(
    plan.inUse.includes('1 of these is the only photograph of a wall.'),
    plan.inUse.join(' | ')
  );
  assert.ok(
    plan.inUse.some((line) => line.startsWith('Afterwards nothing shows east.')),
    plan.inUse.join(' | ')
  );
});

test('two of them says "2 of these are", and both walls are named', () => {
  const plan = scanAsk({ picked: ['e1', 'w1'] });
  assert.deepEqual(plan.soleWitnesses, ['e1', 'w1']);
  assert.deepEqual([...plan.wallsLeftBlind].sort(), ['east', 'west']);
  assert.ok(
    plan.inUse.includes('2 of these are the only photograph of a wall.'),
    plan.inUse.join(' | ')
  );
  assert.ok(
    plan.inUse.some((line) => /nothing shows east and west/.test(line)),
    plan.inUse.join(' | ')
  );
});

test('a delete that blinds nothing says nothing about blinding anything', () => {
  // Both photographs of the north wall, and the north wall is still covered by
  // e1 and w1 afterwards. A warning here would be a warning nobody believes the
  // next time it is right.
  const plan = scanAsk({ picked: ['n1', 'n2'] });
  assert.deepEqual(plan.soleWitnesses, []);
  assert.deepEqual(plan.wallsLeftBlind, []);
  assert.ok(!plan.inUse.some((line) => /only photograph of a wall/.test(line)));
  assert.ok(!plan.inUse.some((line) => /Afterwards nothing shows/.test(line)));
});

test('a wall goes blind even when no single frame was its last one', () => {
  // Two frames of the north wall and nothing else in the scan. Neither is "the
  // only photograph" — together they are, and the wall-by-wall answer catches
  // what the photograph-by-photograph answer cannot.
  const plan = plannedScanDeletion({
    inScan: [n1, n2],
    picked: ['n1', 'n2'],
    room,
    filedWithScan: true,
  });
  assert.deepEqual(plan.soleWitnesses, []);
  assert.deepEqual(plan.wallsLeftBlind, ['north']);
  assert.ok(plan.inUse.some((line) => /Afterwards nothing shows north\./.test(line)));
});

test('walls nothing photographed in the first place are not laid at this delete', () => {
  // East, south and west were never in shot in that two-frame scan. Blaming a
  // delete for walls it never had is the fastest way to teach somebody to click
  // through the warning.
  const plan = plannedScanDeletion({
    inScan: [n1, n2],
    picked: ['n1'],
    room,
    filedWithScan: true,
  });
  assert.deepEqual(plan.wallsLeftBlind, []);
  assert.deepEqual(unphotographedWalls([n1, n2], room).sort(), ['east', 'south', 'west']);
});

test('a scan delete says the count in words, from the set that is actually going', () => {
  assert.equal(scanAsk({ picked: ['e1'] }).headline, 'Delete 1 photograph.');
  assert.equal(scanAsk({ picked: ['e1', 'n1'] }).headline, 'Delete 2 photographs.');
  assert.equal(scanAsk({ picked: scan.map((p) => p.id) }).headline, 'Delete 5 photographs.');
});

test('exactly the ones picked go, in the scan order and not the tapping order', () => {
  const plan = scanAsk({ picked: ['w1', 'n1'] });
  assert.deepEqual(plan.going.map((p) => p.id), ['n1', 'w1']);
  assert.deepEqual(plan.staying.map((p) => p.id), ['n2', 'e1', 's1']);
  assert.equal(plan.going.length + plan.staying.length, scan.length);
});

test('what is left is counted, and emptying a scan says that is what it is', () => {
  assert.ok(scanAsk({ picked: ['e1'] }).inUse.includes('4 photographs stay in this scan.'));
  assert.ok(scanAsk({ picked: ['e1', 'n1', 'n2', 's1'] }).inUse
    .includes('1 photograph stays in this scan.'));
  const all = scanAsk({ picked: scan.map((p) => p.id) });
  assert.ok(
    all.inUse.some((line) => line.startsWith('That is every photograph the walk took.')),
    all.inUse.join(' | ')
  );
  assert.ok(all.inUse.some((line) => /nothing behind any of them to look at/.test(line)));
});

test('which side owns the truth is stated, and no file is claimed to be wiped', () => {
  const onPhone = scanAsk({ filedWithScan: true });
  assert.ok(
    onPhone.inUse.some((line) => /picture files stay in the scan's folder/.test(line)),
    onPhone.inUse.join(' | ')
  );
  assert.ok(onPhone.inUse.some((line) => /rather than wiping anything off the phone/.test(line)));

  const inBrowser = scanAsk({ filedWithScan: false });
  assert.ok(
    inBrowser.inUse.some((line) => /no app here holding the scan folder/.test(line)),
    inBrowser.inUse.join(' | ')
  );
  // Two answers to one question is how somebody stops reading either of them.
  assert.ok(!inBrowser.inUse.some((line) => /scan's folder where the app put them/.test(line)));
});

test('a scan delete states what can be taken back, and what cannot', () => {
  const plan = scanAsk();
  assert.match(plan.finality, /put them back until you leave this screen/);
  assert.match(plan.finality, /do not come back on their own/);
});

test('a delete aimed at a frame this scan does not have is refused', () => {
  // The 53 photographs: the thing on screen was not the thing that went.
  assert.throws(
    () => scanAsk({ picked: ['e1', 'ghost'] }),
    (error: unknown) =>
      error instanceof PhotoError && /not in this scan/.test((error as Error).message)
  );
});

test('a frame ticked twice is refused rather than silently counted once', () => {
  assert.throws(
    () => scanAsk({ picked: ['e1', 'e1'] }),
    (error: unknown) =>
      error instanceof PhotoError && /ticked twice/.test((error as Error).message)
  );
});

test('a scan delete of nothing is refused', () => {
  assert.throws(() => scanAsk({ picked: [] }), PhotoError);
});

test('nothing is ever taken that was not picked, over every subset of a scan', () => {
  // Exhaustive rather than illustrative, like the mark version above. The
  // failure that matters is an off-by-one that takes a neighbour, and it hides
  // in exactly one subset.
  const alreadyBlind = new Set(unphotographedWalls(scan, room));
  for (let bits = 1; bits < 1 << scan.length; bits += 1) {
    const picked = scan.filter((_, i) => (bits >> i) & 1);
    const plan = plannedScanDeletion({
      inScan: scan,
      picked: picked.map((p) => p.id),
      room,
      filedWithScan: true,
    });
    assert.deepEqual(plan.going, picked, `bits ${bits}`);
    assert.deepEqual(
      plan.staying,
      scan.filter((p) => !picked.includes(p)),
      `bits ${bits}`
    );
    assert.equal(
      plan.headline,
      `Delete ${picked.length === 1 ? '1 photograph' : `${picked.length} photographs`}.`
    );
    // A wall this delete is blamed for must actually have had a photograph, and
    // must actually have none left. Both halves, on every subset.
    for (const wallId of plan.wallsLeftBlind) {
      assert.equal(alreadyBlind.has(wallId), false, `bits ${bits}: ${wallId} was already blind`);
    }
    assert.deepEqual(
      [...plan.wallsLeftBlind].sort(),
      unphotographedWalls(plan.staying, room).filter((id) => !alreadyBlind.has(id)).sort(),
      `bits ${bits}`
    );
    // And nothing is called somebody's last photograph unless it is going.
    for (const id of plan.soleWitnesses) {
      assert.ok(plan.going.some((p) => p.id === id), `bits ${bits}: ${id} is not going`);
    }
  }
});
