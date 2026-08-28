import {
  HEIGHT, URL, check, loadScan, noise, open, openAsApp, pick, report, section, sentTo,
} from './lib.mjs';

/**
 * Eleven controls on the drawing screens that nothing had ever pressed.
 *
 * ## What this is the answer to
 *
 * `check-controls.py` lists the controls this app draws that no part of this
 * audit has ever named. Four bugs in a month came out of exactly that state: a
 * paywall screen the app could never present, a refusal 280 pixels above the
 * button that caused it, a photograph control hidden inside a row that gave no
 * sign it opened, and a wall highlight that painted out 73% of its own length.
 * Every one of them was found by a person looking, because nothing had ever
 * driven the control.
 *
 * These eleven are the drawing and room half of that list:
 *
 *   * `Sketch.tsx` — **Take the last corner back**, **Close the room**
 *   * `Draw.tsx` — **Fix the length of** a wall, **Throw it away**
 *   * `Openings.tsx` — **how far the new** door or window is from the corner
 *   * `Thickness.tsx` — **Set the wall thickness**
 *   * `Floor.tsx` — **Start the joins again**
 *   * `App.tsx` — **Home**
 *   * `Sheet.tsx` — **Print it**
 *   * `SignaturePad.tsx` and `Agree.tsx` — **Start again**, twice, on one screen
 *   * `Trouble.tsx` — **Send them**
 *
 * Zooming is the other half and has a part of its own: `a46-viewing.mjs`.
 *
 * ## What every check below is actually asking
 *
 * Not "did the button exist". A button exists in all four of the bugs above.
 * Each check states something that would be false if the control were
 * decorative, in the wrong place, or wired to the wrong thing:
 *
 *   * taking a corner back takes back **the last one**, and the count on the
 *     screen says so — the other corners do not move by a pixel;
 *   * fixing a wall's length changes **that wall** and the one the room has to
 *     close with, and nothing else;
 *   * throwing a typed room away leaves somebody **on the screen they started
 *     on**, ready to name another, rather than dumping them somewhere with
 *     nothing on it;
 *   * a refusal appears **where the person is looking** — within 150px of the
 *     button that was pressed, the same bound `a31-mark` and `a40-ceiling`
 *     hold for the same reason;
 *   * the way out of a floor that could not be laid out **gets out of it**;
 *   * **Home** goes somewhere a person can get back from, and the room is
 *     still there when they do;
 *   * **Print it** puts the drawing on the paper and not the whole app, and
 *     says which before the dialog opens rather than after;
 *   * the two **Start again** buttons on the Agreement screen do two different
 *     things and cannot be told apart by name.
 *
 * Every control is asked whether it is whole on the screen at 430x800 — a real
 * phone — before it is pressed.
 *
 * Nothing below imports anything from the app. Every string it looks for is
 * written out here, so a check cannot pass by agreeing with the code it is
 * checking.
 */

/* ------------------------------------------------------------- the fixtures */

/** Sam's own scan. Nine walls, three doors, three windows, a real room. */
const SCAN = 'dining.json';
/** A second room, with a doorway in it, for the floor. */
const OTHER = 'garage.json';
/** A third, whose capture carries the same floor identifier as `OTHER`. */
const TWIN = 'kitchen.json';

const DRAWN = 'Den';
const TYPED = 'Shop';

/** What the typed room's second wall is entered as, and corrected to. */
const AS_ENTERED = `12'`;
const AS_MEASURED = `14' 6"`;

/** A wall thickness somebody went and measured through a doorway. */
const THICKNESS = `4 1/2"`;
/** And the jamb a 4 1/2" wall makes orderable, which is the point of saying so. */
const JAMB = `4 9/16" jamb`;
/** How far along the wall the new window starts. */
const ALONG = `3'`;

/** How near a refusal has to be to the button that caused it. */
const WITHIN = 150;
/** The height the rest of this app gives anything a thumb has to hit. */
const THUMB = 44;

/* ==========================================================================
   The first browser: everything that starts from a drawing or a scan.
   ========================================================================== */

const TITLE = `A47 — the drawing controls nothing had ever pressed, at 430 by ${HEIGHT}`;

/**
 * Whatever kills this part, the checks it had already made are still printed.
 *
 * `check` only remembers; `report` is what prints. So a part that died on the
 * way — a locator that now matches nothing, a button that never becomes
 * pressable — printed **nothing at all**, and the one thing it was written to
 * notice became the one thing it could not report. That is the same failure
 * `check-the-checks.py` exists for, one level up: a part that cannot be watched
 * failing is not a part. Every deliberate breakage used to watch this file go
 * red goes through here.
 */
function stopOn(trouble) {
  check('this part ran to the end rather than dying part way through', false,
    String(trouble && trouble.message ? trouble.message : trouble).split('\n')[0].slice(0, 200));
  report(TITLE);
  process.exit(1);
}
process.on('uncaughtException', stopOn);
process.on('unhandledRejection', stopOn);

const { browser, ctx, page } = await open();

/** Whether a control is whole inside the window once a thumb has scrolled to it. */
async function reachable(control) {
  if ((await control.count()) === 0) return { ok: false, said: 'there is no such control' };
  await control.first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);
  const box = await control.first().boundingBox();
  if (box === null) return { ok: false, said: 'it is not drawn at all' };
  return {
    ok: box.y >= 0 && box.y + box.height <= HEIGHT,
    said: `top ${Math.round(box.y)}, bottom ${Math.round(box.y + box.height)}, `
      + `in a window ${HEIGHT} tall`,
  };
}

/**
 * How far the nearest message of a kind is from the button that was pressed.
 *
 * Measured after the press, not before it: a refusal can scroll the page, and
 * comparing where the message IS against where the button WAS reports a
 * distance neither of them was ever at. `a40-ceiling` learned that the hard
 * way and this is the same reader.
 */
