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
  sinceLastAgreed,
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
  assert.equal(notYetAgreed(baseline, order, [agreed]).length, 0);

  // The base comes off as well, and nobody has signed for that yet.
  const shrunk = changesSince(baseline, quote([{ ...SHEET[0]!, quantity: '520.0' }], BOOK));
  const left = notYetAgreed(baseline, shrunk, [agreed]);
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

/* ------------------------------------------- moving twice on the same item */

/**
 * The failure these cover, measured before they were written.
 *
 * `notYetAgreed` keyed on item and unit alone, so the moment an item appeared
 * on ANY signed change order it could never be reported as having moved again.
 * With CO-1 signed for the floor at 520 sq ft, taking the floor to 600 left the
 * Price screen showing the bigger number while the Work screen said "Nothing
 * has moved on this job that somebody has not signed for" and the invoice kept
 * billing the smaller one. Silent under-billing, and no screen admitted it.
 *
 * Sam, asked what a twice-moved item should compare against: **"Compare
 * against what was last agreed, not what was ever agreed."**
 */

async function signedFirstChange() {
  const { baseline, document } = await raised();
  const signature = await sign(document, {
    id: 'twice-1', who: 'M. Alvarez', role: 'client', intent: CHANGE_CLIENT_INTENT,
    consented: true, mark: MARK, at: LATER, device: 'iPhone',
  });
  return { baseline, agreed: await agreeToChange(document, [signature], LATER) };
}

const grownAgain = () => quote([{ ...SHEET[0]!, quantity: '600.0' }, SHEET[1]!], BOOK);

test('an item that has already been signed for once can move again and is named when it does', async () => {
  const { baseline, agreed } = await signedFirstChange();
  const left = notYetAgreed(baseline, changesSince(baseline, grownAgain()), [agreed]);
  assert.equal(left.length, 1);
  assert.equal(left[0]!.item, 'Floor');
  assert.equal(left[0]!.unit, 'sq ft');
  // 80 sq ft at $8.75 -- what has moved since CO-1, not since the baseline.
  assert.equal(left[0]!.difference, 70000n);
  assert.equal(left[0]!.wasQuantity, '520.0');
  assert.equal(left[0]!.nowQuantity, '600.0');
  assert.match(left[0]!.says, /signed for/);
});

test('an item sitting exactly where the last change order left it is not named again', async () => {
  const { baseline, agreed } = await signedFirstChange();
  assert.equal(notYetAgreed(baseline, changesSince(baseline, grown()), [agreed]).length, 0);
});

test('the second change order is priced from what was last agreed, never from the baseline', async () => {
  const { baseline, agreed } = await signedFirstChange();
  const next = sinceLastAgreed(baseline, changesSince(baseline, grownAgain()), [agreed]);
  assert.equal(next.unchanged, false);
  assert.equal(next.difference, 70000n);
  // Agreed at the baseline plus CO-1, not at the baseline.
  assert.equal(next.wasTotal, baseline.agreed.total + 87500n);
  assert.equal(next.nowTotal, baseline.agreed.total + 87500n + 70000n);
  const second = raiseChange(baseline, next, { ...RAISE, id: 'c2', number: 'CO-2' });
  assert.equal(second.difference, 70000n);
  // And the two together add up to the whole move, once, rather than to the
  // baseline-to-now difference counted twice.
  assert.equal(agreed.document.difference + second.difference, 157500n);
});

test('with nothing new moved, there is no second change order to raise', async () => {
  const { baseline, agreed } = await signedFirstChange();
  const next = sinceLastAgreed(baseline, changesSince(baseline, grown()), [agreed]);
  assert.equal(next.unchanged, true);
  assert.throws(
    () => raiseChange(baseline, next, { ...RAISE, id: 'c2', number: 'CO-2' }),
    (error: unknown) =>
      error instanceof ChangeError && /nothing to raise/.test((error as Error).message)
  );
});

test('an item a change order took off, put back on, is named as coming back', async () => {
  const { baseline } = await signedBaseline();
  // CO-1 takes the base off entirely.
  const off = changesSince(baseline, quote([SHEET[0]!], BOOK));
  const document = raiseChange(baseline, off, { ...RAISE, id: 'c9', number: 'CO-9' });
  const signature = await sign(document, {
    id: 'twice-2', who: 'M. Alvarez', role: 'client', intent: CHANGE_CLIENT_INTENT,
    consented: true, mark: MARK, at: LATER, device: 'iPhone',
  });
  const agreed = await agreeToChange(document, [signature], LATER);

  const back = notYetAgreed(baseline, changesSince(baseline, quote(SHEET, BOOK)), [agreed]);
  assert.equal(back.length, 1);
  assert.equal(back[0]!.item, 'Base');
  assert.equal(back[0]!.kind, 'added');
  assert.equal(back[0]!.difference, 35550n);
  assert.match(back[0]!.says, /back on/);
});

test('a tampered agreement stays tampered through the restatement', async () => {
  const { baseline, agreed } = await signedFirstChange();
  const order = { ...changesSince(baseline, grownAgain()), tampered: true, tamperNote: 'It moved.' };
  const next = sinceLastAgreed(baseline, order, [agreed]);
  assert.equal(next.tampered, true);
  assert.equal(next.tamperNote, 'It moved.');
  assert.throws(() => raiseChange(baseline, next, { ...RAISE, id: 'c3', number: 'CO-3' }), ChangeError);
});

