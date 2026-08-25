import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength } from '../length.ts';
import {
  confidenceLabel,
  formatWithConfidence,
  history,
  isAdjusted,
  isVerified,
  scanned,
  toleranceOf,
  verified,
  verify,
} from '../measurement.ts';
import { type Heading, type Opening, type Room, type Wall, closes, runLength } from '../room.ts';
import { readiness } from '../issue.ts';
import {
  EditError,
  adjustWall,
  deleteWall,
  notchCorner,
  renameRoom,
  renameWall,
  splitWall,
  unverifyWall,
} from '../edit.ts';

/**
 * Editing the shape of a room, and the one line that must not be crossed.
 *
 * Dragging a wall is a real need — a scan puts one in the wrong place, or an old
 * drawing is plainly out by a foot — and the moment dragging produced a
 * *verified* measurement, somebody could make an unchecked scan claim it had
 * been measured by nudging four walls. Every promise this app makes about where
 * a number came from would be worth nothing. So the tests that matter most here
 * are the ones about what a moved wall is called afterwards.
 */

const T0 = '2026-08-26T09:00:00Z';
const T1 = '2026-08-27T09:00:00Z';
const TOL = parseLength(`2"`);
const scan = (text: string) => scanned(parseLength(text), TOL, T0, 'roomplan');

function w(id: string, heading: Heading, length: string, openings?: Opening[]): Wall {
  return { id, heading, length: scan(length), ...(openings ? { openings } : {}) };
}

const door: Opening = {
  id: 'd1',
  kind: 'door',
  width: scan(`3'`),
  height: scan(`6' 8"`),
  offsetFromStart: scan(`4'`),
};

/** 20 x 10, with a door 4 ft along the south wall. */
const room: Room = {
  id: 'r1',
  name: 'garage.json',
  walls: [
    w('south', 'east', `20'`, [door]),
    w('east', 'north', `10'`),
    w('north', 'west', `20'`),
    w('west', 'south', `10'`),
  ],
  ceilingHeight: verified(parseLength(`9'`), 'sam', T0, 'tape'),
};

const wallNamed = (r: Room, id: string) => r.walls.find((x) => x.id === id)!;

/** What makes the second piece a second wall: it only comes up to the counter. */
const PONY = { height: verified(parseLength(`3' 6"`), 'sam', T1, 'tape') };

/* ------------------------------------------------------------------ names */

test('a room can be given the name a person would call it', () => {
  // Out of the importer it is a file name, and "garage.json" at the head of a
  // document going to an insurer reads as a machine's output.
  const named = renameRoom(room, '  Gilbert — garage  ');
  assert.equal(named.name, 'Gilbert — garage');
  assert.equal(room.name, 'garage.json', 'the room handed in is untouched');
});

test('a blank name and a name the length of a paragraph are both refused', () => {
  assert.throws(() => renameRoom(room, '   '), EditError);
  assert.throws(() => renameRoom(room, 'x'.repeat(121)), EditError);
});

test('a wall can be named for the thing in front of it', () => {
  const named = renameWall(room, 'south', 'behind the washer');
  assert.equal(wallNamed(named, 'behind the washer').openings?.[0]?.id, 'd1');
  assert.equal(named.walls.some((x) => x.id === 'south'), false);
  assert.ok(closes(named), 'renaming cannot change the shape');
});

test('two walls with one name is refused, because nothing could tell them apart', () => {
  assert.throws(() => renameWall(room, 'south', 'north'), EditError);
  // Renaming a wall to what it already is does nothing rather than complaining.
  assert.equal(renameWall(room, 'south', 'south'), room);
});

/* ------------------------------- the line: moved is not measured */

test('a dragged wall is adjusted, never verified', () => {
  const { room: moved } = adjustWall(room, 'south', parseLength(`21'`), 'sam', T1);
  const south = wallNamed(moved, 'south');
  assert.equal(confidenceLabel(south.length), 'adjusted');
  assert.equal(isVerified(south.length), false);
  assert.equal(isAdjusted(south.length), true);
  assert.equal(south.length.value, parseLength(`21'`));
});

test('dragging four walls does NOT make an unchecked scan claim it was measured', () => {
  // The whole product in one assertion. If this ever passes the other way, the
  // plan can say "measured" about a room nobody put a tape on.
  let moved = room;
  for (const id of ['south', 'east', 'north', 'west']) {
    moved = adjustWall(moved, id, runLength(wallNamed(moved, id)) + parseLength(`1"`), 'sam', T1).room;
  }
  const state = readiness(moved);
  assert.ok(
    state.blocking.length > 0,
    'a room of dragged walls must still be blocked on somebody putting a tape on one'
  );
  assert.equal(moved.walls.every((x) => isAdjusted(x.length)), true);
});

