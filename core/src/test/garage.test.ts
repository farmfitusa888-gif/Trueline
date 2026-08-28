import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatFeetInches } from '../length.ts';
import { capturedRoomId, importRoomPlan, isCorrectionOf } from '../import-roomplan.ts';

/**
 * Sam's garage, as his phone actually captured it on 2026-08-28.
 *
 * ## Why a real capture is in the repository
 *
 * > "I JUST SCANNED MY ENTIRE GARAGE AND WHEN IT FINISHED THERE WAS JUST A
 * >  GENERIC SQUARE BLUEPRINT AND 3D. WHAT IT SEEMS LIKE IS THE SCAN IS BEING
 * >  DONE BUT NOT BEING SAVED AND PUT INTO ROOMS PROPERLY."
 *
 * Every scan test before this one was built from numbers written by hand, and
 * every one of them passed while a contractor stood in his garage looking at a
 * square. What they could not do is prove the thing that was actually in
 * doubt: that a capture off a real phone, of a real room, with a garage door in
 * it, comes through as that room.
 *
 * The geometry only. The sixty photographs that came with it are his, and a
 * regression test does not need them.
 */
const GARAGE = JSON.parse(
  readFileSync(new URL('./fixtures/garage-roomplan.json', import.meta.url), 'utf8')
);

const AT = '2026-08-28T12:13:00.000Z';

test("a real garage comes through as a garage, not as a square", () => {
  const { room, report } = importRoomPlan(GARAGE, { name: 'Garage', at: AT });

  assert.equal(room.name, 'Garage');
  // Five captured walls, and a sixth run of outline with nothing across it.
  assert.equal(room.walls.length, 6);
  assert.equal(report.dropped.length, 0);

  const said = room.walls.map((w) => formatFeetInches(w.length.value));
  // The long walls of the bay, both of them, to the sixteenth.
  assert.equal(said.filter((s) => s === `21' 4 1/4"`).length, 2);
  assert.ok(said.includes(`19' 3 11/16"`));

  // Nothing here has had a tape on it, and every wall says so.
  assert.ok(room.walls.every((w) => w.length.provenance.kind === 'scanned'));
});

test('the garage door is found, and is named as a gap rather than as a wall', () => {
  const { room, report } = importRoomPlan(GARAGE, { name: 'Garage', at: AT });
  const gap = room.walls.find((w) => w.id.startsWith('opening-'));
  assert.ok(gap, 'the garage door came through as a wall');
  assert.equal(formatFeetInches(gap.length.value), `9' 9 1/8"`);
  assert.ok(
    report.notes.some((n) => /has no wall across it/.test(n) && /9' 9 1\/8"/.test(n)),
    report.notes.join(' | ')
  );
  // Two windows and a door, on the walls, on top of that.
  assert.equal(report.openings.length, 4);
});

test('the room the scan makes carries the capture’s own identifier', () => {
  const { room } = importRoomPlan(GARAGE, { name: 'Garage', at: AT });
  assert.equal(room.id, 'roomplan:00359271-76DF-46E2-8396-20E9C56E828C');
  assert.equal(capturedRoomId(GARAGE), room.id);
});

/* ------------------------------------------------------------------------ */
/*  The drawing that was sitting in the garage's folder                     */
/* ------------------------------------------------------------------------ */

/**
 * What was actually in `corrected.json` beside that capture: a four-walled
 * room 15 by 11 that Sam drew on a grid two days earlier and called "Draft".
 * A corrected room outranks a capture everywhere, so this is what the app
 * showed him instead of his garage.
 */
const THE_DRAWING = { id: 'drawn:1787736652238', name: 'Draft' };

test('a room drawn on a grid is not a correction of a capture, and is refused as one', () => {
  assert.equal(isCorrectionOf(THE_DRAWING, GARAGE), false);
});

test('a room walked with the phone is not one either', () => {
  assert.equal(isCorrectionOf({ id: 'ar:1787736652238' }, GARAGE), false);
});

test('a real correction of that capture keeps its identifier and is allowed', () => {
  const { room } = importRoomPlan(GARAGE, { name: 'Garage', at: AT });
  assert.equal(isCorrectionOf(room, GARAGE), true);
  // Renaming it, measuring it, moving a wall — none of that changes the id,
  // which is the only thing this reads.
  assert.equal(isCorrectionOf({ id: room.id }, GARAGE), true);
});

test('a correction of a DIFFERENT scan is refused, which is the same failure twice removed', () => {
  assert.equal(
    isCorrectionOf({ id: 'roomplan:00000000-0000-0000-0000-000000000000' }, GARAGE),
    false
  );
});

test('with no capture to contradict, nothing is claimed and the saved room stands', () => {
  // A folder holding only a drawing is a drawing. It opens as it always did.
  for (const nothing of [null, undefined, {}, { floors: [] }, 'not a scan', 7]) {
    assert.equal(isCorrectionOf(THE_DRAWING, nothing), true);
    assert.equal(capturedRoomId(nothing), null);
  }
  // And a capture whose floor has no identifier cannot name a room either.
  assert.equal(capturedRoomId({ floors: [{}] }), null);
  assert.equal(isCorrectionOf(THE_DRAWING, { floors: [{ identifier: '' }] }), true);
});
