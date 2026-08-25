import { type Nanometres, NM_PER_METRE, formatFeetInches, formatMetric } from './length.ts';
import { isVerified, toleranceOf } from './measurement.ts';
import { type Room, isDiagonal, runLength } from './room.ts';
import { type ImportReport } from './import-roomplan.ts';
import { type PhotoImport, PLAUSIBLE_CAMERA_HEIGHT } from './capture.ts';
import { type Photo } from './photo.ts';
import { unphotographedWalls } from './photo.ts';
import { closedWithoutBeingChecked } from './issue.ts';
import { insidePlan } from './section.ts';

/**
 * Is this capture any good?
 *
 * There was a command-line tool for this — a Python script that read a scan and
 * printed what it actually contained. It found two of the room model's
 * assumptions wrong and a missing field, so it earned its place. But asking
 * somebody who has just walked a room with a phone to go and run a Python
 * script is asking the wrong person to do the wrong thing: **the app put the
 * file there, so the app should say whether it is any good.**
 *
 * So the checks live here, in the model, where the app and the tool can both
 * reach them and where they are tested. Every one of them exists because
 * something real went wrong or nearly did:
 *
 *   - a scan closes perfectly whether it is right or wrong
 *   - RoomPlan never exports wall thickness
 *   - it never states a window sill
 *   - its door heights came back out by more than a foot, twice
 *   - a scan can pick up a wall from the room next door
 *   - camera poses in the wrong frame look fine until you check the height
 *
 * Nothing here is a score out of ten. Each finding says what was seen and what
 * it means, because "87%" tells a contractor nothing and "the counter wall is
 * the one to tape" tells him what to do next.
 */

export type Severity =
  /** Stops the drawing going out. */
  | 'stop'
  /** Worth going back for, or at least worth knowing before pricing. */
  | 'check'
  /** True and worth saying once. Nothing to do. */
  | 'note';

export interface Finding {
  readonly severity: Severity;
  /** One line, for a list. */
  readonly what: string;
  /** The reason, for somebody who wants it. */
  readonly detail: string;
}

/**
 * How wide a window gets before it is probably not a window.
 *
 * 8 ft. A picture window that size exists; a garage door that size is the norm,
 * and Sam's own garage came back with one 16' 11 13/16" across labelled window.
 * The number is a prompt to look, not a rule about buildings.
 */
export const WIDEST_LIKELY_WINDOW: Nanometres = 8n * 12n * 25400000n;

/**
 * How far below the ceiling a wall has to stand before it is worth a look.
 *
 * 1 ft. A pony wall or a breakfast bar is much shorter than that and a scanning
 * error is usually smaller, so this is the band where the two are hard to tell
 * apart — which is exactly when somebody should look rather than the app guess.
 */
export const SHORT_WALL: Nanometres = 12n * 25400000n;

/** Apple's own recommended maximum for one capture. */
export const ROOMPLAN_MAX_SIDE: Nanometres = 9n * NM_PER_METRE;

export interface HealthInput {
  readonly room: Room;
  readonly report: ImportReport;
  readonly photos?: readonly Photo[];
  /** Whatever the photo import refused, so it is reported rather than lost. */
  readonly rejectedPhotos?: PhotoImport['rejected'];
  /** Camera heights above the floor, if they were worked out. */
  readonly cameraHeights?: readonly Nanometres[];
}

