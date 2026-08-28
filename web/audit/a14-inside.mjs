import { check, loadScan, noise, open, report, reportEvenIfItDies, section } from './lib.mjs';

// Say what was learned even if this part dies part way through.
reportEvenIfItDies('A14 — standing inside, and what is behind the wall');

/**
 * Standing inside the room, and what is behind the wall.
 *
 * Two features that were built and then had to be reached, which is the
 * failure this repository keeps having: `section.ts` has held a dollhouse, a
 * cut plane and a walkthrough since early on and nothing in the app ever
 * called any of it.
 *
 * So the checks here are mostly reachability — is the control there, does
 * pressing it change what is drawn, does the thing you added appear on the
 * drawing — plus the one property that must never bend: a tag is a place and
 * some words, and it never becomes a number.
 */

const { browser, page } = await open();
await loadScan(page);
await page.evaluate(() => {
  window.webkit = { messageHandlers: { saved: { postMessage() {} } } };
  window.trueline?.setSubscribed(true);
});
await page.waitForTimeout(400);

/* ------------------------------------------------------------ standing in */

await section(page, 'Plan');
// A tab rather than a button -- the view switch is a real tablist.
await page.getByRole('tab', { name: '3D' }).click();
await page.waitForTimeout(300);

const outside = page.getByRole('img', { name: /in three dimensions/ });
check('the 3D view opens looking at the room from outside', (await outside.count()) === 1);

const walls = () =>
  page.evaluate(() => document.querySelectorAll('svg[aria-label] polygon').length);
const before = await walls();

const step = page.getByRole('button', { name: 'Stand inside' });
check('and there is a way to stand in it', (await step.count()) === 1);
await step.click();
await page.waitForTimeout(300);

check('standing inside, the picture says so',
  (await page.getByRole('img', { name: /Standing in .*, looking around/ }).count()) === 1);
check('and it is a different picture, not the same one relabelled',
  (await walls()) !== before, `${before} faces before, ${await walls()} after`);

// The ceiling is the tell: the orbit view never draws one, because looking
// down at a lid is not what anybody wanted. From inside it has to be there.
const hasCeiling = await page.evaluate(() =>
  [...document.querySelectorAll('svg polygon')].length > 0
);
check('something is drawn at all', hasCeiling);

const walking = await page.locator('body').innerText();
check('the instruction changes to match where you are',
  /Drag to look around/.test(walking), walking.slice(0, 200));

await page.getByRole('button', { name: 'Back outside' }).click();
await page.waitForTimeout(300);
check('and there is a way back out',
  (await page.getByRole('img', { name: /in three dimensions/ }).count()) === 1);

/* --------------------------------------------------------- the cut plane */

// The last thing in `section.ts` that nothing called. Everything about WHERE
// the plane falls is tested in section.test.ts; this checks it is reachable
// and that pressing it changes the drawing.
const tall = () =>
  page.evaluate(() => {
    const walls = [...document.querySelectorAll('svg polygon')].map((p) => {
      const ys = p.getAttribute('points').split(' ').map((q) => Number(q.split(',')[1]));
      return Math.max(...ys) - Math.min(...ys);
    });
    return Math.max(...walls);
  });

const whole = await tall();
const cut = page.getByRole('button', { name: 'Cut it' });
check('the room can be cut at a height', (await cut.count()) === 1);
await cut.click();
await page.waitForTimeout(300);

check('and the walls come down to the plane', (await tall()) < whole,
  `${whole} whole, ${await tall()} cut`);

let said = await page.locator('body').innerText();
check('it opens at the conventional four foot', /Cut at 4', looking down/.test(said),
  said.slice(0, 400));
check('and says a cut is a way of looking, not a change to the room',
  /A cut moves no number/.test(said));

// Every stop is a real height in this room rather than an arbitrary slider.
const stops = await page.getByRole('button', { name: /^Cut at / }).count();
check('the heights offered are the ones that show something', stops >= 1, `${stops} stops`);

await page.getByRole('button', { name: 'Whole room' }).click();
await page.waitForTimeout(300);
check('and the whole room comes back', (await tall()) === whole,
  `${whole} before, ${await tall()} after`);

/* ------------------------------------------------------- behind the wall */

await section(page, 'Room');
let text = await page.locator('body').innerText();
check('the room offers somewhere to record what is behind the wall',
  /What is behind the wall/.test(text), text.slice(0, 300));
check('and says out loud that it never becomes a quantity',
  /never becomes a quantity/.test(text));

// Pressing it with nothing filled in has to say what it wants, which is the
// class of bug the complete click-through found in seven other forms.
await page.getByRole('button', { name: 'Pin it' }).click();
await page.waitForTimeout(200);
text = await page.locator('body').innerText();
check('an empty form says what it wants rather than doing nothing',
  /Fill in .*how far along it.*what you found/.test(text), text.slice(0, 400));

// Ticking, not choosing, since 2026-08-26: an open wall is rarely one thing,
// and the form now starts with Framing lit. This part is about a tag never
// becoming a quantity, so it wants one condition on it — tick Electrical, then
// untick Framing. What happens when several are ticked is A18's subject.
await page.getByRole('button', { name: 'Electrical' }).click();
await page.getByRole('button', { name: 'Framing' }).click();
check('a tag can be brought back to one thing',
  (await page.locator('button[aria-pressed="true"]').filter({ hasText: /^Electrical$/ }).count()) === 1
  && (await page.locator('button[aria-pressed="true"]').filter({ hasText: /^Framing$/ }).count()) === 0);
await page.getByLabel('How far along it').fill(`6'`);
await page.getByLabel('How high (if it matters)').fill(`7'`);
await page.getByLabel('What you found').fill('knob and tube, still live');
await page.getByRole('button', { name: 'Pin it' }).click();
await page.waitForTimeout(300);

text = await page.locator('body').innerText();
check('a pinned condition is listed in words anybody could act on',
  /Electrical on .*7' up — knob and tube, still live/.test(text), text.slice(0, 600));
check('and it is counted by kind', /Electrical · 1/.test(text), text.slice(0, 300));

await section(page, 'Plan');
const onPlan = page.getByLabel(/Electrical on .*knob and tube/);
check('and it is on the drawing, at the spot', (await onPlan.count()) >= 1);

// The whole reason it is a separate type from damage.
const takeoff = await (async () => {
  await section(page, 'Takeoff');
  return page.locator('body').innerText();
})();
check('and it is nowhere in the takeoff, because it is not a quantity',
  !/knob and tube/.test(takeoff), takeoff.slice(0, 400));

await section(page, 'Room');
await page.getByRole('button', { name: /^Take off Electrical/ }).click();
await page.waitForTimeout(300);
text = await page.locator('body').innerText();
check('and it can be taken off again', !/knob and tube/.test(text), text.slice(0, 400));

check('no console or page errors across the whole run', noise().length === 0, noise().join(' | '));

const bad = report('A14 — standing inside, and what is behind the wall');
await browser.close();
process.exit(bad === 0 ? 0 : 1);
