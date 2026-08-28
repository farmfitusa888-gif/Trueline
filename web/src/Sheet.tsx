import { useState } from 'react';
import type { Room } from '../../core/src/room.ts';
import { readiness } from '../../core/src/issue.ts';
import { roomToDxf } from '../../core/src/dxf/room.ts';
import { isPresentable, pricing } from '../../core/src/company.ts';
import type { WorkScope } from '../../core/src/work.ts';
import { sheetOf } from './quoteOf.ts';
import { quote } from '../../core/src/price.ts';
import { photosOfWall, type Photo } from '../../core/src/photo.ts';
import { clientFile } from './clientFile.ts';
import { fileNameFor, planPng, planSvg, printOnly, sendFile, sendPicture } from './sheet.ts';
import {
  type Override,
  applyOverrides,
  provenanceOf,
} from '../../core/src/override.ts';
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

/**
 * The best photograph of each wall, shrunk to something that can be texted.
 *
 * One scan's photographs are 26 MB, and a client file that will not go through
 * a message has failed at the only thing it does. So: one picture per wall, the
 * one showing most of it, drawn into a canvas at a few hundred pixels and
 * encoded as a JPEG. A homeowner looking at a photograph of their own kitchen
 * gets far more out of the file than one looking at a line drawing, and this is
 * the version of that which fits.
 */
async function smallShots(
  room: Room,
  photos: readonly Photo[],
  len: (v: bigint) => string
): Promise<{ src: string; caption: string }[]> {
  const out: { src: string; caption: string }[] = [];
  for (const wall of room.walls) {
    if (wall.open) continue;
    const best = photosOfWall(photos, room, wall.id)[0];
    if (!best?.photo.fileName) continue;
    try {
      const shrunk = await shrink(`photos/${best.photo.fileName}`, best.photo.upright ?? 0);
      out.push({ src: shrunk, caption: `${len(best.inFrame.visibleLength)} of one wall` });
    } catch {
      // A picture that will not load is left out. The file is still a file.
    }
    if (out.length >= 6) break;
  }
  return out;
}

/** One photograph, turned the right way up and made small enough to send. */
async function shrink(src: string, upright: number, side = 560): Promise<string> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('not there'));
    image.src = src;
  });
  const quarter = upright === 90 || upright === 270;
  const width = quarter ? image.naturalHeight : image.naturalWidth;
  const height = quarter ? image.naturalWidth : image.naturalHeight;
  const scale = Math.min(1, side / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no canvas');
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((upright * Math.PI) / 180);
  context.drawImage(
    image,
    (-image.naturalWidth * scale) / 2,
    (-image.naturalHeight * scale) / 2,
    image.naturalWidth * scale,
    image.naturalHeight * scale
  );
  return canvas.toDataURL('image/jpeg', 0.72);
}

export function Sheet({
  room,
  photos,
  overrides,
  scope,
}: {
  readonly room: Room;
  readonly photos: readonly Photo[];
  readonly overrides: readonly Override[];
  /**
   * What is being done to each surface, or `null` for a room nobody has
   * scoped — which is priced exactly as this app has always priced one.
   */
  readonly scope: WorkScope | null;
}) {
  const { company, len } = useUnits();
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

  /**
   * One file a homeowner can open, with no app and no login.
   *
   * Matterport's whole business is this one feature and they charge from $65 a
   * month for it. It needs no server: everything a client should see fits in a
   * single HTML file that can be texted, emailed or AirDropped, and then opened
   * on anything, offline, forever, by somebody who has never heard of this app.
   */
  async function forClient() {
    setBusy(true);
    setTold(null);
    try {
      const svg = document.querySelector<SVGSVGElement>('svg[aria-label^="Plan of"]');
      const sheet = sheetOf(room, company, scope, new Date().toLocaleString());
      const { book } = pricing(company);
      const applied = applyOverrides(sheet.lines, overrides);
      const costed = quote(
        applied.lines.map((line) => ({ ...line, provenance: provenanceOf(line) })),
        book
      );
      const shots = await smallShots(room, photos, len);
      const html = clientFile({
        room,
        company,
        lines: applied.lines,
        ...(costed.lines.length > 0 ? { quote: costed } : {}),
        plan: svg,
        photos: shots,
        at: new Date().toLocaleDateString(),
      });
      const said = await sendFile(
        new Blob([html], { type: 'text/html;charset=utf-8' }),
        fileNameFor(room.name, 'html'),
        // What the share sheet shows, and what the hand-over record keeps.
        // A bare file name told the contractor nothing about which document
        // he was about to send.
        `${room.name} — for the client`
      );
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

      {/* Whose drawing this is, before it goes to somebody's client.
          `isPresentable` is the profile's own answer to "is there enough here
          to put on something a client will see", and nothing asked it -- so a
          sheet could go out with a blank title block and the first anybody
          knew was the client asking who sent it. Never blocking: it is his
          drawing and his call. */}
      {!isPresentable(company) && (
        <p className="mt-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          Your business details are not filled in, so this goes out with a blank title block — no
          name, no phone number, no licence. Two minutes under <strong>Your business</strong> puts
          them on every sheet from now on. Nothing stops you sending it as it is.
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2 print:hidden">
        <button
          type="button"
          onClick={() => void forClient()}
          disabled={busy}
          className="min-h-12 rounded-md bg-slate-900 px-5 font-semibold text-white active:bg-slate-700
                     disabled:opacity-60"
        >
          {busy ? 'Making it…' : 'Send to the client'}
        </button>
        <button
          type="button"
          onClick={() => void picture()}
          disabled={busy}
          className="min-h-12 rounded-md border border-slate-300 px-4 font-medium text-slate-700
                     active:bg-slate-100 disabled:opacity-60"
        >
          Just the drawing
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
        <strong className="font-semibold text-slate-700">Send to the client</strong> makes one
        file with the drawing, the room, what it takes, what it costs and a few photographs in
        it — your name at the top. They open it in any browser: no app, no login, no account,
        and it still works in five years with no signal.
      </p>
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
