import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength } from '../length.ts';
import { isVerified } from '../measurement.ts';
import {
  type Company,
  CompanyError,
  EMPTY_COMPANY,
  addressLines,
  hasAddress,
  isPresentable,
  letterhead,
  postalAddress,
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

/* --------------------------------------------------------------- the address */

test('a profile saved before there was an address field has no address, not a blank one', () => {
  // The whole reason the field is optional. Every profile on every phone and in
  // every iCloud account was written before this existed, and the one thing
  // that must never happen is one of them turning into an address of "" — an
  // empty string satisfies every `if (address)` between here and the paper, and
  // the paper is a legal form telling a buyer where to post a cancellation.
  assert.equal(EMPTY_COMPANY.address, undefined);
  assert.equal(hasAddress(EMPTY_COMPANY), false);
  assert.deepEqual(addressLines(EMPTY_COMPANY), []);
  assert.equal(postalAddress(EMPTY_COMPANY), undefined);
});

test('an address of nothing but whitespace is no address at all', () => {
  // Somebody hits the space bar in the box and moves on. The form must refuse
  // that exactly as loudly as it refuses an empty one, because a space prints
  // as a hole.
  for (const typed of ['', '   ', '\n', ' \n \n ', '\r\n']) {
    const company: Company = { ...EMPTY_COMPANY, address: typed };
    assert.equal(hasAddress(company), false, JSON.stringify(typed));
    assert.deepEqual(addressLines(company), [], JSON.stringify(typed));
    assert.equal(postalAddress(company), undefined, JSON.stringify(typed));
  }
});

test('an address is the lines it was typed on, trimmed, with the empty ones dropped', () => {
  // A trailing return is what a phone keyboard leaves behind, and a document
  // that prints an empty line where a town should be looks like a mistake.
  const company: Company = {
    ...EMPTY_COMPANY,
    address: '  2200 Oak Street\n\n  Suite 4 \nMesa AZ 85201\n',
  };
  assert.deepEqual(addressLines(company), ['2200 Oak Street', 'Suite 4', 'Mesa AZ 85201']);
  assert.equal(postalAddress(company), '2200 Oak Street, Suite 4, Mesa AZ 85201');
  assert.equal(hasAddress(company), true);
});

test('windows line endings are line endings too', () => {
  // A price list pasted out of a supplier's email carries \r\n, and so does an
  // address. A stray carriage return on the end of "85201" is invisible on
  // screen and turns up as a box in a PDF.
  const company: Company = { ...EMPTY_COMPANY, address: '2200 Oak Street\r\nMesa AZ 85201' };
  assert.deepEqual(addressLines(company), ['2200 Oak Street', 'Mesa AZ 85201']);
});

test('the address goes on the letterhead, on one line, under the name', () => {
  const withOne: Company = { ...gilbert, address: '119 Fifth Street\nCleveland OH 44113' };
  assert.deepEqual(letterhead(withOne), [
    'Gilbert Remodeling',
    '119 Fifth Street, Cleveland OH 44113',
    '(216) 555-0142 · gil@example.com',
    'Licence OH-CT-88213 · Insured — Westfield #4471',
  ]);
});

test('a letterhead line never carries a line break out of this module', () => {
  // Every caller lays a letterhead out as a stack of single lines — a drawing
  // in SVG, an HTML document, a PDF — and none of them would break the line.
  // "119 Fifth StreetCleveland OH 44113" on somebody's blueprint is the bug
  // this flattening prevents, and it is prevented here rather than in each of
  // the four places that draw one.
  const withOne: Company = { ...gilbert, address: '119 Fifth Street\nCleveland OH 44113' };
  for (const line of letterhead(withOne)) {
    assert.doesNotMatch(line, /[\r\n]/, line);
  }
});

test('a profile with no address has no address line, exactly like a missing licence', () => {
  // The rule for everything on a letterhead: leave it out rather than print it
  // empty. A document with a gap where an address should be is the thing this
  // whole change exists to stop.
  assert.deepEqual(letterhead({ ...EMPTY_COMPANY, name: 'Gilbert Remodeling' }), [
    'Gilbert Remodeling',
  ]);
  assert.deepEqual(letterhead({ ...EMPTY_COMPANY, name: 'Gilbert Remodeling', address: '  ' }), [
    'Gilbert Remodeling',
  ]);
});

test('an address alone still needs a name before anything is presentable', () => {
  // An address is not an identity. A drawing headed "119 Fifth Street" with no
  // business on it is a drawing nobody can be held to.
  assert.equal(isPresentable({ ...EMPTY_COMPANY, address: '119 Fifth Street' }), false);
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