async function nearest(button, messages) {
  const from = await button.boundingBox();
  if (!from) return { away: Infinity, onScreen: false, count: 0 };
  const all = await messages.all();
  let away = Infinity;
  let onScreen = false;
  for (const one of all) {
    const box = await one.boundingBox();
    if (!box) continue;
    away = Math.min(away, Math.abs(box.y - from.y));
    if (box.y >= 0 && box.y + box.height <= HEIGHT) onScreen = true;
  }
  return { away, onScreen, count: all.length };
}

/* ==========================================================================
   1. The room drawn by tapping its corners.

      `Take the last corner back` is the undo of the only gesture this screen
      has. `Close the room` is the alternative to hitting a 22-pixel circle
      with a thumb, and it appears only once there is a room to close.
   ========================================================================== */

await page.goto(`${URL}#draw`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.getByLabel('What to call it').fill(DRAWN);
await page.getByRole('button', { name: 'Start drawing' }).click();
await page.waitForTimeout(300);

const board = page.getByRole('application', { name: new RegExp(`^Drawing ${DRAWN}`) });
check('a room can be started by tapping corners, on a board that says what it is for',
  (await board.count()) === 1, `${await board.count()} boards`);

if ((await board.count()) !== 1) {
  check('there is nothing more to walk without a board to tap corners on', false,
    'the first two controls need the drawing board');
  report(TITLE);
  await ctx.close();
  await browser.close();
  process.exit(1);
}

async function tap(across, down) {
  const box = await board.boundingBox();
  await page.mouse.click(box.x + box.width * across, box.y + box.height * down);
  await page.waitForTimeout(180);
}

/** Where every corner is drawn, and what is written on every wall. */
const shape = () =>
  board.evaluate((svg) => ({
    corners: [...svg.querySelectorAll('circle')].map(
      (c) => `${c.getAttribute('cx')},${c.getAttribute('cy')}`
    ),
    lengths: [...svg.querySelectorAll('text')].map((t) => t.textContent),
  }));

/** What the screen says the room has, in its own words. */
const counted = async () =>
  (await page.locator('body').innerText()).match(/\d+ corners?/)?.[0] ?? '(nothing said)';

for (const [across, down] of [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]]) {
  await tap(across, down);
}

const four = await shape();
check('four taps put four corners on the board', four.corners.length === 4,
  `${four.corners.length} corners`);
check('and the screen says how many, so the count is not something to guess at',
  (await counted()) === '4 corners', await counted());

const takeBack = page.getByRole('button', { name: 'Take the last corner back' });
let at = await reachable(takeBack);
check('Take the last corner back can be brought whole onto a phone screen', at.ok, at.said);

await takeBack.click();
await page.waitForTimeout(300);
const three = await shape();

check('taking a corner back takes back the LAST one, and leaves the others exactly where they are',
  JSON.stringify(three.corners) === JSON.stringify(four.corners.slice(0, 3)),
  `${four.corners.join(' ')} became ${three.corners.join(' ')}`);
check('and the count on the screen says so',
  (await counted()) === '3 corners', await counted());
check('and the wall that went with it is off the drawing too',
  three.lengths.length === four.lengths.length - 1,
  `${four.lengths.length} lengths became ${three.lengths.length}`);

/* ------------------------------------------------------------ closing it */

const closeIt = page.getByRole('button', { name: 'Close the room' });
at = await reachable(closeIt);
check('Close the room is offered as words, not only as a 22-pixel circle to hit', at.ok, at.said);

await closeIt.click();
await page.waitForTimeout(400);
const closed = await shape();
let said = await page.locator('body').innerText();

check('closing the room joins the last corner back to the first and measures that wall too',
  closed.lengths.length === three.lengths.length + 1,
  `${three.lengths.length} walls became ${closed.lengths.length}`);
check('and it moved no corner doing it — closing is not redrawing',
  JSON.stringify(closed.corners) === JSON.stringify(three.corners),
  `${three.corners.join(' ')} became ${closed.corners.join(' ')}`);
check('the room now says what it is worth: drawn, and not measured',
  /3 walls, drawn — not measured/.test(said),
  said.slice(said.indexOf('walls, drawn') - 40, said.indexOf('walls, drawn') + 60));
check('and Close the room retires once there is nothing left to close',
  (await closeIt.count()) === 0, `${await closeIt.count()} still offered`);

/* ==========================================================================
   2. The room typed in wall by wall.

      `Fix the length of` is the only way to correct a typo on the second of
      eight walls: removing a wall in the middle breaks the chain and adding
      one puts it back on the end. `Throw it away` is what happens when the
      whole thing is wrong.
   ========================================================================== */

await page.locator('details summary').first().click();
await page.waitForTimeout(300);
const typedPanel = page.locator('details');
await typedPanel.getByLabel('What is this room?').fill(TYPED);
await typedPanel.getByRole('button', { name: 'Start', exact: true }).click();
await page.waitForTimeout(300);

/** One wall, entered the way somebody working off a sheet enters one. */
async function wall(way, howLong) {
  await page.getByRole('button', { name: new RegExp(`^${way}$`, 'i') }).first().click();
  await page.getByRole('textbox', { name: 'how long this wall is' }).fill(howLong);
  await page.getByRole('button', { name: 'Set how long this wall is' }).click();
  await page.waitForTimeout(250);
}
await wall('north', `20'`);
await wall('east', AS_ENTERED);
await wall('south', `20'`);

/**
 * Each typed wall as three facts: its id, which way it runs, and how long.
 *
 * Read out of the row rather than as the row's whole text, because opening the
 * Fix panel adds a box, a button and possibly a refusal to the same `<li>` —
 * and a check comparing the whole row would be reporting that a panel opened,
 * which is not the question. The question is whether a refused press changed a
 * measurement.
 */
