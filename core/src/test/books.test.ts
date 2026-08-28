import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  type Books,
  type Contact,
  type Grant,
  type Takings,
  type Tester,
  type Trouble,
  NO_BOOKS,
  OwnerError,
} from '../owner.ts';
import {
  describeBooks,
  describeGrant,
  gatherTroubles,
  giveBatch,
  giveGrant,
  markRedeemed,
  pullGrant,
  readDay,
  readMonth,
  readTakings,
  runsOut,
  whereTheyGotTo,
} from '../books.ts';

/**
 * The owner's own books, under the two rules `owner.ts` is written around.
 *
 * **A contractor's work never appears here** -- checked as an assertion about
 * the source rather than as a promise, at the bottom of this file.
 *
 * **Say who is claiming what.** Most of what follows is about one distinction:
 * `redeemedAt` is Apple's fact and `given` is Sam's note, and no sentence this
 * module produces is allowed to blur them. The wordings below are asserted in
 * full, not by keyword, because the failure being guarded against is a sentence
 * that reads fine and claims one word too much.
 *
 * Every figure is integer cents. Every time is ISO 8601 with an offset, and
 * every function that needs to know what day it is is told rather than asking.
 */

/** A fixed today, so nothing here depends on when it is run. */
const TODAY = '2026-09-20T12:00:00Z';

const named = (over: Partial<Grant> = {}): Grant => ({
  code: 'GILBERT3',
  how: 'named',
  given: 'Gilbert Ruiz',
  months: 3,
  madeAt: '2026-06-28T09:15:00-07:00',
  ...over,
});

/* ==================================================== giving them away */

test('a named free run goes in with the name on it and the time it was made', () => {
  const books = giveGrant(
    NO_BOOKS,
    { code: 'GILBERT3', how: 'named', given: 'Gilbert Ruiz', months: 3 },
    '2026-06-28T09:15:00-07:00'
  );
  assert.equal(books.grants.length, 1);
  assert.deepEqual(books.grants[0], {
    code: 'GILBERT3',
    how: 'named',
    given: 'Gilbert Ruiz',
    months: 3,
    madeAt: '2026-06-28T09:15:00-07:00',
  });
});

test('the code is trimmed, because one pasted out of App Store Connect brings a newline', () => {
  const books = giveGrant(
    NO_BOOKS,
    { code: '  GILBERT3\n', how: 'named', given: '  Gilbert Ruiz ', months: 3 },
    TODAY
  );
  assert.equal(books.grants[0]?.code, 'GILBERT3');
  assert.equal(books.grants[0]?.given, 'Gilbert Ruiz');
});

test('the same code twice is refused, because Apple only reports one redemption for it', () => {
  const one = giveGrant(NO_BOOKS, { code: 'TRADE-01', how: 'batch', batch: 'trade night', months: 1 }, TODAY);
  assert.throws(
    () => giveGrant(one, { code: 'TRADE-01', how: 'batch', batch: 'trade night', months: 1 }, TODAY),
    (error: unknown) =>
      error instanceof OwnerError && /already in the books/.test((error as Error).message)
  );
  assert.equal(one.grants.length, 1);
});

test('nought, a fraction and a negative are all refused as a number of months', () => {
  for (const months of [0, 1.5, -3, Number.NaN]) {
    assert.throws(
      () => giveGrant(NO_BOOKS, { code: `C${months}`, how: 'named', given: 'Dana', months }, TODAY),
      (error: unknown) =>
        error instanceof OwnerError && /whole months/.test((error as Error).message),
      `${months} months should have been refused`
    );
  }
});

test('a named free run with nobody named is refused', () => {
  assert.throws(
    () => giveGrant(NO_BOOKS, { code: 'X1', how: 'named', given: '   ', months: 1 }, TODAY),
    (error: unknown) =>
      error instanceof OwnerError && /needs the name of whoever it went to/.test((error as Error).message)
  );
});

test('a batch code carrying a name is refused, because Apple never says who used one', () => {
  assert.throws(
    () =>
      giveGrant(
        NO_BOOKS,
        { code: 'X2', how: 'batch', batch: 'trade night', given: 'Gilbert Ruiz', months: 1 },
        TODAY
      ),
    (error: unknown) =>
      error instanceof OwnerError && /never reports who redeemed one/.test((error as Error).message)
  );
});

