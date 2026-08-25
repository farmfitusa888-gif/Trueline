import type { Room } from '../../core/src/room.ts';
import { pricing } from '../../core/src/company.ts';
import { takeoff } from '../../core/src/takeoff.ts';
import { type JobRecord, type Outcome, money, quote } from '../../core/src/price.ts';
import { useUnits } from './units.tsx';

/**
 * What happened to the quote.
 *
 * One tap, and it is worth having twice over. On its own it answers "what did I
 * send out last month and what came back", which no contractor with a phone full
 * of scans can answer today. And it is the only record the price learning can
 * honestly use: a rate is learned from jobs that were **won**, never from ones
 * that were merely quoted, because a price nobody accepted is evidence of what
 * was asked and nothing else.
 *
 * The rates are captured at the moment somebody marks it, not read back later
 * from a book that has since changed. What was charged on a job is a historical
 * fact and it must not move when the price book does.
 */

const OUTCOMES: readonly { value: Outcome; label: string; why: string }[] = [
  { value: 'quoted', label: 'Quoted', why: 'sent, waiting to hear' },
  { value: 'won', label: 'Won', why: 'this is what teaches your price book' },
  { value: 'lost', label: 'Lost', why: 'kept, and never learned from' },
];

export function JobStatus({ room, fileName }: { readonly room: Room; readonly fileName: string }) {
  const { company, save } = useUnits();
  const jobs = company.jobs ?? [];
  const existing = jobs.find((job) => job.id === fileName);
  const { book } = pricing(company);
  const priced = quote(takeoff(room, '', { company: company.name }).lines, book);

  function mark(outcome: Outcome) {
    const record: JobRecord = {
      id: fileName,
      name: room.name,
      outcome,
      at: new Date().toISOString(),
      // What was charged, captured now. A job's rates are a historical fact and
      // must not move when the price book does.
      rates: priced.lines.map((line) => ({
        item: line.item,
        unit: line.unit,
        cents: line.cents,
      })),
    };
    save({
      ...company,
      jobs: [...jobs.filter((job) => job.id !== fileName), record],
    });
  }

  if (priced.lines.length === 0) return null;

  const won = jobs.filter((job) => job.outcome === 'won').length;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-sheet="no">
      <h2 className="font-semibold text-slate-900">What happened to it</h2>
      <p className="mt-1 text-sm text-slate-600">
        {existing
          ? `Marked ${existing.outcome} at ${money(priced.total)}.`
          : `${money(priced.total)} on this one. Tap what happened when you hear.`}
      </p>

      <div className="mt-3 flex flex-wrap gap-2 print:hidden">
        {OUTCOMES.map(({ value, label, why }) => (
          <button
            key={value}
            type="button"
            title={why}
            onClick={() => mark(value)}
            className={`min-h-12 flex-1 rounded-md px-4 font-semibold ${
              existing?.outcome === value
                ? 'bg-slate-900 text-white'
                : 'border border-slate-300 text-slate-700 active:bg-slate-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <p className="mt-2 text-xs text-slate-500">
        {won === 0
          ? 'Marking jobs won is what lets the app tell you, later, what you actually charge.'
          : `${won} won so far. Three that agree on a rate and the app will say so, in your rates.`}
      </p>
    </section>
  );
}
