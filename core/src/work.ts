import { type Nanometres, NM_PER_MM } from './length.ts';
import type { PriceBook, PriceUnit, Rate } from './price.ts';
import { type Room, RoomError, area } from './room.ts';
import { type WallQuantities, byWall, wholeRoom } from './zone.ts';
import { type Measurement, isVerified, scanned } from './measurement.ts';
import { linearFeet, squareFeet, squareFeetOfHalves, typedAmount } from './quantity.ts';

/**
 * What is actually being done, surface by surface — and the reason this had to
 * exist before anything else.
 *
 * > "How are we costing everything down like it all needs to be replaced by
 * >  each line item? Maybe have an area inside each wall page when you click on
 * >  it with what is actually being done, and figure out how to let the user
 * >  pick or decide that. And if there's things not in the costing option yet,
 * >  let them make it and it also goes into their cost options."
 *
 * The takeoff priced a room as if every square foot of it came out: the whole
 * floor, the whole ceiling, every wall face, all the baseboard. On a real
 * remodel that is almost never true. Three walls get boarded and the fourth is
 * left alone. The ceiling is paint only. The floor comes out and the base goes
 * back on. A sheet that cannot say that is a sheet a contractor corrects in a
 * spreadsheet, and then the app is a drawing app.
 *
 * Three rules hold the whole module up, and every one of them is the same rule
 * the measurements already follow.
 *
 * 1. **A scope is a record, not a filter.** It says who decided and when, it is
 *    saved with the job, and it is what a change order is measured against. It
 *    is not a set of checkboxes that hides rows on a screen. Hiding a row and
 *    deciding not to do the work look identical for about a week, and then
 *    somebody bills for the wall they were not doing.
 *
 * 2. **Unselected is absent, never zero.** A line reading `0.0 sq ft` is a
 *    claim — it says the work is in the job and costs nothing. Work that is not
 *    happening produces no line at all, and the surfaces nobody picked anything
 *    on are *named* on the sheet, so leaving a wall alone reads as a decision
 *    rather than as something forgotten.
 *
 * 3. **A quantity is never invented.** Everything here is a stretch of a wall
 *    the geometry already measured, or a number a person typed and which says
 *    on the sheet that a person typed it. There is no third kind.
 *
 * ## Where the choices come from
 *
 * Not from an enum in this file. They come from the contractor's own rate book
 * — `Company.prices.rates` — plus the handful of items the takeoff has always
 * produced. A rate he adds tonight is something he can select on a wall
 * tomorrow, on every job afterwards, forever. That is the compounding the
 * product is for: after ten jobs the book is genuinely his and nobody else's.
 *
 * The one thing a home-made item needs beyond a name, a unit and a price is
 * **where its quantity comes from**. "Skim coat, sq ft" is worth nothing until
 * the app knows it is charged against a wall's face; then it moves when the
 * wall moves, which is the entire point of measuring the room in the first
 * place. So an item names a `Measure`, and a measure is a thing this room can
 * actually produce.
 */

export class WorkError extends RoomError {}

/* ------------------------------------------------------------- surfaces */

/**
 * A thing a decision gets made about.
 *
 * A wall face, the floor, or the ceiling. Deliberately not "a wall": a wall
 * carries a face, a run of baseboard and the openings in it, and a contractor
 * boarding a wall while reusing its base is making two different decisions
 * about one wall. Both live on the same surface here and are separate items on
 * it, which is what lets them be picked apart.
 */
export type SurfaceKind = 'wall' | 'floor' | 'ceiling';

export type Surface =
  | { readonly kind: 'wall'; readonly wallId: string }
  | { readonly kind: 'floor' }
  | { readonly kind: 'ceiling' };

/**
 * A surface as one string, because that is what a saved file and a lookup want.
 *
 * `wall:north`, `floor`, `ceiling`. Legible in a file somebody opens, which is
 * the same reason lengths are saved as tagged decimal strings rather than as
 * something clever.
 */
export function surfaceKey(surface: Surface): string {
  return surface.kind === 'wall' ? `wall:${surface.wallId}` : surface.kind;
}

export function readSurface(key: string): Surface {
  if (key === 'floor' || key === 'ceiling') return { kind: key };
  if (key.startsWith('wall:')) return { kind: 'wall', wallId: key.slice(5) };
  throw new WorkError(`"${key}" does not name a surface of a room.`);
}

/** What a surface is called on a sheet a person reads. */
export function surfaceName(surface: Surface): string {
  return surface.kind === 'wall' ? surface.wallId : `the ${surface.kind}`;
}

/**
 * Every surface of a room that work can be picked on.
 *
 * A wall with nothing built across it — a garage door opening, a wide span into
 * the next room — is not one. There is no face there to board and no base to
 * run, and offering it would be offering to price a hole.
 */
