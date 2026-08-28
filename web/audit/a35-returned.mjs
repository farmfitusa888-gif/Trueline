import { check, loadScan, noise, open, report, reportEvenIfItDies, section } from './lib.mjs';

// Say what was learned even if this part dies part way through.
reportEvenIfItDies('A35 — the job agreed on a photograph, and the weakness that travels');

/**
 * The job agreed on a photograph, and the weakness that travels with it.
 *
 * > "Let it freeze the job, with the weakness written on the agreement."
 * > — Sam, choosing what happens when a client signs the paper proposal and
 * >   texts a photograph of it back.
 *
 * ## The defect this part exists for
 *
 * A27 built the second way to get a proposal agreed: the contractor sends it,
 * the client prints it, signs it at the kitchen table on Sunday night and
 * photographs it back, and the app files that copy against the job with the
 * fingerprint of the version that went out. What it could not then do was
 * anything with it. `freeze()` requires a client `Signature`, a photograph is
 * deliberately not one, and so the Work screen said "Nothing to invoice yet"
 * to a contractor holding a signed agreement.
 *
 * That is not a small gap. A contractor who cannot invoice inside the app
 * invoices outside it, and from that moment the app knows less about his job
 * than his email does — no agreed figure, no change orders measured against
 * anything, no record of what was paid.
 *
 * ## What must NOT have been done to fix it
 *
 * The photograph must not have become a signature. `countersign.ts` is built so
 * a `ReturnedDocument` cannot impersonate one, and the fix keeps that: the
 * baseline it freezes carries **no** signature at all, and says on itself, in
 * words, that it was agreed on a returned copy. Every check below that looks
 * for that sentence is also a check that nobody quietly made a photograph as
 * good as a finger on a screen.
 *
 * ## Every figure here is worked out on this side
 *
 * The agreed total, the invoice and what is left on the job are computed in
 * this file from the quantities the app printed on its own takeoff and the rate
 * typed into it — quantity times rate, rounded to the cent, plus the mark-up
 * the Price screen names. Nothing is read from one screen and compared with the
 * same screen. A bill that agrees with itself proves nothing; the failure this
 * feature can produce is a bill that adds up perfectly against evidence nobody
 * described honestly.
 *
 * ## Sam's own scan
 *
 * `dining.json` — nine walls, three doors, three windows, and an open span,
 * which is the reason this part has to give the open span a rate before it can
 * write a proposal at all. A room with a side open to the next room is the
 * ordinary case in a remodel, and a proposal refuses to go out while any line
 * on the sheet has no price against it.
 *
 * ## The order these would break in
 *
 *   1. The signed copy files back and is still not a signature.
 *   2. It still binds: while the proposal has moved under the signed copy, the
 *      job cannot be agreed on it at all, and the app says why.
 *   3. Put back the way it went out, it can agree the job — through a button
 *      that says what it is doing.
 *   4. The agreed figure is the one worked out here, to the cent, and the
 *      screen says how it was agreed rather than calling it signed.
 *   5. The invoice can be written, asks for that figure, and carries the
 *      weakness in words.
 *   6. So does the QuickBooks export a bookkeeper opens.
 *   7. So does the proposal document that leaves the phone.
 *   8. All of it survives being put down and picked up again.
 */

/* ===================================================================
   This side's arithmetic. Money in cents as BigInt, never a float --
   the same rule the app follows, implemented again from the sentence
   "quantity times rate, rounded to the cent, plus the mark-up".
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

// The harness's own arithmetic, checked before anything is trusted to it.
if (cents(500n, '408.8') !== 204400n) throw new Error('the audit cannot multiply; fix it first');
if (cents(500n, '85.76') !== 42880n) throw new Error('the audit rounds wrong; fix it first');
if (money(796656n) !== '$7,966.56') throw new Error('the audit cannot spell money; fix it first');

/* ==================================================================== */

const RATE = 500n;              // $5.00 a unit, typed into every rate below.
const SIGNED_ON = '2026-08-28'; // the day the client says they signed the paper.
const PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const { browser, ctx, page } = await open();
await loadScan(page, 'dining.json');

/* ----------------------------------------------- a rate against every line */

await section(page, 'Price');
await page.getByRole('button', { name: /Set your rates|Your rates/ }).first().click();
await page.waitForTimeout(300);
const rates = page
  .locator('section', { has: page.getByRole('heading', { name: 'What you charge' }) })
  .first();
