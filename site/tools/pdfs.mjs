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
 *
 * ## The one built from the regulation instead of from this file
 *
 * `cancellation-notice` does not go through the field renderer below. Its words
 * are the FTC Cooling-Off Rule's own — `RIGHT_TO_CANCEL_STATEMENT` and the
 * paragraphs `cancellationNotice()` produces, out of `core/src/cooling.ts`,
 * where 16 CFR §§ 429.0, 429.1 and 429.2 are quoted and cited. Nothing about
 * that form is drafted here. This file fills the engine's own blanks with
 * tokens, replaces the tokens with rules to write on, and refuses to write the
 * file at all if a token survives — because a legal notice with `[[NAME]]`
 * printed across it is worse than no notice.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { TEMPLATES } from '../content/templates.mjs';
import { SITE } from '../content/site.mjs';
import {
  BUSINESS_DAYS_TO_CANCEL,
  RIGHT_TO_CANCEL_STATEMENT,
  WHAT_THIS_DOES_NOT_KNOW,
  cancellationNotice,
  sayDate,
} from '../../core/src/cooling.ts';

const INK = rgb(0.09, 0.13, 0.17);
const QUIET = rgb(0.42, 0.46, 0.5);
const RULE = rgb(0.78, 0.75, 0.7);

const PAGE = { width: 612, height: 792, margin: 54 };

/**
 * Breaks a paragraph at the last space that still fits.
 *
 * pdf-lib draws a string wherever it is told and off the edge of the paper if
 * that is where the string ends. Every line of running text on these forms goes
 * through here first.
 */
