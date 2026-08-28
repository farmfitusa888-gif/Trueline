import { readFileSync } from 'node:fs';
import { check, loadScan, noise, open, openAsApp, report, reportEvenIfItDies, section, SECTIONS, SP } from './lib.mjs';

// Say what was learned even if this part dies part way through.
reportEvenIfItDies('A25 — one free room, and the work already done');

/**
 * One room free, and the work already done is never touched.
 *
 * > "CHANGE IT TO 1 FREE ROOM EVERYWHERE AND BUILD IT!"
 *
 * ## The two things that have to be true at once
 *
 * They pull in opposite directions, which is why this is driven through a real
 * browser rather than argued about in a unit test.
 *
 *   * **The gate has to be on.** Everything that turns a drawing into money is
 *     shut when the app says nobody has paid, and the sentence in its place has
 *     to describe the thing rather than announce a toll. That includes the free
 *     room allowance itself: a lock that says "the first 2 rooms are free" over
 *     a gate that keeps one is the app advertising something it does not give.
 *
 *   * **Nothing already on the device may move.** A limit on rooms reads, to
 *     anybody who has ever met one, as "your rooms are going away". They are
 *     not, they must not, and this part proves it the only way worth proving:
 *     two rooms are measured while everything is open, the gate is then turned
 *     on underneath them, and every byte of both rooms is still there
 *     afterwards. This project has already lost a contractor 53 photographs
 *     once. Getting this wrong is how it happens twice.
 *
 * ## Every figure here is worked out on this side
 *
 * The room's dimensions and its floor area are computed from the metres in
 * `garage.json` — the file the app is given — and then compared with what the
 * screen prints. A screen that agrees with itself proves nothing; the failure
 * worth catching is an area that is confidently, consistently wrong.
 *
 * The number of rooms kept is counted from the storage the app actually wrote,
 * against a count this script knows because it loaded the files itself.
 */

/* ------------------------------------------------- what this side works out */

const REPORT = JSON.parse(readFileSync(`${SP}/garage.json`, 'utf8'));
const METRES_PER_FOOT = 0.3048;

/** The two wall runs in the scan, in feet, shortest first. */
const SIDES = [...new Set(REPORT.walls.map((wall) => wall.dimensions[0]))]
  .map((metres) => metres / METRES_PER_FOOT)
  .sort((a, b) => a - b);
const AREA = SIDES[0] * SIDES[1];

/**
 * How many rooms are kept without a subscription.
 *
 * Written here on purpose rather than imported from `core/src/entitlement.ts`.
 * This is the promise the product makes, and if somebody changes the constant
 * this part goes red and a person decides whether that was meant — which is
 * exactly what should happen to a number a contractor was told.
 */
const FREE_ROOMS = 1;

/**
 * Opens a section and hands back what is on it, or an empty string.
 *
 * `section` waits for the panel to become visible and gives up if it never
 * does — which is exactly what a panel with nothing in it does. That is the bug
 * this part is about, so it has to arrive as a red line naming the screen
 * rather than as a stack trace that stops the other seven from being looked at.
 */
async function panel(page, name, state) {
  try {
    await section(page, name);
    return (await page.locator('[data-panel]:not([hidden])').first().innerText()).trim();
  } catch (stopped) {
    check(`${state}: ${name} can be opened at all`, false, String(stopped).slice(0, 200));
    return '';
  }
}

/** The room keys this browser is holding, by the name on the end of each. */
const kept = (page) =>
  page.evaluate(() =>
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith('trueline.room.v1:'))
      .map((key) => key.slice('trueline.room.v1:'.length))
      .sort()
  );

/* ==========================================================================
   1. The app says nobody has paid. Measuring still works, and every locked
      screen says what it is rather than being an empty rectangle.
   ========================================================================== */

