import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatFeetInches, parseLength } from '../length.ts';
import { history, isVerified, toleranceOf } from '../measurement.ts';
import { area, closes, formatSquareFeet } from '../room.ts';
import {
  DraftError,
  addWall,
  finish,
  remaining,
  removeWall,
  reviseWall,
  startDraft,
  suggestClosingWall,
} from '../draft.ts';

const T0 = '2026-08-20T09:00:00Z';
const T1 = '2026-08-20T09:30:00Z';

function kitchen() {
  return startDraft({
    id: 'r1', name: 'kitchen', enteredBy: 'sam', at: T0, ceilingHeight: `8'`,
  });
}

test('a room is built from what somebody types, not what a sensor guessed', () => {
  let d = kitchen();
  d = addWall(d, 'north', 'east', `12' 4 1/2"`, T0);
  d = addWall(d, 'east', 'north', `9' 11 7/8"`, T0);
  d = addWall(d, 'south', 'west', `12' 4 1/2"`, T0);
  d = addWall(d, 'west', 'south', `9' 11 7/8"`, T0);

  const room = finish(d);
  assert.equal(closes(room), true);
  assert.equal(room.walls.length, 4);
  // Everything a person typed is verified, and carries no band.
  for (const w of room.walls) assert.equal(isVerified(w.length), true);
  assert.equal(formatFeetInches(room.walls[0]!.length.value), `12' 4 1/2"`);
});

test('it tells you what is left to close, as you go', () => {
  let d = kitchen();
  assert.equal(remaining(d).closes, true); // nothing entered yet

  d = addWall(d, 'north', 'east', `12'`, T0);
  assert.equal(remaining(d).x, -parseLength(`12'`)); // 12 feet back west
  assert.equal(remaining(d).closes, false);

  d = addWall(d, 'east', 'north', `10'`, T0);
  assert.equal(remaining(d).y, -parseLength(`10'`));
});

test('the last wall is worked out rather than asked for', () => {
  let d = kitchen();
  d = addWall(d, 'north', 'east', `12'`, T0);
  d = addWall(d, 'east', 'north', `10'`, T0);
  d = addWall(d, 'south', 'west', `12'`, T0);

  const suggestion = suggestClosingWall(d);
  assert.ok(suggestion, 'with one run outstanding the closing wall is determined');
  assert.equal(suggestion!.heading, 'south');
  assert.equal(formatFeetInches(suggestion!.length), `10'`);

  d = addWall(d, 'west', suggestion!.heading, formatFeetInches(suggestion!.length), T0);
  assert.equal(closes(finish(d)), true);
});

test('it refuses to invent a wall when two runs are still open', () => {
  let d = kitchen();
  d = addWall(d, 'north', 'east', `12'`, T0);
  d = addWall(d, 'east', 'north', `10'`, T0);
  // Both axes outstanding: many rooms would close, so choosing one is inventing.
  assert.equal(suggestClosingWall(d), null);
});

test('it will not suggest a wall that fails to turn a corner', () => {
  let d = kitchen();
  d = addWall(d, 'a', 'east', `12'`, T0);
  d = addWall(d, 'b', 'north', `10'`, T0);
  d = addWall(d, 'c', 'west', `12'`, T0);
  d = addWall(d, 'd', 'south', `4'`, T0);
  // Six feet of north still outstanding, but the last wall already runs north-south.
  assert.equal(suggestClosingWall(d), null);
});

test('two walls running the same way are caught as they are entered', () => {
  let d = kitchen();
  d = addWall(d, 'north', 'east', `12'`, T0);
  assert.throws(() => addWall(d, 'more', 'east', `3'`, T0), /so does the wall before it/);
  assert.throws(() => addWall(d, 'back', 'west', `3'`, T0), /so does the wall before it/);
});

test('a correction keeps what the number was before', () => {
  let d = kitchen();
  d = addWall(d, 'north', 'east', `12'`, T0);
  d = reviseWall(d, 'north', `12' 2 1/2"`, T1, { note: 'measured again at the far end' });

  const wall = d.walls[0]!;
  assert.equal(wall.length.value, parseLength(`12' 2 1/2"`));
  const trail = history(wall.length);
  assert.equal(trail.length, 2);
  assert.equal(trail[1]?.value, parseLength(`12'`));
});

test('walls can be removed and the room re-entered', () => {
  let d = kitchen();
  d = addWall(d, 'a', 'east', `12'`, T0);
  d = addWall(d, 'b', 'north', `10'`, T0);
  d = removeWall(d, 'b');
  assert.equal(d.walls.length, 1);
  assert.throws(() => removeWall(d, 'nope'), DraftError);
});

