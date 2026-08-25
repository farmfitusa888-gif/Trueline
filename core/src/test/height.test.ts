import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength } from '../length.ts';
import { isVerified, scanned } from '../measurement.ts';
import type { Heading, Opening, Room, Wall } from '../room.ts';
import { EditError, setWallHeight, verifyCeiling, verifyOpening } from '../edit.ts';
import { roomQuantities } from '../zone.ts';

/**
 * How high the room is, and the one wall that is not.
 *
 * The import takes the ceiling from the tallest wall in the scan, on the
 * reasoning that a shorter one is a pony wall or a soffit rather than the room
 * getting lower. That is the right guess — Sam's kitchen has one wall at 2.13 m
 * among seven at 2.4257 m — and it is still a guess carrying the sensor's band,
 * and it multiplies every square foot of drywall and paint in the room. Two
 * inches over 80 ft of wall is 13 sq ft of board and two coats on it.
 */

const T0 = '2026-08-25T12:00:00Z';
const scan = (text: string) => scanned(parseLength(text), parseLength(`50mm`), T0, 'roomplan');

function w(id: string, heading: Heading, length: string, openings?: Opening[]): Wall {
  return { id, heading, length: scan(length), ...(openings ? { openings } : {}) };
}

function opening(id: string, kind: Opening['kind'], width: string, height: string, at: string, sill?: string): Opening {
  return {
    id,
    kind,
    width: scan(width),
    height: scan(height),
    offsetFromStart: scan(at),
    ...(sill ? { sillHeight: scan(sill) } : {}),
  };
}

/** 20 by 10, ceiling scanned at 8 ft, a 6'8" door and a window with a 2'6" sill. */
const room: Room = {
  id: 'r1',
  name: 'test room',
  walls: [
    w('south', 'east', `20'`, [opening('door', 'door', `3'`, `6' 8"`, `5'`)]),
    w('east', 'north', `10'`),
    w('north', 'west', `20'`, [opening('win', 'window', `4'`, `3'`, `8'`, `2' 6"`)]),
    w('west', 'south', `10'`),
  ],
  ceilingHeight: scan(`8'`),
};

const FT2 = parseLength(`1'`) * parseLength(`1'`);

test('a measured ceiling is exact from then on, and keeps what it replaced', () => {
  const fixed = verifyCeiling(room, parseLength(`9'`), 'sam', T0, 'tape');
  assert.equal(fixed.ceilingHeight.value, parseLength(`9'`));
  assert.equal(isVerified(fixed.ceilingHeight), true);
  assert.equal(
    fixed.ceilingHeight.provenance.kind === 'verified'
      ? fixed.ceilingHeight.provenance.supersedes?.value
      : null,
    parseLength(`8'`)
  );
});

test('a foot on the ceiling is sixty square feet of board, and no floor at all', () => {
  const before = roomQuantities(room);
  const after = roomQuantities(verifyCeiling(room, parseLength(`9'`), 'sam', T0, 'tape'));
  // 60 ft of wall, one more foot high.
  assert.equal((after.wallFaceArea - before.wallFaceArea) / FT2, 60n);
  assert.equal(after.floorArea, before.floorArea, 'the floor does not know how high the room is');
  assert.equal(after.baseboardRun, before.baseboardRun, 'nor does the baseboard');
});

