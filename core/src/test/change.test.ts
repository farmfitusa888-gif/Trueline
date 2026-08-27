import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_COMPANY } from '../company.ts';
import { type PriceBook, quote } from '../price.ts';
import { NOBODY, optionFrom, proposalOf } from '../proposal.ts';
import { CLIENT_INTENT, CONTRACTOR_INTENT, sign } from '../signature.ts';
import { changesSince, freeze } from '../baseline.ts';
import {
  CHANGE_CLIENT_INTENT,
  CHANGE_CONTRACTOR_INTENT,
  ChangeError,
  agreeToChange,
  agreedDifference,
  describeChangeDocument,
  notYetAgreed,
  raiseChange,
  verifyChange,
} from '../change.ts';

const AT = '2026-08-25T15:00:00.000Z';
const LATER = '2026-08-26T09:00:00.000Z';
const TYPED = { kind: 'typed', by: 'sam', at: AT } as const;
const MARK = 'data:image/png;base64,iVBORw0KGgo=';

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

async function signedBaseline() {
  const proposal = {
    ...proposalOf(
      'p1',
      'Gilbert kitchen',
      { ...EMPTY_COMPANY, name: 'Gilbert Remodeling' },
      { ...NOBODY, name: 'M. Alvarez' },
      [optionFrom('a', 'As measured', 'The room as measured.', quote(SHEET, BOOK))],
      AT,
      '2026-09-25'
    ),
    chosen: 'a',
  };
  const signature = await sign(proposal, {
    id: 's1', who: 'M. Alvarez', role: 'client', intent: CLIENT_INTENT,
    consented: true, mark: MARK, at: AT, device: 'iPhone',
  });
  return { proposal, baseline: await freeze(proposal, [signature], AT) };
}

const RAISE = {
  id: 'c1',
  number: 'CO-1',
  jobName: 'Gilbert kitchen',
  company: { ...EMPTY_COMPANY, name: 'Gilbert Remodeling' },
  client: { ...NOBODY, name: 'M. Alvarez' },
  raisedAt: AT,
  because: 'The floor runs under the island, which nobody could see until it came out.',
  extraDays: 2,
};

const grown = () => quote([{ ...SHEET[0]!, quantity: '520.0' }, SHEET[1]!], BOOK);

async function raised() {
  const { baseline } = await signedBaseline();
  const order = changesSince(baseline, grown());
  return { baseline, order, document: raiseChange(baseline, order, RAISE) };
}

/* ------------------------------------------------------------- raising it */

test('a change order carries the agreement it amends, so it cannot travel to another job', async () => {
  const { baseline, document } = await raised();
  assert.equal(document.baselineHash, baseline.hash);
  assert.equal(document.proposalId, baseline.proposalId);
  assert.equal(document.difference, 87500n);
  assert.equal(document.wasTotal, baseline.agreed.total);
  assert.equal(document.nowTotal, baseline.agreed.total + 87500n);
});

test('a change order for no change is refused', async () => {
  const { baseline } = await signedBaseline();
  assert.throws(
    () => raiseChange(baseline, changesSince(baseline, quote(SHEET, BOOK)), RAISE),
    (error: unknown) => error instanceof ChangeError && /nothing to raise/.test((error as Error).message)
  );
});

test('a change order against a document that has been edited since signing is refused', async () => {
  const { baseline } = await signedBaseline();
  const order = { ...changesSince(baseline, grown()), tampered: true, tamperNote: 'It moved.' };
  assert.throws(() => raiseChange(baseline, order, RAISE), ChangeError);
});

test('a change order with no number, no reason, or a nonsense number of days is refused', async () => {
  const { baseline, order } = await raised();
  assert.throws(() => raiseChange(baseline, order, { ...RAISE, number: '  ' }), ChangeError);
  assert.throws(() => raiseChange(baseline, order, { ...RAISE, because: '' }), ChangeError);
  for (const extraDays of [-1, 1.5, Number.NaN]) {
    assert.throws(() => raiseChange(baseline, order, { ...RAISE, extraDays }), ChangeError);
  }
  assert.throws(() => raiseChange(baseline, order, { ...RAISE, raisedAt: 'tuesday' }), ChangeError);
  // Nought days is an answer, not a blank.
  assert.equal(raiseChange(baseline, order, { ...RAISE, extraDays: 0 }).extraDays, 0);
});

/* ------------------------------------------------------------ agreeing it */

