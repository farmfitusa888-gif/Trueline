import {
  AGREED_BY_SAYS,
  type CameBackBy,
  type ReturnedDocument,
  notTheSignedVersion,
} from './countersign.ts';
import { type Cents, type PricedLine, type Quote, money } from './price.ts';
import { type Proposal, type ProposalOption, ProposalError, chosenOption } from './proposal.ts';
import { type Signature, hashOf, verify } from './signature.ts';
import { RoomError } from './room.ts';

/**
 * What was agreed, frozen, and everything that has happened to it since.
 *
 * This is the largest thing the product was missing. Scope creep is not an
 * argument about who remembers what -- it is what happens when there is no
 * written record of the original scope, so every later addition is a
 * conversation instead of a line. A contractor with a signed baseline does not
 * have that conversation; he has a list, and the list has a price and a place
 * to sign.
 *
 * The rule the whole module exists to enforce: **a baseline is never edited.**
 * The room can be re-measured, walls can move, rates can change, and none of it
 * touches what was signed. The difference between then and now is the change
 * order, and the change order is what gets agreed -- separately, in writing,
 * before the work happens.
 *
 * That is the same discipline the ledger under the measurements already uses:
 * nothing is overwritten, a correction is a new entry, and the original stays
 * legible. It is the reason this could be built in an afternoon rather than a
 * month.
 */

export class BaselineError extends RoomError {}

/**
 * How a baseline was agreed, when it was not agreed on the phone.
 *
 * ## Why a baseline carries this at all
 *
 * Most jobs are won the way `countersign.ts` describes: the proposal goes out,
 * the client prints it, signs it at the kitchen table and texts a photograph
 * back. Until now that photograph could be filed against the job and could not
 * make the job billable, because `freeze()` requires a client `Signature` and a
 * photograph is deliberately not one. The contractor was left holding a signed
 * agreement the app refused to invoice against -- so he invoiced outside it,
 * and the app then knew less about his job than his email did.
 *
 * Sam's decision, in his words: **"Let it freeze the job, with the weakness
 * written on the agreement."**
 *
 * So the returned copy freezes the baseline, and the baseline *itself* records
 * that it was agreed on a returned copy rather than signed on the phone. It is
 * not a footnote somewhere else that a screen may or may not remember to fetch:
 * anything holding this object can see it without looking anywhere else, and
 * the two sentences it carries are the exact words every invoice, document and
 * export prints. You can invoice; nobody is ever misled about the strength of
 * the evidence.
 *
 * ## What it is not
 *
 * It is not a signature and it never becomes one. There is no `who`, no `at`,
 * no `mark`, no `intent` and no `consented` on it, for exactly the reason
 * `countersign.ts` gives: a record that quietly reads like a stronger one is
 * worse than no record. `signatures` on a baseline frozen this way is empty,
 * and stays empty.
 */
export interface AgreedByReturnedCopy {
  /**
   * Which of the ways this was agreed. One value today, and named rather than
   * implied so that a reader holding one of these -- or a `switch` written
   * years from now -- never has to infer it from what is absent.
   */
  readonly how: 'returned copy';
  /** The `ReturnedDocument` this came from, by id, so the copy can be found. */
  readonly returnedId: string;
  /** Who says they signed it. Their word, and named as their word. */
  readonly saysSignedBy: string;
  /** The day they say they signed, `YYYY-MM-DD`. Their word too. */
  readonly saysSignedOn: string;
  /** How the signed copy reached the contractor. */
  readonly cameBackBy: CameBackBy;
  /** When it reached him. The app's own clock, and the only measured time here. */
  readonly cameBackAt: string;
  /** The fingerprint of the proposal as it went out, so this still binds. */
  readonly sentHash: string;
  /** The fingerprint of the copy itself, so the picture cannot be swapped. */
  readonly copyHash: string;
  /**
   * The one line a list can afford, written once and printed everywhere.
   *
   * Stored on the record rather than composed by each screen, because the
   * strength of the evidence is a fact about the agreement and not a matter of
   * how a particular screen feels like phrasing it. It travels inside the saved
   * job file, so it is still there on a phone with no signal in two years.
   */
  readonly says: string;
  /** The same fact at the length a document can afford. */
  readonly weakness: string;
}