test('a ceiling below something already in a wall is refused, and says what', () => {
  // The window tops out at 5'6"; the door at 6'8". A 6 ft ceiling puts the door
  // through it, and the message has to name which one rather than just failing.
  assert.throws(
    () => verifyCeiling(room, parseLength(`6'`), 'sam', T0, 'tape'),
    (error: unknown) => {
      assert.ok(error instanceof EditError);
      assert.match(error.message, /the door in south tops out at 6' 8"/);
      assert.doesNotMatch(error.message, /window/, 'the window fits under 6 ft and is not at fault');
      return true;
    }
  );
});

test('a ceiling of nothing is not a ceiling', () => {
  assert.throws(() => verifyCeiling(room, 0n, 'sam', T0, 'tape'), EditError);
});

/* ---------------------------------------------------------------- pony walls */

test('a wall can be shorter than the room, and only that wall loses the board', () => {
  const before = roomQuantities(room);
  const pony = setWallHeight(room, 'east', parseLength(`3' 6"`), 'sam', T0, 'tape');
  const after = roomQuantities(pony);
  // The east wall is 10 ft, and it lost 4'6" of its 8 ft height: 45 sq ft.
  assert.equal((before.wallFaceArea - after.wallFaceArea) / FT2, 45n);
  assert.equal(after.baseboardRun, before.baseboardRun, 'a breakfast bar still takes base');
  assert.equal(after.floorArea, before.floorArea);
});

test('putting a wall back to full height deletes the key rather than setting it', () => {
  // Left behind as `undefined`, it reads as a height everywhere that spreads the
  // wall — which is how a full-height wall inherited a pony wall's height once
  // already, and 16.8 sq ft of drywall left the takeoff without a word.
  const pony = setWallHeight(room, 'east', parseLength(`3' 6"`), 'sam', T0, 'tape');
  const back = setWallHeight(pony, 'east', undefined, 'sam', T0, 'tape');
  assert.equal('height' in back.walls[1]!, false);
  assert.deepEqual(roomQuantities(back), roomQuantities(room));
});

test('a wall taller than its own room is refused', () => {
  assert.throws(
    () => setWallHeight(room, 'east', parseLength(`10'`), 'sam', T0, 'tape'),
    (error: unknown) => {
      assert.ok(error instanceof EditError);
      assert.match(error.message, /measure the ceiling first/);
      return true;
    }
  );
});

test('a wall cannot be dropped below what is already in it', () => {
  assert.throws(
    () => setWallHeight(room, 'south', parseLength(`5'`), 'sam', T0, 'tape'),
    (error: unknown) => {
      assert.ok(error instanceof EditError);
      assert.match(error.message, /the door in south tops out at 6' 8"/);
      return true;
    }
  );
});

test('an open span has no height, and asking for one says why', () => {
  const garage: Room = {
    ...room,
    walls: room.walls.map((x) => (x.id === 'east' ? { ...x, open: true as const } : x)),
  };
  assert.throws(
    () => setWallHeight(garage, 'east', parseLength(`4'`), 'sam', T0, 'tape'),
    (error: unknown) => {
      assert.ok(error instanceof EditError);
      assert.match(error.message, /make it a wall first/);
      return true;
    }
  );
});

test('a pony wall and its opening are checked against each other, both ways round', () => {
  // Set the wall low, then try to put something tall in it. The two functions
  // ask the same question from either end and both have to refuse.
  const bar = setWallHeight(room, 'east', parseLength(`4'`), 'sam', T0, 'tape');
  const withHatch: Room = {
    ...bar,
    walls: bar.walls.map((x) =>
      x.id === 'east' ? { ...x, openings: [opening('hatch', 'cased', `3'`, `2'`, `2'`)] } : x
    ),
  };
  assert.throws(
    () => verifyOpening(withHatch, 'east', 'hatch', { height: parseLength(`5'`) }, 'sam', T0, 'tape'),
    EditError
  );
  // And under the pony wall's own height it is fine.
  const ok = verifyOpening(withHatch, 'east', 'hatch', { height: parseLength(`3'`) }, 'sam', T0, 'tape');
  assert.equal(ok.walls[1]!.openings![0]!.height.value, parseLength(`3'`));
});

test('raising the ceiling leaves a pony wall where it is', () => {
  const bar = setWallHeight(room, 'east', parseLength(`3' 6"`), 'sam', T0, 'tape');
  const taller = verifyCeiling(bar, parseLength(`10'`), 'sam', T0, 'tape');
  assert.equal(taller.walls[1]!.height!.value, parseLength(`3' 6"`), 'a breakfast bar is not the ceiling');
  const q = roomQuantities(taller);
  // 50 ft of full-height wall at 10 ft, plus 10 ft of bar at 3'6", less the
  // door (3 x 6'8" = 20) and the window (4 x 3 = 12).
  assert.equal(q.wallFaceArea / FT2, 500n + 35n - 20n - 12n);
});

test('a ceiling nobody measured still says so', () => {
  assert.equal(isVerified(room.ceilingHeight), false);
  const fixed = verifyCeiling(room, parseLength(`8'`), 'sam', T0, 'stated');
  assert.equal(isVerified(fixed.ceilingHeight), true);
  assert.equal(
    fixed.ceilingHeight.provenance.kind === 'verified' ? fixed.ceilingHeight.provenance.method : null,
    'stated'
  );
});
