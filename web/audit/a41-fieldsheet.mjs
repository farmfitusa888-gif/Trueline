import { HEIGHT, check, loadScan, noise, open, pick, report, section } from './lib.mjs';

/**
 * The list that goes into a pocket — the three controls that get it out.
 *
 * ## Why this part exists
 *
 * `FieldSheet.tsx` is the only screen in `web/src` that no part of this audit
 * had ever touched, by name or otherwise. Its three buttons — **Send it**,
 * **Copy**, **Print** — are the whole point of the file: the punch list has
 * always been on a screen, and this is the one control that turns it into
 * something somebody can hold while they are holding a tape. Nothing had ever
 * pressed one of them.
 *
 * That is the exact state all four of this month's found-by-looking bugs were
 * in. The paywall compiled and nothing presented it. The refusal drew itself
 * 280 pixels above the button. "Photograph it" sat inside a row that gave no
 * sign it opened. Every time, the control was finished and no script had ever
 * asked for it by name, so nothing had ever had a chance to notice.
 *
 * ## What is asked of them here
 *
 * Not that they exist — a checker can see that. Each check below states
 * something that would be false if the control were quietly broken:
 *
 *   1. All three are **completely inside a real phone window** with nothing
 *      scrolled. `TRUELINE_AUDIT_HEIGHT=800` is the height this is meant to be
 *      run at; at the 1600 default nothing in this app has ever been below the
 *      fold, so this check has never been able to fail there.
 *   2. **Copy hands over the list itself.** The clipboard is read back and
 *      compared against the text the sheet shows — not against a phrase this
 *      file happens to know. A button that copies a stale list, an empty
 *      string, or the wrong room passes every other kind of test in the
 *      repository.
 *   3. **"Send it" is not inert where there is no share sheet.** Chromium has
 *      no `navigator.share`, which is also every desktop browser a contractor
 *      opens a client file in. The button says "Send it"; the check is that
 *      something actually leaves it.
 *   4. **Print carries the list even while the screen is not showing it.**
 *      That is the claim the component's own comment makes, and it is
 *      invisible on screen by construction.
 *   5. **The toggle says what pressing it will do.** "Your business" once kept
 *      that accessible name while showing the word "Close", which is the same
 *      bug one file over.
 *   6. **Nothing on the sheet is a quantity.** `fieldlist.ts` is emphatic
 *      about this and it is a promise to a person, not a data-structure
 *      invariant: a square-foot figure beside a condition note reads as work
 *      somebody has agreed to, and nobody has agreed to anything by noticing
 *      rot. So a mark is put on a wall through the app and the sheet is read
 *      for an area that must not be on it.
 *
 * Nothing below imports anything from the app. Every string it looks for is
 * written out here, so a check cannot pass by agreeing with the code it is
 * checking.
 */

/* ------------------------------------------------------------- the fixtures */

/** What somebody would actually type standing at the wall. */
const NOTE = 'sill plate is soft under the window';
/** Where along wall-1 the rot is, in the three numbers the app asks for. */
const FROM = '2';
const WIDE = '6';
const HIGH = '18"';
/** Put on the clipboard first, so "it was already there" can never pass. */
const SENTINEL = 'nothing has copied anything yet';

const { browser, ctx, page } = await open();
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);

// Counted rather than intercepted. A button whose whole job is to open the
// print dialogue has done it when `window.print` has been called, and there is
// no dialogue to look at in a headless browser. a12 counts it the same way.
await page.addInitScript(() => {
  window.__printed = 0;
  const real = window.print;
  window.print = function counted() {
    window.__printed += 1;
    void real;
  };
});
await page.reload({ waitUntil: 'networkidle' });

await loadScan(page);
await section(page, 'Files');

const sheet = page
  .locator('section', { has: page.getByRole('heading', { name: 'Take this list with you' }) })
  .first();

const sheets = await sheet.count();
check('the Files screen carries the list a person takes into the room',
  sheets === 1, `${sheets} sections named "Take this list with you"`);