const walls = async () =>
  (await page.locator('ol li').allInnerTexts()).map((row) => {
    const said = row.replace(/\s+/g, ' ').trim();
    // Up to the control that follows it, because a length is `14' 6"` — two
    // words — and taking one word off the front of it reports `14'`, which is
    // a different wall by six inches.
    const parts = said.match(/^(wall-\d+) — (\S+) (.*?) (?:Fix|Leave it)\b/);
    return parts ? `${parts[1]} ${parts[2]} ${parts[3]}` : said;
  });

const before = await walls();
check('three typed walls are listed with their headings and their lengths',
  before.length === 3 && before[1].includes(AS_ENTERED), before.join(' | '));

const fix = page.getByRole('button', { name: 'Fix the length of wall-2' });
at = await reachable(fix);
check('every wall carries a Fix that says WHICH wall it fixes', at.ok, at.said);
check('and there is exactly one of them per wall, not one name over three buttons',
  (await page.getByRole('button', { name: /^Fix the length of wall-/ }).count()) === 3,
  `${await page.getByRole('button', { name: /^Fix the length of wall-/ }).count()} found`);
check('it says out loud that it is shut before it is pressed',
  (await fix.getAttribute('aria-expanded')) === 'false',
  String(await fix.getAttribute('aria-expanded')));

await fix.click();
await page.waitForTimeout(300);
check('pressing it says out loud that it is now open',
  (await fix.getAttribute('aria-expanded')) === 'true',
  String(await fix.getAttribute('aria-expanded')));
check('and the words on it change to the way back out',
  (await fix.innerText()).trim() === 'Leave it', (await fix.innerText()).trim());

const reallyIs = page.getByRole('textbox', { name: 'What wall-2 really is' });
const setReally = page.getByRole('button', { name: 'Set what wall-2 really is' });
check('the box it opens is named after the wall as well',
  (await reallyIs.count()) === 1, `${await reallyIs.count()} boxes`);
check('and it shows what the wall is now as a hint, not as an answer already typed',
  (await reallyIs.getAttribute('placeholder')) === AS_ENTERED
    && (await reallyIs.inputValue()) === '',
  `placeholder "${await reallyIs.getAttribute('placeholder')}", value "${await reallyIs.inputValue()}"`);

/* ---------------------------------------- a refusal you can see from the button */

await setReally.click();
await page.waitForTimeout(350);
const refused = page.getByRole('alert').filter({ hasText: /wall-2 really is/ });
let near = await nearest(setReally, refused);
check('pressing Set with the box empty says why, rather than doing nothing at all',
  near.count >= 1, `${near.count} messages`);
check('and the reason is on the screen at a real phone height', near.onScreen,
  `nearest ${near.away === Infinity ? 'none' : Math.round(near.away)}px`);
check('and beside the button that was pressed, not in a panel somewhere else',
  near.away < WITHIN, `${near.away === Infinity ? 'no message' : Math.round(near.away) + 'px'} from the button`);
check('and nothing was changed by a press that was refused',
  JSON.stringify(await walls()) === JSON.stringify(before), (await walls()).join(' | '));

/* -------------------------------------------------------- and now the length */

await reallyIs.fill(AS_MEASURED);
await setReally.click();
await page.waitForTimeout(450);
const after = await walls();

check('a corrected wall reads what it was measured as',
  after[1].includes(AS_MEASURED), after.join(' | '));
check('and the two walls nobody touched are untouched',
  after[0] === before[0] && after[2] === before[2], after.join(' | '));
check('and the box shuts itself once it has done its job',
  (await reallyIs.count()) === 0, `${await reallyIs.count()} boxes still open`);

said = await page.locator('body').innerText();
check('the wall the room now has to close with follows the correction',
  new RegExp(`The last wall has to run west for ${AS_MEASURED.replace(/["']/g, '.')}`).test(said),
  said.match(/The last wall has to run[^\n]*/)?.[0] ?? '(nothing said)');

/* ------------------------------------------------------------ throwing it away */

const throwAway = page.getByRole('button', { name: 'Throw it away' });
at = await reachable(throwAway);
check('Throw it away can be brought whole onto a phone screen', at.ok, at.said);

await throwAway.click();
await page.waitForTimeout(400);

check('throwing a typed room away leaves somebody on the screen they started on',
  (await typedPanel.getByLabel('What is this room?').count()) === 1,
  'the naming box is not there to name another room with');
check('and the walls it had are gone with it',
  (await page.locator('ol li').count()) === 0,
  `${await page.locator('ol li').count()} walls survived`);
check('and it did not throw the OTHER way of drawing a room off the screen with it',
  (await board.count()) === 1,
  'the room tapped out on the board above went away with the typed one');

/* ==========================================================================
   3. A doorway the scan missed, put into a wall by hand.

      The scanner is worse at openings than at walls — one scan called a 16 ft
      span a window — so this is the control that repairs the thing the machine
      is worst at, and nothing had ever typed into it.
   ========================================================================== */

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await loadScan(page, SCAN);
await section(page, 'Plan');
await pick(page, /^Wall wall-4,/);
await page.waitForTimeout(300);

said = await page.locator('body').innerText();
check('a wall the scan found nothing in says so, and offers to have one put in',
  /Nothing in this wall/.test(said), said.slice(0, 300));

await page.getByRole('button', { name: '+ window' }).click();
await page.waitForTimeout(300);

