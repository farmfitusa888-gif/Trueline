import { type Nanometres, NM_PER_FOOT, abs, add, formatFeetInches } from './length.ts';
import {
  type Point,
  type Room,
  type Wall,
  RoomError,
  corners,
  runLength,
  validate,
} from './room.ts';
import { roomQuantities } from './zone.ts';

/**
 * Where the damage is, and what it will take to put right.
 *
 * A restoration contractor walks a room twice: once to measure it and once to
 * record what is wrong with it. Every scanning app on the market does the first
 * and none of them does the second, so the damage ends up in a phone full of
 * photographs nobody can tie to a wall, and the tear-out gets estimated from
 * memory three days later.
 *
 * The whole point of doing it here is that **the room is already measured**. A
 * water line two feet up a nine foot wall is not a note, it is eighteen square
 * feet of board, nine feet of base, and a number an adjuster can check. Nothing
 * else in the field can produce that, because nothing else knows how long the
 * wall is at the moment somebody is standing in front of it.
 *
 * Three shapes, because damage is genuinely three different things:
 *
 *   - A **pin** is a point: a hole, a stain, a scorch mark. It carries a
 *     photograph and a note and it produces no quantity, and that is honest —
 *     it is a marker, and pretending it has an area would be inventing one.
 *   - A **patch** is a region of a wall with a height: the shape water actually
 *     makes. It produces the quantity the whole feature exists for.
 *   - A **surface** is all of something: a ceiling that came down, a floor that
 *     has to go. Quantities fall straight out of what the room already knows.
 *
 * **Nothing here decides what the scope is.** It says what is damaged and how
 * big it is; the contractor says what to do about it and what that costs. An app
 * that decided a wet wall needs its insulation replaced would be guessing at
 * somebody's building from a phone, and it would be wrong the first time the
 * wall turned out to be a partition.
 *
 * ## And the same three shapes on a job nobody is claiming for
 *
 * A remodeler finds a soft sill plate, a wall out of plumb, a chase he cannot
 * get at. That is the same act on the same measured wall, so it is the same
 * record — see `ConditionKind` for why one model carries both, and `losses` for
 * the one line that keeps a condition note off an insurer's estimate.
 *
 * ## The ceiling, and why a mark on it has no position
 *
 * A wall mark is placed by two lengths along the wall and one height off the
 * floor, and every one of those three is a number read straight off a tape
 * hooked in a corner somebody can put a thumb on. **A ceiling has no corner to
 * hook a tape in.** It has no *along*, because nothing on it runs in a
 * direction anybody has named, and no *height*, because all of it is at one
 * height already — which is the height the room is.
 *
 * Three ways of placing a ceiling mark were weighed, and two were turned down:
 *
 *   - **A point on the plan.** To put a stain at a point somebody has to give
 *     it two coordinates, from a corner of the room he is not standing near,
 *     at the top of a ladder with his head back. That is the defect the wall
 *     form was just rid of — `from` and `to` made him add a coordinate up in
 *     his head — and it is worse here: two coordinates instead of one, and
 *     neither with a corner to start from.
 *   - **An area in square feet, typed.** The shape `Part` takes in `work.ts`,
 *     and honest about whose figure it is. But a man who has just measured a
 *     stain is holding two tape readings and not a square footage, so typing
 *     one means multiplying four by three on a ladder — and that is a sum
 *     nothing afterwards can catch, because `12` is a perfectly good area and
 *     the mark simply comes out the wrong size.
 *   - **No position at all, and an extent instead.** Taken.
 *
 * So a ceiling mark says **how much of the ceiling** and never **where on it**.
 * There are two honest answers to how much, and a third that answers neither
 * and says so:
 *
 *   - all of it — the ceiling that came down, which `Surface` has carried since
 *     this module was written;
 *   - a patch of it — `Spread`, the two tape readings he actually took across
 *     the stain, multiplied here in exact nanometres rather than in his head;
 *   - a spot on it — a `Pin` with `on: 'ceiling'`, no point and no area, for
 *     the nail pop and the hole where the light fitting was.
 *
 * **Nothing is lost by dropping the position**, and that is the test the
 * decision had to pass. Position on a wall earns its keep twice over: the
 * elevation draws the patch where it is, and the plan draws the stretch of wall
 * that has to come out. A ceiling has no elevation, and `damageRunOnPlan` has
 * refused to draw a ceiling on the plan since the day it was written — the
 * ceiling *is* the room, and hatching the whole room red would hide the walls
 * the drawing exists to show. A coordinate nothing can draw is a number
 * somebody typed for nobody.
 *
 * **A patch is his tape and not the room's**, and it is held to the rule
 * `readPart` holds a typed figure to. The room goes on measuring the ceiling it
 * measures — `roomQuantities().ceilingArea`, which follows the floor — and a
 * patch is recorded beside that and never over it. It is refused when it is
 * bigger than the ceiling it claims to be part of, with both figures in the
 * sentence. It is never called measured. And its workings say in words that it
 * is the rectangle the damage fits inside, because water does not make
 * rectangles and the difference is not visible anywhere else: a wall patch is
 * drawn on an elevation where a person can see the bound for himself, and a
 * ceiling patch has nowhere to be drawn.
 */

