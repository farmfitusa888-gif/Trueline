import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NM_PER_FOOT, NM_PER_INCH, parseLength } from '../length.ts';
import { confidenceLabel, isVerified, verified } from '../measurement.ts';
import { isDiagonal } from '../room.ts';
import {
  DEFAULT_GRID,
  SketchError,
  addCorner,
  close,
  directionOf,
  lengthOf,
  moveCorner,
  progress,
  removeCorner,
  sketchToRoom,
  snap,
  startSketch,
  wouldClose,
  wouldLand,
} from '../sketch.ts';

const T0 = '2026-08-26T12:00:00Z';
const ft = (n: number) => BigInt(n) * NM_PER_FOOT;

function blank() {
  return startSketch({
    id: 'r1',
    name: 'living room',
    drawnBy: 'sam',
    drawnAt: T0,
    ceilingHeight: verified(parseLength(`9'`), 'sam', T0, 'tape'),
  });
}

/** A 20 x 12 room, tapped clockwise from the origin. */
function box() {
  let sketch = blank();
  for (const at of [
    { x: 0n, y: 0n },
    { x: ft(20), y: 0n },
    { x: ft(20), y: ft(12) },
    { x: 0n, y: ft(12) },
  ]) {
    sketch = addCorner(sketch, at);
  }
  return close(sketch);
}

/* ------------------------------------------------------------------ the grid */

test('a tap lands on the nearest grid line', () => {
  assert.equal(snap(7n * NM_PER_INCH, DEFAULT_GRID), 6n * NM_PER_INCH);
  assert.equal(snap(10n * NM_PER_INCH, DEFAULT_GRID), 12n * NM_PER_INCH);
  assert.equal(snap(0n, DEFAULT_GRID), 0n);
});

test('exactly halfway rounds away from zero, both ways', () => {
  // Rounding half toward zero would pull a room's far corner in by a grid
  // square over a dozen taps, and always in the same direction.
  assert.equal(snap(3n * NM_PER_INCH, DEFAULT_GRID), 6n * NM_PER_INCH);
  assert.equal(snap(-3n * NM_PER_INCH, DEFAULT_GRID), -6n * NM_PER_INCH);
});

test('a grid with no size is refused rather than dividing by zero', () => {
  assert.throws(() => snap(1n, 0n), SketchError);
});

/* --------------------------------------------------------------- the corners */

test('a nearly square run is taken as square', () => {
  // What a thumb does. Most rooms are square and a finger is not.
  const one = addCorner(blank(), { x: 0n, y: 0n });
  const two = addCorner(one, { x: ft(10), y: 6n * NM_PER_INCH });
  assert.equal(two.corners[1]!.y, 0n, 'the six inches of wobble should have gone');
  assert.equal(two.corners[1]!.x, ft(10));
});

test('a run drawn well off the axis keeps the angle it was drawn at', () => {
  // A bay window or a cut corner. The old draw-by-hand could not make one at
  // all -- every wall was a compass point.
  const one = addCorner(blank(), { x: 0n, y: 0n });
  const two = addCorner(one, { x: ft(10), y: ft(6) });
  assert.equal(two.corners[1]!.x, ft(10));
  assert.equal(two.corners[1]!.y, ft(6));
});

test('the preview and the tap land in the same place', () => {
  // A preview that lands somewhere else than the tap is worse than none.
  const one = addCorner(blank(), { x: 0n, y: 0n });
  const at = { x: ft(10) + 2n * NM_PER_INCH, y: 5n * NM_PER_INCH };
  assert.deepEqual(addCorner(one, at).corners[1], wouldLand(one, at));
});

test('tapping the same corner twice adds nothing', () => {
  const one = addCorner(blank(), { x: 0n, y: 0n });
  const again = addCorner(one, { x: 0n, y: 0n });
  assert.equal(again.corners.length, 1);
});

test('a corner can be dragged, and dragging never squares it', () => {
  // Somebody dragging a corner is aiming at a place. Squaring it under their
  // finger would move it somewhere they can see they did not put it.
  const moved = moveCorner(box(), 2, { x: ft(19), y: ft(11) });
  assert.deepEqual(moved.corners[2], { x: ft(19), y: ft(11) });
});

test('a corner can be taken out, and the last three cannot', () => {
  // Built open and then closed: a closed sketch refuses a new corner, which is
  // correct and is what this test got wrong the first time it ran.
  let five = blank();
  for (const at of [
    { x: 0n, y: 0n },
    { x: ft(20), y: 0n },
    { x: ft(20), y: ft(12) },
    { x: ft(10), y: ft(12) },
    { x: 0n, y: ft(12) },
  ]) {
    five = addCorner(five, at);
  }
  const closed = close(five);
  assert.equal(removeCorner(closed, 3).corners.length, 4);
  const triangle = removeCorner(removeCorner(closed, 3), 3);
  assert.equal(triangle.corners.length, 3);
  assert.throws(() => removeCorner(triangle, 0), SketchError);
});

test('moving or removing a corner that is not there says so', () => {
  assert.throws(() => moveCorner(box(), 9, { x: 0n, y: 0n }), SketchError);
  assert.throws(() => removeCorner(box(), -1), SketchError);
});

