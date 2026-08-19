import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, formatFeetInches, parseLength } from '../length.ts';
import { scanned, toleranceOf, verified, verify } from '../measurement.ts';
import {
  type Heading,
  type Room,
  type Wall,
  ClosureConflict,
  RoomError,
  area,
  closes,
  closure,
  corners,
  formatSquareFeet,
  perimeter,
  solve,
  validate,
  verificationPunchList,
} from '../room.ts';

const T0 = '2026-08-19T14:00:00Z';
const T1 = '2026-08-19T15:30:00Z';

function scan(id: string, heading: Heading, length: string, tol: string): Wall {
  return { id, heading, length: scanned(parseLength(length), parseLength(tol), T0, 'roomplan') };
}

function tape(id: string, heading: Heading, length: string): Wall {
  return { id, heading, length: verified(parseLength(length), 'sam', T1, 'tape') };
}

function room(walls: Wall[], name = 'kitchen'): Room {
  return {
    id: 'r1',
    name,
    walls,
    ceilingHeight: scanned(parseLength(`8'`), parseLength(`1/2"`), T0, 'roomplan'),
  };
}

/** A 12' x 10' rectangle that already closes. */
function perfectRectangle(): Room {
  return room([
    scan('north', 'east', `12'`, `1"`),
    scan('east', 'north', `10'`, `1"`),
    scan('south', 'west', `12'`, `1"`),
    scan('west', 'south', `10'`, `1"`),
  ]);
}

test('a room that already closes is left alone', () => {
  const r = perfectRectangle();
  assert.equal(closes(r), true);
  const { room: solved, adjustments } = solve(r);
  assert.equal(adjustments.length, 0);
  assert.deepEqual(
    solved.walls.map((w) => w.length.value),
    r.walls.map((w) => w.length.value)
  );
});

test('corners walk the walls and come back to the start', () => {
  const points = corners(perfectRectangle());
  assert.equal(points.length, 4);
  assert.deepEqual(points[0], { x: 0n, y: 0n });
  assert.deepEqual(points[1], { x: parseLength(`12'`), y: 0n });
  assert.deepEqual(points[2], { x: parseLength(`12'`), y: parseLength(`10'`) });
  assert.deepEqual(points[3], { x: 0n, y: parseLength(`10'`) });
});

test('scan error is shared out and the room closes exactly', () => {
  // The two east-west walls disagree by 3/4" — a normal RoomPlan result.
  const r = room([
    scan('north', 'east', `12' 3/4"`, `1"`),
    scan('east', 'north', `10'`, `1"`),
    scan('south', 'west', `12'`, `1"`),
    scan('west', 'south', `10'`, `1"`),
  ]);
  assert.equal(closure(r).x, parseLength(`3/4"`));

  const { room: solved, adjustments } = solve(r);
  assert.equal(closes(solved), true);
  assert.equal(closure(solved).x, 0n);
  assert.equal(adjustments.length, 2);
  // Equal tolerances, so the discrepancy splits down the middle: each gives 3/8".
  const north = solved.walls.find((w) => w.id === 'north')!;
  const south = solved.walls.find((w) => w.id === 'south')!;
  assert.equal(north.length.value, parseLength(`12' 3/8"`));
  assert.equal(south.length.value, parseLength(`12' 3/8"`));
});

test('the wall the sensor was least sure of gives the most ground', () => {
  const r = room([
    scan('north', 'east', `12' 1"`, `2"`), // three times as unsure
    scan('east', 'north', `10'`, `1"`),
    scan('south', 'west', `12'`, `1/2"`),
    scan('west', 'south', `10'`, `1"`),
  ]);
  const { room: solved } = solve(r);
  assert.equal(closes(solved), true);
  const north = solved.walls.find((w) => w.id === 'north')!;
  const south = solved.walls.find((w) => w.id === 'south')!;
  const northMoved = north.length.value - parseLength(`12' 1"`);
  const southMoved = south.length.value - parseLength(`12'`);
  // North was trusted least, so it absorbs more of the correction.
  assert.ok(
    (northMoved < 0n ? -northMoved : northMoved) > (southMoved < 0n ? -southMoved : southMoved),
    'the less certain wall did not absorb more'
  );
});

