import { type Nanometres, hypotenuse } from './length.ts';
import { type Point, type Room, RoomError, corners, validate } from './room.ts';
// A wall is called `wall-5` in the model and "Wall 5" out loud, and a delete
// that names the walls it is about to blind has to name them the way the
// drawing does. `nameOf` is the one place that translation lives, and a second
// copy of the rule here is a second chance for a screen to say a different
// thing about the same wall.
import { nameOf } from './wallLabel.ts';

/**
 * A photo that knows where it was taken from, and therefore which walls it shows.
 *
 * During a capture every ARFrame carries the camera's transform and intrinsics,
 * and `arFrameReferenceOriginTransform` puts them in the same coordinate space as
 * the finished room. So a photo stops being "a photo of the kitchen" and becomes
 * "taken from here, looking that way, at these walls".
 *
 * What that turns on:
 *   - tap a wall, get every photo that shows it, best first
 *   - a disputed dimension has the frame it was read from attached to it
 *   - a wall marked low confidence because furniture was in the way can prove it
 *
 * The direction vectors arrive as floats from ARKit and are quantised to integers
 * once, on the device, at the same boundary where metres become nanometres. Past
 * that everything here is exact integer arithmetic: every test below is a cross
 * product, so no trigonometry and no floating point enters the room model.
 *
 * This module answers "what is in frame". It deliberately does not answer "what
 * is hidden behind something else" — occlusion is its own problem with its own
 * function, not a missing half of this one.
 */

export interface Vec2 {
  readonly x: bigint;
  readonly y: bigint;
}

export interface CameraPose {
  /** Where the camera stood, in the room's own plan coordinates. */
  readonly at: Point;
  /** Direction of view. Need not be unit length; only its direction is used. */
  readonly forward: Vec2;
  /** The two edges of the horizontal field of view, left and right of forward. */
  readonly leftEdge: Vec2;
  readonly rightEdge: Vec2;
}

export interface Photo {
  readonly id: string;
  readonly takenAt: string;
  readonly pose: CameraPose;
  /** How it was triggered — the app captures on a new viewpoint, and on a tap. */
  readonly trigger: 'automatic' | 'manual';
  /**
   * What the file is called in the capture's own folder.
   *
   * Carried so a screen can actually show the picture. This module has been able
   * to say which walls a photo shows since it was written, and nothing could put
   * one in front of a person, because the model knew where a photo was taken
   * from and not where it *is*. The image itself never enters the model — only
   * its name, so whoever is holding the folder can find it.
   */
  readonly fileName?: string;
  /**
   * How far to turn the picture, clockwise, to put the world the right way up.
   *
   * **ARKit hands back every frame in the device's landscape frame, whatever
   * way the phone was actually being held.** So a walk done in portrait — which
   * is every walk anybody does — produces a folder of pictures lying on their
   * side, and a contractor looking at his own garage sees it sideways.
   *
   * It is not guessed and it is not read off an EXIF tag that is not there. The
   * camera's own X axis is in the pose: measured across all 55 photographs of
   * Sam's garage, it points at the floor with a median dot product of -0.978
   * against world up, which is a phone held upright. That is the number this is
   * derived from, per photograph, so a phone turned sideways halfway through a
   * walk comes out right too.
   *
   * A display quantity, never a measurement — the same boundary rule `render.ts`
   * keeps. Nothing on the plan depends on it.
   */
  readonly upright?: 0 | 90 | 180 | 270;
}

export class PhotoError extends RoomError {}

/* --------------------------------------------------------------- exact math */

function cross(a: Vec2, b: Vec2): bigint {
  return a.x * b.y - a.y * b.x;
}

function minus(p: Point, q: Point): Vec2 {
  return { x: p.x - q.x, y: p.y - q.y };
}

/**
 * Inside the wedge means left of the right edge and right of the left edge.
 * Boundaries count as inside — a wall exactly on the edge of frame is in the frame.
 */
