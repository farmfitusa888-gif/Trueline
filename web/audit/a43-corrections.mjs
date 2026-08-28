import { check, HEIGHT, loadScan, noise, open, pick, report, reportEvenIfItDies, section } from './lib.mjs';

// Say what was learned even if this part dies part way through.
reportEvenIfItDies('A43 — correcting a wall');

/**
 * Correcting a wall — the screen the whole product is built around.
 *
 * ## Why fourteen controls on one screen had never been driven
 *
 * `Edit.tsx` draws the line this app exists for: **a tape reading is a
 * measurement and moving a wall is not.** Everything else — the takeoff, the
 * money, the proposal, what the drawing is allowed to say — hangs off which
 * side of that line a number fell on. Fourteen of its controls had never been
 * named by any part of this audit, including every box in the cut, every box in
 * the notch, the button that takes a tape reading off, and the button that
 * removes a side of the room.
 *
 * One of them was worse than undriven. `Set what to call this wall` was being
 * pressed by `a6-persist.mjs` through
 * `locator('xpath=following-sibling::button[1]')` — exercised, and its
 * accessible name proved by nothing. A button reached by its position in the
 * DOM is a button that can lose its name, or take somebody else's, without one
 * check going red.
 *
 * ## What is asked here
 *
 * Three stories, each on its own copy of the app, because one edit's mess must
 * never be mistaken for the next edit's bug:
 *
 *   1. **What a wall is called, and what a number is.** A tape reading replaces
 *      the ability to drag the wall — the two controls are never both on the
 *      screen — and taking the reading off gives the scan's number back and
 *      hands the drag back with it.
 *   2. **A wall that does not go to the ceiling, and a wall cut in two.** The
 *      takeoff is checked by arithmetic done here, not by "something changed":
 *      a 21 ft wall dropped from 9 ft to 3 ft 6 in takes 115.5 sq ft off the
 *      wall face and not one inch off the baseboard.
 *   3. **A corner that is really a step, and a side that is not there.** A
 *      notch puts in **two** walls and the room does not change size on either
 *      axis, which is the promise `notchCorner` makes in prose and nothing had
 *      ever measured.
 *
 * Driven at `TRUELINE_AUDIT_HEIGHT=800`, which is a phone. Half of this screen
 * is now inside disclosures that start shut, and a control inside a shut row is
 * exactly the state the photograph control was in when Sam reported he could
 * not attach one. So each row is asked whether it says it is shut before
 * anything inside it is reached for.
 *
 * Nothing below imports anything from the app. Every number it expects is
 * worked out in a comment beside the check.
 */

/* ------------------------------------------------------------- the fixtures */

/** `garage.json` is 21 ft by 20 ft with a 9 ft ceiling, and 82 ft of perimeter. */
const FACE = '702.0 sq ft';     // 82 x 9 = 738, less a 3x6'8" door and a 4x4 window
const BASE = '79.00 lf';        // 82 less the 3 ft door; a window runs under
const FLOOR = '420.0 sq ft';    // 21 x 20

/** A breakfast bar on wall-2, which is 21 ft long and carries no openings. */
const BAR = `3' 6"`;
// 702 less wall-2 at full height (21 x 9 = 189) plus wall-2 at the bar's height
// (21 x 3.5 = 73.5) is 586.5. Worked out on paper, not read off the screen.
const FACE_WITH_BAR = '586.5 sq ft';

/** Higher than the room, which the model has to refuse. */
const TOO_TALL = `12'`;

const CALLED = 'the wall behind the washer';
const TAPED = `20' 3"`;
const SCANNED = `20'`;

/** A 2 ft deep, 3 ft wide alcove notched out of the corner after wall-2. */
const STEP_OUT = `2'`;
const STEP_ALONG = `3'`;
const STEP = 'the alcove';
// 420 less the 2 x 3 step is 414. The two walls beside the corner give up the
// step's own dimensions, so 21 = 18 + 3 and 20 = 18 + 2 on the two axes.
const FLOOR_WITH_STEP = '414.0 sq ft';

/**
 * Where a control is right now, without touching the page.
 *
 * Both edges, and `isVisible()` is not the question: a banner two thousand
 * pixels off the top of the window is visible and is not on the screen.
 */
async function whereItIs(page, control) {
  if ((await control.count()) === 0) return { ok: false, said: 'there is no such control' };
  const box = await control.first().boundingBox();
  if (box === null) return { ok: false, said: 'it is not drawn at all' };
  // Rounded to whole pixels, because the layout is not: a control scrolled to
  // the bottom of the window lands at 752.34 and is 48 tall, and a third of a
  // pixel over the edge is not a control somebody cannot see.
  return {
    box,
    ok: Math.round(box.y) >= 0 && Math.round(box.y + box.height) <= HEIGHT,
    said: `top ${Math.round(box.y)}, bottom ${Math.round(box.y + box.height)}, `
      + `in a window ${HEIGHT} tall`,
  };
}

/**
 * Whether a person can actually get a control whole onto a phone screen.
 *
 * A control halfway down a correction panel is below the fold, and that is
 * fine: a thumb scrolls. What is not fine is one that cannot be brought fully
 * onto the screen at all, or that is covered when it gets there. So this
 * scrolls the way a thumb does and then asks about both edges — which is a
 * different question from `whereItIs`, and the difference is the whole reason
 * both exist.
 */
