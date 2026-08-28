/**
 * The proposal, the signature on it, and everything that has changed since.
 *
 * Two of the four places a remodeler loses money live on this one screen.
 *
 * **Looking amateur** is answered by a document that names the work in
 * sentences, offers a choice, and can be signed in the kitchen rather than
 * emailed and chased.
 *
 * **Scope creep** is answered by what happens after the signature: the agreed
 * sheet freezes, and every later difference between it and the room becomes a
 * priced line on a change order. Scope creep stops being an argument about who
 * remembers what and becomes a list.
 *
 * Nothing here re-enters a number. Every figure comes from the same quote the
 * Price section shows, so a proposal cannot disagree with the takeoff it came
 * from — the failure that gets discovered by the client.
 *
 * ## Two ways to get it signed, and one legal question that decides the document
 *
 * A proposal gets agreed one of two ways. The client signs on the phone,
 * standing there, and `signature.ts` records intent, consent, attribution,
 * time, device and a fingerprint of the document. Or the contractor sends it,
 * they print it, sign it at the kitchen table and send a photograph back — and
 * that copy gets **filed against this proposal**, bound to the fingerprint the
 * document had when it went out. The second is weaker evidence than the first,
 * this screen says so in as many words, and `countersign.ts` makes the record
 * itself say so too.
 *
 * The legal question is **where the client signs it**. If it is anywhere but
 * the contractor's own place of business, the FTC's Cooling-Off Rule — 16 CFR
 * Part 429 — gives the buyer until midnight of the third business day to
 * cancel and makes putting the notice and two completed cancellation forms in
 * the buyer's hands the seller's job. This screen asks, and it does not answer
 * for him: the question has no default, because the only answer worth
 * defaulting to is the one that says he owes nothing. `cooling.ts` holds the
 * rule, the quotes and the arithmetic.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  type Baseline,
  type ChangeOrder,
  type Withdrawal,
  type Withdrawn,
  changesSinceVerified,
  describeChanges,
  describeWithdrawal,
  freeze,
  freezeOnReturnedCopy,
  reAgreement,
  withdraw,
  withdrawalOf,
} from '../../core/src/baseline.ts';
import { type Invoice, reversalsFor } from '../../core/src/invoice.ts';
import { money } from '../../core/src/price.ts';
import {
  type Party,
  type Proposal,
  NOBODY,
  STARTING_TERMS,
  chosenOption,
  describeProposal,
  missingFromProposal,
  optionFrom,
  proposalOf,
} from '../../core/src/proposal.ts';
import { type Override } from '../../core/src/override.ts';
import { postalAddress } from '../../core/src/company.ts';
import { handoverTime } from '../../core/src/sent.ts';
import { type Room } from '../../core/src/room.ts';
import type { WorkScope } from '../../core/src/work.ts';
import {
  type Signature,
  CLIENT_INTENT,
  CONSENT,
  describeSignature,
  hashOf,
  sign,
} from '../../core/src/signature.ts';
import {
  type CancellationNotice,
  type SaleVenue,
  WHAT_THIS_DOES_NOT_KNOW,
  cancellationNotice,
  coolingApplies,
  describeCooling,
} from '../../core/src/cooling.ts';
import {
  type CameBackBy,
  type ReturnedDocument,
  CAME_BACK_SAYS,
  WEAKER_THAN_SIGNING_HERE,
  checkReturned,
  describeReturned,
  fileSignedBack,
} from '../../core/src/countersign.ts';
import { useQuote } from './quoteOf.ts';
import { sheetOf } from './quoteOf.ts';
import { DraftButton, DraftedNote } from './Draft.tsx';
import { useUnits } from './units.tsx';
import { proposalFile } from './proposalFile.ts';
import { SignaturePad } from './SignaturePad.tsx';
import { fileNameFor, sendFile, whatWentOut } from './sheet.ts';

function Field({
  label,
  value,
  onChange,
  placeholder = '',
  type = 'text',
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly type?: string;
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
 * Today, as a plain calendar date.
 *
 * Local rather than UTC on purpose: the date on a cancellation notice is the
 * date the contractor and the client are both standing in, and a phone in
 * Arizona at nine at night must not put tomorrow on a legal form.
 */
function today(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** A picked file, as a `data:` URL, so the copy travels inside the job. */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(new Error('That file could not be read. Try the photograph again.'));
    reader.readAsDataURL(file);
  });
}

