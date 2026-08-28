import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_COMPANY } from '../company.ts';
import { type PriceBook, quote } from '../price.ts';
import { NOBODY, optionFrom, proposalOf } from '../proposal.ts';
import { CLIENT_INTENT, sign } from '../signature.ts';
import { changesSince, freeze } from '../baseline.ts';
import {
  InvoiceError,
  amountFor,
  describeInvoice,
  invoiceOf,
  missingFromInvoice,
  invoiceOfVerified,
  outstandingAfter,
  whyNotBilled,
} from '../invoice.ts';
import {
  CHANGE_CLIENT_INTENT,
  ChangeError,
  agreeToChange,
  describeChangeDocument,
  raiseChange,
} from '../change.ts';
import { quickbooksCsv, quickbooksName, readQuickbooks } from '../quickbooks.ts';
import { ScheduleError, icsName, icsOf, inOrder, next, visitOf } from '../schedule.ts';

const AT = '2026-08-25T15:00:00.000Z';
const TYPED = { kind: 'typed', by: 'sam', at: AT } as const;

const BOOK: PriceBook = {
  rates: [
    { item: 'Floor', unit: 'sq ft', cents: 875n, source: TYPED },
    { item: 'Base', unit: 'lf', cents: 450n, source: TYPED },
  ],
};
const SHEET = [
  { what: 'Floor', quantity: '420.0', unit: 'sq ft' as const, provenance: 'measured' as const },
  { what: 'Base', quantity: '79.00', unit: 'lf' as const, provenance: 'measured' as const },
];
// 420 at 8.75 is 3675.00; 79 at 4.50 is 355.50.
const AGREED = 367500n + 35550n;

async function signedBaseline() {
  const p = {
    ...proposalOf(
      'p1',
      'Gilbert kitchen',
      { ...EMPTY_COMPANY, name: 'Gilbert Remodeling' },
      { ...NOBODY, name: 'M. Alvarez', address: '14 Sycamore' },
      [optionFrom('a', 'As measured', 'The room as measured.', quote(SHEET, BOOK))],
      AT,
      '2026-09-25'
    ),
    chosen: 'a',
  };
  const signature = await sign(p, {
    id: 's1',
    who: 'M. Alvarez',
    role: 'client',
    intent: CLIENT_INTENT,
    consented: true,
    mark: 'data:image/png;base64,iVBORw0KGgo=',
    at: AT,
    device: 'iPhone',
  });
  return { proposal: p, baseline: await freeze(p, [signature], AT) };
}

/* --------------------------------------------------------------- invoices */

test('an invoice bills what was signed, and never what the room measures now', async () => {
  const { baseline } = await signedBaseline();
  // The room has grown since. An invoice for that is an invoice for work
  // nobody agreed to.
  const grown = quote([{ ...SHEET[0]!, quantity: '520.0' }, SHEET[1]!], BOOK);
  const moved = changesSince(baseline, grown);

  const invoice = invoiceOf({
    id: 'i1',
    number: '2026-014',
    stage: 'deposit',
    company: { ...EMPTY_COMPANY, name: 'Gilbert Remodeling' },
    client: { ...NOBODY, name: 'M. Alvarez' },
    jobName: 'Gilbert kitchen',
    baseline,
    agreedChanges: [],
    moved,
    alreadyBilled: 0n,
    share: { depositPerCent: 30 },
    issuedAt: AT,
    dueAt: '2026-09-08',
    payTo: 'Cheque to the address above',
  });

  // The extra hundred square feet is worth $875 and is on none of it.
  assert.equal(invoice.lines.length, 1);
  assert.equal(invoice.lines[0]!.amount, AGREED);
  assert.match(invoice.lines[0]!.detail, /signed by M\. Alvarez/);
  assert.equal(invoice.agreed, AGREED);
  // And it is named, so he can go and get it signed.
  assert.equal(invoice.notBilled.length, 1);
  assert.match(whyNotBilled(invoice), /nobody has signed for/);
  assert.match(whyNotBilled(invoice), /\$875\.00/);
});

