/**
 * The worked examples on the calculator pages, worked by the engine.
 *
 * Every figure printed on a calculator page — including the ones in the prose
 * and in the tables, not only the ones the form produces — is computed here, at
 * build time, by `site/src/calc/engine.mjs`, which is `core/src/*.ts`. Nothing
 * on those pages is a number somebody typed into a content file.
 *
 * That is not fussiness. A calculator whose form is correct and whose worked
 * example is a stale hand-typed figure is a page that contradicts itself in
 * front of the reader, and this is the one site on which that particular
 * failure would be fatal: the whole argument is that it never prints a number
 * it cannot defend.
 *
 * `site/tools/calc-truth.mjs` imports this module and checks that every string
 * in it actually appears in the page it belongs to, so a template that dropped
 * a figure or escaped one wrongly fails the build.
 */
import {
  MEASURES,
  NM_PER_FOOT,
  buildRoom,
  formatFeetInches,
  drywall,
  markupToMargin,
  marginToMarkup,
  money,
  paint,
  parseLength,
  percent,
  placeOpenings,
  rectangleWalk,
  roomFigures,
  squareFeetOfHalves,
  trim,
} from '../src/calc/engine.mjs';
import {
  BUSINESS_DAYS_TO_CANCEL,
  cancellationDeadline,
  isBusinessDay,
  sayDate,
} from '../../core/src/cooling.ts';

const ft = (n) => BigInt(n) * NM_PER_FOOT;

/**
 * A percentage for a sentence rather than for a column.
 *
 * `percent()` always gives two places, which is right in a table where a column
 * of figures has to line up and wrong in a paragraph, where "30.00%" reads as
 * somebody quoting a spreadsheet at you. The hundredths come off only when they
 * are nothing, so 23.08 stays 23.08.
 */
const said = (points) => percent(points).replace(/\.00$/, '');

/** A count of square feet, as a sentence says it: "64" rather than "64.0". */
const flat = (squareFeet) => squareFeet.replace(/\.0$/, '');

/* ---------------------------------------------------------------- the room */

/**
 * The room every example below is worked on: 12 ft × 14 ft, an 8 ft ceiling,
 * one door, one window, 4½ inch walls.
 *
 * Chosen because it is the room the drywall guide already argues about — 168
 * square feet of floor and 416 of wall face before a deduction — so a reader
 * who came from that guide sees the same room again with the openings actually
 * taken off.
 */
export const EXAMPLE_ROOM = {
  width: ft(12),
  depth: ft(14),
  height: ft(8),
  thickness: parseLength('4 1/2"'),
  door: { width: parseLength("3'"), height: parseLength("6' 8\"") },
  window: { width: parseLength("3'"), height: parseLength("5'") },
};

/**
 * The same room, written the way somebody types a length into a box.
 *
 * Rendered by `formatFeetInches` rather than typed out again, so the figures
 * the form opens on and the figures the page argues about are one set of
 * numbers. A reader who lands on the page sees the calculator already agreeing
 * with the prose underneath it.
 */
export const EXAMPLE_SAID = {
  width: formatFeetInches(EXAMPLE_ROOM.width),
  depth: formatFeetInches(EXAMPLE_ROOM.depth),
  height: formatFeetInches(EXAMPLE_ROOM.height),
  thickness: formatFeetInches(EXAMPLE_ROOM.thickness),
  doorWidth: formatFeetInches(EXAMPLE_ROOM.door.width),
  doorHeight: formatFeetInches(EXAMPLE_ROOM.door.height),
  windowWidth: formatFeetInches(EXAMPLE_ROOM.window.width),
  windowHeight: formatFeetInches(EXAMPLE_ROOM.window.height),
};

function exampleRoom() {
  const walk = placeOpenings(rectangleWalk(EXAMPLE_ROOM.width, EXAMPLE_ROOM.depth), [
    { kind: 'door', count: 1n, width: EXAMPLE_ROOM.door.width, height: EXAMPLE_ROOM.door.height },
    {
      kind: 'window',
      count: 1n,
      width: EXAMPLE_ROOM.window.width,
      height: EXAMPLE_ROOM.window.height,
    },
  ]);
  return buildRoom(walk, EXAMPLE_ROOM.height, { wallThickness: EXAMPLE_ROOM.thickness });
}

const ROOM = exampleRoom();
const FIGURES = roomFigures(ROOM);

/** The four numbers the room produces, before any trade touches them. */
export const ROOM_FIGURES = {
  floorArea: FIGURES.floorArea,
  ceilingArea: FIGURES.ceilingArea,
  perimeter: FIGURES.perimeterFeet,
  wallFace: FIGURES.wallFace,
  baseboard: FIGURES.baseboard,
  /** Perimeter × height, with nothing deducted — the figure people quote. */
  wallFaceGross: roomFigures(
    buildRoom(rectangleWalk(EXAMPLE_ROOM.width, EXAMPLE_ROOM.depth), EXAMPLE_ROOM.height)
  ).wallFace,
};

