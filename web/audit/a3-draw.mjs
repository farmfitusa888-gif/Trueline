import { check, open, report } from './lib.mjs';
const { browser, page } = await open();

/* ------------------------------------------------------- draw a room by hand */

await page.getByRole('button', { name: /Draw it by hand|Draw the room/i }).click();
await page.waitForTimeout(400);
let t = await page.locator('body').innerText();
check('the drawing screen opens', /name|What is this room|ceiling/i.test(t), t.slice(0, 250));

// Name and ceiling, then Start.
await page.getByRole('textbox', { name: 'What is this room?' }).fill('hand-drawn shop');
await page.getByRole('textbox', { name: 'How high is the ceiling?' }).fill(`9'`);
await page.getByRole('button', { name: 'Start' }).click();
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

process.exit(report('A3 — drawing a room by hand') > 0 ? 1 : 0);