export function surfacesOf(room: Room): readonly Surface[] {
  return [
    { kind: 'floor' as const },
    { kind: 'ceiling' as const },
    ...room.walls.filter((wall) => !wall.open).map((wall) => ({ kind: 'wall' as const, wallId: wall.id })),
  ];
}

/**
 * The ceiling, as the one surface every room has and no wall carries.
 *
 * Written once here rather than as `{ kind: 'ceiling' }` in each screen that
 * wants it. Three copies of a literal is how the plan and the panel end up
 * filing a decision under two different keys.
 */
export const CEILING: Surface = { kind: 'ceiling' };

/* -------------------------------------------------------------- measures */

/**
 * Where a quantity comes from.
 *
 * The list is short on purpose. Every entry is something this room genuinely
 * measures, and there is nothing on it that would have to be estimated — no
 * days, no dumpsters, no crew sizes. Those are judgements somebody standing in
 * the building makes, and an app that printed a number for one would be wrong
 * the first time the job was on the second floor.
 *
 * `typed` is the honest way out: a number the contractor writes down himself,
 * which does not move when the room does and says so on the sheet.
 */
export type MeasureId =
  | 'wall face'
  | 'wall run'
  | 'baseboard'
  | 'doors'
  | 'windows'
  | 'cased'
  | 'openings'
  | 'floor area'
  | 'ceiling area'
  | 'typed';

export interface Measure {
  readonly id: MeasureId;
  /** What it is called where somebody picks it. */
  readonly label: string;
  readonly unit: PriceUnit;
  /** Which surfaces can produce it. A floor has no baseboard of its own. */
  readonly surfaces: readonly SurfaceKind[];
  /** The sentence that goes under the line, so nobody reverse-engineers it. */
  readonly workings: string;
}

export const MEASURES: readonly Measure[] = [
  {
    id: 'wall face',
    label: 'the face of the wall, less its openings',
    unit: 'sq ft',
    surfaces: ['wall'],
    workings: 'the wall face, its height less every door and window in it',
  },
  {
    id: 'wall run',
    label: 'how long the wall is, corner to corner',
    unit: 'lf',
    surfaces: ['wall'],
    workings: 'the whole run of the wall, openings included',
  },
  {
    id: 'baseboard',
    label: 'the run along the floor, less doors and cased openings',
    unit: 'lf',
    surfaces: ['wall'],
    workings: 'the wall at the floor, less doors and cased openings; base runs under a window',
  },
  {
    id: 'doors',
    label: 'doors in the wall',
    unit: 'ea',
    surfaces: ['wall'],
    workings: 'counted off the wall',
  },
  {
    id: 'windows',
    label: 'windows in the wall',
    unit: 'ea',
    surfaces: ['wall'],
    workings: 'counted off the wall',
  },
  {
    id: 'cased',
    label: 'cased openings in the wall',
    unit: 'ea',
    surfaces: ['wall'],
    workings: 'counted off the wall',
  },
  {
    id: 'openings',
    label: 'every opening in the wall — doors, windows and cased',
    unit: 'ea',
    surfaces: ['wall'],
    workings: 'every opening in the wall, whatever kind',
  },
  {
    id: 'floor area',
    label: 'the floor',
    unit: 'sq ft',
    surfaces: ['floor'],
    workings: 'the floor outline',
  },
  {
    id: 'ceiling area',
    label: 'the ceiling',
    unit: 'sq ft',
    surfaces: ['ceiling'],
    workings: 'follows the floor',
  },
  {
    id: 'typed',
    label: 'a number you type',
    unit: 'ea',
    surfaces: ['wall', 'floor', 'ceiling'],
    workings: 'a number typed by hand — it does not move when the room does',
  },
];

export function measureById(id: MeasureId): Measure {
  const found = MEASURES.find((m) => m.id === id);
  if (!found) throw new WorkError(`"${id}" is not a way this app measures anything.`);
  return found;
}

/** True when this measure can be picked on this kind of surface. */
export function measureFits(measure: Measure, kind: SurfaceKind): boolean {
  return measure.surfaces.includes(kind);
}

/* ----------------------------------------------------------- work items */

/**
 * Something that can be picked on a surface: a name, a unit, and where the
 * quantity comes from.
 *
 * `typed` is the only measure that carries an `amount`, and it carries it on
 * the item rather than on each pick, deliberately. "Protect and mask — 1 ea"
 * means one per surface it is put on; putting the number on the item keeps the
 * scope a list of decisions rather than a list of numbers, and keeps the number
 * in the one place a contractor goes to change it.
 */
export interface WorkItem {
  /** Matches a rate's item and a takeoff line's name, so a sheet prices itself. */
  readonly item: string;
  readonly unit: PriceUnit;
  readonly measure: MeasureId;
  /** What trades price off it. Printed on the sheet. */
  readonly prices: string;
  /** Set for an item the contractor invented, so a screen can say whose it is. */
  readonly own?: true;
  /** For a `typed` measure, the number, per surface it is picked on. */
  readonly amount?: string;
}

