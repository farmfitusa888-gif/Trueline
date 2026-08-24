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
