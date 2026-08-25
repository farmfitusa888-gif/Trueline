import { formatFeetInches } from './length.ts';
import { type Room, RoomError, formatSquareFeet } from './room.ts';
import { readiness, trustLabel } from './issue.ts';
import { roomQuantities } from './zone.ts';
import {
  type Damage,
  WATER_CATEGORY,
  damageTotals,
  drying,
} from './damage.ts';

/**
 * The claim itself: whose loss it is, what happened, and who is paying.
 *
 * Separate from the room and separate from the damage on purpose. A room is a
 * measurement of a building, a damage is an observation about part of it, and a
 * claim is an administrative fact about who is arguing over it. Correcting a
 * wall must not touch the claim number, and closing a claim must not touch the
 * measurements — the whole value of the file a year later is that those three
 * things did not contaminate each other.
 *
 * **Insurance mode is a switch per job, not per business.** A remodeler who does
 * one restoration a year should not carry a claim number field on every kitchen,
 * and a restoration contractor should not have to think about it.
 */

export class ClaimError extends RoomError {}

/** What caused it, in the words a policy uses. */
export type Cause =
  | 'burst pipe'
  | 'appliance leak'
  | 'roof leak'
  | 'storm'
  | 'flood'
  | 'sewer backup'
  | 'fire'
  | 'smoke'
  | 'impact'
  | 'other';

export interface Party {
  readonly name: string;
  readonly phone?: string;
  readonly email?: string;
}

export interface Claim {
  /** Turned on for this job. Off and none of the rest of it exists. */
  readonly on: boolean;
  readonly claimNumber?: string;
  /** The day it happened, not the day it was found. Adjusters ask for both. */
  readonly dateOfLoss?: string;
  readonly foundOn?: string;
  readonly cause?: Cause;
  readonly carrier?: Party;
  readonly adjuster?: Party;
  readonly owner?: Party;
  readonly address?: string;
  /** Anything else worth saying about the loss, in the contractor's words. */
  readonly note?: string;
}

export const NO_CLAIM: Claim = { on: false };

/**
 * What is missing before this is worth sending to an adjuster.
 *
 * Named rather than enforced. A contractor standing in a flooded basement should
 * be able to mark damage immediately and fill the paperwork in from the truck;
 * refusing to record anything until a claim number is typed would lose the
 * observation, which is the part that cannot be recovered later.
 */
export function missingFromClaim(claim: Claim): string[] {
  if (!claim.on) return [];
  const missing: string[] = [];
  if (!claim.claimNumber?.trim()) missing.push('the claim number');
  if (!claim.dateOfLoss?.trim()) missing.push('the date of loss');
  if (!claim.cause) missing.push('what caused it');
  if (!claim.owner?.name.trim()) missing.push('whose property it is');
  if (!claim.address?.trim()) missing.push('the address');
  if (!claim.adjuster?.name.trim()) missing.push('the adjuster');
  return missing;
}

/** A party as one line, with nothing empty printed. */
export function describeParty(party: Party | undefined): string {
  if (!party?.name.trim()) return '';
  const contact = [party.phone?.trim(), party.email?.trim()].filter((x) => x);
  return contact.length === 0 ? party.name.trim() : `${party.name.trim()} — ${contact.join(' · ')}`;
}

/* ----------------------------------------------------------- the document */

export interface ClaimLine {
  readonly label: string;
  readonly value: string;
}