/**
 * The items the takeoff has always produced, with the measure each runs on.
 *
 * These are offered whether or not a rate has been set against them: they are
 * what the room measures, and an item with no rate is named as unpriced further
 * down the line rather than being hidden here. Hiding it would mean a
 * contractor could not scope a wall until he had typed a price for it, which is
 * backwards — he decides what he is doing first and what it costs second.
 *
 * The names match `takeoff.ts` exactly, which is what makes a rate somebody
 * typed last March keep working the day this arrives.
 */
export const KNOWN_WORK: readonly WorkItem[] = [
  { item: 'Floor', unit: 'sq ft', measure: 'floor area', prices: 'flooring, tile, underlay' },
  { item: 'Ceiling', unit: 'sq ft', measure: 'ceiling area', prices: 'ceiling drywall, paint' },
  { item: 'Wall face', unit: 'sq ft', measure: 'wall face', prices: 'drywall, paint, primer' },
  { item: 'Baseboard', unit: 'lf', measure: 'baseboard', prices: 'base, shoe, trim' },
  { item: 'Doors', unit: 'ea', measure: 'doors', prices: 'slabs, jambs, casing, hardware' },
  { item: 'Windows', unit: 'ea', measure: 'windows', prices: 'glazing, trim' },
  { item: 'Cased openings', unit: 'ea', measure: 'cased', prices: 'jamb and casing' },
];

const key = (item: string, unit: string) => `${item}|${unit}`;

/**
 * Everything this contractor can pick, his own items included.
 *
 * The app's own list first, in the order a sheet reads, then whatever he has
 * invented, in the order he invented it. A rate in the book that names no
 * measure is not offered — it is one of the framing items priced off the wall
 * build-up (plates, studs, headers, jambs), which follow the walls that have
 * been given a thickness rather than anything picked on a surface.
 */
export function workItems(book: PriceBook): readonly WorkItem[] {
  const known = new Set(KNOWN_WORK.map((w) => key(w.item, w.unit)));
  const own: WorkItem[] = [];
  for (const rate of book.rates) {
    if (rate.measure === undefined || known.has(key(rate.item, rate.unit))) continue;
    // A saved book is a file, and a file can hold a word this version does not
    // know — an item invented in a later version, opened in an earlier one.
    // Skipped rather than crashing the price screen: the rate is still in the
    // book and still prices a line by name, it is just not offered on a wall.
    if (!MEASURES.some((m) => m.id === rate.measure)) continue;
    const item: WorkItem = {
      item: rate.item,
      unit: rate.unit,
      measure: rate.measure as MeasureId,
      prices: rate.note?.trim() || 'your own item',
      own: true,
      ...(rate.amount === undefined ? {} : { amount: rate.amount }),
    };
    try {
      validateItem(item);
    } catch {
      // Same reasoning: a rate that cannot be picked is not a reason to take
      // the screen down. It stays in the book and stays out of the wall panel.
      continue;
    }
    own.push(item);
  }
  return [...KNOWN_WORK, ...own];
}

/**
 * Refuses an item somebody could not defend, before it reaches a rate book.
 *
 * Everything checked here is something that would otherwise be found by
 * reading a quote: an item with no name, a unit that does not match how it is
 * measured, a typed quantity that is not a number.
 */
export function validateItem(item: WorkItem): void {
  if (item.item.trim() === '') {
    throw new WorkError('An item needs a name — it is what goes on the sheet the client reads.');
  }
  const measure = measureById(item.measure);
  if (item.measure !== 'typed' && measure.unit !== item.unit) {
    throw new WorkError(
      `"${item.item}" is charged by the ${item.unit} but measured as ${measure.label}, which is ` +
        `${measure.unit}. A rate in one unit against a quantity in another is how a square foot ` +
        `becomes a linear foot three steps later.`
    );
  }
  if (item.measure === 'typed') {
    if (item.amount === undefined || !/^\d+(\.\d{1,2})?$/.test(item.amount.trim())) {
      throw new WorkError(
        `"${item.item}" takes a number you type, so it needs one: whole numbers, or a decimal to ` +
          `two places — the same shape the sheet prints.`
      );
    }
    if (Number(item.amount) === 0) {
      throw new WorkError(
        `"${item.item}" would be zero of something. Leave it off the job rather than putting it ` +
          `on at nothing — a zero line reads as work priced at no cost.`
      );
    }
  }
}

/** A work item as a rate ready for the book, so inventing one is one action. */
export function rateFor(item: WorkItem, cents: bigint, by: string, at: string): Rate {
  validateItem(item);
  return {
    item: item.item.trim(),
    unit: item.unit,
    cents,
    source: { kind: 'typed', by, at },
    measure: item.measure,
    ...(item.amount === undefined ? {} : { amount: item.amount.trim() }),
    ...(item.prices.trim() === '' ? {} : { note: item.prices.trim() }),
  };
}