test('a named free run cannot also belong to a batch, and a batch needs a name', () => {
  assert.throws(
    () =>
      giveGrant(
        NO_BOOKS,
        { code: 'X3', how: 'named', given: 'Dana', batch: 'trade night', months: 1 },
        TODAY
      ),
    OwnerError
  );
  assert.throws(
    () => giveGrant(NO_BOOKS, { code: 'X4', how: 'batch', months: 1 }, TODAY),
    (error: unknown) =>
      error instanceof OwnerError && /needs a name for the batch/.test((error as Error).message)
  );
});

test('a time it cannot keep is refused, and a local time with no offset is one of them', () => {
  for (const at of ['tuesday', '2026-13-40T00:00:00Z', '2026-06-28T09:15:00', '']) {
    assert.throws(
      () => giveGrant(NO_BOOKS, { code: 'X5', how: 'named', given: 'Dana', months: 1 }, at),
      (error: unknown) =>
        error instanceof OwnerError && /not a time this can keep/.test((error as Error).message),
      `"${at}" should have been refused`
    );
  }
  // And one that is fine, so the check above is not passing on everything.
  assert.doesNotThrow(() =>
    giveGrant(NO_BOOKS, { code: 'X6', how: 'named', given: 'Dana', months: 1 }, '2026-06-28T09:15:00-07:00')
  );
});

/* ------------------------------------------------------------- batches */

test('a batch goes in as one grant per code, each one belonging to the batch', () => {
  const books = giveBatch(NO_BOOKS, 'trade night', ['TN-1', 'TN-2', 'TN-3'], 2, TODAY);
  assert.equal(books.grants.length, 3);
  assert.deepEqual(
    books.grants.map((one) => [one.code, one.how, one.batch, one.months, one.given]),
    [
      ['TN-1', 'batch', 'trade night', 2, undefined],
      ['TN-2', 'batch', 'trade night', 2, undefined],
      ['TN-3', 'batch', 'trade night', 2, undefined],
    ]
  );
});

test('a batch with one bad code in it lands not at all, rather than half of it', () => {
  const already = giveGrant(NO_BOOKS, { code: 'TN-2', how: 'batch', batch: 'old', months: 1 }, TODAY);
  assert.throws(() => giveBatch(already, 'trade night', ['TN-1', 'TN-2'], 2, TODAY), OwnerError);
  assert.deepEqual(already.grants.map((one) => one.code), ['TN-2']);
});

test('a code repeated inside one batch is refused before anything is written down', () => {
  assert.throws(
    () => giveBatch(NO_BOOKS, 'trade night', ['TN-1', 'TN-1'], 2, TODAY),
    (error: unknown) => error instanceof OwnerError && /twice/.test((error as Error).message)
  );
});

test('an empty batch is refused rather than quietly doing nothing', () => {
  assert.throws(
    () => giveBatch(NO_BOOKS, 'trade night', [], 2, TODAY),
    (error: unknown) => error instanceof OwnerError && /no codes in it/.test((error as Error).message)
  );
});

/* ================================================== withdrawing one back */

test('an unredeemed code is withdrawn with the reason kept on it, and the grant survives', () => {
  const books = giveGrant(NO_BOOKS, { code: 'OOPS-1', how: 'named', given: 'Dana Boyle', months: 2 }, TODAY);
  const after = pullGrant(books, 'OOPS-1', '  sent to the wrong address  ', '2026-09-21T08:00:00Z');
  assert.equal(after.grants.length, 1);
  assert.deepEqual(after.grants[0]?.pulled, {
    at: '2026-09-21T08:00:00Z',
    because: 'sent to the wrong address',
  });
  // Never erased: everything it was is still there beside the withdrawal.
  assert.equal(after.grants[0]?.given, 'Dana Boyle');
  assert.equal(after.grants[0]?.months, 2);
});

test('a code Apple has reported redeemed cannot be withdrawn', () => {
  const books: Books = { ...NO_BOOKS, grants: [named({ redeemedAt: '2026-07-02T18:04:00Z' })] };
  assert.throws(
    () => pullGrant(books, 'GILBERT3', 'changed my mind', TODAY),
    (error: unknown) =>
      error instanceof OwnerError &&
      /Apple reported GILBERT3 redeemed on 2 July 2026/.test((error as Error).message)
  );
});

