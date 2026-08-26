import { useEffect, useMemo, useState } from 'react';
import { type Join, floorQuantities } from '../../core/src/floor.ts';
import { type DrawnOpening, couldBeTheSame, extentOf, floorPlan, placedArea } from '../../core/src/floorplan.ts';
import { onRoomsArrived } from './bridge.ts';
import { floorOf, joinBetween, loadJoins, saveJoins, savedRooms } from './floorStore.ts';
import { FloorHouse } from './FloorHouse.tsx';
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
  /**
   * Flat, or with the roof off.
   *
   * The same pair of words the room screen uses for the same pair of things,
   * in the same place on the screen. A floor that called them something else
   * would be teaching the control twice.
   */
  const [look, setLook] = useState<'plan' | 'house'>('plan');
  /**
   * Bumped when the app hands more rooms across, so this reads storage again.
   *
   * Inside the iOS app the Floor tab is handed every corrected room on the
   * phone, and that arrives after this screen has already asked what was in
   * storage. Without this the answer would stay "no rooms yet" while six of
   * them sat in the very storage it had just read.
   */
  const [arrived, setArrived] = useState(0);
  useEffect(() => onRoomsArrived(() => setArrived((n) => n + 1)), []);
  const rooms = useMemo(() => savedRooms(), [arrived]);

  /**
   * The floor both views draw from.
   *
   * One value, so the dollhouse and the blueprint cannot be looking at two
   * different arrangements of the same rooms.
   */
  const floor = useMemo(() => floorOf(rooms, joins), [rooms, joins]);

  const plan = useMemo(() => {
    try {
      return { it: floorPlan(floor), trouble: null as string | null };
    } catch (error) {
      return { it: null, trouble: error instanceof Error ? error.message : String(error) };
    }
  }, [floor]);

  /**
   * What the whole floor takes, across every room that could be placed.
   *
   * The floor view showed a shape and an area and nothing that could be
   * ordered off it. `floorQuantities` has been able to answer this since
   * `floor.ts` was written and nothing called it -- found by
   * `npm run what-is-left`.
   *
   * Rooms that could not be placed are left out by `layout` and named, never
   * quietly added in: a total that silently includes a room nobody could place
   * is a total that is wrong in a way nobody can see.
   */
  const totals = useMemo(() => {
    try {
      return floorQuantities(floor);
    } catch {
      // The plan itself already says why it could not be laid out, above.
      return null;
    }
  }, [floor]);

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
          <p className="text-sm font-mono tabular-nums text-slate-600">
            {len(extent.x)} × {len(extent.y)} · {area(placedArea(plan.it))}
          </p>
        </div>

        {totals && (
          <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-slate-50 px-3 py-2
                         text-sm sm:grid-cols-4">
            <div className="flex justify-between gap-2 sm:block">
              <dt className="text-slate-600">Flooring</dt>
              <dd className="font-semibold font-mono tabular-nums text-slate-900">
                {area(totals.floorArea)}
              </dd>
            </div>
            <div className="flex justify-between gap-2 sm:block">
              <dt className="text-slate-600">Ceiling</dt>
              <dd className="font-semibold font-mono tabular-nums text-slate-900">
                {area(totals.ceilingArea)}
              </dd>
            </div>
            <div className="flex justify-between gap-2 sm:block">
              <dt className="text-slate-600">Wall face</dt>
              <dd className="font-semibold font-mono tabular-nums text-slate-900">
                {area(totals.wallFaceArea * 2n)}
              </dd>
            </div>
            <div className="flex justify-between gap-2 sm:block">
              <dt className="text-slate-600">Baseboard</dt>
              <dd className="font-semibold font-mono tabular-nums text-slate-900">
                {len(totals.baseboardRun)}
              </dd>
            </div>
          </dl>
        )}

        {/* The same control the room screen has, in the same place, saying the
            same two words for the same two things. A floor that named them
            differently would be teaching one idea twice. */}
        <div
          role="tablist"
          aria-label="How to look at this floor"
          className="mb-3 flex gap-1 rounded-lg bg-slate-100 p-1"
        >
          {(['plan', 'house'] as const).map((which) => (
            <button
              key={which}
              type="button"
              role="tab"
              aria-selected={look === which}
              onClick={() => setLook(which)}
              className={`min-h-11 flex-1 rounded-md px-4 font-medium ${
                look === which
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 active:bg-slate-200'
              }`}
            >
              {which === 'plan' ? 'Blueprint' : 'Dollhouse'}
            </button>
          ))}
        </div>

        {look === 'house' ? (
          <FloorHouse
            floor={floor}
            onOpenRoom={(roomId) => {
              // The dollhouse knows a room by the id the FLOOR knows it by;
              // opening one needs the file it was saved under. Looked up
              // rather than assumed equal, because they are not: a room id
              // comes out of the capture and a file name is what somebody
              // called the folder.
              const saved = rooms.find((one) => one.room.id === roomId);
              if (saved) onOpenRoom(saved.fileName);
            }}
          />
        ) : (
        <svg
          viewBox={`0 0 ${box} ${box}`}
          className="w-full h-auto select-none"
          fontFamily="ui-sans-serif, -apple-system, 'Helvetica Neue', Arial, sans-serif"
          role="img"
          aria-label="The floor"
        >
          <rect x="0" y="0" width={box} height={box} fill="rgb(var(--c-raise))" />

          {drawn.map((room) => (
            <polygon
              key={room.roomId}
              points={room.outline.map((p) => `${px(p.x)},${py(p.y)}`).join(' ')}
              // A room nothing has joined yet stands off to one side, paler, so
              // it reads as waiting rather than as part of the building. It has
              // to be drawn at all, because joining is two taps and a room that
              // is not on the screen has no door to tap.
              fill={room.placed ? 'rgb(var(--c-sunk))' : 'rgb(var(--c-scannedSoft))'}
              stroke={room.placed ? 'rgb(var(--c-rule))' : 'rgb(var(--c-scannedEdge))'}
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
              stroke={wall.open ? 'rgb(var(--c-faint))' : wall.measured ? 'rgb(var(--c-ink))' : 'rgb(var(--c-scanned))'}
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
                fill="rgb(var(--c-ink))"
              >
                {room.name}
              </text>
              <text x={px(room.at.x)} y={py(room.at.y) + 26} textAnchor="middle" fontSize={20} fill="rgb(var(--c-derived))">
                {area(room.area)}
              </text>
              {!room.placed && (
                <text
                  x={px(room.at.x)}
                  y={py(room.at.y) + 52}
                  textAnchor="middle"
                  fontSize={19}
                  fill="rgb(var(--c-scanned))"
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
                  fill={chosen ? 'rgb(var(--c-focus))' : opening.joined ? 'rgb(var(--c-ink))' : 'rgb(var(--c-raise))'}
                  stroke={chosen ? 'rgb(var(--c-focus))' : opening.joined ? 'rgb(var(--c-ink))' : 'rgb(var(--c-scanned))'}
                  strokeWidth={4}
                />
              </g>
            );
          })}
        </svg>
        )}

        <p className="mt-2 px-1 text-sm text-slate-600">
          {look === 'house'
            ? 'Joining rooms is done on the blueprint — tap a doorway there, then tap the same ' +
              'doorway in the room on the other side of it.'
            : picked
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
                  <span className="ml-1 font-semibold font-mono tabular-nums">{len(note.by)}</span>
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
