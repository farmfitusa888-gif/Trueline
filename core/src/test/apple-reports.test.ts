import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OwnerError } from '../owner.ts';
import {
  SUBSCRIBER_REPORT_1_3,
  SUBSCRIPTION_EVENT_REPORT_1_3,
  foldIn,
  readEventReport,
  readMoneyReport,
  takingsFrom,
} from '../apple-reports.ts';
import { readTakings } from '../books.ts';

/**
 * Reading Apple's own report files, and refusing everything that is not one.
 *
 * ## What these tests can and cannot prove
 *
 * They prove the parser's behaviour: that it adds up in exact cents, that it
 * refuses a header it does not recognise, a currency it is not summing, a date
 * it cannot read unambiguously, an event it has no meaning for, and a month it
 * has already read in.
 *
 * They **cannot** prove the column lists are Apple's, because there is no real
 * App Store Connect export in this repository or on the machine this was
 * written on to hold beside them. The lists came off Apple's published
 * reference pages, and the first test below is the whole reason the constants
 * exist as constants: it holds them against a header written out again by hand
 * here, so an accidental edit to either is a failure rather than a file that
 * still parses.
 *
 * That is also why the parser refuses rather than reads what it recognises. If
 * a name in that list is wrong, the failure is a report that will not open and
 * a message naming the column -- not a total on Sam's screen that is quietly
 * out by a month.
 *
 * Every figure below is integer cents, and every one of them is checkable by
 * hand from the rows above it.
 */

/* ---------------------------------------------------- the headers, by hand */

/** The Subscriber Report's header, written out again rather than imported. */
const MONEY_HEADER =
  'Event Date\tApp Name\tApp Apple ID\tSubscription Name\tSubscription Apple ID\t' +
  'Subscription Group ID\tStandard Subscription Duration\tSubscription Offer Name\t' +
  'Promotional Offer ID\tSubscription Offer Type\tSubscription Offer Duration\t' +
  'Marketing Opt-In Duration\tCustomer Price\tCustomer Currency\tDeveloper Proceeds\t' +
  'Proceeds Currency\tPreserved Pricing\tProceeds Reason\tClient\tDevice\tCountry\t' +
  'Subscriber ID\tSubscriber ID Reset\tRefund\tPurchase Date\tUnits';

/** The Subscription Event Report's header, written out again rather than imported. */
const EVENT_HEADER =
  'Event Date\tEvent\tApp Name\tApp Apple ID\tSubscription Name\tSubscription Apple ID\t' +
  'Subscription Group ID\tStandard Subscription Duration\tSubscription Offer Type\t' +
  'Subscription Offer Duration\tMarketing Opt-In\tMarketing Opt-In Duration\tPreserved Pricing\t' +
  'Proceeds Reason\tSubscription Offer Name\tPromotional Offer ID\tConsecutive Paid Periods\t' +
  'Original Start Date\tDevice\tClient\tState\tCountry\tPrevious Subscription Name\t' +
  'Previous Subscription Apple ID\tDays Before Canceling\tCancellation Reason\tDays Canceled\t' +
  'Quantity\tPaid Service Days Recovered';

test('the declared layouts are the headers this test writes out by hand', () => {
  assert.equal(SUBSCRIBER_REPORT_1_3.join('\t'), MONEY_HEADER);
  assert.equal(SUBSCRIPTION_EVENT_REPORT_1_3.join('\t'), EVENT_HEADER);
});

/* ------------------------------------------------------------- fixtures */

/** One row of whichever report, with everything not named filled in plainly. */
function row(header: string, said: Readonly<Record<string, string>>): string {
  return header
    .split('\t')
    .map((column) => said[column] ?? filler(column))
    .join('\t');
}

function filler(column: string): string {
  if (column === 'Units' || column === 'Quantity') return '1';
  if (column === 'Customer Price' || column === 'Developer Proceeds') return '0.00';
  if (column === 'Customer Currency' || column === 'Proceeds Currency') return 'USD';
  if (column === 'App Name') return 'ScanToBid';
  if (column === 'Refund') return '';
  return '';
}

const money = (rows: readonly Readonly<Record<string, string>>[]) =>
  [MONEY_HEADER, ...rows.map((one) => row(MONEY_HEADER, one))].join('\n');

const events = (rows: readonly Readonly<Record<string, string>>[]) =>
  [EVENT_HEADER, ...rows.map((one) => row(EVENT_HEADER, one))].join('\n');

/**
 * Two months of money.
 *
 * July: one at $7.99 and two at $78.00, and one $7.99 handed back.
 *   charged   799 + 15,600 = 16,399c
 *   proceeds  559 + 10,920 = 11,479c
 *   refunded  799c
 * August: one at $78.00.
 *   charged   7,800c   proceeds 5,460c   refunded 0
 */
