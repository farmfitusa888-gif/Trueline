import { type Baseline } from '../../core/src/baseline.ts';
import { type Company, letterhead } from '../../core/src/company.ts';
import { type CancellationNotice, WHAT_THIS_DOES_NOT_KNOW } from '../../core/src/cooling.ts';
import {
  type ReturnedDocument,
  CAME_BACK_SAYS,
  describeReturned,
} from '../../core/src/countersign.ts';
import { money } from '../../core/src/price.ts';
import { type Proposal, chosenOption } from '../../core/src/proposal.ts';

/**
 * The proposal, as one file a homeowner can open, keep, print and sign off.
 *
 * ## Why this had to exist
 *
 * The app could write a proposal, price it, take a signature on the phone and
 * freeze the agreed scope — and there was **no way to send it to anybody**.
 * Asked directly, "how do you send the proposal?", the honest answer was that
 * you could not. `Sheet.tsx` sends a client file: the drawing, the room and
 * what it takes. That is not a proposal. A proposal is what somebody says yes
 * to, and a proposal that cannot leave the phone is a proposal nobody signs.
 *
 * ## What is in it, and what is deliberately not
 *
 * Every option, in full, with its lines and its total — because a client
 * choosing between two prices needs both in front of them. What is not
 * included, in the contractor's own words. And when it has been signed: who
 * signed, when, on what, the exact sentence they agreed to, their drawn mark,
 * and the fingerprint of the document at that moment. That last one is the
 * whole of the tamper evidence and it travels with the file.
 *
 * Nothing is fetched, there are no scripts, and every value a person typed is
 * escaped on the way in — same rules as `clientFile.ts`, for the same reason:
 * this is a document that leaves the building. That rule now covers a legal
 * notice as well, which is a second reason it cannot be relaxed: a cancellation
 * form that needs a stylesheet from somewhere is a cancellation form that is
 * blank on the day it matters.
 *
 * ## Two more things it carries
 *
 * **Somewhere to sign by hand.** There are two ways to get a proposal agreed —
 * on the phone, or send it and get it back signed — and until this document had
 * a signature line the second one had nowhere to happen.
 *
 * **The federal three-day cancellation notice**, when the sale is one the FTC's
 * Cooling-Off Rule covers. Not decoration: 16 CFR 429.1 makes the notice, the
 * two completed cancellation forms and the bold sentence beside the buyer's
 * signature the seller's own obligations, and a proposal signed in a kitchen
 * for more than $25 is squarely inside the rule. What triggers it, what it
 * says, and how the deadline is counted all live in `core/src/cooling.ts` with
 * the regulation quoted; this file only lays it out.
 */

