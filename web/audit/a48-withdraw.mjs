import { check, loadScan, noise, open, report, section } from './lib.mjs';

/**
 * The way out of an agreement, and the record it leaves behind.
 *
 * > **"Withdraw it, with a reason, kept on the record."**
 * > **"Withdraw them too, as reversals."**
 * > — Sam, asked whether there should be a way out once a job is agreed, and
 * >   then what happens to the invoices already raised against it.
 *
 * ## The defect this part exists for
 *
 * Nothing could undo an agreement. `state.ts` said so in a comment — a baseline
 * is written once and never edited, so there is no action that changes one —
 * and `Tear it up and start again` on the Work screen discards an *unsigned
 * change order*, not the agreement. So a contractor who froze the job on the
 * wrong photograph, or whose client walked away on the Monday, held an
 * agreement he could not edit, could not leave, and would go on being invoiced
 * against.
 *
 * ## What must NOT have been done to fix it
 *
 * The agreement must not have been deleted, and the bills must not have
 * vanished. The whole defence of this product is that every later difference
 * between the room and the signed scope surfaces as a priced change order
 * somebody signs — and a withdrawal that quietly removed a baseline would be
 * the way round it: withdraw, edit the price up, re-freeze, and $1,623 goes on
 * a job with nobody signing for it.
 *
 * So every check below that looks for the withdrawn agreement still being on
 * the screen, still carrying its signature, still carrying its price, is also a
 * check that nobody made withdrawing into deleting. And the last section is the
 * one that matters most: the job agreed again, dearer, with the difference in
 * money printed beside the reason it was withdrawn.
 *
 * ## The word
 *
 * **Withdraw**, everywhere. Never "delete" — nothing is deleted. Never
 * "cancel": on this very screen "cancel" is the buyer's federal three-day right
 * under 16 CFR 429, it belongs to the buyer, it runs on a clock and it has two
 * forms attached. Two meanings of one word on one job is how the wrong one gets
 * relied on.
 *
 * ## Every figure here is worked out on this side
 *
 * The agreed total, the deposit, the final, and both reversals are computed in
 * this file in integer cents from the quantities the app printed on its own
 * takeoff and the rate typed into it. Nothing is read off one screen and
 * compared with the same screen. A job that nets to zero against its own
 * arithmetic proves nothing; the failure this feature can produce is a set of
 * numbers that agree with each other perfectly and a bill that has gone
 * missing.
 *
 * ## The order these would break in
 *
 *   1. The job is agreed, and billed twice, at figures worked out here.
 *   2. A withdrawal with no reason on it is refused, where the thumb is.
 *   3. So is a reason too thin to mean anything.
 *   4. With a reason, it is withdrawn — and the agreement is still on screen,
 *      whole, with its signature, its price and the reason beside it.
 *   5. Every bill has a reversal for exactly its own figure; the net is zero;
 *      both halves are still listed.
 *   6. The QuickBooks export carries all four and never says a bill went.
 *   7. The document that leaves the phone says it too.
 *   8. The job can be agreed again, dearer, and the difference is printed in
 *      money beside the reason — nothing was laundered past the change order.
 *   9. All of it survives being put down and picked up again.
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

/** A percentage of a figure, rounded half up in cents — the app's own rule. */
const share = (total, perCent) => (total * BigInt(perCent) * 100n + 5000n) / 10000n;

// The harness's own arithmetic, checked before anything is trusted to it.
if (cents(500n, '408.8') !== 204400n) throw new Error('the audit cannot multiply; fix it first');
if (money(796656n) !== '$7,966.56') throw new Error('the audit cannot spell money; fix it first');
if (share(403050n, 30) !== 120915n) throw new Error('the audit cannot take a share; fix it first');
if (money(-120915n) !== '-$1,209.15') throw new Error('the audit cannot sign money; fix it first');

/* ==================================================================== */

const WHY = 'They pulled out before the tear-out started.';

const { browser, ctx, page } = await open();
await loadScan(page, 'dining.json');