/* ----------------------------------------------------------------- scope */

/** One thing being done, named the way a rate is named. */
export interface Pick {
  readonly item: string;
  readonly unit: PriceUnit;
}

/**
 * What is being done to this room, and who said so.
 *
 * A record with a signature on it, exactly like a measurement. Somebody decided
 * that the north wall is being left alone; three weeks later that is either a
 * thing they can point at or an argument.
 */
export interface WorkScope {
  /** Surface key — see `surfaceKey` — to the items picked on it. */
  readonly picked: Readonly<Record<string, readonly Pick[]>>;
  readonly setBy: string;
  readonly setAt: string;
}

export function picksOn(scope: WorkScope, surface: Surface): readonly Pick[] {
  return scope.picked[surfaceKey(surface)] ?? [];
}

export function isPicked(scope: WorkScope, surface: Surface, item: WorkItem): boolean {
  return picksOn(scope, surface).some((p) => p.item === item.item && p.unit === item.unit);
}

/** The scope with one item turned on for one surface. Adding twice adds once. */
export function pick(scope: WorkScope, surface: Surface, item: WorkItem, by: string, at: string): WorkScope {
  if (isPicked(scope, surface, item)) return scope;
  const k = surfaceKey(surface);
  return {
    picked: { ...scope.picked, [k]: [...(scope.picked[k] ?? []), { item: item.item, unit: item.unit }] },
    setBy: by,
    setAt: at,
  };
}

/** The scope with one item turned off for one surface. */
export function drop(scope: WorkScope, surface: Surface, item: WorkItem, by: string, at: string): WorkScope {
  const k = surfaceKey(surface);
  const rest = (scope.picked[k] ?? []).filter((p) => !(p.item === item.item && p.unit === item.unit));
  const picked = { ...scope.picked };
  // Deleted rather than left as an empty list, so "nobody has decided about
  // this surface yet" and "somebody decided nothing is happening to it" stay
  // different states. They read the same on a sheet and they are not the same.
  if (rest.length === 0) delete picked[k];
  else picked[k] = rest;
  return { picked, setBy: by, setAt: at };
}

/**
 * Everything, on everything — the room as the takeoff has always priced it.
 *
 * What a contractor taps when the room really is coming out to the studs, and
 * what "leave it as it was" means for a job that already had a scope.
 *
 * **"Everything" means the sheet this app has always printed, and nothing
 * more.** The contractor's own items are left out, and so is anything measured
 * by a number he types. That is not a technicality — it is what makes the
 * control safe to press. A room nobody has scoped is priced as a full
 * replacement, and saying "I want to say what is being done" has to leave the
 * quote exactly where it was, so that the only thing which ever moves a number
 * is somebody deciding something. If tapping it quietly added a skim coat to
 * thirteen surfaces and a delivery charge to each of them, the very first thing
 * it did would be the thing nobody asked for.
 *
 * So his own items start unticked, and go on a wall because he put them there.
 */
export function everything(room: Room, items: readonly WorkItem[], by: string, at: string): WorkScope {
  const picked: Record<string, Pick[]> = {};
  for (const surface of surfacesOf(room)) {
    const fits = items.filter(
      (item) =>
        item.own !== true &&
        item.measure !== 'typed' &&
        measureFits(measureById(item.measure), surface.kind)
    );
    if (fits.length > 0) {
      picked[surfaceKey(surface)] = fits.map((item) => ({ item: item.item, unit: item.unit }));
    }
  }
  return { picked, setBy: by, setAt: at };
}

/** The scope of a room where nothing has been decided yet. */
export function nothing(by: string, at: string): WorkScope {
  return { picked: {}, setBy: by, setAt: at };
}

/* ------------------------------------------------------------ the lines */

/**
 * A priceable line, and the surfaces it came off.
 *
 * `from` is the part that is new and the part that matters. "460.5 sq ft of
 * wall face" is a number a contractor cannot check; "460.5 sq ft of wall face,
 * from south, east and west" is one he can walk the room with. It is the same
 * argument as provenance: a quantity that does not say where it came from is a
 * quantity nobody can stand behind.
 */
export interface WorkLine {
  readonly what: string;
  readonly quantity: string;
  readonly unit: PriceUnit;
  readonly prices: string;
  readonly workings: string;
  readonly provenance: 'measured' | 'scanned';
  /** The surfaces this quantity was added up from, in the room's own order. */
  readonly from: readonly string[];
  /** The same number, exact, for a screen that shows metric. See `Exact`. */
  readonly exact: Exact;
}

