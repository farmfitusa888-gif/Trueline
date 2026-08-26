import { check, noise, open, report } from './lib.mjs';
const { browser, page } = await open();

/* ------------------------------------------------------- draw a room by hand */

await page.getByRole('button', { name: /Draw it by hand|Draw the room/i }).click();
await page.waitForTimeout(400);
let t = await page.locator('body').innerText();
check('the drawing screen opens', /name|What is this room|ceiling/i.test(t), t.slice(0, 250));

// Tapping corners is what opens first now, because it is what somebody reaches
// for. Typing walls one at a time is folded underneath, for the room somebody
// already has the numbers for -- and this part is about that one.
check('and offers tapping the corners first',
  /Tap its corners the way you would walk round it/.test(t), t.slice(0, 400));
const typed = page.getByText(/Or type it in wall by wall/);
check('with typing it in wall by wall underneath', (await typed.count()) === 1);
await typed.click();
await page.waitForTimeout(300);

// Name and ceiling, then Start.
await page.getByRole('textbox', { name: 'What is this room?' }).fill('hand-drawn shop');
await page.getByRole('textbox', { name: 'How high is the ceiling?' }).fill(`9'`);
await page.getByRole('button', { name: 'Start', exact: true }).click();
await page.waitForTimeout(400);
const headings = page.getByRole('button', { name: /^(north|south|east|west)$/i });
check('only the headings that turn a corner are offered', (await headings.count()) <= 4 && (await headings.count()) >= 1,
  `${await headings.count()} headings`);

// Walk a 12 x 8 room.
async function wall(dir, len) {
  await page.getByRole('button', { name: new RegExp(`^${dir}$`, 'i') }).first().click();
  await page.waitForTimeout(150);
  const box = page.getByRole('textbox', { name: /how long/i });
  await box.fill(len);
  await page.getByRole('button', { name: /^Set how long/i }).click();
  await page.waitForTimeout(250);
}
await wall('east', `12'`);
await wall('north', `8'`);
await wall('west', `12'`);
t = await page.locator('body').innerText();
check('the closing wall is worked out for you', /last wall has to run|has to run south/i.test(t),
  t.split('\n').filter((l) => l.length > 20 && l.length < 200).slice(-6).join(' | '));

const addIt = page.getByRole('button', { name: /^Add it/i });
if (await addIt.count()) { await addIt.first().click(); await page.waitForTimeout(300); }

const finish = page.getByRole('button', { name: /Finish the room/i });
check('the room can be finished', (await finish.count()) > 0);
if (await finish.count()) {
  await finish.first().click();
  await page.waitForTimeout(600);
}
t = await page.locator('body').innerText();
check('a hand-drawn room reads as measured, not scanned', /Measured/.test(t) && !/SCANNED — no wall here/.test(t),
  t.slice(0, 400));
check('the hand-drawn room has the right area', t.includes('96.0 sq ft'), "12 x 8 is 96");
check('the name given is the name shown', t.includes('hand-drawn shop'), t.slice(0, 200));


/* ------------------------------------------- and the same room, by tapping it */

{
  // A separate app, because the one above has a finished room in it and this is
  // about the screen somebody meets with nothing drawn.
  const fresh = await open();
  await fresh.page.getByRole('button', { name: /Draw it by hand|Draw the room/i }).click();
  await fresh.page.waitForTimeout(400);
  await fresh.page.getByLabel('What to call it').fill('tapped shop');
  await fresh.page.getByRole('button', { name: 'Start drawing' }).click();
  await fresh.page.waitForTimeout(400);

  const board = fresh.page.locator('svg[role="application"]');
  check('a board to tap on', (await board.count()) === 1);

  // Re-measured every time: controls appear as corners are added, the page
  // grows, and a box taken once goes stale — which is how this test first
  // "proved" a rectangle was a square.
  const tap = async (fx, fy) => {
    const box = await board.boundingBox();
    await fresh.page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    await fresh.page.waitForTimeout(240);
  };
  await tap(0.28, 0.70);
  await tap(0.72, 0.695);   // a thumb's wobble on a level wall
  await tap(0.725, 0.34);
  await tap(0.28, 0.345);

  const runs = await fresh.page.evaluate(() =>
    [...document.querySelectorAll('svg[role="application"] text')].map((t) => t.textContent));
  check('four corners make three walls, each with its length on it',
    runs.length === 3 && runs.every((r) => /['\u2032]/.test(r)), JSON.stringify(runs));
  check('the wobble is squared away, so opposite walls agree',
    runs[0] === runs[2], JSON.stringify(runs));
  check('and it is the rectangle that was drawn, not a square',
    runs[0] !== runs[1], JSON.stringify(runs));

  await board.locator('circle').first().click();
  await fresh.page.waitForTimeout(350);
  let shown = await fresh.page.locator('body').innerText();
  check('tapping the first corner closes the room',
    /4 walls, drawn — not measured/.test(shown), shown.slice(0, 400));
  check('and it says what a grid length is worth',
    /good to about 6"/.test(shown), shown.slice(0, 500));

  await fresh.page.getByRole('button', { name: 'Open it' }).click();
  await fresh.page.waitForTimeout(800);
  shown = await fresh.page.locator('body').innerText();
  check('it opens as a room', /tapped shop/.test(shown), shown.slice(0, 200));

  // The rule the whole thing rests on. A room tapped out in ten seconds must
  // never tell anybody it was measured -- and it must not say it was scanned
  // either, which is what it did the first time this ran.
  check('the sheet says DRAWN, not measured and not scanned',
    /DRAWN — every length came off the grid/.test(shown) && !/SCANNED/.test(shown),
    shown.slice(0, 600));

  check('tapping: no console or page errors', noise().length === 0, noise().join(' | '));
  await fresh.ctx.close();
  await fresh.browser.close();
}

process.exit(report('A3 — drawing a room by hand') > 0 ? 1 : 0);
