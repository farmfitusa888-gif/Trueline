import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_COMPANY } from '../company.ts';
import { type PriceBook, quote } from '../price.ts';
import {
  NOBODY,
  ProposalError,
  chosenOption,
  missingFromProposal,
  optionFrom,
  proposalOf,
} from '../proposal.ts';
import {
  CLIENT_INTENT,
  CONSENT,
  SignatureError,
  canonical,
  describeSignature,
  sign,
  verify,
} from '../signature.ts';
import { BaselineError, changesSince, changesSinceVerified, describeChanges, freeze } from '../baseline.ts';

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

function proposal(lines = SHEET) {
  const priced = quote(lines, BOOK);
  return proposalOf(
    'p1',
    'Gilbert kitchen',
    { ...EMPTY_COMPANY, name: 'Gilbert Remodeling' },
    { ...NOBODY, name: 'M. Alvarez', address: '14 Sycamore' },
    [optionFrom('a', 'As specified', 'The scope as measured.', priced)],
    AT,
    '2026-09-25'
  );
}

/* ------------------------------------------------------------- the proposal */

test('a proposal is built from the quote, not typed alongside it', () => {
  const p = proposal();
  const option = p.options[0]!;
  // 420 at 8.75 is 3675.00; 79 at 4.50 is 355.50.
  assert.equal(option.total, 367500n + 35550n);
  assert.equal(option.lines.length, 2);
  assert.ok(option.measured);
});

test('a proposal will not carry a line nobody has a rate for', () => {
  const withExtra = [
    ...SHEET,
    { what: 'Tile', quantity: '60.0', unit: 'sq ft' as const, provenance: 'measured' as const },
  ];
  assert.throws(
    () => optionFrom('a', 'As specified', '', quote(withExtra, BOOK)),
    (error: unknown) => error instanceof ProposalError && /Tile/.test((error as Error).message)
  );
});

test('two options may not share an id, or a signature points at both', () => {
  const priced = quote(SHEET, BOOK);
  assert.throws(
    () =>
      proposalOf('p1', 'k', EMPTY_COMPANY, NOBODY, [
        optionFrom('a', 'One', '', priced),
        optionFrom('a', 'Two', '', priced),
      ], AT),
    ProposalError
  );
});

test('what is missing is named and nothing is blocked by it', () => {
  const bare = proposalOf('p1', 'k', EMPTY_COMPANY, NOBODY, [
    optionFrom('a', 'One', '', quote(SHEET, BOOK)),
  ], AT);
  const missing = missingFromProposal(bare);
  assert.ok(missing.includes('your business name'));
  assert.ok(missing.includes('who it is for'));
  // And it still exists, which is the point: a contractor in a kitchen who
  // cannot send a proposal writes it somewhere else.
  assert.equal(bare.options.length, 1);
});

/* ------------------------------------------------------------ the signature */

const MARK = 'data:image/png;base64,iVBORw0KGgo=';

function request(over: Record<string, unknown> = {}) {
  return {
    id: 's1',
    who: 'M. Alvarez',
    role: 'client' as const,
    intent: CLIENT_INTENT,
    consented: true,
    mark: MARK,
    at: AT,
    device: 'iPhone',
    ...over,
  };
}

test('a signature records intent, consent, attribution and the document it sealed', async () => {
  const p = { ...proposal(), chosen: 'a' };
  const s = await sign(p, request());
  assert.equal(s.who, 'M. Alvarez');
  assert.equal(s.intent, CLIENT_INTENT);
  assert.ok(s.consented);
  assert.equal(s.documentHash.length, 64, 'a SHA-256 is 64 hex characters');
  // The evidence has to be producible in words, not only as hex.
  const said = describeSignature(s);
  assert.ok(said.some((line) => line.includes('M. Alvarez')));
  assert.ok(said.some((line) => line.includes(CONSENT)));
});

test('signing is refused when a piece of the evidence is absent', async () => {
  const p = proposal();
  for (const [why, over] of [
    ['no name attributes to nobody', { who: '  ' }],
    ['no consent is a paper signature collected electronically', { consented: false }],
    ['no mark is not a signature', { mark: 'not-an-image' }],
    ['no recorded intent cannot be shown to be agreement', { intent: '' }],
    ['an unparseable time is not a time', { at: 'thursday' }],
  ] as const) {
    await assert.rejects(() => sign(p, request(over)), SignatureError, why);
  }
});

test('the seal catches the document being changed after it was signed', async () => {
  const p = { ...proposal(), chosen: 'a' };
  const s = await sign(p, request());
  assert.equal((await verify(p, s)).ok, true);

  // A price moves after signing. This is exactly the case the hash is for.
  const dearer = {
    ...p,
    options: [{ ...p.options[0]!, total: p.options[0]!.total + 100000n }],
  };
  const seal = await verify(dearer, s);
  assert.equal(seal.ok, false);
  assert.ok(!seal.ok && /has changed since/.test(seal.why));
});