{
  const { browser, ctx, page } = await openAsApp({
    fileName: 'Garage', room: REPORT, subscribed: false,
  });

  // The rule rather than the screen: no part of this app is ever a blank
  // rectangle, locked or open. Five of them once were, for good, on every
  // phone — and an App Review tester who taps a paid feature and gets nothing
  // is the same bug with a rejection attached to it.
  for (const name of SECTIONS) {
    const text = await panel(page, name, 'unpaid');
    check(`unpaid: ${name} says something`, text.length >= 40,
      `${text.length} characters: ${JSON.stringify(text.slice(0, 120))}`);
  }

  await section(page, 'Plan');
  let t = await page.locator('[data-panel="plan"]').innerText();

  const said = /(\d+)' × (\d+)'/.exec(t);
  check('unpaid: the drawing is drawn, with its dimensions on it', said !== null, t.slice(0, 300));
  check('unpaid: and the dimensions are the ones in the scan, worked out here',
    said !== null
      && Math.abs(Number(said[2]) - SIDES[0]) < 0.5
      && Math.abs(Number(said[1]) - SIDES[1]) < 0.5,
    `the scan is ${SIDES[1].toFixed(1)}' × ${SIDES[0].toFixed(1)}', the screen says ${said?.[0]}`);

  const area = Number(/([\d,.]+) sq ft/.exec(t)?.[1]?.replace(/,/g, '') ?? '0');
  check('unpaid: the floor area is free, and it is the right floor area',
    Math.abs(area - AREA) < 0.5, `${SIDES[0]} × ${SIDES[1]} = ${AREA}, the screen says ${area}`);

  /* ---------------------------------------------- the locks, and their words */

  const LOCKED = [
    ['Takeoff', /worked out from the measurements/],
    ['Price', /rates against those quantities/],
    ['Agreement', /a homeowner says yes to/],
    ['Insurance', /Mark the damage on the wall/],
    ['Files', /client file, CAD/],
  ];
  for (const [name, describes] of LOCKED) {
    t = await panel(page, name, 'unpaid');
    check(`unpaid: ${name} is shut`, /part of the subscription/.test(t), t.slice(0, 300));
    check(`unpaid: ${name} says what the thing does`, describes.test(t), t.slice(0, 300));
    check(`unpaid: ${name} never says the word that makes it a toll gate`,
      !/upgrade|unlock|premium|pro only/i.test(t), t.slice(0, 300));
  }

  // The number on the screen against the number this side knows the gate keeps.
  t = await panel(page, 'Takeoff', 'unpaid');
  check('unpaid: the lock says what stays free, so declining is an informed decision',
    /Measuring, the drawing and the 3D view are not/.test(t), t.slice(0, 500));
  check(`unpaid: and it offers exactly the ${FREE_ROOMS} free room the gate keeps`,
    FREE_ROOMS === 1
      ? /neither is the first room you keep/.test(t)
      : new RegExp(`neither is the first ${FREE_ROOMS} rooms you keep`).test(t),
    t.slice(0, 500));
  check('unpaid: and it does not offer more free rooms than that',
    !/first [2-9] rooms/.test(t), t.slice(0, 500));

  check('unpaid: no console or page errors', noise().length === 0, noise().join(' | '));
  await ctx.close();
  await browser.close();
}

/* ==========================================================================
   2. Two rooms measured while everything was open. Then the gate comes on
      underneath them, and not one byte of either room moves.
   ========================================================================== */

