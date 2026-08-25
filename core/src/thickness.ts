import {
  type Nanometres,
  NM_PER_FOOT,
  NM_PER_INCH,
  add,
  formatFeetInches,
  of,
} from './length.ts';
import { type Measurement, isVerified } from './measurement.ts';
import {
  type Opening,
  type Room,
  type Wall,
  RoomError,
  area,
  isDiagonal,
  runLength,
  validate,
} from './room.ts';

/**
 * How thick the walls are — the one number on a job that is never scanned.
 *
 * RoomPlan's export gives every surface three dimensions and the third one is
 * zero. Not sometimes: zero in all five walls of Sam's garage and all eight of
 * the kitchen, because a scanner standing inside a room sees one face of a wall
 * and has no way at all to know what is behind it. So thickness in this model
 * was put there by a person, always, and it carries `verified` provenance saying
 * which person and how they knew — `stated` for "that's a 2x4 wall", `tape` for
 * a tape held through a door opening, `plans` for a number read off a drawing.
 *
 * Setting it moves nothing that is already on the plan. The polygon the scanner
 * produces is the room's **interior face**, which is exactly the surface that
 * flooring, drywall, paint and baseboard are priced off, so floor area, wall
 * face and baseboard run are all unchanged. What thickness adds is the set of
 * numbers a contractor cannot order against without it:
 *
 *   - **Jamb depth.** You cannot buy a door without it. A pre-hung unit comes
 *     with a jamb cut for one wall thickness and the wrong one goes back.
 *   - **The return round an opening.** A window in a 6 1/2 inch wall has two
 *     jambs, a head and a sill to wrap; in a 4 1/2 inch wall it has less of
 *     each. That is drywall, or it is extension jambs, and it is priced.
 *   - **Framing.** Plates run three times the wall; studs land on a spacing.
 *
 * Walls with no thickness are named rather than assumed. Assuming four and a
 * half inches is how a takeoff quietly prices a masonry garage as a stud wall.
 */

/* --------------------------------------------------------------- assemblies */

/**
 * A wall build-up, as a contractor names it, with the actual sizes.
 *
 * Nominal lumber is not its own size and never has been: a 2x4 is 1 1/2 by
 * 3 1/2, a 2x6 is 1 1/2 by 5 1/2, and an 8 inch block is 7 5/8. Those are the
 * numbers in here. The label is what somebody says out loud; the arithmetic uses
 * what the material actually measures.
 */
export interface Assembly {
  readonly id: AssemblyId;
  /** What a contractor calls it. */
  readonly label: string;
  /** The same thing in as few characters as it can be said in, for a column. */
  readonly short: string;
  /** The structural member, at its real size — 3 1/2" for a 2x4. */
  readonly framing: Nanometres;
  /** The finish on each face, at its real size — 1/2" for standard board. */
  readonly board: Nanometres;
  /** How many faces get that finish. A partition gets two; see `label`. */
  readonly sides: 1 | 2;
  /** Face to face, finished. What a tape through a door opening reads. */
  readonly thickness: Nanometres;
  /** True when studs run through it, so plates and studs can be counted. */
  readonly framed: boolean;
}

export type AssemblyId = '2x4' | '2x6' | '2x4-type-x' | '2x6-type-x' | 'cmu-8';

const IN = (whole: number, num = 0, den = 1): Nanometres =>
  BigInt(whole) * NM_PER_INCH + (BigInt(num) * NM_PER_INCH) / BigInt(den);

function assembly(
  id: AssemblyId,
  short: string,
  label: string,
  framing: Nanometres,
  board: Nanometres,
  sides: 1 | 2,
  framed = true
): Assembly {
  return {
    id,
    short,
    label,
    framing,
    board,
    sides,
    thickness: framing + BigInt(sides) * board,
    framed,
  };
}

/**
 * The build-ups worth putting on a button. Anything else gets typed as a number.
 *
 * Deliberately short. A picker with thirty entries is a picker nobody reads, and
 * the two at the top cover most of the residential work this app is for.
 */
export const ASSEMBLIES: readonly Assembly[] = [
  assembly('2x4', '2x4', '2x4 wall, 1/2" board both sides', IN(3, 1, 2), IN(0, 1, 2), 2),
  assembly('2x6', '2x6', '2x6 wall, 1/2" board both sides', IN(5, 1, 2), IN(0, 1, 2), 2),
  assembly('2x4-type-x', '2x4 5/8', '2x4 wall, 5/8" board both sides', IN(3, 1, 2), IN(0, 5, 8), 2),
  assembly('2x6-type-x', '2x6 5/8', '2x6 wall, 5/8" board both sides', IN(5, 1, 2), IN(0, 5, 8), 2),
  assembly('cmu-8', '8" block', '8" block, 1/2" board one side', IN(7, 5, 8), IN(0, 1, 2), 1, false),
];

