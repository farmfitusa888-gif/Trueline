import { type Company } from './company.ts';
import { type Cents, type PricedLine, type Quote, money } from './price.ts';
import { RoomError } from './room.ts';

/**
 * The document a homeowner says yes to.
 *
 * Everything up to here answers "how much is this?". A proposal answers "will
 * you do it?", which is a different document with a different job: it names the
 * work in sentences a person can read, it names a price, it says what is not
 * included, and it has somewhere to sign.
 *
 * It is built **from the quote**, never typed alongside it. A proposal whose
 * numbers were re-entered by hand is a proposal that can disagree with the
 * takeoff, and the disagreement is discovered by the client.
 *
 * ## Options, and why there are three of them
 *
 * The trade is unanimous that a proposal offering a choice outsells one naming a
 * single number, and the reason is not psychology — it is that a homeowner with
 * one number decides *whether*, and a homeowner with three decides *which*.
 *
 * The options here are not markups of each other and this module will not
 * invent them. Each one is a real priced sheet the contractor put together, and
 * the only thing this adds is that they travel on one page.
 */

export class ProposalError extends RoomError {}

export interface ProposalOption {
  readonly id: string;
  /** What the contractor calls it. Not forced to be "good/better/best". */
  readonly name: string;
  /** One sentence on what makes this one different. */
  readonly note: string;
  readonly lines: readonly PricedLine[];
  readonly total: Cents;
  /** True only when every quantity behind this option has had a tape on it. */
  readonly measured: boolean;
}

export interface Party {
  readonly name: string;
  readonly address: string;
  readonly email: string;
  readonly phone: string;
}

export const NOBODY: Party = { name: '', address: '', email: '', phone: '' };

export interface Proposal {
  readonly id: string;
  readonly roomName: string;
  readonly company: Company;
  readonly client: Party;
  readonly options: readonly ProposalOption[];
  /** Which option the client took. Set when it is signed, never before. */
  readonly chosen?: string;
  /**
   * What is not included, and what happens if the job changes.
   *
   * Free text lines rather than a fixed contract: what a contractor may promise
   * is set by his state, his licence and his insurer, and a template that
   * invented terms would be inventing a legal position for somebody else.
   */
  readonly terms: readonly string[];
  readonly issuedAt: string;
  /** After this, the prices are not held. Empty when the contractor sets none. */
  readonly validUntil: string;
}

/** The terms every proposal starts with, which the contractor then edits. */
export const STARTING_TERMS: readonly string[] = [
  'Prices hold until the date above.',
  'Anything not written here is not included.',
  'Work that changes the scope is quoted as a change order and signed before it starts.',
  'Quantities marked scanned have not had a tape on them and may move.',
];

/**
 * Turns a priced sheet into one option on a proposal.
 *
 * The quote's own totals are carried, not recomputed: two places that add the
 * same column up are two places that can disagree, and the one the client is
 * looking at should be the one that was checked.
 */
export function optionFrom(
  id: string,
  name: string,
  note: string,
  from: Quote
): ProposalOption {
  if (!name.trim()) throw new ProposalError('An option needs a name the client will read.');
  if (from.unpriced.length > 0) {
    throw new ProposalError(
      `${from.unpriced.length === 1 ? 'One line has' : `${from.unpriced.length} lines have`} ` +
        `no rate against ${from.unpriced.length === 1 ? 'it' : 'them'}: ` +
        `${from.unpriced.join(', ')}. A proposal that quietly leaves work out is how a job ` +
        'is won at a loss. Set the rate, or take the line off the sheet.'
    );
  }
  return {
    id,
    name: name.trim(),
    note: note.trim(),
    lines: from.lines,
    total: from.total,
    measured: from.measured,
  };
}

export function proposalOf(
  id: string,
  roomName: string,
  company: Company,
  client: Party,
  options: readonly ProposalOption[],
  at: string,
  validUntil = '',
  terms: readonly string[] = STARTING_TERMS
): Proposal {
  if (options.length === 0) {
    throw new ProposalError('A proposal with nothing in it is not a proposal.');
  }
  const seen = new Set<string>();
  for (const option of options) {
    if (seen.has(option.id)) throw new ProposalError(`Two options share the id "${option.id}".`);
    seen.add(option.id);
  }
  return { id, roomName, company, client, options, terms, issuedAt: at, validUntil };
}

/**
 * What is missing before this is worth putting in front of somebody.
 *
 * Named and never enforced, exactly as the claim document does it: a contractor
 * standing in a kitchen who cannot send a proposal because a field is blank
 * will write the proposal somewhere else, and the app will have achieved
 * nothing except being closed.
 */
export function missingFromProposal(proposal: Proposal): string[] {
  const missing: string[] = [];
  if (!proposal.company.name.trim()) missing.push('your business name');
  if (!proposal.client.name.trim()) missing.push('who it is for');
  if (!proposal.client.address.trim()) missing.push('the address of the work');
  if (!proposal.validUntil.trim()) missing.push('how long the price holds');
  if (proposal.terms.length === 0) missing.push('what is not included');
  return missing;
}

/** The option somebody took, or nothing when it has not been signed. */
export function chosenOption(proposal: Proposal): ProposalOption | undefined {
  return proposal.options.find((option) => option.id === proposal.chosen);
}

/**
 * The proposal said out loud, for the top of the document.
 *
 * Says whether the numbers are measured in the same breath as the price,
 * because a client reading a total is exactly the person entitled to know it
 * came off a scan nobody has checked.
 */
export function describeProposal(proposal: Proposal): string {
  const taken = chosenOption(proposal);
  const range = proposal.options.map((o) => o.total);
  const low = range.reduce((a, b) => (b < a ? b : a));
  const high = range.reduce((a, b) => (b > a ? b : a));
  const price = taken
    ? money(taken.total)
    : low === high
      ? money(low)
      : `${money(low)} to ${money(high)}`;
  const everyMeasured = (taken ? [taken] : proposal.options).every((o) => o.measured);
  return (
    `${proposal.roomName} — ${price}. ` +
    (everyMeasured
      ? 'Every quantity behind this has had a tape on it.'
      : 'Some quantities here came off the scan and have not had a tape on them.')
  );
}
