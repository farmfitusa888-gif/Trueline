import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_COMPANY } from '../company.ts';
import { type PriceBook, quote } from '../price.ts';
import { type Proposal, NOBODY, optionFrom, proposalOf } from '../proposal.ts';
import { CLIENT_INTENT, canonical, hashOf, sign } from '../signature.ts';
import { type FileBackRequest, fileSignedBack } from '../countersign.ts';
import { freeze, freezeOnReturnedCopy } from '../baseline.ts';
import { type InvoiceRequest, describeInvoice, invoiceOf } from '../invoice.ts';
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