test('typing one real number moves every other wall, and never that one', () => {
  const before = perfectRectangle();
  const north = before.walls.find((w) => w.id === 'north')!;

  // Sam puts a tape on the north wall: it is really 12' 2 1/2", not 12'.
  const corrected: Room = {
    ...before,
    walls: before.walls.map((w) =>
      w.id === 'north'
        ? { ...w, length: verify(north.length, parseLength(`12' 2 1/2"`), 'sam', T1, 'tape') }
        : w
    ),
  };

  const { room: solved, adjustments } = solve(corrected);
  assert.equal(closes(solved), true);

  // The wall he measured is untouched.
  const solvedNorth = solved.walls.find((w) => w.id === 'north')!;
  assert.equal(solvedNorth.length.value, parseLength(`12' 2 1/2"`));
  assert.equal(adjustments.some((a) => a.wallId === 'north'), false);

  // The opposite wall took the whole correction, because it is the only one left on that axis.
  const solvedSouth = solved.walls.find((w) => w.id === 'south')!;
  assert.equal(solvedSouth.length.value, parseLength(`12' 2 1/2"`));

  // And the walls on the other axis were not disturbed at all.
  assert.equal(solved.walls.find((w) => w.id === 'east')!.length.value, parseLength(`10'`));
  assert.equal(solved.walls.find((w) => w.id === 'west')!.length.value, parseLength(`10'`));
});

test('a wall pushed past its own tolerance is flagged, not hidden', () => {
  const r = room([
    scan('north', 'east', `12' 6"`, `1/4"`),
    scan('east', 'north', `10'`, `1"`),
    scan('south', 'west', `12'`, `1/4"`),
    scan('west', 'south', `10'`, `1"`),
  ]);
  const { adjustments } = solve(r);
  const flagged = adjustments.filter((a) => a.beyondTolerance);
  assert.equal(flagged.length, 2, 'a 6" discrepancy across 1/4" tolerances went unflagged');
});

test('two human statements that contradict each other are raised, not averaged', () => {
  const r = room([
    tape('north', 'east', `12'`),
    scan('east', 'north', `10'`, `1"`),
    tape('south', 'west', `11' 6"`),
    scan('west', 'south', `10'`, `1"`),
  ]);
  assert.throws(
    () => solve(r),
    (err: unknown) => {
      assert.ok(err instanceof ClosureConflict);
      assert.equal(err.axis, 'x');
      assert.deepEqual([...err.wallIds].sort(), ['north', 'south']);
      assert.match(err.message, /verified by a person/);
      return true;
    }
  );
});

test('an L-shaped room closes too', () => {
  // 16' x 12' with a 6' x 5' bite out of one corner.
  const r = room(
    [
      scan('a', 'east', `16'`, `1"`),
      scan('b', 'north', `7'`, `1"`),
      scan('c', 'west', `6'`, `1"`),
      scan('d', 'north', `5'`, `1"`),
      scan('e', 'west', `10'`, `1"`),
      scan('f', 'south', `12'`, `1"`),
    ],
    'great room'
  );
  assert.equal(closes(r), true);
  assert.equal(corners(r).length, 6);
  const { adjustments } = solve(r);
  assert.equal(adjustments.length, 0);
});

test('an L-shaped room with scan error still closes exactly', () => {
  const r = room(
    [
      scan('a', 'east', `16' 1/2"`, `1"`),
      scan('b', 'north', `7'`, `1"`),
      scan('c', 'west', `6'`, `1"`),
      scan('d', 'north', `5' 1/4"`, `1"`),
      scan('e', 'west', `10'`, `1"`),
      scan('f', 'south', `12'`, `1"`),
    ],
    'great room'
  );
  const { room: solved } = solve(r);
  assert.equal(closes(solved), true);
  assert.deepEqual(closure(solved), { x: 0n, y: 0n });
});

test('area is exact, and reads in square feet', () => {
  const a = area(perfectRectangle());
  assert.equal(formatSquareFeet(a.value), '120.0 sq ft');
  assert.equal(formatSquareFeet(a.value, 0), '120 sq ft');
});

test('area of the L-shaped room is the rectangle less the bite', () => {
  const r = room(
    [
      scan('a', 'east', `16'`, `1"`),
      scan('b', 'north', `7'`, `1"`),
      scan('c', 'west', `6'`, `1"`),
      scan('d', 'north', `5'`, `1"`),
      scan('e', 'west', `10'`, `1"`),
      scan('f', 'south', `12'`, `1"`),
    ],
    'great room'
  );
  // 16x7 + 10x5 = 112 + 50 = 162
  assert.equal(formatSquareFeet(area(r).value, 0), '162 sq ft');
});

