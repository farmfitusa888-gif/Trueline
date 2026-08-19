import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NM_PER_INCH, formatFeetInches, formatMetric, parseLength } from '../length.ts';
import {
  MeasurementError,
  band,
  confidenceLabel,
  derive,
  formatWithConfidence,
  history,
  isVerified,
  overlaps,
  preferVerified,
  scanned,
  toleranceOf,
  verified,
  verify,
} from '../measurement.ts';

const T0 = '2026-08-19T14:00:00Z';
const T1 = '2026-08-19T15:30:00Z';

const roomplanWall = () =>
  scanned(parseLength(`12' 4"`), parseLength(`2"`), T0, 'roomplan');

test('a scanned length carries the band it lives in', () => {
  const wall = roomplanWall();
  assert.equal(isVerified(wall), false);
  assert.equal(confidenceLabel(wall), 'scanned');
  assert.equal(toleranceOf(wall), 2n * NM_PER_INCH);
  assert.deepEqual(band(wall), {
    low: parseLength(`12' 2"`),
    high: parseLength(`12' 6"`),
  });
});

test('a person putting a tape on it removes the band', () => {
  const signed = verified(parseLength(`12' 4 1/2"`), 'sam', T1, 'tape');
  assert.equal(isVerified(signed), true);
  assert.equal(toleranceOf(signed), 0n);
  assert.deepEqual(band(signed), { low: signed.value, high: signed.value });
});

test('a verified measurement nobody signed is refused', () => {
  assert.throws(() => verified(1n, '   ', T1, 'tape'), MeasurementError);
  assert.throws(() => verified(1n, 'sam', 'yesterday', 'tape'), MeasurementError);
  assert.throws(() => scanned(1n, 1n, T0, ''), MeasurementError);
  assert.throws(() => scanned(1n, -1n, T0, 'roomplan'), MeasurementError);
});

test('correcting a number keeps what it said before', () => {
  const wall = roomplanWall();
  const corrected = verify(wall, parseLength(`12' 5 1/8"`), 'sam', T1, 'tape', 'bowed at the top');

  assert.equal(corrected.value, parseLength(`12' 5 1/8"`));
  assert.equal(isVerified(corrected), true);
  assert.equal(toleranceOf(corrected), 0n);

  const trail = history(corrected);
  assert.equal(trail.length, 2);
  assert.equal(trail[1]?.value, parseLength(`12' 4"`));
  assert.equal(trail[1]?.provenance.kind, 'scanned');

  // The original object was not mutated.
  assert.equal(wall.value, parseLength(`12' 4"`));
});

test('a correction of a correction keeps the whole chain', () => {
  const first = verify(roomplanWall(), parseLength(`12' 5"`), 'sam', T1, 'tape');
  const second = verify(first, parseLength(`12' 5 1/4"`), 'friend', '2026-08-20T09:00:00Z', 'laser');
  const trail = history(second);
  assert.equal(trail.length, 3);
  assert.deepEqual(
    trail.map((m) => formatFeetInches(m.value)),
    [`12' 5 1/4"`, `12' 5"`, `12' 4"`]
  );
});

test('a person always beats a sensor, with no threshold', () => {
  const scan = roomplanWall();
  const tape = verified(parseLength(`50'`), 'sam', T0, 'tape');
  // Wildly different, far outside the band, and the person still wins.
  assert.equal(preferVerified(scan, tape), tape);
  assert.equal(preferVerified(tape, scan), tape);
});

test('between two of a kind, the later reading wins', () => {
  const early = scanned(parseLength(`10'`), parseLength(`1"`), T0, 'roomplan');
  const late = scanned(parseLength(`10' 1"`), parseLength(`1"`), T1, 'roomplan');
  assert.equal(preferVerified(early, late), late);
});

test('between two readings from the same moment, the tighter one wins', () => {
  const loose = scanned(parseLength(`10'`), parseLength(`3"`), T0, 'arkit-depth');
  const tight = scanned(parseLength(`10'`), parseLength(`1/2"`), T0, 'roomplan');
  assert.equal(preferVerified(loose, tight), tight);
});

test('bands say whether a scan and a tape actually disagree', () => {
  const scan = roomplanWall(); // 12' 4" ± 2"
  assert.equal(overlaps(scan, verified(parseLength(`12' 5"`), 'sam', T1, 'tape')), true);
  assert.equal(overlaps(scan, verified(parseLength(`12' 6"`), 'sam', T1, 'tape')), true);
  assert.equal(overlaps(scan, verified(parseLength(`12' 7"`), 'sam', T1, 'tape')), false);
});

test('a derived number is never more certain than what it came from', () => {
  const a = scanned(parseLength(`10'`), parseLength(`1"`), T0, 'roomplan');
  const b = scanned(parseLength(`8'`), parseLength(`1/2"`), T0, 'roomplan');
  const run = derive(
    [
      { name: 'north wall', measurement: a },
      { name: 'east wall', measurement: b },
    ],
    a.value + b.value
  );
  assert.equal(confidenceLabel(run), 'derived');
  assert.equal(toleranceOf(run), parseLength(`1 1/2"`));
  assert.deepEqual(run.provenance.kind === 'derived' ? run.provenance.from : [], [
    'north wall',
    'east wall',
  ]);
});

test('verifying one wall tightens everything computed from it', () => {
  const a = scanned(parseLength(`10'`), parseLength(`1"`), T0, 'roomplan');
  const b = scanned(parseLength(`8'`), parseLength(`1/2"`), T0, 'roomplan');
  const before = derive(
    [{ name: 'a', measurement: a }, { name: 'b', measurement: b }],
    a.value + b.value
  );

  const aSigned = verify(a, parseLength(`10' 1/4"`), 'sam', T1, 'tape');
  const after = derive(
    [{ name: 'a', measurement: aSigned }, { name: 'b', measurement: b }],
    aSigned.value + b.value
  );

  assert.equal(toleranceOf(before), parseLength(`1 1/2"`));
  assert.equal(toleranceOf(after), parseLength(`1/2"`));
  assert.ok(toleranceOf(after) < toleranceOf(before), 'verifying a wall did not tighten the run');
});

test('a derived measurement needs something to derive from', () => {
  assert.throws(() => derive([], 1n), MeasurementError);
});

test('the screen never shows a guess as a fact', () => {
  const scan = roomplanWall();
  const signed = verified(parseLength(`12' 4 1/2"`), 'sam', T1, 'tape');

  assert.equal(formatWithConfidence(scan), `12' 4" ± 2"`);
  assert.equal(formatWithConfidence(signed), `12' 4 1/2"`);
  // A zero-tolerance scan is still not a verified one, and says so.
  assert.equal(formatWithConfidence(scanned(parseLength(`3'`), 0n, T0, 'roomplan')), `3' (unverified)`);
});

test('confidence reads the same in metric', () => {
  const scan = scanned(parseLength('3000mm'), parseLength('50mm'), T0, 'roomplan');
  assert.equal(formatWithConfidence(scan, (nm) => formatMetric(nm, 'mm')), '3000 mm ± 50 mm');
});