const howFar = page.getByRole('textbox', { name: 'how far the new window is from the corner' });
const setHowFar = page.getByRole('button', { name: 'Set how far the new window is from the corner' });
at = await reachable(howFar);
check('the box asks how far along the wall the new window starts, and names the window', at.ok, at.said);
check('and there is exactly one box answering to that, not one name over three fields',
  (await howFar.count()) === 1, `${await howFar.count()} boxes`);

await setHowFar.click();
await page.waitForTimeout(350);
const wants = page.getByRole('status').filter({ hasText: /how far the new window/ });
near = await nearest(setHowFar, wants);
check('pressing Set with it empty says what to type, rather than doing nothing',
  near.count >= 1, `${near.count} messages`);
check('and it says it beside the button, on the screen', near.onScreen && near.away < WITHIN,
  `${near.away === Infinity ? 'no message' : Math.round(near.away) + 'px'} from the button`);
check('and the form is still open, with the window still un-placed',
  (await howFar.count()) === 1 && /Nothing in this wall/.test(await page.locator('body').innerText()),
  'the form shut itself on a refusal');

await howFar.fill('banana');
await page.waitForTimeout(250);
said = await page.locator('body').innerText();
check('something that is not a length is turned down in words, with examples',
  /"banana" is not a length/.test(said), said.match(/[^\n]*not a length[^\n]*/)?.[0] ?? said.slice(0, 200));

await howFar.fill(ALONG);
await page.waitForTimeout(250);
said = await page.locator('body').innerText();
check('and a real one is read back before it is committed to anything',
  said.includes(`Reads as ${ALONG}`), said.match(/Reads as[^\n]*/)?.[0] ?? '(nothing read back)');

await setHowFar.click();
await page.waitForTimeout(600);
said = await page.locator('body').innerText();
check('the window goes into the wall, where it was said to be',
  /In this wall/.test(said) && said.includes(`${ALONG} from the corner`),
  said.slice(said.indexOf('In this wall'), said.indexOf('In this wall') + 260));
check('and the form shuts, because it has nothing left to ask',
  (await howFar.count()) === 0, `${await howFar.count()} boxes still open`);

/* ==========================================================================
   4. How thick the walls are — the one thing a scan cannot see.

      A phone inside a room only ever sees one face of a wall. Until somebody
      says, the framing and the jambs are left OUT of the takeoff rather than
      guessed at, and this is the button that says.
   ========================================================================== */

await section(page, 'Room');
await page.waitForTimeout(400);

const setThick = page.getByRole('button', { name: 'Set the wall thickness' });
const thickBox = page.getByRole('textbox', { name: 'Wall thickness' });
at = await reachable(setThick);
check('Set the wall thickness can be brought whole onto a phone screen', at.ok, at.said);
// Guarded rather than read straight: `innerText()` on a locator that matches
// nothing throws, and a detail string that throws takes the check it was
// written for down with it — so the one control that had gone missing became
// the one thing this file could not report. Same reason as `sentTo`'s `?.`.
const thickSays = (await setThick.count()) === 1 ? (await setThick.innerText()).trim() : null;
check('and it is named for the thing it sets, not just "Set"',
  (await setThick.count()) === 1 && thickSays === 'Set',
  `${await setThick.count()} found, saying "${thickSays}"`);

/** How many walls the room says still have no thickness on them. */
const withoutThickness = async () =>
  Number((await page.locator('body').innerText())
    .match(/(\d+) walls? still have no thickness at all/)?.[1] ?? -1);

said = await page.locator('body').innerText();
check('while nothing has been said, the room says what is being left out because of it',
  /walls still have no thickness at all/.test(said),
  said.match(/[^\n]*no thickness at all[^\n]*/)?.[0] ?? said.slice(0, 200));
check('and it names every wall it is being left out for, rather than saying "some"',
  /Nothing said yet about wall-1, wall-2/.test(said),
  said.match(/Nothing said yet[^\n]*/)?.[0] ?? '(nothing said)');
// A wall is open, so this sets THAT wall. The panel says which, and the check
// below is that the button does what the panel over it says it will.
check('and with a wall open the panel asks about that wall by name',
  /How thick is wall-4\?/.test(said),
  said.match(/How thick[^\n]*/)?.[0] ?? '(nothing asked)');
const beforeThickness = await withoutThickness();

await setThick.click();
await page.waitForTimeout(350);
const thickWants = page.getByRole('status').filter({ hasText: /Type the wall thickness/ });
near = await nearest(setThick, thickWants);
check('pressing it with the box empty says what to type', near.count >= 1, `${near.count} messages`);
check('and says it beside the button, on the screen', near.onScreen && near.away < WITHIN,
  `${near.away === Infinity ? 'no message' : Math.round(near.away) + 'px'} from the button`);

await thickBox.fill(THICKNESS);
await page.waitForTimeout(250);
said = await page.locator('body').innerText();
check('a typed thickness is read back before it is committed',
  said.includes(`Reads as ${THICKNESS}`), said.match(/Reads as[^\n]*/)?.[0] ?? '(nothing read back)');

await setThick.click();
await page.waitForTimeout(600);
said = await page.locator('body').innerText();
check('setting it takes exactly one wall off the list of walls nothing is known about',
  (await withoutThickness()) === beforeThickness - 1,
  `${beforeThickness} before, ${await withoutThickness()} after`);
check('and it is the wall that was open — the one the panel named',
  /Nothing said yet about wall-1, wall-2, wall-3, wall-5/.test(said),
  said.match(/Nothing said yet[^\n]*/)?.[0] ?? '(nothing said)');
check('a thickness somebody typed is recorded as a tape, not as an assumption',
  /wall-4 · tape/.test(said), said.match(/wall-4 ·[^\n]*/)?.[0] ?? '(nothing recorded)');
