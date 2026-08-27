/**
 * The free forms, as real PDFs.
 *
 * Built by the same library the app's own claim document uses, so a blank form
 * somebody downloads and a filled-in one the app produces are the same
 * document. That is the whole argument for generating them rather than drawing
 * them in a design tool: they are proof the app does what the guide describes.
 *
 * Deliberately plain. These get printed, put on a clipboard, and written on
 * with a pencil in a house with no power — which rules out colour, tints and
 * anything that depends on a printer being good.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { TEMPLATES } from '../content/templates.mjs';
import { SITE } from '../content/site.mjs';

const INK = rgb(0.09, 0.13, 0.17);
const QUIET = rgb(0.42, 0.46, 0.5);
const RULE = rgb(0.78, 0.75, 0.7);

export async function buildPdfs(into) {
  mkdirSync(into, { recursive: true });
  const made = [];

  for (const template of TEMPLATES) {
    const pdf = await PDFDocument.create();
    pdf.setTitle(`${template.title} — ${SITE.name}`);
    pdf.setSubject(template.blurb);
    pdf.setProducer(SITE.name);
    pdf.setCreator(`${SITE.name} — ${SITE.origin}`);

    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const plain = await pdf.embedFont(StandardFonts.Helvetica);
    const mono = await pdf.embedFont(StandardFonts.Courier);

    let page = pdf.addPage([612, 792]);           // US Letter
    const M = 54;                                  // margin
    let y = 792 - M;

    const room = (need) => {
      if (y - need > M + 40) return;
      stamp(page);
      page = pdf.addPage([612, 792]);
      y = 792 - M;
    };

    /** The footer. On every page, because pages get separated. */
    const stamp = (p) => {
      p.drawLine({
        start: { x: M, y: M + 22 }, end: { x: 612 - M, y: M + 22 },
        thickness: 0.5, color: RULE,
      });
      p.drawText(`${template.title} · ${SITE.name} · ${SITE.origin}`, {
        x: M, y: M + 10, size: 7, font: mono, color: QUIET,
      });
    };

    // Title block, top right, like a drawing.
    page.drawText(SITE.name.toUpperCase(), {
      x: 612 - M - bold.widthOfTextAtSize(SITE.name.toUpperCase(), 9),
      y: y - 2, size: 9, font: bold, color: QUIET,
    });
    page.drawText(template.title, { x: M, y: y - 6, size: 19, font: bold, color: INK });
    y -= 30;
    page.drawLine({
      start: { x: M, y }, end: { x: 612 - M, y }, thickness: 1, color: INK,
    });
    y -= 22;

    // Every field says what it is. There was a heuristic here that decided a
    // heading by whether the text was upper case, and it quietly filed
    // "QUANTITIES — item / unit / amount" as a one-line blank because of the
    // lower case after the dash. A form with nowhere to write the quantities is
    // not a form, and nothing on screen said it had happened. Explicit instead.
    for (const field of template.fields) {
      if (typeof field === 'object' && field.block) {
        const lines = field.lines ?? 3;
        room(30 + lines * 22);
        y -= 6;
        page.drawText(field.block.toUpperCase(), { x: M, y, size: 8, font: bold, color: INK });
        y -= 7;
        page.drawLine({
          start: { x: M, y }, end: { x: 612 - M, y }, thickness: 0.6, color: INK,
        });
        y -= 26;
        for (let i = 0; i < lines; i += 1) {
          page.drawLine({
            start: { x: M, y: y + 6 }, end: { x: 612 - M, y: y + 6 },
            thickness: 0.4, color: RULE,
          });
          y -= 22;
        }
        y -= 6;
        continue;
      }

      if (typeof field === 'object' && field.note) {
        room(30);
        page.drawText(field.note, { x: M, y, size: 8, font: plain, color: QUIET });
        y -= 24;
        continue;
      }

      room(30);
      page.drawText(field, { x: M, y, size: 8.5, font: plain, color: QUIET });
      page.drawLine({
        start: { x: M + 4 + plain.widthOfTextAtSize(field, 8.5) + 8, y: y - 2 },
        end: { x: 612 - M, y: y - 2 }, thickness: 0.4, color: RULE,
      });
      y -= 26;
    }

    stamp(page);
    const bytes = await pdf.save();
    writeFileSync(`${into}/${template.file}`, bytes);
    made.push({ file: template.file, pages: pdf.getPageCount(), bytes: bytes.length });
  }
  return made;
}
