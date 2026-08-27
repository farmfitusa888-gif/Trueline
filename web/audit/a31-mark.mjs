import { openChromium } from '../../core/tools/browser.mjs';
import { check, URL, SP, pick, report, section } from './lib.mjs';

/**
 * A refusal you cannot see is a button that does not work.
 *
 * > "MARK BUTTON DOESNT WORK IN THE WALL SECTION WHEN CLICKED"
 *
 * It worked. `keep()` in `Damage.tsx` refuses a mark with no description — and
 * said so at the TOP of a panel, several screens above the button being
 * pressed. From where a thumb is, a working refusal and a dead control are the
 * same thing. This part holds the fix: the refusal appears **beside the button
 * that was refused**, on screen, and the cursor lands in the box it is asking
 * about.
 *
 * It runs at a **real phone height**, and that is not a detail. Every other
 * part of this audit opens a 430 by 1600 window — taller than any phone ever
 * made — so nothing is ever below the fold and no check about whether a person
 * can SEE something can ever fail. Reverting the fix under the shared viewport
 * failed one check out of eight; at 430 by 800 it fails the ones that matter.
 * A test that cannot reproduce the reported bug is not a test of that bug.
 *
 * It also runs on Sam's own dining/living scan — nine walls, three doors, three
 * windows, an eleven-corner outline that is not a rectangle. Every other part of
 * this audit runs on a perfect 21 by 20 box, so this is the first check in the
 * project that has ever seen a room with a hallway coming off it.
 */

// 430 by 800: an iPhone 15 Pro Max with the browser's own chrome taken off.
const browser = await openChromium();
const ctx = await browser.newContext({ viewport: { width: 430, height: 800 }, acceptDownloads: true });
const page = await ctx.newPage();
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.setInputFiles('input[type=file][accept="application/json,.json"]', `${SP}/dining.json`);
await page.waitForTimeout(700);

await section(page, 'Plan');
await page.waitForTimeout(400);

const walls = await page.getByRole('button', { name: /^Wall / }).count();
check('a real scan opens, with all of its walls', walls >= 9, `${walls} walls`);

await pick(page, /^Wall wall-5/);
await page.waitForTimeout(300);

/* ------------------------------------- the refusal, where the button is */

// "+ a spot" is how the wall panel opens the spot-mark flow.
await page.getByRole('button', { name: '+ a spot', exact: true }).first().click();
await page.waitForTimeout(400);

const mark = page.getByRole('button', { name: /^Mark a spot on / }).first();
const there = await mark.count();
check('the mark button is reachable from a wall', there === 1, `${there} found`);

if (there === 1) {
  await mark.scrollIntoViewIfNeeded();
  const buttonBox = await mark.boundingBox();
  await mark.click();
  await page.waitForTimeout(600);

  const says = await page.getByRole('status')
    .filter({ hasText: 'Say what the damage is first' }).all();
  check('pressing it with no description says why, rather than doing nothing',
    says.length >= 1, `${says.length} messages`);

  // Measured, not guessed. Before the fix there was exactly one message and it
  // sat 280 px above the button at a 430 by 800 phone; after it there is also
  // one 88 px below the button. 150 px is comfortably between the two, and the
  // check fails on the old behaviour rather than merely passing on the new.
  const height = page.viewportSize().height;
  let nearest = Infinity;
  let onScreen = false;
  for (const say of says) {
    const box = await say.boundingBox();
    if (!box) continue;
    nearest = Math.min(nearest, Math.abs(box.y - buttonBox.y));
    if (box.y >= 0 && box.y <= height) onScreen = true;
  }
  check('and the reason is on the screen', onScreen, `nearest ${nearest}px`);
  check('and it is beside the button that was pressed, not a panel above it',
    nearest < 150, `nearest message is ${nearest.toFixed(0)}px from the button`);

  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    return el instanceof HTMLInputElement ? (el.placeholder ?? '') : '';
  });
  check('and the cursor is in the box it is asking about',
    /soft under the window|water line along/.test(focused), `focused placeholder: "${focused}"`);

  // Now say something, and it goes.
  await page.getByLabel('What is it?').fill('sill plate is soft under the window');
  await page.getByRole('button', { name: /^Mark a spot on / }).first().click();
  await page.waitForTimeout(600);
  const body = await page.locator('body').innerText();
  check('with a description it marks, and the mark is listed',
    /sill plate is soft under the window/.test(body), body.slice(-700));
}

/* ==========================================================================
   The mark, once made, has to lead somewhere — and say so.
   ========================================================================== */

// Sam: "I CAN ADD A MARK BUT CANNOT ATTACH A PHOTOGRAPH TO IT." He could. The
// photograph control lives inside the mark's own row, and the closed row said
// nothing about it: one word, "Open", in 12px grey beside an em-dash, and no
// `aria-expanded` for anybody listening rather than looking. A control nobody
// can find is a control that does not exist — and on a damage mark the
// photograph is the single thing that cannot be taken again once the wall is
// boarded.
const row = page.getByRole('button', { name: /sill plate is soft under the window/ }).first();
check('the mark it made is listed', (await row.count()) === 1);

if (await row.count()) {
  const shut = await row.getAttribute('aria-expanded');
  check('the row says out loud that it opens, for anybody not looking at it',
    shut === 'false', `aria-expanded=${shut}`);
  check('and it says what is missing without being opened at all',
    /No photograph yet/.test(await row.innerText()), await row.innerText());
  check('there is no way to photograph it while the row is shut',
    (await page.getByRole('button', { name: /Photograph it|^Another$/ }).count()) === 0);

  await row.click();
  await page.waitForTimeout(500);
  check('opening it reaches the camera',
    (await page.getByRole('button', { name: /Photograph it|^Another$/ }).count()) === 1);
  check('and the row now says it is open',
    (await row.getAttribute('aria-expanded')) === 'true');
  // Sam: "WHEN YOU DROPDOWN ANY MENU, HAVE A WAY TO COLLAPSE THEM BACK."
  check('and offers the way back, in that word',
    /Close/.test(await row.innerText()), await row.innerText());

  await row.click();
  await page.waitForTimeout(400);
  check('which shuts it again',
    (await row.getAttribute('aria-expanded')) === 'false'
    && (await page.getByRole('button', { name: /Photograph it|^Another$/ }).count()) === 0);
}

check('no console or page errors across the whole run', problems.length === 0, problems.join(' | '));

const bad = report('A31 — the mark button, on a real scan');
await ctx.close();
await browser.close();
process.exit(bad > 0 ? 1 : 0);
