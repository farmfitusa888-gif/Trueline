import { readFileSync } from 'node:fs';
import { check, noise, openAsApp, pick, report, reportEvenIfItDies, section, sentTo, SP } from './lib.mjs';

// Say what was learned even if this part dies part way through.
reportEvenIfItDies('A23 — costing what is actually being done');

/**
 * Costing what is actually being done, driven through the real app.
 *
 * > "How are we costing everything down like it all needs to be replaced by
 * >  each line item? Maybe have an area inside each wall page when you click on
 * >  it with what is actually being done, and figure out how to let the user
 * >  pick or decide that. And if there's things not in the costing option yet,
 * >  let them make it and it also goes into their cost options."
 *
 * Every figure this part checks is worked out **on this side**, from the
 * numbers the app itself showed beside the tick boxes. A screen that agrees
 * with itself proves nothing; the failure this feature can produce is a quote
 * that adds up perfectly and is for the wrong work, and only arithmetic done
 * outside the thing being tested can see it.
 *
 * Four properties, in the order they would break:
 *
 *   1. A room nobody has scoped is priced exactly as it always was, and says so.
 *   2. Saying what is being done moves nothing until something is unticked.
 *   3. Unticking takes that wall's area off, to the square foot, and the wall
 *      that is left alone produces NO line — not a zero one.
 *   4. An item the contractor invented is offered on a wall, lands on the sheet
 *      at a quantity the room measured, and is priced at the rate he typed.
 */

const kitchen = JSON.parse(readFileSync(`${SP}/kitchen.json`, 'utf8'));

const RATES = [
  ['Floor rate', '9.50'],
  ['Ceiling rate', '4.25'],
  ['Wall face rate', '3.75'],
  ['Baseboard rate', '6.00'],
];

const cash = (text) => Number(String(text).replace(/[^0-9.]/g, ''));

/** The quantity the takeoff screen is showing against one item. */
function quantityOf(panel, item) {
  const line = new RegExp(`(?:^|\\n)${item}\\n[\\s\\S]{0,200}?([\\d,]+\\.?\\d*) (sq ft|lf|ea)`).exec(panel);
  return line ? Number(line[1].replace(/,/g, '')) : null;
}

/* ==========================================================================
   1. The rate book, and an item Gilbert invents that no takeoff has ever
      produced. It has to name where its quantity comes from or it is a line
      in a spreadsheet rather than part of a takeoff.
   ========================================================================== */

const shop = await openAsApp({ subscribed: true }, {});
await shop.page.goto(shop.page.url() + '#business', { waitUntil: 'networkidle' });
await shop.page.waitForTimeout(600);

for (const [label, typed] of RATES) {
  const box = shop.page.getByLabel(label);
  await box.fill(typed);
  await box.blur();
  await shop.page.waitForTimeout(80);
}

let seen = await shop.page.locator('body').innerText();
check('the rate book offers items of the contractor’s own',
  /Your own items/.test(seen), seen.slice(0, 400));
check('and says the quantity has to come from somewhere',
  /Where its quantity comes from/.test(seen), seen.slice(0, 600));

await shop.page.getByLabel('What you call it').fill('Skim coat');
await shop.page.getByLabel('Where its quantity comes from')
  .selectOption({ label: 'the face of the wall, less its openings' });
await shop.page.getByLabel('What it covers').fill('plaster, labour');
await shop.page.getByLabel(/^What you charge, per sq ft$/).fill('2.10');
await shop.page.getByRole('button', { name: 'Add it to your rates' }).click();
await shop.page.waitForTimeout(400);

seen = await shop.page.locator('body').innerText();
check('an invented item joins the book and says how it is measured',
  /Skim coat/.test(seen) && /\$2\.10 \/ sq ft/.test(seen), seen.slice(0, 900));

const profiles = await sentTo(shop.page, 'company');
const company = profiles.at(-1)?.company ?? '';
const skim = (JSON.parse(company || '{}').prices?.rates ?? []).find((r) => r.item === 'Skim coat');
check('and it is kept with the business, so every later job is offered it',
  skim != null && skim.measure === 'wall face', JSON.stringify(skim));
check('with its price in minor units, never a float',
  skim != null && /^\d+$/.test(String(skim.cents?.$nm ?? '')), JSON.stringify(skim?.cents));
check('the rate book: no console or page errors', noise().length === 0, noise().join(' | '));
await shop.ctx.close();

/* ==========================================================================
   2. A room nobody has scoped is priced as it always was, and says so.
   ========================================================================== */

const { ctx, page } = await openAsApp({
  company,
  subscribed: true,
  room: kitchen,
  fileName: 'Kitchen 2026-08-27 0900',
});

await section(page, 'Takeoff');
const takeoff = page.locator('[data-panel="takeoff"]');
const asReplaced = await takeoff.innerText();

check('a room nobody has scoped says every surface is priced as replaced',
  /Everything in this room is priced as replaced/.test(asReplaced), asReplaced.slice(0, 500));
