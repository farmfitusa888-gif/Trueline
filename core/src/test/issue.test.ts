import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength } from '../length.ts';
import { scanned, verified } from '../measurement.ts';
import { type Heading, type Opening, type Room, type Wall, closes } from '../room.ts';
import {
  NotIssuable,
  assertIssuable,
  axisReadiness,
  closedWithoutBeingChecked,
  isIssuable,
  readiness,
  trustLabel,
  unseenError,
} from '../issue.ts';
import { toRenderModel } from '../render.ts';

const T0 = '2026-08-19T14:00:00Z';
const T1 = '2026-08-19T15:30:00Z';

function scan(id: string, heading: Heading, length: string, tol = `2"`, openings?: Opening[]): Wall {
  return {
    id,
    heading,
    length: scanned(parseLength(length), parseLength(tol), T0, 'roomplan'),
    ...(openings ? { openings } : {}),
  };
}

function taped(id: string, heading: Heading, length: string, openings?: Opening[]): Wall {
  return {
    id,
    heading,
    length: verified(parseLength(length), 'sam', T1, 'tape'),
    ...(openings ? { openings } : {}),
  };
}

/**
 * A room straight off a scanner: every wall the sensor's number, and it closes
 * perfectly, because that is what both of Sam's real RoomPlan exports do.
 */
function imported(walls?: Wall[]): Room {
  return {
    id: 'r1',
    name: 'kitchen',
    walls: walls ?? [
      scan('south', 'east', `20'`),
      scan('east', 'north', `12'`),
      scan('north', 'west', `20'`),
      scan('west', 'south', `12'`),
    ],
    ceilingHeight: scanned(parseLength(`7' 11 1/2"`), parseLength(`2"`), T0, 'roomplan'),
  };
}

/* ------------------------------------------------------------- the trap */

test('a scan closes perfectly and that is exactly why it cannot be trusted', () => {
  const r = imported();
  assert.equal(closes(r), true, 'the polygon arrives already closed');
  assert.equal(closedWithoutBeingChecked(r), true);
  assert.equal(isIssuable(r), false);
});

test('a room drawn by hand also closes exactly, and that does mean something', () => {
  const drawn = imported([
    taped('south', 'east', `20'`),
    taped('east', 'north', `12'`),
    taped('north', 'west', `20'`),
    taped('west', 'south', `12'`),
  ]);
  assert.equal(closes(drawn), true);
  assert.equal(closedWithoutBeingChecked(drawn), false, 'nothing was scanned, so nothing was hidden');
  assert.equal(readiness(drawn).trust, 'verified');
  assert.equal(isIssuable(drawn), true);
});

test('one tape anywhere stops the closure check being meaningless', () => {
  const r = imported([
    taped('south', 'east', `20'`),
    scan('east', 'north', `12'`),
    scan('north', 'west', `20'`),
    scan('west', 'south', `12'`),
  ]);
  assert.equal(closedWithoutBeingChecked(r), false);
});

/* ------------------------------------------------------------ per axis */

test('a tape on one axis does nothing for the other, and the guard says so', () => {
  const r = imported([
    taped('south', 'east', `20'`),
    scan('east', 'north', `12'`),
    taped('north', 'west', `20'`),
    scan('west', 'south', `12'`),
  ]);

  const state = readiness(r);
  assert.equal(state.trust, 'scanned');
  assert.equal(state.blocking.length, 1);
  assert.match(state.blocking[0]!, /No north-south dimension has been measured/);
  assert.match(state.blocking[0]!, /east, west/);
  assert.equal(isIssuable(r), false);
});

test('one tape per axis is the floor, and it opens the gate', () => {
  const r = imported([
    taped('south', 'east', `20'`),
    taped('east', 'north', `12'`),
    scan('north', 'west', `20'`),
    scan('west', 'south', `12'`),
  ]);

  const state = readiness(r);
  assert.deepEqual(state.blocking, []);
  assert.equal(state.trust, 'partly-verified');
  assert.equal(isIssuable(r), true);
  assert.doesNotThrow(() => assertIssuable(r));
});

test('the axis breakdown names every wall on both sides of the line', () => {
  const r = imported([
    taped('south', 'east', `20'`),
    scan('east', 'north', `12'`),
    scan('north', 'west', `20'`),
    scan('west', 'south', `12'`),
  ]);
  const [x, y] = axisReadiness(r);
  assert.deepEqual(x, { axis: 'x', verified: ['south'], unverified: ['north'] });
  assert.deepEqual(y, { axis: 'y', verified: [], unverified: ['east', 'west'] });
});

/* --------------------------------------------------------- unseen error */

