import { SP, check, loadScan, noise, open, pick, report, section } from './lib.mjs';

/**
 * Taking several photographs off a mark at once, without losing the wrong ones.
 *
 * > "BUILD IT!" — batch photo delete. Deleting photographs one at a time on a
 * > phone, after a scan that took fifty of them, is unusable.
 *
 * ## Why this part is written the way it is
 *
 * Sam has already lost real work in this app once. A room with **53
 * photographs** was deleted by accident, because a rename had not shown up on
 * the room screen and there was no way to tell which file was which before it
 * went. A batch delete is the most destructive control in the product, and the
 * failure it produces is silent: the screen looks right, the count adds up, and
 * the photograph that is gone is the one that cannot be taken again.
 *
 * So nothing here is checked by reading a number the app printed. Every
 * photograph on the mark is read off the page **by name** before the delete,
 * the set to be deleted is chosen on this side, and the survivors are compared
 * by identity afterwards. A count that matches proves nothing on its own: three
 * out of six going and three coming back is exactly what taking the wrong three
 * looks like.
 *
 * What it walks, in the order it would break:
 *
 *   1. Six photographs on a mark on a claim, and the claim document showing all
 *      six of them.
 *   2. Picking: the count in words, select all, clear, and each thumbnail
 *      saying in words whether it is picked.
 *   3. The confirmation, which has to name the count, name what the
 *      photographs are being used for, and say what can be taken back — before
 *      anything happens. Then backing out of it and changing nothing.
 *   4. The delete itself: exactly the three picked go, by name, and the other
 *      three are untouched — on the mark and on the claim document.
 *   5. Undo, which has to bring back the same three, with their pictures.
 *   6. Emptying a mark, which has to say that is what it is doing.
 *   7. A reload, because a delete that comes back is not a delete and a
 *      survivor that does not is worse.
 */

const { browser, ctx, page } = await open();
await loadScan(page, 'garage-furnished.json');

const plan = page.locator('[data-panel="plan"]');
const claim = page.locator('[data-panel="claim"]');

/** Every photograph on the mark's strip, by name, in the order it is shown. */
async function onTheMark() {
  return plan
    .locator('img[alt^="Damage photograph "]')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('alt').replace('Damage photograph ', ''))
    );
}

/** Every photograph the claim document is showing, by name. */
async function onTheClaim() {
  return claim
    .locator('img[alt^="Photograph of the damage, "]')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('alt').replace('Photograph of the damage, ', ''))
    );
}

/* ==========================================================================
   1. A claim, a mark on a wall, and six photographs of it.
   ========================================================================== */

await section(page, 'Insurance');
await page.getByRole('button', { name: 'Turn it on' }).click();
await page.waitForTimeout(300);

await section(page, 'Plan');
await pick(page, /^Wall wall-1,/);
await page.getByRole('button', { name: '+ damaged area' }).click();
await page.getByRole('button', { name: 'Water', exact: true }).click();
await page
  .getByPlaceholder('water line along the bottom of the wall')
  .fill('supply line behind the washer');
await page.getByLabel('How far from the corner it starts').fill('0');
await page.getByLabel('How wide it is').fill('6');
await page.getByLabel('How high up the wall it goes').fill('18"');
await page.getByRole('button', { name: 'Mark it' }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: /Open$/ }).first().click();
await page.waitForTimeout(300);

// Six of them, which is what a walk hands somebody. Attached the way a phone
// attaches them: one input, several files.
await page.setInputFiles(
  'input[aria-label="Photograph the damage"]',
  Array.from({ length: 6 }, () => `${SP}/damage-photo.jpg`)
);
await page.waitForTimeout(7000);

const before = await onTheMark();
check('six photographs attach to one mark', before.length === 6, before.join(', '));
check('and each one is its own file, not the same name six times',
  new Set(before).size === 6, before.join(', '));

// The claim document, opened, so it is carrying them. This is also what makes
// the delete able to say "3 of these are on the claim" — the list that prints
// them is the thing that says so.
await section(page, 'Insurance');
await page.getByRole('button', { name: 'The report' }).click();
await page.waitForTimeout(600);
const claimBefore = await onTheClaim();
check('the claim document is carrying all six', claimBefore.length === 6, claimBefore.join(', '));

await section(page, 'Plan');
await page.waitForTimeout(200);

/* ==========================================================================
   2. Picking. Fifty taps is the reason this feature exists, so select all and
      clear are not conveniences — and the count is never left to be worked
      out from which thumbnails happen to be ringed.
   ========================================================================== */