// The number, not the word: "jamb" appears three times in the prose on this
// panel whatever anybody has typed. What a thickness is FOR is the jamb it
// makes orderable, and a 4 1/2" wall makes a 4 9/16" one.
check('and the jamb it makes orderable is worked out from it and printed',
  said.includes(JAMB), said.match(/[^\n]*jamb[^\n]*/g)?.slice(0, 3).join(' | ') ?? '(no jamb)');
check('and the box empties, so the next wall is not set to the last one by accident',
  (await thickBox.inputValue()) === '', `the box still holds "${await thickBox.inputValue()}"`);

/* ==========================================================================
   5. Print it.

      Two things on this page are worth putting on paper and they are nothing
      alike: the drawing, which is a sheet to hand somebody, and the field
      list, which is a checklist to carry. `printOnly` puts a class on the body
      to say which BEFORE the dialog opens. Nothing had ever pressed the
      control that does it, so nothing had ever checked that the right one goes
      on the paper.
   ========================================================================== */

await section(page, 'Files');
await page.waitForTimeout(400);

// The dialog itself cannot be opened by a script and would stop the run if it
// could. What is watched instead is the one thing the app decides: which of
// the two the body is marked as, at the moment the dialog is asked for.
await page.evaluate(() => {
  window.__askedFor = [];
  window.print = () => { window.__askedFor.push(document.body.className); };
});

const printIt = page.getByRole('button', { name: 'Print it' });
at = await reachable(printIt);
check('Print it can be brought whole onto a phone screen', at.ok, at.said);
check('and it can be told from the field list\'s own Print, which is on the same screen',
  (await printIt.count()) === 1
    && (await page.getByRole('button', { name: 'Print', exact: true }).count()) === 1
    && (await page.getByRole('button', { name: 'Print' }).count()) === 2,
  `${await page.getByRole('button', { name: 'Print' }).count()} controls answer to "Print"`);

check('nothing is marked for printing before anything is pressed',
  (await page.evaluate(() => document.body.className)) === '',
  await page.evaluate(() => document.body.className));

await printIt.click();
await page.waitForTimeout(250);
const asked = await page.evaluate(() => window.__askedFor);
check('pressing Print it asks for the dialog exactly once', asked.length === 1,
  `${asked.length} times`);
check('and the page is already marked as the drawing when it asks, not a frame later',
  asked[0] === 'printing-plan', `it asked while the body said "${asked[0]}"`);

await page.waitForTimeout(1800);
check('and the mark comes off afterwards, so the page is not left with half its controls hidden',
  (await page.evaluate(() => document.body.className)) === '',
  `the body still says "${await page.evaluate(() => document.body.className)}"`);

/* ==========================================================================
   6. Home.

      The wordmark is the way home once a room is open, because that is where
      every app on this phone puts it. A way home is only a way home if there
      is a way back.
   ========================================================================== */

// `exact`, because Playwright matches an accessible name as a SUBSTRING
// unless told otherwise — and the whole point of this control's name is that
// it is the word `Home` and nothing else, so that it cannot be confused with
// "Open another" beside it. Without this, a button renamed to "The Trueline
// home screen" would still answer to it and the check would pass over the very
// change it exists to catch.
const home = page.getByRole('button', { name: 'Home', exact: true });
at = await reachable(home);
check('Home is on the screen at a phone height, without scrolling to the top first', at.ok, at.said);
check('and exactly one control answers to it',
  (await home.count()) === 1, `${await home.count()} found`);

await home.click();
await page.waitForTimeout(600);
check('Home closes the room that was open',
  (await page.getByRole('navigation', { name: 'Parts of this room' }).count()) === 0,
  'the room is still open');

const kept = await page.evaluate(() =>
  Object.keys(window.localStorage).filter((k) => k.startsWith('trueline.room.v1:')));
check('and the room is still on the device — going home is not throwing work away',
  kept.length === 1, kept.join(' '));

// The way back, walked rather than assumed. A room in storage that nothing on
// the screen leads to is a room somebody has to find the original file for.
await page.getByRole('button', { name: 'The whole floor' }).click();
await page.waitForTimeout(800);
const openAgain = page.getByRole('button', { name: 'Open', exact: true });
check('and from where Home leaves you, the rooms on this device are listed with a way in',
  (await openAgain.count()) === 1, `${await openAgain.count()} rooms offered`);

at = await reachable(openAgain);
check('and that way in is on the screen too', at.ok, at.said);
await openAgain.click();
await page.waitForTimeout(900);
check('and it opens the room Home closed',
  (await page.getByRole('navigation', { name: 'Parts of this room' }).count()) === 1,
  'the room did not come back');
said = await page.locator('body').innerText();
check('with the window it was corrected through still in the wall',
  said.includes(SCAN), said.slice(0, 200));

/* ==========================================================================
   7. The floor that could not be laid out.

      `Start the joins again` is the only control on that screen. It is
      reached by declaring a join through a doorway and then correcting that
      doorway out of the room — which is a real Tuesday: the scanner called a
      cased opening a door, somebody took it out, and the join is left naming a
      hole that is not there any more.
   ========================================================================== */

await page.getByRole('button', { name: 'Open another' }).click();
await page.waitForTimeout(400);
await loadScan(page, OTHER);
await page.waitForTimeout(400);

await page.goto(`${URL}#floor`, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);

const floorPlan = page.locator('svg[aria-label="The floor"]');
check('two rooms on one device are drawn on a floor together',
  (await floorPlan.count()) === 1, `${await floorPlan.count()} floors drawn`);

/**
 * Which room each doorway on the floor belongs to, by the room label nearest
 * to it. The doorways are `<g onClick>` with nothing but circles inside them —
 * no role and no name — so there is nothing to ask for by name. See the note
 * at the foot of this file.
 */