export interface ClaimReport {
  readonly heading: string;
  /** The claim's own facts, in the order an adjuster reads them. */
  readonly about: readonly ClaimLine[];
  /** The room, measured, with how much of it is affected. */
  readonly room: readonly ClaimLine[];
  /** Every damage, each with its own quantity and its own workings. */
  readonly damages: readonly {
    readonly id: string;
    readonly headline: string;
    readonly workings: string;
    readonly note: string;
    readonly photos: readonly string[];
    readonly readings: readonly ClaimLine[];
    readonly dryingNote: string;
    /** What it takes, in one line: "18.0 sq ft of wall face, 9' of baseboard". */
    readonly summary: string;
  }[];
  /** The totals, and every caveat that has to travel with them. */
  readonly totals: readonly ClaimLine[];
  /** What is missing, said on the document rather than left to be discovered. */
  readonly missing: readonly string[];
  /**
   * The sentence that decides whether the numbers can be relied on.
   *
   * A claim priced off an unchecked scan is a claim resting on a guess, and the
   * one document that leaves the building is the last chance to say so.
   */
  readonly caveat: string;
}

/**
 * Everything an adjuster needs, in the order they read it.
 *
 * Deliberately a data structure rather than a string: the same report has to
 * come out as a screen, as a printed page and as a file, and three renderers
 * reading one structure cannot disagree about what the claim says. Three
 * renderers each building their own sentences would.
 */
export function claimReport(
  room: Room,
  damages: readonly Damage[],
  claim: Claim,
  at: string
): ClaimReport {
  const state = readiness(room);
  const totals = damageTotals(room, damages);
  const q = roomQuantities(room);

  const about: ClaimLine[] = [];
  const add = (label: string, value: string | undefined) => {
    if (value && value.trim() !== '') about.push({ label, value: value.trim() });
  };
  add('Claim number', claim.claimNumber);
  add('Date of loss', claim.dateOfLoss);
  add('Found on', claim.foundOn);
  add('Cause of loss', claim.cause);
  add('Property', claim.address);
  add('Owner', describeParty(claim.owner));
  add('Carrier', describeParty(claim.carrier));
  add('Adjuster', describeParty(claim.adjuster));
  add('Notes', claim.note);

  const SQ_FT = 304_800_000n * 304_800_000n;
  const affectedFace = totals.faceArea;
  const share = q.wallFaceArea === 0n ? 0n : (affectedFace * 1000n) / q.wallFaceArea;

  return {
    heading: `${room.name}${claim.claimNumber ? ` — claim ${claim.claimNumber}` : ''}`,
    about,
    room: [
      { label: 'Floor area', value: formatSquareFeet(q.floorArea) },
      { label: 'Ceiling height', value: formatFeetInches(room.ceilingHeight.value) },
      { label: 'Wall face', value: `${Number((q.wallFaceArea * 10n) / SQ_FT) / 10} sq ft` },
      { label: 'Baseboard', value: formatFeetInches(q.baseboardRun) },
    ],
    damages: damages.map((damage) => {
      const quantity = totals.each.find((x) => x.damageId === damage.id)!;
      const curve = drying(damage);
      const category =
        damage.kind === 'water' && damage.category
          ? ` — ${WATER_CATEGORY[damage.category].long}`
          : '';
      const pieces: string[] = [];
      if (quantity.faceArea > 0n) {
        pieces.push(`${Number((quantity.faceArea * 10n) / SQ_FT) / 10} sq ft of wall face`);
      }
      if (quantity.flatArea > 0n) pieces.push(formatSquareFeet(quantity.flatArea));
      if (quantity.baseboardRun > 0n) {
        pieces.push(`${formatFeetInches(quantity.baseboardRun)} of baseboard`);
      }
      return {
        id: damage.id,
        headline: `${quantity.what}${category}`,
        workings: quantity.workings,
        note: damage.note,
        photos: damage.photos,
        readings: curve.readings.map((r) => ({
          label: r.at.slice(0, 10),
          value: `${r.value} ${r.scale}${r.note ? ` — ${r.note}` : ''}`,
        })),
        dryingNote:
          curve.readings.length === 0
            ? ''
            : !curve.comparable
              ? 'These readings were taken on different scales, so they are listed rather than ' +
                'compared. A curve drawn across a scale change would not be a curve.'
              : curve.trend === 'drying'
                ? `Drying: ${curve.first!.value} down to ${curve.latest!.value} ${curve.first!.scale}.`
                : curve.trend === 'wetter'
                  ? `Getting wetter: ${curve.first!.value} up to ${curve.latest!.value} ${curve.first!.scale}.`
                  : curve.trend === 'flat'
                    ? `Not moving: still ${curve.latest!.value} ${curve.latest!.scale}.`
                    : 'One reading so far.',
        summary: pieces.join(', '),
      };
    }),
    totals: [
      {
        label: 'Wall face affected',
        value: `${Number((affectedFace * 10n) / SQ_FT) / 10} sq ft of ${
          Number((q.wallFaceArea * 10n) / SQ_FT) / 10
        } sq ft — ${Number(share) / 10}%`,
      },
      ...(totals.flatArea > 0n
        ? [{ label: 'Floor or ceiling affected', value: formatSquareFeet(totals.flatArea) }]
        : []),
      ...(totals.baseboardRun > 0n
        ? [{ label: 'Baseboard affected', value: formatFeetInches(totals.baseboardRun) }]
        : []),
      ...(totals.pins > 0
        ? [
            {
              label: 'Marked points',
              value:
                `${totals.pins} — photographed and noted, with no area. A pin is a marker ` +
                `rather than a measurement.`,
            },
          ]
        : []),
      ...(totals.anyCut
        ? [
            {
              label: 'Cut heights',
              value:
                'Some areas are quantified to a decided cut height rather than to the damage ' +
                'seen. Each says which, above.',
            },
          ]
        : []),
      { label: 'Prepared', value: at },
    ],
    missing: missingFromClaim(claim),
    caveat:
      state.blocking.length > 0
        ? 'THESE ARE A SCANNER’S MEASUREMENTS. No wall in this room has had a tape on it, so ' +
          'every area above will move when one does. ' +
          `${trustLabel(state.trust)}.`
        : `Every wall behind these measurements has had a tape on it. ${trustLabel(state.trust)}.`,
  };
}

