import { useMemo, useState } from 'react';
import type { Join } from '../../core/src/floor.ts';
import { type DrawnOpening, couldBeTheSame, extentOf, floorPlan, placedArea } from '../../core/src/floorplan.ts';
import { floorOf, joinBetween, loadJoins, saveJoins, savedRooms } from './floorStore.ts';
import { useUnits } from './units.tsx';

/**
 * More than one room, and the place every scanner in the field gives up.
 *
 * Apple's own limit is one floor and one plane, with each scanned room arriving
 * in its own coordinate system. Nothing here guesses how they fit together,
 * because it cannot be done honestly — there is nothing in two captures that
 * says which door is which — and a floor plan that looked right and was wrong is
 * this product's definition of the worst possible output.
 *
 * So a person says it, in the only terms that are not ambiguous: **tap the door
 * in one room, tap the same door in the other.** From there the placement is
 * arithmetic, exact to the nanometre, and the rooms sit the thickness of the
 * wall between them apart.
 *
 * And when the rooms come back round in a loop, the two ways of reaching the
 * last one have to agree. How far they miss by is every scan in the loop's error
 * added up, and it is reported rather than smoothed away — which is the opposite
 * of what a merge that "optimises the final model's appearance" does.
 */

const PAD = 90;
const SIDE = 620;

