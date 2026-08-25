import { type Nanometres, formatFeetInches } from './length.ts';
import {
  type Measurement,
  type VerificationMethod,
  adjust,
  isVerified,
  verified,
  verify,
} from './measurement.ts';
import {
  type Opening,
  type Room,
  type Wall,
  RoomError,
  axisOf,
  diagonal,
  isDiagonal,
  runLength,
  runOf,
  sameBuild,
  solve,
  validate,
} from './room.ts';

/**
 * Changing an imported room, and the reason the import screen is worth building.
 *
 * The importer makes decisions on somebody's behalf and names every one of them:
 * which edges had no wall, which wall belonged to the room next door, how much
 * each edge was straightened. Naming them is only half of it. A note that says
 * *"this 15 foot edge has no wall across it — if that is really a wall, change
 * it here"* is a confession with no remedy unless "here" exists.
 *
 * So this is the small set of operations the correction screen actually needs,
 * done properly in the model rather than in a component:
 *
 *   - `makeWall`   — that open span is really a wall.
 *   - `makeOpen`   — that wall is really an opening.
 *   - `makeCased`  — that opening is really a cased opening, with a header.
 *   - `verifyWall` — somebody put a tape on it, and the room re-solves around it.
 *
 * The last one is the whole product in one function, and this is the first place
 * a person can reach it.
 *
 * Every operation returns a new room and leaves the old one alone, so undo is
 * whatever the caller kept. Nothing here mutates, and nothing here half-succeeds:
 * an edit that would leave the model in a state it does not believe throws with
 * the reason, and the caller still has the room it started with.
 */

export class EditError extends RoomError {}

function find(room: Room, wallId: string): { wall: Wall; index: number } {
  const index = room.walls.findIndex((w) => w.id === wallId);
  if (index === -1) throw new EditError(`"${room.name}" has no edge called "${wallId}".`);
  return { wall: room.walls[index]!, index };
}

/** Re-solves after an edit, so the caller can never be handed a room that does not close. */
function settle(room: Room): Room {
  validate(room);
  return solve(room).room;
}

/* ------------------------------------------------------------ open or built */

/**
 * Turn an open span into a wall, merging it with any wall in line with it.
 *
 * The merge is not tidiness, it is correctness. A garage door sits in line with
 * the stub of wall either side of it, so closing that opening leaves three
 * collinear segments — which the model refuses, and rightly: two built walls on
 * one axis are one wall written twice, and the solver would move both to correct
 * one error. Sam's garage is exactly this shape. So the three become one wall of
 * their combined length, and the openings in them keep their positions along it.
 *
 * The merged wall takes the id of the first segment. That is a real loss: the
 * two it swallowed no longer exist, and there is no un-merge. Undo is the room
 * you were holding before you called this.
 */
export function makeWall(room: Room, wallId: string): Room {
  const { wall, index } = find(room, wallId);
  if (!wall.open) throw new EditError(`"${wallId}" is already a wall.`);

  const built: Wall = { ...wall };
  delete (built as { open?: true }).open;

  const walls = [...room.walls];
  walls[index] = built;
  return settle({ ...room, walls: mergeCollinear(walls) });
}

/**
 * Turn a wall into an open span: a side of the room with nothing built across it.
 *
 * A wall with a door or a window in it is refused rather than emptied. Deleting
 * somebody's opening as a side effect of a different edit is how a take-off
 * quietly loses a door.
 */
export function makeOpen(room: Room, wallId: string): Room {
  const { wall, index } = find(room, wallId);
  if (wall.open) throw new EditError(`"${wallId}" is already an open span.`);
  if ((wall.openings?.length ?? 0) > 0) {
    throw new EditError(
      `"${wallId}" has ${wall.openings!.length} opening${wall.openings!.length === 1 ? '' : 's'} in it ` +
        `(${wall.openings!.map((o) => o.kind).join(', ')}). Take ${wall.openings!.length === 1 ? 'it' : 'them'} ` +
        `out first if there is really no wall here.`
    );
  }

  const walls = [...room.walls];
  walls[index] = { ...wall, open: true };
  return settle({ ...room, walls });
}

/**
 * Turn an edge into a wall with a cased opening across the whole of it.
 *
 * Different from an open span, and the difference is money: a cased opening has
 * a header, jambs and casing, and it interrupts the baseboard. An open span has
 * none of that. A 15 foot garage door is not a cased opening; a 6 foot gap
 * between a kitchen and a dining room usually is.
 */
export function makeCased(room: Room, wallId: string, height?: Measurement): Room {
  const { wall, index } = find(room, wallId);
  if ((wall.openings?.length ?? 0) > 0) {
    throw new EditError(
      `"${wallId}" already has ${wall.openings!.length} opening${wall.openings!.length === 1 ? '' : 's'} in it. ` +
        `A cased opening across the whole edge would sit on top of ${wall.openings!.length === 1 ? 'it' : 'them'}.`
    );
  }
  const span = runLength(wall);
  const opening: Opening = {
    id: `${wall.id}:cased`,
    kind: 'cased',
    width: wall.length,
    height: height ?? wall.height ?? room.ceilingHeight,
    offsetFromStart: { value: 0n, provenance: { kind: 'derived', tolerance: 0n, from: [wall.id] } },
  };
  if (opening.height.value > (wall.height ?? room.ceilingHeight).value) {
    throw new EditError(
      `A ${formatFeetInches(opening.height.value)} opening does not fit in a ` +
        `${formatFeetInches((wall.height ?? room.ceilingHeight).value)} wall.`
    );
  }

  const built: Wall = { ...wall, openings: [opening] };
  delete (built as { open?: true }).open;
  if (span === 0n) throw new EditError(`"${wallId}" has no length to case.`);

  const walls = [...room.walls];
  walls[index] = built;
  return settle({ ...room, walls: mergeCollinear(walls) });
}

