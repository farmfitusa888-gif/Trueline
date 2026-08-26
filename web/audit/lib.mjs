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
 * builds the web bundle, serves it, and walks every part. Every fixture it
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
 * What the page has sent the app through one of its message handlers.
 *
 * Only from a page opened with `openAsApp`, which is the only one that has the
 * handlers on it. Newest last, and empty rather than undefined when nothing has
 * been sent — a part asking "did the room reach the app" should get `[]` and
 * fail its own check, not a TypeError two lines later.
 */
export async function sentTo(page, name) {
  return page.evaluate((which) => window.__sent?.[which] ?? [], name);
}

/**
 * The app, as it actually hands a room over — parked before the page loads.
 *
 * ## Why this exists and `appLike` in A10 was not enough
 *
 * A10 loads the room through the file picker and then calls `setSubscribed`
 * from a page that is already up. That is a state the phone is never in. On a
 * phone the app talks to a page that may not have run its modules yet, so the
 * payload is parked on `window.truelinePayload` for `installBridge` to drain —
 * and for months the parked payload carried the room and nothing else. The
 * subscription answer was dropped, `waiting()` stayed true forever, and five
 * screens drew themselves as empty rectangles.
 *
 * Seventeen audit parts and 264 checks never saw it, because every one of them
 * answered the entitlement from a live page. This is the missing state: park
 * exactly what `CorrectView.hand(over:)` writes, before anything runs.
 *
 * Leave `subscribed` out of the payload to get the state the bug produced — the
 * app never says. Nothing should ever be blank in it.
 */
export async function openAsApp(payload, { scheme = 'light' } = {}) {
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({
    viewport: { width: 430, height: 1600 },
    acceptDownloads: true,
    colorScheme: scheme,
  });
  const page = await ctx.newPage();
  problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  await page.addInitScript((parked) => {
    // The handlers `insideApp()` looks for. Present before a line of the
    // bundle runs, which is how it is on the phone.
    //
    // Each one keeps what it was sent, because half of what this app does on a
    // phone is send something to the native side and trust it landed. The
    // corrected room, the contractor's profile, the plan thumbnail: none of it
    // is visible on the screen, and a check that cannot see it can only ever
    // prove the button was there. `sentTo` reads them back.
    window.__sent = {};
    window.webkit = { messageHandlers: {} };
    for (const name of ['saved', 'thumbnail', 'company', 'photo', 'calendar', 'trouble']) {
      window.__sent[name] = [];
      window.webkit.messageHandlers[name] = {
        postMessage(body) {
          window.__sent[name].push(body);
        },
      };
    }
    if (parked) window.truelinePayload = parked;
  }, payload);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  return { browser, ctx, page };
}

/** Every section of a room, by the name the tab bar uses. */
export const SECTIONS = [
  'Plan', 'Room', 'Takeoff', 'Price', 'Agreement', 'Work', 'Insurance', 'Files',
];

/**
 * Contrast between two `rgb(...)` strings, by WCAG's own formula.
 *
 * Here because "can you read it" is not answerable by looking at class names,
 * and the bug it was written for — every text field in the app painting
 * near-white text on WebKit's near-white default input background — is
 * invisible to every other kind of check.
 */
export function contrast(a, b) {
  const lum = (rgb) => {
    const [r, g, bl] = String(rgb).match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

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
    Plan: 'plan', Room: 'room', Takeoff: 'takeoff', Price: 'price',
    Agreement: 'agree', Work: 'work', Insurance: 'claim', Files: 'files',
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
