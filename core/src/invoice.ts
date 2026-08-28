import {
  type AgreedByReturnedCopy,
  type Baseline,
  type Change,
  type ChangeOrder,
  type Withdrawal,
  type Withdrawn,
  withdrawalOf,
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
  /**
   * What this reverses, when it is a reversal rather than a bill.
   *
   * Absent on every invoice that asks to be paid — including every invoice
   * already saved on somebody's phone, which reads back and canonicalises
   * exactly as it was written. Its presence is what makes this a reversal;
   * `amount` is then negative and nothing on the job is owed on it.
   *
   * See `Reversal` below for what a reversal is and why the bill it reverses
   * is still here.
   */
  readonly reverses?: Reversal;
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
  /**
   * Agreements on this job that have been withdrawn.
   *
   * Handed in so `invoiceOf` can refuse to bill one. It is a list rather than a
   * flag because a job can be agreed, withdrawn and agreed again, and each
   * withdrawal stays on the record for ever; what matters is whether the
   * baseline on THIS request is one of them.
   *
   * Empty or absent on every job that has never had one, which is almost all of
   * them.
   */
  readonly withdrawn?: readonly Withdrawn[];
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
  // Before anything is worked out. A bill against an agreement that has been
  // withdrawn is the exact thing the withdrawal was for -- and it would come
  // out looking like every other bill, with a total, a due date and somewhere
  // to pay, against a scope nobody is bound by.
  const gone = withdrawalOf(request.baseline, request.withdrawn ?? []);
  if (gone) {
    throw new InvoiceError(
      `That agreement was withdrawn on ${gone.withdrawal.at.slice(0, 10)}, so nothing can be ` +
        `invoiced against it. Why it was withdrawn: ${gone.withdrawal.reason} Every invoice ` +
        'already raised on it has been reversed, and both the bills and the reversals stay on ' +
        'this job. Agree the work again and bill against that.'
    );
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

/* ===================================================================== */
/*  Reversals: a bill undone without a bill disappearing                 */
/* ===================================================================== */

/**
 * Why one invoice was reversed, carried on the reversal itself.
 *
 * ## Sam's answer, asked what happens to invoices already raised
 *
 * > **"Withdraw them too, as reversals."**
 *
 * Each invoice raised against a withdrawn agreement gets a matching reversal
 * for exactly its own amount, so what is asked for on the job nets to zero.
 * **Both stay on the record.** The bill is not edited, is not deleted, and does
 * not quietly become smaller; a second document appears beside it saying it has
 * been reversed and why.
 *
 * That is the same rule the double-entry ledger under this product already
 * holds and the reason to hold it here: a reversal never erases the original.
 * A bill that vanished would leave the contractor's own copy, the client's
 * emailed copy and his bookkeeper's export all disagreeing about whether it
 * ever existed — and the one document that can settle that argument is the one
 * that would have been deleted.
 *
 * It is also what stops the withdrawal being a way to launder money out of a
 * job. Deleting the bills would leave a job that had been invoiced $3,000 and
 * shows no sign of it. Reversing them leaves $3,000 asked for, $3,000 taken
 * back, and — if any of it was actually paid — money the contractor is still
 * holding, in plain sight, on the screen and in the export.
 */
export interface Reversal {
  /** The invoice this reverses, by id. */
  readonly of: string;
  /** Its number, so a bookkeeper reading one row can find the other. */
  readonly ofNumber: string;
  /** What that invoice asked for. Positive; this reversal is its negative. */
  readonly ofAmount: Cents;
  /** Why, in the contractor's own words: the withdrawal's own reason. */
  readonly because: string;
  /** When the agreement was withdrawn. */
  readonly at: string;
  /** The one line every screen, list and export prints. */
  readonly says: string;
}

/**
 * The reversal of one invoice.
 *
 * Refuses to reverse a reversal. Two of them against one bill would net to the
 * bill again, so the money would come back from nowhere — and nothing on the
 * screen would say it had.
 *
 * ## What is on it, and what is deliberately not
 *
 * **One line, for exactly what the bill asked.** Not a mirror of the original's
 * lines: those describe the agreed scope and add up to the whole job, while a
 * deposit invoice *asks* for a share of it. Negating the lines would reverse a
 * figure nobody was ever billed. The reversal's single line carries
 * `-invoice.amount`, in `bigint` cents, so bill plus reversal is exactly zero
 * with no rounding anywhere near it.
 *
 * **Its own number**, the original's with `-R` on the end. QuickBooks groups
 * rows by `InvoiceNo`: sharing the number would merge the two into one invoice
 * of zero, which is a bill that vanished by another route.
 *
 * **No due date and nowhere to pay.** A reversal asks for nothing, so there is
 * nothing to be late and nothing to send. `missingFromInvoice` knows that and
 * does not nag for either.
 *
 * **No `agreedBy`.** How the agreement was reached is a fact about a bill that
 * is asking to be paid. This one is not, and its whole content is that the
 * agreement under the original was withdrawn — which it says, in full.
 */
export function reversalOf(invoice: Invoice, withdrawal: Withdrawal): Invoice {
  if (invoice.reverses) {
    throw new InvoiceError(
      `Invoice ${invoice.number} is already the reversal of ${invoice.reverses.ofNumber}. ` +
        'Reversing a reversal would put the money back on the job with nothing on the record ' +
        'to say where it came from.'
    );
  }
  const stage = STAGE_TITLE[invoice.stage].toLowerCase();
  const says =
    `Reverses ${stage} ${invoice.number} in full — ${money(invoice.amount)} — because the ` +
    `agreement it was raised against was withdrawn on ${withdrawal.at.slice(0, 10)}. ` +
    `Why: ${withdrawal.reason} Invoice ${invoice.number} stays on this job exactly as it was ` +
    'sent. Nothing has been deleted.';
  const reverses: Reversal = {
    of: invoice.id,
    ofNumber: invoice.number,
    ofAmount: invoice.amount,
    because: withdrawal.reason,
    at: withdrawal.at,
    says,
  };
  return {
    // Worked out from the invoice it reverses rather than from a clock, so
    // reversing the same bill twice would produce the same id and be caught,
    // and so a job that is saved, reopened and reversed reads identically.
    id: `${invoice.id}-reversed`,
    number: `${invoice.number}-R`,
    // The original's stage, because `Stage` names what a bill was for and this
    // one is for that. What it IS is decided by `reverses` being there, which
    // is the field every screen and every sentence below reads.
    stage: invoice.stage,
    company: invoice.company,
    client: invoice.client,
    jobName: invoice.jobName,
    lines: [
      {
        what: `Reversal of ${stage} ${invoice.number}`,
        detail: says,
        amount: -invoice.amount,
      },
    ],
    notBilled: [],
    amount: -invoice.amount,
    agreed: invoice.agreed,
    alreadyBilled: invoice.alreadyBilled,
    issuedAt: withdrawal.at,
    dueAt: '',
    payTo: '',
    // Into the Memo column of every row of this invoice in the QuickBooks
    // export, so a bookkeeper who reads nothing else reads this.
    note: says,
    reverses,
  };
}

/**
 * The bills on this job that already have a reversal against them, by id.
 *
 * One place that knows, because two places would disagree. It decides what
 * `reversalsFor` may write and what the screen may still ask to be paid, and a
 * screen that offered "money came in" against a bill that had been taken back
 * would be inviting a contractor to record a payment on a bill he has told the
 * client to ignore.
 */
export function alreadyReversed(invoices: readonly Invoice[]): ReadonlySet<string> {
  return new Set(
    invoices.flatMap((invoice) => (invoice.reverses ? [invoice.reverses.of] : []))
  );
}

/**
 * A reversal for every invoice on the job that does not already have one.
 *
 * Idempotent on purpose: run it twice and the second run produces nothing,
 * because every bill already has its reversal beside it. A withdrawal is
 * written once, but the safe answer to "what if this ran again" must not be a
 * job billed to minus the deposit.
 */
export function reversalsFor(
  invoices: readonly Invoice[],
  withdrawal: Withdrawal
): readonly Invoice[] {
  const done = alreadyReversed(invoices);
  return invoices
    .filter((invoice) => !invoice.reverses && !done.has(invoice.id))
    .map((invoice) => reversalOf(invoice, withdrawal));
}

/**
 * What every invoice on a job adds up to asking for, reversals included.
 *
 * The figure a screen means by "invoiced so far" and the one that has to reach
 * zero after a withdrawal. `totalOwed` in `payment.ts` cannot do this job: it
 * floors each invoice at zero so an overpayment never owes a negative, which is
 * right for a bill and wrong for a reversal — a reversal would count as nothing
 * and the bill it reversed would go on being owed for ever.
 */
export function netAsked(invoices: readonly Invoice[]): Cents {
  return invoices.reduce((sum, invoice) => sum + invoice.amount, 0n);
}

/**
 * What is still owed after this one is paid.
 *
 * Zero on a reversal, and stated rather than worked out: a reversal asks for
 * nothing, so nothing is outstanding after it. The subtraction below would run
 * and would produce a figure — the agreed total plus the amount taken back —
 * and a screen printing it would tell a contractor his withdrawn job still had
 * money to bill.
 */
export function outstandingAfter(invoice: Invoice): Cents {
  if (invoice.reverses) return 0n;
  return invoice.agreed - invoice.alreadyBilled - invoice.amount;
}

/** The invoice said out loud, for a list. */
export function describeInvoice(invoice: Invoice): string {
  // A reversal says what it is and what it undid, in its own words, and never
  // borrows the sentence a bill uses -- "Final payment 2026-101-R -- -$4,030.50,
  // which settles the job" is a sentence that is true of nothing.
  if (invoice.reverses) return invoice.reverses.says;
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
  // A reversal asks for nothing, so there is nothing to be due and nowhere to
  // pay. Nagging for either would be asking a contractor to finish a document
  // whose whole content is that a bill has been taken back.
  if (invoice.reverses) return [];
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