function wrap(text, font, size, width) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    const candidate = line === '' ? word : `${line} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) <= width || line === '') line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

export async function buildPdfs(into) {
  mkdirSync(into, { recursive: true });
  const made = [];

  for (const template of TEMPLATES) {
    if (template.kind === 'cooling') {
      made.push(await buildCoolingNotice(template, into));
      continue;
    }
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
        // Wrapped rather than drawn as one string. A note longer than the
        // column used to run off the right-hand edge of the paper, which on a
        // form whose whole job is saying what it does not claim is the worst
        // possible sentence to lose.
        const lines = wrap(field.note, plain, 8, 612 - 2 * M);
        room(18 + lines.length * 11);
        for (const line of lines) {
          page.drawText(line, { x: M, y, size: 8, font: plain, color: QUIET });
          y -= 11;
        }
        y -= 13;
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

/* ------------------------------------------------- the one from the rule */

/**
 * Tokens handed to the engine so that what comes back has the seller's blanks
 * in known places.
 *
 * `cancellationNotice()` refuses a blank name or address — correctly, because a
 * notice with nowhere to post a cancellation is a defective one — so a blank
 * form cannot be produced by handing it empty strings. It is handed something
 * unmistakable instead, and the tokens are swapped for rules afterwards.
 */
const NAME_TOKEN = '[[SELLER-NAME]]';
const ADDRESS_TOKEN = '[[SELLER-ADDRESS]]';

/**
 * A real date, only so the engine will produce the sentence around it.
 *
 * Both dates it computes are then replaced by rules. Nothing about this date
 * reaches the paper, and it is fixed rather than today's so that two builds of
 * this site produce the same file.
 */
const SPECIMEN_DATE = '2026-01-05';

/** What a blank looks like on a form somebody fills in with a pen. */
const BLANK = '_'.repeat(34);

/**
 * The § 429.1(b) form, with the seller's four blanks left blank.
 *
 * Exported so `tools/check.mjs` can assert that no token survived and that the
 * regulation's own sentences are on the paper. A silent failure here prints a
 * legal notice with `[[SELLER-NAME]]` across it.
 */
export function coolingNoticeLines() {
  const notice = cancellationNotice(
    { name: NAME_TOKEN, address: ADDRESS_TOKEN },
    SPECIMEN_DATE
  );
  const blanks = [
    NAME_TOKEN,
    ADDRESS_TOKEN,
    sayDate(SPECIMEN_DATE),
    notice.deadlineSaid,
  ];
  const lines = notice.form.map((paragraph) => {
    let text = paragraph;
    for (const token of blanks) text = text.split(token).join(BLANK);
    return text;
  });
  for (const line of lines) {
    if (line.includes('[[')) {
      throw new Error(
        'The cancellation notice came back from core/src/cooling.ts with a token still in ' +
          `it: "${line}". The wording of the § 429.1(b) form has changed and this file no ` +
          'longer knows where the seller’s blanks are. Fix it before shipping the form.'
      );
    }
  }
  return { lines, statement: notice.statement, copies: notice.copies };
}

/**
 * The notice, printed as many times as the rule requires and once more to
 * explain itself.
 *
 * § 429.1(b) wants the form "in duplicate" and "in ten point bold face type",
 * attached and easily detachable — so each copy is a page of its own set in ten
 * point bold, and everything this site has to say about it is on a separate
 * last page that can be thrown away without taking a copy with it.
 */
async function buildCoolingNotice(template, into) {
  const { lines, statement, copies } = coolingNoticeLines();

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${template.title} — ${SITE.name}`);
  pdf.setSubject(template.blurb);
  pdf.setProducer(SITE.name);
  pdf.setCreator(`${SITE.name} — ${SITE.origin}`);

  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const plain = await pdf.embedFont(StandardFonts.Helvetica);
  const mono = await pdf.embedFont(StandardFonts.Courier);

  const M = PAGE.margin;
  const COLUMN = PAGE.width - 2 * M;

  const sheet = (footer) => {
    const page = pdf.addPage([PAGE.width, PAGE.height]);
    page.drawLine({
      start: { x: M, y: M + 22 }, end: { x: PAGE.width - M, y: M + 22 },
      thickness: 0.5, color: RULE,
    });
    page.drawText(footer, { x: M, y: M + 10, size: 7, font: mono, color: QUIET });
    return page;
  };

  for (let copy = 1; copy <= copies; copy += 1) {
    const page = sheet(
      `${template.title} · copy ${copy} of ${copies} · ${SITE.name} · ${SITE.origin}`
    );
    let y = PAGE.height - M;

    page.drawText('NOTICE OF CANCELLATION', { x: M, y: y - 6, size: 17, font: bold, color: INK });
    y -= 26;
    page.drawText(
      copy === 1
        ? 'COPY 1 OF 2 — the buyer sends this one to cancel.'
        : 'COPY 2 OF 2 — the buyer keeps this one.',
      { x: M, y, size: 8, font: plain, color: QUIET }
    );
    y -= 12;
    page.drawLine({
      start: { x: M, y }, end: { x: PAGE.width - M, y }, thickness: 1, color: INK,
    });
    y -= 22;

    // § 429.1(a): "in bold face type of a minimum size of 10 points, in
    // immediate proximity to the space for the buyer's signature". Ten point
    // bold, word for word, from the engine.
    for (const line of wrap(statement, bold, 10, COLUMN)) {
      page.drawText(line, { x: M, y, size: 10, font: bold, color: INK });
      y -= 13;
    }
    y -= 14;

    // § 429.1(b): the form itself, in ten point bold face type.
    for (const paragraph of lines) {
      const wrapped = wrap(paragraph, bold, 10, COLUMN);
      for (const line of wrapped) {
        page.drawText(line, { x: M, y, size: 10, font: bold, color: INK });
        y -= 13;
      }
      y -= 9;
    }

    y -= 6;
    for (const label of ['Buyer’s signature', 'Printed name', 'Date']) {
      page.drawText(label, { x: M, y, size: 8.5, font: plain, color: QUIET });
      page.drawLine({
        start: { x: M + 4 + plain.widthOfTextAtSize(label, 8.5) + 8, y: y - 2 },
        end: { x: PAGE.width - M, y: y - 2 }, thickness: 0.4, color: RULE,
      });
      y -= 24;
    }
  }

  /* The last page: what this site has to say, kept off both copies. */
  const page = sheet(`${template.title} · notes · ${SITE.name} · ${SITE.origin}`);
  let y = PAGE.height - M;
  page.drawText('BEFORE YOU HAND THESE OVER', { x: M, y: y - 6, size: 15, font: bold, color: INK });
  y -= 26;
  page.drawLine({ start: { x: M, y }, end: { x: PAGE.width - M, y }, thickness: 1, color: INK });
  y -= 20;

  const paragraph = (text, font = plain, size = 9) => {
    for (const line of wrap(text, font, size, COLUMN)) {
      page.drawText(line, { x: M, y, size, font, color: INK });
      y -= size + 3.5;
    }
    y -= 8;
  };

  paragraph(
    'The two pages before this one are the form required by the Federal Trade Commission’s ' +
      'Cooling-Off Rule, 16 CFR Part 429. The wording on them is the regulation’s own. Four ' +
      'things on each copy are blank because § 429.1(c) makes filling them in the seller’s ' +
      'job: your business name, the address of your place of business, the date of the ' +
      'transaction, and the date by which the buyer may cancel.',
    bold
  );
  paragraph(
    `That last date is the one to be careful with. It is midnight of the ` +
      `${BUSINESS_DAYS_TO_CANCEL === 3 ? 'third' : BUSINESS_DAYS_TO_CANCEL} business day ` +
      'after the date of the transaction, and the rule’s own definition of a business day is ' +
      'not the one anybody means by it: § 429.0 says any calendar day except Sunday or a ' +
      'federal holiday. Saturday counts. Sunday does not. Count it wrong in the direction ' +
      'that shortens the buyer’s three days and the form is defective — § 429.1(c) requires a ' +
      'date "not earlier than the third business day".'
  );
  paragraph(
    'Both copies go to the buyer at the time of signing — one to send back, one to keep — ' +
      'attached to the contract and easily detachable, along with a completed copy of the ' +
      'contract itself.'
  );

  page.drawText('WHAT THIS FORM DOES NOT TELL YOU', {
    x: M, y, size: 10, font: bold, color: INK,
  });
  y -= 18;
  for (const caveat of WHAT_THIS_DOES_NOT_KNOW) paragraph(caveat);

  const bytes = await pdf.save();
  writeFileSync(`${into}/${template.file}`, bytes);
  return { file: template.file, pages: pdf.getPageCount(), bytes: bytes.length };
}
