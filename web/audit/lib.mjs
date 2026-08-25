import { chromium } from 'playwright';

/**
 * Driving the whole app in a real browser, feature by feature.
 *
 * Every check here is a thing a person would notice on a phone and no unit test
 * can see: a control with no accessible name, a number that does not move when
 * it should, a document that goes blank without a signal, a screen that says
 * one thing and does another.
 *
 * It is written to be re-run. `npm run audit` from the top of the repository
 * builds the web bundle, serves it, and walks all seven parts. Every fixture it
 * needs — two scans, a supplier price list, a photograph — is in this folder,
 * so it needs nothing from anybody's machine.
 *
 * The checks state what should be true rather than what the code does, and
 * several of them were written *before* the thing they check worked. Two real
 * bugs came straight out of writing them: every tape-reading box on the screen
 * was named after its own placeholder ("e.g. 20 feet"), so with a wall, a
 * ceiling and a door open at once a screen reader announced three identical
 * fields; and the business toggle kept the accessible name "Your business"
 * while showing the word "Close".
 */

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The fixtures live beside these scripts, so the audit needs nothing else. */
export const SP = dirname(fileURLToPath(import.meta.url));
export const URL = process.env.TRUELINE_AUDIT_URL ?? 'http://127.0.0.1:4173/';
const CHROME =
  process.env.TRUELINE_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export const results = [];
let problems = [];

export function check(name, condition, detail = '') {
  results.push({ name, ok: !!condition, detail: condition ? '' : detail });
}

export async function open() {
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 430, height: 1600 }, acceptDownloads: true });
  const page = await ctx.newPage();
  problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  return { browser, ctx, page };
}

export function noise() { return problems; }

/**
 * Select a wall by keyboard, which is also the screen-reader path.
 *
 * Idempotent: pressing Enter on a wall that is already selected DESELECTS it,
 * which is right in the app and wrong in a script that just wants it picked.
 */
export async function pick(page, re) {
  const wall = page.getByRole('button', { name: re }).first();
  if ((await wall.getAttribute('aria-pressed')) === 'true') return;
  await wall.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
}

/**
 * Opens one of the room's sections.
 *
 * The app used to be a single column: everything was on screen at once and a
 * script could find any of it by name. It is tabbed now, because on a phone
 * that column put "Is this an insurance job?" ten screens below the fold and
 * the feature might as well not have been built. So every part of this audit
 * has to say which section its subject lives in — the same thing a person now
 * has to do, which is the point.
 *
 * Idempotent, and it waits for the panel to actually be showing rather than
 * for a timeout, so a slow machine does not fail a passing check.
 */
export async function section(page, title) {
  // Scoped to the bar: "Plan" is also the start of every wall's label on the
  // drawing, and a badge puts a number inside the tab's own name.
  const tab = page
    .getByRole('navigation', { name: 'Parts of this room' })
    .getByRole('button', { name: new RegExp('^' + title) })
    .first();
  await tab.click();
  const key = {
    Plan: 'plan', Room: 'room', Takeoff: 'takeoff',
    Price: 'price', Insurance: 'claim', Files: 'files',
  }[title];
  await page.waitForSelector(`[data-panel="${key}"]:not([hidden])`, { timeout: 5000 });
}

export async function loadScan(page, file = 'garage.json') {
  await page.setInputFiles('input[type=file][accept="application/json,.json"]', `${SP}/${file}`);
  await page.waitForTimeout(500);
}

export function report(title) {
  const bad = results.filter((r) => !r.ok);
  console.log(`\n===== ${title} =====`);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  <<< ' + r.detail}`);
  console.log(`\n${results.length - bad.length}/${results.length} passed`);
  if (problems.length) console.log('console/page errors:', problems);
  return bad.length;
}
