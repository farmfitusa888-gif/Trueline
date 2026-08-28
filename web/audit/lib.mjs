import { openChromium } from '../../core/tools/browser.mjs';

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

import { readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The fixtures live beside these scripts, so the audit needs nothing else. */
export const SP = dirname(fileURLToPath(import.meta.url));
export const URL = process.env.TRUELINE_AUDIT_URL ?? 'http://127.0.0.1:4173/';

/**
 * How tall a window these parts open, and why it is a variable.
 *
 * 1600 is not a phone. An iPhone 15 Pro Max is 932 points tall and a browser
 * takes a bite out of that, so a real one is nearer 800. At 1600 NOTHING is
 * ever below the fold — which means no check about whether a person can SEE
 * something has ever been able to fail here, and four bugs in two days were
 * exactly that: the paywall the app could never present, a refusal 280px above
 * the button that caused it, a photograph control hidden inside a row that gave
 * no sign it opened, and a tour card covering half the screen.
 *
 * So the default is 800, and every part has been through it. The move was made
 * one part at a time, not in one go: at 800 `a8-agree` dropped 18/18 to 10/18,
 * all eight failures on one root -- the signature pad starts below the fold and
 * the audit drew on it by absolute mouse coordinates without scrolling first,
 * so nothing got signed and everything downstream collapsed. That is the class
 * of bug this height exists to find, and it was invisible at 1600.
 *
 * `TRUELINE_AUDIT_HEIGHT=1600` puts the old window back, for the one honest
 * case: reading a whole long screen in a screenshot while working out what is
 * on it. It is not a way to make a failing check pass.
 */
export const HEIGHT = Number(process.env.TRUELINE_AUDIT_HEIGHT ?? 800);

/**
 * Refusing to audit a bundle older than the source it was built from.
 *
 * `npm run audit` builds first. Running one part by hand does not, and
 * `web/dist` is gitignored, so a stale bundle sits there looking exactly like a
 * fresh one. That is not a theoretical hazard: a22-voice crashed for an unknown
 * length of time against a `Damage.tsx` whose field names had been changed,
 * while the stale bundle kept every other part green.
 *
 * So the newest source file is compared against the newest built file, and a
 * bundle that is behind stops the part instead of reporting on code nobody is
 * running. `TRUELINE_AUDIT_STALE_OK=1` turns it off, for the one honest case:
 * a URL served from somewhere that is not this tree.
 */
const REPO = dirname(dirname(SP));

async function newestUnder(dir) {
  let newest = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, await newestUnder(path));
    } else {
      newest = Math.max(newest, (await stat(path)).mtimeMs);
    }
  }
  return newest;
}

export async function refuseAStaleBundle() {
  if (process.env.TRUELINE_AUDIT_STALE_OK === '1') return;
  const built = await newestUnder(join(REPO, 'web', 'dist', 'assets'));
  if (built === 0) {
    throw new Error('There is no built bundle to audit. Run: npm run build');
  }
  const source = Math.max(
    await newestUnder(join(REPO, 'web', 'src')),
    await newestUnder(join(REPO, 'core', 'src'))
  );
  if (source > built) {
    const behind = Math.round((source - built) / 1000);
    throw new Error(
      `The built bundle is ${behind}s older than the source it came from, so this ` +
        'part would report on code nobody is running. Run: npm run build ' +
        '(or set TRUELINE_AUDIT_STALE_OK=1 if the URL is served from elsewhere)'
    );
  }
}

export const results = [];
let problems = [];

export function check(name, condition, detail = '') {
  results.push({ name, ok: !!condition, detail: condition ? '' : detail });
}

export async function open() {
  await refuseAStaleBundle();
  const browser = await openChromium();
  const ctx = await browser.newContext({ viewport: { width: 430, height: HEIGHT }, acceptDownloads: true });
  const page = await ctx.newPage();
  problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('body', { timeout: 60000 });
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
export async function openAsApp(payload, { scheme = 'light', refuses = [] } = {}) {
  await refuseAStaleBundle();
  const browser = await openChromium();
  const ctx = await browser.newContext({
    viewport: { width: 430, height: HEIGHT },
    acceptDownloads: true,
    colorScheme: scheme,
  });
  const page = await ctx.newPage();
  problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  await page.addInitScript(({ parked, refuses }) => {
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
    for (const name of ['saved', 'thumbnail', 'company', 'photo', 'calendar', 'trouble', 'mark', 'draft', 'voice', 'haptic']) {
      window.__sent[name] = [];
      window.webkit.messageHandlers[name] = {
        postMessage(body) {
          // A handler named in `refuses` is an app that is HERE and will not
          // take the message -- which is a different thing from no app at all,
          // and the only one of the two that is a failure. It is the state a
          // room was lost in, and until it could be reproduced there was no
          // way to check that the screen says so.
          if (refuses.includes(name)) throw new Error('the web view refused it');
          window.__sent[name].push(body);
        },
      };
    }
    if (parked) window.truelinePayload = parked;
  }, { parked: payload, refuses });
  // `load`, not `networkidle`. Idle is a clock, not a signal: on a machine
  // doing anything else it never settles, and the part then dies at `goto`
  // saying nothing about the app at all. The wait that matters is the app's own
  // first screen, which is the next line.
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('body', { timeout: 60000 });
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
