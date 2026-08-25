import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatFeetInches, parseLength } from '../length.ts';
import { isVerified, scanned, verified } from '../measurement.ts';
import { type Heading, type Opening, type Room, type Wall, runLength } from '../room.ts';
import { EditError, verifyOpening, verifyWall } from '../edit.ts';
import { roomQuantities } from '../zone.ts';
import { checkCapture } from '../health.ts';

/**
 * The measurement in a scan most likely to be badly wrong.
 *
 * RoomPlan calls a 16 ft 11 in span a window in Sam's garage. A door in the
 * kitchen came back 2 ft 7 in wide, which nobody could carry a sheet of plywood
 * through. Openings are fitted to whatever was reflective enough to see, and the
 * sizes land anywhere from an inch to a foot off — which is exactly the range
 * that never looks wrong on a screen and is wrong on the order.
 *
 * So an opening has to be correctable by hand like everything else, and the
 * correction has to refuse the things a wall correction cannot: an opening that
 * will not fit in the wall it is in, or under the ceiling above it, or in a
 * stretch another opening is already using.
 */

const T0 = '2026-08-25T11:00:00Z';
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

/** 20 by 10, 8 ft ceiling, a door in the south wall and a window in the north. */
const room: Room = {
  id: 'r1',
  name: 'test room',
  walls: [
    w('south', 'east', `20'`, [opening('door', 'door', `2' 7"`, `6' 8"`, `5'`)]),
    w('east', 'north', `10'`),
    w('north', 'west', `20'`, [opening('win', 'window', `4'`, `3'`, `8'`, `2' 6"`)]),
    w('west', 'south', `10'`),
  ],
  ceilingHeight: verified(parseLength(`8'`), 'sam', T0, 'tape'),
};

const openingIn = (r: Room, wallId: string, id: string) =>
  r.walls.find((x) => x.id === wallId)!.openings!.find((o) => o.id === id)!;

/* -------------------------------------------------------- correcting one */

test('a taped door width is exact from then on, and the old one is kept', () => {
  const fixed = verifyOpening(room, 'south', 'door', { width: parseLength(`3'`) }, 'sam', T0, 'tape');
  const door = openingIn(fixed, 'south', 'door');
  assert.equal(door.width.value, parseLength(`3'`));
  assert.equal(isVerified(door.width), true);
  // Never discarded: the day a client asks what it said before, the app answers.
  assert.equal(
    door.width.provenance.kind === 'verified' ? door.width.provenance.supersedes?.value : null,
    parseLength(`2' 7"`)
  );
  // Everything else about it is untouched.
  assert.equal(door.height.value, parseLength(`6' 8"`));
  assert.equal(door.offsetFromStart.value, parseLength(`5'`));
});

test('correcting an opening does not move a single wall', () => {
  // An opening is a hole in a wall, not a side of the building. The closure sum
  // has never known it was there, and re-solving the room over one would move
  // walls somebody had measured.
  const fixed = verifyOpening(room, 'south', 'door', { width: parseLength(`3'`) }, 'sam', T0, 'tape');
  for (const [i, wall] of room.walls.entries()) {
    assert.equal(runLength(fixed.walls[i]!), runLength(wall), wall.id);
  }
});

test('a wider door takes more off the baseboard and more off the paint', () => {
  const before = roomQuantities(room);
  const fixed = verifyOpening(room, 'south', 'door', { width: parseLength(`3'`) }, 'sam', T0, 'tape');
  const after = roomQuantities(fixed);
  assert.equal(before.baseboardRun - after.baseboardRun, parseLength(`5"`));
  assert.ok(after.wallFaceArea < before.wallFaceArea);
  assert.equal(after.floorArea, before.floorArea, 'the floor is not in the wall');
});

test('a window sill can be given where the scan never had one', () => {
  const bare: Room = {
    ...room,
    walls: room.walls.map((x) =>
      x.id === 'north' ? w('north', 'west', `20'`, [opening('win', 'window', `4'`, `3'`, `8'`)]) : x
    ),
  };
  const fixed = verifyOpening(bare, 'north', 'win', { sillHeight: parseLength(`2' 9"`) }, 'sam', T0, 'tape');
  const win = openingIn(fixed, 'north', 'win');
  assert.equal(win.sillHeight!.value, parseLength(`2' 9"`));
  assert.equal(isVerified(win.sillHeight!), true);
});

test('all four numbers can be given at once', () => {
  const fixed = verifyOpening(
    room,
    'north',
    'win',
    {
      width: parseLength(`5'`),
      height: parseLength(`4'`),
      sillHeight: parseLength(`3'`),
      offsetFromStart: parseLength(`10'`),
    },
    'sam',
    T0,
    'tape'
  );
  const win = openingIn(fixed, 'north', 'win');
  assert.equal(win.width.value, parseLength(`5'`));
  assert.equal(win.height.value, parseLength(`4'`));
  assert.equal(win.sillHeight!.value, parseLength(`3'`));
  assert.equal(win.offsetFromStart.value, parseLength(`10'`));
});

/* ---------------------------------------------------------- what it refuses */