test('the error the closure check is hiding is reported as a number', () => {
  const r = imported();
  // Two east-west walls, each at 2", and two north-south the same.
  assert.equal(unseenError(r, 'x'), parseLength(`4"`));
  assert.equal(unseenError(r, 'y'), parseLength(`4"`));

  const half = imported([
    taped('south', 'east', `20'`),
    scan('east', 'north', `12'`),
    scan('north', 'west', `20'`),
    scan('west', 'south', `12'`),
  ]);
  assert.equal(unseenError(half, 'x'), parseLength(`2"`), 'a taped wall stops contributing');
  assert.equal(unseenError(half, 'y'), parseLength(`4"`));
});

test('the blocking message carries the real slack, not a vague warning', () => {
  const state = readiness(imported());
  assert.equal(state.blocking.length, 3, 'the trap line, then one line per axis');
  assert.match(state.blocking[0]!, /closes exactly, and that means nothing yet/);
  assert.ok(state.blocking.some((b) => /could be out by 4"/.test(b)));
});

/* ------------------------------------------------------------- the gate */

test('issuing a scan throws, and the error says which wall to tape first', () => {
  const r = imported([
    scan('south', 'east', `20'`),
    scan('east', 'north', `12'`),
    scan('north', 'west', `20'`),
    scan('west', 'south', `12'`),
  ]);

  assert.throws(
    () => assertIssuable(r),
    (e: unknown) => {
      assert.ok(e instanceof NotIssuable);
      assert.match(e.message, /not ready to issue as a dimensioned drawing/);
      // Both 20' walls put more area in doubt than either 12' wall.
      assert.match(e.message, /Start with a tape on "(south|north)"/);
      assert.equal(e.reasons.length, 3);
      assert.ok(e.nextTape.length > 0);
      return true;
    }
  );
});

test('the punch list is ordered by the area each wall puts in doubt', () => {
  const state = readiness(imported());
  const ids = state.nextTape.map((t) => t.wallId);
  assert.deepEqual(ids.slice(0, 2).sort(), ['north', 'south'], 'the long walls come first');
  assert.equal(state.nextTape.length, 4);
});

test('a fully verified room has nothing left to tape', () => {
  const drawn = imported([
    taped('south', 'east', `20'`),
    taped('east', 'north', `12'`),
    taped('north', 'west', `20'`),
    taped('west', 'south', `12'`),
  ]);
  assert.deepEqual(readiness(drawn).nextTape, []);
});

/* ------------------------------------------------------------ warnings */

function scannedDoor(id: string): Opening {
  return {
    id,
    kind: 'door',
    width: scanned(parseLength(`2' 8"`), parseLength(`2"`), T0, 'roomplan'),
    height: scanned(parseLength(`5' 7"`), parseLength(`2"`), T0, 'roomplan'),
    offsetFromStart: scanned(parseLength(`8'`), parseLength(`2"`), T0, 'roomplan'),
  };
}

test('a scanned opening does not block the drawing but must appear on it', () => {
  const r = imported([
    taped('south', 'east', `20'`, [scannedDoor('front')]),
    taped('east', 'north', `12'`),
    scan('north', 'west', `20'`),
    scan('west', 'south', `12'`),
  ]);

  const state = readiness(r);
  assert.deepEqual(state.blocking, [], 'openings are a warning, not a gate');
  assert.equal(isIssuable(r), true);
  assert.ok(state.warnings.some((x) => /door "front" on wall "south"/.test(x)));
  assert.ok(state.warnings.some((x) => /never ordered against/.test(x)));
});

test('an unverified ceiling height is called out, because wall area is priced off it', () => {
  const r = imported([
    taped('south', 'east', `20'`),
    taped('east', 'north', `12'`),
    taped('north', 'west', `20'`),
    taped('west', 'south', `12'`),
  ]);
  assert.ok(readiness(r).warnings.some((x) => /ceiling height is the sensor's number/.test(x)));

  const withCeiling: Room = { ...r, ceilingHeight: verified(parseLength(`8'`), 'sam', T1, 'tape') };
  assert.deepEqual(readiness(withCeiling).warnings, []);
});

/* --------------------------------------------------------------- badge */

test('the badge says in one word whether anybody stood behind these numbers', () => {
  assert.equal(trustLabel('scanned'), 'Scanned — not checked');
  assert.equal(trustLabel(readiness(imported()).trust), 'Scanned — not checked');
});

/* ------------------------------------------------------- on the screen too */

test('the badge reaches the renderer, so it is on the screen and not only the export', () => {
  const fromScanner = toRenderModel(imported(), [], { unit: 'ft' });
  assert.equal(fromScanner.trust, 'scanned');
  assert.equal(fromScanner.issuable, false);

  const checked = toRenderModel(
    imported([
      taped('south', 'east', `20'`),
      taped('east', 'north', `12'`),
      scan('north', 'west', `20'`),
      scan('west', 'south', `12'`),
    ]),
    [],
    { unit: 'ft' }
  );
  assert.equal(checked.trust, 'partly-verified');
  assert.equal(checked.issuable, true);
});
