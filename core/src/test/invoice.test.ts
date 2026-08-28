import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_COMPANY } from '../company.ts';
import { type PriceBook, quote } from '../price.ts';
import { type Proposal, NOBODY, optionFrom, proposalOf } from '../proposal.ts';
import { CLIENT_INTENT, canonical, hashOf, sign } from '../signature.ts';
import { type FileBackRequest, fileSignedBack } from '../countersign.ts';
import { freeze, freezeOnReturnedCopy, withdraw } from '../baseline.ts';
import {
  type InvoiceRequest,
  InvoiceError,
  alreadyReversed,
  describeInvoice,
  invoiceOf,
  missingFromInvoice,
  netAsked,
  outstandingAfter,
  reversalOf,
  reversalsFor,
} from '../invoice.ts';
import { quickbooksCsv, readQuickbooks } from '../quickbooks.ts';

/**
 * What a bill says about how the job was agreed.
 *
 * The rule this file is here to hold: the weakness travels. A job frozen on a
 * photograph can be invoiced -- that is the whole point of the decision -- and
 * every invoice, every line of it and every export carries the fact that it was
 * a photograph, in the same words, so an adjuster, a homeowner, a bookkeeper
 * and a court all see what the app sees.
 *
 * The other half is that an invoice raised on a signature taken on the phone is
 * byte for byte the invoice it has always been. A change that quietly rewrote
 * every existing bill would be a worse defect than the one being fixed.
 */

const AT = '2026-08-25T15:00:00.000Z';
const FROZEN = '2026-08-26T09:40:00.000Z';
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

