import {
  type AgreedByReturnedCopy,
  type Baseline,
  type Change,
  type ChangeOrder,
} from './baseline.ts';
import { AGREED_BY_SAYS } from './countersign.ts';
import { type AgreedChange, agreedDifference, notYetAgreed, verifyChange } from './change.ts';
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
  /**
   * What has moved on the job that nobody signed for, and so is not on this
   * bill. Empty on a job that is running to its agreement.
   */
  readonly notBilled: readonly Change[];
  /** What this one asks for. */
  readonly amount: Cents;
  /** The whole job, agreed, so the client can see where this sits. */
  readonly agreed: Cents;
  /** Everything asked for before this one, on this job. */
  readonly alreadyBilled: Cents;
  /**
   * How the agreement under this bill was reached, when it was not a signature
   * taken on the phone.
   *
   * Carried on the invoice itself, not left to be looked up from the baseline.
   * An invoice is the document that leaves the job and gets forwarded, printed,
   * exported to a bookkeeper and put in front of an adjuster or a court, and it
   * has to be able to answer "how do you know this was agreed?" on its own. The
   * words are the baseline's own; see `AgreedByReturnedCopy` in `baseline.ts`.
   *
   * Absent on every invoice raised against a signature taken on the phone --
   * including every invoice already saved on somebody's phone, which reads back
   * exactly as it was written.
   */
  readonly agreedBy?: AgreedByReturnedCopy;
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
 * How much of the job a stage is being asked for.
 *
 * A deposit is a share of what was agreed. A progress payment is against the
 * work that has actually been done, so it has to be told how much that is --
 * either as the share of the job complete or as a figure the contractor names.
 * The final is the rest.
 *
 * The first version treated progress and final identically: both asked for
 * everything outstanding. That is not a progress payment, it is the final
 * invoice with the wrong word at the top, and sending one halfway through a job
 * asks a homeowner for the whole balance before the work is done.
 */
export interface StageShare {
  /** Deposit: what share of the agreed total it is. */
  readonly depositPerCent?: number;
  /** Progress: how much of the job is done, as a percentage. */
  readonly completePerCent?: number;
  /** Progress: a figure the contractor names instead, in cents. */
  readonly amount?: Cents;
}

/** The amount a stage asks for. */
export function amountFor(
  stage: Stage,
  agreed: Cents,
  alreadyBilled: Cents,
  share: StageShare = {}
): Cents {
  const outstanding = agreed - alreadyBilled;
  if (outstanding <= 0n) {
    throw new InvoiceError(
      `${money(alreadyBilled)} has already been invoiced against an agreed ` +
        `${money(agreed)}. There is nothing left to ask for, and asking twice for ` +
        'the same work is how a job ends badly.'
    );
  }
  if (stage === 'final') return outstanding;

  if (stage === 'deposit') {
    const perCent = share.depositPerCent ?? 0;
    if (perCent <= 0 || perCent >= 100) {
      throw new InvoiceError('A deposit has to be somewhere between 0 and 100 per cent of the job.');
    }
    // Rounded half away from zero, in cents, so the deposit and the final add up
    // to exactly the agreed figure with nothing left over.
    const part = (agreed * BigInt(Math.round(perCent * 100)) + 5000n) / 10000n;
    return part > outstanding ? outstanding : part;
  }

  if (share.amount !== undefined) {
    if (share.amount <= 0n) {
      throw new InvoiceError('A progress payment has to ask for something.');
    }
    if (share.amount > outstanding) {
      throw new InvoiceError(
        `${money(share.amount)} is more than the ${money(outstanding)} left on this job. ` +
          'A progress payment cannot ask for work that is not in the agreement.'
      );
    }
    return share.amount;
  }

  const complete = share.completePerCent;
  if (complete === undefined) {
    throw new InvoiceError(
      'A progress payment is against work that has been done, so say how much of the job ' +
        'is done or name the figure. Asking for everything outstanding halfway through is ' +
        'the final invoice with the wrong word at the top.'
    );
  }
  if (complete <= 0 || complete > 100) {
    throw new InvoiceError('How much of the job is done has to be more than 0 and at most 100 per cent.');
  }
  const earned = (agreed * BigInt(Math.round(complete * 100)) + 5000n) / 10000n;
  const due = earned - alreadyBilled;
  if (due <= 0n) {
    throw new InvoiceError(
      `At ${complete}% complete this job has earned ${money(earned)}, and ` +
        `${money(alreadyBilled)} has already been invoiced. There is nothing to ask for yet.`
    );
  }
  return due > outstanding ? outstanding : due;
}

export interface InvoiceRequest {
  readonly id: string;
  readonly number: string;
  readonly stage: Stage;
  readonly company: Company;
  readonly client: Party;
  readonly jobName: string;
  readonly baseline: Baseline;
  /**
   * Change orders the client has signed. Only these are billed.
   *
   * An empty list is fine and common: most jobs run without a change order, and
   * a job with one that nobody signed bills the same as a job with none.
   */
  readonly agreedChanges: readonly AgreedChange[];
  /**
   * What has moved on the job since it was signed, whether or not anybody has
   * agreed to it. Never billed. Named on the invoice so the contractor can see
   * exactly what is not on it, and raise a change order for the parts he means
   * to be paid for.
   */
  readonly moved?: ChangeOrder;
  readonly alreadyBilled: Cents;
  readonly share?: StageShare;
  readonly issuedAt: string;
  readonly dueAt?: string;
  readonly payTo?: string;
  readonly note?: string;
}

