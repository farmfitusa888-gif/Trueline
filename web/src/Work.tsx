/**
 * When it happens, and asking to be paid for it.
 *
 * The two things every platform this competes with charges a monthly fee for,
 * and neither needs a service behind it. A visit goes into the contractor's own
 * calendar — his, already synced to every device he owns, already shared with
 * whoever he shares it with — and out as an `.ics` file anybody's calendar
 * reads. An invoice is a document built from what was signed, and a way to pay
 * that he pastes in from whoever he already banks with.
 *
 * Nothing here touches money. It asks for it.
 */
import { useMemo, useState } from 'react';
import { type Baseline, type ChangeOrder, changesSince } from '../../core/src/baseline.ts';
import { money } from '../../core/src/price.ts';
import { type Override } from '../../core/src/override.ts';
import { type Proposal } from '../../core/src/proposal.ts';
import { type Room } from '../../core/src/room.ts';
import {
  type Invoice,
  type Stage,
  STAGE_TITLE,
  describeInvoice,
  invoiceOf,
  missingFromInvoice,
  outstandingAfter,
} from '../../core/src/invoice.ts';
import { quickbooksCsv, quickbooksName } from '../../core/src/quickbooks.ts';
import {
  type Visit,
  type VisitKind,
  VISIT_TITLE,
  icsName,
  icsOf,
  inOrder,
  next,
  visitOf,
} from '../../core/src/schedule.ts';
import { handBackVisits } from './bridge.ts';
import { useQuote } from './quoteOf.ts';
import { sendFile } from './sheet.ts';
import { useUnits } from './units.tsx';

function Field({
  label, value, onChange, type = 'text', placeholder = '',
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly type?: string;
  readonly placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        className="mt-1 min-h-12 w-full rounded-md border border-slate-300 px-3 py-2
                   focus:border-sky-500 focus:outline-none"
      />
    </label>
  );
}

