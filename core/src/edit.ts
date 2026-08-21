import { type Nanometres, formatFeetInches } from './length.ts';
import { type Measurement, type VerificationMethod, verify } from './measurement.ts';
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

    out[out.length - 1] = {
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
