import { useState } from 'react';
import {
  type PriceUnit,
  type Rate,
  parseMoney,
  rateLabel,
} from '../../core/src/price.ts';
import {
  type MeasureId,
  type WorkItem,
  MEASURES,
  measureById,
  rateFor,
} from '../../core/src/work.ts';
import { useUnits } from './units.tsx';

/**
 * What you charge, in one place, reachable without a room open.
 *
 * ## Why this moved out of `Price`
 *
 * > "AND WHERES THE AREA THE CONTRACTOR CAN SET THEIR OWN RATES FOR EACH TYPE
 * >  OF JOB? SO COST CAN FILL WITH THE MEASURED AREA TO GIVE A CONSISTENT
 * >  PRICE/ESTIMATE"
 *
 * It existed. It was behind **Price → Set your rates**, which is inside a room,
 * behind the subscription, on a screen that was rendering blank because the
 * entitlement never arrived (`bridge.ts`). Three doors, and the outermost one
 * was painted shut.
 *
 * But the deeper problem is that it was in the wrong place to begin with. The
 * rates are **not part of a room**: they save to the company profile, they are
 * the same book in every job, and typing them is something a contractor does
 * once, at a kitchen table, before the first scan. Reaching them only from
 * inside a room is like keeping the price list in one customer's folder.
 *
 * So the book lives here and both screens show it: the Business tab, next to
 * the licence number and the supplier price list, and still under **Price →
 * Your rates** where somebody is looking at the money and wants to change a
 * number without losing their place. One book, one component, two doors.
 *
 * ## What it never does
 *
 * Invents a price. There is no market data, no regional average, and nothing
 * guessing what drywall costs in Ohio. Every rate is typed, or taken from this
 * contractor's own won jobs on a tap. A number he cannot defend line by line to
 * a client is worse than no number.
 */

/** The lines a takeoff produces, so the book can be filled in without guessing. */
export const KNOWN: readonly { item: string; unit: PriceUnit; prices: string }[] = [
  { item: 'Floor', unit: 'sq ft', prices: 'flooring, tile, underlay' },
  { item: 'Ceiling', unit: 'sq ft', prices: 'ceiling drywall and paint' },
  { item: 'Wall face', unit: 'sq ft', prices: 'drywall, paint, primer' },
  { item: 'Baseboard', unit: 'lf', prices: 'base, shoe, trim' },
  { item: 'Doors', unit: 'ea', prices: 'slab, jamb, casing, hardware' },
  { item: 'Windows', unit: 'ea', prices: 'glazing and trim' },
  { item: 'Cased openings', unit: 'ea', prices: 'jamb and casing' },
  { item: 'Opening wrap', unit: 'sq ft', prices: 'drywall return, reveal trim' },
  { item: 'Plates', unit: 'lf', prices: 'plate stock' },
  { item: 'Studs', unit: 'ea', prices: 'stud stock' },
  { item: 'Headers', unit: 'ea', prices: 'header stock' },
];