async function reachable(page, control) {
  if ((await control.count()) === 0) return { ok: false, said: 'there is no such control' };
  await control.first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);
  return whereItIs(page, control);
}

/**
 * How far below a button its refusal was drawn, in pixels, or null.
 *
 * The mark button "refused" 280 px above the thumb pressing it and Sam
 * reported a dead button. A message is only a message if it is where the eye
 * already is, so every refusal on this screen is measured against the control
 * that caused it rather than merely being found somewhere on the page.
 */
async function gapBelow(button, message) {
  // Counted before either is measured. `boundingBox()` on a locator that
  // matches nothing waits thirty seconds and then throws, which turns a control
  // somebody deleted into a dead run instead of a red check.
  if ((await button.count()) === 0 || (await message.count()) === 0) return null;
  const above = await button.first().boundingBox();
  const below = await message.first().boundingBox();
  if (!above || !below) return null;
  return Math.round(below.y - (above.y + above.height));
}

/**
 * Presses a control, or fails a check saying why the story stops here.
 *
 * A part that dies on a missing control reports one stack trace and hides every
 * check after it, including the ones that would have said what actually broke.
 * Watching this file fail is how that was found: taking the tape-reading guard
 * out of `Edit.tsx` should have gone red on three checks and instead killed the
 * whole part on a click that timed out.
 */
async function press(page, control, whatFor, waitFor = 700) {
  if ((await control.count()) === 0) {
    check(`there is a control to ${whatFor}, which the rest of this story needs`,
      false, 'it is not on the screen, so what follows cannot be walked');
    return false;
  }
  await control.first().click();
  await page.waitForTimeout(waitFor);
  return true;
}

/**
 * Types into a box, or fails a check saying why the story stops here.
 *
 * The same reason `press` exists. `fill()` on a locator that matches nothing
 * waits thirty seconds and throws, and a run that dies reports one stack trace
 * where it should have reported the red check that explains it.
 */
async function type(control, text, whatFor) {
  if ((await control.count()) === 0) {
    check(`there is a box for ${whatFor}, which the rest of this story needs`,
      false, 'it is not on the screen, so what follows cannot be walked');
    return false;
  }
  await control.first().fill(text);
  return true;
}

/** Every wall on the plan, by the label the drawing gives it. */
async function wallsOn(page) {
  const found = [];
  for (const one of await page.getByRole('button', { name: /^(Wall|Open span) / }).all()) {
    found.push(await one.getAttribute('aria-label'));
  }
  return found;
}

/**
 * Selects a wall and gets its correction panel open.
 *
 * The panel's own open/shut state belongs to the component and survives a
 * change of wall, so "Change this wall" is there the first time and gone every
 * time after. Asking rather than assuming keeps a story from dying on its
 * second wall.
 */
async function changeWall(page, which) {
  await pick(page, which);
  const opener = page.getByRole('button', { name: 'Change this wall' });
  if (await opener.count()) {
    await opener.click();
    await page.waitForTimeout(350);
  }
}

/**
 * Opens one of the correction rows, and says whether it was shut.
 *
 * Six blocks of boxes opened together the moment "Change this wall" was tapped,
 * so three of them are disclosures that start shut now. A control inside a shut
 * row is only reachable if the row says it is shut and says what is in it —
 * which is the whole difference between this and the row Sam could not find the
 * photograph in.
 */
async function openRow(page, title) {
  const header = page.getByRole('button', { name: new RegExp('^' + title) }).first();
  // A row that is not on the screen at all is a finding, not a reason to hang
  // for thirty seconds and die. The caller's own checks say what is missing.
  if ((await page.getByRole('button', { name: new RegExp('^' + title) }).count()) === 0) {
    check(`there is a row called "${title}", which the rest of this story needs`,
      false, 'it is not on the screen, so what follows cannot be walked');
    return { wasShut: false, saidWhileShut: '', header };
  }
  const wasShut = (await header.getAttribute('aria-expanded')) === 'false';
  // Read while it is still shut. The summary is what a shut row says it holds,
  // and it is gone the instant the row opens — so reading it afterwards would
  // check nothing and pass.
  const saidWhileShut = await header.innerText();
  if (wasShut) {
    await header.click();
    await page.waitForTimeout(300);
  }
  return { wasShut, saidWhileShut, header };
}

/* ==========================================================================
   1. What a wall is called, and what a number is.
   ========================================================================== */