async function signedChange(extraDays = 0) {
  const { baseline } = await signedBaseline();
  const grown = quote([{ ...SHEET[0]!, quantity: '520.0' }, SHEET[1]!], BOOK);
  const document = raiseChange(baseline, changesSince(baseline, grown), {
    id: 'c1',
    number: 'CO-1',
    jobName: 'Gilbert kitchen',
    company: { ...EMPTY_COMPANY, name: 'Gilbert Remodeling' },
    client: { ...NOBODY, name: 'M. Alvarez' },
    raisedAt: AT,
    because: 'The floor runs under the island, which nobody could see until it came out.',
    extraDays,
  });
  const signature = await sign(document, {
    id: 'cs1',
    who: 'M. Alvarez',
    role: 'client',
    intent: CHANGE_CLIENT_INTENT,
    consented: true,
    mark: 'data:image/png;base64,iVBORw0KGgo=',
    at: AT,
    device: 'iPhone',
  });
  return { baseline, grown, agreed: await agreeToChange(document, [signature], AT) };
}

test('once the client signs the change order, and only then, it is on the bill', async () => {
  const { baseline, grown, agreed } = await signedChange(3);
  const invoice = await invoiceOfVerified({
    id: 'i2', number: '2026-015', stage: 'final',
    company: EMPTY_COMPANY, client: { ...NOBODY, name: 'M. Alvarez' }, jobName: 'Gilbert kitchen',
    baseline, agreedChanges: [agreed], moved: changesSince(baseline, grown),
    alreadyBilled: 0n, issuedAt: AT,
  });

  // 100 more square feet of floor at $8.75.
  assert.equal(invoice.agreed, AGREED + 87500n);
  assert.equal(invoice.amount, AGREED + 87500n);
  assert.equal(invoice.lines.length, 2);
  assert.match(invoice.lines[1]!.what, /^Change CO-1: Floor/);
  assert.match(invoice.lines[1]!.detail, /signed by M\. Alvarez/);
  // Nothing is left over unsigned, so there is nothing to explain.
  assert.equal(invoice.notBilled.length, 0);
  assert.equal(whyNotBilled(invoice), '');
  assert.deepEqual(
    describeChangeDocument(agreed.document).at(-1),
    'This adds 3 days to the finish date.'
  );
});

test('a change order signed against a different agreement cannot be billed on this one', async () => {
  const { agreed } = await signedChange();
  // A second job, signed a moment later, with its own fingerprint.
  const other = await signedBaseline();
  await assert.rejects(
    invoiceOfVerified({
      id: 'i3', number: '3', stage: 'final',
      company: EMPTY_COMPANY, client: NOBODY, jobName: 'k',
      baseline: { ...other.baseline, hash: 'a-different-agreement' },
      agreedChanges: [agreed], alreadyBilled: 0n, issuedAt: AT,
    }),
    (error: unknown) => error instanceof ChangeError && /different agreement/.test((error as Error).message)
  );
});

test('the same change order cannot be billed twice', async () => {
  const { baseline, agreed } = await signedChange();
  assert.throws(
    () =>
      invoiceOf({
        id: 'i4', number: '4', stage: 'final',
        company: EMPTY_COMPANY, client: NOBODY, jobName: 'k',
        baseline, agreedChanges: [agreed, agreed], alreadyBilled: 0n, issuedAt: AT,
      }),
    (error: unknown) => error instanceof ChangeError && /twice/.test((error as Error).message)
  );
});

test('a change order edited after it was signed is refused at the moment of billing', async () => {
  const { baseline, agreed } = await signedChange();
  const doctored = {
    ...agreed,
    document: { ...agreed.document, difference: agreed.document.difference * 10n },
  };
  await assert.rejects(
    invoiceOfVerified({
      id: 'i5', number: '5', stage: 'final',
      company: EMPTY_COMPANY, client: NOBODY, jobName: 'k',
      baseline, agreedChanges: [doctored], alreadyBilled: 0n, issuedAt: AT,
    }),
    (error: unknown) =>
      error instanceof InvoiceError && /no longer matches what was signed/.test((error as Error).message)
  );
});

test('an invoice saved before any of this existed still opens', async () => {
  // Every invoice on a phone today was written when `notBilled` did not exist,
  // and the Work screen calls this on every one of them as it draws the list.
  // The first version read `.length` off it and took the whole screen down.
  const { baseline } = await signedBaseline();
  const invoice = invoiceOf({
    id: 'i0', number: '2026-001', stage: 'final',
    company: EMPTY_COMPANY, client: NOBODY, jobName: 'k',
    baseline, agreedChanges: [], alreadyBilled: 0n, issuedAt: AT,
  });
  const old = { ...invoice, notBilled: undefined } as unknown as typeof invoice;
  assert.equal(whyNotBilled(old), '');
  assert.equal(describeInvoice(old), describeInvoice(invoice));
});

