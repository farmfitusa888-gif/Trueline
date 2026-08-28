/**
 * The calculators, driven in a real browser.
 *
 * `tools/calc-truth.mjs` proves the arithmetic. It cannot prove the page: that
 * the module actually loads over HTTP under the deployed content security
 * policy, that the form's names match what the wiring looks for, that the shape
 * switch appears, that typing in a box produces the figure the engine produced.
 * Every one of those can be broken while every number in the build is perfect.
 *
 * So this serves `dist` on 127.0.0.1:4356, opens each calculator, types into
 * it, and compares what appears on screen with what the engine says — and fails
 * on a single console error, because a module that 404s fails silently and
 * leaves a form that simply does nothing.
 *
 *   node site/tools/calc-browser.mjs
 *
 * Not part of `npm run site`, and deliberately not: it needs a browser and a
 * port, and the build that runs on deploy has neither. It is the check somebody
 * runs after touching the form or the wiring.
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openChromium } from '../../core/tools/browser.mjs';
import * as E from '../src/calc/engine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, '../dist');
const PORT = 4356;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * The static server, with the deployed CSP on every response.
 *
 * The header is read out of `site/netlify.toml` rather than written here, so
 * this is testing the policy that will actually be served. A calculator that
 * works on a bare local server and is blocked in production is the exact bug
 * `check.mjs` already refuses to let the films have.
 */
function serve() {
  const toml = readFileSync(join(HERE, '../netlify.toml'), 'utf8');
  const policy = /Content-Security-Policy = "([^"]*)"/.exec(toml)?.[1] ?? '';
  if (!policy) throw new Error('site/netlify.toml has no Content-Security-Policy to serve with.');

  const server = createServer((request, response) => {
    const asked = decodeURIComponent(request.url.split('?')[0]);
    const relative = normalize(asked).replace(/^(\.\.[/\\])+/, '');
    let file = join(DIST, relative);
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('not here');
      return;
    }
    response.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'content-security-policy': policy,
    });
    response.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

/* --------------------------------------------------------------- the drives */

const ft = (n) => BigInt(n) * E.NM_PER_FOOT;

/** A rectangle with the openings the form is about to be given. */
function rectangle({ width, depth, height, openings = [], thickness }) {
  const walk = openings.length
    ? E.placeOpenings(E.rectangleWalk(width, depth), openings)
    : E.rectangleWalk(width, depth);
  return E.buildRoom(walk, height, thickness === undefined ? {} : { wallThickness: thickness });
}

/**
 * What to type, and what must be on screen afterwards.
 *
 * The expectations are the engine's own answers, computed here in Node. The
 * point of this file is not to re-check the arithmetic — `calc-truth.mjs` does
 * that against figures worked out by hand — it is to check that the number the
 * engine produces is the number a person sees.
 */
const DRIVES = [
  {
    path: '/calculators/markup-vs-margin/',
    type: { cost: '18500', markup: '35', targetMargin: '30' },
    expect: () => {
      const r = E.markupToMargin(E.parseMoney('18500'), 3500n);
      return [
        E.money(r.priceCents),
        E.money(r.marginCents),
        `${E.percent(r.marginBasisPoints)}%`,
        `${E.percent(E.marginToMarkup(3000n))}%`,
      ];
    },
  },
  {
    path: '/calculators/drywall-sheets/',
    type: { width: "16'", depth: "13' 6\"", height: "9'", doors: '2', windows: '1', waste: '12.5' },
    select: { sheet: '4x12' },
    expect: () => {
      const room = rectangle({
        width: ft(16),
        depth: E.parseLength("13' 6\""),
        height: ft(9),
        thickness: E.parseLength('4 1/2"'),
        openings: [
          { kind: 'door', count: 2n, width: ft(3), height: E.parseLength("6' 8\"") },
          { kind: 'window', count: 1n, width: ft(3), height: ft(5) },
        ],
      });
      const r = E.drywall(room, { sheet: '4x12', wasteBasisPoints: 1250n });
      return [`${r.wallFace} sq ft`, `${r.boardArea} sq ft`, `${r.sheets}`, `${r.sheetsWithWaste}`];
    },
  },
  {
    path: '/calculators/paint/',
    type: { width: "16'", depth: "13' 6\"", height: "9'", doors: '2', windows: '1',
            coats: '3', coverage: '325' },
    expect: () => {
      const room = rectangle({
        width: ft(16),
        depth: E.parseLength("13' 6\""),
        height: ft(9),
        openings: [
          { kind: 'door', count: 2n, width: ft(3), height: E.parseLength("6' 8\"") },
          { kind: 'window', count: 1n, width: ft(3), height: ft(5) },
        ],
      });
      const r = E.paint(room, { coats: 3n, coverageSqFt: 325n });
      return [`${r.areaAllCoats} sq ft`, `${r.gallons} gal`, `${r.gallonsToBuy}`];
    },
  },
  {
    path: '/calculators/baseboard-trim/',
    type: { width: "16'", depth: "13' 6\"", height: "9'", doors: '2', windows: '1',
            cased: '1', casedWidth: "5'", casedHeight: "7'" },
    select: { stock: "12'" },
    expect: () => {
      const room = rectangle({
        width: ft(16),
        depth: E.parseLength("13' 6\""),
        height: ft(9),
        openings: [
          { kind: 'door', count: 2n, width: ft(3), height: E.parseLength("6' 8\"") },
          { kind: 'window', count: 1n, width: ft(3), height: ft(5) },
          { kind: 'cased', count: 1n, width: ft(5), height: ft(7) },
        ],
      });
      const r = E.trim(room, { stockLengthNm: ft(12) });
      return [`${r.perimeter} lf`, `${r.deducted} lf`, `${r.baseboard} lf`, `${r.pieces}`];
    },
  },
  {
    // The one field nothing can be inferred for, left empty. The page must ask
    // for it rather than showing a parse error, and it must still show what it
    // does know about the room.
    path: '/calculators/paint/',
    name: 'paint, with no coverage rate typed',
    type: { width: "10'", depth: "10'", height: "8'", doors: '0', windows: '0',
            coats: '2', coverage: '' },
    expect: () => {
      const room = E.buildRoom(E.rectangleWalk(ft(10), ft(10)), ft(8));
      const f = E.roomFigures(room);
      return [`${f.wallFace} sq ft`, 'coverage rate'];
    },
  },
  {
    path: '/calculators/odd-shaped-room/',
    // The page opens on the L already walked, so this one is checked as it
    // loads — which is also the state a visitor arriving from a search sees.
    type: {},
    expect: () => {
      const room = E.buildRoom(
        [
          { heading: 'east', length: ft(20) },
          { heading: 'south', length: ft(12) },
          { heading: 'west', length: ft(8) },
          { heading: 'south', length: ft(8) },
          { heading: 'west', length: ft(12) },
          { heading: 'north', length: ft(20) },
        ],
        ft(9)
      );
      const f = E.roomFigures(room);
      return [`${f.floorArea} sq ft`, `${f.perimeterFeet} lf`, `${f.wallFace} sq ft`];
    },
  },
];

