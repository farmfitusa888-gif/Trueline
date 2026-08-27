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
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type Baseline,
  type ChangeOrder,
  changesSinceVerified,
  describeChanges,
  freeze,
} from '../../core/src/baseline.ts';
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
import { type Room } from '../../core/src/room.ts';
import {
  type Signature,
  CLIENT_INTENT,
  CONSENT,
  describeSignature,
  sign,
} from '../../core/src/signature.ts';
import { useQuote } from './quoteOf.ts';
import { takeoff as buildTakeoff } from '../../core/src/takeoff.ts';
import { DraftButton, DraftedNote } from './Draft.tsx';
import { useUnits } from './units.tsx';
import { proposalFile } from './proposalFile.ts';
import { fileNameFor, sendFile } from './sheet.ts';

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
 * Somewhere to sign, with a finger.
 *
 * A canvas rather than a font: a typed name in a script face is not a
 * signature, it is a typed name, and everybody who has ever been shown one
 * knows it. The strokes are kept as points and drawn on every resize so the
 * mark survives the keyboard opening underneath it.
 */
function SignaturePad({
  onChange,
  disabled,
}: {
  readonly onChange: (dataUrl: string) => void;
  readonly disabled: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const strokes = useRef<{ x: number; y: number }[][]>([]);
  const drawing = useRef(false);
  const [marked, setMarked] = useState(false);

  const redraw = () => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    context.clearRect(0, 0, element.width, element.height);
    context.lineWidth = 2.5;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = 'rgb(var(--c-ink))';
    for (const stroke of strokes.current) {
      if (stroke.length < 2) continue;
      context.beginPath();
      context.moveTo(stroke[0]!.x, stroke[0]!.y);
      for (const point of stroke.slice(1)) context.lineTo(point.x, point.y);
      context.stroke();
    }
  };

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const fit = () => {
      const box = element.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      element.width = Math.round(box.width * ratio);
      element.height = Math.round(box.height * ratio);
      const context = element.getContext('2d');
      context?.setTransform(ratio, 0, 0, ratio, 0, 0);
      redraw();
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const at = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const finish = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const element = canvas.current;
    if (!element) return;
    setMarked(true);
    onChange(element.toDataURL('image/png'));
  };

  return (
    <div>
      <canvas
        ref={canvas}
        className={`h-40 w-full touch-none rounded-md border-2 border-dashed bg-white
                    ${disabled ? 'border-slate-200 opacity-50' : 'border-slate-400'}`}
        aria-label="Sign here with your finger"
        role="img"
        onPointerDown={(event) => {
          if (disabled) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drawing.current = true;
          strokes.current.push([at(event)]);
          redraw();
        }}
        onPointerMove={(event) => {
          if (!drawing.current || disabled) return;
          strokes.current[strokes.current.length - 1]?.push(at(event));
          redraw();
        }}
        onPointerUp={finish}
        onPointerLeave={finish}
        onPointerCancel={finish}
      />
      <div className="mt-1 flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          {marked ? 'Signed above.' : 'Sign above with a finger.'}
        </p>
        <button
          type="button"
          onClick={() => {
            strokes.current = [];
            setMarked(false);
            onChange('');
            redraw();
          }}
          className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium
                     text-slate-700 active:bg-slate-100"
        >
          Start again
        </button>
      </div>
    </div>
  );
}

export function Agree({
  room,
  overrides,
  proposal,
  baseline,
  onProposal,
  onBaseline,
}: {
  readonly room: Room;
  readonly overrides: readonly Override[];
  readonly proposal: Proposal | null;
  readonly baseline: Baseline | null;
  readonly onProposal: (proposal: Proposal | null) => void;
  readonly onBaseline: (baseline: Baseline) => void;
}) {
  const { company } = useUnits();
  // The same quote the Price section shows, from the same hook. A proposal that
  // worked its own total out could disagree with the sheet it came from, and
  // the disagreement would be found by the client.
  const { quote: current } = useQuote(room, overrides, company);
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
        at: new Date().toLocaleDateString(),
      });
      const said = await sendFile(
        new Blob([html], { type: 'text/html;charset=utf-8' }),
        fileNameFor(proposal.roomName, 'html', 'proposal'),
        `${proposal.roomName} — proposal`
      );
      if (said) setSent(said);
    } catch (error) {
      setSent(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  }
  /**
   * The work in this room, as quantities. Built here rather than taken from the
   * quote so a scope paragraph can be drafted before a single rate is typed.
   */
  const scope = useMemo(
    () => buildTakeoff(room, new Date().toLocaleString(), { company: company.name }),
    [room, company.name]
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

  const missing = proposal ? missingFromProposal(proposal) : [];
  const taken = proposal ? chosenOption(proposal) : undefined;

  // Everything that has moved since it was signed, re-read whenever the room
  // or the rates do. Asynchronous because verifying the seal is.
  useEffect(() => {
    let live = true;
    if (!baseline || !proposal) {
      setOrder(null);
      return;
    }
    void changesSinceVerified(baseline, proposal, current).then((next) => {
      if (live) setOrder(next);
    });
    return () => {
      live = false;
    };
  }, [baseline, proposal, current]);

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
                    ...scope.lines.map(
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

        <h3 className="mt-4 text-sm font-semibold text-slate-900">What is not included</h3>
        <ul className="mt-1 list-disc pl-5 text-sm text-slate-600">
          {proposal.terms.map((term) => (
            <li key={term}>{term}</li>
          ))}
        </ul>

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
        </div>
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

      {/* ---------------------------------------------- signed, and after */}

      {baseline && (
        <section
          data-sheet="no"
          className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 shadow-sm"
        >
          <h2 className="font-semibold text-emerald-900">
            Agreed — {baseline.agreed.name}, {money(baseline.agreed.total)}
          </h2>
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
