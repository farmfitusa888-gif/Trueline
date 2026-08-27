/**
 * Builds the worked example, by doing the work.
 *
 * The demo job is not a hand-written fixture. This drives the real app in a
 * real browser — types the rates, opens a real scan, measures two walls, writes
 * the proposal, signs it, raises the deposit — and then saves whatever the app
 * produced. So the example somebody looks at is a project the app made, and it
 * cannot drift away from what the app currently does: rebuild it and any change
 * in behaviour shows up in the example immediately.
 *
 *   npm run build
 *   (cd web && npx vite preview --port 4173 &)
 *   node site/tools/demo.mjs
 *
 * Writes `web/src/demo.json`, which the app ships and loads on `#demo`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const CHROME = process.env.TRUELINE_CHROME
  ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const URL = process.env.TRUELINE_AUDIT_URL ?? 'http://127.0.0.1:4173/';
const FIXTURES = new globalThis.URL('../../web/audit/', import.meta.url).pathname;
const OUT = new globalThis.URL('../../web/src/demo.json', import.meta.url).pathname;

const kitchen = JSON.parse(readFileSync(`${FIXTURES}kitchen.json`, 'utf8'));

const RATES = [
  ['Floor rate', '9.50'], ['Ceiling rate', '4.25'], ['Wall face rate', '3.75'],
  ['Baseboard rate', '6.00'], ['Doors rate', '450.00'], ['Windows rate', '300.00'],
  ['Cased openings rate', '180.00'], ['Opening wrap rate', '5.00'],
];

const browser = await chromium.launch({ executablePath: CHROME });

async function open(payload) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 1600 } });
  const page = await ctx.newPage();
  const trouble = [];
  page.on('pageerror', (e) => trouble.push(e.message));
  await page.addInitScript((parked) => {
    window.__sent = {};
    window.webkit = { messageHandlers: {} };
    for (const n of ['saved', 'thumbnail', 'company', 'photo', 'calendar', 'trouble', 'mark', 'draft']) {
      window.__sent[n] = [];
      window.webkit.messageHandlers[n] = { postMessage(b) { window.__sent[n].push(b); } };
    }
    window.truelinePayload = parked;
  }, payload);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  return { ctx, page, trouble };
}

async function part(page, title) {
  await page.getByRole('navigation', { name: 'Parts of this room' })
    .getByRole('button', { name: new RegExp('^' + title) }).first().click();
  const key = { Plan: 'plan', Room: 'room', Takeoff: 'takeoff', Price: 'price',
                Agreement: 'agree', Work: 'work', Insurance: 'claim', Files: 'files' }[title];
  await page.waitForSelector(`[data-panel="${key}"]:not([hidden])`, { timeout: 5000 });
  await page.waitForTimeout(300);
}

/* ---- 1. the business, typed once ---- */
let company = '';
{
  const { ctx, page } = await open({ subscribed: true });
  await page.goto(URL + '#business', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.getByLabel('Business name').fill('Reyes Remodeling');
  await page.getByLabel('Phone').fill('(847) 555-0142');
  await page.getByLabel('Licence number').fill('IL-104-018872').catch(() => {});
  // Nothing on this screen is committed until Save is pressed — the form holds
  // a draft so it can be left without half a profile being written. Without
  // this press the example carried eight rates and no business name, and every
  // document it produced said "your business details are not filled in".
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await page.waitForTimeout(500);
  for (const [label, value] of RATES) {
    const box = page.getByLabel(label);
    if (await box.count()) { await box.fill(value); await box.blur(); await page.waitForTimeout(60); }
  }
  await page.waitForTimeout(400);
  company = await page.evaluate(() => window.__sent.company.at(-1)?.company ?? '');
  await ctx.close();
  console.log('  ✓ business and 8 rates');
}

/* ---- 2. the room: scanned, then two walls actually measured ---- */
const { ctx, page, trouble } = await open({
  company, subscribed: true, room: kitchen, fileName: 'Whitaker — kitchen',
});

// A tape on one wall running each way, which is the whole discipline.
await part(page, 'Plan');
for (const [wall, reading] of [[/^Wall wall-1/, `20' 11"`], [/^Wall wall-2/, `19' 10"`]]) {
  const button = page.getByRole('button', { name: wall }).first();
  await button.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  const box = page.getByRole('textbox', { name: /how long/i }).first();
  if (await box.count()) {
    await box.fill(reading);
    await page.getByRole('button', { name: /^Set how long|^Set$/ }).first().click().catch(() => {});
    await page.waitForTimeout(300);
  }
}
console.log('  ✓ two walls measured with a tape');

/* ---- 3. the proposal, signed ---- */
await part(page, 'Agreement');
await page.getByLabel(/What to call this option/i).fill('As measured');
await page.getByLabel(/One line on what it covers/i).fill(
  'Take up the old floor and base, board and finish the walls and ceiling, then lay the new '
  + 'floor and set the base back, trimming out the door and the window.');
await page.getByRole('button', { name: 'Write the proposal' }).click();
await page.waitForTimeout(600);
await page.getByLabel(/Who it is for/i).fill('J. Whitaker');
await page.getByLabel(/Address of the work/i).fill('118 Willow St');
// Thirty days out from whenever the example was built, so the one thing the
// proposal screen asks for that nothing else supplies is not left blank.
{
  const holds = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const box = page.getByLabel(/How long the price holds/i).first();
  if (await box.count()) { await box.fill(holds); await page.waitForTimeout(200); }
}
await page.getByRole('button', { name: 'Save these details' }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Take this one' }).click();
await page.waitForTimeout(400);
await page.getByLabel(/Your name/i).fill('J. Whitaker');
await page.getByLabel(/I agree to sign electronically/i).check();
{
  const pad = page.locator('[data-panel="agree"] canvas').first();
  const box = await pad.boundingBox();
  await page.mouse.move(box.x + 24, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 14; i += 1) {
    await page.mouse.move(box.x + 24 + (i * (box.width - 48)) / 14,
      box.y + box.height / 2 + (i % 2 ? -16 : 16));
  }
  await page.mouse.up();
}
await page.waitForTimeout(300);
await page.getByRole('button', { name: /^Agree to / }).click();
await page.waitForTimeout(700);
console.log('  ✓ proposal written and signed');

/* ---- 4. a deposit raised against it ---- */
await part(page, 'Work');
{
  const write = page.getByRole('button', { name: 'Write the invoice' });
  if (await write.count()) {
    const number = page.getByLabel(/Your invoice number/i);
    if (await number.count()) await number.fill('2026-041');
    // Due in a fortnight, and a way to be paid — the two things the invoice
    // screen asks for that nothing upstream supplies. Left blank, the example's
    // own invoice tells you it is unfinished.
    const due = page.getByLabel(/When it is due/i);
    if (await due.count()) {
      await due.fill(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
    }
    const how = page.getByLabel(/How to pay you/i);
    if (await how.count()) {
      await how.fill('Cheque to Reyes Remodeling, or card by the link on the emailed copy.');
    }
    await page.waitForTimeout(300);
    await write.click();
    await page.waitForTimeout(600);
    console.log('  ✓ deposit invoice raised');
  }
}

/* ---- 5. the restoration half of the same job ----

   A kitchen being remodelled after a supply line let go behind the washer is
   an ordinary job, and it is the job half this app's audience does. Without
   this the claim screens in the example are an off switch and nothing else,
   and a tour of them is a tour of a switch.

   The damage scope is kept apart from the takeoff by design -- two payers, two
   sheets -- so none of the quantities or money above move because of this. */
await part(page, 'Insurance');
{
  const turnOn = page.getByRole('button', { name: 'Turn it on' });
  if (await turnOn.count()) { await turnOn.click(); await page.waitForTimeout(400); }

  const claim = page.locator('section', { has: page.getByRole('heading', { name: 'The claim' }) })
    .first();
  await claim.getByLabel('Claim number').fill('CLM-88412');
  await claim.getByLabel('Date of loss').fill('2026-08-18');
  await claim.getByRole('button', { name: 'burst pipe', exact: true }).click();
  await claim.getByLabel('Property address').fill('118 Willow St');
  // The first thing an adjuster reads, so the example does not leave it empty.
  await claim.getByLabel('What happened').fill(
    'The supply line under the sink let go overnight. Water ran along the base of the run '
    + 'wall for about nine feet before it was found in the morning.');
  await claim.getByLabel('Carrier').fill('Midwest Mutual');
  await claim.getByLabel('Owner', { exact: true }).fill('J. Whitaker');
  await claim.getByLabel('Adjuster', { exact: true }).fill('D. Chen');
  await page.waitForTimeout(400);

  // Damage is marked on the drawing, against the wall it is on — so this goes
  // back to the plan and picks a wall first. The claim screen is where the
  // claim's own details live and nothing else.
  await part(page, 'Plan');
  {
    const wall = page.getByRole('button', { name: /^Wall wall-1/ }).first();
    await wall.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
  }
  await page.getByRole('button', { name: '+ damaged area' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Water', exact: true }).click();
  await page.getByPlaceholder('water line along the bottom of the wall')
    .fill('supply line behind the washer');
  await page.getByLabel('From along the wall').fill('0');
  await page.getByLabel('To along the wall').fill('9');
  await page.getByLabel('How high the damage reaches').fill('18"');
  await page.getByRole('button', { name: 'Mark it' }).click();
  await page.waitForTimeout(500);

  // Two readings, four days apart, on the same scale — so the example has a
  // curve the app is willing to draw rather than a list it refuses to.
  // Opened to two feet, which is the cut a restorer decides on rather than the
  // 18 inches the damage was seen to — the example carries both figures because
  // the app keeps them apart.
  const open = page.getByRole('button', { name: /Open$/ }).first();
  if (await open.count()) {
    await open.click();
    await page.waitForTimeout(300);
    const two = page.getByRole('button', { name: "2'", exact: true }).first();
    if (await two.count()) { await two.click(); await page.waitForTimeout(300); }
  }
  for (const reading of ['28', '14']) {
    const box = page.getByLabel('Moisture reading');
    if (await box.count()) {
      await box.fill(reading);
      await page.getByRole('button', { name: 'Log it' }).click();
      await page.waitForTimeout(350);
    }
  }
  console.log('  ✓ insurance mode, one damaged area, two moisture readings');
}

/* ---- 6. save whatever the app produced ---- */
await page.waitForTimeout(600);
const saved = await page.evaluate(() => window.__sent.saved.at(-1)?.project ?? '');
if (!saved) { console.error('The app never handed a project back.'); process.exit(1); }
if (trouble.length) { console.error('The app threw: ' + trouble.join(' | ')); process.exit(1); }

const project = JSON.parse(saved);

// The profile goes in beside the project, because half of what made this
// example is the rate book and a project file does not carry one. Without it
// the example opens on a phone with no rates, every priced line comes back
// empty, and the app correctly reports that the entire signed scope has been
// removed — "Agreed $0.00" under an invoice for a third of the job.
//
// It is lent to the screen and never written down. See `Units.borrow`.
if (!company) { console.error('The app never handed the profile back.'); process.exit(1); }
writeFileSync(OUT, JSON.stringify({ company, project }, null, 2) + '\n');
await ctx.close();
await browser.close();

console.log(`\nWrote web/src/demo.json — ${(saved.length / 1024).toFixed(1)} kB, `
  + `${project.room.walls.length} walls, ${project.extras.baseline ? 'signed' : 'unsigned'}, `
  + `${JSON.parse(company).prices?.rates?.length ?? 0} rates, `
  + `${project.extras.damages?.length ?? 0} damaged area(s)`);
