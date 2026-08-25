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

export interface Baseline {
  readonly proposalId: string;
  /** The option that was taken, exactly as it was priced then. */
  readonly agreed: ProposalOption;
  /** Who signed it, and the evidence that they did. */
  readonly signatures: readonly Signature[];
  readonly frozenAt: string;
  /** The fingerprint of the proposal at the moment it was agreed. */
  readonly hash: string;
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
  if (!client) return order;
  const seal = await verify(proposal, client);
  if (seal.ok) return order;
  return { ...order, tampered: true, tamperNote: seal.why };
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