/**
 * A line's quantity in the unit the model keeps it in, beside the feet the
 * sheet prints.
 *
 * The takeoff writes feet, because the text and the CSV go to a lumber yard.
 * The screen follows whichever units the contractor set, and it used to convert
 * by reaching back to `roomQuantities` and re-rendering the WHOLE room's floor,
 * ceiling, wall face and baseboard over the top of the line names — which was
 * harmless while every sheet was the whole room and became a lie the moment one
 * was not. A scoped sheet re-rendered that way would show three walls' worth of
 * money against four walls' worth of area.
 *
 * So the exact value travels on the line. A count is `count` and is not
 * converted, because a door is one door in any country; a typed quantity is the
 * contractor's own number and converting it would be inventing one.
 */
export type Exact =
  /** In the doubled unit `area()` keeps, so it converts like any other area. */
  | { readonly kind: 'area'; readonly halfSquares: bigint }
  | { readonly kind: 'run'; readonly nanometres: Nanometres }
  | { readonly kind: 'count' };

function exactOf(tally: Tally): Exact {
  switch (tally.kind) {
    // A wall face is plain square nanometres and an area is the doubled unit.
    case 'squares':
      return { kind: 'area', halfSquares: 2n * tally.value };
    case 'halfSquares':
      return { kind: 'area', halfSquares: tally.value };
    case 'run':
      return { kind: 'run', nanometres: tally.value };
    case 'count':
    case 'typed':
      return { kind: 'count' };
  }
}

export interface WorkSheet {
  readonly lines: readonly WorkLine[];
  /**
   * Surfaces with nothing picked on them, named.
   *
   * A wall being left alone is a decision, and a decision that produces no line
   * anywhere is indistinguishable from an oversight. This is how the sheet says
   * "you are not doing anything to the north wall" out loud.
   */
  readonly untouched: readonly string[];
  /**
   * Items picked on a surface that measures none of them, named.
   *
   * Somebody ticked Doors on a wall with no doors in it. That is worth saying —
   * it is either a door the scan missed or a tick in the wrong place — and it
   * must not become a `0 ea` line, which reads as a door being fitted for
   * nothing.
   */
  readonly measuresNothing: readonly string[];
  /**
   * Work picked on a surface the room no longer has, named.
   *
   * A wall gets deleted, renamed, or turned into an open span, and everything
   * somebody decided about it stops applying. The quote changes and nothing
   * says why — which is exactly the failure `applyOverrides` reports as
   * `stranded`, in exactly the same words, for exactly the same reason: a
   * number that quietly moved is worse than a number that is wrong, because
   * nobody goes looking for it.
   */
  readonly stranded: readonly string[];
}

/** How a quantity is being accumulated. One item, one kind, always. */
type Tally =
  | { kind: 'squares'; value: bigint }
  | { kind: 'halfSquares'; value: bigint }
  | { kind: 'run'; value: Nanometres }
  | { kind: 'count'; value: number }
  | { kind: 'typed'; value: bigint };

/**
 * What an item starts at before any surface has been added to it.
 *
 * The kind comes from the measure and never from the unit, because two items
 * both charged by the square foot are kept in different units underneath: a
 * wall face is plain square nanometres and a floor is the doubled unit the
 * shoelace produces. Adding one to the other would be off by a factor of two
 * and would look entirely plausible on a sheet.
 */
function emptyTally(measure: MeasureId): Tally {
  switch (measure) {
    case 'wall face':
      return { kind: 'squares', value: 0n };
    case 'floor area':
    case 'ceiling area':
      return { kind: 'halfSquares', value: 0n };
    case 'wall run':
    case 'baseboard':
      return { kind: 'run', value: 0n };
    case 'typed':
      return { kind: 'typed', value: 0n };
    default:
      return { kind: 'count', value: 0 };
  }
}

/** One surface's share, added on. The kinds cannot be crossed by construction. */
function plus(tally: Tally, share: bigint | number): Tally {
  switch (tally.kind) {
    case 'count':
      return { kind: 'count', value: tally.value + Number(share) };
    case 'squares':
      return { kind: 'squares', value: tally.value + BigInt(share) };
    case 'halfSquares':
      return { kind: 'halfSquares', value: tally.value + BigInt(share) };
    case 'run':
      return { kind: 'run', value: tally.value + BigInt(share) };
    case 'typed':
      return { kind: 'typed', value: tally.value + BigInt(share) };
  }
}

function show(tally: Tally): string {
  switch (tally.kind) {
    case 'squares':
      return squareFeet(tally.value);
    case 'halfSquares':
      return squareFeetOfHalves(tally.value);
    case 'run':
      return linearFeet(tally.value);
    case 'count':
      return String(tally.value);
    case 'typed':
      return typedAmount(tally.value);
  }
}

function isZero(tally: Tally): boolean {
  return tally.kind === 'count' ? tally.value === 0 : tally.value === 0n;
}