/* ------------------------------------------------------------------ running */

const server = await serve();
const browser = await openChromium();
const problems = [];

try {
  for (const drive of DRIVES) {
    const page = await browser.newPage();
    const noise = [];
    const ours = (url) => url.startsWith(`http://127.0.0.1:${PORT}`) || url === '';
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      // A console error carries the URL it is about, and the generic "Failed to
      // load resource" text does not. The one outside host these pages touch is
      // Google Fonts, and a machine with no route to it — a CI container, a job
      // site — is not a broken page: every face here has a real fallback stack
      // for exactly that. Ours, and only ours.
      if (!ours(message.location()?.url ?? '')) return;
      noise.push(message.text());
    });
    page.on('pageerror', (error) => noise.push(String(error)));
    // Only our own origin. The one outside host these pages touch is Google
    // Fonts, and a machine with no route to it -- a CI container, a job site --
    // is not a broken page: every face on this site has a real fallback stack
    // for exactly that. A same-origin request that fails is a missing file.
    page.on('requestfailed', (request) => {
      if (!ours(request.url())) return;
      noise.push(`${request.url()} failed: ${request.failure()?.errorText}`);
    });

    const what = drive.name ?? drive.path;
    await page.goto(`http://127.0.0.1:${PORT}${drive.path}`, { waitUntil: 'load' });

    // The wiring marks the form when it has actually attached. Waiting on that
    // rather than on a timeout, so a module that never loaded fails here with a
    // sentence rather than by producing an empty answer box.
    try {
      await page.waitForSelector('[data-calc][data-live="yes"]', { timeout: 5000 });
    } catch {
      problems.push(`${what}: the calculator never came alive. ${noise.join(' | ')}`);
      await page.close();
      continue;
    }

    // The shape switch is hidden in the HTML and unhidden by the wiring.
    if (await page.locator('[data-shape-switch]').count()) {
      if (await page.locator('[data-shape-switch]').isHidden()) {
        problems.push(`${what}: the rectangle/walk switch never appeared`);
      }
    }

    for (const [name, value] of Object.entries(drive.type)) {
      await page.fill(`[name="${name}"]`, value);
    }
    for (const [name, value] of Object.entries(drive.select ?? {})) {
      await page.selectOption(`[name="${name}"]`, value);
    }

    const shown = (await page.locator('[data-out]').innerText()).replace(/\s+/g, ' ');
    for (const wanted of drive.expect()) {
      if (!shown.includes(wanted)) {
        problems.push(
          `${what}: the page does not show "${wanted}", which the engine gives for what `
            + `was typed. On screen: ${shown}`);
      }
    }
    if (noise.length) {
      problems.push(`${what}: the browser complained — ${noise.join(' | ')}`);
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

if (problems.length) {
  for (const p of problems) console.log('  ✗ ' + p);
  console.log(`\n${problems.length} problem(s).`);
  process.exit(1);
}
const pages_ = new Set(DRIVES.map((d) => d.path)).size;
console.log(`${DRIVES.length} drives over ${pages_} calculators, in a real browser under the `
  + 'deployed CSP: every one loaded, attached, and printed the figure the engine gives.');
