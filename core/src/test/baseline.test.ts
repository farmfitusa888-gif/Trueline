import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_COMPANY } from '../company.ts';
import { type PriceBook, quote } from '../price.ts';
import { type Proposal, NOBODY, optionFrom, proposalOf } from '../proposal.ts';
import { CLIENT_INTENT, CONSENT, canonical, hashOf, sign } from '../signature.ts';
import { type FileBackRequest, fileSignedBack } from '../countersign.ts';
import {
  BaselineError,
  changesSinceVerified,
  describeWithdrawal,
  freeze,
  freezeOnReturnedCopy,
  reAgreement,
  withdraw,
  withdrawalOf,
} from '../baseline.ts';

/**
 * The second way a job gets agreed, and the fact it carries for ever after.
 *
 * Sam's decision, in his words: **"Let it freeze the job, with the weakness
 * written on the agreement."** A returned photograph freezes the baseline, the
 * baseline records that it was agreed on a returned copy rather than signed on
 * the phone, and every invoice and export carries that.
 *
 * The two things this file guards hardest are the two that would quietly undo
 * it: that a returned copy still cannot become a `Signature`, and that a
 * baseline taken from an on-phone signature is byte for byte the record it has
 * always been.
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

const MARK = 'data:image/png;base64,iVBORw0KGgo=';
const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

function proposal(over: { chosen?: string; address?: string } = {}): Proposal {
  const priced = quote(SHEET, BOOK);
  const built = proposalOf(
    'p1',
    'Gilbert kitchen',
    { ...EMPTY_COMPANY, name: 'Gilbert Remodeling' },
    { ...NOBODY, name: 'M. Alvarez', address: over.address ?? '14 Sycamore' },
    [optionFrom('a', 'As specified', 'The scope as measured.', priced)],
    AT,
    '2026-09-25'
  );
  return { ...built, chosen: over.chosen ?? 'a' };
}

function signing() {
  return {
    id: 'sig-1',
    who: 'M. Alvarez',
    role: 'client' as const,
    intent: CLIENT_INTENT,
    consented: true,
    mark: MARK,
    at: AT,
    device: 'iPhone',
  };
}

/** A signed copy filed back against the proposal exactly as it went out. */
async function returned(
  p = proposal(),
  over: Partial<FileBackRequest> = {}
) {
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
    copy: PHOTO,
    note: '',
    ...over,
  };
  return fileSignedBack(p, asked);
}

/* ================================================ the old path, untouched */

test('an on-phone signature freezes exactly the baseline it always did', async () => {
  const p = proposal();
  const base = await freeze(p, [await sign(p, signing())], FROZEN);

  // Byte for byte. The canonical text is what everything downstream hashes,
  // signs against and saves, so a new key appearing on this path -- even one
  // set to `undefined` or to a "signed here" marker -- would change the
  // fingerprint of every agreement in the product and every job file already
  // on somebody's phone would read back as a different record.
  assert.deepEqual(Object.keys(base).sort(), [
    'agreed', 'frozenAt', 'hash', 'proposalId', 'signatures',
  ]);
  assert.equal('agreedBy' in base, false);
  assert.equal(base.agreedBy, undefined);
  assert.equal(
    canonical(base),
    canonical({
      proposalId: base.proposalId,
      agreed: base.agreed,
      signatures: base.signatures,
      frozenAt: base.frozenAt,
      hash: base.hash,
    })
  );
  assert.equal(base.hash, await hashOf(p));
  assert.equal(base.signatures[0]?.intent, CLIENT_INTENT);
  assert.equal(CONSENT.length > 0, true);
});

test('freeze still refuses everything that is not a client signature', async () => {
  const p = proposal();
  await assert.rejects(() => freeze(p, [], FROZEN), BaselineError);

  // The returned copy itself, pushed at the door it must never open. It is
  // rejected because it is not a `Signature`, and this is the check that says
  // so from the outside rather than trusting the type system to have.
  const back = await returned(p);
  await assert.rejects(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => freeze(p, [back as unknown as any], FROZEN),
    BaselineError
  );
});