test('a moved wall says so in words rather than borrowing the sensor’s band', () => {
  // "21' ± 2"" would be claiming the scanner's guarantee for a number the
  // scanner did not produce.
  const { room: moved } = adjustWall(room, 'south', parseLength(`21'`), 'sam', T1);
  const said = formatWithConfidence(wallNamed(moved, 'south').length);
  assert.equal(said, `21' (moved by hand)`);
  assert.doesNotMatch(said, /±/);
});

test('the band under a moved wall is the band of what it replaced', () => {
  // A floor, not a guarantee: moving a line with a finger cannot make a number
  // more certain than the instrument that produced it.
  const { room: moved } = adjustWall(room, 'south', parseLength(`21'`), 'sam', T1);
  assert.equal(toleranceOf(wallNamed(moved, 'south').length), TOL);
});

test('what it said before is kept, and the history walks back through it', () => {
  const { room: once } = adjustWall(room, 'south', parseLength(`21'`), 'sam', T1);
  const { room: twice } = adjustWall(once, 'south', parseLength(`22'`), 'gilbert', T1);
  const chain = history(wallNamed(twice, 'south').length);
  assert.deepEqual(
    chain.map((m) => m.value),
    [parseLength(`22'`), parseLength(`21'`), parseLength(`20'`)]
  );
});

test('a wall that has had a tape on it refuses to be dragged', () => {
  const measured = verify(wallNamed(room, 'south').length, parseLength(`20' 1"`), 'sam', T1, 'tape');
  const withTape: Room = {
    ...room,
    walls: room.walls.map((x) => (x.id === 'south' ? { ...x, length: measured } : x)),
  };
  assert.throws(
    () => adjustWall(withTape, 'south', parseLength(`21'`), 'sam', T1),
    (e: unknown) => e instanceof EditError && /quietly replace a measurement with a guess/.test((e as Error).message)
  );
});

test('taking a tape reading back off restores what was under it', () => {
  const measured = verify(wallNamed(room, 'south').length, parseLength(`20' 1"`), 'sam', T1, 'tape');
  const withTape: Room = {
    ...room,
    walls: room.walls.map((x) => (x.id === 'south' ? { ...x, length: measured } : x)),
  };
  const back = unverifyWall(withTape, 'south');
  assert.equal(confidenceLabel(wallNamed(back, 'south').length), 'scanned');
  assert.equal(wallNamed(back, 'south').length.value, parseLength(`20'`));
  // And a wall that was never anything but somebody's word has nothing under it.
  assert.throws(() => unverifyWall(back, 'south'), EditError);
});

test('the room still closes after a drag, because it re-solves like a tape does', () => {
  const { room: moved, adjustments } = adjustWall(room, 'south', parseLength(`21'`), 'sam', T1);
  assert.ok(closes(moved));
  assert.ok(adjustments.some((a) => a.wallId === 'north'), 'the opposite wall took the difference');
});

/* ------------------------------------------------------------- splitting */

test('a split with nothing to tell the pieces apart is refused', () => {
  // Two collinear built walls alike in every way are one wall written twice,
  // and the solver would move both of them to correct one error.
  assert.throws(
    () => splitWall(room, 'north', parseLength(`8'`), 'north-right', {}),
    (e: unknown) =>
      e instanceof EditError && /one wall written twice/.test((e as Error).message)
  );
});

test('a height that equals the ceiling is not a difference, however it is written', () => {
  // The bug this catches: the first piece carries no height (meaning "the
  // room's ceiling") and the second carries an explicit nine feet. As fields
  // those differ; as walls they are identical, and the split would have
  // produced exactly the two indistinguishable walls the rule exists to stop.
  assert.throws(
    () =>
      splitWall(room, 'north', parseLength(`8'`), 'north-right', {
        height: verified(parseLength(`9'`), 'sam', T1, 'tape'),
      }),
    (e: unknown) => e instanceof EditError && /one wall written twice/.test((e as Error).message)
  );
});

test('the second piece carries what makes it a second wall', () => {
  const cut = splitWall(room, 'north', parseLength(`8'`), 'north-right', PONY);
  assert.equal(wallNamed(cut, 'north').height, undefined, 'the first piece is untouched');
  assert.equal(wallNamed(cut, 'north-right').height?.value, parseLength(`3' 6"`));
});