/** What one surface contributes to one item, exactly, in that item's own unit. */
function contribution(
  item: WorkItem,
  surface: Surface,
  room: Room,
  walls: ReadonlyMap<string, WallQuantities>
): bigint | number {
  if (item.measure === 'typed') {
    const text = (item.amount ?? '').trim();
    const [whole, fraction = ''] = text.split('.');
    return BigInt(whole || '0') * 100n + BigInt(fraction.padEnd(2, '0') || '0');
  }
  if (surface.kind === 'floor' || surface.kind === 'ceiling') {
    // Both follow the room's outline, which is what `area()` returns and what
    // the takeoff has always printed for them.
    return area(room).value;
  }
  const q = walls.get(surface.wallId);
  // A wall in the scope that is no longer in the room. It contributes nothing
  // rather than throwing: a contractor who deletes a wall he had scoped should
  // get a sheet, and the surface simply stops appearing on it.
  if (!q) return 0n;
  switch (item.measure) {
    case 'wall face':
      return q.wallFaceArea;
    case 'wall run':
      return q.run;
    case 'baseboard':
      return q.baseboardRun;
    case 'doors':
      return q.doors;
    case 'windows':
      return q.windows;
    case 'cased':
      return q.cased;
    case 'openings':
      return q.doors + q.windows + q.cased;
    default:
      return 0n;
  }
}

/**
 * The walls a line's provenance depends on.
 *
 * A wall face depends on the wall it is on. A floor depends on every wall in
 * the room, because the outline is what closes it — re-measure any one of them
 * and the floor area moves.
 */
function wallsBehind(surface: Surface, room: Room): readonly string[] {
  return surface.kind === 'wall' ? [surface.wallId] : room.walls.map((w) => w.id);
}

/**
 * The sheet, counting only what somebody said was being done.
 *
 * `roomProvenance` is the ceiling and never the answer on its own. A room that
 * has had no tape on it makes every line scanned, whatever the walls say. A
 * room that *has* been measured still produces a scanned line wherever one of
 * the walls behind it is the sensor's own number — because "put a tape on one
 * wall running each way" is what makes a room's shape trustworthy, and it is
 * not a promise about the wall nobody touched.
 */
export function workSheet(
  room: Room,
  scope: WorkScope,
  items: readonly WorkItem[],
  roomProvenance: 'measured' | 'scanned'
): WorkSheet {
  const walls = new Map(byWall(wholeRoom(room), room).map((q) => [q.wallId, q]));
  const verified = new Map(room.walls.map((w) => [w.id, isVerified(w.length)]));
  const byName = new Map(items.map((item) => [key(item.item, item.unit), item]));

  const totals = new Map<
    string,
    { item: WorkItem; tally: Tally; from: string[]; measured: boolean }
  >();
  const untouched: string[] = [];
  const measuresNothing: string[] = [];

  // Anything the scope names that this room does not have any more. Gathered
  // before the lines are built, because a stranded pick contributes to nothing
  // and would otherwise leave no trace at all.
  const here = new Set(surfacesOf(room).map(surfaceKey));
  const stranded: string[] = [];
  for (const [key_, picks] of Object.entries(scope.picked)) {
    if (here.has(key_) || picks.length === 0) continue;
    let named: string;
    try {
      named = surfaceName(readSurface(key_));
    } catch {
      // A key this version cannot read at all — a file from somewhere else.
      // Reported as it was written rather than dropped.
      named = key_;
    }
    stranded.push(`${picks.map((p) => p.item).join(', ')} on ${named}`);
  }

  for (const surface of surfacesOf(room)) {
    const picks = picksOn(scope, surface);
    if (picks.length === 0) {
      untouched.push(surfaceName(surface));
      continue;
    }
    for (const p of picks) {
      const item = byName.get(key(p.item, p.unit));
      // A pick naming an item that is no longer offered — a rate deleted from
      // the book. Named rather than silently dropped, through the same list as
      // a pick that measures nothing, because both are "you asked for this and
      // it is not on the sheet".
      if (!item) {
        measuresNothing.push(`${p.item} on ${surfaceName(surface)} — no such item any more`);
        continue;
      }
      const share = contribution(item, surface, room, walls);
      const k = key(item.item, item.unit);
      const running =
        totals.get(k) ?? { item, tally: emptyTally(item.measure), from: [], measured: true };
      running.tally = plus(running.tally, share);
      running.from.push(surfaceName(surface));
      if (!wallsBehind(surface, room).every((id) => verified.get(id) === true)) {
        running.measured = false;
      }
      totals.set(k, running);
    }
  }

  const lines: WorkLine[] = [];
  // In the order the items were offered, so a sheet reads the same way twice
  // and the contractor's own items sit under the app's rather than wherever
  // the first wall happened to put them.
  for (const item of items) {
    const running = totals.get(key(item.item, item.unit));
    if (!running) continue;
    if (isZero(running.tally)) {
      measuresNothing.push(
        `${item.item} on ${running.from.join(', ')} — picked, and there is none of it there`
      );
      continue;
    }
    const measure = measureById(item.measure);
    lines.push({
      what: item.item,
      quantity: show(running.tally),
      unit: item.unit,
      prices: item.prices,
      workings: `${measure.workings} — ${running.from.join(', ')}`,
      provenance: roomProvenance === 'measured' && running.measured ? 'measured' : 'scanned',
      from: running.from,
      exact: exactOf(running.tally),
    });
  }

  return { lines, untouched, measuresNothing, stranded };
}