export class DamageError extends RoomError {}

/** What happened. Plain words, because a homeowner reads the report too. */
export type DamageKind = 'water' | 'fire' | 'smoke' | 'mould' | 'impact' | 'wind' | 'other';

/**
 * What is wrong with a wall on a job nobody is claiming for.
 *
 * ## Why this is the same feature and not a second one
 *
 * A remodeler walks a room and finds a soft sill plate, a wall out of plumb at
 * the top, a chase he cannot get at. He wants to do exactly what a restoration
 * contractor does with a water line: say where it is along the wall, how high it
 * reaches, photograph it, and talk at it. That is the same act, on the same
 * measured wall, with the same three things to fill in.
 *
 * A second model for it would have meant a second screen to learn, a second
 * thing to save, a second thing to draw on the elevation, and two definitions of
 * "how far along the wall" that would eventually disagree. So there is one mark,
 * and the **job** decides where it lands:
 *
 *   - on a claim it is a damage line and prices as tear-out — `scope.ts`;
 *   - on an ordinary remodel it is a condition note, on the field sheet and
 *     nowhere else. It never reaches the takeoff, because nobody asked for it to
 *     be fixed. Somebody noticing rot is not somebody buying its removal.
 *
 * The vocabulary is what differs, and it has to. A cause-of-loss list is what an
 * adjuster reads and it is the wrong list for a remodel: forcing "the wall is
 * out of plumb at the top" into *other* throws away the one word that made the
 * note worth taking.
 *
 * Nothing here is a diagnosis. `asbestos suspect` says somebody wants it tested
 * before anybody cuts into it — not that it is asbestos, which is a laboratory's
 * answer and never an app's.
 */
export type ConditionKind =
  | 'rot'
  | 'cracked'
  | 'out of plumb'
  | 'out of level'
  | 'previous repair'
  | 'no access'
  | 'asbestos suspect'
  | 'note';

/**
 * What a mark can be, either way round.
 *
 * One union rather than a separate field naming which list a kind came from. The
 * kind already says: `isLoss` answers it from the word itself, so a mark cannot
 * be saved with a cause of loss and a flag beside it disagreeing about whether
 * it is one.
 */
export type MarkKind = DamageKind | ConditionKind;

/** The cause-of-loss words, in the order a claim screen offers them. */
export const LOSS_KINDS: readonly DamageKind[] = [
  'water',
  'fire',
  'smoke',
  'mould',
  'impact',
  'wind',
  'other',
];

/** And the condition words, for a job that is not a claim. */
export const CONDITION_KINDS: readonly ConditionKind[] = [
  'rot',
  'cracked',
  'out of plumb',
  'out of level',
  'previous repair',
  'no access',
  'asbestos suspect',
  'note',
];

/** Whether this word is a cause of loss rather than a condition. */
export function isLoss(kind: MarkKind): kind is DamageKind {
  return (LOSS_KINDS as readonly string[]).includes(kind);
}

/**
 * What to call one, on a screen or a sheet.
 *
 * "water damage" and "rot" — a loss takes the word *damage* after it because
 * that is what a claim calls it, and a condition does not, because "out of plumb
 * damage" is not something anybody says.
 */
export function markWord(kind: MarkKind): string {
  return isLoss(kind) ? `${kind} damage` : kind;
}

/**
 * How dirty the water was, on the scale the industry uses.
 *
 * IICRC categories, kept as a number and shown beside the plain words rather
 * than instead of them: an adjuster wants "Category 2", a homeowner wants "grey
 * water", and the report can say both without either of them having to
 * translate. Only ever set on water damage — it means nothing about a fire.
 */
export type WaterCategory = 1 | 2 | 3;

export const WATER_CATEGORY: Record<WaterCategory, { plain: string; long: string }> = {
  1: { plain: 'clean water', long: 'Category 1 — from a sanitary source' },
  2: { plain: 'grey water', long: 'Category 2 — significantly contaminated' },
  3: { plain: 'black water', long: 'Category 3 — grossly contaminated' },
};

/* ------------------------------------------------------------------ shapes */

/**
 * A point, in the room, with a photograph and a note.
 *
 * `wallId` when it is on a wall — which is most of the time, and is what lets
 * the report say which wall. A pin in the middle of the floor has none.
 *
 * It produces no quantity and it is not supposed to. A pin is somebody saying
 * *"look at this"*, and turning that into square feet would be inventing a
 * measurement out of a gesture.
 */
