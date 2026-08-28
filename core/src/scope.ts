import { type Nanometres, NM_PER_FOOT } from './length.ts';
import { type Room, RoomError } from './room.ts';
import { readiness, trustLabel } from './issue.ts';
import { type Cents, type PriceBook, type PricedLine, quote } from './price.ts';
import {
  type Damage,
  type DamageQuantity,
  WATER_CATEGORY,
  damageQuantity,
} from './damage.ts';

/**
 * What it takes to put the damage right, kept apart from what the room takes.
 *
 * Two sheets, deliberately, and never one. A remodel takeoff answers "what does
 * this room need". A damage scope answers "what does this loss need". They are
 * priced by different people out of different money — one by a homeowner and one
 * by a carrier — and a single sheet holding both is a sheet somebody bills the
 * wrong party off. So the takeoff is untouched by any of this, and this module
 * produces its own lines, its own text and its own CSV.
 *
 * **Every quantity here comes from the geometry, and nothing else is invented.**
 * There is no equipment count, no drying-day estimate and no dumpster size in
 * here, because none of those come off a wall — they are judgements somebody
 * standing in the building makes, and an app that printed a number for them
 * would be wrong the first time the basement had a window open in it. What this
 * knows is how many square feet of board come out and how many feet of base go
 * back, which is what nothing else in the field knows while somebody is still
 * standing in front of the wall.
 *
 * One thing here is deliberately **wider than the damage** and says so on its
 * own line: paint. Nobody feathers a coat into the middle of a wall — it runs
 * corner to corner, and a scope that priced eighteen square feet of paint on a
 * twenty foot wall is a scope that gets corrected by the adjuster, which is the
 * expensive way to find out.
 */

export class ScopeError extends RoomError {}

/** Which half of the job a line belongs to. */
export type Stage = 'tear out' | 'protect' | 'rebuild';

export interface ScopeLine {
  /** Which mark this came off, so a line can always be traced to an observation. */
  readonly damageId: string;
  readonly what: string;
  readonly quantity: string;
  readonly unit: 'sq ft' | 'lf' | 'ea';
  readonly stage: Stage;
  readonly workings: string;
  readonly provenance: 'measured' | 'scanned';
  /**
   * Set when the line covers more than the damaged area, with the reason.
   *
   * Never silent. A quantity bigger than the damage is the first thing an
   * adjuster queries, and the answer has to already be on the sheet.
   */
  readonly widerThanTheDamage?: string;
}

export interface Scope {
  readonly room: string;
  readonly lines: readonly ScopeLine[];
  /** Ready to text, print, or read down a phone. */
  readonly text: string;
  /** Ready to open in a spreadsheet or an estimating package. */
  readonly csv: string;
  /**
   * What this sheet is not, said on the sheet.
   *
   * It is the restoration scope and it is not the room's takeoff. Somebody who
   * prices both off this one will bill a carrier for a kitchen.
   */
  readonly note: string;
  /** Marks that produce no work, named rather than silently dropped. */
  readonly noWork: readonly string[];
}

/**
 * Every item this module can produce, with its unit.
 *
 * Exported so the rate editor is generated from the same list the lines are,
 * rather than from a second list somebody keeps in step by hand. A rate typed
 * against an item that no longer exists is a rate that silently never applies,
 * and the quote comes out short by whatever it was for.
 *
 * The names are deliberately free of anything job-specific — no water
 * category, no wall id. A rate is per item, and "remove wall board" costs the
 * same whether the water was clean or not. What the water was goes in the
 * workings, where it belongs.
 */
export const SCOPE_ITEMS: readonly {
  readonly item: string;
  readonly unit: 'sq ft' | 'lf';
  readonly stage: Stage;
  readonly prices: string;
}[] = [
  { item: 'Remove wall board', unit: 'sq ft', stage: 'tear out', prices: 'demolition, bagging' },
  { item: 'Remove floor finish', unit: 'sq ft', stage: 'tear out', prices: 'demolition, bagging' },
  { item: 'Remove ceiling finish', unit: 'sq ft', stage: 'tear out', prices: 'demolition, bagging' },
  { item: 'Remove baseboard', unit: 'lf', stage: 'tear out', prices: 'demolition' },
  { item: 'Clean and treat the opened cavity', unit: 'sq ft', stage: 'protect', prices: 'antimicrobial' },
  { item: 'Seal the affected surface', unit: 'sq ft', stage: 'protect', prices: 'sealer, labour' },
  { item: 'Hang wall board', unit: 'sq ft', stage: 'rebuild', prices: 'board, screws, labour' },
  { item: 'Tape and finish', unit: 'sq ft', stage: 'rebuild', prices: 'compound, tape, labour' },
  { item: 'Replace floor finish', unit: 'sq ft', stage: 'rebuild', prices: 'flooring, underlay' },
  { item: 'Replace ceiling finish', unit: 'sq ft', stage: 'rebuild', prices: 'board, finish' },
  { item: 'Replace baseboard', unit: 'lf', stage: 'rebuild', prices: 'base, shoe, labour' },
  { item: 'Prime and paint the wall', unit: 'sq ft', stage: 'rebuild', prices: 'primer, paint, labour' },
];