export function Work({
  room,
  overrides,
  proposal,
  baseline,
  visits,
  invoices,
  onVisits,
  onInvoices,
}: {
  readonly room: Room;
  readonly overrides: readonly Override[];
  readonly proposal: Proposal | null;
  readonly baseline: Baseline | null;
  readonly visits: readonly Visit[];
  readonly invoices: readonly Invoice[];
  readonly onVisits: (visits: readonly Visit[]) => void;
  readonly onInvoices: (invoices: readonly Invoice[]) => void;
}) {
  const { company } = useUnits();
  // The same quote every other screen shows. An invoice worked out from its own
  // arithmetic is an invoice that can disagree with the thing somebody signed.
  const { quote: current } = useQuote(room, overrides, company);
  const [kind, setKind] = useState<VisitKind>('work');
  const [what, setWhat] = useState('');
  const [day, setDay] = useState('');
  const [from, setFrom] = useState('08:00');
  const [to, setTo] = useState('16:00');
  const [note, setNote] = useState('');
  const [number, setNumber] = useState('');
  const [stage, setStage] = useState<Stage>('deposit');
  const [deposit, setDeposit] = useState('30');
  const [dueAt, setDueAt] = useState('');
  const [payTo, setPayTo] = useState('');
  const [trouble, setTrouble] = useState<string | null>(null);
  const [calendarNote, setCalendarNote] = useState<string | null>(null);

  const where = proposal?.client.address ?? '';
  const changes: ChangeOrder | null = baseline ? changesSince(baseline, current) : null;
  const billed = useMemo(
    () => invoices.reduce((sum, invoice) => sum + invoice.amount, 0n),
    [invoices]
  );
  const upcoming = next(visits, new Date().toISOString());

  return (
    <div className="space-y-5">

      {/* --------------------------------------------------------- when */}

      <section data-sheet="no" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="font-semibold text-slate-900">When it happens</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          These go in your own calendar — no service, no monthly fee, and already on every
          device you own. Send one to a client and their calendar reads it too, whatever they use.
        </p>

        {upcoming && (
          <p className="mt-3 rounded-md bg-sky-50 p-3 text-sm text-sky-900">
            Next: <strong>{upcoming.what}</strong> —{' '}
            {new Date(upcoming.starts).toLocaleString()}
          </p>
        )}

        <div className="mt-3 space-y-3">
          <div>
            <span className="text-sm font-medium text-slate-700">What kind</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {(['measure', 'present', 'work', 'other'] as const).map((which) => (
                <button
                  key={which}
                  type="button"
                  onClick={() => setKind(which)}
                  aria-pressed={kind === which}
                  className={`min-h-11 rounded-md px-3 text-sm font-medium ${
                    kind === which
                      ? 'bg-slate-900 text-white'
                      : 'border border-slate-300 text-slate-700 active:bg-slate-100'
                  }`}
                >
                  {VISIT_TITLE[which]}
                </button>
              ))}
            </div>
          </div>
          <Field label="What is it" value={what} onChange={setWhat}
            placeholder={`${room.name} — tear out`} />
          <Field label="Day" value={day} onChange={setDay} type="date" />
          <div className="flex gap-2">
            <div className="flex-1"><Field label="Starts at" value={from} onChange={setFrom} type="time" /></div>
            <div className="flex-1"><Field label="Ends at" value={to} onChange={setTo} type="time" /></div>
          </div>
          <Field label="Anything they need to know" value={note} onChange={setNote}
            placeholder="Skip arrives at eight." />
          <button
            type="button"
            onClick={() => {
              try {
                setTrouble(null);
                const starts = new Date(`${day}T${from}`).toISOString();
                const ends = new Date(`${day}T${to}`).toISOString();
                onVisits([
                  ...visits,
                  visitOf(`v-${Date.now()}`, kind, what || VISIT_TITLE[kind], where, starts, ends, note),
                ]);
                setWhat('');
                setNote('');
              } catch (error) {
                setTrouble(error instanceof Error ? error.message : String(error));
              }
            }}
            disabled={!day}
            className="min-h-12 w-full rounded-md bg-slate-900 px-5 font-semibold text-white
                       active:bg-slate-700 disabled:opacity-40"
          >
            Put it in the calendar
          </button>
        </div>

        {trouble && (
          <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-900">{trouble}</p>
        )}

        {visits.length > 0 && (
          <>
            <ul className="mt-4 divide-y divide-slate-100">
              {inOrder(visits).map((visit) => (
                <li key={visit.id} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="text-sm text-slate-700">
                    <strong>{visit.what}</strong>
                    <span className="block text-xs text-slate-500">
                      {new Date(visit.starts).toLocaleString()} — {VISIT_TITLE[visit.kind]}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onVisits(visits.filter((v) => v.id !== visit.id))}
                    aria-label={`Take ${visit.what} off the calendar`}
                    className="min-h-11 shrink-0 px-2 text-sm text-slate-500 underline underline-offset-4"
                  >
                    Take off
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => {
                const wrote = handBackVisits(visits, company.name);
                setCalendarNote(
                  wrote
                    ? `${visits.length} ${visits.length === 1 ? 'day' : 'days'} put in your ` +
                      'own calendar. Days already added are not added twice.'
                    : null
                );
              }}
              className="mt-3 min-h-11 rounded-md bg-slate-900 px-4 text-sm font-semibold
                         text-white active:bg-slate-700"
            >
              Add to my calendar
            </button>
            {calendarNote && (
              <p className="mt-1 text-xs text-emerald-800">{calendarNote}</p>
            )}
            <button
              type="button"
              onClick={() =>
                void sendFile(
                  new Blob(
                    [icsOf(visits, new Date().toISOString(), company.name || 'Trueline')],
                    { type: 'text/calendar' }
                  ),
                  icsName(room.name),
                  `${room.name} — dates`
                )
              }
              className="mt-3 min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium
                         text-slate-700 active:bg-slate-100"
            >
              Send it to somebody
            </button>
            <p className="mt-1 text-xs text-slate-500">
              The first puts these days in your own iPhone calendar — no service, no monthly
              fee, and already on every device you own. The second sends a file anybody's
              calendar reads, whatever they use.
            </p>
          </>
        )}
      </section>

      {/* ------------------------------------------------------ invoices */}

      <section data-sheet="no" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="font-semibold text-slate-900">Asking to be paid</h2>

        {!baseline || !changes ? (
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            Nothing to invoice yet. An invoice is built from what somebody signed, never from
            what the room measures today — a bill for work nobody agreed to is not a mistake,
            it is a dispute. Get a proposal signed under Agreement first.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-slate-600">
              Agreed {money(baseline.agreed.total + changes.difference)} · invoiced so far{' '}
              {money(billed)}
            </p>

            <div className="mt-3 space-y-3">
              <div>
                <span className="text-sm font-medium text-slate-700">Which one</span>
                <div className="mt-1 flex flex-wrap gap-2">
                  {(['deposit', 'progress', 'final'] as const).map((which) => (
                    <button
                      key={which}
                      type="button"
                      onClick={() => setStage(which)}
                      aria-pressed={stage === which}
                      className={`min-h-11 rounded-md px-3 text-sm font-medium ${
                        stage === which
                          ? 'bg-slate-900 text-white'
                          : 'border border-slate-300 text-slate-700 active:bg-slate-100'
                      }`}
                    >
                      {STAGE_TITLE[which]}
                    </button>
                  ))}
                </div>
              </div>
              <Field label="Your invoice number" value={number} onChange={setNumber}
                placeholder="2026-014" />
              {stage === 'deposit' && (
                <Field label="Deposit, per cent of the job" value={deposit}
                  onChange={setDeposit} placeholder="30" />
              )}
              <Field label="When it is due" value={dueAt} onChange={setDueAt} type="date" />
              <Field label="How to pay you" value={payTo} onChange={setPayTo}
                placeholder="A payment link, bank details, or a cheque to the address above" />

              <button
                type="button"
                onClick={() => {
                  try {
                    setTrouble(null);
                    onInvoices([
                      ...invoices,
                      invoiceOf({
                        id: `inv-${Date.now()}`,
                        number,
                        stage,
                        company,
                        client: proposal?.client ?? { name: '', address: '', email: '', phone: '' },
                        jobName: room.name,
                        baseline,
                        changes,
                        alreadyBilled: billed,
                        depositPerCent: Number(deposit) || 0,
                        issuedAt: new Date().toISOString(),
                        dueAt,
                        payTo,
                      }),
                    ]);
                    setNumber('');
                  } catch (error) {
                    setTrouble(error instanceof Error ? error.message : String(error));
                  }
                }}
                className="min-h-12 w-full rounded-md bg-slate-900 px-5 font-semibold text-white
                           active:bg-slate-700"
              >
                Write the invoice
              </button>
            </div>
          </>
        )}

        {invoices.length > 0 && (
          <>
            <ul className="mt-4 divide-y divide-slate-100">
              {invoices.map((invoice) => (
                <li key={invoice.id} className="py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-slate-900">
                      {STAGE_TITLE[invoice.stage]} {invoice.number}
                    </span>
                    <span className="font-mono font-semibold tabular-nums">
                      {money(invoice.amount)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">{describeInvoice(invoice)}</p>
                  {missingFromInvoice(invoice).length > 0 && (
                    <p className="mt-1 text-xs text-amber-800">
                      Still to fill in: {missingFromInvoice(invoice).join(', ')}
                    </p>
                  )}
                  {outstandingAfter(invoice) === 0n && (
                    <p className="mt-1 text-xs text-emerald-800">This settles the job.</p>
                  )}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() =>
                void sendFile(
                  new Blob([quickbooksCsv(invoices)], { type: 'text/csv' }),
                  quickbooksName(room.name),
                  `${room.name} — invoices`
                )
              }
              className="mt-3 min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium
                         text-slate-700 active:bg-slate-100"
            >
              Send to QuickBooks
            </button>
            <p className="mt-1 text-xs text-slate-500">
              A file, not an integration: QuickBooks has imported these for as long as it has
              existed, it works on Online and Desktop, and nothing about it stops working on a
              Tuesday. Open it in a spreadsheet first if your bookkeeper wants different columns.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
