import { readFileSync } from 'node:fs';
import { check, noise, openAsApp, pick, report, section, sentTo, SP } from './lib.mjs';

/**
 * How much of a surface is being done, driven through the real app.
 *
 * > "I LOVE THE OPTION TO SELECT WHAT IS BEING DONE ON THE WALL, BUT SHOULD
 * >  ALSO BE ABLE TO PUT IN HOW MUCH OF THAT WALL NEEDS REPLACING (GET TO
 * >  CHOOSE THE EACHES)"
 *
 * A tick said "all of it" and there was nothing else it could say. Most of a
 * remodel is not all of it, and a sheet that can only say all-or-nothing is a
 * sheet a contractor corrects in a spreadsheet.
 *
 * ## Every figure here is worked out on this side
 *
 * The app is asked for the numbers it printed — the area beside a tick box, the
 * rate beside it, the quantity on the takeoff, the money on the quote — and
 * every expected figure below is computed here, in integer cents, from those.
 * Nothing is read back out of the thing being tested and compared with itself.
 * The failure this feature can produce is a quote that adds up perfectly and is
 * for the wrong amount of work, and a screen that agrees with itself cannot see
 * it.
 *
 * ## And on Sam's own scan
 *
 * `dining.json`: eleven walls, three doors, three windows, an outline that is
 * not a rectangle and two sides with nothing built across them. wall-5 in it is
 * the wall from his own complaint — 84.4 sq ft of face, 10.13 lf of base, one
 * door.
 *
 * Five properties, in the order they would break:
 *
 *   1. A ticked line offers a figure, and the room's own measurement never
 *      leaves the screen beside it.
 *   2. Typing one moves the sheet by exactly that part and moves the money by
 *      exactly the rate times it — and leaves every other line alone, to the
 *      cent.
 *   3. A part bigger than the wall is refused in a sentence, and nothing moves.
 *   4. The eaches can be chosen: one window of the two in a wall.
 *   5. It is a record. It goes back to the app as an exact integer, never a
 *      float, and it is never presented as something the room measured.
 *
 * Then the other half of what Sam said, on the same wall:
 *
 * > "'FROM' 'TO' 'UPTO' MAKES NO SENSE MAKE IT EASY AND UNDERSTANDABLE."
 */

const dining = JSON.parse(readFileSync(`${SP}/dining.json`, 'utf8'));

const NM_PER_FOOT = 304800000n;

const RATES = [
  ['Floor rate', '9.50'],
  ['Ceiling rate', '4.25'],
  ['Wall face rate', '3.75'],
  ['Baseboard rate', '6.00'],
  ['Windows rate', '240.00'],
];

/** A printed money figure as whole cents, exactly. No floats anywhere here. */
function cents(text) {
  const m = /(-?)\$?([\d,]+)\.(\d\d)/.exec(String(text));
  if (!m) return null;
  const value = BigInt(m[2].replace(/,/g, '')) * 100n + BigInt(m[3]);
  return m[1] === '-' ? -value : value;
}

/** A printed quantity as hundredths, exactly — the same shape `quote` parses. */
function hundredths(text) {
  const m = /^([\d,]+)(?:\.(\d{1,2}))?$/.exec(String(text).trim());
  if (!m) return null;
  const fraction = (m[2] ?? '').padEnd(2, '0');
  return BigInt(m[1].replace(/,/g, '')) * 100n + BigInt(fraction);
}

/** Rate x quantity, rounded to the cent once, half away from zero. As `quote`. */
function lineTotal(rateCents, quantityHundredths) {
  const raw = rateCents * quantityHundredths;
  return raw < 0n ? (raw - 50n) / 100n : (raw + 50n) / 100n;
}

/** Anything, as a string a failure detail can print — bigints included. */
const said = (value) => JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? String(v) : v));

/**
 * The quantity the takeoff screen is showing against one item.
 *
 * The quantity is on a line of its own, under the item's name and its workings,
 * and it is pinned to that rather than to "the first number after the name" —
 * which is what A23's own reader does and is exactly what a typed figure breaks:
 * the workings on a parted line read "wall-5 30.0 of 84.4 sq ft", so the first
 * number-and-unit after the name is the wall's measurement rather than the
 * sheet's total. Reading that one and calling it the quantity is how a check
 * passes on a sheet that is wrong.
 */