const SQ_FT = NM_PER_FOOT * NM_PER_FOOT;
const HALF_SQ_FT = 2n * SQ_FT;

/** Plain square nanometres to square feet, to one place, rounded not truncated. */
function squares(value: bigint): string {
  const tenths = (value * 10n + SQ_FT / 2n) / SQ_FT;
  return `${tenths / 10n}.${tenths % 10n}`;
}

/** The doubled unit `area()` keeps, to square feet. */
function halfSquares(value: bigint): string {
  const tenths = (value * 10n + HALF_SQ_FT / 2n) / HALF_SQ_FT;
  return `${tenths / 10n}.${tenths % 10n}`;
}

function linearFeet(value: Nanometres): string {
  const hundredths = (value * 100n + NM_PER_FOOT / 2n) / NM_PER_FOOT;
  return `${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, '0')}`;
}

/** The whole wall a damage is on, so paint can run corner to corner. */
function wholeWallFace(room: Room, damage: Damage): { id: string; area: bigint } | undefined {
  const shape = damage.shape;
  const wallId =
    shape.kind === 'patch'
      ? shape.wallId
      : shape.kind === 'surface' && shape.surface === 'wall'
        ? shape.wallId
        : undefined;
  if (!wallId) return undefined;
  // Built by asking `damageQuantity` for the whole wall rather than
  // re-deriving it here. Two derivations of one area is two chances to
  // disagree, and the one that would be wrong is the one on the claim.
  const whole = damageQuantity(room, {
    ...damage,
    id: `${damage.id}-whole-wall`,
    shape: { kind: 'surface', surface: 'wall', wallId },
  });
  return { id: wallId, area: whole.faceArea };
}

/**
 * What one damage takes, in lines.
 *
 * The order is the order the work happens in, because that is the order a
 * scope is read in and the order it is scheduled in.
 */