export function Floor({ onOpenRoom }: { readonly onOpenRoom: (fileName: string) => void }) {
  const { len, area } = useUnits();
  const [joins, setJoins] = useState<Join[]>(() => loadJoins());
  const [picked, setPicked] = useState<DrawnOpening | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const rooms = useMemo(() => savedRooms(), []);

  const plan = useMemo(() => {
    try {
      return { it: floorPlan(floorOf(rooms, joins)), trouble: null as string | null };
    } catch (error) {
      return { it: null, trouble: error instanceof Error ? error.message : String(error) };
    }
  }, [rooms, joins]);

  function commit(next: Join[]) {
    setJoins(next);
    saveJoins(next);
  }

  function tap(opening: DrawnOpening) {
    setTrouble(null);
    if (!picked) {
      setPicked(opening);
      return;
    }
    if (picked.openingId === opening.openingId && picked.roomId === opening.roomId) {
      setPicked(null);
      return;
    }
    const why = couldBeTheSame(picked, opening);
    if (why) {
      setTrouble(why);
      setPicked(null);
      return;
    }
    const join = joinBetween(
      { roomId: picked.roomId, wallId: picked.wallId, openingId: picked.openingId },
      { roomId: opening.roomId, wallId: opening.wallId, openingId: opening.openingId },
      'me',
      new Date().toISOString()
    );
    commit([...joins.filter((x) => x.id !== join.id), join]);
    setPicked(null);
  }

  if (rooms.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
        <h2 className="text-lg font-semibold text-slate-900">No rooms yet</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">
          Scan or draw a room and it appears here. Two or more, and you can say which door in one
          is which door in the other, and they will find their places.
        </p>
      </div>
    );
  }

  if (!plan.it) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <h2 className="font-semibold">This floor could not be laid out</h2>
        <p className="mt-1">{plan.trouble}</p>
        <button
          type="button"
          onClick={() => commit([])}
          className="mt-3 min-h-11 rounded-md border border-amber-300 px-4 font-medium"
        >
          Start the joins again
        </button>
      </div>
    );
  }

  const { rooms: drawn, walls, openings, bounds, unplaced, notes } = plan.it;
  const width = Number(bounds.hi.x - bounds.lo.x) || 1;
  const height = Number(bounds.hi.y - bounds.lo.y) || 1;
  const scale = SIDE / Math.max(width, height);
  const insetX = (SIDE - width * scale) / 2;
  const insetY = (SIDE - height * scale) / 2;
  const px = (v: bigint) => PAD + insetX + Number(v - bounds.lo.x) * scale;
  // Screen y grows downward, plan y grows north. Flipped once, here.
  const py = (v: bigint) => PAD + insetY + Number(bounds.hi.y - v) * scale;
  const box = SIDE + PAD * 2;
  const extent = extentOf(plan.it);

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
          <h2 className="text-base font-semibold text-slate-900">
            {drawn.length} room{drawn.length === 1 ? '' : 's'}
          </h2>
          <p className="text-sm tabular-nums text-slate-600">
            {len(extent.x)} × {len(extent.y)} · {area(placedArea(plan.it))}
          </p>
        </div>

        <svg
          viewBox={`0 0 ${box} ${box}`}
          className="w-full h-auto select-none"
          fontFamily="ui-sans-serif, -apple-system, 'Helvetica Neue', Arial, sans-serif"
          role="img"
          aria-label="The floor"
        >
          <rect x="0" y="0" width={box} height={box} fill="#ffffff" />

          {drawn.map((room) => (
            <polygon
              key={room.roomId}
              points={room.outline.map((p) => `${px(p.x)},${py(p.y)}`).join(' ')}
              // A room nothing has joined yet stands off to one side, paler, so
              // it reads as waiting rather than as part of the building. It has
              // to be drawn at all, because joining is two taps and a room that
              // is not on the screen has no door to tap.
              fill={room.placed ? '#f1f5f9' : '#fffbeb'}
              stroke={room.placed ? '#cbd5e1' : '#fcd34d'}
              strokeWidth={room.placed ? 1 : 2}
              strokeDasharray={room.placed ? undefined : '8 6'}
            />
          ))}

          {walls.map((wall) => (
            <line
              key={`${wall.roomId}-${wall.wallId}`}
              x1={px(wall.from.x)}
              y1={py(wall.from.y)}
              x2={px(wall.to.x)}
              y2={py(wall.to.y)}
              stroke={wall.open ? '#94a3b8' : wall.measured ? '#0f172a' : '#b45309'}
              strokeWidth={wall.open ? 3 : 6}
              strokeLinecap="round"
              strokeDasharray={wall.open ? '2 10' : undefined}
            />
          ))}

          {drawn.map((room) => (
            <g key={`${room.roomId}-label`}>
              <text
                x={px(room.at.x)}
                y={py(room.at.y)}
                textAnchor="middle"
                fontSize={26}
                fontWeight={600}
                fill="#0f172a"
              >
                {room.name}
              </text>
              <text x={px(room.at.x)} y={py(room.at.y) + 26} textAnchor="middle" fontSize={20} fill="#64748b">
                {area(room.area)}
              </text>
              {!room.placed && (
                <text
                  x={px(room.at.x)}
                  y={py(room.at.y) + 52}
                  textAnchor="middle"
                  fontSize={19}
                  fill="#b45309"
                >
                  not joined yet
                </text>
              )}
            </g>
          ))}

          {openings.map((opening) => {
            const chosen =
              picked?.roomId === opening.roomId && picked?.openingId === opening.openingId;
            return (
              <g
                key={`${opening.roomId}-${opening.openingId}`}
                onClick={() => tap(opening)}
                className="cursor-pointer"
              >
                {/* A fat invisible target, so a finger can hit a doorway. */}
                <circle cx={px(opening.at.x)} cy={py(opening.at.y)} r={26} fill="transparent" />
                <circle
                  cx={px(opening.at.x)}
                  cy={py(opening.at.y)}
                  r={chosen ? 15 : 10}
                  fill={chosen ? '#0ea5e9' : opening.joined ? '#0f172a' : '#ffffff'}
                  stroke={chosen ? '#0ea5e9' : opening.joined ? '#0f172a' : '#b45309'}
                  strokeWidth={4}
                />
              </g>
            );
          })}
        </svg>

        <p className="mt-2 px-1 text-sm text-slate-600">
          {picked
            ? `Now tap the same ${picked.kind} in the other room.`
            : openings.length === 0
              ? 'None of these rooms has a door in it yet. Open one, tap the wall the door is ' +
                'in, and put it there — a room with no doors cannot be joined to anything.'
              : openings.some((o) => !o.joined)
                ? 'Tap a doorway, then tap the same doorway in the room on the other side of it.'
                : 'Every doorway on this floor is spoken for.'}
        </p>
      </section>

      {trouble && (
        <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {trouble}
        </p>
      )}

      {notes.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="font-semibold text-slate-900">Worth knowing about this floor</h3>
          <ul className="mt-2 space-y-2">
            {notes.map((note) => (
              <li key={note.what} className="text-sm text-slate-700">
                {note.what}
                {note.by > 0n && (
                  <span className="ml-1 font-semibold tabular-nums">{len(note.by)}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="font-semibold text-slate-900">Rooms on this device</h3>
        <ul className="mt-2 divide-y divide-slate-100">
          {rooms.map((saved) => (
            <li key={saved.fileName} className="flex items-baseline justify-between gap-3 py-2">
              <span className="text-slate-700">
                {saved.room.name}
                {unplaced.includes(saved.room.id) && (
                  <span className="block text-xs text-amber-700">
                    not joined to anything yet
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => onOpenRoom(saved.fileName)}
                className="min-h-11 shrink-0 text-sm text-slate-500 underline underline-offset-4"
              >
                Open
              </button>
            </li>
          ))}
        </ul>
      </section>

      {joins.length > 0 && (
        <button
          type="button"
          onClick={() => commit([])}
          className="text-sm text-slate-500 underline underline-offset-4"
        >
          Undo every join on this floor
        </button>
      )}
    </div>
  );
}