check('and offers somewhere to say what is actually being done',
  /Say what is actually being done/.test(asReplaced), asReplaced.slice(0, 500));

const wholeFace = quantityOf(asReplaced, 'Wall face');
const wholeFloor = quantityOf(asReplaced, 'Floor');
check('with the whole room’s wall face on it', wholeFace > 0, `${wholeFace}`);

await section(page, 'Price');
const pricedWhole = await page.locator('[data-panel="price"]').innerText();
const totalWhole = cash(/Total\n\$([\d,]+\.\d{2})/.exec(pricedWhole)?.[1] ?? '0');
check('and money against it', totalWhole > 0, `${totalWhole}`);

/* ==========================================================================
   3. Saying what is being done. The first tap must move nothing at all.
   ========================================================================== */

await section(page, 'Plan');
const wall = page.getByRole('button', { name: /^Wall wall-2,/ }).first();
await wall.focus();
await page.keyboard.press('Enter');
await page.waitForTimeout(300);

let panel = await page.locator('[data-panel="plan"]').innerText();
check('a wall opens with an area saying what is being done to it',
  /What is being done here/.test(panel), panel.slice(0, 900));
check('and it says the room is priced as a full replacement until somebody says otherwise',
  /priced as if it were being replaced/.test(panel), panel.slice(0, 1200));

await page.getByRole('button', { name: 'Say what is being done' }).first().click();
await page.waitForTimeout(400);

await section(page, 'Takeoff');
const scopedAll = await takeoff.innerText();
check('saying what is being done starts from everything, so nothing moves',
  quantityOf(scopedAll, 'Wall face') === wholeFace &&
    quantityOf(scopedAll, 'Floor') === wholeFloor,
  `face ${quantityOf(scopedAll, 'Wall face')} was ${wholeFace}; ` +
    `floor ${quantityOf(scopedAll, 'Floor')} was ${wholeFloor}`);
check('and the sheet now says it is counting only what is being done',
  /Counting only what is being done/.test(scopedAll), scopedAll.slice(0, 500));

await section(page, 'Price');
const pricedAll = await page.locator('[data-panel="price"]').innerText();
check('and the money has not moved either',
  Math.abs(cash(/Total\n\$([\d,]+\.\d{2})/.exec(pricedAll)?.[1] ?? '0') - totalWhole) < 0.005,
  `${cash(/Total\n\$([\d,]+\.\d{2})/.exec(pricedAll)?.[1] ?? '0')} vs ${totalWhole}`);

/* ==========================================================================
   4. Taking one wall out. The arithmetic is done here, off the figure the app
      printed beside the tick box, and compared with what the sheet does.
   ========================================================================== */

await section(page, 'Plan');
const faceBox = page.locator('input[aria-label="Wall face on wall-2"]');
const baseBox = page.locator('input[aria-label="Baseboard on wall-2"]');
check('the wall lists what can be done to it, ticked', await faceBox.isChecked());

const faceLabel = await page.locator('label:has(input[aria-label="Wall face on wall-2"])').innerText();
const thisWallFace = Number((/([\d,]+\.?\d*) sq ft/.exec(faceLabel) ?? [])[1]?.replace(/,/g, ''));
check('and shows the quantity the decision is about, with the rate beside it',
  thisWallFace > 0 && /\$3\.75 \/ sq ft/.test(faceLabel), faceLabel);

await faceBox.uncheck();
await page.waitForTimeout(400);
await section(page, 'Takeoff');
const oneOff = await takeoff.innerText();
check('unticking a wall takes exactly that wall’s face off the sheet',
  Math.abs(quantityOf(oneOff, 'Wall face') - (wholeFace - thisWallFace)) < 0.11,
  `${quantityOf(oneOff, 'Wall face')}, expected ${(wholeFace - thisWallFace).toFixed(1)}`);
check('and the floor is untouched by a decision about a wall',
  quantityOf(oneOff, 'Floor') === wholeFloor,
  `${quantityOf(oneOff, 'Floor')} vs ${wholeFloor}`);
check('and every line says which walls it came off',
  /wall-1/.test(oneOff) && !/Wall face[\s\S]{0,160}wall-2/.test(oneOff),
  oneOff.slice(0, 900));

/* ==========================================================================
   5. A wall left alone entirely. No line, not a zero line — and said out loud.
   ========================================================================== */

await section(page, 'Plan');
for (const label of ['Baseboard on wall-2', 'Doors on wall-2', 'Windows on wall-2',
  'Cased openings on wall-2', 'Skim coat on wall-2']) {
  const box = page.locator(`input[aria-label="${label}"]`);
  if ((await box.count()) === 0) continue;
  if (await box.isChecked()) await box.uncheck();
  await page.waitForTimeout(120);
}
await page.waitForTimeout(300);
const leftAlone = await page.locator('[data-panel="plan"]').innerText();
check('a wall with nothing on it says it is not on the sheet at all',
  /Nothing is being done to wall-2/.test(leftAlone), leftAlone.slice(0, 1400));

