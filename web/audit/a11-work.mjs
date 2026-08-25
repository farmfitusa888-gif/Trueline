import { check, loadScan, noise, open, report, section } from './lib.mjs';

/**
 * The calendar and the invoice: the two things every competitor charges a
 * monthly fee for, neither of which needs a service.
 *
 * The check that matters most is the last one. An invoice is built from what
 * somebody signed, and the same work must not be billable twice — that failure
 * is not a bug, it is the thing that costs a contractor a customer.
 */
const { browser, ctx, page } = await open();
await loadScan(page);

/* ------------------------------------------------ nothing signed yet */

await section(page, 'Work');
let t = await page.locator('body').innerText();
check('a calendar is offered before anything is signed',
  /When it happens/.test(t), t.slice(0, 300));
check('but nothing can be invoiced against an unsigned job',
  /built from what somebody signed/.test(t), t.slice(0, 600));

/* ------------------------------------------------------ the calendar */

await page.getByLabel('What is it').fill('Kitchen — tear out');
await page.getByLabel('Day').fill('2026-09-01');
await page.getByLabel('Starts at').fill('08:00');
await page.getByLabel('Ends at').fill('16:00');
await page.getByRole('button', { name: 'Put it in the calendar' }).click();
await page.waitForTimeout(400);
t = await page.locator('body').innerText();
check('a visit lands in the list', /Kitchen — tear out/.test(t), t.slice(0, 500));
check('and the next one is called out', /^[\s\S]*Next:/.test(t), t.slice(0, 400));

check('a calendar file can be sent to anybody',
  (await page.getByRole('button', { name: 'Send it to somebody' }).count()) === 1);
check('and the phone can put them in its own calendar',
  (await page.getByRole('button', { name: 'Add to my calendar' }).count()) === 1);

// Inside the app that button reaches the phone. Outside it there is no
// calendar to reach, so it has to say nothing rather than claim it worked.
await page.evaluate(() => {
  window.__calendarCalls = [];
  window.webkit = {
    messageHandlers: {
      calendar: { postMessage: (m) => window.__calendarCalls.push(m) },
    },
  };
});
await page.getByRole('button', { name: 'Add to my calendar' }).click();
await page.waitForTimeout(300);
const calls = await page.evaluate(() => window.__calendarCalls ?? []);
check('the app is handed the days, as JSON it can decode', calls.length === 1, JSON.stringify(calls));
check('and every field the phone needs is in them',
  calls.length === 1 && ['id', 'what', 'where', 'starts', 'ends', 'note']
    .every((key) => key in (JSON.parse(calls[0].visits)[0] ?? {})),
  calls.length === 1 ? calls[0].visits : 'nothing sent');
check('and the screen says what happened',
  /put in your own calendar/.test(await page.locator('body').innerText()));

/* ------------------------------- price it, propose it, sign it */

await section(page, 'Price');
await page.getByRole('button', { name: /Set your rates|Your rates/ }).first().click();
await page.waitForTimeout(300);
const rates = page.locator('section', { has: page.getByRole('heading', { name: 'What you charge' }) }).first();
for (const box of await rates.getByRole('textbox').all()) {
  await box.fill('5.00');
  await box.blur();
  await page.waitForTimeout(100);
}

await section(page, 'Agreement');
await page.getByRole('button', { name: 'Write the proposal' }).click();
await page.waitForTimeout(400);
await page.getByLabel('Who it is for').fill('M. Alvarez');
await page.getByLabel('Address of the work').fill('14 Sycamore');
await page.getByRole('button', { name: 'Save these details' }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Take this one' }).first().click();
await page.waitForTimeout(300);
await page.getByLabel('Your name').fill('M. Alvarez');
await page.getByLabel('I agree to sign electronically').check();
const pad = page.getByRole('img', { name: 'Sign here with your finger' });
const box = await pad.boundingBox();
await page.mouse.move(box.x + 40, box.y + 100);
await page.mouse.down();
await page.mouse.move(box.x + 140, box.y + 50, { steps: 8 });
await page.mouse.move(box.x + 240, box.y + 100, { steps: 8 });
await page.mouse.up();
await page.getByRole('button', { name: /^Agree to / }).click();
await page.waitForTimeout(700);

/* --------------------------------------------------- the invoices */

await section(page, 'Work');
await page.waitForTimeout(400);
t = await page.locator('body').innerText();
check('once it is signed there is something to invoice',
  /Agreed \$[\d,]+\.\d\d/.test(t), t.slice(0, 600));

await page.getByLabel('Your invoice number').fill('2026-014');
await page.getByLabel('Deposit, per cent of the job').fill('30');
await page.getByLabel('When it is due').fill('2026-09-08');
await page.getByLabel('How to pay you').fill('Cheque to the address above');
await page.getByRole('button', { name: 'Write the invoice' }).click();
await page.waitForTimeout(500);
t = await page.locator('body').innerText();
check('a deposit is written and says what is left on the job',
  /Deposit 2026-014/.test(t) && /leaving \$/.test(t), t.slice(-800));

// The final, for the rest.
await page.getByRole('button', { name: 'Final payment' }).click();
await page.getByLabel('Your invoice number').fill('2026-015');
await page.getByRole('button', { name: 'Write the invoice' }).click();
await page.waitForTimeout(500);
t = await page.locator('body').innerText();
check('the final settles the job exactly', /settles the job/.test(t), t.slice(-800));

// And now there is nothing left. Asking again has to be refused.
await page.getByLabel('Your invoice number').fill('2026-016');
await page.getByRole('button', { name: 'Write the invoice' }).click();
await page.waitForTimeout(400);
t = await page.locator('body').innerText();
check('the same work cannot be invoiced twice, and it says why',
  /already been invoiced/.test(t), t.slice(-600));

check('a QuickBooks file can be sent',
  (await page.getByRole('button', { name: 'Send to QuickBooks' }).count()) === 1);
check('and it says why it is a file rather than an integration',
  /nothing about it stops working on a Tuesday/.test(t), t.slice(-700));

check('no console or page errors across the whole run', noise().length === 0, noise().join(' | '));

const bad = report('A11 — the calendar and the invoice');
await ctx.close();
await browser.close();
process.exit(bad > 0 ? 1 : 0);
