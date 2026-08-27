/**
 * Real screenshots of the real app, for the website.
 *
 * Nothing on the site is a mock-up, an illustration or a render of something
 * that does not exist. This drives the actual bundle in an actual browser with
 * an actual scan in it and photographs what comes up — the same code the phone
 * runs, the same numbers off the same geometry.
 *
 * That is not a purity exercise. A site full of generated imagery reads as
 * generated, and the one thing this product sells is that its numbers are real.
 *
 * Run it with the preview server up:
 *
 *   npm run build && (cd web && npx vite preview --port 4173 &) && node site/tools/capture.mjs
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { openChromium } from '../../core/tools/browser.mjs';

const URL = process.env.TRUELINE_AUDIT_URL ?? 'http://127.0.0.1:4173/';
const OUT = new globalThis.URL('../src/shots/', import.meta.url).pathname;
const FIXTURES = new globalThis.URL('../../web/audit/', import.meta.url).pathname;

mkdirSync(OUT, { recursive: true });

const kitchen = JSON.parse(readFileSync(`${FIXTURES}kitchen.json`, 'utf8'));

/** Rates a contractor would actually have typed, so the money is arithmetic. */
const RATES = [
  ['Floor rate', '9.50'], ['Ceiling rate', '4.25'], ['Wall face rate', '3.75'],
  ['Baseboard rate', '6.00'], ['Doors rate', '450.00'], ['Windows rate', '300.00'],
];

const browser = await openChromium();

/** One profile, typed once, handed to every later page the way the app does. */
async function profile() {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 1400 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__sent = {};
    window.webkit = { messageHandlers: {} };
    for (const n of ['saved', 'thumbnail', 'company', 'photo', 'calendar', 'trouble', 'mark', 'draft']) {
      window.__sent[n] = [];
      window.webkit.messageHandlers[n] = { postMessage(b) { window.__sent[n].push(b); } };
    }
    window.truelinePayload = { subscribed: true };
  });
  await page.goto(URL + '#business', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.getByLabel('Business name').fill('Reyes Remodeling');
  await page.getByLabel('Phone').fill('(847) 555-0142').catch(() => {});
  for (const [label, value] of RATES) {
    const box = page.getByLabel(label);
    if (await box.count()) { await box.fill(value); await box.blur(); await page.waitForTimeout(60); }
  }
  await page.waitForTimeout(400);
  const company = await page.evaluate(() => window.__sent.company.at(-1)?.company ?? '');
  await ctx.close();
  return company;
}

const company = await profile();

async function open(payload, { width = 430, height = 1400 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript((parked) => {
    window.webkit = { messageHandlers: {} };
    for (const n of ['saved', 'thumbnail', 'company', 'photo', 'calendar', 'trouble', 'mark', 'draft']) {
      window.webkit.messageHandlers[n] = { postMessage() {} };
    }
    window.truelinePayload = parked;
  }, payload);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  return { ctx, page };
}

async function part(page, title) {
  await page.getByRole('navigation', { name: 'Parts of this room' })
    .getByRole('button', { name: new RegExp('^' + title) }).first().click();
  const key = { Plan: 'plan', Room: 'room', Takeoff: 'takeoff', Price: 'price',
                Agreement: 'agree', Work: 'work', Insurance: 'claim', Files: 'files' }[title];
  await page.waitForSelector(`[data-panel="${key}"]:not([hidden])`, { timeout: 5000 });
  await page.waitForTimeout(400);
}

/** Crops to one element, so a shot is the thing rather than the page around it. */
async function shotOf(page, locator, name) {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await locator.screenshot({ path: `${OUT}${name}.png` });
  console.log('  ✓', name);
}

console.log('Capturing:');

/* ---- the room, from the scan, all the way through ---- */
{
  const { ctx, page } = await open({
    company, subscribed: true, room: kitchen, fileName: 'Reyes — kitchen',
  });

  await part(page, 'Plan');
  await shotOf(page, page.locator('[data-sheet="yes"]').first(), 'plan');

  // Standing inside it, which is the thing nobody expects a measuring app to do.
  await page.getByRole('tab', { name: '3D' }).click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Stand inside' }).click();
  await page.waitForTimeout(800);
  await shotOf(page, page.locator('svg[aria-label*="Standing in"]'), 'inside');

  await part(page, 'Takeoff');
  await shotOf(page, page.locator('[data-panel="takeoff"] section').first(), 'takeoff');

  await part(page, 'Price');
  await shotOf(page, page.locator('[data-panel="price"] section').first(), 'price');

  await part(page, 'Agreement');
  await page.getByLabel(/What to call this option/i).fill('As measured');
  await page.getByLabel(/One line on what it covers/i)
    .fill('Floor, ceiling, walls and base through the kitchen, with the door and window trimmed out.');
  await page.getByRole('button', { name: 'Write the proposal' }).click();
  await page.waitForTimeout(700);
  await page.getByLabel(/Who it is for/i).fill('J. Whitaker');
  await page.getByLabel(/Address of the work/i).fill('118 Willow St');
  await page.getByRole('button', { name: 'Save these details' }).click();
  await page.waitForTimeout(400);
  await shotOf(page, page.locator('[data-panel="agree"] section').first(), 'proposal');

  await part(page, 'Insurance');
  const turnOn = page.getByRole('button', { name: 'Turn it on' });
  if (await turnOn.count()) { await turnOn.click(); await page.waitForTimeout(500); }
  await shotOf(page, page.locator('[data-panel="claim"] section').first(), 'claim');

  await ctx.close();
}

/* ---- the grid, with the room drawn on it ---- */
{
  const { ctx, page } = await open({ company, subscribed: true });
  await page.goto(URL + '#draw', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.getByLabel('What to call it').fill('Front bedroom');
  await page.getByRole('button', { name: 'Start drawing' }).click();
  await page.waitForTimeout(400);
  const board = page.locator('svg[role="application"]');
  const tap = async (fx, fy) => {
    const b = await board.boundingBox();
    await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy);
    await page.waitForTimeout(200);
  };
  await tap(0.26, 0.72); await tap(0.74, 0.715); await tap(0.745, 0.32); await tap(0.26, 0.325);
  await board.locator('circle').first().click();
  await page.waitForTimeout(400);
  await shotOf(page, board, 'grid');
  await ctx.close();
}

await browser.close();
console.log('\nShots are in site/src/shots/');