const TWO_MONTHS_OF_MONEY = money([
  { 'Event Date': '2026-07-02', 'Customer Price': '7.99', 'Developer Proceeds': '5.59', Units: '1' },
  { 'Event Date': '2026-07-19', 'Customer Price': '78.00', 'Developer Proceeds': '54.60', Units: '2', Refund: 'No' },
  { 'Event Date': '2026-07-25', 'Customer Price': '7.99', 'Developer Proceeds': '5.59', Units: '1', Refund: 'Yes' },
  { 'Event Date': '2026-08-03', 'Customer Price': '78.00', 'Developer Proceeds': '54.60', Units: '1', Refund: 'No' },
]);

/**
 * The same two months of events.
 *
 * July: 3 started, 5 renewed, 1 cancelled, and an upgrade that is neither.
 * August: 1 started, 4 renewed, 2 cancelled.
 */
const TWO_MONTHS_OF_EVENTS = events([
  { 'Event Date': '2026-07-04', Event: 'Start Introductory Price', Quantity: '3' },
  { 'Event Date': '2026-07-11', Event: 'Renew', Quantity: '5' },
  { 'Event Date': '2026-07-22', Event: 'Cancel', Quantity: '1' },
  { 'Event Date': '2026-07-28', Event: 'Upgrade', Quantity: '2' },
  { 'Event Date': '2026-08-05', Event: 'Reactivate', Quantity: '1' },
  { 'Event Date': '2026-08-09', Event: 'Renew', Quantity: '4' },
  { 'Event Date': '2026-08-27', Event: 'Cancel', Quantity: '2' },
]);

/* =========================================================== the money */

test('the money adds up month by month, in exact cents, with units multiplied through', () => {
  assert.deepEqual(readMoneyReport(TWO_MONTHS_OF_MONEY, 'USD'), [
    { month: '2026-07', charged: 16_399n, proceeds: 11_479n, refunded: 799n },
    { month: '2026-08', charged: 7_800n, proceeds: 5_460n, refunded: 0n },
  ]);
});

test('a refunded row goes to refunds and to neither of the other two', () => {
  const one = readMoneyReport(
    money([
      { 'Event Date': '2026-07-25', 'Customer Price': '7.99', 'Developer Proceeds': '5.59', Refund: 'Yes' },
    ]),
    'USD'
  );
  assert.deepEqual(one, [{ month: '2026-07', charged: 0n, proceeds: 0n, refunded: 799n }]);
});

test('the slashed dates Apple writes are read month first', () => {
  const one = readMoneyReport(
    money([{ 'Event Date': '07/02/2026', 'Customer Price': '7.99', 'Developer Proceeds': '5.59' }]),
    'USD'
  );
  assert.equal(one[0]?.month, '2026-07');
});

test('a date that cannot be month first stops the file rather than being read the other way', () => {
  assert.throws(
    () =>
      readMoneyReport(
        money([{ 'Event Date': '25/07/2026', 'Customer Price': '7.99', 'Developer Proceeds': '5.59' }]),
        'USD'
      ),
    (error: unknown) =>
      error instanceof OwnerError && /written day first/.test((error as Error).message)
  );
});

test('a currency that is not the one being summed stops the file', () => {
  const mixed = money([
    { 'Event Date': '2026-07-02', 'Customer Price': '7.99', 'Developer Proceeds': '5.59' },
    {
      'Event Date': '2026-07-03',
      'Customer Price': '8.99',
      'Developer Proceeds': '6.29',
      'Customer Currency': 'EUR',
      'Proceeds Currency': 'EUR',
    },
  ]);
  assert.throws(
    () => readMoneyReport(mixed, 'USD'),
    (error: unknown) =>
      error instanceof OwnerError &&
      /Line 3 .* is in EUR under Customer Currency/.test((error as Error).message)
  );
  // And summing the euros instead is refused for the same reason, the other way up.
  assert.throws(() => readMoneyReport(mixed, 'EUR'), OwnerError);
});

test('a Refund column saying something this does not know stops the file', () => {
  assert.throws(
    () =>
      readMoneyReport(
        money([
          { 'Event Date': '2026-07-02', 'Customer Price': '7.99', 'Developer Proceeds': '5.59', Refund: 'R' },
        ]),
        'USD'
      ),
    (error: unknown) =>
      error instanceof OwnerError && /quietly lose the refund/.test((error as Error).message)
  );
});

test('a price with a third of a cent in it is refused rather than rounded', () => {
  assert.throws(
    () =>
      readMoneyReport(
        money([{ 'Event Date': '2026-07-02', 'Customer Price': '7.995', 'Developer Proceeds': '5.59' }]),
        'USD'
      ),
    (error: unknown) =>
      error instanceof OwnerError && /not an amount of money this can hold exactly/.test((error as Error).message)
  );
});

