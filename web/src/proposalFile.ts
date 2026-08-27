import { type Baseline } from '../../core/src/baseline.ts';
import { type Company, letterhead } from '../../core/src/company.ts';
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
 * this is a document that leaves the building.
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

export function proposalFile({ proposal, company, baseline, at }: ProposalFileParts): string {
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
  </section>`;

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
  footer { margin-top: 30px; font-size: .75rem; color: #56606A; }
  @media print { body { padding: 0; } .opt { break-inside: avoid; } }
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

${signed}

<footer>
  ${safe(proposal.roomName)} · measured and priced in Trueline · this document contains
  everything it needs and works with no internet connection.
</footer>
</html>`;
}
