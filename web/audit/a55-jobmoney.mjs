import { check, loadScan, noise, open, report, reportEvenIfItDies, section } from './lib.mjs';

// Say what was learned even if this part dies part way through.
reportEvenIfItDies('A55 — a share of the job, money in, and a change order torn up');

/**
 * The five controls on the Work screen that decide what a contractor is owed.
 *
 * Nothing had ever named one of them. `check-controls.py` stood at eighteen
 * undriven controls this morning and five of them were here — the box a
 * progress payment's percentage is typed into, the box the day a cheque
 * arrived is typed into, the button that discards an unsigned change order, the
 * button that hands over a signed one, and the note that travels with a day in
 * somebody's calendar. Between them they are how much is asked for, when it
 * came in, and what a client is told about either.
 *
 * ## What each one could get wrong, which is what is checked
 *
 *   * **`How much of the job is done, per cent`** — a percentage typed here is
 *     a share of the AGREED total, not of what is left and not of what the room
 *     measures today. The invoice must ask for that share to the cent, minus
 *     what has already been billed, and the second progress bill must ask for
 *     the difference between the two percentages and not for the whole of the
 *     second one. Asking twice for the same work is the failure.
 *   * **`When it came in`** — a payment lands on the day it is given, the
 *     amount owed on that invoice goes down by exactly what came in, and what
 *     is still out across the job goes down by the same figure and by nothing
 *     else. A date typed against one invoice must not appear against another.
 *   * **`Tear it up and start again`** — this is the one that has to be proved
 *     by what it leaves behind. It discards an UNSIGNED change order. The
 *     signed agreement, its signature, every change order somebody has already
 *     signed, every invoice and every payment must be exactly as they were. A
 *     tear-up that quietly took the agreement with it would be a way to unbill
 *     work that was agreed to.
 *   * **`Send the signed copy`** — hands over the document it says it does: the
 *     signed change order, by its own number, with the signature on it. Not the
 *     agreement, not the unsigned one waiting beside it.
 *   * **`Anything they need to know`** — what is typed here is the only part of
 *     a visit that is not a date, and it has to reach the calendar file the
 *     client opens, as typed.
 *
 * ## Every figure here is worked out on this side
 *
 * The agreed total is priced in this file, in integer cents, from the
 * quantities the app printed on its own takeoff and the rates typed into it.
 * Every share, every payment and every change order difference is then computed
 * from that, here, and compared with what the screen says. Nothing is read off
 * one screen and asserted to equal itself: a Work screen whose four figures
 * agree with each other perfectly and are all wrong is exactly what a share
 * taken of the wrong base looks like.
 *
 * It runs on `dining.json` — Sam's own scan, nine walls, an eleven-corner
 * outline and an open span — at 430 by 800, which is a phone.
 */

/* ===================================================================
   This side's arithmetic. Money in cents as BigInt, never a float.
   =================================================================== */

/** A decimal with at most two places, as hundredths. "408.8" -> 40880n. */
function hundredths(text) {
  const [whole, part = ''] = String(text).replace(/,/g, '').split('.');
  return BigInt(whole) * 100n + BigInt((part + '00').slice(0, 2));
}

/** Cents, rounded half away from zero. */
function cents(rateCents, quantity) {
  const raw = rateCents * hundredths(quantity);
  return (raw + 50n) / 100n;
}

/** Dollars-and-cents text, as the app writes it, so the two can be compared. */
function money(value) {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  return `${negative ? '-' : ''}$${(abs / 100n).toLocaleString('en-US')}.` +
    `${`${abs % 100n}`.padStart(2, '0')}`;
}

/** What a screen printed, as cents, so it can be compared with the above. */
const read = (text) => hundredths(String(text).replace(/[^0-9.]/g, ''));

/**
 * A percentage of a figure, rounded half up in cents.
 *
 * `amountFor` in `core/src/invoice.ts` does exactly this and then takes off
 * what has already been billed. Written out again here rather than imported,
 * because a check that computes the expected figure with the same function the
 * app used is a check that cannot fail.
 */
const share = (total, perCent) => (total * BigInt(perCent) * 100n + 5000n) / 10000n;

/** A money string as a regular expression, for matching against a screen. */
const re = (value) => money(value).replace(/[$.]/g, '\\$&');

// The harness's own arithmetic, checked before anything is trusted to it.
if (cents(500n, '408.8') !== 204400n) throw new Error('the audit cannot multiply; fix it first');
if (money(796656n) !== '$7,966.56') throw new Error('the audit cannot spell money; fix it first');
if (share(403050n, 40) !== 161220n) throw new Error('the audit cannot take a share; fix it first');
if (share(1000n, 65) !== 650n) throw new Error('the audit cannot round a share; fix it first');

/* ==================================================================== */

const NOTE = 'Skip arrives at eight and the water is off at the street until noon';
const WHY = 'The floor runs under the island and nobody could see it until it came out';

const { browser, ctx, page } = await open();
await loadScan(page, 'dining.json');

const work = page.locator('[data-panel="work"]');
const agree = page.locator('[data-panel="agree"]');

/**
 * A control pressed by focusing it and hitting Enter, which is also the
 * screen-reader path — the same reason `pick` in `lib.mjs` does it.
 *
 * The tab bar is fixed to the bottom of a 430 by 800 phone and several of these
 * buttons sit at the very end of a long screen with nothing below them to
 * scroll. A pointer click lands on the tab bar, is retried for thirty seconds
 * and then throws, taking the whole part down and reporting nothing.
 */
