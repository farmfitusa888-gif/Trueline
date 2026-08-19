import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LengthError,
  NM_PER_FOOT,
  NM_PER_INCH,
  NM_PER_METRE,
  NM_PER_MM,
  add,
  divideEvenly,
  formatFeetInches,
  formatMetric,
  fromJSON,
  isExactAt,
  of,
  parseLength,
  scale,
  subtract,
  toJSON,
} from '../length.ts';

test('the inch is exactly 25.4 mm, so both systems are lossless', () => {
  assert.equal(NM_PER_INCH, 25_400_000n);
  assert.equal(NM_PER_INCH, 254n * NM_PER_MM / 10n);
  assert.equal(NM_PER_FOOT, 304_800_000n);
  // Every binary fraction a trade uses lands on a whole nanometre.
  for (const den of [2n, 4n, 8n, 16n, 32n, 64n]) {
    assert.equal(NM_PER_INCH % den, 0n, `1/${den}" is not exact`);
  }
});

test('parses what somebody actually types on a job site', () => {
  const twelveFourAndAHalf = 12n * NM_PER_FOOT + 4n * NM_PER_INCH + NM_PER_INCH / 2n;
  for (const written of [`12' 4 1/2"`, `12'4-1/2"`, `12' 4.5"`, `12'4 1/2"`, `12 ft 4 1/2 in`]) {
    assert.equal(parseLength(written), twelveFourAndAHalf, `failed on ${written}`);
  }
});

test('parses each piece on its own', () => {
  assert.equal(parseLength(`12'`), 12n * NM_PER_FOOT);
  assert.equal(parseLength(`98"`), 98n * NM_PER_INCH);
  assert.equal(parseLength(`12.5'`), 12n * NM_PER_FOOT + 6n * NM_PER_INCH);
  assert.equal(parseLength(`1/2"`), NM_PER_INCH / 2n);
  assert.equal(parseLength(`4 1/2"`), 4n * NM_PER_INCH + NM_PER_INCH / 2n);
  assert.equal(parseLength(`-3"`), -3n * NM_PER_INCH);
});

test('parses metric', () => {
  assert.equal(parseLength('3050mm'), 3050n * NM_PER_MM);
  assert.equal(parseLength('3.05m'), 3050n * NM_PER_MM);
  assert.equal(parseLength('305cm'), 3050n * NM_PER_MM);
  assert.equal(parseLength('3.05 metres'), 3050n * NM_PER_MM);
  // Metric and imperial meet exactly where they should.
  assert.equal(parseLength('25.4mm'), parseLength(`1"`));
});

test('a bare number means what the field says it means, never a guess', () => {
  assert.equal(parseLength('12'), 12n * NM_PER_INCH);
  assert.equal(parseLength('12', { defaultUnit: 'ft' }), 12n * NM_PER_FOOT);
  assert.equal(parseLength('12', { defaultUnit: 'mm' }), 12n * NM_PER_MM);
  // An explicit mark always wins over the field's default.
  assert.equal(parseLength(`12"`, { defaultUnit: 'ft' }), 12n * NM_PER_INCH);
});

test('refuses what it cannot hold exactly, instead of rounding quietly', () => {
  assert.throws(() => parseLength(`1/3"`), LengthError);
  assert.throws(() => parseLength(`1/0"`), LengthError);
  assert.throws(() => parseLength(''), LengthError);
  assert.throws(() => parseLength('about ten feet'), LengthError);
  assert.throws(() => parseLength(`'`), LengthError);
  assert.throws(() => of(12.5, 'ft'), LengthError);
});

test('formats the way it is written on a cut list', () => {
  const m = parseLength(`12' 4 1/2"`);
  assert.equal(formatFeetInches(m), `12' 4 1/2"`);
  assert.equal(formatFeetInches(parseLength(`12'`)), `12'`);
  assert.equal(formatFeetInches(parseLength(`12'`), { keepZeroInches: true }), `12' 0"`);
  assert.equal(formatFeetInches(parseLength(`1/2"`)), `1/2"`);
  assert.equal(formatFeetInches(parseLength(`8"`)), `8"`);
  assert.equal(formatFeetInches(0n), `0"`);
  assert.equal(formatFeetInches(-parseLength(`3 1/4"`)), `-3 1/4"`);
});