/* ------------------------------------------------------------------ merging */

/**
 * Folds runs of built walls that share a heading into one wall each.
 *
 * Only built, axis-aligned, same-heading neighbours merge. A diagonal never
 * merges — two angles in a row is a bay, not a duplicate — and an open span
 * never merges, because it is what separates the segments either side of it.
 *
 * Openings come along, shifted by however far their wall now starts down the
 * merged one, so a door stays where it is in the building.
 */
function mergeCollinear(walls: readonly Wall[]): Wall[] {
  const out: Wall[] = [];
  for (const wall of walls) {
    const previous = out[out.length - 1];
    const mergeable =
      previous !== undefined &&
      !previous.open &&
      !wall.open &&
      axisOf(previous) !== null &&
      previous.heading === wall.heading;

    if (!mergeable) {
      out.push(wall);
      continue;
    }

    const shift = runLength(previous);
    const moved = (wall.openings ?? []).map((o) => ({
      ...o,
      offsetFromStart: {
        ...o.offsetFromStart,
        value: o.offsetFromStart.value + shift,
      },
    }));
    const openings = [...(previous.openings ?? []), ...moved];

    // A merged wall stands as tall as the tallest piece of it.
    //
    // Spreading `previous` kept whichever height happened to be first in the
    // ring. On Sam's garage — where the importer's own note tells you to do this
    // merge — a 572 mm stub was first, so 5.94 m of wall came out 1950 mm high
    // and 16.8 sq ft of drywall and paint vanished from the takeoff with the
    // room still closing exactly and no finding raised.
    //
    // Tallest is the safe direction: it never under-orders material, and the
    // pieces disagreeing at all is itself worth seeing on the drawing.
    // An undefined height means "the room's ceiling", which is the tallest thing
    // there is — so one full-height piece makes the whole merged wall full
    // height, and the key has to come off rather than be left behind by the
    // spread below.
    const fullHeight = previous.height === undefined || wall.height === undefined;
    const tallest = fullHeight
      ? undefined
      : previous.height!.value >= wall.height!.value
        ? previous.height
        : wall.height;

    const merged: { -readonly [K in keyof Wall]: Wall[K] } = {
      ...previous,
      length: {
        ...previous.length,
        value: previous.length.value + wall.length.value,
        // Two scanned lengths added are two tolerances added: the merged wall is
        // no more certain than the sum of the pieces it came from.
        provenance:
          previous.length.provenance.kind === 'scanned' && wall.length.provenance.kind === 'scanned'
            ? {
                ...previous.length.provenance,
                tolerance: previous.length.provenance.tolerance + wall.length.provenance.tolerance,
              }
            : { kind: 'derived', tolerance: 0n, from: [previous.id, wall.id] },
      },
      ...(openings.length > 0 ? { openings } : {}),
    };
    if (tallest) merged.height = tallest;
    else delete (merged as { height?: Measurement }).height;
    out[out.length - 1] = merged;
  }

  // The list is a ring, so the last may run into the first.
  if (out.length > 2) {
    const first = out[0]!;
    const last = out[out.length - 1]!;
    if (!first.open && !last.open && axisOf(first) !== null && first.heading === last.heading) {
      const folded = mergeCollinear([last, first]);
      if (folded.length === 1) {
        out[0] = folded[0]!;
        out.pop();
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------- verification */

export interface Verification {
  readonly room: Room;
  /** Which walls moved to accommodate the new number, and by how far. */
  readonly adjustments: readonly { wallId: string; by: Nanometres; beyondTolerance: boolean }[];
}

/**
 * Somebody put a tape on a wall. The room rearranges itself around what they said.
 *
 * This is the correction layer, and it is the reason the product exists. Every
 * scanning app lets you edit a number; none of them re-solves the room around it.
 * Here the typed length is fixed — it never moves again — and every other
 * unverified wall gives ground in proportion to how unsure the sensor was about
 * it, until the room closes exactly.
 *
 * A wall that runs at an angle keeps its angle. Its run is rebuilt at the new
 * length in the same direction, because a person measuring a chamfer measured
 * its length and said nothing whatever about its angle.
 */
export function verifyWall(
  room: Room,
  wallId: string,
  length: Nanometres,
  by: string,
  at: string,
  method: VerificationMethod
): Verification {
  const { wall, index } = find(room, wallId);
  if (length <= 0n) {
    throw new EditError(`A wall of ${formatFeetInches(length)} is not a wall.`);
  }

  const measured = verify(wall.length, length, by, at, method);
  const walls = [...room.walls];
  walls[index] = isDiagonal(wall.heading)
    ? { ...wall, heading: diagonal(length, runOf(wall)), length: measured }
    : { ...wall, length: measured };

  const solved = solve({ ...room, walls });
  return { room: solved.room, adjustments: solved.adjustments };
}

/* ------------------------------------------------------------- thickness */

/**
 * How thick the walls are, said once for the room.
 *
 * The scanner cannot know this — RoomPlan's third dimension on every surface is
 * zero — so it is always somebody saying it, and the method says how they knew:
 * `stated` for "that's a 2x4 wall", `tape` for a tape held through a doorway,
 * `plans` for a number off a drawing.
 *
 * It changes nothing already on the plan. The outline the scanner produced is
 * the room's inside face, which is what flooring, drywall, paint and baseboard
 * are priced off, so no length, area or quantity already on screen moves. What
 * it adds is in `thickness.ts`: the jamb, the wrap round each opening, the
 * plates and studs, and what the building measures outside.
 */
export function setRoomThickness(room: Room, thickness: Measurement): Room {
  if (thickness.value <= 0n) {
    throw new EditError(`A wall ${formatFeetInches(thickness.value)} thick is not a wall.`);
  }
  const next: Room = { ...room, wallThickness: thickness };
  validate(next);
  return next;
}

/**
 * How thick one wall is, when it is not like the others.
 *
 * Most houses are two thicknesses: the outside walls and the partitions. Pass
 * `undefined` to take the override off again, so the wall goes back to whatever
 * the room says.
 */
export function setWallThickness(
  room: Room,
  wallId: string,
  thickness: Measurement | undefined
): Room {
  const { wall, index } = find(room, wallId);
  if (wall.open) {
    throw new EditError(
      `"${wallId}" is an open span — there is nothing built across it to be thick. If there ` +
        `really is a wall there, make it one first.`
    );
  }
  if (thickness !== undefined && thickness.value <= 0n) {
    throw new EditError(`A wall ${formatFeetInches(thickness.value)} thick is not a wall.`);
  }
  const walls = [...room.walls];
  const { thickness: _dropped, ...bare } = wall;
  walls[index] = thickness === undefined ? bare : { ...wall, thickness };
  const next: Room = { ...room, walls };
  validate(next);
  return next;
}

/* ---------------------------------------------------------- opening sizes */

/**
 * What somebody wants to change about an opening. Anything left out stays.
 *
 * Four separate numbers because they are four separate readings, and somebody
 * measuring a window in a half-built room will have the width before they have
 * the sill.
 */
export interface OpeningEdit {
  readonly width?: Nanometres;
  readonly height?: Nanometres;
  /** How far the bottom sits above the floor. Windows only; a door starts at it. */
  readonly sillHeight?: Nanometres;
  /** How far along the wall it starts, from the wall's first corner. */
  readonly offsetFromStart?: Nanometres;
}

/**
 * Somebody put a tape on a door or a window and typed what it really is.
 *
 * The one measurement in a scan most likely to be badly wrong. RoomPlan calls a
 * 16 ft 11 in span a window in the garage, and a 2 ft 7 in door in the kitchen
 * is a door nobody could carry a sheet of plywood through. Openings are fitted
 * to whatever was reflective enough to see, and the sizes come out anywhere from
 * an inch to a foot off — which is exactly the range that never looks wrong on
 * screen and is wrong on the order.
 *
 * Unlike a wall, this does not re-solve the room. An opening is a hole in a
 * wall, not a side of the building: the closure sum does not know it exists.
 * What it does do is refuse an opening that will not fit where it is being put,
 * because an opening hanging off the end of its wall is not a small error — it
 * silently comes off a wall it is not in.
 */
export function verifyOpening(
  room: Room,
  wallId: string,
  openingId: string,
  edit: OpeningEdit,
  by: string,
  at: string,
  method: VerificationMethod
): Room {
  const { wall, index } = find(room, wallId);
  const openings = wall.openings ?? [];
  const position = openings.findIndex((o) => o.id === openingId);
  if (position === -1) {
    throw new EditError(`Wall "${wallId}" has nothing in it called "${openingId}".`);
  }
  const was = openings[position]!;

  const next: Opening = {
    ...was,
    ...(edit.width === undefined ? {} : { width: verify(was.width, edit.width, by, at, method) }),
    ...(edit.height === undefined
      ? {}
      : { height: verify(was.height, edit.height, by, at, method) }),
    ...(edit.offsetFromStart === undefined
      ? {}
      : {
          offsetFromStart: verify(was.offsetFromStart, edit.offsetFromStart, by, at, method),
        }),
    ...(edit.sillHeight === undefined
      ? {}
      : {
          sillHeight:
            was.sillHeight === undefined
              ? verified(edit.sillHeight, by, at, method)
              : verify(was.sillHeight, edit.sillHeight, by, at, method),
        }),
  };

  if (next.width.value <= 0n) {
    throw new EditError(`An opening ${formatFeetInches(next.width.value)} wide is not an opening.`);
  }
  if (next.height.value <= 0n) {
    throw new EditError(`An opening ${formatFeetInches(next.height.value)} high is not an opening.`);
  }
  if (next.offsetFromStart.value < 0n) {
    throw new EditError(
      `That would start the ${next.kind} ${formatFeetInches(-next.offsetFromStart.value)} before ` +
        `the beginning of "${wallId}".`
    );
  }

  // It has to fit in the wall it is in. An opening that overhangs is not a
  // rounding: every quantity clips it at the wall's end, so a door that hangs
  // two feet past the corner quietly takes two feet of trim off a wall it is
  // not in, and the room still adds up.
  const run = runLength(wall);
  const end = next.offsetFromStart.value + next.width.value;
  if (end > run) {
    throw new EditError(
      `A ${formatFeetInches(next.width.value)} ${next.kind} starting ` +
        `${formatFeetInches(next.offsetFromStart.value)} along "${wallId}" ends ` +
        `${formatFeetInches(end - run)} past the end of it — the wall is ` +
        `${formatFeetInches(run)}. Either it starts somewhere else, or the wall is longer than ` +
        `the scan thinks. Measure whichever one you are less sure of.`
    );
  }

  // And it has to fit under the ceiling, sill included.
  const standing = (wall.height ?? room.ceilingHeight).value;
  const top = (next.sillHeight?.value ?? 0n) + next.height.value;
  if (top > standing) {
    throw new EditError(
      `That puts the top of the ${next.kind} ${formatFeetInches(top)} above the floor, and ` +
        `"${wallId}" is ${formatFeetInches(standing)} high. Check the sill and the height ` +
        `together — one of them is out.`
    );
  }

  // Two openings in the same wall cannot occupy the same stretch of it.
  for (const other of openings) {
    if (other.id === openingId) continue;
    const otherEnd = other.offsetFromStart.value + other.width.value;
    if (next.offsetFromStart.value < otherEnd && other.offsetFromStart.value < end) {
      throw new EditError(
        `That would run the ${next.kind} through "${other.id}", which is already in "${wallId}" ` +
          `from ${formatFeetInches(other.offsetFromStart.value)} to ` +
          `${formatFeetInches(otherEnd)}.`
      );
    }
  }

  const walls = [...room.walls];
  const rest = [...openings];
  rest[position] = next;
  walls[index] = { ...wall, openings: rest };

  // No solve. An opening is a hole in a wall, not a side of the building: the
  // closure sum has never known it was there and does not now.
  const changed: Room = { ...room, walls };
  validate(changed);
  return changed;
}

/* --------------------------------------------------------------- heights */

/**
 * Every opening that would stick out through a wall of this height.
 *
 * Shared by the two functions below because they are the same question asked
 * from either end: lowering the ceiling and raising a window's sill both put the
 * top of something above the top of what it is in.
 */
function pokingThrough(
  height: Nanometres,
  walls: readonly Wall[]
): { wall: Wall; opening: Opening; top: Nanometres }[] {
  const out: { wall: Wall; opening: Opening; top: Nanometres }[] = [];
  for (const wall of walls) {
    const standing = wall.height?.value ?? height;
    for (const opening of wall.openings ?? []) {
      const top = (opening.sillHeight?.value ?? 0n) + opening.height.value;
      if (top > standing) out.push({ wall, opening, top });
    }
  }
  return out;
}

function tooTall(
  over: readonly { wall: Wall; opening: Opening; top: Nanometres }[],
  height: Nanometres
): string {
  return (
    over
      .map(
        (x) =>
          `the ${x.opening.kind} in ${x.wall.id} tops out at ${formatFeetInches(x.top)}`
      )
      .join('; ') +
    `. Nothing in a wall can be taller than the wall. Either the ceiling is higher than ` +
    `${formatFeetInches(height)}, or ${over.length === 1 ? 'that opening was' : 'those openings were'} ` +
    `measured wrong — the scan is routinely a foot out on them.`
  );
}

/**
 * Somebody measured the ceiling.
 *
 * The import takes the tallest wall in the scan, on the reasoning that a shorter
 * one is a pony wall or a soffit rather than the room getting lower. That is the
 * right guess and it is still a guess, carrying the sensor's band — and it
 * multiplies every square foot of drywall and paint in the room. A 2 inch error
 * over 80 ft of wall is 13 sq ft of board and two coats on it.
 *
 * Wall face, opening returns and everything downstream of them move when this
 * does. Floor and baseboard do not: neither has ever cared how high the room is.
 */
export function verifyCeiling(
  room: Room,
  height: Nanometres,
  by: string,
  at: string,
  method: VerificationMethod
): Room {
  if (height <= 0n) {
    throw new EditError(`A ceiling ${formatFeetInches(height)} above the floor is not a ceiling.`);
  }
  const over = pokingThrough(height, room.walls);
  if (over.length > 0) throw new EditError(tooTall(over, height));

  const next: Room = { ...room, ceilingHeight: verify(room.ceilingHeight, height, by, at, method) };
  validate(next);
  return next;
}

/**
 * One wall that does not go to the ceiling — a pony wall, a breakfast bar, the
 * half wall round a stair.
 *
 * It is genuinely built, so it takes drywall, paint and a cap and it divides the
 * space, but it is not the room getting shorter. `undefined` puts it back to
 * full height.
 */
export function setWallHeight(
  room: Room,
  wallId: string,
  height: Nanometres | undefined,
  by: string,
  at: string,
  method: VerificationMethod
): Room {
  const { wall, index } = find(room, wallId);
  if (wall.open) {
    throw new EditError(
      `"${wallId}" is an open span — there is no wall there to have a height. If there really ` +
        `is one, make it a wall first.`
    );
  }
  if (height !== undefined && height <= 0n) {
    throw new EditError(`A wall ${formatFeetInches(height)} high is not a wall.`);
  }
  if (height !== undefined && height > room.ceilingHeight.value) {
    throw new EditError(
      `That would make "${wallId}" ${formatFeetInches(height)} high in a room whose ceiling is ` +
        `${formatFeetInches(room.ceilingHeight.value)}. If the room really is that tall, ` +
        `measure the ceiling first and this wall after.`
    );
  }

  const walls = [...room.walls];
  const { height: _dropped, ...bare } = wall;
  walls[index] =
    height === undefined
      ? bare
      : {
          ...wall,
          height:
            wall.height === undefined
              ? verified(height, by, at, method)
              : verify(wall.height, height, by, at, method),
        };

  const over = pokingThrough(room.ceilingHeight.value, [walls[index]!]);
  if (over.length > 0) throw new EditError(tooTall(over, height ?? room.ceilingHeight.value));

  const next: Room = { ...room, walls };
  validate(next);
  return next;
}

/**
 * Putting a door or a window into a wall by hand.
 *
 * Two rooms need this and both of them are ordinary. A room drawn by hand has no
 * openings at all — `draft.ts` builds walls and nothing else — so until now a
 * hand-drawn room could not carry a door, which meant no baseboard deduction, no
 * jamb, and no way to join it to the room next door. And a scanned room is
 * routinely missing one: RoomPlan finds what it can see, and a door standing
 * open against a wall, or a cased opening with no frame, is regularly not there.
 *
 * It goes in where somebody says, and everything `verifyOpening` refuses is
 * refused here too — an opening has to fit in its wall, under its ceiling, and
 * not through something already there. The difference is only that this one is
 * making a hole rather than correcting one.
 *
 * Sizes are `verified`, because a person typed them. A door somebody put in by
 * hand is not the scanner's guess and must never read like one.
 */
export function addOpening(
  room: Room,
  wallId: string,
  opening: {
    readonly id: string;
    readonly kind: Opening['kind'];
    readonly width: Nanometres;
    readonly height: Nanometres;
    readonly offsetFromStart: Nanometres;
    readonly sillHeight?: Nanometres;
  },
  by: string,
  at: string,
  method: VerificationMethod = 'tape'
): Room {
  const { wall, index } = find(room, wallId);
  if (wall.open) {
    throw new EditError(
      `"${wallId}" is an open span — there is no wall there to put a ${opening.kind} in. If ` +
        `there really is a wall, make it one first.`
    );
  }
  if ((wall.openings ?? []).some((o) => o.id === opening.id)) {
    throw new EditError(`"${wallId}" already has something in it called "${opening.id}".`);
  }

  const made: Opening = {
    id: opening.id,
    kind: opening.kind,
    width: verified(opening.width, by, at, method),
    height: verified(opening.height, by, at, method),
    offsetFromStart: verified(opening.offsetFromStart, by, at, method),
    ...(opening.sillHeight === undefined
      ? {}
      : { sillHeight: verified(opening.sillHeight, by, at, method) }),
  };

  const walls = [...room.walls];
  walls[index] = { ...wall, openings: [...(wall.openings ?? []), made] };
  const next: Room = { ...room, walls };
  validate(next);

  // Everything that would refuse a correction refuses a new one, said in the
  // same words — checked by re-verifying it against itself, so there is one set
  // of rules about what fits in a wall rather than two that can drift apart.
  return verifyOpening(next, wallId, opening.id, {}, by, at, method);
}

/** Takes an opening out of a wall — the scanner found one that is not there. */
export function removeOpening(room: Room, wallId: string, openingId: string): Room {
  const { wall, index } = find(room, wallId);
  const openings = (wall.openings ?? []).filter((o) => o.id !== openingId);
  if (openings.length === (wall.openings ?? []).length) {
    throw new EditError(`Wall "${wallId}" has nothing in it called "${openingId}".`);
  }
  const walls = [...room.walls];
  const { openings: _gone, ...bare } = wall;
  walls[index] = openings.length === 0 ? bare : { ...wall, openings };
  const next: Room = { ...room, walls };
  validate(next);
  return next;
}

/* ------------------------------------------------------------------ names */

/**
 * What a room is called.
 *
 * It is on the drawing, on the takeoff, on the client file and at the top of
 * the claim document, and out of the importer it is a file name. "garage.json"
 * at the head of a document going to an insurer is not a small thing: it reads
 * as a machine's output rather than a contractor's, which is exactly the
 * impression this app exists to prevent.
 *
 * A name is not a measurement, so it carries no provenance and re-solves
 * nothing. It is the one edit in this module that cannot change a number.
 */
export function renameRoom(room: Room, name: string): Room {
  const trimmed = name.trim();
  if (trimmed === '') {
    throw new EditError('A room with no name is a room nobody can find again.');
  }
  if (trimmed.length > 120) {
    throw new EditError(
      `That name is ${trimmed.length} characters. Something that long is a note rather than a ` +
        `name, and it will not fit in the title block on the drawing.`
    );
  }
  const next: Room = { ...room, name: trimmed };
  validate(next);
  return next;
}

/**
 * What a wall is called.
 *
 * "wall-1" is the importer counting. "the wall behind the washer" is a person
 * telling somebody else which wall, and every sheet this app produces names
 * walls: the schedule, the punch list, the damage workings, the claim document.
 *
 * Ids are what everything else in the model points at — openings belong to a
 * wall id, damage is marked against one, joins between rooms name one — so this
 * changes the id itself and it has to refuse a collision rather than produce a
 * room with two walls answering to one name. Callers holding a wall id (a
 * selection, a damage mark) must move with it; `renameWall` returns the room
 * and the caller is responsible for its own references, because this module
 * does not know what they are.
 */
export function renameWall(room: Room, wallId: string, name: string): Room {
  const { wall, index } = find(room, wallId);
  const trimmed = name.trim();
  if (trimmed === '') {
    throw new EditError('A wall with no name is a wall nothing else can point at.');
  }
  if (trimmed === wallId) return room;
  if (room.walls.some((w) => w.id === trimmed)) {
    throw new EditError(
      `"${room.name}" already has a wall called "${trimmed}". Two walls with one name is two ` +
        `walls nothing can tell apart — including the openings and the damage marked on them.`
    );
  }
  const walls = [...room.walls];
  walls[index] = { ...wall, id: trimmed };
  const next: Room = { ...room, walls };
  validate(next);
  return next;
}

/* ------------------------------------------------- moved rather than measured */

/**
 * Somebody drags a wall to a new length.
 *
 * The room re-solves around it exactly as it does for a tape — that part is the
 * same operation — but what lands in the model is **not** a verified
 * measurement. A wall moved with a finger is not the sensor's number any more
 * and nobody put a tape on it either, so it goes in as `adjusted`: its own
 * word, its own colour on the plan, and it does not satisfy "put a tape on one
 * wall running each way".
 *
 * That distinction is the whole product. The moment dragging produced a
 * verified measurement, somebody could make an unchecked scan say "measured" by
 * nudging four walls, and every promise this app makes about where a number
 * came from would be worth nothing.
 *
 * A dragged wall stays movable by a later tape, deliberately: a tape beats a
 * finger, always.
 */
export function adjustWall(
  room: Room,
  wallId: string,
  length: Nanometres,
  by: string,
  at: string,
  note?: string
): Verification {
  const { wall, index } = find(room, wallId);
  if (length <= 0n) {
    throw new EditError(`A wall of ${formatFeetInches(length)} is not a wall.`);
  }
  if (isVerified(wall.length)) {
    throw new EditError(
      `"${wallId}" has had a tape on it. Dragging it would quietly replace a measurement with a ` +
        `guess, and the plan would still say somebody measured this room. Type what the tape ` +
        `says instead, or take the verification off it first.`
    );
  }

  const moved = adjust(wall.length, length, by, at, note);
  const walls = [...room.walls];
  walls[index] = isDiagonal(wall.heading)
    ? { ...wall, heading: diagonal(length, runOf(wall)), length: moved }
    : { ...wall, length: moved };

  // Held for this solve, exactly as a tape reading is. Somebody who drags a
  // wall to twenty-one feet and watches it settle at twenty-and-a-half has not
  // moved a wall — the room gave way in the wrong direction and the edit did
  // nothing. It is held for this solve only: a tape typed later moves it like
  // any other unverified wall.
  const solved = solve({ ...room, walls }, new Set([wallId]));
  return { room: solved.room, adjustments: solved.adjustments };
}

/**
 * Takes a person's word back off a wall.
 *
 * Needed because the refusal above needs a way out: somebody types a tape
 * reading, then finds they read the wrong wall. Restoring what the measurement
 * superseded is the only honest undo — the alternative is leaving a wrong
 * number wearing a tape's authority.
 *
 * A measurement with nothing under it was verified from the start (a room drawn
 * by hand), and there is nothing to fall back to, so it is refused rather than
 * quietly turned into a scan the sensor never produced.
 */
export function unverifyWall(room: Room, wallId: string): Room {
  const { wall, index } = find(room, wallId);
  const provenance = wall.length.provenance;
  if (provenance.kind !== 'verified') {
    throw new EditError(`"${wallId}" has not had a tape on it, so there is nothing to take off.`);
  }
  if (!provenance.supersedes) {
    throw new EditError(
      `"${wallId}" has never been anything but somebody's word — this room was drawn by hand ` +
        `rather than scanned. There is no earlier number to go back to. Type the right one.`
    );
  }
  const walls = [...room.walls];
  walls[index] = { ...wall, length: provenance.supersedes };
  const next: Room = { ...room, walls };
  validate(next);
  return next;
}

/* -------------------------------------------------- adding and taking away */

/**
 * One wall becomes two, at a point along it.
 *
 * Exact: the two pieces run in the same direction and their lengths sum to the
 * original, so the walk closes exactly as it did before. Nothing moves and
 * nothing re-solves.
 *
 * **The second piece has to be different from the first, and that is not a
 * formality.** Two collinear built walls that are alike in every way are one
 * wall written twice — the model refuses them, and rightly, because the solver
 * would move both of them to correct one error. So a split says what makes the
 * second piece a second wall: a height, a thickness, or both. That is also what
 * a split is actually *for* — a pony wall meeting a full-height one, a 2x6 run
 * meeting a 2x4 partition. Wanting half a wall to mark damage on needs no split
 * at all: a damaged area already runs from here to there along a wall.
 *
 * Both pieces keep the original's provenance rather than being marked adjusted.
 * That is the one case where inheriting is honest: if the sensor said twenty
 * feet ± two inches, then eight feet of it is eight feet ± two inches. Cutting
 * a run in two states nothing new about the building's size.
 *
 * An opening the cut would run through is refused. What happens to half a door
 * is a decision about somebody's building, not an arithmetic problem, and
 * quietly putting the whole door on one side would move a header three feet
 * without saying so.
 */
export interface SplitDifference {
  /** How tall the second piece stands. Omit to leave it at the room's ceiling. */
  readonly height?: Measurement;
  /** How thick the second piece is. */
  readonly thickness?: Measurement;
}

export function splitWall(
  room: Room,
  wallId: string,
  at: Nanometres,
  newId: string,
  difference: SplitDifference
): Room {
  const { wall, index } = find(room, wallId);
  if (wall.open) {
    throw new EditError(
      `"${wallId}" is an open span — there is no wall there to split. Make it a wall first.`
    );
  }
  if (isDiagonal(wall.heading)) {
    throw new EditError(
      `"${wallId}" runs at an angle. Splitting it would need the point on the run rather than a ` +
        `distance along it, and getting that wrong changes the angle — which is a measurement.`
    );
  }
  const whole = runLength(wall);
  if (at <= 0n || at >= whole) {
    throw new EditError(
      `"${wallId}" is ${formatFeetInches(whole)} long, so it cannot be split at ` +
        `${formatFeetInches(at)}. The point has to be somewhere along it.`
    );
  }
  if (newId.trim() === '') throw new EditError('The second piece needs a name.');
  if (room.walls.some((w) => w.id === newId.trim())) {
    throw new EditError(`"${room.name}" already has a wall called "${newId.trim()}".`);
  }

  const straddling = (wall.openings ?? []).filter(
    (o) => o.offsetFromStart.value < at && o.offsetFromStart.value + o.width.value > at
  );
  if (straddling.length > 0) {
    throw new EditError(
      `The cut at ${formatFeetInches(at)} runs through ${straddling
        .map((o) => `the ${o.kind} "${o.id}"`)
        .join(' and ')}. Split somewhere else, or take it out first — what happens to half a ` +
        `door is a decision about the building rather than about arithmetic.`
    );
  }

  // The provenance rides along unchanged: a piece of a scanned wall is scanned,
  // with the same band. Only the value changes.
  const piece = (value: Nanometres): Measurement => ({ ...wall.length, value });

  const before = (wall.openings ?? []).filter((o) => o.offsetFromStart.value + o.width.value <= at);
  const after = (wall.openings ?? [])
    .filter((o) => o.offsetFromStart.value >= at)
    .map((o) => ({
      ...o,
      offsetFromStart: { ...o.offsetFromStart, value: o.offsetFromStart.value - at },
    }));

  const first: Wall = {
    ...wall,
    length: piece(at),
    ...(before.length > 0 ? { openings: before } : {}),
  };
  if (before.length === 0) delete (first as { openings?: readonly Opening[] }).openings;

  const second: Wall = {
    ...wall,
    id: newId.trim(),
    length: piece(whole - at),
    ...(after.length > 0 ? { openings: after } : {}),
    ...(difference.height === undefined ? {} : { height: difference.height }),
    ...(difference.thickness === undefined ? {} : { thickness: difference.thickness }),
  };
  if (after.length === 0) delete (second as { openings?: readonly Opening[] }).openings;
  // An explicit "no height given" means the room's ceiling, and the key has to
  // come off rather than be left behind by the spread above — otherwise a pony
  // wall split into two pony walls would keep a height nobody asked for.
  if (difference.height === undefined && 'height' in difference) {
    delete (second as { height?: Measurement }).height;
  }
  if (difference.thickness === undefined && 'thickness' in difference) {
    delete (second as { thickness?: Measurement }).thickness;
  }

  // Compared at their effective values: a wall with no height on it stands at
  // the room's ceiling, so an explicit nine feet in a nine-foot room is not a
  // difference at all — and letting it look like one would produce exactly the
  // two identical walls this refusal exists to stop.
  if (sameBuild(first, second, room.ceilingHeight.value)) {
    throw new EditError(
      `Nothing would tell the two pieces of "${wallId}" apart — same height, same thickness — ` +
        `and two walls in line that are alike in every way are one wall written twice. Say what ` +
        `is different about the second piece: how tall it stands, or how thick it is. If what ` +
        `you actually want is to mark part of this wall, a damaged area already runs from here ` +
        `to there along it without splitting anything.`
    );
  }

  const walls = [...room.walls];
  walls.splice(index, 1, first, second);
  const next: Room = { ...room, walls };
  validate(next);
  return next;
}

/**
 * A wall comes out of the room, and the room closes back up around it.
 *
 * This is the edit that can quietly change a building, so it does not do it
 * quietly. Removing a wall leaves the walk short by exactly that wall's run,
 * and the room has to make it up somewhere — so the return is the same
 * `Verification` a tape produces, carrying every wall that moved and how far.
 * The screen shows those before anybody prices off the result.
 *
 * When there is nothing on that axis left to absorb it, `solve` refuses and
 * says which walls were held and why. That is the right answer rather than a
 * shape nobody asked for: in a plain rectangle, deleting one wall leaves three
 * sides and nothing that can close them, and the honest response is "this is
 * not a room any more".
 *
 * A wall with openings in it is refused. A door does not stop existing because
 * somebody deleted the wall it was in — either it moved to another wall or it
 * came out, and both of those are decisions.
 */
export function deleteWall(room: Room, wallId: string): Verification {
  const { wall, index } = find(room, wallId);
  if (room.walls.length <= 3) {
    throw new EditError(
      `"${room.name}" has ${room.walls.length} sides. Taking another out does not leave a room.`
    );
  }
  if ((wall.openings?.length ?? 0) > 0) {
    throw new EditError(
      `"${wallId}" has ${wall.openings!.map((o) => o.kind).join(' and ')} in it. Take ` +
        `${wall.openings!.length === 1 ? 'it' : 'them'} out first — a door does not stop ` +
        `existing because the wall it was in was deleted.`
    );
  }

  const walls = room.walls.filter((_, i) => i !== index);
  // Collinear neighbours become one wall, exactly as they do when an opening is
  // closed up. Two built walls on one axis are one wall written twice, and the
  // solver would move both to correct one error.
  const merged = mergeCollinear(walls);
  validate({ ...room, walls: merged });
  const solved = solve({ ...room, walls: merged });
  return { room: solved.room, adjustments: solved.adjustments };
}

/**
 * A corner becomes a step: the alcove the scanner flattened.
 *
 * **Two walls, never one, and that is geometry rather than taste.** A closed
 * rectilinear walk alternates axes, so it always has an even number of sides;
 * adding a single wall would leave five sides on a rectangle, which cannot
 * close, and the model would see the new wall in line with one of its
 * neighbours and rightly call it one wall written twice. What people mean by
 * "add a wall" here is a notch — out and back — and that is what this does.
 *
 * Given a wall running east into one running north, notching by `out` and
 * `along` replaces the corner between them with a step:
 *
 *     before                 after
 *     ────────────┐          ─────────┐
 *                 │                   └──┐  <- out, along
 *                 │                      │
 *
 * The incoming wall gives up `along` and the outgoing one gives up `out`, so
 * the room's overall extent does not move at all — the walk is exactly as long
 * on each axis as it was. Nothing else in the room has to give way, and the
 * returned adjustments are the solver's, which for a well-formed notch is
 * nothing.
 *
 * The two new lengths are `verified`, like any wall a person puts in: somebody
 * saying an alcove is two feet deep is stating a fact about the building, not
 * nudging a line. The two walls that gave up length keep their own provenance
 * with the new value — they are the same walls, shortened, and a shortened
 * scan is still a scan.
 *
 * A wall somebody put a tape on will not give up length to a notch. Shortening
 * a measured wall by a side effect is how a tape reading quietly stops being
 * true.
 */
export function notchCorner(
  room: Room,
  wallId: string,
  notch: {
    /** How far the step goes out, taken off the wall after this one. */
    readonly out: Nanometres;
    /** How far along the step runs, taken off this wall. */
    readonly along: Nanometres;
    readonly outId: string;
    readonly alongId: string;
  },
  by: string,
  at: string,
  method: VerificationMethod = 'tape'
): Verification {
  const { wall, index } = find(room, wallId);
  const next = room.walls[(index + 1) % room.walls.length]!;

  if (isDiagonal(wall.heading) || isDiagonal(next.heading)) {
    throw new EditError(
      `"${wallId}" or the wall after it runs at an angle. Notching a corner between two square ` +
        `walls is exact arithmetic; between angled ones it is a decision about where the corner ` +
        `actually is.`
    );
  }
  if (wall.open || next.open) {
    throw new EditError(
      `There is no wall on one side of that corner, so there is no corner to notch. Make it a ` +
        `wall first.`
    );
  }
  for (const [id, name] of [[notch.outId, 'first'], [notch.alongId, 'second']] as const) {
    if (id.trim() === '') throw new EditError(`The ${name} new wall needs a name.`);
    if (room.walls.some((w) => w.id === id.trim())) {
      throw new EditError(`"${room.name}" already has a wall called "${id.trim()}".`);
    }
  }
  if (notch.outId.trim() === notch.alongId.trim()) {
    throw new EditError('The two new walls need different names.');
  }

  const along = notch.along;
  const out = notch.out;
  if (along <= 0n || out <= 0n) {
    throw new EditError('A notch with no depth or no width is not a notch.');
  }
  const wallRun = runLength(wall);
  const nextRun = runLength(next);
  if (along >= wallRun) {
    throw new EditError(
      `"${wallId}" is ${formatFeetInches(wallRun)} long, so a notch cannot take ` +
        `${formatFeetInches(along)} off it — there would be no wall left before the step.`
    );
  }
  if (out >= nextRun) {
    throw new EditError(
      `"${next.id}" is ${formatFeetInches(nextRun)} long, so a notch cannot take ` +
        `${formatFeetInches(out)} off it — there would be no wall left after the step.`
    );
  }
  for (const [w, taken] of [
    [wall, along],
    [next, out],
  ] as const) {
    if (isVerified(w.length)) {
      throw new EditError(
        `"${w.id}" has had a tape on it, and notching would quietly take ` +
          `${formatFeetInches(taken)} off it. A measurement that changed as a side effect of a ` +
          `different edit is a measurement nobody can rely on. Take the tape reading off it first ` +
          `if the wall really is shorter than it was measured.`
      );
    }
  }
  const inTheWay = (wall.openings ?? []).filter(
    (o) => o.offsetFromStart.value + o.width.value > wallRun - along
  );
  if (inTheWay.length > 0) {
    throw new EditError(
      `The step would start ${formatFeetInches(wallRun - along)} along "${wallId}", which is ` +
        `inside ${inTheWay.map((o) => `the ${o.kind} "${o.id}"`).join(' and ')}. Move the step, ` +
        `or take it out first.`
    );
  }

  const shorter = (w: Wall, value: Nanometres): Wall => ({
    ...w,
    length: { ...w.length, value },
  });

  const outWall: Wall = {
    id: notch.outId.trim(),
    heading: next.heading,
    length: verified(out, by, at, method),
  };
  const alongWall: Wall = {
    id: notch.alongId.trim(),
    heading: wall.heading,
    length: verified(along, by, at, method),
  };

  const walls = [...room.walls];
  walls[index] = shorter(wall, wallRun - along);
  const after = (index + 1) % room.walls.length;
  walls[after] = shorter(next, nextRun - out);
  walls.splice(index + 1, 0, outWall, alongWall);

  const solved = solve({ ...room, walls });
  return { room: solved.room, adjustments: solved.adjustments };
}
