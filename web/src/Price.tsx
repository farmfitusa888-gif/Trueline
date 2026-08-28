import { useMemo, useState } from 'react';
import type { Room } from '../../core/src/room.ts';
import type { WorkScope } from '../../core/src/work.ts';
import { money } from '../../core/src/price.ts';
import {
  type Override,
  type OverriddenLine,
  describeOverride,
} from '../../core/src/override.ts';
import { useUnits } from './units.tsx';
import { useQuote } from './quoteOf.ts';
import { RateBook } from './Rates.tsx';

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

export function Price({
  room,
  overrides,
  scope,
  markCount,
  onOverride,
  onClearOverride,
}: {
  readonly room: Room;
  readonly overrides: readonly Override[];
  /**
   * What is being done to each surface, or `null` for a room nobody has
   * scoped — which is priced exactly as this app has always priced one.
   */
  readonly scope: WorkScope | null;

  /**
   * How many marks are on this room, and nothing else about them.
   *
   * This screen prices the ROOM: every surface, as replaced, because that is
   * what a takeoff is. The marked damage is a different sheet for a different
   * payer and it is priced on Insurance. Sam went looking for the price of his
   * mould here, found a floor and a ceiling he had never said needed doing, and
   * had no way of knowing the other sheet existed. So the count comes in, to
   * say where the number is -- not to price anything.
   */
  readonly markCount: number;

  readonly onOverride: (override: Override) => void;
  readonly onClearOverride: (item: string, unit: Override['unit']) => void;
}) {
  // `save` and the typing state went to `RateBook` with the book itself: this
  // screen reads the rates to multiply by, and writes nothing to them.
  const { company } = useUnits();
  const [editing, setEditing] = useState(false);
  const [changing, setChanging] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [why, setWhy] = useState('');

  // The quantities, with whatever somebody typed over, and the money that comes
  // out of them. Shared with the proposal rather than worked out twice: two
  // screens that add the same column up are two screens that can disagree, and
  // the one that disagrees is the one in front of the client.
  const { applied, quote: priced, book, suggestions } = useQuote(room, overrides, company, scope);
  const byItem = useMemo(
    () => new Map(applied.lines.map((line) => [`${line.what}|${line.unit}`, line])),
    [applied]
  );

  /* ------------------------------------------------------------ the book */

  // The book itself lives in `Rates.tsx` and the Business tab shows the same
  // component. It used to live here, which made "where do I set my rates" a
  // question with the answer "inside a room, behind the subscription" -- and
  // that is not where a contractor types them. He types them once, at a
  // kitchen table, before the first scan.
  if (editing) {
    return <RateBook suggestions={suggestions} onDone={() => setEditing(false)} />;
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
          {/* The tour rings THIS, not the whole section: the stop is about a line
              being a rate times a quantity, and the section around it carries a
              heading, the rate book and two footnotes that the stop is not
              about. a21-tour fails a ring taller than the part of the screen
              its own card is not covering. */}
          <dl data-tour="priced-lines" className="mt-2 divide-y divide-slate-100">
            {priced.lines.map((line) => {
              const key = `${line.item}|${line.unit}`;
              const source: OverriddenLine | undefined = byItem.get(key);
              const over = source?.overridden;
              return (
                <div key={key} className="py-2">
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-slate-700">
                      {line.item}
                      <span className="block text-xs text-slate-500">
                        {line.quantity} {line.unit} at {money(line.cents)}
                      </span>
                    </dt>
                    <dd className="flex shrink-0 items-baseline gap-3">
                      <span className="font-semibold font-mono tabular-nums text-slate-900">
                        {money(line.total)}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setChanging(changing === key ? null : key);
                          setAmount(over ? line.quantity : '');
                          setWhy(over?.why ?? '');
                        }}
                        /* This row already folded back — the same control
                           opens and shuts it, which is what Sam asked for
                           everywhere. What it never did was SAY that it opens
                           anything, so a screen reader announced a button with
                           nothing behind it. The words are left exactly as
                           they were: `a19-money.mjs` and `a33-howmuch.mjs`
                           reach this by them. */
                        aria-expanded={changing === key}
                        aria-controls={`price-${key}`}
                        className="min-h-11 text-xs text-slate-500 underline underline-offset-4"
                      >
                        {changing === key ? 'Done' : over ? 'Change' : 'Price a different number'}
                      </button>
                    </dd>
                  </div>

                  {over && (
                    <p className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900">
                      {describeOverride(source!)}
                    </p>
                  )}

                  {changing === key && (
                    <div id={`price-${key}`} className="mt-2 rounded-md bg-slate-50 p-3">
                      <p className="text-xs text-slate-600">
                        This room measures{' '}
                        <strong className="font-mono tabular-nums">
                          {over ? over.was : line.quantity} {line.unit}
                        </strong>
                        . Price something else and both numbers stay on the sheet — the one the
                        room measured never goes away, and the reason goes everywhere the number
                        does.
                      </p>
                      <div className="mt-2 flex gap-2">
                        <input
                          value={amount}
                          onChange={(event) => setAmount(event.target.value)}
                          inputMode="decimal"
                          placeholder={over ? over.was : line.quantity}
                          aria-label={`Price this many ${line.unit} of ${line.item}`}
                          className="min-h-12 w-28 shrink-0 rounded-md border border-slate-300 px-2 py-2
                                     text-right font-mono tabular-nums focus:border-sky-500 focus:outline-none"
                        />
                        <input
                          value={why}
                          onChange={(event) => setWhy(event.target.value)}
                          placeholder="why — waste, full boxes, access"
                          aria-label={`Why ${line.item} is a different number`}
                          className="min-h-12 w-full rounded-md border border-slate-300 px-3 py-2
                                     focus:border-sky-500 focus:outline-none"
                        />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            onOverride({
                              item: line.item,
                              unit: line.unit,
                              quantity: amount.trim(),
                              why: why.trim(),
                              by: company.name || 'me',
                              at: new Date().toISOString(),
                            })
                          }
                          className="min-h-11 rounded-md bg-slate-900 px-4 text-sm font-semibold
                                     text-white active:bg-slate-700"
                        >
                          Price that
                        </button>
                        {over && (
                          <button
                            type="button"
                            onClick={() => {
                              onClearOverride(line.item, line.unit);
                              setChanging(null);
                            }}
                            className="min-h-11 px-2 text-sm text-slate-500 underline underline-offset-4"
                          >
                            Back to what the room measures
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </dl>

          {applied.stranded.length > 0 && (
            <p className="mt-2 text-sm text-amber-800">
              {applied.stranded.map((o) => o.item).join(', ')}{' '}
              {applied.stranded.length === 1 ? 'is' : 'are'} no longer on this sheet, so the
              number you typed for {applied.stranded.length === 1 ? 'it' : 'them'} is not being
              used. The room changed after you set{' '}
              {applied.stranded.length === 1 ? 'it' : 'them'}.
            </p>
          )}

          <div className="mt-2 border-t border-slate-200 pt-2">
            {priced.margin !== 0n && (
              <>
                <div className="flex items-baseline justify-between gap-4 py-1 text-sm text-slate-600">
                  <span>Subtotal</span>
                  <span className="font-mono tabular-nums">{money(priced.subtotal)}</span>
                </div>
                <div className="flex items-baseline justify-between gap-4 py-1 text-sm text-slate-600">
                  <span>Mark-up {(book.marginBasisPoints ?? 0) / 100}%</span>
                  <span className="font-mono tabular-nums">{money(priced.margin)}</span>
                </div>
              </>
            )}
            <div className="flex items-baseline justify-between gap-4 py-1">
              <span className="font-semibold text-slate-900">Total</span>
              <span className="text-lg font-semibold font-mono tabular-nums text-slate-900">
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

      {markCount > 0 && (
        <p className="mt-3 text-sm text-slate-600">
          <span className="font-semibold text-slate-900">This prices the whole room.</span>{' '}
          The {markCount === 1 ? 'mark you made is' : `${markCount} marks you made are`} priced on{' '}
          <span className="font-semibold text-slate-900">Insurance</span>, on {markCount === 1 ? 'its' : 'their'} own
          sheet — what it takes to put that damage right, and nothing off a surface you did not
          mark. A remodel and a restoration go to two different payers, so they are never one
          sheet.
        </p>
      )}
    </section>
  );
}
