import { SP, check, loadScan, open, pick, report, section } from './lib.mjs';
const { browser, ctx, page } = await open();

/* -------------------------------------------- corrections survive a reload */

await loadScan(page);
await pick(page, /^Wall wall-1,/);
await page.getByRole('textbox', { name: 'the length of wall-1' }).fill(`20' 3"`);
await page.getByRole('button', { name: 'Set the length of wall-1' }).click();
await page.waitForTimeout(500);

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
let t = await page.locator('body').innerText();
check('a browser reload asks for the file again', /Open a scan/.test(t), t.slice(0, 200));

await loadScan(page);
await page.waitForTimeout(600);
const walls = [];
for (const l of await page.getByRole('button', { name: /^Wall / }).all()) walls.push(await l.getAttribute('aria-label'));
check('re-opening the same scan brings the correction back', walls.some((l) => /20' 3"/.test(l || '')), walls.join(' | '));

/* -------------------------------------- two scans keep two sets of corrections */

await page.getByRole('button', { name: /Open another/i }).click().catch(() => {});
await page.waitForTimeout(400);
await page.setInputFiles('input[type=file][accept="application/json,.json"]', SP + '/kitchen.json');
await page.waitForTimeout(600);
const kitchenWalls = [];
for (const l of await page.getByRole('button', { name: /^Wall / }).all()) kitchenWalls.push(await l.getAttribute('aria-label'));
check('the second scan opens clean, not carrying the first one’s work',
  !kitchenWalls.some((l) => /20' 3"/.test(l || '')), kitchenWalls.join(' | '));

await page.getByRole('button', { name: /Open another/i }).click().catch(() => {});
await page.waitForTimeout(300);
await loadScan(page);
await page.waitForTimeout(600);
const back = [];
for (const l of await page.getByRole('button', { name: /^Wall / }).all()) back.push(await l.getAttribute('aria-label'));
check('and the first one still has its own', back.some((l) => /20' 3"/.test(l || '')), back.join(' | '));

/* ------------------------------------------------------------ the editing */

await pick(page, /^Wall wall-2,/);
await page.getByRole('button', { name: 'Change this wall' }).click();
await page.waitForTimeout(250);
await page.getByRole('textbox', { name: 'What to call this wall' }).fill('behind the washer');
await page.getByRole('textbox', { name: 'What to call this wall' })
  .locator('xpath=following-sibling::button[1]').click();
await page.waitForTimeout(400);
const named = [];
for (const l of await page.getByRole('button', { name: /^Wall / }).all()) named.push(await l.getAttribute('aria-label'));
check('a wall can be renamed', named.some((l) => /behind the washer/.test(l || '')), named.join(' | '));

// Move it by hand.
await page.getByRole('textbox', { name: 'Move this wall to' }).fill('22');
await page.getByRole('button', { name: 'Move it' }).click();
await page.waitForTimeout(500);
const moved = [];
for (const l of await page.getByRole('button', { name: /^Wall / }).all()) moved.push(await l.getAttribute('aria-label'));
check('a moved wall goes where it was put', moved.some((l) => /behind the washer, 22'/.test(l || '')), moved.join(' | '));
check('a moved wall is violet on the plan', (await page.locator('svg line[stroke="#7c3aed"]').count()) === 1);
check('the key names it', (await page.locator('ul.flex-wrap').first().innerText()).includes('Moved by hand'));
t = await page.locator('body').innerText();
check('a moved wall never reads as measured', /moved by hand, which is not the same as measured/.test(t));
// The room's own verdict lives with the checks, a tab away from the drawing.
// That it is a tab away is the point: a wall dragged on the Plan must not have
// quietly changed what the Room section says about the whole room.
await section(page, 'Room');
const verdict = await page.locator('body').innerText();
check('and the room still asks for a tape',
  /Put a tape on one east-west wall|Put a tape on one north-south wall/.test(verdict),
  verdict.split('\n').filter((l) => /tape on one/.test(l)).join(' | '));
await section(page, 'Plan');

/* --------------------------------------------------------------- the room name */

await page.getByRole('button', { name: /^Rename / }).click();
await page.getByRole('textbox', { name: 'What to call this room' }).fill('Gilbert — garage');
await page.getByRole('button', { name: 'Set', exact: true }).first().click();
await page.waitForTimeout(400);
check('the room can be renamed', (await page.locator('h2').first().innerText()) === 'Gilbert — garage');

process.exit(report('A6 — persistence, two scans, editing') > 0 ? 1 : 0);
