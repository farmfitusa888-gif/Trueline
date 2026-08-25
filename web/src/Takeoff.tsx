import { useMemo, useState } from 'react';
import { formatFeetInches } from '../../core/src/length.ts';
import { type Room, formatSquareFeet } from '../../core/src/room.ts';
import { roomQuantities } from '../../core/src/zone.ts';
import { takeoff as buildTakeoff } from '../../core/src/takeoff.ts';
import { type Readiness, trustLabel } from '../../core/src/issue.ts';

/**
 * What this room takes.
 *
 * The four numbers a contractor actually prices off — floor, ceiling, the wall
 * face that takes drywall and paint, and the baseboard run. Every one of them
 * has been computable since `quantities()` was written and none of them has
 * ever reached a screen, because the plan stopped at "here is your room" and
 * left the arithmetic on a notepad at eleven at night.
 *
 * What comes *off* is the part worth reading twice. A door takes its width out
 * of the baseboard and its whole opening out of the paintable face. A window
 * takes nothing off the baseboard, because the baseboard runs underneath it. A
 * side of the room with nothing built across it — a garage door — takes no
 * drywall, no paint and no baseboard, and is reported separately rather than
 * quietly priced as wall.
 *
 * These inherit the room's honesty exactly. They are the sensor's numbers until
 * a tape has been on one wall running each way, and the card says so in the
 * same words the rest of the app uses rather than printing four figures as if
 * they were facts.
 */

const SQ_FT = 304_800_000n * 304_800_000n;

function squareFeet(squareNanometres: bigint): string {
  const tenths = (squareNanometres * 10n) / SQ_FT;
  return `${Number(tenths) / 10} sq ft`;
}

export function Takeoff({ room, readiness }: { readonly room: Room; readonly readiness: Readiness }) {
  const [open, setOpen] = useState(false);
  const [told, setTold] = useState<string | null>(null);
  const sheet = useMemo(() => buildTakeoff(room, new Date().toLocaleString()), [room]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(sheet.text);
      setTold('Copied.');
    } catch {
      setTold('This browser would not let the app reach the clipboard.');
    }
  }

  async function send() {
    // Web Share is what puts this into Messages on an iPhone, which is how a
    // takeoff actually reaches whoever is pricing it.
    if (!navigator.share) {
      void copy();
      return;
    }
    try {
      await navigator.share({ title: `${room.name} — takeoff`, text: sheet.text });
    } catch (error) {
      // Cancelling is not failing. Anything else is, and falling back to the
      // clipboard beats a button that silently does nothing twice.
      if (!(error instanceof DOMException && error.name === 'AbortError')) void copy();
    }
  }

  function spreadsheet() {
    // A file, because the person who prices this is at a desk and the thing
    // they price in eats CSV. Built and revoked in the same breath: a blob URL
    // left behind is a copy of somebody's building held in memory.
    try {
      const blob = new Blob([sheet.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${room.name.replace(/[^\w -]/g, '')} takeoff.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setTold('Saved as a spreadsheet.');
    } catch (error) {
      setTold(error instanceof Error ? error.message : 'The file could not be made.');
    }
  }
  const q = useMemo(() => {
    try {
      return { it: roomQuantities(room), trouble: null as string | null };
    } catch (error) {
      return { it: null, trouble: error instanceof Error ? error.message : String(error) };
    }
  }, [room]);

  if (!q.it) {
    return (
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <h2 className="font-semibold">The quantities could not be worked out</h2>
        <p className="mt-1">{q.trouble}</p>
      </section>
    );
  }

  const rows = [
    { what: 'Floor', value: formatSquareFeet(q.it.floorArea), prices: 'flooring, tile, underlay' },
    { what: 'Ceiling', value: formatSquareFeet(q.it.ceilingArea), prices: 'ceiling drywall and paint' },
    {
      what: 'Wall face',
      value: squareFeet(q.it.wallFaceArea),
      prices: 'drywall and paint — every door and window taken off',
    },
    {
      what: 'Baseboard',
      value: formatFeetInches(q.it.baseboardRun),
      prices: 'trim — doors taken off, windows left on',
    },
    ...(q.it.openRun > 0n
      ? [
          {
            what: 'Open span',
            value: formatFeetInches(q.it.openRun),
            prices: 'nothing built here — no drywall, no paint, no trim',
          },
        ]
      : []),
  ];

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-slate-900">What this room takes</h2>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="min-h-11 px-2 text-sm text-slate-500 underline underline-offset-4"
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </div>

      <dl className="mt-2 divide-y divide-slate-100">
        {rows.map((row) => (
          <div key={row.what} className="flex items-baseline justify-between gap-4 py-3">
            <dt className="text-slate-700">
              {row.what}
              {open && <span className="block text-xs text-slate-500">{row.prices}</span>}
            </dt>
            <dd className="shrink-0 font-semibold tabular-nums text-slate-900">{row.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 flex flex-wrap gap-2 print:hidden">
        <button
          type="button"
          onClick={() => void send()}
          className="min-h-12 rounded-md bg-slate-900 px-5 font-semibold text-white active:bg-slate-700"
        >
          Send it
        </button>
        <button
          type="button"
          onClick={() => void copy()}
          className="min-h-12 rounded-md border border-slate-300 px-4 font-medium text-slate-700 active:bg-slate-100"
        >
          Copy
        </button>
        <button
          type="button"
          onClick={spreadsheet}
          className="min-h-12 rounded-md border border-slate-300 px-4 font-medium text-slate-700 active:bg-slate-100"
        >
          Spreadsheet
        </button>
      </div>
      {told && (
        <p aria-live="polite" className="mt-2 text-sm text-slate-600">
          {told}
        </p>
      )}

      <p className="mt-2 text-sm text-slate-600">
        {readiness.blocking.length > 0 ? (
          <>
            <span className="font-semibold text-slate-900">
              These are the scanner&rsquo;s numbers, not measurements.
            </span>{' '}
            They move when you put a tape on a wall. {trustLabel(readiness.trust)}.
          </>
        ) : (
          <>Built from the walls above — {trustLabel(readiness.trust).toLowerCase()}.</>
        )}
      </p>
    </section>
  );
}
