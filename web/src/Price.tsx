import { useMemo, useState } from 'react';
import type { Room } from '../../core/src/room.ts';
import { pricing } from '../../core/src/company.ts';
import { takeoff } from '../../core/src/takeoff.ts';
import {
  type PriceUnit,
  type Rate,
  money,
  parseMoney,
  quote,
  rateLabel,
} from '../../core/src/price.ts';
import { useUnits } from './units.tsx';

/**
 * The takeoff, priced — and the rule that makes it worth trusting.
 *
 * **Nothing here invents a price.** The quantities come from the geometry, the
 * rates come from a book this contractor typed himself, and what happens between
 * them is multiplication. There is no market data, no regional average, and
 * nothing guessing what drywall costs in Ohio. A number a contractor cannot
 * defend line by line to a client is worse than no number, in exactly the way an
 * unchecked scan is worse than an honest "I have not measured it yet".
 *
 * Which is also why an item with no rate against it is **named** rather than
 * priced at zero. A quote that adds up perfectly and is short by a floor is the
 * worst thing this could produce.
 */

/** The lines a takeoff produces, so the book can be filled in without guessing. */
const KNOWN: readonly { item: string; unit: PriceUnit; prices: string }[] = [
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

export function Price({ room }: { readonly room: Room }) {
  const { company, save } = useUnits();
  const [editing, setEditing] = useState(false);
  const [typing, setTyping] = useState<Record<string, string>>({});
  const [trouble, setTrouble] = useState<string | null>(null);

  const { book, suggestions } = useMemo(() => pricing(company), [company]);
  const sheet = useMemo(
    () => takeoff(room, new Date().toLocaleString(), { company: company.name }),
    [room, company.name]
  );
  const priced = useMemo(() => quote(sheet.lines, book), [sheet, book]);

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

  /* ------------------------------------------------------------ the book */

  if (editing) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-semibold text-slate-900">What you charge</h2>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="min-h-11 px-2 text-sm text-slate-500 underline underline-offset-4"
          >
            Done
          </button>
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
                               tabular-nums focus:border-sky-500 focus:outline-none"
                  />
                  <span className="w-12 text-sm text-slate-500">/ {unit}</span>
                </dd>
              </div>
            );
          })}
        </dl>

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
                         tabular-nums focus:border-sky-500 focus:outline-none"
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

  /* ----------------------------------------------------------- the quote */

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-sheet="no">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-slate-900">What it comes to</h2>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="min-h-11 px-2 text-sm text-slate-500 underline underline-offset-4"
        >
          {book.rates.length === 0 ? 'Set your rates' : 'Your rates'}
        </button>
      </div>

      {priced.lines.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">
          Type what you charge and this room prices itself — every line a rate you set times a
          quantity the room measured.
        </p>
      ) : (
        <>
          <dl className="mt-2 divide-y divide-slate-100">
            {priced.lines.map((line) => (
              <div key={line.item} className="flex items-baseline justify-between gap-4 py-2">
                <dt className="text-slate-700">
                  {line.item}
                  <span className="block text-xs text-slate-500">
                    {line.quantity} {line.unit} at {money(line.cents)}
                  </span>
                </dt>
                <dd className="shrink-0 font-semibold tabular-nums text-slate-900">
                  {money(line.total)}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-2 border-t border-slate-200 pt-2">
            {priced.margin !== 0n && (
              <>
                <div className="flex items-baseline justify-between gap-4 py-1 text-sm text-slate-600">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{money(priced.subtotal)}</span>
                </div>
                <div className="flex items-baseline justify-between gap-4 py-1 text-sm text-slate-600">
                  <span>Mark-up {(book.marginBasisPoints ?? 0) / 100}%</span>
                  <span className="tabular-nums">{money(priced.margin)}</span>
                </div>
              </>
            )}
            <div className="flex items-baseline justify-between gap-4 py-1">
              <span className="font-semibold text-slate-900">Total</span>
              <span className="text-lg font-semibold tabular-nums text-slate-900">
                {money(priced.total)}
              </span>
            </div>
          </div>
        </>
      )}

      {priced.unpriced.length > 0 && book.rates.length > 0 && (
        <p className="mt-2 text-sm text-amber-800">
          Nothing is charged for {priced.unpriced.join(', ')} — you have not set a rate for
          {priced.unpriced.length === 1 ? ' it' : ' them'}. They are left out rather than priced
          at nothing.
        </p>
      )}

      {priced.lines.length > 0 && !priced.measured && (
        <p className="mt-2 text-sm text-slate-600">
          <span className="font-semibold text-slate-900">This is money resting on a scan.</span>{' '}
          Put a tape on one wall each way and every figure above moves to what is actually there.
        </p>
      )}
    </section>
  );
}