/* ------------------------------------------------------- markup and margin */

/** The cost the markup table is worked on. Ten thousand dollars, in cents. */
const EXAMPLE_COST = 1_000_000n;

/** The one everybody gets wrong, spelled out on a hundred dollars. */
const HUNDRED = markupToMargin(10_000n, 3000n);

export const MARKUP = {
  cost: money(HUNDRED.costCents),
  markup: said(HUNDRED.markupBasisPoints),
  price: money(HUNDRED.priceCents),
  profit: money(HUNDRED.marginCents),
  margin: said(HUNDRED.marginBasisPoints),
  /** The markup a thirty per cent margin needs, for the sentence that says so. */
  markupForThirty: said(marginToMarkup(3000n)),
  markupWorking: HUNDRED.workings.markup,
  marginWorking: HUNDRED.workings.margin,
  /** Every markup a contractor is likely to use, and what it actually leaves. */
  table: [1000n, 1500n, 2000n, 2500n, 3000n, 3500n, 4000n, 5000n, 10_000n].map((points) => {
    const r = markupToMargin(EXAMPLE_COST, points);
    return {
      markup: `${percent(points)}%`,
      price: money(r.priceCents),
      profit: money(r.marginCents),
      margin: `${percent(r.marginBasisPoints)}%`,
    };
  }),
  /** And the other direction: the markup a wanted margin actually needs. */
  wanted: [1000n, 1500n, 2000n, 2500n, 3000n, 3500n, 4000n, 5000n].map((points) => ({
    margin: `${percent(points)}%`,
    markup: `${percent(marginToMarkup(points))}%`,
  })),
  costWorked: money(EXAMPLE_COST),
};

/* ------------------------------------------------------------------ drywall */

const SHEET_IDS = ['4x8', '4x9', '4x10', '4x12', '4x16'];

/**
 * The waste figure the comparison column is worked at.
 *
 * It is on the page to show the *shape* of the effect — a tenth more board is
 * not a tenth more sheets, because sheets round up — and the page says in words
 * that it is not a recommendation. The calculator's own waste box starts empty.
 */
const SHOWN_WASTE = 1000n;

export const DRYWALL = {
  wasteShown: said(SHOWN_WASTE),
  boardArea: drywall(ROOM, { sheet: '4x8' }).boardArea,
  wallFace: drywall(ROOM, { sheet: '4x8' }).wallFace,
  ceilingArea: drywall(ROOM, { sheet: '4x8' }).ceilingArea,
  wrap: drywall(ROOM, { sheet: '4x8' }).openingWrap,
  table: SHEET_IDS.map((id) => {
    const r = drywall(ROOM, { sheet: id });
    const waste = drywall(ROOM, { sheet: id, wasteBasisPoints: SHOWN_WASTE });
    return {
      sheet: r.sheet.label,
      covers: `${r.sheetArea} sq ft`,
      sheets: `${r.sheets}`,
      withWaste: `${waste.sheetsWithWaste}`,
    };
  }),
  /** Walls only, for the reader who is not boarding the ceiling. */
  wallsOnly: `${drywall(ROOM, { sheet: '4x8', ceiling: false }).sheets}`,
};

/* -------------------------------------------------------------------- paint */

/**
 * A coverage rate the reader is told to replace.
 *
 * Written as an assumption in the sentence beside it rather than presented as
 * a fact about paint: coverage is printed on the tin, it is different for a
 * primer, and it is different again over bare board. ScanToBid does not know
 * what anybody is painting with and will not pick a number for them.
 */
export const ASSUMED_COVERAGE = 350n;

const PAINT_WALLS = paint(ROOM, { coats: 2n, coverageSqFt: ASSUMED_COVERAGE });
const PAINT_ALL = paint(ROOM, { coats: 2n, coverageSqFt: ASSUMED_COVERAGE, ceiling: true });

export const PAINT = {
  coverage: `${ASSUMED_COVERAGE}`,
  wallFace: PAINT_WALLS.wallFace,
  onePass: PAINT_WALLS.areaPerCoat,
  twoCoats: PAINT_WALLS.areaAllCoats,
  gallons: PAINT_WALLS.gallons,
  buy: `${PAINT_WALLS.gallonsToBuy}`,
  withCeilingArea: PAINT_ALL.areaAllCoats,
  withCeilingGallons: PAINT_ALL.gallons,
  withCeilingBuy: `${PAINT_ALL.gallonsToBuy}`,
};

/* ------------------------------------------------------------------- trim */

const TRIM = trim(ROOM, { stockLengthNm: ft(16) });

export const BASEBOARD = {
  perimeter: TRIM.perimeter,
  deducted: TRIM.deducted,
  run: TRIM.baseboard,
  runSaid: TRIM.baseboardSaid,
  sticks: `${TRIM.pieces}`,
  stock: '16',
};

