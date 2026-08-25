import { SP, check, loadScan, noise, open, pick, report } from './lib.mjs';

const { browser, page } = await open();

/* ---------------------------------------------------------- the empty state */

const first = await page.locator('body').innerText();
check('opening screen offers a scan', first.includes('Open a scan'), first.slice(0, 200));
check('opening screen offers drawing by hand', /Draw it by hand|Draw the room/i.test(first), first.slice(0, 300));
check('opening screen says nothing is uploaded', first.includes('Nothing is uploaded'), first.slice(0, 400));

/* ------------------------------------------------------------ loading a scan */

await loadScan(page);
const body = await page.locator('body').innerText();
check('the room loads', body.includes('420.0 sq ft'), body.slice(0, 300));
check('room dimensions shown', body.includes("21' × 20'"), body.slice(0, 200));
check('the caveat is on screen', /SCANNED — no wall here has had a tape on it/.test(body));

/* ------------------------------------------------------------------ the plan */

const plan = page.locator('svg[aria-label^="Plan of"]');
check('the plan renders', (await plan.count()) === 1);
const walls = page.getByRole('button', { name: /^(Wall|Open span) / });
check('every wall is a named control', (await walls.count()) === 4, `${await walls.count()} walls`);
const labels = [];
for (let i = 0; i < await walls.count(); i += 1) labels.push(await walls.nth(i).getAttribute('aria-label'));
check('wall labels carry the length', labels.every((l) => /\d/.test(l || '')), labels.join(' | '));

// Keyboard selection.
await pick(page, /^Wall wall-1,/);
check('a wall selects by keyboard', await page.getByRole('button', { name: /^Wall wall-1,/ }).getAttribute('aria-pressed') === 'true');

/* --------------------------------------------------------------- 3D and back */

await page.getByRole('tab', { name: '3D' }).click();
await page.waitForTimeout(300);
check('3D view renders', (await page.locator('svg').count()) > 0);
await page.getByRole('tab', { name: 'Blueprint' }).click();
await page.waitForTimeout(300);
check('back to the blueprint', (await page.locator('svg[aria-label^="Plan of"]').count()) === 1);

/* ---------------------------------------------------------------- the takeoff */

const takeoff = await page.locator('body').innerText();
check('floor area on the takeoff', takeoff.includes('420.0 sq ft'));
check('wall face on the takeoff', takeoff.includes('702.0 sq ft'), 'expected 82ft perimeter x 9ft less 36 sq ft of openings');
check('baseboard on the takeoff', takeoff.includes('79.00 lf'), 'expected 82ft less a 3ft door');

/* ------------------------------------------------------------ ceiling height */

await page.getByRole('button', { name: "10'", exact: true }).first().click();
await page.waitForTimeout(400);
const tall = await page.locator('body').innerText();
// 82 ft of perimeter at 10 ft is 820 sq ft, less a 3x6'8" door (20) and a
// 4x4 window (16) = 784. Checked on paper.
check('setting the ceiling moves wall face', tall.includes('784.0 sq ft'), tall.slice(tall.indexOf('Wall face'), tall.indexOf('Wall face') + 40));
check('setting the ceiling leaves the floor alone', tall.includes('420.0 sq ft'));

/* --------------------------------------------------------------- wall thickness */

await page.getByRole('button', { name: '2x6', exact: true }).first().click();
await page.waitForTimeout(400);
const thick = await page.locator('body').innerText();
check('thickness unlocks the framing block', /Plates|Studs/.test(thick), thick.slice(0, 400));
check('thickness gives the jamb size', /6 9\/16|6\.5625/.test(thick), 'a 2x6 jamb is 6 9/16 inches');

/* -------------------------------------------------------------- verify a wall */

await pick(page, /^Wall wall-1,/);
const box = page.getByRole('textbox', { name: 'the length of wall-1' });
check('the wall length box is named for its wall', (await box.count()) === 1, `${await box.count()} boxes`);
await box.fill('20\' 3"');
await page.getByRole('button', { name: 'Set the length of wall-1' }).click();
await page.waitForTimeout(400);
const measured = await page.locator('body').innerText();
check('a taped wall re-solves the room', /measured|Measured/.test(measured), measured.slice(0, 300));
const after = [];
for (const l of await page.getByRole('button', { name: /^Wall / }).all()) after.push(await l.getAttribute('aria-label'));
check('the taped wall holds its number', after.some((l) => /20' 3"/.test(l || '')), after.join(' | '));

console.log('walls after taping:', after.join(' | '));
process.exit(report('A1 — loading, plan, takeoff, corrections') > 0 ? 1 : 0);