function quantityOf(panel, item) {
  const line = new RegExp(
    `(?:^|\\n)${item}\\n[\\s\\S]{0,900}?\\n([\\d,]+(?:\\.\\d+)?) (?:sq ft|lf|ea)(?=\\n|$)`
  ).exec(panel);
  return line ? line[1].replace(/,/g, '') : null;
}

/** What one line on the quote is asking for, in whole cents. */
function pricedAt(panel, item) {
  const line = new RegExp(`(?:^|\\n)${item}\\n([\\d,]+\\.?\\d*) (?:sq ft|lf|ea) at \\$[\\d,.]+\\n(\\$[\\d,]+\\.\\d\\d)`).exec(panel);
  return line ? { quantity: line[1].replace(/,/g, ''), total: cents(line[2]) } : null;
}

/* ==========================================================================
   0. His rate book. Every figure below is the rate he typed times a quantity
      the room measured or a quantity he typed, and both have to be real.
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
const profiles = await sentTo(shop.page, 'company');
const company = profiles.at(-1)?.company ?? '';
check('the rates are set before anything is priced', /Wall face/.test(company), company.slice(0, 200));
await shop.ctx.close();

const { ctx, page } = await openAsApp({
  company,
  subscribed: true,
  room: dining,
  fileName: 'Dining 2026-08-28 0900',
});

await section(page, 'Plan');
const walls = await page.getByRole('button', { name: /^Wall / }).count();
check('his own scan opens, with all of its walls', walls >= 9, `${walls} walls`);

await pick(page, /^Wall wall-5,/);
await page.getByRole('button', { name: 'Say what is being done' }).first().click();
await page.waitForTimeout(400);

/* ==========================================================================
   1. The figure is offered, and the room's own measurement stays beside it.
   ========================================================================== */

const faceRow = page.locator('li:has(input[aria-label="Wall face on wall-5"])');
const faceLabel = await page.locator('label:has(input[aria-label="Wall face on wall-5"])').innerText();
const wallFaceHere = (/([\d,]+\.?\d*) sq ft/.exec(faceLabel) ?? [])[1]?.replace(/,/g, '');
const faceRateText = (/\$([\d,]+\.\d\d) \/ sq ft/.exec(faceLabel) ?? [])[1];
const faceRate = cents(faceRateText);
check('the wall says what it measures and what it earns',
  hundredths(wallFaceHere) > 0n && faceRate === 375n, `${wallFaceHere} sq ft at ${faceRateText}`);

const howMuch = page.locator('input[aria-label="How much of it? — Wall face on wall-5"]');
check('a ticked line offers somewhere to say how much of it is being done',
  (await howMuch.count()) === 1, `${await howMuch.count()} boxes`);

let rowText = await faceRow.innerText();
check('and it says, before anything is typed, that it is all of it as measured',
  new RegExp(`All ${wallFaceHere} sq ft of it, as the room measures it`).test(rowText), rowText);

// A wall with none of something on it is not offered a figure: the honest
// answer to "how many of them" there is not a number.
const noWindows = page.locator('input[aria-label="How much of it? — Windows on wall-5"]');
check('an item there is none of on this wall is offered no figure at all',
  (await noWindows.count()) === 0 && /none of this on wall-5/.test(await page.locator('[data-panel="plan"]').innerText()),
  `${await noWindows.count()} boxes`);

/* ==========================================================================
   2. Typing a part, on a room where everything is ticked. The rest of the
      sheet must not move at all, and the money must be the rate he typed
      times the quantity the sheet is showing — both worked out here.
   ========================================================================== */

await section(page, 'Takeoff');
const takeoff = page.locator('[data-panel="takeoff"]');
const wholeSheet = await takeoff.innerText();
const wholeFace = quantityOf(wholeSheet, 'Wall face');
const wholeBase = quantityOf(wholeSheet, 'Baseboard');
const wholeFloor = quantityOf(wholeSheet, 'Floor');

await section(page, 'Price');
const wholePrice = await page.locator('[data-panel="price"]').innerText();
const faceBefore = pricedAt(wholePrice, 'Wall face');
const baseBefore = pricedAt(wholePrice, 'Baseboard');
check('the quote prices the whole room’s wall face at the rate he typed',
  faceBefore != null && faceBefore.total === lineTotal(375n, hundredths(faceBefore.quantity)),
  said(faceBefore));

const PART = '30';
await section(page, 'Plan');
await howMuch.fill(PART);
await howMuch.blur();
await page.waitForTimeout(400);

rowText = await faceRow.innerText();
check('the typed figure is named as his, and the measured one is still there beside it',
  new RegExp(`30 sq ft of the ${wallFaceHere} sq ft wall-5 measures — your figure, not a measurement`)
    .test(rowText), rowText);
