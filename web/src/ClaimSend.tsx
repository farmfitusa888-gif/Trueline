import { useEffect, useMemo, useState } from 'react';
import type { Room } from '../../core/src/room.ts';
import type { Damage } from '../../core/src/damage.ts';
import type { Claim } from '../../core/src/claim.ts';
import { type ClaimRoom, claimFile } from '../../core/src/claim-file.ts';
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
}: {
  readonly room: Room;
  readonly fileName: string;
  readonly damages: readonly Damage[];
  readonly claim: Claim;
}) {
  const { company } = useUnits();
  const [busy, setBusy] = useState(false);
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

  async function send() {
    setBusy(true);
    setTold(null);
    try {
      const parts: ClaimRoom[] = [
        {
          room,
          damages,
          // Every room on the document goes through the same renderer,
          // including the open one. Taking the open room's drawing off the
          // screen and the rest from a re-render would put two code paths on
          // one sheet, and the one that would be wrong is whichever nobody is
          // looking at.
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
      setBusy(false);
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
        disabled={busy}
        onClick={() => void send()}
        className="mt-3 min-h-12 w-full rounded-md bg-slate-900 px-5 font-semibold text-white
                   active:bg-slate-700 disabled:opacity-60"
      >
        {busy ? 'Putting it together…' : 'Make the claim document'}
      </button>

      <p className="mt-2 text-xs text-slate-500">
        {chosen.length + 1} room{chosen.length === 0 ? '' : 's'} · {markCount} mark
        {markCount === 1 ? '' : 's'} · {photoCount} photograph{photoCount === 1 ? '' : 's'}
        {photoCount > 0 && ' at full size, which is what makes this file big and is the point of it'}
      </p>

      {told && <p className="mt-2 text-sm text-slate-700">{told}</p>}
    </section>
  );
}