const first = await open();
{
  const page = first.page;
  await loadScan(page);
  await changeWall(page, /^Wall wall-1,/);

  /* ------------------------------------------------- the button, by its name */

  const setName = page.getByRole('button', { name: 'Set what to call this wall' });
  check('the button that names a wall is reachable by the name it announces',
    (await setName.count()) === 1, `${await setName.count()} found`);
  // There is more than one "Set" on this panel, and a screen reader reads them
  // all the same without this. It is the reason the aria-label is there at all.
  check('and it is not one of several buttons all announced as "Set"',
    (await page.getByRole('button', { name: 'Set', exact: true }).count()) === 0,
    `${await page.getByRole('button', { name: 'Set', exact: true }).count()} plain "Set" buttons`);
  const nameAt = await reachable(page, setName);
  check('and it is whole on the screen at a phone height', nameAt.ok, nameAt.said);

  // Pressed on an empty box it must say what it wants. Seven forms in this app
  // once answered an empty box by doing absolutely nothing, which on a phone is
  // indistinguishable from a broken app.
  await press(page, setName, 'set what a wall is called', 350);
  let body = await page.locator('body').innerText();
  check('pressing it on an empty box says what it wants, rather than doing nothing',
    /Type what to call this wall first/.test(body),
    body.slice(0, 400));
  const wants = page.getByText(/Type what to call this wall first/).first();
  const wantsAt = await whereItIs(page, wants);
  const wantsGap = await gapBelow(setName, wants);
  check('and it says it beside the button that was pressed, on the screen',
    wantsAt.ok && wantsGap !== null && wantsGap >= 0 && wantsGap < 160,
    `${wantsAt.said}; ${wantsGap} px below the button`);

  // The box is reached by its position on purpose, and this is the one place in
  // the repository where that is the right call. `a6-persist.mjs` is the only
  // part that names "What to call this wall", and `check-the-checks.py` proves
  // `check-controls.py` works by taking that name out of a6 and requiring the
  // checker to notice. Naming the box here as well would leave it driven after
  // that mutation, the checker would stay quiet, and the harness that watches
  // the checkers would go red — for four words this part does not need.
  const nameBox = setName.locator('xpath=preceding-sibling::input[1]');
  check('the box the button sets is the one immediately before it, as a person reads it',
    (await nameBox.count()) === 1, `${await nameBox.count()} boxes before the button`);
  await type(nameBox, CALLED, 'what a wall is called');
  await press(page, setName, 'set what a wall is called', 600);

  let walls = await wallsOn(page);
  check('and pressing it by that name really renames the wall on the drawing',
    walls.some((label) => label?.startsWith(`Wall ${CALLED},`)), walls.join(' | '));
  check('and the wall it renamed kept its length, because a name is not a number',
    walls.some((label) => label === `Wall ${CALLED}, ${SCANNED}`), walls.join(' | '));

  /* --------------------------------------- a tape reading, and taking it off */

  await section(page, 'Plan');
  await type(page.getByRole('textbox', { name: `the length of ${CALLED}` }), TAPED,
    'a tape reading on a wall');
  await press(page, page.getByRole('button', { name: `Set the length of ${CALLED}` }),
    'put a tape reading on a wall', 600);

  body = await page.locator('body').innerText();
  check('a wall with a tape on it says so on its own panel',
    /It has had a tape on it/.test(body), body.slice(0, 600));
  // The line the product is built on, drawn as two controls that are never both
  // on the screen. If dragging a measured wall were possible, somebody could
  // make an unchecked scan claim it had been measured by nudging four walls.
  check('and a wall with a tape on it cannot be dragged at all — there is no box for it',
    (await page.getByRole('textbox', { name: 'Move this wall to' }).count()) === 0,
    'a measured wall still offers to be moved by hand');

  const takeOff = page.getByRole('button', { name: 'Take the tape reading off' });
  check('what it offers instead is taking the reading off, in those words',
    (await takeOff.count()) === 1, `${await takeOff.count()} found`);
  const takeOffAt = await reachable(page, takeOff);
  check('and that control is whole on the screen at a phone height',
    takeOffAt.ok, takeOffAt.said);

  walls = await wallsOn(page);
  check('the taped wall holds the number that was typed',
    walls.some((label) => label === `Wall ${CALLED}, ${TAPED}`), walls.join(' | '));

  await press(page, takeOff, 'take a tape reading off');

  walls = await wallsOn(page);
  check('taking the reading off gives the wall back the number the scan gave it',
    walls.some((label) => label === `Wall ${CALLED}, ${SCANNED}`), walls.join(' | '));
  check('and the room stops claiming anybody put a tape on it',
    /SCANNED — no wall here has had a tape on it/.test(await page.locator('body').innerText()),
    (await page.locator('body').innerText()).slice(0, 300));
  check('and moving it by hand is offered again, because there is no measurement left to protect',
    (await page.getByRole('textbox', { name: 'Move this wall to' }).count()) === 1,
    'the drag never came back');
  check('while the button that took it off has gone, having nothing left to take',
    (await takeOff.count()) === 0, 'it still offers to take a reading off');

  /* ------------------------------------------------- the way out of a rename */

  await section(page, 'Plan');
  const rename = page.getByRole('button', { name: /^Rename / });
  await press(page, rename, 'rename the room', 300);

  const leave = page.getByRole('button', { name: /^Leave it called / });
  check('a rename that has been opened offers a way out that names the room',
    (await leave.count()) === 1 && /Leave it called garage\.json/.test(await leave.innerText()),
    (await leave.count()) === 0 ? 'nothing offers a way out' : await leave.innerText());
  const leaveAt = await reachable(page, leave);
  check('and the way out is whole on the screen, not below the box it belongs to',
    leaveAt.ok, leaveAt.said);

  // A refusal that will not close leaves somebody holding a box they cannot put
  // down. `renameRoom` turns down a name too long for the title block, and this
  // is the control that exists so that being refused is not a dead end.
  const roomBox = page.getByRole('textbox', { name: 'What to call this room' });
  await type(roomBox, 'x'.repeat(121), 'what the room is called');
  await press(page, leave, 'leave the room called what it is called', 400);

  check('taking the way out puts the rename away without renaming anything',
    (await page.getByRole('textbox', { name: 'What to call this room' }).count()) === 0,
    'the rename box is still open');
  check('and the room is still called what it was called',
    /Rename garage\.json/.test(
      (await page.getByRole('button', { name: /^Rename / }).first().getAttribute('aria-label')) ?? ''
    ),
    (await page.getByRole('button', { name: /^Rename / }).first().getAttribute('aria-label')) ?? 'none');

  await first.ctx.close();
  await first.browser.close();
}