function insideWedge(pose: CameraPose, p: Point): boolean {
  const v = minus(p, pose.at);
  return cross(pose.rightEdge, v) >= 0n && cross(pose.leftEdge, v) <= 0n;
}

/**
 * Where a segment crosses a ray from the camera, as an exact fraction along the
 * segment. Returns null when they do not cross within the segment.
 *
 * Kept as a numerator and denominator rather than a number, so the caller can
 * decide where to round rather than having it rounded here.
 */
function crossingFraction(
  from: Point,
  to: Point,
  origin: Point,
  direction: Vec2
): { numerator: bigint; denominator: bigint } | null {
  const seg = minus(to, from);
  const denominator = cross(direction, seg);
  if (denominator === 0n) return null; // parallel
  const numerator = cross(direction, minus(origin, from));
  // The crossing must land within the segment, and ahead of the camera.
  const t = { numerator, denominator };
  const inRange =
    denominator > 0n
      ? numerator >= 0n && numerator <= denominator
      : numerator <= 0n && numerator >= denominator;
  if (!inRange) return null;
  // How far along the ray the crossing sits: s = cross(seg, d) / denominator.
  // It has to be non-negative, so the two must share a sign — a crossing behind
  // the camera is a wall it is facing away from, not one it can see.
  const along = cross(seg, minus(origin, from));
  const ahead = denominator > 0n ? along >= 0n : along <= 0n;
  return ahead ? t : null;
}

/** Rounds a point a fraction of the way along a segment, to the nearest nanometre. */
function along(from: Point, to: Point, f: { numerator: bigint; denominator: bigint }): Point {
  const seg = minus(to, from);
  const half = f.denominator / 2n;
  const sign = f.denominator < 0n ? -1n : 1n;
  return {
    x: from.x + (seg.x * f.numerator + half * sign) / f.denominator,
    y: from.y + (seg.y * f.numerator + half * sign) / f.denominator,
  };
}

/**
 * How much of a wall a clipped span covers.
 *
 * Square segments are exact subtraction. One that runs at an angle takes the
 * integer square root, the same rounding the wall it lies on already carries.
 * This used to refuse angled walls outright, and 292 real camera poses walked
 * into a kitchen with a 203 mm chamfer in it and found out.
 */
function segmentLength(a: Point, b: Point): Nanometres {
  const dx = a.x > b.x ? a.x - b.x : b.x - a.x;
  const dy = a.y > b.y ? a.y - b.y : b.y - a.y;
  if (dx === 0n || dy === 0n) return dx + dy;
  return hypotenuse(dx, dy);
}

/* ------------------------------------------------------------------ in frame */

export interface WallInFrame {
  readonly wallId: string;
  /** The stretch of that wall which is actually inside the frame. */
  readonly from: Point;
  readonly to: Point;
  /** How much of the wall is in shot. Used to rank photos, never as a dimension. */
  readonly visibleLength: Nanometres;
  /** How much of the whole wall that is, in thousandths, so 1000 means all of it. */
  readonly fractionPerMille: bigint;
}

/**
 * Which walls this photo has in frame, and how much of each.
 *
 * The clipped span is a ranking quantity — it decides which photo to show first
 * for a given wall — and is explicitly not a measurement. Nothing here ever
 * becomes a dimension on a plan.
 */