test('a deposit and the final add up to exactly the agreed figure', () => {
  // The rounding case that would otherwise leave a cent behind on the job.
  for (const agreed of [403050n, 100001n, 3n, 999999n]) {
    const deposit = amountFor('deposit', agreed, 0n, { depositPerCent: 33.33 });
    const final = amountFor('final', agreed, deposit);
    assert.equal(deposit + final, agreed, `${agreed}`);
  }
});

test('a progress payment is against work done, not against the whole balance', () => {
  // The defect: progress and final returned the same figure, so a progress
  // invoice halfway through a job asked for everything.
  const deposit = amountFor('deposit', AGREED, 0n, { depositPerCent: 30 });
  const half = amountFor('progress', AGREED, deposit, { completePerCent: 50 });
  // Half of $4,030.50 is $2,015.25, less the $1,209.15 deposit already asked for.
  assert.equal(deposit, 120915n);
  assert.equal(half, 201525n - deposit);
  assert.notEqual(half, amountFor('final', AGREED, deposit));
  // And the three of them still settle the job exactly.
  assert.equal(deposit + half + amountFor('final', AGREED, deposit + half), AGREED);
});

test('a progress payment that is not told how much of the job is done is refused', () => {
  assert.throws(
    () => amountFor('progress', AGREED, 0n),
    (error: unknown) => error instanceof InvoiceError && /how much of the job/.test((error as Error).message)
  );
  // A named figure is the other way to answer, and it cannot exceed the job.
  assert.equal(amountFor('progress', AGREED, 0n, { amount: 50000n }), 50000n);
  assert.throws(() => amountFor('progress', AGREED, 0n, { amount: AGREED + 1n }), InvoiceError);
  assert.throws(() => amountFor('progress', AGREED, 0n, { amount: 0n }), InvoiceError);
  // Asking against work already paid for asks for nothing.
  assert.throws(
    () => amountFor('progress', AGREED, AGREED / 2n, { completePerCent: 25 }),
    InvoiceError
  );
});

test('the same work cannot be invoiced twice', () => {
  assert.throws(
    () => amountFor('final', AGREED, AGREED),
    (error: unknown) => error instanceof InvoiceError && /already been invoiced/.test((error as Error).message)
  );
});

test('a deposit never exceeds what is left on the job', () => {
  const already = AGREED - 1000n;
  assert.equal(amountFor('deposit', AGREED, already, { depositPerCent: 50 }), 1000n);
});

test('a deposit outside nought and a hundred per cent is refused', () => {
  for (const depositPerCent of [0, 100, -5, 140]) {
    assert.throws(() => amountFor('deposit', AGREED, 0n, { depositPerCent }), InvoiceError);
  }
});

test('nothing can be invoiced against a document that no longer matches its signature', async () => {
  const { baseline } = await signedBaseline();
  const moved = { ...changesSince(baseline, quote(SHEET, BOOK)), tampered: true, tamperNote: 'It moved.' };
  assert.throws(
    () =>
      invoiceOf({
        id: 'i1', number: '1', stage: 'final',
        company: EMPTY_COMPANY, client: NOBODY, jobName: 'k',
        baseline, agreedChanges: [], moved, alreadyBilled: 0n, issuedAt: AT,
      }),
    (error: unknown) => error instanceof InvoiceError && /no longer matches/.test((error as Error).message)
  );
});

test('an invoice with no number is refused, because two of them could not be told apart', async () => {
  const { baseline } = await signedBaseline();
  assert.throws(
    () =>
      invoiceOf({
        id: 'i1', number: '  ', stage: 'final',
        company: EMPTY_COMPANY, client: NOBODY, jobName: 'k',
        baseline, agreedChanges: [],
        alreadyBilled: 0n, issuedAt: AT,
      }),
    InvoiceError
  );
});

test('what is left on the job is said, and what is missing is named without blocking', async () => {
  const { baseline } = await signedBaseline();
  const invoice = invoiceOf({
    id: 'i1', number: '2026-014', stage: 'deposit',
    company: EMPTY_COMPANY, client: NOBODY, jobName: 'k',
    baseline, agreedChanges: [],
    alreadyBilled: 0n, share: { depositPerCent: 25 }, issuedAt: AT,
  });
  assert.equal(invoice.amount + outstandingAfter(invoice), AGREED);
  assert.match(describeInvoice(invoice), /leaving \$/);

  const missing = missingFromInvoice(invoice);
  assert.ok(missing.includes('how to pay you'));
  assert.ok(missing.includes('when it is due'));
  // And it still exists.
  assert.equal(invoice.number, '2026-014');
});