/** Anything a person typed, safe to put in HTML. */
function safe(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface ProposalFileParts {
  readonly proposal: Proposal;
  readonly company: Company;
  /** The signed record, when there is one. A draft has none. */
  readonly baseline: Baseline | null;
  readonly at: string;
  /**
   * The federal three-day cancellation notice, when the sale is one the FTC's
   * Cooling-Off Rule covers.
   *
   * `null` when it is not — signed at the contractor's own place of business,
   * or under the rule's dollar threshold — and the document then says nothing
   * about cancelling. Silence is right there and a line saying "you have no
   * right to cancel" would be wrong, because a state's own home-solicitation
   * law may give one and this app has not checked any state's law.
   *
   * Worked out in `core/src/cooling.ts`, never typed here. See that file for
   * what 16 CFR 429.1 actually requires, quoted.
   */
  readonly cooling: CancellationNotice | null;
  /**
   * Signed copies that came back — a photograph, a PDF, a scan of paper.
   *
   * On the document rather than only on the phone, because the record is worth
   * keeping only if it can be produced. What it does and does not establish
   * travels with it; see `core/src/countersign.ts`.
   */
  readonly returned: readonly ReturnedDocument[];
}

/**
 * Somewhere to sign by hand, for the client who prints it.
 *
 * The change order has had one of these since it was built and the proposal
 * never did, which meant the second of the two ways to get a proposal agreed —
 * send it, get it back signed — had nowhere on the page to actually sign. A
 * document sent out to be signed with no signature line on it is a document
 * that comes back as a question.
 */
const BY_HAND = `
  <div class="byhand">
    <p class="line">Signature</p>
    <p class="line">Printed name</p>
    <p class="line">Date</p>
  </div>`;

/**
 * One copy of the § 429.1(b) form.
 *
 * Two of these go on every proposal the rule covers, because the rule says "in
 * duplicate": the buyer sends one back to cancel and keeps the other, and a
 * buyer who has posted his only copy has kept no evidence that he cancelled.
 */
function cancellationForm(notice: CancellationNotice, which: string): string {
  return `
  <section class="notice">
    <p class="which">${safe(which)}</p>
    <h2 class="cap">NOTICE OF CANCELLATION</h2>
    ${notice.form.map((line) => `<p class="ten">${safe(line)}</p>`).join('')}
    <div class="byhand">
      <p class="line">Date</p>
      <p class="line">Buyer’s signature</p>
    </div>
  </section>`;
}

function optionBlock(
  option: Proposal['options'][number],
  taken: boolean
): string {
  const lines = option.lines
    .map(
      (line) => `
        <tr>
          <td>${safe(line.item)}</td>
          <td class="n">${safe(line.quantity)} ${safe(line.unit)}</td>
          <td class="n">${safe(money(line.cents))}</td>
          <td class="n b">${safe(money(line.total))}</td>
        </tr>`
    )
    .join('');
  return `
  <section class="opt${taken ? ' taken' : ''}">
    <header>
      <h2>${safe(option.name)}${taken ? ' <span class="chip">Agreed</span>' : ''}</h2>
      <p class="total">${safe(money(option.total))}</p>
    </header>
    ${option.note ? `<p class="note">${safe(option.note)}</p>` : ''}
    <table>
      <thead><tr><th>Work</th><th class="n">Quantity</th><th class="n">Rate</th><th class="n">Amount</th></tr></thead>
      <tbody>${lines}</tbody>
    </table>
    ${
      option.measured
        ? '<p class="prov good">Every quantity here has had a tape on it.</p>'
        : '<p class="prov warn">Some quantities here came off the scan and have not had a tape '
          + 'on them. They may move.</p>'
    }
  </section>`;
}

export function proposalFile({
  proposal,
  company,
  baseline,
  at,
  cooling,
  returned,
}: ProposalFileParts): string {
  const head = letterhead(company);
  const taken = chosenOption(proposal);
  const terms = proposal.terms
    .filter((line) => line.trim() !== '')
    .map((line) => `<li>${safe(line)}</li>`)
    .join('');

  const signed = baseline
    ? `
  <section class="signed">
    <h2>Signed</h2>
    ${baseline.signatures
      .map(
        (s) => `
      <div class="sig">
        <img alt="Signature of ${safe(s.who)}" src="${safe(s.mark)}">
        <p class="who">${safe(s.who)} — ${safe(s.role === 'client' ? 'client' : 'contractor')}</p>
        <p class="fine">${safe(s.at)} · ${safe(s.device)}</p>
        <p class="fine">Agreed: “${safe(s.intent)}”</p>
        ${s.consented ? '<p class="fine">Agreed separately to sign electronically.</p>' : ''}
      </div>`
      )
      .join('')}
    <p class="fine">
      Fingerprint of this document when it was signed: <code>${safe(baseline.hash)}</code>.
      Anything changed after that produces a different one.
    </p>
  </section>`
    : `
  <section class="unsigned">
    <h2>Not signed yet</h2>
    <p>This is a proposal, not an agreement. Nothing here is owed until somebody signs it.</p>
    <p>
      Two ways to agree to it: sign it on the phone together, or print this, sign below, and
      send it back. Either one counts, and both are kept on the job.
    </p>
    ${BY_HAND}
  </section>`;

  /**
   * The sentence § 429.1(a) requires, immediately above the space for the
   * buyer's signature and in bold face type of at least ten points.
   *
   * Its position on the page is part of the requirement — "in immediate
   * proximity to the space reserved in the contract for the signature of the
   * buyer" — so it is rendered here, attached to the signature area, rather
   * than filed with the rest of the small print at the foot where nobody would
   * read it and where it would not satisfy the rule.
   */
  const statement = cooling
    ? `
  <section class="stmt">
    <p class="ten">${safe(cooling.statement)}</p>
  </section>`
    : '';

  const notices = cooling
    ? `
  ${cancellationForm(cooling, 'Copy 1 of 2 — send this one back if you cancel')}
  ${cancellationForm(cooling, 'Copy 2 of 2 — keep this one')}
  <section class="caveat">
    <h2>About that three-day right</h2>
    <ul>${WHAT_THIS_DOES_NOT_KNOW.map((line) => `<li>${safe(line)}</li>`).join('')}</ul>
  </section>`
    : '';

  const back = returned.length
    ? `
  <section class="back">
    <h2>Signed copy${returned.length === 1 ? '' : 's'} on file</h2>
    ${returned
      .map(
        (one) => `
      <div class="one">
        <p class="who">${safe(one.saysSignedBy)} — ${safe(CAME_BACK_SAYS[one.cameBackBy])}</p>
        ${
          one.copyType.startsWith('image/')
            ? `<img alt="The signed copy that came back from ${safe(one.saysSignedBy)}" ` +
              `src="${safe(one.copy)}">`
            : '<p class="fine">The signed copy is a PDF and is kept on the job rather than ' +
              'printed here.</p>'
        }
        <ul>${describeReturned(one).map((line) => `<li>${safe(line)}</li>`).join('')}</ul>
      </div>`
      )
      .join('')}
  </section>`
    : '';

  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safe(proposal.roomName)} — proposal${company.name ? ' from ' + safe(company.name) : ''}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 28px 20px 64px; background: #fff; color: #16212B;
    font: 400 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    max-width: 46rem; margin-inline: auto;
  }
  h1 { font-size: 1.5rem; margin: 0 0 .2rem; }
  h2 { font-size: 1.1rem; margin: 0; }
  .head { border-bottom: 2px solid #16212B; padding-bottom: 12px; margin-bottom: 20px; }
  .head p { margin: .1rem 0; color: #56606A; font-size: .9rem; }
  .to { margin: 18px 0 24px; }
  .to dt { font-size: .78rem; letter-spacing: .06em; text-transform: uppercase; color: #56606A; }
  .to dd { margin: 0 0 .5rem; font-weight: 600; }
  .opt { border: 1px solid #D9CFBC; border-radius: 8px; padding: 16px; margin: 0 0 18px; }
  .opt.taken { border-color: #1F6B3A; border-width: 2px; }
  .opt header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .chip { background: #1F6B3A; color: #fff; font-size: .68rem; padding: .12rem .4rem; border-radius: 4px; vertical-align: .15em; }
  .total { font-size: 1.35rem; font-weight: 700; margin: 0; font-variant-numeric: tabular-nums; }
  .note { color: #56606A; margin: .4rem 0 .8rem; }
  table { border-collapse: collapse; width: 100%; font-size: .92rem; }
  th, td { text-align: left; padding: .35rem .4rem; border-bottom: 1px solid #EFE9DC; }
  th { font-size: .74rem; letter-spacing: .05em; text-transform: uppercase; color: #56606A; }
  .n { text-align: right; font-variant-numeric: tabular-nums; }
  .b { font-weight: 600; }
  .prov { font-size: .85rem; margin: .7rem 0 0; }
  .prov.good { color: #1F6B3A; }
  .prov.warn { color: #B8590A; }
  ul { padding-left: 1.1rem; }
  li { margin: .2rem 0; }
  .signed, .unsigned { border-top: 2px solid #16212B; margin-top: 26px; padding-top: 16px; }
  .sig { margin: 14px 0; }
  .sig img { display: block; max-width: 260px; height: auto; border-bottom: 1px solid #16212B; }
  .who { font-weight: 600; margin: .3rem 0 0; }
  .fine { font-size: .78rem; color: #56606A; margin: .15rem 0; }
  code { font-size: .72rem; word-break: break-all; }
  /* Ten points is the floor 16 CFR 429.1 sets for the statement and for the
     cancellation form, so this is set in points rather than pixels and set a
     point over the floor. A rem here would scale with a reader's own settings
     and could land under it. */
  .ten { font-size: 11pt; font-weight: 700; line-height: 1.5; margin: 0 0 .7rem; }
  .stmt { border: 2px solid #16212B; padding: 12px 14px; margin: 26px 0 0; }
  .stmt .ten { margin: 0; }
  .notice { border: 2px solid #16212B; padding: 16px; margin: 22px 0 0; }
  .notice .which { font-size: .74rem; letter-spacing: .06em; text-transform: uppercase;
                   color: #56606A; margin: 0 0 .6rem; }
  .cap { font-size: 1.05rem; letter-spacing: .04em; margin: 0 0 .9rem; }
  .caveat { border-top: 2px solid #16212B; margin-top: 26px; padding-top: 14px; }
  .caveat li { font-size: .85rem; color: #56606A; margin: .4rem 0; }
  .byhand { margin-top: 22px; }
  .byhand .line { border-bottom: 1px solid #16212B; margin: 0 0 26px; padding-bottom: 22px;
                  font-size: .74rem; letter-spacing: .05em; text-transform: uppercase;
                  color: #56606A; }
  .back { border-top: 2px solid #16212B; margin-top: 26px; padding-top: 16px; }
  .back .one { margin: 14px 0 22px; }
  .back img { display: block; max-width: 320px; height: auto; border: 1px solid #D9CFBC; }
  .back li { font-size: .8rem; color: #56606A; margin: .25rem 0; }
  footer { margin-top: 30px; font-size: .75rem; color: #56606A; }
  @media print {
    body { padding: 0; }
    .opt { break-inside: avoid; }
    /* Each cancellation form on its own sheet, because the rule wants them
       "easily detachable" and a form printed halfway down the back of the
       price schedule is not. */
    .notice { break-before: page; break-inside: avoid; }
  }
</style>
<div class="head">
  <h1>${safe(head[0] ?? 'Proposal')}</h1>
  ${head.slice(1).map((line) => `<p>${safe(line)}</p>`).join('')}
</div>

<dl class="to">
  <dt>For</dt><dd>${safe(proposal.client.name || '—')}</dd>
  <dt>Work at</dt><dd>${safe(proposal.client.address || proposal.roomName)}</dd>
  <dt>Issued</dt><dd>${safe(at)}</dd>
  ${proposal.validUntil ? `<dt>Prices hold until</dt><dd>${safe(proposal.validUntil)}</dd>` : ''}
</dl>

${proposal.options.map((o) => optionBlock(o, taken?.id === o.id)).join('')}

<section>
  <h2>What is not included</h2>
  <ul>${terms}</ul>
</section>

${statement}
${signed}
${back}
${notices}

<footer>
  ${safe(proposal.roomName)} · measured and priced in Trueline · this document contains
  everything it needs and works with no internet connection.
</footer>
</html>`;
}