function linesFor(
  room: Room,
  damage: Damage,
  quantity: DamageQuantity,
  provenance: 'measured' | 'scanned'
): ScopeLine[] {
  const out: ScopeLine[] = [];
  const of = (what: string, rest: Omit<ScopeLine, 'damageId' | 'what'>): ScopeLine => ({
    damageId: damage.id,
    what,
    ...rest,
  });

  const kind = damage.kind;
  // The category belongs in the workings and never in the item name. A rate is
  // per item — removing board costs the same whether the water was clean or
  // not — and an item called "remove wall board (grey water)" is an item no
  // rate in anybody's book will ever match.
  const said =
    kind === 'water' && damage.category
      ? `${kind} damage, ${WATER_CATEGORY[damage.category].plain}. `
      : `${kind} damage. `;

  /* ------------------------------------------------------------- tear out */

  if (quantity.faceArea > 0n) {
    out.push(
      of('Remove wall board', {
        quantity: squares(quantity.faceArea),
        unit: 'sq ft',
        stage: 'tear out',
        workings: said + quantity.workings,
        provenance,
      })
    );
  }

  if (quantity.flatArea > 0n) {
    const shape = damage.shape;
    const surface = shape.kind === 'surface' ? shape.surface : 'floor';
    out.push(
      of(`Remove ${surface} finish`, {
        quantity: halfSquares(quantity.flatArea),
        unit: 'sq ft',
        stage: 'tear out',
        workings: said + quantity.workings,
        provenance,
      })
    );
  }

  if (quantity.baseboardRun > 0n) {
    out.push(
      of('Remove baseboard', {
        quantity: linearFeet(quantity.baseboardRun),
        unit: 'lf',
        stage: 'tear out',
        workings: 'the run of wall the damage reaches the floor along',
        provenance,
      })
    );
  }

  /* -------------------------------------------------------------- protect */

  // Only where the kind of damage decides it, and only as an area off the same
  // geometry. Nothing here is a day, a machine or a bag: those do not come off
  // a wall, and this app does not print numbers it did not measure.
  if (kind === 'mould' && quantity.faceArea > 0n) {
    out.push(
      of('Clean and treat the opened cavity', {
        quantity: squares(quantity.faceArea),
        unit: 'sq ft',
        stage: 'protect',
        workings: 'the same face that came out',
        provenance,
      })
    );
  }

  if (kind === 'smoke' || kind === 'fire') {
    const whole = wholeWallFace(room, damage);
    if (whole) {
      out.push(
        of('Seal the affected surface', {
          quantity: squares(whole.area),
          unit: 'sq ft',
          stage: 'protect',
          workings: `the whole face of ${whole.id}`,
          provenance,
          widerThanTheDamage:
            'Smoke does not stop at the edge of what it stained, so a sealer runs the whole ' +
            'surface. Priced to the wall, not to the mark.',
        })
      );
    }
  }

  /* -------------------------------------------------------------- rebuild */

  if (quantity.faceArea > 0n) {
    out.push(
      of('Hang wall board', {
        quantity: squares(quantity.faceArea),
        unit: 'sq ft',
        stage: 'rebuild',
        workings: 'what came out goes back',
        provenance,
      }),
      of('Tape and finish', {
        quantity: squares(quantity.faceArea),
        unit: 'sq ft',
        stage: 'rebuild',
        workings: 'the same face',
        provenance,
      })
    );
  }

  if (quantity.flatArea > 0n) {
    const shape = damage.shape;
    const surface = shape.kind === 'surface' ? shape.surface : 'floor';
    out.push(
      of(`Replace ${surface} finish`, {
        quantity: halfSquares(quantity.flatArea),
        unit: 'sq ft',
        stage: 'rebuild',
        workings: 'what came out goes back',
        provenance,
      })
    );
  }

  if (quantity.baseboardRun > 0n) {
    out.push(
      of('Replace baseboard', {
        quantity: linearFeet(quantity.baseboardRun),
        unit: 'lf',
        stage: 'rebuild',
        workings: 'the same run',
        provenance,
      })
    );
  }

  // Paint, corner to corner, on its own line saying so. This is the number an
  // adjuster queries and the answer belongs on the sheet rather than in an
  // argument three weeks later.
  const whole = wholeWallFace(room, damage);
  if (whole && quantity.faceArea > 0n) {
    out.push(
      of('Prime and paint the wall', {
        quantity: squares(whole.area),
        unit: 'sq ft',
        stage: 'rebuild',
        workings: `the whole face of ${whole.id}, less its openings`,
        provenance,
        widerThanTheDamage:
          'Paint runs corner to corner. Nobody feathers a coat into the middle of a wall, and ' +
          `${squares(quantity.faceArea)} sq ft of paint on this wall is a line that comes back ` +
          'corrected.',
      })
    );
  }

  return out;
}

/**
 * Every damage in a room, as work.
 *
 * Order is by damage, not by trade: a scope is walked room by room and mark by
 * mark, and grouping by trade loses which observation each line came off.
 */
export function damageScope(room: Room, damages: readonly Damage[], at: string): Scope {
  const state = readiness(room);
  const provenance = state.blocking.length === 0 ? 'measured' : 'scanned';

  const lines: ScopeLine[] = [];
  const noWork: string[] = [];

  for (const damage of damages) {
    const quantity = damageQuantity(room, damage);
    const produced = linesFor(room, damage, quantity, provenance);
    if (produced.length === 0) {
      // A pin. It is on the claim as an observation with a photograph, and it
      // is not on this sheet as work — because nobody can price a marker. Said
      // out loud rather than left as a mark that quietly produced nothing.
      noWork.push(`${damage.kind} — ${damage.note}`);
      continue;
    }
    lines.push(...produced);
  }

  const note =
    'This is the restoration scope for the damage marked in this room. It is NOT the room’s ' +
    'takeoff — a remodel of the same room is a different sheet, priced by a different person ' +
    'out of different money. Every quantity here comes off the measurements; nothing on it is ' +
    'equipment, days or debris, because none of those come off a wall.';

  const width = Math.max(1, ...lines.map((l) => l.what.length));
  const stages: Stage[] = ['tear out', 'protect', 'rebuild'];
  const body = stages
    .map((stage) => {
      const inStage = lines.filter((l) => l.stage === stage);
      if (inStage.length === 0) return '';
      const rows = inStage
        .map((l) => {
          const row = `${l.what.padEnd(width)}  ${l.quantity.padStart(8)} ${l.unit}`;
          return l.widerThanTheDamage ? `${row}\n${' '.repeat(width + 2)}  ${l.widerThanTheDamage}` : row;
        })
        .join('\n');
      return `${stage.toUpperCase()}\n${rows}`;
    })
    .filter((block) => block !== '')
    .join('\n\n');

  const text = [
    `${room.name} — damage scope`,
    at,
    '',
    body || 'Nothing marked in this room takes any work.',
    '',
    ...(noWork.length > 0
      ? [`Marked, and not work: ${noWork.join('; ')}. A pin is a marker, not a measurement.`, '']
      : []),
    note,
    trustLabel(state.trust) + '.',
  ].join('\n');

  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const csv = [
    'mark,stage,item,quantity,unit,workings,provenance,wider than the damage',
    ...lines.map((l) =>
      [
        escape(l.damageId),
        escape(l.stage),
        escape(l.what),
        l.quantity,
        escape(l.unit),
        escape(l.workings),
        escape(l.provenance),
        escape(l.widerThanTheDamage ?? ''),
      ].join(',')
    ),
  ].join('\n');

  return { room: room.name, lines, text, csv, note, noWork };
}

