/**
 * The calculators, running the app's own engine.
 *
 * ## Why this file imports out of `core/src` and not out of a copy
 *
 * A calculator on a marketing site is normally a form with some arithmetic
 * written into it by hand. That arithmetic then drifts away from the product it
 * is advertising, silently, and the site ends up publishing numbers the app
 * would not produce — which for this product would be the single most damaging
 * thing on the whole domain, because the pitch is that it never prints a number
 * it cannot defend.
 *
 * So there is no arithmetic here. Every quantity below comes out of
 * `core/src/*.ts` — the same `roomQuantities`, the same `area`, the same
 * `quote`, the same `parseLength` the iPhone app runs. This file builds the
 * app's own `Room` out of what somebody typed into a form, hands it to the
 * engine, and prints what comes back.
 *
 * `site/tools/engine.mjs` bundles this for the browser with esbuild, which is
 * where the TypeScript in `core/src` gets its types stripped. Node 22.18 and
 * later strips them on its own, so `site/tools/calc-truth.mjs` imports *this
 * file* directly and compares it against the bundle the browser is served —
 * which is how a bundler that mangled something would be caught rather than
 * shipped.
 *
 * ## The rules this file keeps
 *
 * - **No floats.** Lengths are `bigint` nanometres, money is `bigint` cents,
 *   areas are `bigint` square nanometres, and percentages are `bigint` basis
 *   points. `Number` appears only where a value is on its way to the screen.
 * - **Nothing is defaulted that a person has to decide.** No waste percentage,
 *   no paint coverage rate, no sheet size. Every one of those is a fact about a
 *   job or a product, and inventing one here would be inventing a number.
 * - **Nothing pretends to be measured.** A figure typed into a web form is
 *   `verified(..., 'stated')` in the model — somebody said it — and every page
 *   says so. The app is the thing that knows whether a tape was on the wall.
 */

import {
  NM_PER_FOOT,
  NM_PER_INCH,
  LengthError,
  formatFeetInches,
  parseLength,
} from '../../../core/src/length.ts';
import { verified } from '../../../core/src/measurement.ts';
import {
  RoomError,
  area,
  closes,
  closure,
  corners,
  perimeter,
} from '../../../core/src/room.ts';
import { roomQuantities } from '../../../core/src/zone.ts';
import { openingReturns } from '../../../core/src/thickness.ts';
import {
  SQ_FT,
  decimals,
  linearFeet,
  squareFeet,
  squareFeetOfHalves,
} from '../../../core/src/quantity.ts';
import { PriceError, money, parseMoney, quote } from '../../../core/src/price.ts';
import { MEASURES } from '../../../core/src/work.ts';

/**
 * The ways the app measures a surface, straight out of `core/src/work.ts`.
 *
 * Re-exported rather than described, so the takeoff-formulas guide prints the
 * app's own list and its own sentence about each one. A page explaining nine
 * measures while the app had ten would be a page nobody could trust.
 */
export { MEASURES };

export { LengthError, RoomError, PriceError, formatFeetInches, money, parseLength, parseMoney };

/**
 * The instant stamped on a measurement somebody typed into a form.
 *
 * Fixed rather than `new Date()`, deliberately. The engine requires an ISO
 * instant on anything a person stands behind, nothing on any calculator page
 * ever displays it, and a clock reading inside a pure function is what makes a
 * result impossible to test twice. What it means is recorded in the string
 * itself so nobody later mistakes it for a real capture time.
 */
const TYPED_AT = '2026-01-01T00:00:00Z';
const TYPED_BY = 'typed into the calculator';

/** A length somebody typed. Not scanned, not taped — stated. */
function stated(nm) {
  return verified(nm, TYPED_BY, TYPED_AT, 'stated');
}

/** Round up, on integers, with no float and no `Math.ceil`. */
function ceilDiv(numerator, denominator) {
  if (denominator <= 0n) throw new RangeError('Cannot divide by zero or less.');
  return (numerator + denominator - 1n) / denominator;
}

