/**
 * The calculators, checked against arithmetic that was not done by them.
 *
 * ## Why this exists at all
 *
 * A dead link is visible. A calculator that is quietly wrong is not: it prints
 * a confident number, in the same typeface as a correct one, and the first
 * person to find out is a contractor who ordered against it. On a site whose
 * entire argument is that it never prints a number it cannot defend, a
 * calculator that disagrees with the app is worse than having no calculator.
 *
 * So this checks three separate things, and it is three rather than one because
 * they fail in three different ways:
 *
 *   1. **The engine against figures worked out independently.** Every expected
 *      value below was derived by hand, on paper, from the room's own
 *      dimensions — never by running the code and writing down what it said,
 *      which would test nothing at all. A second, deliberately naive model
 *      using ordinary decimal arithmetic checks the same rooms to within a
 *      hundredth, so a case nobody hand-checked still cannot drift far.
 *   2. **The bundle against the source.** The browser is served
 *      `dist/calc-engine.js`, which esbuild produced from `src/calc/engine.mjs`.
 *      Those are not the same bytes, so both are loaded and run on every case,
 *      and any disagreement between them is a bundler doing something to the
 *      arithmetic.
 *   3. **The pages against the engine.** Every figure printed in the prose and
 *      the tables of a calculator page comes from `content/worked.mjs`. This
 *      re-derives them and confirms each one is actually on the page it belongs
 *      to — so a template that dropped a figure, escaped one wrongly, or had a
 *      number typed into it by hand fails the build.
 *
 *   node site/tools/calc-truth.mjs
 *
 * Also run by `tools/check.mjs`, which is what `npm run site` runs.
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

import * as SOURCE from '../src/calc/engine.mjs';
import * as WORKED from '../content/worked.mjs';
import { CALCULATORS } from '../content/calculators.mjs';
import { ENGINE_FILE } from './engine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------- the rooms, by hand */

const FT = 304_800_000n; // 12 inches of 25.4mm, exactly. Written out, not imported.

/**
 * Every case, with what it should produce and why.
 *
 * The `expect` values are worked out from the dimensions and written down here.
 * A 12 × 14 room has a 52 ft perimeter; at 8 ft that is 416 sq ft of wall face;
 * a 3 ft × 6 ft 8 in door is 36 in × 80 in = 2,880 sq in = exactly 20 sq ft; a
 * 3 ft × 5 ft window is 15; 416 − 20 − 15 = 381. None of those came from
 * running the code.
 */
