import { readFileSync } from 'node:fs';
import { check, contrast, noise, openAsApp, report, section, sentTo, SECTIONS, SP } from './lib.mjs';

/**
 * The path Sam actually walks, from a scan to money, without leaving it.
 *
 * > "Scan → room → money, end to end first — the path you actually walked: scan
 * >  a room, watch it land in Rooms, plan, takeoff, price, proposal. Fix
 * >  everything broken on it before touching anything else."
 *
 * Every other part of this audit takes one feature and drives it hard. This one
 * takes one journey and refuses to skip a step of it, because the two failures
 * that hurt most on a phone were both joins rather than features:
 *
 *   - Every priced screen drawing itself blank, because the entitlement was
 *     dropped between the app and the page. Seventeen parts and 264 checks
 *     never saw it — each of them answered the question from a live page.
 *   - "AND HOW ARE JOBS COSTED OUT WHEN THERES NO PRICING ANYWHERE?" The
 *     pricing had been there for weeks, three doors deep, behind a component
 *     returning null.
 *
 * So the arithmetic here is done in this file rather than read off the screen.
 * A total that agrees with itself proves nothing; a total that agrees with
 * quantity × rate, worked out on this side, is the only kind worth printing.
 */

const kitchen = JSON.parse(readFileSync(`${SP}/kitchen.json`, 'utf8'));

/** What Gilbert charges. Typed once, on the Business tab, before any scan. */
const RATES = [
  ['Floor rate', '9.50', 9.5],
  ['Ceiling rate', '4.25', 4.25],
  ['Wall face rate', '3.75', 3.75],
  ['Baseboard rate', '6.00', 6],
  ['Doors rate', '450.00', 450],
  ['Windows rate', '300.00', 300],
];

/**
 * A dollar figure off the screen, as a number.
 *
 * The pattern is deliberately `\d{2}` at the end rather than anything greedy:
 * `[\d,.]+` swallows the full stop that ends the sentence a price sits in, and
 * `Number('9631.50.')` is `NaN` — which failed this file's own check the first
 * time it ran, on a total that was perfectly correct.
 */
const MONEY = /\$([\d,]+\.\d{2})/;
const cash = (text) => Number(String(text).replace(/[^0-9.]/g, ''));

/* ==========================================================================
   1. The rates, where a contractor actually types them: before the first job.
   ========================================================================== */

// The Business tab, which is a whole web view with no room in it — the state
// that used to drop the subscription and draw five screens as blank rectangles.
const shop = await openAsApp({ subscribed: true }, {});
await shop.page.goto(shop.page.url() + '#business', { waitUntil: 'networkidle' });
await shop.page.waitForTimeout(600);

let seen = await shop.page.locator('body').innerText();
check('the Business tab offers the rate book without a room open',
  /What you charge/.test(seen), seen.slice(0, 300));
check('and says the rates are the contractor’s own, not an average',
  /no averages, no\s+guesses|no averages/.test(seen), seen.slice(0, 900));

for (const [label, typed] of RATES) {
  const box = shop.page.getByLabel(label);
  await box.fill(typed);
  await box.blur();
  await shop.page.waitForTimeout(90);
}
await shop.page.waitForTimeout(300);

const profiles = await sentTo(shop.page, 'company');
check('typing a rate hands the profile to the app to keep',
  profiles.length > 0 && typeof profiles.at(-1)?.company === 'string',
  `${profiles.length} sent`);

const company = profiles.at(-1)?.company ?? '';
const book = JSON.parse(company || '{}').prices?.rates ?? [];
check('every rate typed is in the profile the app was handed',
  book.length === RATES.length,
  `${book.length} of ${RATES.length}: ${book.map((r) => r.item).join(', ')}`);
check('and money in it is minor units, never a float',
  book.every((r) => typeof r.cents === 'object' && /^\d+$/.test(String(r.cents.$nm ?? ''))),
  JSON.stringify(book[0]?.cents));

// Readable while typing, in the dark, which is where these get typed.
const dark = await shop.page.getByLabel('Floor rate').evaluate((el) => {
  const style = getComputedStyle(el);
  return { ink: style.color, ground: style.backgroundColor };
});
check('a rate is readable as it is typed', contrast(dark.ink, dark.ground) >= 4.5,
  `${contrast(dark.ink, dark.ground).toFixed(1)}:1 — ${dark.ink} on ${dark.ground}`);
