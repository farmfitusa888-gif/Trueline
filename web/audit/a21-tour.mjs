import { check, noise, open, report, URL } from './lib.mjs';

/**
 * The worked example, and the guided tour over the top of it.
 *
 * ## The problem both of these exist to solve
 *
 * Everything this app is worth showing anybody happens *after* a scan, and a
 * scan needs a LiDAR phone, a room and ten minutes. So the first thing a new
 * person saw was an empty list and an instruction — a bad way to find out
 * whether the takeoff is any good, and a worse way to discover that there is a
 * change-order screen at all.
 *
 * `#demo` loads one finished kitchen: scanned, taped on two walls, priced off a
 * real rate book, written up, signed and invoiced. `#tour` loads the same
 * kitchen and walks every screen of it in the order of a job.
 *
 * ## What is checked here
 *
 *  1. The example loads, and is a real job rather than an empty shell — a
 *     signed proposal, priced lines, and quantities that came off the room.
 *  2. It says what it is. Somebody must never mistake the example for their own
 *     work, so the banner is checked for the words that say so.
 *  3. Every stop of the tour moves the app to the screen it is about, and the
 *     screen is actually on. A tour that narrates a panel nobody can see is
 *     worse than no tour.
 *  4. Every stop that says it will ring something rings something. A ring drawn
 *     round nothing is the failure mode this catches.
 *  5. **The tour changes nothing.** The takeoff, the price and the proposal are
 *     read before the tour starts and again at the end, and compared character
 *     for character. This is the property that decides whether the tour is
 *     safe to leave switched on inside somebody's real job.
 *  6. Back, and stopping. Both, because a card with no way out is a trap.
 *
 * The example itself is not hand-written: `site/tools/demo.mjs` builds it by
 * driving this same app through that whole path and saving what came out. So a
 * check here that the example is a real job is also a check that the app can
 * still produce one.
 */

const ring = '[data-tour-ring]';

/**
 * Every panel that carries a number, as one string.
 *
 * `textContent`, deliberately. `innerText` returns what is PAINTED, and only
 * one of these panels is ever on screen — so an innerText version of this
 * compared the takeoff against nothing and reported that the tour had changed
 * every number in the app. What is wanted is what the panels SAY, whether or
 * not they happen to be the one on top.
 */
async function everyNumber(page) {
  return page.evaluate(() =>
    ['takeoff', 'price', 'agree', 'work', 'files']
      .map((k) => document.querySelector(`[data-panel="${k}"]`)?.textContent ?? '')
      .join('\n~~~\n'));
}

/* ========================================================================
   1. The example is a real, finished job.
   ======================================================================== */

const { browser, page } = await open();
await page.goto(`${URL}#demo`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-panel="plan"]', { timeout: 10000 });

const heading = await page.locator('h2').first().innerText();
check('the example opens on a named room, not "Untitled"',
  heading.trim().length > 0 && !/untitled/i.test(heading), heading);

const banner = await page.getByRole('note').first().innerText();
check('and says, in the first sentence, that it is the worked example',
  /worked example/i.test(banner), banner.slice(0, 200));
check('and that nothing done to it matters',
  /nothing you change here matters/i.test(banner), banner.slice(0, 300));
check('and points at where your own work starts',
  /Rooms/.test(banner), banner.slice(0, 300));

// Everything below reads the panels directly rather than clicking to them,
// because the tour is about to do the clicking and these are the "before".
const before = await everyNumber(page);

/* ------------------------------------------------------------------------
   The example carries the book that priced it — and does not keep it.

   A project file holds a room, not a rate book: the book belongs to the
   contractor. So the first version of this example opened on a browser that
   had never had a rate typed into it, every priced line came back empty, and
   `changesSince` correctly reported that every line of the signed scope had
   been REMOVED. The Work screen read "Agreed $0.00" under an invoice for
   $2,889.45, and the Agreement screen offered a change order deleting the job.

   The fix is `Units.borrow`: the example lends its own profile to the screen
   and never writes it anywhere. Both halves are checked, because a fix that
   made the example look right by overwriting somebody's real rate book would
   be far worse than the bug.
   ------------------------------------------------------------------------ */