const CASES = [
  {
    name: 'markup — $100 at 30%',
    run: (E) => {
      const r = E.markupToMargin(10_000n, 3000n);
      return {
        price: r.priceCents,
        profit: r.marginCents,
        marginBasisPoints: r.marginBasisPoints,
      };
    },
    // $100 + 30% = $130. Profit $30. $30 / $130 = 0.230769… = 23.08%.
    expect: { price: 13_000n, profit: 3_000n, marginBasisPoints: 2308n },
  },
  {
    name: 'markup — $250,000 at 20%',
    run: (E) => {
      const r = E.markupToMargin(25_000_000n, 2000n);
      return { price: r.priceCents, profit: r.marginCents, marginBasisPoints: r.marginBasisPoints };
    },
    // $250,000 + 20% = $300,000. Profit $50,000. 50/300 = 0.16666… = 16.67%.
    expect: { price: 30_000_000n, profit: 5_000_000n, marginBasisPoints: 1667n },
  },
  {
    name: 'margin back to markup',
    run: (E) => ({
      twenty: E.marginToMarkup(2000n),
      thirty: E.marginToMarkup(3000n),
      half: E.marginToMarkup(5000n),
    }),
    // 0.2/0.8 = 0.25. 0.3/0.7 = 0.428571… = 42.86%. 0.5/0.5 = 1.
    expect: { twenty: 2500n, thirty: 4286n, half: 10_000n },
  },
  {
    name: '12 × 14 at 8 ft, one door, one window',
    room: () => ({ width: 12n * FT, depth: 14n * FT, height: 8n * FT, thickness: '4 1/2"',
                   door: 1, window: 1 }),
    run: (E) => {
      const room = buildExample(E);
      const f = E.roomFigures(room);
      const board = E.drywall(room, { sheet: '4x8' });
      const twelves = E.drywall(room, { sheet: '4x12' });
      const wasted = E.drywall(room, { sheet: '4x8', wasteBasisPoints: 1000n });
      const walls = E.drywall(room, { sheet: '4x8', ceiling: false });
      const coats = E.paint(room, { coats: 2n, coverageSqFt: 350n });
      const base = E.trim(room, { stockLengthNm: 16n * FT });
      return {
        floorArea: f.floorArea,
        perimeter: f.perimeterFeet,
        wallFace: f.wallFace,
        baseboard: f.baseboard,
        boardArea: board.boardArea,
        sheetArea: board.sheetArea,
        sheets: board.sheets,
        sheetsTwelve: twelves.sheets,
        sheetsWasted: wasted.sheetsWithWaste,
        sheetsWallsOnly: walls.sheets,
        wrap: board.openingWrap,
        gallons: coats.gallons,
        gallonsToBuy: coats.gallonsToBuy,
        pieces: base.pieces,
        deducted: base.deducted,
      };
    },
    expect: {
      floorArea: '168.0',        // 12 × 14
      perimeter: '52.00',        // 12 + 14 + 12 + 14
      wallFace: '381.0',         // 52 × 8 = 416, less 20 (door) and 15 (window)
      baseboard: '49.00',        // 52 less the 3 ft door; the window does not come off
      boardArea: '549.0',        // 381 wall + 168 ceiling
      sheetArea: '32.0',         // 4 × 8
      sheets: 18n,               // 549 / 32 = 17.16, up
      sheetsTwelve: 12n,         // 549 / 48 = 11.4375, up
      sheetsWasted: 19n,         // 549 × 1.1 = 603.9, / 32 = 18.87, up
      sheetsWallsOnly: 12n,      // 381 / 32 = 11.9, up
      // Door reveal 2 × 80 in + 36 in = 196 in. Window 2 × 60 + 2 × 36 = 192 in.
      // 388 in of reveal × 4.5 in of wall = 1,746 sq in = 12.125 sq ft.
      wrap: '12.1',
      gallons: '2.18',           // 381 × 2 = 762, / 350 = 2.177
      gallonsToBuy: 3n,
      pieces: 4n,                // 49 / 16 = 3.06, up
      deducted: '3.00',          // the door, and only the door
    },
    naive: { perimeterFt: 52, floorFt: 168, heightFt: 8, openings: [[3, 20 / 3], [3, 5]],
             doorsFt: 3 },
  },
  {
    name: '10 × 10 at 8 ft, nothing in the walls',
    run: (E) => {
      const room = E.buildRoom(E.rectangleWalk(10n * FT, 10n * FT), 8n * FT);
      const f = E.roomFigures(room);
      return {
        floorArea: f.floorArea,
        perimeter: f.perimeterFeet,
        wallFace: f.wallFace,
        baseboard: f.baseboard,
        sheets: E.drywall(room, { sheet: '4x8', ceiling: false }).sheets,
      };
    },
    // 40 ft round, 100 sq ft of floor, 320 sq ft of wall, 320/32 = exactly 10.
    expect: { floorArea: '100.0', perimeter: '40.00', wallFace: '320.0', baseboard: '40.00',
              sheets: 10n },
    naive: { perimeterFt: 40, floorFt: 100, heightFt: 8, openings: [], doorsFt: 0 },
  },
  {
    name: 'metric — 3050mm × 4000mm',
    run: (E) => {
      const room = E.buildRoom(
        E.rectangleWalk(E.parseLength('3050mm'), E.parseLength('4000mm')),
        E.parseLength('2450mm')
      );
      const f = E.roomFigures(room);
      return { floorArea: f.floorArea, perimeter: f.perimeterFeet };
    },
    // The inch is exactly 25.4mm, so 3.05 m is 3050/304.8 = 10.006561… ft and
    // 4 m is 13.123359… ft. Their product is 131.3195… sq ft; the perimeter is
    // 2 × (10.006561 + 13.123359) = 46.25984 ft.
    expect: { floorArea: '131.3', perimeter: '46.26' },
  },
  {
    name: 'the L — 20 across the front, an 8 ft square out of the corner',
    run: (E) => {
      const room = E.buildRoom(
        [
          { heading: 'east', length: 20n * FT },
          { heading: 'south', length: 12n * FT },
          { heading: 'west', length: 8n * FT },
          { heading: 'south', length: 8n * FT },
          { heading: 'west', length: 12n * FT },
          { heading: 'north', length: 20n * FT },
        ],
        9n * FT
      );
      const f = E.roomFigures(room);
      return {
        closes: f.closes,
        floorArea: f.floorArea,
        perimeter: f.perimeterFeet,
        wallFace: f.wallFace,
        baseboard: f.baseboard,
      };
    },
    // 20 × 20 = 400, less the 8 × 8 bite = 336. The walk is
    // 20 + 12 + 8 + 8 + 12 + 20 = 80 ft — the same as the box it sits in.
    // 80 × 9 = 720 sq ft of wall face, and nothing is deducted from base.
    expect: { closes: true, floorArea: '336.0', perimeter: '80.00', wallFace: '720.0',
              baseboard: '80.00' },
    naive: { perimeterFt: 80, floorFt: 336, heightFt: 9, openings: [], doorsFt: 0 },
  },
  {
    name: 'a walk that does not close is refused an area',
    run: (E) => {
      const room = E.buildRoom(
        [
          { heading: 'east', length: 20n * FT },
          { heading: 'south', length: 12n * FT },
          { heading: 'west', length: 8n * FT },
          { heading: 'south', length: 8n * FT },
          { heading: 'west', length: 12n * FT },
          { heading: 'north', length: 19n * FT },
        ],
        9n * FT
      );
      const f = E.roomFigures(room);
      return { closes: f.closes, gapX: f.closureGap.x, gapY: f.closureGap.y };
    },
    // One run written down a foot short: the walk finishes a foot south of
    // where it started, and nothing east or west.
    expect: { closes: false, gapX: 0n, gapY: -FT },
  },
  {
    name: 'more opening than there is wall is refused',
    run: (E) => {
      try {
        E.placeOpenings(E.rectangleWalk(10n * FT, 10n * FT), [
          { kind: 'door', count: 8n, width: 6n * FT, height: 7n * FT },
        ]);
        return { refused: false };
      } catch (error) {
        return { refused: error instanceof E.RoomError };
      }
    },
    // 8 doors of 6 ft is 48 ft of opening in 40 ft of wall.
    expect: { refused: true },
  },
];

