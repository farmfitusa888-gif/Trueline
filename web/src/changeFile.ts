import { type AgreedChange, type ChangeDocument } from '../../core/src/change.ts';
import { letterhead } from '../../core/src/company.ts';
import { money } from '../../core/src/price.ts';

/**
 * A change order, as one file a homeowner can open, keep, print and sign.
 *
 * The proposal has `proposalFile.ts`, and an amendment to a signed contract
 * needs exactly the same thing for exactly the same reason: a change order that
 * cannot leave the phone is a change order nobody signs, and an unsigned change
 * order is not billable. That is not this app being strict — it is the rule in
 * `core/src/change.ts`, and this file is how the contractor satisfies it when
 * the client is not standing next to him.
 *
 * Two ways to get it agreed, and the document says both: sign it on the phone
 * when they are there, or send this and get it back signed. When it comes back
 * agreed, the same file carries the marks, the sentences, the times and the
 * fingerprint.
 *
 * No scripts, nothing fetched, every typed value escaped. Same rules as the
 * proposal, for the same reason: this is a document that leaves the building.
 */

/** Anything a person typed, safe to put in HTML. */
function safe(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface ChangeFileParts {
  readonly document: ChangeDocument;
  /** The signed record, when there is one. A change on its way out has none. */
  readonly agreed: AgreedChange | null;
  readonly at: string;
}

const KIND_SAYS = {
  added: 'Added',
  removed: 'Comes off',
  more: 'More of it',
  less: 'Less of it',
  repriced: 'Priced again',
} as const;

export function changeFile({ document, agreed, at }: ChangeFileParts): string {
  const head = letterhead(document.company);
  const rows = document.changes
    .map(
      (change) => `
      <tr>
        <td>${safe(change.item)}</td>
        <td>${safe(KIND_SAYS[change.kind])}</td>
        <td class="n">${safe(change.wasQuantity || '—')}</td>
        <td class="n">${safe(change.nowQuantity || '—')}</td>
        <td class="n b ${change.difference < 0n ? 'down' : 'up'}">${
          change.difference < 0n ? '−' : '+'
        }${safe(money(change.difference < 0n ? -change.difference : change.difference))}</td>
      </tr>`
    )
    .join('') +
    // The job's mark-up, as its own row. The rows above are the work before
    // mark-up and `document.difference` below is the work after it, so without
    // this the client adds the column up and gets a smaller number than the one
    // he is being asked to sign. See `ChangeOrder.markup` in `core/src`.
    (document.markup === 0n
      ? ''
      : `
      <tr>
        <td>Mark-up</td>
        <td>The job mark-up on this change</td>
        <td class="n">—</td>
        <td class="n">—</td>
        <td class="n b ${document.markup < 0n ? 'down' : 'up'}">${
          document.markup < 0n ? '−' : '+'
        }${safe(money(document.markup < 0n ? -document.markup : document.markup))}</td>
      </tr>`);

  const size = document.difference < 0n ? -document.difference : document.difference;
  const signed = agreed
    ? `
  <section class="signed">
    <h2>Agreed</h2>
    ${agreed.signatures
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
      Raised ${safe(document.raisedAt.slice(0, 10))}, agreed ${safe(agreed.agreedAt.slice(0, 10))}.
    </p>
    <p class="fine">
      Fingerprint of this change order when it was signed:
      <code>${safe(agreed.hash)}</code>. Anything changed after that produces a different one.
    </p>
  </section>`
    : `
  <section class="unsigned">
    <h2>Not agreed yet</h2>
    <p>
      Nothing here is owed, and none of this work is authorised, until it is signed. Sign it on
      the phone together, or sign this and send it back — either one counts, and both are
      recorded the same way.
    </p>
    <div class="byhand">
      <p class="line">Signature</p>
      <p class="line">Printed name</p>
      <p class="line">Date</p>
    </div>
  </section>`;

  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Change order ${safe(document.number)} — ${safe(document.jobName)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 28px 20px 64px; background: #fff; color: #16212B;
    font: 400 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    max-width: 46rem; margin-inline: auto;
  }
  h1 { font-size: 1.5rem; margin: 0 0 .2rem; }
  h2 { font-size: 1.1rem; margin: 0 0 .6rem; }
  .head { border-bottom: 2px solid #16212B; padding-bottom: 12px; margin-bottom: 20px; }
  .head p { margin: .1rem 0; color: #56606A; font-size: .9rem; }
  .stamp { display: inline-block; border: 2px solid #B8590A; color: #B8590A; border-radius: 6px;
           padding: .1rem .5rem; font-size: .8rem; letter-spacing: .06em; text-transform: uppercase; }
  .to { margin: 18px 0 24px; }
  .to dt { font-size: .78rem; letter-spacing: .06em; text-transform: uppercase; color: #56606A; }
  .to dd { margin: 0 0 .5rem; font-weight: 600; }
  .why { border-left: 3px solid #B8590A; padding: .1rem 0 .1rem .8rem; margin: 0 0 20px; }
  table { border-collapse: collapse; width: 100%; font-size: .92rem; }
  th, td { text-align: left; padding: .35rem .4rem; border-bottom: 1px solid #EFE9DC; }
  th { font-size: .74rem; letter-spacing: .05em; text-transform: uppercase; color: #56606A; }
  .n { text-align: right; font-variant-numeric: tabular-nums; }
  .b { font-weight: 600; }
  .up { color: #B8590A; }
  .down { color: #1F6B3A; }
  .sums { margin: 20px 0 0; border-top: 2px solid #16212B; padding-top: 12px; }
  .sums div { display: flex; justify-content: space-between; gap: 12px; padding: .2rem 0; }
  .sums .big { font-size: 1.2rem; font-weight: 700; font-variant-numeric: tabular-nums; }
  .days { margin: 16px 0 0; font-weight: 600; }
  .signed, .unsigned { border-top: 2px solid #16212B; margin-top: 26px; padding-top: 16px; }
  .sig { margin: 14px 0; }
  .sig img { display: block; max-width: 260px; height: auto; border-bottom: 1px solid #16212B; }
  .who { font-weight: 600; margin: .3rem 0 0; }
  .fine { font-size: .78rem; color: #56606A; margin: .15rem 0; }
  .byhand { margin-top: 22px; }
  .byhand .line { border-bottom: 1px solid #16212B; margin: 0 0 26px; padding-bottom: 22px;
                  font-size: .74rem; letter-spacing: .05em; text-transform: uppercase; color: #56606A; }
  code { font-size: .72rem; word-break: break-all; }
  footer { margin-top: 30px; font-size: .75rem; color: #56606A; }
  @media print { body { padding: 0; } table { break-inside: avoid; } }
</style>
<div class="head">
  <h1>${safe(head[0] ?? 'Change order')}</h1>
  ${head.slice(1).map((line) => `<p>${safe(line)}</p>`).join('')}
</div>

<p><span class="stamp">Change order ${safe(document.number)}</span></p>

<dl class="to">
  <dt>For</dt><dd>${safe(document.client.name || '—')}</dd>
  <dt>Work at</dt><dd>${safe(document.client.address || document.jobName)}</dd>
  <dt>Job</dt><dd>${safe(document.jobName)}</dd>
  <dt>Raised</dt><dd>${safe(document.raisedAt.slice(0, 10))}</dd>
  <dt>Sent</dt><dd>${safe(at)}</dd>
</dl>

<section>
  <h2>Why this is happening</h2>
  <p class="why">${safe(document.because)}</p>

  <h2>What changes</h2>
  <table>
    <thead>
      <tr><th>Work</th><th>Change</th><th class="n">Was</th><th class="n">Now</th><th class="n">Amount</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="sums">
    <div><span>Agreed before this</span><span class="n">${safe(money(document.wasTotal))}</span></div>
    <div><span>This change</span><span class="n ${document.difference < 0n ? 'down' : 'up'}">${
      document.difference < 0n ? '−' : '+'
    }${safe(money(size))}</span></div>
    <div class="big"><span>Agreed with this change</span><span class="n">${safe(
      money(document.nowTotal)
    )}</span></div>
  </div>

  <p class="days">${
    document.extraDays === 0
      ? 'This adds no days to the finish date.'
      : `This adds ${document.extraDays} day${document.extraDays === 1 ? '' : 's'} to the finish date.`
  }</p>
</section>

${signed}

<footer>
  ${safe(document.jobName)} · change order ${safe(document.number)} · written in Trueline · this
  document contains everything it needs and works with no internet connection.
</footer>
</html>`;
}

/** What to call the file, so a folder of them stays legible. */
export function changeFileName(document: ChangeDocument): string {
  const job = document.jobName.replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '') || 'job';
  const number = document.number.replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '') || 'CO';
  return `${job}-change-${number}.html`;
}