for (const box of await rates.getByRole('textbox').all()) {
  await box.fill('5.00');
  await box.blur();
  await page.waitForTimeout(80);
}
// The open span. A dining room open to the next room has one, it is on the
// takeoff, and a proposal will not go out while anything on the sheet has no
// price against it -- so the contractor gives it one, at the same rate as
// everything else, and this side knows to count it.
await rates.getByLabel('What you call it').fill('Open span');
await rates
  .getByLabel('Where its quantity comes from')
  .selectOption({ label: 'how long the wall is, corner to corner' });
await page.waitForTimeout(150);
await rates.getByLabel('What it covers', { exact: true }).fill('nothing built across it');
await rates.getByLabel(/^What you charge, per/).fill('5.00');
await rates.getByRole('button', { name: 'Add it to your rates' }).click();
await page.waitForTimeout(300);
await rates.getByRole('button', { name: 'Done' }).first().click();
await page.waitForTimeout(400);

/* --------------------------- the job, priced on this side from the takeoff */

await section(page, 'Takeoff');
await page.waitForTimeout(300);
const sheet = await page.locator('[data-panel="takeoff"]').innerText();

const ITEMS = ['Floor', 'Wall face', 'Ceiling', 'Baseboard', 'Doors', 'Windows', 'Open span'];
let subtotal = 0n;
const quantities = {};
for (const item of ITEMS) {
  const found = new RegExp(`^${item}\\n[^\\n]*\\n([\\d.,]+) (sq ft|lf|ea)$`, 'm').exec(sheet);
  if (found) {
    quantities[item] = found[1];
    subtotal += cents(RATE, found[1]);
  }
}
check('every priced line on the takeoff was read off the app’s own sheet',
  Object.keys(quantities).length === ITEMS.length,
  `read ${JSON.stringify(quantities)}`);

await section(page, 'Price');
await page.waitForTimeout(300);
const priced = await page.locator('[data-panel="price"]').innerText();
const markUp = /Mark-up ([\d.]+)%/.exec(priced);
check('the app names the mark-up it is applying', markUp !== null, priced.slice(0, 600));
// The mark-up read off the screen, applied here rather than taken on trust.
const points = hundredths(markUp?.[1] ?? '0');
const margin = (subtotal * points + 5000n) / 10_000n;
const AGREED = subtotal + margin;

check('the total the app prints is the one worked out here from its own quantities',
  priced.includes(money(AGREED)),
  `worked out ${money(AGREED)} from ${JSON.stringify(quantities)} at $5.00`);

/* ------------------------------------------ a letterhead and a proposal out */

await page.getByRole('button', { name: 'Your business' }).click();
await page.waitForTimeout(400);
await page.getByRole('textbox', { name: /Business name/i }).first().fill('Alvarez Remodeling');
// The seller's address for the cancellation forms lives on the business
// profile now, not on a box per proposal -- a field somebody retypes on every
// job is a field somebody eventually leaves blank, on a federal form.
await page.getByRole('textbox', { name: /Business address/i }).first()
  .fill('2200 Oak Street, Mesa AZ 85201');
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForTimeout(500);

await section(page, 'Agreement');
const panel = page.locator('[data-panel="agree"]');
await page.getByRole('button', { name: 'Write the proposal' }).click();
await page.waitForTimeout(400);
await page.getByLabel('Who it is for').fill('M. Alvarez');
await page.getByLabel('Address of the work').fill('14 Sycamore');
await page.getByRole('button', { name: 'Save these details' }).click();
await page.waitForTimeout(400);
await panel.getByRole('button', { name: 'Their home', exact: true }).click();
await page.waitForTimeout(200);
await page.getByLabel('The day it gets signed').fill(SIGNED_ON);
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Take this one' }).first().click();
await page.waitForTimeout(400);

async function sendAndRead() {
  const waitFor = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Send th(is|e signed) proposal$/ }).click();
  const sent = await waitFor;
  let html = '';
  for await (const chunk of await sent.createReadStream()) html += chunk;
  await page.waitForTimeout(400);
  return html;
}

// It has to go out before a copy can come back: the fingerprint of the version
// that was sent is the whole of what binds the returned sheet to this job.
await sendAndRead();

/* ==========================================================================
   1. The signed copy comes back, and is still not a signature.
   ========================================================================== */

