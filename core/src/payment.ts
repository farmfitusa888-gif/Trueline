import { type Invoice, type Stage } from './invoice.ts';
import { type Cents, money } from './price.ts';
import { RoomError } from './room.ts';

/**
 * Writing down that the money arrived.
 *
 * ## What this is not, and must never become
 *
 * This app **does not take payments**. It never has and this file does not
 * change that. Taking a card means PCI DSS, a processor agreement, chargeback
 * liability and money-transmission questions in fifty states — none of which a
 * remodeler needs in order to know who still owes him.
 *
 * So this records what the contractor says arrived, the way a paper ledger
 * does. He is the one who saw the cheque. The app's job is to remember it, add
 * it up, and tell him who is late.
 *
 * ## The one thing it refuses
 *
 * A reference is free text on purpose — a cheque number, a wire reference, "the
 * one his wife sent". Free text next to the word "payment" is exactly where a
 * card number gets typed, by a contractor being helpful, into a phone that then
 * carries it into a saved file and out through a text message.
 *
 * So `recordPayment` refuses a reference that looks like a card number: 13 to
 * 19 digits that pass the Luhn check. That is the same test every payment form
 * in the world uses to decide a number *is* a card, run here to decide it must
 * not be stored. It is deliberately narrow — a cheque number, an invoice
 * number, a phone number and a date all pass through untouched — and it costs
 * nothing to be wrong about, because the fix is to type the last four instead.
 */

export class PaymentError extends RoomError {}

export type HowPaid = 'cash' | 'cheque' | 'transfer' | 'card' | 'other';

export const HOW_PAID_TITLE: Readonly<Record<HowPaid, string>> = {
  cash: 'Cash',
  cheque: 'Cheque',
  transfer: 'Bank transfer',
  card: 'Card',
  other: 'Something else',
};

export interface Payment {
  readonly id: string;
  /** The invoice it settles, in part or in whole. */
  readonly invoiceId: string;
  /** Its number, kept beside the id so a list reads without a lookup. */
  readonly invoiceNumber: string;
  readonly amount: Cents;
  readonly receivedAt: string;
  readonly how: HowPaid;
  /** A cheque number, a wire reference, whatever he wrote down. Never a card. */
  readonly reference: string;
  readonly note: string;
}

/**
 * Whether a string of digits passes the Luhn check.
 *
 * Every card number does, and almost nothing else of that length does by
 * accident — the check is a mod-10 sum designed to catch a single mistyped
 * digit, so a random 16-digit number has about a one in ten chance. That is the
 * whole basis for using it here: a false positive costs somebody a retype, and
 * a false negative puts a live card number in a saved file.
 */
