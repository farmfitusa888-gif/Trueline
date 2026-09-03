import { type Nanometres, formatFeetInches } from './length.ts';
import { isVerified, toleranceOf } from './measurement.ts';
import {
  type Room,
  RoomError,
  axisOf,
  closes,
  isDiagonal,
  validate,
  verificationPunchList,
} from './room.ts';

/**
 * Whether a room may be issued as a drawing.
 *
 * This file exists because of one measurement taken off Sam's own scans, and it
 * is the most dangerous thing found so far:
 *
 *   **A RoomPlan scan always closes perfectly.**
 *
 * Two real exports, a kitchen and a garage, and in both of them every wall end
 * meets its neighbour to within a thousandth of a millimetre. RoomPlan does not
 * hand back raw measurements — it hands back a polygon it has already rectified
 * and snapped. Apple's documented ±5 cm per wall is still in there. It is simply
 * systematic, and a closure check cannot see it.
 *
 * So the reassurance a closed room normally gives is, on an imported scan,
 * worth nothing. `closure()` returns zero, `solve()` reports no adjustment and
 * no wall beyond tolerance, and a person reads that as *the measurements agree*.
 * They have not agreed. They have never been compared.
 *
 * Which makes the guard simple to state and important to keep: **a room whose
 * walls were all scanned has not been checked against anything, and may not go
 * out as a dimensioned drawing.** It needs a tape on it first — and specifically
 * one tape per axis, because the model closes on two independent equations and a
 * measurement along one of them constrains nothing along the other. Verify the
 * north wall of a rectangle and every east-west dimension is still a guess.
 *
 * One tape per axis is the floor, not the target. It is the least that makes the
 * drawing checkable at all.
 */

export type Trust =
  /** Nothing has been checked against anything. Not issuable. */
  | 'scanned'
  /** Enough tape to scale both axes, but not every dimension is stood behind. */
  | 'partly-verified'
  /** Every wall carries a human measurement. */
  | 'verified';

export type Axis = 'x' | 'y';

const AXIS_NAME: Record<Axis, string> = {
  x: 'east-west',
  y: 'north-south',
};

export interface AxisReadiness {
  readonly axis: Axis;
  /** Wall ids on this axis that a person has measured. */
  readonly verified: readonly string[];
  /** Wall ids on this axis still carrying a sensor's number. */
  readonly unverified: readonly string[];
}

export interface Readiness {
  readonly trust: Trust;
  /** True when every wall came from a sensor and the room nonetheless closes exactly. */
  readonly closedWithoutBeingChecked: boolean;
  readonly axes: readonly AxisReadiness[];
  /**
   * Why the room cannot be issued, in the words to put on screen. Empty when it
   * can be.
   */
  readonly blocking: readonly string[];
  /**
   * Real problems that do not stop a drawing going out, but must appear on it.
   * Opening sizes live here: RoomPlan measured a door 5'7" tall in Sam's garage
   * and 6'10" in his kitchen, against a real door of 6'8". A drawing may carry
   * those, but never silently.
   */
  readonly warnings: readonly string[];
  /** The walls worth a tape first, worst first. Empty once everything is verified. */
  readonly nextTape: readonly { wallId: string; areaAtStake: bigint }[];
}

export class NotIssuable extends RoomError {
  readonly reasons: readonly string[];
  readonly nextTape: readonly { wallId: string; areaAtStake: bigint }[];

  constructor(roomName: string, reasons: readonly string[], nextTape: Readiness['nextTape']) {
    const first = nextTape[0];
    super(
      `"${roomName}" is not ready to issue as a dimensioned drawing.\n` +
        reasons.map((r) => `  - ${r}`).join('\n') +
        (first ? `\n\nStart with a tape on "${first.wallId}": it is the wall putting the most area in doubt.` : '')
    );
    this.reasons = reasons;
    this.nextTape = nextTape;
  }
}

/* ----------------------------------------------------------------- reading */

/** Which walls on each axis a person has stood behind, and which they have not. */
export function axisReadiness(room: Room): AxisReadiness[] {
  validate(room);
  return (['x', 'y'] as const).map((axis) => {
    const onAxis = room.walls.filter((w) => axisOf(w) === axis);
    return {
      axis,
      verified: onAxis.filter((w) => isVerified(w.length)).map((w) => w.id),
      unverified: onAxis.filter((w) => !isVerified(w.length)).map((w) => w.id),
    };
  });
}

/**
 * The trap, named: every wall came off a sensor, every one carries a tolerance,
 * and the room closes to the nanometre anyway.
 *
 * That combination is not evidence of accuracy. It is evidence that something
 * upstream closed the polygon before ScanToBid ever saw it, which is exactly what
 * RoomPlan does. A room drawn by hand also closes exactly, and that *is*
 * meaningful — hence the requirement that nothing in it be verified.
 */
