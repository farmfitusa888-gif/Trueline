import { useMemo } from 'react';
import type { Room } from '../../core/src/room.ts';
import {
  type Surface,
  type WorkItem,
  type WorkScope,
  CEILING,
  amountOn,
  isPicked,
  itemsFor,
  picksOn,
  surfaceName,
  workItems,
} from '../../core/src/work.ts';
import { money } from '../../core/src/price.ts';
import { CeilingPanel } from './Ceiling.tsx';
import { useUnits } from './units.tsx';

/**
 * What is actually being done to this surface.
 *
 * > "How are we costing everything down like it all needs to be replaced by
 * >  each line item? Maybe have an area inside each wall page when you click on
 * >  it with what is actually being done."
 *
 * The takeoff priced every room as a gut job: the whole floor out, the whole
 * ceiling out, every wall face boarded, all the base replaced. On a real
 * remodel that is almost never true, and a contractor handed that sheet does
 * the real one in his head and types the difference into a spreadsheet — at
 * which point this app is a drawing tool.
 *
 * ## Why the first tap does not move a single number
 *
 * A room nobody has scoped is priced as a full replacement, exactly as it
 * always was, and this panel says that out loud rather than showing an empty
 * list of boxes. Saying what is being done starts from **everything already
 * ticked**, so the sheet is identical the instant the control appears and only
 * moves when somebody actually takes work off. A control whose first use empties
 * the quote is a control nobody presses a second time.
 *
 * The other door is here too, because both are real ways a contractor thinks: a
 * gut job starts from everything and has work taken off it, and a patch starts
 * from nothing and has work put on.
 *
 * ## Why the quantity sits beside every box
 *
 * Deciding whether this wall gets boarded is deciding about 160 square feet,
 * and the number is the decision. It comes from `amountOn` rather than being
 * worked out here: the figure beside the tick box and the figure on the sheet
 * are one piece of arithmetic asked twice, never two that can drift apart.
 */

export interface WorkOnProps {
  readonly room: Room;
  /** `null` when nobody has scoped this room — every surface priced as replaced. */
  readonly scope: WorkScope | null;
  readonly onPick: (surface: Surface, item: WorkItem, items: readonly WorkItem[]) => void;
  readonly onDrop: (surface: Surface, item: WorkItem, items: readonly WorkItem[]) => void;
  readonly onStartFromEverything: (items: readonly WorkItem[]) => void;
  readonly onStartFromNothing: () => void;
  readonly onPriceEverything: () => void;
}

const itemKey = (item: WorkItem) => `${item.item}|${item.unit}`;

/**
 * The room as it has always been priced, and the two ways out of it.
 *
 * Shown once wherever it appears rather than once per surface: three identical
 * invitations to do the same thing read as three different things.
 */
function NotScopedYet({
  items,
  onStartFromEverything,
  onStartFromNothing,
}: {
  readonly items: readonly WorkItem[];
  readonly onStartFromEverything: (items: readonly WorkItem[]) => void;
  readonly onStartFromNothing: () => void;
}) {
  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3" data-sheet="no">
      <h3 className="text-sm font-semibold text-slate-900">What is being done here</h3>
      <p className="mt-1 text-sm text-slate-600">
        Everything in this room is priced as if it were being replaced — the whole floor, the whole
        ceiling, every wall face and all the baseboard. That is right for a gut job and wrong for
        most jobs.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onStartFromEverything(items)}
          className="min-h-11 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white
                     active:bg-slate-700"
        >
          Say what is being done
        </button>
        <button
          type="button"
          onClick={onStartFromNothing}
          className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium
                     text-slate-700 active:bg-slate-100"
        >
          Start from nothing
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Nothing moves when you tap the first one: it starts with everything ticked and you take off
        whatever is not happening. The second starts empty, for a patch.
      </p>
    </div>
  );
}