test('an empty reason is refused, because a withdrawal with no reason is a guess later', () => {
  const books = giveGrant(NO_BOOKS, { code: 'OOPS-1', how: 'named', given: 'Dana', months: 2 }, TODAY);
  assert.throws(
    () => pullGrant(books, 'OOPS-1', '   ', TODAY),
    (error: unknown) => error instanceof OwnerError && /Say why/.test((error as Error).message)
  );
});

test('withdrawing a code that is not there, or one already withdrawn, is refused', () => {
  const books = giveGrant(NO_BOOKS, { code: 'OOPS-1', how: 'named', given: 'Dana', months: 2 }, TODAY);
  assert.throws(() => pullGrant(books, 'NOPE', 'because', TODAY), OwnerError);
  const once = pullGrant(books, 'OOPS-1', 'wrong address', '2026-09-21T08:00:00Z');
  assert.throws(
    () => pullGrant(once, 'OOPS-1', 'again', TODAY),
    (error: unknown) =>
      error instanceof OwnerError && /already withdrawn on 21 September 2026/.test((error as Error).message)
  );
});

/* ============================================ Apple reporting a redemption */

test('a redemption is written down as the day Apple reported, and the months run from it', () => {
  const books = giveGrant(NO_BOOKS, { code: 'GILBERT3', how: 'named', given: 'Gilbert Ruiz', months: 3 }, TODAY);
  const after = markRedeemed(books, 'GILBERT3', '2026-07-02');
  assert.equal(after.grants[0]?.redeemedAt, '2026-07-02T00:00:00Z');
  assert.equal(runsOut(after.grants[0] as Grant, TODAY)?.on, '2026-10-02');
});

test('a code that is not there, and a date that is not a day, are both refused', () => {
  const books = giveGrant(NO_BOOKS, { code: 'GILBERT3', how: 'named', given: 'Gilbert Ruiz', months: 3 }, TODAY);
  assert.throws(() => markRedeemed(books, 'NOPE', '2026-07-02'), OwnerError);
  for (const day of ['2 July 2026', '2026-07-02T00:00:00Z', '2026-02-30', '']) {
    assert.throws(
      () => markRedeemed(books, 'GILBERT3', day),
      (error: unknown) => error instanceof OwnerError && /is not a day/.test((error as Error).message),
      `"${day}" should have been refused`
    );
  }
});

test('a second redemption is refused, because it would move the day the months end', () => {
  const once = markRedeemed(
    giveGrant(NO_BOOKS, { code: 'GILBERT3', how: 'named', given: 'Gilbert', months: 3 }, TODAY),
    'GILBERT3',
    '2026-07-02'
  );
  assert.throws(
    () => markRedeemed(once, 'GILBERT3', '2026-08-02'),
    (error: unknown) =>
      error instanceof OwnerError && /would move the day they end/.test((error as Error).message)
  );
});

test('a withdrawn code Apple later reports redeemed says both halves out loud', () => {
  const given = giveGrant(NO_BOOKS, { code: 'OOPS-1', how: 'named', given: 'Dana Boyle', months: 2 }, '2026-08-02T10:00:00Z');
  const pulled = pullGrant(given, 'OOPS-1', 'nobody had used it', '2026-08-05T11:00:00Z');
  const late = markRedeemed(pulled, 'OOPS-1', '2026-08-03');
  assert.equal(
    describeGrant(late.grants[0] as Grant, TODAY),
    'OOPS-1 - 2 free months, you say you gave it to Dana Boyle. Made 2 August 2026, withdrawn ' +
      '5 August 2026: nobody had used it. Apple has since reported it redeemed on 3 August 2026, ' +
      'so somebody was already inside those free months when it was withdrawn, and they run to ' +
      '3 October 2026.'
  );
});

/* ====================================================== when it runs out */

test('a redeemed run ends its months after the redemption, with the days left counted', () => {
  const ends = runsOut(named({ redeemedAt: '2026-07-02T18:04:00Z' }), TODAY);
  assert.deepEqual(ends, { on: '2026-10-02', daysLeft: 12, over: false });
});