test('a returned copy has no field a signature has, so it can never pass as one', async () => {
  const back = await returned();
  for (const name of ['who', 'at', 'role', 'intent', 'consented', 'mark', 'documentHash']) {
    assert.equal(name in back, false, `a returned copy must not carry "${name}"`);
  }
  // And the baseline it freezes holds no signature either -- not a synthesised
  // one, not a placeholder, nothing. An empty list is the honest answer.
  const base = await freezeOnReturnedCopy(proposal(), back, FROZEN);
  assert.deepEqual(base.signatures, []);
});

/* =========================================== the new path: it is marked */

test('a baseline frozen on a returned copy says so on itself', async () => {
  const p = proposal();
  const base = await freezeOnReturnedCopy(p, await returned(p), FROZEN);

  assert.equal(base.agreedBy?.how, 'returned copy');
  assert.equal(base.agreedBy?.returnedId, 'back-1');
  assert.equal(base.agreedBy?.saysSignedBy, 'M. Alvarez');
  assert.equal(base.agreedBy?.saysSignedOn, '2026-08-25');
  assert.equal(base.agreedBy?.cameBackBy, 'photograph');
  assert.equal(base.agreedBy?.sentHash, await hashOf(p));

  // Self-describing: the sentence is ON the record, not fetched from anywhere.
  assert.equal(
    base.agreedBy?.says,
    'Agreed by a photograph of the signed page from M. Alvarez, not by a signature taken ' +
      'on the phone.'
  );
  assert.match(base.agreedBy?.weakness ?? '', /not by a signature taken on the phone/);
  assert.match(base.agreedBy?.weakness ?? '', /Nobody watched them sign/);
  assert.match(base.agreedBy?.weakness ?? '', /has not checked anybody’s identity/);
  assert.match(base.agreedBy?.weakness ?? '', /both fingerprinted/);

  // It still agrees a price, and it is the price on the option they took.
  assert.equal(base.agreed.total, 367500n + 35550n);
  assert.equal(base.proposalId, 'p1');
  assert.equal(base.hash, await hashOf(p));
});

test('the wording follows how the copy actually arrived', async () => {
  const p = proposal();
  const pdf = await returned(p, {
    cameBackBy: 'pdf',
    copy: 'data:application/pdf;base64,JVBERi0xLjQK',
  });
  const base = await freezeOnReturnedCopy(p, pdf, FROZEN);
  assert.match(base.agreedBy?.says ?? '', /Agreed by a signed PDF that came back from/);

  const paper = await returned(p, { id: 'back-2', cameBackBy: 'paper' });
  const onPaper = await freezeOnReturnedCopy(p, paper, FROZEN);
  assert.match(onPaper.agreedBy?.says ?? '', /Agreed by a signed sheet handed over on paper/);
});

/* ================================================ the new path: it binds */

test('a proposal that has moved since it went out cannot be frozen on the copy', async () => {
  const sent = proposal();
  const back = await returned(sent);
  // The same job, one field edited after the sheet went out. This is the
  // accidental fraud the whole path exists to refuse.
  const moved = proposal({ address: '14 Sycamore Lane' });
  await assert.rejects(
    () => freezeOnReturnedCopy(moved, back, FROZEN),
    (error: unknown) =>
      error instanceof BaselineError &&
      /not the proposal that was sent out/.test((error as Error).message) &&
      /two different documents/.test((error as Error).message)
  );
});

test('a copy signed against something else cannot freeze this job', async () => {
  const p = proposal();
  const other = await returned(p, { documentId: 'p9' });
  await assert.rejects(
    () => freezeOnReturnedCopy(p, other, FROZEN),
    (error: unknown) =>
      error instanceof BaselineError && /different proposal/.test((error as Error).message)
  );

  const co = await returned(p, { documentKind: 'change order' });
  await assert.rejects(
    () => freezeOnReturnedCopy(p, co, FROZEN),
    (error: unknown) =>
      error instanceof BaselineError && /cannot be the agreement/.test((error as Error).message)
  );
});

test('a proposal with no option taken agrees to no price', async () => {
  const p: Proposal = { ...proposal(), chosen: undefined };
  const back = await returned(p);
  await assert.rejects(() => freezeOnReturnedCopy(p, back, FROZEN), /No option has been taken/);
});

test('a time the app cannot keep is refused rather than written down', async () => {
  const p = proposal();
  const back = await returned(p);
  await assert.rejects(
    () => freezeOnReturnedCopy(p, back, 'Tuesday'),
    (error: unknown) =>
      error instanceof BaselineError && /not a time this can record/.test((error as Error).message)
  );
});