export interface Pin {
  readonly kind: 'pin';
  /**
   * Where in the room it is.
   *
   * Absent on the ceiling, and only there. A point on a wall or on the floor
   * comes off a tap on a drawing somebody is looking down at, so it has a place
   * and the place is real. A point on a ceiling has neither: nothing on the
   * plan is the ceiling, and there is no corner to measure a coordinate from.
   * So it is left out rather than filled in with the room's origin — which is a
   * real corner of a real room, and a marker drawn there would put somebody's
   * mark in a place he never pointed at.
   */
  readonly at?: Point;
  /** How far off the floor, when it is known. */
  readonly height?: Nanometres;
  readonly wallId?: string;
  /**
   * The ceiling, when the spot is on the ceiling.
   *
   * Only ever the ceiling, because it is the only surface of a room that has no
   * other way of being named. A wall says which wall. The floor is the thing
   * the plan draws, so a spot on it is a point like any other. The ceiling is
   * the one with nothing to point at, so it is the one that has to say its own
   * name.
   */
  readonly on?: 'ceiling';
}

/**
 * A region of one wall: from here to there along it, from this height to that.
 *
 * The shape water makes, and the reason this whole module is worth building. A
 * water line has a height and a width, and both of them are already known to the
 * nanometre because the room has been measured.
 */
export interface Patch {
  readonly kind: 'patch';
  readonly wallId: string;
  /** Measured from the wall's first corner, walking the room in order. */
  readonly fromAlong: Nanometres;
  readonly toAlong: Nanometres;
  /** Above the finished floor. Water starts at zero; a roof leak does not. */
  readonly fromHeight: Nanometres;
  readonly toHeight: Nanometres;
}

/**
 * How big a patch of the ceiling is, from the two tape readings across it.
 *
 * Neither of them is *along* anything. A ceiling has no corner to measure from
 * and no direction anybody has named, so these are simply the two ways somebody
 * ran a tape over the stain, in the order he ran them. Swapping them describes
 * the same patch, which is the honest consequence of a surface with no
 * orientation, and `damageQuantity` multiplies them so it cannot matter.
 *
 * Two lengths and not one area, deliberately. The area is the multiplication of
 * these two, done here in exact nanometres — never four times three worked out
 * in somebody's head at the top of a ladder, where a slip produces a number
 * that is still a perfectly valid area and is simply wrong.
 */
export interface Spread {
  readonly oneWay: Nanometres;
  readonly theOtherWay: Nanometres;
}

/**
 * One of the room's own surfaces: this whole wall, the floor, the ceiling — or
 * a patch of the ceiling.
 *
 * The patch is the one thing here that is not all of something, and it is on
 * the ceiling alone. See the note at the top of this file: a wall and a floor
 * both have a place a mark can be put and drawn, and the ceiling is the one
 * surface where extent is all there honestly is.
 */
export interface Surface {
  readonly kind: 'surface';
  readonly surface: 'wall' | 'ceiling' | 'floor';
  /** Which wall, when it is a wall. */
  readonly wallId?: string;
  /**
   * Part of the ceiling rather than all of it.
   *
   * Left off means the whole surface, which is what a `Surface` has always
   * meant and what every mark recorded before this says.
   */
  readonly patch?: Spread;
}

export type DamageShape = Pin | Patch | Surface;

/* -------------------------------------------------------------- a reading */

/**
 * A moisture meter reading, on a day.
 *
 * The single strongest piece of evidence in a water claim. A drying curve proves
 * two things nothing else can: that the work was necessary, and when it was
 * finished. Contractors take them daily and write them on a clipboard that gets
 * lost.
 *
 * The number is whatever the meter said, in whatever units it reads — meters
 * differ and this app has never seen one. `scale` records which, so two
 * readings from two different meters are never quietly compared.
 */
export interface Reading {
  readonly at: string;
  readonly value: number;
  /** `%MC` on wood, `points` on a pin meter, `wme` on a non-invasive one. */
  readonly scale: string;
  readonly by: string;
  readonly note?: string;
}

/* --------------------------------------------------------------- a damage */

export interface Damage {
  readonly id: string;
  /**
   * A cause of loss, or a condition. See `ConditionKind` for why one field
   * carries both: it is one mark, and the job it is on decides where it lands.
   */
  readonly kind: MarkKind;
  readonly shape: DamageShape;
  /** What it is, in the words the person standing there used. */
  readonly note: string;
  readonly recordedAt: string;
  readonly recordedBy: string;
  /** Only ever on water. */
  readonly category?: WaterCategory;
  /**
   * The photographs of it, by id.
   *
   * These are evidence rather than decoration, which is why they are named on
   * the damage rather than left to be found among the hundreds from the walk.
   * They go in the claim document full size and they get backed up; the walk's
   * photographs do neither.
   */
  readonly photos: readonly string[];
  readonly readings: readonly Reading[];
  /**
   * How high to cut, when it is not simply the top of the damage.
   *
   * Trade practice is to cut at a convenient height above the water line — a
   * two foot or four foot flood cut — rather than following a ragged edge. That
   * is the contractor's decision and not the app's, so the damage records what
   * was **seen** and this records what was **decided**, separately, and the
   * scope says which it used.
   */
  readonly cutTo?: Nanometres;
  /**
   * How well the phone knew where this was, when it came off a tap in AR.
   *
   * Absent on damage drawn by hand on the plan, where the question does not
   * arise: somebody put it there.
   *
   * ## Why a pin is allowed to be uncertain at all
   *
   * A mark used to be **refused** unless the ray hit a surface ARKit had
   * already mapped. That sounded careful and in practice meant Mark never
   * worked:
   *
   * > "MARK STILL DOES NOT WORK DURING THE SCAN."
   *
   * RoomPlan maps walls and floors. It does not map ceilings, and a water stain
   * on a ceiling is the single most common thing an adjuster is shown. So the
   * one surface the feature exists for was the one surface it refused.
   *
   * The fix is not to pretend the estimate is a measurement. It is to let the
   * pin land and carry **which kind of hit it was**, all the way onto the claim
   * document, so the difference between "the phone had mapped that wall" and
   * "the phone worked it out from depth" is on the paper the adjuster reads
   * rather than lost in a refusal nobody could get past.
   */
  readonly found?: HowFound;
}

