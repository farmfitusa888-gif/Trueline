import { type Nanometres, abs, add, formatFeetInches } from './length.ts';

/**
 * A measurement is a length plus the answer to "how do we know?".
 *
 * This is the part no competitor ships. Every scanning app hands back numbers
 * that all look equally true — the one the sensor guessed at across a dim
 * hallway reads exactly like the one somebody put a tape on. Then a cabinet run
 * gets ordered against the guess.
 *
 * So a length never travels alone here. It carries where it came from, and the
 * screen and every export say so.
 *
 * Four ways a number gets into the model:
 *
 *   scanned   — a sensor produced it, and it is only as good as its tolerance
 *   verified  — a person put a tape on it and typed what the tape said
 *   derived   — computed from others, and no more certain than its worst input
 *   adjusted  — a person moved it by hand, without a tape
 *
 * A verified measurement has no tolerance, and that is a statement about
 * responsibility rather than about physics: the number is what the person said
 * it is, and the record says who said it and when.
 *
 * **Adjusted is the awkward one, and it is honest about being awkward.** A wall
 * somebody dragged into place on a screen is not the sensor's number any more,
 * and nobody put a tape on it either. It sits between the two and is never
 * allowed to pass for either: it does not satisfy "put a tape on one wall
 * running each way", and it does not claim the sensor's band as its own
 * guarantee. It carries the band of whatever it replaced as a **floor** — the
 * least uncertainty it could possibly have — because moving a line with a
 * finger cannot make a number more certain than the instrument that produced
 * it, and inventing a wider band would be inventing a number.
 */

export type VerificationMethod = 'tape' | 'laser' | 'plans' | 'stated';

export interface Scanned {
  readonly kind: 'scanned';
  /** Half-width of the band the sensor is trusted within: value ± tolerance. */
  readonly tolerance: Nanometres;
  readonly capturedAt: string;
  /** What produced it — "roomplan", "arkit-depth", and so on. */
  readonly sensor: string;
}

export interface Verified {
  readonly kind: 'verified';
  readonly verifiedBy: string;
  readonly verifiedAt: string;
  readonly method: VerificationMethod;
  readonly note?: string;
  /** What the model held before a person corrected it. Never discarded. */
  readonly supersedes?: Measurement;
}

export interface Derived {
  readonly kind: 'derived';
  /** Worst-case band, carried up from whatever this was computed from. */
  readonly tolerance: Nanometres;
  /** Names of the inputs, so a number on screen can be traced back. */
  readonly from: readonly string[];
}

/**
 * Somebody moved it on the screen, without a tape.
 *
 * Dragging a wall is a real thing people need — a scan puts a wall in the wrong
 * place, or a room is drawn from an old sheet and one corner is plainly out —
 * and pretending it produces either a scan or a verified measurement would be
 * the one dishonest thing in this model.
 */
export interface Adjusted {
  readonly kind: 'adjusted';
  readonly adjustedBy: string;
  readonly adjustedAt: string;
  /** Why it was moved, in the person's own words, when they gave one. */
  readonly note?: string;
  /**
   * What it said before. Never discarded, and never optional.
   *
   * Required, unlike the one on `Verified`, because an adjustment has no
   * standing of its own: a verified measurement is somebody's word and can
   * exist without a predecessor, and an adjusted one is only ever a change to
   * something that was already there. It is also where the band comes from.
   */
  readonly supersedes: Measurement;
}

export type Provenance = Scanned | Verified | Derived | Adjusted;

export interface Measurement {
  readonly value: Nanometres;
  readonly provenance: Provenance;
}

export class MeasurementError extends Error {}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function requireInstant(value: string, field: string): string {
  if (!ISO.test(value)) {
    throw new MeasurementError(`${field} must be an ISO 8601 instant, not "${value}".`);
  }
  return value;
}

function requireSomebody(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new MeasurementError(
      `${field} cannot be blank. A verified measurement that nobody signed is a scanned ` +
        `measurement wearing a badge.`
    );
  }
  return trimmed;
}

/* ------------------------------------------------------------ construction */

export function scanned(
  value: Nanometres,
  tolerance: Nanometres,
  capturedAt: string,
  sensor: string
): Measurement {
  if (tolerance < 0n) {
    throw new MeasurementError(`Tolerance cannot be negative (got ${tolerance}nm).`);
  }
  return {
    value,
    provenance: {
      kind: 'scanned',
      tolerance,
      capturedAt: requireInstant(capturedAt, 'capturedAt'),
      sensor: requireSomebody(sensor, 'sensor'),
    },
  };
}

export function verified(
  value: Nanometres,
  verifiedBy: string,
  verifiedAt: string,
  method: VerificationMethod,
  note?: string
): Measurement {
  return {
    value,
    provenance: {
      kind: 'verified',
      verifiedBy: requireSomebody(verifiedBy, 'verifiedBy'),
      verifiedAt: requireInstant(verifiedAt, 'verifiedAt'),
      method,
      ...(note === undefined ? {} : { note }),
    },
  };
}

/**
 * A person corrects a measurement. The previous one is kept on the new record
 * rather than overwritten, so a plan can always answer "what did it say before,
 * and who changed it?" — the question that gets asked the day a client disputes
 * a number.
 */
export function verify(
  existing: Measurement,
  value: Nanometres,
  verifiedBy: string,
  verifiedAt: string,
  method: VerificationMethod,
  note?: string
): Measurement {
  const fresh = verified(value, verifiedBy, verifiedAt, method, note);
  return {
    value: fresh.value,
    provenance: { ...(fresh.provenance as Verified), supersedes: existing },
  };
}