/* ============================ and it keeps binding after it is frozen */

test('editing the proposal after freezing on a copy raises the alarm', async () => {
  const sent = proposal();
  const base = await freezeOnReturnedCopy(sent, await returned(sent), FROZEN);
  const now = quote(SHEET, BOOK);

  const quiet = await changesSinceVerified(base, sent, now);
  assert.equal(quiet.tampered, false);
  assert.equal(quiet.tamperNote, '');

  // Before this, a baseline with no signature returned early and no drift was
  // ever reported -- so an edited proposal would have gone on being invoiced
  // against, silently, which is the failure the seal exists to prevent.
  const moved = proposal({ address: '14 Sycamore Lane' });
  const loud = await changesSinceVerified(base, moved, now);
  assert.equal(loud.tampered, true);
  assert.match(loud.tamperNote, /not the proposal M\. Alvarez signed and sent back on 2026-08-25/);
  assert.match(loud.tamperNote, /belongs in a change order/);
});

test('an on-phone baseline still raises the alarm the way it always did', async () => {
  const p = proposal();
  const base = await freeze(p, [await sign(p, signing())], FROZEN);
  const now = quote(SHEET, BOOK);
  assert.equal((await changesSinceVerified(base, p, now)).tampered, false);
  const loud = await changesSinceVerified(base, proposal({ address: '14 Sycamore Lane' }), now);
  assert.equal(loud.tampered, true);
  assert.match(loud.tamperNote, /This is not the document M\. Alvarez signed/);
});

/* ====================================================== withdrawing one */

/**
 * The way out of an agreement, and the thing it must never become.
 *
 * Sam, asked directly whether there should be a way out once a job is agreed:
 * **"Withdraw it, with a reason, kept on the record."** Not deleted, not
 * quietly rolled back — withdrawn, in writing, with the withdrawn agreement
 * still on the job for ever and the reason beside it.
 *
 * The tests below are in two halves. The first is that it works: a reason is
 * required, it is required to be a sentence, it cannot happen twice, and it
 * cannot be dated before the thing it withdraws. The second half is the one
 * that matters more — that withdrawing does not become a way to move a price
 * without anybody signing for it. A contractor who could withdraw, edit the
 * total up, and re-freeze would have walked around the whole change-order
 * defence, and the defence is the reason this product exists.
 */

const WITHDRAWN_AT = '2026-09-02T11:15:00.000Z';
const WHY = 'They pulled out before the tear-out started.';

/** The agreement as `freeze` writes it, with nothing else on the job. */
async function agreed(p = proposal()) {
  return freeze(p, [await sign(p, signing())], FROZEN);
}

test('withdrawing keeps the agreement whole and carries the reason beside it', async () => {
  const base = await agreed();
  const before = canonical(base);

  const gone = withdraw(base, WHY, WITHDRAWN_AT);

  // The baseline is the same object it was, byte for byte. This is the whole
  // design: the withdrawal is a second record, never an edit to the first.
  assert.equal(canonical(base), before);
  assert.deepEqual(Object.keys(base).sort(), [
    'agreed', 'frozenAt', 'hash', 'proposalId', 'signatures',
  ]);
  assert.equal('withdrawn' in base, false);
  assert.equal('withdrawal' in base, false);

  assert.equal(gone.reason, WHY);
  assert.equal(gone.at, WITHDRAWN_AT);
  assert.equal(gone.proposalId, 'p1');
  assert.equal(gone.baselineHash, base.hash);
  assert.equal(gone.frozenAt, FROZEN);
  // $4,030.50, in cents, off the agreement itself.
  assert.equal(gone.wasTotal, 367500n + 35550n);
  assert.equal(
    gone.says,
    'Agreed 2026-08-26 at $4,030.50, withdrawn 2026-09-02. Why: ' +
      'They pulled out before the tear-out started.'
  );
});