/** The 12 × 14 example room, built the way the pages build it. */
function buildExample(E) {
  const walk = E.placeOpenings(E.rectangleWalk(12n * FT, 14n * FT), [
    { kind: 'door', count: 1n, width: 3n * FT, height: E.parseLength("6' 8\"") },
    { kind: 'window', count: 1n, width: 3n * FT, height: 5n * FT },
  ]);
  return E.buildRoom(walk, 8n * FT, { wallThickness: E.parseLength('4 1/2"') });
}

/**
 * The second opinion: the same quantities in ordinary decimal arithmetic.
 *
 * Deliberately the naive way — plain floating-point feet, the way somebody
 * would do it on a phone calculator — because the point is to disagree with the
 * engine if the engine is wrong, not to reproduce its method. Compared to a
 * hundredth of a foot, which is well inside anything a float can lose at these
 * magnitudes and well outside any real arithmetic error.
 */
function naive({ perimeterFt, floorFt, heightFt, openings, doorsFt }) {
  const openingArea = openings.reduce((sum, [w, h]) => sum + w * h, 0);
  return {
    floorArea: floorFt,
    perimeter: perimeterFt,
    wallFace: perimeterFt * heightFt - openingArea,
    baseboard: perimeterFt - doorsFt,
  };
}

/* ------------------------------------------------------------------ running */