/**
 * What one surface would contribute of one item, in that item's own unit.
 *
 * For the wall panel, where somebody deciding whether this wall gets boarded
 * wants to see the 160 sq ft he is deciding about. It is the same arithmetic
 * `workSheet` adds up — asked for one surface rather than derived a second time
 * — so the number beside the tick box and the number on the sheet cannot
 * disagree.
 *
 * Zero comes back as an empty string rather than as "0", deliberately. A wall
 * with no door in it should not be offered "Doors — 0 ea" as though the answer
 * were a quantity; the tick box simply carries no number, and picking it lands
 * in `measuresNothing` where it is named.
 */
export function amountOn(room: Room, surface: Surface, item: WorkItem): string {
  const walls = new Map(byWall(wholeRoom(room), room).map((q) => [q.wallId, q]));
  const tally = plus(emptyTally(item.measure), contribution(item, surface, room, walls));
  return isZero(tally) ? '' : show(tally);
}

/**
 * How much ceiling there is, in the words the sheet uses.
 *
 * The ceiling panel has to print an area, and there are two numbers it could
 * print: one worked out on the panel, and the one the takeoff has always
 * charged against `Ceiling`. Those must never be two numbers, so this asks the
 * same arithmetic the sheet asks — `amountOn`, against the takeoff's own
 * ceiling line — rather than doing the multiplication a second time.
 */
export function ceilingArea(room: Room): string {
  return amountOn(room, CEILING, CEILING_ITEM);
}

/** The takeoff's ceiling line, looked up once rather than searched per render. */
const CEILING_ITEM: WorkItem = KNOWN_WORK.find((item) => item.item === 'Ceiling')!;

/** The items that can be picked on this kind of surface, in the order offered. */
export function itemsFor(items: readonly WorkItem[], kind: SurfaceKind): readonly WorkItem[] {
  return items.filter((item) => measureFits(measureById(item.measure), kind));
}

/**
 * What a scope says, in one sentence, for a screen or a sheet.
 *
 * Never "3 of 6 surfaces": a fraction reads like progress towards filling
 * something in, and a contractor who has deliberately left three walls alone
 * has not left the form half-done.
 */
export function describeScope(room: Room, scope: WorkScope): string {
  const surfaces = surfacesOf(room);
  const touched = surfaces.filter((s) => picksOn(scope, s).length > 0);
  if (touched.length === 0) {
    return 'Nothing is picked yet, so this sheet has nothing on it. Open a wall and say what is being done to it.';
  }
  const left = surfaces.filter((s) => picksOn(scope, s).length === 0).map(surfaceName);
  return (
    `Counting only what is being done: ${touched.map(surfaceName).join(', ')}.` +
    (left.length === 0
      ? ' Every surface in the room has work on it.'
      : ` Nothing is being done to ${left.join(', ')}, so ${left.length === 1 ? 'it is' : 'they are'} ` +
        `not on this sheet at all — left out rather than priced at nothing.`)
  );
}

/* --------------------------------------- measured by pointing a phone at it */

/**
 * Something on a surface, measured point to point in the air.
 *
 * > "ON THE 3D MODEL I TOLD YOU THAT I DIDNT WANT THE CEILING BEING RENDERED
 * >  AND ITS GREAT, BUT WHAT IF I HAVE TO SCAN A CEILING OR POINT IT UP TO
 * >  SOMETHING SIMILAR, HOW WOULD THAT WORK?"
 *
 * The AR Measure screen has measured between two points in space since it was
 * built, so pointing the phone up at a soffit already produces the right
 * number. What it has never had is anywhere to put it: the reading is shown on
 * the camera screen and then thrown away when the screen closes. Somebody
 * measures the drop on a beam, walks to the next room, and the figure is gone.
 *
 * So a span is recorded against the surface it was taken on — the same
 * `surfaceKey` a scope is filed under, so a ceiling has one identity in this
 * app and not two.
 *
 * ## Why it is a `Measurement` and never a tape reading
 *
 * A tape on a wall is `verified`: somebody put a tape on it and signed for the
 * number. ARKit did not. A span comes off a moving camera and a depth estimate
 * and it carries a real band, so it is recorded exactly as the scan itself is
 * recorded — `scanned`, with the sensor named and its tolerance on it. That is
 * what stops it being quietly promoted into the ceiling height, where it would
 * multiply every square foot of board in the room.
 *
 * ## Why it moves no number
 *
 * Nothing in `workSheet` reads one. A soffit that is 14 inches deep is a fact
 * about the building that a carpenter needs and the takeoff has no opinion
 * about, and the moment a measurement like this started feeding a quantity, a
 * contractor pointing his phone at something to find out how big it was would
 * be changing his own quote by accident.
 */