export function checkCapture(input: HealthInput): Finding[] {
  const { room, report } = input;
  const findings: Finding[] = [];

  /* ------------------------------------------------------------ the trap */

  if (closedWithoutBeingChecked(room)) {
    findings.push({
      severity: 'stop',
      what: 'This room closes perfectly, and that means nothing yet',
      detail:
        'A scan arrives already squared up, so every corner meets to a thousandth of a ' +
        'millimetre whether the room is right or wrong. Nothing here has been compared against ' +
        'anything. Put a tape on one wall running each way.',
    });
  }

  /* ----------------------------------------------------------- the shape */

  if (report.dropped.length > 0) {
    findings.push({
      severity: 'check',
      what: `${report.dropped.length} wall${report.dropped.length === 1 ? '' : 's'} left out of this room`,
      detail:
        report.dropped
          .map((w) => `${formatFeetInches(w.length)}: no edge of the floor runs between its ends`)
          .join('; ') +
        '. Usually a wall of the room next door, seen through a doorway. If one of them is ' +
        'really part of this room, the scan missed a corner.',
    });
  }

  const openSpans = room.walls.filter((w) => w.open);
  if (openSpans.length > 0) {
    findings.push({
      severity: 'check',
      what: `${openSpans.length} edge${openSpans.length === 1 ? '' : 's'} with no wall across`,
      detail:
        openSpans.map((w) => formatFeetInches(runLength(w))).join(', ') +
        '. Nothing is built here, so no drywall, no paint, no baseboard. If one of them is ' +
        'really a wall or a cased opening, say so before anything is priced off this room.',
    });
  }

  const worstSnap = report.snapped.reduce((most, s) => (s.by > most ? s.by : most), 0n);
  if (worstSnap > 10n * NM_PER_METRE / 1000n) {
    findings.push({
      severity: 'note',
      what: `An edge was straightened by ${formatMetric(worstSnap, 'mm')}`,
      detail:
        'RoomPlan squares up its walls and not its floor outline, so the two disagree slightly. ' +
        'The walls win, and whatever was left over was shared out when the room re-closed.',
    });
  }

  const angled = room.walls.filter((w) => isDiagonal(w.heading));
  if (angled.length > 0) {
    findings.push({
      severity: 'note',
      what: `${angled.length} wall${angled.length === 1 ? '' : 's'} at a real angle`,
      detail:
        angled.map((w) => formatFeetInches(runLength(w))).join(', ') +
        '. Kept as measured rather than straightened onto the grid.',
    });
  }

  /* ------------------------------------------------------------- the size */

  const spans = extent(room);
  if (spans.x > ROOMPLAN_MAX_SIDE || spans.y > ROOMPLAN_MAX_SIDE) {
    findings.push({
      severity: 'check',
      what: 'This room is bigger than one capture is meant to cover',
      detail:
        `It measures ${formatFeetInches(spans.x)} by ${formatFeetInches(spans.y)}, and Apple ` +
        `recommends no more than ${formatFeetInches(ROOMPLAN_MAX_SIDE)} a side. Drift builds up ` +
        'past that. Worth splitting, and worth a tape either way.',
    });
  }

  /* ---------------------------------------------------------- the openings */

  const openings = room.walls.flatMap((w) => (w.openings ?? []).map((o) => ({ wall: w, opening: o })));
  const implausibleDoors = openings.filter(
    ({ opening }) =>
      (opening.kind === 'door' || opening.kind === 'cased') &&
      !isVerified(opening.height) &&
      (opening.height.value < parseFeet(6) || opening.height.value > parseFeet(7.5))
  );
  if (implausibleDoors.length > 0) {
    findings.push({
      severity: 'check',
      what: `${implausibleDoors.length} door height${implausibleDoors.length === 1 ? '' : 's'} the scan probably got wrong`,
      detail:
        implausibleDoors.map(({ opening }) => formatFeetInches(opening.height.value)).join(', ') +
        '. A door is nearly always 6\'8". Scanned door heights came back out by more than a foot ' +
        'in both directions on two real scans, so measure any you intend to order against.',
    });
  }

  // An opening that runs past the end of the wall it is in. It does not arrive
  // that way — every opening in both real scans fits — but a wall gets shorter
  // when somebody measures it, and a door that was near the corner can end up
  // hanging past it. Every quantity clips at the wall's end, so the room still
  // adds up while a foot of trim comes off a wall the door is not in.
  const overhanging = openings
    .map(({ wall, opening }) => ({
      wall,
      opening,
      past: opening.offsetFromStart.value + opening.width.value - runLength(wall),
    }))
    .filter((x) => x.past > 0n);
  if (overhanging.length > 0) {
    findings.push({
      severity: 'stop',
      what: `${overhanging.length} opening${overhanging.length === 1 ? '' : 's'} running past the end of ${overhanging.length === 1 ? 'its' : 'their'} wall`,
      detail:
        overhanging
          .map(
            (x) =>
              `the ${x.opening.kind} in ${x.wall.id} ends ${formatFeetInches(x.past)} past it`
          )
          .join('; ') +
        '. This happens when a wall is measured shorter than the scan had it. Every quantity ' +
        'clips the opening at the wall\'s end, so the room still adds up while the trim and ' +
        'paint come off a wall it is not in. Measure where it starts, or measure the wall again.',
    });
  }

  if (report.recoveredSills.length > 0) {
    findings.push({
      severity: 'note',
      what: `${report.recoveredSills.length} window sill height${report.recoveredSills.length === 1 ? '' : 's'} worked out, not read`,
      detail:
        'RoomPlan never states a sill height. These were recovered from the window\'s centre and ' +
        'its height, so they carry the same band as everything else the scanner produced.',
    });
  }

  /* ---------------------------------------------------------- the photos */

  if (input.photos) {
    const missing = unphotographedWalls(input.photos, room);
    if (input.photos.length === 0) {
      findings.push({
        severity: 'check',
        what: 'No photographs came with this scan',
        detail:
          'Nothing to go back to when a dimension is argued about, and no way to say which walls ' +
          'the scanner could not see properly.',
      });
    } else if (missing.length > 0) {
      findings.push({
        severity: 'check',
        what: `${missing.length} wall${missing.length === 1 ? '' : 's'} no photograph shows`,
        detail:
          missing
            .map((id) => {
              const wall = room.walls.find((w) => w.id === id);
              return wall ? formatFeetInches(runLength(wall)) : id;
            })
            .join(', ') + '. Worth another walk past before leaving the site.',
      });
    }
  }

  if (input.rejectedPhotos && input.rejectedPhotos.length > 0) {
    findings.push({
      severity: 'check',
      what: `${input.rejectedPhotos.length} photograph${input.rejectedPhotos.length === 1 ? '' : 's'} could not be placed`,
      detail: input.rejectedPhotos[0]!.reason,
    });
  }

  if (input.cameraHeights && input.cameraHeights.length > 0) {
    const odd = input.cameraHeights.filter(
      (h) => h < PLAUSIBLE_CAMERA_HEIGHT.low || h > PLAUSIBLE_CAMERA_HEIGHT.high
    );
    if (odd.length > 0) {
      findings.push({
        severity: 'stop',
        what: 'The photographs do not appear to be in the same room as the walls',
        detail:
          `${odd.length} of ${input.cameraHeights.length} were taken between ` +
          // The range of the BAD ones. Quoting min and max over every photograph
          // meant a stop finding understating its own evidence — six frames at
          // 13 to 15 ft reported as "between 3' 11" and 15' 6"", because one
          // perfectly good photograph was the minimum.
          `${formatFeetInches(min(odd))} and ${formatFeetInches(max(odd))} ` +
          'above the floor. A person holds a phone somewhere between knee and head height, so ' +
          'anything else means the poses and the room are in different coordinate systems. ' +
          'Nothing should be drawn from this until it is worked out.',
      });
    }
  }

  // Height catches a capture whose poses are in the wrong space vertically.
  // This catches one that is wrong across the floor, which is what happens when
  // the poses and the walls have had different rotations or origins applied to
  // them — and it is what happened here: every photograph was placed against
  // walls eight feet from where they are, and every number that came out of it
  // looked perfectly reasonable.
  if (input.photos && input.photos.length > 0) {
    const outside = input.photos.filter((p) => !insidePlan(room, p.pose.at));
    // Somebody scanning a garage stands in the doorway, so a handful outside is
    // a room with a wide opening, not a broken frame. Most of them outside is
    // not something a person does.
    if (outside.length * 2 > input.photos.length) {
      findings.push({
        severity: 'stop',
        what: 'The photographer appears to have been standing outside this room',
        detail:
          `${outside.length} of ${input.photos.length} photographs were taken from a position ` +
          'outside the floor outline. A few is a wide opening somebody stood in; most of them ' +
          'means the photographs and the walls are not in the same coordinate system, and ' +
          'nothing that relates one to the other can be believed until that is worked out.',
      });
    } else if (outside.length > 0) {
      findings.push({
        severity: 'note',
        what: `${outside.length} photograph${outside.length === 1 ? ' was' : 's were'} taken from outside the room`,
        detail:
          'Normal where a room has a wide opening — a garage door, a span into the next room — ' +
          'and worth knowing, because those are the shots that see the outside face of a wall.',
      });
    }
  }

  // RoomPlan classifies what it sees, and a garage door is a big flat rectangle
  // in a wall. Sam's own garage came back with a "window" 16' 11 13/16" wide.
  // Nothing downstream can tell the difference, and the difference is the price
  // of a garage door against the price of a window.
  const generous = room.walls.flatMap((wall) =>
    (wall.openings ?? [])
      .filter((o) => o.kind === 'window' && o.width.value > WIDEST_LIKELY_WINDOW)
      .map((o) => ({ wall, opening: o }))
  );
  if (generous.length > 0) {
    findings.push({
      severity: 'check',
      what: `${generous.length === 1 ? 'A window' : `${generous.length} windows`} too wide to be a window`,
      detail:
        generous
          .map((g) => `${formatFeetInches(g.opening.width.value)} across ${g.wall.id}`)
          .join('; ') +
        `. Anything past ${formatFeetInches(WIDEST_LIKELY_WINDOW)} is usually a garage door, a ` +
        'slider, or a wide opening the scanner filled in. It is priced as glazing until somebody ' +
        'says otherwise.',
    });
  }

  // Every wall keeps its own scanned height and the ceiling is the tallest of
  // them, so a wall the scanner read short stands short — and Sam's garage came
  // back with heights of 2.13, 1.95, 1.95, 1.62 and 2.13 m off one slab, which
  // the model presents as a garage with a 5'4" pony wall. There is a
  // plausibility check for door heights and there was none for walls, and the
  // wall face is what drywall and paint are priced off.
  const ceiling = room.ceilingHeight.value;
  const short = room.walls.filter(
    (wall) => wall.height !== undefined && ceiling - wall.height.value > SHORT_WALL
  );
  if (short.length > 0) {
    const missing = short.reduce(
      (total, wall) => total + runLength(wall) * (ceiling - wall.height!.value),
      0n
    );
    findings.push({
      severity: 'check',
      what: `${short.length} wall${short.length === 1 ? ' stands' : 's stand'} well short of the ceiling`,
      detail:
        short
          .map(
            (wall) =>
              `${wall.id} at ${formatFeetInches(wall.height!.value)} against a ` +
              `${formatFeetInches(ceiling)} ceiling`
          )
          .join('; ') +
        `. Some are real — a pony wall, a breakfast bar — and some are a wall the scanner read ` +
        `short. It is ${formatFeetInches(sideOf(missing))} squared of wall face either way, so it ` +
        'is worth a look before anything is priced by area.',
    });
  }

  /* -------------------------------------------------------- always worth saying */

  const bands = room.walls.filter((w) => !isVerified(w.length) && toleranceOf(w.length) > 0n);
  if (bands.length > 0) {
    findings.push({
      severity: 'note',
      what: 'Wall thickness is not in this file at all',
      detail:
        'RoomPlan does not export it, so every thickness on the drawing is one the app chose. ' +
        'Check it against a door jamb before it is used for anything.',
    });
  }

  return findings;
}