export function wallsInFrame(photo: Photo, room: Room): WallInFrame[] {
  validate(room);
  if (cross(photo.pose.rightEdge, photo.pose.leftEdge) <= 0n) {
    throw new PhotoError(
      `Photo "${photo.id}" has a field of view that is not a wedge opening to the left of its ` +
        `right edge. The frustum edges are the wrong way round, or it spans half a turn or more.`
    );
  }

  const points = corners(room);
  const found: WallInFrame[] = [];

  room.walls.forEach((wall, i) => {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;

    const aIn = insideWedge(photo.pose, a);
    const bIn = insideWedge(photo.pose, b);

    let from = a;
    let to = b;

    if (!aIn || !bIn) {
      // Clip against whichever frustum edges the wall crosses.
      //
      // A point produced by clipping against one edge lies *on* that edge, so
      // checking it against that same edge asks whether a rounded number is
      // exactly zero — and it is not. The crossing is rounded to the nearest
      // nanometre, which lands it a fraction of a nanometre to one side, and
      // that fraction used to throw the whole wall away. Found by pointing a
      // camera at a wall it plainly could see and getting nothing back. Each hit
      // is therefore tested against the *other* edge only.
      const clipped = (edge: Vec2, keep: (v: Vec2) => boolean): Point | null => {
        const f = crossingFraction(a, b, photo.pose.at, edge);
        if (f === null) return null;
        const p = along(a, b, f);
        return keep(minus(p, photo.pose.at)) ? p : null;
      };
      const hits = [
        clipped(photo.pose.leftEdge, (v) => cross(photo.pose.rightEdge, v) >= 0n),
        clipped(photo.pose.rightEdge, (v) => cross(photo.pose.leftEdge, v) <= 0n),
      ]
        .filter((p): p is Point => p !== null)
        // In the order they appear walking the wall, so `from` and `to` mean
        // what they say and the length is measured across the right stretch.
        .sort((p, q) => {
          const along = (r: Point) => (r.x - a.x) * (b.x - a.x) + (r.y - a.y) * (b.y - a.y);
          const dp = along(p);
          const dq = along(q);
          return dp === dq ? 0 : dp < dq ? -1 : 1;
        });

      if (aIn && hits[0]) { from = a; to = hits[0]; }
      else if (bIn && hits[0]) { from = hits[0]; to = b; }
      else if (hits.length >= 2) { from = hits[0]!; to = hits[1]!; }
      else return; // nothing of this wall is in frame
    }

    const visible = segmentLength(from, to);
    if (visible === 0n) return;
    const whole = wall.length.value;
    found.push({
      wallId: wall.id,
      from,
      to,
      visibleLength: visible,
      fractionPerMille: whole === 0n ? 0n : (visible * 1000n) / whole,
    });
  });

  return found;
}

/** Does this photo show any part of that wall? */
export function shows(photo: Photo, room: Room, wallId: string): boolean {
  return wallsInFrame(photo, room).some((w) => w.wallId === wallId);
}

/**
 * The photos of a given wall, the one showing most of it first. This is what
 * comes up when somebody taps a wall on the plan and asks what it looked like.
 */
export function photosOfWall(
  photos: readonly Photo[],
  room: Room,
  wallId: string
): { photo: Photo; inFrame: WallInFrame }[] {
  return photos
    .flatMap((photo) => {
      const inFrame = wallsInFrame(photo, room).find((w) => w.wallId === wallId);
      return inFrame ? [{ photo, inFrame }] : [];
    })
    .sort((p, q) =>
      p.inFrame.visibleLength === q.inFrame.visibleLength
        ? p.photo.id.localeCompare(q.photo.id)
        : p.inFrame.visibleLength > q.inFrame.visibleLength
          ? -1
          : 1
    );
}

/**
 * Walls no photo shows any part of.
 *
 * A wall nobody photographed is the wall that gets argued about, so this is a
 * finishing check on a capture rather than a report: it is what the app uses to
 * say "go back and shoot the north wall" before somebody leaves the site.
 */
export function unphotographedWalls(photos: readonly Photo[], room: Room): string[] {
  validate(room);
  const seen = new Set<string>();
  for (const photo of photos) {
    for (const w of wallsInFrame(photo, room)) seen.add(w.wallId);
  }
  return room.walls.map((w) => w.id).filter((id) => !seen.has(id));
}

/* ------------------------------------------- taking photographs off a mark */