/**
 * The same thing, under the name the screens call it.
 *
 * A **mark** is what a contractor makes: he points at part of a wall and says
 * what is wrong with it. On a claim that mark is a damage; on a remodel it is a
 * condition note. One record, two audiences, and the name each audience uses.
 *
 * An alias rather than a rename because `Damage` is what the claim, the scope
 * and the saved file have called it since they were written, and renaming a type
 * across a saved format buys nothing that a sentence does not.
 */
export type Mark = Damage;

/**
 * The marks that price as tear-out, and the ones that do not.
 *
 * Split here rather than inside `scope.ts` on purpose: the scope's job is to
 * turn damage into work, and "is this damage at all" is a question about the
 * mark. Anything building a restoration scope passes `losses(marks)`, so a
 * condition note somebody wrote on the same wall cannot quietly become a line
 * item on an insurer's estimate.
 */
export function losses(marks: readonly Mark[]): Mark[] {
  return marks.filter((mark) => isLoss(mark.kind));
}

// There is deliberately no `conditions()` beside it. The complement is
// `isLoss` negated, and every screen that wants the other half wants **every**
// mark rather than the ones that are not losses -- a field sheet carries the
// water damage as well. An export nothing calls is a feature nobody can reach,
// which is what `check-reachable.py` exists to say.

/**
 * How the phone found the point under a finger, when a damage came off a tap.
 *
 * ARKit's own three answers, kept in its words rather than translated into a
 * scale this module invented, because they are not equally good and a claim
 * should be able to say which it had.
 *
 *   - `planeGeometry` — the ray hit a surface the phone has actually mapped.
 *     The point is on something real that was seen.
 *   - `planeInfinite` — it hit the *plane* of a mapped surface, out past the
 *     part that was seen. The plane is real; how far along it the point is, is
 *     an extrapolation.
 *   - `estimated` — no mapped surface, only what the depth data says. On a
 *     LiDAR phone that is a measured distance rather than a guess; on one
 *     without, it is feature points. Either way it is the only answer available
 *     for a ceiling, because RoomPlan does not map ceilings.
 */
export type HowFound = 'planeGeometry' | 'planeInfinite' | 'estimated';

/**
 * What to call each kind of hit, on a document somebody else reads.
 *
 * Not the raw word: `planeGeometry` means nothing to an adjuster. These are
 * the sentences, and they are deliberately about evidence rather than about
 * ARKit.
 */
export function certainty(found: HowFound): string {
  switch (found) {
    case 'planeGeometry':
      return 'on a surface the phone had mapped';
    case 'planeInfinite':
      return 'on the line of a mapped surface, past its edge';
    case 'estimated':
      return 'from depth alone — no mapped surface under it';
  }
}

/* --------------------------------------------------------------- checking */

function wallOf(room: Room, wallId: string): { wall: Wall; index: number } {
  const index = room.walls.findIndex((w) => w.id === wallId);
  if (index === -1) throw new DamageError(`"${room.name}" has no wall called "${wallId}".`);
  return { wall: room.walls[index]!, index };
}

/** What a wall stands at — its own height, or the room's ceiling. */
function standsAt(wall: Wall, room: Room): Nanometres {
  return (wall.height ?? room.ceilingHeight).value;
}

/**
 * Refuses a damage that does not fit the room it is in.
 *
 * The same discipline as an opening: a patch running past the end of its wall,
 * or up through the ceiling, is not a small error — every quantity below clips
 * it silently, and the claim comes out short on a wall the damage is not even
 * on.
 */