test('the same document hashes the same whichever order it was built in', () => {
  // Key order is an accident of construction; a tamper alarm that fires on it
  // is an alarm nobody keeps switched on.
  const one = canonical({ a: 1, b: { c: 2, d: [3, 4] } });
  const two = canonical({ b: { d: [3, 4], c: 2 }, a: 1 });
  assert.equal(one, two);
  // And a bigint is written rather than thrown on.
  assert.equal(canonical({ cents: 12345n }), '{"cents":12345}');
});

/* ------------------------------------------------------------- the baseline */

test('nothing freezes until the client has signed it', async () => {
  const p = { ...proposal(), chosen: 'a' };
  await assert.rejects(() => freeze(p, [], AT), BaselineError);
  const contractorOnly = await sign(p, request({ role: 'contractor' }));
  await assert.rejects(() => freeze(p, [contractorOnly], AT), BaselineError);
});

test('a proposal with no option taken cannot be agreed to', async () => {
  const p = proposal();
  const s = await sign(p, request());
  await assert.rejects(() => freeze(p, [s], AT), ProposalError);
});

test('nothing has changed the moment it is signed', async () => {
  const p = { ...proposal(), chosen: 'a' };
  const s = await sign(p, request());
  const base = await freeze(p, [s], AT);
  const order = changesSince(base, quote(SHEET, BOOK));
  assert.ok(order.unchanged);
  assert.equal(order.difference, 0n);
  assert.equal(describeChanges(order), 'Nothing has changed since this was signed.');
});

test('more of something already agreed is priced as a change, not a new scope', async () => {
  const p = { ...proposal(), chosen: 'a' };
  const base = await freeze(p, [await sign(p, request())], AT);

  const bigger = [
    { ...SHEET[0]!, quantity: '470.0' },
    SHEET[1]!,
  ];
  const order = changesSince(base, quote(bigger, BOOK));
  assert.equal(order.changes.length, 1);
  const change = order.changes[0]!;
  assert.equal(change.kind, 'more');
  assert.equal(change.wasQuantity, '420.0');
  assert.equal(change.nowQuantity, '470.0');
  // Fifty square feet at 8.75.
  assert.equal(change.difference, 43750n);
  assert.equal(order.nowTotal, base.agreed.total + 43750n);
});

test('work nobody agreed to is called out as not being in the signed scope', async () => {
  const p = { ...proposal(), chosen: 'a' };
  const base = await freeze(p, [await sign(p, request())], AT);

  const book: PriceBook = { rates: [...BOOK.rates, { item: 'Tile', unit: 'sq ft', cents: 1200n, source: TYPED }] };
  const extra = [...SHEET, { what: 'Tile', quantity: '30.0', unit: 'sq ft' as const, provenance: 'measured' as const }];
  const order = changesSince(base, quote(extra, book));

  assert.equal(order.changes.length, 1);
  assert.equal(order.changes[0]!.kind, 'added');
  assert.ok(/not in the signed scope/.test(order.changes[0]!.says));
  assert.equal(order.difference, 36000n);
});

test('work taken off comes back as a credit, not as a deletion', async () => {
  const p = { ...proposal(), chosen: 'a' };
  const base = await freeze(p, [await sign(p, request())], AT);
  const order = changesSince(base, quote([SHEET[0]!], BOOK));

  assert.equal(order.changes.length, 1);
  assert.equal(order.changes[0]!.kind, 'removed');
  assert.equal(order.changes[0]!.difference, -35550n);
  assert.ok(order.nowTotal < order.wasTotal);
});

test('changes are ordered by what they cost, because that is the decision', async () => {
  const p = { ...proposal(), chosen: 'a' };
  const base = await freeze(p, [await sign(p, request())], AT);
  const moved = [
    { ...SHEET[0]!, quantity: '520.0' },   // +100 sq ft = $875.00
    { ...SHEET[1]!, quantity: '81.00' },   // +2 lf     =   $9.00
  ];
  const order = changesSince(base, quote(moved, BOOK));
  assert.equal(order.changes.length, 2);
  assert.equal(order.changes[0]!.item, 'Floor', 'the biggest number comes first');
});

test('editing the agreed document instead of raising a change is caught and named', async () => {
  const p = { ...proposal(), chosen: 'a' };
  const base = await freeze(p, [await sign(p, request())], AT);

  // Somebody goes back and edits the signed proposal rather than raising a
  // change order against it. The baseline still holds the original.
  const edited = { ...p, client: { ...p.client, name: 'Somebody Else' } };
  const order = await changesSinceVerified(base, edited, quote(SHEET, BOOK));

  assert.ok(order.tampered);
  assert.ok(/has changed since/.test(order.tamperNote));
  // And the agreed scope is untouched by the edit, which is the whole rule.
  assert.equal(base.agreed.total, 367500n + 35550n);
});

test('a baseline that still matches reports no tampering', async () => {
  const p = { ...proposal(), chosen: 'a' };
  const base = await freeze(p, [await sign(p, request())], AT);
  const order = await changesSinceVerified(base, p, quote(SHEET, BOOK));
  assert.equal(order.tampered, false);
  assert.equal(order.tamperNote, '');
});