export interface Baseline {
  readonly proposalId: string;
  /** The option that was taken, exactly as it was priced then. */
  readonly agreed: ProposalOption;
  /** Who signed it, and the evidence that they did. */
  readonly signatures: readonly Signature[];
  readonly frozenAt: string;
  /** The fingerprint of the proposal at the moment it was agreed. */
  readonly hash: string;
  /**
   * How it was agreed, when it was **not** a signature taken on the phone.
   *
   * Absent -- not `null`, not a `'signed here'` variant -- on every baseline
   * `freeze()` produces, which is what keeps an on-phone agreement byte for
   * byte the record it has always been: the same keys, the same canonical
   * text, the same hash, and every baseline already saved on somebody's phone
   * still reads back exactly as it was written.
   *
   * So the test is `baseline.agreedBy`, and its absence means the strongest
   * evidence this app can take. Nothing sets it by accident: `freeze()` never
   * writes it and `freezeOnReturnedCopy()` is the only thing that does.
   */
  readonly agreedBy?: AgreedByReturnedCopy;
}

/**
 * Freezes a signed proposal.
 *
 * Refuses an unsigned one. A baseline nobody signed is a draft, and calling it
 * a baseline is how a contractor ends up believing he has an agreement he
 * cannot show anybody.
 */
export async function freeze(
  proposal: Proposal,
  signatures: readonly Signature[],
  at: string
): Promise<Baseline> {
  const agreed = chosenOption(proposal);
  if (!agreed) {
    throw new ProposalError(
      'No option has been taken, so there is nothing to agree to. The client picks one, ' +
        'then signs it.'
    );
  }
  if (!signatures.some((s) => s.role === 'client')) {
    throw new BaselineError(
      'Nothing is frozen until the client has signed it. Until then this is a quote, and a ' +
        'quote is not something a change order can be measured against.'
    );
  }
  return {
    proposalId: proposal.id,
    agreed,
    signatures,
    frozenAt: at,
    hash: await hashOf(proposal),
  };
}

/**
 * Freezes a proposal on the strength of a signed copy that came back.
 *
 * The second of the two ways a job gets agreed, and the one most jobs actually
 * take. It is a **separate, explicitly named function** rather than another
 * argument to `freeze()` on purpose: nothing reaches this path by leaving a
 * field blank, by passing an empty list, or by an object that happens to have
 * the right shape. Somebody had to type the name of it.
 *
 * `freeze()` is untouched and still refuses anything without a client
 * `Signature`. A `ReturnedDocument` still cannot be passed to it, still has no
 * field a `Signature` has, and still cannot be made into one. What has changed
 * is that there is now a second door, marked, and the baseline that comes
 * through it says so on itself for the rest of its life.
 *
 * ## The three refusals
 *
 * **Nothing taken.** The same refusal `freeze()` gives: a signed copy of a
 * proposal where no option was chosen agrees to no price.
 *
 * **The wrong document.** A copy filed against a change order, or against
 * another proposal, cannot be the agreement. A change order amends an
 * agreement; it is not one.
 *
 * **The document moved.** This is the refusal the whole path exists to keep.
 * The returned copy carries the fingerprint of the proposal as it went out. If
 * the proposal on this phone no longer hashes to it, the sheet they signed and
 * the sheet here are two different documents, and freezing would put their
 * signature against a version they never saw -- the exact shape of an
 * accidental fraud, committed by a contractor who would have no idea.
 */