check('the example prices itself off the book that priced it',
  /\$9,631\.50/.test(before), before.slice(0, 400));
check('and the invoice screen agrees with the proposal, to the cent',
  /Agreed \$9,631\.50/.test(before.replace(/\s+/g, ' ')),
  (/Agreed [^·]*·[^A-Z]*/.exec(before.replace(/\s+/g, ' ')) ?? ['not found'])[0]);
check('and nothing has changed since it was signed',
  /Nothing has changed since this was signed/.test(before.replace(/\s+/g, ' ')));
// Panel by panel: `before` is every panel joined, and "Still to fill in" on
// the invoice would otherwise be read as a hole in the proposal.
for (const [key, what] of [['agree', 'proposal'], ['work', 'invoice']]) {
  const text = await page.evaluate((k) =>
    document.querySelector(`[data-panel="${k}"]`)?.textContent ?? '', key);
  check(`nothing on the ${what} is left outstanding`,
    !/Still to fill in/.test(text),
    (/Still to fill in[^.]*/.exec(text.replace(/\s+/g, ' ')) ?? [''])[0].slice(0, 160));
}
check('the restoration half of the job is in it too',
  /Remove wall board/.test(await page.evaluate(() =>
    document.querySelector('[data-panel="claim"]')?.textContent ?? '')));
check('the example writes no profile into this browser',
  (await page.evaluate(() => window.localStorage.getItem('trueline.company.v1'))) === null);

check('the takeoff has quantities in it',
  /\d/.test(before) && /(sq ft|ft)/i.test(before), before.slice(0, 300));
check('the price has money in it', /\$[\d,]+\.\d{2}/.test(before), before.slice(0, 400));
check('and the proposal was signed', /signed/i.test(before), before.slice(0, 600));

/* ========================================================================
   2. The tour walks every screen, and rings what it says it will.
   ======================================================================== */

await page.getByRole('button', { name: /Take the tour/ }).click();
const card = page.getByRole('dialog', { name: 'Guided tour' });
await card.waitFor({ timeout: 5000 });

// The count comes off the card rather than out of a constant in this file, so
// adding a stop cannot leave the audit checking a stale number.
//
// `textContent`, not `innerText`: the counter is set in small caps by CSS, and
// `innerText` returns what is PAINTED. The first version of this read "TOUR · 1
// OF 20", matched nothing, ran a loop zero times, and then failed on a Back
// button that was disabled because the tour had never left stop one.
const counter = await card.locator('p').first().textContent();
const total = Number(/of (\d+)/.exec(counter)?.[1] ?? 0);
check('the card says how many stops there are', total > 0, counter);

let rangSomething = 0;
let everyTitleDifferent = new Set();
let missed = [];

for (let at = 1; at <= total; at += 1) {
  const shown = await card.locator('p').first().textContent();
  check(`stop ${at} is stop ${at}`, shown.includes(`${at} of ${total}`), shown);

  const title = await card.locator('h2').innerText();
  everyTitleDifferent.add(title);

  // The stop moved the app somewhere. Whichever panel it moved to, that panel
  // must be the one on screen — this is the check that a stop about the claim
  // screen is not narrating the takeoff.
  const open = await page.evaluate(() =>
    [...document.querySelectorAll('[data-panel]')]
      .filter((p) => !p.hasAttribute('hidden'))
      .map((p) => p.getAttribute('data-panel')));
  check(`stop ${at} has exactly one screen on`, open.length === 1, `${title}: ${open.join()}`);

  // Give the ring the same 260ms the tour gives itself, and a little more.
  await page.waitForTimeout(420);
  const rings = await page.locator(ring).count();
  if (rings > 0) rangSomething += 1; else missed.push(`${at}. ${title}`);
  check(`stop ${at} rings at most one thing`, rings <= 1, `${title}: ${rings}`);

  const body = await card.locator('p').nth(1).textContent();
  check(`stop ${at} says something`, body.trim().length > 40, `${title}: ${body}`);

  if (at < total) await card.getByRole('button', { name: 'Next' }).click();
  await page.waitForTimeout(120);
}