test('a currency nobody named is refused, because there is no default and should not be', () => {
  assert.throws(
    () => readMoneyReport(TWO_MONTHS_OF_MONEY, '  '),
    (error: unknown) =>
      error instanceof OwnerError &&
      /Say which currency is being summed/.test((error as Error).message)
  );
});

test('a date in no shape at all stops the file rather than being taken as some month', () => {
  assert.throws(
    () =>
      readMoneyReport(
        money([{ 'Event Date': 'July 2026', 'Customer Price': '7.99', 'Developer Proceeds': '5.59' }]),
        'USD'
      ),
    (error: unknown) =>
      error instanceof OwnerError &&
      /which is neither 2026-07-02 nor 07\/02\/2026/.test((error as Error).message)
  );
});

/* ========================================================== the events */

test('the events add up month by month, with the quantity on each row added rather than counted', () => {
  assert.deepEqual(readEventReport(TWO_MONTHS_OF_EVENTS), [
    { month: '2026-07', started: 3, cancelled: 1, renewed: 5 },
    { month: '2026-08', started: 1, cancelled: 2, renewed: 4 },
  ]);
});

test('an upgrade is neither a start nor a cancellation, because the same person is still there', () => {
  assert.deepEqual(readEventReport(events([{ 'Event Date': '2026-07-28', Event: 'Upgrade', Quantity: '9' }])), [
    { month: '2026-07', started: 0, cancelled: 0, renewed: 0 },
  ]);
});

test('an event this has no meaning for stops the file rather than counting the month short', () => {
  assert.throws(
    () => readEventReport(events([{ 'Event Date': '2026-07-04', Event: 'Resubscribe', Quantity: '1' }])),
    (error: unknown) =>
      error instanceof OwnerError &&
      /has the event "Resubscribe", which this does not have a meaning for/.test((error as Error).message)
  );
});

test('a quantity that is not a whole number of subscriptions stops the file', () => {
  for (const quantity of ['1.5', '-2', 'two', '']) {
    assert.throws(
      () => readEventReport(events([{ 'Event Date': '2026-07-04', Event: 'Renew', Quantity: quantity }])),
      OwnerError,
      `"${quantity}" should have been refused`
    );
  }
});

/* ======================================================== the refusals */

test('a header that is not the declared layout stops, and prints the header it saw', () => {
  const wrong = ['Event Date\tEvent\tMoney', '2026-07-04\tRenew\t7.99'].join('\n');
  assert.throws(
    () => readEventReport(wrong),
    (error: unknown) =>
      error instanceof OwnerError &&
      /column 3 is "Money" where the Subscription Event Report \(version 1_3\) has "App Name"/.test(
        (error as Error).message
      ) &&
      /The header it actually has: Event Date \| Event \| Money/.test((error as Error).message)
  );
});

test('a column inserted in the middle stops, which is the case that matters most', () => {
  const shifted = SUBSCRIBER_REPORT_1_3.slice(0, 13)
    .concat(['Something New'], SUBSCRIBER_REPORT_1_3.slice(13))
    .join('\t');
  assert.throws(
    () => readMoneyReport([shifted, ''].join('\n'), 'USD'),
    (error: unknown) => error instanceof OwnerError && /column 14 is "Something New"/.test((error as Error).message)
  );
});

test('a file a spreadsheet saved as commas is named for what is wrong with it', () => {
  assert.throws(
    () => readMoneyReport('Event Date,App Name,App Apple ID\n2026-07-02,ScanToBid,1', 'USD'),
    (error: unknown) =>
      error instanceof OwnerError && /tab-separated and that file is not/.test((error as Error).message)
  );
});

test('a row with the wrong number of fields stops the whole file, not just that row', () => {
  assert.throws(
    () => readEventReport([EVENT_HEADER, '2026-07-04\tRenew'].join('\n')),
    (error: unknown) =>
      error instanceof OwnerError && /Line 2 .* has 2 fields where the header has 29/.test((error as Error).message)
  );
});

test('an empty file is refused rather than read as a month of nothing', () => {
  assert.throws(() => readMoneyReport('', 'USD'), OwnerError);
});

test('a report with a header and no rows reads as no months at all', () => {
  assert.deepEqual(readMoneyReport(MONEY_HEADER, 'USD'), []);
});

/* ===================================================== joining the two */

