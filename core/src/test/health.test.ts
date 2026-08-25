import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NM_PER_METRE, parseLength } from '../length.ts';
import { scanned, verified } from '../measurement.ts';
import { type Heading, type Room, type Wall } from '../room.ts';
import { type Photo } from '../photo.ts';
import { type ImportReport } from '../import-roomplan.ts';
import { type Finding, checkCapture } from '../health.ts';

/**
 * The checks that decide whether a capture is worth drawing from.
 *
 * The one that matters most here is the frame check. Every other finding says
 * something is missing or uncertain; this one says the numbers are confidently
 * wrong, which is the failure that does not look like a failure. It was written
 * because it had already happened: photographs were being placed against walls
 * eight feet from where those walls are, and everything downstream looked fine.
 */

const T0 = '2026-08-20T17:12:09Z';

function w(id: string, heading: Heading, length: string): Wall {
  return { id, heading, length: scanned(parseLength(length), parseLength(`50mm`), T0, 'roomplan') };
}

/** 6 m x 4 m, corners (0,0) (6,0) (6,4) (0,4). */
const room: Room = {
  id: 'r1',
  name: 'kitchen',
  walls: [
    w('south', 'east', `6000mm`),
    w('east', 'north', `4000mm`),
    w('north', 'west', `6000mm`),
    w('west', 'south', `4000mm`),
  ],
  // Verified, so the room does not also trip the closes-perfectly stop and
  // clutter what these tests are looking at.
  ceilingHeight: verified(parseLength(`2400mm`), 'sam', T0, 'tape'),
};

const nm = (metres: number) => BigInt(Math.round(metres * Number(NM_PER_METRE)));

const REPORT: ImportReport = {
  sourceVersion: 2,
  walls: room.walls.map((wall) => wall.id),
  openSpans: [],
  dropped: [],
  snapped: [],
  diagonals: [],
  closureBeforeSolving: { x: 0n, y: 0n },
  openings: [],
  recoveredSills: [],
  sourceIds: [],
  notes: [],
};

/** A photograph taken from a spot on the floor, facing east. Only `at` matters. */
function shot(id: string, x: number, y: number): Photo {
  return {
    id,
    takenAt: T0,
    trigger: 'automatic',
    pose: {
      at: { x: nm(x), y: nm(y) },
      forward: { x: 1_000_000_000n, y: 0n },
      rightEdge: { x: 707_000_000n, y: -707_000_000n },
      leftEdge: { x: 707_000_000n, y: 707_000_000n },
    },
  };
}

const named = (findings: readonly Finding[], text: string) =>
  findings.filter((f) => f.what.includes(text));

test('photographs taken from inside the room raise nothing', () => {
  const findings = checkCapture({
    room,
    report: REPORT,
    photos: [shot('a', 1, 1), shot('b', 3, 2), shot('c', 5, 3)],
  });
  assert.equal(named(findings, 'outside').length, 0);
});

test('a few taken from outside are a wide opening, and are said once', () => {
  const findings = checkCapture({
    room,
    report: REPORT,
    photos: [shot('a', 1, 1), shot('b', 3, 2), shot('c', 5, 3), shot('d', 3, -2)],
  });
  const outside = named(findings, 'outside the room');
  assert.equal(outside.length, 1);
  assert.equal(outside[0]!.severity, 'note');
  assert.match(outside[0]!.what, /1 photograph was taken/);
});

test('most of them outside stops the drawing — the frames do not match', () => {
  // What the bug did on Gilbert's kitchen: the walls laid out from the plan
  // origin, the photographs still in the scanner's own metres, eight feet
  // apart. Every wall-to-photo answer it produced was confident and wrong.
  const findings = checkCapture({
    room,
    report: REPORT,
    photos: [shot('a', 9, 9), shot('b', 11, 8), shot('c', 5, 3), shot('d', 12, 10)],
  });
  const outside = named(findings, 'standing outside this room');
  assert.equal(outside.length, 1);
  assert.equal(outside[0]!.severity, 'stop');
  assert.match(outside[0]!.detail, /not in the same coordinate system/);
});

test('with no photographs at all, nothing is claimed either way', () => {
  const findings = checkCapture({ room, report: REPORT });
  assert.equal(named(findings, 'outside').length, 0);
});

/* ------------------------------------------------------ walls that stand short */

test('a wall standing well short of the ceiling is worth a look', () => {
  // Sam's garage came back with wall heights of 2.13, 1.95, 1.95, 1.62 and
  // 2.13 m off one slab. The model presents that as a garage with a 5'4" pony
  // wall in it. There was a plausibility check for door heights and none at all
  // for walls, and the wall face is what drywall and paint are priced off.
  const stubby: Room = {
    ...room,
    walls: room.walls.map((wall) =>
      wall.id === 'east'
        ? { ...wall, height: scanned(parseLength(`5' 4"`), parseLength(`50mm`), T0, 'roomplan') }
        : wall
    ),
  };
  const findings = checkCapture({ room: stubby, report: REPORT });
  const short = named(findings, 'short of the ceiling');
  assert.equal(short.length, 1);
  assert.equal(short[0]!.severity, 'check');
  assert.match(short[0]!.detail, /east at 5' 4"/);
});

test('a room whose walls all reach the ceiling says nothing about it', () => {
  assert.equal(named(checkCapture({ room, report: REPORT }), 'short of the ceiling').length, 0);
});

test('the frame alarm quotes the bad photographs, not all of them', () => {
  // It filtered the implausible heights and then reported the min and max over
  // every photograph, so one good picture at 3' 11" became the bottom of a
  // range describing six frames at 13 to 15 ft. A stop finding understating its
  // own evidence teaches people to argue with it.
  const nm = (metres: number) => BigInt(Math.round(metres * Number(NM_PER_METRE)));
  const findings = checkCapture({
    room,
    report: REPORT,
    cameraHeights: [nm(1.2), nm(1.5), nm(1.6), nm(4.2), nm(4.6)],
  });
  const alarm = named(findings, 'same room as the walls');
  assert.equal(alarm.length, 1);
  assert.match(alarm[0]!.detail, /2 of 5/);
  assert.doesNotMatch(alarm[0]!.detail, /3' 11/, 'it quoted a perfectly good photograph');
});