function proposal(): Proposal {
  return {
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
}

async function signedOnThePhone() {
  const p = proposal();
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
  return freeze(p, [signature], AT);
}

async function agreedOnAReturnedCopy(over: Partial<FileBackRequest> = {}) {
  const p = proposal();
  const asked: FileBackRequest = {
    id: 'back-1',
    jobName: 'Gilbert kitchen',
    documentId: 'p1',
    documentKind: 'proposal',
    sentHash: await hashOf(p),
    sentAt: '2026-08-24T16:00:00.000Z',
    saysSignedBy: 'M. Alvarez',
    saysSignedOn: '2026-08-25',
    cameBackAt: '2026-08-26T09:30:00.000Z',
    cameBackBy: 'photograph',
    copy: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
    note: '',
    ...over,
  };
  return freezeOnReturnedCopy(p, await fileSignedBack(p, asked), FROZEN);
}

function billFor(baseline: InvoiceRequest['baseline'], over: Partial<InvoiceRequest> = {}) {
  return invoiceOf({
    id: 'i1',
    number: '2026-014',
    stage: 'final',
    company: { ...EMPTY_COMPANY, name: 'Gilbert Remodeling' },
    client: { ...NOBODY, name: 'M. Alvarez' },
    jobName: 'Gilbert kitchen',
    baseline,
    agreedChanges: [],
    alreadyBilled: 0n,
    issuedAt: AT,
    dueAt: '2026-09-08',
    payTo: 'Cheque to the address above',
    ...over,
  });
}

/* ======================================= a job agreed on a returned copy bills */

test('a job agreed on a returned copy can be invoiced at all', async () => {
  const invoice = billFor(await agreedOnAReturnedCopy());
  // The defect this closes: a contractor holding a signed photograph could not
  // bill inside the app, so he billed outside it.
  assert.equal(invoice.amount, AGREED);
  assert.equal(invoice.agreed, AGREED);
});

test('and the bill says how it was agreed, on the line carrying the money', async () => {
  const invoice = billFor(await agreedOnAReturnedCopy());
  assert.equal(
    invoice.lines[0]!.detail,
    'Agreed 2026-08-26 by a photograph of the signed page from M. Alvarez. Not signed on ' +
      'the phone: nobody watched them sign and no identity was checked.'
  );
  assert.equal(invoice.lines[0]!.amount, AGREED);
});

test('the fact is on the invoice itself, not only on the baseline', async () => {
  const invoice = billFor(await agreedOnAReturnedCopy());
  // An invoice is the document that leaves the job. It has to answer "how do
  // you know this was agreed?" with nothing else in the room.
  assert.equal(invoice.agreedBy?.how, 'returned copy');
  assert.equal(invoice.agreedBy?.saysSignedBy, 'M. Alvarez');
  assert.match(invoice.agreedBy?.weakness ?? '', /not by a signature taken on the phone/);
});

test('describeInvoice carries it into every list the app shows', async () => {
  const invoice = describeInvoice(billFor(await agreedOnAReturnedCopy()));
  assert.match(invoice, /^Final payment 2026-014 — \$4,030\.50, which settles the job\./);
  assert.match(
    invoice,
    /Agreed by a photograph of the signed page from M\. Alvarez, not by a signature taken on the phone\.$/
  );
});

test('and into the export a bookkeeper opens', async () => {
  const rows = readQuickbooks(quickbooksCsv([billFor(await agreedOnAReturnedCopy())]));
  assert.equal(rows.length, 1);
  assert.match(rows[0]!.ItemDescription ?? '', /by a photograph of the signed page/);
  assert.match(rows[0]!.ItemDescription ?? '', /nobody watched them sign/);
});

test('a PDF that came back is described as a PDF, on the bill', async () => {
  const baseline = await agreedOnAReturnedCopy({
    cameBackBy: 'pdf',
    copy: 'data:application/pdf;base64,JVBERi0xLjQK',
  });
  assert.match(billFor(baseline).lines[0]!.detail, /by a signed PDF that came back from/);
});

/* ============================= and nothing about the old path has moved */

test('an invoice on a signature taken here is byte for byte what it was', async () => {
  const invoice = billFor(await signedOnThePhone());

  assert.equal('agreedBy' in invoice, false);
  assert.equal(invoice.agreedBy, undefined);
  assert.equal(invoice.lines[0]!.detail, 'Agreed 2026-08-25, signed by M. Alvarez.');
  assert.equal(
    describeInvoice(invoice),
    'Final payment 2026-014 — $4,030.50, which settles the job.'
  );

  // The canonical text is what the QuickBooks export, the saved job file and
  // anything hashing an invoice all read. Nothing new may appear in it.
  assert.equal(canonical(invoice).includes('agreedBy'), false);
});

test('the two paths bill exactly the same money', async () => {
  const onPhone = billFor(await signedOnThePhone());
  const onCopy = billFor(await agreedOnAReturnedCopy());
  assert.equal(onPhone.amount, onCopy.amount);
  assert.equal(onPhone.agreed, onCopy.agreed);
  // What differs is what is said about the evidence, and only that.
  assert.notEqual(onPhone.lines[0]!.detail, onCopy.lines[0]!.detail);
});

/* =========================================== withdrawing what was billed */

/**
 * The bills, when the agreement under them is withdrawn.
 *
 * Sam, asked what happens to invoices already raised against a job he is
 * withdrawing: **"Withdraw them too, as reversals."**
 *
 * So each one gets a matching reversal for exactly its own amount and the net
 * goes to zero — and **both stay on the record**. Nothing is deleted, nothing
 * is edited, and the QuickBooks export never tells a bookkeeper a bill vanished.
 * That is the same rule the double-entry ledger this product is built on
 * already holds: a reversal never erases the original.
 *
 * Every figure below is worked out here, in integer cents. The job agreed at
 * $4,030.50. A 30% deposit is $1,209.15 and the final is the $2,821.35 left.
 * The two reversals are exactly those two figures with the sign turned round,
 * and the four together are exactly zero.
 */

const WITHDRAWN_AT = '2026-09-02T11:15:00.000Z';
const WHY = 'They pulled out before the tear-out started.';

const DEPOSIT = 120915n;   // 30% of $4,030.50, rounded to the cent.
const FINAL = 282135n;     // what is left of it.

/** The agreement, its withdrawal, and the two bills raised before it. */
async function jobWithdrawnAfterTwoBills() {
  const baseline = await signedOnThePhone();
  const deposit = billFor(baseline, {
    id: 'i-dep',
    number: '2026-014',
    stage: 'deposit',
    share: { depositPerCent: 30 },
    alreadyBilled: 0n,
  });
  const final = billFor(baseline, {
    id: 'i-fin',
    number: '2026-015',
    stage: 'final',
    alreadyBilled: deposit.amount,
  });
  return { baseline, withdrawal: withdraw(baseline, WHY, WITHDRAWN_AT), bills: [deposit, final] };
}

test('the two bills add up to the agreed job, before anything is withdrawn', async () => {
  const { bills } = await jobWithdrawnAfterTwoBills();
  assert.equal(bills[0]!.amount, DEPOSIT);
  assert.equal(bills[1]!.amount, FINAL);
  assert.equal(DEPOSIT + FINAL, AGREED);
  assert.equal(netAsked(bills), AGREED);
});

test('every invoice gets a reversal for exactly its own amount, and the net is zero', async () => {
  const { withdrawal, bills } = await jobWithdrawnAfterTwoBills();
  const reversals = reversalsFor(bills, withdrawal);

  assert.equal(reversals.length, 2);
  assert.equal(reversals[0]!.amount, -DEPOSIT);
  assert.equal(reversals[1]!.amount, -FINAL);

  // The figure, not the fact that a function was called. $4,030.50 asked for,
  // $4,030.50 taken back, and nothing left owed on the job.
  const after = [...bills, ...reversals];
  assert.equal(netAsked(after), 0n);
  assert.equal(typeof netAsked(after), 'bigint');
  // And the money that was asked for is still legible on both sides of it.
  assert.equal(netAsked(bills), 403050n);
  assert.equal(netAsked(reversals), -403050n);
});

test('the bill it reverses is still there, whole, and says nothing new', async () => {
  const { withdrawal, bills } = await jobWithdrawnAfterTwoBills();
  const before = bills.map(canonical);
  reversalsFor(bills, withdrawal);
  assert.deepEqual(bills.map(canonical), before);
  assert.equal('reverses' in bills[0]!, false);
  assert.equal(canonical(bills[0]!).includes('reverses'), false);
});

test('a reversal says what it undid, why, and that the bill has not gone', async () => {
  const { withdrawal, bills } = await jobWithdrawnAfterTwoBills();
  const [reversal] = reversalsFor([bills[0]!], withdrawal);

  assert.equal(reversal!.id, 'i-dep-reversed');
  assert.equal(reversal!.number, '2026-014-R');
  assert.equal(reversal!.reverses?.of, 'i-dep');
  assert.equal(reversal!.reverses?.ofNumber, '2026-014');
  assert.equal(reversal!.reverses?.ofAmount, DEPOSIT);
  assert.equal(reversal!.reverses?.because, WHY);
  assert.equal(
    describeInvoice(reversal!),
    'Reverses deposit 2026-014 in full — $1,209.15 — because the agreement it was raised ' +
      'against was withdrawn on 2026-09-02. Why: They pulled out before the tear-out ' +
      'started. Invoice 2026-014 stays on this job exactly as it was sent. Nothing has been ' +
      'deleted.'
  );
  // It asks for nothing, so there is nothing to be due, nowhere to pay, and
  // nothing outstanding after it.
  assert.deepEqual(missingFromInvoice(reversal!), []);
  assert.equal(outstandingAfter(reversal!), 0n);
  // Never the other word: "cancel" is the buyer's federal three-day right in
  // this app, and the two must not collide on one job.
  assert.equal(/cancel|delete[^d]/i.test(describeInvoice(reversal!)), false);
});

test('a reversal cannot itself be reversed', async () => {
  const { withdrawal, bills } = await jobWithdrawnAfterTwoBills();
  const [reversal] = reversalsFor([bills[0]!], withdrawal);
  assert.throws(
    () => reversalOf(reversal!, withdrawal),
    (error: unknown) =>
      error instanceof InvoiceError &&
      /already the reversal of 2026-014/.test((error as Error).message)
  );
});

test('reversing a job twice does not bill it to minus the deposit', async () => {
  const { withdrawal, bills } = await jobWithdrawnAfterTwoBills();
  const once = [...bills, ...reversalsFor(bills, withdrawal)];
  const twice = [...once, ...reversalsFor(once, withdrawal)];
  assert.equal(reversalsFor(once, withdrawal).length, 0);
  // And the same list is what the screen asks before it offers to take money
  // against a bill: both of these have been taken back.
  assert.deepEqual([...alreadyReversed(once)].sort(), ['i-dep', 'i-fin']);
  assert.deepEqual([...alreadyReversed(bills)], []);
  assert.equal(twice.length, once.length);
  assert.equal(netAsked(twice), 0n);
});

test('nothing can be invoiced against a withdrawn agreement', async () => {
  const { baseline, withdrawal } = await jobWithdrawnAfterTwoBills();
  assert.throws(
    () => billFor(baseline, { withdrawn: [{ baseline, withdrawal }] }),
    (error: unknown) =>
      error instanceof InvoiceError &&
      /withdrawn on 2026-09-02/.test((error as Error).message) &&
      /They pulled out before the tear-out started/.test((error as Error).message) &&
      /has been reversed/.test((error as Error).message)
  );
  // And a live agreement on the same job still bills exactly as it did.
  assert.equal(billFor(baseline, { withdrawn: [] }).amount, AGREED);
});

/* ------------------------------------ the file a bookkeeper opens */

test('the export carries the bill AND its reversal, and nets to zero', async () => {
  const baseline = await signedOnThePhone();
  // A final invoice on its own: its lines add up to exactly what it asks for,
  // so the whole export can be added up and checked against zero.
  const final = billFor(baseline, { id: 'i-fin', number: '2026-015' });
  const withdrawal = withdraw(baseline, WHY, WITHDRAWN_AT);
  const rows = readQuickbooks(quickbooksCsv([final, ...reversalsFor([final], withdrawal)]));

  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.InvoiceNo, '2026-015');
  assert.equal(rows[0]!.ItemAmount, '4030.50');
  assert.equal(rows[1]!.InvoiceNo, '2026-015-R');
  assert.equal(rows[1]!.ItemAmount, '-4030.50');

  // Added up the way a bookkeeper would, in cents, on this side.
  const asCents = (text: string) => {
    const [whole, part = ''] = text.replace('-', '').split('.');
    const size = BigInt(whole!) * 100n + BigInt((part + '00').slice(0, 2));
    return text.startsWith('-') ? -size : size;
  };
  assert.equal(rows.reduce((sum, row) => sum + asCents(row.ItemAmount ?? '0'), 0n), 0n);

  // The two rows are separate invoices, not one netted to nothing. QuickBooks
  // groups by InvoiceNo, and sharing the number would import them as a single
  // zero invoice -- a bill that vanished by another route.
  assert.notEqual(rows[0]!.InvoiceNo, rows[1]!.InvoiceNo);
});