test('a grant Apple has not reported redeemed gets nothing at all, never a guess', () => {
  assert.equal(runsOut(named(), TODAY), null);
  assert.equal(
    runsOut(named({ pulled: { at: '2026-07-01T00:00:00Z', because: 'wrong address' } }), TODAY),
    null
  );
});

test('the end of the month is clamped rather than rolling over into the next one', () => {
  const ends = runsOut(named({ redeemedAt: '2026-01-31T12:00:00Z', months: 1 }), TODAY);
  assert.equal(ends?.on, '2026-02-28');
});

test('a year of free months lands on the same day a year later', () => {
  const ends = runsOut(named({ redeemedAt: '2026-03-15T00:00:00Z', months: 12 }), TODAY);
  assert.equal(ends?.on, '2027-03-15');
});

test('the day it runs out is up, and the day after is behind', () => {
  assert.deepEqual(runsOut(named({ redeemedAt: '2026-08-20T00:00:00Z', months: 1 }), TODAY), {
    on: '2026-09-20',
    daysLeft: 0,
    over: true,
  });
  assert.deepEqual(runsOut(named({ redeemedAt: '2026-08-19T00:00:00Z', months: 1 }), TODAY), {
    on: '2026-09-19',
    daysLeft: -1,
    over: true,
  });
});

/* ============================================================ the money */

const july: Takings = {
  month: '2026-07',
  charged: 16_399n,
  proceeds: 11_479n,
  refunded: 799n,
  started: 4,
  cancelled: 1,
  renewed: 5,
  from: 'Subscriber Report July',
};
const august: Takings = {
  month: '2026-08',
  charged: 7_800n,
  proceeds: 5_460n,
  refunded: 0n,
  started: 1,
  cancelled: 2,
  renewed: 4,
  from: 'Subscriber Report August',
};

test('the months add up in exact cents, and Apple and tax is the difference', () => {
  const sum = readTakings([july, august]);
  assert.equal(sum.months, 2);
  assert.equal(sum.from, '2026-07');
  assert.equal(sum.to, '2026-08');
  assert.equal(sum.charged, 24_199n);
  assert.equal(sum.proceeds, 16_939n);
  assert.equal(sum.refunded, 799n);
  assert.equal(sum.appleAndTax, 7_260n);
  assert.equal(sum.started, 5);
  assert.equal(sum.cancelled, 3);
  assert.equal(sum.renewed, 9);
});

test('every figure summed is a bigint, never a number that could have been a float', () => {
  const sum = readTakings([july, august]);
  for (const figure of [sum.charged, sum.proceeds, sum.refunded, sum.appleAndTax]) {
    assert.equal(typeof figure, 'bigint');
  }
});

test('nothing at all sums to nothing at all, with no months and no span', () => {
  const sum = readTakings([]);
  assert.equal(sum.months, 0);
  assert.equal(sum.from, undefined);
  assert.equal(sum.charged, 0n);
});

test('the same month twice is refused rather than quietly doubled', () => {
  assert.throws(
    () => readTakings([july, { ...july, from: 'the same file again' }]),
    (error: unknown) =>
      error instanceof OwnerError && /July 2026 is in the takings twice/.test((error as Error).message)
  );
});

/* ========================================================== the trouble */

const broke = (over: Partial<Trouble>): Trouble => ({
  what: 'Cannot read properties of undefined',
  where: 'index-4f2a.js:812:19',
  times: 1,
  firstAt: '2026-09-01T10:00:00Z',
  lastAt: '2026-09-01T10:00:00Z',
  ...over,
});

test('the same fault reported six times is one line, and the commonest is at the top', () => {
  const gathered = gatherTroubles([
    broke({ times: 2, firstAt: '2026-09-02T10:00:00Z', lastAt: '2026-09-02T10:00:00Z' }),
    broke({ what: 'The plan would not draw', where: 'plan-9c1.js:44:2', times: 9 }),
    broke({ times: 4, firstAt: '2026-08-28T09:00:00Z', lastAt: '2026-09-05T22:00:00Z' }),
  ]);
  assert.equal(gathered.length, 2);
  assert.equal(gathered[0]?.what, 'The plan would not draw');
  assert.equal(gathered[0]?.times, 9);
  assert.equal(gathered[1]?.times, 6);
  assert.equal(gathered[1]?.firstAt, '2026-08-28T09:00:00Z');
  assert.equal(gathered[1]?.lastAt, '2026-09-05T22:00:00Z');
});

