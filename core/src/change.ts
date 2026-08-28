import { type Baseline, type Change, type ChangeKind, type ChangeOrder } from './baseline.ts';
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
  /** What it costs, mark-up and all. This is the figure that goes on a bill. */
  readonly difference: Cents;
  /** The job's mark-up on this change, on its own line. See `ChangeOrder`. */
  readonly markup: Cents;
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
    markup: order.markup,
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
 * Where each item stood when it was last signed for.
 *
 * Newest last, so the map ends up holding the most recent signed position of
 * every item rather than the first one. Ties keep the order the list arrived
 * in, because `sort` is stable and two change orders agreed in the same
 * millisecond have no other way to be told apart.
 */
function lastAgreedPositions(agreed: readonly AgreedChange[]): Map<string, Change> {
  const position = new Map<string, Change>();
  for (const one of [...agreed].sort((a, b) => Date.parse(a.agreedAt) - Date.parse(b.agreedAt))) {
    for (const change of one.document.changes) position.set(key(change), change);
  }
  return position;
}

/**
 * One item, restated from where the last signed change order left it.
 *
 * The kind is worked out again rather than carried over, because a line that
 * grew from the baseline can have shrunk since the change order, and calling
 * that "more" would be a sentence the contractor reads and disbelieves.
 */
function sinceItWasSignedFor(was: Change, now: Change): Change {
  const gone = now.nowQuantity === '';
  const back = was.nowQuantity === '';
  const kind: ChangeKind = gone
    ? 'removed'
    : back
      ? 'added'
      : now.nowQuantity === was.nowQuantity
        ? 'repriced'
        : Number(now.nowQuantity) > Number(was.nowQuantity)
          ? 'more'
          : 'less';
  return {
    item: now.item,
    unit: now.unit,
    kind,
    wasQuantity: was.nowQuantity,
    wasTotal: was.nowTotal,
    nowQuantity: now.nowQuantity,
    nowTotal: now.nowTotal,
    difference: now.nowTotal - was.nowTotal,
    says: gone
      ? `${now.item} comes off — ${was.nowQuantity} ${now.unit} at ${money(was.nowTotal)} was ` +
        'signed for on a change order.'
      : back
        ? `${now.item} is back on — ${now.nowQuantity} ${now.unit} at ${money(now.nowTotal)}, ` +
          'after a change order took it off.'
        : `${now.item} has moved again since it was signed for — ${was.nowQuantity} ${now.unit} ` +
          `at ${money(was.nowTotal)}, now ${now.nowQuantity} ${now.unit} at ${money(now.nowTotal)}.`,
  };
}

/**
 * The job as it stands, measured from what was LAST agreed rather than from the
 * baseline.
 *
 * ## The defect this exists to close
 *
 * `notYetAgreed` used to key on item and unit alone: once an item appeared on
 * any signed change order, it was treated as settled for ever. Measured on a
 * real job — CO-1 signed for the floor going from 420 to 520 sq ft, then the
 * rate book taken to $7.00 — the Price screen showed $11,144.20 while the Work
 * screen said "Nothing has moved on this job that somebody has not signed for"
 * and the invoice went on billing $9,479.72. The contractor was under-billing
 * himself and no screen admitted it.
 *
 * The other half of the same defect: `changesSince` prices everything against
 * the baseline, so a second change order raised on an item CO-1 already moved
 * would have carried the WHOLE move again — 420 to 600 rather than 520 to 600 —
 * and `agreedDifference` would have added both. Under-billing turning into
 * double-billing the moment the contractor did the right thing and raised the
 * amendment.
 *
 * Sam, asked which of the two an item should be compared against:
 *
 * > **"Compare against what was last agreed, not what was ever agreed."**
 *
 * So: every item that has a signed change order behind it is restated from
 * where that change order left it, `wasTotal` becomes the contract total as it
 * currently stands (baseline plus everything signed), and an item sitting
 * exactly where the last change order put it drops out — there is nothing to
 * report and nothing to raise.
 *
 * `agreedDifference` does the refusing: a change order signed against a
 * different agreement, or the same one twice, throws here before any of it is
 * priced. That is deliberate. Restating against a change order that belongs to
 * another job is the one arithmetic in this file nobody would ever catch.
 */
