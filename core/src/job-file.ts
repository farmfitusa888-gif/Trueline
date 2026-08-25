import type { ClaimReport } from './claim.ts';
import type { Company } from './company.ts';

/**
 * Everything about one job, in one archive.
 *
 * The claim document, the PDF of it, the drawing as CAD, the scope, and the
 * photographs at full size — one file to attach, rather than an email with six
 * things on it and a seventh forgotten.
 *
 * **This is not an ESX and does not pretend to be one.** ESX is Xactimate's
 * native format; it is a zip, but its schema is not published and every
 * integration that writes one — Encircle, iGUIDE, magicplan — announced a
 * partnership with Verisk to do it. Writing a speculative one and calling it an
 * export would ship a file that cannot be verified to open, which is worse than
 * not having the button. When there is a partnership the contents below are
 * what an ESX needs; only the wrapper changes.
 *
 * The manifest is here rather than in the zipping code because it is the part
 * worth testing: it says what is in the archive, what each thing is for, and —
 * the part that matters — whether anybody has put a tape on the room these
 * numbers came from. A caveat that travels with the drawing and not with the
 * spreadsheet is a caveat somebody works around.
 */

export interface JobEntry {
  /** Where it sits in the archive. */
  readonly path: string;
  /** What it is, in words, for somebody looking at a folder of files. */
  readonly what: string;
}

export interface JobManifest {
  readonly schema: 'trueline.job.v1';
  readonly room: string;
  readonly claimNumber?: string;
  readonly preparedAt: string;
  readonly preparedBy?: string;
  readonly contents: readonly JobEntry[];
  /**
   * The same sentence that is on the drawing and on the document.
   *
   * Repeated deliberately. Somebody opens the CSV in a spreadsheet, prices off
   * it, and never sees the drawing — so the caveat has to be in the archive at
   * a level above any one file in it.
   */
  readonly caveat: string;
  /** What is missing from the claim, said here too. */
  readonly missing: readonly string[];
  /**
   * Said out loud, because somebody will ask.
   *
   * A file that quietly is not an ESX is a file somebody sends to an adjuster
   * expecting Xactimate to open it.
   */
  readonly notAnEsx: string;
}

export const NOT_AN_ESX =
  'This is not an .esx and Xactimate will not open it. ESX is Verisk’s own format; its schema ' +
  'is not published, and every tool that writes one has a partnership with Verisk to do it. ' +
  'Everything an ESX would carry is in here in formats anything can read — the drawing as DXF, ' +
  'the quantities as CSV, the claim as PDF and HTML, the photographs as they were taken.';

export function jobManifest(parts: {
  readonly report: ClaimReport;
  readonly company: Company;
  readonly claimNumber?: string;
  readonly at: string;
  readonly contents: readonly JobEntry[];
}): JobManifest {
  const { report, company, claimNumber, at, contents } = parts;
  return {
    schema: 'trueline.job.v1',
    room: report.heading,
    ...(claimNumber?.trim() ? { claimNumber: claimNumber.trim() } : {}),
    preparedAt: at,
    ...(company.name.trim() ? { preparedBy: company.name.trim() } : {}),
    contents,
    caveat: report.caveat,
    missing: report.missing,
    notAnEsx: NOT_AN_ESX,
  };
}

/**
 * A file name that survives being emailed, unzipped on Windows and searched.
 *
 * Anything but letters, digits, space, dash and dot goes. A claim number with a
 * slash in it — and they have slashes — makes a folder somebody did not ask
 * for, in an archive, which is how a photograph ends up somewhere nothing
 * looks for it.
 */
export function safeName(value: string, fallback: string): string {
  const clean = value.replace(/[^\w .-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return clean === '' ? fallback : clean.slice(0, 80);
}