test('putting a tape on a wall visibly tightens the area on screen', () => {
  const before = area(perfectRectangle());

  const r = perfectRectangle();
  const north = r.walls.find((w) => w.id === 'north')!;
  const tightened: Room = {
    ...r,
    walls: r.walls.map((w) =>
      w.id === 'north' ? { ...w, length: verify(north.length, parseLength(`12'`), 'sam', T1, 'tape') } : w
    ),
  };
  const after = area(solve(tightened).room);

  assert.ok(toleranceOf(after) < toleranceOf(before), 'verifying a wall did not tighten the area');
});

test('the punch list names the wall worth measuring first', () => {
  const r = room([
    scan('north', 'east', `20'`, `2"`), // longest and least certain — most area at stake
    scan('east', 'north', `10'`, `1"`),
    scan('south', 'west', `20'`, `1/4"`),
    scan('west', 'south', `10'`, `1"`),
  ]);
  const list = verificationPunchList(r);
  assert.equal(list[0]?.wallId, 'north');
  assert.equal(list.length, 4);

  // Once it is verified it drops off the list entirely.
  const north = r.walls.find((w) => w.id === 'north')!;
  const done: Room = {
    ...r,
    walls: r.walls.map((w) =>
      w.id === 'north' ? { ...w, length: verify(north.length, parseLength(`20'`), 'sam', T1, 'tape') } : w
    ),
  };
  assert.equal(verificationPunchList(done).some((w) => w.wallId === 'north'), false);
});

test('perimeter carries the uncertainty of the walls it added up', () => {
  const p = perimeter(perfectRectangle());
  assert.equal(p.value, parseLength(`44'`));
  assert.equal(toleranceOf(p), parseLength(`4"`));
});

test('a room that is not a room is refused with a reason', () => {
  assert.throws(() => validate(room([scan('a', 'east', `1'`, `1"`)])), RoomError);
  assert.throws(
    () =>
      validate(
        room([
          scan('a', 'east', `12'`, `1"`),
          scan('b', 'east', `10'`, `1"`),
          scan('c', 'west', `12'`, `1"`),
          scan('d', 'west', `10'`, `1"`),
        ])
      ),
    /turns a corner/
  );
  assert.throws(
    () =>
      validate(
        room([
          scan('a', 'east', `12'`, `1"`),
          scan('a', 'north', `10'`, `1"`),
          scan('c', 'west', `12'`, `1"`),
          scan('d', 'south', `10'`, `1"`),
        ])
      ),
    /share the id/
  );
});

test('closing a room can never quietly shrink a wall out of existence', () => {
  // Two walls on an axis always resolve to each other, so a wall can only be
  // driven negative when three or more share an axis and the verified ones
  // leave nothing for the movable one. An L-shape whose verified east run is
  // shorter than its verified west run does exactly that.
  const r = room(
    [
      tape('a', 'east', `6'`),
      scan('b', 'north', `7'`, `1"`),
      tape('c', 'west', `10'`),
      scan('d', 'north', `5'`, `1"`),
      scan('e', 'west', `4'`, `1"`),
      scan('f', 'south', `12'`, `1"`),
    ],
    'impossible room'
  );
  assert.throws(() => solve(r), (err: unknown) => {
    assert.ok(err instanceof RoomError);
    assert.match((err as Error).message, /cannot all be right/);
    return true;
  });
});

test('every closed room stays closed to the nanometre, whatever the error', () => {
  // Sweep a range of discrepancies and weightings; the invariant never bends.
  for (let err = -37; err <= 37; err += 1) {
    for (const tol of [`1/8"`, `1"`, `3"`]) {
      const r = room([
        { ...scan('north', 'east', `12'`, tol),
          length: scanned(parseLength(`12'`) + BigInt(err) * 1000n, parseLength(tol), T0, 'roomplan') },
        scan('east', 'north', `10'`, tol),
        scan('south', 'west', `12'`, tol),
        scan('west', 'south', `10'`, tol),
      ]);
      const { room: solved } = solve(r);
      assert.deepEqual(closure(solved), { x: 0n, y: 0n }, `failed at err=${err} tol=${tol}`);
      assert.equal(
        add(...solved.walls.map((w) => w.length.value)) > 0n,
        true
      );
    }
  }
});