export function validateDamage(room: Room, damage: Damage): void {
  validate(room);
  if (damage.note.trim() === '') {
    throw new DamageError(
      `The ${markWord(damage.kind)} has no note on it. A mark on a plan that nobody described ` +
        `is a mark nobody can act on three days later.`
    );
  }
  if (damage.category !== undefined && damage.kind !== 'water') {
    throw new DamageError(
      `A water category is set on ${damage.kind} damage. Categories describe how dirty water ` +
        `was; they mean nothing about a fire.`
    );
  }

  const shape = damage.shape;
  if (shape.kind === 'patch') {
    const { wall } = wallOf(room, shape.wallId);
    if (wall.open) {
      throw new DamageError(
        `"${shape.wallId}" is an open span — there is no wall there to be damaged.`
      );
    }
    const length = runLength(wall);
    const lo = shape.fromAlong < shape.toAlong ? shape.fromAlong : shape.toAlong;
    const hi = shape.fromAlong < shape.toAlong ? shape.toAlong : shape.fromAlong;
    if (lo < 0n || hi > length) {
      throw new DamageError(
        `That damaged area runs from ${formatFeetInches(lo)} to ${formatFeetInches(hi)} along ` +
          `"${shape.wallId}", which is ${formatFeetInches(length)} long. One of the two ends is ` +
          `off the wall.`
      );
    }
    if (hi === lo) {
      throw new DamageError(`A damaged area of no width is a pin, not an area. Mark it as one.`);
    }
    const top = shape.toHeight > shape.fromHeight ? shape.toHeight : shape.fromHeight;
    const bottom = shape.toHeight > shape.fromHeight ? shape.fromHeight : shape.toHeight;
    if (bottom < 0n) throw new DamageError(`Damage cannot start below the floor.`);
    if (top > standsAt(wall, room)) {
      throw new DamageError(
        `That damage reaches ${formatFeetInches(top)} up a wall that is ` +
          `${formatFeetInches(standsAt(wall, room))} high.`
      );
    }
    if (top === bottom) {
      throw new DamageError(`A damaged area of no height is a pin, not an area. Mark it as one.`);
    }
    if (damage.cutTo !== undefined) {
      if (damage.cutTo < top) {
        throw new DamageError(
          `The cut is set at ${formatFeetInches(damage.cutTo)}, below the top of the damage at ` +
            `${formatFeetInches(top)}. A cut below the damage leaves the damage in the wall.`
        );
      }
      if (damage.cutTo > standsAt(wall, room)) {
        throw new DamageError(
          `The cut is set above the top of the wall. Mark the whole wall instead.`
        );
      }
    }
  }

  if (shape.kind === 'surface') {
    if (shape.surface === 'wall') {
      if (!shape.wallId) throw new DamageError('A damaged wall has to say which wall.');
      wallOf(room, shape.wallId);
    }
    if (shape.patch !== undefined) checkCeilingPatch(room, shape);
  }

  if (shape.kind === 'pin' && shape.wallId !== undefined) wallOf(room, shape.wallId);
  if (shape.kind === 'pin' && shape.on === 'ceiling' && shape.wallId !== undefined) {
    throw new DamageError(
      `That spot is on the ceiling and on "${shape.wallId}" at the same time. A mark is on one ` +
        `surface, and which one decides where it is priced and which panel it appears under.`
    );
  }
}

/**
 * Refuses a patch of ceiling that is not a patch of this ceiling.
 *
 * The same discipline `readPart` keeps over a typed quantity, for the same
 * reason: this is the one figure on a ceiling mark that no geometry produced,
 * so every way of getting it wrong is answered in a sentence somebody can act
 * on rather than clamped, rounded or quietly taken as it comes.
 */
function checkCeilingPatch(room: Room, shape: Surface): void {
  const patch = shape.patch!;
  if (shape.surface !== 'ceiling') {
    throw new DamageError(
      `Part of ${shape.surface === 'wall' ? `"${shape.wallId ?? 'a wall'}"` : 'the floor'} is ` +
        `marked by where it is, not only by how big it is — ${
          shape.surface === 'wall'
            ? 'mark the area on the wall instead, which the elevation can draw'
            : 'put a spot on the plan instead, which is a place somebody can point at'
        }. Only the ceiling has nowhere for a position to go.`
    );
  }
  if (patch.oneWay <= 0n || patch.theOtherWay <= 0n) {
    throw new DamageError(
      `A patch ${formatFeetInches(patch.oneWay)} one way by ` +
        `${formatFeetInches(patch.theOtherWay)} the other is not a size. Something with no size ` +
        `is a spot on the ceiling — mark it as one, and it carries the photograph just the same.`
    );
  }
  const whole = roomQuantities(room).ceilingArea;
  const covered = 2n * patch.oneWay * patch.theOtherWay;
  if (covered > whole) {
    throw new DamageError(
      `That patch is ${squareFeet(covered)} sq ft, and the whole ceiling of "${room.name}" is ` +
        `${squareFeet(whole)} sq ft. A part cannot be bigger than the thing it is part of — ` +
        `check the tape, or mark the whole ceiling.`
    );
  }
}

/** The doubled area unit, to square feet, to one place. For a refusal to quote. */
function squareFeet(halves: bigint): string {
  const half = NM_PER_FOOT * NM_PER_FOOT * 2n;
  const tenths = (halves * 10n + half / 2n) / half;
  return `${tenths / 10n}.${tenths % 10n}`;
}

/* ------------------------------------------------------------- quantities */