/**
 * What a batch delete is about to do, said in words before it happens.
 *
 * ## The 53 photographs
 *
 * Sam lost a room with 53 photographs in it. Not to a bug in the delete — to a
 * delete that never said what it was about to take. A rename had not reached the
 * room screen, so the thing on screen was not the thing that went, and there was
 * no way to tell one file from another before it was too late. Nothing has ever
 * brought those photographs back, and nothing ever will: a water line that has
 * been cut out and boarded over cannot be re-photographed by anybody.
 *
 * A batch delete is the most destructive control in this product. So the
 * sentence in front of it is not decoration and it is not a screen's private
 * business — it is worked out here, from the lists themselves, and it is tested.
 * The count comes from the set that is actually going, never from what happens
 * to be highlighted, because a count a person has to work out by looking at
 * highlighting is the 53-photograph failure all over again.
 *
 * ## It never reassures
 *
 * Everything below is a fact about the lists it was handed. A caller that does
 * not know whether these photographs are on a claim passes nothing, and gets the
 * sentence that is true either way rather than a comfortable one. The rule is
 * that a use may be **understated** — a screen cannot always know — and must
 * never be invented, and that nothing is ever called undoable that is not.
 *
 * The photographs here are damage photographs, which are known by name: the
 * model carries a file name and never the bytes. See `web/src/photoStore.ts`.
 */

export interface DeletionRequest {
  /** Every photograph on the mark, in the order the strip shows them. */
  readonly onMark: readonly string[];
  /** The ones somebody has actually ticked. */
  readonly picked: readonly string[];
  /**
   * Of the mark's photographs, the ones a claim document is showing.
   *
   * Empty when the caller does not know, which is not the same as knowing there
   * are none — hence the wording it produces, which names the consequence
   * without claiming a number nobody established.
   */
  readonly onClaim?: readonly string[];
  /** Of the mark's photographs, the ones whose bytes this device is holding. */
  readonly held: readonly string[];
  /** Whether an app is here that filed a copy of each one with the scan. */
  readonly filedWithScan: boolean;
  /**
   * The dates on which a document carrying these photographs left this phone,
   * newest first, from the hand-over record in `sent.ts`.
   *
   * Empty means the record says nothing went out — which is not the same as
   * knowing nothing did, because the record lives on this device. The sentence
   * this produces is worded for that: it names what the record shows and never
   * says "nothing has been sent".
   */
  readonly wentOutOn?: readonly string[];
}

export interface Deletion {
  /** Exactly what goes, in the strip's own order. */
  readonly going: readonly string[];
  /** Exactly what is left, in the strip's own order. */
  readonly staying: readonly string[];
  /** "Delete 14 photographs." — the count, in words, before anything goes. */
  readonly headline: string;
  /** Every true sentence about what these photographs are doing. */
  readonly inUse: readonly string[];
  /** What can be taken back, and what cannot. Never implies a net that is not there. */
  readonly finality: string;
}

/** How many photographs, written the way somebody says it out loud. */
function photographs(n: number): string {
  return n === 1 ? '1 photograph' : `${n} photographs`;
}

/**
 * Works out the delete, or refuses it.
 *
 * Three refusals, and every one of them is the 53 photographs in a different
 * costume: a delete aimed at a photograph the mark does not have is aimed at
 * something else; a photograph ticked twice makes "delete 14" take 13; and a
 * delete of nothing is a button that did something the person cannot see.
 */