const say = (value) => (typeof value === 'bigint' ? `${value}n` : String(value));

function compare(problems, label, got, want) {
  for (const key of Object.keys(want)) {
    if (!(key in got)) {
      problems.push(`${label}: nothing came back for "${key}"`);
      continue;
    }
    if (got[key] !== want[key]) {
      problems.push(`${label}: ${key} is ${say(got[key])}, and it should be ${say(want[key])}`);
    }
  }
}

/**
 * Loads the bundle the browser is actually served.
 *
 * Copied to a `.mjs` first, only so Node stops warning about a `.js` file in a
 * package with no `type` field. The bytes are unchanged, which is the whole
 * point of loading it rather than the source.
 */
async function loadBundle(dist) {
  const built = join(dist, ENGINE_FILE);
  if (!existsSync(built)) return null;
  const into = join(mkdtempSync(join(tmpdir(), 'trueline-engine-')), 'engine.mjs');
  copyFileSync(built, into);
  return import(pathToFileURL(into).href);
}

/** Every string in an object or array, flattened, for the "is it on the page" check. */
function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) strings(v, out);
  return out;
}

/**
 * Which figures have to be visible on which page.
 *
 * Named explicitly rather than "everything in worked.mjs", because a few of the
 * derived values exist to be checked rather than to be printed — the corner
 * coordinates of the L, for instance. Everything a page argues from is here.
 */
function figuresOnPages(W) {
  return [
    ['/calculators/markup-vs-margin/', [
      W.MARKUP.cost, W.MARKUP.markup, W.MARKUP.price, W.MARKUP.profit, W.MARKUP.margin,
      W.MARKUP.markupForThirty, W.MARKUP.markupWorking, W.MARKUP.marginWorking,
      W.MARKUP.costWorked, ...strings(W.MARKUP.table), ...strings(W.MARKUP.wanted),
    ]],
    ['/calculators/drywall-sheets/', [
      W.DRYWALL.wasteShown, W.DRYWALL.boardArea, W.DRYWALL.wrap, W.DRYWALL.wallsOnly,
      ...strings(W.DRYWALL.table),
      W.ROOM_FIGURES.perimeter, W.ROOM_FIGURES.wallFace, W.ROOM_FIGURES.wallFaceGross,
      W.ROOM_FIGURES.ceilingArea,
    ]],
    ['/calculators/paint/', [
      W.PAINT.coverage, W.PAINT.wallFace, W.PAINT.onePass, W.PAINT.twoCoats, W.PAINT.gallons,
      W.PAINT.buy, W.PAINT.withCeilingArea, W.PAINT.withCeilingGallons, W.PAINT.withCeilingBuy,
    ]],
    ['/calculators/baseboard-trim/', [
      W.BASEBOARD.perimeter, W.BASEBOARD.deducted, W.BASEBOARD.run, W.BASEBOARD.sticks,
      W.BASEBOARD.stock,
    ]],
    ['/calculators/odd-shaped-room/', [
      W.ODD_ROOM.floorArea, W.ODD_ROOM.perimeter, W.ODD_ROOM.wallFace, W.ODD_ROOM.baseboard,
      W.ODD_ROOM.boxArea, W.ODD_ROOM.overstated, W.ODD_ROOM.bite, W.ODD_ROOM.ceilingHeight,
    ]],
    // The one page on this site with a legal deadline printed on it. Every date
    // in its table is counted by `core/src/cooling.ts`, and this is what makes
    // sure the table on the page is the one the engine produced.
    ['/guides/three-day-right-to-cancel/', [
      ...W.COOLING.rows.map((r) => r.signed), ...W.COOLING.rows.map((r) => r.deadline),
      ...W.COOLING.rows.map((r) => r.counted),
    ]],
    ['/guides/takeoff-formulas/', [
      W.ROOM_FIGURES.floorArea, W.ROOM_FIGURES.perimeter, W.ROOM_FIGURES.wallFace,
      W.ROOM_FIGURES.wallFaceGross, W.ROOM_FIGURES.baseboard,
      W.EXAMPLE_SAID.width, W.EXAMPLE_SAID.depth, W.EXAMPLE_SAID.height,
      W.EXAMPLE_SAID.doorWidth, W.EXAMPLE_SAID.doorHeight,
      W.EXAMPLE_SAID.windowWidth, W.EXAMPLE_SAID.windowHeight,
      ...W.MEASURE_ROWS.map((m) => m.label), ...W.MEASURE_ROWS.map((m) => m.workings),
    ]],
  ];
}

