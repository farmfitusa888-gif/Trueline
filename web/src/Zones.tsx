import { useMemo, useState } from 'react';
import { parseLength } from '../../core/src/length.ts';
import { corners, runLength } from '../../core/src/room.ts';
import type { Point, Room } from '../../core/src/room.ts';
import { type Boundary, report, splitByBoundary } from '../../core/src/zone.ts';
import { Wants } from './Measure.tsx';
import { useUnits } from './units.tsx';

/**
 * Open plans, priced as the several rooms they actually are.
 *
 * ## The thing the whole field gets wrong
 *
 * A kitchen that runs into a dining area that runs into a living room is one
 * continuous space with no walls in it, and a contractor has to price it as
 * three: different flooring, different paint, different scope. The advice
 * people are given today is to **lay a strip of painter's tape on the
 * customer's floor** so the scanner sees a corner. That is not a workaround, it
 * is a field admitting its model cannot describe an ordinary modern house.
 *
 * The obvious fix is worse than the problem: split the space with a wall, and
 * the estimate quietly carries drywall, paint and baseboard for a surface
 * nobody will ever build. On a twenty-foot divider that is real money for
 * nothing.
 *
 * So a divider here is its own kind of thing. `zone.ts` has known that since it
 * was written; this is the screen that lets somebody say it.
 *
 * ## One button, and why there is not a second one
 *
 * There was going to be a pair: *draw a line on the floor* and *there is a real
 * half wall*. The second was written and taken out, because it would have made
 * the identical virtual edge and labelled it built — a control that does
 * something other than what it says, which is worse than a control that is
 * missing.
 *
 * A pony wall or a breakfast bar **is a wall**. It gets finished, it costs
 * money, and it belongs in the room's own wall list at its own height, where it
 * will carry drywall, paint and base the way it should. What belongs here is
 * only the other thing: a line somebody decided on, which bounds floor area and
 * nothing else and carries no tolerance, because nobody measured it.
 */