/* ==========================================================================
   2. A wall that does not go to the ceiling, and a wall cut in two.
   ========================================================================== */

const second = await open();
{
  const page = second.page;
  await loadScan(page);

  await section(page, 'Takeoff');
  let takeoff = await page.locator('body').innerText();
  check('the room starts at the wall face a full-height scan gives it',
    takeoff.includes(FACE), takeoff.slice(takeoff.indexOf('Wall face'), takeoff.indexOf('Wall face') + 120));
  check('and at the baseboard that goes with it',
    takeoff.includes(BASE), takeoff.slice(takeoff.indexOf('Baseboard'), takeoff.indexOf('Baseboard') + 120));

  await section(page, 'Plan');
  await changeWall(page, /^Wall wall-2,/);

  const heightRow = await openRow(page, 'It does not go to the ceiling');
  check('the pony-wall row starts shut on an ordinary wall, and says so rather than hiding',
    heightRow.wasShut, 'the row was already open, so nothing about shut rows was proved');
  check('and while it is shut it says what the wall currently is, so nobody opens six to find one',
    /Full height/.test(heightRow.saidWhileShut) && /9'/.test(heightRow.saidWhileShut),
    heightRow.saidWhileShut);

  const stands = page.getByRole('textbox', { name: 'How high this wall stands', exact: true });
  const setHigh = page.getByRole('button', { name: 'Set how high this wall stands' });
  check('there is one box for how high the wall stands, and one button that sets it',
    (await stands.count()) === 1 && (await setHigh.count()) === 1,
    `${await stands.count()} boxes, ${await setHigh.count()} buttons`);
  const standsAt = await reachable(page, stands);
  check('and the box is whole on the screen once its row is open', standsAt.ok, standsAt.said);

  await press(page, setHigh, 'set how high a wall stands', 350);
  const asked = page.getByText(/Type how high it stands/).first();
  check('pressing it on an empty box says what it wants, with an example of each kind',
    (await asked.count()) === 1
    && /3' 6" for a bar/.test(await asked.innerText())
    && /7' for a partition/.test(await asked.innerText()),
    (await asked.count()) === 0 ? 'nothing was said' : await asked.innerText());
  const askedAt = await whereItIs(page, asked);
  const askedGap = await gapBelow(setHigh, asked);
  check('and it says it beside the button, where the thumb already is',
    askedAt.ok && askedGap !== null && askedGap >= 0 && askedGap < 160,
    `${askedAt.said}; ${askedGap} px below the button`);

  /* ------------------------------- a wall taller than the room it is in */

  await type(stands, TOO_TALL, 'how high a wall stands');
  await press(page, setHigh, 'set how high a wall stands', 500);

  const refusal = page.locator('[role="alert"]').first();
  check('a wall taller than the room it stands in is refused rather than recorded',
    (await refusal.count()) === 1, 'nothing refused a 12 ft wall under a 9 ft ceiling');
  const refusalText = (await refusal.count()) ? await refusal.innerText() : '';
  check('and the refusal names both numbers, so it can be acted on rather than guessed at',
    /12'/.test(refusalText) && /9'/.test(refusalText), refusalText.slice(0, 300));
  check('and it says what to do about it, if the room really is that tall',
    /measure the ceiling first/.test(refusalText), refusalText.slice(0, 300));
  check('and nothing was recorded — the wall still goes to the ceiling',
    /Full height|goes to the room’s ceiling|goes to the room's ceiling/
      .test(await page.locator('body').innerText()),
    'the refused height was taken anyway');

  // Where the refusal actually lands, asserted. This used to be a `console.log`
  // and nothing more, because the banner was drawn above the whole room while
  // the button that produced it sat most of a screen down inside a correction
  // panel: measured on this part's own runs at 430 by 800, a 12 ft wall refused
  // under a 9 ft ceiling put it at y = -1874, which is 2,213 px ABOVE the
  // button, with nothing moving and nothing scrolling. Pressing the button
  // looked exactly like pressing a dead one — the bug Sam already reported once
  // at 280 px, at eight times the distance, on the screen the product is built
  // around. The banner is sticky now and is scrolled to and focused, so this is
  // a promise the app keeps and a check can hold it to.
  const refusalAt = await whereItIs(page, refusal);
  check('the model\'s refusal is on the screen, not drawn off the top of it',
    refusalAt.ok, refusalAt.said);
  const refusalBox = (await refusal.count()) ? await refusal.boundingBox() : null;
  const buttonBox = (await setHigh.count()) ? await setHigh.first().boundingBox() : null;
  const apart = refusalBox && buttonBox
    ? Math.round(buttonBox.y - (refusalBox.y + refusalBox.height))
    : null;
  check('and it is within one screen of the button that caused it, not 2,213 px above it',
    apart !== null && Math.abs(apart) < HEIGHT,
    `${apart} px from the button, refusal at y=${refusalBox ? Math.round(refusalBox.y) : 'none'}, `
      + `button at y=${buttonBox ? Math.round(buttonBox.y) : 'none'}, in a ${HEIGHT} px window`);
  // And the person can see BOTH at once: the thing that refused and the thing
  // that was pressed. That is what "where the person is looking" means, and it
  // is the check the sticky banner exists to pass.
  const buttonAt = await whereItIs(page, setHigh);
  check('and the button that was pressed is still on the screen beside it, so the two are read together',
    buttonAt.ok, buttonAt.said);

  const close = refusal.getByRole('button', { name: 'Close', exact: true });
  check('the refusal offers a way to put it away, so it is not stuck on the screen',
    (await close.count()) === 1, `${await close.count()} ways out`);
  await press(page, close, 'put a refusal away', 300);
  check('and pressing that way out clears it',
    (await page.locator('[role="alert"]').count()) === 0, 'the refusal is still there');

  /* ------------------------------------------------------- a breakfast bar */

  await type(stands, BAR, 'how high a wall stands');
  await press(page, setHigh, 'set how high a wall stands');

  check('a wall that stands lower than the ceiling says so on its own panel',
    new RegExp(`It stands ${BAR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
      .test(await page.locator('body').innerText()),
    (await page.locator('body').innerText()).match(/It stands[^\n]*/)?.[0] ?? 'nothing says how high it stands');

  const backUp = page.getByRole('button', { name: 'It does go to the ceiling' });
  check('and only now is there a control offering to put it back to the ceiling',
    (await backUp.count()) === 1, `${await backUp.count()} found`);
  const backUpAt = await reachable(page, backUp);
  check('and that control is whole on the screen at a phone height',
    backUpAt.ok, backUpAt.said);

  // The arithmetic, done here. 21 ft of wall came down from 9 ft to 3 ft 6 in,
  // which is 115.5 sq ft of board, paint and wall face — and not one inch of
  // baseboard, because a bar still meets the floor.
  await section(page, 'Takeoff');
  takeoff = await page.locator('body').innerText();
  check('the takeoff moves with it, by exactly the board the wall stopped taking',
    takeoff.includes(FACE_WITH_BAR),
    takeoff.slice(takeoff.indexOf('Wall face'), takeoff.indexOf('Wall face') + 120));
  check('and the baseboard does not move, because a bar still meets the floor',
    takeoff.includes(BASE),
    takeoff.slice(takeoff.indexOf('Baseboard'), takeoff.indexOf('Baseboard') + 120));
  check('and the floor is untouched, because lowering a wall does not shrink a room',
    takeoff.includes(FLOOR), takeoff.slice(takeoff.indexOf('Floor'), takeoff.indexOf('Floor') + 120));

  await section(page, 'Plan');
  await press(page, backUp, 'put the wall back to the ceiling');
  await section(page, 'Takeoff');
  takeoff = await page.locator('body').innerText();
  check('putting it back to the ceiling puts every one of those square feet back',
    takeoff.includes(FACE),
    takeoff.slice(takeoff.indexOf('Wall face'), takeoff.indexOf('Wall face') + 120));

  await section(page, 'Plan');
  check('and the control that offered it has gone, because there is nothing left to undo',
    (await page.getByRole('button', { name: 'It does go to the ceiling' }).count()) === 0,
    'it still offers to put a full-height wall back to the ceiling');

  /* --------------------------------------------------------- cut it in two */

  await openRow(page, 'Cut it in two');
  const cutAt = page.getByRole('textbox', { name: 'Cut this wall at' });
  const cutName = page.getByRole('textbox', { name: 'What to call the second piece' });
  const cutHigh = page.getByRole('textbox', { name: 'How high the second piece stands' });
  for (const [what, box] of [['Cut this wall at', cutAt],
                             ['What to call the second piece', cutName],
                             ['How high the second piece stands', cutHigh]]) {
    check(`the cut has exactly one box called "${what}"`,
      (await box.count()) === 1, `${await box.count()} found`);
    const at = await reachable(page, box);
    check(`and "${what}" is whole on the screen at a phone height`, at.ok, at.said);
  }

  // Three empty boxes, and it has to name all three at once. Three rounds of
  // pressing and being refused is three chances to give up.
  const cutIt = page.getByRole('button', { name: 'Cut it', exact: true });
  await press(page, cutIt, 'cut a wall in two', 400);
  const cutWants = page.getByText(/Fill in /).first();
  const cutSaid = (await cutWants.count()) ? await cutWants.innerText() : '';
  check('pressing Cut it with nothing filled in names every box that is empty, not the first',
    /how far along to cut it/.test(cutSaid)
    && /what to call the second piece/.test(cutSaid)
    && /how high the second piece stands/.test(cutSaid),
    cutSaid || 'nothing was said at all');
  const cutWantsAt = await whereItIs(page, cutWants);
  const cutGap = await gapBelow(cutIt, cutWants);
  check('and it says it beside the button that was pressed',
    cutWantsAt.ok && cutGap !== null && cutGap >= 0 && cutGap < 160,
    `${cutWantsAt.said}; ${cutGap} px below the button`);

  // Nothing clears when a button is pressed — the rule the whole file keeps.
  await type(cutAt, `10'`, 'where to cut a wall');
  await press(page, cutIt, 'cut a wall in two', 400);
  check('a refused cut keeps what was already typed, so nobody retypes three boxes to fix one',
    (await cutAt.inputValue()) === `10'`, `the box now holds ${JSON.stringify(await cutAt.inputValue())}`);
  const stillWanted = (await page.getByText(/Fill in /).count())
    ? await page.getByText(/Fill in /).first().innerText()
    : '(nothing was said at all)';
  check('and it names only the boxes that are still empty',
    (await page.getByText(/Fill in /).count()) > 0
    && !/how far along to cut it/.test(stillWanted), stillWanted);

  await type(cutName, 'the bar end', 'what to call the second piece');
  await type(cutHigh, `3'`, 'how high the second piece stands');
  await press(page, cutIt, 'cut a wall in two', 800);

  const cutWalls = await wallsOn(page);
  check('a wall cut in two makes exactly one more wall, not two more and not none',
    cutWalls.length === 5, cutWalls.join(' | '));
  check('and the second piece is called what it was told to be called',
    cutWalls.some((label) => label?.startsWith('Wall the bar end,')), cutWalls.join(' | '));
  // 10 ft off a 21 ft wall leaves 11 ft. The two pieces run in the same
  // direction and the walk closes exactly as it did, so nothing re-solves.
  check('and the two pieces add up to the wall they came from, so nothing moved',
    cutWalls.includes(`Wall wall-2, 10'`) && cutWalls.includes(`Wall the bar end, 11'`),
    cutWalls.join(' | '));

  await section(page, 'Takeoff');
  check('and the floor is exactly what it was, because cutting a run in two says nothing new',
    (await page.locator('body').innerText()).includes(FLOOR),
    (await page.locator('body').innerText()).slice(0, 300));

  await second.ctx.close();
  await second.browser.close();
}

/* ==========================================================================
   3. A corner that is really a step, and a side that is not there.
   ========================================================================== */

const third = await open();
{
  const page = third.page;
  await loadScan(page);
  await changeWall(page, /^Wall wall-2,/);

  // Before anything is notched, on the room every scan of an ordinary rectangle
  // produces. The row that removes a side used to be drawn whenever the room
  // had more than three walls, which is true here — and here the model refuses
  // every delete, because four sides less one is three and a rectilinear walk
  // cannot close on three. So an ordinary four-walled room offered a control
  // that could never once succeed. It is offered on the rooms it works on and
  // nowhere else now, and the two checks below are the pair: not here, and —
  // further down — yes on the wall the notch makes it possible on.
  const walls = await wallsOn(page);
  check('the room this story starts on is an ordinary four-walled scan',
    walls.length === 4, walls.join(' | '));
  // The ROW as well as the button, because the row starts shut and a shut
  // disclosure takes its contents out of the page — so asking for the button
  // alone would pass on a panel that offers the row.
  const onARectangle = (await page.getByRole('button', { name: /^Take it out/ }).count())
    + (await page.getByRole('button', { name: 'There is no wall here at all' }).count());
  check('and a four-walled room does not offer to take a side out, because it can never work',
    onARectangle === 0, `${onARectangle} rows or buttons offered on a four-walled scan`);

  const notchRow = await openRow(page, 'Notch the corner after it');
  check('the notch row starts shut, and says it is shut rather than giving no sign',
    notchRow.wasShut, 'the notch row was already open');
  check('and while it is shut it says what is behind it, which is how anybody finds it',
    /alcove|chase|two walls/i.test(notchRow.saidWhileShut), notchRow.saidWhileShut);

  const deep = page.getByRole('textbox', { name: 'How deep the step goes' });
  const wide = page.getByRole('textbox', { name: 'How wide the step is' });
  const stepName = page.getByRole('textbox', { name: 'What to call the step' });
  const notchIt = page.getByRole('button', { name: 'Notch it', exact: true });

  for (const [what, box] of [['How deep the step goes', deep],
                             ['How wide the step is', wide],
                             ['What to call the step', stepName]]) {
    check(`the notch has exactly one box called "${what}"`,
      (await box.count()) === 1, `${await box.count()} found`);
    const at = await reachable(page, box);
    check(`and "${what}" is whole on the screen once the row is open`, at.ok, at.said);
  }
  const notchAt = await reachable(page, notchIt);
  check('and so is the button that does it', notchAt.ok, notchAt.said);

  // Three empty boxes, and it has to name all three at once — the same promise
  // `Cut it` keeps two rows above, for the same reason: three rounds of
  // pressing and being refused is three chances to give up.
  //
  // This button used to answer three empty boxes with a bare `return`. Pressing
  // it changed not one byte of the screen: no alert, no status, `innerText`
  // identical before and after. On a phone that is indistinguishable from a
  // dead button, and it is the exact class `a12-everything.mjs` found in seven
  // forms and that the rest of `Edit.tsx` was fixed for.
  const before = await wallsOn(page);
  await press(page, notchIt, 'notch a corner', 500);
  check('pressing Notch it with the boxes empty puts nothing into the room',
    (await wallsOn(page)).join('|') === before.join('|'), (await wallsOn(page)).join(' | '));

  const notchWants = page.getByText(/Fill in /).first();
  const notchSaid = (await notchWants.count()) ? await notchWants.innerText() : '';
  check('and it says what it wants, rather than answering three empty boxes with silence',
    /how deep the step goes/.test(notchSaid)
    && /how wide the step is/.test(notchSaid)
    && /what to call it/.test(notchSaid),
    notchSaid || 'nothing was said at all');
  const notchWantsAt = await whereItIs(page, notchWants);
  const notchGap = await gapBelow(notchIt, notchWants);
  check('and it says it beside the button that was pressed, where the thumb already is',
    notchWantsAt.ok && notchGap !== null && notchGap >= 0 && notchGap < 160,
    `${notchWantsAt.said}; ${notchGap} px below the button`);

  // Nothing clears when a button is pressed, and what is already filled in is
  // not asked for again — the rule the whole file keeps.
  await type(deep, STEP_OUT, 'how deep the step goes');
  await press(page, notchIt, 'notch a corner', 500);
  check('a refused notch keeps what was already typed, so nobody retypes three boxes to fix one',
    (await deep.inputValue()) === STEP_OUT,
    `the box now holds ${JSON.stringify(await deep.inputValue())}`);
  const stillWanted = (await page.getByText(/Fill in /).count())
    ? await page.getByText(/Fill in /).first().innerText()
    : '(nothing was said at all)';
  check('and it names only the boxes that are still empty',
    (await page.getByText(/Fill in /).count()) > 0
    && !/how deep the step goes/.test(stillWanted)
    && /how wide the step is/.test(stillWanted)
    && /what to call it/.test(stillWanted),
    stillWanted);

  await type(deep, STEP_OUT, 'how deep the step goes');
  await type(wide, STEP_ALONG, 'how wide the step is');
  await type(stepName, STEP, 'what to call the step');
  await press(page, notchIt, 'notch a corner', 900);

  const stepped = await wallsOn(page);
  // Two, never one. A closed rectilinear walk alternates axes, so it always has
  // an even number of sides; one more wall on a rectangle leaves five, which
  // cannot close.
  check('a notch puts two walls in, because a room with square corners has an even number of sides',
    stepped.length === before.length + 2, `${before.length} walls became ${stepped.length}`);
  check('and both of them are named out of the one word that was typed',
    stepped.some((l) => l?.startsWith(`Wall ${STEP} back,`))
    && stepped.some((l) => l?.startsWith(`Wall ${STEP} side,`)),
    stepped.join(' | '));
  check('the step goes out as far as it was told to',
    stepped.includes(`Wall ${STEP} back, ${STEP_OUT}`), stepped.join(' | '));
  check('and runs as wide as it was told to',
    stepped.includes(`Wall ${STEP} side, ${STEP_ALONG}`), stepped.join(' | '));

  // The promise `notchCorner` makes in prose and nothing had ever measured: the
  // two walls beside the corner give up the step's own dimensions, so the walk
  // is exactly as long on each axis as it was and nothing else has to move.
  check('the wall the step was cut into gave up exactly the width of the step',
    stepped.includes(`Wall wall-2, 18'`), stepped.join(' | '));
  check('and the wall after it gave up exactly the depth of the step',
    stepped.includes(`Wall wall-3, 18'`), stepped.join(' | '));
  check('so the room is the same size across it as it was — 18 and 3 is still 21',
    stepped.includes(`Wall wall-4, 21'`), stepped.join(' | '));
  check('and the same size the other way — 18 and 2 is still 20',
    stepped.includes(`Wall wall-1, 20'`), stepped.join(' | '));

  await section(page, 'Takeoff');
  check('and the floor lost exactly the step and nothing else',
    (await page.locator('body').innerText()).includes(FLOOR_WITH_STEP),
    (await page.locator('body').innerText()).slice(0, 400));

  /* --------------------------------------- a side of the room that is not there */

  await section(page, 'Plan');

  // Six walls now, and still not every wall. `deleteWall` refuses four of the
  // six on this room: `wall-1` has a door and a window in it, and taking
  // `wall-2`, `wall-3` or `wall-4` out leaves two walls on one axis that
  // nothing tells apart, which the model calls one wall written twice. Only
  // the two the notch put in can actually come out.
  //
  // That is why the row asks the model rather than counting walls. A guard
  // counting what `mergeCollinear` leaves would say five here, draw the row on
  // `wall-2`, and hand somebody a button that cannot work — which is the bug
  // this is the fix for, moved rather than removed.
  // The ROW, not the button inside it. The row starts shut and a shut
  // disclosure takes its contents out of the page altogether, so asking for the
  // button alone would pass on a panel that offers the row — which is exactly
  // the state being checked against.
  const offered = async () => (await page.getByRole('button', { name: /^Take it out/ }).count())
    + (await page.getByRole('button', { name: 'There is no wall here at all' }).count());

  await changeWall(page, /^Wall wall-2,/);
  const onADuplicate = await offered();
  check('a wall the model will not let go of does not offer to be taken out either',
    onADuplicate === 0,
    `${onADuplicate} offers on a wall whose removal leaves one wall written twice`);

  await changeWall(page, /^Wall wall-1,/);
  const onTheDoorWall = await offered();
  check('and a wall with a door and a window in it does not offer it, being a side that is really there',
    onTheDoorWall === 0, `${onTheDoorWall} offers on a wall carrying a door`);

  await changeWall(page, new RegExp(`^Wall ${STEP} back,`));
  await openRow(page, 'Take it out');

  const takeOut = page.getByRole('button', { name: 'There is no wall here at all' });
  const openSpan = page.getByRole('button', { name: 'There is no wall here', exact: true });
  check('and the wall the room can actually lose does offer it',
    (await takeOut.count()) === 1, `${await takeOut.count()} found`);
  // Two controls, two meanings, on one panel. One takes the side out of the
  // room and the walls on that axis close it up; the other leaves the side
  // exactly where it is and says nothing is built across it. Telling them apart
  // is the difference between a room that shrank and a room with an opening.
  check('and it is a different control from the one that makes the side an open span',
    (await openSpan.count()) === 1, `${await openSpan.count()} open-span controls`);
  // Read once, with a guard: an `innerText()` inside a check's DETAIL is
  // evaluated whether the check passes or not, so a missing control hangs the
  // run on the argument rather than failing the check.
  const takeOutSays = (await takeOut.count()) ? await takeOut.first().innerText() : '(missing)';
  const openSpanSays = (await openSpan.count()) ? await openSpan.first().innerText() : '(missing)';
  check('and the two of them do not answer to one name',
    (await takeOut.count()) === 1 && (await openSpan.count()) === 1
    && takeOutSays !== openSpanSays,
    `${takeOutSays} against ${openSpanSays}`);
  const takeOutAt = await reachable(page, takeOut);
  check('and the one that removes a side is whole on the screen before it is pressed',
    takeOutAt.ok, takeOutAt.said);

  await press(page, takeOut, 'take a side out of the room', 900);

  const closed = await wallsOn(page);
  check('taking a side out leaves a room with the sides it can actually close on',
    closed.length === 4, closed.join(' | '));
  check('and the walls on that axis moved to close it back up, rather than leaving a hole',
    closed.includes(`Wall wall-1, 19'`) && closed.includes(`Wall wall-3, 19'`),
    closed.join(' | '));
  check('and the line under the plan says which walls moved, so it is not a silent change',
    /the alcove back is gone/.test(await page.locator('body').innerText())
    && /moved to close the room back up/.test(await page.locator('body').innerText()),
    (await page.locator('body').innerText()).match(/[^\n]*is gone[^\n]*/)?.[0] ?? 'nothing was said'); ;
  check('and it is one tap to undo, because that is what the screen promises',
    (await page.getByRole('button', { name: /^Undo/ }).count()) === 1,
    'nothing offers to undo it');

  await third.ctx.close();
  await third.browser.close();
}

check('no console or page errors across the whole run', noise().length === 0, noise().join(' | '));

const bad = report('A43 — correcting a wall');
process.exit(bad > 0 ? 1 : 0);

/* ==========================================================================
   What this part found, and what it deliberately does not check.

   * **Refusals from the model used to be drawn off the top of the screen —
     fixed, and the placement is asserted now rather than printed.** The model's
     own refusals go into `state.error`, which `App.tsx` drew as a banner ABOVE
     the whole room while the button that caused them sat most of a screen down
     inside a correction panel. Measured on this part's own runs at 430 by 800:
     the too-tall refusal landed at y = -1874, which is 2,213 px above the
     button, and taking a fourth side out of a four-walled room put it 2,527 px
     above. Nothing moved and nothing scrolled. That was bug two of the four
     this audit exists for — "the mark button refused 280 pixels above the
     button being pressed; Sam reported it as a dead button" — at eight times
     the distance, on the screen the product is built around. The banner is
     sticky now and is scrolled to and focused, and the two `console.log` lines
     this part carried have become three checks: the refusal is on the screen,
     it is within one screen of its button, and the button is still beside it.
   * **`Notch it` answered an empty box with silence — fixed.** Every other
     button on this panel says what it wants; the notch returned on a bare
     `return`, so pressing it with a box empty changed nothing on the page and
     said nothing at all. That is the exact class a12-everything found in seven
     forms and that the rest of `Edit.tsx` was fixed for; the notch was missed.
     It now names every empty box at once, the way `Cut it` does, keeps what was
     already typed, and each box clears the line as it is filled in.
   * **`There is no wall here at all` was offered on rooms it can never work on
     — fixed by asking the model instead of counting walls.** The row was drawn
     whenever `room.walls.length > 3`, which is true of every ordinary scanned
     rectangle, and on one the delete is always refused: a rectilinear walk
     cannot close on three sides. Counting walls after `mergeCollinear` would
     not have fixed it either — measured on the six-walled room this story
     builds, `deleteWall` refuses four of the six, three of them because
     removing the wall leaves two walls on one axis that nothing tells apart.
     The row now asks `deleteWall` itself, which is the one function that
     decides, and is drawn only where the answer is yes. A wall with a door in
     it therefore loses the row rather than keeping a button that refuses, which
     reads right: the row is for a side of the room that is not really there.
   * **What "Take the tape reading off" leaves behind.** Taping wall-1 to
     20' 3" re-solves the room and the opposite wall goes to 20' 3" with it.
     Taking the reading off gives wall-1 back its scanned 20' and leaves the
     opposite wall at 20' 3" — a number that exists only because of a
     measurement that has been withdrawn, in a room the screen now calls
     SCANNED. Whether that is right is a question about the model rather than
     about a control, so it is recorded in the integration note as an
     observation rather than asserted here either way.
   ========================================================================== */
