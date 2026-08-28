import { readFileSync } from 'node:fs';
import { check, HEIGHT, noise, openAsApp, pick, report, reportEvenIfItDies, section, sentTo, SP } from './lib.mjs';

// Say what was learned even if this part dies part way through.
reportEvenIfItDies('A45 — the five ways back off the sheet');

/**
 * The five controls on the sheet that nothing had ever pressed.
 *
 * `check-controls.py` names them: **Say what is actually being done** and
 * **Change it** on the takeoff, **Back to what the room measures** on the
 * quote, **Do the whole** on a wall, and **Copy the scope** on the restoration
 * sheet. Every one of them is a way back from a decision about money, and not
 * one of them had ever been driven.
 *
 * That is the exact state all four of this month's found-by-looking bugs were
 * in — a paywall nothing presented, a refusal 280 pixels above the button, a
 * photograph control inside a collapsed row, a highlight painted out by its own
 * doorways. Each worked. Nothing had ever asked for it by name, so nothing had
 * ever had the chance to notice.
 *
 * ## What is asked of them
 *
 * Not that they are in the DOM. Each check below states something that would be
 * false if the control were quietly broken, and the ones that matter here are
 * the ones about money and about quantity:
 *
 *   1. **Saying what is being done moves nobody's money.** The takeoff of a
 *      room nobody has scoped and the takeoff of the same room scoped as
 *      everything are the same sheet, and the quote off them is the same quote
 *      **to the cent**. If tapping that control quietly added or dropped a
 *      surface, the very first thing it did would be the thing nobody asked
 *      for.
 *   2. **The control goes somewhere.** Pressing it lands on the screen where
 *      the scoping is actually done, and the banner afterwards offers **Change
 *      it** in its place rather than offering both or neither.
 *   3. **"Do the whole" is exact.** A part typed against one wall moves the
 *      sheet and the money; pressing the way back returns both to what they
 *      were **to the cent and to the hundredth**, not to about what they were.
 *      And the way back is offered in the wall's own measured figure, so the
 *      number a person is going back to is on the button.
 *   4. **A refusal is where the eye already is.** Type more of a wall than the
 *      wall has and the sentence appears within a thumb's reach of the box,
 *      measured on the same screen at the same moment — never 280 px away.
 *   5. **"Back to what the room measures" gives back the measurement.** A typed
 *      quantity moves the total by exactly the rate times the difference,
 *      worked out here in integer cents; taking it off puts the total back
 *      exactly, and takes the note with it.
 *   6. **"Copy the scope" copies the scope, and not the takeoff.** The
 *      clipboard is read back and compared line by line with what the screen
 *      shows, and it must not contain a line off the room's own remodel sheet.
 *      Two payers, two sheets — a single sheet holding both is a sheet somebody
 *      bills the wrong party off.
 *
 * All of it at 430 by 800, which is a phone, and every control is measured for
 * whether a person could actually put a thumb on it rather than for whether it
 * is drawn.
 *
 * Nothing below imports anything from the app. Every string it looks for and
 * every figure it asserts is written out here, on Sam's own scan.
 */

const dining = JSON.parse(readFileSync(`${SP}/dining.json`, 'utf8'));

/** The rate book this part types, and prices everything against afterwards. */
const RATES = [
  ['Floor', 950n],
  ['Ceiling', 425n],
  ['Wall face', 375n],
  ['Baseboard', 600n],
  ['Doors', 30000n],
  ['Windows', 24000n],
];

/** The restoration book, kept apart from the remodel one exactly as the app does. */
const RESTORATION = [
  ['Remove wall board', 250n],
  ['Remove baseboard', 120n],
  ['Clean and treat the opened cavity', 340n],
  ['Seal the affected surface', 110n],
  ['Hang wall board', 420n],
  ['Tape and finish', 230n],
  ['Replace baseboard', 675n],
  ['Prime and paint the wall', 145n],
];

/** The part of wall-5 that is being done, in the sheet's own printed unit. */
const PART = '30';
/** What the baseboard is priced at instead, and why. */
const INSTEAD = '120';
const BECAUSE = 'full lengths, and the offcuts are not worth splicing';

