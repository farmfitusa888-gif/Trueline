import type { Room } from '../../core/src/room.ts';
import { type Company, letterhead, showArea, showLength } from '../../core/src/company.ts';
import { readiness, trustLabel } from '../../core/src/issue.ts';
import { area } from '../../core/src/room.ts';
import { type Quote, money } from '../../core/src/price.ts';
import type { Takeoff } from '../../core/src/takeoff.ts';
import { planSvg } from './sheet.ts';

/**
 * One file a homeowner can open, with no app, no login and no account.
 *
 * Matterport's entire business is this one feature and they charge from $65 a
 * month for it. It does not need a server: everything a client should see fits
 * in a single HTML file — the drawing, the room, what it takes, what it costs,
 * and a few photographs — and a file can be texted, emailed or AirDropped and
 * then opened on anything, forever, offline, by somebody who has never heard of
 * this app.
 *
 * The things that decides:
 *
 *   - **Nothing is fetched.** Every byte is inside it: the plan is the same SVG
 *     that is on the contractor's screen, inlined; the photographs are data
 *     URLs; there are no scripts and no fonts to download. A file that goes
 *     blank without a signal is worse than no file, because it goes blank in
 *     front of the client.
 *   - **A few small photographs, not all of them.** One garage scan is 26 MB of
 *     pictures and a client file that will not go through a text message has
 *     failed at the only thing it does.
 *   - **The contractor's name on it, and ours small.** A homeowner handed a
 *     document with somebody else's brand on it is being handed a tool their
 *     contractor is borrowing.
 *   - **The caveat travels.** If nobody has put a tape on a wall, the client is
 *     told so in the same words the contractor sees. This is the one document
 *     that leaves the building, and it is the last chance to be honest about
 *     where the numbers came from.
 *
 * No script tags at all, so nothing here can be an attack surface in somebody's
 * browser, and every value that comes from a person is escaped on the way in.
 */

/** Anything a person typed, safe to put in HTML. */
function safe(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface ClientFileParts {
  readonly room: Room;
  readonly company: Company;
  readonly takeoff: Takeoff;
  /** Omitted when the contractor has not set any rates. */
  readonly quote?: Quote;
  /** The plan, as it is on the screen. */
  readonly plan: SVGSVGElement | null;
  /** Small pictures, already data URLs, with a line about each. */
  readonly photos: readonly { readonly src: string; readonly caption: string }[];
  readonly at: string;
}

export function clientFile(parts: ClientFileParts): string {
  const { room, company, takeoff, quote, plan, photos, at } = parts;
  const state = readiness(room);
  const units = company.units;
  const head = letterhead(company);
  const unchecked = state.blocking.length > 0;

  const drawing = plan ? planSvg(plan) : '';

  const rows = takeoff.lines
    .filter((line) => line.group === undefined)
    .map(
      (line) => `<tr><th>${safe(line.what)}</th><td>${safe(line.quantity)} ${safe(line.unit)}</td></tr>`
    )
    .join('');

  const priced =
    quote && quote.lines.length > 0
      ? `<section>
      <h2>What it comes to</h2>
      <table class="cost">
        ${quote.lines
          .map(
            (line) =>
              `<tr><th>${safe(line.item)}<span>${safe(line.quantity)} ${safe(line.unit)} at ${safe(
                money(line.cents)
              )}</span></th><td>${safe(money(line.total))}</td></tr>`
          )
          .join('')}
        ${
          quote.margin === 0n
            ? ''
            : `<tr class="sub"><th>Subtotal</th><td>${safe(money(quote.subtotal))}</td></tr>`
        }
        <tr class="total"><th>Total</th><td>${safe(money(quote.total))}</td></tr>
      </table>
    </section>`
      : '';

  const gallery =
    photos.length === 0
      ? ''
      : `<section>
      <h2>The room</h2>
      <div class="shots">
        ${photos
          .map(
            (photo) =>
              `<figure><img src="${photo.src}" alt=""><figcaption>${safe(photo.caption)}</figcaption></figure>`
          )
          .join('')}
      </div>
    </section>`;

  // Deliberately plain, deliberately printable, and deliberately without a
  // single script or web font. This opens on a ten-year-old phone in a driveway.
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safe(room.name)}${company.name ? ` — ${safe(company.name)}` : ''}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px 18px 64px;
    font: 16px/1.55 ui-sans-serif, -apple-system, "Helvetica Neue", Arial, sans-serif;
    color: #0f172a; background: #f8fafc; -webkit-text-size-adjust: 100%;
  }
  main { max-width: 720px; margin: 0 auto; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
  header .who { font-weight: 600; font-size: 18px; }
  header .who span { display: block; font-weight: 400; font-size: 14px; color: #64748b; }
  h1 { font-size: 28px; margin: 20px 0 2px; }
  .size { color: #64748b; margin: 0 0 20px; }
  section { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 0 0 18px; }
  h2 { font-size: 18px; margin: 0 0 10px; }
  svg { width: 100%; height: auto; display: block; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-weight: 400; padding: 9px 0; border-top: 1px solid #f1f5f9; }
  td { text-align: right; font-weight: 600; padding: 9px 0; border-top: 1px solid #f1f5f9;
       font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr:first-child th, tr:first-child td { border-top: 0; }
  .cost th span { display: block; font-size: 13px; color: #64748b; font-weight: 400; }
  .cost .sub th, .cost .sub td { color: #64748b; font-weight: 400; }
  .cost .total th, .cost .total td { font-size: 20px; font-weight: 700; border-top: 2px solid #0f172a; }
  .caveat { border-color: #fcd34d; background: #fffbeb; color: #92400e; }
  .shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
  figure { margin: 0; }
  figure img { width: 100%; border-radius: 8px; display: block; }
  figcaption { font-size: 13px; color: #64748b; margin-top: 4px; }
  footer { color: #94a3b8; font-size: 13px; text-align: center; margin-top: 26px; }
  @media print { body { background: #fff; padding: 0; } section { border: 0; padding: 0 0 18px; } }
</style>
<main>
  <header>
    <div class="who">
      ${head[0] ? safe(head[0]) : 'Trueline'}
      ${head.slice(1).map((line) => `<span>${safe(line)}</span>`).join('')}
    </div>
    ${company.logo ? `<img src="${company.logo}" alt="" style="height:44px;width:auto">` : ''}
  </header>

  <h1>${safe(room.name)}</h1>
  <p class="size">${safe(showArea(area(room).value, units))} · ceiling ${safe(
    showLength(room.ceilingHeight.value, units)
  )} · ${safe(at)}</p>

  ${drawing ? `<section>${drawing}</section>` : ''}

  <section>
    <h2>What is in it</h2>
    <table>${rows}</table>
  </section>

  ${priced}
  ${gallery}

  <section class="caveat">
    <h2>Where these numbers came from</h2>
    <p>${
      unchecked
        ? 'These are a 3D scanner&rsquo;s figures. No wall here has had a tape measure on it yet, ' +
          'so they will move when one does — usually by an inch or two, occasionally by more.'
        : 'Every wall behind these numbers has had a tape measure on it.'
    }</p>
    <p style="margin-bottom:0">${safe(trustLabel(state.trust))}.</p>
  </section>

  <footer>${
    company.name ? `${safe(company.name)} · made with Trueline` : 'Made with Trueline'
  }</footer>
</main>
</html>`;
}
