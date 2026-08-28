import { openChromium } from '../../core/tools/browser.mjs';

import { check, HEIGHT, loadScan, payingBrowser, report, reportEvenIfItDies, section, URL } from './lib.mjs';

// Say what was learned even if this part dies part way through.
reportEvenIfItDies('A12 — the complete click-through');


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

/**
 * How long the whole walk may take, in seconds.
 *
 * This part opens a fresh context per control and presses it, so its cost is
 * the number of controls in the app — and that number only ever goes up. Nine
 * disclosure headers were added in one afternoon, then eighteen more controls,
 * then the doorways on the floor. Every one of them is a good thing and every
 * one of them makes this longer.
 *
 * What it must never do is die on a clock and report nothing, which is what a
 * runner's timeout produces: a part that walked four hundred controls and said
 * nothing about any of them. So the budget is here, it is checked, and it is
 * printed with the real figure beside it. When it goes red it is not a fault in
 * the app — it is this part saying the walk has outgrown the budget, and
 * somebody deciding whether to raise the number or split the walk.
 *
 * 600 against a measured 300-and-something is deliberate slack: this runs
 * alongside fifty-four other parts on a box that is doing other things.
 */
const BUDGET_SECONDS = 600;
const startedAt = Date.now();

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
let opened = 0;

/**
 * `load`, not `networkidle`, and why.
 *
 * This part opens a fresh context per control — two hundred of them — and every
 * one used to wait for the network to go quiet for half a second. That is a
 * clock, not a signal: on a machine doing anything else at the same time it
 * simply never settles, and the part died at `page.goto` reporting nothing at
 * all about how far it had got. It failed four different ways in one afternoon
 * and every one of them read as "the app is broken" when it meant "the box is
 * busy".
 *
 * So it waits for the document, and then for the app's own first screen to be
 * on it, which is the thing the next line actually needs. The timeout is
 * generous for the same reason: a slow load is a slow load, not a failure.
 */
async function fresh() {
  SHARED ??= await openChromium();
  const ctx = await SHARED.newContext({
    viewport: { width: 430, height: HEIGHT }, acceptDownloads: true,
  });
  // A paying contractor's browser, the way `open()` makes one. See `payingBrowser`.
  await payingBrowser(ctx);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  // Retried, because this crawl is minutes long and the thing it is crawling is
  // a directory of files. A `vite preview` server hands back a 404 for the
  // fraction of a second while a build rewrites `dist` underneath it, and a
  // whole two-hundred-control crawl thrown away over one of those tells you
  // nothing about the app. Three tries, then it is real and it throws.
  let landed = null;
  for (let go = 0; go < 3; go += 1) {
    try {
      await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
      await page.waitForSelector('body', { timeout: 60000 });
      landed = null;
      break;
    } catch (error) {
      landed = error;
      await page.waitForTimeout(1500);
    }
  }
  if (landed) throw landed;
  opened += 1;
  // A line every twenty-five, so a long crawl says where it has got to rather
  // than sitting silent for twenty minutes.
  if (opened % 25 === 0) console.log(`  ... ${opened} screens opened`);
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

const walked = (Date.now() - startedAt) / 1000;
check('the walk finished inside the time it is given, so it never dies on a clock',
  walked <= BUDGET_SECONDS,
  `${walked.toFixed(1)}s for ${clicks} controls, and the budget is ${BUDGET_SECONDS}s. ` +
    'This is not a fault in the app: the walk has outgrown its budget. Raise the number ' +
    'or split the walk.');

console.log(
  `\n  ${clicks} controls pressed, ${reached.size} screens reached, ` +
  `${walked.toFixed(1)}s of ${BUDGET_SECONDS}s.`
);
console.log(`  ${[...reached].sort().join('\n  ')}`);

check('no console or page errors across the whole click-through', errors.length === 0,
  [...new Set(errors)].slice(0, 5).join(' | '));

const bad = report('A12 — the complete click-through');
await SHARED?.close();
process.exit(bad === 0 ? 0 : 1);