/** Basis points as a percentage a person reads: `2308n` becomes "23.08". */
export function percent(basisPoints) {
  const negative = basisPoints < 0n;
  const abs = negative ? -basisPoints : basisPoints;
  const whole = abs / 100n;
  const rest = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${rest}`;
}

/**
 * A percentage somebody typed, into exact basis points.
 *
 * Two decimal places, because that is where a percentage stops being something
 * a contractor writes down. `30`, `30.5`, `23.08` and `30%` all work.
 */
export function parsePercent(text) {
  const cleaned = String(text).trim().replace(/%$/, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new RangeError(`"${text}" is not a percentage. Write it as 30, 30.5 or 23.08.`);
  }
  const [whole, fraction = ''] = cleaned.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

/** A whole count somebody typed. */
export function parseCount(text, what) {
  const cleaned = String(text).trim();
  if (!/^\d+$/.test(cleaned)) {
    throw new RangeError(`"${text}" is not a whole number of ${what}.`);
  }
  return BigInt(cleaned);
}

/* ==================================================================== 1 of 5
 * Markup and margin
 * ======================================================================== */

/**
 * What a markup does to a margin, and what margin a markup actually leaves.
 *
 * The arithmetic is `quote()` out of `core/src/price.ts` — the same function
 * that puts a job total on a proposal — with one line at the cost and the job
 * markup set to the figure typed. That matters more here than anywhere else on
 * the site: the field on a `PriceBook` is called `marginBasisPoints` and it is
 * documented as "the mark-up applied to the whole job", because it is applied
 * *to the cost*. So the app's own price book, like almost every contractor's,
 * holds a markup under the word margin — and the number this page exists to
 * explain is exactly the gap between those two words.
 *
 * Everything is exact integers. `marginBasisPoints` out of the result is
 * `margin ÷ price`, rounded to the nearest basis point half away from zero, so
 * a contractor checking it on a calculator gets the figure on the page.
 */
export function markupToMargin(costCents, markupBasisPoints) {
  if (costCents <= 0n) throw new RangeError('A job cost has to be more than nothing.');
  if (markupBasisPoints < 0n) throw new RangeError('A markup does not run backwards.');

  const item = 'Job cost';
  const result = quote(
    [{ what: item, quantity: '1', unit: 'ea', provenance: 'scanned' }],
    {
      rates: [
        {
          item,
          unit: 'ea',
          cents: costCents,
          source: { kind: 'typed', by: TYPED_BY, at: TYPED_AT },
        },
      ],
      marginBasisPoints: Number(markupBasisPoints),
    }
  );

  const price = result.total;
  const marginCents = result.margin;
  // margin ÷ price, in basis points, rounded half away from zero.
  const marginBasisPoints = (2n * marginCents * 10_000n + price) / (2n * price);

  return {
    costCents,
    markupBasisPoints,
    marginCents,
    priceCents: price,
    marginBasisPoints,
    /** What the two words mean, as the division each one is. */
    workings: {
      markup: `${money(marginCents)} ÷ ${money(costCents)} = ${percent(markupBasisPoints)}% markup`,
      margin: `${money(marginCents)} ÷ ${money(price)} = ${percent(marginBasisPoints)}% margin`,
    },
  };
}

/**
 * The markup that actually lands on a wanted margin.
 *
 * `markup = margin ÷ (1 − margin)`, in basis points, exactly. 100% margin and
 * up is refused rather than returned as a very large number: there is no
 * markup that leaves a hundred per cent margin, and printing one would be
 * printing an answer to a question with none.
 */
export function marginToMarkup(marginBasisPoints) {
  if (marginBasisPoints < 0n) throw new RangeError('A margin does not run backwards.');
  if (marginBasisPoints >= 10_000n) {
    throw new RangeError(
      'There is no markup that leaves a margin of 100% or more — the price would have to be ' +
        'infinite. Margin is a share of the price, and the price includes the cost.'
    );
  }
  const left = 10_000n - marginBasisPoints;
  return (2n * marginBasisPoints * 10_000n + left) / (2n * left);
}

/* ==================================================================== 2 of 5
 * The room itself — the thing every other calculator is built on
 * ======================================================================== */

export const HEADINGS = ['north', 'east', 'south', 'west'];

/**
 * The walk of a room, as a list of `{ heading, length }`, into the app's `Room`.
 *
 * This is the whole trick of the odd-shaped-room calculator, and it is why the
 * result is right where a generic one is wrong: a room is not a width and a
 * depth, it is a walk round the walls, and the area of the polygon that walk
 * closes is the shoelace formula over its corners. `core/src/room.ts` has done
 * that from the beginning, on exact integers, including rooms with an angled
 * wall in them.
 *
 * `validate()` inside the engine refuses two walls in a row that run the same
 * way with nothing to tell them apart, because that is one wall written twice
 * — and it refuses a walk of fewer than four walls. Both refusals are useful
 * on a form and both are passed straight through as the engine wrote them.
 */
export function buildRoom(walk, ceilingHeightNm, options = {}) {
  const walls = walk.map((step, i) => ({
    id: step.id ?? `Wall ${i + 1}`,
    heading: step.heading,
    length: stated(step.length),
    ...(step.openings ? { openings: step.openings } : {}),
  }));
  return {
    id: 'calculator',
    name: options.name ?? 'This room',
    walls,
    ceilingHeight: stated(ceilingHeightNm),
    ...(options.wallThickness === undefined
      ? {}
      : { wallThickness: stated(options.wallThickness) }),
  };
}

/** A plain rectangle, as the four-wall walk it is. */
export function rectangleWalk(widthNm, depthNm) {
  return [
    { id: 'North wall', heading: 'east', length: widthNm },
    { id: 'East wall', heading: 'south', length: depthNm },
    { id: 'South wall', heading: 'west', length: widthNm },
    { id: 'West wall', heading: 'north', length: depthNm },
  ];
}

/**
 * Puts the openings somebody listed onto walls that are long enough to hold
 * them.
 *
 * The engine attributes an opening to the stretch of wall it falls in, so an
 * opening needs a wall and an offset along it — and a form that asked a
 * contractor which wall each door is on, in what order, would be a form nobody
 * finishes. So they are laid along the walls in the order they were typed,
 * moving on to the next wall when the one in hand has no room left.
 *
 * **Where each door sits changes nothing about the totals**, which is what
 * makes this safe: wall face is run × height less every opening's own area, and
 * baseboard is run less every door width, so both are sums over the same
 * openings whichever wall they land on. What it is not safe to do is overflow —
 * more opening than wall means the room cannot hold what was typed, and that is
 * raised rather than quietly clamped.
 */
export function placeOpenings(walk, openings) {
  const placed = walk.map((step) => ({ ...step, openings: [] }));
  let wall = 0;
  let offset = 0n;
  let n = 0;

  for (const opening of openings) {
    for (let count = 0n; count < opening.count; count += 1n) {
      while (wall < placed.length && offset + opening.width > placed[wall].length) {
        wall += 1;
        offset = 0n;
      }
      if (wall >= placed.length) {
        throw new RoomError(
          `The openings add up to more wall than this room has. ${formatFeetInches(
            opening.width
          )} of ${opening.kind} will not fit anywhere that is left.`
        );
      }
      n += 1;
      placed[wall].openings.push({
        id: `${opening.kind}-${n}`,
        kind: opening.kind,
        width: stated(opening.width),
        height: stated(opening.height),
        offsetFromStart: stated(offset),
        ...(opening.sill === undefined ? {} : { sillHeight: stated(opening.sill) }),
      });
      offset += opening.width;
    }
  }
  return placed;
}

/**
 * Every quantity a room produces, from the engine, printed the way the app
 * prints them.
 *
 * `roomQuantities` is `quantities(wholeRoom(room), room)` — the function the
 * takeoff itself calls. Nothing is recomputed here.
 */
export function roomFigures(room) {
  const q = roomQuantities(room);
  const walk = area(room);
  const round = perimeter(room);
  const gap = closure(room);
  return {
    closes: closes(room),
    closureGap: gap,
    floorAreaHalfSqNm: q.floorArea,
    ceilingAreaHalfSqNm: q.ceilingArea,
    wallFaceSqNm: q.wallFaceArea,
    baseboardNm: q.baseboardRun,
    perimeterNm: round.value,
    openRunNm: q.openRun,
    floorArea: squareFeetOfHalves(q.floorArea),
    ceilingArea: squareFeetOfHalves(q.ceilingArea),
    wallFace: squareFeet(q.wallFaceArea),
    baseboard: linearFeet(q.baseboardRun),
    perimeterFeet: linearFeet(round.value),
    perimeterSaid: formatFeetInches(round.value),
    /** Where the walk got to, corner by corner, for a plan or a sanity check. */
    corners: corners(room).map((point) => ({ x: point.x, y: point.y })),
    /** Twice the signed shoelace sum, which is what `area()` holds. */
    exactArea: walk.value,
  };
}

/* ==================================================================== 3 of 5
 * Drywall
 * ======================================================================== */

/** The sheets a contractor can actually buy, as exact dimensions. */
export const SHEETS = [
  { id: '4x8', label: '4 ft × 8 ft', width: 4n * NM_PER_FOOT, length: 8n * NM_PER_FOOT },
  { id: '4x9', label: '4 ft × 9 ft', width: 4n * NM_PER_FOOT, length: 9n * NM_PER_FOOT },
  { id: '4x10', label: '4 ft × 10 ft', width: 4n * NM_PER_FOOT, length: 10n * NM_PER_FOOT },
  { id: '4x12', label: '4 ft × 12 ft', width: 4n * NM_PER_FOOT, length: 12n * NM_PER_FOOT },
  { id: '4x16', label: '4 ft × 16 ft', width: 4n * NM_PER_FOOT, length: 16n * NM_PER_FOOT },
];

export function sheetById(id) {
  const found = SHEETS.find((s) => s.id === id);
  if (!found) throw new RangeError(`"${id}" is not a sheet size this knows.`);
  return found;
}

/**
 * Board for a room: wall face less every opening, the ceiling if it is being
 * boarded, and the sheets that covers.
 *
 * `wasteBasisPoints` is whatever the contractor typed and is zero when he
 * typed nothing. There is no default waste figure here and there never will
 * be: how much a room wastes is a fact about the room — a plain rectangle
 * wastes almost nothing and a room full of closets and bulkheads wastes a
 * great deal — and a constant picked in this file would be a number invented
 * for a job nobody here has seen.
 */
export function drywall(room, { sheet, ceiling = true, wasteBasisPoints = 0n }) {
  const size = typeof sheet === 'string' ? sheetById(sheet) : sheet;
  const q = roomQuantities(room);

  // The floor and ceiling are held in half square nanometres, wall face in
  // plain ones. Doubling the wall face is what brings them into one unit
  // without halving anything — halving early is what loses a tenth.
  const wallHalves = 2n * q.wallFaceArea;
  const ceilingHalves = ceiling ? q.ceilingArea : 0n;
  const totalHalves = wallHalves + ceilingHalves;

  const sheetHalves = 2n * size.width * size.length;
  const withWaste = (totalHalves * (10_000n + wasteBasisPoints)) / 10_000n;

  const returns = openingReturns(room);
  const returnHalves = 2n * returns.reduce((sum, r) => sum + r.area, 0n);

  return {
    sheet: size,
    ceilingIncluded: ceiling,
    wasteBasisPoints,
    wallFace: squareFeet(q.wallFaceArea),
    ceilingArea: squareFeetOfHalves(q.ceilingArea),
    boardArea: squareFeetOfHalves(totalHalves),
    boardAreaWithWaste: squareFeetOfHalves(withWaste),
    sheetArea: squareFeetOfHalves(sheetHalves),
    sheets: ceilDiv(totalHalves, sheetHalves),
    sheetsWithWaste: ceilDiv(withWaste, sheetHalves),
    /**
     * The board that wraps into the jambs, when the walls have been given a
     * thickness. Zero-length when they have not — never guessed at four and a
     * half inches, because a block wall priced as stud framing reconciles
     * perfectly and is wrong.
     */
    openingWrap: returns.length === 0 ? null : squareFeetOfHalves(returnHalves),
    openingWrapSheets: returns.length === 0 ? null : ceilDiv(returnHalves, sheetHalves),
  };
}

/* ==================================================================== 4 of 5
 * Paint
 * ======================================================================== */

/**
 * Paint for a room, by coat, at the coverage rate on the tin.
 *
 * `coverageSqFt` is a `bigint` number of square feet per gallon and it comes
 * from the person, every time. Coverage is a property of a product — it is
 * printed on the can, it differs between a primer and a finish, and it differs
 * again on bare drywall — so a figure chosen in this file would be a made-up
 * number sitting under somebody's material order.
 */
export function paint(room, { coats, coverageSqFt, ceiling = false }) {
  if (coats <= 0n) throw new RangeError('A coat of paint is at least one coat.');
  if (coverageSqFt <= 0n) {
    throw new RangeError(
      'Coverage is the square feet a gallon covers, off the can. Trueline does not know what ' +
        'you are painting with, so it will not pick one for you.'
    );
  }
  const q = roomQuantities(room);
  const wallHalves = 2n * q.wallFaceArea;
  const ceilingHalves = ceiling ? q.ceilingArea : 0n;
  const perCoatHalves = wallHalves + ceilingHalves;
  const totalHalves = perCoatHalves * coats;

  const gallonHalves = 2n * coverageSqFt * SQ_FT;

  return {
    coats,
    coverageSqFt,
    ceilingIncluded: ceiling,
    wallFace: squareFeet(q.wallFaceArea),
    ceilingArea: squareFeetOfHalves(q.ceilingArea),
    areaPerCoat: squareFeetOfHalves(perCoatHalves),
    areaAllCoats: squareFeetOfHalves(totalHalves),
    /** To two places, so somebody can see how much of the last can is spare. */
    gallons: decimals(totalHalves, gallonHalves, 2),
    /** What actually comes off the shelf. */
    gallonsToBuy: ceilDiv(totalHalves, gallonHalves),
  };
}

/* ==================================================================== 5 of 5
 * Baseboard and trim
 * ======================================================================== */

/**
 * Base and trim, in linear feet, off the engine's own baseboard run.
 *
 * The run is the perimeter of the built walls less every door and every cased
 * opening, and windows are not deducted, because base runs under a window.
 * That is `byWall` in `core/src/zone.ts` and it is not restated here.
 */
export function trim(room, { stockLengthNm = null, wasteBasisPoints = 0n } = {}) {
  const q = roomQuantities(room);
  const round = perimeter(room);
  const deducted = round.value - q.baseboardRun - q.openRun;
  const withWaste = (q.baseboardRun * (10_000n + wasteBasisPoints)) / 10_000n;

  return {
    perimeterNm: round.value,
    perimeter: linearFeet(round.value),
    perimeterSaid: formatFeetInches(round.value),
    deductedNm: deducted,
    deducted: linearFeet(deducted),
    deductedSaid: formatFeetInches(deducted),
    openRun: linearFeet(q.openRun),
    baseboardNm: q.baseboardRun,
    baseboard: linearFeet(q.baseboardRun),
    baseboardSaid: formatFeetInches(q.baseboardRun),
    wasteBasisPoints,
    baseboardWithWaste: linearFeet(withWaste),
    /**
     * How many sticks that is, if a stock length was given.
     *
     * Straight division and rounded up, and the page says out loud that it is:
     * how many pieces a run really takes depends on where the joins land and
     * how much every mitre eats, and neither of those is something a room's
     * geometry knows.
     */
    pieces: stockLengthNm === null ? null : ceilDiv(withWaste, stockLengthNm),
    stockLengthNm,
  };
}

/* ------------------------------------------------------------------ reading */

/**
 * A length typed into a form, with the field's own name in the error.
 *
 * `parseLength` says why it refused; this puts the field in front of it, so a
 * form with six length boxes says which box is wrong.
 */
export function readLength(text, field, defaultUnit = 'ft') {
  const raw = String(text ?? '').trim();
  if (raw === '') throw new LengthError(`${field} is empty.`);
  try {
    const value = parseLength(raw, { defaultUnit });
    if (value <= 0n) throw new LengthError(`${field} has to be more than nothing.`);
    return value;
  } catch (error) {
    if (error instanceof LengthError) throw new LengthError(`${field}: ${error.message}`);
    throw error;
  }
}

export { NM_PER_FOOT, NM_PER_INCH, SQ_FT, decimals, linearFeet, squareFeet, squareFeetOfHalves };