await plan.getByRole('button', { name: 'Pick several' }).click();
await page.waitForTimeout(200);
let t = await plan.innerText();
check('picking says how many are picked, in words', /0 of 6 picked/.test(t), t.slice(0, 400));
check('and there is nothing to delete until something is picked',
  (await plan.getByRole('button', { name: /^Delete \d+ photograph/ }).count()) === 0);

await plan.getByRole('button', { name: 'Select all' }).click();
await page.waitForTimeout(200);
t = await plan.innerText();
check('select all takes every one', /6 of 6 picked/.test(t), t.slice(0, 400));
check('and every thumbnail says so in words, not only with a ring round it',
  (await plan.getByText('Picked', { exact: true }).count()) === 6);

await plan.getByRole('button', { name: 'Clear' }).click();
await page.waitForTimeout(200);
check('clear puts them all back', /0 of 6 picked/.test(await plan.innerText()));
check('and nothing has left the mark by picking or unpicking',
  (await onTheMark()).join('|') === before.join('|'));

// Three of the six, chosen here rather than by the app: the second, fourth and
// fifth. If the delete is off by one this is where it shows.
const wanted = [before[1], before[3], before[4]];
for (const n of [2, 4, 5]) {
  await plan.getByRole('button', { name: `Photograph ${n} of 6` }).click();
  await page.waitForTimeout(100);
}
check('the count follows the taps', /3 of 6 picked/.test(await plan.innerText()));

/* ==========================================================================
   3. What it says before anything goes.
   ========================================================================== */

await plan.getByRole('button', { name: 'Delete 3 photographs' }).click();
await page.waitForTimeout(300);
const asking = plan.getByRole('alertdialog', { name: 'Before these photographs go' });
check('a batch delete asks first', (await asking.count()) === 1);
t = await asking.innerText();

check('it says how many are going, in words', /Delete 3 photographs\./.test(t), t);
check('it names what they are being used for — these are on the claim',
  /3 of these are on the claim\./.test(t), t);
check('and that they come off the claim document with them',
  /off the claim document/.test(t), t);
check('it says what is left afterwards', /3 photographs stay on this mark\./.test(t), t);
check('it says where the only copy of them is',
  /3 of them are on this browser only\. Nothing else has a copy\./.test(t), t);
check('it says what can be taken back, and what cannot',
  /put them back until you leave this screen/.test(t) && /dropped for good/.test(t), t);
// Two things at once. It says the consequence -- a document that went out
// keeps the pictures that were in it -- and, where the hand-over record is
// silent, it says "if" rather than "nothing has been sent". The record lives on
// this device, so silence in it is not knowledge that nothing went out.
check('and it never pretends it can reach a document that has already gone out',
  /keeps the photographs that went with it/.test(t), t);
check('and where the record says nothing, it claims nothing',
  /If a claim document or an archive has already gone out/.test(t)
    && !/nothing has been sent|has not been sent/i.test(t), t);

// Backing out has to be free.
await asking.getByRole('button', { name: 'Keep them' }).click();
await page.waitForTimeout(300);
check('keeping them takes nothing off',
  (await onTheMark()).join('|') === before.join('|'), (await onTheMark()).join(', '));
check('and the picking is still where it was', /3 of 6 picked/.test(await plan.innerText()));

/* ==========================================================================
   4. The delete. Counted before and after, and checked by name — because
      three going and three staying is also what taking the wrong three looks
      like.
   ========================================================================== */

await plan.getByRole('button', { name: 'Delete 3 photographs' }).click();
await page.waitForTimeout(200);
await plan.getByRole('button', { name: 'Delete them' }).click();
await page.waitForTimeout(800);

const after = await onTheMark();
const expected = before.filter((name) => !wanted.includes(name));
check('three of the six went', after.length === before.length - 3,
  `${before.length} before, ${after.length} after`);
check('and the ones left are exactly the ones nobody picked, by name',
  after.join('|') === expected.join('|'), `left ${after.join(', ')} — expected ${expected.join(', ')}`);
check('none of the three that were picked is still on the mark',
  wanted.every((name) => !after.includes(name)), `${wanted.join(', ')} vs ${after.join(', ')}`);
check('and no photograph appeared that was never there',
  after.every((name) => before.includes(name)), after.join(', '));

await section(page, 'Insurance');
await page.waitForTimeout(400);
const claimAfter = await onTheClaim();
check('they come off the claim document too, and only they do',
  claimAfter.join('|') === expected.join('|'),
  `claim has ${claimAfter.join(', ')} — expected ${expected.join(', ')}`);