check('and the way back to the whole of it is offered in the wall’s own figure',
  new RegExp(`Do the whole ${wallFaceHere} sq ft`).test(rowText), rowText);

await section(page, 'Takeoff');
const partSheet = await takeoff.innerText();
const partFace = quantityOf(partSheet, 'Wall face');

// Worked out here: the room's whole wall face, less what wall-5 measures, plus
// the thirty he typed — in hundredths, from the strings the app printed.
//
// Fifteen hundredths of tolerance, and it is arithmetic rather than slack.
// Three printed figures go into that sum and each was rounded to the tenth, so
// the reconstruction can be a tenth and a half out from a sheet that is exactly
// right. The part of this that IS exact is proved below, on a sheet where
// wall-5 is the only wall on the line and no rounding can hide in the total.
const expectedFace = hundredths(wholeFace) - hundredths(wallFaceHere) + hundredths(PART);
const outBy = hundredths(partFace) - expectedFace;
check('the sheet counts the part he typed and the whole of every other wall',
  outBy <= 15n && outBy >= -15n,
  `${partFace}, expected about ${wholeFace} - ${wallFaceHere} + ${PART}, out by ${outBy}`);
check('and the baseboard and the floor, which nobody said anything about, have not moved',
  quantityOf(partSheet, 'Baseboard') === wholeBase && quantityOf(partSheet, 'Floor') === wholeFloor,
  `base ${quantityOf(partSheet, 'Baseboard')} was ${wholeBase}; ` +
    `floor ${quantityOf(partSheet, 'Floor')} was ${wholeFloor}`);
check('the sheet says out loud whose figure it is, and what the wall measures',
  new RegExp(`Your own figure, not a measurement: wall-5 30\\.0 of ${wallFaceHere} sq ft`).test(partSheet),
  partSheet.slice(0, 1400));
check('and it says it about that wall and about no other',
  (partSheet.match(/Your own figure, not a measurement/g) ?? []).length === 1 &&
    !/Your own figure, not a measurement: [^\n]*wall-(?!5\b)/.test(partSheet),
  partSheet.slice(0, 1400));

await section(page, 'Price');
const partPrice = await page.locator('[data-panel="price"]').innerText();
const faceAfter = pricedAt(partPrice, 'Wall face');
const baseAfter = pricedAt(partPrice, 'Baseboard');
check('the money on the wall face is the rate he typed times the quantity on the sheet',
  faceAfter != null && faceAfter.total === lineTotal(375n, hundredths(faceAfter.quantity)),
  said(faceAfter));
check('while the untouched line is the same to the cent',
  baseAfter != null && baseBefore != null && baseAfter.total === baseBefore.total,
  `${baseAfter?.total} was ${baseBefore?.total}`);

/* ==========================================================================
   3. It is a record, and it goes back to the app as an exact integer.
   ========================================================================== */

let saved = JSON.parse((await sentTo(page, 'saved')).at(-1)?.project ?? '{}');
const kept = saved.extras?.scope?.picked?.['wall:wall-5']?.find((p) => p.item === 'Wall face');
check('the figure goes back to the app with the room, against the wall he typed it on',
  kept?.part != null, said(kept));
check('as an exact integer of hundredths, never a float',
  kept?.part?.hundredths?.$nm === '3000', said(kept?.part));
check('and it says who said so and when',
  typeof kept?.part?.by === 'string' && kept.part.by.length > 0 &&
    /^\d{4}-\d{2}-\d{2}T/.test(kept?.part?.at ?? ''), said(kept?.part));

/* ==========================================================================
   4. The same thing on a patch job, where wall-5 is the only wall on the
      line — so every figure is exact and the money can be proved to the cent.
   ========================================================================== */

await section(page, 'Plan');
await page.getByRole('button', { name: 'Price it all again' }).first().click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Start from nothing' }).first().click();
await page.waitForTimeout(400);

await page.locator('input[aria-label="Wall face on wall-5"]').check();
await page.waitForTimeout(200);
await page.locator('input[aria-label="Baseboard on wall-5"]').check();
await page.waitForTimeout(400);

const baseLabel = await page.locator('label:has(input[aria-label="Baseboard on wall-5"])').innerText();
const baseHere = (/([\d,]+\.?\d*) lf/.exec(baseLabel) ?? [])[1]?.replace(/,/g, '');