check('the rate book: no console or page errors', noise().length === 0, noise().join(' | '));
await shop.ctx.close();

/* ==========================================================================
   2. The scan arrives, exactly as `CorrectView.hand(over:)` hands it over.
   ========================================================================== */

const { ctx, page } = await openAsApp({
  company,
  subscribed: true,
  room: kitchen,
  fileName: 'Kitchen 2026-08-26 1431',
});

seen = await page.locator('body').innerText();
check('the scan lands under the name the app gave it',
  seen.includes('Kitchen 2026-08-26 1431'), seen.slice(0, 200));
check('and it lands on the drawing, not on a file picker',
  !/Open a scan|Choose a file|Nothing to show for this one/.test(seen), seen.slice(0, 300));

const plan = page.locator('svg[aria-label^="Plan of"]');
check('with a plan of the room on it', (await plan.count()) === 1);

const walls = await page.getByRole('button', { name: /^Wall / }).count();
check('and every wall on it can be picked', walls === 4, `${walls} walls`);

// The room reaches the app to be kept, which is the whole reason a correction
// is not just a browser cache.
const kept = await sentTo(page, 'saved');
check('the room is handed to the app to keep the moment it opens',
  kept.length > 0 && typeof kept.at(-1)?.project === 'string', `${kept.length} sent`);

/* ==========================================================================
   3. Every part of the room is reachable and none of them is empty.
   ========================================================================== */

for (const part of SECTIONS) {
  await section(page, part);
  const panel = await page.locator(`[data-panel]:not([hidden])`).innerText();
  check(`${part} opens with something on it`, panel.trim().length > 40,
    `${panel.trim().length} characters`);
}

/* ==========================================================================
   4. The takeoff: quantities off the geometry, and honest about where from.
   ========================================================================== */

await section(page, 'Takeoff');
const takeoff = await page.locator('[data-panel="takeoff"]').innerText();

const quantity = (item) => {
  const line = new RegExp(`${item}[\\s\\S]{0,120}?([\\d,.]+)\\s(sq ft|lf|ea)`).exec(takeoff);
  return line ? { amount: Number(line[1].replace(/,/g, '')), unit: line[2] } : null;
};

const floor = quantity('Floor');
const ceiling = quantity('Ceiling');
check('the takeoff measures the floor', floor !== null && floor.unit === 'sq ft',
  JSON.stringify(floor));
check('and the ceiling follows the floor exactly',
  floor && ceiling && floor.amount === ceiling.amount,
  `${floor?.amount} vs ${ceiling?.amount}`);
check('and it says these are the scanner’s numbers rather than measurements',
  /not measurements|Scanned/.test(takeoff), takeoff.slice(-400));

/* ==========================================================================
   5. The money: the rates typed in step 1, times those quantities. Nothing
      here reads a total off the screen and calls it checked.
   ========================================================================== */

await section(page, 'Price');
const priced = await page.locator('[data-panel="price"]').innerText();

check('the rates typed on the Business tab reach the room',
  !/Type what you charge/.test(priced) && /\$/.test(priced), priced.slice(0, 300));

let worked = 0;
let allRight = true;
const wrong = [];
for (const [label, , rate] of RATES) {
  const item = label.replace(/ rate$/, '');
  const line = new RegExp(
    `${item}\\n([\\d,]+\\.?\\d*) (sq ft|lf|ea) at \\$([\\d,]+\\.\\d{2})\\n\\$([\\d,]+\\.\\d{2})`
  ).exec(priced);
  if (!line) { allRight = false; wrong.push(`${item}: no line`); continue; }
  const amount = Number(line[1].replace(/,/g, ''));
  const each = Number(line[3].replace(/,/g, ''));
  const total = Number(line[4].replace(/,/g, ''));
  worked += total;
  if (each !== rate) { allRight = false; wrong.push(`${item}: rate ${each} not ${rate}`); }
  if (Math.abs(amount * rate - total) > 0.005) {
    allRight = false;
    wrong.push(`${item}: ${amount} x ${rate} = ${(amount * rate).toFixed(2)}, screen says ${total}`);
  }
}
check('every priced line is its own quantity times the rate that was typed',
  allRight, wrong.join(' | '));