/** Nothing but findings that stop a drawing. */
export function blockers(findings: readonly Finding[]): Finding[] {
  return findings.filter((f) => f.severity === 'stop');
}

/* ------------------------------------------------------------------ helpers */

function parseFeet(feet: number): Nanometres {
  return BigInt(Math.round(feet * 304_800_000));
}

function min(values: readonly Nanometres[]): Nanometres {
  return values.reduce((a, b) => (a < b ? a : b));
}

function max(values: readonly Nanometres[]): Nanometres {
  return values.reduce((a, b) => (a > b ? a : b));
}

/** The side of a square of this area — a readable way to say a square-nanometre. */
function sideOf(squareNanometres: bigint): Nanometres {
  let low = 0n;
  let high = squareNanometres + 1n;
  while (low + 1n < high) {
    const mid = (low + high) / 2n;
    if (mid * mid <= squareNanometres) low = mid;
    else high = mid;
  }
  return low;
}

/** How far the room reaches in each direction. */
export function extent(room: Room): { x: Nanometres; y: Nanometres } {
  let x = 0n;
  let y = 0n;
  let minX = 0n;
  let maxX = 0n;
  let minY = 0n;
  let maxY = 0n;
  for (const wall of room.walls) {
    const run = isDiagonal(wall.heading)
      ? wall.heading.run
      : wall.heading === 'east'
        ? { x: wall.length.value, y: 0n }
        : wall.heading === 'west'
          ? { x: -wall.length.value, y: 0n }
          : wall.heading === 'north'
            ? { x: 0n, y: wall.length.value }
            : { x: 0n, y: -wall.length.value };
    x += run.x;
    y += run.y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { x: maxX - minX, y: maxY - minY };
}
