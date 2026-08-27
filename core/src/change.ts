import { type Baseline, type Change, type ChangeOrder } from './baseline.ts';
import { type Company } from './company.ts';
import { type Cents, money } from './price.ts';
import { type Party } from './proposal.ts';
import { type Seal, type Signature, hashOf, verify } from './signature.ts';
import { RoomError } from './room.ts';

/**
 * A change order somebody signed.
 *
 * ## The defect this exists to close
 *
 * `invoice.ts` said, in its own documentation, that it "refuses a change order
 * that has not been agreed to". It did not. `invoiceOf` added
 * `changes.difference` to the agreed total unconditionally, and
 * `changes.difference` is computed from whatever the room measures *right now*.
 * Move a wall, add a line to the price book, re-measure a floor — the invoice
 * went up, silently, against a contract nobody had amended.
 *
 * That is not a rounding bug. It is the single accusation a homeowner makes
 * against a remodeler, and this app existed to be the reason its owner can
 * prove he does not do it. The document claimed a protection the code did not
 * have, which is worse than not having it, because he would have relied on it.
 *
 * ## What a change order has to be
 *
 * A change order is an amendment to a signed contract, so it needs everything
 * the contract needed and one thing more:
 *
 * 1. **In writing, itemised, priced.** Not "we agreed on some extras".
 * 2. **Raised before the work.** The document carries when it was raised, and
 *    when it was agreed, as two separate times, because the gap between them is
 *    the fact in dispute.
 * 3. **Signed by the client**, with the same five pieces of evidence a
 *    signature on the original carries — intent, consent, attribution, time,
 *    and a fingerprint of *this* document. See `signature.ts`.
 * 4. **Bound to the agreement it amends.** It carries the fingerprint of the
 *    baseline. A change signed against one proposal cannot be billed on
 *    another, and this refuses to.
 * 5. **What it does to the finish date.** Money is not the only thing a change
 *    moves, and "it was going to be done by Friday" is the other argument.
 *
 * Several states require a written, signed change order on a home improvement
 * contract before the extra work happens, and every one of them is satisfied by
 * producing the document rather than by claiming it exists. Nothing here is
 * legal advice, and none of it replaces reading what a particular state
 * requires of a particular contract.
 *
 * ## The rule
 *
 * **Only a signed change order is billable.** Everything else is a number on a
 * screen. `notYetAgreed` names the rest so the contractor can see exactly what
 * is not on the bill and why, rather than wondering where his money went.
 */

export class ChangeError extends RoomError {}

/** The sentence a client agrees to on a change order. */
export const CHANGE_CLIENT_INTENT =
  'I agree to this change to the work and to what it does to the price and the ' +
  'finish date, and I intend this to be my signature.';

/** The sentence the contractor agrees to. */
export const CHANGE_CONTRACTOR_INTENT =
  'I offer this change at this price and this change to the schedule, and I ' +
  'intend this to be my signature.';

/**
 * The amendment, as a document.
 *
 * Everything on it is fixed at the moment it is raised. Re-measuring the room
 * afterwards produces a different `ChangeOrder`, and a different `ChangeOrder`
 * is a different change order — raised, numbered and signed on its own.
 */
export interface ChangeDocument {
  readonly id: string;
  /** The contractor's own numbering, so two of them can be told apart. */
  readonly number: string;
  readonly jobName: string;
  readonly company: Company;
  readonly client: Party;
  /** The agreement being amended. */
  readonly proposalId: string;
  /** Its fingerprint, so this cannot be billed against a different one. */
  readonly baselineHash: string;
  readonly raisedAt: string;
  /** Why this is happening, in the contractor's own words. */
  readonly because: string;
  readonly changes: readonly Change[];
  readonly difference: Cents;
  readonly wasTotal: Cents;
  readonly nowTotal: Cents;
  /** Days this adds to the finish date. Zero is an answer; blank is not. */
  readonly extraDays: number;
}

export interface RaiseRequest {
  readonly id: string;
  readonly number: string;
  readonly jobName: string;
  readonly company: Company;
  readonly client: Party;
  readonly raisedAt: string;
  readonly because: string;
  readonly extraDays: number;
}

/**
 * Writes the amendment down.
 *
 * Refuses an empty one, a tampered one, and one with no reason on it. A change
 * order with no reason is the one that gets argued about, and the reason costs
 * a sentence to record and a job to reconstruct.
 */
export function raiseChange(
  baseline: Baseline,
  order: ChangeOrder,
  request: RaiseRequest
): ChangeDocument {
  if (order.tampered) {
    throw new ChangeError(
      'The signed agreement no longer matches what was signed, so nothing can be raised ' +
        'against it until that is sorted out. ' + order.tamperNote
    );
  }
  if (order.unchanged) {
    throw new ChangeError(
      'Nothing has changed since this was signed, so there is nothing to raise. A change ' +
        'order for no change is a document that makes a job look like it moved when it did not.'
    );
  }
  if (!request.number.trim()) {
    throw new ChangeError('A change order needs a number, or two of them cannot be told apart.');
  }
  if (!request.because.trim()) {
    throw new ChangeError(
      'Say why this change is happening. It is one sentence now and the whole argument later.'
    );
  }
  if (!Number.isInteger(request.extraDays) || request.extraDays < 0) {
    throw new ChangeError(
      'Days added to the job have to be a whole number, and none of them can be negative. ' +
        'Put 0 if this changes nothing about the finish date.'
    );
  }
  if (Number.isNaN(Date.parse(request.raisedAt))) {
    throw new ChangeError(`"${request.raisedAt}" is not a time this can record.`);
  }
  return {
    id: request.id,
    number: request.number.trim(),
    jobName: request.jobName,
    company: request.company,
    client: request.client,
    proposalId: baseline.proposalId,
    baselineHash: baseline.hash,
    raisedAt: request.raisedAt,
    because: request.because.trim(),
    changes: order.changes,
    difference: order.difference,
    wasTotal: order.wasTotal,
    nowTotal: order.nowTotal,
    extraDays: request.extraDays,
  };
}