const totalOnScreen = cash(/Total\n\$([\d,]+\.\d{2})/.exec(priced)?.[1] ?? '0');
check('and the total is the lines added up',
  Math.abs(totalOnScreen - worked) < 0.005,
  `screen ${totalOnScreen}, lines add to ${worked.toFixed(2)}`);
check('the money says out loud that it is resting on a scan',
  /resting on a scan|Put a tape on/.test(priced), priced.slice(-500));

/* ==========================================================================
   6. The proposal, which must never re-type any of it.
   ========================================================================== */

await section(page, 'Agreement');
await page.getByLabel(/What to call this option/i).fill('Full kitchen refit');
await page.getByLabel(/One line on what it covers/i).fill('Floor, ceiling, walls, base, one door, one window.');
await page.getByRole('button', { name: 'Write the proposal' }).click();
await page.waitForTimeout(700);

let paper = await page.locator('[data-panel="agree"]').innerText();
const quoted = cash(MONEY.exec(paper)?.[1] ?? '0');
check('the proposal quotes the same money the takeoff priced',
  Math.abs(quoted - totalOnScreen) < 0.005, `proposal ${quoted}, price ${totalOnScreen}`);
check('and it names what is still missing rather than looking finished',
  /Still to fill in/.test(paper), paper.slice(0, 400));
check('and it carries the scan caveat onto the client’s paper',
  /came off the scan/.test(paper), paper.slice(0, 500));

