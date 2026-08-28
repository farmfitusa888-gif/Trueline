import { check, loadScan, noise, open, report, reportEvenIfItDies, section, SP } from './lib.mjs';

// Say what was learned even if this part dies part way through.
reportEvenIfItDies('A9 — what the trade changes, and what it must not');

/**
 * The trade somebody picks changes the words and the order, and nothing else.
 *
 * The check that matters is the last one: the numbers a painter sees and the
 * numbers a drywaller sees have to be the same numbers. A vocabulary that moved
 * a quantity would be a vocabulary that lied.
 */
const { browser, ctx, page } = await open();
await loadScan(page);

async function takeoffText() {
  await section(page, 'Takeoff');
  return (await page.locator('section', {
    has: page.getByRole('heading', { name: 'What this room takes' }),
  }).first().innerText());
}

async function pickTrade(name) {
  await page.getByRole('button', { name: 'Your business' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: new RegExp('^' + name) }).first().click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(400);
}

const plain = await takeoffText();
check('by default the app uses its own words', /Wall face/.test(plain), plain.slice(0, 300));

/* ------------------------------------------------------------- a painter */

await pickTrade('Painting');
const painter = await takeoffText();
check('a painter sees paint areas, not "wall face"',
  /Wall paint area/.test(painter) && !/Wall face/.test(painter), painter.slice(0, 400));
check('and the painter leads with the wall, not the floor',
  painter.indexOf('Wall paint area') < painter.indexOf('Finished floor') ||
  painter.indexOf('Wall paint area') < painter.indexOf('Floor'), painter.slice(0, 300));

/* ------------------------------------------------------------ a drywaller */

await pickTrade('Drywall');
const drywall = await takeoffText();
check('a drywaller sees board areas for the same wall',
  /Board area, walls/.test(drywall), drywall.slice(0, 400));

/* ------------------------------------------- and the numbers never moved */

const numbers = (text) => (text.match(/[\d,]+\.\d+\s*(sq ft|lf)/g) ?? []).sort();
check('every quantity is identical whichever trade is chosen',
  JSON.stringify(numbers(painter)) === JSON.stringify(numbers(plain)) &&
  JSON.stringify(numbers(drywall)) === JSON.stringify(numbers(plain)),
  `plain ${numbers(plain).join(' | ')}\npaint ${numbers(painter).join(' | ')}\nboard ${numbers(drywall).join(' | ')}`);

check('nothing is dropped: every line is still there for every trade',
  numbers(painter).length === numbers(plain).length &&
  numbers(drywall).length === numbers(plain).length,
  `${numbers(plain).length} / ${numbers(painter).length} / ${numbers(drywall).length}`);

check('no console or page errors across the whole run', noise().length === 0, noise().join(' | '));

const bad = report('A9 — what the trade changes, and what it must not');
await ctx.close();
await browser.close();
process.exit(bad > 0 ? 1 : 0);