/**
 * A change order and the evidence it was agreed to.
 *
 * The same shape as a `Baseline`, on purpose: a signed amendment is a signed
 * agreement, and anything that can be billed in this app is one of these two
 * things and nothing else.
 */
export interface AgreedChange {
  readonly document: ChangeDocument;
  readonly signatures: readonly Signature[];
  readonly agreedAt: string;
  /** The fingerprint of the document at the moment it was agreed. */
  readonly hash: string;
}

/**
 * Freezes a signed change order.
 *
 * Refuses one the client has not signed, and refuses a signature that was made
 * against a different version of the document — which is the failure that
 * matters, because a signature sealed to yesterday's price attached to today's
 * document is exactly what a forged amendment looks like.
 */
export async function agreeToChange(
  document: ChangeDocument,
  signatures: readonly Signature[],
  at: string
): Promise<AgreedChange> {
  const client = signatures.find((s) => s.role === 'client');
  if (!client) {
    throw new ChangeError(
      'Nothing is agreed until the client has signed it. Until then this change is a ' +
        'proposal, and a proposal cannot be invoiced.'
    );
  }
  if (Number.isNaN(Date.parse(at))) {
    throw new ChangeError(`"${at}" is not a time this can record.`);
  }
  const hash = await hashOf(document);
  for (const signature of signatures) {
    if (signature.documentHash !== hash) {
      throw new ChangeError(
        `${signature.who} signed a different version of this change order. The version ` +
          'they signed is the one that counts, and this one has moved since. Raise it again.'
      );
    }
  }
  return { document, signatures, agreedAt: at, hash };
}

/** Whether a signed change order still matches what was signed. */
export async function verifyChange(agreed: AgreedChange): Promise<Seal> {
  const client = agreed.signatures.find((s) => s.role === 'client');
  if (!client) {
    return {
      ok: false,
      hash: agreed.hash,
      signed: agreed.hash,
      why: 'This change order carries no client signature, so there is nothing to check it against.',
    };
  }
  return verify(agreed.document, client);
}

/**
 * What the signed change orders add to the job, and nothing else.
 *
 * Refuses a change signed against a different agreement, and refuses the same
 * one twice. Both are the same mistake — billing a number more than once — and
 * both are silent until somebody adds up the invoices by hand.
 */
export function agreedDifference(
  baseline: Baseline,
  agreed: readonly AgreedChange[]
): Cents {
  const seen = new Set<string>();
  let total = 0n;
  for (const one of agreed) {
    const doc = one.document;
    if (doc.baselineHash !== baseline.hash || doc.proposalId !== baseline.proposalId) {
      throw new ChangeError(
        `Change order ${doc.number} was signed against a different agreement, so it cannot ` +
          'be billed on this one. The agreement it belongs to is the one it goes on.'
      );
    }
    if (seen.has(doc.id)) {
      throw new ChangeError(
        `Change order ${doc.number} is on this bill twice, for ${money(doc.difference)} each ` +
          'time. Asking twice for the same work is how a job ends badly.'
      );
    }
    seen.add(doc.id);
    total += doc.difference;
  }
  return total;
}

const key = (line: { item: string; unit: string }) => `${line.item} ${line.unit}`;

/**
 * What has moved on the job that nobody has signed for.
 *
 * The honest half of the rule. The invoice bills only what was agreed, and this
 * is what it did not bill — named, priced, and on the document, so the number
 * being lower than the contractor expected has a reason he can read rather than
 * being a figure he has to trust.
 */
export function notYetAgreed(
  order: ChangeOrder,
  agreed: readonly AgreedChange[]
): readonly Change[] {
  const signed = new Set<string>();
  for (const one of agreed) {
    for (const change of one.document.changes) signed.add(key(change));
  }
  return order.changes.filter((change) => !signed.has(key(change)));
}

/**
 * The change order said out loud, for the sheet the client reads.
 *
 * Plain sentences rather than a table, for the same reason `describeSignature`
 * is: the record is only worth keeping if it can be produced and understood by
 * somebody who was not there.
 */
export function describeChangeDocument(document: ChangeDocument): string[] {
  const size = document.difference < 0n ? -document.difference : document.difference;
  const direction = document.difference < 0n ? 'off the job' : 'onto the job';
  return [
    `Change order ${document.number} on ${document.jobName}, raised ${document.raisedAt.slice(0, 10)}.`,
    `Why: ${document.because}`,
    ...document.changes.map((change) => `• ${change.says}`),
    document.difference === 0n
      ? 'This costs nothing either way.'
      : `${money(size)} ${direction}. Agreed at ${money(document.wasTotal)}, ` +
        `now ${money(document.nowTotal)}.`,
    document.extraDays === 0
      ? 'This adds no days to the finish date.'
      : `This adds ${document.extraDays} day${document.extraDays === 1 ? '' : 's'} to the ` +
        'finish date.',
  ];
}
