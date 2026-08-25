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
  outstandingAfter,
} from '../invoice.ts';
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

test('an invoice is built from what was signed, not from what the room measures now', async () => {
  const { baseline } = await signedBaseline();
  // The room has grown since. An invoice for that is an invoice for work
  // nobody agreed to.
  const grown = quote([{ ...SHEET[0]!, quantity: '520.0' }, SHEET[1]!], BOOK);
  const changes = changesSince(baseline, grown);

  const invoice = invoiceOf({
    id: 'i1',
    number: '2026-014',
    stage: 'deposit',
    company: { ...EMPTY_COMPANY, name: 'Gilbert Remodeling' },
    client: { ...NOBODY, name: 'M. Alvarez' },
    jobName: 'Gilbert kitchen',
    baseline,
    changes,
    alreadyBilled: 0n,
    depositPerCent: 30,
    issuedAt: AT,
    dueAt: '2026-09-08',
    payTo: 'Cheque to the address above',
  });

  // Every line points at something signed, or at a change with a name.
  assert.equal(invoice.lines[0]!.amount, AGREED);
  assert.match(invoice.lines[0]!.detail, /signed by M\. Alvarez/);
  assert.equal(invoice.lines.length, 2);
  assert.match(invoice.lines[1]!.what, /^Change: Floor/);
});

test('a deposit and the final add up to exactly the agreed figure', () => {
  // The rounding case that would otherwise leave a cent behind on the job.
  for (const agreed of [403050n, 100001n, 3n, 999999n]) {
    const deposit = amountFor('deposit', agreed, 0n, 33.33);
    const final = amountFor('final', agreed, deposit);
    assert.equal(deposit + final, agreed, `${agreed}`);
  }
});

test('the same work cannot be invoiced twice', () => {
  assert.throws(
    () => amountFor('final', AGREED, AGREED),
    (error: unknown) => error instanceof InvoiceError && /already been invoiced/.test((error as Error).message)
  );
});

test('a deposit never exceeds what is left on the job', () => {
  const already = AGREED - 1000n;
  assert.equal(amountFor('deposit', AGREED, already, 50), 1000n);
});

test('a deposit outside nought and a hundred per cent is refused', () => {
  for (const share of [0, 100, -5, 140]) {
    assert.throws(() => amountFor('deposit', AGREED, 0n, share), InvoiceError);
  }
});

test('nothing can be invoiced against a document that no longer matches its signature', async () => {
  const { baseline } = await signedBaseline();
  const changes = { ...changesSince(baseline, quote(SHEET, BOOK)), tampered: true, tamperNote: 'It moved.' };
  assert.throws(
    () =>
      invoiceOf({
        id: 'i1', number: '1', stage: 'final',
        company: EMPTY_COMPANY, client: NOBODY, jobName: 'k',
        baseline, changes, alreadyBilled: 0n, issuedAt: AT,
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
        baseline, changes: changesSince(baseline, quote(SHEET, BOOK)),
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
    baseline, changes: changesSince(baseline, quote(SHEET, BOOK)),
    alreadyBilled: 0n, depositPerCent: 25, issuedAt: AT,
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
    baseline, changes: changesSince(baseline, quote(SHEET, BOOK)),
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
  const { baseline } = await signedBaseline();
  const changes = changesSince(baseline, quote([{ ...SHEET[0]!, quantity: '520.0' }, SHEET[1]!], BOOK));
  const invoice = invoiceOf({
    id: 'i1', number: '2026-015', stage: 'final',
    company: EMPTY_COMPANY, client: { ...NOBODY, name: 'M. Alvarez' }, jobName: 'k',
    baseline, changes, alreadyBilled: 0n, issuedAt: AT, dueAt: '2026-09-08',
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
