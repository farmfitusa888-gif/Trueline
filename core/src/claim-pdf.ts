import type { ClaimReport } from './claim.ts';
import { type Company, letterhead } from './company.ts';

/**
 * The claim, as a PDF an adjuster's system will actually take.
 *
 * The HTML file is the better document — it opens on anything, it carries the
 * drawing as vector SVG, and it needs nothing installed. But a carrier's claim
 * system takes PDFs, and an adjuster who has to convert a file before he can
 * attach it is an adjuster who asks for it again in the format he wanted.
 *
 * So both, from one report. Neither is built from the other and neither is
 * built from the screen: `claimReport` produces the structure, and the two
 * renderers read it. Three renderers agreeing about what a claim says is the
 * whole reason that function returns data rather than a string.
 *
 * **Laid out here rather than by printing the HTML.** A browser's print-to-PDF
 * is not available inside a web view without a user gesture, produces a
 * different result on every platform, and cannot be tested. This is arithmetic
 * on a page: it produces the same bytes on a phone, on a laptop and in a test.
 *
 * What it carries is the same thing the HTML carries, including the money: the
 * restoration scope, priced at the contractor's own rates, and never the room's
 * remodel takeoff. The two are different sheets going to different payers, and
 * this one only ever prices what somebody marked.
 */

/** US Letter, in points, because that is what a carrier prints on. */
export const PAGE = { width: 612, height: 792 } as const;
const MARGIN = 54;
const WIDTH = PAGE.width - MARGIN * 2;

/**
 * How small a photograph may be squeezed to finish a page.
 *
 * Three inches. Below that a water line stops being evidence and starts being a
 * smudge, and the point of putting it on the document at all is that somebody
 * can decide from it — so it takes a fresh page instead.
 */
const SMALLEST_PHOTO = 216;

/** What a caller has to hand this to draw with. */
export interface Pen {
  /** A new page, and everything after goes on it. */
  newPage(): void;
  text(
    value: string,
    at: { x: number; y: number },
    style: { size: number; bold?: boolean; grey?: boolean }
  ): void;
  /** How wide that string will be, so this module can wrap it. */
  widthOf(value: string, size: number, bold?: boolean): number;
  line(from: { x: number; y: number }, to: { x: number; y: number }, grey?: boolean): void;
  /** A photograph, already decoded, drawn into a box. */
  image(id: string, box: { x: number; y: number; width: number; height: number }): void;
  /** How tall that photograph is per unit of width, for fitting it. */
  ratioOf(id: string): number;
}

/**
 * Splits a line to a width, on spaces, without measuring by character count.
 *
 * A proportional font makes "MMMM" three times the width of "iiii", so wrapping
 * at N characters puts some lines off the page and leaves others half empty.
 * The pen knows the real widths, so it does the measuring.
 */