await section(page, 'Price');
const patchBefore = await page.locator('[data-panel="price"]').innerText();
const oneWallFace = pricedAt(patchBefore, 'Wall face');
const oneWallBase = pricedAt(patchBefore, 'Baseboard');

// One wall on each line, so the sheet's figure IS the wall's figure and there
// is nowhere for a rounding to hide.
check('a patch job prices the one wall he picked, at what that wall measures',
  oneWallFace?.quantity === wallFaceHere && oneWallBase?.quantity === baseHere,
  `${oneWallFace?.quantity} / ${oneWallBase?.quantity}, wall says ${wallFaceHere} / ${baseHere}`);
check('and the money on both is the rate times that figure, to the cent',
  oneWallFace.total === lineTotal(375n, hundredths(wallFaceHere)) &&
    oneWallBase.total === lineTotal(600n, hundredths(baseHere)),
  `${oneWallFace.total} vs ${lineTotal(375n, hundredths(wallFaceHere))}; ` +
    `${oneWallBase.total} vs ${lineTotal(600n, hundredths(baseHere))}`);

await section(page, 'Plan');
await howMuch.fill(PART);
await howMuch.blur();
await page.waitForTimeout(400);

await section(page, 'Takeoff');
check('the sheet is exactly the figure he typed, and nothing else',
  quantityOf(await takeoff.innerText(), 'Wall face') === '30.0',
  `${quantityOf(await takeoff.innerText(), 'Wall face')}`);

await section(page, 'Price');
const patchAfter = await page.locator('[data-panel="price"]').innerText();
const partedFace = pricedAt(patchAfter, 'Wall face');
const partedBase = pricedAt(patchAfter, 'Baseboard');

check('the money is the rate he typed times the part he typed, to the cent',
  partedFace.total === lineTotal(375n, hundredths(PART)), said(partedFace));
check('and it came down by exactly what he took off — the wall, less his part',
  oneWallFace.total - partedFace.total ===
    lineTotal(375n, hundredths(wallFaceHere) - hundredths(PART)),
  `dropped ${oneWallFace.total - partedFace.total}, ` +
    `expected ${lineTotal(375n, hundredths(wallFaceHere) - hundredths(PART))}`);
check('while the baseboard on the same wall, untouched, is unchanged to the cent',
  partedBase.total === oneWallBase.total, `${partedBase?.total} was ${oneWallBase?.total}`);

/* ==========================================================================
   4b. A part bigger than the wall. A refusal with a sentence, not a clamp.
   ========================================================================== */

await section(page, 'Plan');
const tooMuch = page.locator('input[aria-label="How much of it? — Baseboard on wall-5"]');
// Ten linear feet more than the wall has, worked out in hundredths so the
// number typed into the app is a number and not a float's opinion of one.
const over = hundredths(baseHere) + 1000n;
const overshoot = `${over / 100n}.${String(over % 100n).padStart(2, '0')}`;
await tooMuch.fill(overshoot);
await tooMuch.blur();
await page.waitForTimeout(400);

const baseRow = await page.locator('li:has(input[aria-label="Baseboard on wall-5"])').innerText();
check('more baseboard than the wall has is refused, in a sentence, with both figures',
  new RegExp(`wall-5 has ${baseHere} lf of baseboard on it, and you have said ${overshoot} lf`).test(baseRow),
  baseRow);
check('and the refusal says why rather than just saying no',
  /cannot be bigger than the thing it is part of/.test(baseRow), baseRow);
check('and what he typed is still in the box for him to correct',
  (await tooMuch.inputValue()) === overshoot, await tooMuch.inputValue());

await section(page, 'Takeoff');
check('nothing was clamped: the sheet still has the whole run of base on it',
  quantityOf(await takeoff.innerText(), 'Baseboard') === baseHere,
  `${quantityOf(await takeoff.innerText(), 'Baseboard')} was ${baseHere}`);
await section(page, 'Price');
check('and the money for it has not moved either',
  pricedAt(await page.locator('[data-panel="price"]').innerText(), 'Baseboard').total ===
    oneWallBase.total);

/* ==========================================================================
   5. The eaches. One window of the two in a wall.
   ========================================================================== */

await section(page, 'Plan');
await pick(page, /^Wall wall-9,/);
await page.waitForTimeout(300);
await page.locator('input[aria-label="Windows on wall-9"]').check();
await page.waitForTimeout(400);
const windowLabel = await page.locator('label:has(input[aria-label="Windows on wall-9"])').innerText();
const windowsHere = (/([\d,]+\.?\d*) ea/.exec(windowLabel) ?? [])[1];
check('the wall with two windows in it says so', windowsHere === '2', windowLabel);

