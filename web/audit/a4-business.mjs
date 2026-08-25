import { SP, check, loadScan, open, report } from './lib.mjs';
const { browser, page } = await open();

/* ------------------------------------------------------------ the business */

await page.getByRole('button', { name: 'Your business' }).click();
await page.waitForTimeout(400);
let t = await page.locator('body').innerText();
check('the business screen opens', /Your business|What you are called|licence/i.test(t), t.slice(0, 200));

const settings = page.locator('section').first();
const fields = await page.locator('input[type=text], input[type=tel], input[type=email]').count();
check('the profile has fields to fill in', fields >= 4, `${fields} fields`);

// Fill it in.
for (const [name, value] of [['name', 'Gilbert Remodeling'], ['phone', '555-0142'],
                             ['email', 'g@example.com'], ['licence', 'RC-4412'],
                             ['insurance', 'Acme Mutual']]) {
  const box = page.getByRole('textbox', { name: new RegExp(name, 'i') }).first();
  if (await box.count()) { await box.fill(value); await box.blur(); await page.waitForTimeout(120); }
}
// Units, then Save. Nothing in the profile is committed until Save —
// deliberately, so the screen can be left without a half-typed licence number
// becoming the record — and saving closes it.
const metric = page.getByRole('button', { name: /Metric/i }).first();
check('there is a units switch', (await metric.count()) > 0);
await metric.click();
await page.waitForTimeout(200);

check('the price list importer is here',
  (await page.getByRole('heading', { name: /supplier/i }).count()) > 0);
check('the toggle is named for what it does now',
  (await page.getByRole('button', { name: 'Close your business details' }).count()) === 1);

await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForTimeout(400);
check('saving closes the profile', (await page.getByRole('button', { name: 'Your business' }).count()) === 1);

/* ------------------------------------- metric reaches the numbers, and back */

await loadScan(page);
t = await page.locator('body').innerText();
check('metric reaches the plan', /m²|mm/.test(t), t.slice(0, 300));
check('metric rounds to whole millimetres', !/\d\.\d+ mm/.test(t), (t.match(/[\d.]+ mm/g) || []).slice(0, 5).join(' | '));
check('the letterhead is on the drawing', t.includes('Gilbert Remodeling'), t.slice(0, 300));
check('the licence is on the drawing', t.includes('RC-4412'));

await page.getByRole('button', { name: 'Your business' }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: /Feet and inches/i }).first().click();
await page.waitForTimeout(200);
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForTimeout(400);
t = await page.locator('body').innerText();
check('switching back gives feet and inches', t.includes('420.0 sq ft'), t.slice(0, 250));

/* ------------------------------------------------------------- job status */

// It hides itself until there are rates, which is right: nobody can mark a job
// won at a price they never set. So set one.
const price = page.locator('section', { has: page.getByRole('heading', { name: 'What it comes to' }) }).first();
await price.getByRole('button', { name: /Set your rates|Your rates/ }).click();
await page.waitForTimeout(300);
const rates = page.locator('section', { has: page.getByRole('heading', { name: 'What you charge' }) }).first();
await rates.getByLabel('Floor rate').fill('8.75');
await rates.getByLabel('Floor rate').blur();
await page.waitForTimeout(250);
await rates.getByRole('button', { name: 'Done' }).click();
await page.waitForTimeout(400);
t = await page.locator('body').innerText();
check('the room prices itself', t.includes('$3,675.00'), '420.0 sq ft at $8.75');
check('a job status appears once there is a price', /What happened to it/.test(t), t.slice(-400));
const status = page.locator('section', { has: page.getByRole('heading', { name: 'What happened to it' }) }).first();
await status.getByRole('button', { name: 'Won' }).click();
await page.waitForTimeout(400);
check('a job can be marked won', (await status.innerText()).includes('Marked won'), await status.innerText());

/* --------------------------------------------------------------- the floor */

await page.getByRole('button', { name: 'The whole floor' }).click();
await page.waitForTimeout(500);
t = await page.locator('body').innerText();
check('the floor screen opens', /floor|room/i.test(t), t.slice(0, 200));
check('rooms not joined yet are named', /not joined|waiting|nothing joined/i.test(t) || /garage/i.test(t),
  t.slice(0, 400));

process.exit(report('A4 — business, units, floor') > 0 ? 1 : 0);
