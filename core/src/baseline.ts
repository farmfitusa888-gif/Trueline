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

/* ===================================================================== */
/*  Undoing an agreement, without erasing one                            */
/* ===================================================================== */

/**
 * An agreement withdrawn, with the reason on the record.
 *
 * ## The question, and Sam's answer
 *
 * > Once a job is agreed, should there be a way out?
 * > — **"Withdraw it, with a reason, kept on the record."**
 *
 * Until now there was no way out at all. `state.ts` said so in a comment: a
 * baseline is written once and never edited, so there is no action that changes
 * one. `Tear it up and start again` on the Work screen discards an *unsigned
 * change order*, not the agreement. So a contractor who froze the job on the
 * wrong photograph, or whose client walked away on the Monday, was stuck with
 * an agreement he could not edit and could not leave.
 *
 * ## Why this is a record beside the baseline and not a field on it
 *
 * A `Withdrawal` does not touch the `Baseline` it withdraws. It carries the
 * fingerprint of it, the moment it was frozen and what it agreed, and it is
 * stored **beside** the whole untouched baseline in a `Withdrawn` record.
 *
 * Three reasons, and the third is the one that decides it:
 *
 * 1. **Nothing is erased.** What was agreed, who agreed it, when, and the mark
 *    they made are all still there, byte for byte, with the reason beside them.
 * 2. **Every baseline already saved on somebody's phone reads back exactly as
 *    it was written.** No new key appears on the old path, so the canonical
 *    text of every agreement in the product is unchanged and every fingerprint
 *    still checks out. A field on `Baseline` — even an absent one — would have
 *    put a decision about withdrawals inside the record of every job that has
 *    never had one.
 * 3. **A withdrawn agreement must stop being an agreement, not become a
 *    weaker one.** A flag on the baseline invites code that reads the baseline
 *    and forgets the flag: `invoiceOf` would happily bill it, `raiseChange`
 *    would happily amend it. Beside it, the withdrawal has to be handed to the
 *    functions that matter, and those functions refuse — see
 *    `changesSinceVerified` below and `invoiceOf` in `invoice.ts`.
 *
 * ## What a withdrawal is not
 *
 * It is not a deletion and the word is never used for one. It is not the
 * buyer's federal three-day right to **cancel** either — that is
 * `core/src/cooling.ts`, it belongs to the buyer, it runs on a clock, and it
 * has forms. This belongs to the contractor, has no deadline, and is a line on
 * the record. The two words must never be swapped, on a screen or in a file.
 */
export interface Withdrawal {
  readonly proposalId: string;
  /**
   * The fingerprint of the agreement being withdrawn.
   *
   * So a withdrawal cannot drift onto a different agreement — including the
   * next one, if the job is agreed again after this.
   */
  readonly baselineHash: string;
  /**
   * The moment that agreement was frozen.
   *
   * Carried as well as the hash, and it has to be. A job withdrawn and then
   * agreed again **without a word of the proposal changing** produces a second
   * baseline with exactly the same fingerprint as the first, and the hash alone
   * would read the fresh agreement as the withdrawn one. `frozenAt` is the only
   * thing that tells those two apart.
   */
  readonly frozenAt: string;
  /** What was agreed, in money, so the record can be read without the baseline. */
  readonly wasTotal: Cents;
  /** Why, in the contractor's own words. Never blank, never a label. */
  readonly reason: string;
  /** When it was withdrawn. The app's own clock. */
  readonly at: string;
  /**
   * The one line every screen, document and list prints.
   *
   * Written once, here, rather than composed by each screen — the same rule
   * `AgreedByReturnedCopy.says` follows, for the same reason: what a record
   * says about itself must not depend on which screen is showing it.
   */
  readonly says: string;
}

/**
 * A withdrawn agreement, kept whole, with the withdrawal beside it.
 *
 * The pair is the record. Holding only the `Withdrawal` would leave the reason
 * on file and the agreement it withdrew gone from the job — which is the
 * deletion this whole design exists to avoid.
 */
export interface Withdrawn {
  readonly baseline: Baseline;
  readonly withdrawal: Withdrawal;
}

/**
 * The shortest thing this will accept as a reason, in characters.
 *
 * A floor, and honestly a floor rather than a judge: no check can tell whether
 * a sentence is true. What it can do is refuse a label. "no", "n/a", "mistake",
 * "wrong" and "test" are labels — they are what gets typed when somebody wants
 * the box to go away, and they are worth nothing to the person reading this
 * record in two years, who is usually the same person.
 *
 * Fifteen is about the shortest real sentence: "Wrong photograph" is 16,
 * "Client pulled out" is 17, "She changed her mind" is 20. Paired with the
 * two-word rule below, because "aaaaaaaaaaaaaaaaaa" is long and is still a
 * label.
 */
const REASON_FLOOR = 15;

/** Whether this withdrawal is the one that withdrew this baseline. */
function withdrew(withdrawal: Withdrawal, baseline: Baseline): boolean {
  return (
    withdrawal.proposalId === baseline.proposalId &&
    withdrawal.baselineHash === baseline.hash &&
    withdrawal.frozenAt === baseline.frozenAt
  );
}