/* --------------------------------------------------------------- closing it */

test('a tap near the first corner closes the loop', () => {
  let sketch = blank();
  for (const at of [{ x: 0n, y: 0n }, { x: ft(10), y: 0n }, { x: ft(10), y: ft(8) }]) {
    sketch = addCorner(sketch, at);
  }
  assert.equal(wouldClose(sketch, { x: 2n * NM_PER_INCH, y: 0n }), true);
  assert.equal(wouldClose(sketch, { x: ft(5), y: ft(5) }), false);
});

test('two corners are not a room', () => {
  let sketch = addCorner(blank(), { x: 0n, y: 0n });
  sketch = addCorner(sketch, { x: ft(10), y: 0n });
  assert.equal(wouldClose(sketch, { x: 0n, y: 0n }), false);
  assert.throws(() => close(sketch), SketchError);
});

test('nothing can be added to a closed room until it is opened', () => {
  assert.throws(() => addCorner(box(), { x: ft(30), y: ft(30) }), SketchError);
});

/* ------------------------------------------------------------- what it makes */

test('a tapped box becomes a room with the walls it was drawn with', () => {
  const room = sketchToRoom(box());
  assert.equal(room.walls.length, 4);
  assert.deepEqual(
    room.walls.map((w) => w.length.value),
    [ft(20), ft(12), ft(20), ft(12)]
  );
  assert.deepEqual(
    room.walls.map((w) => w.heading),
    ['east', 'north', 'west', 'south']
  );
});

test('an angled wall comes out as a run rather than a compass point', () => {
  let sketch = blank();
  for (const at of [
    { x: 0n, y: 0n },
    { x: ft(12), y: 0n },
    { x: ft(9), y: ft(4) },
    { x: 0n, y: ft(4) },
  ]) {
    sketch = addCorner(sketch, at);
  }
  const room = sketchToRoom(close(sketch));
  const angled = room.walls[1]!;
  assert.equal(isDiagonal(angled.heading), true);
  // 3-4-5, in feet.
  assert.equal(angled.length.value, ft(5));
});

test('a diagonal length is exact, not rounded through a float', () => {
  const from = { x: 0n, y: 0n };
  const to = { x: 3n * NM_PER_FOOT, y: 4n * NM_PER_FOOT };
  assert.equal(lengthOf(from, to), 5n * NM_PER_FOOT);
  assert.equal(isDiagonal(directionOf(from, to)), true);
});

test('an open sketch is not a room', () => {
  let sketch = blank();
  for (const at of [{ x: 0n, y: 0n }, { x: ft(10), y: 0n }, { x: ft(10), y: ft(8) }]) {
    sketch = addCorner(sketch, at);
  }
  assert.throws(() => sketchToRoom(sketch), SketchError);
});

/* ------------------------------------------- the rule the whole thing rests on */

test('NOTHING a tapped room produces is verified', () => {
  // The one that matters. A room drawn in ten seconds must never tell an
  // adjuster it was measured, and this is what stops it.
  const room = sketchToRoom(box());
  for (const wall of room.walls) {
    assert.equal(isVerified(wall.length), false, `${wall.id} came out verified`);
    assert.equal(confidenceLabel(wall.length), 'derived');
  }
});

test('and every wall carries an honest tolerance of one grid square', () => {
  const room = sketchToRoom(box());
  for (const wall of room.walls) {
    assert.equal(wall.length.provenance.kind, 'derived');
    if (wall.length.provenance.kind === 'derived') {
      assert.equal(wall.length.provenance.tolerance, DEFAULT_GRID);
      assert.deepEqual(wall.length.provenance.from, ['the grid it was drawn on']);
    }
  }
});

/*
 * The wall-by-wall tape reading is tested where it lives — `verify` in the
 * reducer, and `Edit.tsx` on screen. A drawn room goes through the same one.
 */

/* -------------------------------------------------------- what the screen says */

test('the screen is told what to say at every stage', () => {
  assert.match(progress(blank()).saying, /Tap a corner/);
  const one = addCorner(blank(), { x: 0n, y: 0n });
  assert.match(progress(one).saying, /Keep tapping/);
  let three = one;
  for (const at of [{ x: ft(10), y: 0n }, { x: ft(10), y: ft(8) }]) three = addCorner(three, at);
  assert.match(progress(three).saying, /close it/);
  assert.equal(progress(three).canClose, true);
  assert.match(progress(box()).saying, /name it|tape reading/);
  assert.equal(progress(box()).canClose, false);
});

test('the lengths drawn along the lines are the lengths of the runs', () => {
  const shown = progress(box()).walls;
  assert.deepEqual(shown.map((w) => w.length), [ft(20), ft(12), ft(20), ft(12)]);
  assert.deepEqual(shown.map((w) => w.label), [`20'`, `12'`, `20'`, `12'`]);
});

test('an open sketch shows one fewer run than it has corners', () => {
  let sketch = blank();
  for (const at of [{ x: 0n, y: 0n }, { x: ft(10), y: 0n }, { x: ft(10), y: ft(8) }]) {
    sketch = addCorner(sketch, at);
  }
  assert.equal(progress(sketch).walls.length, 2);
  assert.equal(progress(close(sketch)).walls.length, 3);
});
