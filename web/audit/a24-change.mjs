import { check, loadScan, noise, open, report, reportEvenIfItDies, section } from './lib.mjs';

// Say what was learned even if this part dies part way through.
reportEvenIfItDies('A24 — the signed change order, and the money in');

/**
 * A change order, signed, and the bill that refuses to move until it is.
 *
 * > "And these are files that can be signed and returned as legal signatures?
 * >  … and what about signed change orders? BUILD IT!!"
 *
 * ## The defect this part exists for
 *
 * `invoice.ts` documented, in its own comment, that it "refuses a change order
 * that has not been agreed to". It did not. `invoiceOf` added the whole of
 * `changes.difference` — worked out from whatever the room measures *now* —
 * straight onto the agreed total. Move a wall, change a rate, re-measure a
 * floor, and the bill went up against a contract nobody had amended. The
 * protection was written down, was believed, and did not exist.
 *
 * Every figure below is worked out **on this side**, from the totals the app
 * itself printed at each step. A screen that agrees with itself proves nothing:
 * the failure this feature produces is a bill that adds up perfectly and is for
 * work nobody signed for, and only arithmetic done outside the app can see it.
 *
 * Five properties, in the order they would break:
 *
 *   1. A signed job with nothing moved says so, and offers no change order.
 *   2. Moving the money moves the "agreed" figure by nothing at all, and the
 *      app names what it is refusing to bill and what it is worth.
 *   3. An invoice written in that state asks for the signed figure, to the cent.
 *   4. A change order refuses to be written without a reason on it, and once
 *      written can be sent as a file that carries the price, the days and
 *      somewhere to sign.
 *   5. Signed, and only then, the agreed figure moves by exactly the amount the
 *      app said was not on the bill — and the next invoice asks for it.
 *
 * Then the other half of getting paid: writing down what arrived. This app
 * takes no payments and holds no card details, which is why it needs no
 * security certification and cannot leak anybody's card. The refusal that keeps
 * it true — a reference that looks like a card number is turned away — is
 * checked here with the test numbers every processor publishes for the purpose.
 */

const cash = (text) => Number(String(text).replace(/[^0-9.]/g, ''));

const { browser, ctx, page } = await open();
await loadScan(page);

/* ------------------------------------- price it, propose it, sign it */

await section(page, 'Price');
await page.getByRole('button', { name: /Set your rates|Your rates/ }).first().click();
await page.waitForTimeout(300);
const rates = page
  .locator('section', { has: page.getByRole('heading', { name: 'What you charge' }) })
  .first();