export function sinceLastAgreed(
  baseline: Baseline,
  order: ChangeOrder,
  agreed: readonly AgreedChange[]
): ChangeOrder {
  const settled = agreedDifference(baseline, agreed);
  const position = lastAgreedPositions(agreed);
  const changes: Change[] = [];
  for (const change of order.changes) {
    const was = position.get(key(change));
    if (!was) {
      changes.push(change);
      continue;
    }
    // Exactly where the last signed change order left it: nothing has happened
    // since, so there is nothing to say and nothing to raise.
    if (was.nowQuantity === change.nowQuantity && was.nowTotal === change.nowTotal) continue;
    changes.push(sinceItWasSignedFor(was, change));
  }
  // An item a change order moved can also have gone back to exactly what the
  // baseline said, and `changesSince` reports that as no change at all --
  // because against the baseline it is not one. Against the change order it is.
  // A base a change order took off, put back in the room, would otherwise sit
  // in the job billed at nothing and named nowhere.
  const named = new Set(order.changes.map(key));
  for (const [k, was] of position) {
    if (named.has(k)) continue;
    const line = baseline.agreed.lines.find((one) => key(one) === k);
    const now: Change = {
      item: line?.item ?? was.item,
      unit: line?.unit ?? was.unit,
      kind: 'repriced',
      wasQuantity: '',
      wasTotal: 0n,
      nowQuantity: line?.quantity ?? '',
      nowTotal: line?.total ?? 0n,
      difference: 0n,
      says: '',
    };
    if (was.nowQuantity === now.nowQuantity && was.nowTotal === now.nowTotal) continue;
    changes.push(sinceItWasSignedFor(was, now));
  }

  // Largest first, the same order `changesSince` puts them in and for the same
  // reason: this is read by somebody deciding whether to agree to it.
  changes.sort((a, b) => {
    const size = (one: Change) => (one.difference < 0n ? -one.difference : one.difference);
    return size(b) > size(a) ? 1 : size(b) < size(a) ? -1 : 0;
  });

  const onLines = changes.reduce((sum, one) => sum + one.difference, 0n);
  // What the whole move is worth, less what has already been signed for. Taken
  // off the totals rather than off the lines so the job's mark-up comes with
  // it, once: `order.difference` carries the mark-up on everything that has
  // moved since the baseline, and `settled` carries the mark-up already on the
  // signed change orders. What is left is the mark-up on this change alone.
  const difference = order.difference - settled;
  const wasTotal = order.wasTotal + settled;
  return {
    changes,
    difference,
    markup: difference - onLines,
    wasTotal,
    nowTotal: wasTotal + difference,
    unchanged: changes.length === 0 && difference === 0n,
    tampered: order.tampered,
    tamperNote: order.tamperNote,
  };
}

/**
 * What has moved on the job that nobody has signed for.
 *
 * The honest half of the rule. The invoice bills only what was agreed, and this
 * is what it did not bill — named, priced, and on the document, so the number
 * being lower than the contractor expected has a reason he can read rather than
 * being a figure he has to trust.
 *
 * Priced from the last signed change order, not from the baseline, so the
 * figure beside it is what is genuinely still unbilled. See `sinceLastAgreed`.
 */
export function notYetAgreed(
  baseline: Baseline,
  order: ChangeOrder,
  agreed: readonly AgreedChange[]
): readonly Change[] {
  return sinceLastAgreed(baseline, order, agreed).changes;
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
    // The mark-up said out loud, the same way the proposal says it. A figure
    // on an amendment that the lines above do not add up to is the figure a
    // client stops the job over.
    ...(document.markup === 0n
      ? []
      : [`• Mark-up on this change: ${money(document.markup)}.`]),
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