/* ---------------------------------------------------------------- the money */

/**
 * What one mark comes to, in cents.
 *
 * Per mark and not only per sheet, because that is the question somebody
 * standing in front of a wall is actually asking: *what is this one worth?* A
 * single figure at the bottom of a scope answers "what is the loss worth" and
 * leaves every argument about one wall unanswerable.
 */
export interface MarkMoney {
  /** Which mark this is the cost of, so money can always be traced to an observation. */
  readonly damageId: string;
  readonly lines: readonly PricedLine[];
  readonly subtotal: Cents;
}

export interface ScopeMoney {
  readonly perMark: readonly MarkMoney[];
  /** Every priced line on the sheet, in the order the work happens in. */
  readonly lines: readonly PricedLine[];
  readonly subtotal: Cents;
  /** Zero unless the contractor set a mark-up on his book. */
  readonly margin: Cents;
  readonly total: Cents;
  /**
   * Items with no rate against them, named once each.
   *
   * Never zero-priced and never silently dropped. A restoration sheet that adds
   * up perfectly and is short by a tear-out is the worst thing this could hand
   * an adjuster, because it is the version nobody queries.
   */
  readonly unpriced: readonly string[];
  /** True when at least one line got a rate, so a renderer knows there is a figure at all. */
  readonly priced: boolean;
  /** True when every quantity behind the money has had a tape on it. */
  readonly measured: boolean;
}

/**
 * The damage scope, priced at the contractor's own rates.
 *
 * ## Why this exists
 *
 * > "IT DOESNT AUTOMATICALLY PRICE OUT THE DAMAGE BUT INSTEAD IF YOU GO TO THE
 * >  PRICING IS SHOW YOU THE ENTIRE ROOM AND THE FLOOR AND CEILING WHICH ARE
 * >  NOT CHECK FOR BEING NEEDED"
 *
 * The two sheets stay two sheets — a remodel takeoff and a restoration scope go
 * to two different payers and collapsing them is how a carrier gets billed for
 * a kitchen. What was missing is that the restoration half never became money
 * anywhere a claim could carry it, so the only figure in the app was the
 * takeoff's, which prices a whole room nobody asked to have done.
 *
 * ## Why it goes through `quote` twice rather than multiplying here
 *
 * Once for the sheet and once per mark, through the same function the remodel
 * takeoff is priced by. Re-multiplying a quantity here to attribute it to a
 * mark would be a second derivation of one number, and the one that would be
 * wrong is whichever nobody is looking at. Every total is a per-line sum of
 * integer cents, so the marks add back to the subtotal exactly — there is no
 * rounding between the two passes to disagree about.
 */
export function scopeMoney(scope: Scope, book: PriceBook): ScopeMoney {
  const whole = quote(scope.lines, book);

  // First appearance decides the order, so the money reads down the page in the
  // same order as the marks it came off.
  const order: string[] = [];
  const byMark = new Map<string, ScopeLine[]>();
  for (const line of scope.lines) {
    const got = byMark.get(line.damageId);
    if (got) {
      got.push(line);
    } else {
      order.push(line.damageId);
      byMark.set(line.damageId, [line]);
    }
  }

  const perMark = order.map((damageId) => {
    const part = quote(byMark.get(damageId)!, book);
    return { damageId, lines: part.lines, subtotal: part.subtotal };
  });

  // Named once each. `quote` reports an unpriced item per line, and an adjuster
  // reading "Remove wall board, Remove wall board, Remove wall board" learns
  // nothing the first one did not tell him.
  const unpriced = [...new Set(whole.unpriced)];

  return {
    perMark,
    lines: whole.lines,
    subtotal: whole.subtotal,
    margin: whole.margin,
    total: whole.total,
    unpriced,
    priced: whole.lines.length > 0,
    measured: whole.measured,
  };
}