test('the latest signed change order is the one compared against, whatever order they arrive in', async () => {
  const { baseline, agreed } = await signedFirstChange();
  // A second signed change order, agreed AFTER the first but listed before it.
  const next = sinceLastAgreed(baseline, changesSince(baseline, grownAgain()), [agreed]);
  const document = raiseChange(baseline, next, { ...RAISE, id: 'c2', number: 'CO-2' });
  const signature = await sign(document, {
    id: 'twice-3', who: 'M. Alvarez', role: 'client', intent: CHANGE_CLIENT_INTENT,
    consented: true, mark: MARK, at: '2026-08-27T09:00:00.000Z', device: 'iPhone',
  });
  const second = await agreeToChange(document, [signature], '2026-08-27T09:00:00.000Z');

  // Both lists say the same thing: the floor is where CO-2 left it.
  for (const list of [[agreed, second], [second, agreed]]) {
    assert.equal(notYetAgreed(baseline, changesSince(baseline, grownAgain()), list).length, 0);
  }
});

/* --------------------------------------------------- the mark-up on a change */

/**
 * Sam, asked whether a change order carries the job's mark-up: **"Put the
 * mark-up on the change too."**
 *
 * Measured before this was written, on a book with 15% on it: taking the rates
 * from $5 to $6 made a fresh quote $1,588.82 dearer, and the change order said
 * $1,513.16 — the difference between the LINES, with no mark-up on it. Then
 * `changesSince` added that pre-mark-up figure to a post-mark-up
 * `baseline.agreed.total`, so the invoice billed the short number and the
 * contractor gave away his mark-up on every change he ever raised.
 */

const MARKED_UP: PriceBook = { ...BOOK, markupBasisPoints: 1500 };

async function markedUpBaseline() {
  const proposal = {
    ...proposalOf(
      'p2',
      'Gilbert kitchen',
      { ...EMPTY_COMPANY, name: 'Gilbert Remodeling' },
      { ...NOBODY, name: 'M. Alvarez' },
      [optionFrom('a', 'As measured', 'The room as measured.', quote(SHEET, MARKED_UP))],
      AT,
      '2026-09-25'
    ),
    chosen: 'a',
  };
  const signature = await sign(proposal, {
    id: 's2', who: 'M. Alvarez', role: 'client', intent: CLIENT_INTENT,
    consented: true, mark: MARK, at: AT, device: 'iPhone',
  });
  return freeze(proposal, [signature], AT);
}

test('a change order carries the job mark-up, so the total on it is the total a fresh quote gives', async () => {
  const baseline = await markedUpBaseline();
  const now = quote([{ ...SHEET[0]!, quantity: '520.0' }, SHEET[1]!], MARKED_UP);
  const order = changesSince(baseline, now);

  // The lines moved by 100 sq ft at $8.75, and 15% of that is the mark-up.
  const onLines = order.changes.reduce((sum, one) => sum + one.difference, 0n);
  assert.equal(onLines, 87500n);
  assert.equal(order.markup, 13125n);
  assert.equal(order.difference, 100625n);

  // The one that matters: the change order's total and a fresh quote agree.
  assert.equal(order.nowTotal, now.total);
  assert.equal(order.wasTotal, baseline.agreed.total);
  assert.equal(order.difference, now.total - baseline.agreed.total);
});

test('the mark-up travels onto the document, so what is signed is what is billed', async () => {
  const baseline = await markedUpBaseline();
  const now = quote([{ ...SHEET[0]!, quantity: '520.0' }, SHEET[1]!], MARKED_UP);
  const document = raiseChange(baseline, changesSince(baseline, now), RAISE);
  assert.equal(document.markup, 13125n);
  assert.equal(document.difference, 100625n);
  assert.equal(document.nowTotal, now.total);

  const signature = await sign(document, {
    id: 'mu1', who: 'M. Alvarez', role: 'client', intent: CHANGE_CLIENT_INTENT,
    consented: true, mark: MARK, at: LATER, device: 'iPhone',
  });
  const agreed = await agreeToChange(document, [signature], LATER);
  assert.equal(baseline.agreed.total + agreedDifference(baseline, [agreed]), now.total);

  // And it is said out loud rather than being a number nobody can account for.
  assert.ok(describeChangeDocument(document).some((line) => /mark-up/i.test(line)));
});

test('a book with no mark-up on it puts no mark-up on the change', async () => {
  const { baseline } = await signedBaseline();
  const order = changesSince(baseline, grown());
  assert.equal(order.markup, 0n);
  assert.equal(order.difference, 87500n);
});

test('a second change order carries the mark-up on what it alone moves, once', async () => {
  const baseline = await markedUpBaseline();
  const first = quote([{ ...SHEET[0]!, quantity: '520.0' }, SHEET[1]!], MARKED_UP);
  const document = raiseChange(baseline, changesSince(baseline, first), RAISE);
  const signature = await sign(document, {
    id: 'mu2', who: 'M. Alvarez', role: 'client', intent: CHANGE_CLIENT_INTENT,
    consented: true, mark: MARK, at: LATER, device: 'iPhone',
  });
  const agreed = await agreeToChange(document, [signature], LATER);

  const second = quote([{ ...SHEET[0]!, quantity: '600.0' }, SHEET[1]!], MARKED_UP);
  const next = sinceLastAgreed(baseline, changesSince(baseline, second), [agreed]);
  assert.equal(next.changes.reduce((sum, one) => sum + one.difference, 0n), 70000n);
  assert.equal(next.markup, 10500n);
  assert.equal(next.difference, 80500n);
  assert.equal(next.nowTotal, second.total);
  // Both change orders and the baseline are exactly a fresh quote. No mark-up
  // counted twice, and none given away.
  assert.equal(
    baseline.agreed.total + agreedDifference(baseline, [agreed]) + next.difference,
    second.total
  );
});
