import { useMemo, useState } from 'react';
import type { Room } from '../../core/src/room.ts';
import type { Damage } from '../../core/src/damage.ts';
import {
  type Cause,
  type Claim as ClaimRecord,
  claimReport,
  describeParty,
  missingFromClaim,
  overlappingDamage,
} from '../../core/src/claim.ts';
import type { ClaimMoney as ClaimReportMoney } from '../../core/src/claim.ts';
import { pricing } from '../../core/src/company.ts';
import { useUnits } from './units.tsx';
import { ReportPhotos } from './ReportPhotos.tsx';
import { canMarkAgain, markAgain } from './bridge.ts';
import { DraftButton, DraftedNote } from './Draft.tsx';

/**
 * Insurance mode: the switch, the claim's own facts, and the document.
 *
 * A switch per job rather than per business. A remodeler who does one
 * restoration a year should not carry a claim number field on every kitchen, and
 * a restoration contractor should not have to think about it.
 *
 * What is missing from a claim is **named and never enforced**. Somebody
 * standing in a flooded basement has to be able to mark damage immediately and
 * fill the paperwork in from the truck; refusing to record anything until a
 * claim number is typed loses the observation, and the observation is the part
 * that cannot be recovered later.
 */

const CAUSES: readonly Cause[] = [
  'burst pipe',
  'appliance leak',
  'roof leak',
  'storm',
  'flood',
  'sewer backup',
  'fire',
  'smoke',
  'impact',
  'other',
];