test('the two reports join into month lines the dashboard reads', () => {
  const lines = takingsFrom(
    readMoneyReport(TWO_MONTHS_OF_MONEY, 'USD'),
    readEventReport(TWO_MONTHS_OF_EVENTS),
    'July and August 2026'
  );
  assert.deepEqual(lines, [
    {
      month: '2026-07',
      charged: 16_399n,
      proceeds: 11_479n,
      refunded: 799n,
      started: 3,
      cancelled: 1,
      renewed: 5,
      from: 'July and August 2026',
    },
    {
      month: '2026-08',
      charged: 7_800n,
      proceeds: 5_460n,
      refunded: 0n,
      started: 1,
      cancelled: 2,
      renewed: 4,
      from: 'July and August 2026',
    },
  ]);
});

test('what comes out of the two reports adds up to what a person can check by hand', () => {
  const sum = readTakings(
    takingsFrom(
      readMoneyReport(TWO_MONTHS_OF_MONEY, 'USD'),
      readEventReport(TWO_MONTHS_OF_EVENTS),
      'July and August 2026'
    )
  );
  assert.equal(sum.charged, 24_199n);
  assert.equal(sum.proceeds, 16_939n);
  assert.equal(sum.appleAndTax, 7_260n);
  assert.equal(sum.refunded, 799n);
  assert.equal(sum.started, 4);
  assert.equal(sum.renewed, 9);
  assert.equal(sum.cancelled, 3);
});

test('two reports with no rows between them are refused rather than read as a quiet month', () => {
  assert.throws(
    () => takingsFrom(readMoneyReport(MONEY_HEADER, 'USD'), readEventReport(EVENT_HEADER), 'nothing at all'),
    (error: unknown) =>
      error instanceof OwnerError &&
      /Neither report had a single row in it/.test((error as Error).message)
  );
});

test('two reports covering different months are refused, because a zero would be a guess', () => {
  assert.throws(
    () =>
      takingsFrom(
        readMoneyReport(TWO_MONTHS_OF_MONEY, 'USD'),
        readEventReport(events([{ 'Event Date': '2026-07-11', Event: 'Renew', Quantity: '5' }])),
        'a mismatched pair'
      ),
    (error: unknown) =>
      error instanceof OwnerError &&
      /the money runs 2026-07 to 2026-08 and the events run 2026-07 to 2026-07/.test((error as Error).message)
  );
});

test('inside the span both cover, a month missing from one of them is a real zero', () => {
  const lines = takingsFrom(
    readMoneyReport(
      money([
        { 'Event Date': '2026-07-02', 'Customer Price': '7.99', 'Developer Proceeds': '5.59' },
        { 'Event Date': '2026-09-02', 'Customer Price': '7.99', 'Developer Proceeds': '5.59' },
      ]),
      'USD'
    ),
    readEventReport(
      events([
        { 'Event Date': '2026-07-04', Event: 'Renew', Quantity: '2' },
        { 'Event Date': '2026-08-04', Event: 'Cancel', Quantity: '1' },
        { 'Event Date': '2026-09-04', Event: 'Renew', Quantity: '2' },
      ])
    ),
    'three months'
  );
  assert.deepEqual(
    lines.map((one) => [one.month, one.charged, one.cancelled]),
    [
      ['2026-07', 799n, 0],
      ['2026-08', 0n, 1],
      ['2026-09', 799n, 0],
    ]
  );
});

/* ================================================== reading one in twice */

test('months fold into the ones already read in, and come back in order', () => {
  const july = takingsFrom(
    readMoneyReport(
      money([{ 'Event Date': '2026-07-02', 'Customer Price': '7.99', 'Developer Proceeds': '5.59' }]),
      'USD'
    ),
    readEventReport(events([{ 'Event Date': '2026-07-04', Event: 'Renew', Quantity: '2' }])),
    'July'
  );
  const june = takingsFrom(
    readMoneyReport(
      money([{ 'Event Date': '2026-06-02', 'Customer Price': '7.99', 'Developer Proceeds': '5.59' }]),
      'USD'
    ),
    readEventReport(events([{ 'Event Date': '2026-06-04', Event: 'Renew', Quantity: '1' }])),
    'June'
  );
  assert.deepEqual(
    foldIn(july, june).map((one) => one.month),
    ['2026-06', '2026-07']
  );
});

test('the same month read in twice is refused, and names the file it came from first', () => {
  const july = takingsFrom(
    readMoneyReport(
      money([{ 'Event Date': '2026-07-02', 'Customer Price': '7.99', 'Developer Proceeds': '5.59' }]),
      'USD'
    ),
    readEventReport(events([{ 'Event Date': '2026-07-04', Event: 'Renew', Quantity: '2' }])),
    'S_M_July.txt'
  );
  assert.throws(
    () => foldIn(july, july),
    (error: unknown) =>
      error instanceof OwnerError &&
      /July 2026 has already been read in, from S_M_July\.txt/.test((error as Error).message)
  );
});