export function looksLikeCardNumber(text: string): boolean {
  const digits = text.replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = digits.charCodeAt(i) - 48;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

export interface PaymentRequest {
  readonly id: string;
  readonly amount: Cents;
  readonly receivedAt: string;
  readonly how: HowPaid;
  readonly reference?: string;
  readonly note?: string;
}

/** What has been received against one invoice. */
export function paidOn(invoice: Invoice, payments: readonly Payment[]): Cents {
  return payments
    .filter((payment) => payment.invoiceId === invoice.id)
    .reduce((sum, payment) => sum + payment.amount, 0n);
}

/** What is still owed on it. Never negative: an overpayment owes nothing. */
export function owedOn(invoice: Invoice, payments: readonly Payment[]): Cents {
  const left = invoice.amount - paidOn(invoice, payments);
  return left > 0n ? left : 0n;
}

/**
 * Records a payment against an invoice, or refuses and says why.
 *
 * Refuses more than the invoice asks for. An overpayment is a real thing that
 * happens, and it is a conversation rather than a line: the contractor either
 * owes it back or it belongs against a different invoice, and quietly absorbing
 * it makes both of those invisible.
 */
export function recordPayment(
  invoice: Invoice,
  payments: readonly Payment[],
  request: PaymentRequest
): Payment {
  if (request.amount <= 0n) {
    throw new PaymentError('A payment has to be for something.');
  }
  const owed = owedOn(invoice, payments);
  if (owed === 0n) {
    throw new PaymentError(
      `Invoice ${invoice.number} is already paid in full. If more has arrived, it belongs ` +
        'against another invoice or it goes back.'
    );
  }
  if (request.amount > owed) {
    throw new PaymentError(
      `${money(request.amount)} is more than the ${money(owed)} still owed on invoice ` +
        `${invoice.number}. Put the rest against another invoice, or give it back — an ` +
        'overpayment absorbed quietly is one nobody can find later.'
    );
  }
  if (Number.isNaN(Date.parse(request.receivedAt))) {
    throw new PaymentError(`"${request.receivedAt}" is not a date this can record.`);
  }
  const reference = (request.reference ?? '').trim();
  if (looksLikeCardNumber(reference)) {
    throw new PaymentError(
      'That looks like a card number, and this app will not store one. It takes no payments ' +
        'and holds no card details, which is the reason it needs no security certification ' +
        'and cannot leak yours. Put the last four digits, or the receipt number, instead.'
    );
  }
  return {
    id: request.id,
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    amount: request.amount,
    receivedAt: request.receivedAt,
    how: request.how,
    reference,
    note: (request.note ?? '').trim(),
  };
}

export interface Owing {
  readonly invoiceId: string;
  readonly number: string;
  readonly stage: Stage;
  readonly asked: Cents;
  readonly paid: Cents;
  readonly owed: Cents;
  /** Days past the due date. Negative before it, zero on the day. */
  readonly daysLate: number;
  /** True when the invoice named a due date at all. */
  readonly hasDueDate: boolean;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Who owes what, and how late, worst first.
 *
 * The screen a contractor actually opens. Settled invoices are left out — a
 * list of what is owed that includes what is not owed is a list nobody reads.
 */
export function owing(
  invoices: readonly Invoice[],
  payments: readonly Payment[],
  at: string
): Owing[] {
  const now = Date.parse(at);
  const rows: Owing[] = [];
  for (const invoice of invoices) {
    const owed = owedOn(invoice, payments);
    if (owed === 0n) continue;
    const due = Date.parse(invoice.dueAt);
    const hasDueDate = !Number.isNaN(due);
    rows.push({
      invoiceId: invoice.id,
      number: invoice.number,
      stage: invoice.stage,
      asked: invoice.amount,
      paid: paidOn(invoice, payments),
      owed,
      daysLate: hasDueDate && !Number.isNaN(now) ? Math.floor((now - due) / DAY) : 0,
      hasDueDate,
    });
  }
  // Latest first, then largest. What is most overdue is what he chases today.
  rows.sort((a, b) => b.daysLate - a.daysLate || (b.owed > a.owed ? 1 : b.owed < a.owed ? -1 : 0));
  return rows;
}

/** Everything still outstanding across a job. */
export function totalOwed(invoices: readonly Invoice[], payments: readonly Payment[]): Cents {
  return invoices.reduce((sum, invoice) => sum + owedOn(invoice, payments), 0n);
}

/** One line of the owed list, said out loud. */
export function describeOwing(row: Owing): string {
  const part =
    row.paid > 0n
      ? `${money(row.paid)} of ${money(row.asked)} in, ${money(row.owed)} still out.`
      : `${money(row.owed)} out, none of it in.`;
  if (!row.hasDueDate) return `${part} No due date was ever put on it.`;
  if (row.daysLate > 0) {
    return `${part} ${row.daysLate} day${row.daysLate === 1 ? '' : 's'} past due.`;
  }
  if (row.daysLate === 0) return `${part} Due today.`;
  return `${part} Due in ${-row.daysLate} day${row.daysLate === -1 ? '' : 's'}.`;
}

/** A payment, said out loud, for the list under an invoice. */
export function describePayment(payment: Payment): string {
  const how = HOW_PAID_TITLE[payment.how].toLowerCase();
  return (
    `${money(payment.amount)} by ${how} on ${payment.receivedAt.slice(0, 10)}` +
    (payment.reference ? ` — ${payment.reference}` : '') +
    '.'
  );
}