/**
 * A control pressed by focusing it and hitting Enter, which is also the
 * screen-reader path — the same reason `pick` in `lib.mjs` does it.
 *
 * Not a preference. The tab bar is fixed to the bottom of a 430 by 800 phone,
 * and the button that agrees the job sits at the very end of a long screen: it
 * cannot be scrolled clear of the bar, because there is nothing below it to
 * scroll. A pointer click on it lands on the tab bar, is retried for thirty
 * seconds and then throws, taking the whole part down and reporting nothing —
 * which is how this part failed intermittently while it was being written, and
 * exactly the failure `a38` warns about. Keyboard activation reaches the button
 * that is actually there, and focusing it brings it on screen on the way.
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

/** Every rate on the job set to one figure, and the open span given one. */
async function setEveryRate(dollars, { addOpenSpan = false } = {}) {
  await section(page, 'Price');
  await page.getByRole('button', { name: /Set your rates|Your rates/ }).first().click();
  await page.waitForTimeout(300);
  const rates = page
    .locator('section', { has: page.getByRole('heading', { name: 'What you charge' }) })
    .first();
  for (const box of await rates.getByRole('textbox').all()) {
    await box.fill(dollars);
    await box.blur();
    await page.waitForTimeout(80);
  }
  if (addOpenSpan) {
    // A dining room open to the next room has one, it is on the takeoff, and a
    // proposal will not go out while anything on the sheet has no price on it.
    await rates.getByLabel('What you call it').fill('Open span');
    await rates
      .getByLabel('Where its quantity comes from')
      .selectOption({ label: 'how long the wall is, corner to corner' });
    await page.waitForTimeout(150);
    await rates.getByLabel('What it covers', { exact: true }).fill('nothing built across it');
    await rates.getByLabel(/^What you charge, per/).fill(dollars);
    await rates.getByRole('button', { name: 'Add it to your rates' }).click();
    await page.waitForTimeout(300);
  }
  await rates.getByRole('button', { name: 'Done' }).first().click();
  await page.waitForTimeout(400);
}

const ITEMS = ['Floor', 'Wall face', 'Ceiling', 'Baseboard', 'Doors', 'Windows', 'Open span'];

/**
 * The job priced on this side, from the app's own takeoff, at the rates this
 * side believes are in the book.
 *
 * `rates` is per item rather than one figure, and that is not fussiness. A rate
 * the contractor adds himself — the open span — is listed on the rates screen
 * with a Remove button and **no box to type in**, so raising every rate in the
 * app raises the six standard ones and leaves his own where he set it. This
 * side knows that and counts it at what it actually is. If that ever changes,
 * the total this works out stops matching the total the app prints, and the
 * check below says so with both figures.
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
    total: subtotal + (subtotal * points + 5000n) / 10_000n,
    lines: Object.keys(quantities).length,
    quantities,
    priced,
  };
}

/* ==========================================================================
   1. The job, agreed and billed.
   ========================================================================== */

/** Every rate at $5.00, the open span included, because it is added at $5.00. */
const AT_FIVE = Object.fromEntries(ITEMS.map((item) => [item, 500n]));
/** Every standard rate at $6.00. The contractor's own line cannot be retyped. */
const AT_SIX = { ...Object.fromEntries(ITEMS.map((item) => [item, 600n])), 'Open span': 500n };

await setEveryRate('5.00', { addOpenSpan: true });
const first = await pricedHere(AT_FIVE);
check('every priced line on the takeoff was read off the app’s own sheet',
  first.lines === 7, `read ${JSON.stringify(first.quantities)}`);
check('the total the app prints is the one worked out here from its own quantities',
  first.priced.includes(money(first.total)),
  `worked out ${money(first.total)} from ${JSON.stringify(first.quantities)} at $5.00`);

const AGREED = first.total;
const DEPOSIT = share(AGREED, 30);
const FINAL = AGREED - DEPOSIT;

await page.getByRole('button', { name: 'Your business' }).click();
await page.waitForTimeout(400);
await page.getByRole('textbox', { name: /Business name/i }).first().fill('Alvarez Remodeling');
await page.getByRole('textbox', { name: /Business address/i }).first()
  .fill('2200 Oak Street, Mesa AZ 85201');
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForTimeout(500);