/* ------------------------------------------------------------- quickbooks */

test('the QuickBooks file reads back as the invoice that was written', async () => {
  const { baseline } = await signedBaseline();
  const invoice = invoiceOf({
    id: 'i1', number: '2026-014', stage: 'final',
    company: { ...EMPTY_COMPANY, name: 'Gilbert Remodeling' },
    client: { ...NOBODY, name: 'Alvarez, M.' },   // a comma, which is the trap
    jobName: 'Gilbert kitchen',
    baseline, agreedChanges: [],
    alreadyBilled: 0n, issuedAt: AT, dueAt: '2026-09-08',
    note: 'Thanks — any questions, call.',
  });

  const rows = readQuickbooks(quickbooksCsv([invoice]));
  assert.equal(rows.length, invoice.lines.length);
  // The comma in the customer's name survived being written and read.
  assert.equal(rows[0]!.Customer, 'Alvarez, M.');
  assert.equal(rows[0]!.InvoiceNo, '2026-014');
  assert.equal(rows[0]!.InvoiceDate, '2026-08-25');
  assert.equal(rows[0]!.ItemAmount, '4030.50');
});

test('every line of an invoice carries the same number, which is how QuickBooks groups them', async () => {
  const { baseline, agreed } = await signedChange();
  const invoice = invoiceOf({
    id: 'i1', number: '2026-015', stage: 'final',
    company: EMPTY_COMPANY, client: { ...NOBODY, name: 'M. Alvarez' }, jobName: 'k',
    baseline, agreedChanges: [agreed], alreadyBilled: 0n, issuedAt: AT, dueAt: '2026-09-08',
  });
  const rows = readQuickbooks(quickbooksCsv([invoice]));
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.InvoiceNo === '2026-015'));
  assert.equal(quickbooksName('Gilbert kitchen'), 'Gilbert-kitchen-quickbooks.csv');
});

/* --------------------------------------------------------------- calendar */

const VISIT = () =>
  visitOf('v1', 'work', 'Kitchen — tear out', '14 Sycamore',
    '2026-09-01T13:00:00.000Z', '2026-09-01T21:00:00.000Z', 'Skip arrives at eight.');

test('a visit that ends before it starts is refused', () => {
  assert.throws(
    () => visitOf('v1', 'work', 'x', '', '2026-09-01T21:00:00Z', '2026-09-01T13:00:00Z'),
    ScheduleError
  );
  assert.throws(() => visitOf('v1', 'work', 'x', '', 'thursday', '2026-09-01T13:00:00Z'), ScheduleError);
  assert.throws(() => visitOf('v1', 'work', '   ', '', AT, '2026-09-01T13:00:00Z'), ScheduleError);
});

test('a calendar file says what every calendar expects', () => {
  const ics = icsOf([VISIT()], AT, 'Gilbert Remodeling');
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /\r\nEND:VCALENDAR\r\n$/);
  assert.match(ics, /VERSION:2\.0/);
  // Times in UTC with a trailing Z, so an appointment cannot land an hour out
  // after a clock change.
  assert.match(ics, /DTSTART:20260901T130000Z/);
  assert.match(ics, /DTEND:20260901T210000Z/);
  // A stable id, so re-sending updates the appointment rather than adding one.
  assert.match(ics, /UID:v1@trueline/);
  // CRLF everywhere, which strict readers require.
  assert.equal(ics.includes('\n'), true);
  assert.equal(/[^\r]\n/.test(ics), false, 'every newline must be preceded by a carriage return');
});

test('commas and semicolons in a room name do not break the file', () => {
  const ics = icsOf(
    [visitOf('v2', 'work', 'Kitchen, upstairs; second floor', 'A, B', AT, '2026-08-25T17:00:00Z')],
    AT
  );
  assert.match(ics, /SUMMARY:Kitchen\\, upstairs\\; second floor/);
  assert.match(ics, /LOCATION:A\\, B/);
});

