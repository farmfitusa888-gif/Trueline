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
 */

export class DamageError extends RoomError {}

/** What happened. Plain words, because a homeowner reads the report too. */
export type DamageKind = 'water' | 'fire' | 'smoke' | 'mould' | 'impact' | 'wind' | 'other';

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
  readonly at: Point;
  /** How far off the floor, when it is known. */
  readonly height?: Nanometres;
  readonly wallId?: string;
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

/** All of one thing: this whole wall, the ceiling, the floor. */
export interface Surface {
  readonly kind: 'surface';
  readonly surface: 'wall' | 'ceiling' | 'floor';
  /** Which wall, when it is a wall. */
  readonly wallId?: string;
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
  readonly kind: DamageKind;
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
      `The ${damage.kind} damage has no note on it. A mark on a plan that nobody described is ` +
        `a mark nobody can act on three days later.`
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

  if (shape.kind === 'surface' && shape.surface === 'wall') {
    if (!shape.wallId) throw new DamageError('A damaged wall has to say which wall.');
    wallOf(room, shape.wallId);
  }

  if (shape.kind === 'pin' && shape.wallId !== undefined) wallOf(room, shape.wallId);
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
    return {
      damageId: damage.id,
      what: `${damage.kind} damage, marked`,
      faceArea: 0n,
      baseboardRun: 0n,
      flatArea: 0n,
      // Said plainly rather than left as a zero somebody has to interpret.
      workings: 'a marked point — no area, because a pin is a marker and not a measurement',
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
      what: `${damage.kind} damage to ${shape.wallId}`,
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
      what: `${damage.kind} damage — all of ${shape.wallId}`,
      faceArea: length * height - holes,
      baseboardRun: length - doors,
      flatArea: 0n,
      workings: `the whole of ${shape.wallId}, ${formatFeetInches(length)} by ${formatFeetInches(height)}, less every opening`,
      cut: false,
    };
  }

  const q = roomQuantities(room);
  return {
    damageId: damage.id,
    what: `${damage.kind} damage — the whole ${shape.surface}`,
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

/** A damage in the words a report uses. */
export function describeDamage(room: Room, damage: Damage): string {
  const q = damageQuantity(room, damage);
  const category =
    damage.kind === 'water' && damage.category
      ? ` (${WATER_CATEGORY[damage.category].plain})`
      : '';
  return `${damage.kind}${category} — ${q.workings}`;
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
