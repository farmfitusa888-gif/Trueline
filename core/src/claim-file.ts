import { type Room, RoomError } from './room.ts';
import type { Damage } from './damage.ts';
import { onPaper } from './design.ts';
import { type Company, letterhead, pricing, showArea, showLength } from './company.ts';
import { type Claim, type ClaimReport, claimReport, missingFromClaim } from './claim.ts';
import { money } from './price.ts';
import { type ScopeMoney, damageScope, scopeMoney } from './scope.ts';
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
 * **The money on it is the restoration scope and nothing else.** For a long time
 * there was none, on the argument that an adjuster who reads a number before the
 * scope is agreed negotiates against it. What that argument missed is where the
 * number then lived: nowhere. The damage was measured to the square foot and
 * priced on no sheet anybody could find, so the only figure in the app was the
 * room's remodel takeoff — a whole floor and a whole ceiling nobody said needed
 * doing. An adjuster gets a number, and it is the right one: every line comes
 * off a mark somebody made, at a rate this contractor typed himself, and a
 * surface nobody marked produces nothing. The remodel takeoff stays where it
 * was and never appears here.
 *
 * Silent when the contractor has not set his restoration rates. A claim that
 * leaves the building saying "none of this is priced" is not a document
 * anybody sends, so the document is exactly what it always was until there is
 * a real figure to put on it.
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

/**
 * A document that cannot be built honestly, refused rather than half-built.
 *
 * There is exactly one thing that raises it and it is not a person's typing: a
 * colour the shared palette does not define. That is a programming mistake, and
 * a loud one here is a black rectangle nobody notices there.
 */
export class ClaimFileError extends RoomError {}