await section(page, 'Agreement');
const panel = page.locator('[data-panel="agree"]');
await press(page.getByRole('button', { name: 'Write the proposal' }));
await page.waitForTimeout(400);
await page.getByLabel('Who it is for').fill('M. Alvarez');
await page.getByLabel('Address of the work').fill('14 Sycamore');
await press(page.getByRole('button', { name: 'Save these details' }));
await page.waitForTimeout(400);
await panel.getByRole('button', { name: 'Their home', exact: true }).click();
await page.waitForTimeout(200);
await press(page.getByRole('button', { name: 'Take this one' }).first());
await page.waitForTimeout(400);
await page.getByLabel('Your name').fill('M. Alvarez');
await page.getByLabel('I agree to sign electronically').check();
await scribble();
await press(page.getByRole('button', { name: /^Agree to / }));
await page.waitForTimeout(800);

let t = await panel.innerText();
check('the job is agreed, at the figure worked out here',
  new RegExp(`Agreed — As measured, ${money(AGREED).replace(/[$.]/g, '\\$&')}`).test(t),
  t.slice(0, 900));

await section(page, 'Work');
await page.waitForTimeout(500);
const work = page.locator('[data-panel="work"]');

await page.getByLabel('Your invoice number').fill('2026-101');
await page.getByLabel('When it is due').fill('2026-09-30');
await page.getByLabel('How to pay you').fill('Cheque to the address above');
await press(work.getByRole('button', { name: 'Deposit' }));
await page.getByLabel('Deposit, per cent of the job').fill('30');
await press(page.getByRole('button', { name: 'Write the invoice' }));
await page.waitForTimeout(700);

await page.getByLabel('Your invoice number').fill('2026-102');
await press(work.getByRole('button', { name: 'Final payment' }));
await press(page.getByRole('button', { name: 'Write the invoice' }));
await page.waitForTimeout(700);
let w = await work.innerText();

const askedDeposit = /Deposit 2026-101\s*\n?\s*(\$[\d,]+\.\d\d)/.exec(w);
const askedFinal = /Final payment 2026-102\s*\n?\s*(\$[\d,]+\.\d\d)/.exec(w);
check('the deposit asks for the share worked out here, to the cent',
  askedDeposit !== null && read(askedDeposit[1]) === DEPOSIT,
  `worked out ${money(DEPOSIT)}, screen said ${askedDeposit?.[1] ?? 'nothing'}`);
check('and the final asks for the rest of it, to the cent',
  askedFinal !== null && read(askedFinal[1]) === FINAL,
  `worked out ${money(FINAL)}, screen said ${askedFinal?.[1] ?? 'nothing'}`);
check('and the two of them are the whole agreed job',
  DEPOSIT + FINAL === AGREED, `${money(DEPOSIT)} + ${money(FINAL)} vs ${money(AGREED)}`);

const stillOut = /(\$[\d,]+\.\d\d) still out/.exec(w);
check('the whole of it is out',
  stillOut !== null && read(stillOut[1]) === AGREED,
  `worked out ${money(AGREED)}, screen said ${stillOut?.[1] ?? 'nothing'}`);

/* ==========================================================================
   2 & 3. The refusals — and WHERE they appear.
   ========================================================================== */

await section(page, 'Agreement');
await page.waitForTimeout(400);

const open1 = panel.getByRole('button', { name: 'Withdraw this agreement' });
check('there is one way out of an agreement, and it says what it does',
  (await open1.count()) === 1, `${await open1.count()} controls found`);
t = await panel.innerText();
check('and it says, before it is pressed, what happens to the job and to the bills',
  /goes back to being a quote you can edit/.test(t)
  && /every invoice raised against it is reversed/i.test(t)
  && /Nothing is deleted/.test(t),
  t.slice(-1800));

await press(open1);
await page.waitForTimeout(400);