export function closedWithoutBeingChecked(room: Room): boolean {
  validate(room);
  if (room.walls.some((w) => isVerified(w.length))) return false;
  if (room.walls.every((w) => toleranceOf(w.length) === 0n)) return false;
  return closes(room);
}

/**
 * How far off the room could be and still look exactly like this.
 *
 * The sum of the unverified tolerances on an axis. On an imported scan this is
 * the number the closure check is silently hiding, and it is the honest answer
 * to "how good is this drawing".
 */
export function unseenError(room: Room, axis: Axis): Nanometres {
  validate(room);
  // A diagonal is counted against both axes. It runs in both, so an unverified
  // one puts both dimensions in doubt — and counting it twice is the honest way
  // round, since this number is an upper bound on what nobody has checked.
  return room.walls
    .filter((w) => !isVerified(w.length) && (axisOf(w) === axis || isDiagonal(w.heading)))
    .reduce((total, w) => total + toleranceOf(w.length), 0n);
}

/* --------------------------------------------------------------- readiness */

export function readiness(room: Room): Readiness {
  validate(room);
  const axes = axisReadiness(room);
  const trap = closedWithoutBeingChecked(room);

  const blocking: string[] = [];
  for (const axis of axes) {
    if (axis.verified.length === 0) {
      const slack = unseenError(room, axis.axis);
      blocking.push(
        `No ${AXIS_NAME[axis.axis]} dimension has been measured by a person. ` +
          `Every one of them (${axis.unverified.join(', ')}) is the sensor's own number, ` +
          `and together they could be out by ${formatFeetInches(slack)}. ` +
          `Put a tape on one ${AXIS_NAME[axis.axis]} wall.`
      );
    }
  }

  if (trap && blocking.length > 0) {
    blocking.unshift(
      `This room closes exactly, and that means nothing yet: a scan arrives already ` +
        `closed, so the check passed without comparing anything. It will only start ` +
        `telling you something once a measured dimension is in it.`
    );
  }

  const warnings: string[] = [];
  const unverifiedOpenings = room.walls.flatMap((w) =>
    (w.openings ?? [])
      .filter((o) => !isVerified(o.width) || !isVerified(o.height))
      .map((o) => `${o.kind} "${o.id}" on wall "${w.id}"`)
  );
  if (unverifiedOpenings.length > 0) {
    warnings.push(
      `${unverifiedOpenings.length} opening ${unverifiedOpenings.length === 1 ? 'size is' : 'sizes are'} ` +
        `still the sensor's: ${unverifiedOpenings.join(', ')}. Scanned opening heights have been off by ` +
        `more than a foot in both directions on real scans, so these must be marked on the drawing ` +
        `and never ordered against.`
    );
  }
  if (!isVerified(room.ceilingHeight)) {
    warnings.push(
      `The ceiling height is the sensor's number. Everything priced by wall area — drywall, ` +
        `paint, trim — is only as good as it is.`
    );
  }

  const verifiedCount = room.walls.filter((w) => isVerified(w.length)).length;
  const trust: Trust =
    verifiedCount === room.walls.length
      ? 'verified'
      : blocking.length === 0
        ? 'partly-verified'
        : 'scanned';

  return {
    trust,
    closedWithoutBeingChecked: trap,
    axes,
    blocking,
    warnings,
    nextTape: verificationPunchList(room, room.walls.length),
  };
}

/**
 * The gate every dimensioned output goes through.
 *
 * Call this before writing a PDF, a DXF, a schedule, or anything else a person
 * might build from. It throws rather than returning a flag on purpose: an export
 * that forgets to check a boolean is the failure this whole file exists to
 * prevent, and a thrown error cannot be forgotten.
 *
 * On-screen views are not gated — looking at a scan is how somebody decides
 * where to put the tape. It is *issuing* that requires a checked drawing.
 */
export function assertIssuable(room: Room): void {
  const state = readiness(room);
  if (state.blocking.length > 0) {
    throw new NotIssuable(room.name, state.blocking, state.nextTape);
  }
}

/** True when `assertIssuable` would let this room through. */
export function isIssuable(room: Room): boolean {
  return readiness(room).blocking.length === 0;
}

/**
 * The badge for the drawing and the screen.
 *
 * Deliberately blunt. "Scanned — not checked" is the whole point: a contractor
 * glancing at a title block needs to know in one word whether anybody stood
 * behind these numbers.
 */
export function trustLabel(trust: Trust): string {
  switch (trust) {
    case 'verified':
      return 'Measured — every dimension checked';
    case 'partly-verified':
      return 'Partly measured — scanned dimensions marked';
    case 'scanned':
      return 'Scanned — not checked';
  }
}
