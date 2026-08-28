import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_COMPANY, postalAddress } from '../company.ts';
import {
  BUSINESS_DAYS_TO_CANCEL,
  CoolingError,
  NOTICE_NOT_COMPLETED,
  RIGHT_TO_CANCEL_STATEMENT,
  WHAT_THIS_DOES_NOT_KNOW,
  addBusinessDays,
  cancellationDeadline,
  cancellationNotice,
  coolingApplies,
  describeCooling,
  isBusinessDay,
  sayDate,
} from '../cooling.ts';

const SELLER = { name: 'Alvarez Remodeling', address: '2200 Oak Street, Mesa AZ 85201' };

/* ============================================================ business days */

/**
 * The definition in § 429.0 is not the one anybody expects, and every check in
 * this block is written against the regulation rather than against intuition:
 * "any calendar day except Sunday or any federal holiday".
 */
test('Saturday is a business day and Sunday is not', () => {
  assert.equal(isBusinessDay('2026-08-29'), true, 'Saturday');
  assert.equal(isBusinessDay('2026-08-30'), false, 'Sunday');
  assert.equal(isBusinessDay('2026-08-31'), true, 'Monday');
});

test('every federal holiday of 2026 is excluded', () => {
  for (const day of [
    '2026-01-01', // New Year's Day, a Thursday
    '2026-01-19', // Birthday of Martin Luther King, Jr., third Monday
    '2026-02-16', // Washington's Birthday, third Monday
    '2026-05-25', // Memorial Day, last Monday
    '2026-06-19', // Juneteenth, a Friday
    '2026-07-04', // Independence Day, a Saturday
    '2026-09-07', // Labor Day, first Monday
    '2026-10-12', // Columbus Day, second Monday
    '2026-11-11', // Veterans Day, a Wednesday
    '2026-11-26', // Thanksgiving, fourth Thursday
    '2026-12-25', // Christmas Day, a Friday
  ]) {
    assert.equal(isBusinessDay(day), false, day);
  }
});

test('a fixed holiday falling on a Saturday takes the Friday with it', () => {
  // Independence Day 2026 is a Saturday, observed on Friday 3 July. Counting
  // the observed day is the safe side of § 429.1(c)'s "not earlier than".
  assert.equal(isBusinessDay('2026-07-03'), false, 'the observed holiday');
  assert.equal(isBusinessDay('2026-07-04'), false, 'the holiday itself');
  assert.equal(isBusinessDay('2026-07-06'), true, 'the Monday after is ordinary');
});

test('the day after Thanksgiving is a business day, because it is not a federal holiday', () => {
  assert.equal(isBusinessDay('2026-11-27'), true);
});

/* ============================================== the deadline, across a weekend */

test('three business days across a weekend, and over a month boundary', () => {
  // Signed Friday 28 August 2026. Saturday counts as the first business day,
  // Sunday does not, Monday is the second and Tuesday the third.
  //
  // This is the check that fails if somebody "fixes" the counter to skip
  // weekends the way the rest of the world means them: that mistake lands the
  // deadline on Wednesday 2 September, a day late, and a contractor who
  // believed it would tell a client the wrong date.
  assert.equal(cancellationDeadline('2026-08-28'), '2026-09-01');
});

test('three business days over a month boundary with no weekend in them', () => {
  // Signed Monday 31 August 2026: Tuesday, Wednesday, Thursday.
  assert.equal(cancellationDeadline('2026-08-31'), '2026-09-03');
});

test('three business days over a year boundary and a holiday', () => {
  // Signed Wednesday 31 December 2025. New Year's Day is a Thursday and is
  // out; Friday is the first, Saturday the second, Sunday is out, Monday is
  // the third.
  assert.equal(cancellationDeadline('2025-12-31'), '2026-01-05');
});

test('an observed holiday, the holiday itself and a Sunday all push the deadline out', () => {
  // Signed Thursday 2 July 2026. Friday 3rd is Independence Day observed,
  // Saturday 4th is Independence Day, Sunday 5th is a Sunday: the count does
  // not start until Monday 6th.
  assert.equal(cancellationDeadline('2026-07-02'), '2026-07-08');
});

test('Christmas on a Friday', () => {
  // Signed Thursday 24 December 2026. Christmas is out, Saturday is the first,
  // Sunday is out, Monday the second, Tuesday the third.
  assert.equal(cancellationDeadline('2026-12-24'), '2026-12-29');
});

test('Thanksgiving is out but the Friday after it is not', () => {
  // Signed Wednesday 25 November 2026: Thursday is Thanksgiving, Friday is the
  // first business day, Saturday the second, Sunday out, Monday the third.
  assert.equal(cancellationDeadline('2026-11-25'), '2026-11-30');
});