test('a version survives when every report agreed on it, and goes when they did not', () => {
  const agreed = gatherTroubles([broke({ version: '0.4.1' }), broke({ version: '0.4.1' })]);
  assert.equal(agreed[0]?.version, '0.4.1');
  const disagreed = gatherTroubles([broke({ version: '0.4.1' }), broke({ version: '0.5.0' })]);
  assert.equal(disagreed[0]?.version, undefined);
  assert.equal(disagreed[0]?.times, 2);
});

test('the same reports always come back in the same order', () => {
  const reports = [broke({ times: 3 }), broke({ what: 'Another', times: 3 })];
  assert.deepEqual(
    gatherTroubles(reports).map((one) => one.what),
    gatherTroubles([...reports].reverse()).map((one) => one.what)
  );
});

/* ============================================================ the funnel */

const at = (who: string, stage: Tester['stage']): Tester => ({
  who,
  stage,
  at: '2026-09-01T10:00:00Z',
});

test('every stage counts everybody who got at least that far, and the gap is a number', () => {
  const funnel = whereTheyGotTo([
    at('a', 'asked'),
    at('b', 'asked'),
    at('c', 'invited'),
    at('d', 'invited'),
    at('e', 'invited'),
    at('f', 'installed'),
    at('g', 'installed'),
    at('h', 'installed'),
    at('i', 'installed'),
    at('j', 'opened'),
    at('k', 'opened'),
    at('l', 'opened'),
    at('m', 'opened'),
    at('n', 'opened'),
  ]);
  assert.deepEqual(funnel, [
    { stage: 'asked', reached: 14, lost: 0 },
    { stage: 'invited', reached: 12, lost: 2 },
    { stage: 'installed', reached: 9, lost: 3 },
    { stage: 'opened', reached: 5, lost: 4 },
  ]);
});

test('nobody on the list is four zeroes rather than nothing to show', () => {
  assert.deepEqual(
    whereTheyGotTo([]).map((step) => step.reached),
    [0, 0, 0, 0]
  );
});

/* ========================================================== the sentences */

test('a redeemed named grant keeps Apple’s fact and Sam’s note in separate clauses', () => {
  assert.equal(
    describeGrant(named({ redeemedAt: '2026-07-02T18:04:00Z' }), TODAY),
    'GILBERT3 - 3 free months, you say you gave it to Gilbert Ruiz. Made 28 June 2026. ' +
      'Apple reported it redeemed on 2 July 2026, so it runs out 2 October 2026 - 12 days left.'
  );
});

test('a grant Apple has not reported redeemed says the report lags, in so many words', () => {
  assert.equal(
    describeGrant(
      { code: 'TN-1', how: 'batch', batch: 'trade night', months: 1, madeAt: '2026-08-01T10:00:00Z' },
      TODAY
    ),
    'TN-1 - 1 free month, part of the trade night batch, so it went to nobody in particular. ' +
      'Made 1 August 2026. Apple has not reported it redeemed, which is not the same as knowing ' +
      "it was unused: a report lags by days, so it may already be in somebody's hands."
  );
});

test('a withdrawn grant carries its reason and says Apple had not reported it redeemed', () => {
  assert.equal(
    describeGrant(
      named({
        code: 'OOPS-1',
        given: 'Dana Boyle',
        months: 2,
        madeAt: '2026-08-02T10:00:00Z',
        pulled: { at: '2026-08-05T11:00:00Z', because: 'sent to the wrong address' },
      }),
      TODAY
    ),
    'OOPS-1 - 2 free months, you say you gave it to Dana Boyle. Made 2 August 2026, withdrawn ' +
      '5 August 2026: sent to the wrong address. Apple had not reported it redeemed.'
  );
});

test('a run that is over says so, in days, rather than showing a date and leaving it', () => {
  assert.match(
    describeGrant(named({ redeemedAt: '2026-05-01T00:00:00Z', months: 1 }), TODAY),
    /the free months were up 111 days ago\.$/
  );
  assert.match(
    describeGrant(named({ redeemedAt: '2026-08-20T00:00:00Z', months: 1 }), TODAY),
    /the free months are up today\.$/
  );
  assert.match(
    describeGrant(named({ redeemedAt: '2026-08-21T00:00:00Z', months: 1 }), TODAY),
    /1 day left\.$/
  );
});