test('a wall splits into two that add back up to it, exactly', () => {
  const cut = splitWall(room, 'north', parseLength(`8'`), 'north-right', PONY);
  assert.equal(runLength(wallNamed(cut, 'north')), parseLength(`8'`));
  assert.equal(runLength(wallNamed(cut, 'north-right')), parseLength(`12'`));
  assert.ok(closes(cut), 'splitting cannot change the shape');
  assert.equal(cut.walls.length, 5);
});

test('a split piece keeps the provenance it had, because a split states nothing new', () => {
  const cut = splitWall(room, 'north', parseLength(`8'`), 'north-right', PONY);
  for (const id of ['north', 'north-right']) {
    assert.equal(confidenceLabel(wallNamed(cut, id).length), 'scanned');
    assert.equal(toleranceOf(wallNamed(cut, id).length), TOL);
  }
});

test('openings land on the piece they are in, with the offset moved', () => {
  // The door is 4 ft along a 20 ft south wall. Cut at 10 ft: it stays on the
  // first piece. Cut at 2 ft: it moves to the second, 2 ft along it.
  const early = splitWall(room, 'south', parseLength(`10'`), 'south-right', PONY);
  assert.equal(wallNamed(early, 'south').openings?.length, 1);
  assert.equal(wallNamed(early, 'south-right').openings, undefined);

  const late = splitWall(room, 'south', parseLength(`2'`), 'south-right', PONY);
  assert.equal(wallNamed(late, 'south').openings, undefined);
  assert.equal(
    wallNamed(late, 'south-right').openings?.[0]?.offsetFromStart.value,
    parseLength(`2'`)
  );
});

test('a cut through a door is refused rather than deciding for somebody', () => {
  assert.throws(
    () => splitWall(room, 'south', parseLength(`5'`), 'south-right', PONY),
    (e: unknown) => e instanceof EditError && /runs through the door "d1"/.test((e as Error).message)
  );
});

test('a cut at the end, past the end, or at a name already taken is refused', () => {
  assert.throws(() => splitWall(room, 'north', 0n, 'x', PONY), EditError);
  assert.throws(() => splitWall(room, 'north', parseLength(`20'`), 'x', PONY), EditError);
  assert.throws(() => splitWall(room, 'north', parseLength(`25'`), 'x', PONY), EditError);
  assert.throws(() => splitWall(room, 'north', parseLength(`8'`), 'south', PONY), EditError);
});

/* -------------------------------------------------- deleting and inserting */

test('deleting a piece gives its length back to the walls on that axis', () => {
  // Not a round trip, and it should not pretend to be one. Cutting the 20 ft
  // north wall at 8 ft and deleting the 12 ft piece leaves the walk 12 ft short
  // running west, and the two east-west walls share the correction in
  // proportion to how unsure the sensor was — equal bands, so 6 ft each. North
  // grows to 14 ft and south shrinks to 14 ft: the room is now 14 x 10.
  //
  // That is a big change and it is exactly why deleting returns the same
  // adjustments a tape does. Nobody should discover it by comparing takeoffs.
  const cut = splitWall(room, 'north', parseLength(`8'`), 'north-right', PONY);
  const { room: back, adjustments } = deleteWall(cut, 'north-right');
  assert.ok(closes(back));
  assert.equal(back.walls.length, 4);

  const gained = adjustments.reduce((sum, a) => sum + (a.by > 0n ? a.by : -a.by), 0n);
  assert.equal(gained, parseLength(`12'`), 'the deleted length is accounted for, all of it');
  assert.equal(runLength(wallNamed(back, 'north')), parseLength(`14'`));
  assert.equal(runLength(wallNamed(back, 'south')), parseLength(`14'`));
});

test('deleting a wall says which walls moved and how far, rather than doing it quietly', () => {
  const cut = splitWall(room, 'north', parseLength(`8'`), 'north-right', PONY);
  const { adjustments } = deleteWall(cut, 'north-right');
  assert.ok(adjustments.length > 0, 'something had to move to close the room back up');
  assert.ok(adjustments.some((a) => a.by !== 0n));
});

test('a wall with a door in it will not be deleted out from under it', () => {
  assert.throws(
    () => deleteWall(room, 'south'),
    (e: unknown) =>
      e instanceof EditError &&
      /a door does not stop existing because the wall it was in was deleted/.test((e as Error).message)
  );
});

test('a four-sided room refuses to become a three-sided one', () => {
  // Deleting a side of a rectangle leaves nothing on that axis to close it, and
  // "this is not a room any more" is the honest answer.
  assert.throws(() => deleteWall(room, 'north'), Error);
});