test('the day of the sale is never one of the three', () => {
  // Signed on a Monday, the count starts Tuesday. If the transaction date were
  // counted the answer would be Wednesday.
  assert.equal(cancellationDeadline('2026-08-31'), '2026-09-03');
  assert.equal(BUSINESS_DAYS_TO_CANCEL, 3);
});

test('the deadline is never earlier than three calendar days after the sale', () => {
  // § 429.1(c) says "not earlier than the third business day following the date
  // of the transaction". Walked across a whole year rather than spot-checked,
  // because the failure this guards against is one bad week in one month.
  let day = '2026-01-01';
  for (let i = 0; i < 365; i += 1) {
    const deadline = cancellationDeadline(day);
    const gap =
      (Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86400000;
    assert.ok(gap >= 3, `${day} gave ${deadline}, only ${gap} days`);
    assert.ok(gap <= 8, `${day} gave ${deadline}, ${gap} days is too far to be right`);
    assert.equal(isBusinessDay(deadline), true, `${deadline} is not a business day`);
    day = new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  }
});

test('a date that is not a date is refused rather than guessed at', () => {
  assert.throws(() => cancellationDeadline('31/08/2026'), CoolingError);
  assert.throws(() => cancellationDeadline('2026-02-30'), CoolingError);
  assert.throws(() => cancellationDeadline(''), CoolingError);
  assert.throws(() => addBusinessDays('2026-08-31', 0), CoolingError);
});

test('a date is spelled out the same way on every phone', () => {
  assert.equal(sayDate('2026-09-01'), 'Tuesday, September 1, 2026');
  assert.equal(sayDate('2026-01-05'), 'Monday, January 5, 2026');
});

/* ================================================== whether the rule applies */

test('signed at the client’s home for $25 or more, the notice is owed', () => {
  const read = coolingApplies('buyer-home', 2500n);
  assert.equal(read.applies, true);
  assert.match(read.why, /16 CFR 429/);
});

test('signed at the client’s home under $25, it is not', () => {
  const read = coolingApplies('buyer-home', 2499n);
  assert.equal(read.applies, false);
  assert.match(read.why, /under the \$25\.00 that the rule sets/);
  // Even here it says the state may differ rather than closing the question.
  assert.match(read.why, /does not know your state/);
});

test('away from both, the threshold is $130 and not $25', () => {
  assert.equal(coolingApplies('away-from-both', 12999n).applies, false);
  assert.equal(coolingApplies('away-from-both', 13000n).applies, true);
  // The same money at the buyer's home is over the line, which is the whole
  // reason the venue is three answers and not two.
  assert.equal(coolingApplies('buyer-home', 12999n).applies, true);
});

test('signed at the contractor’s own place of business, no federal notice is owed', () => {
  const read = coolingApplies('seller-place', 5_000_00n);
  assert.equal(read.applies, false);
  assert.match(read.why, /not a door-to-door sale/);
  assert.match(read.why, /does not know your state/);
});

/* =========================================================== the notice itself */

test('the notice carries the rule’s own sentence, word for word', () => {
  const notice = cancellationNotice(SELLER, '2026-08-28');
  assert.equal(notice.statement, RIGHT_TO_CANCEL_STATEMENT);
  assert.match(
    notice.statement,
    /prior to midnight of the third business day after the date of this transaction/
  );
});

test('the form is completed with the four things § 429.1(c) makes the seller’s job', () => {
  const notice = cancellationNotice(SELLER, '2026-08-28');
  const text = notice.form.join('\n');
  assert.match(text, /Alvarez Remodeling/, 'the name of the seller');
  assert.match(text, /2200 Oak Street, Mesa AZ 85201/, 'the address of the seller');
  assert.match(text, /Date of transaction: Friday, August 28, 2026/, 'the date of the transaction');
  assert.match(
    text,
    /NOT LATER THAN MIDNIGHT OF Tuesday, September 1, 2026/,
    'the date by which the buyer may cancel'
  );
  assert.equal(notice.deadline, '2026-09-01');
  assert.equal(notice.copies, 2, 'the rule wants it in duplicate');
});

test('the form keeps the paragraphs the rule requires', () => {
  const text = cancellationNotice(SELLER, '2026-08-28').form.join('\n');
  assert.match(text, /without any Penalty or Obligation, within THREE BUSINESS DAYS/);
  assert.match(text, /within TEN BUSINESS DAYS following receipt by the seller/);
  assert.match(text, /any security interest arising out of the transaction will be cancelled/);
  assert.match(text, /you must make available to the seller at your residence/);
  assert.match(text, /does not pick them up within 20 days/);
  assert.match(text, /you remain liable for performance of all obligations under the contract/);
  assert.match(text, /I HEREBY CANCEL THIS TRANSACTION\./);
});

test('a notice with no seller on it is refused rather than printed with a hole', () => {
  assert.throws(() => cancellationNotice({ name: '', address: 'x' }, '2026-08-28'), CoolingError);
  assert.throws(
    () => cancellationNotice({ name: 'Alvarez Remodeling', address: '   ' }, '2026-08-28'),
    CoolingError
  );
});

test('a seller with no address at all is refused exactly like one with a blank', () => {
  // The state every profile saved before there was an address field is in.
  // `undefined` has to reach here as `undefined` and be refused on arrival —
  // if a caller were forced to turn it into '' on the way in, the absence
  // would be gone by the time anything could refuse it.
  assert.throws(
    () => cancellationNotice({ name: 'Alvarez Remodeling', address: undefined }, '2026-08-28'),
    CoolingError
  );
  assert.throws(
    () => cancellationNotice({ name: 'Alvarez Remodeling', address: postalAddress(EMPTY_COMPANY) },
      '2026-08-28'),
    CoolingError
  );
});

test('the refusal names the business profile, because that is where the fix is', () => {
  // A refusal a contractor cannot act on is a refusal he ignores. It used to
  // say the address was needed without saying where to put it, back when the
  // answer was a box on the Agreement screen he had already walked past.
  assert.throws(
    () => cancellationNotice({ name: 'Alvarez Remodeling', address: undefined }, '2026-08-28'),
    (error: unknown) => {
      assert.ok(error instanceof CoolingError);
      assert.match(error.message, /business profile/);
      assert.match(error.message, /429\.1\(c\)/);
      return true;
    }
  );
});

test('an address typed over several lines reaches the form as one sentence', () => {
  // § 429.1(b) puts the address inside a sentence — "mail or deliver ... to
  // NAME, at ADDRESS, NOT LATER THAN ..." — so the lines somebody typed have
  // to arrive flattened. A line break inside that sentence would break the
  // sentence, and on the HTML document it would either vanish or, escaped
  // wrongly, become markup.
  const company = { ...EMPTY_COMPANY, address: '2200 Oak Street\nMesa AZ 85201' };
  const notice = cancellationNotice(
    { name: 'Alvarez Remodeling', address: postalAddress(company) },
    '2026-08-28'
  );
  assert.equal(notice.sellerAddress, '2200 Oak Street, Mesa AZ 85201');
  assert.match(notice.form.join('\n'), /at 2200 Oak Street, Mesa AZ 85201, NOT LATER THAN/);
  for (const line of notice.form) assert.doesNotMatch(line, /[\r\n]/, line);
});

test('when the form cannot be completed there are words for saying so, and they are not a form', () => {
  const said = NOTICE_NOT_COMPLETED.join(' ');
  assert.match(said, /THIS NOTICE COULD NOT BE COMPLETED/);
  // It says what is missing, whose job it was, and what each of the two people
  // holding the document should do about it.
  assert.match(said, /16 CFR 429\.1\(c\)/);
  assert.match(said, /address of the seller’s place of business/);
  assert.match(said, /business profile/);
  assert.match(said, /the right to cancel does not depend on this paperwork existing/);
  // And it is never captioned like the real form. A buyer must not be able to
  // fill this in, post it, and believe he has cancelled.
  assert.doesNotMatch(said, /NOTICE OF CANCELLATION/);
  assert.doesNotMatch(said, /I HEREBY CANCEL/);
});

test('what the app does not know is said, not left out', () => {
  const said = WHAT_THIS_DOES_NOT_KNOW.join(' ');
  assert.match(said, /not legal advice/);
  assert.match(said, /Many states have their own/);
  assert.match(said, /longer than three days/);
  // And it names no state, because no state's rule was checked.
  assert.doesNotMatch(said, /California|Arizona|New York|Texas|Florida/);
});

test('the screen’s version explains the counting rather than only the date', () => {
  const read = coolingApplies('buyer-home', 500_000n);
  const said = describeCooling(read, cancellationNotice(SELLER, '2026-08-28')).join(' ');
  assert.match(said, /Saturdays count, Sundays and federal holidays do not/);
  assert.match(said, /Tuesday, September 1, 2026/);
  assert.match(said, /both copies/);
});

test('when it does not apply the screen says why and nothing more', () => {
  const read = coolingApplies('seller-place', 500_000n);
  assert.deepEqual(describeCooling(read, null), [read.why]);
});