test('a change order nobody signed is not agreed to', async () => {
  const { document } = await raised();
  await assert.rejects(
    agreeToChange(document, [], LATER),
    (error: unknown) => error instanceof ChangeError && /client has signed/.test((error as Error).message)
  );
  // The contractor signing his own change order is not the client agreeing to it.
  const his = await sign(document, {
    id: 'x1', who: 'Gilbert', role: 'contractor', intent: CHANGE_CONTRACTOR_INTENT,
    consented: true, mark: MARK, at: LATER, device: 'iPhone',
  });
  await assert.rejects(agreeToChange(document, [his], LATER), ChangeError);
});

test('a signature made against a different version of the change order is refused', async () => {
  const { document } = await raised();
  const signature = await sign(document, {
    id: 'x2', who: 'M. Alvarez', role: 'client', intent: CHANGE_CLIENT_INTENT,
    consented: true, mark: MARK, at: LATER, device: 'iPhone',
  });
  // The price is raised after she signed. This is the forgery this exists to catch.
  const doctored = { ...document, difference: document.difference * 2n };
  await assert.rejects(
    agreeToChange(doctored, [signature], LATER),
    (error: unknown) =>
      error instanceof ChangeError && /signed a different version/.test((error as Error).message)
  );
});

test('an agreed change order keeps the two times apart, because the gap is the argument', async () => {
  const { document } = await raised();
  const signature = await sign(document, {
    id: 'x3', who: 'M. Alvarez', role: 'client', intent: CHANGE_CLIENT_INTENT,
    consented: true, mark: MARK, at: LATER, device: 'iPhone',
  });
  const agreed = await agreeToChange(document, [signature], LATER);
  assert.equal(agreed.document.raisedAt, AT);
  assert.equal(agreed.agreedAt, LATER);
  assert.equal((await verifyChange(agreed)).ok, true);
  await assert.rejects(agreeToChange(document, [signature], 'soon'), ChangeError);
});

test('a change order that has been altered since it was agreed stops verifying', async () => {
  const { document } = await raised();
  const signature = await sign(document, {
    id: 'x4', who: 'M. Alvarez', role: 'client', intent: CHANGE_CLIENT_INTENT,
    consented: true, mark: MARK, at: LATER, device: 'iPhone',
  });
  const agreed = await agreeToChange(document, [signature], LATER);
  const after = { ...agreed, document: { ...agreed.document, because: 'Something else entirely.' } };
  const seal = await verifyChange(after);
  assert.equal(seal.ok, false);
  // And one with no client signature at all reports rather than throwing.
  assert.equal((await verifyChange({ ...agreed, signatures: [] })).ok, false);
});

/* --------------------------------------------------------------- billing it */

test('what is signed is added up, and what is not signed is named', async () => {
  const { baseline, order, document } = await raised();
  const signature = await sign(document, {
    id: 'x5', who: 'M. Alvarez', role: 'client', intent: CHANGE_CLIENT_INTENT,
    consented: true, mark: MARK, at: LATER, device: 'iPhone',
  });
  const agreed = await agreeToChange(document, [signature], LATER);

  assert.equal(agreedDifference(baseline, []), 0n);
  assert.equal(agreedDifference(baseline, [agreed]), 87500n);
  assert.equal(notYetAgreed(order, [agreed]).length, 0);

  // The base comes off as well, and nobody has signed for that yet.
  const shrunk = changesSince(baseline, quote([{ ...SHEET[0]!, quantity: '520.0' }], BOOK));
  const left = notYetAgreed(shrunk, [agreed]);
  assert.equal(left.length, 1);
  assert.equal(left[0]!.item, 'Base');
  assert.equal(left[0]!.difference, -35550n);
});

test('the change order reads as a decision rather than a diff', async () => {
  const { document } = await raised();
  const said = describeChangeDocument(document);
  assert.match(said[0]!, /^Change order CO-1 on Gilbert kitchen, raised 2026-08-25\.$/);
  assert.match(said[1]!, /^Why: The floor runs under the island/);
  assert.ok(said.some((line) => line.startsWith('• Floor was 420.0 sq ft, now 520.0')));
  assert.ok(said.some((line) => line.includes('$875.00 onto the job')));
  assert.equal(said.at(-1), 'This adds 2 days to the finish date.');
  assert.equal(CONTRACTOR_INTENT.length > 0, true);
});
