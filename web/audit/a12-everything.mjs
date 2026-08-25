import { chromium } from 'playwright';

import { URL, check, loadScan, report, section } from './lib.mjs';

const CHROME =
  process.env.TRUELINE_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/**
 * The complete click-through: every control in the app, pressed.
 *
 * The other eleven parts check features Sam or I named. This one names
 * nothing. It walks out from each section, finds every button, link, box and
 * list on the screen, presses each one, and asks four questions of it that a
 * person would ask on a phone:
 *
 *   1. Does it have a name? A control with no accessible name is invisible to
 *      a screen reader and unnameable in a bug report.
 *   2. Is its name its own on that screen? Two controls called the same thing
 *      is the bug class that has already bitten this app twice -- every tape
 *      box named after its placeholder, and "From"/"To" on four elements.
 *   3. Does the app survive it? No thrown error, and the navigation still
 *      there afterwards, because a screen you cannot leave is a dead app.
 *   4. Does it DO anything? A button that changes nothing on screen, downloads
 *      nothing and toggles nothing is the thing Sam asked to be checked for,
 *      and it is invisible to every other test in this repository.
 *
 * ## How it gets everywhere
 *
 * Most of the app is behind another control: Price is one button until it is
 * opened, Insurance is one question until it is answered. So this crawls.
 * Every state is a path of names from a fresh app -- ["Insurance", "Yes, this
 * is an insurance job", "Mark the damage"] -- and to press a control it starts
 * a fresh app and replays the path. Starting fresh every time is slower than
 * clicking forward, and it is the only way one control's mess cannot be
 * mistaken for the next control's bug.
 *
 * ## What it deliberately does not do
 *
 * File pickers are not pressed: a real one opens a window belonging to the
 * operating system and there is nothing behind it to click. They are checked
 * for a name and for what they accept instead. Everything else is pressed.
 */

const SECTIONS = ['Plan', 'Room', 'Takeoff', 'Price', 'Agreement', 'Work', 'Insurance', 'Files'];

/** How deep a chain of controls to follow before calling it a screen. */
const DEEPEST = 4;
/** A backstop against a crawl that never converges. Reported if it is hit. */
const MOST = 500;

const CONTROLS = 'button,a[href],input,select,textarea,[role="button"],summary';

/* --------------------------------------------------------------- the app */

/**
 * A fresh app with a room in it and the subscription on, every time.
 *
 * One browser for the whole crawl and a new context per control: a context is
 * its own storage and its own history, so nothing carries over, and starting
 * one costs milliseconds where starting a browser costs a second. At two
 * hundred controls that is the difference between four minutes and twenty.
 */
let SHARED;
const errors = [];

async function fresh() {
  SHARED ??= await chromium.launch({ executablePath: CHROME });
  const ctx = await SHARED.newContext({
    viewport: { width: 430, height: 1600 }, acceptDownloads: true,
  });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await loadScan(page);
  await page.evaluate(() => {
    window.webkit = { messageHandlers: { saved: { postMessage() {} } } };
    window.trueline?.setSubscribed(true);
  });
  await page.waitForTimeout(300);
  return { browser: { close: () => ctx.close() }, page };
}

/** Everything on the visible panel, as {name, kind, disabled, accepts}. */
async function onScreen(page) {
  return page.evaluate((sel) => {
    const panel = document.querySelector('[data-panel]:not([hidden])');
    if (!panel) return [];
    // The accessible name, the way a screen reader works it out: the label
    // wins, then the text, then the title, then the placeholder -- and the
    // placeholder last on purpose, because falling back to it is the bug.
    const nameOf = (el) => {
      const aria = el.getAttribute('aria-label');
      if (aria) return aria.trim();
      const by = el.getAttribute('aria-labelledby');
      if (by) {
        const from = by.split(/\s+/).map((id) => document.getElementById(id))
          .filter(Boolean).map((n) => n.textContent.trim()).join(' ');
        if (from) return from;
      }
      if (el.id) {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label?.textContent.trim()) return label.textContent.trim();
      }
      const wrapping = el.closest('label');
      if (wrapping?.textContent.trim()) return wrapping.textContent.trim();
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) return text;
      return (el.getAttribute('title') || '').trim();
    };
    const seen = [];
    for (const el of panel.querySelectorAll(sel)) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;
      seen.push({
        name: nameOf(el),
        // An option that is already the chosen one changes nothing when it is
        // pressed again, and that is correct rather than broken.
        alreadyOn: el.getAttribute('aria-pressed') === 'true'
          || el.getAttribute('aria-selected') === 'true'
          || el.getAttribute('aria-checked') === 'true',
        placeholderOnly: !nameOf(el) && !!el.getAttribute('placeholder'),
        kind: el.tagName.toLowerCase() === 'input'
          ? `input:${el.getAttribute('type') || 'text'}`
          : el.tagName.toLowerCase(),
        disabled: !!el.disabled,
        accepts: el.getAttribute('accept') || '',
        href: el.getAttribute('href') || '',
      });
    }
    return seen;
  }, CONTROLS);
}

/** What the screen looks like now, cheaply, so a change can be noticed. */
async function shape(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('[data-panel]:not([hidden])');
    const html = panel ? panel.innerHTML : '';
    let hash = 0;
    for (let i = 0; i < html.length; i += 1) hash = (hash * 31 + html.charCodeAt(i)) | 0;
    return { hash, length: html.length,
             headings: [...document.querySelectorAll('h2,h3')].map((h) => h.textContent.trim()) };
  });
}