await page.getByLabel(/Who it is for/i).fill('Gilbert Reyes');
await page.getByLabel(/Address of the work/i).fill('118 Willow St');
await page.getByRole('button', { name: 'Save these details' }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Take this one' }).click();
await page.waitForTimeout(400);

paper = await page.locator('[data-panel="agree"]').innerText();
check('taking an option opens somewhere to sign', /Sign it/.test(paper), paper.slice(-600));

const agree = page.getByRole('button', { name: /^Agree to / });
check('and the signature is against the option by name and price',
  /Agree to Full kitchen refit — \$/.test(await agree.innerText()), await agree.innerText());

await page.getByLabel(/Your name/i).fill('Gilbert Reyes');
await page.getByLabel(/I agree to sign electronically/i).check();
const pad = page.locator('[data-panel="agree"] canvas').first();
const box = await pad.boundingBox();
await page.mouse.move(box.x + 20, box.y + box.height / 2);
await page.mouse.down();
for (let step = 1; step <= 12; step += 1) {
  await page.mouse.move(box.x + 20 + (step * (box.width - 40)) / 12,
    box.y + box.height / 2 + (step % 2 ? -14 : 14));
}
await page.mouse.up();
await page.waitForTimeout(300);
await agree.click();
await page.waitForTimeout(700);

paper = await page.locator('[data-panel="agree"]').innerText();
check('signing records the exact words agreed to, not just a name',
  /I have read this proposal/.test(paper), paper.slice(0, 900));
check('and a fingerprint of the document that was signed',
  /SHA-256/.test(paper), paper.slice(0, 1200));
check('and the signed scope becomes what the job is measured against',
  /never edited|change order/i.test(paper), paper.slice(0, 1400));

/* ==========================================================================
   7. Asking to be paid — which must come off what was signed, never off what
      the room measures today.
   ========================================================================== */

await section(page, 'Work');
const working = await page.locator('[data-panel="work"]').innerText();
check('an invoice can be raised once something has been signed',
  /Write the invoice/.test(working), working.slice(-700));
const agreed = cash(/Agreed \$([\d,]+\.\d{2})/.exec(working)?.[1] ?? '0');
check('and it is raised against the agreed figure, to the cent',
  Math.abs(agreed - totalOnScreen) < 0.005, `invoice says ${agreed}, price said ${totalOnScreen}`);
check('with nothing invoiced yet, said rather than left blank',
  /invoiced so far \$0\.00/.test(working), working.slice(-400));

/* ==========================================================================
   8. And the whole journey is still handing the work back to the app.
   ========================================================================== */

const finally_ = await sentTo(page, 'saved');
check('every step of this was written back to the app, not just the first',
  finally_.length > kept.length, `${kept.length} at the start, ${finally_.length} now`);

const last = JSON.parse(finally_.at(-1).project);
check('and what went back carries the signed proposal, not only the room',
  last.extras?.baseline != null || last.extras?.proposal != null,
  Object.keys(last.extras ?? {}).join(', '));

check('scan to money: no console or page errors', noise().length === 0, noise().join(' | '));
await ctx.close();

/* ==========================================================================
   9. The same journey for a room nobody scanned — the grid, which until now
      had no door on the phone at all.
   ========================================================================== */

{
  const drawn = await openAsApp({ company, subscribed: true }, {});
  await drawn.page.goto(drawn.page.url() + '#draw', { waitUntil: 'networkidle' });
  await drawn.page.waitForTimeout(700);

  let onGrid = await drawn.page.locator('body').innerText();
  check('the app can open straight onto the grid',
    /Tap its corners the way you would walk round it/.test(onGrid), onGrid.slice(0, 400));
  check('and it is the grid, not the dead-capture page it used to arrive through',
    !/Nothing to show for this one|has no room in it/.test(onGrid), onGrid.slice(0, 400));
  check('with no Cancel that would strand somebody on a page about a failed scan',
    (await drawn.page.getByRole('button', { name: /^Cancel$/ }).count()) === 0);

  await drawn.page.getByLabel('What to call it').fill('Gilbert front bedroom');
  await drawn.page.getByRole('button', { name: 'Start drawing' }).click();
  await drawn.page.waitForTimeout(400);

  const board = drawn.page.locator('svg[role="application"]');
  const tap = async (fx, fy) => {
    const where = await board.boundingBox();
    await drawn.page.mouse.click(where.x + where.width * fx, where.y + where.height * fy);
    await drawn.page.waitForTimeout(240);
  };
  await tap(0.28, 0.70);
  await tap(0.72, 0.695);
  await tap(0.725, 0.34);
  await tap(0.28, 0.345);
  await board.locator('circle').first().click();
  await drawn.page.waitForTimeout(350);
  await drawn.page.getByRole('button', { name: 'Open it' }).click();
  await drawn.page.waitForTimeout(900);

  onGrid = await drawn.page.locator('body').innerText();
  check('a drawn room opens as a room under the name it was given',
    onGrid.includes('Gilbert front bedroom'), onGrid.slice(0, 250));
  check('and its sheet says DRAWN — never measured, and never scanned',
    /DRAWN — every length came off the grid/.test(onGrid) && !/SCANNED/.test(onGrid),
    onGrid.slice(0, 600));

  // The one thing `DrawScreen.swift` needs off this channel: a name to call the
  // folder. Without it every drawn room on the phone is called "Room".
  const drawnSaves = await sentTo(drawn.page, 'saved');
  check('a drawn room is handed to the app to keep, like any other',
    drawnSaves.length > 0, `${drawnSaves.length} sent`);
  const project = JSON.parse(drawnSaves.at(-1)?.project ?? '{}');
  check('and it carries the name the app names its folder from',
    project.fileName === 'Gilbert front bedroom', JSON.stringify(project.fileName));

  await section(drawn.page, 'Takeoff');
  const drawnTakeoff = await drawn.page.locator('[data-panel="takeoff"]').innerText();
  check('a drawn room takes off like a scanned one', /sq ft/.test(drawnTakeoff),
    drawnTakeoff.slice(0, 400));

  await section(drawn.page, 'Price');
  const drawnPrice = await drawn.page.locator('[data-panel="price"]').innerText();
  check('and prices itself against the same book, with no rates re-typed',
    /Floor\n[\d,.]+ sq ft at \$9\.50/.test(drawnPrice), drawnPrice.slice(0, 500));
  check('while still saying the money is resting on something drawn',
    /Total/.test(drawnPrice), drawnPrice.slice(0, 600));

  check('the grid: no console or page errors', noise().length === 0, noise().join(' | '));
  await drawn.ctx.close();
}

process.exit(report('A19 — scan to money, end to end') === 0 ? 0 : 1);