export interface DamageQuantity {
  readonly damageId: string;
  readonly what: string;
  /** Face area affected, in square nanometres. Zero for a pin. */
  readonly faceArea: bigint;
  /** Baseboard in the affected run, when the damage reaches the floor. */
  readonly baseboardRun: Nanometres;
  /** Floor or ceiling area, when a whole surface is gone. In the doubled unit. */
  readonly flatArea: bigint;
  /** How the numbers were arrived at, in words, for the report. */
  readonly workings: string;
  /** True when a cut height was decided rather than the damage followed. */
  readonly cut: boolean;
}

/**
 * What one damage takes, from the geometry and nothing else.
 *
 * It says how much surface is affected. It does **not** say what to do about it:
 * whether the insulation goes, whether the studs need treating, whether the
 * floor comes up. Those are decisions about somebody's building made by somebody
 * standing in it, and an app that made them from a phone would be wrong the
 * first time the wall turned out to be a partition.
 */
export function damageQuantity(room: Room, damage: Damage): DamageQuantity {
  validateDamage(room, damage);
  const shape = damage.shape;

  if (shape.kind === 'pin') {
    // A spot on the ceiling says so, because the ceiling is the one surface a
    // spot cannot be found on the plan afterwards — there is no marker on the
    // drawing and no wall name beside it, so the words are the whole of where.
    const onTheCeiling = shape.on === 'ceiling';
    return {
      damageId: damage.id,
      what: `${markWord(damage.kind)}, marked${onTheCeiling ? ' on the ceiling' : ''}`,
      faceArea: 0n,
      baseboardRun: 0n,
      flatArea: 0n,
      // Said plainly rather than left as a zero somebody has to interpret.
      workings: onTheCeiling
        ? 'a marked spot on the ceiling — no area, because a pin is a marker and not a measurement'
        : 'a marked point — no area, because a pin is a marker and not a measurement',
      cut: false,
    };
  }

  if (shape.kind === 'patch') {
    const { wall } = wallOf(room, shape.wallId);
    const lo = shape.fromAlong < shape.toAlong ? shape.fromAlong : shape.toAlong;
    const hi = shape.fromAlong < shape.toAlong ? shape.toAlong : shape.fromAlong;
    const bottom = shape.fromHeight < shape.toHeight ? shape.fromHeight : shape.toHeight;
    const seen = shape.fromHeight < shape.toHeight ? shape.toHeight : shape.fromHeight;
    const top = damage.cutTo ?? seen;
    const width = hi - lo;

    // Openings in the affected stretch are not wall and do not take board.
    const holes = add(
      ...(wall.openings ?? []).map((opening) => {
        const oLo = opening.offsetFromStart.value;
        const oHi = oLo + opening.width.value;
        const sharedWidth = (oHi < hi ? oHi : hi) - (oLo > lo ? oLo : lo);
        if (sharedWidth <= 0n) return 0n;
        const oBottom = opening.sillHeight?.value ?? 0n;
        const oTop = oBottom + opening.height.value;
        const sharedHeight = (oTop < top ? oTop : top) - (oBottom > bottom ? oBottom : bottom);
        return sharedHeight <= 0n ? 0n : sharedWidth * sharedHeight;
      })
    );

    const face = width * (top - bottom) - holes;
    // Base only comes off if the damage actually reaches the floor.
    const base = bottom === 0n ? width - openingWidthIn(wall, lo, hi, 'floor') : 0n;

    return {
      damageId: damage.id,
      what: `${markWord(damage.kind)} to ${shape.wallId}`,
      faceArea: face < 0n ? 0n : face,
      baseboardRun: base < 0n ? 0n : base,
      flatArea: 0n,
      workings:
        `${formatFeetInches(width)} along ${shape.wallId}, ` +
        (damage.cutTo === undefined
          ? `${formatFeetInches(bottom)} to ${formatFeetInches(seen)} high`
          : `cut from ${formatFeetInches(bottom)} to ${formatFeetInches(top)} — the damage was ` +
            `seen to ${formatFeetInches(seen)}`) +
        (holes > 0n ? ', less the openings in it' : ''),
      cut: damage.cutTo !== undefined,
    };
  }

  // A whole surface.
  if (shape.surface === 'wall') {
    const { wall } = wallOf(room, shape.wallId!);
    const length = runLength(wall);
    const height = standsAt(wall, room);
    const holes = add(
      ...(wall.openings ?? []).map((o) => o.width.value * o.height.value)
    );
    const doors = add(
      ...(wall.openings ?? [])
        .filter((o) => o.kind !== 'window')
        .map((o) => o.width.value)
    );
    return {
      damageId: damage.id,
      what: `${markWord(damage.kind)} — all of ${shape.wallId}`,
      faceArea: length * height - holes,
      baseboardRun: length - doors,
      flatArea: 0n,
      workings: `the whole of ${shape.wallId}, ${formatFeetInches(length)} by ${formatFeetInches(height)}, less every opening`,
      cut: false,
    };
  }

  // A patch of the ceiling. His two tape readings, multiplied here — the only
  // arithmetic on a ceiling mark, done in exact nanometres so it is never done
  // on a ladder. The workings name it as a rectangle round the damage rather
  // than the damage itself, because nothing draws a ceiling patch and the words
  // are the only place that difference can be seen.
  if (shape.patch !== undefined) {
    const { oneWay, theOtherWay } = shape.patch;
    return {
      damageId: damage.id,
      what: `${markWord(damage.kind)} — part of the ceiling`,
      faceArea: 0n,
      baseboardRun: 0n,
      flatArea: 2n * oneWay * theOtherWay,
      workings:
        `${formatFeetInches(oneWay)} by ${formatFeetInches(theOtherWay)} of the ceiling of ` +
        `${room.name} — the rectangle it fits inside, taped across it rather than measured off ` +
        `the room`,
      cut: false,
    };
  }

  const q = roomQuantities(room);
  return {
    damageId: damage.id,
    what: `${markWord(damage.kind)} — the whole ${shape.surface}`,
    faceArea: 0n,
    baseboardRun: shape.surface === 'floor' ? q.baseboardRun : 0n,
    flatArea: shape.surface === 'ceiling' ? q.ceilingArea : q.floorArea,
    workings: `the whole ${shape.surface} of ${room.name}`,
    cut: false,
  };
}

