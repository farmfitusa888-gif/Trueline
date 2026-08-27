import { useEffect, useMemo, useState } from 'react';
import type { Room } from '../../core/src/room.ts';
import type { Damage } from '../../core/src/damage.ts';
import type { Claim } from '../../core/src/claim.ts';
import type { WorkScope } from '../../core/src/work.ts';
import { type ClaimRoom, claimFile } from '../../core/src/claim-file.ts';
import { claimReport } from '../../core/src/claim.ts';
import { showArea, showLength } from '../../core/src/company.ts';
import { planSvgFor } from './renderPlan.tsx';
import { savedRooms } from './floorStore.ts';
import { asDataUrl, fetchPhoto } from './photoStore.ts';
import { fileNameFor, sendFile } from './sheet.ts';
import { useUnits } from './units.tsx';

/**
 * The claim, as one file somebody can send.
 *
 * A loss is a job and a job is rooms, so this gathers every room on the device
 * and lets the contractor tick the ones the claim covers. A basement flood must
 * not arrive at an adjuster carrying the untouched bedrooms — a document with
 * rooms in it that have nothing wrong with them reads as padding, and padding
 * is what gets a whole claim looked at twice.
 *
 * The room that is open is always in and always first: it is the one being
 * worked on, and its damage may be newer than anything in storage.
 *
 * **No prices on it.** The measurements and the evidence go to the adjuster;
 * the priced scope is the sheet that follows once the scope is agreed. An
 * adjuster who reads a number first negotiates against it.
 */

/** Every photograph named by a set of damages, as data URLs, for embedding. */
async function gather(damages: readonly Damage[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const damage of damages) {
    for (const name of damage.photos) {
      if (out.has(name)) continue;
      const blob = await fetchPhoto(name);
      if (!blob) continue;
      try {
        out.set(name, await asDataUrl(blob));
      } catch {
        // A picture that will not read is named on the document instead of
        // being silently absent. `claimFile` says which one and where it is.
      }
    }
  }
  return out;
}