await section(page, 'Price');
const beforeWindows = pricedAt(await page.locator('[data-panel="price"]').innerText(), 'Windows');
check('and two windows are priced at twice the rate he typed',
  beforeWindows?.quantity === '2' && beforeWindows.total === lineTotal(24000n, 200n),
  said(beforeWindows));

await section(page, 'Plan');
const oneWindow = page.locator('input[aria-label="How much of it? — Windows on wall-9"]');
await oneWindow.fill('1');
await oneWindow.blur();
await page.waitForTimeout(400);

await section(page, 'Takeoff');
check('one window of the two, and it prints as a count rather than as 1.00',
  quantityOf(await takeoff.innerText(), 'Windows') === '1',
  `${quantityOf(await takeoff.innerText(), 'Windows')}`);

await section(page, 'Price');
const afterWindows = pricedAt(await page.locator('[data-panel="price"]').innerText(), 'Windows');
check('and the money came down by exactly one window at the rate he typed',
  beforeWindows.total - afterWindows.total === lineTotal(24000n, 100n),
  `dropped ${beforeWindows?.total - afterWindows?.total}, expected ${lineTotal(24000n, 100n)}`);

/* ==========================================================================
   6. Marking a patch, in the words somebody standing at the wall uses.
   ========================================================================== */

await section(page, 'Plan');
await pick(page, /^Wall wall-9,/);
await pick(page, /^Wall wall-5,/);
await page.waitForTimeout(300);
await page.getByRole('button', { name: '+ part of this wall', exact: true }).first().click();
await page.waitForTimeout(400);

const form = await page.locator('[data-marks="wall-5"]').innerText();
check('the patch asks for what a person measures, not for two coordinates',
  /How far from the corner it starts/.test(form) &&
    /How wide it is/.test(form) &&
    /How high up the wall it goes/.test(form), form.slice(0, 900));
check('and "from", "to" and "up to" are gone from it',
  !/(^|\n)\s*(from|to|up to)\s*($|\n)/i.test(form) &&
    (await page.locator('[data-marks="wall-5"] input[placeholder="from"]').count()) === 0 &&
    (await page.locator('[data-marks="wall-5"] input[placeholder="to"]').count()) === 0 &&
    (await page.locator('[data-marks="wall-5"] input[placeholder="up to"]').count()) === 0,
  form.slice(0, 900));
check('the corner is named as a corner somebody can put a thumb on',
  /Hook your tape in the corner where wall-5 meets wall-4/.test(form), form.slice(0, 1200));
check('and the wall’s own run and height are in the prompt, before anything is typed',
  /wall-5 runs \d+' [\d ]*[\d/]*" and stands \d+' [\d ]*[\d/]*" high/.test(form), form.slice(0, 600));

await page.getByLabel('What is it?').fill('mould behind the radiator');
await page.getByLabel(/^How far from the corner it starts/).fill(`3'`);
await page.getByLabel(/^How wide it is/).fill(`4'`);
await page.getByLabel(/^How high up the wall it goes/).fill(`2'`);
await page.getByRole('button', { name: 'Mark it' }).click();
await page.waitForTimeout(600);

check('it marks, and the mark is listed',
  /mould behind the radiator/.test(await page.locator('[data-panel="plan"]').innerText()));

saved = JSON.parse((await sentTo(page, 'saved')).at(-1)?.project ?? '{}');
const patch = (saved.extras?.damages ?? []).find((d) => d.note === 'mould behind the radiator')?.shape;
// Worked out here: three feet in, four feet wide, so the far end is at seven
// feet. If the middle box were still a coordinate this would be four.
check('the record is unchanged — two positions along the wall and a height off the floor',
  patch?.kind === 'patch' && patch.wallId === 'wall-5', JSON.stringify(patch));
check('and the width he typed became the far end, in exact nanometres',
  patch?.fromAlong?.$nm === String(3n * NM_PER_FOOT) &&
    patch?.toAlong?.$nm === String(7n * NM_PER_FOOT) &&
    patch?.fromHeight?.$nm === '0' &&
    patch?.toHeight?.$nm === String(2n * NM_PER_FOOT),
  JSON.stringify(patch));

check('how much of it: no console or page errors', noise().length === 0, noise().join(' | '));
await ctx.close();

process.exit(report('A33 — how much of it is being done') === 0 ? 0 : 1);