const doIt = panel.getByRole('button', { name: /^Withdraw the agreement — / });
check('the confirming button names the money it is withdrawing',
  (await doIt.count()) === 1 && (await doIt.innerText()).includes(money(AGREED)),
  (await doIt.count()) === 1 ? await doIt.innerText() : 'no button');

// Backing out has to be free, and it has to take the half-typed reason with
// it. A sentence left in the box from a withdrawal somebody thought better of
// is a sentence that gets sent with the next one without being re-read.
await page.getByLabel('Why you are withdrawing it')
  .fill('Typed this and then thought better of it.');
await press(panel.getByRole('button', { name: 'Not now' }));
await page.waitForTimeout(400);
check('backing out of a withdrawal is free, and withdraws nothing',
  (await panel.getByRole('button', { name: /^Withdraw the agreement — / }).count()) === 0
  && (await panel.getByRole('heading', { name: /^Withdrawn — / }).count()) === 0
  && (await panel.getByRole('button', { name: 'Withdraw this agreement' }).count()) === 1,
  'backing out either left the box open or withdrew the agreement');

await press(panel.getByRole('button', { name: 'Withdraw this agreement' }));
await page.waitForTimeout(400);
check('and the reason box is empty again, not holding what was typed before',
  (await page.getByLabel('Why you are withdrawing it').inputValue()) === '',
  await page.getByLabel('Why you are withdrawing it').inputValue());
// Emptied here as well as checked above, and the two are doing different jobs.
// The check says whether the app kept a sentence it should have dropped; this
// makes sure that when it has, the next press does not WITHDRAW THE AGREEMENT
// on a leftover reason and take the rest of the part down with it. A check that
// crashes the run reports nothing at all, including itself.
await page.getByLabel('Why you are withdrawing it').fill('');

const tall = page.viewportSize().height;

/**
 * How far a refusal ended up from the button that caused it, and whether a
 * thumb could see either of them.
 *
 * Both measured AFTER the refusal has appeared, in the layout the person is
 * actually looking at — not before the press, when the button is somewhere it
 * will not be a moment later. This app shipped a refusal 280px from its own
 * button once, on a 430 by 800 phone, and the person never saw it.
 */
async function howFarApart(button, message) {
  const said = await message.boundingBox();
  const pressed = await button.boundingBox();
  if (!said || !pressed) return null;
  return {
    apart: Math.abs(said.y - pressed.y),
    seen: said.y >= 0 && said.y <= tall && pressed.y >= 0 && pressed.y <= tall,
  };
}

// Pressed with nothing in the box.
await press(doIt);
await page.waitForTimeout(400);

let refusal = panel.getByRole('alert').filter({ hasText: 'Say why this agreement is being' });
check('withdrawing with no reason is refused, and says why',
  (await refusal.count()) === 1, (await panel.innerText()).slice(-1200));
check('and the refusal says it is not a deletion, which is the reason for the box',
  /not deleting it/.test(await panel.innerText()), (await panel.innerText()).slice(-1200));

let apart = (await refusal.count()) === 1 ? await howFarApart(doIt, refusal) : null;
check('the refusal and its button are both on the screen at a real phone height',
  apart !== null && apart.seen,
  `viewport ${tall}, ${apart ? Math.round(apart.apart) : 'nothing'}px apart`);
check('and it is beside the button that was pressed, not a panel above it',
  apart !== null && apart.apart < 150,
  `${apart ? Math.round(apart.apart) : 'none'}px from the button`);
check('and nothing was withdrawn',
  (await panel.getByRole('heading', { name: /^Withdrawn — / }).count()) === 0,
  'the agreement went without a reason on it');

// A label rather than a reason.
await page.getByLabel('Why you are withdrawing it').fill('mistake');
await press(doIt);
await page.waitForTimeout(400);
refusal = panel.getByRole('alert').filter({ hasText: 'is a label, not a reason' });
check('a reason too thin to mean anything in two years is refused',
  (await refusal.count()) === 1, (await panel.innerText()).slice(-1200));