test('an opening that would hang off the end of its wall is refused, with the arithmetic', () => {
  // Not a rounding. Every quantity clips an opening at the wall's end, so a door
  // hanging two feet past the corner quietly takes two feet of trim off a wall
  // it is not in — and the room still adds up.
  assert.throws(
    () => verifyOpening(room, 'south', 'door', { width: parseLength(`16'`) }, 'sam', T0, 'tape'),
    (error: unknown) => {
      assert.ok(error instanceof EditError);
      assert.match(error.message, /1' past the end/);
      assert.match(error.message, /the wall is 20'/);
      return true;
    }
  );
});

test('an opening cannot start before the beginning of its wall', () => {
  assert.throws(
    () => verifyOpening(room, 'south', 'door', { offsetFromStart: -parseLength(`1'`) }, 'sam', T0, 'tape'),
    EditError
  );
});

test('a window whose sill and height put it through the ceiling is refused', () => {
  // 2' 6" sill plus 6' of window is 8' 6" in an 8' room. One of the two is out,
  // and the message says to check them together rather than blaming one.
  assert.throws(
    () => verifyOpening(room, 'north', 'win', { height: parseLength(`6'`) }, 'sam', T0, 'tape'),
    (error: unknown) => {
      assert.ok(error instanceof EditError);
      assert.match(error.message, /8' 6" above the floor/);
      assert.match(error.message, /is 8' high/);
      return true;
    }
  );
});

test('two openings cannot occupy the same stretch of wall', () => {
  const two: Room = {
    ...room,
    walls: room.walls.map((x) =>
      x.id === 'south'
        ? w('south', 'east', `20'`, [
            opening('door', 'door', `3'`, `6' 8"`, `5'`),
            opening('win', 'window', `4'`, `3'`, `12'`, `2' 6"`),
          ])
        : x
    ),
  };
  assert.throws(
    () => verifyOpening(two, 'south', 'door', { width: parseLength(`8'`) }, 'sam', T0, 'tape'),
    (error: unknown) => {
      assert.ok(error instanceof EditError);
      assert.match(error.message, /through "win"/);
      return true;
    }
  );
});

test('nothing zero or negative gets through', () => {
  for (const edit of [{ width: 0n }, { height: 0n }, { width: -parseLength(`1'`) }]) {
    assert.throws(() => verifyOpening(room, 'south', 'door', edit, 'sam', T0, 'tape'), EditError);
  }
});

test('an opening that is not there is named rather than ignored', () => {
  assert.throws(() => verifyOpening(room, 'south', 'nope', { width: 1n }, 'sam', T0, 'tape'), EditError);
  assert.throws(() => verifyOpening(room, 'nope', 'door', { width: 1n }, 'sam', T0, 'tape'), EditError);
});

/* ------------------------------------- what happens when the wall moves instead */

test('measuring a wall shorter can leave a door hanging past it, and that is a stop', () => {
  // Every opening in both real scans fits when it arrives. This is how one stops
  // fitting: somebody puts a tape on the wall and it is shorter than the scan
  // had it. The room is still closed and every number still reconciles, which is
  // exactly why it has to be said out loud.
  const near: Room = {
    ...room,
    walls: room.walls.map((x) =>
      x.id === 'south' ? w('south', 'east', `20'`, [opening('door', 'door', `3'`, `6' 8"`, `16' 6"`)]) : x
    ),
  };
  const { room: shortened } = verifyWall(near, 'south', parseLength(`18'`), 'sam', T0, 'tape');
  const door = openingIn(shortened, 'south', 'door');
  assert.ok(
    door.offsetFromStart.value + door.width.value > runLength(shortened.walls[0]!),
    'the fixture should leave the door hanging'
  );

  const findings = checkCapture({
    room: shortened,
    report: {
      sourceVersion: undefined,
      walls: shortened.walls.map((x) => x.id),
      openSpans: [],
      dropped: [],
      snapped: [],
      diagonals: [],
      closureBeforeSolving: { x: 0n, y: 0n },
      openings: [],
      recoveredSills: [],
      sourceIds: [],
      notes: [],
    },
  });
  const overhang = findings.find((f) => f.what.includes('running past the end'));
  assert.ok(overhang, 'nothing said about a door hanging off the end of its wall');
  assert.equal(overhang.severity, 'stop');
  assert.match(overhang.detail, /the door in south ends 1' 6" past it/);
});

test('and the fix is to say where it really starts', () => {
  const near: Room = {
    ...room,
    walls: room.walls.map((x) =>
      x.id === 'south' ? w('south', 'east', `20'`, [opening('door', 'door', `3'`, `6' 8"`, `16' 6"`)]) : x
    ),
  };
  const { room: shortened } = verifyWall(near, 'south', parseLength(`18'`), 'sam', T0, 'tape');
  const fixed = verifyOpening(shortened, 'south', 'door', { offsetFromStart: parseLength(`14'`) }, 'sam', T0, 'tape');
  const door = openingIn(fixed, 'south', 'door');
  assert.equal(
    formatFeetInches(door.offsetFromStart.value + door.width.value),
    formatFeetInches(runLength(fixed.walls[0]!) - parseLength(`1'`))
  );
});