test('a corner becomes a step, and the room does not change size doing it', () => {
  // The alcove the scanner flattened. East wall is 10 ft running north into the
  // 20 ft north wall running west; notch 2 ft out and 3 ft along and the walk
  // is still 20 ft east-west and 10 ft north-south — the two new walls are paid
  // for by the two they came out of.
  const { room: stepped } = notchCorner(
    room,
    'east',
    { out: parseLength(`2'`), along: parseLength(`3'`), outId: 'alcove-back', alongId: 'alcove-side' },
    'sam',
    T1
  );
  assert.ok(closes(stepped));
  assert.equal(stepped.walls.length, 6);
  assert.equal(runLength(wallNamed(stepped, 'east')), parseLength(`7'`), 'east gave up the 3 ft');
  assert.equal(runLength(wallNamed(stepped, 'north')), parseLength(`18'`), 'north gave up the 2 ft');
  assert.equal(runLength(wallNamed(stepped, 'alcove-back')), parseLength(`2'`));
  assert.equal(runLength(wallNamed(stepped, 'alcove-side')), parseLength(`3'`));
});

test('the new walls of a notch are verified; the shortened ones keep what they were', () => {
  // Somebody saying an alcove is two feet deep is stating a fact about the
  // building. The walls that gave up length are the same walls, shortened, and
  // a shortened scan is still a scan.
  const { room: stepped } = notchCorner(
    room,
    'east',
    { out: parseLength(`2'`), along: parseLength(`3'`), outId: 'a', alongId: 'b' },
    'sam',
    T1
  );
  assert.equal(confidenceLabel(wallNamed(stepped, 'a').length), 'verified');
  assert.equal(confidenceLabel(wallNamed(stepped, 'b').length), 'verified');
  assert.equal(confidenceLabel(wallNamed(stepped, 'east').length), 'scanned');
  assert.equal(toleranceOf(wallNamed(stepped, 'east').length), TOL);
});

test('a notch will not quietly shorten a wall somebody put a tape on', () => {
  // A measurement that changed as a side effect of a different edit is a
  // measurement nobody can rely on.
  const measured = verify(wallNamed(room, 'east').length, parseLength(`10'`), 'sam', T1, 'tape');
  const withTape: Room = {
    ...room,
    walls: room.walls.map((x) => (x.id === 'east' ? { ...x, length: measured } : x)),
  };
  assert.throws(
    () =>
      notchCorner(
        withTape,
        'east',
        { out: parseLength(`2'`), along: parseLength(`3'`), outId: 'a', alongId: 'b' },
        'sam',
        T1
      ),
    (e: unknown) =>
      e instanceof EditError && /side effect of a different edit/.test((e as Error).message)
  );
});

test('a notch bigger than the walls it comes out of is refused, with the sizes', () => {
  const tooDeep = () =>
    notchCorner(
      room,
      'east',
      { out: parseLength(`2'`), along: parseLength(`30'`), outId: 'a', alongId: 'b' },
      'sam',
      T1
    );
  assert.throws(tooDeep, (e: unknown) => e instanceof EditError && /no wall left before the step/.test((e as Error).message));
  assert.throws(
    () =>
      notchCorner(
        room,
        'east',
        { out: parseLength(`20'`), along: parseLength(`3'`), outId: 'a', alongId: 'b' },
        'sam',
        T1
      ),
    (e: unknown) => e instanceof EditError && /no wall left after the step/.test((e as Error).message)
  );
});

test('a step landing inside a door is refused rather than cutting through it', () => {
  // The door is 4 ft along the 20 ft south wall, so a step taking 17 ft off the
  // south wall would start at 3 ft — inside it.
  assert.throws(
    () =>
      notchCorner(
        room,
        'south',
        { out: parseLength(`2'`), along: parseLength(`17'`), outId: 'a', alongId: 'b' },
        'sam',
        T1
      ),
    (e: unknown) => e instanceof EditError && /inside the door "d1"/.test((e as Error).message)
  );
});

test('two new walls with one name, or a name already taken, is refused', () => {
  const bad = (outId: string, alongId: string) => () =>
    notchCorner(
      room,
      'east',
      { out: parseLength(`2'`), along: parseLength(`3'`), outId, alongId },
      'sam',
      T1
    );
  assert.throws(bad('a', 'a'), EditError);
  assert.throws(bad('south', 'b'), EditError);
  assert.throws(bad('a', ''), EditError);
});