// Guarded. Every check below reaches into that section, and a section that has
// gone missing should report one failed check rather than forty lines of stack
// trace that hide the rest of the part.
if (sheets !== 1) {
  check('there is nothing more to drive without the sheet on the screen', false,
    'the rest of this part needs the field sheet in the Files section');
  report('A41 — the list that goes into a pocket');
  await ctx.close();
  await browser.close();
  process.exit(1);
}

/* ==========================================================================
   1. All three controls, whole, inside a real phone window.
   ========================================================================== */

const sendIt = sheet.getByRole('button', { name: 'Send it', exact: true });
const copy = sheet.getByRole('button', { name: 'Copy', exact: true });
const print = sheet.getByRole('button', { name: 'Print', exact: true });

for (const [what, control] of [['Send it', sendIt], ['Copy', copy], ['Print', print]]) {
  check(`there is exactly one control called "${what}" on the sheet`,
    (await control.count()) === 1, `${await control.count()} found`);
}

/**
 * Presses a control, or fails a check saying why the walk stops here.
 *
 * A part that dies on a missing control reports one stack trace and hides every
 * check after it — including the ones that would have said what actually broke.
 * Found by watching this file fail: a control taken out of `web/src` should go
 * red on the check that says it is there, not kill the run on a click that
 * timed out thirty seconds later.
 */
async function press(control, whatFor, waitFor = 400) {
  if ((await control.count()) === 0) {
    check(`there is a control to ${whatFor}, which the rest of this part needs`,
      false, 'it is not on the screen, so what follows cannot be walked');
    return false;
  }
  await control.first().click();
  await page.waitForTimeout(waitFor);
  return true;
}

/**
 * Whether a control is entirely inside the window as the screen stands.
 *
 * Not `isVisible()`, which is true of a button four thousand pixels below the
 * fold: it answers "is this drawn" and the question here is "can somebody see
 * it". Both edges are checked, because the failure that started all of this
 * was a control whose top was on the screen and whose bottom was not.
 */
async function whereItIs(control) {
  // Counted first. `boundingBox()` on a locator that matches nothing waits
  // thirty seconds and then throws, which turns a control somebody deleted into
  // a dead run instead of a red check.
  if ((await control.count()) === 0) return { onScreen: false, said: 'there is no such control' };
  const box = await control.first().boundingBox();
  if (box === null) return { onScreen: false, said: 'it is not drawn at all' };
  // Rounded to whole pixels, because the layout is not: a row that ends at
  // 799.6 is not a row somebody cannot see.
  const onScreen = Math.round(box.y) >= 0 && Math.round(box.y + box.height) <= HEIGHT;
  return {
    box,
    onScreen,
    said: `top ${Math.round(box.y)}, bottom ${Math.round(box.y + box.height)}, `
      + `in a window ${HEIGHT} tall`,
  };
}

const places = {};
for (const [what, control] of [['Send it', sendIt], ['Copy', copy], ['Print', print]]) {
  const at = await whereItIs(control);
  places[what] = at;
  check(`"${what}" is whole on the screen with nothing scrolled, at a phone height`,
    at.onScreen, at.said);
  // 44 points is the smallest thing Apple will call a target, and every one of
  // these carries `min-h-11`. A row of three that quietly became text links is
  // a row nobody can hit with a thumb in a cold garage.
  check(`and "${what}" is big enough to hit with a thumb`,
    at.box !== undefined && at.box.height >= 44,
    at.box ? `${Math.round(at.box.height)} px tall` : 'it is not drawn at all');
}

check('and the three of them are on one row, so none is hidden under the next',
  places['Send it'].box !== undefined
  && Math.round(places['Send it'].box.y) === Math.round(places.Copy.box.y)
  && Math.round(places.Copy.box.y) === Math.round(places.Print.box.y),
  [places['Send it'], places.Copy, places.Print].map((p) => p.said).join(' | '));

/* ==========================================================================
   2. Copy hands over the list itself.
   ========================================================================== */

