import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength } from '../length.ts';
import { history, isVerified, scanned, toleranceOf, verified } from '../measurement.ts';
import {
  type Heading,
  type Opening,
  type Room,
  type Wall,
  area,
  closes,
  diagonal,
  formatSquareFeet,
  isDiagonal,
  runLength,
  runOf,
} from '../room.ts';
import { EditError, makeCased, makeOpen, makeWall, verifyWall } from '../edit.ts';
import { isIssuable, readiness } from '../issue.ts';

const T0 = '2026-08-19T14:00:00Z';
const T1 = '2026-08-21T09:00:00Z';

function w(id: string, heading: Heading, length: string, tol = `2"`): Wall {
  return { id, heading, length: scanned(parseLength(length), parseLength(tol), T0, 'roomplan') };
}

function door(id: string, offset: string): Opening {
  return {
    id,
    kind: 'door',
    width: verified(parseLength(`3'`), 'sam', T1, 'tape'),
    height: verified(parseLength(`6' 8"`), 'sam', T1, 'tape'),
    offsetFromStart: verified(parseLength(offset), 'sam', T1, 'tape'),
  };
}

/**
 * The garage, in miniature: a 20' x 12' box whose east side is a 2' stub, a 8'
 * opening and another 2' stub, all three dead in line. This is the shape that
 * makes closing an opening a merge rather than a flag flip.
 */
function garage(walls?: Wall[]): Room {
  return {
    id: 'g1',
    name: 'garage',
    walls: walls ?? [
      w('south', 'east', `20'`),
      { ...w('stub-a', 'north', `2'`) },
      { ...w('door-opening', 'north', `8'`), open: true },
      { ...w('stub-b', 'north', `2'`) },
      w('north', 'west', `20'`),
      w('west', 'south', `12'`),
    ],
    ceilingHeight: scanned(parseLength(`8'`), parseLength(`2"`), T0, 'roomplan'),
  };
}

/** A plain box, for the edits that do not involve merging. */
function box(walls?: Wall[]): Room {
  return {
    id: 'r1',
    name: 'kitchen',
    walls: walls ?? [
      w('south', 'east', `20'`),
      w('east', 'north', `12'`),
      w('north', 'west', `20'`),
      w('west', 'south', `12'`),
    ],
    ceilingHeight: scanned(parseLength(`8'`), parseLength(`2"`), T0, 'roomplan'),
  };
}

/* -------------------------------------------------------------- open spans */

test('an open span becomes a wall, and the walls in line with it fold in', () => {
  const room = makeWall(garage(), 'door-opening');

  assert.equal(room.walls.length, 4, 'the three collinear segments are now one wall');
  assert.deepEqual(room.walls.map((x) => x.id), ['south', 'stub-a', 'north', 'west']);
  assert.equal(runLength(room.walls[1]!), parseLength(`12'`), '2 + 8 + 2');
  assert.equal(closes(room), true);
  assert.ok(!room.walls.some((x) => x.open));
});

test('merging adds the tolerances, because the merged wall is no surer than its pieces', () => {
  const room = makeWall(garage(), 'door-opening');
  assert.equal(toleranceOf(room.walls[1]!.length), parseLength(`6"`), 'three pieces at 2" each');
});

test('a door in a merged piece keeps its place in the building', () => {
  const withDoor = garage([
    w('south', 'east', `20'`),
    w('stub-a', 'north', `2'`),
    { ...w('door-opening', 'north', `8'`), open: true },
    { ...w('stub-b', 'north', `2'`), openings: [door('side', `6"`)] },
    w('north', 'west', `20'`),
    w('west', 'south', `12'`),
  ]);

  const room = makeWall(withDoor, 'door-opening');
  const merged = room.walls.find((x) => x.id === 'stub-a')!;
  // The door was 6" along the last stub, which now starts 10' down the merged wall.
  assert.equal(merged.openings?.length, 1);
  assert.equal(merged.openings![0]!.offsetFromStart.value, parseLength(`10' 6"`));
});

test('a wall becomes an open span, and its measured length comes with it', () => {
  const room = makeOpen(box(), 'east');
  const open = room.walls.find((x) => x.id === 'east')!;
  assert.equal(open.open, true);
  assert.equal(runLength(open), parseLength(`12'`));
  assert.equal(closes(room), true);
});

test('a wall with a door in it is not quietly emptied to make it an opening', () => {
  const room = box([
    { ...w('south', 'east', `20'`), openings: [door('front', `8'`)] },
    w('east', 'north', `12'`),
    w('north', 'west', `20'`),
    w('west', 'south', `12'`),
  ]);
  assert.throws(
    () => makeOpen(room, 'south'),
    (e: unknown) => e instanceof EditError && /Take it out first if there is really no wall here/.test((e as Error).message)
  );
});

test('the edits refuse what they cannot do, and say which edge', () => {
  assert.throws(() => makeWall(box(), 'east'), (e: unknown) => e instanceof EditError && /already a wall/.test((e as Error).message));
  assert.throws(() => makeOpen(garage(), 'door-opening'), (e: unknown) => e instanceof EditError && /already an open span/.test((e as Error).message));
  assert.throws(() => makeWall(box(), 'nowhere'), (e: unknown) => e instanceof EditError && /no edge called "nowhere"/.test((e as Error).message));
});

/* ------------------------------------------------------------ cased openings */

test('a cased opening is a wall with a header, which is the whole difference', () => {
  const room = makeCased(garage(), 'door-opening');
  const merged = room.walls.find((x) => x.id === 'stub-a')!;

  assert.equal(merged.open, undefined, 'there is a wall here now');
  assert.equal(merged.openings?.length, 1);
  const cased = merged.openings![0]!;
  assert.equal(cased.kind, 'cased');
  assert.equal(cased.width.value, parseLength(`8'`), 'the whole of the edge it replaced');
  assert.equal(cased.offsetFromStart.value, parseLength(`2'`), 'shifted past the stub it merged with');
  assert.equal(closes(room), true);
});