export function plannedDeletion(request: DeletionRequest): Deletion {
  const onMark = request.onMark;
  const wanted = new Set(request.picked);

  if (wanted.size !== request.picked.length) {
    throw new PhotoError(
      'The same photograph is ticked twice. That would delete fewer than it says it will, ' +
        'and the number in front of somebody is the whole point of this.'
    );
  }
  if (wanted.size === 0) {
    throw new PhotoError('Nothing is picked, so there is nothing to delete.');
  }
  const strays = request.picked.filter((name) => !onMark.includes(name));
  if (strays.length > 0) {
    throw new PhotoError(
      `${strays.join(', ')} ${strays.length === 1 ? 'is' : 'are'} not on this mark, so this ` +
        'delete is pointed at something other than what is on the screen. Nothing has been ' +
        'taken off.'
    );
  }

  // Both lists in the strip's order rather than the order somebody tapped
  // things. What the sentence says and what the record shows have to be the
  // same list read the same way round.
  const going = onMark.filter((name) => wanted.has(name));
  const staying = onMark.filter((name) => !wanted.has(name));

  const held = new Set(request.held);
  const claimed = (request.onClaim ?? []).filter((name) => wanted.has(name));
  const onlyHere = going.filter((name) => held.has(name));
  const notHere = going.filter((name) => !held.has(name));

  const inUse: string[] = [];

  if (claimed.length > 0) {
    inUse.push(
      `${claimed.length} of these ${claimed.length === 1 ? 'is' : 'are'} on the claim. ` +
        `${claimed.length === 1 ? 'It comes' : 'They come'} off the claim document with them.`
    );
  }

  if (staying.length === 0) {
    inUse.push(
      'That is every photograph on this mark. The mark stays on the job and there will be ' +
        'nothing on it to look at.'
    );
  } else {
    inUse.push(
      `${photographs(staying.length)} ${staying.length === 1 ? 'stays' : 'stay'} on this mark.`
    );
  }

  // Where the bytes are is the only thing that differs photograph by
  // photograph, and it is the part that decides whether "deleted" means gone.
  if (request.filedWithScan) {
    inUse.push(
      "The app filed a copy of each one with the scan. That copy stays in the scan's folder — " +
        'but nothing on this mark will point at it any more.'
    );
  } else if (onlyHere.length > 0) {
    inUse.push(
      `${onlyHere.length === 1 ? 'One of them is' : `${onlyHere.length} of them are`} on this ` +
        'browser only. Nothing else has a copy.'
    );
  }
  if (!request.filedWithScan && notHere.length > 0) {
    inUse.push(
      `${photographs(notHere.length)} ${notHere.length === 1 ? 'is' : 'are'} not on this device ` +
        "at all — in the scan's folder on the phone that took them, which this cannot reach."
    );
  }

  // The honest answer to "is it already out there". Until there was a record of
  // documents leaving this phone, this could only ever be a generality. Now it
  // can name the day -- and where the record is silent it still must not say
  // "nothing went out", because the record is on this device and a device can
  // lose it.
  const wentOut = request.wentOutOn ?? [];
  inUse.push(
    wentOut.length === 0
      ? 'If a claim document or an archive has already gone out, it keeps the photographs ' +
          'that went with it. Nothing this app makes from now on will have them.'
      : `A claim document or an archive left this phone ${
          wentOut.length === 1 ? `on ${wentOut[0]}` : `${wentOut.length} times, last on ${wentOut[0]}`
        }. That copy keeps the photographs that were in it, and nothing this app makes from ` +
        'now on will have them.'
  );

  return {
    going,
    staying,
    headline: `Delete ${photographs(going.length)}.`,
    inUse,
    finality:
      'You can put them back until you leave this screen. After that the pictures this browser ' +
      'is holding are dropped for good.',
  };
}

/* ------------------------------- taking photographs out of the scan itself */

/**
 * Which photographs are the only one showing a wall, and which wall that is.
 *
 * ## Why this is a question at all
 *
 * A walk takes about fifty frames and most of them overlap, so it is easy to
 * look at a strip of near-identical pictures and believe any one of them is
 * spare. Some of them are not. `photosOfWall` matches poses to walls, and in a
 * room shot from a doorway there are walls exactly one frame ever saw — the
 * short return by the hallway, the piece of wall behind the door. Deleting that
 * frame is the difference between a wall somebody can show an adjuster and a
 * wall that is a number on a drawing with nothing behind it, which is what
 * `unphotographedWalls` above already calls the wall that gets argued about.
 *
 * So it is worked out here, from the poses, and handed to the screen. A screen
 * deciding for itself which pictures look spare is the 53 photographs again.
 *
 * Keyed by photograph id, and a photograph only appears when it is somebody's
 * last one: an id missing from the map is a frame no wall depends on.
 */