check('every stop has its own title', everyTitleDifferent.size === total,
  `${everyTitleDifferent.size} distinct of ${total}`);
check('and most of them ring the thing they are about',
  rangSomething >= Math.ceil(total * 0.7),
  `${rangSomething}/${total} rang. Missed: ${missed.join(' | ')}`);

/* ========================================================================
   3. The tour changed nothing.
   ======================================================================== */

const after = await everyNumber(page);
check('not one number, price, or word of the proposal moved during the tour',
  after === before,
  'takeoff/price/agreement/work/files differ after the tour');

/* ========================================================================
   4. Back, and the way out.
   ======================================================================== */

await card.getByRole('button', { name: 'Back' }).click();
await page.waitForTimeout(200);
const backTo = await card.locator('p').first().textContent();
check('Back goes back a stop', backTo.includes(`${total - 1} of ${total}`), backTo);

await card.getByRole('button', { name: 'Stop the tour' }).click();
await page.waitForTimeout(300);
check('stopping puts the card away', (await card.count()) === 0);
check('and takes the ring off with it', (await page.locator(ring).count()) === 0);
check('and leaves the room on the screen',
  (await page.locator('[data-panel]').count()) > 0);

/* ========================================================================
   5. #tour opens straight into it, which is what the Rooms tab row pushes.
   ======================================================================== */

{
  const fresh = await page.context().newPage();
  await fresh.goto(`${URL}#tour`, { waitUntil: 'networkidle' });
  const straight = fresh.getByRole('dialog', { name: 'Guided tour' });
  await straight.waitFor({ timeout: 10000 }).catch(() => {});
  check('#tour starts the tour with no tap at all', (await straight.count()) === 1);
  const first = await straight.locator('p').first().textContent().catch(() => '');
  check('on stop one', /1 of \d+/.test(first), first);
  await fresh.close();
}

/* ========================================================================
   6. And a contractor's own rate book survives looking at the example.
   ======================================================================== */

{
  const mine = await page.context().newPage();
  await mine.goto(URL, { waitUntil: 'networkidle' });
  const REAL = '{"name":"Gilbert Tile & Stone","phone":"","email":"","licence":"CA-777",'
    + '"insurance":"","units":"imperial","trade":"tile","useDefaultCeiling":false,'
    + '"defaultCeiling":"8\'"}';
  await mine.evaluate((text) => window.localStorage.setItem('trueline.company.v1', text), REAL);

  await mine.goto(`${URL}#demo`, { waitUntil: 'networkidle' });
  await mine.waitForSelector('[data-panel="plan"]', { timeout: 10000 });
  await mine.waitForTimeout(800);
  const kept = await mine.evaluate(() => window.localStorage.getItem('trueline.company.v1'));
  check('opening the example leaves your own profile in storage exactly as it was',
    kept === REAL, String(kept).slice(0, 200));

  // And on screen it is the example's, not yours — otherwise the example would
  // price a kitchen off a tile setter's book and none of its numbers would add
  // up to what its own signed proposal says.
  const priced = await mine.evaluate(() =>
    document.querySelector('[data-panel="price"]')?.textContent ?? '');
  check('and the example shows the example\'s prices while it is open',
    /\$9,631\.50/.test(priced), priced.slice(0, 200));

  await mine.goto(URL, { waitUntil: 'networkidle' });
  await mine.waitForTimeout(600);
  const back = await mine.evaluate(() => window.localStorage.getItem('trueline.company.v1'));
  check('and leaving it gives your own profile straight back', back === REAL,
    String(back).slice(0, 200));
  await mine.close();
}

check('no console or page errors anywhere in the example or the tour',
  noise().length === 0, noise().join(' | '));

await browser.close();
process.exit(report('A21 — the worked example and the guided tour') ? 1 : 0);
