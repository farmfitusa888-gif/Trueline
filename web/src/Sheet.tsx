import { useState } from 'react';
import type { Room } from '../../core/src/room.ts';
import { readiness } from '../../core/src/issue.ts';
import { roomToDxf } from '../../core/src/dxf/room.ts';
import { fileNameFor, planPng, planSvg, printOnly, sendFile, sendPicture } from './sheet.ts';
import { useUnits } from './units.tsx';

/**
 * Getting the drawing to somebody who is not holding this phone.
 *
 * A client wants a picture in a message. A sub wants a sheet of paper on the
 * tailgate. Both come from the `<svg>` that is on the screen right now — cloned,
 * not re-rendered — so what somebody else ends up holding cannot say anything
 * different from what the person who made it was looking at.
 *
 * The title block goes with them both, and it carries the caveat. A drawing of
 * an unchecked scan that leaves this device without saying so is a guess in a
 * frame, and nothing downstream of it will ever mention that again.
 */

export function Sheet({ room }: { readonly room: Room }) {
  const { company } = useUnits();
  const [told, setTold] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const unchecked = readiness(room).blocking.length > 0;

  /**
   * The drawing as CAD, for whoever asks for one.
   *
   * magicplan's own help page says their DXF to SketchUp and AutoCAD does not
   * include dimensions, so an architect or a cabinet shop gets a shape with no
   * numbers on it and measures the building again. This one carries them — and
   * it carries the thing nothing else about provenance survives the trip into
   * CAD: the measured walls are dimensioned on their own layer, so switching one
   * layer off in a viewer shows exactly which numbers anybody stood behind.
   */
  async function cad() {
    setBusy(true);
    setTold(null);
    try {
      const { dxf } = roomToDxf(room, {
        units: company.units === 'metric' ? 'mm' : 'in',
        company: company.name,
        at: new Date().toLocaleDateString(),
      });
      const said = await sendFile(
        new Blob([dxf], { type: 'application/dxf' }),
        fileNameFor(room.name, 'dxf'),
        `${room.name} — drawing`
      );
      if (said) setTold(said);
    } catch (error) {
      setTold(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function picture() {
    setBusy(true);
    setTold(null);
    try {
      // The one on screen. If the 3D view is showing there is no plan to save,
      // and saying so beats saving whatever else happens to be an svg.
      const svg = document.querySelector<SVGSVGElement>('svg[aria-label^="Plan of"]');
      if (!svg) {
        setTold('Switch to Blueprint first — the drawing is what gets saved, not the 3D view.');
        return;
      }
      const blob = await planPng(planSvg(svg));
      const said = await sendPicture(blob, fileNameFor(room.name, 'png'), `${room.name} — plan`);
      if (said) setTold(said);
    } catch (error) {
      setTold(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-sheet="no" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="font-semibold text-slate-900">Send the drawing</h2>
      <p className="mt-1 text-sm text-slate-600">
        The plan as it is on the screen, with its title block — the room, the area, and whether
        anybody has put a tape on it.
        {unchecked && (
          <>
            {' '}
            <span className="font-semibold text-amber-800">
              It will say these are the scanner&rsquo;s numbers, because they are.
            </span>
          </>
        )}
      </p>

      <div className="mt-3 flex flex-wrap gap-2 print:hidden">
        <button
          type="button"
          onClick={() => void picture()}
          disabled={busy}
          className="min-h-12 rounded-md bg-slate-900 px-5 font-semibold text-white active:bg-slate-700
                     disabled:opacity-60"
        >
          {busy ? 'Making it…' : 'Save as a picture'}
        </button>
        <button
          type="button"
          onClick={() => printOnly('plan')}
          className="min-h-12 rounded-md border border-slate-300 px-4 font-medium text-slate-700 active:bg-slate-100"
        >
          Print it
        </button>
        <button
          type="button"
          onClick={() => void cad()}
          disabled={busy}
          className="min-h-12 rounded-md border border-slate-300 px-4 font-medium text-slate-700
                     active:bg-slate-100 disabled:opacity-60"
        >
          CAD drawing
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500 print:hidden">
        The CAD drawing is a DXF — it opens in AutoCAD, SketchUp and the free Autodesk viewer,
        and it keeps its dimensions. Walls you have taped are dimensioned on their own layer, so
        whoever opens it can switch off everything nobody stood behind.
      </p>

      {told && (
        <p aria-live="polite" className="mt-2 text-sm text-slate-600">
          {told}
        </p>
      )}
    </section>
  );
}