/** How much of the openings in a stretch of wall sit on the floor. */
function openingWidthIn(wall: Wall, lo: Nanometres, hi: Nanometres, at: 'floor'): Nanometres {
  if (at !== 'floor') return 0n;
  return add(
    ...(wall.openings ?? [])
      .filter((o) => o.kind !== 'window')
      .map((o) => {
        const oLo = o.offsetFromStart.value;
        const oHi = oLo + o.width.value;
        const shared = (oHi < hi ? oHi : hi) - (oLo > lo ? oLo : lo);
        return shared > 0n ? shared : 0n;
      })
  );
}

/* ------------------------------------------------------------ the totals */

export interface DamageTotals {
  readonly each: readonly DamageQuantity[];
  /** Board and paint area across every damage, in square nanometres. */
  readonly faceArea: bigint;
  readonly baseboardRun: Nanometres;
  /** Floor and ceiling, in the doubled unit `area()` uses. */
  readonly flatArea: bigint;
  /** Marked points that carry no area, counted rather than hidden. */
  readonly pins: number;
  /** True when any quantity used a decided cut rather than the damage seen. */
  readonly anyCut: boolean;
}

/**
 * Every damage in the room, added up.
 *
 * **Overlaps are not deducted, and that is stated rather than fixed.** Two
 * damaged areas marked over the same stretch of wall are two people's
 * observations, not one area counted twice, and silently merging them would
 * throw away one of them. Where it matters the report shows each area
 * separately, so anybody adding them can see what they are adding.
 */
export function damageTotals(room: Room, damages: readonly Damage[]): DamageTotals {
  const each = damages.map((damage) => damageQuantity(room, damage));
  return {
    each,
    faceArea: each.reduce((sum, q) => sum + q.faceArea, 0n),
    baseboardRun: add(...each.map((q) => q.baseboardRun)),
    flatArea: each.reduce((sum, q) => sum + q.flatArea, 0n),
    pins: each.filter((q) => q.faceArea === 0n && q.flatArea === 0n && q.baseboardRun === 0n).length,
    anyCut: each.some((q) => q.cut),
  };
}

/**
 * How much of the room is affected, as a fraction of its own wall face.
 *
 * The figure an adjuster reaches for first, and the one that decides whether a
 * room is a patch or a gut. In tenths of a percent so it stays an integer.
 */
export function affectedPerMille(room: Room, damages: readonly Damage[]): bigint {
  const whole = roomQuantities(room).wallFaceArea;
  if (whole === 0n) return 0n;
  return (damageTotals(room, damages).faceArea * 1000n) / whole;
}

/* --------------------------------------------------------- the flood cut */

/** The heights a flood cut is normally taken to. Offered, never applied. */
export const FLOOD_CUTS: readonly Nanometres[] = [2n * NM_PER_FOOT, 4n * NM_PER_FOOT];

/**
 * The next standard cut above what was seen, or nothing when the damage is
 * already higher than any of them.
 *
 * Suggested, never applied. Where to cut is a decision about somebody's
 * building, and the difference between what was seen and what was decided is
 * exactly the distinction this app exists to keep.
 */
export function suggestedCut(seenTo: Nanometres): Nanometres | undefined {
  return FLOOD_CUTS.find((cut) => cut > seenTo);
}

/* ------------------------------------------------------------- the drying */

export interface Drying {
  readonly damageId: string;
  readonly readings: readonly Reading[];
  /** True when every scale in the readings is the same one. */
  readonly comparable: boolean;
  /** Down, up, or neither. Nothing at all until there are two readings. */
  readonly trend: 'drying' | 'wetter' | 'flat' | 'not enough readings';
  readonly first?: Reading;
  readonly latest?: Reading;
}

/**
 * What the meter has been saying.
 *
 * A drying curve is the strongest evidence in a water claim: it proves the work
 * was necessary, and it proves when it was finished.
 *
 * Two readings from two different meters are **never** compared. Meters read on
 * different scales and this app has never seen one; a curve drawn across a
 * scale change would be a fabricated trend on a document somebody is paid
 * against.
 */