await page.setInputFiles('input[type=file][accept="image/*,application/pdf"]', {
  name: 'signed-page.png',
  mimeType: 'image/png',
  buffer: PHOTO,
});
await page.waitForTimeout(400);
await page.getByLabel('Who signed it').fill('M. Alvarez');
await page.getByLabel('The day they say they signed it').fill(SIGNED_ON);
await panel.getByRole('button', { name: 'A photograph' }).click();
await page.waitForTimeout(150);
await panel.getByRole('button', { name: 'File the signed copy' }).click();
await page.waitForTimeout(700);
let t = await panel.innerText();

check('the signed copy files back against the proposal',
  /Signed copy on file — M\. Alvarez/.test(t), t.slice(-1500));
check('and it is still somebody’s word, not the app’s',
  /M\. Alvarez says they signed it on/.test(t), t.slice(-1500));
check('and it still says what it does not show',
  /What it does not show:/.test(t) && /has not verified anybody’s identity/.test(t),
  t.slice(-2000));

/* ==========================================================================
   2. It still binds. While the proposal has moved, nothing can be agreed on
      the copy — because the sheet they signed and the sheet on this phone
      would be two different documents.
   ========================================================================== */

await page.getByLabel('Address of the work').fill('14 Sycamore Lane');
await page.getByRole('button', { name: 'Save these details' }).click();
await page.waitForTimeout(900);
t = await panel.innerText();

check('a proposal edited after the copy came back is caught, and said out loud',
  /is not the proposal M\. Alvarez signed and sent back on 2026-08-28/.test(t), t.slice(0, 3000));
check('and it names the change order as where the change belongs',
  /belongs in a change order/.test(t), t.slice(0, 3000));
check('and the job cannot be agreed on the copy while that is true',
  (await panel.getByRole('button', { name: /^Agree the job on this signed copy/ }).count()) === 0,
  'the app offered to agree a job on a copy of a document that has since changed');

// Put back exactly as it went out. The fingerprint is of the document, so the
// same document gives the same fingerprint and the copy binds again.
await page.getByLabel('Address of the work').fill('14 Sycamore');
await page.getByRole('button', { name: 'Save these details' }).click();
await page.waitForTimeout(900);
t = await panel.innerText();
check('put back the way it went out, the alarm goes',
  !/is not the proposal M\. Alvarez signed/.test(t), t.slice(0, 2000));

/* ==========================================================================
   3 & 4. It can agree the job — through a door that says what it is.
   ========================================================================== */

const agreeOnIt = panel.getByRole('button', { name: /^Agree the job on this signed copy/ });
check('a filed copy offers to agree the job, and nothing else does',
  (await agreeOnIt.count()) === 1,
  'there is no way to agree a job on a signed copy that came back');
check('the button says what it is agreeing and for how much',
  (await agreeOnIt.count()) === 1
  && (await agreeOnIt.innerText()).includes(money(AGREED)),
  (await agreeOnIt.count()) === 1 ? await agreeOnIt.innerText() : 'no button');
check('and the screen warns, before it is pressed, that every document will say so',
  /Every invoice and every document then says it was agreed on a photograph of the signed page/
    .test(t),
  t.slice(-2500));

await agreeOnIt.click();
await page.waitForTimeout(800);
t = await panel.innerText();

/* -------------------- the job is agreed, at this side's figure, and says how */

check('the job is agreed',
  new RegExp(`Agreed — As measured, ${money(AGREED).replace(/[$.]/g, '\\$&')}`).test(t),
  t.slice(0, 1200));
check('the agreed figure is the one worked out here, to the cent',
  t.includes(money(AGREED)), `worked out ${money(AGREED)}`);
check('and the agreement says on its face how it was agreed',
  /This was agreed by a photograph of the signed page, not by a signature taken on the phone/
    .test(t),
  t.slice(0, 2000));
check('it names whose word the date is',
  new RegExp(`M\\. Alvarez says they signed it on ${SIGNED_ON}`).test(t), t.slice(0, 2000));
check('it says nobody watched, and that no identity was checked',
  /Nobody watched them sign/.test(t) && /has not checked anybody’s identity/.test(t),
  t.slice(0, 2000));
check('and it still says what the photograph DOES bind',
  /both fingerprinted/.test(t), t.slice(0, 2000));
check('no signature appears anywhere on a job agreed this way',
  (await panel.locator('img[alt^="Signature of"]').count()) === 0,
  'a signature was drawn for a job nobody signed on the phone');
check('and the app never says the client signed here',
  !/They agreed to sign electronically/.test(t.slice(t.indexOf('Agreed — As measured'))),
  'the returned copy was described with the words used for an on-phone signature');

/* ==========================================================================
   5. The bill. It can be written at all, which is the whole decision.
   ========================================================================== */