/* ------------------------------------------------- what this side works out */

function dollars(cents) {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const grouped = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${grouped}.${(abs % 100n).toString().padStart(2, '0')}`;
}

function cents(text) {
  const m = /(-?)\$?([\d,]+)\.(\d\d)/.exec(String(text));
  if (!m) return null;
  const value = BigInt(m[2].replace(/,/g, '')) * 100n + BigInt(m[3]);
  return m[1] === '-' ? -value : value;
}

function hundredths(text) {
  const m = /^([\d,]+)(?:\.(\d{1,2}))?$/.exec(String(text).trim());
  if (!m) return null;
  return BigInt(m[1].replace(/,/g, '')) * 100n + BigInt((m[2] ?? '').padEnd(2, '0'));
}

/** Rate x quantity, rounded to the cent once, half away from zero. */
function lineTotal(rateCents, quantityHundredths) {
  const raw = rateCents * quantityHundredths;
  return raw < 0n ? (raw - 50n) / 100n : (raw + 50n) / 100n;
}

const said = (value) => JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? String(v) : v));

/** The quantity the takeoff is showing against one item, off its own line. */
function quantityOf(panel, item) {
  const line = new RegExp(
    `(?:^|\\n)${item}\\n[\\s\\S]{0,900}?\\n([\\d,]+(?:\\.\\d+)?) (?:sq ft|lf|ea)(?=\\n|$)`
  ).exec(panel);
  return line ? line[1].replace(/,/g, '') : null;
}

/** What one line on the quote is asking for: how much, at what, for how much. */
function pricedAt(panel, item) {
  const line = new RegExp(
    `(?:^|\\n)${item}\\n([\\d,]+\\.?\\d*) (?:sq ft|lf|ea) at \\$([\\d,.]+)\\n(\\$[\\d,]+\\.\\d\\d)`
  ).exec(panel);
  return line
    ? { quantity: line[1].replace(/,/g, ''), rate: cents(`$${line[2]}`), total: cents(line[3]) }
    : null;
}

/** The one figure at the bottom of the quote. */
function totalOf(panel) {
  return cents((/(?:^|\n)Total\n(\$[\d,]+\.\d\d)/.exec(panel) ?? [])[1] ?? '');
}

/**
 * Where a control is, and whether a person could put a thumb on it.
 *
 * `isVisible()` is true of a button four thousand pixels below the fold, and a
 * box inside the window is still unusable if a bar is painted over it — which
 * is the shape of every one of this month's four bugs. So the control is
 * scrolled to, the whole of it has to be inside a phone-sized window, and the
 * point in the middle of it is hit-tested: the answer has to be the control.
 */
async function reachable(control) {
  await control.scrollIntoViewIfNeeded().catch(() => {});
  const box = await control.boundingBox();
  if (box === null) return { ok: false, said: 'it is not drawn at all' };
  const whole = box.y >= 0 && box.y + box.height <= HEIGHT;
  const mine = await control.evaluate((el) => {
    const at = el.getBoundingClientRect();
    const hit = document.elementFromPoint(at.x + at.width / 2, at.y + at.height / 2);
    // `el.contains(hit)` and nothing wider. A control whose middle belongs to
    // its own `<span>` is fine; one whose middle belongs to the section AROUND
    // it is a control the point is passing straight through, which is what a
    // dead button and a covered one both look like from here.
    return hit !== null && (el === hit || el.contains(hit));
  });
  return {
    box,
    ok: whole && mine,
    said:
      `top ${Math.round(box.y)}, bottom ${Math.round(box.y + box.height)} of ${HEIGHT}, ` +
      (mine ? 'and the middle of it belongs to it' : 'but something else is painted over its middle'),
  };
}

/**
 * Every console error either of the two browsers this part opens has heard.
 *
 * `noise()` is reset by each `open`, so asking it once at the end asks about
 * the last browser only — and the rate book is typed in the first one. A stray
 * error there would never have been heard.
 */
const heard = [];
async function shutDown(one) {
  heard.push(...noise());
  await one.close().catch(() => {});
}

/**
 * Give up, out loud, with the checks that already ran still printed.
 *
 * A part that throws says nothing about the checks behind the throw, and a
 * control wired to nothing is exactly the shape that makes the next line throw.
 * So the structural gates stop here instead. a26 and a41 guard the same way.
 */
async function stop(why, closing) {
  check('there is nothing more of the sheet to drive without it', false, why);
  for (const one of closing) await shutDown(one);
  check('the sheet: no console or page errors', heard.length === 0, heard.join(' | '));
  report('A45 — the five ways back off the sheet');
  process.exit(1);
}

/** Which panel a person is looking at. A control that goes nowhere is the bug. */
const showing = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-panel]')]
      .filter((el) => !el.hasAttribute('hidden'))
      .map((el) => el.dataset.panel)
  );

/* ==========================================================================
   0. His rate book, then his own scan, exactly as the app hands one over.
   ========================================================================== */

const shop = await openAsApp({ subscribed: true }, {});
await shop.page.goto(shop.page.url().replace(/#.*$/, '') + '#business', { waitUntil: 'networkidle' });
await shop.page.waitForTimeout(700);
for (const [item, rate] of RATES) {
  const box = shop.page.getByLabel(`${item} rate`);
  await box.fill((Number(rate) / 100).toFixed(2));
  await box.blur();
  await shop.page.waitForTimeout(80);
}
const profiles = await sentTo(shop.page, 'company');
const company = profiles.at(-1)?.company ?? '';
check('the rates are typed before anything is priced', /Wall face/.test(company), company.slice(0, 200));
await shutDown(shop.ctx);

const { ctx, page } = await openAsApp({
  company,
  subscribed: true,
  room: dining,
  fileName: 'Dining 2026-08-28 0900',
});
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);

await section(page, 'Plan');
const walls = await page.getByRole('button', { name: /^Wall / }).count();
check('his own scan opens, with all of its walls', walls >= 9, `${walls} walls`);
if (walls < 9) {
  await stop('there is no room here to say anything about', [ctx]);
}

/* ==========================================================================
   1. Say what is actually being done — and the money that must not move.
   ========================================================================== */

await section(page, 'Takeoff');
const takeoff = page.locator('[data-panel="takeoff"]');
let sheet = await takeoff.innerText();
check('a room nobody has scoped says so, and says everything is priced as replaced',
  /Everything in this room is priced as replaced/.test(sheet), sheet.slice(0, 400));

const wholeFace = quantityOf(sheet, 'Wall face');
const wholeBase = quantityOf(sheet, 'Baseboard');
const wholeFloor = quantityOf(sheet, 'Floor');

await section(page, 'Price');
let quote = await page.locator('[data-panel="price"]').innerText();
const totalUnscoped = totalOf(quote);
const faceUnscoped = pricedAt(quote, 'Wall face');
check('the quote is the rates I typed times the quantities the room measured',
  faceUnscoped !== null
    && faceUnscoped.rate === 375n
    && faceUnscoped.total === lineTotal(375n, hundredths(faceUnscoped.quantity)),
  said(faceUnscoped));
check('and there is a total on it to compare against afterwards',
  totalUnscoped !== null && totalUnscoped > 0n, said(totalUnscoped));

await section(page, 'Takeoff');
const sayWhat = takeoff.getByRole('button', { name: 'Say what is actually being done' });
check('the way to say what is actually being done is on the sheet that needs it',
  (await sayWhat.count()) === 1, `${await sayWhat.count()} controls`);
// Counted before it is measured: `boundingBox` on a control that is not there
// waits and then throws, and a control that is not there is the finding.
if ((await sayWhat.count()) !== 1) {
  await stop('a sheet with no way to scope it cannot be scoped', [ctx]);
}
const sayAt = await reachable(sayWhat);
check('and a person can put a thumb on the whole of it, at a phone height', sayAt.ok, sayAt.said);

await sayWhat.click();
await page.waitForTimeout(600);
check('pressing it goes somewhere: the screen where what is being done is decided',
  (await showing(page)).includes('room'), (await showing(page)).join(', '));
// Walked to by hand from here, so that a control which goes nowhere is one red
// line rather than the end of the run.
await section(page, 'Room');
const room = page.locator('[data-panel="room"]');
check('and that screen is the one that asks the question',
  /What is being done here/.test(await room.innerText()), (await room.innerText()).slice(0, 600));

await room.getByRole('button', { name: 'Say what is being done', exact: true }).click();
await page.waitForTimeout(600);

await section(page, 'Takeoff');
sheet = await takeoff.innerText();
check('the sheet is now a scoped one, and says what it is counting',
  /Counting only what is being done/.test(sheet)
    && !/Everything in this room is priced as replaced/.test(sheet),
  sheet.slice(0, 500));
check('every quantity on it is the one that was there before, to the hundredth',
  quantityOf(sheet, 'Wall face') === wholeFace
    && quantityOf(sheet, 'Baseboard') === wholeBase
    && quantityOf(sheet, 'Floor') === wholeFloor,
  `face ${quantityOf(sheet, 'Wall face')} was ${wholeFace}; ` +
    `base ${quantityOf(sheet, 'Baseboard')} was ${wholeBase}; ` +
    `floor ${quantityOf(sheet, 'Floor')} was ${wholeFloor}`);

await section(page, 'Price');
quote = await page.locator('[data-panel="price"]').innerText();
const totalScoped = totalOf(quote);
check('and the money is the same money, to the cent — nothing was added and nothing dropped',
  totalScoped === totalUnscoped,
  `${dollars(totalScoped ?? 0n)} was ${dollars(totalUnscoped ?? 0n)}`);

/* ==========================================================================
   2. Change it — in its place, not beside it.
   ========================================================================== */

await section(page, 'Takeoff');
const changeIt = takeoff.getByRole('button', { name: 'Change it', exact: true });
check('the way in is now Change it, and the first one is gone rather than doubled up',
  (await changeIt.count()) === 1 && (await sayWhat.count()) === 0,
  `${await changeIt.count()} Change it, ${await sayWhat.count()} Say what is actually being done`);
if ((await changeIt.count()) === 1) {
  const changeAt = await reachable(changeIt);
  check('and it too is whole on the screen with nothing over it', changeAt.ok, changeAt.said);
  await changeIt.click();
  await page.waitForTimeout(600);
  check('and it goes to the same place, which is the screen that can change it',
    (await showing(page)).includes('room'), (await showing(page)).join(', '));
} else {
  check('and it too is whole on the screen with nothing over it', false, 'there is no Change it');
  check('and it goes to the same place, which is the screen that can change it', false,
    'there is no Change it to press');
}

/* ==========================================================================
   3. Do the whole — the way back from a figure somebody typed.
   ========================================================================== */

// The wall already carries its tick list, because the room has a scope on it
// now. That is the point of the control pressed two sections up.
await section(page, 'Plan');
await pick(page, /^Wall wall-5,/);
await page.waitForTimeout(500);

const faceTick = page.locator('label:has(input[aria-label="Wall face on wall-5"])');
const howMuch = page.locator('input[aria-label="How much of it? — Wall face on wall-5"]');
check('the wall’s face is on the tick list, with somewhere to say how much of it is being done',
  (await faceTick.count()) === 1 && (await howMuch.count()) === 1,
  `${await faceTick.count()} lines, ${await howMuch.count()} boxes`);
if ((await faceTick.count()) !== 1 || (await howMuch.count()) !== 1) {
  await stop('a wall with no wall face on it has no part of it to type', [ctx]);
}

const faceLabel = await faceTick.innerText();
const wallFaceHere = (/([\d,]+\.?\d*) sq ft/.exec(faceLabel) ?? [])[1]?.replace(/,/g, '');
check('the wall says what its face measures, before anything is typed over it',
  wallFaceHere !== undefined && hundredths(wallFaceHere) > 0n, faceLabel);
if (wallFaceHere === undefined || hundredths(wallFaceHere) <= 0n) {
  await stop('nothing can be said about part of a wall that does not say what it measures', [ctx]);
}

await howMuch.fill(PART);
await howMuch.blur();
await page.waitForTimeout(500);

await section(page, 'Takeoff');
const partedFace = quantityOf(await takeoff.innerText(), 'Wall face');
check('typing a part takes it off the sheet',
  partedFace !== wholeFace && hundredths(partedFace) < hundredths(wholeFace),
  `${partedFace} was ${wholeFace}`);

await section(page, 'Price');
quote = await page.locator('[data-panel="price"]').innerText();
const facePart = pricedAt(quote, 'Wall face');
check('and the money on that line is still the rate times what the sheet now says',
  facePart !== null && facePart.total === lineTotal(375n, hundredths(facePart.quantity)),
  said(facePart));

/* ------------------------------------- the refusal, where the eye already is */

const over = hundredths(wallFaceHere) + 1000n;
const overshoot = `${over / 100n}.${String(over % 100n).padStart(2, '0')}`;
await section(page, 'Plan');
await howMuch.fill(overshoot);
await howMuch.blur();
await page.waitForTimeout(500);

const refusal = page.locator('li:has(input[aria-label="Wall face on wall-5"])').getByRole('status');
const refused = (await refusal.count()) >= 1 ? await refusal.first().innerText() : '';
check('more of a wall than the wall has is refused in a sentence, with both figures',
  new RegExp(`wall-5 has ${wallFaceHere} sq ft of wall face on it`).test(refused),
  refused === '' ? 'nothing was said at all' : refused);

// Both boxes read here, together. A distance between a stale measurement and a
// fresh one is not a distance on anybody's screen.
const boxNow = await howMuch.boundingBox();
const saidNow = refused === '' ? null : await refusal.first().boundingBox();
const gap = boxNow && saidNow ? Math.round(saidNow.y - (boxNow.y + boxNow.height)) : null;
check('and it is said where the person is looking, not 280 px away from the box they typed in',
  gap !== null && gap >= 0 && gap < 120,
  gap === null
    ? 'there was no refusal on the screen to measure'
    : `${gap} px below the box (box ${JSON.stringify(boxNow)}, said ${JSON.stringify(saidNow)})`);

await section(page, 'Takeoff');
check('nothing was clamped: the sheet still carries the part he typed, not the overshoot',
  quantityOf(await takeoff.innerText(), 'Wall face') === partedFace,
  `${quantityOf(await takeoff.innerText(), 'Wall face')} was ${partedFace}`);

/* ------------------------------------------------- and the way back is exact */

await section(page, 'Plan');
await howMuch.fill(PART);
await howMuch.blur();
await page.waitForTimeout(500);

const wholeAgain = page.getByRole('button', { name: /^Do the whole / }).first();
check('the way back to all of it is offered on the line it is on',
  (await wholeAgain.count()) === 1, `${await wholeAgain.count()} controls`);
if ((await wholeAgain.count()) !== 1) {
  await stop('a figure he typed with no way back is the bug this control is', [ctx]);
}
const backName = await wholeAgain.getAttribute('aria-label');
check('and it is offered in the wall’s own measured figure, so the number is on the button',
  backName === `Do the whole ${wallFaceHere} sq ft — Wall face on wall-5`, String(backName));
const backAt = await reachable(wholeAgain);
check('and a person can put a thumb on the whole of it', backAt.ok, backAt.said);

await wholeAgain.click();
await page.waitForTimeout(600);

check('pressing it empties the box rather than leaving his figure in it to be typed over',
  (await howMuch.inputValue()) === '', await howMuch.inputValue());
const rowNow = await page.locator('li:has(input[aria-label="Wall face on wall-5"])').innerText();
check('and the line goes back to saying it is all of it, as the room measures it',
  new RegExp(`All ${wallFaceHere} sq ft of it, as the room measures it`).test(rowNow)
    && !/your figure, not a measurement/.test(rowNow),
  rowNow.slice(0, 500));

await section(page, 'Takeoff');
sheet = await takeoff.innerText();
check('the sheet is back to the whole of the room, to the hundredth',
  quantityOf(sheet, 'Wall face') === wholeFace, `${quantityOf(sheet, 'Wall face')} was ${wholeFace}`);
check('and nothing says a figure of his is on it any more',
  !/Your own figure, not a measurement/.test(sheet), sheet.slice(0, 1600));

await section(page, 'Price');
quote = await page.locator('[data-panel="price"]').innerText();
check('and the money is back to the cent it was before he typed anything',
  totalOf(quote) === totalUnscoped,
  `${dollars(totalOf(quote) ?? 0n)} was ${dollars(totalUnscoped ?? 0n)}`);

/* ==========================================================================
   4. Back to what the room measures — the way back from a typed quantity.
   ========================================================================== */

const pricePanel = page.locator('[data-panel="price"]');
const baseBefore = pricedAt(await pricePanel.innerText(), 'Baseboard');
check('there is a baseboard line to price a different number of, with its rate on it',
  baseBefore !== null && baseBefore.rate === 600n, said(baseBefore));
if (baseBefore === null) {
  await stop('a line that does not say what it is charged at cannot be checked against a rate', [ctx]);
}

// The baseboard's own row of the priced list, rather than the fourth button
// down: a script that counts buttons keeps passing while the sheet reorders
// itself, and what it would then be typing over is a different line's money.
await pricePanel
  .locator('dl[data-tour="priced-lines"] > div', { hasText: 'Baseboard' })
  .getByRole('button', { name: 'Price a different number' })
  .first()
  .click();
await page.waitForTimeout(400);
await page.getByLabel('Price this many lf of Baseboard').fill(INSTEAD);
await page.getByLabel('Why Baseboard is a different number').fill(BECAUSE);
await page.getByRole('button', { name: 'Price that', exact: true }).click();
await page.waitForTimeout(600);

quote = await pricePanel.innerText();
const baseTyped = pricedAt(quote, 'Baseboard');
const totalTyped = totalOf(quote);
check('the line is priced at the number he typed, at the rate he set',
  baseTyped !== null
    && baseTyped.quantity === INSTEAD
    && baseTyped.total === lineTotal(600n, hundredths(INSTEAD)),
  said(baseTyped));
check('and the total moved by exactly the rate times the difference, worked out here',
  totalTyped !== null && totalUnscoped !== null
    && totalTyped - totalUnscoped
      === lineTotal(600n, hundredths(INSTEAD)) - lineTotal(600n, hundredths(baseBefore.quantity)),
  `moved ${dollars((totalTyped ?? 0n) - (totalUnscoped ?? 0n))}, expected ` +
    `${dollars(lineTotal(600n, hundredths(INSTEAD)) - lineTotal(600n, hundredths(baseBefore.quantity)))}`);
check('and the sheet says both numbers and the reason, rather than only the new one',
  quote.includes(baseBefore.quantity) && quote.includes(BECAUSE), quote.slice(0, 1400));

const back = pricePanel.getByRole('button', { name: 'Back to what the room measures' });
check('the way back to the measurement is offered on the line that lost it',
  (await back.count()) === 1, `${await back.count()} controls`);
if ((await back.count()) !== 1) {
  await stop('a typed quantity with no way back is the bug this control is', [ctx]);
}
const backHere = await reachable(back);
check('and it is whole on the screen with nothing painted over it', backHere.ok, backHere.said);

await back.click();
await page.waitForTimeout(600);

quote = await pricePanel.innerText();
const baseBack = pricedAt(quote, 'Baseboard');
check('taking it off gives the room’s own figure back, to the hundredth',
  baseBack !== null && baseBack.quantity === baseBefore.quantity, said(baseBack));
check('and the money with it, to the cent',
  baseBack !== null && baseBack.total === baseBefore.total && totalOf(quote) === totalUnscoped,
  `line ${dollars(baseBack?.total ?? 0n)} was ${dollars(baseBefore.total)}; ` +
    `total ${dollars(totalOf(quote) ?? 0n)} was ${dollars(totalUnscoped ?? 0n)}`);
check('and the reason goes with it rather than sitting over a number nobody changed',
  !quote.includes(BECAUSE), quote.slice(0, 1200));

/* ==========================================================================
   5. Copy the scope — the other sheet, for the other payer.
   ========================================================================== */

await section(page, 'Insurance');
await page.locator('[data-panel="claim"]').getByRole('button', { name: 'Turn it on' }).click();
await page.waitForTimeout(500);

// wall-1 has no door and no window anywhere in it, which is why the mark is
// there: ten feet of it, a foot and a half high, is 15.0 square feet and
// nothing is deducted. That is arithmetic anybody can do on an envelope.
await section(page, 'Plan');
await pick(page, /^Wall wall-1,/);
await page.getByRole('button', { name: '+ damaged area', exact: true }).first().click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Mould', exact: true }).first().click();
await page.getByLabel('What is it?').fill('mould behind the skirting where the pipe ran');
await page.getByLabel(/^How far from the corner it starts/).fill('0');
await page.getByLabel(/^How wide it is/).fill('10');
await page.getByLabel(/^How high up the wall it goes/).fill(`1' 6"`);
await page.getByRole('button', { name: 'Mark it' }).click();
await page.waitForTimeout(700);

await section(page, 'Insurance');
const damage = page
  .locator('section', { has: page.getByRole('heading', { name: 'What the damage takes' }) })
  .first();
check('a marked room has a restoration sheet of its own', (await damage.count()) === 1);

if ((await damage.count()) !== 1) {
  await stop('a marked room with no restoration sheet has nothing to copy', [ctx]);
}
await damage.getByRole('button', { name: 'Your rates' }).click();
await page.waitForTimeout(400);
for (const [item, rate] of RESTORATION) {
  const box = page.getByLabel(`${item} rate`);
  await box.fill((Number(rate) / 100).toFixed(2));
  await box.blur();
  await page.waitForTimeout(60);
}
await page.getByRole('button', { name: 'Done', exact: true }).click();
await page.waitForTimeout(600);

const restoration = await damage.innerText();

/**
 * The priced lines the restoration sheet shows: what, how much, and the money.
 *
 * Read off the rendered text rather than out of the app's own state, because
 * what is being checked is what a person is looking at.
 */
const scopeLines = [...restoration.matchAll(
  /(?:^|\n)(.+)\n([\d,]+\.?\d*) (sq ft|lf)(\$[\d,]+\.\d\d)(?=\n)/g
)].map((m) => ({
  what: m[1].trim(),
  quantity: m[2].replace(/,/g, ''),
  unit: m[3],
  total: cents(m[4]),
}));
const rateOf = Object.fromEntries(RESTORATION);

check('every line on it is priced', scopeLines.length >= 6,
  `${scopeLines.length} lines: ${restoration.slice(0, 1200)}`);
const wrong = scopeLines.filter(
  (l) => rateOf[l.what] === undefined || l.total !== lineTotal(rateOf[l.what], hundredths(l.quantity))
);
// The count as well as the disagreements: `every one of nothing` is true, and a
// reader that had stopped reading would report the sheet as perfect.
check('and every one of them is the restoration rate I typed times what the mark measures',
  scopeLines.length >= 6 && wrong.length === 0,
  wrong
    .map((l) => `${l.what}: ${l.quantity} at ${rateOf[l.what]} should be ` +
      `${dollars(lineTotal(rateOf[l.what] ?? 0n, hundredths(l.quantity)))}, showed ${dollars(l.total)}`)
    .join(' | '));

const scopeTotal = cents((/(?:^|\n)Total\n(\$[\d,]+\.\d\d)/.exec(restoration) ?? [])[1] ?? '');
const addedUp = scopeLines.reduce((sum, l) => sum + l.total, 0n);
check('and the total is those lines added up and nothing else, to the cent',
  scopeTotal === addedUp, `${dollars(scopeTotal ?? 0n)}, the lines add to ${dollars(addedUp)}`);

// The mark is 10 ft along a wall with nothing in it, 1'6" high: 15.0 sq ft of
// board and 10.00 ft of base. Worked out here, not read off the app.
const board = scopeLines.find((l) => l.what === 'Remove wall board');
const base = scopeLines.find((l) => l.what === 'Remove baseboard');
check('the board that comes out is ten feet by a foot and a half of it',
  board?.quantity === '15.0' && board.total === lineTotal(250n, 1500n), said(board));
check('and the base is the ten feet the damage runs along the floor',
  base?.quantity === '10.00' && base.total === lineTotal(120n, 1000n), said(base));

/* ------------------------------------------------------ and onto a clipboard */

const SENTINEL = 'nothing has copied anything yet';
await page.evaluate((mark) => navigator.clipboard.writeText(mark), SENTINEL);
check('the clipboard holds nothing of ours before the button is pressed',
  (await page.evaluate(() => navigator.clipboard.readText())) === SENTINEL,
  'the sentinel did not go onto the clipboard, so nothing below proves anything');

const copyScope = damage.getByRole('button', { name: 'Copy the scope' });
check('there is exactly one control that copies the scope',
  (await copyScope.count()) === 1, `${await copyScope.count()} controls`);
if ((await copyScope.count()) !== 1) {
  await stop('there is no way to get the scope out of the app', [ctx]);
}
const copyAt = await reachable(copyScope);
check('and a person can put a thumb on the whole of it, at a phone height', copyAt.ok, copyAt.said);
check('and it is big enough to hit with a thumb in a cold basement',
  copyAt.box !== undefined && copyAt.box.height >= 44,
  copyAt.box ? `${Math.round(copyAt.box.height)} px tall` : 'it is not drawn at all');

await copyScope.click();
await page.waitForTimeout(500);

const copied = (await page.evaluate(() => navigator.clipboard.readText())).trim();
check('pressing it puts something on the clipboard',
  copied !== SENTINEL && copied !== '', copied.slice(0, 200));

const missing = scopeLines.filter(
  (l) => !new RegExp(`${l.what.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+${l.quantity} ${l.unit}`).test(copied)
);
check('and what it puts there is every line on the screen, with the quantity beside it',
  scopeLines.length >= 6 && missing.length === 0,
  missing.map((l) => `${l.what} ${l.quantity} ${l.unit}`).join(' | ') + ` — ${copied.slice(0, 600)}`);
check('it says out loud that it is not the room’s takeoff, on the sheet that leaves the app',
  /It is NOT the room’s takeoff/.test(copied), copied.slice(0, 900));
check('and no line off the room’s own remodel sheet is on it — two payers, two sheets',
  !/(?:^|\n)Wall face\b/m.test(copied)
    && !/(?:^|\n)Ceiling\b/m.test(copied)
    && !/(?:^|\n)Floor\b/m.test(copied),
  copied.slice(0, 900));
check('and it carries how far the app will stand behind the numbers on it',
  /not checked|Measured/i.test(copied), copied.slice(-300));

// The confirmation, where the button was pressed. Both boxes read here,
// together, for the reason a41 gives: a distance between a stale measurement
// and a fresh one is not a distance on anybody's screen.
const toldIt = damage.getByText('The scope is on the clipboard.', { exact: true });
check('a copy that worked says so, rather than leaving somebody pressing again',
  (await toldIt.count()) === 1, `${await toldIt.count()} messages`);
const pressed = await copyScope.boundingBox();
const answer = (await toldIt.count()) === 0 ? null : await toldIt.first().boundingBox();
const apart = pressed && answer ? Math.round(answer.y - (pressed.y + pressed.height)) : null;
check('and it says it beside the button that was pressed, not 280 px away from it',
  apart !== null && apart >= 0 && apart < 120,
  apart === null
    ? 'there was nothing said on the screen to measure'
    : `${apart} px below the button (button ${JSON.stringify(pressed)}, said ${JSON.stringify(answer)})`);

await shutDown(ctx);
check('the sheet: no console or page errors', heard.length === 0, heard.join(' | '));

process.exit(report('A45 — the five ways back off the sheet') === 0 ? 0 : 1);