await section(page, 'Takeoff');
const withoutIt = await takeoff.innerText();
check('the takeoff names the wall that is being left alone',
  /Nothing is being done to[^.]*wall-2/.test(withoutIt), withoutIt.slice(0, 700));
check('and there is no zero anywhere on the sheet, because zero is a claim',
  !/(^|\n)\s*0(\.0+)? (sq ft|lf|ea)/.test(withoutIt), withoutIt.slice(0, 1200));

await section(page, 'Price');
const pricedLess = await page.locator('[data-panel="price"]').innerText();
const totalLess = cash(/Total\n\$([\d,]+\.\d{2})/.exec(pricedLess)?.[1] ?? '0');
check('the money came down by the work that came off, and not by more',
  totalLess < totalWhole && totalLess > 0,
  `${totalLess} of ${totalWhole}`);
check('and no line on the quote is priced at nothing',
  !/\$0\.00/.test(pricedLess), pricedLess.slice(0, 900));

/* ==========================================================================
   6. The invented item, on a wall, at a quantity the room measured.
   ========================================================================== */

await section(page, 'Plan');
// A different wall: the decisions above were about wall-2, and this one is
// about wall-1. Two walls, two independent decisions, which is the point.
await pick(page, /^Wall wall-1,/);
const skimBox = page.locator('input[aria-label="Skim coat on wall-1"]');
check('an item the contractor invented is offered on a wall', (await skimBox.count()) === 1);
const skimLabel = await page.locator('label:has(input[aria-label="Skim coat on wall-1"])').innerText();
const skimArea = Number((/([\d,]+\.?\d*) sq ft/.exec(skimLabel) ?? [])[1]?.replace(/,/g, ''));
check('measured off the wall it is picked on, not typed',
  skimArea > 0 && /\$2\.10 \/ sq ft/.test(skimLabel), skimLabel);

await skimBox.check();
await page.waitForTimeout(400);
await section(page, 'Takeoff');
const withSkim = await takeoff.innerText();
check('it reaches the takeoff at the quantity the wall measures',
  Math.abs(quantityOf(withSkim, 'Skim coat') - skimArea) < 0.11,
  `${quantityOf(withSkim, 'Skim coat')} vs ${skimArea}`);

await section(page, 'Price');
const withSkimPriced = await page.locator('[data-panel="price"]').innerText();
const skimLine = /Skim coat\n([\d,]+\.?\d*) sq ft at \$2\.10\n\$([\d,]+\.\d{2})/.exec(withSkimPriced);
check('and it is priced at the rate he typed, times the quantity the room measured',
  skimLine != null &&
    Math.abs(Number(skimLine[1].replace(/,/g, '')) * 2.1 - Number(skimLine[2].replace(/,/g, ''))) < 0.005,
  withSkimPriced.slice(0, 900));

/* ==========================================================================
   7. It is a record, not a display filter: it goes back to the app to be kept.
   ========================================================================== */

const saved = await sentTo(page, 'saved');
const last = JSON.parse(saved.at(-1)?.project ?? '{}');
check('what is being done is written back with the room, not held on a screen',
  last.extras?.scope != null && typeof last.extras.scope.setAt === 'string',
  JSON.stringify(last.extras?.scope ?? null).slice(0, 300));
check('and it records who decided it',
  typeof last.extras?.scope?.setBy === 'string' && last.extras.scope.setBy.length > 0,
  JSON.stringify(last.extras?.scope?.setBy));
check('with the wall that was left alone genuinely absent, not stored as empty',
  last.extras?.scope?.picked?.['wall:wall-2'] === undefined,
  JSON.stringify(Object.keys(last.extras?.scope?.picked ?? {})));

/* ==========================================================================
   8. And the way back. A contractor who scoped the wrong room must be able to
      put it back to the sheet he had before.
   ========================================================================== */

await section(page, 'Plan');
await page.getByRole('button', { name: 'Price it all again' }).first().click();
await page.waitForTimeout(400);
await section(page, 'Takeoff');
const backAgain = await takeoff.innerText();
check('pricing it all again puts every surface back',
  /Everything in this room is priced as replaced/.test(backAgain) &&
    quantityOf(backAgain, 'Wall face') === wholeFace,
  `${quantityOf(backAgain, 'Wall face')} vs ${wholeFace}`);

await section(page, 'Price');
const backPriced = await page.locator('[data-panel="price"]').innerText();
check('and the money is exactly what it was before anybody scoped anything',
  Math.abs(cash(/Total\n\$([\d,]+\.\d{2})/.exec(backPriced)?.[1] ?? '0') - totalWhole) < 0.005,
  `${cash(/Total\n\$([\d,]+\.\d{2})/.exec(backPriced)?.[1] ?? '0')} vs ${totalWhole}`);

check('what is being done: no console or page errors', noise().length === 0, noise().join(' | '));
await ctx.close();

process.exit(report('A23 — costing what is actually being done') === 0 ? 0 : 1);
