import JSZip from 'jszip';
import type { Damage } from '../../core/src/damage.ts';
import type { Room } from '../../core/src/room.ts';
import type { Claim } from '../../core/src/claim.ts';
import type { Company } from '../../core/src/company.ts';
import { claimReport } from '../../core/src/claim.ts';
import { showArea, showLength } from '../../core/src/company.ts';
import { type JobEntry, jobManifest, safeName } from '../../core/src/job-file.ts';
import { damageScope } from '../../core/src/scope.ts';
import type { WorkScope } from '../../core/src/work.ts';
import { workItems } from '../../core/src/work.ts';
import { takeoff } from '../../core/src/takeoff.ts';
import { roomToDxf } from '../../core/src/dxf/room.ts';

/**
 * One archive with the whole job in it.
 *
 * Six things an adjuster or a sub would otherwise be sent separately, and the
 * seventh that gets forgotten. Every piece of it is something this app already
 * produces and has already been verified: the claim document opened offline
 * with nothing fetched, the PDF read page by page, the DXF drawn in a real CAD
 * renderer, the CSVs checked line by line.
 *
 * **Deliberately not an .esx.** See `core/src/job-file.ts` for why, and the
 * manifest says so inside the archive as well, because a file that quietly is
 * not an ESX is a file somebody sends expecting Xactimate to open it.
 */

export interface JobFileParts {
  readonly room: Room;
  readonly damages: readonly Damage[];
  readonly claim: Claim;
  readonly company: Company;
  /** The claim document, already built, so both come from one report. */
  readonly html: string;
  /** The PDF of the same, or nothing when it could not be made. */
  readonly pdf?: Uint8Array;
  /** Photograph bytes by name, as they were taken. */
  readonly photos: ReadonlyMap<string, Uint8Array>;
  /**
   * What is being done to each surface, or `null` for a room nobody scoped.
   *
   * The archive is what leaves the building, so it is the last place a stale
   * takeoff can hide. Without this the CSV in the zip would still price the
   * whole room as a gut job while every screen priced the real one.
   */
  readonly scope: WorkScope | null;
  readonly at: string;
}

export async function jobFile(parts: JobFileParts): Promise<Blob> {
  const { room, damages, claim, company, html, pdf, photos, scope, at } = parts;
  const zip = new JSZip();
  const contents: JobEntry[] = [];

  const put = (path: string, what: string, body: string | Uint8Array): void => {
    zip.file(path, body);
    contents.push({ path, what });
  };

  const stem = safeName(claim.claimNumber?.trim() || room.name, 'job');

  put(
    `${stem} claim.html`,
    'The claim, to read. Opens in any browser with no network — the drawing in it is a real ' +
      'drawing rather than a picture of one.',
    html
  );
  if (pdf) {
    put(
      `${stem} claim.pdf`,
      'The same claim, for a system that wants a PDF. Same numbers, laid out for paper.',
      pdf
    );
  }

  // The drawing as CAD, so an architect or a cabinet shop gets numbers rather
  // than a shape they have to measure again.
  try {
    put(
      `${safeName(room.name, 'room')} plan.dxf`,
      'The drawing as CAD. The walls somebody put a tape on are dimensioned on their own layer, ' +
        'so switching one layer off shows exactly which numbers anybody stood behind.',
      roomToDxf(room, {
        units: company.units === 'metric' ? 'mm' : 'in',
        company: company.name,
        at,
      }).dxf
    );
  } catch {
    // A room the DXF writer refuses is a room with something in it the format
    // cannot say. The rest of the archive is still worth having.
  }

  const sheet = takeoff(room, at, {
    company: company.name,
    ...(scope ? { work: { scope, items: workItems(company.prices ?? { rates: [] }) } } : {}),
  });
  put(
    `${safeName(room.name, 'room')} takeoff.csv`,
    'What the room takes, every row carrying its own unit and whether anybody measured it.',
    sheet.csv
  );

  if (damages.length > 0) {
    const scope = damageScope(room, damages, at);
    put(
      `${stem} damage scope.csv`,
      'What the damage takes — tear-out, protect and rebuild — kept apart from the room’s own ' +
        'takeoff, because the two are priced by different people out of different money.',
      scope.csv
    );
    put(`${stem} damage scope.txt`, 'The same scope, to read or to text.', scope.text);
  }

  for (const [name, bytes] of photos) {
    put(
      `photos/${safeName(name, 'photo.jpg')}`,
      'A photograph of the damage, at the size it was taken.',
      bytes
    );
  }

  const manifest = jobManifest({
    report: claimReport(room, damages, claim, at, {
      len: (v) => showLength(v, company.units),
      area: (a) => showArea(a, company.units),
    }),
    company,
    ...(claim.claimNumber ? { claimNumber: claim.claimNumber } : {}),
    at,
    contents,
  });
  // Last, so it lists everything else. And as text as well as JSON: the person
  // who opens this in Windows Explorer is not going to read a .json.
  zip.file('what is in here.json', JSON.stringify(manifest, null, 2));
  zip.file(
    'what is in here.txt',
    [
      manifest.room,
      manifest.claimNumber ? `Claim ${manifest.claimNumber}` : '',
      `Prepared ${manifest.preparedAt}${manifest.preparedBy ? ` by ${manifest.preparedBy}` : ''}`,
      '',
      ...manifest.contents.map((c) => `${c.path}\n    ${c.what}`),
      '',
      manifest.caveat,
      ...(manifest.missing.length > 0
        ? ['', `This claim is still missing ${manifest.missing.join(', ')}.`]
        : []),
      '',
      manifest.notAnEsx,
    ]
      .filter((line) => line !== undefined)
      .join('\n')
  );

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