export async function verifyCalculators(dist) {
  const problems = [];

  const bundle = await loadBundle(dist);
  if (!bundle) {
    problems.push(
      `${ENGINE_FILE} was never built, so five calculator pages would load nothing. `
        + 'Run node site/build.mjs.');
  }

  for (const testCase of CASES) {
    let fromSource;
    try {
      fromSource = testCase.run(SOURCE);
    } catch (error) {
      problems.push(`${testCase.name}: the engine threw — ${error.message}`);
      continue;
    }
    compare(problems, `${testCase.name} [engine]`, fromSource, testCase.expect);

    if (bundle) {
      let fromBundle;
      try {
        fromBundle = testCase.run(bundle);
      } catch (error) {
        problems.push(`${testCase.name}: the bundled engine threw — ${error.message}`);
        continue;
      }
      // Not against the expectations — against the source. A disagreement here
      // is the bundler having changed the arithmetic on its way to the browser.
      compare(problems, `${testCase.name} [bundle vs source]`, fromBundle, fromSource);
    }

    if (testCase.naive) {
      const second = naive(testCase.naive);
      for (const [key, value] of Object.entries(second)) {
        const engine = Number(fromSource[key]);
        if (!Number.isFinite(engine)) {
          problems.push(`${testCase.name}: "${key}" did not come back as a number`);
          continue;
        }
        if (Math.abs(engine - value) > 0.01) {
          problems.push(
            `${testCase.name}: the engine says ${key} is ${fromSource[key]} and doing it the `
              + `ordinary way gives ${value}`);
        }
      }
    }
  }

  /* --- the pages print what the engine worked out, and nothing else --- */

  for (const [path, figures] of figuresOnPages(WORKED)) {
    const file = join(dist, path.replace(/^\//, ''), 'index.html');
    if (!existsSync(file)) {
      problems.push(`${path} was not built, so its figures cannot be checked`);
      continue;
    }
    const html = readFileSync(file, 'utf8');
    for (const figure of new Set(figures)) {
      if (!html.includes(figure)) {
        problems.push(
          `${path} does not print "${figure}", which the engine worked out for it. Either the `
            + 'page dropped a figure or a number on it was typed by hand.');
      }
    }
  }

  /* --- every calculator names a function the engine actually has --- */

  const KNOWN = new Set(['markup', 'drywall', 'paint', 'trim', 'room']);
  for (const calculator of CALCULATORS) {
    if (!KNOWN.has(calculator.calc)) {
      problems.push(`/calculators/${calculator.slug}/ runs "${calculator.calc}", which is not a `
        + 'calculator the wiring knows about');
    }
  }

  return problems;
}

/* ------------------------------------------------------------------- as a CLI */

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = await verifyCalculators(join(HERE, '../dist'));
  if (problems.length) {
    for (const p of problems) console.log('  ✗ ' + p);
    console.log(`\n${problems.length} problem(s).`);
    process.exit(1);
  }
  console.log(`${CASES.length} cases: the engine, the bundle the browser gets, and a second `
    + 'opinion in ordinary arithmetic all agree, and every page prints what the engine worked '
    + 'out.');
}