test('the record says it was withdrawn, why, and that nothing has been erased', async () => {
  const base = await agreed();
  const said = describeWithdrawal({ baseline: base, withdrawal: withdraw(base, WHY, WITHDRAWN_AT) });
  assert.equal(said[0], 'Withdrawn on 2026-09-02.');
  assert.equal(said[1], `Why: ${WHY}`);
  assert.equal(said[2], 'It was agreed on 2026-08-26 at $4,030.50, signed by M. Alvarez.');
  assert.match(said[3] ?? '', /Nothing has been erased/);
  // Never the other word. "Cancel" is the buyer's federal three-day right in
  // this app (`cooling.ts`) and belongs to the buyer, on a clock, with forms.
  // Two meanings of one word on one job is how the wrong one gets read out.
  for (const line of said) assert.equal(/cancel|delete/i.test(line), false, line);
});

test('a job agreed on a returned copy says so in its withdrawal too', async () => {
  const p = proposal();
  const base = await freezeOnReturnedCopy(p, await returned(p), FROZEN);
  const said = describeWithdrawal({ baseline: base, withdrawal: withdraw(base, WHY, WITHDRAWN_AT) });
  assert.equal(
    said[2],
    'It was agreed on 2026-08-26 at $4,030.50, by a photograph of the signed page from ' +
      'M. Alvarez.'
  );
});

test('a withdrawal with no reason on it is refused', async () => {
  const base = await agreed();
  for (const nothing of ['', '   ', '\n\t ']) {
    await assert.rejects(
      async () => withdraw(base, nothing, WITHDRAWN_AT),
      (error: unknown) =>
        error instanceof BaselineError &&
        /Say why this agreement is being withdrawn/.test((error as Error).message) &&
        /not deleting it/.test((error as Error).message)
    );
  }
});

test('and so is a reason too thin to mean anything in two years', async () => {
  const base = await agreed();
  // Each of these is what gets typed to make a box go away.
  for (const thin of ['no', 'n/a', 'mistake', 'wrong one', 'test', 'aaaaaaaaaaaaaaaaaaaaaa']) {
    await assert.rejects(
      async () => withdraw(base, thin, WITHDRAWN_AT),
      (error: unknown) =>
        error instanceof BaselineError && /is a label, not a reason/.test((error as Error).message),
      `"${thin}" should not have been accepted as a reason`
    );
  }
  // And the shortest real sentence is not refused.
  assert.equal(withdraw(base, 'Wrong photograph', WITHDRAWN_AT).reason, 'Wrong photograph');
});

test('an agreement cannot be withdrawn twice, and the refusal names the first reason', async () => {
  const base = await agreed();
  const first = withdraw(base, WHY, WITHDRAWN_AT);
  await assert.rejects(
    async () => withdraw(base, 'Changed my mind about it again.', '2026-09-05T09:00:00.000Z', [
      { baseline: base, withdrawal: first },
    ]),
    (error: unknown) =>
      error instanceof BaselineError &&
      /already withdrawn on 2026-09-02/.test((error as Error).message) &&
      /They pulled out before the tear-out started/.test((error as Error).message)
  );
});

test('a time the app cannot keep, or one before the agreement, is refused', async () => {
  const base = await agreed();
  await assert.rejects(
    async () => withdraw(base, WHY, 'Tuesday'),
    (error: unknown) =>
      error instanceof BaselineError && /not a time this can record/.test((error as Error).message)
  );
  await assert.rejects(
    async () => withdraw(base, WHY, '2026-08-20T09:00:00.000Z'),
    (error: unknown) =>
      error instanceof BaselineError &&
      /before it was agreed on 2026-08-26/.test((error as Error).message)
  );
});

/* ============================ the withdrawal binds to what it withdrew */

test('a withdrawal does not reach an agreement it did not withdraw', async () => {
  const base = await agreed();
  const record = { baseline: base, withdrawal: withdraw(base, WHY, WITHDRAWN_AT) };
  assert.equal(withdrawalOf(base, [record])?.withdrawal.reason, WHY);

  // The same proposal, agreed again a day later. Not one word of the document
  // changed, so it hashes to exactly what the withdrawn one hashed to -- and
  // without `frozenAt` on the withdrawal this fresh agreement would read back
  // as the withdrawn one and could never be invoiced.
  const again = await freeze(proposal(), [await sign(proposal(), signing())], '2026-09-03T08:00:00.000Z');
  assert.equal(again.hash, base.hash);
  assert.equal(withdrawalOf(again, [record]), null);
});

/* ============ what a withdrawn agreement means for changesSinceVerified */