export class ThicknessError extends RoomError {}

export function assemblyById(id: AssemblyId): Assembly {
  const found = ASSEMBLIES.find((a) => a.id === id);
  if (!found) throw new ThicknessError(`There is no wall build-up called "${id}".`);
  return found;
}

/** The build-up whose finished thickness is exactly this, if one of them is. */
export function assemblyForThickness(thickness: Nanometres): Assembly | undefined {
  return ASSEMBLIES.find((a) => a.thickness === thickness);
}

/* ------------------------------------------------------------- jamb depth */

/**
 * How far a jamb stands proud of the wall it sits in.
 *
 * A jamb is cut a shade wider than the wall so the casing lands on wood rather
 * than rocking on a drywall edge. A sixteenth is the number the trade cuts to,
 * and it is the reason the two sizes on every millwork shelf are 4 9/16" and
 * 6 9/16": a 2x4 wall finishes at 4 1/2 and a 2x6 at 6 1/2. Those two shelf
 * sizes fall straight out of this constant, which is the check that it is right.
 */
export const JAMB_CLEARANCE: Nanometres = NM_PER_INCH / 16n;

/** The jamb to order for a wall of this thickness. */
export function jambDepth(thickness: Nanometres): Nanometres {
  if (thickness <= 0n) {
    throw new ThicknessError(`A wall ${formatFeetInches(thickness)} thick takes no jamb.`);
  }
  return thickness + JAMB_CLEARANCE;
}

/* ------------------------------------------------------- what a wall knows */

/** The wall's own thickness, or the room's, or nothing. Nothing is an answer. */
export function thicknessOf(wall: Wall, room: Room): Measurement | undefined {
  if (wall.open) return undefined;
  return wall.thickness ?? room.wallThickness;
}

/** Walls nobody has said a thickness for. Named, never guessed at. */
export function withoutThickness(room: Room): readonly string[] {
  validate(room);
  return room.walls.filter((w) => !w.open && thicknessOf(w, room) === undefined).map((w) => w.id);
}

/** True when every built wall in the room has a thickness against it. */
export function fullyThick(room: Room): boolean {
  return withoutThickness(room).length === 0;
}

/**
 * The distinct thicknesses in the room, each with the walls that carry it.
 *
 * A room is rarely one thickness — the outside walls are 2x6 and the partitions
 * are 2x4 — and the door for one is the wrong door for the other. So this is
 * what the jamb schedule is built from, rather than a single room-wide number
 * that would be right for some of the openings and quietly wrong for the rest.
 *
 * Sorted thinnest first, and every group carries whether a person stood behind
 * every wall in it or only some.
 */
export interface ThicknessGroup {
  readonly thickness: Nanometres;
  readonly wallIds: readonly string[];
  /** The catalogue build-up that measures exactly this, when one does. */
  readonly assembly?: Assembly;
  /** The jamb to order for openings in these walls. */
  readonly jamb: Nanometres;
  /** How many doors, windows and cased openings sit in walls of this thickness. */
  readonly openings: number;
  /** True when a person stood behind this number on every wall in the group. */
  readonly verified: boolean;
  /** How they knew: `stated`, `tape`, `plans`. The bluntest of the three is kept. */
  readonly how: string;
}