/**
 * The withdrawal of this agreement, out of everything on the job, or `null`.
 *
 * Asked rather than assumed by every function that must refuse a withdrawn
 * agreement, and exported because the screens ask it too. It hands back the
 * whole record rather than a yes or no, because everything that refuses on the
 * strength of it has to say *when* and *why* in the same breath — a refusal
 * that cannot name the reason sends somebody looking for it.
 */
export function withdrawalOf(
  baseline: Baseline,
  withdrawn: readonly Withdrawn[]
): Withdrawn | null {
  return withdrawn.find((one) => withdrew(one.withdrawal, baseline)) ?? null;
}

/**
 * Withdraws an agreement, or refuses and says why.
 *
 * Returns the withdrawal. It does **not** return a changed baseline, because
 * there is no such thing: the baseline handed in comes back out of this
 * function untouched, and the caller keeps the two together in a `Withdrawn`.
 *
 * ## The four refusals
 *
 * **No reason.** Sam's answer was "withdraw it, *with a reason*", and the
 * reason is the whole of what makes this a record rather than a deletion.
 *
 * **A reason too thin to mean anything.** See `REASON_FLOOR`.
 *
 * **Already withdrawn.** Withdrawing twice would put two reasons and two dates
 * against one agreement, and the second one is always the one somebody typed to
 * get past a screen. The refusal names the reason already on the record, so the
 * answer to "why won't it let me" is on the screen.
 *
 * **A time it cannot keep** — either not a time at all, or before the agreement
 * it withdraws was frozen. A withdrawal dated before the agreement is a record
 * that reads as though the job was called off before it was won, and a record
 * that cannot be true is worse than no record.
 */
export function withdraw(
  baseline: Baseline,
  reason: string,
  at: string,
  already: readonly Withdrawn[] = []
): Withdrawal {
  const said = reason.trim();
  if (!said) {
    throw new BaselineError(
      'Say why this agreement is being withdrawn. Withdrawing it is not deleting it — ' +
        'the agreement stays on this job for ever, and the reason is what makes it a record ' +
        'rather than a hole.'
    );
  }
  if (said.length < REASON_FLOOR || said.split(/\s+/).length < 2) {
    throw new BaselineError(
      `"${said}" is a label, not a reason. Say what happened, in a sentence — they ` +
        'pulled out, it was frozen on the wrong photograph, the price was wrong. It is one ' +
        'line now and the whole argument later.'
    );
  }
  const before = withdrawalOf(baseline, already);
  if (before) {
    throw new BaselineError(
      `This agreement was already withdrawn on ${before.withdrawal.at.slice(0, 10)}: ` +
        `${before.withdrawal.reason} It cannot be withdrawn twice, and nothing about it has ` +
        'changed since.'
    );
  }
  if (Number.isNaN(Date.parse(at))) {
    throw new BaselineError(`"${at}" is not a time this can record.`);
  }
  if (Date.parse(at) < Date.parse(baseline.frozenAt)) {
    throw new BaselineError(
      `This says the agreement was withdrawn on ${at.slice(0, 10)}, which is before it was ` +
        `agreed on ${baseline.frozenAt.slice(0, 10)}. Nobody withdrew an agreement that did ` +
        'not exist yet, so one of those two is wrong.'
    );
  }
  return {
    proposalId: baseline.proposalId,
    baselineHash: baseline.hash,
    frozenAt: baseline.frozenAt,
    wasTotal: baseline.agreed.total,
    reason: said,
    at,
    says:
      `Agreed ${baseline.frozenAt.slice(0, 10)} at ${money(baseline.agreed.total)}, ` +
      `withdrawn ${at.slice(0, 10)}. Why: ${said}`,
  };
}

/**
 * A withdrawn agreement said out loud, for the screen and for the document.
 *
 * The last line is the one that matters and it is not decoration: a contractor
 * looking at this is looking for the thing he thinks he has destroyed, and a
 * client reading it is entitled to see that the agreement he signed is still
 * there.
 */
export function describeWithdrawal(one: Withdrawn): string[] {
  const { baseline, withdrawal } = one;
  return [
    `Withdrawn on ${withdrawal.at.slice(0, 10)}.`,
    `Why: ${withdrawal.reason}`,
    `It was agreed on ${baseline.frozenAt.slice(0, 10)} at ${money(withdrawal.wasTotal)}` +
      (baseline.agreedBy
        ? `, by ${AGREED_BY_SAYS[baseline.agreedBy.cameBackBy]} from ` +
          `${baseline.agreedBy.saysSignedBy}.`
        : baseline.signatures.length > 0
          ? `, signed by ${baseline.signatures.map((s) => s.who).join(' and ')}.`
          : '.'),
    'Nothing has been erased. What was agreed, who agreed it and when are all still on this ' +
      'job, with the reason beside them.',
  ];
}