test('a long line is folded to 75 octets, because Outlook is a strict reader', () => {
  const long = 'A note that goes on and on and on '.repeat(6);
  const ics = icsOf([visitOf('v3', 'work', 'x', '', AT, '2026-08-25T17:00:00Z', long)], AT);
  for (const line of ics.split('\r\n')) {
    assert.ok(
      new TextEncoder().encode(line).length <= 75,
      `${new TextEncoder().encode(line).length} octets: ${line.slice(0, 40)}…`
    );
  }
  // And a folded continuation starts with a single space.
  assert.match(ics, /\r\n /);
});

test('the same visits produce the same bytes twice', () => {
  // A file that differs every time it is written cannot be tested or diffed.
  assert.equal(icsOf([VISIT()], AT), icsOf([VISIT()], AT));
});

test('an empty calendar is refused rather than sent', () => {
  assert.throws(() => icsOf([], AT), ScheduleError);
});

test('visits come back in the order they happen, and the next one is the next one', () => {
  const later = visitOf('v2', 'measure', 'Measure the bath', '', '2026-09-05T13:00:00Z', '2026-09-05T14:00:00Z');
  const sorted = inOrder([later, VISIT()]);
  assert.equal(sorted[0]!.id, 'v1');
  assert.equal(next([later, VISIT()], '2026-09-01T22:00:00Z')?.id, 'v2');
  // Nothing ahead once everything is past.
  assert.equal(next([later, VISIT()], '2026-10-01T00:00:00Z'), undefined);
  assert.equal(icsName('Gilbert kitchen'), 'Gilbert-kitchen.ics');
});

/* ------------------------------------ the mark-up, from the change to the bill */

/**
 * Sam: **"Put the mark-up on the change too."**
 *
 * The column has to add up to the figure being asked for. Before this, the
 * change-order lines on an invoice were the work BEFORE mark-up while
 * `invoice.agreed` was the contract AFTER it, so the two disagreed by exactly
 * the mark-up on every change ever raised.
 */
test('an invoice with a change order on it adds up, mark-up and all', async () => {
  const book: PriceBook = { ...BOOK, markupBasisPoints: 1500 };
  const p = {
    ...proposalOf(
      'p9',
      'Gilbert kitchen',
      { ...EMPTY_COMPANY, name: 'Gilbert Remodeling' },
      { ...NOBODY, name: 'M. Alvarez', address: '14 Sycamore' },
      [optionFrom('a', 'As measured', 'The room as measured.', quote(SHEET, book))],
      AT,
      '2026-09-25'
    ),
    chosen: 'a',
  };
  const signature = await sign(p, {
    id: 's9', who: 'M. Alvarez', role: 'client', intent: CLIENT_INTENT,
    consented: true, mark: 'data:image/png;base64,iVBORw0KGgo=', at: AT, device: 'iPhone',
  });
  const baseline = await freeze(p, [signature], AT);

  const grown = quote([{ ...SHEET[0]!, quantity: '520.0' }, SHEET[1]!], book);
  const document = raiseChange(baseline, changesSince(baseline, grown), {
    id: 'c9', number: 'CO-9', jobName: 'Gilbert kitchen',
    company: EMPTY_COMPANY, client: { ...NOBODY, name: 'M. Alvarez' },
    raisedAt: AT, because: 'The floor runs under the island.', extraDays: 1,
  });
  const changeSignature = await sign(document, {
    id: 'x9', who: 'M. Alvarez', role: 'client', intent: CHANGE_CLIENT_INTENT,
    consented: true, mark: 'data:image/png;base64,iVBORw0KGgo=', at: AT, device: 'iPhone',
  });
  const agreed = await agreeToChange(document, [changeSignature], AT);

  const invoice = await invoiceOfVerified({
    id: 'i9', number: '2026-099', stage: 'final',
    company: EMPTY_COMPANY, client: { ...NOBODY, name: 'M. Alvarez' }, jobName: 'Gilbert kitchen',
    baseline, agreedChanges: [agreed], moved: changesSince(baseline, grown),
    alreadyBilled: 0n, issuedAt: AT,
  });

  // The agreement, the change, and the mark-up on the change: three lines.
  assert.equal(invoice.lines.length, 3);
  assert.equal(invoice.lines[2]!.what, 'Change CO-9: mark-up');
  assert.equal(invoice.lines[2]!.amount, 13125n);
  // What the client can check with a pencil.
  assert.equal(invoice.lines.reduce((sum, one) => sum + one.amount, 0n), invoice.agreed);
  assert.equal(invoice.agreed, grown.total);
  // And nothing is left unbilled, because the change order covered all of it.
  assert.equal(invoice.notBilled.length, 0);
});