test('a cased opening takes the wall height unless it is given one', () => {
  const room = makeCased(garage(), 'door-opening');
  const cased = room.walls.find((x) => x.id === 'stub-a')!.openings![0]!;
  assert.equal(cased.height.value, parseLength(`8'`));

  const lower = makeCased(garage(), 'door-opening', verified(parseLength(`7'`), 'sam', T1, 'tape'));
  assert.equal(lower.walls.find((x) => x.id === 'stub-a')!.openings![0]!.height.value, parseLength(`7'`));
});

test('an opening taller than the wall it is in is refused', () => {
  assert.throws(
    () => makeCased(garage(), 'door-opening', verified(parseLength(`9'`), 'sam', T1, 'tape')),
    (e: unknown) => e instanceof EditError && /does not fit in a 8' wall/.test((e as Error).message)
  );
});

/* ------------------------------------------------------------ verification */

test('a typed measurement is fixed, and every other wall moves around it', () => {
  const room = box();
  const { room: solved, adjustments } = verifyWall(room, 'south', parseLength(`20' 3"`), 'sam', T1, 'laser');

  const south = solved.walls.find((x) => x.id === 'south')!;
  assert.equal(isVerified(south.length), true);
  assert.equal(south.length.value, parseLength(`20' 3"`));
  assert.equal(toleranceOf(south.length), 0n, 'a measured wall carries no band');

  // The other east-west wall took the whole 3", because it is the only one that
  // can. It runs the other way, so it gets 3" longer to close the same gap.
  const north = solved.walls.find((x) => x.id === 'north')!;
  assert.equal(north.length.value, parseLength(`20' 3"`));
  assert.equal(adjustments.find((a) => a.wallId === 'north')!.by, parseLength(`3"`));
  assert.equal(closes(solved), true);
});

test('the scan the number replaced is kept, not overwritten', () => {
  const { room } = verifyWall(box(), 'south', parseLength(`20' 3"`), 'sam', T1, 'laser');
  const trail = history(room.walls.find((x) => x.id === 'south')!.length);
  assert.equal(trail.length, 2);
  assert.equal(trail[1]!.value, parseLength(`20'`), 'what the scanner said is still there');
});

test('a wall that had to move further than its tolerance is flagged, not hidden', () => {
  const { adjustments } = verifyWall(box(), 'south', parseLength(`20' 6"`), 'sam', T1, 'laser');
  const north = adjustments.find((a) => a.wallId === 'north')!;
  assert.equal(north.by, parseLength(`6"`));
  assert.equal(north.beyondTolerance, true, 'the scanner said 2 inches and it moved six');
});

test('an angled wall keeps its angle when somebody measures its length', () => {
  const chamfered: Room = {
    ...box(),
    walls: [
      w('south', 'east', `12'`),
      w('east', 'north', `6'`),
      {
        id: 'chamfer',
        heading: diagonal(parseLength(`5'`), { x: -3n, y: 4n }),
        length: scanned(parseLength(`5'`), parseLength(`2"`), T0, 'roomplan'),
      },
      w('north', 'west', `9'`),
      w('west', 'south', `10'`),
    ],
  };

  const before = runOf(chamfered.walls[2]!);
  const { room } = verifyWall(chamfered, 'chamfer', parseLength(`5' 6"`), 'sam', T1, 'tape');
  const after = room.walls.find((x) => x.id === 'chamfer')!;

  assert.ok(isDiagonal(after.heading));
  assert.equal(runLength(after), parseLength(`5' 6"`), 'the new length');
  // Same direction: the run grew in proportion, so the cross product stays zero.
  const now = runOf(after);
  assert.equal(before.x * now.y - before.y * now.x, 0n, 'the angle did not move');
  assert.equal(closes(room), true);
});

test('a measurement of nothing is refused', () => {
  assert.throws(() => verifyWall(box(), 'south', 0n, 'sam', T1, 'tape'), EditError);
  assert.throws(() => verifyWall(box(), 'south', parseLength(`-3'`), 'sam', T1, 'tape'), EditError);
});

/* ----------------------------------------------------- the loop, end to end */

test('two tapes take a scan from refused to issuable, on screen', () => {
  const scanRoom = box();
  assert.equal(isIssuable(scanRoom), false);

  const first = verifyWall(scanRoom, 'south', parseLength(`20' 1"`), 'sam', T1, 'laser').room;
  assert.equal(isIssuable(first), false, 'one axis is still nobody\'s number');
  assert.equal(readiness(first).blocking.length, 1);

  const second = verifyWall(first, 'east', parseLength(`12' 2"`), 'sam', T1, 'laser').room;
  assert.equal(isIssuable(second), true);
  assert.equal(readiness(second).trust, 'partly-verified');
  assert.equal(closes(second), true);

  // And the first tape is still exactly what was typed: solving for the second
  // never moved it.
  assert.equal(second.walls.find((x) => x.id === 'south')!.length.value, parseLength(`20' 1"`));
});

test('an edit leaves the room it started from untouched, so undo is free', () => {
  const before = garage();
  const after = makeWall(before, 'door-opening');
  assert.equal(before.walls.length, 6);
  assert.equal(after.walls.length, 4);
  assert.equal(before.walls[2]!.open, true, 'the original is unchanged');
});

test('turning an opening into a wall changes what is built, not the room', () => {
  const before = garage();
  const after = makeWall(before, 'door-opening');
  assert.equal(area(after).value, area(before).value, '20 x 12 either way');
  assert.equal(formatSquareFeet(area(after).value), '240.0 sq ft');
});
