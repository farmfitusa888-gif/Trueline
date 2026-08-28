import { SP, check, loadScan, noise, open, pick, report, section } from './lib.mjs';

/**
 * The proposal, the signature, and the change order.
 *
 * Two of the four ways a remodeler loses money, walked end to end in a real
 * browser: a document a homeowner can say yes to, and what happens to the scope
 * afterwards. The last check is the one that matters most on this file —
 * editing the agreed document instead of raising a change against it has to be
 * caught and said out loud.
 */
const { browser, ctx, page } = await open();
await loadScan(page);

/* ---------------------------------------------------- nothing to agree to yet */

await section(page, 'Agreement');
let t = await page.locator('body').innerText();
check('a room with no rates cannot be made into a proposal',
  /no rate against/.test(t), t.slice(0, 300));

/* ------------------------------------------------------------- set the rates */

await section(page, 'Price');
await page.getByRole('button', { name: /Set your rates|Your rates/ }).first().click();
await page.waitForTimeout(300);
const rates = page.locator('section', { has: page.getByRole('heading', { name: 'What you charge' }) }).first();
// Every rate the sheet asks for, rather than a guessed list of names: an
// unpriced line is exactly what stops a proposal being written, so the audit
// has to price all of them or it is testing the refusal instead of the feature.
const boxes = await rates.getByRole('textbox').all();
check('the rates screen asks for a rate per takeoff line', boxes.length >= 3, `${boxes.length} boxes`);
for (const box of boxes) {
  await box.fill('5.00');
  await box.blur();
  await page.waitForTimeout(120);
}
await page.waitForTimeout(400);

/* --------------------------------------------------------- write a proposal */

await section(page, 'Agreement');
t = await page.locator('body').innerText();
const priced = !/no rate against/.test(t);
check('with rates set, a proposal can be written', priced, t.slice(0, 400));

if (priced) {
  await page.getByLabel('What to call this option').fill('Everything measured');
  await page.getByLabel('One line on what it covers').fill('The whole room, finished.');
  await page.getByRole('button', { name: 'Write the proposal' }).click();
  await page.waitForTimeout(400);

  t = await page.locator('body').innerText();
  check('the proposal carries the price from the takeoff, not a typed one',
    /\$[\d,]+\.\d\d/.test(t), t.slice(0, 400));
  check('what is missing is named and nothing is blocked',
    /Still to fill in/.test(t), t.slice(0, 500));

  /* ------------------------------------------------------- the client details */

  await page.getByLabel('Who it is for').fill('M. Alvarez');
  await page.getByLabel('Address of the work').fill('14 Sycamore');
  await page.getByLabel('How long the price holds').fill('2026-09-25');
  await page.getByRole('button', { name: 'Save these details' }).click();
  await page.waitForTimeout(300);
  t = await page.locator('body').innerText();
  check('filling the details clears them from the missing list',
    !/who it is for/.test(t), t.slice(0, 400));

  /* ------------------------------------------------------------- signing it */

  check('nothing can be signed before an option is taken',
    /Take an option above first/.test(t), t.slice(-500));

  await page.getByRole('button', { name: 'Take this one' }).first().click();
  await page.waitForTimeout(300);

  // A signature with no name attributes to nobody, and is refused.
  const pad = page.getByRole('img', { name: 'Sign here with your finger' });
  // The pad is measured on EVERY stroke, and scrolled to first. On a real
  // phone height it starts below the fold, and mouse coordinates are viewport
  // coordinates: a box read once, before scrolling, points at empty air after
  // the page moves, and the finger draws nothing at all.
  const draw = async () => {
    await pad.scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
    const box = await pad.boundingBox();
    if (!box) throw new Error('the signature pad has no box on screen');
    await page.mouse.move(box.x + 40, box.y + 90);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 40, { steps: 8 });
    await page.mouse.move(box.x + 200, box.y + 100, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);
  };
  await draw();
  await page.getByRole('button', { name: /^Agree to / }).click();
  await page.waitForTimeout(400);
  t = await page.locator('body').innerText();
  check('signing without a name is refused, and says why',
    /attributes to nobody/.test(t), t.slice(-400));

  // And without agreeing to sign electronically.
  await page.getByLabel('Your name').fill('M. Alvarez');
  await page.getByRole('button', { name: /^Agree to / }).click();
  await page.waitForTimeout(400);
  t = await page.locator('body').innerText();
  check('signing without agreeing to do it electronically is refused',
    /has to be agreed to before it happens/.test(t), t.slice(-400));

  await page.getByLabel('I agree to sign electronically').check();
  await page.getByRole('button', { name: /^Agree to / }).click();
  await page.waitForTimeout(600);
  t = await page.locator('body').innerText();

  check('a complete signature is accepted', /Agreed —/.test(t), t.slice(-600));
  check('the evidence is written out in words, not only as hex',
    /signed as the client/.test(t) && /agreed to sign electronically/i.test(t), t.slice(-800));
  check('the fingerprint of what was signed is recorded',
    /SHA-256/.test(t), t.slice(-600));
  check('the mark itself is kept',
    (await page.locator('img[alt^="Signature of"]').count()) === 1);
  check('nothing has changed the moment it is signed',
    /Nothing has changed since this was signed/.test(t), t.slice(-400));

  /* -------------------------------------------- and now the room is edited */

  await section(page, 'Plan');
  await pick(page, /^Wall wall-1,/);
  await page.getByRole('button', { name: 'Change this wall' }).click();
  await page.waitForTimeout(250);
  await page.getByRole('textbox', { name: 'Move this wall to' }).fill('26');
  await page.getByRole('button', { name: 'Move it', exact: true }).click();
  await page.waitForTimeout(500);

  await section(page, 'Agreement');
  await page.waitForTimeout(500);
  t = await page.locator('body').innerText();

  check('growing the room becomes a priced change, not a silent new total',
    /changes? since signing/.test(t), t.slice(-800));
  check('the signed total is still shown beside the new one',
    /Signed at \$[\d,]+\.\d\d, now/.test(t), t.slice(-500));
  check('the agreed scope itself is untouched by the edit',
    /Agreed —/.test(t), t.slice(-900));
}

check('no console or page errors across the whole run', noise().length === 0, noise().join(' | '));

const bad = report('A8 — the proposal, the signature, and the change order');
await ctx.close();
await browser.close();
process.exit(bad > 0 ? 1 : 0);