await section(page, 'Plan');
await page.waitForTimeout(200);

/* ==========================================================================
   5. Undo. The bar says they can go back, so they have to actually go back —
      the names in their old order, and the pictures with them.
   ========================================================================== */

t = await plan.innerText();
check('the screen says what was deleted and that it can be undone',
  /3 photographs deleted\./.test(t) && /can go back until you leave this screen/.test(t),
  t.slice(0, 600));

await plan.getByRole('button', { name: 'Put them back' }).click();
await page.waitForTimeout(900);
const back = await onTheMark();
check('put them back brings back every one, in the order they were in',
  back.join('|') === before.join('|'), `${back.join(', ')} vs ${before.join(', ')}`);
check('and the pictures come back with the names',
  !(await plan.innerText()).includes('Not on this device'), await plan.innerText());

await section(page, 'Insurance');
await page.waitForTimeout(400);
check('the claim document has all six again',
  (await onTheClaim()).join('|') === before.join('|'));
await section(page, 'Plan');
await page.waitForTimeout(200);

/* ==========================================================================
   6. Taking every photograph off a mark. The mark stays and has nothing on it
      to look at, which is a thing somebody has to be told before it happens.
   ========================================================================== */

await plan.getByRole('button', { name: 'Pick several' }).click();
await plan.getByRole('button', { name: 'Select all' }).click();
await page.waitForTimeout(200);
await plan.getByRole('button', { name: 'Delete 6 photographs' }).click();
await page.waitForTimeout(300);
t = await plan.getByRole('alertdialog', { name: 'Before these photographs go' }).innerText();
check('emptying a mark says that is what it is doing',
  /That is every photograph on this mark\./.test(t), t);
check('and says what the mark is left as',
  /nothing on it to look at/.test(t), t);

await plan.getByRole('button', { name: 'Delete them' }).click();
await page.waitForTimeout(800);
check('all six go', (await onTheMark()).length === 0, (await onTheMark()).join(', '));
check('the mark itself is still there',
  /supply line behind the washer/.test(await plan.innerText()));
check('and the screen offers to photograph it again rather than looking broken',
  (await plan.getByRole('button', { name: 'Photograph it' }).count()) === 1);

await plan.getByRole('button', { name: 'Put them back' }).click();
await page.waitForTimeout(900);
check('and all six come back from that too',
  (await onTheMark()).join('|') === before.join('|'), (await onTheMark()).join(', '));

/* ==========================================================================
   7. Put down and picked up again. A delete that comes back is not a delete,
      and a survivor that does not come back is the 53 photographs.
   ========================================================================== */

await plan.getByRole('button', { name: 'Pick several' }).click();
const twoGone = [before[0], before[5]];
for (const n of [1, 6]) {
  await plan.getByRole('button', { name: `Photograph ${n} of 6` }).click();
  await page.waitForTimeout(100);
}
await plan.getByRole('button', { name: 'Delete 2 photographs' }).click();
await page.waitForTimeout(200);
await plan.getByRole('button', { name: 'Delete them' }).click();
await page.waitForTimeout(600);
// Done, rather than leaving the undo open: this is the person saying they meant
// it, which is the point at which the bytes are actually dropped.
await plan.getByRole('button', { name: 'Leave them off' }).click();
await page.waitForTimeout(500);

const kept = before.filter((name) => !twoGone.includes(name));
check('four are left before the reload', (await onTheMark()).join('|') === kept.join('|'));

await page.reload({ waitUntil: 'networkidle' });
await loadScan(page, 'garage-furnished.json');
await section(page, 'Plan');
await pick(page, /^Wall wall-1,/);
await page.getByRole('button', { name: /Open$/ }).first().click();
await page.waitForTimeout(900);

const afterReload = await onTheMark();
check('the four survivors come back, by name and in order',
  afterReload.join('|') === kept.join('|'), `${afterReload.join(', ')} vs ${kept.join(', ')}`);
check('and the two that were deleted stay deleted',
  twoGone.every((name) => !afterReload.includes(name)), afterReload.join(', '));
check('the survivors still have their pictures after a reload',
  !(await plan.innerText()).includes('Not on this device'),
  (await plan.innerText()).slice(0, 500));

check('no console or page errors across the whole run', noise().length === 0, noise().join(' | '));

const bad = report('A28 — taking several photographs off, and getting them back');
await ctx.close();
await browser.close();
process.exit(bad > 0 ? 1 : 0);
