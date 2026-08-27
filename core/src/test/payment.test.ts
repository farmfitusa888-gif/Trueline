import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_COMPANY } from '../company.ts';
import { NOBODY } from '../proposal.ts';
import { type Invoice } from '../invoice.ts';
import {
  PaymentError,
  describeOwing,
  describePayment,
  looksLikeCardNumber,
  owedOn,
  owing,
  paidOn,
  recordPayment,
  totalOwed,
} from '../payment.ts';

const AT = '2026-08-25T15:00:00.000Z';

const invoice = (over: Partial<Invoice> = {}): Invoice => ({
  id: 'i1',
  number: '2026-014',
  stage: 'deposit',
  company: EMPTY_COMPANY,
  client: NOBODY,
  jobName: 'Gilbert kitchen',
  lines: [],
  notBilled: [],
  amount: 120915n,
  agreed: 403050n,
  alreadyBilled: 0n,
  issuedAt: AT,
  dueAt: '2026-09-08',
  payTo: 'Cheque to the address above',
  note: '',
  ...over,
});

const REQUEST = {
  id: 'p1',
  amount: 50000n,
  receivedAt: '2026-08-30T12:00:00.000Z',
  how: 'cheque' as const,
  reference: '2291',
};

test('a payment is recorded against the invoice it settles', () => {
  const one = invoice();
  const payment = recordPayment(one, [], REQUEST);
  assert.equal(payment.invoiceId, 'i1');
  assert.equal(payment.invoiceNumber, '2026-014');
  assert.equal(paidOn(one, [payment]), 50000n);
  assert.equal(owedOn(one, [payment]), 70915n);
  assert.equal(describePayment(payment), '$500.00 by cheque on 2026-08-30 — 2291.');
});

test('a payment for more than is owed is refused rather than absorbed', () => {
  const one = invoice();
  const part = recordPayment(one, [], REQUEST);
  assert.throws(
    () => recordPayment(one, [part], { ...REQUEST, id: 'p2', amount: 70916n }),
    (error: unknown) => error instanceof PaymentError && /more than the/.test((error as Error).message)
  );
  // The exact remainder is fine, and settles it.
  const rest = recordPayment(one, [part], { ...REQUEST, id: 'p2', amount: 70915n });
  assert.equal(owedOn(one, [part, rest]), 0n);
  // And nothing more can be put against it.
  assert.throws(
    () => recordPayment(one, [part, rest], { ...REQUEST, id: 'p3', amount: 1n }),
    (error: unknown) => error instanceof PaymentError && /already paid in full/.test((error as Error).message)
  );
});

test('a payment for nothing, or on a date that is not one, is refused', () => {
  const one = invoice();
  assert.throws(() => recordPayment(one, [], { ...REQUEST, amount: 0n }), PaymentError);
  assert.throws(() => recordPayment(one, [], { ...REQUEST, amount: -1n }), PaymentError);
  assert.throws(() => recordPayment(one, [], { ...REQUEST, receivedAt: 'tuesday' }), PaymentError);
});

test('a card number cannot be stored in the reference, however it is spaced', () => {
  const one = invoice();
  // Test numbers every processor publishes for exactly this purpose. Not
  // anybody's card, and none of them will ever be charged.
  for (const card of [
    '4111111111111111',
    '4111 1111 1111 1111',
    '4111-1111-1111-1111',
    '5555555555554444',
    '378282246310005',
    '6011111111111117',
    '3530111333300000',
  ]) {
    assert.equal(looksLikeCardNumber(card), true, card);
    assert.throws(
      () => recordPayment(one, [], { ...REQUEST, reference: card }),
      (error: unknown) =>
        error instanceof PaymentError && /will not store one/.test((error as Error).message),
      card
    );
  }
});

test('and the things a contractor really types go straight through', () => {
  const one = invoice();
  for (const reference of [
    '2291',                 // a cheque number
    '2026-014',             // his own invoice number
    'Wire ref 88213004',    // a wire reference
    '5551234567',           // a phone number
    '20260830',             // a date
    'last four 4242',       // the fix the refusal suggests
    '4111111111111112',     // sixteen digits that fail the Luhn check
    '411111111111',         // twelve digits, too short to be a card
  ]) {
    assert.equal(looksLikeCardNumber(reference), false, reference);
    assert.equal(recordPayment(one, [], { ...REQUEST, reference }).reference, reference);
  }
});

test('who is late comes back worst first, and what is settled is left out', () => {
  const deposit = invoice({ id: 'i1', number: '2026-014', dueAt: '2026-08-20', amount: 100000n });
  const middle = invoice({ id: 'i2', number: '2026-015', dueAt: '2026-09-08', amount: 50000n, stage: 'progress' });
  const done = invoice({ id: 'i3', number: '2026-016', dueAt: '2026-08-01', amount: 25000n, stage: 'final' });
  const paid = [
    recordPayment(done, [], { ...REQUEST, id: 'p1', amount: 25000n }),
    recordPayment(deposit, [], { ...REQUEST, id: 'p2', amount: 40000n }),
  ];

  const rows = owing([deposit, middle, done], paid, '2026-09-01T00:00:00.000Z');
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.number, '2026-014');
  assert.equal(rows[0]!.daysLate, 12);
  assert.equal(rows[0]!.owed, 60000n);
  assert.equal(rows[1]!.number, '2026-015');
  assert.equal(rows[1]!.daysLate, -7);
  assert.equal(totalOwed([deposit, middle, done], paid), 110000n);

  assert.equal(describeOwing(rows[0]!), '$400.00 of $1,000.00 in, $600.00 still out. 12 days past due.');
  assert.equal(describeOwing(rows[1]!), '$500.00 out, none of it in. Due in 7 days.');
  assert.match(describeOwing({ ...rows[1]!, daysLate: 0 }), /Due today\.$/);
  assert.match(
    describeOwing({ ...rows[1]!, hasDueDate: false }),
    /No due date was ever put on it\.$/
  );
});
