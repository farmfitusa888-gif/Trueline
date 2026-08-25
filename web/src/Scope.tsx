import { useMemo, useState } from 'react';
import type { Room } from '../../core/src/room.ts';
import { type Damage, affectedPerMille } from '../../core/src/damage.ts';
import { SCOPE_ITEMS, damageScope } from '../../core/src/scope.ts';
import { pricing } from '../../core/src/company.ts';
import { type Rate, money, parseMoney, quote } from '../../core/src/price.ts';
import { useUnits } from './units.tsx';

/**
 * What it takes to put the damage right, priced, on its own sheet.
 *
 * Two sheets and never one. The takeoff answers "what does this room need" and
 * is priced by a homeowner; this answers "what does this loss need" and is
 * priced by a carrier. A single sheet holding both is a sheet somebody bills
 * the wrong party off, which is a mistake that is expensive in both directions.
 *
 * The rate rows are generated from `SCOPE_ITEMS` — the same list the lines come
 * out of — rather than from a second list kept in step by hand. A rate typed
 * against an item that no longer exists is a rate that silently never applies,
 * and the quote comes out short by exactly whatever it was for.
 */

export function Scope({
  room,
  damages,
}: {
  readonly room: Room;
  readonly damages: readonly Damage[];
}) {
  const { company, save } = useUnits();
  const [editing, setEditing] = useState(false);
  const [typing, setTyping] = useState<Record<string, string>>({});
  const [trouble, setTrouble] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const { book } = useMemo(() => pricing(company), [company]);
  const affected = affectedPerMille(room, damages);

  const sheet = useMemo(
    () => damageScope(room, damages, new Date().toLocaleString()),
    [room, damages]
  );
  const priced = useMemo(() => quote(sheet.lines, book), [sheet, book]);

  function setRate(item: string, unit: 'sq ft' | 'lf', text: string) {
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

  async function copy(what: 'text' | 'csv') {
    try {
      await navigator.clipboard.writeText(sheet[what]);
      setCopied(what === 'text' ? 'The scope is on the clipboard.' : 'The rows are on the clipboard.');
    } catch {
      setCopied('This browser would not give the clipboard. Select the sheet and copy it.');
    }
  }

  if (damages.length === 0) return null;

  /* ------------------------------------------------------------ the rates */

  if (editing) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-sheet="no">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-semibold text-slate-900">What you charge on restoration</h2>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="min-h-11 px-2 text-sm text-slate-500 underline underline-offset-4"
          >
            Done
          </button>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Kept apart from your remodel rates on purpose. Tear-out and rebuild on a claim are not
          priced the way a kitchen is, and one book holding both is how a carrier gets billed a
          remodel rate.
        </p>

        <dl className="mt-3 divide-y divide-slate-100">
          {SCOPE_ITEMS.map(({ item, unit, prices, stage }) => {
            const key = `${item}|${unit}`;
            const rate = book.rates.find((r) => r.item === item && r.unit === unit);
            return (
              <div key={key} className="flex items-baseline justify-between gap-3 py-3">
                <dt className="text-slate-700">
                  {item}
                  <span className="block text-xs text-slate-500">
                    {stage} · {prices}
                  </span>
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

        {trouble && <p className="mt-3 text-sm text-red-700">{trouble}</p>}
      </section>
    );
  }

  /* ------------------------------------------------------------ the sheet */

  const stages = ['tear out', 'protect', 'rebuild'] as const;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-slate-900">What the damage takes</h2>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="min-h-11 shrink-0 px-2 text-sm text-slate-500 underline underline-offset-4"
        >
          Your rates
        </button>
      </div>

      {/* Patch or gut, as a share of the room's own wall face.
          The question an adjuster and a contractor are both answering in their
          heads before anything else, and the room already knows enough to
          answer it. In tenths of a percent so it stays an integer -- nothing
          here is ever a float. */}
      {damages.length > 0 && (
        <p className="mt-2 text-sm text-slate-600">
          The damage covers{' '}
          <strong className="tabular-nums">{Number(affected) / 10}%</strong> of this room's wall
          face.{' '}
          {affected >= 500n
            ? 'Over half of it — this is a gut rather than a patch, and it is worth saying so on the estimate.'
            : affected >= 200n
              ? 'Enough that patching and repainting one wall will not match; price the whole surface.'
              : 'A patch. The rest of the room is untouched.'}
        </p>
      )}

      {stages.map((stage) => {
        const inStage = sheet.lines.filter((l) => l.stage === stage);
        if (inStage.length === 0) return null;
        return (
          <div key={stage} className="mt-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{stage}</h3>
            <dl className="mt-1 divide-y divide-slate-100">
              {inStage.map((l, n) => {
                const cost = priced.lines.find((p) => p.item === l.what && p.quantity === l.quantity);
                return (
                  <div key={`${l.damageId}-${l.what}-${n}`} className="py-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-slate-800">{l.what}</dt>
                      <dd className="shrink-0 text-right tabular-nums text-slate-900">
                        {l.quantity} {l.unit}
                        {cost && (
                          <span className="ml-3 font-semibold">{money(cost.total)}</span>
                        )}
                      </dd>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">{l.workings}</p>
                    {l.widerThanTheDamage && (
                      <p className="mt-0.5 text-xs text-amber-800">{l.widerThanTheDamage}</p>
                    )}
                  </div>
                );
              })}
            </dl>
          </div>
        );
      })}

      {priced.lines.length > 0 && (
        <dl className="mt-4 divide-y divide-slate-200 border-t-2 border-slate-300">
          <div className="flex items-baseline justify-between gap-3 py-2">
            <dt className="text-slate-700">Priced so far</dt>
            <dd className="shrink-0 font-semibold tabular-nums text-slate-900">
              {money(priced.subtotal)}
            </dd>
          </div>
          {priced.margin !== 0n && (
            <div className="flex items-baseline justify-between gap-3 py-2">
              <dt className="text-slate-700">Mark-up</dt>
              <dd className="shrink-0 tabular-nums text-slate-900">{money(priced.margin)}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-3 py-2">
            <dt className="font-semibold text-slate-900">Total</dt>
            <dd className="shrink-0 text-lg font-semibold tabular-nums text-slate-900">
              {money(priced.total)}
            </dd>
          </div>
        </dl>
      )}

      {priced.unpriced.length > 0 && (
        <p className="mt-2 text-sm text-amber-800">
          No rate yet for {priced.unpriced.join(', ')}. Those are <strong>not in the total</strong>
          {' '}— a sheet that adds up perfectly and is short by a tear-out is the worst thing this
          could hand you. Tap "your rates" and they come in.
        </p>
      )}

      {sheet.noWork.length > 0 && (
        <p className="mt-2 text-sm text-slate-600">
          Marked and not on this sheet: {sheet.noWork.join('; ')}. A pin is a marker, not a
          measurement, and nobody can price a marker.
        </p>
      )}

      <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        {sheet.note}
      </p>

      <div className="mt-3 flex flex-wrap gap-2 print:hidden">
        <button
          type="button"
          onClick={() => void copy('text')}
          className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium
                     text-slate-700 active:bg-slate-100"
        >
          Copy the scope
        </button>
        <button
          type="button"
          onClick={() => void copy('csv')}
          className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium
                     text-slate-700 active:bg-slate-100"
        >
          Spreadsheet
        </button>
      </div>
      {copied && <p className="mt-2 text-sm text-slate-600">{copied}</p>}
    </section>
  );
}