async function press(control) {
  await control.scrollIntoViewIfNeeded();
  await control.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
}

/** A signature drawn with a finger, on whichever pad is on screen. */
async function scribble() {
  const pad = page.getByRole('img', { name: 'Sign here with your finger' }).last();
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  await page.mouse.move(box.x + 40, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 30, { steps: 8 });
  await page.mouse.move(box.x + 240, box.y + 60, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

/**
 * The six rates the app ships with, set one at a time by their own names.
 *
 * Not "every textbox in the rates panel", which is how this was written first
 * and which is wrong twice over: that panel's boxes include the **mark-up on
 * the whole job** and the contractor's own added lines, so setting every rate
 * to "6.00" also moved the mark-up from 5% to 6% and the total this side worked
 * out then disagreed with the app's by $90.99. Reaching for each rate by the
 * name beside it changes exactly what it says it changes, and leaves the
 * mark-up where this part put it.
 */
async function setStandardRates(dollars) {
  const rates = await openTheRates();
  for (const item of STANDARD) {
    const box = rates.getByLabel(`${item} rate`);
    await box.fill(dollars);
    await box.blur();
    await page.waitForTimeout(80);
  }
  await closeTheRates(rates);
}

/** The mark-up, set once and then left alone, so every figure here is exact. */
async function setMarkUp(perCent) {
  const rates = await openTheRates();
  const box = rates.getByLabel('Mark-up on the whole job');
  await box.fill(String(perCent));
  await box.blur();
  await page.waitForTimeout(250);
  await closeTheRates(rates);
}

/**
 * A line of the contractor's own, at a quantity he types.
 *
 * Two of them are used here. The open span, because a dining room open to the
 * next room has one, it is on the takeoff, and a proposal will not go out while
 * anything on the sheet has no price against it. And a dumpster, later, because
 * a change order has to be raised against something the signed scope has never
 * seen — see the note where it is added.
 */
async function addOwnItem({ name, from, covers, price, each = null, unit = 'ea' }) {
  const rates = await openTheRates();
  await rates.getByLabel('What you call it').fill(name);
  await rates.getByLabel('Where its quantity comes from').selectOption({ label: from });
  await page.waitForTimeout(150);
  if (each !== null) {
    await rates.getByLabel('How many, each time').fill(each);
    await rates.getByLabel('Charged by the').selectOption(unit);
    await page.waitForTimeout(150);
  }
  await rates.getByLabel('What it covers', { exact: true }).fill(covers);
  await rates.getByLabel(/^What you charge, per/).fill(price);
  await rates.getByRole('button', { name: 'Add it to your rates' }).click();
  await page.waitForTimeout(300);
  await closeTheRates(rates);
}

async function openTheRates() {
  await section(page, 'Price');
  await page.getByRole('button', { name: /Set your rates|Your rates/ }).first().click();
  await page.waitForTimeout(300);
  return page
    .locator('section', { has: page.getByRole('heading', { name: 'What you charge' }) })
    .first();
}

async function closeTheRates(rates) {
  await rates.getByRole('button', { name: 'Done' }).first().click();
  await page.waitForTimeout(400);
}

/** The six the app ships with. The contractor's own lines are not among them. */
const STANDARD = ['Floor', 'Ceiling', 'Wall face', 'Baseboard', 'Doors', 'Windows'];

const ITEMS = ['Floor', 'Wall face', 'Ceiling', 'Baseboard', 'Doors', 'Windows', 'Open span'];

/**
 * The job priced on this side, from the app's own takeoff, at the rates this
 * side believes are in the book.
 *
 * `rates` is per item rather than one figure, because a rate the contractor
 * adds himself — the open span — is listed with a Remove button and no box to
 * type in, so raising every rate in the app raises the six standard ones and
 * leaves his own where he set it.
 */
async function pricedHere(rates) {
  await section(page, 'Takeoff');
  await page.waitForTimeout(300);
  const sheet = await page.locator('[data-panel="takeoff"]').innerText();
  let subtotal = 0n;
  const quantities = {};
  for (const item of ITEMS) {
    const found = new RegExp(`^${item}\\n[^\\n]*\\n([\\d.,]+) (sq ft|lf|ea)$`, 'm').exec(sheet);
    if (found) {
      quantities[item] = found[1];
      subtotal += cents(rates[item], found[1]);
    }
  }
  await section(page, 'Price');
  await page.waitForTimeout(300);
  const priced = await page.locator('[data-panel="price"]').innerText();
  const markUp = /Mark-up ([\d.]+)%/.exec(priced);
  const points = hundredths(markUp?.[1] ?? '0');
  return {
    subtotal,
    total: subtotal + (subtotal * points + 5000n) / 10_000n,
    lines: Object.keys(quantities).length,
    quantities,
    priced,
  };
}
/* ==========================================================================
   0. A signed job to bill against.
   ========================================================================== */

/** Five dollars a unit across the book, the contractor's open span included. */
const AT_FIVE = Object.fromEntries(ITEMS.map((item) => [item, 500n]));
/** Six on the six the app ships with. His own line has no box and stays at five. */
const AT_SIX = { ...Object.fromEntries(ITEMS.map((item) => [item, 600n])), 'Open span': 500n };
/** The mark-up, set once here and never touched again, so every figure is exact. */
const MARK_UP = 5;

await setStandardRates('5.00');
await setMarkUp(MARK_UP);
await addOwnItem({
  name: 'Open span',
  from: 'how long the wall is, corner to corner',
  covers: 'nothing built across it',
  price: '5.00',
});
const first = await pricedHere(AT_FIVE);
check('every priced line on the takeoff was read off the app’s own sheet',
  first.lines === 7, `read ${JSON.stringify(first.quantities)}`);
check('the total the app prints is the one worked out here from its own quantities',
  first.priced.includes(money(first.total)),
  `worked out ${money(first.total)} from ${JSON.stringify(first.quantities)} at $5.00`);
check('and the mark-up on it is the one this part put there, not one it inherited',
  new RegExp(`Mark-up ${MARK_UP}%`).test(first.priced), first.priced.slice(0, 600));

const AGREED = first.total;

await page.getByRole('button', { name: 'Your business' }).click();
await page.waitForTimeout(400);
await page.getByRole('textbox', { name: /Business name/i }).first().fill('Alvarez Remodeling');
await page.getByRole('textbox', { name: /Business address/i }).first()
  .fill('2200 Oak Street, Mesa AZ 85201');
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForTimeout(500);

await section(page, 'Agreement');
await press(page.getByRole('button', { name: 'Write the proposal' }));
await page.waitForTimeout(400);
await page.getByLabel('Who it is for').fill('M. Alvarez');
await page.getByLabel('Address of the work').fill('14 Sycamore');
await press(page.getByRole('button', { name: 'Save these details' }));
await page.waitForTimeout(400);
await agree.getByRole('button', { name: 'Their home', exact: true }).click();
await page.waitForTimeout(200);
await press(page.getByRole('button', { name: 'Take this one' }).first());
await page.waitForTimeout(400);
await page.getByLabel('Your name').fill('M. Alvarez');
await page.getByLabel('I agree to sign electronically').check();
await scribble();
await press(page.getByRole('button', { name: /^Agree to / }));
await page.waitForTimeout(800);

let t = await agree.innerText();
check('the job is agreed, at the figure worked out here',
  new RegExp(`Agreed — As measured, ${re(AGREED)}`).test(t), t.slice(0, 900));

await section(page, 'Work');
await page.waitForTimeout(500);

/* ==========================================================================
   1. `Anything they need to know` — the one part of a day that is not a date,
      and the only one that can be lost silently.
   ========================================================================== */

await page.getByLabel('What is it').fill('Tear-out, dining room');
await page.getByLabel('Day').fill('2026-09-14');
await page.getByLabel('Starts at').fill('08:00');
await page.getByLabel('Ends at').fill('16:00');
await page.getByLabel('Anything they need to know').fill(NOTE);
await press(work.getByRole('button', { name: 'Put it in the calendar' }));
await page.waitForTimeout(500);

let w = await work.innerText();
check('the day goes in the calendar under the name it was given',
  /Tear-out, dining room/.test(w), w.slice(0, 1200));
check('and the box that carries the note is emptied, so the next day does not inherit it',
  (await page.getByLabel('Anything they need to know').inputValue()) === '',
  await page.getByLabel('Anything they need to know').inputValue());

const waitIcs = page.waitForEvent('download');
await press(work.getByRole('button', { name: 'Send it to somebody' }));
const icsFile = await waitIcs;
let ics = '';
for await (const chunk of await icsFile.createReadStream()) ics += chunk;
// iCalendar folds a long line by breaking it and starting the next with a
// space. Unfolded here, because what the client's calendar shows is the whole
// sentence and not the first seventy-five octets of it.
const unfolded = ics.replace(/\r\n /g, '');
await page.waitForTimeout(300);

check('the calendar file is a file, named after the job',
  /\.ics$/.test(icsFile.suggestedFilename()), icsFile.suggestedFilename());
check('the day is in it, on the day it was typed, at the hour it was typed',
  /DTSTART:20260914T0800/.test(unfolded) && /DTEND:20260914T1600/.test(unfolded),
  unfolded.slice(0, 700));
check('and what they need to know travels with it, as typed',
  unfolded.includes(`DESCRIPTION:${NOTE}`), unfolded.slice(0, 900));
check('the note is on the day it was typed against and not on the calendar as a whole',
  /BEGIN:VEVENT[\s\S]*DESCRIPTION:Skip arrives[\s\S]*END:VEVENT/.test(unfolded),
  unfolded.slice(0, 900));

/* ==========================================================================
   2. `How much of the job is done, per cent` — a share of what was AGREED.
   ========================================================================== */

await page.getByLabel('Your invoice number').fill('2026-201');
await page.getByLabel('When it is due').fill('2026-09-30');
await page.getByLabel('How to pay you').fill('Cheque to the address above');
await press(work.getByRole('button', { name: 'Progress payment' }));
await page.waitForTimeout(300);

check('a progress payment asks how much of the job is done, and says why',
  (await page.getByLabel('How much of the job is done, per cent').count()) === 1
  && /Asking for the whole balance halfway through is the final invoice with the wrong word/
    .test(await work.innerText()),
  (await work.innerText()).slice(0, 1500));

// Nothing in the box at all. The model refuses rather than quietly asking for
// everything outstanding, which is the bug it was written for.
await press(page.getByRole('button', { name: 'Write the invoice' }));
await page.waitForTimeout(500);
let refusal = work.getByRole('alert');
check('a progress payment with no percentage on it is refused, and says why',
  (await refusal.count()) === 1
  && /say how much of the job is done|name the figure/.test(await refusal.innerText()),
  (await work.innerText()).slice(-900));

await page.getByLabel('How much of the job is done, per cent').fill('0');
await press(page.getByRole('button', { name: 'Write the invoice' }));
await page.waitForTimeout(400);
check('nought per cent of the job done is refused, and says what to type instead',
  (await work.getByRole('alert').count()) === 1
  && /how much of the job is done|more than 0 and at most 100/
    .test(await work.getByRole('alert').innerText()),
  await work.getByRole('alert').innerText());

await page.getByLabel('How much of the job is done, per cent').fill('120');
await press(page.getByRole('button', { name: 'Write the invoice' }));
await page.waitForTimeout(400);
check('and more of the job done than there is job is refused too',
  (await work.getByRole('alert').count()) === 1
  && /more than 0 and at most 100/.test(await work.getByRole('alert').innerText()),
  await work.getByRole('alert').innerText());
check('and none of the three refusals wrote an invoice',
  (await work.getByRole('button', { name: 'Money came in' }).count()) === 0,
  'a refused progress payment was billed anyway');

// 40% of the job, which is 40% of what was AGREED and not of what is left.
const FORTY = share(AGREED, 40);
await page.getByLabel('How much of the job is done, per cent').fill('40');
await press(page.getByRole('button', { name: 'Write the invoice' }));
await page.waitForTimeout(800);
w = await work.innerText();

let asked = /Progress payment 2026-201\s*\n?\s*(\$[\d,]+\.\d\d)/.exec(w);
check('two fifths of the job done asks for two fifths of the agreed total, to the cent',
  asked !== null && read(asked[1]) === FORTY,
  `worked out ${money(FORTY)} as 40% of ${money(AGREED)}, screen said ${asked?.[1] ?? 'nothing'}`);
check('and it is not the whole balance with the wrong word on top',
  asked !== null && read(asked[1]) < AGREED,
  `${asked?.[1] ?? 'nothing'} against an agreed ${money(AGREED)}`);
let billed = /invoiced so far (\$[\d,]+\.\d\d)/.exec(w);
check('and that is all that has been invoiced on the job',
  billed !== null && read(billed[1]) === FORTY,
  `worked out ${money(FORTY)}, screen said ${billed?.[1] ?? 'nothing'}`);
let out = /(\$[\d,]+\.\d\d) still out/.exec(w);
check('and all of it is still out, because nothing has come in',
  out !== null && read(out[1]) === FORTY,
  `worked out ${money(FORTY)}, screen said ${out?.[1] ?? 'nothing'}`);

// Two thirds of the way through. The second progress bill asks for the
// DIFFERENCE, not for 65% of the job all over again.
const SIXTY_FIVE = share(AGREED, 65);
const SECOND = SIXTY_FIVE - FORTY;
await page.getByLabel('Your invoice number').fill('2026-202');
await press(work.getByRole('button', { name: 'Progress payment' }));
await page.getByLabel('How much of the job is done, per cent').fill('65');
await press(page.getByRole('button', { name: 'Write the invoice' }));
await page.waitForTimeout(800);
w = await work.innerText();

asked = /Progress payment 2026-202\s*\n?\s*(\$[\d,]+\.\d\d)/.exec(w);
check('the next progress bill asks for the difference between the two percentages',
  asked !== null && read(asked[1]) === SECOND,
  `worked out ${money(SIXTY_FIVE)} earned less ${money(FORTY)} billed = ${money(SECOND)}, ` +
    `screen said ${asked?.[1] ?? 'nothing'}`);
billed = /invoiced so far (\$[\d,]+\.\d\d)/.exec(w);
check('and the two bills together are 65% of the agreed total and nothing more',
  billed !== null && read(billed[1]) === SIXTY_FIVE && FORTY + SECOND === SIXTY_FIVE,
  `${money(FORTY)} + ${money(SECOND)} vs ${money(SIXTY_FIVE)}, screen said ${billed?.[1] ?? 'nothing'}`);

// Back to 40% after 65% has been billed. There is nothing to ask for, and the
// refusal has to name both figures rather than write a bill for nothing.
await page.getByLabel('Your invoice number').fill('2026-203');
await press(work.getByRole('button', { name: 'Progress payment' }));
await page.getByLabel('How much of the job is done, per cent').fill('40');
await press(page.getByRole('button', { name: 'Write the invoice' }));
await page.waitForTimeout(500);
refusal = work.getByRole('alert');
check('asking again for work already billed is refused, with both figures named',
  (await refusal.count()) === 1
  && (await refusal.innerText()).includes(money(FORTY))
  && (await refusal.innerText()).includes(money(SIXTY_FIVE))
  && /nothing to ask for yet/.test(await refusal.innerText()),
  await refusal.innerText());
check('and no third invoice was written',
  !/2026-203/.test(await work.innerText()), 'a bill for nothing was written');

/* ==========================================================================
   3. `When it came in` — the day a cheque arrived, and what it settles.
   ========================================================================== */

const PART_PAID = 100_000n; // $1,000.00, a round cheque against the first bill.
const CAME_IN = '2026-09-15';

const firstBill = work.locator('li', { has: page.getByText('Progress payment 2026-201') }).first();
await press(firstBill.getByRole('button', { name: 'Money came in' }));
await page.waitForTimeout(300);

check('the day it came in is asked for, and starts on today rather than empty',
  /^\d{4}-\d{2}-\d{2}$/.test(await page.getByLabel('When it came in').inputValue()),
  await page.getByLabel('When it came in').inputValue());

await page.getByLabel('How much came in').fill('1000.00');
await page.getByLabel('When it came in').fill(CAME_IN);
await press(page.getByRole('button', { name: 'Cheque', exact: true }));
await page.getByLabel('Reference').fill('cheque 4471');
await press(page.getByRole('button', { name: 'Write it down' }));
await page.waitForTimeout(700);
w = await work.innerText();

check('the payment is written down on the day it was typed, for what came in',
  w.includes(`${money(PART_PAID)} by cheque on ${CAME_IN} — cheque 4471.`), w.slice(-2500));
check('and what is owed on that bill is what it asked less what came in, to the cent',
  new RegExp(`${re(PART_PAID)} in, ${re(FORTY - PART_PAID)} still out`).test(w),
  `worked out ${money(FORTY - PART_PAID)} still out on the first bill`);
out = /(\$[\d,]+\.\d\d) still out/.exec(w);
check('and what is out across the whole job drops by exactly what came in',
  out !== null && read(out[1]) === SIXTY_FIVE - PART_PAID,
  `worked out ${money(SIXTY_FIVE - PART_PAID)}, screen said ${out?.[1] ?? 'nothing'}`);

// More than is owed. An overpayment is a conversation, not a line.
await press(firstBill.getByRole('button', { name: 'Money came in' }));
await page.getByLabel('How much came in').fill('99999.00');
await page.getByLabel('When it came in').fill('2026-09-16');
await press(page.getByRole('button', { name: 'Write it down' }));
await page.waitForTimeout(500);
check('more than is owed on a bill is refused, and names both figures',
  (await page.getByRole('alert').filter({ hasText: 'is more than the' }).count()) >= 1,
  (await work.innerText()).slice(-1200));
check('and nothing was written down on the sixteenth',
  !/on 2026-09-16/.test(await work.innerText()), 'an overpayment was absorbed');

// The rest of it, on a different day. The first payment's day must not move.
await page.getByLabel('How much came in').fill(money(FORTY - PART_PAID).replace(/[$,]/g, ''));
await page.getByLabel('When it came in').fill('2026-09-22');
await press(page.getByRole('button', { name: 'Bank transfer', exact: true }));
await page.getByLabel('Reference').fill('wire 8890');
await press(page.getByRole('button', { name: 'Write it down' }));
await page.waitForTimeout(700);
w = await work.innerText();

check('the rest of it settles the bill, and the app says so with the total in',
  new RegExp(`Paid in full — ${re(FORTY)} in\\.`).test(w), w.slice(-2500));
check('the second payment lands on its own day, and the first one has not moved',
  w.includes(`${money(FORTY - PART_PAID)} by bank transfer on 2026-09-22 — wire 8890.`)
  && w.includes(`${money(PART_PAID)} by cheque on ${CAME_IN} — cheque 4471.`),
  w.slice(-2500));
out = /(\$[\d,]+\.\d\d) still out/.exec(w);
check('and what is left out is the second bill and nothing else',
  out !== null && read(out[1]) === SECOND,
  `worked out ${money(SECOND)}, screen said ${out?.[1] ?? 'nothing'}`);
/* ==========================================================================
   4. A change order raised, signed, and on the bill — so that there is
      something for the tear-up to leave alone.
   ========================================================================== */

await setStandardRates('6.00');
const second = await pricedHere(AT_SIX);

/**
 * What the six moved lines are worth, worked out here.
 *
 * A dollar a unit across the six the app ships with, against the quantities the
 * app printed on its own takeoff. That is the figure a change order for a
 * repricing is: the difference between the signed lines and the same lines now.
 *
 * Deliberately NOT `second.total - first.total`. Those two are the quoted
 * price, which carries the job's mark-up; this is the sum of the lines, which
 * does not. The app's change order is the second of those, and the gap between
 * them is a real defect written up in scratchpad/integration/drive-last.md.
 * What is checked here is the arithmetic the app actually does, to the cent,
 * against the quantities it printed itself.
 */
const MOVED = ITEMS.filter((item) => item !== 'Open span')
  .reduce((sum, item) => sum + cents(100n, second.quantities[item] ?? '0'), 0n);

check('the six rates that moved are the six the app ships with, at the quantities it printed',
  Object.keys(second.quantities).length === 7
  && JSON.stringify(second.quantities) === JSON.stringify(first.quantities),
  `${JSON.stringify(first.quantities)} then, ${JSON.stringify(second.quantities)} now`);
check('the dearer subtotal the app prints is a dollar a unit more, to the cent',
  second.subtotal === first.subtotal + MOVED,
  `worked out ${money(first.subtotal + MOVED)}, app said ${money(second.subtotal)}`);

await section(page, 'Work');
await page.waitForTimeout(600);
w = await work.innerText();
check('the agreed figure does not move because a rate did',
  new RegExp(`Agreed ${re(AGREED)}`).test(w), w.slice(0, 900));
check('the app says how many things moved, and what they are worth, to the cent',
  new RegExp(`6 things moved since this was signed, worth ${re(MOVED)}`).test(w)
  && /None of it is on a bill/.test(w),
  `worked out ${money(MOVED)} from ${JSON.stringify(second.quantities)} at a dollar a unit`);
check('and it says so again beside the money, so it is not missed',
  new RegExp(`${re(MOVED)} has moved on this job that nobody has signed for`).test(w),
  w.slice(0, 2000));

await page.getByLabel('Your change order number').fill('CO-1');
await page.getByLabel('Why this is happening').fill(WHY);
await page.getByLabel('Days this adds to the finish date').fill('3');
await press(work.getByRole('button', { name: 'Write the change order' }));
await page.waitForTimeout(600);
w = await work.innerText();

check('the change order names every line that moved, with the rate before and after',
  ITEMS.filter((item) => item !== 'Open span')
    .every((item) => new RegExp(`${item} was \\$5\\.00 per (sq ft|lf|ea), now \\$6\\.00\\.`).test(w)),
  w.slice(0, 2500));
check('and it does not name the one rate that did not move',
  !/Open span was/.test(w), w.slice(0, 2500));

await page.getByLabel('Who is signing').fill('M. Alvarez');
await page.getByLabel('I agree to sign electronically').check();
await scribble();
await press(work.getByRole('button', { name: 'Agree to this change' }));
await page.waitForTimeout(900);
w = await work.innerText();

check('the signed change order is listed, for the figure worked out here',
  new RegExp(`Change order CO-1\\s*\\n?\\s*\\+${re(MOVED)}`).test(w), w.slice(0, 2500));
check('and it says who signed it and that it is on the bill',
  /Signed by M\. Alvarez on \d{4}-\d{2}-\d{2}\. On the bill\./.test(w), w.slice(0, 2500));
check('the agreed figure now carries the signed change and nothing else',
  new RegExp(`Agreed ${re(AGREED + MOVED)}`).test(w),
  `worked out ${money(AGREED)} + ${money(MOVED)} = ${money(AGREED + MOVED)}`);
check('and nothing is left on the job that nobody has signed for',
  /Nothing has moved on this job that somebody has not signed for/.test(w), w.slice(0, 2500));

/* ==========================================================================
   5. `Send the signed copy` — the document it says it is.
   ========================================================================== */

const signedRow = work.locator('li', { has: page.getByText('Change order CO-1') }).first();
const sendSigned = signedRow.getByRole('button', { name: 'Send the signed copy' });
check('there is one way to hand over the signed change order, and only for the signed one',
  (await sendSigned.count()) === 1
  && (await work.getByRole('button', { name: 'Send the signed copy' }).count()) === 1,
  `${await work.getByRole('button', { name: 'Send the signed copy' }).count()} controls found`);

const waitCo = page.waitForEvent('download');
await press(sendSigned);
const coFile = await waitCo;
let co = '';
for await (const chunk of await coFile.createReadStream()) co += chunk;
await page.waitForTimeout(400);

check('what leaves the phone is named after this change order, by its own number',
  /-change-CO-1\.html$/.test(coFile.suggestedFilename()), coFile.suggestedFilename());
check('it is the change order, at the figure worked out here, with the reason on it',
  co.includes('CO-1') && co.includes(money(MOVED)) && co.includes(WHY),
  `looking for CO-1, ${money(MOVED)} and the reason`);
check('and it is the SIGNED copy — the signature and who made it are on it',
  /Agreed<\/h2>/.test(co) && /Signature of M\. Alvarez/.test(co),
  'the document that went out carries no signature');
check('every line that moved is in it, each one said to have been priced again',
  ITEMS.filter((item) => item !== 'Open span')
    .every((item) => new RegExp(`<td>${item}</td>\\s*<td>Priced again</td>`).test(co))
  && (co.match(/Priced again/g) ?? []).length === 6,
  `${(co.match(/Priced again/g) ?? []).length} repriced lines in the document, expected 6`);
check('and it says what the job was agreed at and what it comes to now, both worked out here',
  co.includes(money(AGREED)) && co.includes(money(AGREED + MOVED)),
  `looking for ${money(AGREED)} before and ${money(AGREED + MOVED)} after`);
check('and it fetches nothing and runs nothing, so it opens with no signal',
  !/<script/i.test(co) && !/https?:\/\//.test(co.replace(/xmlns[^ >]*/g, '')),
  'the document reaches out');

// The record of the sending is read from the hand-over log when the row draws,
// so the row has to be drawn again before it can say anything.
await section(page, 'Price');
await page.waitForTimeout(300);
await section(page, 'Work');
await page.waitForTimeout(500);
check('and the change order says, under the button, that it has left this phone',
  /left this phone once, on \d{4}-\d{2}-\d{2}/.test(await signedRow.innerText()),
  await signedRow.innerText());

/* ==========================================================================
   6. `Tear it up and start again` — proved by what it leaves behind.
   ========================================================================== */

/**
 * The open span, priced again — the one line the signed change order never saw.
 *
 * The unsigned change order has to be about a line CO-1 did not cover, and that
 * is not fussiness about realism. `notYetAgreed` in `core/src/change.ts` matches
 * a movement to a signed change order by **item and unit alone**, so moving any
 * of the six rates a second time produces nothing at all to raise a change
 * order against — measured on this build, and written up in
 * scratchpad/integration/drive-last.md as its own defect. The contractor's own
 * open-span line is not on CO-1, so a movement of it is one the app can see.
 *
 * It has no box to retype, so it is taken off the book and put back at nine
 * dollars, which is how a contractor changes one of his own rates. The quantity
 * is the 4.28 lf the app printed on its own takeoff, so what this is worth —
 * four dollars a foot of it — is arithmetic done here.
 */
const SPAN = cents(400n, first.quantities['Open span']);
{
  const rates = await openTheRates();
  await rates.getByRole('button', { name: 'Remove Open span' }).click();
  await page.waitForTimeout(300);
  await closeTheRates(rates);
}
await addOwnItem({
  name: 'Open span',
  from: 'how long the wall is, corner to corner',
  covers: 'a header over it, which nobody costed',
  price: '9.00',
});

await section(page, 'Work');
await page.waitForTimeout(700);
w = await work.innerText();
check('a line the signed change order never covered shows up as unsigned, to the cent',
  new RegExp(`1 thing moved since this was signed, worth ${re(SPAN)}`).test(w)
  && /Open span was \$5\.00 per lf, now \$9\.00\./.test(w),
  `worked out ${money(SPAN)} as four dollars a foot of ` +
    `${first.quantities['Open span']} lf`);

await page.getByLabel('Your change order number').fill('CO-2');
await page.getByLabel('Why this is happening').fill('Second thoughts about the whole thing');
await page.getByLabel('Days this adds to the finish date').fill('5');
await press(work.getByRole('button', { name: 'Write the change order' }));
await page.waitForTimeout(600);
w = await work.innerText();

check('an unsigned change order is waiting, and says it is not authorised',
  /Change order CO-2 — waiting to be signed/.test(w)
  && /none of this is authorised and none of it is billable/.test(w),
  w.slice(0, 2500));
check('and it is not offered as a signed copy, because nobody has signed it',
  (await work.getByRole('button', { name: 'Send the signed copy' }).count()) === 1
  && (await work.getByRole('button', { name: 'Send it to be signed' }).count()) === 1,
  `${await work.getByRole('button', { name: 'Send the signed copy' }).count()} signed copies offered`);
check('and it is not on the agreed figure either, because nobody has signed it',
  new RegExp(`Agreed ${re(AGREED + MOVED)}`).test(w),
  `worked out ${money(AGREED + MOVED)}, with ${money(SPAN)} unsigned beside it`);

// What the tear-up must leave exactly as it is, read before it happens.
const beforeAgreed = /Agreed (\$[\d,]+\.\d\d)/.exec(w)?.[1];
const beforeBilled = /invoiced so far (\$[\d,]+\.\d\d)/.exec(w)?.[1];
const beforeOut = /(\$[\d,]+\.\d\d) still out/.exec(w)?.[1];

const tearUp = work.getByRole('button', { name: 'Tear it up and start again' });
check('the unsigned change order has one way out',
  (await tearUp.count()) === 1, `${await tearUp.count()} controls found`);

await press(tearUp);
await page.waitForTimeout(800);
w = await work.innerText();

check('the unsigned change order is gone',
  !/Change order CO-2/.test(w) && !/waiting to be signed/.test(w), w.slice(0, 2500));
/**
 * What the boxes hold after a tear-up, and what the next change order becomes.
 *
 * `Agree to this change` empties the number, the reason and the days. `Tear it
 * up and start again` empties none of them — it calls `onRaisedChange(null)`
 * and nothing else. So the sentence somebody thought better of is still in the
 * box, and the next change order raised without retyping carries the torn-up
 * one's NUMBER and the torn-up one's REASON onto a document a client signs.
 *
 * A48 checks exactly this on the withdrawal screen, in those words: "a sentence
 * left in the box from a withdrawal somebody thought better of is a sentence
 * that gets sent with the next one without being re-read." It is the same
 * failure, on the screen where the leftover is a change order number as well as
 * a reason, and two change orders under one number is not a tidiness problem.
 *
 * Measured rather than asserted: the next one is raised with nothing retyped
 * and what it calls itself is read off the screen. The three-line fix is in
 * scratchpad/integration/drive-last.md.
 */
const leftInTheBoxes = {
  number: await page.getByLabel('Your change order number').inputValue(),
  reason: await page.getByLabel('Why this is happening').inputValue(),
  days: await page.getByLabel('Days this adds to the finish date').inputValue(),
};
await press(work.getByRole('button', { name: 'Write the change order' }));
await page.waitForTimeout(600);
const inherited = /Change order (\S+) — waiting to be signed/.exec(await work.innerText())?.[1];
const inheritedReason = /Why: ([^\n]+)/.exec(
  await work.locator('div', { hasText: 'waiting to be signed' }).last().innerText()
)?.[1];

check('tearing one up empties the boxes, so the next one is not the torn-up one again',
  leftInTheBoxes.number === '' && leftInTheBoxes.reason === ''
  && leftInTheBoxes.days === '0'
  && inherited !== 'CO-2',
  `after the tear-up the boxes still held number "${leftInTheBoxes.number}", ` +
    `reason "${leftInTheBoxes.reason}", days "${leftInTheBoxes.days}", and the next ` +
    `change order raised with nothing retyped called itself "${inherited}" with the ` +
    `reason "${inheritedReason}". Work.tsx clears all three on Agree and none of ` +
    'them on Tear it up; the fix is in scratchpad/integration/drive-last.md.');

// Torn up again, so the rest of this part is looking at a job with one signed
// change order on it and nothing waiting — which is the state it was in before
// the paragraph above, whichever way that check went.
if ((await work.getByRole('button', { name: 'Tear it up and start again' }).count()) === 1) {
  await press(work.getByRole('button', { name: 'Tear it up and start again' }));
  await page.waitForTimeout(700);
}
w = await work.innerText();
check('the unsigned change order is gone again, whatever the boxes held',
  !/waiting to be signed/.test(w), w.slice(0, 2000));

// The whole point of the control: everything else is exactly as it was.
check('the change order somebody DID sign is still there, at its own figure',
  new RegExp(`Change order CO-1\\s*\\n?\\s*\\+${re(MOVED)}`).test(w)
  && /Signed by M\. Alvarez on \d{4}-\d{2}-\d{2}\. On the bill\./.test(w),
  w.slice(0, 2500));
check('the agreed figure is exactly what it was before the tear-up',
  /Agreed (\$[\d,]+\.\d\d)/.exec(w)?.[1] === beforeAgreed
  && read(beforeAgreed ?? '0') === AGREED + MOVED,
  `${beforeAgreed} before, ${/Agreed (\$[\d,]+\.\d\d)/.exec(w)?.[1]} after, ` +
    `worked out ${money(AGREED + MOVED)}`);
check('nothing was unbilled by it',
  /invoiced so far (\$[\d,]+\.\d\d)/.exec(w)?.[1] === beforeBilled
  && read(beforeBilled ?? '0') === SIXTY_FIVE,
  `${beforeBilled} before, ${/invoiced so far (\$[\d,]+\.\d\d)/.exec(w)?.[1]} after, ` +
    `worked out ${money(SIXTY_FIVE)}`);
check('and nothing that came in went back out',
  /(\$[\d,]+\.\d\d) still out/.exec(w)?.[1] === beforeOut
  && w.includes(`${money(PART_PAID)} by cheque on ${CAME_IN} — cheque 4471.`)
  && new RegExp(`Paid in full — ${re(FORTY)} in\\.`).test(w),
  `${beforeOut} before, ${/(\$[\d,]+\.\d\d) still out/.exec(w)?.[1]} after`);
check('both invoices are still on the job, under their own numbers',
  /Progress payment 2026-201/.test(w) && /Progress payment 2026-202/.test(w), w.slice(-3000));
check('and the day in the calendar is untouched by any of it',
  /Tear-out, dining room/.test(w), w.slice(0, 1200));

await section(page, 'Agreement');
await page.waitForTimeout(500);
t = await agree.innerText();
check('the agreement is still agreed, at the figure it was signed at',
  new RegExp(`Agreed — As measured, ${re(AGREED)}`).test(t) && !/Withdrawn/.test(t),
  t.slice(0, 1200));
check('and its signature is still on the screen',
  (await agree.locator('img[alt*="ignature"]').count()) >= 1,
  'the signature went with the torn-up change order');

// And the job can raise another one, because tearing up is starting again.
await section(page, 'Work');
await page.waitForTimeout(600);
check('and there is a way to write the next one, which is what "start again" means',
  (await work.getByRole('button', { name: 'Write the change order' }).count()) === 1
  && new RegExp(`1 thing moved since this was signed, worth ${re(SPAN)}`)
    .test(await work.innerText()),
  'tearing one up left no way to write the next, or lost what it was about');

/* ==========================================================================
   7. Put down and picked up again. A tear-up that comes back is not a tear-up.
   ========================================================================== */

await page.reload({ waitUntil: 'networkidle' });
await loadScan(page, 'dining.json');
await section(page, 'Work');
await page.waitForTimeout(900);
w = await work.innerText();

check('the torn-up change order does not come back after a reload',
  !/Change order CO-2/.test(w), w.slice(0, 2500));
check('the signed one does, at its own figure and still on the bill',
  new RegExp(`Change order CO-1\\s*\\n?\\s*\\+${re(MOVED)}`).test(w)
  && /On the bill\./.test(w), w.slice(0, 2500));
check('both bills come back, and so do both payments, on their own days',
  /Progress payment 2026-201/.test(w) && /Progress payment 2026-202/.test(w)
  && w.includes(`by cheque on ${CAME_IN} — cheque 4471.`)
  && w.includes('by bank transfer on 2026-09-22 — wire 8890.'),
  w.slice(-3000));
check('and what is still out is the second bill and nothing else',
  read(/(\$[\d,]+\.\d\d) still out/.exec(w)?.[1] ?? '0') === SECOND,
  `worked out ${money(SECOND)}, screen said ${/(\$[\d,]+\.\d\d) still out/.exec(w)?.[1] ?? 'nothing'}`);
check('and the day in the calendar came back with what they need to know on it',
  /Tear-out, dining room/.test(w), w.slice(0, 1200));

check('no console or page errors across the whole run', noise().length === 0, noise().join(' | '));

const bad = report('A55 — a share of the job, money in, and a change order torn up');
await ctx.close();
await browser.close();
process.exit(bad > 0 ? 1 : 0);