/** One of a small set of answers, as buttons rather than a dropdown. */
function Choice<T extends string>({
  value,
  options,
  onChange,
}: {
  readonly value: T | null;
  readonly options: readonly (readonly [T, string])[];
  readonly onChange: (value: T) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {options.map(([option, label]) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={`min-h-11 rounded-md px-4 text-sm font-semibold ${
            value === option
              ? 'bg-slate-900 text-white'
              : 'border border-slate-300 text-slate-700 active:bg-slate-100'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function Agree({
  room,
  overrides,
  scope,
  proposal,
  baseline,
  withdrawn = [],
  invoices = [],
  proposalSent,
  saleVenue,
  returnedCopies,
  onProposal,
  onBaseline,
  onWithdraw,
  onProposalSent,
  onSaleVenue,
  onReturnedCopies,
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
   * Kept for ever and shown for ever, each one whole with the reason beside
   * it. Nothing is erased by a withdrawal, so nothing is dropped from here.
   */
  readonly withdrawn?: readonly Withdrawn[];
  /**
   * What has been asked for on this job, so withdrawing can reverse it.
   *
   * The Work screen owns invoicing and this screen owns the agreement; the
   * reversals are worked out here because they happen in the same instant the
   * agreement is withdrawn, and a job left withdrawn with live bills on it for
   * as long as it takes somebody to open another screen is a job that is
   * asking to be paid on an agreement nobody is bound by.
   */
  readonly invoices?: readonly Invoice[];
  /** The proposal as it went out: when, and its fingerprint then. */
  readonly proposalSent: { readonly at: string; readonly hash: string } | null;
  /** Where the agreement gets made, or `null` for not asked. Never defaulted. */
  readonly saleVenue: SaleVenue | null;
  /** Signed copies that have come back. */
  readonly returnedCopies: readonly ReturnedDocument[];
  readonly onProposal: (proposal: Proposal | null) => void;
  readonly onBaseline: (baseline: Baseline) => void;
  /**
   * Withdraw the agreement, and reverse every bill raised against it, in one
   * move.
   *
   * Both together on purpose: a withdrawal that wrote the reason and left the
   * invoices standing would leave money owed on an agreement that no longer
   * exists, and there is no moment in between where that is a state anybody
   * should be able to see.
   *
   * **Optional, and the control is not drawn without it.** The action and the
   * reducer case this needs live in `web/src/state.ts`, which is not this
   * change's to edit; until they land a contractor has no way to withdraw
   * anything, and a button that cannot do what it says is worse than no button.
   * The exact strings to add are in the integration note that came with this.
   */
  readonly onWithdraw?: (
    withdrawal: Withdrawal,
    reversals: readonly Invoice[]
  ) => void;
  readonly onProposalSent: (sent: { at: string; hash: string }) => void;
  readonly onSaleVenue: (venue: SaleVenue | null) => void;
  readonly onReturnedCopies: (copies: readonly ReturnedDocument[]) => void;
}) {
  const { company } = useUnits();
  // The same quote the Price section shows, from the same hook. A proposal that
  // worked its own total out could disagree with the sheet it came from, and
  // the disagreement would be found by the client.
  const { quote: current } = useQuote(room, overrides, company, scope);
  const roomName = room.name;
  /**
   * Whether the line in the box was written by the phone and not yet read.
   *
   * Cleared the moment somebody types in the box, because from then on it is
   * their sentence — which is the whole distinction this flag exists to draw.
   */
  const [drafted, setDrafted] = useState(false);
  /** True while the proposal document is being built, so the button says so. */
  const [sending, setSending] = useState(false);
  /** What happened to the last send, or nothing. */
  const [sent, setSent] = useState<string | null>(null);

  /**
   * The proposal, as a file, out through whatever the phone shares with.
   *
   * `sendFile` puts it into Messages or Mail on an iPhone and falls back to a
   * download everywhere else, which is the same path the client file and the
   * claim already take.
   */
  async function sendProposal(): Promise<void> {
    if (!proposal) return;
    setSending(true);
    setSent(null);
    try {
      const html = proposalFile({
        proposal,
        company,
        baseline,
        // Withdrawn agreements travel onto the document too. A proposal that
        // was agreed, withdrawn and then sent again would otherwise reach the
        // client saying "Not signed yet", with no sign that anything had ever
        // been agreed or taken back -- which is the one document somebody
        // would use to argue that it never was.
        withdrawn,
        at: new Date().toLocaleDateString(),
        cooling: notice.ready,
        // Why it could not be completed, when it could not be. Without this the
        // document is silent about a notice the buyer was owed, and a buyer who
        // cannot see that something is missing cannot ask for it.
        coolingTrouble: notice.trouble,
        returned: filed,
      });
      const said = await sendFile(
        new Blob([html], { type: 'text/html;charset=utf-8' }),
        fileNameFor(proposal.roomName, 'html', 'proposal'),
        `${proposal.roomName} — proposal`
      );
      // The fingerprint of the document AT THE MOMENT IT WENT OUT, kept so a
      // signed copy that comes back can be checked against it.
      //
      // Only when something actually left. `sendFile` answers a share the
      // contractor backed out of with an empty string and nothing else does,
      // and this used to write the record regardless -- so cancelling out of
      // the share sheet put "Sent" and a fingerprint on screen for a document
      // that never left the phone.
      if (!said) return;
      setSentOut({ at: handoverTime(new Date()), hash: await hashOf(proposal) });
      setSent(said);
    } catch (error) {
      setSent(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  }
  /**
   * The work in this room, as quantities. Built here rather than taken from the
   * quote so a scope paragraph can be drafted before a single rate is typed.
   *
   * Named `sheet` rather than `scope`, which it used to be called: a scope is
   * now a real thing in this app — what is being done to each surface — and two
   * meanings of one word in one file is how the wrong one gets read.
   */
  const sheet = useMemo(
    () => sheetOf(room, company, scope, new Date().toLocaleString()),
    [room, company, scope]
  );
  const [client, setClient] = useState<Party>(proposal?.client ?? NOBODY);
  const [validUntil, setValidUntil] = useState(proposal?.validUntil ?? '');
  const [optionName, setOptionName] = useState('As measured');
  const [optionNote, setOptionNote] = useState('');
  const [terms] = useState<readonly string[]>(proposal?.terms ?? STARTING_TERMS);
  const [who, setWho] = useState('');
  const [mark, setMark] = useState('');
  const [consented, setConsented] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [order, setOrder] = useState<ChangeOrder | null>(null);
  /**
   * What the model refused when it was asked what has changed since signing.
   *
   * It refuses one thing: a baseline that has been withdrawn, because there is
   * nothing on the other side of the subtraction. That state is unreachable
   * from this screen -- the live baseline goes to `null` the instant one is
   * withdrawn -- and it is shown rather than swallowed, because a promise
   * rejecting into nothing is how a screen ends up quietly drawing no change
   * order on a job that has one.
   */
  const [orderTrouble, setOrderTrouble] = useState<string | null>(null);
  /** True once the withdraw control has been pressed and is asking why. */
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawWhy, setWithdrawWhy] = useState('');
  const [withdrawTrouble, setWithdrawTrouble] = useState<string | null>(null);

  /**
   * Where the client's agreement gets made. No default, ever.
   *
   * `null` is "not asked", and it is a state the screen shows rather than
   * resolves. Picking one for him would be picking one of two legal positions
   * on his behalf, and the convenient one — his own office, no notice owed — is
   * the one that gets a contractor sued.
   */
  // Kept beside the room rather than in this component, because a proposal
  // reopened tomorrow has to remember where it is being signed. Losing the
  // answer means asking again, and a question asked twice gets the convenient
  // answer the second time.
  const venue = saleVenue;
  const setVenue = onSaleVenue;
  /** The day it gets signed. Today until he says otherwise, and always shown. */
  const [signingDay, setSigningDay] = useState(today());
  /**
   * The proposal as it went out: when, and its fingerprint at that moment.
   *
   * The whole basis of filing a signed copy back. Without it there is nothing
   * to check a returned sheet against, which is why the screen refuses to file
   * one until the proposal has actually been sent from this phone.
   */
  const sentOut = proposalSent;
  const setSentOut = onProposalSent;
  /** Signed copies that have come back, in the order they arrived. */
  const filed = returnedCopies;
  const setFiled = onReturnedCopies;
  const [backWho, setBackWho] = useState('');
  const [backOn, setBackOn] = useState('');
  const [backHow, setBackHow] = useState<CameBackBy | null>(null);
  const [backNote, setBackNote] = useState('');
  const [backCopy, setBackCopy] = useState<{ data: string; name: string } | null>(null);
  const [backTrouble, setBackTrouble] = useState<string | null>(null);
  /**
   * Filed copies whose proposal has moved out from under them, by id.
   *
   * Checked continuously rather than only at the moment of filing, because the
   * proposal can be edited afterwards — a name corrected, an address fixed —
   * and from that instant the signed sheet in the folder is not the sheet the
   * app is showing. Finding that out at the end of the job is finding it out
   * too late, which is the same reason `changesSinceVerified` exists.
   */
  const [drifted, setDrifted] = useState<Record<string, string>>({});

  const missing = proposal ? missingFromProposal(proposal) : [];
  const taken = proposal ? chosenOption(proposal) : undefined;

  /**
   * The withdrawal of the agreement this screen is being handed as the live
   * one, when there is one — which there must never be.
   *
   * Withdrawing sets the live baseline to `null`, so a job cannot be both
   * agreed and withdrawn. This asks the question anyway, because the screen
   * must never present a withdrawn agreement as the one the job is running to
   * whatever the store hands it: "Agreed — $4,030.50" over an agreement
   * somebody withdrew is the single most expensive sentence this file could
   * print.
   */
  const liveButWithdrawn = baseline ? withdrawalOf(baseline, withdrawn) : null;

  /**
   * What the buyer is agreeing to pay, for the rule's dollar threshold.
   *
   * The chosen option once there is one. Before that, the dearest option on the
   * sheet — deliberately the largest rather than the smallest, because being
   * over the threshold is the answer that makes work for the contractor and
   * guessing low would quietly excuse him from a notice he owes.
   */
  const price = taken
    ? taken.total
    : (proposal?.options ?? []).reduce((most, option) =>
        option.total > most ? option.total : most, 0n);

  /**
   * The date of the transaction: the day the buyer's agreement is made.
   *
   * Once it is signed on the phone that is a fact and is read off the frozen
   * baseline. Before then it is whatever day the contractor says it will be
   * signed, because a notice dated today and signed on Saturday carries a
   * deadline three days short.
   */
  const transactionDay = baseline ? baseline.frozenAt.slice(0, 10) : signingDay;

  const cooling = venue ? coolingApplies(venue, price) : null;

  /**
   * The completed notice, or what is stopping it being completed.
   *
   * `cancellationNotice` refuses rather than printing a form with a hole in it,
   * and that refusal is a sentence the contractor can act on — so it is caught
   * and shown rather than swallowed.
   */
  const notice = useMemo<{ ready: CancellationNotice | null; trouble: string | null }>(() => {
    if (!cooling?.applies) return { ready: null, trouble: null };
    try {
      return {
        // Off the business profile, never off a box on this screen. It is the
        // same address on every job, so asking for it here meant retyping it on
        // every proposal -- and a field somebody retypes is a field somebody
        // eventually leaves blank, on the one form whose purpose is telling a
        // buyer where to send a cancellation. `postalAddress` hands back
        // `undefined` when nobody has filled one in, and `cancellationNotice`
        // refuses on that rather than printing a form with a hole in it.
        ready: cancellationNotice(
          { name: company.name, address: postalAddress(company) },
          transactionDay
        ),
        trouble: null,
      };
    } catch (error) {
      return { ready: null, trouble: error instanceof Error ? error.message : String(error) };
    }
  }, [cooling?.applies, company.name, company.address, transactionDay]);

  // Everything that has moved since it was signed, re-read whenever the room
  // or the rates do. Asynchronous because verifying the seal is.
  useEffect(() => {
    let live = true;
    if (!baseline || !proposal) {
      setOrder(null);
      setOrderTrouble(null);
      return;
    }
    // `withdrawn` goes in so the refusal lives in the model rather than in a
    // convention this screen is trusted to keep. See `changesSinceVerified`.
    void changesSinceVerified(baseline, proposal, current, withdrawn)
      .then((next) => {
        if (!live) return;
        setOrder(next);
        setOrderTrouble(null);
      })
      .catch((error: unknown) => {
        if (!live) return;
        setOrder(null);
        setOrderTrouble(error instanceof Error ? error.message : String(error));
      });
    return () => {
      live = false;
    };
  }, [baseline, proposal, current, withdrawn]);

  // Every filed copy re-checked against the proposal as it stands now.
  // Asynchronous because hashing is; keyed by id so the alert sits on the copy
  // it belongs to rather than at the top of a list.
  useEffect(() => {
    let live = true;
    if (!proposal || filed.length === 0) {
      setDrifted({});
      return;
    }
    void Promise.all(
      filed.map(async (one) => [one.id, await checkReturned(proposal, one)] as const)
    ).then((seals) => {
      if (!live) return;
      const bad: Record<string, string> = {};
      for (const [id, seal] of seals) if (!seal.ok) bad[id] = seal.why;
      setDrifted(bad);
    });
    return () => {
      live = false;
    };
  }, [proposal, filed]);

  const device = useMemo(
    () => (typeof navigator === 'undefined' ? 'not recorded' : navigator.userAgent),
    []
  );

  /* ------------------------------------------------------- writing one */

  if (!proposal) {
    return (
      <section
        data-sheet="no"
        className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <h2 className="font-semibold text-slate-900">Turn this into a proposal</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          The quantities and the rates are already here. A proposal is what a homeowner says
          yes to: the work in sentences, a price, what is not included, and somewhere to sign.
          Nothing is re-typed, so it cannot disagree with the takeoff.
        </p>
        <div className="mt-3 space-y-3">
          <Field label="What to call this option" value={optionName} onChange={setOptionName}
            placeholder="As measured" />
          <div>
            <Field
              label="One line on what it covers"
              value={optionNote}
              // Typing in it makes it theirs, and the draft note goes.
              onChange={(v) => { setOptionNote(v); setDrafted(false); }}
              placeholder="Everything measured in this room, finished."
            />
            <DraftedNote showing={drafted && optionNote !== ''} />
            <div className="mt-2">
              {/* The hardest box on this screen to write and the most-read line
                  on the document. What goes across is the room's name and the
                  priced lines with their quantities -- figures this app already
                  worked out. The model puts them in a sentence and is told, in
                  as many words, never to touch a number. */}
              <DraftButton
                job="scope"
                label="Draft this line"
                notes={() =>
                  [
                    `Room: ${roomName}.`,
                    `Option: ${optionName || 'As measured'}.`,
                    'The work, and how much of each:',
                    // The TAKEOFF, not the priced lines. Two reasons, and the
                    // second is the one that matters: a scope paragraph
                    // describes work rather than money, and the takeoff exists
                    // whether or not anybody has typed a rate yet. Drafting off
                    // the priced lines meant that a contractor with an empty
                    // rate book handed the model a heading and no work at all —
                    // and a paragraph written from nothing is exactly the thing
                    // this whole feature is not allowed to produce.
                    // The unit is on every line, never left to be inferred.
                    // `TakeoffLine` keeps the number and the unit apart, and a
                    // fact sheet that said "Floor: 420.0" would be handing a
                    // model a bare number to guess the meaning of — which is
                    // the exact failure this file's whole rule exists to stop.
                    ...sheet.lines.map(
                      (line) => `- ${line.what}: ${line.quantity} ${line.unit}`
                    ),
                  ].join('\n')
                }
                onWritten={(text) => {
                  setOptionNote(text);
                  setDrafted(true);
                }}
              />
            </div>
          </div>
        </div>

        {current.unpriced.length > 0 ? (
          <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
            {current.unpriced.length === 1 ? 'One line has' : `${current.unpriced.length} lines have`}{' '}
            no rate against {current.unpriced.length === 1 ? 'it' : 'them'} —{' '}
            {current.unpriced.join(', ')}. Set the rate under Price first. A proposal that quietly
            leaves work out is how a job is won at a loss.
          </p>
        ) : (
          <button
            type="button"
            onClick={() => {
              try {
                setTrouble(null);
                onProposal(
                  proposalOf(
                    `prop-${Date.now()}`,
                    roomName,
                    company,
                    client,
                    [optionFrom('a', optionName || 'As measured', optionNote, current)],
                    new Date().toISOString(),
                    validUntil,
                    terms
                  )
                );
              } catch (error) {
                setTrouble(error instanceof Error ? error.message : String(error));
              }
            }}
            className="mt-3 min-h-12 rounded-md bg-slate-900 px-5 font-semibold text-white
                       active:bg-slate-700"
          >
            Write the proposal
          </button>
        )}
        {trouble && (
          <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-900">
            {trouble}
          </p>
        )}
      </section>
    );
  }

  /* --------------------------------------------------------- the sheet */

  return (
    <div className="space-y-5">
      <section
        data-sheet="no"
        className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-semibold text-slate-900">The proposal</h2>
          {!baseline && (
            <button
              type="button"
              onClick={() => onProposal(null)}
              className="text-sm text-slate-500 underline underline-offset-4"
            >
              Start again
            </button>
          )}
        </div>


        {/* The proposal in one sentence, the way the document opens.
            It says whether the numbers are measured in the same breath as the
            price, because a client reading a total is exactly the person
            entitled to know it came off a scan nobody has checked. */}
        <p className="mt-2 text-sm text-slate-700">{describeProposal(proposal)}</p>

        {missing.length > 0 && (
          <p className="mt-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
            Still to fill in: {missing.join(', ')}. None of it stops you sending this — it is
            what somebody reading it will look for.
          </p>
        )}

        {!baseline && (
          <div className="mt-3 space-y-3">
            <Field label="Who it is for" value={client.name}
              onChange={(name) => setClient({ ...client, name })} placeholder="M. Alvarez" />
            <Field label="Address of the work" value={client.address}
              onChange={(address) => setClient({ ...client, address })} placeholder="14 Sycamore" />
            <Field label="How long the price holds" value={validUntil}
              onChange={setValidUntil} type="date" />
            <button
              type="button"
              onClick={() =>
                onProposal({ ...proposal, client, validUntil, terms })
              }
              className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium
                         text-slate-700 active:bg-slate-100"
            >
              Save these details
            </button>
          </div>
        )}

        <ul className="mt-4 space-y-3">
          {proposal.options.map((option) => {
            const picked = proposal.chosen === option.id;
            return (
              <li
                key={option.id}
                className={`rounded-lg border p-3 ${
                  picked ? 'border-slate-900 bg-slate-50' : 'border-slate-200'
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-semibold text-slate-900">{option.name}</h3>
                  <span className="font-mono text-lg font-semibold tabular-nums">
                    {money(option.total)}
                  </span>
                </div>
                {option.note && <p className="mt-1 text-sm text-slate-600">{option.note}</p>}
                <p className="mt-1 text-xs text-slate-500">
                  {option.lines.length} line{option.lines.length === 1 ? '' : 's'} ·{' '}
                  {option.measured
                    ? 'every quantity has had a tape on it'
                    : 'some quantities came off the scan and have not had a tape on them'}
                </p>
                {!baseline && (
                  <button
                    type="button"
                    onClick={() => onProposal({ ...proposal, chosen: picked ? undefined : option.id })}
                    aria-pressed={picked}
                    className={`mt-2 min-h-11 rounded-md px-4 text-sm font-semibold ${
                      picked
                        ? 'bg-slate-900 text-white'
                        : 'border border-slate-300 text-slate-700 active:bg-slate-100'
                    }`}
                  >
                    {picked ? 'This one' : 'Take this one'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        <details className="mt-4">
          <summary className="text-sm font-semibold text-slate-900">What is not included</summary>
          <ul className="mt-1 list-disc pl-5 text-sm text-slate-600">
            {proposal.terms.map((term) => (
              <li key={term}>{term}</li>
            ))}
          </ul>
        </details>

        {/* Sending it, at the FOOT of the proposal.
            
            It was at the top, beside the heading, which is where a control goes
            when nobody has thought about when it is used. Nobody sends a
            proposal before reading it: you read the options, you read what is
            not included, and then you send it. So it is here, under the last
            line of the document, which is where somebody's thumb already is.
            
            It goes out whether or not it has been signed, because an unsigned
            proposal is exactly the thing you send in order to get it signed --
            and the document says which it is, at the top, in its own words. */}
        <div className="mt-5 border-t border-slate-200 pt-4">
          {/* Answered below, never here. This is only the reminder, put where
              the thumb already is: the document that goes out is different
              depending on the answer, and sending first and answering after
              means the client is holding a proposal with no notice on it. One
              line, because everything above the signature pad pushes it further
              down a phone screen and the pad is what this screen is for. */}
          {!venue && (
            <p className="mb-2 text-sm font-medium text-amber-800">
              Answer “where does this get signed?” below before you send it.
            </p>
          )}
          {cooling && !cooling.applies && (
            <p className="mb-3 text-xs leading-relaxed text-slate-500">{cooling.why}</p>
          )}
          {notice.trouble && (
            <p role="alert" className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-900">
              {notice.trouble} Until then this goes out without the cancellation forms.
            </p>
          )}
          <button
            type="button"
            disabled={sending}
            onClick={() => void sendProposal()}
            className="min-h-11 w-full rounded-md bg-slate-900 px-4 font-semibold text-white
                       active:bg-slate-700 disabled:opacity-50"
          >
            {sending ? 'Making it…' : baseline ? 'Send the signed proposal' : 'Send this proposal'}
          </button>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            One file: every option in full, what is not included, and — once it is signed — who
            signed, when, on what, and the fingerprint that proves nothing moved since. It opens
            on anything, with no app and no signal.
          </p>
          {sent && (
            <p role="status" className="mt-2 text-sm text-slate-700">{sent}</p>
          )}
          {sentOut && (
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              {/* Not "Sent". The app hands a file to the share sheet and cannot
                  know it was delivered — and `proposalSent` only ever kept the
                  last sending, where the hand-over record keeps every one. */}
              {whatWentOut(fileNameFor(proposal.roomName, 'html', 'proposal'), null).summary}{' '}
              The fingerprint of what went out is{' '}
              <span className="font-mono">{sentOut.hash.slice(0, 16)}…</span>. A signed copy
              that comes back gets checked against it.
            </p>
          )}
        </div>
      </section>

      {/* -------------------------------------- where it gets signed */}

      {/*
        One question, and the app must not answer it.

        16 CFR 429.0(a) turns on where the buyer's agreement is made, not on who
        rang whom: "including those in response to or following an invitation by
        the buyer". A contractor invited to quote a kitchen and signing at that
        kitchen table has made a sale the rule covers, and almost every
        contractor believes the opposite because the rule is called door-to-door.

        The three answers are the rule's three cases and the money is different
        in each — $25 at the buyer's home, $130 away from it, nothing at the
        seller's own premises. See `core/src/cooling.ts`.
      */}
      <section
        data-sheet="no"
        className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <h2 className="font-semibold text-slate-900">Where does this get signed?</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          {venue
            ? 'This decides whether federal law puts a three-day cancellation notice on the ' +
              'document. Your premises means your own permanent shop, yard or office.'
            : 'Not answered, and Trueline will not guess it. Until you say, the proposal goes ' +
              'out with no cancellation notice on it. Your premises means your own permanent ' +
              'shop, yard or office.'}
        </p>
        <Choice<SaleVenue>
          value={venue}
          onChange={setVenue}
          options={[
            ['buyer-home', 'Their home'],
            ['away-from-both', 'Somewhere else'],
            ['seller-place', 'Your premises'],
          ]}
        />

        {cooling?.applies && (
          <div className="mt-3 space-y-3">
            {!baseline && (
              <Field
                label="The day it gets signed"
                value={signingDay}
                onChange={setSigningDay}
                type="date"
              />
            )}
          </div>
        )}

        {cooling && (
          <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-700">
            {describeCooling(cooling, notice.ready).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}

        {notice.trouble && (
          <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-900">
            {notice.trouble}
          </p>
        )}

        {cooling?.applies && (
          <ul className="mt-3 space-y-2 text-xs leading-relaxed text-slate-500">
            {WHAT_THIS_DOES_NOT_KNOW.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </section>

      {/* ----------------------------------------------------- signing */}

      {!baseline && (
        <section
          data-sheet="no"
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <h2 className="font-semibold text-slate-900">Sign it</h2>
          {!taken ? (
            <p className="mt-1 text-sm text-slate-600">
              Take an option above first. A signature has to be against something.
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">
                {CLIENT_INTENT}
              </p>
              <div className="mt-3 space-y-3">
                <Field label="Your name" value={who} onChange={setWho} placeholder="M. Alvarez" />
                <label className="flex items-start gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={consented}
                    onChange={(event) => setConsented(event.target.checked)}
                    aria-label="I agree to sign electronically"
                    className="mt-1 h-5 w-5"
                  />
                  <span>{CONSENT}</span>
                </label>
                {/* 16 CFR 429.1(a) wants this sentence "in immediate proximity
                    to the space reserved in the contract for the signature of
                    the buyer", in bold face type of at least ten points. On a
                    phone the space reserved for the signature is the pad, so it
                    goes here, directly above it, and not with the small print
                    at the foot where it would satisfy nobody. */}
                {notice.ready && (
                  <p className="rounded-md border-2 border-slate-900 p-3 text-[11pt]
                                font-bold leading-relaxed text-slate-900">
                    {notice.ready.statement}
                  </p>
                )}
                <SignaturePad onChange={setMark} disabled={false} />
                <button
                  type="button"
                  onClick={() => {
                    void (async () => {
                      try {
                        setTrouble(null);
                        const at = new Date().toISOString();
                        const signature: Signature = await sign(proposal, {
                          id: `sig-${Date.now()}`,
                          who,
                          role: 'client',
                          intent: CLIENT_INTENT,
                          consented,
                          mark,
                          at,
                          device,
                        });
                        onBaseline(await freeze(proposal, [signature], at));
                      } catch (error) {
                        setTrouble(error instanceof Error ? error.message : String(error));
                      }
                    })();
                  }}
                  className="min-h-12 w-full rounded-md bg-slate-900 px-5 font-semibold text-white
                             active:bg-slate-700"
                >
                  Agree to {taken.name} — {money(taken.total)}
                </button>
              </div>
              {trouble && (
                <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-900">
                  {trouble}
                </p>
              )}
              <p className="mt-3 text-xs leading-relaxed text-slate-500">
                This records who signed, when, on what, the exact words they agreed to, that they
                agreed to sign electronically, and a fingerprint of this document. Under the ESIGN
                Act and the state UETAs a signature is not invalid for being electronic, and no
                signing service is required — what decides a dispute is that record. It does not
                verify identity, and nothing here says it does.
              </p>
            </>
          )}
        </section>
      )}

      {/* ------------------------------------ the other way: signed and sent back */}

      {/*
        The second of the two ways to get a proposal agreed.

        It only appears once the proposal has actually gone out from this phone,
        and that is the feature rather than a limitation: the fingerprint of the
        document is taken at the moment it is sent, and without it there is
        nothing to check a returned sheet against. A record that says "signed"
        and cannot say WHICH VERSION was signed is the record that loses the
        argument it was kept for.
      */}
      {sentOut && (
        <section
          data-sheet="no"
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <h2 className="font-semibold text-slate-900">A signed copy came back</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            They printed it, signed it and sent it back. File it here and it is kept on this
            job, against this proposal, with the fingerprint of the version that went out.
          </p>
          <p className="mt-2 rounded-md bg-amber-50 p-3 text-sm leading-relaxed text-amber-900">
            {WEAKER_THAN_SIGNING_HERE}
          </p>

          <div className="mt-3 space-y-3">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">
                The photograph or PDF they sent
              </span>
              <input
                type="file"
                accept="image/*,application/pdf"
                aria-label="The photograph or PDF they sent"
                className="mt-1 block w-full text-sm text-slate-700"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void (async () => {
                    try {
                      setBackTrouble(null);
                      setBackCopy({ data: await readAsDataUrl(file), name: file.name });
                      // What it is, taken from the file itself rather than
                      // asked for twice. Still changeable below, because a
                      // photograph OF a signed paper page is both.
                      setBackHow(file.type === 'application/pdf' ? 'pdf' : 'photograph');
                    } catch (error) {
                      setBackTrouble(error instanceof Error ? error.message : String(error));
                    }
                  })();
                }}
              />
              {backCopy && (
                <span className="mt-1 block text-xs text-slate-500">{backCopy.name}</span>
              )}
            </label>

            <Field
              label="Who signed it"
              value={backWho}
              onChange={setBackWho}
              placeholder="M. Alvarez"
            />
            <Field
              label="The day they say they signed it"
              value={backOn}
              onChange={setBackOn}
              type="date"
            />

            <div>
              <span className="text-sm font-medium text-slate-700">How it got back to you</span>
              <Choice<CameBackBy>
                value={backHow}
                onChange={setBackHow}
                options={[
                  ['photograph', 'A photograph'],
                  ['pdf', 'A PDF'],
                  ['paper', 'On paper'],
                ]}
              />
            </div>

            <Field
              label="Anything worth putting on the record"
              value={backNote}
              onChange={setBackNote}
              placeholder="Texted it Tuesday night."
            />

            <button
              type="button"
              onClick={() => {
                void (async () => {
                  try {
                    setBackTrouble(null);
                    if (!backHow) {
                      throw new Error('Say how it got back to you.');
                    }
                    const one = await fileSignedBack(proposal, {
                      id: `back-${Date.now()}`,
                      jobName: proposal.roomName,
                      documentId: proposal.id,
                      documentKind: 'proposal',
                      sentHash: sentOut.hash,
                      sentAt: sentOut.at,
                      saysSignedBy: backWho,
                      saysSignedOn: backOn,
                      cameBackAt: new Date().toISOString(),
                      cameBackBy: backHow,
                      copy: backCopy?.data ?? '',
                      note: backNote,
                    });
                    setFiled([...filed, one]);
                    setBackWho('');
                    setBackOn('');
                    setBackNote('');
                    setBackCopy(null);
                  } catch (error) {
                    setBackTrouble(error instanceof Error ? error.message : String(error));
                  }
                })();
              }}
              className="min-h-12 w-full rounded-md bg-slate-900 px-5 font-semibold text-white
                         active:bg-slate-700"
            >
              File the signed copy
            </button>
          </div>

          {backTrouble && (
            <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-900">
              {backTrouble}
            </p>
          )}

          {filed.map((one) => (
            <div
              key={one.id}
              className="mt-4 rounded-lg border border-slate-200 p-3"
            >
              <h3 className="font-semibold text-slate-900">
                Signed copy on file — {one.saysSignedBy}
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                {CAME_BACK_SAYS[one.cameBackBy]}, filed {one.cameBackAt.slice(0, 10)}
              </p>
              {drifted[one.id] && (
                <p role="alert" className="mt-2 rounded-md bg-red-50 p-3 text-sm text-red-900">
                  {drifted[one.id]}
                </p>
              )}
              {one.copyType.startsWith('image/') && (
                <img
                  src={one.copy}
                  alt={`The signed copy that came back from ${one.saysSignedBy}`}
                  className="mt-2 max-h-48 rounded border border-slate-200 bg-white"
                />
              )}
              <ul className="mt-2 space-y-1 text-xs leading-relaxed text-slate-600">
                {describeReturned(one).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {/*
                The second way a job gets agreed. Sam: "Let it freeze the job,
                with the weakness written on the agreement."

                A contractor holding a signed photograph who cannot invoice in
                the app invoices outside it, and the app then knows less about
                his job than his email does. So this freezes the job -- and the
                baseline it writes carries, on itself and for ever, the fact
                that it was agreed on a returned copy rather than signed here.
                Nothing is softened: `freezeOnReturnedCopy` never produces a
                `Signature`, and the sentence below is the one that then prints
                on every invoice and every export.

                Hidden once there is a baseline (a job is agreed once) and while
                the proposal has moved under the copy: the core refuses that
                anyway, and a button that can only fail is worse than no button.
              */}
              {!baseline && !drifted[one.id] && taken && (
                <div className="mt-3 border-t border-slate-200 pt-3">
                  <p className="text-xs leading-relaxed text-slate-600">
                    Agreeing the job on this copy lets you invoice against it. Every invoice and
                    every document then says it was agreed on {CAME_BACK_SAYS[one.cameBackBy]}
                    {' '}and not signed here, so nobody is misled about what you are holding.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      void (async () => {
                        try {
                          setBackTrouble(null);
                          onBaseline(
                            await freezeOnReturnedCopy(proposal, one, new Date().toISOString())
                          );
                        } catch (error) {
                          setBackTrouble(error instanceof Error ? error.message : String(error));
                        }
                      })();
                    }}
                    className="mt-2 min-h-12 w-full rounded-md border-2 border-slate-900 px-5
                               font-semibold text-slate-900 active:bg-slate-100"
                  >
                    Agree the job on this signed copy — {money(taken.total)}
                  </button>
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {/* ---------------------------------------------- signed, and after */}

      {baseline && !liveButWithdrawn && (
        <section
          data-sheet="no"
          className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 shadow-sm"
        >
          <h2 className="font-semibold text-emerald-900">
            Agreed — {baseline.agreed.name}, {money(baseline.agreed.total)}
          </h2>
          {/*
            How it was agreed, said in the same breath as that it was. The
            words are the baseline's own (`AgreedByReturnedCopy.weakness` in
            core/src/baseline.ts) rather than written again here, so the screen,
            the document and the bill cannot drift apart.
          */}
          {baseline.agreedBy && (
            <p className="mt-2 rounded-md bg-amber-50 p-3 text-sm leading-relaxed text-amber-900">
              {baseline.agreedBy.weakness}
            </p>
          )}
          {baseline.signatures.map((signature) => (
            <div key={signature.id} className="mt-3">
              <img
                src={signature.mark}
                alt={`Signature of ${signature.who}`}
                className="h-20 rounded border border-emerald-200 bg-white"
              />
              <ul className="mt-2 space-y-1 text-xs leading-relaxed text-emerald-900">
                {describeSignature(signature).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ))}
          <p className="mt-3 text-xs text-emerald-900">
            This is the scope the job is measured against from here. It is never edited — anything
            that changes becomes a change order below.
          </p>

          {/* ------------------------------------------- the way out */}

          {/*
            Sam, asked whether there should be a way out once a job is agreed:
            "Withdraw it, with a reason, kept on the record."

            The word is **withdraw**, everywhere, and it is never "delete" and
            never "cancel". Delete is not what happens: the agreement, the
            signature, the bills and their reversals all stay on this job for
            ever. And "cancel" is already taken — it is the buyer's federal
            three-day right under 16 CFR 429, it belongs to the buyer, it runs
            on a clock and it has forms. Two meanings of one word on one job is
            how the wrong one gets read out in the one conversation that matters.

            It is a two-step control because it is destructive, and the second
            step is the reason rather than an "are you sure": a confirmation
            teaches somebody to press twice, and a sentence they had to write
            is the thing that is worth something in two years.
          */}
          {onWithdraw && !withdrawing && (
            <div className="mt-4 border-t border-emerald-300 pt-4">
              <button
                type="button"
                onClick={() => {
                  setWithdrawing(true);
                  setWithdrawTrouble(null);
                  // Empty every time it is opened, and emptied HERE rather
                  // than on the way out. A reason left in the box from a
                  // withdrawal somebody thought better of is a sentence that
                  // gets sent with the next one without being re-read, and
                  // this is the one field on the screen whose whole value is
                  // that somebody meant what it says. Clearing on the way in
                  // covers every way of leaving it — backed out of, withdrawn,
                  // or the screen navigated away from — with one line; clearing
                  // on the way out covers only the ways somebody remembered.
                  setWithdrawWhy('');
                }}
                className="min-h-11 w-full rounded-md border-2 border-rose-700 px-4 text-sm
                           font-semibold text-rose-800 active:bg-rose-50"
              >
                Withdraw this agreement
              </button>
              <p className="mt-2 text-xs leading-relaxed text-emerald-900">
                The job goes back to being a quote you can edit, and every invoice raised
                against it is reversed so nothing is owed on it. Nothing is deleted: this
                agreement, what it agreed, who agreed it, and every bill and its reversal all
                stay on this job with your reason beside them.
              </p>
            </div>
          )}

          {onWithdraw && withdrawing && (
            <div className="mt-4 rounded-md border-2 border-rose-400 bg-white p-3">
              <h3 className="font-semibold text-rose-900">Withdraw this agreement</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-700">
                Say why. It stays on this job beside the agreement for as long as the job
                exists, and it is the only thing that will explain this to anybody — including
                you — in two years.
              </p>
              <label className="mt-3 block">
                <span className="text-sm font-medium text-slate-700">
                  Why you are withdrawing it
                </span>
                <textarea
                  value={withdrawWhy}
                  onChange={(event) => setWithdrawWhy(event.target.value)}
                  aria-label="Why you are withdrawing it"
                  rows={3}
                  placeholder="They pulled out before the tear-out started."
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2
                             focus:border-sky-500 focus:outline-none"
                />
              </label>

              {/* The refusal goes HERE: under the box it is about and directly
                  above the button that produced it. This app has already
                  shipped a refusal 280px away from its own button once, on a
                  430 by 800 phone, and the person never saw it. */}
              {withdrawTrouble && (
                <p role="alert" className="mt-2 rounded-md bg-rose-50 p-3 text-sm text-rose-900">
                  {withdrawTrouble}
                </p>
              )}

              <button
                type="button"
                onClick={() => {
                  try {
                    setWithdrawTrouble(null);
                    const gone = withdraw(
                      baseline,
                      withdrawWhy,
                      new Date().toISOString(),
                      withdrawn
                    );
                    // The bills go back in the same move. Worked out here and
                    // handed over together, so there is no instant in which
                    // this job is withdrawn and still asking to be paid.
                    onWithdraw(gone, reversalsFor(invoices, gone));
                    setWithdrawing(false);
                    setWithdrawWhy('');
                  } catch (error) {
                    setWithdrawTrouble(error instanceof Error ? error.message : String(error));
                  }
                }}
                className="mt-3 min-h-12 w-full rounded-md bg-rose-700 px-5 font-semibold
                           text-white active:bg-rose-800"
              >
                Withdraw the agreement — {money(baseline.agreed.total)}
              </button>
              <button
                type="button"
                onClick={() => {
                  setWithdrawing(false);
                  setWithdrawTrouble(null);
                }}
                className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-4 text-sm
                           font-medium text-slate-700 active:bg-slate-100"
              >
                Not now
              </button>
            </div>
          )}
        </section>
      )}

      {/* ------------------------------------- what was withdrawn, kept */}

      {/*
        Shown whether or not there is a live agreement, and never removed. A
        withdrawn agreement that disappears off the screen is a deleted one as
        far as anybody using this is concerned, whatever the file underneath
        still holds.

        When the job HAS been agreed again, the two are put side by side with
        the difference in money between them. That is the line that stops a
        withdrawal being a way round the change-order machinery: a second
        agreement cannot launder a price rise, because there is no door to a
        baseline that does not take a fresh signature on the whole of the new
        total — but a price that moved between two agreements still has to be
        VISIBLE, and this is where it is visible. See `reAgreement` in
        `core/src/baseline.ts`.
      */}
      {withdrawn.map((one) => (
        <section
          key={`${one.withdrawal.baselineHash}-${one.withdrawal.frozenAt}`}
          data-sheet="no"
          className="rounded-xl border border-slate-300 bg-slate-50 p-4 shadow-sm"
        >
          <h2 className="font-semibold text-slate-900">
            Withdrawn — {one.baseline.agreed.name}, {money(one.withdrawal.wasTotal)}
          </h2>
          <ul className="mt-2 space-y-1 text-sm leading-relaxed text-slate-700">
            {describeWithdrawal(one).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {baseline && Date.parse(baseline.frozenAt) >= Date.parse(one.withdrawal.at) && (
            <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm leading-relaxed text-amber-900">
              {reAgreement(one, baseline).says}
            </p>
          )}
          {one.baseline.signatures.map((signature) => (
            <div key={signature.id} className="mt-3">
              <img
                src={signature.mark}
                alt={`Signature of ${signature.who} on the withdrawn agreement`}
                className="h-20 rounded border border-slate-300 bg-white"
              />
              <ul className="mt-2 space-y-1 text-xs leading-relaxed text-slate-600">
                {describeSignature(signature).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ))}
          {one.baseline.agreedBy && (
            <p className="mt-2 text-xs leading-relaxed text-slate-600">
              {one.baseline.agreedBy.weakness}
            </p>
          )}
        </section>
      ))}

      {orderTrouble && (
        <section
          data-sheet="no"
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <h2 className="font-semibold text-slate-900">What has changed since</h2>
          <p role="alert" className="mt-2 rounded-md bg-rose-50 p-3 text-sm text-rose-900">
            {orderTrouble}
          </p>
        </section>
      )}

      {order && (
        <section
          data-sheet="no"
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <h2 className="font-semibold text-slate-900">What has changed since</h2>
          {order.tampered && (
            <p role="alert" className="mt-2 rounded-md bg-red-50 p-3 text-sm text-red-900">
              {order.tamperNote}
            </p>
          )}
          <p className="mt-1 text-sm text-slate-700">{describeChanges(order)}</p>
          {order.changes.length > 0 && (
            <ul className="mt-3 space-y-2">
              {order.changes.map((change) => (
                <li
                  key={`${change.item}-${change.unit}`}
                  className="flex items-baseline justify-between gap-3 border-b border-slate-100 pb-2"
                >
                  <span className="text-sm text-slate-700">{change.says}</span>
                  <span
                    className={`shrink-0 font-mono text-sm font-semibold tabular-nums ${
                      change.difference > 0n ? 'text-red-700' : 'text-emerald-700'
                    }`}
                  >
                    {change.difference > 0n ? '+' : '−'}
                    {money(change.difference < 0n ? -change.difference : change.difference)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {order.changes.length > 0 && (
            <div className="mt-3 flex items-baseline justify-between gap-3 font-semibold">
              <span>Signed at {money(order.wasTotal)}, now</span>
              <span className="font-mono tabular-nums">{money(order.nowTotal)}</span>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
