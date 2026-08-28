import { readFileSync } from 'node:fs';
import { check, noise, open, report, reportEvenIfItDies, SP, URL } from './lib.mjs';

// Say what was learned even if this part dies part way through.
reportEvenIfItDies('A16 — the app as it opens, and where the tabs land');

/**
 * The app as somebody meets it, and where the tabs land.
 *
 * ## Why this part exists
 *
 * Every other part of this audit loads a scan first. So for fifteen parts,
 * nothing had walked the app the way it is actually met: nothing on the phone,
 * nothing open, and only whatever navigation is on the screen to get anywhere.
 * That is the state the report came out of —
 *
 * > "weird opening screen again and no navigation tabs on the bottom ... have
 * > to go through a project to get to the options ... the menu looks weird and
 * > not everything works ... all those rooms when you get on the app, cant do
 * > anything with them, no options"
 *
 * — and it was invisible to a suite that always began by opening a room.
 *
 * ## What a browser can and cannot see
 *
 * The tab bar is native, in `RootTabs.swift`, and nothing here can see it. What
 * this part checks is the half the tabs point at, which is the half that could
 * silently stop working: that the bundle opens on the screen it was asked for,
 * that the business form is a destination rather than a panel whose Done blanks
 * it, that the floor takes the rooms the app hands it, that the dollhouse draws
 * and turns without moving a number, and that the page's own row of links is
 * gone inside the app — where it had become a second, worse copy of the native
 * chrome.
 */

const { browser, page } = await open();

/* ---------------------------------------------------- nothing open at all */

check(
  'the app opens without a room and says what to do about it',
  (await page.getByRole('heading', { name: /open a scan/i }).count()) > 0,
  await page.locator('main').innerText()
);

check(
  'and offers a way to draw one by hand, which needs no scanner at all',
  (await page.getByRole('button', { name: /draw it by hand/i }).count()) > 0
);

/* ----------------------------------------------- the floor, with nothing on it */

await page.getByRole('button', { name: 'The whole floor' }).click();
await page.waitForTimeout(400);
check(
  'the floor opens with nothing on the phone and says so plainly',
  (await page.getByRole('heading', { name: /no rooms yet/i }).count()) > 0,
  await page.locator('main').innerText()
);

/* --------------------------------- the hand-over the Floor tab depends on */

check(
  'the page offers the app a way to hand every room it holds across',
  (await page.evaluate(() => typeof window.trueline?.putRooms)) === 'function'
);

// A real corrected room, produced the way the app produces one: open a scan,
// let the room screen save it, and take exactly what it wrote. A fixture typed
// by hand here would pass with the hand-over deleted.
await page.getByRole('button', { name: 'Back to this room' }).click();
await page.waitForTimeout(300);
const kitchen = JSON.parse(readFileSync(`${SP}/kitchen.json`, 'utf8'));
await page.evaluate((room) => window.trueline.open(room, undefined, 'kitchen'), kitchen);
await page.waitForTimeout(800);

const written = await page.evaluate(() => {
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (key && key.startsWith('trueline.room.v1:')) return window.localStorage.getItem(key);
  }
  return null;
});
check('the room screen writes a corrected room the app can keep', written !== null);

check(
  'and the parts of the room are along the bottom, where a thumb is',
  await page
    .getByRole('navigation', { name: /parts of this room/i })
    .evaluate((nav) => {
      const style = getComputedStyle(nav);
      return style.position === 'fixed' && style.bottom === '0px';
    })
);

// Now wipe it, exactly as a phone that has never opened that room in a web
// view, and let the app hand it over.
const put = await page.evaluate((project) => {
  for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
    const key = window.localStorage.key(i);
    if (key && key.startsWith('trueline.room.v1:')) window.localStorage.removeItem(key);
  }
  return window.trueline.putRooms([project]);
}, written);
check('the app can hand a room the page has never seen straight in', put === 1, `wrote ${put}`);

check(
  'and it will not overwrite a room the page has newer',
  (await page.evaluate((project) => window.trueline.putRooms([project]), written)) === 0
);

/* ---------------------------------------------------------------- dollhouse */

await page.getByRole('button', { name: 'The whole floor' }).click();
await page.waitForTimeout(600);

check(
  'the floor draws the room the app handed over',
  (await page.getByRole('heading', { name: /^1 room$/i }).count()) > 0,
  (await page.locator('main').innerText()).slice(0, 300)
);

check(
  'the floor offers a dollhouse beside the blueprint',
  (await page.getByRole('tab', { name: 'Dollhouse' }).count()) === 1
);

const flat = ((await page.locator('main').innerText()).match(/([\d,.]+)\s*sq ft/) ?? [])[1];

await page.getByRole('tab', { name: 'Dollhouse' }).click();
await page.waitForTimeout(500);