apart = (await refusal.count()) === 1 ? await howFarApart(doIt, refusal) : null;
check('and that refusal is beside its button too, and both can be seen',
  apart !== null && apart.seen && apart.apart < 150,
  `${apart ? Math.round(apart.apart) : 'none'}px from the button, ` +
    `both on screen: ${apart ? apart.seen : 'unknown'}`);
check('and still nothing was withdrawn',
  (await panel.getByRole('heading', { name: /^Withdrawn — / }).count()) === 0,
  'a one-word label was accepted as a reason');

/* ==========================================================================
   4. With a reason. Withdrawn — and still there.
   ========================================================================== */

await page.getByLabel('Why you are withdrawing it').fill(WHY);
await press(panel.getByRole('button', { name: /^Withdraw the agreement — / }));
await page.waitForTimeout(900);
t = await panel.innerText();

check('with a reason on it, the agreement is withdrawn',
  new RegExp(`Withdrawn — As measured, ${money(AGREED).replace(/[$.]/g, '\\$&')}`).test(t),
  t.slice(0, 1500));
check('the job is no longer showing as agreed',
  !/Agreed — As measured/.test(t), t.slice(0, 1500));
check('the reason is on the record, in the contractor’s own words',
  t.includes(`Why: ${WHY}`), t.slice(0, 1500));
check('and the day it was withdrawn is on it',
  /Withdrawn on \d{4}-\d{2}-\d{2}\./.test(t), t.slice(0, 1500));
check('the withdrawn agreement still says what it agreed and when',
  /It was agreed on \d{4}-\d{2}-\d{2} at/.test(t) && t.includes(money(AGREED)),
  t.slice(0, 1500));
check('and it says, in as many words, that nothing has been erased',
  /Nothing has been erased/.test(t), t.slice(0, 1500));
check('the signature on the withdrawn agreement is still on the screen',
  (await panel.locator('img[alt$="on the withdrawn agreement"]').count()) === 1,
  'the signature went with the agreement');

// The word. "Cancel" is the buyer's federal three-day right on this same
// screen, so the check is scoped to the withdrawn block rather than the page.
// Read only if it is there: a locator that waits thirty seconds and then
// throws takes the whole run down and hides every other result with it, which
// is exactly what happened the first time this was run against a build that
// dropped the block.
const withdrawnSection = panel
  .locator('section', { has: page.getByRole('heading', { name: /^Withdrawn — / }) })
  .first();
const withdrawnBlock = (await withdrawnSection.count()) > 0
  ? await withdrawnSection.innerText()
  : '';
check('the withdrawn agreement is a block of its own on the screen',
  withdrawnBlock !== '', 'there is no withdrawn agreement anywhere on the Agreement screen');
check('the word on the screen is withdraw, never delete and never cancel',
  withdrawnBlock !== ''
  && !/delete/i.test(withdrawnBlock) && !/cancel/i.test(withdrawnBlock), withdrawnBlock);

// Scoped to the proposal's own section: the signature pad has a control of the
// same name for wiping the drawing, and picking the wrong one would clear a
// canvas rather than reopen a document.
const proposalSection = panel
  .locator('section', { has: page.getByRole('heading', { name: 'The proposal' }) })
  .first();
check('and the proposal is a quote he can edit again',
  (await proposalSection.getByRole('button', { name: 'Start again' }).count()) === 1
  && (await panel.getByLabel('Address of the work').count()) === 1,
  'the proposal is still frozen after the agreement was withdrawn');

/* ==========================================================================
   5. The bills. Reversed, not deleted.
   ========================================================================== */

await section(page, 'Work');
await page.waitForTimeout(600);
w = await work.innerText();

check('the Work screen says the agreement was withdrawn, and why',
  /agreement was withdrawn on \d{4}-\d{2}-\d{2}/.test(w) && w.includes(WHY),
  w.slice(0, 1600));
check('and that no change order can be raised against it',
  /no change order to raise on it/.test(w), w.slice(0, 1600));
check('it says how many bills went back, and for how much',
  new RegExp(`2 invoices raised against it were reversed, for ${money(AGREED).replace(/[$.]/g, '\\$&')} in total`)
    .test(w),
  w.slice(0, 2000));