/* -------------------------------------------------------- the odd-shaped room */

/**
 * An L: twenty feet across the front, with an eight-foot square bitten out of
 * the back corner.
 *
 * The point of it is the number a generic calculator gives — 20 × 20, because
 * it asked for a width and a depth and there is no other answer it can give —
 * against the number the walk actually encloses.
 */
export const L_WALK = [
  { heading: 'east', length: ft(20), said: "20'" },
  { heading: 'south', length: ft(12), said: "12'" },
  { heading: 'west', length: ft(8), said: "8'" },
  { heading: 'south', length: ft(8), said: "8'" },
  { heading: 'west', length: ft(12), said: "12'" },
  { heading: 'north', length: ft(20), said: "20'" },
];

const L_ROOM = buildRoom(
  L_WALK.map((step, i) => ({ id: `Wall ${i + 1}`, heading: step.heading, length: step.length })),
  ft(9)
);
const L_FIGURES = roomFigures(L_ROOM);

const BOX = roomFigures(buildRoom(rectangleWalk(ft(20), ft(20)), ft(9)));

export const ODD_ROOM = {
  floorArea: L_FIGURES.floorArea,
  perimeter: L_FIGURES.perimeterFeet,
  wallFace: L_FIGURES.wallFace,
  baseboard: L_FIGURES.baseboard,
  ceilingHeight: "9'",
  /** What a width-and-depth calculator answers for the same room. */
  boxArea: BOX.floorArea,
  boxPerimeter: BOX.perimeterFeet,
  /** The gap between the two, which is the entire point of the page. */
  overstated: flat(
    squareFeetOfHalves(
      roomFigures(buildRoom(rectangleWalk(ft(20), ft(20)), ft(9))).floorAreaHalfSqNm -
        L_FIGURES.floorAreaHalfSqNm
    )
  ),
  /** The bite out of the corner, off the walk itself rather than typed. */
  bite: L_WALK[2].said,
  walk: L_WALK.map((step) => ({ heading: step.heading, said: step.said })),
  /** The corners the walk lands on, in feet, for the reader who wants to plot it. */
  corners: L_FIGURES.corners.map((point) => ({
    x: (Number(point.x) / Number(NM_PER_FOOT)).toFixed(0),
    y: (Number(point.y) / Number(NM_PER_FOOT)).toFixed(0),
  })),
};

/* --------------------------------------------------- how the app measures */

/**
 * Every way the app can measure a surface, out of `core/src/work.ts`.
 *
 * The label, the unit and the sentence explaining what comes off it are the
 * engine's own strings — the same ones printed under a line on a takeoff — so
 * the guide and the app cannot describe the same quantity differently.
 */
export const MEASURE_ROWS = MEASURES.map((m) => ({
  id: m.id,
  label: m.label,
  unit: m.unit,
  surfaces: m.surfaces.join(', '),
  workings: m.workings,
}));

/* ------------------------------------------- the three-day cancellation date */

/**
 * Worked cancellation deadlines, counted by the engine rather than by hand.
 *
 * The guide's table used to be six dates somebody worked out on their fingers,
 * which on a page about a legal deadline is the last place to put arithmetic
 * nobody checked. These come out of `core/src/cooling.ts` — the same
 * `cancellationDeadline` the app puts on a proposal, counting business days the
 * way § 429.0 defines them: Saturdays in, Sundays and federal holidays out.
 *
 * The first week is deliberately a plain one with no federal holiday in it, so
 * the only thing moving the answer is the Sunday. The last row is the week of
 * Thanksgiving 2026, which is the case that shows a holiday being skipped as
 * well — and neither the date of Thanksgiving nor the deadline is typed here.
 */
const WEEK = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07'];

export const COOLING = {
  rows: [...WEEK, '2026-11-25'].map((day) => {
    const deadline = cancellationDeadline(day);
    return {
      signed: sayDate(day),
      deadline: sayDate(deadline),
      /** The days actually counted, named, so the skip is visible. */
      counted: countedDays(day, deadline),
    };
  }),
  /** Named rather than sprinkled: it is `BUSINESS_DAYS_TO_CANCEL` from § 429.1(a). */
  days: String(BUSINESS_DAYS_TO_CANCEL),
};

/** Every day from the one after the sale to the deadline, marked business or not. */
function countedDays(from, to) {
  const out = [];
  let day = from;
  for (let step = 0; step < 30; step += 1) {
    day = addBusinessOrCalendarDay(day);
    out.push(`${sayDate(day).split(',')[0]}${isBusinessDay(day) ? '' : ' (skipped)'}`);
    if (day === to) break;
  }
  return out.join(', ');
}

/** The next calendar day. `cooling.ts` counts in business days; this walks all of them. */
function addBusinessOrCalendarDay(day) {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
}