export function wrap(
  pen: Pen,
  value: string,
  width: number,
  size: number,
  bold = false
): string[] {
  const out: string[] = [];
  for (const paragraph of value.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter((w) => w !== '')) {
      const tried = line === '' ? word : `${line} ${word}`;
      if (pen.widthOf(tried, size, bold) <= width || line === '') {
        line = tried;
      } else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

export interface ClaimPdfParts {
  readonly report: ClaimReport;
  readonly company: Company;
  /** Photograph ids the pen can draw, per damage id, in order. */
  readonly photos: ReadonlyMap<string, readonly string[]>;
  readonly at: string;
}

/**
 * Draws the whole document, and says how many pages it took.
 *
 * Pure apart from the pen: everything about where a line goes is decided here
 * and can be tested by handing it a pen that records rather than draws.
 */
export function drawClaim(pen: Pen, parts: ClaimPdfParts): number {
  const { report, company, photos, at } = parts;
  let y = PAGE.height - MARGIN;
  let pages = 1;

  /** Moves down, starting a page when there is not room for what comes next. */
  const room = (needed: number): void => {
    if (y - needed >= MARGIN) return;
    pen.newPage();
    pages += 1;
    y = PAGE.height - MARGIN;
  };

  const say = (
    value: string,
    size: number,
    { bold = false, grey = false, indent = 0, gap = 4 } = {}
  ): void => {
    for (const line of wrap(pen, value, WIDTH - indent, size, bold)) {
      room(size + gap);
      y -= size;
      pen.text(line, { x: MARGIN + indent, y }, { size, bold, grey });
      y -= gap;
    }
  };

  /** A label on the left and a value on the right, on one line. */
  const row = (label: string, value: string, size = 10): void => {
    const lines = wrap(pen, value, WIDTH * 0.62, size);
    room(size * lines.length + 8);
    const top = y - size;
    pen.text(label, { x: MARGIN, y: top }, { size, grey: true });
    let at2 = top;
    for (const line of lines) {
      pen.text(line, { x: MARGIN + WIDTH - pen.widthOf(line, size), y: at2 }, { size, bold: true });
      at2 -= size + 2;
    }
    y = at2 - 6;
    pen.line({ x: MARGIN, y: y + 4 }, { x: MARGIN + WIDTH, y: y + 4 }, true);
  };

  const rule = (): void => {
    room(10);
    y -= 6;
    pen.line({ x: MARGIN, y }, { x: MARGIN + WIDTH, y });
    y -= 6;
  };

  /* ------------------------------------------------------------ letterhead */

  const head = letterhead(company);
  say(head[0] ?? 'ScanToBid', 13, { bold: true, gap: 2 });
  for (const line of head.slice(1)) say(line, 9, { grey: true, gap: 2 });
  rule();

  say(report.heading, 18, { bold: true, gap: 6 });
  say(`Prepared ${at}`, 9, { grey: true, gap: 12 });

  /* ---------------------------------------------------------- the claim */

  if (report.about.length > 0) {
    say('The claim', 12, { bold: true, gap: 6 });
    for (const line of report.about) row(line.label, line.value);
    y -= 8;
  }

  /* ------------------------------------------------------------ the room */

  if (report.room.length > 0) {
    say('The room, measured', 12, { bold: true, gap: 6 });
    for (const line of report.room) row(line.label, line.value);
    y -= 8;
  }

  /* --------------------------------------------------------- the damages */

  say('What is wrong with it', 12, { bold: true, gap: 6 });
  if (report.damages.length === 0) {
    say('Nothing marked in this room.', 10, { grey: true, gap: 10 });
  }
  for (const damage of report.damages) {
    room(40);
    say(damage.headline, 11, { bold: true, gap: 3 });
    if (damage.summary) say(damage.summary, 11, { bold: true, gap: 4 });
    // What this one mark comes to, beside the mark. A single figure at the
    // bottom of a scope answers what the loss is worth and leaves every
    // argument about one wall unanswerable.
    if (damage.cost) say(`Putting this right: ${damage.cost}`, 10, { bold: true, gap: 4 });
    if (damage.note) say(damage.note, 10, { gap: 3 });
    say(damage.workings, 9, { grey: true, gap: 3 });
    if (damage.dryingNote) say(damage.dryingNote, 9, { grey: true, gap: 3 });
    for (const reading of damage.readings) {
      say(`${reading.label}   ${reading.value}`, 9, { grey: true, indent: 12, gap: 2 });
    }

    // Full size, one to a row, because that is the point of them. A stain at
    // thumbnail size decides nothing, and deciding is what they are for.
    //
    // But "full size or a new page" left half of page one blank on a claim with
    // one photograph on it, which reads as a bug rather than as a decision. So
    // a photograph fills whatever is left of the page if that is still big
    // enough to see, and only takes a fresh page when it is not.
    for (const id of photos.get(damage.id) ?? []) {
      const ratio = pen.ratioOf(id);
      if (ratio <= 0) continue;
      const whole = Math.min(WIDTH * ratio, PAGE.height - MARGIN * 2);
      const left = y - MARGIN - 10;
      let height = whole;
      if (left < whole) {
        if (left >= SMALLEST_PHOTO) {
          height = left;
        } else {
          room(whole + 10);
          height = Math.min(whole, y - MARGIN - 10);
        }
      }
      // Kept in proportion: a photograph squeezed to fit is a photograph of a
      // different room.
      const width = Math.min(WIDTH, height / ratio);
      y -= height;
      pen.image(id, { x: MARGIN, y, width, height });
      y -= 10;
    }
    y -= 6;
  }

  /* ----------------------------------------------------------- the money */

  // Under the damage and above the totals, because it is the answer to what is
  // directly above it. Grouped by the stage the work happens in, with the
  // quantity and the rate beside every figure so the multiplication can be
  // checked without anybody asking for a breakdown.
  const priced = report.money;
  if (priced && priced.priced) {
    rule();
    say('What it takes to put right', 12, { bold: true, gap: 6 });
    for (const stage of ['tear out', 'protect', 'rebuild'] as const) {
      const inStage = priced.lines.filter((l) => l.stage === stage);
      if (inStage.length === 0) continue;
      say(stage.toUpperCase(), 9, { grey: true, gap: 4 });
      for (const line of inStage) {
        row(`${line.item} — ${line.quantity} at ${line.rate}`, line.amount);
      }
    }
    for (const line of priced.totals) row(line.label, line.value, 11);
    y -= 6;
    say(priced.note, 9, { grey: true, gap: 4 });
    if (priced.unpriced.length > 0) {
      say(
        `Not in the figure above: ${priced.unpriced.join(', ')}. There is no rate set for those, ` +
          `and they are left out rather than counted as nothing.`,
        9,
        { grey: true, gap: 8 }
      );
    }
    y -= 8;
  }

  /* ---------------------------------------------------------- the totals */

  if (report.totals.length > 0) {
    rule();
    say('Across this room', 12, { bold: true, gap: 6 });
    for (const line of report.totals) row(line.label, line.value);
    y -= 8;
  }

  if (report.missing.length > 0) {
    say(`This document is missing ${report.missing.join(', ')}.`, 10, { gap: 8 });
  }

  /* ---------------------------------------------------------- the caveat */

  rule();
  say('Where these measurements came from', 11, { bold: true, gap: 4 });
  say(report.caveat, 10, { gap: 4 });
  say(
    priced && priced.priced
      ? 'The money on this document is the restoration scope only — what it takes to put the ' +
          'marked damage right, at this contractor’s own rates. It is not a remodel of this ' +
          'room, and nothing on it comes off a surface nobody marked.'
      : 'No prices appear on this document. The scope and its cost is a separate sheet.',
    10,
    { gap: 10 }
  );

  room(20);
  y -= 12;
  pen.text(
    company.name ? `${company.name} · made with ScanToBid` : 'Made with ScanToBid',
    { x: MARGIN, y },
    { size: 8, grey: true }
  );

  return pages;
}