// Both halves of both bills, still listed.
check('the deposit is still on the record, for what it asked',
  new RegExp(`Deposit 2026-101\\s*\\n?\\s*${money(DEPOSIT).replace(/[$.]/g, '\\$&')}`).test(w),
  w.slice(-3000));
check('the final is still on the record, for what it asked',
  new RegExp(`Final payment 2026-102\\s*\\n?\\s*${money(FINAL).replace(/[$.]/g, '\\$&')}`).test(w),
  w.slice(-3000));
check('the deposit has a reversal for exactly its own figure',
  new RegExp(`Reversal 2026-101-R\\s*\\n?\\s*${money(-DEPOSIT).replace(/[$.]/g, '\\$&')}`).test(w),
  w.slice(-3000));
check('the final has a reversal for exactly its own figure',
  new RegExp(`Reversal 2026-102-R\\s*\\n?\\s*${money(-FINAL).replace(/[$.]/g, '\\$&')}`).test(w),
  w.slice(-3000));
check('each reversal says which bill it reversed, and why',
  /Reverses deposit 2026-101 in full/.test(w)
  && /Reverses final payment 2026-102 in full/.test(w)
  && w.includes(WHY),
  w.slice(-3000));
check('and each says the bill it reversed is still here',
  /Invoice 2026-101 stays on this job exactly as it was sent/.test(w)
  && /Nothing has been deleted/.test(w),
  w.slice(-3000));
check('nothing is owed on the job, and the screen says so without saying money came in',
  /Every invoice raised on this job has been reversed\. Nothing is owed on it/.test(w)
  && !/Everything asked for is in/.test(w),
  w.slice(0, 2000));
check('no reversal offers to take a payment against it',
  (await work.getByRole('button', { name: 'Money came in' }).count()) === 0,
  'a reversal was offered a payment');
check('and nothing on the withdrawn job asks to be invoiced',
  (await work.getByRole('button', { name: 'Write the invoice' }).count()) === 0,
  'the app offered to bill a withdrawn agreement');

// The four figures, added up on this side, in cents.
const rows = [...w.matchAll(/(?:Deposit|Final payment|Reversal) [\d-]+R?\s*\n\s*(-?\$[\d,]+\.\d\d)/g)];
const net = rows.reduce((sum, row) => {
  const size = read(row[1]);
  return row[1].startsWith('-') ? sum - size : sum + size;
}, 0n);
check('the four figures on the screen add up to exactly nothing',
  rows.length === 4 && net === 0n,
  `${rows.length} figures: ${rows.map((r) => r[1]).join(', ')} → ${money(net)}`);

/* ==========================================================================
   6. The file a bookkeeper opens.
   ========================================================================== */

const waitCsv = page.waitForEvent('download');
await press(page.getByRole('button', { name: 'Send to QuickBooks' }));
const csvFile = await waitCsv;
let csv = '';
for await (const chunk of await csvFile.createReadStream()) csv += chunk;
await page.waitForTimeout(300);

const plain = (value) => `${value < 0n ? '-' : ''}${(value < 0n ? -value : value) / 100n}.` +
  `${`${(value < 0n ? -value : value) % 100n}`.padStart(2, '0')}`;

check('the export is a file', /\.csv$/.test(csvFile.suggestedFilename()),
  csvFile.suggestedFilename());
check('the two bills are still in it, under their own numbers',
  csv.includes('2026-101,') && csv.includes('2026-102,'), csv.slice(0, 400));
check('and so are their reversals, under numbers of their own',
  csv.includes('2026-101-R,') && csv.includes('2026-102-R,'), csv.slice(0, 400));
check('the reversals carry the negative figures worked out here',
  csv.includes(`,${plain(-DEPOSIT)},`) && csv.includes(`,${plain(-FINAL)},`),
  `looking for ${plain(-DEPOSIT)} and ${plain(-FINAL)}`);
check('the export says why, on every reversal row',
  csv.includes(WHY) && /Reverses deposit 2026-101 in full/.test(csv), csv.slice(0, 900));
