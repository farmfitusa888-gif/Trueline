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
import { useEffect, useMemo, useState } from 'react';
import {
  type Baseline,
  type ChangeOrder,
  type Withdrawn,
  changesSinceVerified,
  describeWithdrawal,
} from '../../core/src/baseline.ts';
import {
  type AgreedChange,
  type ChangeDocument,
  CHANGE_CLIENT_INTENT,
  agreeToChange,
  agreedDifference,
  describeChangeDocument,
  notYetAgreed,
  raiseChange,
} from '../../core/src/change.ts';
import { CONSENT, sign } from '../../core/src/signature.ts';
import { money } from '../../core/src/price.ts';
import { type Override } from '../../core/src/override.ts';
import { type Proposal } from '../../core/src/proposal.ts';
import { type Room } from '../../core/src/room.ts';
import type { WorkScope } from '../../core/src/work.ts';
import {
  type Invoice,
  type Stage,
  STAGE_TITLE,
  alreadyReversed,
  describeInvoice,
  invoiceOfVerified,
  missingFromInvoice,
  netAsked,
  outstandingAfter,
  whyNotBilled,
} from '../../core/src/invoice.ts';
import {
  type Payment,
  type HowPaid,
  HOW_PAID_TITLE,
  describeOwing,
  describePayment,
  owedOn,
  owing,
  paidOn,
  recordPayment,
  totalOwed,
} from '../../core/src/payment.ts';
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
import { SignaturePad } from './SignaturePad.tsx';
import { changeFile, changeFileName } from './changeFile.ts';
import { useQuote } from './quoteOf.ts';
import { sendFile, whatWentOut } from './sheet.ts';
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

/**
 * What the record says about a change order, under the button that sends it.
 *
 * A change order that went out and then moved is the failure `change.ts` exists
 * for, one level up — so the line names how many times this document left and
 * whether what left is this version. Silent until something has gone out.
 */
function WentOut({ document }: { readonly document: string }) {
  let out;
  try {
    out = whatWentOut(document, null);
  } catch {
    return null;
  }
  if (out.sendings.length === 0) return null;
  return <p className="mt-1 text-xs text-slate-500">{out.summary}</p>;
}