test('reduces fractions the way a person writes them', () => {
  assert.equal(formatFeetInches(parseLength(`4/8"`)), `1/2"`);
  assert.equal(formatFeetInches(parseLength(`2/16"`)), `1/8"`);
  assert.equal(formatFeetInches(parseLength(`3/4"`)), `3/4"`);
});

test('round-trips every sixteenth of an inch across a wall', () => {
  for (let i = 0; i < 16 * 12 * 20; i += 1) {
    const nm = (BigInt(i) * NM_PER_INCH) / 16n;
    assert.equal(parseLength(formatFeetInches(nm)), nm, `broke at tick ${i}`);
  }
});

test('display rounding is one-way and says so', () => {
  const thirtySecond = NM_PER_INCH / 32n;
  assert.equal(isExactAt(thirtySecond, 32), true);
  assert.equal(isExactAt(thirtySecond, 16), false);
  // Shown at sixteenths it rounds up rather than disappearing.
  assert.equal(formatFeetInches(thirtySecond, { denominator: 16 }), `1/16"`);
  // Storage is untouched by how it was displayed.
  assert.equal(thirtySecond, NM_PER_INCH / 32n);
});

test('formats metric without inventing precision', () => {
  assert.equal(formatMetric(3050n * NM_PER_MM), '3050 mm');
  assert.equal(formatMetric(3050n * NM_PER_MM, 'm'), '3.05 m');
  assert.equal(formatMetric(NM_PER_METRE, 'm'), '1 m');
  assert.equal(formatMetric(-NM_PER_MM), '-1 mm');
  assert.equal(formatMetric(parseLength(`1"`), 'mm'), '25.4 mm');
});

test('arithmetic is exact', () => {
  const a = parseLength(`3' 5 3/8"`);
  const b = parseLength(`2' 7 5/8"`);
  assert.equal(add(a, b), parseLength(`6' 1"`));
  assert.equal(subtract(add(a, b), b), a);
  assert.equal(add(), 0n);
});

test('scaling refuses to lose a nanometre', () => {
  assert.equal(scale(parseLength(`8'`), 1n, 2n), parseLength(`4'`));
  assert.throws(() => scale(1n, 1n, 3n), LengthError);
  assert.throws(() => scale(1n, 1n, 0n), LengthError);
});

test('a run of joists reaches the wall exactly', () => {
  const wall = parseLength(`16' 1"`);
  for (const parts of [3, 7, 13, 64]) {
    const pieces = divideEvenly(wall, parts);
    assert.equal(pieces.length, parts);
    assert.equal(add(...pieces), wall, `${parts} pieces did not sum back to the wall`);
    // Nothing is more than a nanometre off any other piece.
    const min = pieces.reduce((x, y) => (y < x ? y : x));
    const max = pieces.reduce((x, y) => (y > x ? y : x));
    assert.ok(max - min <= 1n);
  }
  assert.throws(() => divideEvenly(1n, 0), LengthError);
  assert.throws(() => divideEvenly(1n, 1.5), LengthError);
});

test('negative lengths divide back to themselves', () => {
  const pieces = divideEvenly(-parseLength(`10'`), 3);
  assert.equal(add(...pieces), -parseLength(`10'`));
});

test('crosses the wire as a string, because JSON has no bigint', () => {
  const wall = parseLength(`24' 7 3/16"`);
  assert.equal(typeof toJSON(wall), 'string');
  assert.equal(fromJSON(toJSON(wall)), wall);
  assert.equal(JSON.parse(JSON.stringify({ length: toJSON(wall) })).length, wall.toString());
  assert.throws(() => fromJSON('12.5'), LengthError);
  assert.throws(() => fromJSON('twelve'), LengthError);
});

test('a hundred-metre building is nowhere near any limit', () => {
  const building = of(100, 'm');
  assert.equal(building, 100_000_000_000n);
  assert.ok(building < BigInt(Number.MAX_SAFE_INTEGER));
});