test('and the export never tells a bookkeeper the bill was deleted', async () => {
  const baseline = await signedOnThePhone();
  const final = billFor(baseline, { id: 'i-fin', number: '2026-015' });
  const withdrawal = withdraw(baseline, WHY, WITHDRAWN_AT);
  const csv = quickbooksCsv([final, ...reversalsFor([final], withdrawal)]);

  // The original's own line is still in the file, word for word.
  assert.match(csv, /Agreed 2026-08-25, signed by M\. Alvarez\./);
  // And the reversal says what happened, on its description AND on its memo,
  // so a bookkeeper who reads one column reads it.
  assert.match(csv, /Reverses final payment 2026-015 in full/);
  assert.match(csv, /Invoice 2026-015 stays on this job exactly as it was sent/);
  assert.match(csv, /They pulled out before the tear-out started/);
  assert.equal(/deleted[^.]/i.test(csv), false);
  assert.equal(/cancelled|voided|removed/i.test(csv), false);
});

test('an ordinary invoice is still byte for byte what it always was', async () => {
  const invoice = billFor(await signedOnThePhone());
  assert.equal('reverses' in invoice, false);
  assert.equal(invoice.reverses, undefined);
  assert.equal(canonical(invoice).includes('reverses'), false);
  assert.equal(canonical(invoice).includes('withdrawn'), false);
  assert.equal(
    describeInvoice(invoice),
    'Final payment 2026-014 — $4,030.50, which settles the job.'
  );
});