/**
 * An invoice, from what was signed and from the change orders that were signed
 * since. Nothing else.
 *
 * This is the rule the file used to claim and not keep. `request.moved` can say
 * the job is now worth twice what was agreed; not one cent of it reaches
 * `amount` until there is an `AgreedChange` carrying a client signature sealed
 * to the change order document. What is unsigned comes back on `notBilled`, so
 * the contractor sees it and can go and get it signed.
 *
 * Synchronous, so every screen that shows a total can call it. The seals on the
 * signed change orders are checked by `invoiceOfVerified`, which is the one
 * anything sends.
 */
export function invoiceOf(request: InvoiceRequest): Invoice {
  if (!request.number.trim()) {
    throw new InvoiceError('An invoice needs a number, or two of them cannot be told apart.');
  }
  if (request.moved?.tampered) {
    throw new InvoiceError(
      'The agreed document no longer matches what was signed, so nothing can be invoiced ' +
        'against it until that is sorted out. ' + request.moved.tamperNote
    );
  }

  const difference = agreedDifference(request.baseline, request.agreedChanges);
  const agreed = request.baseline.agreed.total + difference;
  const amount = amountFor(request.stage, agreed, request.alreadyBilled, request.share ?? {});

  // How this was agreed, on the line that carries the agreed figure -- so the
  // strength of the evidence sits beside the money it is being used to ask for,
  // on the screen, on the document, and in the QuickBooks export, which prints
  // this field verbatim. A bookkeeper reading the CSV six months later sees the
  // same sentence the homeowner does.
  const agreedBy = request.baseline.agreedBy;
  const day = request.baseline.frozenAt.slice(0, 10);
  const lines: InvoiceLine[] = [
    {
      what: request.baseline.agreed.name,
      detail: agreedBy
        ? `Agreed ${day} by ${AGREED_BY_SAYS[agreedBy.cameBackBy]} from ` +
          `${agreedBy.saysSignedBy}. Not signed on the phone: nobody watched them sign and ` +
          'no identity was checked.'
        : `Agreed ${day}, signed by ` +
          `${request.baseline.signatures.map((s) => s.who).join(' and ')}.`,
      amount: request.baseline.agreed.total,
    },
  ];
  for (const one of request.agreedChanges) {
    const doc = one.document;
    for (const change of doc.changes) {
      lines.push({
        what: `Change ${doc.number}: ${change.item}`,
        detail:
          `${change.says} Agreed ${one.agreedAt.slice(0, 10)}, signed by ` +
          `${one.signatures.map((s) => s.who).join(' and ')}.`,
        amount: change.difference,
      });
    }
  }

  const notBilled = request.moved ? notYetAgreed(request.moved, request.agreedChanges) : [];

  return {
    id: request.id,
    number: request.number.trim(),
    stage: request.stage,
    company: request.company,
    client: request.client,
    jobName: request.jobName,
    lines,
    notBilled,
    amount,
    agreed,
    alreadyBilled: request.alreadyBilled,
    // Spread rather than written as `agreedBy: undefined`, so an invoice raised
    // on a signature taken on the phone has exactly the keys it has always had
    // and canonicalises to exactly the text it always did.
    ...(agreedBy ? { agreedBy } : {}),
    issuedAt: request.issuedAt,
    dueAt: request.dueAt ?? '',
    payTo: request.payTo ?? '',
    note: request.note ?? '',
  };
}

/**
 * The same, with every signed change order's seal checked first.
 *
 * Separate for the same reason `changesSinceVerified` is separate from
 * `changesSince`: checking a hash is asynchronous and a total on a screen is
 * not. Anything that sends an invoice, or shows one to a client, uses this one.
 */
export async function invoiceOfVerified(request: InvoiceRequest): Promise<Invoice> {
  for (const one of request.agreedChanges) {
    const seal = await verifyChange(one);
    if (!seal.ok) {
      throw new InvoiceError(
        `Change order ${one.document.number} no longer matches what was signed, so it cannot ` +
          'be billed. ' + seal.why
      );
    }
  }
  return invoiceOf(request);
}

/** What is still owed after this one is paid. */
export function outstandingAfter(invoice: Invoice): Cents {
  return invoice.agreed - invoice.alreadyBilled - invoice.amount;
}

/** The invoice said out loud, for a list. */
export function describeInvoice(invoice: Invoice): string {
  const left = outstandingAfter(invoice);
  // Read defensively: every invoice written before there was a second way to
  // agree a job has no `agreedBy` on it, and absent is exactly right for those
  // -- they were all raised against a signature taken on the phone.
  const how = invoice.agreedBy ? ` ${invoice.agreedBy.says}` : '';
  return (
    `${STAGE_TITLE[invoice.stage]} ${invoice.number} — ${money(invoice.amount)}` +
    (left > 0n ? `, leaving ${money(left)} on the job.` : ', which settles the job.') +
    how
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

/**
 * What is on the job but not on the bill, said out loud.
 *
 * The contractor reads this, not the client. He is owed an explanation for
 * every dollar the app declined to ask for on his behalf, and "it is not
 * signed" is the whole of it.
 */
export function whyNotBilled(invoice: Invoice): string {
  // Read defensively, because every invoice written before change orders were
  // separated from the live quote has no `notBilled` on it, and every one of
  // those is inside a saved job on somebody's phone. Absent is not empty by
  // accident here -- it is exactly right: nothing was held back, because
  // holding things back is what this release introduced.
  const held = invoice.notBilled ?? [];
  if (held.length === 0) return '';
  const total = held.reduce((sum, c) => sum + c.difference, 0n);
  const size = total < 0n ? -total : total;
  const count = held.length;
  return (
    `${count} thing${count === 1 ? '' : 's'} ${count === 1 ? 'has' : 'have'} changed on this ` +
    `job that nobody has signed for, worth ${money(size)}. ${count === 1 ? 'It is' : 'They are'} ` +
    'not on this invoice. Raise a change order, get it signed, and it goes on the next one.'
  );
}
