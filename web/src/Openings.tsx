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
  /** Which opening this row belongs to, so its box has a name of its own. */
  of,
  value,
  note,
  hint,
  onSubmit,
}: {
  readonly label: string;
  readonly of: string;
  readonly value: string;
  readonly note: string;
  readonly hint: string;
  readonly onSubmit: (text: string) => void;
}) {
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-slate-700">{label}</span>
        <span className="shrink-0 text-sm font-mono tabular-nums text-slate-900">
          {value} <span className="text-xs text-slate-500">{note}</span>
        </span>
      </div>
      <div className="mt-1 print:hidden">
        <Measure name={`${label.toLowerCase()} of the ${of}`} label={hint} onSubmit={onSubmit} />
      </div>
    </div>
  );
}

/** What a door and a window usually are, so adding one is two taps. */
const USUAL = {
  door: { width: `3'`, height: `6'8"`, sill: undefined },
  cased: { width: `4'`, height: `6'8"`, sill: undefined },
  window: { width: `3'`, height: `4'`, sill: `2'6"` },
} as const;

export function Openings({
  room,
  wall,
  onSet,
  onAdd,
  onRemove,
}: {
  readonly room: Room;
  readonly wall: Wall;
  readonly onSet: (openingId: string, field: OpeningField, text: string) => void;
  readonly onAdd: (kind: Opening['kind'], where: string) => void;
  readonly onRemove: (openingId: string) => void;
}) {
  const { len } = useUnits();
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<Opening['kind'] | null>(null);
  const openings = wall.openings ?? [];

  /**
   * Putting one in by hand.
   *
   * Two rooms need this and both are ordinary. A room drawn by hand has no
   * openings at all — so it could carry no door, no baseboard deduction and no
   * jamb, and could not be joined to the room next door. And a scanned room is
   * routinely missing one: a door standing open against a wall is regularly not
   * in the capture.
   *
   * It goes in at a normal size, which is then corrected like any other — the
   * same fields, the same refusals. A 6'8" door is what a door is; putting one
   * in and adjusting it beats an empty form.
   */
  const putIn = wall.open ? null : (
    <div className="mt-3 print:hidden">
      {adding === null ? (
        <div className="flex flex-wrap gap-2">
          {(['door', 'window', 'cased'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setAdding(kind)}
              className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium
                         text-slate-700 active:bg-slate-100"
            >
              + {kind === 'cased' ? 'cased opening' : kind}
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-md bg-white/70 p-3">
          <p className="text-sm text-slate-700">
            How far along {wall.id} does the {adding} start? A {USUAL[adding].width} by{' '}
            {USUAL[adding].height} {adding} goes in there and you can correct it after.
          </p>
          <div className="mt-2">
            <Measure
              name={`how far the new ${adding} is from the corner`}
              label={`e.g. ${len(runLength(wall) / 4n)}`}
              onSubmit={(text) => {
                onAdd(adding, text);
                setAdding(null);
              }}
            />
          </div>
          <button
            type="button"
            onClick={() => setAdding(null)}
            className="mt-2 min-h-11 text-sm text-slate-500 underline underline-offset-4"
          >
            Never mind
          </button>
        </div>
      )}
    </div>
  );

  if (openings.length === 0) {
    return putIn && (
      <div className="mt-4 border-t border-sky-200 pt-3">
        <h3 className="text-sm font-semibold text-slate-900">Nothing in this wall</h3>
        <p className="mt-1 text-sm text-slate-600">
          If there is a door or a window in it that the scan missed — or you drew this room by
          hand — put it in here. It comes off the baseboard and the paint, and it is what lets
          this room be joined to the one on the other side of it.
        </p>
        {putIn}
      </div>
    );
  }

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
                /* This row was already a disclosure and already had its way
                   back — the same row shuts it, which is the pattern the rest
                   of the app has now been brought round to. What it did not
                   have was any way of SAYING so: no `aria-expanded`, so
                   anybody listening rather than looking was told about a
                   button with nothing behind it. That is the exact state the
                   damage mark's row was in when Sam reported he could not
                   attach a photograph to a mark.
                   The words on it are deliberately left as they were.
                   "Measure" is what this row opens and `a2-edits.mjs` finds it
                   by that word; renaming it to Open would break the one part
                   of the audit that proves an opening can be corrected at
                   all. */
                aria-expanded={showing}
                aria-controls={`opening-${o.id}`}
                className="flex min-h-11 w-full items-baseline justify-between gap-3 text-left"
              >
                <span className="text-slate-800">
                  {NOUN[o.kind]}
                  <span className="block text-xs text-slate-500">
                    {len(o.offsetFromStart.value)} from the corner
                  </span>
                </span>
                <span className="shrink-0 font-mono tabular-nums text-slate-900">
                  {len(o.width.value)} × {len(o.height.value)}
                  <span className="ml-2 text-xs text-slate-500 underline underline-offset-4">
                    {showing ? 'Done' : 'Measure'}
                  </span>
                </span>
              </button>

              {showing && (
                <div
                  id={`opening-${o.id}`}
                  className="mt-1 divide-y divide-sky-100 rounded-md bg-white/60 px-3"
                >
                  <Row
                    label="Width"
                    of={`${o.kind} "${o.id}"`}
                    value={len(o.width.value)}
                    note={band(o.width, len)}
                    hint={`e.g. ${len(o.width.value)}`}
                    onSubmit={(text) => onSet(o.id, 'width', text)}
                  />
                  <Row
                    label="Height"
                    of={`${o.kind} "${o.id}"`}
                    value={len(o.height.value)}
                    note={band(o.height, len)}
                    hint={o.kind === 'window' ? `e.g. ${len(o.height.value)}` : `e.g. 6'8"`}
                    onSubmit={(text) => onSet(o.id, 'height', text)}
                  />
                  {o.kind === 'window' && (
                    <Row
                      label="Sill off the floor"
                      of={`${o.kind} "${o.id}"`}
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
                    of={`${o.kind} "${o.id}"`}
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
                  <button
                    type="button"
                    onClick={() => onRemove(o.id)}
                    className="min-h-11 py-2 text-sm text-slate-500 underline underline-offset-4 print:hidden"
                  >
                    There is no {o.kind} here
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {putIn}
    </div>
  );
}