const toggle = sheet.getByRole('button', { name: /^(Show|Hide)$/ });
check('the list is not shown until it is asked for, so the controls stay near the top',
  (await sheet.locator('pre').first().isVisible()) === false,
  'the list was already open');
check('and the one control that opens it says what pressing it will do',
  (await toggle.innerText()).trim() === 'Show', await toggle.innerText());

// What the screen would show if it were opened. Read from the DOM rather than
// written out here on purpose: the question is whether the button copies THE
// LIST, and a phrase typed into this file would only prove it copies a phrase
// somebody typed into this file.
const onTheScreen = (await sheet.locator('pre').first().innerText()).trim();
check('the list the sheet holds names the room it is for',
  onTheScreen.startsWith('garage.json — walls to measure'), onTheScreen.slice(0, 120));

await page.evaluate((mark) => navigator.clipboard.writeText(mark), SENTINEL);
check('the clipboard holds nothing of ours before the button is pressed',
  (await page.evaluate(() => navigator.clipboard.readText())) === SENTINEL,
  'the sentinel did not go onto the clipboard, so nothing below proves anything');

await press(copy, 'copy the list');

const copied = (await page.evaluate(() => navigator.clipboard.readText())).trim();
check('pressing Copy puts something on the clipboard',
  copied !== SENTINEL && copied !== '', copied.slice(0, 200));
check('and what it puts there is the list the sheet is showing, to the character',
  copied === onTheScreen,
  `clipboard ${copied.length} characters, screen ${onTheScreen.length}`);

// Four walls on the punch list, four numbered entries, four blanks to write a
// reading on. The sheet's own paragraph says "4 walls"; the thing in somebody's
// pocket has to agree with it.
const said = await sheet.innerText();
const walls = Number((said.match(/(\d+) walls?, a tape/) ?? [])[1] ?? 0);
check('the sheet says how many walls are worth a tape', walls > 0, said.slice(0, 200));
check('and the copied list has that many walls numbered on it',
  (copied.match(/^\d+\. \S+/gm) ?? []).length === walls,
  `${(copied.match(/^\d+\. \S+/gm) ?? []).length} numbered, ${walls} promised`);
check('each with somewhere to write the reading down, which is what it is for',
  (copied.match(/Measured: {3}_+/g) ?? []).length === walls,
  `${(copied.match(/Measured: {3}_+/g) ?? []).length} blanks, ${walls} walls`);
check('and each with what the scan already said, so the number to write is the one that disagrees',
  (copied.match(/Scan says: {2}\S/g) ?? []).length === walls,
  `${(copied.match(/Scan says: {2}\S/g) ?? []).length} scan readings, ${walls} walls`);

/* ------------------------------------------- and it says so where you pressed */

const told = sheet.getByRole('status');
check('a copy that worked says so, rather than leaving somebody pressing again',
  (await told.count()) === 1 && /Copied/.test(await told.innerText()),
  (await told.count()) === 0 ? 'nothing was said at all' : await told.innerText());

const toldAt = await whereItIs(told);
check('and it says it on the screen, not somewhere a person would have to go and find',
  toldAt.onScreen, toldAt.said);
// The mark button "refused" 280 px above the thumb that pressed it and Sam
// reported a dead button. A confirmation is the same shape: it is only a
// confirmation if it is where the eye already is.
//
// Both boxes are read HERE, together, rather than one of them being the box
// this part measured before anything was pressed. A distance between a stale
// measurement and a fresh one is not a distance on anybody's screen — measured
// that way this check reported a confirmation 115 px above the button on one
// run and 6 px below it on the next, which is a bug in the check.
const buttonNow = (await copy.count()) ? await copy.first().boundingBox() : null;
const toldNow = (await told.count()) ? await told.first().boundingBox() : null;
const gap = buttonNow && toldNow
  ? Math.round(toldNow.y - (buttonNow.y + buttonNow.height))
  : null;
