import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength } from '../length.ts';
import { isVerified } from '../measurement.ts';
import {
  type Company,
  CompanyError,
  EMPTY_COMPANY,
  isPresentable,
  letterhead,
  showArea,
  showLength,
  showRun,
  startingCeiling,
  startingThickness,
} from '../company.ts';

/**
 * Whose business this is, and how they like their numbers.
 *
 * Two things that are the same on every job: the details that go on anything a
 * homeowner sees, and the preferences that decide what a new scan starts as.
 * Nothing here is ever a measurement, and the tests below are mostly about
 * making sure it cannot become one by accident.
 */

const T0 = '2026-08-25T16:00:00Z';

const gilbert: Company = {
  ...EMPTY_COMPANY,
  name: 'Gilbert Remodeling',
  phone: '(216) 555-0142',
  email: 'gil@example.com',
  licence: 'OH-CT-88213',
  insurance: 'Westfield #4471',
};

/* ---------------------------------------------------------------- the head */

test('the letterhead leaves out what nobody has filled in', () => {
  // A drawing that says "Licence:" with nothing after it looks like a mistake,
  // and on a document a homeowner may show to somebody else, it is one.
  assert.deepEqual(letterhead({ ...EMPTY_COMPANY, name: 'Gilbert Remodeling' }), [
    'Gilbert Remodeling',
  ]);
  assert.deepEqual(letterhead(gilbert), [
    'Gilbert Remodeling',
    '(216) 555-0142 · gil@example.com',
    'Licence OH-CT-88213 · Insured — Westfield #4471',
  ]);
});

test('nothing at all is not presentable, and whitespace is nothing', () => {
  assert.equal(isPresentable(EMPTY_COMPANY), false);
  assert.equal(isPresentable({ ...EMPTY_COMPANY, name: '   ' }), false);
  assert.equal(isPresentable(gilbert), true);
  assert.deepEqual(letterhead(EMPTY_COMPANY), []);
});

/* ------------------------------------------------------- what a room starts at */

test('the default ceiling is off until somebody turns it on', () => {
  // A scanner measuring a ceiling off a wall it could actually see beats
  // anybody's habit, so overriding it is a decision rather than a default.
  assert.equal(startingCeiling(gilbert, 'sam', T0), undefined);
});

test('a default ceiling arrives stated, never scanned and never bare', () => {
  const on: Company = { ...gilbert, useDefaultCeiling: true, defaultCeiling: `9'` };
  const height = startingCeiling(on, 'sam', T0)!;
  assert.equal(height.value, parseLength(`9'`));
  assert.equal(isVerified(height), true);
  // The distinction that is the whole product: a room eight foot high because
  // of a setting must never read like a room somebody measured.
  assert.equal(
    height.provenance.kind === 'verified' ? height.provenance.method : null,
    'stated'
  );
  assert.equal(
    height.provenance.kind === 'verified' ? height.provenance.verifiedBy : null,
    'sam'
  );
});

test('a default ceiling that is not a length is refused with the text somebody typed', () => {
  const broken: Company = { ...gilbert, useDefaultCeiling: true, defaultCeiling: 'about eight' };
  assert.throws(
    () => startingCeiling(broken, 'sam', T0),
    (error: unknown) => {
      assert.ok(error instanceof CompanyError);
      assert.match(error.message, /about eight/);
      return true;
    }
  );
  assert.throws(
    () => startingCeiling({ ...gilbert, useDefaultCeiling: true, defaultCeiling: `0"` }, 'sam', T0),
    CompanyError
  );
});

test('a default wall build-up is the real thickness of that build-up, stated', () => {
  assert.equal(startingThickness(gilbert, 'sam', T0), undefined);
  const framed = startingThickness({ ...gilbert, defaultAssembly: '2x6' }, 'sam', T0)!;
  assert.equal(framed.value, parseLength(`6 1/2"`));
  assert.equal(isVerified(framed), true);
});

/* ------------------------------------------------------------------ reading */

test('one length, two ways of reading it, and the value never changes', () => {
  const twelveFour = parseLength(`12' 4"`);
  assert.equal(showLength(twelveFour, 'imperial'), `12' 4"`);
  // Whole millimetres. The model holds 3759200000 nanometres; printing
  // "3759.2 mm" on a drawing is a tenth of a micron on somebody's wall, and a
  // millimetre is already finer than any tape ever made.
  assert.equal(showLength(twelveFour, 'metric'), '3759 mm');
});

test('areas convert at the end, once, from the doubled unit', () => {
  // 20 x 10 ft, doubled, which is how `area()` hands it over.
  const doubled = 2n * parseLength(`20'`) * parseLength(`10'`);
  assert.equal(showArea(doubled, 'imperial'), '200.0 sq ft');
  assert.equal(showArea(doubled, 'metric'), '18.6 m²');
});

test('a run reads as linear feet or as metres, with its unit attached', () => {
  assert.equal(showRun(parseLength(`60'`), 'imperial'), '60.00 lf');
  assert.equal(showRun(parseLength(`60'`), 'metric'), '18.29 m');
});

test('a metric length rounds to the nearest millimetre, up or down', () => {
  assert.equal(showLength(parseLength('1000.6mm'), 'metric'), '1001 mm');
  assert.equal(showLength(parseLength('1000.4mm'), 'metric'), '1000 mm');
  assert.equal(showLength(-parseLength('1000.6mm'), 'metric'), '-1001 mm');
});

test('switching units changes not one stored number', () => {
  // The whole rule for this preference: it is a way of reading, never a way of
  // recording. The same nanometre count is behind both strings.
  const value = parseLength(`8' 1 1/2"`);
  const both = [showLength(value, 'imperial'), showLength(value, 'metric')];
  assert.notEqual(both[0], both[1]);
  assert.equal(parseLength(both[0]!), value, 'the imperial reading must round-trip exactly');
});