function safe(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ------------------------------------------------- the drawing’s own colours */

/**
 * Every palette token, as the channels the app’s stylesheet holds them in.
 *
 * Built from `design.ts`, which is the one place the palette lives and the same
 * place `web/src/tokens.css` is generated from. A second table of hexes typed
 * out here would be a palette maintained twice, which is the exact failure that
 * file exists to prevent.
 *
 * The **light** values, always. Anything that leaves the app as a document is
 * paper, and a claim printed out of the dark palette is a sheet of black ink
 * arriving at an adjuster.
 */
/**
 * The plan's colours, resolved to paper, so the drawing survives leaving the
 * app. It lives in `design.ts` beside the palette itself, because the same bug
 * is live on every other path a drawing takes out of here — the client file,
 * the PNG, every thumbnail — and one copy of the fix is the only way they stay
 * fixed together. See `onPaper` for the whole story and the measurements.
 */
const resolvePalette = onPaper;

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

/**
 * The whole loss as one figure, across every room going on the document.
 *
 * Exported because the screen that sends the file has to be able to say what
 * will be on it before it builds it — and saying so from a second calculation
 * would be a screen that promises one number and attaches another.
 *
 * Priced by quoting the union of the rooms' scope lines through the same
 * function each room's own money goes through, never by adding the printed
 * strings back up. Adding printed money is arithmetic done on a rounding
 * instead of on the money.
 */
export function lossMoney(
  rooms: readonly { readonly room: Room; readonly damages: readonly Damage[] }[],
  company: Company,
  at: string
): ScopeMoney {
  return scopeMoney(
    {
      room: rooms.map((r) => r.room.name).join(' · '),
      lines: rooms.flatMap((r) => damageScope(r.room, r.damages, at).lines),
      text: '',
      csv: '',
      note: '',
      noWork: [],
    },
    pricing(company).book
  );
}

/**
 * The marked damage, priced, under the room it was marked in.
 *
 * Grouped by the stage the work happens in — tear out, protect, rebuild —
 * because that is the order a scope is read in and the order it is scheduled
 * in. Every row carries the quantity and the rate beside the money, so an
 * adjuster can check the multiplication without asking anybody for a breakdown.
 *
 * Silent when nothing has a rate against it. A claim that leaves the building
 * announcing that the contractor has not set his prices is not a document
 * anybody sends.
 */
function moneyBlock(report: ClaimReport): string {
  const priced = report.money;
  if (!priced || !priced.priced) return '';

  const stages = ['tear out', 'protect', 'rebuild'] as const;
  const rows = stages
    .map((stage) => {
      const inStage = priced.lines.filter((l) => l.stage === stage);
      if (inStage.length === 0) return '';
      return (
        `<tr><th colspan="2" class="stage">${safe(stage)}</th></tr>` +
        inStage
          .map(
            (l) =>
              `<tr><th>${safe(l.item)}<span>${safe(l.quantity)} at ${safe(l.rate)}</span></th>` +
              `<td>${safe(l.amount)}</td></tr>`
          )
          .join('')
      );
    })
    .join('');

  const totals = priced.totals
    .map((line) => `<tr class="sum"><th>${safe(line.label)}</th><td>${safe(line.value)}</td></tr>`)
    .join('');

  return `<div class="money">
      <h3>What it takes to put right</h3>
      <table>${rows}${totals}</table>
      <p class="how">${safe(priced.note)}</p>
      ${
        priced.unpriced.length > 0
          ? `<p class="how"><strong>Not in the figure above:</strong> ${safe(
              priced.unpriced.join(', ')
            )}. There is no rate set for those, and they are left out rather than counted as ` +
            `nothing.</p>`
          : ''
      }
    </div>`;
}

export function claimFile(parts: ClaimFileParts): string {
  const { rooms, claim, company, at } = parts;
  const units = company.units;
  const head = letterhead(company);
  const missing = missingFromClaim(claim);

  const book = pricing(company).book;
  const reports = rooms.map((r) => ({
    part: r,
    report: claimReport(
      r.room,
      r.damages,
      claim,
      at,
      { len: (v) => showLength(v, units), area: (a) => showArea(a, units) },
      book
    ),
  }));

  const wholeLoss = lossMoney(rooms, company, at);

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
    // The one number an adjuster is looking for, on a document that used to
    // carry none. Only when something is actually priced: a claim announcing
    // that the contractor has not set his rates is not a document anybody
    // sends, and a total of nothing beside real damage is worse than no total.
    ...(wholeLoss.priced
      ? [
          {
            label: 'What it takes to put right',
            value:
              money(wholeLoss.total) +
              (wholeLoss.unpriced.length > 0
                ? ` — not counting ${wholeLoss.unpriced.join(', ')}, which have no rate set`
                : ''),
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
    ${part.plan ? `<div class="plan">${resolvePalette(part.plan)}</div>` : ''}
    ${damageBlock(report, part.photos)}
    ${moneyBlock(report)}
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
  .money { border-top: 1px solid #e2e8f0; margin: 16px 0 0; padding: 14px 0 0; }
  .money h3 { margin: 0 0 8px; }
  .money th span { display: block; font-size: 13px; color: #64748b; font-variant-numeric: tabular-nums; }
  .money .stage { text-transform: uppercase; letter-spacing: .04em; font-size: 12px;
                  color: #64748b; padding-top: 14px; }
  .money .sum th, .money .sum td { font-weight: 700; }
  .money .sum:first-of-type th, .money .sum:first-of-type td { border-top: 2px solid #cbd5e1; }
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
      ${head[0] ? safe(head[0]) : 'ScanToBid'}
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
        : wholeLoss.priced
          ? 'The money on this document is the restoration scope only &mdash; what it takes to ' +
            'put the marked damage right, at this contractor&rsquo;s own rates. It is not a ' +
            'remodel of these rooms, and nothing on it comes off a surface nobody marked.'
          : 'No prices appear on this document. The scope and its cost are a separate sheet.'
    }</p>
  </section>

  <footer>${
    company.name ? `${safe(company.name)} · made with ScanToBid` : 'Made with ScanToBid'
  }</footer>
</main>
</html>`;
}