check('and it says it beside the button that was pressed, not 280 px away from it',
  gap !== null && gap >= 0 && gap < 120,
  `${gap} px below the Copy button (button ${JSON.stringify(buttonNow)}, `
    + `message ${JSON.stringify(toldNow)})`);

/* ==========================================================================
   3. "Send it", in a browser with nowhere to send it.
   ========================================================================== */

// Chromium has no `navigator.share`, and neither does any desktop browser a
// homeowner opens a client file in. `FieldSheet` falls back to the clipboard
// for exactly that case, and until this part nothing had ever pressed the
// button to find out whether the fallback runs.
check('this browser has no share sheet, which is the state the fallback is for',
  (await page.evaluate(() => typeof navigator.share)) === 'undefined',
  await page.evaluate(() => typeof navigator.share));

await page.evaluate((mark) => navigator.clipboard.writeText(mark), SENTINEL);
await press(sendIt, 'send the list');

const sent = (await page.evaluate(() => navigator.clipboard.readText())).trim();
check('"Send it" does something where there is no share sheet, rather than nothing at all',
  sent !== SENTINEL, 'the clipboard still holds the sentinel: the button was inert');
check('and what it falls back to is the same list, not a different one',
  sent === onTheScreen, `${sent.length} characters against ${onTheScreen.length}`);

/* ==========================================================================
   4. Print carries the list even while the screen is not showing it.
   ========================================================================== */

// The component keeps the list in the document at all times and hides it
// visually, so that printing works whether or not somebody expanded it. That
// is a claim nothing can see on a screen, and it is the whole reason Print is
// a separate button from Show.
const hidden = sheet.locator('pre').first();
check('the list is in the document even while the screen is not showing it',
  (await hidden.isVisible()) === false && (await hidden.innerText()).trim() === onTheScreen,
  `visible ${await hidden.isVisible()}, ${(await hidden.innerText()).trim().length} characters`);

check('nothing so far has opened the print dialogue',
  (await page.evaluate(() => window.__printed)) === 0,
  `${await page.evaluate(() => window.__printed)} print calls before Print was pressed`);

await press(print, 'print the list', 300);
check('pressing Print opens the print dialogue, exactly once',
  (await page.evaluate(() => window.__printed)) === 1,
  `${await page.evaluate(() => window.__printed)} print calls`);

/* ==========================================================================
   5. The toggle says what it will do, and doing it shows the list.
   ========================================================================== */

await toggle.click();
await page.waitForTimeout(300);
check('opening the list makes it something a person can read on the screen',
  await sheet.locator('pre').first().isVisible(), 'the list is still hidden');
check('and the control that opened it now offers to put it away',
  (await toggle.innerText()).trim() === 'Hide', await toggle.innerText());
check('the opened list is the same text that was copied, so one sheet exists and not two',
  (await sheet.locator('pre').first().innerText()).trim() === copied,
  'the list on screen and the list on the clipboard are different');

await toggle.click();
await page.waitForTimeout(300);
check('and pressing it again puts it away and says so',
  (await sheet.locator('pre').first().isVisible()) === false
  && (await toggle.innerText()).trim() === 'Show',
  `visible ${await sheet.locator('pre').first().isVisible()}, says ${await toggle.innerText()}`);

/* ==========================================================================
   6. What somebody found, and never what it would cost.
   ========================================================================== */

await section(page, 'Plan');
await pick(page, /^Wall wall-1,/);
await page.getByRole('button', { name: '+ part of this wall' }).click();
await page.waitForTimeout(250);
await page.getByRole('button', { name: 'Rot', exact: true }).click();
await page.getByPlaceholder('sill plate is soft under the window').fill(NOTE);
await page.getByLabel('How far from the corner it starts').fill(FROM);
await page.getByLabel('How wide it is').fill(WIDE);
await page.getByLabel('How high up the wall it goes').fill(HIGH);
await page.getByRole('button', { name: 'Mark it' }).click();
await page.waitForTimeout(600);

await section(page, 'Files');
await page.waitForTimeout(300);

