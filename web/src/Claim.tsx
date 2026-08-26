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
import { useUnits } from './units.tsx';
import { ReportPhotos } from './ReportPhotos.tsx';

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
  const { area, len } = useUnits();
  const [showing, setShowing] = useState<'details' | 'report'>('details');

  const report = useMemo(
    () =>
      claim.on
        ? claimReport(room, damages, claim, new Date().toLocaleDateString(), {
            len,
            area: (a) => area(a),
          })
        : null,
    [room, damages, claim, len, area]
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