test('nothing is measured against a withdrawn agreement, and it says why', async () => {
  const p = proposal();
  const base = await agreed(p);
  const now = quote(SHEET, BOOK);
  const record = { baseline: base, withdrawal: withdraw(base, WHY, WITHDRAWN_AT) };

  // Live, it answers exactly as it always did.
  assert.equal((await changesSinceVerified(base, p, now, [])).tampered, false);

  // Withdrawn, there is nothing on the other side of the subtraction. Answering
  // would price a change order against an agreement nobody is bound by, and
  // `raiseChange` would take it.
  await assert.rejects(
    () => changesSinceVerified(base, p, now, [record]),
    (error: unknown) =>
      error instanceof BaselineError &&
      /withdrawn on 2026-09-02/.test((error as Error).message) &&
      /no change order can be raised on it/.test((error as Error).message) &&
      /They pulled out before the tear-out started/.test((error as Error).message)
  );

  // And the alarm it would otherwise raise is silence rather than noise: the
  // point of withdrawing is that the proposal becomes editable again, so the
  // very next thing that happens is the edit that makes `verify` fail.
  await assert.rejects(
    () => changesSinceVerified(base, proposal({ address: '14 Sycamore Lane' }), now, [record]),
    BaselineError
  );
});

/* ================================= agreeing again, without laundering */

test('a withdrawn job agreed again is a whole new agreement, signed for in full', async () => {
  const first = await agreed();
  const record = { baseline: first, withdrawal: withdraw(first, WHY, WITHDRAWN_AT) };

  // The price goes up: every rate a dollar dearer. 420 sq ft at $9.75 is
  // $4,095.00; 79 lf at $5.50 is $434.50. $4,529.50 against $4,030.50 signed.
  const dearer: PriceBook = {
    rates: [
      { item: 'Floor', unit: 'sq ft', cents: 975n, source: TYPED },
      { item: 'Base', unit: 'lf', cents: 550n, source: TYPED },
    ],
  };
  const raised: Proposal = {
    ...proposalOf(
      'p1',
      'Gilbert kitchen',
      { ...EMPTY_COMPANY, name: 'Gilbert Remodeling' },
      { ...NOBODY, name: 'M. Alvarez', address: '14 Sycamore' },
      [optionFrom('a', 'As specified', 'The scope as measured.', quote(SHEET, dearer))],
      AT,
      '2026-09-25'
    ),
    chosen: 'a',
  };
  assert.equal(raised.options[0]?.total, 409500n + 43450n);

  // There is no door to a second agreement that is not a whole agreement.
  // Unsigned, it is refused exactly as the first one would have been.
  await assert.rejects(() => freeze(raised, [], '2026-09-03T08:00:00.000Z'), BaselineError);

  const second = await freeze(
    raised,
    [await sign(raised, { ...signing(), id: 'sig-2', at: '2026-09-03T08:00:00.000Z' })],
    '2026-09-03T08:00:00.000Z'
  );

  // The client signed for the WHOLE of the new total, sealed to the new
  // document -- not for a $499.00 difference nobody itemised.
  assert.equal(second.agreed.total, 452950n);
  assert.equal(second.signatures[0]?.documentHash, await hashOf(raised));
  assert.notEqual(second.hash, first.hash);

  const again = reAgreement(record, second);
  assert.equal(again.wasTotal, 403050n);
  assert.equal(again.nowTotal, 452950n);
  assert.equal(again.difference, 49900n);
  assert.equal(
    again.says,
    'Agreed at $4,030.50 on 2026-08-26, withdrawn on 2026-09-02, agreed again at $4,529.50 ' +
      'on 2026-09-03 — $499.00 more. The difference did not go through a change order: the ' +
      'whole of the new agreement was agreed on its own, and this is what was withdrawn to ' +
      'get there.'
  );

  // And the withdrawn one is still there, whole, with its reason.
  assert.equal(record.baseline.agreed.total, 403050n);
  assert.equal(record.withdrawal.reason, WHY);
});

test('an agreement frozen before the withdrawal did not replace it', async () => {
  const first = await agreed();
  const record = { baseline: first, withdrawal: withdraw(first, WHY, WITHDRAWN_AT) };
  assert.throws(
    () => reAgreement(record, first),
    (error: unknown) =>
      error instanceof BaselineError && /did not replace it/.test((error as Error).message)
  );
});
