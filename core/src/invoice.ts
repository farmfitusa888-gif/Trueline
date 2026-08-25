import { type Baseline, type ChangeOrder } from './baseline.ts';
import { type Company } from './company.ts';
import { type Cents, money } from './price.ts';
import { type Party } from './proposal.ts';
import { RoomError } from './room.ts';

/**
 * Asking to be paid.
 *
 * ## Why this needs no service
 *
 * An invoice is a document and a number, not a subscription. What the invoicing
 * products sell is a document generator, a record of what has been asked for,
 * and a way to take a card. The first is `pdf-lib`, which is already in this
 * app. The second is this file. The third is a link the contractor pastes in
 * from whoever he already banks with -- and if he takes cheques, he pastes
 * nothing and the invoice says how to pay him instead.
 *
 * Nothing here touches money. It produces a document that asks for it.
 *
 * ## What it is built from
 *
 * The signed baseline and the change orders agreed since. Never the current
 * quote: an invoice for what the room measures *today* is an invoice for work
 * nobody agreed to, and the first time that happens it is not a bug, it is a
 * dispute. Everything on it can be pointed at something somebody signed.
 */

export class InvoiceError extends RoomError {}

export type Stage =
  /** Taken before the work starts. */
  | 'deposit'
  /** Somewhere in the middle, against work done. */
  | 'progress'
  /** The rest. */
  | 'final';

export const STAGE_TITLE: Readonly<Record<Stage, string>> = {
  deposit: 'Deposit',
  progress: 'Progress payment',
  final: 'Final payment',
};

export interface InvoiceLine {
  readonly what: string;
  readonly detail: string;
  readonly amount: Cents;
}

export interface Invoice {
  readonly id: string;
  /** What the contractor's own numbering calls it. His, not this app's. */
  readonly number: string;
  readonly stage: Stage;
  readonly company: Company;
  readonly client: Party;
  readonly jobName: string;
  readonly lines: readonly InvoiceLine[];
  /** What this one asks for. */
  readonly amount: Cents;
  /** The whole job, agreed, so the client can see where this sits. */
  readonly agreed: Cents;
  /** Everything asked for before this one, on this job. */
  readonly alreadyBilled: Cents;
  readonly issuedAt: string;
  /** When it is due, as a date. Empty when the contractor sets no terms. */
  readonly dueAt: string;
  /**
   * Where to pay, in the contractor's own words.
   *
   * A link he pastes in from his own bank or card processor, or a bank
   * transfer, or "cheque to the address above". Free text on purpose: this app
   * takes no payment, holds no card, and has no opinion about who he banks
   * with. An app that steered him at one processor would be an app taking a cut
   * without saying so.
   */
  readonly payTo: string;
  readonly note: string;
}

/**
 * The amount a stage asks for.
 *
 * A deposit is a share of what was agreed. Progress and final are whatever is
 * left after what has already been asked for -- which is the only definition
 * that cannot double-bill, and double-billing is the failure that costs a
 * contractor a customer rather than a morning.
 */
export function amountFor(
  stage: Stage,
  agreed: Cents,
  alreadyBilled: Cents,
  depositPerCent = 0
): Cents {
  const outstanding = agreed - alreadyBilled;
  if (outstanding <= 0n) {
    throw new InvoiceError(
      `${money(alreadyBilled)} has already been invoiced against an agreed ` +
        `${money(agreed)}. There is nothing left to ask for, and asking twice for ` +
        'the same work is how a job ends badly.'
    );
  }
  if (stage !== 'deposit') return outstanding;

  if (depositPerCent <= 0 || depositPerCent >= 100) {
    throw new InvoiceError('A deposit has to be somewhere between 0 and 100 per cent of the job.');
  }
  // Rounded half away from zero, in cents, so the deposit and the final add up
  // to exactly the agreed figure with nothing left over.
  const share = (agreed * BigInt(Math.round(depositPerCent * 100)) + 5000n) / 10000n;
  return share > outstanding ? outstanding : share;
}

export interface InvoiceRequest {
  readonly id: string;
  readonly number: string;
  readonly stage: Stage;
  readonly company: Company;
  readonly client: Party;
  readonly jobName: string;
  readonly baseline: Baseline;
  /** Changes agreed since signing. An empty order is fine and common. */
  readonly changes: ChangeOrder;
  readonly alreadyBilled: Cents;
  readonly depositPerCent?: number;
  readonly issuedAt: string;
  readonly dueAt?: string;
  readonly payTo?: string;
  readonly note?: string;
}

/**
 * An invoice, from what was signed and what has been agreed since.
 *
 * Refuses a change order that has not been agreed to. A change appearing on an
 * invoice before anybody said yes to it is exactly the behaviour a contractor
 * is accused of, and this app should be the reason he can prove he does not do
 * it.
 */
export function invoiceOf(request: InvoiceRequest): Invoice {
  if (!request.number.trim()) {
    throw new InvoiceError('An invoice needs a number, or two of them cannot be told apart.');
  }
  if (request.changes.tampered) {
    throw new InvoiceError(
      'The agreed document no longer matches what was signed, so nothing can be invoiced ' +
        'against it until that is sorted out. ' + request.changes.tamperNote
    );
  }

  const agreed = request.baseline.agreed.total + request.changes.difference;
  const amount = amountFor(
    request.stage,
    agreed,
    request.alreadyBilled,
    request.depositPerCent ?? 0
  );

  const lines: InvoiceLine[] = [
    {
      what: request.baseline.agreed.name,
      detail:
        `Agreed ${request.baseline.frozenAt.slice(0, 10)}, signed by ` +
        `${request.baseline.signatures.map((s) => s.who).join(' and ')}.`,
      amount: request.baseline.agreed.total,
    },
  ];
  for (const change of request.changes.changes) {
    lines.push({ what: `Change: ${change.item}`, detail: change.says, amount: change.difference });
  }

  return {
    id: request.id,
    number: request.number.trim(),
    stage: request.stage,
    company: request.company,
    client: request.client,
    jobName: request.jobName,
    lines,
    amount,
    agreed,
    alreadyBilled: request.alreadyBilled,
    issuedAt: request.issuedAt,
    dueAt: request.dueAt ?? '',
    payTo: request.payTo ?? '',
    note: request.note ?? '',
  };
}

/** What is still owed after this one is paid. */
export function outstandingAfter(invoice: Invoice): Cents {
  return invoice.agreed - invoice.alreadyBilled - invoice.amount;
}

/** The invoice said out loud, for a list. */
export function describeInvoice(invoice: Invoice): string {
  const left = outstandingAfter(invoice);
  return (
    `${STAGE_TITLE[invoice.stage]} ${invoice.number} — ${money(invoice.amount)}` +
    (left > 0n ? `, leaving ${money(left)} on the job.` : ', which settles the job.')
  );
}

/**
 * What is missing before this is worth sending.
 *
 * Named, never enforced -- the same rule the proposal and the claim follow. A
 * contractor who cannot send an invoice because a field is blank writes it
 * somewhere else.
 */
export function missingFromInvoice(invoice: Invoice): string[] {
  const missing: string[] = [];
  if (!invoice.company.name.trim()) missing.push('your business name');
  if (!invoice.client.name.trim()) missing.push('who it is for');
  if (!invoice.dueAt.trim()) missing.push('when it is due');
  if (!invoice.payTo.trim()) missing.push('how to pay you');
  return missing;
}