export function thicknessGroups(room: Room): readonly ThicknessGroup[] {
  validate(room);
  interface Building {
    thickness: Nanometres;
    wallIds: string[];
    openings: number;
    verified: boolean;
    how: Set<string>;
  }
  const groups = new Map<string, Building>();
  for (const wall of room.walls) {
    const t = thicknessOf(wall, room);
    if (t === undefined) continue;
    const key = t.value.toString();
    const group: Building = groups.get(key) ?? {
      thickness: t.value,
      wallIds: [],
      openings: 0,
      verified: true,
      how: new Set<string>(),
    };
    group.wallIds.push(wall.id);
    group.openings += (wall.openings ?? []).length;
    group.verified = group.verified && isVerified(t);
    group.how.add(provenanceMethod(t));
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort((a, b) => (a.thickness === b.thickness ? 0 : a.thickness < b.thickness ? -1 : 1))
    .map((g) => {
      const found = assemblyForThickness(g.thickness);
      // The bluntest way anybody knew it. A group where one wall was taped and
      // three were assumed is an assumed group.
      const ranked = ['stated', 'plans', 'laser', 'tape'];
      const how = [...g.how].sort(
        (a, b) => ranked.indexOf(a) - ranked.indexOf(b)
      )[0]!;
      return {
        thickness: g.thickness,
        wallIds: g.wallIds,
        ...(found ? { assembly: found } : {}),
        jamb: jambDepth(g.thickness),
        openings: g.openings,
        verified: g.verified,
        how,
      };
    });
}

/* -------------------------------------------------------- opening returns */

/**
 * The wrap round an opening: two jambs, a head, and a sill if it has one.
 *
 * The hole in a wall is not just a hole. Its sides are surfaces, and how much
 * surface there is depends entirely on how thick the wall is — which is why this
 * quantity has been uncomputable in this app until now, and why a takeoff
 * without it is short every time a window goes in a masonry wall.
 *
 * A door and a cased opening have no sill: the floor runs through. A window has
 * all four sides. The run is the perimeter of the reveal; the area is that run
 * times the thickness, which is the drywall wrapped round it or the extension
 * jamb stock milled for it.
 */
export interface OpeningReturn {
  readonly wallId: string;
  readonly openingId: string;
  readonly kind: Opening['kind'];
  /** Perimeter of the reveal: two jambs, a head, and a sill on a window. */
  readonly run: Nanometres;
  /** That run times the wall's thickness. In square nanometres. */
  readonly area: bigint;
  readonly thickness: Nanometres;
}

export function openingReturns(room: Room): readonly OpeningReturn[] {
  validate(room);
  const out: OpeningReturn[] = [];
  for (const wall of room.walls) {
    const t = thicknessOf(wall, room);
    if (t === undefined) continue;
    for (const opening of wall.openings ?? []) {
      // Two jambs and a head always. A window adds a sill; a door and a cased
      // opening do not have one, because the floor runs straight through.
      const sides = opening.kind === 'window' ? 2n : 1n;
      const run = 2n * opening.height.value + sides * opening.width.value;
      out.push({
        wallId: wall.id,
        openingId: opening.id,
        kind: opening.kind,
        run,
        area: run * t.value,
        thickness: t.value,
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ framing */

/** Where studs land. 16 inches on centre unless somebody says otherwise. */
export type Spacing = 16 | 24;

export interface Framing {
  /** Plates: one bottom and two top, so three times every framed wall. */
  readonly plateRun: Nanometres;
  /**
   * Field studs at the stated spacing, and nothing else.
   *
   * Corners, channels, king studs, jacks, cripples and headers are **not** in
   * here, because how many of those a wall takes depends on how it is framed and
   * this app has not been in the wall. A number that quietly included a guess at
   * them would be the wrong kind of helpful. What is here is exact: the studs
   * that land on the spacing, one at each end.
   */
  readonly studs: number;
  readonly spacing: Spacing;
  /** Walls counted — the framed ones with a thickness against them. */
  readonly wallIds: readonly string[];
  /** How long those walls run, before the plates multiply it. */
  readonly framedRun: Nanometres;
  /** Openings in those walls, each of which needs a header sized on site. */
  readonly headers: number;
  /** Walls left out, and why, so the number is never read as the whole room. */
  readonly skipped: readonly { readonly wallId: string; readonly why: string }[];
}

/**
 * Plates and studs for the walls that are framed and have a thickness.
 *
 * Everything left out is listed with a reason. A framing count that silently
 * skipped the block wall and the garage door opening would read like a count of
 * the whole building.
 */
export function framing(room: Room, spacing: Spacing = 16): Framing {
  validate(room);
  const perStud = of(spacing, 'in');
  const wallIds: string[] = [];
  const skipped: { wallId: string; why: string }[] = [];
  let framedRun = 0n;
  let studs = 0;
  let headers = 0;

  for (const wall of room.walls) {
    if (wall.open) {
      skipped.push({ wallId: wall.id, why: 'nothing is built across it' });
      continue;
    }
    const t = thicknessOf(wall, room);
    if (t === undefined) {
      skipped.push({ wallId: wall.id, why: 'no thickness has been given for it' });
      continue;
    }
    const built = assemblyForThickness(t.value);
    if (built && !built.framed) {
      skipped.push({ wallId: wall.id, why: `it is ${built.label.toLowerCase()}, not stud framing` });
      continue;
    }
    const run = runLength(wall);
    wallIds.push(wall.id);
    framedRun += run;
    // One at each end, then one every spacing between them.
    studs += Number(run / perStud) + 1;
    headers += (wall.openings ?? []).length;
  }

  return {
    plateRun: 3n * framedRun,
    studs,
    spacing,
    wallIds,
    framedRun,
    headers,
    skipped,
  };
}

/* ---------------------------------------------------------------- footprint */

/**
 * How much floor the walls themselves stand on, and what the room measures
 * outside.
 *
 * Offsetting a closed rectilinear outline outward by a uniform `t` grows its
 * area by exactly `t * perimeter + 4 * t^2`. The perimeter term is the strip
 * along each wall; the `4t^2` is the corners, and it is four rather than the
 * corner count because every simple rectilinear loop has exactly four more
 * square corners than reflex ones, however many jogs it has. That identity is
 * exact in integers, which is why it is used rather than building the offset
 * polygon and intersecting the lines — that would need a division per corner
 * and would round.
 *
 * It needs one thickness for the whole outline, so it is only offered when the
 * room has one, and it is refused rather than approximated when it does not.
 * A room with an angled wall is refused too: the corner wedge at a 70 degree
 * chamfer is not a square, it is a kite whose area needs a tangent, and this
 * module does not do trigonometry on somebody's building.
 */
export interface Footprint {
  /** Inside the finished faces — the number flooring is priced off. */
  readonly inside: bigint;
  /** Outside the finished faces — what the building measures on the ground. */
  readonly outside: bigint;
  /** The difference: the plan area the walls themselves occupy. */
  readonly walls: bigint;
  readonly thickness: Nanometres;
}

/** Whether `footprint()` can answer, and if not, what to tell somebody. */
export function footprintObstacle(room: Room): string | undefined {
  validate(room);
  const built = room.walls.filter((w) => !w.open);
  if (built.length !== room.walls.length) {
    return (
      `${room.name} has a side with nothing built across it, so it has no outside face to ` +
      `measure to. The inside floor area is the honest number here.`
    );
  }
  if (room.walls.some((w) => isDiagonal(w.heading))) {
    return (
      `${room.name} has an angled wall. Working the outside dimensions round a corner that is ` +
      `not square needs trigonometry, and this would have to round your building to do it.`
    );
  }
  const thicknesses = new Set(built.map((w) => thicknessOf(w, room)?.value));
  if (thicknesses.has(undefined)) {
    return `Not every wall in ${room.name} has a thickness yet.`;
  }
  if (thicknesses.size > 1) {
    return (
      `${room.name} has walls of ${thicknesses.size} different thicknesses. Outside dimensions ` +
      `need one thickness all the way round.`
    );
  }
  return undefined;
}

/**
 * Inside area, outside area, and the floor the walls stand on.
 *
 * Areas are in the same half-square-nanometre unit `area()` uses, so they add up
 * with everything else in the model rather than needing a conversion nobody
 * remembers.
 */
export function footprint(room: Room): Footprint {
  const obstacle = footprintObstacle(room);
  if (obstacle) throw new ThicknessError(obstacle);

  const t = thicknessOf(room.walls[0]!, room)!.value;
  const inside = area(room).value;
  const perimeter = add(...room.walls.map((w) => runLength(w)));
  // Doubled, because areas here are held doubled. See `room.ts`.
  const grown = 2n * (t * perimeter + 4n * t * t);
  return { inside, outside: inside + grown, walls: grown, thickness: t };
}

/* ----------------------------------------------------------------- reading */

/** Square feet from the doubled unit, rounded for reading only. */
const HALF_NM2_PER_SQ_FT = 2n * NM_PER_FOOT * NM_PER_FOOT;

export function squareFeet(halfNm2: bigint, places = 1): string {
  const scale = 10n ** BigInt(places);
  const scaled = (halfNm2 * scale + HALF_NM2_PER_SQ_FT / 2n) / HALF_NM2_PER_SQ_FT;
  return `${Number(scaled) / Number(scale)}`;
}

/**
 * Whether anybody actually stood behind the thicknesses, or the room is running
 * on a default somebody tapped once.
 */
export function thicknessProvenance(room: Room): 'measured' | 'stated' | 'missing' {
  const walls = room.walls.filter((w) => !w.open);
  const values = walls.map((w) => thicknessOf(w, room));
  if (values.some((v) => v === undefined)) return 'missing';
  return values.every((v) => isVerified(v!) && provenanceMethod(v!) === 'tape')
    ? 'measured'
    : 'stated';
}

function provenanceMethod(m: Measurement): string {
  return m.provenance.kind === 'verified' ? m.provenance.method : m.provenance.kind;
}
