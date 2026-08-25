import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, StandardFonts, rgb } from 'pdf-lib';
import { type ClaimPdfParts, PAGE, type Pen, drawClaim } from '../../core/src/claim-pdf.ts';

/**
 * The pen that actually draws, on top of pdf-lib.
 *
 * Everything about *where* things go is in `core/src/claim-pdf.ts`, which knows
 * nothing about pdf-lib and is driven in tests by a pen that records instead of
 * drawing. This file is the other half: fonts, colours, pages and bytes. It is
 * deliberately thin, because it is the half that cannot be tested here.
 */

const INK = rgb(0.06, 0.09, 0.16);
const GREY = rgb(0.39, 0.45, 0.55);
const RULE = rgb(0.89, 0.91, 0.94);

/** JPEG or PNG only — the two pdf-lib embeds, and the two a phone produces. */
async function embed(pdf: PDFDocument, bytes: Uint8Array): Promise<PDFImage> {
  const isPng =
    bytes.length > 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  return isPng ? pdf.embedPng(bytes) : pdf.embedJpg(bytes);
}

export interface PdfPhoto {
  readonly id: string;
  readonly bytes: Uint8Array;
}

export async function claimPdf(
  parts: Omit<ClaimPdfParts, 'photos'> & {
    /** Which photographs belong to which damage, in order. */
    readonly photos: ReadonlyMap<string, readonly string[]>;
    /** The bytes for each of those ids. A missing id is simply not drawn. */
    readonly bytes: ReadonlyMap<string, Uint8Array>;
  }
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const plain = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Embedded once each, before drawing, because a photograph used twice should
  // be one object in the file rather than two copies of a megabyte.
  const images = new Map<string, PDFImage>();
  for (const [id, bytes] of parts.bytes) {
    try {
      images.set(id, await embed(pdf, bytes));
    } catch {
      // A picture pdf-lib will not take is left out rather than taking the
      // document down. The report already names photographs it cannot show.
    }
  }

  let page: PDFPage = pdf.addPage([PAGE.width, PAGE.height]);
  const font = (isBold?: boolean): PDFFont => (isBold ? bold : plain);

  const pen: Pen = {
    newPage() {
      page = pdf.addPage([PAGE.width, PAGE.height]);
    },
    text(value, at, style) {
      page.drawText(value, {
        x: at.x,
        y: at.y,
        size: style.size,
        font: font(style.bold),
        color: style.grey ? GREY : INK,
      });
    },
    widthOf(value, size, isBold) {
      return font(isBold).widthOfTextAtSize(value, size);
    },
    line(from, to, grey) {
      page.drawLine({
        start: from,
        end: to,
        thickness: grey ? 0.5 : 1,
        color: grey ? RULE : INK,
      });
    },
    image(id, box) {
      const found = images.get(id);
      if (!found) return;
      page.drawImage(found, box);
    },
    ratioOf(id) {
      const found = images.get(id);
      // A missing picture gets no height, so nothing is reserved for it.
      return found ? found.height / found.width : 0;
    },
  };

  // Only the photographs that actually embedded are offered to the layout, so
  // it does not leave a gap where one failed.
  const kept = new Map<string, readonly string[]>();
  for (const [damageId, ids] of parts.photos) {
    kept.set(damageId, ids.filter((id) => images.has(id)));
  }

  drawClaim(pen, { report: parts.report, company: parts.company, photos: kept, at: parts.at });
  return pdf.save();
}
