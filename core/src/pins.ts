import { type RoomFrame, CaptureError, planFromWorld } from './capture.ts';
import { type Damage, type DamageKind, type Pin } from './damage.ts';
import { type Nanometres } from './length.ts';
import { type Point, type Room, corners } from './room.ts';

/**
 * Damage marked while the room is still being walked.
 *
 * ## Why this exists at all
 *
 * A restoration contractor walks a flooded basement once. Everything he notices
 * on that walk — the stain behind the boiler, the swollen base at the bottom of
 * the stair, the black spotting inside the closet — he currently records by
 * taking a photograph and remembering. Back at the truck he has ninety
 * photographs and no idea which wall any of them was on, so the claim gets
 * written from memory and the things he forgot are the things he does not get
 * paid for.
 *
 * A pin dropped during the walk is the same gesture, kept. He points at the
 * stain, taps, says what it is, and it lands on the plan at the spot, on the
 * right wall, with the photograph attached — before he has left the room.
 *
 * ## The rule this obeys, which is the whole product
 *
 * **A pin produces no quantity, ever.** It is somebody saying *look at this*.
 * Turning a gesture into square feet would be inventing a measurement, and the
 * one thing this app exists to refuse is a number nobody stood behind. What a
 * pin gives the claim is a *place* and a *photograph* — evidence — and the
 * square feet still come from a person putting a tape on the wall afterwards,
 * or from a patch they draw deliberately.
 *
 * ## Why the geometry is here and not on the phone
 *
 * The phone knows where the tap landed in ARKit's world: metres from wherever
 * the scan began, in the scanner's own axes. The room is a chain of walls laid
 * out from (0, 0) in the datum frame the importer chose. Those are not the same
 * coordinate system and in Gilbert's kitchen they were eight feet apart.
 *
 * Photographs already cross that gap through `RoomFrame`, and a pin crosses it
 * the same way, through the same function, with the same datum. Anything else
 * would be a second derivation of one frame, which is two chances to disagree.
 */

/** What a pin manifest says it is. Refused if it says anything else. */
export const PIN_MANIFEST_SCHEMA = 'trueline.pins.v1';

/**
 * How the phone found the point under the finger.
 *
 * These are ARKit's own three answers, kept in its words rather than translated
 * into a scale this module invented, because they are not equally good and a
 * claim should be able to say which it had.
 *
 *   - `planeGeometry` — the ray hit a surface the phone has actually mapped.
 *     The point is on something real that was seen.
 *   - `planeInfinite` — it hit the *plane* of a mapped surface, out past the
 *     part that was seen. The plane is real; how far along it the point is, is
 *     an extrapolation. Kept, and recorded as what it is.
 *   - `estimated` — no surface at all, only a guess from feature points.
 *     Refused below rather than drawn somewhere plausible, because a pin whose
 *     distance is a guess is a pin at the wrong end of the room.
 */
export type HowFound = 'planeGeometry' | 'planeInfinite' | 'estimated';

/** One tap, as the phone wrote it down, in the scanner's own metres. */
export interface CapturedPin {
  readonly id: string;
  /** Where the tap landed in ARKit's world: x, y up, z. Metres. */
  readonly at: readonly [number, number, number];
  readonly droppedAt: string;
  readonly kind: DamageKind;
  /** What the person said it was. Never generated. */
  readonly note: string;
  /** The photograph taken at the moment of the tap, by id, when there is one. */
  readonly photoId?: string;
  readonly found: HowFound;
}

export interface PinManifest {
  readonly schema: string;
  readonly pins: readonly CapturedPin[];
}

/**
 * Where the floor is, and why it has to be carried rather than worked out.
 *
 * A pin's height above the floor is its ARKit y less the floor's ARKit y. The
 * room model has no idea what the second one is — a `Room` starts at zero
 * because a chain of headings and lengths has no opinion about altitude either.
 * The importer reads it off a wall, and it comes across in `RoomFrame.floor`.
 */

/* --------------------------------------------------------------- the maths */

/** Metres to nanometres, refusing anything that is not a number. */
function nm(metres: number): Nanometres {
  if (!Number.isFinite(metres)) {
    throw new CaptureError(`A pin holds ${metres} where a position should be.`);
  }
  return BigInt(Math.round(metres * 1e9));
}

/**
 * How far a point is from a wall, as an exact fraction rather than a distance.
 *
 * Returned as `over / under` — a squared distance that has not been divided —
 * because comparing two of them across walls of different lengths needs
 * `a.over * b.under < b.over * a.under` and nothing else. One integer
 * multiplication instead of a square root and a rounding, and the answer is the
 * true one rather than a near one.
 */
function distanceFrom(point: Point, from: Point, to: Point): { over: bigint; under: bigint } {
  const run = { x: to.x - from.x, y: to.y - from.y };
  const span = run.x * run.x + run.y * run.y;
  if (span === 0n) {
    const dx = point.x - from.x;
    const dy = point.y - from.y;
    return { over: dx * dx + dy * dy, under: 1n };
  }
  const along = (point.x - from.x) * run.x + (point.y - from.y) * run.y;
  if (along <= 0n) {
    const dx = point.x - from.x;
    const dy = point.y - from.y;
    return { over: dx * dx + dy * dy, under: 1n };
  }
  if (along >= span) {
    const dx = point.x - to.x;
    const dy = point.y - to.y;
    return { over: dx * dx + dy * dy, under: 1n };
  }
  // Beside the wall rather than past either end, so it is the perpendicular
  // distance, whose square is cross² / span.
  const cross = (point.x - from.x) * run.y - (point.y - from.y) * run.x;
  return { over: cross * cross, under: span };
}