test('no sentence about a grant ever says Apple reported who redeemed it', () => {
  const said = [
    describeGrant(named({ redeemedAt: '2026-07-02T18:04:00Z' }), TODAY),
    describeGrant(named(), TODAY),
  ];
  for (const one of said) {
    assert.equal(/Apple[^.]*Gilbert/.test(one), false, one);
  }
});

const contact = (over: Partial<Contact> = {}): Contact => ({
  who: 'Gilbert Ruiz',
  at: '2026-09-02T14:00:00Z',
  about: 'the plan would not print',
  ...over,
});

const full: Books = {
  grants: [
    named({ redeemedAt: '2026-07-02T18:04:00Z' }),
    { code: 'TN-1', how: 'batch', batch: 'trade night', months: 1, madeAt: '2026-08-01T10:00:00Z' },
    named({
      code: 'OOPS-1',
      madeAt: '2026-08-02T10:00:00Z',
      pulled: { at: '2026-08-05T11:00:00Z', because: 'sent to the wrong address' },
    }),
  ],
  takings: [july, august],
  testers: [at('a', 'asked'), at('b', 'installed'), at('c', 'opened')],
  troubles: [broke({ times: 4 }), broke({ what: 'The plan would not draw', times: 1 })],
  contacts: [contact(), contact({ who: 'Dana Boyle', settled: { at: TODAY, did: 'rang her' } })],
};

test('the whole business reads as one paragraph, with the money in exact dollars', () => {
  const said = describeBooks(full, TODAY);
  assert.match(
    said,
    /^2 months of Apple's reports, July 2026 to August 2026: \$241\.99 charged, \$169\.39 to be paid out, \$72\.60 to Apple and tax, \$7\.99 refunded\./
  );
  assert.match(said, /5 started, 9 renewed, 3 cancelled\./);
  assert.match(said, /no year is worked out from them here/);
  assert.match(
    said,
    /3 free runs given away\. Apple has reported 1 of them redeemed, 1 still inside the free months, 1 withdrawn\./
  );
  assert.match(said, /What Apple has not reported redeemed is not the same as unused\./);
  assert.match(said, /3 asked for TestFlight, 1 have opened it\./);
  assert.match(said, /5 reports of something going wrong, 2 separate faults\./);
  assert.match(said, /2 contractors in touch, 1 not dealt with\./);
});

test('nothing in the books says so plainly rather than printing a row of zeroes', () => {
  const said = describeBooks(NO_BOOKS, TODAY);
  assert.match(said, /No report from Apple has been read in yet/);
  assert.match(said, /No free months have been given away\./);
  assert.match(said, /Nobody is on the TestFlight list yet\./);
  assert.match(said, /Nothing has been reported broken\./);
  assert.match(said, /Nobody has been in touch\./);
  assert.equal(/\$0\.00/.test(said), false, said);
});

test('nothing is ever annualised, forecast or averaged', () => {
  const said = describeBooks(full, TODAY);
  for (const word of ['a year', 'per year', 'annual', 'forecast', 'on average', 'projected']) {
    assert.equal(
      said.toLowerCase().includes(word) && !said.includes('no year is worked out'),
      false,
      `"${word}" turned up in: ${said}`
    );
  }
});

/* ================================================= the dates, read aloud */

test('a date reads the same on every machine, because none of it comes from the locale', () => {
  assert.equal(readDay('2026-07-02'), '2 July 2026');
  assert.equal(readDay('2026-12-31'), '31 December 2026');
  assert.equal(readMonth('2026-01'), 'January 2026');
});

/* ============================================ the line it must not cross */

test('books.ts reaches for nothing out of a contractor’s room', () => {
  const source = readFileSync(new URL('../books.ts', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/from '([^']+)'/g)].map((one) => one[1]);
  assert.deepEqual(
    [...new Set(imports)].sort(),
    ['./owner.ts', './price.ts'],
    'the owner half of this app imported something out of the measurement half'
  );
});