{
  const { browser, ctx, page } = await open();

  await loadScan(page, 'garage.json');
  let names = await kept(page);
  check('the first room is written down', names.length === 1, names.join(', '));

  await page.reload({ waitUntil: 'networkidle' });
  await loadScan(page, 'kitchen.json');
  names = await kept(page);
  check('and so is a second one, while there is nothing to buy',
    names.length === 2, names.join(', '));

  // What is on the device, exactly, before anything is gated. Compared byte
  // for byte afterwards: "the rooms are still listed" is not the same claim as
  // "the rooms are untouched", and only the second one is worth making.
  const before = await page.evaluate(() =>
    Object.fromEntries(
      Object.keys(window.localStorage)
        .filter((key) => key.startsWith('trueline.room.v1:'))
        .map((key) => [key, window.localStorage.getItem(key)])
    )
  );
  check('two rooms, and this side loaded exactly two files',
    Object.keys(before).length === 2, Object.keys(before).join(', '));

  /* ------------------------------------------- now the app says nobody paid */

  await page.evaluate(() => {
    window.webkit = { messageHandlers: { saved: { postMessage() {} } } };
    window.trueline?.setSubscribed(false);
  });
  await page.waitForTimeout(500);

  let t = await panel(page, 'Takeoff', 'gate on');
  check('the gate really is on: the takeoff is shut',
    /part of the subscription/.test(t), t.slice(0, 300));

  const after = await page.evaluate(() =>
    Object.fromEntries(
      Object.keys(window.localStorage)
        .filter((key) => key.startsWith('trueline.room.v1:'))
        .map((key) => [key, window.localStorage.getItem(key)])
    )
  );
  check('both rooms are still on the device once the gate is on',
    Object.keys(after).sort().join('|') === Object.keys(before).sort().join('|'),
    `${Object.keys(before).join(', ')} → ${Object.keys(after).join(', ')}`);
  check('and neither of them has been altered by one character',
    Object.keys(before).every((key) => after[key] === before[key]),
    Object.keys(before).filter((key) => after[key] !== before[key]).join(', ') || 'none');

  // Reading old work is free and stays free. The room on the screen is the
  // second one — the one that would have been over the line — and it draws.
  await section(page, 'Plan');
  t = await page.locator('[data-panel="plan"]').innerText();
  const areaNow = Number(/([\d,.]+) sq ft/.exec(t)?.[1]?.replace(/,/g, '') ?? '0');
  check('the room that would be over the line still opens, and still measures right',
    Math.abs(areaNow - AREA) < 0.5, `${AREA} expected, screen says ${areaNow}`);

  /* ------------------------- and correcting a room already kept is not a new one */

  await page.reload({ waitUntil: 'networkidle' });
  await loadScan(page, 'garage.json');
  names = await kept(page);
  check('opening a room that is already kept makes no third room',
    names.length === 2, names.join(', '));
  await section(page, 'Plan');
  t = await page.locator('[data-panel="plan"]').innerText();
  check('and it comes back with the measurements it went in with',
    Math.abs(Number(/([\d,.]+) sq ft/.exec(t)?.[1]?.replace(/,/g, '') ?? '0') - AREA) < 0.5,
    t.slice(0, 200));

  check('nothing kept, altered or deleted raised a console error',
    noise().length === 0, noise().join(' | '));
  await ctx.close();
  await browser.close();
}

/* ==========================================================================
   3. Somebody has paid. Every one of them opens, and none of them shows a lock.
      Without this the part above would pass on an app with no gate at all.
   ========================================================================== */

{
  const { browser, ctx, page } = await openAsApp({
    fileName: 'Garage', room: REPORT, subscribed: true,
  });

  for (const [name, opens] of [['Takeoff', /What this room takes/],
                               ['Price', /What it comes to/],
                               ['Agreement', /Turn this into a proposal/],
                               ['Insurance', /Is this an insurance job\?/],
                               ['Files', /Send the drawing/]]) {
    const t = await panel(page, name, 'paid');
    check(`paid: ${name} opens`, opens.test(t), t.slice(0, 250));
    check(`paid: ${name} shows no lock`, !/part of the subscription/.test(t), t.slice(0, 250));
  }

  check('paid: no console or page errors', noise().length === 0, noise().join(' | '));
  await ctx.close();
  await browser.close();
}

process.exit(report('A25 — one free room, and the work already done') > 0 ? 1 : 0);
