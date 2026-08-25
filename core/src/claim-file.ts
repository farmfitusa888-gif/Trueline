import type { Room } from './room.ts';
import type { Damage } from './damage.ts';
import { type Company, letterhead, showArea, showLength } from './company.ts';
import { type Claim, type ClaimReport, claimReport, missingFromClaim } from './claim.ts';
import { damageTotals } from './damage.ts';

/**
 * One file for the adjuster: the measurements, the damage, and the evidence.
 *
 * In `core` rather than in the web layer because it is a pure function of the
 * model — a room, its damages, a claim and some strings in, one string out. It
 * touches no DOM and no browser, which is what makes it testable, and a
 * document that decides what an insurer is told is one that should have tests
 * on it.
 *
 * **No money in it, on purpose.** This is what was measured and what was found;
 * the priced scope is a separate sheet the contractor sends when they choose to.
 * An adjuster who reads a number before the scope is agreed negotiates against
 * that number, and the contractor has handed away the first move for no reason.
 * The two documents exist to be sent in that order.
 *
 * Everything else follows the client file's rules, for the same reasons:
 *
 *   - **Nothing is fetched.** The drawings are inlined SVG, the photographs are
 *     data URLs, there are no scripts and no web fonts. A claim document that
 *     goes blank without a signal goes blank in front of an adjuster.
 *   - **The photographs are full size.** This is the one place a picture is
 *     deliberately big: a stain at 128 pixels decides nothing, and the whole
 *     point of the photograph is that it cannot be taken again.
 *   - **The caveat travels.** A claim priced off an unchecked scan rests on a
 *     guess, and this is the last chance to say so.
 *   - **What is missing is named on the document**, rather than left to be
 *     discovered by whoever receives it.
 *
 * Not a single script tag, and every value a person typed is escaped on the way
 * in.
 */