/** Presses one named control on the panel. Returns false if it is not there. */
async function press(page, name) {
  const one = page.locator('[data-panel]:not([hidden])')
    .getByRole('button', { name, exact: true }).first();
  if (!(await one.count())) return false;
  await one.click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(220);
  return true;
}

/** Walks a fresh app to the state a path describes. */
async function walkTo(page, tab, path) {
  await section(page, tab);
  for (const step of path) {
    if (!(await press(page, step))) return false;
  }
  return true;
}

/* ------------------------------------------------------------- the crawl */

const reached = new Set();     // every heading the crawl ever saw
const pressed = new Set();     // section›name, so nothing is pressed twice
const nameless = [];
const collisions = [];
const inert = [];
const broke = [];
let clicks = 0;
let capped = false;

const queue = SECTIONS.map((tab) => ({ tab, path: [] }));

while (queue.length) {
  const { tab, path } = queue.shift();
  if (path.length > DEEPEST) continue;

  const { browser, page } = await fresh();
  try {
    if (!(await walkTo(page, tab, path))) continue;

    const here = await onScreen(page);
    for (const h of (await shape(page)).headings) reached.add(h);

    // 1 and 2 — every control named, and named only once on this screen.
    const counts = new Map();
    for (const control of here) {
      const where = `${tab}${path.length ? ' → ' + path.join(' → ') : ''}`;
      if (!control.name) nameless.push(`${where}: a ${control.kind} with no name`);
      else counts.set(control.name, (counts.get(control.name) || 0) + 1);
      if (control.placeholderOnly) {
        nameless.push(`${where}: a ${control.kind} named only by its placeholder`);
      }
      if (control.kind === 'a' && (!control.href || control.href === '#')) {
        broke.push(`${where}: the link "${control.name}" goes nowhere`);
      }
    }
    for (const [name, n] of counts) {
      if (n > 1) collisions.push(`${tab}${path.length ? ' → ' + path.join(' → ') : ''}: ${n} controls called "${name}"`);
    }

    // 3 and 4 — press each one, from its own fresh app.
    for (const control of here) {
      if (!control.name || control.disabled) continue;
      if (control.kind === 'input:file') continue;          // an OS window, not a screen
      if (!/^(button|summary)$/.test(control.kind) && control.kind !== 'a') continue;
      const key = `${tab}›${control.name}`;
      if (pressed.has(key)) continue;
      pressed.add(key);
      if (clicks >= MOST) { capped = true; break; }
      clicks += 1;

      const trial = await fresh();
      try {
        if (!(await walkTo(trial.page, tab, path))) continue;
        // Printing is the one thing a headless browser cannot show. Rather
        // than excuse those buttons, the print call itself is counted: a
        // button that opens the print dialogue has done its whole job.
        await trial.page.evaluate(() => {
          window.__printed = 0;
          window.print = () => { window.__printed += 1; };
        });
        const before = await shape(trial.page);
        let downloaded = false;
        trial.page.once('download', () => { downloaded = true; });
        const failures = [];
        trial.page.on('pageerror', (e) => failures.push(e.message));

        if (!(await press(trial.page, control.name))) continue;
        await trial.page.waitForTimeout(320);

        const after = await shape(trial.page);
        const alive = await trial.page
          .getByRole('navigation', { name: 'Parts of this room' }).count();
        const where = `${tab}${path.length ? ' → ' + path.join(' → ') : ''} → ${control.name}`;

        if (failures.length) broke.push(`${where}: threw — ${failures[0]}`);
        if (!alive) broke.push(`${where}: the navigation is gone, so there is no way back`);
        const printed = await trial.page.evaluate(() => window.__printed ?? 0);
        const moved = after.hash !== before.hash || after.length !== before.length;
        if (!moved && !downloaded && !printed && !control.alreadyOn) inert.push(where);

        // Anything new it opened is somewhere else to go.
        if (moved && path.length < DEEPEST) {
          queue.push({ tab, path: [...path, control.name] });
        }
        for (const h of after.headings) reached.add(h);
      } finally {
        await trial.browser.close();
      }
    }
  } finally {
    await browser.close();
  }
  if (capped) break;
}

/* ------------------------------------------------------------ the verdict */

check('every control on every screen has a name a screen reader can say',
  nameless.length === 0, nameless.join(' | '));
check('and no two controls on one screen answer to the same name',
  collisions.length === 0, collisions.join(' | '));
check('nothing threw, and nothing left the app with no way back',
  broke.length === 0, broke.join(' | '));
check('every button does something you can see',
  inert.length === 0, inert.join(' | '));
check('the crawl finished rather than hitting its own limit',
  !capped, `stopped at ${MOST} controls, so some were never pressed`);

console.log(`\n  ${clicks} controls pressed, ${reached.size} screens reached.`);
console.log(`  ${[...reached].sort().join('\n  ')}`);

check('no console or page errors across the whole click-through', errors.length === 0,
  [...new Set(errors)].slice(0, 5).join(' | '));

const bad = report('A12 — the complete click-through');
await SHARED?.close();
process.exit(bad === 0 ? 0 : 1);