check('and it never tells a bookkeeper a bill was deleted, cancelled or voided',
  !/deleted/i.test(csv) || /Nothing has been deleted/.test(csv),
  'the export said a bill went');
check('and never the words that would let one be written off',
  !/\bvoided\b/i.test(csv) && !/\bcancelled\b/i.test(csv), csv.slice(0, 900));

/* ==========================================================================
   7. The document that leaves the phone.
   ========================================================================== */

await section(page, 'Agreement');
await page.waitForTimeout(400);
const waitDoc = page.waitForEvent('download');
await press(page.getByRole('button', { name: /^Send th(is|e signed) proposal$/ }));
const doc = await waitDoc;
let html = '';
for await (const chunk of await doc.createReadStream()) html += chunk;
await page.waitForTimeout(400);

check('the document that goes out says an agreement was withdrawn',
  /Withdrawn agreement/.test(html), 'the document is silent about the withdrawal');
check('and it carries the reason, the date and the figure',
  html.includes(WHY) && /Withdrawn on \d{4}-\d{2}-\d{2}\./.test(html)
  && html.includes(money(AGREED)),
  'the document has the heading and none of the record');
check('and it says nothing has been erased',
  /Nothing has been erased/.test(html), 'the document does not say the record is kept');
check('and it still fetches nothing and runs nothing',
  !/<script/i.test(html) && !/https?:\/\//.test(html.replace(/xmlns[^ >]*/g, '')),
  'the document reaches out');

/* ==========================================================================
   8. Agreed again, dearer — and nothing laundered past the change order.
   ========================================================================== */

await section(page, 'Agreement');
await press(proposalSection.getByRole('button', { name: 'Start again' }));
await page.waitForTimeout(400);
await setEveryRate('6.00');
const second = await pricedHere(AT_SIX);
const RAISED = second.total;
check('the dearer total the app prints is the one worked out here',
  second.priced.includes(money(RAISED)),
  `worked out ${money(RAISED)} from ${JSON.stringify(second.quantities)} at $6.00`);
check('the job is dearer than it was agreed at',
  RAISED > AGREED, `${money(AGREED)} then, ${money(RAISED)} now`);

await section(page, 'Agreement');
await press(page.getByRole('button', { name: 'Write the proposal' }));
await page.waitForTimeout(500);
await page.getByLabel('Who it is for').fill('M. Alvarez');
await page.getByLabel('Address of the work').fill('14 Sycamore');
await press(page.getByRole('button', { name: 'Save these details' }));
await page.waitForTimeout(400);
await press(page.getByRole('button', { name: 'Take this one' }).first());
await page.waitForTimeout(400);
t = await panel.innerText();

// The whole of the new total, not a difference. There is no door to a second
// agreement that is not a whole agreement.
const agreeAgain = panel.getByRole('button', { name: /^Agree to / });
check('agreeing again asks for a signature on the WHOLE of the new total',
  (await agreeAgain.count()) === 1 && (await agreeAgain.innerText()).includes(money(RAISED)),
  (await agreeAgain.count()) === 1 ? await agreeAgain.innerText() : 'no button');

await page.getByLabel('Your name').fill('M. Alvarez');
await page.getByLabel('I agree to sign electronically').check();
await scribble();
await press(agreeAgain);
await page.waitForTimeout(900);
t = await panel.innerText();

check('the job is agreed again, at the new figure worked out here',
  new RegExp(`Agreed — As measured, ${money(RAISED).replace(/[$.]/g, '\\$&')}`).test(t),
  t.slice(0, 1200));
check('the withdrawn agreement is still there, at its own figure',
  new RegExp(`Withdrawn — As measured, ${money(AGREED).replace(/[$.]/g, '\\$&')}`).test(t)
  && t.includes(WHY),
  t.slice(0, 2500));