export function Work({
  room,
  overrides,
  scope,
  proposal,
  baseline,
  withdrawn = [],
  agreedChanges,
  raisedChange,
  visits,
  invoices,
  payments,
  onVisits,
  onAgreedChanges,
  onRaisedChange,
  onInvoices,
  onPayments,
}: {
  readonly room: Room;
  readonly overrides: readonly Override[];
  /**
   * What is being done to each surface, or `null` for a room nobody has
   * scoped — which is priced exactly as this app has always priced one.
   */
  readonly scope: WorkScope | null;
  readonly proposal: Proposal | null;
  readonly baseline: Baseline | null;
  /**
   * Agreements on this job that have been withdrawn, oldest first.
   *
   * Withdrawing is done on the Agreement screen, which is where the agreement
   * is. This screen shows what it did to the money: every bill reversed, both
   * halves on the record, and nothing owed on a job nobody is bound by.
   */
  readonly withdrawn?: readonly Withdrawn[];
  /** Change orders the client has signed. The only extras an invoice may bill. */
  readonly agreedChanges: readonly AgreedChange[];
  /** A change order written down and waiting to be signed, when there is one. */
  readonly raisedChange: ChangeDocument | null;
  readonly visits: readonly Visit[];
  readonly invoices: readonly Invoice[];
  /** What has come in against them. Written down, never taken. */
  readonly payments: readonly Payment[];
  readonly onVisits: (visits: readonly Visit[]) => void;
  readonly onAgreedChanges: (agreed: readonly AgreedChange[]) => void;
  readonly onRaisedChange: (raised: ChangeDocument | null) => void;
  readonly onInvoices: (invoices: readonly Invoice[]) => void;
  readonly onPayments: (payments: readonly Payment[]) => void;
}) {
  const { company } = useUnits();
  // The same quote every other screen shows. An invoice worked out from its own
  // arithmetic is an invoice that can disagree with the thing somebody signed.
  const { quote: current } = useQuote(room, overrides, company, scope);
  const [kind, setKind] = useState<VisitKind>('work');
  const [what, setWhat] = useState('');
  const [day, setDay] = useState('');
  const [from, setFrom] = useState('08:00');
  const [to, setTo] = useState('16:00');
  const [note, setNote] = useState('');
  const [number, setNumber] = useState('');
  const [stage, setStage] = useState<Stage>('deposit');
  /**
   * No default deposit percentage, deliberately.
   *
   * This was `'30'`. Several US states cap what a contractor may take up front
   * on home improvement work -- California's is the lesser of $1,000 or ten per
   * cent, and a breach there is a misdemeanour rather than a dispute. Shipping
   * a number means shipping a number that is illegal somewhere, to somebody who
   * reasonably assumes the app knows.
   *
   * So the field starts empty and the screen says the cap exists. The app does
   * not name a figure for any state, because it has not verified one and a
   * wrong figure here is worse than no figure.
   */
  const [deposit, setDeposit] = useState('');
  /**
   * How much of the job is done, for a progress payment.
   *
   * Empty, like the deposit, because there is no honest default: the app has
   * not been on the job site and does not know. `amountFor` refuses a progress
   * payment that has not been told, rather than quietly asking for everything.
   */
  const [complete, setComplete] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [payTo, setPayTo] = useState('');
  const [trouble, setTrouble] = useState<string | null>(null);
  const [calendarNote, setCalendarNote] = useState<string | null>(null);
  const [coNumber, setCoNumber] = useState('');
  const [coBecause, setCoBecause] = useState('');
  const [coDays, setCoDays] = useState('0');
  const [coWho, setCoWho] = useState('');
  const [coMark, setCoMark] = useState('');
  const [coConsent, setCoConsent] = useState(false);
  const [coTrouble, setCoTrouble] = useState<string | null>(null);
  /** Which invoice the money-in form is open against, if any. */
  const [paying, setPaying] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payAt, setPayAt] = useState('');
  const [payHow, setPayHow] = useState<HowPaid>('cheque');
  const [payReference, setPayReference] = useState('');
  const [payTrouble, setPayTrouble] = useState<string | null>(null);

  const where = proposal?.client.address ?? '';
  /**
   * What has moved since it was signed, WITH the seal checked.
   *
   * This called `changesSince`, which hardcodes `tampered: false` -- it cannot
   * check a seal because checking one is asynchronous. `invoiceOf` refuses to
   * bill against a tampered document, and that refusal was therefore
   * unreachable from the only screen in the app that writes invoices. The guard
   * existed, was tested, and could never fire where it mattered.
   *
   * `changesSinceVerified` re-hashes the agreed document and reports drift,
   * which is what `Agree.tsx` has always used. Same call, same shape, one await.
   */
  const [changes, setChanges] = useState<ChangeOrder | null>(null);
  /**
   * What the model refused when asked what has moved since it was signed.
   *
   * It refuses one thing: a baseline that has been withdrawn. Unreachable from
   * here, because withdrawing sets the live baseline to `null` — and shown
   * rather than swallowed, because a promise rejecting into nothing is how this
   * screen would end up drawing a bill with no idea it had been told not to.
   */
  const [changesTrouble, setChangesTrouble] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    // Both, because verifying the seal re-hashes the PROPOSAL against what the
    // signature recorded. A baseline with no proposal beside it is a state the
    // Agreement screen cannot produce, and billing against a document this
    // screen cannot check is exactly what this change exists to stop.
    if (!baseline || !proposal) {
      setChanges(null);
      setChangesTrouble(null);
      return;
    }
    void changesSinceVerified(baseline, proposal, current, withdrawn)
      .then((next) => {
        if (!live) return;
        setChanges(next);
        setChangesTrouble(null);
      })
      .catch((error: unknown) => {
        if (!live) return;
        setChanges(null);
        setChangesTrouble(error instanceof Error ? error.message : String(error));
      });
    return () => {
      live = false;
    };
  }, [baseline, proposal, current, withdrawn]);
  /**
   * What has been asked for on this job, reversals counted.
   *
   * `netAsked` rather than a sum of the bills, so a reversal takes its bill's
   * figure back off. After a withdrawal this is exactly zero, which is what
   * lets the job be agreed again and billed from the start without the deposit
   * on the withdrawn agreement being deducted from the new one.
   */
  const billed = useMemo(() => netAsked(invoices), [invoices]);
  /**
   * What the signed change orders add, and what has moved that nobody signed.
   *
   * `agreedExtra` is what may be billed; `unsigned` is what may not, named on
   * the screen so the difference between the two is visible rather than
   * mysterious. See `core/src/change.ts`.
   */
  const agreedExtra = useMemo(() => {
    if (!baseline) return 0n;
    try {
      return agreedDifference(baseline, agreedChanges);
    } catch {
      // A change order signed against a different agreement. The list says so;
      // the total refuses to guess which of them is the real one.
      return 0n;
    }
  }, [baseline, agreedChanges]);
  const unsigned = useMemo(
    () => (changes ? notYetAgreed(changes, agreedChanges) : []),
    [changes, agreedChanges]
  );
  const unsignedWorth = useMemo(
    () => unsigned.reduce((sum, one) => sum + one.difference, 0n),
    [unsigned]
  );
  /**
   * What is still out, with the reversals counted back in.
   *
   * `totalOwed` floors each invoice at zero, which is right for a bill — an
   * overpayment owes nothing — and wrong for a reversal, which would count as
   * nothing and leave the bill it reversed owed for ever. So the reversals are
   * added back at their own negative figures.
   *
   * It can go below zero, and that is a real state worth printing rather than
   * hiding: money that came in against a bill that has since been reversed is
   * money the contractor is holding on a job nobody is bound by.
   */
  const reversed = useMemo(
    () => netAsked(invoices.filter((invoice) => invoice.reverses)),
    [invoices]
  );
  const out = useMemo(
    () => totalOwed(invoices, payments) + reversed,
    [invoices, payments, reversed]
  );
  const late = useMemo(
    () => owing(invoices, payments, new Date().toISOString()),
    [invoices, payments]
  );
  const upcoming = next(visits, new Date().toISOString());
  /**
   * The last agreement withdrawn on this job, when there is one.
   *
   * The last rather than the only, because a job can be agreed, withdrawn and
   * agreed again, and each withdrawal stays on the record for ever. What these
   * two sections need to say is what happened to the agreement that is not
   * there any more, which is the most recent one.
   */
  const lastWithdrawn = withdrawn.length > 0 ? withdrawn[withdrawn.length - 1]! : null;
  /** True when this job has no live agreement because one was withdrawn. */
  const isWithdrawn = !baseline && lastWithdrawn !== null;
  /** The reversals on the job, so the screen can say how many bills went back. */
  const reversals = useMemo(() => invoices.filter((one) => one.reverses), [invoices]);
  /**
   * The bills that have been taken back, by id.
   *
   * A reversed bill is still on the record and still says what it asked for,
   * and it is finished: nothing is owed on it, it is not late, and money must
   * not be recorded against it. `owedOn` cannot know that — it only sees one
   * invoice at a time and a reversal is a different document — so the screen
   * asks here before it offers anything.
   */
  const takenBack = useMemo(() => alreadyReversed(invoices), [invoices]);

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


      {/* -------------------------------------------------- change orders */}

      <section data-sheet="no" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="font-semibold text-slate-900">Changes to what was signed</h2>

        {changesTrouble ? (
          <p role="alert" className="mt-2 rounded-md bg-rose-50 p-3 text-sm text-rose-900">
            {changesTrouble}
          </p>
        ) : isWithdrawn && lastWithdrawn ? (
          /* Nothing is measured against a withdrawn agreement, and this says so
             rather than falling through to "nothing to change yet" — which
             would be true of a job nobody has ever agreed and is a different
             sentence from a job whose agreement was taken back on purpose. */
          <div className="mt-1">
            <ul className="space-y-1 text-sm leading-relaxed text-slate-700">
              {describeWithdrawal(lastWithdrawn).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Nothing is measured against it any more, so there is no change order to raise on
              it. Agree the work again under Agreement and changes are measured against that.
            </p>
          </div>
        ) : !baseline || !changes ? (
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            Nothing to change yet. A change order amends something somebody signed, so there has
            to be a signed agreement first — get one under Agreement.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">
              Only a signed change order goes on a bill. Anything else that has moved on this
              job stays off it, however obvious it looks, because a bill for work nobody agreed
              to is the one accusation you cannot answer.
            </p>

            {agreedChanges.length > 0 && (
              <ul className="mt-3 divide-y divide-slate-100">
                {agreedChanges.map((one) => (
                  <li key={one.document.id} className="py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium text-slate-900">
                        Change order {one.document.number}
                      </span>
                      <span className="font-mono font-semibold tabular-nums text-emerald-800">
                        {one.document.difference < 0n ? '−' : '+'}
                        {money(
                          one.document.difference < 0n
                            ? -one.document.difference
                            : one.document.difference
                        )}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-emerald-800">
                      Signed by {one.signatures.map((s) => s.who).join(' and ')} on{' '}
                      {one.agreedAt.slice(0, 10)}. On the bill.
                    </p>
                    {describeChangeDocument(one.document).map((line, index) => (
                      <p key={index} className="mt-0.5 text-xs text-slate-500">
                        {line}
                      </p>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        void sendFile(
                          new Blob([changeFile({ document: one.document, agreed: one, at: new Date().toISOString().slice(0, 10) })], {
                            type: 'text/html',
                          }),
                          changeFileName(one.document),
                          `Change order ${one.document.number} — ${room.name}`
                        )
                      }
                      className="mt-2 min-h-11 rounded-md border border-slate-300 px-4 text-sm
                                 font-medium text-slate-700 active:bg-slate-100"
                    >
                      Send the signed copy
                    </button>
                    <WentOut document={changeFileName(one.document)} />
                  </li>
                ))}
              </ul>
            )}

            {!raisedChange && unsigned.length > 0 && (
              <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3">
                <p className="text-sm font-medium text-amber-900">
                  {unsigned.length} thing{unsigned.length === 1 ? '' : 's'} moved since this was
                  signed, worth {money(unsignedWorth < 0n ? -unsignedWorth : unsignedWorth)}.
                  None of it is on a bill.
                </p>
                <ul className="mt-2 space-y-1">
                  {unsigned.map((one) => (
                    <li key={`${one.item} ${one.unit}`} className="text-xs text-amber-900">
                      {one.says}
                    </li>
                  ))}
                </ul>
                <div className="mt-3 space-y-3">
                  <Field label="Your change order number" value={coNumber} onChange={setCoNumber}
                    placeholder="CO-1" />
                  <Field label="Why this is happening" value={coBecause} onChange={setCoBecause}
                    placeholder="The floor runs under the island, which nobody could see until it came out" />
                  <Field label="Days this adds to the finish date" value={coDays}
                    onChange={setCoDays} type="number" placeholder="0" />
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        setCoTrouble(null);
                        onRaisedChange(
                          raiseChange(baseline, changes, {
                            id: `co-${Date.now()}`,
                            number: coNumber,
                            jobName: room.name,
                            company,
                            client: proposal?.client ?? { name: '', address: '', email: '', phone: '' },
                            raisedAt: new Date().toISOString(),
                            because: coBecause,
                            extraDays: Number(coDays),
                          })
                        );
                      } catch (error) {
                        setCoTrouble(error instanceof Error ? error.message : String(error));
                      }
                    }}
                    className="min-h-12 w-full rounded-md bg-slate-900 px-5 font-semibold text-white
                               active:bg-slate-700"
                  >
                    Write the change order
                  </button>
                </div>
              </div>
            )}

            {raisedChange && (
              <div className="mt-4 rounded-md border-2 border-amber-400 bg-white p-3">
                <p className="text-sm font-semibold text-slate-900">
                  Change order {raisedChange.number} — waiting to be signed
                </p>
                {describeChangeDocument(raisedChange).map((line, index) => (
                  <p key={index} className="mt-0.5 text-xs text-slate-600">
                    {line}
                  </p>
                ))}
                <p className="mt-2 text-xs leading-relaxed text-slate-600">
                  Two ways to get it agreed, and they count the same. Sign it here together, or
                  send it and get it back signed. Until one of them happens, none of this is
                  authorised and none of it is billable.
                </p>

                <button
                  type="button"
                  onClick={() =>
                    void sendFile(
                      new Blob([changeFile({ document: raisedChange, agreed: null, at: new Date().toISOString().slice(0, 10) })], {
                        type: 'text/html',
                      }),
                      changeFileName(raisedChange),
                      `Change order ${raisedChange.number} — ${room.name}`
                    )
                  }
                  className="mt-3 min-h-11 w-full rounded-md border border-slate-300 px-4 text-sm
                             font-medium text-slate-700 active:bg-slate-100"
                >
                  Send it to be signed
                </button>
                <WentOut document={changeFileName(raisedChange)} />

                <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
                  <Field label="Who is signing" value={coWho} onChange={setCoWho}
                    placeholder="Their name, typed" />
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={coConsent}
                      onChange={(event) => setCoConsent(event.target.checked)}
                      className="mt-1 h-5 w-5"
                    />
                    <span className="text-sm text-slate-700">{CONSENT}</span>
                  </label>
                  <p className="text-sm text-slate-700">{CHANGE_CLIENT_INTENT}</p>
                  <SignaturePad onChange={setCoMark} disabled={false} />
                  <button
                    type="button"
                    onClick={() => {
                      setCoTrouble(null);
                      void (async () => {
                        try {
                          const at = new Date().toISOString();
                          const signature = await sign(raisedChange, {
                            id: `sig-${Date.now()}`,
                            who: coWho,
                            role: 'client',
                            intent: CHANGE_CLIENT_INTENT,
                            consented: coConsent,
                            mark: coMark,
                            at,
                            device: navigator.userAgent,
                          });
                          const agreed = await agreeToChange(raisedChange, [signature], at);
                          onAgreedChanges([...agreedChanges, agreed]);
                          onRaisedChange(null);
                          setCoNumber('');
                          setCoBecause('');
                          setCoDays('0');
                          setCoWho('');
                          setCoMark('');
                          setCoConsent(false);
                        } catch (error) {
                          setCoTrouble(error instanceof Error ? error.message : String(error));
                        }
                      })();
                    }}
                    className="min-h-12 w-full rounded-md bg-emerald-700 px-5 font-semibold
                               text-white active:bg-emerald-800"
                  >
                    Agree to this change
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      // Everything `Agree to this change` clears, because a
                      // change order torn up must not come back as the next
                      // one's number and the next one's reason. Measured: tear
                      // up CO-2 and press Write the change order with nothing
                      // retyped, and the new document calls itself CO-2 and
                      // carries the reason from the one just torn up. Two
                      // change orders under one number is not untidiness; it is
                      // two documents a client can sign that refer to each
                      // other's work.
                      onRaisedChange(null);
                      setCoNumber('');
                      setCoBecause('');
                      setCoDays('0');
                      setCoWho('');
                      setCoMark('');
                      setCoConsent(false);
                      setCoTrouble(null);
                    }}
                    className="min-h-11 w-full rounded-md border border-slate-300 px-4 text-sm
                               font-medium text-slate-700 active:bg-slate-100"
                  >
                    Tear it up and start again
                  </button>
                </div>
              </div>
            )}

            {!raisedChange && unsigned.length === 0 && (
              <p className="mt-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">
                Nothing has moved on this job that somebody has not signed for.
              </p>
            )}

            {coTrouble && (
              <p role="alert" className="mt-3 rounded-md bg-rose-50 p-3 text-sm text-rose-900">
                {coTrouble}
              </p>
            )}
          </>
        )}
      </section>

      {/* ------------------------------------------------------ invoices */}

      <section data-sheet="no" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="font-semibold text-slate-900">Asking to be paid</h2>

        {isWithdrawn && lastWithdrawn ? (
          <div className="mt-1">
            <p className="text-sm leading-relaxed text-slate-700">
              This job’s agreement was withdrawn on{' '}
              {lastWithdrawn.withdrawal.at.slice(0, 10)}, so nothing more can be asked for on
              it. Why: {lastWithdrawn.withdrawal.reason}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              {reversals.length === 0
                ? 'No invoice had been raised on it, so there was nothing to take back.'
                : `${reversals.length} invoice${reversals.length === 1 ? '' : 's'} raised ` +
                  `against it ${reversals.length === 1 ? 'was' : 'were'} reversed, for ` +
                  `${money(-netAsked(reversals))} in total. Nothing has been deleted: the ` +
                  'bills and their reversals are both below and both stay on this job.'}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Agree the work again under Agreement and you can bill against that. It will be a
              whole new agreement with its own signature on the whole of its own total, not an
              amendment to this one.
            </p>
          </div>
        ) : !baseline || !changes ? (
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            Nothing to invoice yet. An invoice is built from what somebody signed, never from
            what the room measures today — a bill for work nobody agreed to is not a mistake,
            it is a dispute. Get a proposal signed under Agreement first.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-slate-600">
              Agreed {money(baseline.agreed.total + agreedExtra)} · invoiced so far{' '}
              {money(billed)}
            </p>
            {unsigned.length > 0 && (
              <p className="mt-1 text-sm text-amber-800">
                {money(unsignedWorth < 0n ? -unsignedWorth : unsignedWorth)} has moved on this
                job that nobody has signed for, and it is not in that figure. Raise a change
                order above and it goes on the next invoice.
              </p>
            )}

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
              {stage === 'progress' && (
                <>
                  <Field label="How much of the job is done, per cent" value={complete}
                    onChange={setComplete} placeholder="50" />
                  <p className="text-xs text-slate-500">
                    A progress payment is against work that has been done. Asking for the whole
                    balance halfway through is the final invoice with the wrong word on top.
                  </p>
                </>
              )}
              <Field label="When it is due" value={dueAt} onChange={setDueAt} type="date" />
              <Field label="How to pay you" value={payTo} onChange={setPayTo}
                placeholder="A payment link, bank details, or a cheque to the address above" />

              <button
                type="button"
                onClick={() => {
                  setTrouble(null);
                  void (async () => {
                    try {
                      // Verified, not `invoiceOf`: every signed change order is
                      // re-hashed against its signature before a cent of it is
                      // billed. One that has moved since it was agreed refuses,
                      // loudly, here rather than in a dispute.
                      const invoice = await invoiceOfVerified({
                        id: `inv-${Date.now()}`,
                        number,
                        stage,
                        company,
                        client: proposal?.client ?? { name: '', address: '', email: '', phone: '' },
                        jobName: room.name,
                        baseline,
                        agreedChanges,
                        moved: changes,
                        // Belt and braces. The button is not on the screen at
                        // all when the agreement has been withdrawn, and the
                        // model refuses one anyway rather than trusting that.
                        withdrawn,
                        alreadyBilled: billed,
                        share: {
                          depositPerCent: Number(deposit) || undefined,
                          completePerCent: Number(complete) || undefined,
                        },
                        issuedAt: new Date().toISOString(),
                        dueAt,
                        payTo,
                      });
                      onInvoices([...invoices, invoice]);
                      setNumber('');
                    } catch (error) {
                      setTrouble(error instanceof Error ? error.message : String(error));
                    }
                  })();
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
            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">
                {/* Four states, and the two new ones are the reason this is not
                    a ternary. "Everything asked for is in" over a withdrawn job
                    would be exactly wrong: nothing came in, everything went
                    back. And money that came in against a bill since reversed
                    is not nothing owed either — it is money the contractor is
                    holding, and he needs to see it rather than have it net to
                    a comfortable zero. */}
                {out < 0n
                  ? `${money(-out)} came in against invoices that have since been reversed. ` +
                    'Nothing is owed on this job, and that money is still with you.'
                  : reversals.length > 0 && billed === 0n
                    ? 'Every invoice raised on this job has been reversed. Nothing is owed on ' +
                      'it, and nothing has been deleted — the bills and their reversals are ' +
                      'both below.'
                    : out === 0n
                      ? 'Everything asked for is in.'
                      : `${money(out)} still out.`}
              </p>
              {late
                .filter((row) => !takenBack.has(row.invoiceId))
                .slice(0, 3)
                .map((row) => (
                <p
                  key={row.invoiceId}
                  className={`mt-0.5 text-xs ${
                    row.daysLate > 0 ? 'font-medium text-rose-800' : 'text-slate-600'
                  }`}
                >
                  {STAGE_TITLE[row.stage]} {row.number} — {describeOwing(row)}
                </p>
              ))}
            </div>

            <ul className="mt-4 divide-y divide-slate-100">
              {invoices.map((invoice) => (
                <li key={invoice.id} className="py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    {/* A reversal is named as one, and never as the bill it
                        reverses with a minus sign in front. "Deposit 2026-014-R
                        — -$1,209.15" reads as a deposit that went wrong; what
                        this is, is a deposit that was taken back. */}
                    <span className="font-medium text-slate-900">
                      {invoice.reverses
                        ? `Reversal ${invoice.number}`
                        : `${STAGE_TITLE[invoice.stage]} ${invoice.number}`}
                    </span>
                    <span
                      className={`font-mono font-semibold tabular-nums ${
                        invoice.reverses ? 'text-rose-800' : ''
                      }`}
                    >
                      {money(invoice.amount)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">{describeInvoice(invoice)}</p>
                  {/* A bill that has been reversed is finished. It stays on
                      the record saying exactly what it asked for, and it says
                      what happened to it -- and it is not chased, not settled
                      and cannot take a payment. */}
                  {takenBack.has(invoice.id) && (
                    <p className="mt-1 text-xs text-rose-800">
                      Taken back in full by reversal {invoice.number}-R. Nothing is owed on it,
                      and it stays on this job exactly as it was sent.
                    </p>
                  )}
                  {/* Everything below is about a bill that is asking to be
                      paid. A reversal asks for nothing: nothing is due on it,
                      nothing settles it, and money cannot come in against it. */}
                  {!invoice.reverses && !takenBack.has(invoice.id) && (
                  <>
                  {missingFromInvoice(invoice).length > 0 && (
                    <p className="mt-1 text-xs text-amber-800">
                      Still to fill in: {missingFromInvoice(invoice).join(', ')}
                    </p>
                  )}
                  {outstandingAfter(invoice) === 0n && (
                    <p className="mt-1 text-xs text-emerald-800">This settles the job.</p>
                  )}
                  {whyNotBilled(invoice) !== '' && (
                    <p className="mt-1 text-xs text-amber-800">{whyNotBilled(invoice)}</p>
                  )}

                  {owedOn(invoice, payments) === 0n ? (
                    <p className="mt-1 text-xs font-medium text-emerald-800">
                      Paid in full — {money(paidOn(invoice, payments))} in.
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-slate-600">
                      {paidOn(invoice, payments) > 0n
                        ? `${money(paidOn(invoice, payments))} in, ${money(owedOn(invoice, payments))} still out.`
                        : `${money(owedOn(invoice, payments))} out, none of it in.`}
                    </p>
                  )}

                  {payments
                    .filter((payment) => payment.invoiceId === invoice.id)
                    .map((payment) => (
                      <p key={payment.id} className="mt-0.5 text-xs text-emerald-800">
                        {describePayment(payment)}
                      </p>
                    ))}

                  {owedOn(invoice, payments) > 0n && paying !== invoice.id && (
                    <button
                      type="button"
                      onClick={() => {
                        setPaying(invoice.id);
                        setPayAmount('');
                        setPayAt(new Date().toISOString().slice(0, 10));
                        setPayReference('');
                        setPayTrouble(null);
                      }}
                      className="mt-2 min-h-11 rounded-md border border-slate-300 px-4 text-sm
                                 font-medium text-slate-700 active:bg-slate-100"
                    >
                      Money came in
                    </button>
                  )}

                  {paying === invoice.id && (
                    <div className="mt-2 space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                      <Field label="How much came in" value={payAmount} onChange={setPayAmount}
                        placeholder={money(owedOn(invoice, payments)).replace('$', '')} />
                      <Field label="When it came in" value={payAt} onChange={setPayAt} type="date" />
                      <div>
                        <span className="text-sm font-medium text-slate-700">How it came in</span>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {(['cash', 'cheque', 'transfer', 'card', 'other'] as const).map((which) => (
                            <button
                              key={which}
                              type="button"
                              onClick={() => setPayHow(which)}
                              aria-pressed={payHow === which}
                              className={`min-h-11 rounded-md px-3 text-sm font-medium ${
                                payHow === which
                                  ? 'bg-slate-900 text-white'
                                  : 'border border-slate-300 text-slate-700 active:bg-slate-100'
                              }`}
                            >
                              {HOW_PAID_TITLE[which]}
                            </button>
                          ))}
                        </div>
                      </div>
                      <Field label="Reference" value={payReference} onChange={setPayReference}
                        placeholder="Cheque number, wire reference, or the last four" />
                      <p className="text-xs text-slate-500">
                        This app takes no payments and holds no card details — you are writing
                        down what arrived. Never put a full card number here; it will refuse one.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          try {
                            setPayTrouble(null);
                            const cents = BigInt(
                              Math.round(Number(payAmount.replace(/[^0-9.]/g, '')) * 100)
                            );
                            onPayments([
                              ...payments,
                              recordPayment(invoice, payments, {
                                id: `pay-${Date.now()}`,
                                amount: cents,
                                receivedAt: payAt,
                                how: payHow,
                                reference: payReference,
                              }),
                            ]);
                            setPaying(null);
                            setPayAmount('');
                            setPayReference('');
                          } catch (error) {
                            setPayTrouble(error instanceof Error ? error.message : String(error));
                          }
                        }}
                        className="min-h-12 w-full rounded-md bg-emerald-700 px-5 font-semibold
                                   text-white active:bg-emerald-800"
                      >
                        Write it down
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPaying(null);
                          setPayTrouble(null);
                        }}
                        className="min-h-11 w-full rounded-md border border-slate-300 px-4 text-sm
                                   font-medium text-slate-700 active:bg-slate-100"
                      >
                        Not now
                      </button>
                      {payTrouble && (
                        <p role="alert" className="rounded-md bg-rose-50 p-3 text-sm text-rose-900">
                          {payTrouble}
                        </p>
                      )}
                    </div>
                  )}
                  </>
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
