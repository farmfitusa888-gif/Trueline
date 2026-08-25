import { useState } from 'react';
import { useUnits } from './units.tsx';
import { isVerified, toleranceOf } from '../../core/src/measurement.ts';
import { type Opening, type Room, type Wall, runLength } from '../../core/src/room.ts';
import { Measure } from './Measure.tsx';

/**
 * The doors and windows in the wall somebody has selected, and their real sizes.
 *
 * These are the numbers a scan is worst at. RoomPlan called a 16 ft 11 in span a
 * window in Sam's garage, and a kitchen door came back 2 ft 7 in wide — nobody
 * carries a sheet of plywood through that. The sizes land anywhere from an inch
 * to a foot off, which is exactly the range that never looks wrong on a screen
 * and is wrong on the order.
 *
 * So every one of them is shown with its band, marked scanned or measured like
 * everything else, and every one is correctable. Correcting one moves no walls:
 * an opening is a hole in a wall, not a side of the building.
 */

export type OpeningField = 'width' | 'height' | 'sillHeight' | 'offsetFromStart';

const NOUN: Record<Opening['kind'], string> = {
  door: 'Door',
  window: 'Window',
  cased: 'Cased opening',
};

function band(measurement: { provenance: unknown }, len: (v: bigint) => string): string {
  const m = measurement as Parameters<typeof isVerified>[0];
  return isVerified(m) ? 'measured' : `± ${len(toleranceOf(m))}`;
}

function Row({
  label,
  value,
  note,
  hint,
  onSubmit,
}: {
  readonly label: string;
  readonly value: string;
  readonly note: string;
  readonly hint: string;
  readonly onSubmit: (text: string) => void;
}) {
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-slate-700">{label}</span>
        <span className="shrink-0 text-sm tabular-nums text-slate-900">
          {value} <span className="text-xs text-slate-500">{note}</span>
        </span>
      </div>
      <div className="mt-1 print:hidden">
        <Measure label={hint} onSubmit={onSubmit} />
      </div>
    </div>
  );
}

export function Openings({
  room,
  wall,
  onSet,
}: {
  readonly room: Room;
  readonly wall: Wall;
  readonly onSet: (openingId: string, field: OpeningField, text: string) => void;
}) {
  const { len } = useUnits();
  const [open, setOpen] = useState<string | null>(null);
  const openings = wall.openings ?? [];
  if (openings.length === 0) return null;

  return (
    <div className="mt-4 border-t border-sky-200 pt-3">
      <h3 className="text-sm font-semibold text-slate-900">
        In this wall — {len(runLength(wall))} of it
      </h3>
      <p className="mt-1 text-sm text-slate-600">
        The scanner is worse at these than at walls. A door is nearly always 6&rsquo;8&quot;, and
        one scan called a 16&nbsp;ft span a window. Tape anything you intend to order.
      </p>

      <ul className="mt-2 divide-y divide-sky-200">
        {openings.map((o) => {
          const showing = open === o.id;
          return (
            <li key={o.id} className="py-2">
              <button
                type="button"
                onClick={() => setOpen(showing ? null : o.id)}
                className="flex min-h-11 w-full items-baseline justify-between gap-3 text-left"
              >
                <span className="text-slate-800">
                  {NOUN[o.kind]}
                  <span className="block text-xs text-slate-500">
                    {len(o.offsetFromStart.value)} from the corner
                  </span>
                </span>
                <span className="shrink-0 tabular-nums text-slate-900">
                  {len(o.width.value)} × {len(o.height.value)}
                  <span className="ml-2 text-xs text-slate-500 underline underline-offset-4">
                    {showing ? 'Done' : 'Measure'}
                  </span>
                </span>
              </button>

              {showing && (
                <div className="mt-1 divide-y divide-sky-100 rounded-md bg-white/60 px-3">
                  <Row
                    label="Width"
                    value={len(o.width.value)}
                    note={band(o.width, len)}
                    hint={`e.g. ${len(o.width.value)}`}
                    onSubmit={(text) => onSet(o.id, 'width', text)}
                  />
                  <Row
                    label="Height"
                    value={len(o.height.value)}
                    note={band(o.height, len)}
                    hint={o.kind === 'window' ? `e.g. ${len(o.height.value)}` : `e.g. 6'8"`}
                    onSubmit={(text) => onSet(o.id, 'height', text)}
                  />
                  {o.kind === 'window' && (
                    <Row
                      label="Sill off the floor"
                      value={o.sillHeight ? len(o.sillHeight.value) : 'not known'}
                      // RoomPlan never states a sill; where one exists it was
                      // worked back from the window's centre and its height.
                      note={o.sillHeight ? band(o.sillHeight, len) : 'the scan never said'}
                      hint={`e.g. 2'6"`}
                      onSubmit={(text) => onSet(o.id, 'sillHeight', text)}
                    />
                  )}
                  <Row
                    label="From the corner"
                    value={len(o.offsetFromStart.value)}
                    note={band(o.offsetFromStart, len)}
                    hint={`e.g. ${len(o.offsetFromStart.value)}`}
                    onSubmit={(text) => onSet(o.id, 'offsetFromStart', text)}
                  />
                  <p className="py-2 text-xs text-slate-500">
                    Measured from the first corner of {wall.id}, walking the room the way the
                    plan is numbered. Correcting any of these moves no walls — the ceiling is{' '}
                    {len((wall.height ?? room.ceilingHeight).value)}.
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