export function Zones({
  room,
  boundary,
  onSplit,
  onClear,
}: {
  readonly room: Room;
  readonly boundary: Boundary | null;
  readonly onSplit: (boundary: Boundary, names: readonly [string, string]) => void;
  readonly onClear: () => void;
}) {
  const { len, area } = useUnits();
  const [fromWall, setFromWall] = useState(room.walls[0]?.id ?? '');
  const [fromAlong, setFromAlong] = useState('');
  const [toWall, setToWall] = useState(room.walls[2]?.id ?? room.walls[1]?.id ?? '');
  const [toAlong, setToAlong] = useState('');
  const [thisSide, setThisSide] = useState('Kitchen');
  const [thatSide, setThatSide] = useState('Dining');
  const [wants, setWants] = useState<string | null>(null);

  /** A point on a wall, a stated distance from its first corner. */
  function pointOn(id: string, distance: bigint): Point | null {
    const index = room.walls.findIndex((w) => w.id === id);
    if (index === -1) return null;
    const outline = corners(room);
    const from = outline[index];
    const to = outline[(index + 1) % outline.length];
    if (!from || !to) return null;
    const span = runLength(room.walls[index]!);
    if (span === 0n) return null;
    const capped = distance < 0n ? 0n : distance > span ? span : distance;
    return {
      x: from.x + ((to.x - from.x) * capped) / span,
      y: from.y + ((to.y - from.y) * capped) / span,
    };
  }

  /**
   * What the split comes to, worked out live.
   *
   * `report` refuses a set of zones whose floor areas do not add up to the
   * room's own, to the square nanometre. That check is the reason to show this
   * before anything is saved: a divider that does not reconcile is a divider
   * that would have put a wrong number in front of a homeowner.
   */
  const split = useMemo(() => {
    if (!boundary) return null;
    try {
      const zones = splitByBoundary(room, boundary, [thisSide || 'One', thatSide || 'Two']);
      return { report: report(room, zones), trouble: null as string | null };
    } catch (error) {
      return { report: null, trouble: error instanceof Error ? error.message : String(error) };
    }
  }, [room, boundary, thisSide, thatSide]);

  function make() {
    const missing = [
      fromAlong.trim() === '' && 'where it starts',
      toAlong.trim() === '' && 'where it ends',
      thisSide.trim() === '' && 'a name for one side',
      thatSide.trim() === '' && 'a name for the other',
    ].filter(Boolean);
    if (missing.length) {
      setWants(`Fill in ${missing.join(', and ')} first.`);
      return;
    }
    let from: Point | null;
    let to: Point | null;
    try {
      from = pointOn(fromWall, parseLength(fromAlong.trim()));
      to = pointOn(toWall, parseLength(toAlong.trim()));
    } catch (error) {
      setWants(error instanceof Error ? error.message : String(error));
      return;
    }
    if (!from || !to) {
      setWants('One of those walls is not part of this room any more.');
      return;
    }
    setWants(null);
    onSplit(
      {
        id: `b-${Date.now()}`,
        name: 'a line drawn on the floor',
        declaredBy: 'me',
        declaredAt: new Date().toISOString(),
        from,
        to,
      },
      [thisSide.trim(), thatSide.trim()]
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-semibold text-slate-900">Split an open plan</h2>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        One space that has to be priced as two — a kitchen running into a dining area. Say where
        the divide is and each side gets its own floor, ceiling, baseboard and wall face.
      </p>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        <strong>It is not a wall.</strong> Splitting a space with a wall puts drywall, paint and
        baseboard on the estimate for a surface nobody will ever build. A line drawn on the floor
        bounds area and nothing else, and it carries no tolerance — nobody measured it, somebody
        decided it.
      </p>

      {boundary && split?.report ? (
        <>
          <ul className="mt-4 divide-y divide-slate-100 border-y border-slate-200">
            {split.report.zones.map(({ zone, quantities }) => (
              <li key={zone.id} className="py-3">
                <p className="font-semibold text-slate-900">{zone.name}</p>
                <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-700">
                  <dt>Floor</dt>
                  <dd className="tabular-nums text-right">{area(quantities.floorArea)}</dd>
                  <dt>Wall face</dt>
                  <dd className="tabular-nums text-right">{area(quantities.wallFaceArea * 2n)}</dd>
                  <dt>Baseboard</dt>
                  <dd className="tabular-nums text-right">{len(quantities.baseboardRun)}</dd>
                  {quantities.virtualRun > 0n && (
                    <>
                      <dt className="text-slate-500">Open to the other side</dt>
                      <dd className="tabular-nums text-right text-slate-500">
                        {len(quantities.virtualRun)}
                      </dd>
                    </>
                  )}
                </dl>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            The two floors add up to {area(split.report.total.floorArea)}, which is the whole room
            to the square inch — checked every time, because a divide that does not reconcile is a
            wrong number in front of a homeowner.{' '}
            {split.report.total.virtualRun > 0n && (
              <>
                {len(split.report.total.virtualRun)} of the outline is a line somebody drew, and it
                carries no drywall, no paint and no base.
              </>
            )}
          </p>
          <button
            type="button"
            onClick={onClear}
            className="mt-3 min-h-11 rounded-md border border-slate-300 px-3 font-medium text-slate-700
                       active:bg-slate-100"
          >
            Put it back to one space
          </button>
        </>
      ) : (
        <div className="mt-4 space-y-3">
          {split?.trouble && (
            <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-900">
              {split.trouble}
            </p>
          )}

          {(
            // Each row's boxes are named for which end of the divide they
            // are, and never "how far along it": the tag screen on this same
            // panel already has a box by that name, and two controls sharing
            // an accessible name is the bug class the click-through exists to
            // catch. It caught this one.
            [
              ['Starts on', 'How far along the first wall',
               fromWall, setFromWall, fromAlong, setFromAlong] as const,
              ['Ends on', 'How far along the second wall',
               toWall, setToWall, toAlong, setToAlong] as const,
            ]
          ).map(([label, farLabel, wall, setWall, along, setAlong]) => (
            <div key={label} className="flex flex-wrap gap-2">
              <label className="flex-1">
                <span className="block text-sm font-medium text-slate-700">{label}</span>
                <select
                  value={wall}
                  onChange={(event) => { setWall(event.target.value); setWants(null); }}
                  className="mt-1 min-h-12 w-full rounded-md border border-slate-300 px-2 py-2"
                >
                  {room.walls.map((one) => (
                    <option key={one.id} value={one.id}>
                      {one.id} — {len(runLength(one))}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex-1">
                <span className="block text-sm font-medium text-slate-700">{farLabel}</span>
                <input
                  value={along}
                  onChange={(event) => { setAlong(event.target.value); setWants(null); }}
                  inputMode="text"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={`e.g. 12'`}
                  className="mt-1 min-h-12 w-full rounded-md border border-slate-300 px-3 py-2
                             tabular-nums focus:border-sky-500 focus:outline-none"
                />
              </label>
            </div>
          ))}

          <div className="flex flex-wrap gap-2">
            <label className="flex-1">
              <span className="block text-sm font-medium text-slate-700">Call this side</span>
              <input
                value={thisSide}
                onChange={(event) => { setThisSide(event.target.value); setWants(null); }}
                className="mt-1 min-h-12 w-full rounded-md border border-slate-300 px-3 py-2
                           focus:border-sky-500 focus:outline-none"
              />
            </label>
            <label className="flex-1">
              <span className="block text-sm font-medium text-slate-700">And that side</span>
              <input
                value={thatSide}
                onChange={(event) => { setThatSide(event.target.value); setWants(null); }}
                className="mt-1 min-h-12 w-full rounded-md border border-slate-300 px-3 py-2
                           focus:border-sky-500 focus:outline-none"
              />
            </label>
          </div>

          {/* One button, deliberately.
              A second one saying "there is a real half wall" was written and
              taken out: it would have made the same virtual edge and labelled
              it built, which is a control that does something other than what
              it says. A pony wall or a breakfast bar is a WALL -- it gets
              finished, it costs money, and it belongs in the room's own wall
              list at its own height, not here. */}
          <button
            type="button"
            onClick={make}
            className="min-h-12 w-full rounded-md bg-slate-900 px-4 font-semibold text-white
                       active:bg-slate-700"
          >
            Draw a line on the floor
          </button>
          <p className="text-xs leading-relaxed text-slate-500">
            If there is a real half wall between the two — a pony wall, a breakfast bar — it is a
            wall and not a line. Add it on the plan and give it its own height, and it will carry
            drywall, paint and base the way it should.
          </p>
          <Wants say={wants} />
        </div>
      )}
    </section>
  );
}