/**
 * Overlapping damaged areas, named so nobody adds them up twice by accident.
 *
 * They are deliberately not merged — two marks over the same stretch are two
 * observations, and merging them throws one away — but a total that quietly
 * double-counts is exactly the sort of thing that loses an argument with an
 * adjuster. So it is said, on the document, with the pair named.
 */
export function overlappingDamage(damages: readonly Damage[]): { a: string; b: string }[] {
  const patches = damages.filter(
    (d): d is Damage & { shape: Extract<Damage['shape'], { kind: 'patch' }> } =>
      d.shape.kind === 'patch'
  );
  const out: { a: string; b: string }[] = [];
  for (let i = 0; i < patches.length; i += 1) {
    for (let j = i + 1; j < patches.length; j += 1) {
      const p = patches[i]!.shape;
      const q = patches[j]!.shape;
      if (p.wallId !== q.wallId) continue;
      const pLo = p.fromAlong < p.toAlong ? p.fromAlong : p.toAlong;
      const pHi = p.fromAlong < p.toAlong ? p.toAlong : p.fromAlong;
      const qLo = q.fromAlong < q.toAlong ? q.fromAlong : q.toAlong;
      const qHi = q.fromAlong < q.toAlong ? q.toAlong : q.fromAlong;
      if (pLo >= qHi || qLo >= pHi) continue;
      const pBot = p.fromHeight < p.toHeight ? p.fromHeight : p.toHeight;
      const pTop = p.fromHeight < p.toHeight ? p.toHeight : p.fromHeight;
      const qBot = q.fromHeight < q.toHeight ? q.fromHeight : q.toHeight;
      const qTop = q.fromHeight < q.toHeight ? q.toHeight : q.fromHeight;
      if (pBot >= qTop || qBot >= pTop) continue;
      out.push({ a: patches[i]!.id, b: patches[j]!.id });
    }
  }
  return out;
}