function safe(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** One room's part of the claim: its own drawing, its damage, its evidence. */
export interface ClaimRoom {
  readonly room: Room;
  readonly damages: readonly Damage[];
  /** The plan, already serialised, with the damage drawn on it. */
  readonly plan: string;
  /**
   * Photographs by name, as data URLs.
   *
   * Passed in rather than read here, because reading them is asynchronous and
   * a document builder that could half-fail would produce a claim with some of
   * the evidence in it — which is worse than one that says a picture is
   * missing, because nobody would notice.
   */
  readonly photos: ReadonlyMap<string, string>;
}

export interface ClaimFileParts {
  readonly rooms: readonly ClaimRoom[];
  readonly claim: Claim;
  readonly company: Company;
  readonly at: string;
}

function damageBlock(report: ClaimReport, photos: ReadonlyMap<string, string>): string {
  if (report.damages.length === 0) {
    return `<p class="none">Nothing marked in this room.</p>`;
  }
  return report.damages
    .map((damage) => {
      const shots = damage.photos
        .map((name) => {
          const src = photos.get(name);
          return src
            ? `<figure><img src="${src}" alt="Photograph of the damage"></figure>`
            : `<p class="none">A photograph named ${safe(name)} belongs here and was not on ` +
              `the device this document was made on. It is in the scan&rsquo;s own folder.</p>`;
        })
        .join('');

      const readings =
        damage.readings.length === 0
          ? ''
          : `<table class="readings">${damage.readings
              .map((r) => `<tr><th>${safe(r.label)}</th><td>${safe(r.value)}</td></tr>`)
              .join('')}</table>`;

      return `<article>
      <h3>${safe(damage.headline)}</h3>
      ${damage.summary ? `<p class="qty">${safe(damage.summary)}</p>` : ''}
      <p class="said">${safe(damage.note)}</p>
      <p class="how">${safe(damage.workings)}</p>
      ${damage.dryingNote ? `<p class="how">${safe(damage.dryingNote)}</p>` : ''}
      ${readings}
      ${shots}
    </article>`;
    })
    .join('');
}

export function claimFile(parts: ClaimFileParts): string {
  const { rooms, claim, company, at } = parts;
  const units = company.units;
  const head = letterhead(company);
  const missing = missingFromClaim(claim);

  const reports = rooms.map((r) => ({
    part: r,
    report: claimReport(r.room, r.damages, claim, at, {
      len: (v) => showLength(v, units),
      area: (a) => showArea(a, units),
    }),
  }));

  // The claim's own facts are the same on every room, so they are stated once
  // at the top rather than repeated under each drawing.
  const about = reports[0]?.report.about ?? [];

  // Across every room on this document, not per room: a loss is argued as one
  // number and a per-room total leaves whoever reads it adding up by hand.
  const everyDamage = rooms.flatMap((r) => r.damages);
  const anyCut = rooms.some((r) => damageTotals(r.room, r.damages).anyCut);
  const pins = rooms.reduce((n, r) => n + damageTotals(r.room, r.damages).pins, 0);
  const faceArea = rooms.reduce((sum, r) => sum + damageTotals(r.room, r.damages).faceArea, 0n);
  const flatArea = rooms.reduce((sum, r) => sum + damageTotals(r.room, r.damages).flatArea, 0n);
  const baseboard = rooms.reduce((sum, r) => sum + damageTotals(r.room, r.damages).baseboardRun, 0n);

  const jobTotals = [
    ...(faceArea > 0n
      ? [{ label: 'Wall face affected', value: showArea(2n * faceArea, units) }]
      : []),
    ...(flatArea > 0n
      ? [{ label: 'Floor or ceiling affected', value: showArea(flatArea, units) }]
      : []),
    ...(baseboard > 0n
      ? [{ label: 'Baseboard affected', value: showLength(baseboard, units) }]
      : []),
    ...(pins > 0
      ? [
          {
            label: 'Marked points',
            value: `${pins} — photographed and noted, with no area. A pin is a marker rather than a measurement.`,
          },
        ]
      : []),
    ...(anyCut
      ? [
          {
            label: 'Cut heights',
            value:
              'Some areas are quantified to a decided cut height rather than to the damage seen. Each says which, above.',
          },
        ]
      : []),
  ];

  const unchecked = reports.some((r) => r.report.caveat.startsWith('THESE ARE'));

  const body = reports
    .map(
      ({ part, report }) => `<section class="room">
    <h2>${safe(part.room.name)}</h2>
    <p class="size">${safe(
      report.room.map((line) => `${line.label} ${line.value}`).join(' · ')
    )}</p>
    ${part.plan ? `<div class="plan">${part.plan}</div>` : ''}
    ${damageBlock(report, part.photos)}
  </section>`
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${claim.claimNumber ? `Claim ${safe(claim.claimNumber)}` : 'Claim'}${
    company.name ? ` — ${safe(company.name)}` : ''
  }</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px 18px 64px;
    font: 16px/1.55 ui-sans-serif, -apple-system, "Helvetica Neue", Arial, sans-serif;
    color: #0f172a; background: #f8fafc; -webkit-text-size-adjust: 100%;
  }
  main { max-width: 760px; margin: 0 auto; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
  header .who { font-weight: 600; font-size: 18px; }
  header .who span { display: block; font-weight: 400; font-size: 14px; color: #64748b; }
  h1 { font-size: 28px; margin: 20px 0 2px; }
  .when { color: #64748b; margin: 0 0 20px; }
  section { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 0 0 18px; }
  h2 { font-size: 20px; margin: 0 0 4px; }
  h3 { font-size: 17px; margin: 0 0 4px; }
  .size { color: #64748b; font-size: 14px; margin: 0 0 12px; }
  .plan { margin: 0 0 16px; }
  svg { width: 100%; height: auto; display: block; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-weight: 400; padding: 9px 0; border-top: 1px solid #f1f5f9; }
  td { text-align: right; font-weight: 600; padding: 9px 0; border-top: 1px solid #f1f5f9;
       font-variant-numeric: tabular-nums; }
  tr:first-child th, tr:first-child td { border-top: 0; }
  article { border-top: 1px solid #e2e8f0; padding: 14px 0 4px; }
  article:first-of-type { border-top: 0; }
  .qty { font-weight: 700; font-variant-numeric: tabular-nums; margin: 0 0 6px; }
  .said { margin: 0 0 6px; }
  .how { color: #64748b; font-size: 14px; margin: 0 0 6px; }
  .none { color: #64748b; font-size: 14px; }
  .readings { max-width: 320px; margin: 0 0 12px; }
  .readings th, .readings td { padding: 5px 0; font-size: 14px; }
  figure { margin: 12px 0 0; }
  figure img { width: 100%; border-radius: 8px; display: block; }
  .caveat { border-color: #fcd34d; background: #fffbeb; color: #92400e; }
  .missing { border-color: #fcd34d; background: #fffbeb; color: #92400e; }
  footer { color: #94a3b8; font-size: 13px; text-align: center; margin-top: 26px; }
  @media print {
    body { background: #fff; padding: 0; }
    section { border: 0; padding: 0 0 18px; break-inside: avoid; }
    article, figure { break-inside: avoid; }
  }
</style>
<main>
  <header>
    <div class="who">
      ${head[0] ? safe(head[0]) : 'Trueline'}
      ${head.slice(1).map((line) => `<span>${safe(line)}</span>`).join('')}
    </div>
    ${company.logo ? `<img src="${company.logo}" alt="" style="height:44px;width:auto">` : ''}
  </header>

  <h1>${claim.claimNumber ? `Claim ${safe(claim.claimNumber)}` : 'Claim'}</h1>
  <p class="when">${safe(rooms.map((r) => r.room.name).join(' · '))} · prepared ${safe(at)}</p>

  ${
    about.length > 0
      ? `<section>
    <h2>The claim</h2>
    <table>${about
      .map((line) => `<tr><th>${safe(line.label)}</th><td>${safe(line.value)}</td></tr>`)
      .join('')}</table>
  </section>`
      : ''
  }

  ${body}

  ${
    jobTotals.length > 0
      ? `<section>
    <h2>Across ${rooms.length === 1 ? 'this room' : `these ${rooms.length} rooms`}</h2>
    <table>${jobTotals
      .map((line) => `<tr><th>${safe(line.label)}</th><td>${safe(line.value)}</td></tr>`)
      .join('')}</table>
  </section>`
      : ''
  }

  ${
    missing.length > 0
      ? `<section class="missing">
    <h2>Still to be filled in</h2>
    <p style="margin:0">This document is missing ${safe(missing.join(', '))}.</p>
  </section>`
      : ''
  }

  <section class="caveat">
    <h2>Where these measurements came from</h2>
    <p>${
      unchecked
        ? 'THESE ARE A SCANNER&rsquo;S MEASUREMENTS. At least one room here has had no tape ' +
          'measure on any wall, so every area above will move when one does.'
        : 'Every wall behind these measurements has had a tape measure on it.'
    }</p>
    <p style="margin-bottom:0">${
      everyDamage.length === 0
        ? 'No damage is marked on this document.'
        : 'No prices appear on this document. The scope and its cost are a separate sheet.'
    }</p>
  </section>

  <footer>${
    company.name ? `${safe(company.name)} · made with Trueline` : 'Made with Trueline'
  }</footer>
</main>
</html>`;
}