/**
 * The way back, once and only once on a screen.
 *
 * It belongs to the room rather than to a surface — putting it back to a full
 * replacement undoes every decision in the room, not the one on this wall — and
 * the Room panel shows two surfaces at a time, so a copy inside each of them
 * would put two identically named controls on one screen. `a12-everything`
 * found exactly that and named both of them, which is what that part is for.
 */
function PriceItAllAgain({ onPriceEverything }: { readonly onPriceEverything: () => void }) {
  return (
    <button
      type="button"
      onClick={onPriceEverything}
      className="min-h-11 shrink-0 text-xs text-slate-500 underline underline-offset-4"
    >
      Price it all again
    </button>
  );
}

/** The tick list for one surface. Only ever rendered against a real scope. */
function Picker({
  room,
  surface,
  scope,
  items,
  onPick,
  onDrop,
}: {
  readonly room: Room;
  readonly surface: Surface;
  readonly scope: WorkScope;
  readonly items: readonly WorkItem[];
  readonly onPick: (surface: Surface, item: WorkItem, items: readonly WorkItem[]) => void;
  readonly onDrop: (surface: Surface, item: WorkItem, items: readonly WorkItem[]) => void;
}) {
  const { company } = useUnits();
  const book = company.prices ?? { rates: [] };
  const offered = useMemo(() => itemsFor(items, surface.kind), [items, surface.kind]);
  const what = surfaceName(surface);
  const picked = picksOn(scope, surface);

  return (
    <div className="mt-3 rounded-lg border border-sky-300 bg-white p-3" data-sheet="no">
      <h3 className="text-sm font-semibold text-slate-900">What is being done to {what}</h3>

      {picked.length === 0 && (
        <p className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-sm text-amber-900">
          Nothing is being done to {what}, so it is not on the sheet at all — left out rather than
          priced at nothing.
        </p>
      )}

      <ul className="mt-1 divide-y divide-slate-100">
        {offered.map((item) => {
          const on = isPicked(scope, surface, item);
          const amount = amountOn(room, surface, item);
          const rate = book.rates.find((r) => r.item === item.item && r.unit === item.unit);
          return (
            <li key={itemKey(item)}>
              <label className="flex min-h-11 items-center gap-3 py-1">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => (on ? onDrop(surface, item, items) : onPick(surface, item, items))}
                  aria-label={`${item.item} on ${what}`}
                  className="size-5 shrink-0 accent-sky-600"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-slate-800">
                    {item.item}
                    {item.own && (
                      <span className="ml-1 text-[10px] uppercase tracking-wider text-sky-700">
                        yours
                      </span>
                    )}
                  </span>
                  {/* The number the decision is about, and what it earns. An
                      item with no rate says so here rather than turning up
                      missing from the quote three screens later. */}
                  <span className="block text-xs text-slate-500">
                    {amount === '' ? `none of this on ${what}` : `${amount} ${item.unit}`}
                    {rate ? ` at ${money(rate.cents)} / ${item.unit}` : ' — no rate set'}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * What is being done to one surface, whichever surface it is.
 *
 * A wall, the floor, the ceiling: the panel is the same one, because the
 * decision is the same decision. It was written out twice — once inside the
 * wall panel and once inside the room panel — for exactly as long as the
 * ceiling had nowhere of its own to live, and a third copy for the ceiling
 * would have been the point where the three started to differ.
 *
 * `roomControls` is whether this is the place that carries the room-wide ways
 * in and out — "Say what is being done", "Start from nothing", "Price it all
 * again". All three undo or set up every surface in the room at once, so they
 * belong to the room and not to a surface, and two surfaces on one screen each
 * carrying a copy puts two controls with one name four inches apart on a phone.
 * That is the failure `a12-everything` fails a screen for, and it is the reason
 * `PriceItAllAgain` was pulled out of the picker in the first place.
 */
export function WorkOnSurface({
  surface,
  roomControls = true,
  ...props
}: WorkOnProps & { readonly surface: Surface; readonly roomControls?: boolean }) {
  const { company } = useUnits();
  const items = useMemo(() => workItems(company.prices ?? { rates: [] }), [company.prices]);
  if (!props.scope) {
    return roomControls ? (
      <NotScopedYet
        items={items}
        onStartFromEverything={props.onStartFromEverything}
        onStartFromNothing={props.onStartFromNothing}
      />
    ) : (
      // Said rather than left blank. A surface that goes quiet about what is
      // being done to it reads as a surface with nothing happening to it, and
      // this one is priced as a full replacement like everything else.
      <p className="mt-3 text-sm text-slate-600">
        Priced as replaced, along with the rest of the room. Saying what is actually being done
        starts with the room's floor, just above.
      </p>
    );
  }
  return (
    <div>
      <Picker {...props} scope={props.scope} surface={surface} items={items} />
      {roomControls && (
        <div className="mt-1 text-right">
          <PriceItAllAgain onPriceEverything={props.onPriceEverything} />
        </div>
      )}
    </div>
  );
}

/** The panel for one wall, opened by tapping it on the plan. */
export function WorkOnWall({ wallId, ...props }: WorkOnProps & { readonly wallId: string }) {
  return <WorkOnSurface {...props} surface={{ kind: 'wall', wallId }} />;
}

/**
 * The floor, and the ceiling beside it.
 *
 * The floor lives on the Room panel for the obvious reason — there is no floor
 * to tap on the plan — and the ceiling used to sit next to it as a second tick
 * list and nothing else. That was the whole of the ceiling in this app:
 *
 * > "WHAT IF I HAVE TO SCAN A CEILING OR POINT IT UP TO SOMETHING SIMILAR, HOW
 * >  WOULD THAT WORK?"
 *
 * A tick list is not a surface you can work on. So the ceiling's tick list now
 * sits inside `CeilingPanel` — its area, its marks, its photographs, what was
 * said about it and what was measured on it — rather than beside the floor's,
 * and the panel is handed the same `WorkOnSurface` the wall gets. One decision,
 * one control, in one place.
 *
 * `ceilingHere` is how it stops being in two places at once. The ceiling panel
 * belongs wherever the ceiling is opened; when the plan grows a way to open it
 * beside the wall panel, the room panel passes `false` and shows the floor
 * alone. Two identical tick lists on two tabs is how a contractor unticks the
 * ceiling on one screen and finds it still ticked on the other.
 */
export function WorkOnRoom({ ceilingHere = true, ...props }: WorkOnProps & { readonly ceilingHere?: boolean }) {
  const { company } = useUnits();
  const items = useMemo(() => workItems(company.prices ?? { rates: [] }), [company.prices]);
  return (
    <>
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-sheet="no">
        <h2 className="font-semibold text-slate-900">
          {ceilingHere ? 'The floor and the ceiling' : 'The floor'}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {ceilingHere
            ? 'Two surfaces, decided separately. A floor that comes out and a ceiling that only ' +
              'gets painted are two different jobs in one room, and a sheet that cannot say so ' +
              'is a sheet somebody corrects by hand.'
            : 'The floor on its own. The ceiling has a panel of its own, opened from the plan, ' +
              'because it carries marks and photographs as well as a decision.'}
        </p>
        {props.scope ? (
          <>
            <Picker {...props} scope={props.scope} surface={{ kind: 'floor' }} items={items} />
            <div className="mt-1 text-right">
              <PriceItAllAgain onPriceEverything={props.onPriceEverything} />
            </div>
          </>
        ) : (
          <NotScopedYet
            items={items}
            onStartFromEverything={props.onStartFromEverything}
            onStartFromNothing={props.onStartFromNothing}
          />
        )}
      </section>

      {ceilingHere && (
        <CeilingPanel room={props.room}>
          <WorkOnSurface {...props} surface={CEILING} roomControls={false} />
        </CeilingPanel>
      )}
    </>
  );
}