/**
 * Combines measurements into one derived from them.
 *
 * Tolerances add rather than combining in quadrature. Root-sum-square is the
 * better estimate when errors are independent and you want a likely band; a
 * plain sum is the band the answer is *guaranteed* inside. Somebody ordering
 * material off this number is better served by the guarantee, so that is what
 * gets carried up. A verified input contributes nothing to the band, which is
 * the whole reason verifying one wall tightens everything downstream of it.
 */
export function derive(
  from: readonly { name: string; measurement: Measurement }[],
  value: Nanometres
): Measurement {
  if (from.length === 0) {
    throw new MeasurementError('A derived measurement needs at least one input.');
  }
  const tolerance = add(...from.map((f) => toleranceOf(f.measurement)));
  return {
    value,
    provenance: { kind: 'derived', tolerance, from: from.map((f) => f.name) },
  };
}

/* --------------------------------------------------------------- questions */

/** A person stood behind this number. */
export function isVerified(m: Measurement): boolean {
  return m.provenance.kind === 'verified';
}

/** Somebody moved this one on a screen rather than measuring it. */
export function isAdjusted(m: Measurement): boolean {
  return m.provenance.kind === 'adjusted';
}

/**
 * The half-width of the band this number lives in. Zero once a person signs it.
 *
 * An adjusted number inherits the band of what it replaced, as a floor rather
 * than a guarantee — see the note at the top of this file. It is the least
 * uncertainty a dragged wall could have, not a promise about the building.
 */
export function toleranceOf(m: Measurement): Nanometres {
  if (m.provenance.kind === 'verified') return 0n;
  if (m.provenance.kind === 'adjusted') return toleranceOf(m.provenance.supersedes);
  return m.provenance.tolerance;
}

/** The interval the true value is guaranteed to lie in. */
export function band(m: Measurement): { low: Nanometres; high: Nanometres } {
  const t = toleranceOf(m);
  return { low: m.value - t, high: m.value + t };
}

/**
 * Whether two measurements could be describing the same real distance. Used to
 * decide whether a scan disagrees with a tape badly enough to be worth flagging,
 * rather than treating every nanometre of difference as a conflict.
 */
export function overlaps(a: Measurement, b: Measurement): boolean {
  const x = band(a);
  const y = band(b);
  return x.low <= y.high && y.low <= x.high;
}

/**
 * Which of two readings of the same thing to keep. A person's beats a sensor's,
 * always and without a threshold — that is the rule the whole product rests on.
 * Between two of the same kind, the later one wins; between two sensor readings
 * taken at the same moment, the tighter one does.
 */
export function preferVerified(a: Measurement, b: Measurement): Measurement {
  if (isVerified(a) && !isVerified(b)) return a;
  if (isVerified(b) && !isVerified(a)) return b;
  const at = instantOf(a);
  const bt = instantOf(b);
  if (at !== bt) return at > bt ? a : b;
  return toleranceOf(a) <= toleranceOf(b) ? a : b;
}

function instantOf(m: Measurement): string {
  switch (m.provenance.kind) {
    case 'scanned':
      return m.provenance.capturedAt;
    case 'verified':
      return m.provenance.verifiedAt;
    case 'derived':
      return '';
    case 'adjusted':
      return m.provenance.adjustedAt;
  }
}

/** Walks the correction history, newest first. */
export function history(m: Measurement): Measurement[] {
  const chain: Measurement[] = [m];
  let current = m;
  for (;;) {
    const previous =
      current.provenance.kind === 'verified'
        ? current.provenance.supersedes
        : current.provenance.kind === 'adjusted'
          ? current.provenance.supersedes
          : undefined;
    if (!previous) return chain;
    current = previous;
    chain.push(current);
  }
}

/* ---------------------------------------------------------------- for eyes */

/**
 * How the number reads on screen and on an export. A verified length is shown
 * plainly; anything else is shown with the band it lives in, so nobody mistakes
 * a sensor's opinion for a fact.
 */
export function formatWithConfidence(
  m: Measurement,
  format: (nm: Nanometres) => string = (nm) => formatFeetInches(nm)
): string {
  if (isVerified(m)) return format(m.value);
  const t = toleranceOf(m);
  // Said in words rather than as a band, because the band is a floor and
  // printing "20' 3" ± 2"" would be claiming the scanner's guarantee for a
  // number the scanner did not produce.
  if (isAdjusted(m)) return `${format(m.value)} (moved by hand)`;
  if (t === 0n) return `${format(m.value)} (unverified)`;
  return `${format(m.value)} ± ${format(abs(t))}`;
}

/** A short word for a badge next to the number. */
export function confidenceLabel(m: Measurement): 'verified' | 'scanned' | 'derived' | 'adjusted' {
  return m.provenance.kind;
}

/**
 * A person moves a measurement on the screen. What it said before is kept.
 *
 * Deliberately not `verify` with a different method. A `stated` verification is
 * still somebody putting their name to a number as fact — "the plans say eight
 * foot" — and this is not that. This is "I dragged it here because the scan was
 * plainly wrong", which is worth recording and is not worth trusting like a
 * tape.
 */
export function adjust(
  existing: Measurement,
  value: Nanometres,
  adjustedBy: string,
  adjustedAt: string,
  note?: string
): Measurement {
  return {
    value,
    provenance: {
      kind: 'adjusted',
      adjustedBy: requireSomebody(adjustedBy, 'adjustedBy'),
      adjustedAt: requireInstant(adjustedAt, 'adjustedAt'),
      ...(note === undefined ? {} : { note }),
      supersedes: existing,
    },
  };
}