export function onlyPhotographOf(
  photos: readonly Photo[],
  room: Room
): ReadonlyMap<string, readonly string[]> {
  validate(room);

  const seenBy = new Map<string, string[]>();
  for (const photo of photos) {
    for (const inFrame of wallsInFrame(photo, room)) {
      const already = seenBy.get(inFrame.wallId);
      if (already) already.push(photo.id);
      else seenBy.set(inFrame.wallId, [photo.id]);
    }
  }

  const sole = new Map<string, string[]>();
  for (const [wallId, ids] of seenBy) {
    // Two frames of a wall means neither of them is the last one, however alike
    // they look. Only a wall with exactly one witness puts a photograph here.
    if (ids.length !== 1) continue;
    const only = ids[0]!;
    const walls = sole.get(only);
    if (walls) walls.push(wallId);
    else sole.set(only, [wallId]);
  }
  return sole;
}

/**
 * What deleting a set of the scan's own photographs is about to do.
 *
 * ## The same 53 photographs, one screen further along
 *
 * `plannedDeletion` above says this for the photographs somebody takes of a
 * damage. These are the other kind: the fifty-odd frames the walk itself takes,
 * which is the batch Sam was actually talking about and which had no delete
 * anywhere in the app at all. Everything the damage version learned applies
 * here unchanged — the count is said in words and never left to be worked out
 * off which thumbnails happen to be ringed, and what a photograph is doing is
 * named before it goes.
 *
 * What is different, and it is the whole reason this is its own function:
 *
 *   - These frames carry **camera poses**, so a photograph is not just a
 *     picture — it is the only thing that shows a particular wall. That is a
 *     fact about the room, it is computable, and it is stated.
 *   - **The record owns the truth and the file does not.** The pictures are
 *     served out of the scan's own folder by the app that wrote them, and this
 *     page has no way to delete a file there and never claims to. What goes is
 *     the corrected room's list of frames. Saying "deleted for good" would be a
 *     lie, and so would saying nothing at all — the photograph is off the job
 *     either way.
 */
export interface ScanDeletionRequest {
  /** Every photograph the scan is carrying, in the order the room holds them. */
  readonly inScan: readonly Photo[];
  /** The ones somebody has actually ticked, by photograph id. */
  readonly picked: readonly string[];
  /** The room they were taken in, so what each one is doing can be worked out. */
  readonly room: Room;
  /** Whether an app is here holding the scan's folder the pictures are served from. */
  readonly filedWithScan: boolean;
}

export interface ScanDeletion {
  /** Exactly what goes, in the scan's own order. */
  readonly going: readonly Photo[];
  /** Exactly what is left, in the scan's own order. */
  readonly staying: readonly Photo[];
  /** "Delete 14 photographs." — the count, in words, before anything goes. */
  readonly headline: string;
  /** Of the ones going, the ids that are the only photograph of some wall. */
  readonly soleWitnesses: readonly string[];
  /** Walls something shows now and nothing would show afterwards. */
  readonly wallsLeftBlind: readonly string[];
  /** Every true sentence about what these photographs are doing. */
  readonly inUse: readonly string[];
  /** What can be taken back, and what cannot. Never implies a net that is not there. */
  readonly finality: string;
}