export function ClaimSend({
  room,
  fileName,
  damages,
  claim,
  scope,
}: {
  readonly room: Room;
  readonly fileName: string;
  readonly damages: readonly Damage[];
  readonly claim: Claim;
  /**
   * What is being done to each surface of the open room, or `null` when nobody
   * has scoped it. The archive carries the open room's takeoff, so it carries
   * this with it — otherwise the CSV in the zip prices a gut job while every
   * screen in the app prices the real one.
   */
  readonly scope: WorkScope | null;
}) {
  const { company } = useUnits();
  const [busy, setBusy] = useState<'html' | 'pdf' | 'job' | null>(null);
  const [told, setTold] = useState<string | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());

  // Every other room this device holds. The open one is excluded because it is
  // always included, and offering to tick it off would offer to build a claim
  // document about a job with the room somebody is standing in left out of it.
  const others = useMemo(
    () => savedRooms().filter((saved) => saved.fileName !== fileName),
    [fileName]
  );

  // Rooms with damage marked on them start ticked. A contractor who scanned
  // four rooms and marked two of them means those two, and making him tick
  // them again is asking him to repeat himself.
  useEffect(() => {
    setTicked(new Set(others.filter((o) => o.damages.length > 0).map((o) => o.fileName)));
  }, [others]);

  const chosen = others.filter((o) => ticked.has(o.fileName));

  /** Every room's parts, gathered once and used by both documents. */
  async function gatherRooms(): Promise<ClaimRoom[]> {
    const parts: ClaimRoom[] = [
      {
        room,
        damages,
        plan: planSvgFor(room, damages),
        photos: await gather(damages),
      },
    ];
    for (const saved of chosen) {
      parts.push({
        room: saved.room,
        damages: saved.damages,
        plan: planSvgFor(saved.room, saved.damages),
        photos: await gather(saved.damages),
      });
    }
    return parts;
  }

  /**
   * The same document, as a PDF.
   *
   * Not a print of the HTML: a carrier's claim system takes PDFs, and a browser
   * print is unavailable inside a web view without a gesture, differs on every
   * platform and cannot be tested. This is laid out as arithmetic on a page.
   */
  async function sendPdf() {
    setBusy('pdf');
    setTold(null);
    try {
      const parts = await gatherRooms();
      // One room per PDF. A carrier attaches a document per room, and a
      // fourteen-page file covering four rooms is a file somebody splits by
      // hand before they can use it.
      const first = parts[0]!;
      const bytes = new Map<string, Uint8Array>();
      const byDamage = new Map<string, readonly string[]>();
      for (const damage of first.damages) {
        byDamage.set(damage.id, damage.photos);
        for (const name of damage.photos) {
          const url = first.photos.get(name);
          if (!url) continue;
          const comma = url.indexOf(',');
          if (comma === -1) continue;
          const binary = atob(url.slice(comma + 1));
          const out = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
          bytes.set(name, out);
        }
      }
      // pdf-lib is 450 kB and a remodeler never touches this button, so it is
      // fetched the first time somebody actually asks for a PDF rather than
      // riding along in the bundle every scan pays to load. Vite splits it out
      // on the dynamic import.
      const { claimPdf } = await import('./claimPdf.ts');
      const pdf = await claimPdf({
        report: claimReport(first.room, first.damages, claim, new Date().toLocaleDateString(), {
          len: (v) => showLength(v, company.units),
          area: (a) => showArea(a, company.units),
        }),
        company,
        photos: byDamage,
        bytes,
        at: new Date().toLocaleDateString(),
      });
      const said = await sendFile(
        new Blob([pdf as BlobPart], { type: 'application/pdf' }),
        fileNameFor(claim.claimNumber?.trim() || room.name, 'pdf', 'claim'),
        claim.claimNumber ? `Claim ${claim.claimNumber}` : `${room.name} — claim`
      );
      if (said) setTold(said);
    } catch (error) {
      setTold(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  /**
   * The whole job in one archive.
   *
   * Six things that would otherwise be six attachments and a seventh somebody
   * forgets. Not an .esx — see `core/src/job-file.ts` — and it says so inside
   * itself, because a file that quietly is not an ESX is a file somebody sends
   * expecting Xactimate to open it.
   */
  async function sendJob() {
    setBusy('job');
    setTold(null);
    try {
      const parts = await gatherRooms();
      const first = parts[0]!;
      const at = new Date().toLocaleDateString();

      const html = claimFile({ rooms: parts, claim, company, at });

      // Photographs as bytes rather than data URLs: an archive should carry the
      // picture, not a base64 spelling of it a third larger.
      const bytes = new Map<string, Uint8Array>();
      for (const [name, url] of first.photos) {
        const comma = url.indexOf(',');
        if (comma === -1) continue;
        const binary = atob(url.slice(comma + 1));
        const out = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
        bytes.set(name, out);
      }

      let pdf: Uint8Array | undefined;
      try {
        const { claimPdf } = await import('./claimPdf.ts');
        const byDamage = new Map(first.damages.map((d) => [d.id, d.photos]));
        pdf = await claimPdf({
          report: claimReport(first.room, first.damages, claim, at, {
            len: (v) => showLength(v, company.units),
            area: (a) => showArea(a, company.units),
          }),
          company,
          photos: byDamage,
          bytes,
          at,
        });
      } catch {
        // An archive without the PDF is still the archive. The manifest lists
        // what is actually in it rather than what was meant to be.
      }

      const { jobFile } = await import('./jobFile.ts');
      const zip = await jobFile({
        room: first.room,
        damages: first.damages,
        claim,
        company,
        html,
        ...(pdf ? { pdf } : {}),
        photos: bytes,
        scope,
        at,
      });
      const said = await sendFile(
        zip,
        fileNameFor(claim.claimNumber?.trim() || room.name, 'zip', 'job'),
        claim.claimNumber ? `Claim ${claim.claimNumber}` : `${room.name} — the job`
      );
      if (said) setTold(said);
    } catch (error) {
      setTold(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    setBusy('html');
    setTold(null);
    try {
      // Every room on the document goes through the same renderer, including
      // the open one. Taking the open room's drawing off the screen and the
      // rest from a re-render would put two code paths on one sheet, and the
      // one that would be wrong is whichever nobody is looking at.
      const parts = await gatherRooms();

      const html = claimFile({
        rooms: parts,
        claim,
        company,
        at: new Date().toLocaleDateString(),
      });
      const said = await sendFile(
        new Blob([html], { type: 'text/html;charset=utf-8' }),
        fileNameFor(claim.claimNumber?.trim() || room.name, 'html', 'claim'),
        claim.claimNumber ? `Claim ${claim.claimNumber}` : `${room.name} — claim`
      );
      if (said) setTold(said);
    } catch (error) {
      setTold(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  const photoCount =
    damages.reduce((n, d) => n + d.photos.length, 0) +
    chosen.reduce((n, o) => n + o.damages.reduce((m, d) => m + d.photos.length, 0), 0);
  const markCount = damages.length + chosen.reduce((n, o) => n + o.damages.length, 0);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-sheet="no">
      <h2 className="font-semibold text-slate-900">Send it to the adjuster</h2>
      <p className="mt-1 text-sm text-slate-600">
        One file: the drawings, every damaged area with what it measures, the moisture readings
        and the photographs at full size. It opens on anything, with no app and no login, and it
        works with no signal because nothing in it is fetched.
      </p>
      <p className="mt-1 text-sm text-slate-600">
        <strong>No prices are on it.</strong> The scope and what it costs is the sheet you send
        after the scope is agreed — an adjuster who reads your number first negotiates against it.
      </p>

      {others.length > 0 && (
        <fieldset className="mt-3">
          <legend className="text-sm font-medium text-slate-700">Which rooms this claim covers</legend>
          <ul className="mt-1 divide-y divide-slate-100">
            <li className="flex items-baseline justify-between gap-3 py-2">
              <span className="text-slate-800">
                {room.name}
                <span className="block text-xs text-slate-500">
                  open now · {damages.length} mark{damages.length === 1 ? '' : 's'}
                </span>
              </span>
              <span className="shrink-0 text-xs text-slate-500">always in</span>
            </li>
            {others.map((saved) => (
              <li key={saved.fileName} className="py-1">
                <label className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    checked={ticked.has(saved.fileName)}
                    onChange={(event) => {
                      const next = new Set(ticked);
                      if (event.target.checked) next.add(saved.fileName);
                      else next.delete(saved.fileName);
                      setTicked(next);
                    }}
                    className="h-5 w-5 shrink-0 rounded border-slate-300"
                  />
                  <span className="text-slate-800">
                    {saved.room.name}
                    <span className="block text-xs text-slate-500">
                      {saved.damages.length === 0
                        ? 'nothing marked on it'
                        : `${saved.damages.length} mark${saved.damages.length === 1 ? '' : 's'}`}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      <button
        type="button"
        disabled={busy !== null}
        onClick={() => void send()}
        className="mt-3 min-h-12 w-full rounded-md bg-slate-900 px-5 font-semibold text-white
                   active:bg-slate-700 disabled:opacity-60"
      >
        {busy === 'html' ? 'Putting it together…' : 'Make the claim document'}
      </button>

      <button
        type="button"
        disabled={busy !== null}
        onClick={() => void sendPdf()}
        className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-4 text-sm
                   font-medium text-slate-700 active:bg-slate-100 disabled:opacity-60"
      >
        {busy === 'pdf' ? 'Drawing it…' : 'As a PDF instead'}
      </button>
      <p className="mt-1 text-xs text-slate-500">
        The file above is the better document — the drawing in it is a real drawing rather than a
        picture of one, and it opens on anything. Send the PDF when the carrier&rsquo;s system
        wants one, which most of them do. It is this room only: a claim system takes a document
        per room, and one file covering four is a file somebody splits by hand.
      </p>

      <button
        type="button"
        disabled={busy !== null}
        onClick={() => void sendJob()}
        className="mt-3 min-h-11 w-full rounded-md border border-slate-300 px-4 text-sm
                   font-medium text-slate-700 active:bg-slate-100 disabled:opacity-60"
      >
        {busy === 'job' ? 'Packing it…' : 'Everything, in one archive'}
      </button>
      <p className="mt-1 text-xs text-slate-500">
        The claim both ways, the drawing as CAD, the room&rsquo;s takeoff and the damage scope as
        spreadsheets, and the photographs as they were taken — with a plain list inside saying
        what each thing is for.{' '}
        <strong>It is not an .esx and Xactimate will not open it.</strong> ESX is Verisk&rsquo;s
        own format and every tool that writes one has a partnership with them to do it; this
        carries the same things in formats anything can read.
      </p>

      <p className="mt-2 text-xs text-slate-500">
        {chosen.length + 1} room{chosen.length === 0 ? '' : 's'} · {markCount} mark
        {markCount === 1 ? '' : 's'} · {photoCount} photograph{photoCount === 1 ? '' : 's'}
        {photoCount > 0 && ' at full size, which is what makes this file big and is the point of it'}
      </p>

      {told && <p className="mt-2 text-sm text-slate-700">{told}</p>}
    </section>
  );
}
