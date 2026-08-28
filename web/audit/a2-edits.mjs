import { check, loadScan, open, pick, report, reportEvenIfItDies, section, SP } from './lib.mjs';

// Say what was learned even if this part dies part way through.
reportEvenIfItDies('A2 — openings, refusals, undo, exports');
const { browser, ctx, page } = await open();
await loadScan(page);

/* ------------------------------------------------------------- openings */

await pick(page, /^Wall wall-1,/);
const body = await page.locator('body').innerText();
check('the wall lists its openings', /Door[\s\S]*Window/.test(body), body.slice(0, 200));
check('opening sizes shown', body.includes(`3' × 6' 8"`) && body.includes(`4' × 4'`));

await page.getByRole('button', { name: 'Measure' }).first().click();
await page.waitForTimeout(300);
const widthBox = page.getByRole('textbox', { name: /^width of the door/ });
check('an opening field is named for its opening', (await widthBox.count()) === 1, `${await widthBox.count()}`);
await widthBox.fill(`2' 10"`);
await page.getByRole('button', { name: /^Set width of the door/ }).click();
await page.waitForTimeout(400);
const afterDoor = [];
for (const l of await page.getByRole('button', { name: /^Wall / }).all()) afterDoor.push(await l.getAttribute('aria-label'));
check('measuring an opening moves no wall', afterDoor.every((l) => /20'$|21'$/.test(l || '')), afterDoor.join(' | '));
await section(page, 'Takeoff');
const t2 = await page.locator('body').innerText();
check('the baseboard follows the door', t2.includes('79.17 lf'), '82ft less a 2ft10 door = 79.166');
await section(page, 'Plan');

/* --------------------------------- an opening that will not fit is refused */

const fromBox = page.getByRole('textbox', { name: /^from the corner of the door/ });
await fromBox.fill(`19'`);
await page.getByRole('button', { name: /^Set from the corner of the door/ }).click();
await page.waitForTimeout(400);
const refused = await page.locator('body').innerText();
check(
  'an opening pushed past the end of the wall is refused, with the numbers',
  /past the end|does not fit|would (?:run|stick)/i.test(refused),
  refused.split('\n').filter((l) => l.length > 30 && l.length < 200).slice(0, 6).join(' | ')
);

/* ------------------------------------------------------------------ undo */

const undo = page.getByRole('button', { name: /^Undo/ });
check('undo is offered', (await undo.count()) > 0);
if (await undo.count()) {
  await undo.first().click();
  await page.waitForTimeout(400);
}

/* ------------------------------------------------- furniture comes off the sheet */

// A drawing going to a client or an adjuster is the building, not the client's
// freezer. The toggle is a view control and this is what proves it: the takeoff
// is read on both sides of it and has to be the same both times.
{
  const shots = await open();
  const p2 = shots.page;
  await p2.setInputFiles('input[type=file][accept="application/json,.json"]', `${SP}/garage-furnished.json`);
  await p2.waitForTimeout(600);

  const boxes = () => p2.locator('svg[aria-label^="Plan of"] rect[stroke-dasharray="3 3"]').count();
  check('what was in the room is drawn on the plan', (await boxes()) === 3, `${await boxes()} drawn`);
  check('the key says so', (await p2.locator('ul.flex-wrap').first().innerText()).includes('What was in the room'));

  await section(p2, 'Takeoff');
  const withIt = await p2.locator('body').innerText();

  await section(p2, 'Plan');
  await p2.getByRole('button', { name: /^Hide what was in the room/ }).click();
  await p2.waitForTimeout(300);
  check('hiding it takes it off the drawing', (await boxes()) === 0, `${await boxes()} still drawn`);
  check('and out of the key, which would otherwise name something absent',
    !(await p2.locator('ul.flex-wrap').first().innerText()).includes('What was in the room'));

  await section(p2, 'Takeoff');
  check('and moves not one number, because none of them ever came from it',
    (await p2.locator('body').innerText()) === withIt);

  await shots.browser.close();
}

/* --------------------------------------------------------------- exports */

await section(page, 'Files');

const send = page.locator('section', { has: page.getByRole('heading', { name: 'Send the drawing' }) }).first();
check('the drawing can be sent', (await send.count()) === 1);
const names = await send.getByRole('button').allInnerTexts();
check('drawing, print, CAD and client file all offered',
  names.join('|').includes('Just the drawing') && names.join('|').includes('Print') &&
  names.join('|').includes('CAD') && names.join('|').includes('client'), names.join(' | '));

// The CAD file, actually produced.
const [dxf] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  send.getByRole('button', { name: /CAD/ }).click(),
]);
await dxf.saveAs(SP + '/audit-plan.dxf');
check('a DXF is produced', dxf.suggestedFilename().endsWith('.dxf'), dxf.suggestedFilename());

// The spreadsheet.
await section(page, 'Takeoff');
const takeoff = page.locator('section', { has: page.getByRole('heading', { name: 'What this room takes' }) }).first();
const [csv] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  takeoff.getByRole('button', { name: 'Spreadsheet' }).click(),
]);
await csv.saveAs(SP + '/audit-takeoff.csv');
check('a CSV is produced', csv.suggestedFilename().endsWith('.csv'), csv.suggestedFilename());

process.exit(report('A2 — openings, refusals, undo, exports') > 0 ? 1 : 0);