export function RateBook({
  suggestions = [],
  onDone,
}: {
  /**
   * Rates this contractor's own won jobs suggest, when there is a room open to
   * work them out from. Empty on the Business tab, where the section simply
   * does not appear -- rather than appearing empty, which reads as broken.
   */
  readonly suggestions?: readonly Rate[];
  /** Given only where there is somewhere to go back to. */
  readonly onDone?: () => void;
}) {
  const { company, save } = useUnits();
  const book = company.prices ?? { rates: [], marginBasisPoints: 0 };
  const [typing, setTyping] = useState<Record<string, string>>({});
  const [trouble, setTrouble] = useState<string | null>(null);

  function setRate(item: string, unit: PriceUnit, text: string) {
    try {
      const trimmed = text.trim();
      const rest = book.rates.filter((r) => !(r.item === item && r.unit === unit));
      const rates: Rate[] =
        trimmed === ''
          ? rest
          : [
              ...rest,
              {
                item,
                unit,
                cents: parseMoney(trimmed),
                source: { kind: 'typed', by: company.name || 'me', at: new Date().toISOString() },
              },
            ];
      save({ ...company, prices: { ...book, rates } });
      setTrouble(null);
    } catch (error) {
      setTrouble(error instanceof Error ? error.message : String(error));
    }
  }

  const priceOf = (item: string, unit: PriceUnit) =>
    book.rates.find((r) => r.item === item && r.unit === unit);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-slate-900">What you charge</h2>
        {onDone && (
          <button
            type="button"
            onClick={onDone}
            className="min-h-11 px-2 text-sm text-slate-500 underline underline-offset-4"
          >
            Done
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-600">
        Your rates, typed once. Nothing here comes from anywhere else — no averages, no
        guesses — so every line on a quote is a number you set times a number the room
        measured, and you can defend both.
      </p>

      <dl className="mt-3 divide-y divide-slate-100">
        {KNOWN.map(({ item, unit, prices }) => {
          const key = `${item}|${unit}`;
          const rate = priceOf(item, unit);
          return (
            <div key={key} className="flex items-baseline justify-between gap-3 py-3">
              <dt className="text-slate-700">
                {item}
                <span className="block text-xs text-slate-500">{prices}</span>
              </dt>
              <dd className="flex shrink-0 items-baseline gap-2">
                <input
                  value={typing[key] ?? (rate ? (Number(rate.cents) / 100).toFixed(2) : '')}
                  onChange={(event) => setTyping({ ...typing, [key]: event.target.value })}
                  onBlur={(event) => {
                    setRate(item, unit, event.target.value);
                    setTyping(({ [key]: _gone, ...rest }) => rest);
                  }}
                  inputMode="decimal"
                  placeholder="—"
                  aria-label={`${item} rate`}
                  className="min-h-11 w-24 rounded-md border border-slate-300 px-2 py-1 text-right
                             font-mono tabular-nums focus:border-sky-500 focus:outline-none"
                />
                <span className="w-12 text-sm text-slate-500">/ {unit}</span>
              </dd>
            </div>
          );
        })}
      </dl>

      <OwnItems />

      <label className="mt-4 block">
        <span className="text-sm font-medium text-slate-700">Mark-up on the whole job</span>
        <span className="mt-1 flex items-baseline gap-2">
          <input
            value={String((book.marginBasisPoints ?? 0) / 100)}
            onChange={(event) => {
              const percent = Number(event.target.value);
              if (!Number.isFinite(percent)) return;
              save({
                ...company,
                prices: { ...book, marginBasisPoints: Math.round(percent * 100) },
              });
            }}
            inputMode="decimal"
            className="min-h-11 w-24 rounded-md border border-slate-300 px-2 py-1 text-right
                       font-mono tabular-nums focus:border-sky-500 focus:outline-none"
          />
          <span className="text-sm text-slate-500">%</span>
        </span>
      </label>

      {suggestions.length > 0 && (
        <div className="mt-4 rounded-lg bg-slate-100 p-3">
          <p className="text-sm font-semibold text-slate-900">What your won jobs say</p>
          <p className="mt-1 text-xs text-slate-600">
            From jobs you marked won, never from ones you did not. The middle number, so one
            emergency job at triple rate does not move your book. Nothing changes unless you
            tap it.
          </p>
          <ul className="mt-2 space-y-1">
            {suggestions.map((r) => (
              <li key={`${r.item}|${r.unit}`} className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-slate-700">
                  {r.item} — {rateLabel(r)}
                  {r.source.kind === 'learned' && (
                    <span className="block text-xs text-slate-500">
                      from {r.source.from.join(', ')}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setRate(r.item, r.unit, (Number(r.cents) / 100).toFixed(2))}
                  className="min-h-11 shrink-0 rounded-md border border-slate-300 px-3 text-sm
                             font-medium text-slate-700 active:bg-slate-100"
                >
                  Use it
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {trouble && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {trouble}
        </p>
      )}
    </section>
  );

}

/**
 * Items the contractor invents, and the field that makes them worth having.
 *
 * > "And if there's things not in the costing option yet, let them make it and
 * >  it also goes into their cost options."
 *
 * A name, a unit and a price is a line in a spreadsheet. What makes it part of
 * *this* app is the fourth field: **where the quantity comes from.** "Skim
 * coat, sq ft, $2.10" is worth nothing until the book knows it is charged
 * against a wall's face — and then it can be ticked on three walls, it lands on
 * the sheet at the right number, and it moves when somebody puts a tape on one
 * of them. That is the difference between a price list and a takeoff.
 *
 * It goes into the rate book, which lives on the company rather than on the
 * job, so an item invented tonight is offered on every job afterwards. After
 * ten jobs the book is genuinely his.
 *
 * The one thing that cannot be invented is a measurement. An item whose
 * quantity is a number he types says so on the sheet, every time, because a
 * typed number does not move when the room does and a client reading a quote is
 * entitled to know which of the two he is looking at.
 */
function OwnItems() {
  const { company, save } = useUnits();
  const book = company.prices ?? { rates: [] };
  const mine = book.rates.filter((rate) => rate.measure !== undefined);

  const [name, setName] = useState('');
  const [measure, setMeasure] = useState<MeasureId>('wall face');
  const [price, setPrice] = useState('');
  const [amount, setAmount] = useState('');
  const [covers, setCovers] = useState('');
  const [trouble, setTrouble] = useState<string | null>(null);

  const chosen = measureById(measure);
  const [unit, setUnit] = useState<PriceUnit>('ea');
  // A measured item is charged in the unit it is measured in — there is no
  // choice to offer, and offering one is how a square foot becomes a linear
  // foot three steps later. Only a typed quantity has a free unit.
  const effective: PriceUnit = measure === 'typed' ? unit : chosen.unit;

  function add() {
    try {
      const item: WorkItem = {
        item: name.trim(),
        unit: effective,
        measure,
        prices: covers.trim(),
        own: true,
        ...(measure === 'typed' ? { amount: amount.trim() } : {}),
      };
      const rate = rateFor(item, parseMoney(price), company.name || 'me', new Date().toISOString());
      const rest = book.rates.filter((r) => !(r.item === rate.item && r.unit === rate.unit));
      save({ ...company, prices: { ...book, rates: [...rest, rate] } });
      setName('');
      setPrice('');
      setAmount('');
      setCovers('');
      setTrouble(null);
    } catch (error) {
      setTrouble(error instanceof Error ? error.message : String(error));
    }
  }

  function remove(rate: Rate) {
    save({
      ...company,
      prices: {
        ...book,
        rates: book.rates.filter((r) => !(r.item === rate.item && r.unit === rate.unit)),
      },
    });
  }

  return (
    <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <h3 className="text-sm font-semibold text-slate-900">Your own items</h3>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">
        Anything you charge for that is not on the list above. Say where its quantity comes from
        and it can be ticked on a wall, on the floor or on the ceiling — and it moves when you put
        a tape on that wall. Everything you add here is offered on every job from now on.
      </p>

      {mine.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-200">
          {mine.map((rate) => (
            <li
              key={`${rate.item}|${rate.unit}`}
              className="flex items-baseline justify-between gap-3 py-2"
            >
              <span className="min-w-0">
                <span className="block text-sm text-slate-800">{rate.item}</span>
                <span className="block text-xs text-slate-500">
                  {rateLabel(rate)} · {measureById(rate.measure as MeasureId).label}
                  {rate.amount ? ` · ${rate.amount} each time` : ''}
                </span>
              </span>
              <button
                type="button"
                onClick={() => remove(rate)}
                aria-label={`Remove ${rate.item}`}
                className="min-h-11 shrink-0 text-xs text-slate-500 underline underline-offset-4"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 grid gap-2">
        <label className="block">
          <span className="text-xs font-medium text-slate-700">What you call it</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Skim coat"
            aria-label="What you call it"
            className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2
                       focus:border-sky-500 focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-slate-700">Where its quantity comes from</span>
          <select
            value={measure}
            onChange={(event) => setMeasure(event.target.value as MeasureId)}
            aria-label="Where its quantity comes from"
            className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 py-2
                       focus:border-sky-500 focus:outline-none"
          >
            {MEASURES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        {measure === 'typed' ? (
          <div className="flex gap-2">
            <label className="block">
              <span className="text-xs font-medium text-slate-700">How many, each time</span>
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                placeholder="1"
                aria-label="How many, each time"
                className="mt-1 min-h-11 w-24 rounded-md border border-slate-300 px-3 py-2
                           text-right font-mono tabular-nums focus:border-sky-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700">Charged by the</span>
              <select
                value={unit}
                onChange={(event) => setUnit(event.target.value as PriceUnit)}
                aria-label="Charged by the"
                className="mt-1 min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2
                           focus:border-sky-500 focus:outline-none"
              >
                <option value="ea">ea</option>
                <option value="sq ft">sq ft</option>
                <option value="lf">lf</option>
              </select>
            </label>
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            Charged by the <strong>{effective}</strong>, because that is how it is measured. A rate
            in one unit against a quantity in another is how a square foot becomes a linear foot
            three steps later.
          </p>
        )}

        <label className="block">
          <span className="text-xs font-medium text-slate-700">What it covers</span>
          <input
            value={covers}
            onChange={(event) => setCovers(event.target.value)}
            placeholder="plaster, labour"
            aria-label="What it covers"
            className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3 py-2
                       focus:border-sky-500 focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-slate-700">
            What you charge, per {effective}
          </span>
          <input
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            inputMode="decimal"
            placeholder="2.10"
            aria-label={`What you charge, per ${effective}`}
            className="mt-1 min-h-11 w-28 rounded-md border border-slate-300 px-3 py-2 text-right
                       font-mono tabular-nums focus:border-sky-500 focus:outline-none"
          />
        </label>

        <button
          type="button"
          onClick={add}
          className="min-h-12 rounded-md bg-slate-900 px-5 font-semibold text-white active:bg-slate-700"
        >
          Add it to your rates
        </button>
      </div>

      {trouble && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {trouble}
        </p>
      )}
    </div>
  );
}