// The line that stops this being a way round the change order: the difference
// between the two agreements, in money, on the screen, beside the reason.
check('and the difference between the two is printed in money, beside the reason',
  new RegExp(
    `Agreed at ${money(AGREED).replace(/[$.]/g, '\\$&')} on \\d{4}-\\d{2}-\\d{2}, withdrawn on ` +
    `\\d{4}-\\d{2}-\\d{2}, agreed again at ${money(RAISED).replace(/[$.]/g, '\\$&')} on ` +
    `\\d{4}-\\d{2}-\\d{2} — ${money(RAISED - AGREED).replace(/[$.]/g, '\\$&')} more`
  ).test(t),
  t.slice(0, 2500));
check('and it says the difference did not go through a change order',
  /did not go through a change order/.test(t)
  && /whole of the new agreement was agreed on its own/.test(t),
  t.slice(0, 2500));

await section(page, 'Work');
await page.waitForTimeout(600);
w = await work.innerText();
const nowAgreed = /Agreed (\$[\d,]+\.\d\d)/.exec(w);
check('the Work screen bills against the new agreement',
  nowAgreed !== null && read(nowAgreed[1]) === RAISED,
  `worked out ${money(RAISED)}, screen said ${nowAgreed?.[1] ?? 'nothing'}`);
const billedSoFar = /invoiced so far (\$[\d,]+\.\d\d)/.exec(w);
check('and nothing counts as invoiced, because every old bill went back',
  billedSoFar !== null && read(billedSoFar[1]) === 0n,
  `screen said ${billedSoFar?.[1] ?? 'nothing'} invoiced so far`);

await page.getByLabel('Your invoice number').fill('2026-103');
await page.getByLabel('When it is due').fill('2026-10-31');
await page.getByLabel('How to pay you').fill('Cheque to the address above');
await press(work.getByRole('button', { name: 'Final payment' }));
await press(page.getByRole('button', { name: 'Write the invoice' }));
await page.waitForTimeout(800);
w = await work.innerText();
const asked = /Final payment 2026-103\s*\n?\s*(\$[\d,]+\.\d\d)/.exec(w);
check('the first bill on the new agreement asks for the whole of it, to the cent',
  asked !== null && read(asked[1]) === RAISED,
  `worked out ${money(RAISED)}, invoice asked ${asked?.[1] ?? 'nothing'}`);
const outNow = /(\$[\d,]+\.\d\d) still out/.exec(w);
check('and what is still out is that and nothing else — the reversed bills are not owed',
  outNow !== null && read(outNow[1]) === RAISED,
  `worked out ${money(RAISED)}, screen said ${outNow?.[1] ?? 'nothing'}`);

/* ==========================================================================
   9. Put down and picked up again.
   ========================================================================== */

await page.reload({ waitUntil: 'networkidle' });
await loadScan(page, 'dining.json');
await section(page, 'Agreement');
await page.waitForTimeout(800);
t = await page.locator('[data-panel="agree"]').innerText();
check('the withdrawn agreement comes back after a reload, with its reason',
  new RegExp(`Withdrawn — As measured, ${money(AGREED).replace(/[$.]/g, '\\$&')}`).test(t)
  && t.includes(WHY),
  t.slice(0, 2500));
check('and so does the agreement that replaced it',
  new RegExp(`Agreed — As measured, ${money(RAISED).replace(/[$.]/g, '\\$&')}`).test(t),
  t.slice(0, 2500));

await section(page, 'Work');
await page.waitForTimeout(700);
w = await work.innerText();
check('the reversed bills come back too, both halves of both',
  /Deposit 2026-101/.test(w) && /Reversal 2026-101-R/.test(w)
  && /Final payment 2026-102/.test(w) && /Reversal 2026-102-R/.test(w),
  w.slice(-3000));
check('and what is still out is the new agreement and nothing else',
  new RegExp(`${money(RAISED).replace(/[$.]/g, '\\$&')} still out`).test(w),
  w.slice(0, 1500));

check('no console or page errors across the whole run', noise().length === 0, noise().join(' | '));

const bad = report('A48 — withdrawing an agreement, and the record it leaves');
await ctx.close();
await browser.close();
process.exit(bad > 0 ? 1 : 0);