const withMark = (await sheet.locator('pre').first().innerText()).trim();
check('a condition marked on a wall reaches the sheet somebody carries back into the room',
  withMark.includes(NOTE), withMark.slice(-400));
check('and it says which wall it is on, because the sheet is read standing at one',
  /wall-1 — rot/.test(withMark), withMark.slice(-400));
check('and where along that wall to look, in words a person can use with a tape',
  /Where: {2}.*along wall-1/.test(withMark), withMark.slice(-400));

// The promise `fieldlist.ts` makes in three separate paragraphs, checked once.
// Noticing rot is not being paid to fix rot, and a square-foot figure beside a
// condition note on a sheet like this reads as work somebody has agreed to.
check('nothing on the sheet is an area, because noticing something is not being paid to fix it',
  !/sq ft|m²/.test(withMark), (withMark.match(/.{0,60}(sq ft|m²).{0,40}/) ?? []).join(' '));
check('and the sheet says out loud that none of it is in the takeoff',
  /None of it is in the takeoff/.test(withMark), withMark.slice(-500));

// The paragraph on the screen and the thing in the pocket have to agree about
// how many marks there are. Two counts of one fact is two chances to disagree,
// and the last disagreement of that shape cost 53 photographs.
const onScreenNow = await sheet.innerText();
const promised = Number((onScreenNow.match(/— (\d+) of them, with/) ?? [])[1] ?? 0);
check('the screen says how many marks are going with them',
  promised === 1, onScreenNow.slice(0, 400));
// Matched on the shape of the heading rather than on its exact wording. What
// this check is about is the two counts agreeing, and the words above them are
// `core/src/fieldlist.ts`'s to choose — it went from "MARKED ON THESE WALLS" to
// "MARKED IN THIS ROOM" the day ceiling marks were added to the sheet, and a
// check pinned to the old sentence goes red over a heading rather than over a
// number.
const heading = withMark.match(/^MARKED\b[^\n]*— (\d+)$/m);
check('and the sheet itself carries exactly that many',
  heading !== null && Number(heading[1]) === promised,
  heading === null ? 'the sheet has no block of marks on it at all' : heading[0]);

// And the three controls are still whole on the screen now that the paragraph
// above them has grown by three lines. A row that fits an empty room and not a
// marked one is a row that fits nothing a person will actually have.
for (const [what, control] of [['Send it', sendIt], ['Copy', copy], ['Print', print]]) {
  const at = await whereItIs(control);
  check(`"${what}" is still whole on the screen with a mark on the room`,
    at.onScreen, at.said);
}

check('no console or page errors across the whole run', noise().length === 0, noise().join(' | '));

const bad = report('A41 — the list that goes into a pocket');
await ctx.close();
await browser.close();
process.exit(bad > 0 ? 1 : 0);

/* ==========================================================================
   What this part found, and what it deliberately does not check.

   * **A refused copy points at a list that is not there.** `copy()` answers a
     browser that will not let a page write to the clipboard with "This browser
     would not let the page copy. The list is below — select it and copy by
     hand." The list is `hidden` until somebody presses Show, so on the one
     path where the button cannot do its job the sentence names something that
     is not on the screen — and the toggle still says "Show", so the app is
     telling the person to read something it is simultaneously hiding. Driven
     with `navigator.clipboard.writeText` replaced by a rejecting stub: the
     status appears and `pre` has no bounding box at all. Reported rather than
     fixed; the old/new is in the integration note.
   * **A room with a tape on every wall and nothing marked on it.**
     `FieldSheet` returns `null` for that room and draws no section at all,
     which is right and is not checked here: getting there means measuring four
     walls through the UI, and a part that spends two minutes setting up one
     check is a part somebody deletes. It wants its own fixture.
   * **That any of this reaches an actual phone.** `window.print` is counted,
     not watched, and there is no share sheet on this machine to accept what
     "Send it" hands it. What is proved here is that the fallback runs and the
     dialogue is opened; what iOS does with either is device-only.
   ========================================================================== */