/** "Wall 1, Wall 4 and Wall 9" — the way somebody reads a list out loud. */
function listOf(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`;
}

/**
 * Works out the delete, or refuses it.
 *
 * The three refusals are the ones `plannedDeletion` makes and for the same
 * reasons: a delete aimed at a frame this scan does not have is aimed at
 * something other than what is on the screen, a frame ticked twice makes
 * "delete 14" take 13, and a delete of nothing is a button that did something
 * invisible.
 */
export function plannedScanDeletion(request: ScanDeletionRequest): ScanDeletion {
  const inScan = request.inScan;
  const wanted = new Set(request.picked);

  if (wanted.size !== request.picked.length) {
    throw new PhotoError(
      'The same photograph is ticked twice. That would delete fewer than it says it will, ' +
        'and the number in front of somebody is the whole point of this.'
    );
  }
  if (wanted.size === 0) {
    throw new PhotoError('Nothing is picked, so there is nothing to delete.');
  }
  const here = new Set(inScan.map((photo) => photo.id));
  const strays = request.picked.filter((id) => !here.has(id));
  if (strays.length > 0) {
    throw new PhotoError(
      `${strays.join(', ')} ${strays.length === 1 ? 'is' : 'are'} not in this scan, so this ` +
        'delete is pointed at something other than what is on the screen. Nothing has been ' +
        'taken off.'
    );
  }

  // Both lists in the scan's order rather than the order somebody tapped
  // things. What the sentence says and what the record shows have to be the
  // same list read the same way round.
  const going = inScan.filter((photo) => wanted.has(photo.id));
  const staying = inScan.filter((photo) => !wanted.has(photo.id));

  // What each frame is doing, from the poses. `unphotographedWalls` is asked
  // twice rather than reasoned about: once as the room stands and once as it
  // would stand, and the difference is exactly the walls this delete blinds.
  // Walls nothing shows already are not this delete's doing and are not laid at
  // its door.
  const blindNow = new Set(unphotographedWalls(inScan, request.room));
  const wallsLeftBlind = unphotographedWalls(staying, request.room).filter(
    (wallId) => !blindNow.has(wallId)
  );
  const sole = onlyPhotographOf(inScan, request.room);
  const soleWitnesses = going.filter((photo) => sole.has(photo.id)).map((photo) => photo.id);

  const inUse: string[] = [];

  if (soleWitnesses.length > 0) {
    inUse.push(
      `${soleWitnesses.length} of these ${soleWitnesses.length === 1 ? 'is' : 'are'} the only ` +
        `photograph of a wall.`
    );
  }

  if (wallsLeftBlind.length > 0) {
    // Named, not counted. "3 walls lose their photograph" leaves somebody to
    // work out which three off the drawing, and working it out off the screen
    // is how 53 photographs went.
    const named = wallsLeftBlind.map(nameOf);
    const shown = named.length > 8 ? named.slice(0, 8) : named;
    const rest = named.length - shown.length;
    inUse.push(
      `Afterwards nothing shows ${listOf(shown)}${rest > 0 ? `, and ${rest} more` : ''}. ` +
        `${wallsLeftBlind.length === 1 ? 'That is the wall' : 'Those are the walls'} that ` +
        `${wallsLeftBlind.length === 1 ? 'gets' : 'get'} argued about later.`
    );
  }

  if (staying.length === 0) {
    inUse.push(
      'That is every photograph the walk took. The room and its measurements stay exactly as ' +
        'they are, and there will be nothing behind any of them to look at.'
    );
  } else {
    inUse.push(
      `${photographs(staying.length)} ${staying.length === 1 ? 'stays' : 'stay'} in this scan.`
    );
  }

  // Which side owns the truth, said plainly. The app serves these pictures
  // read-only out of the scan's own folder — see `WebBundle.swift` — and there
  // is no message on the bridge that deletes a file there. So the corrected
  // room's list of frames is the thing that goes, and claiming the picture was
  // wiped would be inventing a consequence.
  inUse.push(
    request.filedWithScan
      ? "The picture files stay in the scan's folder where the app put them. This takes the " +
        'photographs off the job — off the plan and off anything printed from it — rather than ' +
        'wiping anything off the phone.'
      : 'There is no app here holding the scan folder, so this takes the photographs off this ' +
        'room and nothing else. Whatever the scan was opened from still has the pictures.'
  );

  return {
    going,
    staying,
    headline: `Delete ${photographs(going.length)}.`,
    soleWitnesses,
    wallsLeftBlind,
    inUse,
    finality:
      'You can put them back until you leave this screen. After that this room is saved without ' +
      'them, and the saved room is what opens next time — so they do not come back on their own.',
  };
}