export function drying(damage: Damage): Drying {
  const readings = [...damage.readings].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const scales = new Set(readings.map((r) => r.scale));
  const comparable = scales.size <= 1;
  const first = readings[0];
  const latest = readings[readings.length - 1];

  let trend: Drying['trend'] = 'not enough readings';
  if (readings.length >= 2 && comparable && first && latest) {
    trend = latest.value < first.value ? 'drying' : latest.value > first.value ? 'wetter' : 'flat';
  }

  return {
    damageId: damage.id,
    readings,
    comparable,
    trend,
    ...(first ? { first } : {}),
    ...(latest ? { latest } : {}),
  };
}

/* ------------------------------------------------------------- for a screen */

/** Where a patch sits on its wall, as fractions, for drawing an elevation. */
export function patchOnWall(
  room: Room,
  patch: Patch
): { along: [number, number]; height: [number, number] } {
  const { wall } = wallOf(room, patch.wallId);
  const length = Number(runLength(wall));
  const tall = Number(standsAt(wall, room));
  const lo = patch.fromAlong < patch.toAlong ? patch.fromAlong : patch.toAlong;
  const hi = patch.fromAlong < patch.toAlong ? patch.toAlong : patch.fromAlong;
  const bottom = patch.fromHeight < patch.toHeight ? patch.fromHeight : patch.toHeight;
  const top = patch.fromHeight < patch.toHeight ? patch.toHeight : patch.fromHeight;
  return {
    along: [Number(lo) / length, Number(hi) / length],
    height: [Number(bottom) / tall, Number(top) / tall],
  };
}

/** Where a damage is on the plan, for a marker. Nothing for a whole surface. */
export function damageOnPlan(room: Room, damage: Damage): Point | undefined {
  const shape = damage.shape;
  if (shape.kind === 'pin') return shape.at;

  const points = corners(room);
  const wallId = shape.kind === 'patch' ? shape.wallId : shape.wallId;
  if (!wallId) return undefined;
  const { wall, index } = wallOf(room, wallId);
  const from = points[index]!;
  const to = points[(index + 1) % points.length]!;
  const length = runLength(wall);
  if (length === 0n) return from;

  const middle =
    shape.kind === 'patch'
      ? (shape.fromAlong + shape.toAlong) / 2n
      : length / 2n;
  return {
    x: from.x + ((to.x - from.x) * middle) / length,
    y: from.y + ((to.y - from.y) * middle) / length,
  };
}

/**
 * The stretch of wall a damage covers, in plan, as two points.
 *
 * A marker in the middle of a wall says something is wrong somewhere along it.
 * What a contractor actually reads off a plan is **how much of that wall has to
 * come out** — where the cut starts and where it stops — because that is what
 * gets ordered, scheduled and argued about. So the extent is drawn, not a dot.
 *
 * Nothing for a pin (it is a point, and giving it a length would invent one) and
 * nothing for a floor or a ceiling (they are the room, not a run of it).
 */
export function damageRunOnPlan(
  room: Room,
  damage: Damage
): { readonly from: Point; readonly to: Point } | undefined {
  const shape = damage.shape;
  if (shape.kind === 'pin') return undefined;
  if (shape.kind === 'surface' && shape.surface !== 'wall') return undefined;
  if (!shape.wallId) return undefined;

  const points = corners(room);
  const { wall, index } = wallOf(room, shape.wallId);
  const start = points[index]!;
  const end = points[(index + 1) % points.length]!;
  const length = runLength(wall);
  if (length === 0n) return { from: start, to: start };

  // A whole-wall surface is the whole wall. A patch is the span it was marked
  // over, in the order the plan numbers the wall from — which is the same order
  // the person typed "from" and "to" in.
  const lo =
    shape.kind === 'surface'
      ? 0n
      : shape.fromAlong < shape.toAlong
        ? shape.fromAlong
        : shape.toAlong;
  const hi =
    shape.kind === 'surface'
      ? length
      : shape.fromAlong < shape.toAlong
        ? shape.toAlong
        : shape.fromAlong;

  const at = (along: Nanometres): Point => ({
    x: start.x + ((end.x - start.x) * along) / length,
    y: start.y + ((end.y - start.y) * along) / length,
  });
  return { from: at(lo), to: at(hi) };
}

/** A damage in the words a report uses. */
export function describeDamage(room: Room, damage: Damage): string {
  const q = damageQuantity(room, damage);
  const category =
    damage.kind === 'water' && damage.category
      ? ` (${WATER_CATEGORY[damage.category].plain})`
      : '';
  return `${markWord(damage.kind)}${category} — ${q.workings}`;
}

/** How far a damage reaches up the wall, for sorting a report. */
export function reaches(damage: Damage): Nanometres {
  const shape = damage.shape;
  if (shape.kind === 'patch') {
    return abs(shape.toHeight > shape.fromHeight ? shape.toHeight : shape.fromHeight);
  }
  if (shape.kind === 'pin') return shape.height ?? 0n;
  return 0n;
}
