import { useRef, useState } from 'react';
import { DraftButton } from './Draft.tsx';
import {
  type ImportResult,
  type Mapping,
  type ParsedList,
  importList,
  merge,
  parseList,
} from '../../core/src/pricelist.ts';
import { money } from '../../core/src/price.ts';
import { pricing } from '../../core/src/company.ts';
import { useUnits } from './units.tsx';

/**
 * A supplier's price list, into the book.
 *
 * Two steps and never one. The file is read, the guessed columns are shown
 * against four real rows, and the person confirms or fixes them before a single
 * number reaches the book. A silent mis-mapping puts a price per sheet against
 * a rate per square foot, and the first anybody knows about it is a quote out
 * by a factor of thirty-two.
 *
 * What is refused is shown in full. A list of four hundred rows that imports
 * "381 rates" and says nothing about the other nineteen is a list somebody
 * trusts, and the nineteen are exactly the ones worth looking at — a unit
 * nothing can convert, a price with four decimal places, a duplicate the
 * supplier should be asked about.
 */

function Column({
  label,
  headers,
  value,
  onChange,
  optional,
}: {
  readonly label: string;
  readonly headers: readonly string[];
  readonly value: number | undefined;
  readonly onChange: (next: number | undefined) => void;
  readonly optional?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <select
        value={value === undefined ? '' : String(value)}
        onChange={(event) =>
          onChange(event.target.value === '' ? undefined : Number(event.target.value))
        }
        className="mt-1 min-h-12 w-full rounded-md border border-slate-300 px-2 py-2"
      >
        <option value="">{optional ? '— none —' : '— pick a column —'}</option>
        {headers.map((header, i) => (
          <option key={`${header}-${i}`} value={i}>
            {header || `column ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Turns `item = Description` lines into column numbers.
 *
 * Deliberately unforgiving in one direction and forgiving in the other: a
 * heading it cannot find is skipped and whatever was already picked stays. A
 * guess that half-lands leaves the other half as it was, and every one of them
 * is still shown in a picker before anything is imported.
 *
 * Nothing here can produce a price. It produces at most five small integers,
 * each of which is an index into the file's own headings.
 */
function readGuess(
  text: string,
  headers: readonly string[],
  already: Partial<Mapping>
): Partial<Mapping> {
  const fields = ['item', 'unit', 'price', 'code', 'coverage'] as const;
  // Built as a mutable record and handed back as the readonly shape: `Mapping`
  // is readonly for the right reason -- nothing downstream may edit a mapping
  // out from under the pickers -- and this is the one place that assembles one.
  const next: { -readonly [K in keyof Mapping]?: Mapping[K] } = { ...already };
  for (const line of text.split('\n')) {
    const [left, right] = line.split('=');
    if (left === undefined || right === undefined) continue;
    const said = left.trim().toLowerCase();
    const field = fields.find((f) => said.startsWith(f));
    if (!field) continue;
    const wanted = right.trim().toLowerCase();
    if (wanted === '' || wanted === 'none') continue;
    const at = headers.findIndex((header) => header.trim().toLowerCase() === wanted);
    if (at === -1) continue;
    next[field] = at;
  }
  return next;
}

export function PriceList() {
  const { company, save } = useUnits();
  const input = useRef<HTMLInputElement>(null);
  const [list, setList] = useState<ParsedList | null>(null);
  const [supplier, setSupplier] = useState('');
  const [mapping, setMapping] = useState<Partial<Mapping>>({});
  const [done, setDone] = useState<
    (ImportResult & { changed: readonly { item: string; was: bigint; now: bigint }[] }) | null
  >(null);
  const [trouble, setTrouble] = useState<string | null>(null);

  const { book } = pricing(company);
  const ready =
    mapping.item !== undefined && mapping.unit !== undefined && mapping.price !== undefined;

  async function read(file: File | undefined) {
    if (!file) return;
    setTrouble(null);
    setDone(null);
    try {
      const parsed = parseList(await file.text());
      setList(parsed);
      setMapping(parsed.guess);
      if (supplier.trim() === '') setSupplier(file.name.replace(/\.csv$/i, ''));
    } catch (error) {
      setList(null);
      setTrouble(error instanceof Error ? error.message : String(error));
    }
  }

  function bring() {
    if (!list || !ready) return;
    try {
      const result = importList(
        list,
        mapping as Mapping,
        company.name || 'me',
        new Date().toISOString(),
        supplier.trim() || 'a supplier'
      );
      const { rates, changed } = merge(book.rates, result.rates);
      save({ ...company, prices: { ...book, rates } });
      setDone({ ...result, changed: changed.map((c) => ({ item: c.item, was: c.was, now: c.now })) });
      setList(null);
      setTrouble(null);
    } catch (error) {
      setTrouble(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-sheet="no">
      <h2 className="font-semibold text-slate-900">Your supplier’s prices</h2>
      <p className="mt-1 text-sm text-slate-600">
        A CSV from the yard, straight into your book. Nothing is guessed at without asking: the
        columns are shown against your own rows before anything is imported, and every line that
        cannot be read is listed with the reason.
      </p>

      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        onChange={(event) => void read(event.target.files?.[0])}
        className="sr-only"
        aria-label="Choose a price list"
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="mt-3 min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium
                   text-slate-700 active:bg-slate-100"
      >
        Choose a price list
      </button>
      <p className="mt-1 text-xs text-slate-500">
        Anything that opens in a spreadsheet can save as CSV. A parser for the supplier’s own
        format is a parser this app would have to keep working forever, and one “save as” is a
        smaller ask.
      </p>

      {trouble && <p className="mt-3 text-sm text-red-700">{trouble}</p>}

      {list && (
        <div className="mt-4 border-t border-slate-200 pt-4">
          <h3 className="font-semibold text-slate-900">Which column is which</h3>
          <p className="mt-1 text-sm text-slate-600">
            {list.rows.length} row{list.rows.length === 1 ? '' : 's'} in this file. Check these
            against the rows underneath before importing.
          </p>

          <label className="mt-3 block">
            <span className="text-sm font-medium text-slate-700">Whose list this is</span>
            <input
              value={supplier}
              onChange={(event) => setSupplier(event.target.value)}
              placeholder="Miller Lumber"
              className="mt-1 min-h-12 w-full rounded-md border border-slate-300 px-3 py-2
                         focus:border-sky-500 focus:outline-none"
            />
          </label>

          {/* The mapping, guessed. It is only ever a SUGGESTION: the pickers
              below are what decides, the rows underneath show what the choice
              means, and nothing is imported until somebody presses the button.
              This turns a ten-minute job into ten seconds and moves no number
              -- every price still comes out of the file. */}
          <div className="mt-3">
            <DraftButton
              job="columns"
              label="Guess the columns"
              busyLabel="Reading the headings…"
              notes={() =>
                [
                  'Headings in the file:',
                  ...list.headers.map((header, i) => `- ${header || `column ${i + 1}`}`),
                  '',
                  'App items to match:',
                  '- item (what the thing is)',
                  '- unit (what it is priced per)',
                  '- price',
                  '- code (the supplier’s own code)',
                  '- coverage (how much one of them covers)',
                ].join('\n')
              }
              onWritten={(text) => setMapping(readGuess(text, list.headers, mapping))}
            />
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Column
              label="What the thing is"
              headers={list.headers}
              value={mapping.item}
              onChange={(item) => setMapping({ ...mapping, item })}
            />
            <Column
              label="What it is priced per"
              headers={list.headers}
              value={mapping.unit}
              onChange={(unit) => setMapping({ ...mapping, unit })}
            />
            <Column
              label="The price"
              headers={list.headers}
              value={mapping.price}
              onChange={(price) => setMapping({ ...mapping, price })}
            />
            <Column
              label="Their code for it"
              headers={list.headers}
              value={mapping.code}
              onChange={(code) => setMapping({ ...mapping, code })}
              optional
            />
            <Column
              label="How much one covers"
              headers={list.headers}
              value={mapping.coverage}
              onChange={(coverage) => setMapping({ ...mapping, coverage })}
              optional
            />
          </div>

          <p className="mt-1 text-xs text-slate-500">
            <strong>How much one covers</strong> is what makes a flooring list work at all. Tile
            is priced by the box and laid by the square foot, and the only thing connecting the
            two is the number printed on the box — which any flooring price list carries in a
            column. Map it and those rows come in; leave it and they are refused rather than
            guessed at.
          </p>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {list.rows.slice(0, 4).map((row, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="py-2 pr-3 text-slate-800">
                      {mapping.item === undefined ? '—' : row[mapping.item]}
                    </td>
                    <td className="py-2 pr-3 text-slate-600">
                      {mapping.unit === undefined ? '—' : row[mapping.unit]}
                      {mapping.coverage !== undefined && row[mapping.coverage]
                        ? ` · covers ${row[mapping.coverage]}`
                        : ''}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums text-slate-900">
                      {mapping.price === undefined ? '—' : row[mapping.price]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            disabled={!ready}
            onClick={bring}
            className="mt-3 min-h-12 w-full rounded-md bg-slate-900 px-5 font-semibold text-white
                       active:bg-slate-700 disabled:opacity-60"
          >
            {ready ? 'Bring these into my book' : 'Pick the three columns above'}
          </button>
        </div>
      )}

      {done && (
        <div className="mt-4 border-t border-slate-200 pt-4">
          <p className="font-semibold text-slate-900">
            {done.rates.length} price{done.rates.length === 1 ? '' : 's'} in your book.
          </p>

          {done.changed.length > 0 && (
            <div className="mt-2 rounded-lg bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-900">
                {done.changed.length} rate{done.changed.length === 1 ? '' : 's'} you already had
                changed
              </p>
              <ul className="mt-1 space-y-1">
                {done.changed.map((c) => (
                  <li key={c.item} className="text-sm text-amber-900">
                    {c.item}: {money(c.was)} → <strong>{money(c.now)}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {done.converted.length > 0 && (
            <div className="mt-2">
              <p className="text-sm font-semibold text-slate-900">
                {done.converted.length} price{done.converted.length === 1 ? '' : 's'} worked out
                rather than read
              </p>
              <ul className="mt-1 space-y-1">
                {done.converted.map((c) => (
                  <li key={`${c.line}-${c.item}`} className="text-sm text-slate-600">
                    {c.item}: <span className="font-mono tabular-nums">{c.workings}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-slate-500">
                These will not match the price list in your hand, and that is the point — a
                square is 100 square feet and a box covers what the box says. The sum is kept on
                every one so you can check it.
              </p>
            </div>
          )}

          {done.refused.length > 0 && (
            <div className="mt-2">
              <p className="text-sm font-semibold text-slate-900">
                {done.refused.length} row{done.refused.length === 1 ? '' : 's'} not imported
              </p>
              <ul className="mt-1 space-y-1">
                {done.refused.map((r) => (
                  <li key={r.line} className="text-sm text-slate-600">
                    <span className="font-mono tabular-nums text-slate-500">line {r.line}</span> — {r.what}:{' '}
                    {r.why}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-slate-500">
                Nothing here is guessed at. A board foot is a volume and a hundredweight is a
                mass — neither becomes an area without a thickness or a density nobody told this
                app. Rows priced by the box just need the coverage column mapped.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