const doorways = await floorPlan.evaluate((svg) => {
  const middle = (el) => {
    const box = el.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const rooms = [...svg.querySelectorAll('text')]
    .filter((t) => /\.json$/.test(t.textContent ?? ''))
    .map((t) => ({ name: t.textContent, ...middle(t) }));
  return [...svg.querySelectorAll('g > circle[fill="transparent"]')].map((circle) => {
    const spot = middle(circle);
    const near = rooms
      .map((room) => ({ name: room.name, away: Math.hypot(room.x - spot.x, room.y - spot.y) }))
      .sort((a, b) => a.away - b.away)[0];
    return { room: near?.name, x: Math.round(spot.x), y: Math.round(spot.y) };
  });
});
const here = doorways.find((one) => one.room === SCAN);
const there = doorways.find((one) => one.room === OTHER);
check('both rooms have a doorway on the floor to join them by',
  here !== undefined && there !== undefined,
  doorways.map((d) => d.room).join(' | '));

await page.mouse.click(here.x, here.y);
await page.waitForTimeout(300);
await page.mouse.click(there.x, there.y);
await page.waitForTimeout(600);

const joined = await page.evaluate(() => window.localStorage.getItem('trueline.floor.v1'));
check('tapping the same doorway in both rooms joins them, and the join is written down',
  JSON.parse(joined ?? '[]').length === 1, String(joined).slice(0, 200));
said = await page.locator('body').innerText();
check('and the floor stops saying one of them is not joined to anything',
  !/not joined yet/.test(said), said.slice(0, 400));

// And now the doorway the join names is taken out of the room, through the
// control a person would use: the scanner found a door that is not there.
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await loadScan(page, OTHER);
await section(page, 'Plan');
await pick(page, /^Wall wall-1,/);
await page.waitForTimeout(300);
await page.getByRole('button', { name: /Measure$/ }).first().click();
await page.waitForTimeout(300);
const noDoor = page.getByRole('button', { name: 'There is no door here' });
check('a doorway the scan invented can be taken out of the wall',
  (await noDoor.count()) === 1, `${await noDoor.count()} found`);
await noDoor.scrollIntoViewIfNeeded();
await noDoor.click();
await page.waitForTimeout(700);

await page.goto(`${URL}#floor`, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
said = await page.locator('body').innerText();
check('a join naming a doorway that is not there any more stops the floor being laid out',
  /could not be laid out/.test(said), said.slice(0, 400));
check('and it says which doorway, rather than "something went wrong"',
  /has nothing in it called "door-1"/.test(said), said.slice(0, 400));

const startJoins = page.getByRole('button', { name: 'Start the joins again' });
at = await reachable(startJoins);
check('Start the joins again is on the screen at a phone height, on a screen with nothing else on it',
  at.ok, at.said);

await startJoins.click();
await page.waitForTimeout(900);
said = await page.locator('body').innerText();
check('pressing it gets the floor out of the state it was stuck in',
  !/could not be laid out/.test(said), said.slice(0, 400));
check('and it took the joins, not the rooms — both are still on the device',
  /2 rooms/.test(said), said.slice(0, 300));
check('and the joins it cleared really are cleared',
  JSON.parse(await page.evaluate(() => window.localStorage.getItem('trueline.floor.v1')) ?? 'null')
    ?.length === 0,
  String(await page.evaluate(() => window.localStorage.getItem('trueline.floor.v1'))));

/* ------------------ the other way a floor refuses, where it cannot help at all */

// Two captures that carry the same floor identifier. `garage.json` and
// `kitchen.json` are both `floor-1`, which is what two exports of one capture
// look like on a device. The floor refuses to lay out — and the ONLY control
// on the screen is a button about joins, when there is not a join in sight.
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await loadScan(page, TWIN);
await page.waitForTimeout(400);
await page.goto(`${URL}#floor`, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
said = await page.locator('body').innerText();
check('two captures sharing a floor identifier also stop the floor being laid out',
  /could not be laid out/.test(said) && /share the id/.test(said), said.slice(0, 400));

const stuck = await page.locator('body').innerText();
await page.getByRole('button', { name: 'Start the joins again' }).click();
await page.waitForTimeout(900);
check('and the one way out the screen offers changes something when it is pressed',
  (await page.locator('body').innerText()) !== stuck,
  'the only control on the screen did nothing at all when it was pressed');

check('the drawing and room screens: no console or page errors',
  noise().length === 0, noise().join(' | '));
await ctx.close();

/* ==========================================================================
   8. Start again, twice, on one screen.

      `SignaturePad.tsx` draws one and `Agree.tsx` draws the other, and once an
      option has been taken they are both on the Agreement screen at the same
      time. One clears a pen stroke. The other throws the whole proposal away.
   ========================================================================== */

const second = await open();

await loadScan(second.page);
await section(second.page, 'Price');
await second.page.getByRole('button', { name: /Set your rates|Your rates/ }).first().click();
await second.page.waitForTimeout(300);
const rateSheet = second.page
  .locator('section', { has: second.page.getByRole('heading', { name: 'What you charge' }) })
  .first();
for (const box of await rateSheet.getByRole('textbox').all()) {
  await box.fill('5.00');
  await box.blur();
  await second.page.waitForTimeout(80);
}
await second.page.waitForTimeout(400);

await section(second.page, 'Agreement');
await second.page.getByLabel('What to call this option').fill('Everything measured');
await second.page.getByLabel('One line on what it covers').fill('The whole room, finished.');
await second.page.getByRole('button', { name: 'Write the proposal' }).click();
await second.page.waitForTimeout(600);

// Two controls, one name, two outcomes that are nothing alike. This screen
// used to carry TWO buttons whose whole accessible name was `Start again` —
// one clearing a pen stroke, one throwing the proposal away — and the
// destructive one was the 20px one, against the 44px every other thumb target
// in this app carries. A person reaching for the small job could hit the big
// one, and a screen reader announced them identically. This app has had that
// bug twice before: three boxes called "e.g." and a toggle that said "Your
// business" while showing the word "Close".
//
// The proposal's is now `Write it again`, named for what it destroys.
const again = second.page.getByRole('button', { name: 'Start again', exact: true });
const rewrite = second.page.getByRole('button', { name: 'Write it again', exact: true });

check('before anything is signed, the proposal offers to be written again',
  (await rewrite.count()) === 1, `${await rewrite.count()} found`);
check('and nothing yet says Start again, because there is no pen stroke to clear',
  (await again.count()) === 0, `${await again.count()} found`);

await second.page.getByRole('button', { name: 'Take this one' }).first().click();
await second.page.waitForTimeout(500);

check('taking an option brings out the signature pad, with its own way to start over',
  (await again.count()) === 1, `${await again.count()} found`);

/** Which section of the screen each one is in, by the heading over it. */
const under = async (control) =>
  control.evaluate((el) => el.closest('section')?.querySelector('h2')?.textContent ?? '(nowhere)');

const both = [rewrite.first(), again.first()];
const places = [];
for (const one of both) places.push(await under(one));
check('one is in the proposal and the other is beside the signature pad',
  places.includes('The proposal') && places.includes('Sign it'), places.join(' | '));

// The check that would catch it coming back: two controls doing different
// things must not answer to one name, because a name is all a screen reader
// has and all a bug report can say.
const names = [];
for (const one of both) names.push((await one.getAttribute('aria-label')) ?? (await one.innerText()));
check('and the two can be told apart by their names, which is all a screen reader has',
  new Set(names.map((n) => n.trim())).size === 2, names.join(' | '));

const proposalAgain = both[places.indexOf('The proposal')];
const signatureAgain = both[places.indexOf('Sign it')];

const sizes = [];
for (const one of both) {
  await one.scrollIntoViewIfNeeded();
  const box = await one.boundingBox();
  sizes.push(box ? Math.round(box.height) : 0);
}
check(`both are at least the ${THUMB}px this app gives a thumb everywhere else`,
  sizes.every((h) => h >= THUMB), sizes.map((h, i) => `${places[i]}: ${h}px`).join(', '));

/* ------------------------------------------- and each one does its own job */

const pad = second.page.getByRole('img', { name: 'Sign here with your finger' });
await pad.scrollIntoViewIfNeeded();
await second.page.waitForTimeout(120);
const padBox = await pad.boundingBox();
await second.page.mouse.move(padBox.x + 40, padBox.y + 90);
await second.page.mouse.down();
await second.page.mouse.move(padBox.x + 120, padBox.y + 40, { steps: 8 });
await second.page.mouse.move(padBox.x + 200, padBox.y + 100, { steps: 8 });
await second.page.mouse.up();
await second.page.waitForTimeout(300);

said = await second.page.locator('section').filter({ hasText: 'Sign it' }).last().innerText();
check('a mark on the pad is acknowledged in words', /Signed above/.test(said), said.slice(0, 200));

await signatureAgain.scrollIntoViewIfNeeded();
await signatureAgain.click();
await second.page.waitForTimeout(400);
said = await second.page.locator('section').filter({ hasText: 'Sign it' }).last().innerText();
check('the Start again beside the pad clears the mark and asks for another',
  /Sign above with a finger/.test(said), said.slice(0, 200));
check('and it left the proposal alone — a pen stroke is not a document',
  (await second.page.getByRole('heading', { name: 'The proposal' }).count()) === 1,
  'clearing the signature took the proposal with it');

await proposalAgain.scrollIntoViewIfNeeded();
await proposalAgain.click();
await second.page.waitForTimeout(600);
check('the Start again in the proposal throws the whole proposal away',
  (await second.page.getByLabel('What to call this option').count()) === 1,
  'the proposal is still there');
check('and leaves the screen ready to write another, not blank',
  (await second.page.getByRole('button', { name: 'Write the proposal' }).count()) === 1,
  (await second.page.locator('main').innerText()).slice(0, 300));

check('the agreement screen: no console or page errors',
  noise().length === 0, noise().join(' | '));
await second.ctx.close();

/* ==========================================================================
   9. Send them.

      The one control in this app that puts a file in front of a mail composer.
      Nothing leaves the phone until it is pressed — that is the rule the rest
      of the app keeps about a customer's kitchen, and it applies to the app's
      own laundry too. It only exists inside the app, so it is driven through
      the same handlers `Diagnostics.swift` registers.
   ========================================================================== */

const REPORTS = JSON.stringify([
  {
    name: 'crash-2026-08-27.json',
    kind: 'crash',
    when: '2026-08-27T19:04:00Z',
    summary: 'EXC_BAD_ACCESS in RoomCaptureView',
  },
  { name: 'daily-2026-08-27.json', kind: 'daily', when: '2026-08-27T02:00:00Z', summary: '' },
]);

const phone = await openAsApp({ subscribed: true, reports: REPORTS });

// A REAL load of `#business`, not a hop to the fragment. Changing a fragment is
// a same-document navigation: nothing reloads, the parked payload is never
// re-parked, and the reports would be handed to a screen that had not been
// drawn yet. On the phone every tab builds a new web view and does a real
// load, which is what this reproduces — and getting it wrong here looks
// exactly like a dropped payload.
await phone.page.goto(`${URL}#business`, { waitUntil: 'networkidle' });
await phone.page.reload({ waitUntil: 'networkidle' });
await phone.page.waitForTimeout(900);

said = await phone.page.locator('body').innerText();
check('inside the app, the business screen says what the phone has to report',
  /2 reports on this phone/.test(said),
  said.match(/[^\n]*on this phone[^\n]*/)?.[0] ?? '(nothing said)');
check('and says which of them is a fault, because most of them are not',
  /1 of them is a fault/.test(said),
  said.match(/[^\n]*on this phone[^\n]*/)?.[0] ?? '(nothing said)');

const send = phone.page.getByRole('button', { name: 'Send them' });
const sendBox = await (async () => {
  await send.scrollIntoViewIfNeeded();
  await phone.page.waitForTimeout(120);
  const box = await send.boundingBox();
  return box;
})();
check('Send them can be brought whole onto a phone screen',
  sendBox !== null && sendBox.y >= 0 && sendBox.y + sendBox.height <= HEIGHT,
  sendBox ? `top ${Math.round(sendBox.y)}, bottom ${Math.round(sendBox.y + sendBox.height)}` : 'no box');

check('nothing has been sent anywhere before it is pressed',
  (await sentTo(phone.page, 'trouble')).length === 0,
  JSON.stringify(await sentTo(phone.page, 'trouble')));

await send.click();
await phone.page.waitForTimeout(400);
const posted = await sentTo(phone.page, 'trouble');
check('pressing it asks the app to send them, exactly once',
  posted.length === 1, `${posted.length} messages`);
check('and asks for sending rather than for anything else',
  posted.at(-1)?.action === 'send', JSON.stringify(posted.at(-1)));
check('and the reports are still on the phone — sending is not deleting',
  /2 reports on this phone/.test(await phone.page.locator('body').innerText()),
  (await phone.page.locator('body').innerText()).match(/[^\n]*on this phone[^\n]*/)?.[0] ?? '');

/* ------------------------------- an app build with no way to send them at all */

// The state the button's own fallback exists for: the page is inside the app,
// so the section is drawn, and the app half is older than this page and has no
// handler for sending. Pressing it must say so where the finger is, rather
// than looking like a button that swallowed the tap.
await phone.page.evaluate(() => { delete window.webkit.messageHandlers.trouble; });
await send.scrollIntoViewIfNeeded();
await phone.page.waitForTimeout(120);
const cannotBox = await send.boundingBox();
await send.click();
await phone.page.waitForTimeout(400);

const cannot = phone.page.getByRole('status').filter({ hasText: /no way to send them/ });
let away = Infinity;
let onScreen = false;
for (const one of await cannot.all()) {
  const box = await one.boundingBox();
  if (!box) continue;
  away = Math.min(away, Math.abs(box.y - cannotBox.y));
  if (box.y >= 0 && box.y + box.height <= HEIGHT) onScreen = true;
}
check('a build that cannot send them says so, rather than swallowing the tap',
  (await cannot.count()) >= 1, `${await cannot.count()} messages`);
check('and says it beside the Send them it was pressed on, on the screen',
  onScreen && away < WITHIN,
  `${away === Infinity ? 'no message' : Math.round(away) + 'px'} from the button`);
check('and it says what to do about it, not only what went wrong',
  /Open Trueline on the phone/.test(await phone.page.locator('body').innerText()),
  (await phone.page.locator('body').innerText()).match(/[^\n]*no way to send[^\n]*/)?.[0] ?? '');

check('inside the app: no console or page errors', noise().length === 0, noise().join(' | '));
await phone.ctx.close();

const bad = report(TITLE);
await browser.close();
process.exit(bad > 0 ? 1 : 0);

/* ==========================================================================
   What this part found and could not fix, and who has to.

   Three of the eleven controls above were wrong in a way nothing could have
   noticed while nothing drove them. None of the three files is this part's to
   edit; the exact changes are in the integration note.

   * **`Floor.tsx` — the one way out of a floor that could not be laid out
     cannot always help.** When two saved captures share a floor identifier —
     `garage.json` and `kitchen.json` both carry `floor-1`, which is what two
     exports of one capture look like — the screen says "Two rooms on 'This
     floor' share the id" and offers exactly one control: "Start the joins
     again". There are no joins. Pressing it writes `[]` over an empty list and
     the screen does not change by one character. Measured above. The screen
     has to say what can actually be done about the trouble it is reporting.

   * **`Agree.tsx` and `SignaturePad.tsx` — two controls, one name, on one
     screen.** Once an option is taken, the Agreement screen carries two
     buttons whose whole accessible name is "Start again": one clears a pen
     stroke, the other destroys the proposal. A screen reader announces them
     identically and anything driving this app by name cannot tell them apart.
     `Measure.tsx` already carries the note about three fields called "e.g."
     and `App.tsx` the one about `Home` colliding with "Open another"; this is
     the same failure a third time.

   * **`Agree.tsx` — the control that destroys a proposal is 20 pixels tall.**
     Every other control in this app that a thumb has to hit carries
     `min-h-11`, which is 44. This one carries none.

   And one thing no checker in this repository can see, found while driving
   `Start the joins again`: **the doorways on the floor plan have no accessible
   name and no role at all.** Joining two rooms is two taps on `<g onClick>`
   elements containing nothing but `<circle>`s — no `role`, no `aria-label`, no
   `tabindex`. `check-controls.py` cannot report it, because a control with no
   name is not a name that can go undriven; this part had to find them by
   working out which room label each dot was nearest to. Every other tappable
   thing drawn in this app — a wall, a facet, a mark — is a `role="button"`
   with a name.

   What is NOT proven here, and cannot be without a device: that the print
   dialog on a real phone honours the class the body is wearing (the dialog
   cannot be opened by a script), and that `Send them` reaches a mail composer.
   Everything above proves the app is ASKED, in the message `Diagnostics.swift`
   listens for; what the app does with it is Swift, and only a device can
   answer it.
   ========================================================================== */