const house = page.getByRole('img', { name: /roof off/i });
check('and it draws the floor with the roof off', (await house.count()) === 1);

// Not a raw count. A rectangular room seen from a corner is a floor and the
// two walls you are NOT standing in front of -- three polygons, and three is
// right. The first version of this check asked for more than four and failed
// on a correct drawing, which is a test measuring the wrong thing.
const drawn = await house.evaluate((svg) =>
  [...svg.querySelectorAll('polygon')].map((p) => p.getAttribute('fill'))
);
const floors = drawn.filter((fill) => fill === 'rgb(var(--c-sunk))').length;
const walls = drawn.filter((fill) => fill.startsWith('hsl(214')).length;
check('one floor is drawn for the room', floors === 1, drawn.join(' '));
check(
  'and the walls behind it are up while the ones in front are taken away',
  walls >= 2 && walls < 4,
  `${walls} of 4 walls drawn`
);
check(
  'the room is named on it, so a dollhouse of six rooms can be read',
  (await house.evaluate((svg) => [...svg.querySelectorAll('text')].map((t) => t.textContent)))
    .includes('kitchen')
);

check(
  'it says the near walls are taken away, so nobody reads one as a missing wall',
  (await page.locator('main').innerText()).includes('taken away')
);

// Turning it must move nothing anybody is paid on. The whole product rests on
// a picture never being allowed to become a measurement.
const box = await house.boundingBox();
const firstFace = () => house.evaluate((svg) => svg.querySelector('polygon')?.getAttribute('points'));
const wasDrawn = await firstFace();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 140, box.y + box.height / 2 + 50, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(400);
check('dragging turns it', (await firstFace()) !== wasDrawn);

await page.getByRole('tab', { name: 'Blueprint' }).click();
await page.waitForTimeout(400);
const still = ((await page.locator('main').innerText()).match(/([\d,.]+)\s*sq ft/) ?? [])[1];
check('and turning it moved no number on the floor', flat === still, `${flat} then ${still}`);

/* ------------------------------------------- opening straight on a screen */

await page.goto(`${URL}#business`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

check(
  'the app can open straight on the business details, with no room in the way',
  (await page.getByRole('heading', { name: 'Your business' }).count()) === 1,
  (await page.locator('main').innerText()).slice(0, 200)
);

check(
  'and nothing else is drawn underneath it',
  (await page.getByRole('heading', { name: /open a scan/i }).count()) === 0
);

check(
  'there is no Done on it, because there is nothing behind it to go back to',
  (await page.getByRole('button', { name: 'Done' }).count()) === 0
);

await page.getByLabel('Business name').fill('Gilbert Remodeling');
await page.getByRole('button', { name: 'Save' }).click();
await page.waitForTimeout(400);
check(
  'and saving says it landed rather than looking like nothing happened',
  (await page.getByRole('status').filter({ hasText: /saved/i }).count()) > 0,
  (await page.locator('main').innerText()).slice(0, 400)
);

await page.goto(`${URL}#floor`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
check(
  'and straight on the floor',
  (await page.getByRole('tab', { name: 'Dollhouse' }).count()) === 1,
  (await page.locator('main').innerText()).slice(0, 200)
);

/* ------------------------------------ the page's own links, inside the app */

// Set before any script on the page runs, because `insideApp()` is asked at
// render and a stub installed afterwards would be answered by a screen that
// had already drawn itself.
await page.addInitScript(() => {
  window.webkit = { messageHandlers: {
    saved: { postMessage() {} },
    thumbnail: { postMessage() {} },
    company: { postMessage() {} },
    photo: { postMessage() {} },
    calendar: { postMessage() {} },
  } };
});
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

check(
  'inside the app the page draws no row of links of its own',
  (await page.getByRole('button', { name: 'The whole floor' }).count()) === 0 &&
    (await page.getByRole('button', { name: 'Your business' }).count()) === 0,
  (await page.locator('main').innerText()).slice(0, 300)
);

check(
  'and it offers to draw a room rather than a file picker there is no filesystem for',
  (await page.getByRole('button', { name: /draw/i }).count()) > 0,
  (await page.locator('main').innerText()).slice(0, 300)
);

// In a browser it is the only navigation there is, so it must still be there.
await page.addInitScript(() => { delete window.webkit; });
const fresh = await page.context().newPage();
await fresh.goto(URL, { waitUntil: 'networkidle' });
await fresh.waitForTimeout(400);
check(
  'and in a browser, where there are no tabs, the links are still the way around',
  (await fresh.getByRole('button', { name: 'The whole floor' }).count()) === 1 &&
    (await fresh.getByRole('button', { name: 'Your business' }).count()) === 1
);

check('no console or page errors across the whole run', noise().length === 0, noise().join('\n'));

const bad = report('A16 — the app as it opens, and where the tabs land');
await browser.close();
process.exit(bad === 0 ? 0 : 1);
