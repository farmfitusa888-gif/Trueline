import { check, loadScan, noise, open, pick, report, reportEvenIfItDies, section, SP } from './lib.mjs';

// Say what was learned even if this part dies part way through.
reportEvenIfItDies('A7 — findings, overrides, the client file');
const { browser, ctx, page } = await open();
await loadScan(page);

/* ------------------------------------------------------------ the findings */

await section(page, 'Room');
let t = await page.locator('body').innerText();
check('the room closing perfectly is called out as meaningless', /closes perfectly, and that means nothing yet/i.test(t));
check('the punch list ranks walls worth a tape', /Measure these first/i.test(t));
check('wall thickness missing from the scan is named', /Wall thickness is not in this file/i.test(t));
check('every dimension is listed with where it came from', /Every dimension, and where it came from/i.test(t));

/* --------------------------------------------------------------- the field sheet */

await section(page, 'Files');
t = await page.locator('body').innerText();

check('a field sheet exists to carry and write on', /Take this list with you/i.test(t), t.slice(-800));

/* ------------------------------------------------- override travels to the client */

await section(page, 'Price');
const price = page.locator('section', { has: page.getByRole('heading', { name: 'What it comes to' }) }).first();
await price.getByRole('button', { name: /Set your rates|Your rates/ }).click();
await page.waitForTimeout(300);
const rates = page.locator('section', { has: page.getByRole('heading', { name: 'What you charge' }) }).first();
await rates.getByLabel('Floor rate').fill('8.75');
await rates.getByLabel('Floor rate').blur();
await page.waitForTimeout(250);
await rates.getByRole('button', { name: 'Done' }).click();
await page.waitForTimeout(400);

await price.getByRole('button', { name: 'Price a different number' }).first().click();
await page.waitForTimeout(200);
await price.getByLabel(/^Price this many/).fill('450.00');
await price.getByRole('button', { name: 'Price that' }).click();
await page.waitForTimeout(300);
check('an override with no reason is refused',
  /Say why/.test((await page.locator('body').innerText())));

await price.getByLabel(/^Why /).fill('diagonal lay, 7% waste');
await price.getByRole('button', { name: 'Price that' }).click();
await page.waitForTimeout(400);
t = await price.innerText();
check('the override prices the typed number', t.includes('$3,937.50'), '450 at $8.75');
check('and both numbers stay on the line', /not the 420\.0 sq ft this room measures/.test(t), t.slice(0, 400));

/* -------------------------------------------------------------- client file */

await section(page, 'Files');
const send = page.locator('section', { has: page.getByRole('heading', { name: 'Send the drawing' }) }).first();
const [file] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  send.getByRole('button', { name: /Send to the client/ }).click(),
]);
await file.saveAs(SP + '/audit-client.html');

const doc = await ctx.newPage();
const asks = [];
doc.on('request', (r) => { if (!r.url().startsWith('file://')) asks.push(r.url()); });
await doc.goto('file://' + SP + '/audit-client.html');
await doc.waitForTimeout(400);
const html = await doc.locator('body').innerText();
check('the client file opens offline with nothing fetched', asks.length === 0, asks.join(', '));
check('it has no scripts in it', (await doc.locator('script').count()) === 0);
check('the drawing is in it', (await doc.locator('svg').count()) >= 1);
check('the override travels onto it', /not the 420\.0 sq ft this room measures/.test(html), html.slice(0, 400));
check('the caveat travels onto it', /scanner/i.test(html));
// With no profile set this run, "Made with Trueline" is the honest footer.
// The letterhead case is covered in A4, where a profile IS filled in.
check('the file signs itself', /Made with Trueline/.test(html), html.slice(-200));

/* -------------------------------------------------------- nothing threw anywhere */

check('no console or page errors across the whole run', noise().length === 0, noise().join(' | '));

process.exit(report('A7 — findings, overrides, the client file') > 0 ? 1 : 0);