const boxes = await rates.getByRole('textbox').all();
for (const box of boxes) {
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

async function scribble(page) {
  const pad = page.getByRole('img', { name: 'Sign here with your finger' }).last();
  const box = await pad.boundingBox();
  await page.mouse.move(box.x + 40, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 50, { steps: 8 });
  await page.mouse.move(box.x + 240, box.y + 100, { steps: 8 });
  await page.mouse.up();
}
await scribble(page);
await page.getByRole('button', { name: /^Agree to / }).click();
await page.waitForTimeout(700);

/* ==========================================================================
   1. Signed, and nothing has moved.
   ========================================================================== */

await section(page, 'Work');
await page.waitForTimeout(400);
let t = await page.locator('[data-panel="work"]').innerText();

const signedTotal = cash(/Agreed (\$[\d,]+\.\d\d)/.exec(t)?.[1] ?? '0');
check('a signed job has an agreed figure', signedTotal > 0, t.slice(0, 400));
check('and nothing has moved on it that nobody signed for',
  /Nothing has moved on this job that somebody has not signed for/.test(t), t.slice(0, 900));
check('so there is no change order to write yet',
  (await page.getByRole('button', { name: 'Write the change order' }).count()) === 0);

/* ==========================================================================
   2. Now the money moves — every rate goes up by a dollar. The room is the
      same room; what it costs is not. Nobody has signed for any of it.
   ========================================================================== */

await section(page, 'Price');
for (const box of await rates.getByRole('textbox').all()) {
  await box.fill('6.00');
  await box.blur();
  await page.waitForTimeout(100);
}

await section(page, 'Work');
await page.waitForTimeout(500);
t = await page.locator('[data-panel="work"]').innerText();

const stillAgreed = cash(/Agreed (\$[\d,]+\.\d\d)/.exec(t)?.[1] ?? '0');
check('the agreed figure does not move when nobody has agreed to anything',
  stillAgreed === signedTotal, `signed ${signedTotal}, now ${stillAgreed}`);

const moved = /(\d+) things? moved since this was signed, worth (\$[\d,]+\.\d\d)/.exec(t);
check('the app says how much moved and that none of it is on a bill',
  moved !== null && /None of it is on a bill/.test(t), t.slice(0, 1200));
const unsignedWorth = cash(moved?.[2] ?? '0');
check('and what is not being billed is worth something',
  unsignedWorth > 0, `worth ${unsignedWorth}`);

/* ==========================================================================
   3. An invoice written now asks for the signed figure, to the cent.
      This is the regression. Before the fix it asked for the moved one.
   ========================================================================== */

await page.getByLabel('Your invoice number').fill('2026-014');
await page.getByLabel('When it is due').fill('2026-09-08');
await page.getByLabel('How to pay you').fill('Cheque to the address above');
await page.getByRole('button', { name: 'Final payment' }).click();
await page.getByRole('button', { name: 'Write the invoice' }).click();
await page.waitForTimeout(600);
t = await page.locator('[data-panel="work"]').innerText();

const askedFor = cash(/Final payment 2026-014\s*\n?\s*(\$[\d,]+\.\d\d)/.exec(t)?.[1] ?? '0');
check('the invoice asks for exactly what was signed, not what the room costs today',
  askedFor === signedTotal, `signed ${signedTotal}, asked ${askedFor}`);
check('and it says on its face what it left off, and why',
  /nobody has signed for/.test(t) && /Raise a change order/.test(t), t.slice(-1200));

/* ==========================================================================
   4. Writing the change order. It refuses without a reason.
   ========================================================================== */

await page.getByLabel('Your change order number').fill('CO-1');
await page.getByRole('button', { name: 'Write the change order' }).click();
await page.waitForTimeout(400);
t = await page.locator('[data-panel="work"]').innerText();
check('a change order with no reason on it is refused, and says why',
  /Say why this change is happening/.test(t), t.slice(-800));
check('and nothing was written', /waiting to be signed/.test(t) === false, t.slice(-500));

await page.getByLabel('Why this is happening')
  .fill('Materials went up between the estimate and the order.');
await page.getByLabel('Days this adds to the finish date').fill('2');
await page.getByRole('button', { name: 'Write the change order' }).click();
await page.waitForTimeout(500);
t = await page.locator('[data-panel="work"]').innerText();
check('a change order with a reason is written and waits to be signed',
  /Change order CO-1 — waiting to be signed/.test(t), t.slice(-1000));
check('it says what it does to the finish date',
  /adds 2 days to the finish date/.test(t), t.slice(-1000));
check('and it says plainly that none of it is authorised until it is signed',
  /none of this is authorised and none of it is billable/.test(t), t.slice(-1000));

/* ----------------------------------- the file, for a client who is not here */

const waitFor = page.waitForEvent('download');
await page.getByRole('button', { name: 'Send it to be signed' }).click();
const sent = await waitFor;
const html = await sent.createReadStream().then(async (stream) => {
  let text = '';
  for await (const chunk of stream) text += chunk;
  return text;
});
check('the change order goes out as its own file', /change-CO-1\.html$/.test(sent.suggestedFilename()),
  sent.suggestedFilename());
check('the file carries the reason, the money and the days',
  html.includes('Materials went up between the estimate and the order.')
  && html.includes('Agreed with this change')
  && /adds 2 days to the finish date/.test(html),
  html.slice(0, 400));
check('and somewhere to sign it by hand, for a client who wants paper',
  /Printed name/.test(html) && /Not agreed yet/.test(html), 'no by-hand block');
check('it fetches nothing and runs nothing, so it works with no signal',
  !/<script/i.test(html) && !/https?:\/\//.test(html.replace(/xmlns[^ >]*/g, '')),
  'the document reaches out');

/* ==========================================================================
   5. Signed. Only now does the money move.
   ========================================================================== */

await page.getByLabel('Who is signing').fill('M. Alvarez');
await page.getByLabel(/I agree to sign electronically/).check();
await scribble(page);
await page.getByRole('button', { name: 'Agree to this change' }).click();
await page.waitForTimeout(800);
t = await page.locator('[data-panel="work"]').innerText();

check('the signed change order is listed, with who signed it',
  /Change order CO-1/.test(t) && /Signed by M\. Alvarez/.test(t) && /On the bill\./.test(t),
  t.slice(0, 1400));

const nowAgreed = cash(/Agreed (\$[\d,]+\.\d\d)/.exec(t)?.[1] ?? '0');
check('the agreed figure moves by exactly what the app said was not on the bill',
  Math.abs(nowAgreed - (signedTotal + unsignedWorth)) < 0.005,
  `${signedTotal} + ${unsignedWorth} should be ${nowAgreed}`);
check('and nothing is left unsigned on the job',
  /Nothing has moved on this job that somebody has not signed for/.test(t), t.slice(0, 1400));

/* ---------------------------------- and the next invoice asks for it */

await page.getByLabel('Your invoice number').fill('2026-015');
await page.getByRole('button', { name: 'Write the invoice' }).click();
await page.waitForTimeout(600);
t = await page.locator('[data-panel="work"]').innerText();
const second = cash(/Final payment 2026-015\s*\n?\s*(\$[\d,]+\.\d\d)/.exec(t)?.[1] ?? '0');
check('the invoice after it asks for the change, and only the change',
  Math.abs(second - unsignedWorth) < 0.005, `change ${unsignedWorth}, asked ${second}`);
check('and that settles the job', /settles the job/.test(t), t.slice(-900));

/* ==========================================================================
   6. The money coming in. Written down, never taken.
   ========================================================================== */

t = await page.locator('[data-panel="work"]').innerText();
const owedAll = cash(/(\$[\d,]+\.\d\d) still out/.exec(t)?.[1] ?? '0');
check('the screen leads with what is still out',
  Math.abs(owedAll - (signedTotal + unsignedWorth)) < 0.005,
  `${signedTotal} + ${unsignedWorth} vs ${owedAll}`);
check('and every unpaid invoice says none of it is in',
  /none of it in/.test(t), t.slice(-1400));

await page.getByRole('button', { name: 'Money came in' }).first().click();
await page.waitForTimeout(300);

// A card number, typed by a contractor being helpful. This is the one thing
// the field must never keep.
await page.getByLabel('How much came in').fill('100.00');
await page.getByLabel('Reference').fill('4111 1111 1111 1111');
await page.getByRole('button', { name: 'Write it down' }).click();
await page.waitForTimeout(400);
t = await page.locator('[data-panel="work"]').innerText();
check('a card number in the reference is refused, and says why',
  /will not store one/.test(t) && /takes no payments/.test(t), t.slice(-900));
check('and nothing was written down', /by cheque on/.test(t) === false, t.slice(-900));

// Now a cheque, for part of it.
await page.getByLabel('Reference').fill('2291');
await page.getByRole('button', { name: 'Write it down' }).click();
await page.waitForTimeout(500);
t = await page.locator('[data-panel="work"]').innerText();
check('a real payment is written down against the invoice it settles',
  /\$100\.00 by cheque on/.test(t) && /2291/.test(t), t.slice(-1200));

const owedNow = cash(/(\$[\d,]+\.\d\d) still out\./.exec(t)?.[1] ?? '0');
check('and what is still out drops by exactly what came in',
  Math.abs(owedNow - (owedAll - 100)) < 0.005, `${owedAll} - 100 vs ${owedNow}`);

// More than is owed is refused rather than quietly absorbed.
await page.getByRole('button', { name: 'Money came in' }).first().click();
await page.waitForTimeout(300);
await page.getByLabel('How much came in').fill(String(owedAll + 1000));
await page.getByRole('button', { name: 'Write it down' }).click();
await page.waitForTimeout(400);
t = await page.locator('[data-panel="work"]').innerText();
check('more than the invoice asks for is refused rather than absorbed',
  /is more than the/.test(t) && /an overpayment absorbed quietly/.test(t), t.slice(-900));

check('no card details are anywhere in the saved job',
  (await page.evaluate(() => JSON.stringify(window.localStorage))).includes('4111') === false);

/* ==========================================================================
   7. All of it survives being put down and picked up again. A signed change
      order and a recorded payment that do not come back are not a record.
   ========================================================================== */

await page.reload({ waitUntil: 'networkidle' });
await loadScan(page);
await section(page, 'Work');
await page.waitForTimeout(600);
t = await page.locator('[data-panel="work"]').innerText();

check('the signed change order comes back after a reload',
  /Change order CO-1/.test(t) && /Signed by M\. Alvarez/.test(t), t.slice(0, 1200));
check('the payment comes back with it',
  /\$100\.00 by cheque on/.test(t), t.slice(-1500));
const owedBack = cash(/(\$[\d,]+\.\d\d) still out\./.exec(t)?.[1] ?? '0');
check('and what is still out is the same figure it was',
  Math.abs(owedBack - (owedAll - 100)) < 0.005, `${owedAll - 100} vs ${owedBack}`);

/* ------------------------------------------ a progress payment is not the final */

check('a progress payment asks how much of the job is done',
  await page.getByRole('button', { name: 'Progress payment' }).count() === 1);

check('no console or page errors across the whole run', noise().length === 0, noise().join(' | '));

const bad = report('A24 — the signed change order, and the money in');
await ctx.close();
await browser.close();
process.exit(bad > 0 ? 1 : 0);