export async function freezeOnReturnedCopy(
  proposal: Proposal,
  returned: ReturnedDocument,
  at: string
): Promise<Baseline> {
  const agreed = chosenOption(proposal);
  if (!agreed) {
    throw new ProposalError(
      'No option has been taken, so there is nothing to agree to. Take the option they ' +
        'signed for, then file the signed copy against it.'
    );
  }
  if (returned.documentKind !== 'proposal') {
    throw new BaselineError(
      `That signed copy is against a ${returned.documentKind}, not against this proposal. A ` +
        'change order amends an agreement and cannot be the agreement, so it cannot freeze ' +
        'the job.'
    );
  }
  if (returned.documentId !== proposal.id) {
    throw new BaselineError(
      'That signed copy belongs to a different proposal. A signature carries across nothing ' +
        'except the document it was made against, and freezing this one on it would agree a ' +
        'price nobody was shown.'
    );
  }
  // The one measured time on this whole record. A signature carries the moment
  // it was made; a photograph carries whatever the contractor's phone said when
  // the copy arrived, and if that is not a time this can keep then the record
  // has no measured time on it at all -- only somebody's word for a date.
  if (Number.isNaN(Date.parse(at))) {
    throw new BaselineError(`"${at}" is not a time this can record.`);
  }
  const hash = await hashOf(proposal);
  if (hash !== returned.sentHash) {
    throw new BaselineError(
      'This is not the proposal that was sent out, so it cannot be frozen on that signed ' +
        'copy. Something in it has changed since it went, which makes the sheet they signed ' +
        'and the sheet on this phone two different documents. Put the proposal back the way ' +
        'it was, or send the current one again and get that signed.'
    );
  }
  return {
    proposalId: proposal.id,
    agreed,
    // Empty, and empty on purpose. There is no signature here, so the app does
    // not hold one, does not synthesise one, and never shows one.
    signatures: [],
    frozenAt: at,
    hash,
    agreedBy: {
      how: 'returned copy',
      returnedId: returned.id,
      saysSignedBy: returned.saysSignedBy,
      saysSignedOn: returned.saysSignedOn,
      cameBackBy: returned.cameBackBy,
      cameBackAt: returned.cameBackAt,
      sentHash: returned.sentHash,
      copyHash: returned.copyHash,
      says:
        `Agreed by ${AGREED_BY_SAYS[returned.cameBackBy]} from ${returned.saysSignedBy}, ` +
        'not by a signature taken on the phone.',
      weakness:
        `This was agreed by ${AGREED_BY_SAYS[returned.cameBackBy]}, not by a signature ` +
        `taken on the phone. ${returned.saysSignedBy} says they signed it on ` +
        `${returned.saysSignedOn}, and it came back on ${returned.cameBackAt.slice(0, 10)}. ` +
        'Nobody watched them sign, this app has not checked anybody\u2019s identity, and the ' +
        'date they signed is their word for it. What it does bind: the proposal that went ' +
        'out and the copy that came back are both fingerprinted, so neither can be swapped ' +
        'for another.',
    },
  };
}

export type ChangeKind = 'added' | 'removed' | 'more' | 'less' | 'repriced';

export interface Change {
  readonly item: string;
  readonly unit: PricedLine['unit'];
  readonly kind: ChangeKind;
  /** What the signed sheet said. Empty for work that was not on it. */
  readonly wasQuantity: string;
  readonly wasTotal: Cents;
  /** What it says now. Empty for work that has come off. */
  readonly nowQuantity: string;
  readonly nowTotal: Cents;
  /** What this one costs, positive or negative. */
  readonly difference: Cents;
  /** Said in a sentence, for the sheet the client reads. */
  readonly says: string;
}

export interface ChangeOrder {
  readonly changes: readonly Change[];
  readonly difference: Cents;
  readonly wasTotal: Cents;
  readonly nowTotal: Cents;
  /** True when nothing has moved since it was signed. */
  readonly unchanged: boolean;
  /**
   * True when the proposal itself no longer matches what was signed.
   *
   * Different from having changes: a change order is a normal, healthy thing
   * and this is not. It means somebody edited the agreed document rather than
   * raising a change against it, and the signed version is the one that counts.
   */
  readonly tampered: boolean;
  readonly tamperNote: string;
}

const key = (line: { item: string; unit: string }) => `${line.item} ${line.unit}`;

/**
 * What has changed since it was signed, priced.
 *
 * Matched by item and unit, which is what a change order is about: the same
 * work, more or less of it, or work that was not there. Two lines for the same
 * item in different units are two different things and are not netted off --
 * sixty feet of base is not five square feet of anything.
 */
