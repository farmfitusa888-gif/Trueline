import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { chromium } from 'playwright';

import { SP, URL, check, report } from './lib.mjs';

/**
 * How many cards the handbook should have, counted from the handbook.
 *
 * Never a number typed in here: adding a card would fail this check for no
 * reason, and somebody would "fix" it by raising the number, which is how a
 * count check stops checking anything.
 */
const repo = dirname(dirname(SP));
const source = readFileSync(join(repo, 'docs', 'handbook.html'), 'utf8');
const EXPECTED = (source.match(/^      \{ t: /gm) ?? []).length;

/**
 * The handbook, inside the app, with the network cut.
 *
 * It is bundled rather than linked for one reason: the person who needs it is
 * standing in somebody's unfinished basement with no signal. So the check that
 * matters is not that it renders — it is that it renders **with every outbound
 * request refused**, which is the only way to prove nothing in it is being
 * fetched from a webserver at read time.
 *
 * The rest is what a guide has to be able to do: be got to from the app, be
 * searched, and let somebody back out again.
 */
const CHROME =
  process.env.TRUELINE_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({ viewport: { width: 430, height: 1600 } });
const page = await ctx.newPage();

// Everything that is not the app's own origin is refused, and every refusal is
// recorded. A font, a script or a stylesheet from anywhere else shows up here.
const reachedOut = [];
await ctx.route('**', (route) => {
  const target = route.request().url();
  if (target.startsWith(URL) || target.startsWith('data:') || target.startsWith('blob:')) {
    return route.continue();
  }
  reachedOut.push(target);
  return route.abort();
});

const failures = [];
page.on('pageerror', (e) => failures.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') failures.push(m.text()); });

await page.goto(URL, { waitUntil: 'networkidle' });

const help = page.getByRole('link', { name: 'How to use it' });
check('the app offers the handbook from its first screen', (await help.count()) === 1,
  `${await help.count()} links`);

await help.click();
await page.waitForLoadState('networkidle');

check('and it opens', /handbook/.test(page.url()), page.url());
check('with nothing fetched from off the device', reachedOut.length === 0,
  reachedOut.join(' | '));

const cards = page.locator('.card');
check(`every card is there — all ${EXPECTED} of them`,
  (await cards.count()) === EXPECTED, `${await cards.count()} on screen, ${EXPECTED} in the source`);

// The search is the whole reason this is a web page rather than a PDF.
const find = page.getByRole('searchbox').or(page.locator('.finder input')).first();
await find.fill('tape');
await page.waitForTimeout(300);
const matched = await cards.count();
check('searching narrows it', matched > 0 && matched < EXPECTED,
  `${matched} of ${EXPECTED} match "tape"`);

const said = await page.locator('.count').innerText();
check('and it says how many matched', new RegExp(`of ${EXPECTED}`).test(said), said);

await find.fill('zzzzz');
await page.waitForTimeout(300);
const nothing = await page.locator('body').innerText();
check('a search that matches nothing says what to try instead',
  /Nothing here matches/.test(nothing) && /tape, wall, damage/.test(nothing),
  nothing.slice(0, 200));

await find.fill('');
await page.waitForTimeout(300);

const back = page.getByRole('link', { name: /Back to Trueline/ });
check('there is a way back to the app', (await back.count()) === 1);
await back.click();
await page.waitForLoadState('networkidle');
check('and it goes there', (await page.getByRole('heading', { name: 'Open a scan' }).count()) === 1,
  page.url());

check('nothing threw on the way', failures.length === 0, failures.join(' | '));

const bad = report('A13 — the handbook, inside the app, offline');
await browser.close();
process.exit(bad === 0 ? 0 : 1);
