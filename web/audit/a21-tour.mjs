import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { openChromium } from '../../core/tools/browser.mjs';
import { check, noise, open, payingBrowser, report, reportEvenIfItDies, SP, URL } from './lib.mjs';

// Say what was learned even if this part dies part way through.
reportEvenIfItDies('A21 — the worked example and the guided tour');

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
// Raised from "most of them" (14 of 20) to all of them. It could be met before
// by pointing four stops at a whole panel -- a selector that always matches and
// draws a ring 2,800 pixels tall round everything at once, which is worse than
// no ring. Every stop now names the smallest element that is actually its
// subject, so anything that fails to match is a stop pointing at nothing.
check('and every one of them rings the thing it is about',
  rangSomething === total,
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


/* ========================================================================
   7. On a phone that exists, the card is a budget rather than a paragraph.

   ## Why this section opens its own browser

   The shared harness in `lib.mjs` opens 430 x 1600. That is 430 wide, which is
   a phone, and 1600 tall, which is no phone ever made -- it is a page-height
   window chosen so that every panel is fully laid out and nothing a check wants
   to read is below the fold. It is the right window for "does this screen say
   the right thing" and it is the wrong window for the only question this
   section asks, which is "can somebody SEE it". At 1600 a card that covers the
   bottom third of a real phone covers a seventh, every ring fits, and no
   measurement here can fail. So this opens 430 x 800 -- an iPhone 14 Pro,
   near enough -- and leaves `lib.mjs` alone, because eighteen other parts
   depend on the harness being what it is.

   ## What is being measured, and why these two numbers

   This is the complaint, in full:

       "NEED TO FIX THE TOUR, CANT SEE ANYTHING PROPERLY"

   with a screenshot of the card over the bottom half of the screen and the
   drawing it was describing behind it. There are exactly two things a person
   needs to be true at a stop, and both are numbers rather than opinions:

     1. **How much of the screen the card has taken.** Measured as the height of
        the card over the height of the window.
     2. **How much of the thing it is pointing at is on screen.** Measured as
        the visible height of the ringed element over its own height.

   The budget for the first is declared in `Tour.tsx` next to the card it
   governs, and read out of that file here so the two cannot drift apart. It is
   also checked against the numbers this section was written to -- otherwise
   raising the constant would "fix" a failure without a pixel moving.
   ======================================================================== */

{
  const CARD = readFileSync(join(dirname(SP), 'src', 'Tour.tsx'), 'utf8');
  const budgetOf = (name) => {
    const found = new RegExp(`${name}:\\s*([\\d.]+)`).exec(
      /CARD_BUDGET\s*=\s*\{([^}]*)\}/.exec(CARD)?.[1] ?? ''
    );
    return found ? Number(found[1]) : NaN;
  };
  const BUDGET = {
    open: budgetOf('open'), folded: budgetOf('folded'), reading: budgetOf('reading'),
  };

  // The budget the card declares is itself held to the numbers this section was
  // written against. Without this, a stop that grew past the budget could be
  // made green by editing one digit in the other file.
  check('the tour declares a card budget', Number.isFinite(BUDGET.open)
    && Number.isFinite(BUDGET.folded) && Number.isFinite(BUDGET.reading),
    JSON.stringify(BUDGET));
  check('and it is no looser than a fifth of the screen with the body showing',
    BUDGET.open <= 0.2, String(BUDGET.open));
  check('an eighth folded', BUDGET.folded <= 0.125, String(BUDGET.folded));
  check('and under half even while somebody is reading the long version',
    BUDGET.reading <= 0.45, String(BUDGET.reading));

  const PHONE = { width: 430, height: 800 };
  const browser2 = await openChromium();
  const ctx2 = await browser2.newContext({ viewport: PHONE, acceptDownloads: true });
  // A paying contractor's browser, the way `open()` makes one. See `payingBrowser`.
  await payingBrowser(ctx2);
  const phone = await ctx2.newPage();
  const shouted = [];
  phone.on('console', (m) => { if (m.type() === 'error') shouted.push('console: ' + m.text()); });
  phone.on('pageerror', (e) => shouted.push('pageerror: ' + e.message));
  await phone.goto(`${URL}#tour`, { waitUntil: 'networkidle' });
  const bar = phone.getByRole('dialog', { name: 'Guided tour' });
  await bar.waitFor({ timeout: 15000 });
  await phone.waitForTimeout(600);

  /**
   * Waits for the smooth scroll to actually stop.
   *
   * A fixed timeout here would be a check that passes on a fast machine and
   * fails on a loaded one, and the failure would look like a layout bug.
   */
  async function settled() {
    let last = -1;
    for (let tries = 0; tries < 40; tries += 1) {
      const now = await phone.evaluate(() => Math.round(window.scrollY));
      if (now === last) return;
      last = now;
      await phone.waitForTimeout(100);
    }
  }

  /**
   * The two numbers, off the screen as it stands.
   *
   * `free` is the band the card is not on -- the top of the window down to the
   * top of the card. It is what the tour itself scrolls into, so it is what a
   * ring has to fit in.
   */
  const look = () => phone.evaluate(() => {
    const tall = window.innerHeight;
    const card = document.querySelector('[role="dialog"][aria-label="Guided tour"]')
      .getBoundingClientRect();
    const free = card.top;
    const ringed = [...document.querySelectorAll('[data-tour-ring]')];
    const one = ringed[0]?.getBoundingClientRect();
    return {
      tall,
      card: card.height / tall,
      // Everything from the top of the card down is gone: the card itself and
      // the section bar underneath it. This is the number in the screenshot.
      lost: (tall - card.top) / tall,
      free,
      rings: ringed.length,
      ring: one && {
        height: one.height,
        top: one.top,
        bottom: one.bottom,
        seen: Math.max(0, Math.min(one.bottom, free) - Math.max(one.top, 0))
          / Math.max(1, one.height),
      },
    };
  });

  const stops = Number(/of (\d+)/.exec(await bar.locator('p').first().textContent())?.[1] ?? 0);
  let widest = 0;
  let mostLost = 0;
  let leastSeen = 1;
  let tooBig = [];
  let cutOff = [];
  let longest = 0;

  for (let at = 1; at <= stops; at += 1) {
    await phone.waitForTimeout(420);
    await settled();
    const now = await look();
    const title = await bar.locator('h2').innerText();

    widest = Math.max(widest, now.card);
    mostLost = Math.max(mostLost, now.lost);

    check(`stop ${at} rings exactly one thing on a phone`, now.rings === 1,
      `${title}: ${now.rings}`);

    if (now.ring) {
      leastSeen = Math.min(leastSeen, now.ring.seen);
      // A ring taller than the free band cannot be shown whole however the page
      // is scrolled, which is what ringing a whole panel did: 2,800 pixels of
      // outline with both edges off the screen.
      if (now.ring.height > now.free) {
        tooBig.push(`${at}. ${title}: ${Math.round(now.ring.height)}px in ${Math.round(now.free)}px`);
      }
      // The other half of the complaint, in his words: "the highlighted region
      // runs off the top".
      if (now.ring.top < -1) cutOff.push(`${at}. ${title}: top ${Math.round(now.ring.top)}`);
    }

    // The card stays small because the sentence in it is short. Checked so that
    // a paragraph cannot creep back in one stop at a time.
    const said = (await bar.locator('p').nth(1).textContent()).trim();
    longest = Math.max(longest, said.length);

    if (at < stops) await bar.getByRole('button', { name: 'Next' }).click();
    await phone.waitForTimeout(120);
  }

  check(`the card never takes more than a fifth of a 430x800 screen (worst ${
    (widest * 100).toFixed(1)}%)`, widest <= BUDGET.open, `${(widest * 100).toFixed(1)}%`);
  check(`and the card and the section bar together never take more than a third (worst ${
    (mostLost * 100).toFixed(1)}%)`, mostLost <= 0.33, `${(mostLost * 100).toFixed(1)}%`);
  check('every stop shows the whole of what it is pointing at',
    leastSeen >= 0.999, `least seen ${(leastSeen * 100).toFixed(1)}%`);
  check('nothing is ringed that is too tall to fit in the free part of the screen',
    tooBig.length === 0, tooBig.join(' | '));
  check('and no ring has its top edge off the top of the screen',
    cutOff.length === 0, cutOff.join(' | '));
  check('no stop says more than two lines before somebody asks for more',
    longest <= 120, `longest body is ${longest} characters`);

  /* ---- Folded, and reading. The two things a person can do to the card. ---- */

  // Every control is checked for before it is used. An audit that throws on a
  // missing button reports nothing at all -- including the eight measurements
  // above it, which are the ones somebody reverting this change needs to read.
  const there = async (name) => (await bar.getByRole('button', { name }).count()) === 1;

  check('the card can be got out of the way', await there('Hide'));
  if (await there('Hide')) {
    await bar.getByRole('button', { name: 'Hide' }).click();
    await phone.waitForTimeout(500);
    await settled();
    const shut = await look();
    check('folded, the card is an eighth of the screen', shut.card <= BUDGET.folded,
      `${(shut.card * 100).toFixed(1)}%`);
    check('and folding it leaves more of the room than the open card did',
      shut.card < widest, `${(shut.card * 100).toFixed(1)}% vs ${(widest * 100).toFixed(1)}%`);
    check('and what the stop is about is still ringed and still whole',
      shut.rings === 1 && (shut.ring?.seen ?? 0) >= 0.999, JSON.stringify(shut.ring));

    if (await there('Show')) {
      await bar.getByRole('button', { name: 'Show' }).click();
      await phone.waitForTimeout(400);
    }
    check('and Show brings the sentence back',
      (await bar.locator('p').nth(1).textContent()).trim().length > 40);
  }

  await bar.getByRole('button', { name: 'Back' }).click();
  await phone.waitForTimeout(500);
  await settled();
  const brief = await look();
  const short = (await bar.innerText()).length;

  // Nothing was deleted to hit the budget: every sentence the card used to say
  // is still one tap away. A card that simply lost two thirds of its prose
  // would pass every measurement above and be a worse tour.
  check('the long version of a stop is still there, behind More', await there('More'));
  if (await there('More')) {
    await bar.getByRole('button', { name: 'More' }).click();
    await phone.waitForTimeout(600);
    await settled();
    const full = await look();
    check('More says appreciably more than the card was saying',
      (await bar.innerText()).length > short + 40,
      `${(await bar.innerText()).length} vs ${short}`);
    check('and even then the card is under half the screen', full.card <= BUDGET.reading,
      `${(full.card * 100).toFixed(1)}%`);
    check('and what the stop is about is still almost entirely on screen',
      (full.ring?.seen ?? 0) >= 0.9, JSON.stringify(full.ring));

    if (await there('Less')) {
      await bar.getByRole('button', { name: 'Less' }).click();
      await phone.waitForTimeout(500);
      await settled();
    }
    const backDown = await look();
    check('and Less gives the room back', backDown.card <= brief.card + 0.001,
      `${(backDown.card * 100).toFixed(1)}% vs ${(brief.card * 100).toFixed(1)}%`);

    // Reading the long version on one stop must not leave it open on the next,
    // where it would be covering a drawing to answer a question nobody asked.
    await bar.getByRole('button', { name: 'Next' }).click();
    await phone.waitForTimeout(500);
    check('and moving on closes it again', await there('More'));
  }

  check('a phone-sized screen: no console or page errors', shouted.length === 0,
    shouted.join(' | '));
  await browser2.close();
}

check('no console or page errors anywhere in the example or the tour',
  noise().length === 0, noise().join(' | '));

await browser.close();
process.exit(report('A21 — the worked example and the guided tour') ? 1 : 0);