export interface SurfaceMeasure {
  /** Unique within the room. The phone names the reading; nothing derives it. */
  readonly id: string;
  /** Which surface it was taken on — see `surfaceKey`. */
  readonly surface: string;
  /** What was measured, in the words of whoever was standing there. */
  readonly what: string;
  /** How long it is, with where the number came from and its band. */
  readonly length: Measurement;
}

/**
 * The spans taken on one surface, oldest first.
 *
 * Oldest first for the same reason `notesOnWall` is: this is somebody working
 * their way round a room, and the order they did it in is the order it makes
 * sense in. Newest-first is right for a list of files and wrong for a visit.
 */
export function measuresOn(
  measures: readonly SurfaceMeasure[],
  surface: Surface
): readonly SurfaceMeasure[] {
  const wanted = surfaceKey(surface);
  return measures
    .filter((measure) => measure.surface === wanted)
    .sort((a, b) => (takenAt(a) === takenAt(b) ? a.id.localeCompare(b.id) : takenAt(a) < takenAt(b) ? -1 : 1));
}

/** When a span was taken, for ordering. Its provenance is the only record. */
function takenAt(measure: SurfaceMeasure): string {
  const p = measure.length.provenance;
  return p.kind === 'scanned' ? p.capturedAt : p.kind === 'verified' ? p.verifiedAt : '';
}

/**
 * What the phone sends when somebody points it at something and keeps the
 * reading.
 *
 * Whole millimetres as a string, and that is not fussiness. ARKit works in
 * float metres; every other float coming off Apple's frameworks is quantised
 * at this boundary — see `Damage.milliseconds` and the photo manifest — and a
 * measurement of a building is the last place in this app where a float would
 * be allowed to survive. The phone rounds once, to the millimetre, and what
 * crosses is an integer written down.
 */
export interface SpanFromPhone {
  readonly id: string;
  /** A surface key: `ceiling`, `floor`, or `wall:north`. */
  readonly surface: string;
  readonly what: string;
  /** Whole millimetres, as digits. */
  readonly millimetres: string;
  /** The band on it, whole millimetres, as digits. Never omitted. */
  readonly toleranceMillimetres: string;
  /** ISO 8601, from the phone's clock. */
  readonly at: string;
  /** What took it, e.g. `arkit`. Printed wherever the number is. */
  readonly sensor: string;
}

/**
 * One reading off the phone, turned into a record of this room — or refused.
 *
 * Read here, at the point the panel shows it, rather than trusted. A payload
 * from a newer build of the app can name a surface this one has never heard
 * of, and the failure that must not happen is a measurement landing in the
 * room silently attached to nothing: it would be in the file, on no screen,
 * and gone the next time somebody saved. Refusing it out loud is the only
 * version anybody can act on.
 */
export function readSurfaceMeasure(room: Room, raw: SpanFromPhone): SurfaceMeasure {
  if (raw.id.trim() === '') {
    throw new WorkError('That reading has no id, so nothing could ever show it twice the same.');
  }
  const surface = readSurface(raw.surface);
  const here = new Set(surfacesOf(room).map(surfaceKey));
  if (!here.has(raw.surface)) {
    throw new WorkError(
      `That reading was taken on ${surfaceName(surface)}, and "${room.name}" has no such ` +
        `surface. A measurement filed against something that is not there is a measurement ` +
        `nobody will ever see again.`
    );
  }
  if (raw.what.trim() === '') {
    throw new WorkError(
      'That reading does not say what was measured. A number on its own is not a measurement of ' +
        'anything — three weeks later nobody knows whether it was the soffit or the beam.'
    );
  }
  const value = wholeMillimetres(raw.millimetres, 'how long it is');
  if (value === 0n) {
    throw new WorkError('That reading is nothing long. Two taps in the same place measured no distance.');
  }
  const tolerance = wholeMillimetres(raw.toleranceMillimetres, 'the band on it');
  if (tolerance === 0n) {
    throw new WorkError(
      'That reading claims to be exact. A span off a camera has a band on it, and one that says ' +
        'otherwise would outrank a tape on every screen that compares them.'
    );
  }
  return {
    id: raw.id.trim(),
    surface: raw.surface,
    what: raw.what.trim(),
    length: scanned(value, tolerance, raw.at, raw.sensor),
  };
}

/** Whole millimetres as digits, into exact nanometres. Nothing else is taken. */
function wholeMillimetres(text: string, field: string): Nanometres {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new WorkError(
      `"${text}" is not ${field}. The phone sends whole millimetres as digits, because rounding ` +
        `once on the device is the only place a float is allowed to become a measurement.`
    );
  }
  return BigInt(trimmed) * NM_PER_MM;
}