test('duplicate names and impossible lengths are refused', () => {
  let d = kitchen();
  d = addWall(d, 'north', 'east', `12'`, T0);
  assert.throws(() => addWall(d, 'north', 'north', `10'`, T0), /already has a wall/);
  assert.throws(() => addWall(d, 'x', 'north', `0"`, T0), DraftError);
});

test('a room that does not close says by how much, and does not guess', () => {
  let d = kitchen();
  d = addWall(d, 'north', 'east', `12'`, T0);
  d = addWall(d, 'east', 'north', `10'`, T0);
  d = addWall(d, 'south', 'west', `11'`, T0);   // a foot short
  d = addWall(d, 'west', 'south', `10'`, T0);

  assert.throws(() => finish(d), (err: unknown) => {
    assert.ok(err instanceof DraftError);
    const message = (err as Error).message;
    assert.match(message, /does not close/);
    assert.match(message, /east/);
    assert.match(message, /one of them is wrong/);
    return true;
  });
});

test('a draft that is not yet a room is refused with a reason', () => {
  let d = kitchen();
  assert.throws(() => finish(d), /needs at least four/);
  d = addWall(d, 'a', 'east', `12'`, T0);
  d = addWall(d, 'b', 'north', `10'`, T0);
  d = addWall(d, 'c', 'west', `12'`, T0);
  assert.throws(() => finish(d), /needs at least four/);
});

test('the first and last wall have to turn a corner into each other', () => {
  let d = kitchen();
  d = addWall(d, 'a', 'east', `10'`, T0);
  d = addWall(d, 'b', 'north', `10'`, T0);
  d = addWall(d, 'c', 'west', `5'`, T0);
  d = addWall(d, 'd', 'south', `10'`, T0);
  d = addWall(d, 'e', 'west', `5'`, T0);
  assert.throws(() => finish(d), /same way as the first/);
});

test('an L-shaped room can be typed in as easily as a rectangle', () => {
  let d = startDraft({ id: 'r2', name: 'great room', enteredBy: 'sam', at: T0, ceilingHeight: `9'` });
  d = addWall(d, 'a', 'east', `16'`, T0);
  d = addWall(d, 'b', 'north', `7'`, T0);
  d = addWall(d, 'c', 'west', `6'`, T0);
  d = addWall(d, 'd', 'north', `5'`, T0);
  d = addWall(d, 'e', 'west', `10'`, T0);
  d = addWall(d, 'f', 'south', `12'`, T0);

  const room = finish(d);
  assert.equal(closes(room), true);
  assert.equal(formatSquareFeet(area(room).value, 0), '162 sq ft');
});

test('a typed room has no uncertainty anywhere in it', () => {
  let d = kitchen();
  d = addWall(d, 'a', 'east', `12'`, T0);
  d = addWall(d, 'b', 'north', `10'`, T0);
  d = addWall(d, 'c', 'west', `12'`, T0);
  d = addWall(d, 'd', 'south', `10'`, T0);
  const room = finish(d);
  // Nothing was scanned, so the area carries no band at all.
  const measured = area(room);
  assert.equal(measured.provenance.kind, 'derived');
  assert.equal(toleranceOf(measured), 0n);
});

test('bare numbers mean feet here, because that is what the field says', () => {
  let d = kitchen();
  d = addWall(d, 'a', 'east', '12', T0);
  assert.equal(d.walls[0]!.length.value, parseLength(`12'`));
  d = addWall(d, 'b', 'north', '10', T0, { defaultUnit: 'in' });
  assert.equal(d.walls[1]!.length.value, parseLength(`10"`));
});

test('the closing wall the app suggests closes the room exactly', () => {
  // The suggestion is worked out to the nanometre. Anything that rounds it on
  // the way back in — formatting it to a sixteenth for a text field and parsing
  // that — loses up to a thirty-second, and then the room does not close and
  // `finish()` refuses it over a wall nobody typed. A room whose closing run is
  // 13' 5 7/32" is enough to do it.
  const odd = addWall(
    addWall(
      addWall(
        startDraft({
          id: 'd',
          name: 'odd',
          enteredBy: 'sam',
          at: T0,
          ceilingHeight: `8'`,
        }),
        'a',
        'east',
        `13' 5 7/32"`,
        T0
      ),
      'b',
      'north',
      `9' 1 3/32"`,
      T0
    ),
    'c',
    'west',
    `13' 5 7/32"`,
    T0
  );

  const closing = suggestClosingWall(odd)!;
  assert.ok(closing, 'three walls of a rectangle determine the fourth');

  // Exactly as the screen passes it: the value, not the label on the button.
  const finished = finish(addWall(odd, 'd', closing.heading, `${closing.length}nm`, T0));
  assert.equal(closes(finished), true);

  // And the lossy way round, written down so nobody reintroduces it.
  assert.throws(
    () => finish(addWall(odd, 'd', closing.heading, formatFeetInches(closing.length), T0)),
    DraftError
  );
});