export function changesSince(baseline: Baseline, now: Quote): ChangeOrder {
  const before = new Map(baseline.agreed.lines.map((l) => [key(l), l]));
  const after = new Map(now.lines.map((l) => [key(l), l]));
  const changes: Change[] = [];

  for (const [k, was] of before) {
    const is = after.get(k);
    if (!is) {
      changes.push({
        item: was.item,
        unit: was.unit,
        kind: 'removed',
        wasQuantity: was.quantity,
        wasTotal: was.total,
        nowQuantity: '',
        nowTotal: 0n,
        difference: -was.total,
        says: `${was.item} comes off \u2014 ${was.quantity} ${was.unit} at ${money(was.cents)}.`,
      });
      continue;
    }
    if (is.quantity === was.quantity && is.cents === was.cents) continue;

    const kind: ChangeKind =
      is.cents !== was.cents && is.quantity === was.quantity
        ? 'repriced'
        : Number(is.quantity) > Number(was.quantity)
          ? 'more'
          : 'less';
    changes.push({
      item: was.item,
      unit: was.unit,
      kind,
      wasQuantity: was.quantity,
      wasTotal: was.total,
      nowQuantity: is.quantity,
      nowTotal: is.total,
      difference: is.total - was.total,
      says:
        kind === 'repriced'
          ? `${was.item} was ${money(was.cents)} per ${was.unit}, now ${money(is.cents)}.`
          : `${was.item} was ${was.quantity} ${was.unit}, now ${is.quantity}.`,
    });
  }

  for (const [k, is] of after) {
    if (before.has(k)) continue;
    changes.push({
      item: is.item,
      unit: is.unit,
      kind: 'added',
      wasQuantity: '',
      wasTotal: 0n,
      nowQuantity: is.quantity,
      nowTotal: is.total,
      difference: is.total,
      says: `${is.item} was not in the signed scope \u2014 ${is.quantity} ${is.unit} at ${money(is.cents)}.`,
    });
  }

  // Ordered by what it costs, largest first: a change order is read by somebody
  // deciding whether to agree to it, and the biggest number is the decision.
  changes.sort((a, b) => {
    const size = (c: Change) => (c.difference < 0n ? -c.difference : c.difference);
    return size(b) > size(a) ? 1 : size(b) < size(a) ? -1 : 0;
  });

  const difference = changes.reduce((sum, c) => sum + c.difference, 0n);
  return {
    changes,
    difference,
    wasTotal: baseline.agreed.total,
    nowTotal: baseline.agreed.total + difference,
    unchanged: changes.length === 0,
    tampered: false,
    tamperNote: '',
  };
}

/**
 * The same, with the seal checked first.
 *
 * Separate from `changesSince` because checking a hash is asynchronous and
 * every screen that lists changes should not have to be. Anything that shows a
 * client a number uses this one.
 */
export async function changesSinceVerified(
  baseline: Baseline,
  proposal: Proposal,
  now: Quote
): Promise<ChangeOrder> {
  const order = changesSince(baseline, now);
  const client = baseline.signatures.find((s) => s.role === 'client');
  if (client) {
    const seal = await verify(proposal, client);
    if (seal.ok) return order;
    return { ...order, tampered: true, tamperNote: seal.why };
  }
  // A baseline frozen on a returned copy has no signature to check, and the
  // first version of this returned early on exactly that -- so a proposal
  // edited after the signed photograph came back would have raised no alarm at
  // all, and `invoiceOf` would have billed against it. The returned copy binds
  // through the fingerprint of the document as it was sent, and that is what is
  // checked here.
  const agreedBy = baseline.agreedBy;
  if (!agreedBy) return order;
  const hash = await hashOf(proposal);
  if (hash === agreedBy.sentHash) return order;
  return {
    ...order,
    tampered: true,
    tamperNote: notTheSignedVersion('proposal', agreedBy.saysSignedBy, agreedBy.saysSignedOn),
  };
}

/**
 * A change order said out loud.
 *
 * Reads as a decision rather than a diff, because that is what it is for.
 */
export function describeChanges(order: ChangeOrder): string {
  if (order.unchanged) {
    return 'Nothing has changed since this was signed.';
  }
  const count = order.changes.length;
  const direction = order.difference > 0n ? 'more' : order.difference < 0n ? 'less' : 'no change';
  const amount = order.difference < 0n ? -order.difference : order.difference;
  return (
    `${count} change${count === 1 ? '' : 's'} since signing \u2014 ` +
    (order.difference === 0n
      ? 'and they cancel out exactly, which is worth a second look.'
      : `${money(amount)} ${direction}. Signed at ${money(order.wasTotal)}, now ` +
        `${money(order.nowTotal)}.`)
  );
}
