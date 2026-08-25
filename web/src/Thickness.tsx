import { useState } from 'react';
import { formatFeetInches, parseLength } from '../../core/src/length.ts';
import { isVerified } from '../../core/src/measurement.ts';
import type { Room } from '../../core/src/room.ts';
import {
  ASSEMBLIES,
  thicknessGroups,
  thicknessOf,
  withoutThickness,
} from '../../core/src/thickness.ts';

/**
 * How thick the walls are — the one number the scanner will never know.
 *
 * RoomPlan reports a thickness for every surface and it is zero, in every wall
 * of every scan, because a phone standing inside a room sees one face of a wall
 * and has no way to know what is behind it. So this is a person saying it, and
 * the screen is built round that: five buttons for what it usually is, a field
 * for when it is not, and a plain statement of which walls nobody has said
 * anything about yet.
 *
 * Nothing on the plan moves when this is set. The outline is the inside face,
 * which is what flooring, paint and baseboard are priced off. What it unlocks is
 * the set of numbers you cannot order against without it — the jamb a door is
 * cut for above all, which is the difference between a pre-hung unit that fits
 * and one that goes back on the truck.
 */

export function Thickness({
  room,
  selected,
  onSet,
}: {
  readonly room: Room;
  /** The wall the plan has selected, if any. Sets that wall rather than the room. */
  readonly selected: string | null;
  readonly onSet: (wallId: string | null, text: string | null, how: 'stated' | 'tape') => void;
}) {
  const [typed, setTyped] = useState('');
  const wall = selected ? room.walls.find((w) => w.id === selected) : undefined;
  // An open span has nothing built across it, so it has no thickness and is
  // never asked for one.
  const target = wall && !wall.open ? wall : undefined;
  const scope = target ? target.id : null;

  const current = target ? thicknessOf(target, room) : room.wallThickness;
  const bare = withoutThickness(room);
  // A room somebody typed by hand never had a scanner in it, and telling them
  // what the scan could not see would be describing a scan that never happened.
  const scanned = room.walls.some((w) => !isVerified(w.length));
  const groups = thicknessGroups(room);

  let reads: string | null = null;
  if (typed.trim() !== '') {
    try {
      reads = `Reads as ${formatFeetInches(parseLength(typed.trim(), { defaultUnit: 'in' }))}`;
    } catch (error) {
      reads = error instanceof Error ? error.message : String(error);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-slate-900">
          {target ? `How thick is ${target.id}?` : 'How thick are the walls?'}
        </h2>
        {current && (
          <span className="shrink-0 font-semibold tabular-nums text-slate-900">
            {formatFeetInches(current.value)}
          </span>
        )}
      </div>

      <p className="mt-1 text-sm text-slate-600">
        {scanned
          ? 'The scan cannot see this — a phone inside a room only ever sees one face of a wall.'
          : 'Nothing has said yet how thick these walls are.'}{' '}
        Say what it is and you get the jamb to order, the wrap round each opening, and the framing.
      </p>

      <div className="mt-3 flex flex-wrap gap-2 print:hidden">
        {ASSEMBLIES.map((a) => {
          const on = current?.value === a.thickness;
          return (
            <button
              key={a.id}
              type="button"
              title={a.label}
              onClick={() => onSet(scope, formatFeetInches(a.thickness), 'stated')}
              className={`min-h-12 rounded-md px-4 font-semibold tabular-nums ${
                on
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-300 text-slate-700 active:bg-slate-100'
              }`}
            >
              {a.short}
            </button>
          );
        })}
      </div>

      <form
        className="mt-2 flex flex-wrap gap-2 print:hidden"
        onSubmit={(event) => {
          event.preventDefault();
          if (typed.trim() === '') return;
          // Typed rather than tapped means somebody went and looked, so it is
          // recorded as a tape rather than as an assumption.
          onSet(scope, typed.trim(), 'tape');
          setTyped('');
        }}
      >
        <input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          inputMode="text"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="or measure it through a doorway"
          aria-label="Wall thickness"
          className="min-h-12 flex-1 rounded-md border border-slate-300 px-3 py-2 tabular-nums
                     focus:border-sky-500 focus:outline-none"
        />
        <button
          type="submit"
          className="min-h-12 rounded-md border border-slate-300 px-4 font-medium text-slate-700 active:bg-slate-100"
        >
          Set
        </button>
        {reads && (
          <p aria-live="polite" className="basis-full text-sm text-slate-600">
            {reads}
          </p>
        )}
      </form>

      {target && target.thickness && (
        <button
          type="button"
          onClick={() => onSet(target.id, null, 'stated')}
          className="mt-2 text-sm text-slate-600 underline underline-offset-4 print:hidden"
        >
          Make {target.id} the same as the rest
        </button>
      )}

      {groups.length > 0 && (
        <dl className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
          {groups.map((g) => (
            <div key={g.thickness.toString()} className="flex items-baseline justify-between gap-4 py-2">
              <dt className="text-sm text-slate-700">
                {g.assembly ? g.assembly.short : formatFeetInches(g.thickness)}
                <span className="block text-xs text-slate-500">
                  {g.wallIds.join(', ')} · {g.how}
                </span>
              </dt>
              <dd className="shrink-0 text-sm tabular-nums text-slate-900">
                {formatFeetInches(g.jamb)} jamb
              </dd>
            </div>
          ))}
        </dl>
      )}

      {bare.length > 0 && (
        <p className="mt-3 text-sm text-amber-800">
          Nothing said yet about {bare.join(', ')}. Those walls are not in the framing, the jambs
          or the wrap — they are left out rather than guessed at.
        </p>
      )}
    </section>
  );
}