await section(page, 'Work');
await page.waitForTimeout(500);
let w = await page.locator('[data-panel="work"]').innerText();

check('the Work screen no longer refuses to invoice a job agreed this way',
  !/Nothing to invoice yet/.test(w), w.slice(0, 800));
const onScreen = /Agreed (\$[\d,]+\.\d\d)/.exec(w);
check('and the agreed figure it carries is this side’s figure',
  onScreen !== null && read(onScreen[1]) === AGREED,
  `worked out ${money(AGREED)}, screen said ${onScreen?.[1] ?? 'nothing'}`);

await page.getByLabel('Your invoice number').fill('2026-101');
await page.getByLabel('When it is due').fill('2026-09-30');
await page.getByLabel('How to pay you').fill('Cheque to the address above');
await page.getByRole('button', { name: 'Final payment' }).click();
await page.getByRole('button', { name: 'Write the invoice' }).click();
await page.waitForTimeout(700);
w = await page.locator('[data-panel="work"]').innerText();

const asked = /Final payment 2026-101\s*\n?\s*(\$[\d,]+\.\d\d)/.exec(w);
check('an invoice is written, and asks for exactly what was agreed',
  asked !== null && read(asked[1]) === AGREED,
  `worked out ${money(AGREED)}, invoice asked ${asked?.[1] ?? 'nothing'}`);
check('and the line under the money says how the job was agreed',
  /Agreed by a photograph of the signed page from M\. Alvarez, not by a signature taken on the phone/
    .test(w),
  w.slice(-2000));

/* ==========================================================================
   6. The export a bookkeeper opens.
   ========================================================================== */

const waitCsv = page.waitForEvent('download');
await page.getByRole('button', { name: 'Send to QuickBooks' }).click();
const csvFile = await waitCsv;
let csv = '';
for await (const chunk of await csvFile.createReadStream()) csv += chunk;
await page.waitForTimeout(300);

check('the invoice exports as a file', /\.csv$/.test(csvFile.suggestedFilename()),
  csvFile.suggestedFilename());
check('the export carries the whole agreed figure',
  csv.includes(`${AGREED / 100n}.${`${AGREED % 100n}`.padStart(2, '0')}`),
  csv.slice(0, 600));
check('and it carries how the job was agreed, into the bookkeeping',
  /by a photograph of the signed page from M\. Alvarez/.test(csv)
  && /nobody watched them sign and no identity was checked/.test(csv),
  csv.slice(0, 600));
// The description column is the only place the invoice's own line detail leaves
// the app, so it is the only place this can be checked: a bill that told a
// bookkeeper the client "signed" would put the claim into the accounts.
check('and it never tells a bookkeeper somebody signed when nobody did',
  !/signed by M\. Alvarez/.test(csv),
  csv.slice(0, 600));

/* ==========================================================================
   7. The document that leaves the phone.
   ========================================================================== */

await section(page, 'Agreement');
await page.waitForTimeout(400);
const html = await sendAndRead();

check('the proposal that goes out no longer calls this signed',
  /Agreed on a signed copy that came back/.test(html) && !/<h2>Signed<\/h2>/.test(html),
  'the document still says "Signed" over a photograph');
check('and the weakness is on the document itself, in full',
  html.includes('not by a signature taken on the phone')
  && html.includes('Nobody watched them sign'),
  'the honesty was left on the phone');
check('the filed copy still travels with it',
  /Signed copy on file/.test(html), 'the returned copy is not on the document');
check('and the document still fetches nothing and runs nothing',
  !/<script/i.test(html) && !/https?:\/\//.test(html.replace(/xmlns[^ >]*/g, '')),
  'the document reaches out');

/* ==========================================================================
   8. Put down and picked up again.
   ========================================================================== */

await page.reload({ waitUntil: 'networkidle' });
await loadScan(page, 'dining.json');
await section(page, 'Work');
await page.waitForTimeout(700);
w = await page.locator('[data-panel="work"]').innerText();
check('the invoice comes back after a reload, asking for the same figure',
  /Final payment 2026-101/.test(w) && w.includes(money(AGREED)), w.slice(0, 1500));
check('and it still says how the job was agreed',
  /not by a signature taken on the phone/.test(w), w.slice(-2000));

check('no console or page errors across the whole run', noise().length === 0, noise().join(' | '));

const bad = report('A35 — the job agreed on a photograph, and the weakness that travels');
await ctx.close();
await browser.close();
process.exit(bad > 0 ? 1 : 0);