/**
 * The job agreed again after a withdrawal, and what it costs.
 *
 * ## The hole this closes
 *
 * A withdrawal that could not be followed by a second agreement would be no use
 * to anybody: the ordinary reason to withdraw is that the job is being agreed
 * differently. So a withdrawn job **can** be agreed again, and the second
 * agreement is a whole agreement — a new signature on the phone, or a new
 * signed copy filed against a newly sent proposal — never an amendment to the
 * withdrawn one.
 *
 * That is what stops a second agreement laundering a price rise past the
 * change-order machinery. There is no door to a `Baseline` that does not go
 * through `freeze()` or `freezeOnReturnedCopy()`; `freeze()` refuses anything
 * without a client `Signature` sealed to the document, and
 * `freezeOnReturnedCopy()` refuses unless the proposal still hashes to the
 * version the signed copy was taken from. So the client signs for the **whole**
 * of the new total, not for a difference nobody itemised.
 *
 * What the change-order machinery would have added, and what this adds instead,
 * is that the difference is **visible**. A contractor who withdraws at $10,000
 * and re-agrees at $12,000 has a record that says so, in money, beside the
 * reason he gave for withdrawing. That is the line an adjuster, a homeowner or
 * a court reads, and it is on the screen and on the document rather than only
 * in a diff nobody runs.
 */
export interface ReAgreement {
  readonly wasTotal: Cents;
  readonly nowTotal: Cents;
  /** Positive when the second agreement is dearer. */
  readonly difference: Cents;
  readonly says: string;
}

/**
 * The withdrawn agreement and the one that replaced it, priced against each
 * other.
 *
 * Refuses a pair that is not a pair: a baseline frozen before the withdrawal
 * did not replace it, and saying it did would put two unrelated agreements on
 * one line with a difference between them that means nothing.
 */
export function reAgreement(one: Withdrawn, next: Baseline): ReAgreement {
  if (Date.parse(next.frozenAt) < Date.parse(one.withdrawal.at)) {
    throw new BaselineError(
      `That agreement was frozen on ${next.frozenAt.slice(0, 10)}, before the withdrawal on ` +
        `${one.withdrawal.at.slice(0, 10)}, so it did not replace it.`
    );
  }
  const wasTotal = one.withdrawal.wasTotal;
  const nowTotal = next.agreed.total;
  const difference = nowTotal - wasTotal;
  const size = difference < 0n ? -difference : difference;
  return {
    wasTotal,
    nowTotal,
    difference,
    says:
      `Agreed at ${money(wasTotal)} on ${one.baseline.frozenAt.slice(0, 10)}, withdrawn on ` +
      `${one.withdrawal.at.slice(0, 10)}, agreed again at ${money(nowTotal)} on ` +
      `${next.frozenAt.slice(0, 10)} — ` +
      (difference === 0n
        ? 'the same money.'
        : `${money(size)} ${difference > 0n ? 'more' : 'less'}.`) +
      ' The difference did not go through a change order: the whole of the new agreement was ' +
      'agreed on its own, and this is what was withdrawn to get there.',
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
 *
 * ## What a withdrawn agreement means here
 *
 * It means there is no question to answer, and this refuses to answer one.
 *
 * A change order is the difference between what was agreed and what the room
 * costs now, and it is priced, raised and signed against the agreement it
 * amends. Withdraw that agreement and there is nothing on the other side of the
 * subtraction. Answering anyway would produce two bad outcomes and both of them
 * are the failures this module exists to prevent:
 *
 * **A priced change order against nothing.** `raiseChange` would take it,
 * `agreeToChange` would seal it to a baseline hash nobody is bound by, and
 * `invoiceOf` would bill it. The whole defence — every later difference
 * surfaces as a change order somebody signs — runs on the agreement being real.
 *
 * **A tamper alarm that is noise.** The point of a withdrawal is that the
 * proposal becomes editable again, so the first thing that happens after one is
 * exactly the edit that makes `verify` fail. The screen would raise "this is
 * not the document they signed" over a document nobody is holding them to, and
 * an alarm that cries wolf on the ordinary case is an alarm that gets ignored
 * on the day it is right.
 *
 * So the answer is a refusal, in core, rather than a convention the screens are
 * trusted to keep. The screens do keep it — the live `baseline` goes to `null`
 * the moment one is withdrawn, so neither of them can reach this — and this is
 * the check that would catch it if one of them stopped keeping it.
 */
export async function changesSinceVerified(
  baseline: Baseline,
  proposal: Proposal,
  now: Quote,
  withdrawn: readonly Withdrawn[] = []
): Promise<ChangeOrder> {
  const gone = withdrawalOf(baseline, withdrawn);
  if (gone) {
    throw new BaselineError(
      `That agreement was withdrawn on ${gone.withdrawal.at.slice(0, 10)}, so nothing is ` +
        'measured against it any more and no change order can be raised on it. ' +
        `Why it was withdrawn: ${gone.withdrawal.reason} It stays on this job, with the ` +
        'reason beside it. Agree the work again and changes are measured against that.'
    );
  }
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