function Field({
  label,
  value,
  onChange,
  type = 'text',
  hint,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly type?: string;
  readonly hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoCorrect="off"
        spellCheck={false}
        className="mt-1 min-h-12 w-full rounded-md border border-slate-300 px-3 py-2
                   focus:border-sky-500 focus:outline-none"
      />
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

/**
 * Back to the camera, for marks only.
 *
 * ## Why this button exists
 *
 * Damage turns up on the second visit. A water line behind a cabinet, a stain
 * that only shows once the lights are on, a ceiling nobody looked at. Until now
 * the only way to record it was to walk the whole room again — which makes a
 * **second room**, with a second set of walls, in a second folder, and every
 * tape reading typed against the first one left behind on it.
 *
 * So this asks for a marking pass instead: the same camera and the same Mark
 * button, and nothing RoomPlan builds is kept. The pins and the photographs are
 * merged into the folder this room is already in, and the room, its
 * measurements and everything typed against them are untouched — see
 * `ScanModel.markingInto`, which never opens `room.json`.
 *
 * Absent in a browser, where there is no camera to open and no folder to merge
 * into. A button that cannot work is worse than no button, which is the lesson
 * of the dead capture screen.
 */
function MarkMore() {
  const [asked, setAsked] = useState(false);
  if (!canMarkAgain()) return null;
  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <button
        type="button"
        onClick={() => setAsked(markAgain())}
        className="min-h-11 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white
                   active:bg-slate-700"
      >
        Mark more on the phone
      </button>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">
        {asked
          ? 'Opening the camera. Point at what is wrong and tap Mark — the walls and every ' +
            'measurement stay exactly as they are.'
          : 'Opens the camera again to add marks and photographs to this room. It does not ' +
            'rescan it: nothing measured changes, and nothing you have typed is lost.'}
      </p>
    </div>
  );
}

/**
 * The damage, priced, on the claim.
 *
 * ## Why this is here and not on the Price screen
 *
 * > "IT DOESNT AUTOMATICALLY PRICE OUT THE DAMAGE BUT INSTEAD IF YOU GO TO THE
 * >  PRICING IS SHOW YOU THE ENTIRE ROOM AND THE FLOOR AND CEILING WHICH ARE
 * >  NOT CHECK FOR BEING NEEDED"
 *
 * Sam marked mould on one wall, saw "15.0 sq ft" beside it, went looking for
 * what that was worth, and found the room's remodel takeoff — a floor and a
 * ceiling he had never said needed doing. He was not wrong about either screen.
 * The takeoff prices the room because that is what a takeoff is for, and the
 * damage was measured exactly. What did not exist anywhere was the number in
 * between: **the marks he made, at his rates, adding up.**
 *
 * It belongs on the claim and nowhere else. A remodel takeoff and a restoration
 * scope go to two different payers out of two different pots of money, and a
 * single screen holding both is a screen somebody bills the wrong party off.
 * Folding this into the Price screen would have been the easy fix and the wrong
 * one.
 *
 * Every figure is a rate this contractor typed multiplied by a quantity the
 * room measured. Nothing here is a market average and nothing is guessed, and
 * an item with no rate against it is named rather than counted as nothing — a
 * sheet that adds up perfectly and is short by a tear-out is the version nobody
 * queries.
 */
function Money({ money }: { readonly money: ClaimReportMoney | null }) {
  if (!money) return null;

  if (!money.priced) {
    return (
      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-semibold">None of this damage is priced yet.</p>
        <p className="mt-1">
          The work it takes is worked out below, to the square foot, and there is no rate against
          any of it: {money.unpriced.join(', ')}. Tap <strong>Your rates</strong> on the sheet
          underneath and every figure on this claim fills in.
        </p>
      </div>
    );
  }

  const stages = ['tear out', 'protect', 'rebuild'] as const;

  return (
    <div className="mt-4 rounded-lg border border-slate-200 p-3">
      <h4 className="font-semibold text-slate-900">What it takes to put right</h4>
      {stages.map((stage) => {
        const inStage = money.lines.filter((line) => line.stage === stage);
        if (inStage.length === 0) return null;
        return (
          <div key={stage} className="mt-2">
            <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {stage}
            </h5>
            <dl className="mt-1 divide-y divide-slate-100">
              {inStage.map((line, n) => (
                <div
                  key={`${line.damageId}-${line.item}-${n}`}
                  className="flex items-baseline justify-between gap-3 py-2"
                >
                  <dt className="text-sm text-slate-800">
                    {line.item}
                    <span className="block font-mono text-xs tabular-nums text-slate-500">
                      {line.quantity} at {line.rate}
                    </span>
                  </dt>
                  <dd className="shrink-0 font-mono text-sm font-semibold tabular-nums text-slate-900">
                    {line.amount}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}

      <dl className="mt-3 divide-y divide-slate-200 border-t-2 border-slate-300">
        {money.totals.map((line) => (
          <div key={line.label} className="flex items-baseline justify-between gap-3 py-2">
            <dt className="font-semibold text-slate-900">{line.label}</dt>
            <dd className="shrink-0 font-mono text-lg font-semibold tabular-nums text-slate-900">
              {line.value}
            </dd>
          </div>
        ))}
      </dl>

      {money.unpriced.length > 0 && (
        <p className="mt-2 text-sm text-amber-800">
          No rate yet for {money.unpriced.join(', ')}. Those are{' '}
          <strong>not in the total</strong> — a sheet that adds up perfectly and is short by a
          tear-out is the worst thing this could hand you.
        </p>
      )}

      <p className="mt-2 text-xs leading-relaxed text-slate-600">{money.note}</p>
    </div>
  );
}

export function Claim({
  room,
  damages,
  claim,
  onChange,
}: {
  readonly room: Room;
  readonly damages: readonly Damage[];
  readonly claim: ClaimRecord;
  readonly onChange: (next: ClaimRecord) => void;
}) {
  const { area, len, company } = useUnits();
  const [showing, setShowing] = useState<'details' | 'report'>('details');
  /** Whether the loss description was drafted by the phone and not yet read. */
  const [drafted, setDrafted] = useState(false);

  // The contractor's own book, so the marks on this claim carry money. The
  // same book the restoration sheet below prices off and the same one the
  // claim document prints from — one book, three places, no chance of three
  // different figures for one loss.
  const book = useMemo(() => pricing(company).book, [company]);

  const report = useMemo(
    () =>
      claim.on
        ? claimReport(
            room,
            damages,
            claim,
            new Date().toLocaleDateString(),
            { len, area: (a) => area(a) },
            book
          )
        : null,
    [room, damages, claim, len, area, book]
  );
  const overlaps = useMemo(() => overlappingDamage(damages), [damages]);
  const missing = missingFromClaim(claim);

  // Overlaps come back as ids, which mean nothing to the person reading the
  // page. Say what the two marks are instead, and keep the id as the fallback
  // so a stale pairing can still be found.
  const name = (id: string) =>
    report?.damages.find((d) => d.id === id)?.headline ?? id;

  const set = <K extends keyof ClaimRecord>(key: K, value: ClaimRecord[K]) =>
    onChange({ ...claim, [key]: value });

  if (!claim.on) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-sheet="no">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-semibold text-slate-900">Is this an insurance job?</h2>
          <button
            type="button"
            onClick={() => onChange({ ...claim, on: true })}
            className="min-h-11 rounded-md bg-slate-900 px-4 font-semibold text-white active:bg-slate-700"
          >
            Turn it on
          </button>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Mark where the damage is while you are standing in front of it, and the room tells you
          how many square feet of board and how many feet of base that actually is — because it
          already knows how long the wall is. Log the moisture readings. Send the adjuster one
          document with the measurements, the areas and the photographs on it.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-sheet="no">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-slate-900">The claim</h2>
        <span className="flex shrink-0 items-baseline gap-3">
          <button
            type="button"
            onClick={() => setShowing(showing === 'report' ? 'details' : 'report')}
            className="min-h-11 text-sm text-slate-500 underline underline-offset-4"
          >
            {showing === 'report' ? 'The details' : 'The report'}
          </button>
          <button
            type="button"
            onClick={() => onChange({ ...claim, on: false })}
            className="min-h-11 text-sm text-slate-500 underline underline-offset-4"
          >
            Not a claim
          </button>
        </span>
      </div>

      <MarkMore />

      {showing === 'details' ? (
        <>
          <div className="mt-3 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Claim number"
                value={claim.claimNumber ?? ''}
                onChange={(v) => set('claimNumber', v)}
              />
              <Field
                label="Date of loss"
                type="date"
                value={claim.dateOfLoss ?? ''}
                onChange={(v) => set('dateOfLoss', v)}
                hint="The day it happened, not the day it was found."
              />
            </div>
            <Field
              label="Found on"
              type="date"
              value={claim.foundOn ?? ''}
              onChange={(v) => set('foundOn', v)}
            />

            <div>
              <span className="text-sm font-medium text-slate-700">What caused it</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {CAUSES.map((cause) => (
                  <button
                    key={cause}
                    type="button"
                    onClick={() => set('cause', cause)}
                    className={`min-h-11 rounded-md px-3 text-sm font-medium ${
                      claim.cause === cause
                        ? 'bg-slate-900 text-white'
                        : 'border border-slate-300 text-slate-700 active:bg-slate-100'
                    }`}
                  >
                    {cause}
                  </button>
                ))}
              </div>
            </div>

            <Field label="Property address" value={claim.address ?? ''} onChange={(v) => set('address', v)} />

            {/* The loss description. It has been on the claim document since
                the document was written -- `claim.ts` prints it under "Notes"
                -- and there has never been a box to type it in. Another
                finished, unreachable field. */}
            <label className="block">
              <span className="text-sm font-medium text-slate-700">What happened</span>
              <textarea
                value={claim.note ?? ''}
                onChange={(event) => { set('note', event.target.value); setDrafted(false); }}
                rows={4}
                aria-label="What happened"
                placeholder="The supply line under the sink let go overnight."
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2
                           leading-relaxed focus:border-sky-500 focus:outline-none"
              />
            </label>
            <p className="text-xs leading-relaxed text-slate-500">
              The first thing an adjuster reads. It goes at the top of the claim document, in
              your words.
            </p>
            <DraftedNote showing={drafted && (claim.note ?? '') !== ''} />
            {/* What goes across is what is already on this claim: the cause,
                the dates, and every mark with its kind, its category and its
                measured area. The model writes two paragraphs out of them and
                is told never to touch a figure. */}
            <DraftButton
              job="loss"
              label="Draft what happened"
              notes={() =>
                [
                  claim.cause ? `Cause: ${claim.cause}.` : '',
                  claim.dateOfLoss ? `Date of loss: ${claim.dateOfLoss}.` : '',
                  claim.foundOn ? `Found on: ${claim.foundOn}.` : '',
                  `Room: ${room.name}.`,
                  damages.length === 0
                    ? 'Nothing has been marked in this room yet.'
                    : 'Marked in this room:',
                  ...damages.map((damage) => {
                    const where = damage.shape.kind === 'pin' ? 'a marked spot' : 'an area';
                    const category = damage.category ? `, category ${damage.category}` : '';
                    return `- ${damage.kind}${category}, on ${where}: ${damage.note}`;
                  }),
                ]
                  .filter((line) => line !== '')
                  .join('\n')
              }
              onWritten={(text) => { set('note', text); setDrafted(true); }}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Owner"
                value={claim.owner?.name ?? ''}
                onChange={(v) => set('owner', { ...claim.owner, name: v })}
              />
              <Field
                label="Owner's phone"
                type="tel"
                value={claim.owner?.phone ?? ''}
                onChange={(v) => set('owner', { name: claim.owner?.name ?? '', phone: v })}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Carrier"
                value={claim.carrier?.name ?? ''}
                onChange={(v) => set('carrier', { ...claim.carrier, name: v })}
              />
              <Field
                label="Adjuster"
                value={claim.adjuster?.name ?? ''}
                onChange={(v) => set('adjuster', { ...claim.adjuster, name: v })}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Adjuster's phone"
                type="tel"
                value={claim.adjuster?.phone ?? ''}
                onChange={(v) =>
                  set('adjuster', { name: claim.adjuster?.name ?? '', phone: v, email: claim.adjuster?.email })
                }
              />
              <Field
                label="Adjuster's email"
                type="email"
                value={claim.adjuster?.email ?? ''}
                onChange={(v) =>
                  set('adjuster', { name: claim.adjuster?.name ?? '', phone: claim.adjuster?.phone, email: v })
                }
              />
            </div>
          </div>

          {/* Who this claim is between, in one line each, the way the claim
              document prints them. `describeParty` is what the document uses,
              so a name and a phone number are formatted once and read the same
              on the screen and on the paperwork. */}
          {(describeParty(claim.owner) || describeParty(claim.adjuster)) && (
            <dl className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm">
              {describeParty(claim.owner) && (
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-slate-500">Owner</dt>
                  <dd className="text-slate-900">{describeParty(claim.owner)}</dd>
                </div>
              )}
              {describeParty(claim.adjuster) && (
                <div className="mt-0.5 flex flex-wrap gap-x-2">
                  <dt className="text-slate-500">Adjuster</dt>
                  <dd className="text-slate-900">{describeParty(claim.adjuster)}</dd>
                </div>
              )}
            </dl>
          )}

          {missing.length > 0 && (
            <p className="mt-3 text-sm text-amber-800">
              Still to fill in: {missing.join(', ')}. Nothing is stopped by it — mark the damage
              now and do this from the truck.
            </p>
          )}
        </>
      ) : (
        report && (
          <div className="mt-3">
            <h3 className="font-semibold text-slate-900">{report.heading}</h3>

            {report.about.length > 0 && (
              <dl className="mt-2 divide-y divide-slate-100 border-y border-slate-100">
                {report.about.map((line) => (
                  <div key={line.label} className="flex items-baseline justify-between gap-4 py-2">
                    <dt className="text-sm text-slate-600">{line.label}</dt>
                    <dd className="text-sm font-medium text-slate-900">{line.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            {report.damages.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600">
                Nothing marked yet. Tap a wall on the plan and mark what is wrong with it.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {report.damages.map((damage) => (
                  <li key={damage.id} className="rounded-lg bg-slate-50 p-3">
                    <p className="font-medium text-slate-900">{damage.headline}</p>
                    {damage.summary && (
                      <p className="mt-1 text-sm font-semibold font-mono tabular-nums text-slate-900">
                        {damage.summary}
                      </p>
                    )}
                    {/* What this one mark comes to. Beside the mark, because
                        "what is the loss worth" and "what is THIS wall worth"
                        are two different questions and only the second one can
                        be argued about with an adjuster. */}
                    {damage.cost && (
                      <p className="mt-1 text-sm text-slate-700">
                        Putting this right:{' '}
                        <strong className="font-mono tabular-nums text-slate-900">
                          {damage.cost}
                        </strong>
                      </p>
                    )}
                    <p className="mt-1 text-sm text-slate-600">{damage.note}</p>
                    <p className="mt-1 text-xs text-slate-500">{damage.workings}</p>
                    {damage.dryingNote && (
                      <p className="mt-1 text-xs text-slate-600">{damage.dryingNote}</p>
                    )}
                    {damage.readings.length > 0 && (
                      <dl className="mt-2 space-y-0.5">
                        {damage.readings.map((reading) => (
                          <div
                            key={`${reading.label}-${reading.value}`}
                            className="flex items-baseline justify-between gap-3 text-xs text-slate-600"
                          >
                            <dt>{reading.label}</dt>
                            <dd className="font-mono tabular-nums">{reading.value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    <ReportPhotos photos={damage.photos} />
                  </li>
                ))}
              </ul>
            )}

            <Money money={report.money} />

            <dl className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
              {report.totals.map((line) => (
                <div key={line.label} className="py-2">
                  <dt className="text-sm text-slate-600">{line.label}</dt>
                  <dd className="text-sm font-medium text-slate-900">{line.value}</dd>
                </div>
              ))}
            </dl>

            {overlaps.length > 0 && (
              <p className="mt-2 text-sm text-amber-800">
                {overlaps.map((pair) => `${name(pair.a)} and ${name(pair.b)}`).join('; ')} cover the same
                stretch of wall. They are both kept, because two marks are two observations — but
                the totals above count both, so check before you send it.
              </p>
            )}

            {report.missing.length > 0 && (
              <p className="mt-2 text-sm text-amber-800">
                This document is missing {report.missing.join(', ')}.
              </p>
            )}

            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {report.caveat}
            </p>
          </div>
        )
      )}
    </section>
  );
}