/** `a < b`, for two of the fractions above. */
function nearer(a: { over: bigint; under: bigint }, b: { over: bigint; under: bigint }): boolean {
  return a.over * b.under < b.over * a.under;
}

/**
 * How close a pin has to be to a wall to be called that wall's.
 *
 * A foot. Chosen for what it is: further than a person's aim through a phone
 * screen is wrong by, and closer than the narrowest thing anybody would call a
 * separate wall. A pin further out than this gets no wall rather than the
 * nearest one, because a claim that puts damage on the wrong wall is worse than
 * a claim that says which corner of the room it was in.
 */
export const REACHES: Nanometres = 304_800_000n;

/* ---------------------------------------------------------------- the work */

/**
 * Turns one tap into a damage the room model can draw and the claim can carry.
 *
 * Refuses rather than guesses in three cases, each of which is a pin that would
 * otherwise be drawn somewhere it is not:
 *
 *   - ARKit only estimated the point, so there is no surface under it;
 *   - it is below the floor, which means the two coordinate frames disagree and
 *     nothing about the pin can be trusted;
 *   - the person typed nothing, so there is no evidence, only a dot.
 */
export function toDamage(captured: CapturedPin, frame: RoomFrame, room: Room): Damage {
  if (captured.found === 'estimated') {
    throw new CaptureError(
      `The pin "${captured.id}" was dropped where the phone could not find a surface, so there ` +
        'is no telling how far away it is. Point at the wall and mark it again.'
    );
  }
  const note = captured.note.trim();
  if (note === '') {
    throw new CaptureError(
      `The pin "${captured.id}" says nothing about what is wrong, and a pin with no words is a ` +
        'dot on a drawing rather than evidence.'
    );
  }

  const [worldX, worldY, worldZ] = captured.at;
  const [planX, planY] = planFromWorld(worldX, worldZ, frame.datum);
  const at: Point = { x: nm(planX) - frame.origin.x, y: nm(planY) - frame.origin.y };
  const height = nm(worldY) - frame.floor;

  if (height < 0n) {
    throw new CaptureError(
      `The pin "${captured.id}" lands below the floor of "${room.name}", which means the scan ` +
        'and the room are not in the same coordinate system. Nothing placed from it would be ' +
        'where it says it is.'
    );
  }

  const shape: Pin = { kind: 'pin', at, height, ...(wallNear(at, room) ?? {}) };
  return {
    id: captured.id,
    kind: captured.kind,
    shape,
    note,
    recordedAt: captured.droppedAt,
    recordedBy: 'me',
    photos: captured.photoId ? [captured.photoId] : [],
    readings: [],
  };
}

/**
 * The wall a pin belongs to, or nothing.
 *
 * Nothing is a real answer here and is returned often: a pin on a boiler in the
 * middle of a basement is not on any wall, and saying it is on the nearest one
 * would put it on a drawing eight feet from where the person was standing.
 */
export function wallNear(at: Point, room: Room): { wallId: string } | undefined {
  const outline = corners(room);
  let best: { wallId: string; distance: { over: bigint; under: bigint } } | undefined;
  for (const [index, wall] of room.walls.entries()) {
    const from = outline[index];
    const to = outline[(index + 1) % outline.length];
    if (!from || !to) continue;
    const distance = distanceFrom(at, from, to);
    if (!best || nearer(distance, best.distance)) best = { wallId: wall.id, distance };
  }
  if (!best) return undefined;
  // `over / under <= REACHES²` without dividing.
  const reach = REACHES * REACHES;
  return best.distance.over <= reach * best.distance.under ? { wallId: best.wallId } : undefined;
}

export interface PinImport {
  readonly pins: readonly Damage[];
  /** Taps that could not be placed, and why. Never silently dropped. */
  readonly refused: readonly { readonly id: string; readonly reason: string }[];
}

/**
 * Reads a whole manifest.
 *
 * One unusable pin does not lose the rest, and nothing is dropped quietly. A
 * refusal here is somebody's evidence not making it onto the claim, which is
 * the most expensive kind of silence this app could keep — so every one comes
 * back with its reason for the screen that shows what the import decided.
 */
export function importPins(manifest: PinManifest, frame: RoomFrame, room: Room): PinImport {
  if (manifest.schema !== PIN_MANIFEST_SCHEMA) {
    throw new CaptureError(
      `That pin manifest says it is "${manifest.schema}"; this reads "${PIN_MANIFEST_SCHEMA}". ` +
        'Rather than guess at what changed, it is being refused.'
    );
  }
  const pins: Damage[] = [];
  const refused: { id: string; reason: string }[] = [];
  for (const captured of manifest.pins) {
    try {
      pins.push(toDamage(captured, frame, room));
    } catch (error) {
      refused.push({
        id: captured.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { pins, refused };
}

/**
 * What to say on screen about a set of pins that has just come in.
 *
 * Plain, and it says the refusals out loud. A contractor who marked six things
 * and sees four needs to be told, in the room, while he can still mark the
 * other two.
 */
export function describePins(result: PinImport): string {
  const placed = result.pins.length;
  const lost = result.refused.length;
  if (placed === 0 && lost === 0) return 'Nothing was marked during the walk.';
  const put = placed === 1 ? '1 thing marked on the walk is on the plan'
    : `${placed} things marked on the walk are on the plan`;
  if (lost === 0) return `${put}.`;
  return `${put}, and ${lost === 1 ? 'one is not' : `${lost} are not`}: ` +
    result.refused.map((r) => r.reason).join(' ');
}
