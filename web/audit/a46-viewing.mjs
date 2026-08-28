import { HEIGHT, URL, check, loadScan, noise, open, report, section } from './lib.mjs';

/**
 * Getting closer to a drawing is not measuring it.
 *
 * ## Why this is the promise worth a whole part
 *
 * Everything else this app does rests on one sentence: **a view is not a
 * measurement.** A tapped room says it came off a grid. A scanned wall says it
 * came off a scanner until somebody puts a tape on it. The furniture is drawn
 * faintly because no number ever came from it. The one thing that would make
 * all of that worthless is a control that changes what the room is by changing
 * how it is being looked at.
 *
 * Five controls do exactly the second thing, on two screens, and **not one of
 * them had ever been driven by any part of this audit**:
 *
 *   * `Sketch.tsx` — `Closer` and `Further out` over the grid a room is drawn
 *     on;
 *   * `Room3D.tsx` — `Closer`, `Further out` and `Straighten up` over the room
 *     in three dimensions.
 *
 * `check-controls.py` reported all five. Nothing had ever asked for one by
 * name, so nothing had ever had the chance to find out that zooming moved a
 * wall, that zooming out came back to somewhere else, or that a button was on
 * the screen doing nothing at all.
 *
 * ## What each check below states, and how it could be false
 *
 * Nothing here reads a class name, a state variable or an attribute the app
 * wrote about itself. Every number comes off the drawn SVG:
 *
 *   1. **Closer magnifies and moves no number.** The corners of a drawn room
 *      spread apart by exactly the zoom factor, and every length written on it
 *      is the same string it was.
 *   2. **Further out comes back to where it was, exactly.** Not "about" — the
 *      same coordinates and the same lengths, character for character. A view
 *      that drifts a hair on every round trip is a drawing somebody re-taps.
 *   3. **A grid square is a length, not a number of pixels.** The board says
 *      "one square is 6"" at every zoom, and the squares themselves grow by the
 *      zoom factor. If the app answered a zoom by making the grid finer, a
 *      corner would land somewhere a person did not put it.
 *   4. **Turning the room changes what you can see and not what anything
 *      measures.** Every wall labelled before a drag and after it carries the
 *      same reading.
 *   5. **Straighten up puts back the angle AND the zoom**, and leaves the mode
 *      it was pressed inside alone.
 *   6. **A zoom control that can do nothing says so.** This is the one that
 *      fails: `Room3D` disables both ends, `Sketch` does not, so at the widest
 *      view "Further out" is a live button that does nothing whatever. That is
 *      the shape of the bug Sam reported as a dead button. See the note at the
 *      foot of this file.
 *
 * Every control is pressed at 430x800 — a real phone — and each one is asked
 * whether it is whole on the screen before it is pressed, because a zoom
 * control below the fold is a zoom control nobody has.
 *
 * Nothing below imports anything from the app. Every string it looks for is
 * written out here, so a check cannot pass by agreeing with the code it is
 * checking.
 */

/* ------------------------------------------------------------- the fixtures */

/** The room drawn by tapping, so the corners are ours and not a scanner's. */
const DRAWN = 'Den';
/** Sam's own scan, for the three-dimensional half. `dining.json` is real. */
const SCAN = 'dining.json';

/** What `Closer` multiplies the tapped drawing by. `Sketch.tsx` picks 1.6. */
const SKETCH_STEP = 1.6;
/** And what `Room3D` picks for the same word. */
const ROOM_STEP = 1.4;

/** The default grid, said in the words the board itself uses. */
const ONE_SQUARE = `one square is 6"`;

/** How near two floating-point pixel counts have to be to be the same. */
const HAIR = 0.01;

const TITLE = `A46 — a view is not a measurement, at 430 by ${HEIGHT}`;

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

/**
 * Whether a control is whole inside the window once a thumb has scrolled to it.
 *
 * The same question `a42-forms` asks of a field, for the same reason: a control
 * halfway down a screen is fine, and one that cannot be brought fully onto a
 * phone at all is not. `isVisible()` is not the question — it is true of a
 * button four thousand pixels below the fold.
 */
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

/* ==========================================================================
   1. The room drawn by tapping corners.

      Drawn rather than opened, because these are corners a person put where
      they are: if a zoom moved one, the wall it is on would be a wall nobody
      drew. A square is used so the arithmetic in the checks is arithmetic
      anybody can do in their head.
   ========================================================================== */

await page.goto(`${URL}#draw`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.getByLabel('What to call it').fill(DRAWN);
await page.getByRole('button', { name: 'Start drawing' }).click();
await page.waitForTimeout(300);

const board = page.getByRole('application', { name: new RegExp(`^Drawing ${DRAWN}`) });
check('the board a room is tapped on is on the screen and says what it is for',
  (await board.count()) === 1, `${await board.count()} boards`);

// Guarded, so a board that has gone missing reports a failed check rather than
// a stack trace thirty lines further down. A named control that has vanished is
// the exact bug this part is for; it has to say so plainly, and a part that
// dies before `report` is a part nobody can watch failing.
if ((await board.count()) !== 1) {
  check('there is nothing more to walk without a board to tap corners on', false,
    'every check below needs the drawing board');
  report(TITLE);
  await ctx.close();
  await browser.close();
  process.exit(1);
}

/** One tap, at a fraction of the board's width and height. */
async function tap(acrossFraction, downFraction) {
  const box = await board.boundingBox();
  await page.mouse.click(box.x + box.width * acrossFraction, box.y + box.height * downFraction);
  await page.waitForTimeout(180);
}

/**
 * Everything the drawing is currently saying, in its own units.
 *
 * The corners are read as the `<circle>`s the board draws, in board
 * coordinates, so a zoom that moved one is visible as a different number. The
 * lengths are the `<text>` on each run — the numbers a contractor reads off and
 * writes on a wall.
 */
const drawing = () =>
  board.evaluate((svg) => ({
    corners: [...svg.querySelectorAll('circle')].map((c) => ({
      x: Number(c.getAttribute('cx')),
      y: Number(c.getAttribute('cy')),
    })),
    lengths: [...svg.querySelectorAll('text')].map((t) => t.textContent),
    // The narrowest gap between two grid lines running the same way. One grid
    // square, in board units, measured off the drawing rather than worked out.
    square: (() => {
      const xs = [...svg.querySelectorAll('line')]
        .filter((l) => l.getAttribute('x1') === l.getAttribute('x2'))
        .map((l) => Number(l.getAttribute('x1')))
        .sort((a, b) => a - b);
      const gaps = xs.slice(1).map((v, i) => v - xs[i]).filter((g) => g > 0.01);
      return gaps.length > 0 ? Math.min(...gaps) : null;
    })(),
  }));

for (const [across, down] of [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]]) {
  await tap(across, down);
}

const flat = await drawing();
check('four taps make four corners and three walls with a length written on each',
  flat.corners.length === 4 && flat.lengths.length === 3,
  `${flat.corners.length} corners, ${flat.lengths.length} lengths`);
check('and every wall on a square room reads the same, so a moved corner would show',
  new Set(flat.lengths).size === 1, flat.lengths.join(' | '));

const closer = page.getByRole('button', { name: 'Closer' });
const further = page.getByRole('button', { name: 'Further out' });

// Asked BEFORE either is pressed, and that order is the check rather than an
// accident: a name that answers to two controls is a name nothing can drive,
// and Playwright refuses an ambiguous locator rather than picking one. Asked
// after the presses, this would never run — the run would already be over.
check('the drawing board is the only place these two words appear while it is open',
  (await closer.count()) === 1 && (await further.count()) === 1,
  `${await closer.count()} Closer, ${await further.count()} Further out`);
check('and no room is open behind it, so its zoom cannot be another screen\'s zoom',
  (await page.getByRole('navigation', { name: 'Parts of this room' }).count()) === 0,
  'a room is open on the same screen as the drawing board');

let at = await reachable(closer);
check('Closer can be brought whole onto a phone screen on the drawing board', at.ok, at.said);
at = await reachable(further);
check('and so can Further out, beside it', at.ok, at.said);

/* ------------------------------------------------- closer, and no number moves */

await closer.click();
await page.waitForTimeout(250);
const near = await drawing();

check('getting closer moves no number on the drawing — not one character of one length',
  JSON.stringify(near.lengths) === JSON.stringify(flat.lengths),
  `${flat.lengths.join(' | ')} became ${near.lengths.join(' | ')}`);

// The corners must spread by exactly the zoom step. Measured as the distance
// between two of them rather than as where either one is, because the board
// zooms about its middle and both ends move.
const span = (shot) => Math.hypot(
  shot.corners[1].x - shot.corners[0].x,
  shot.corners[1].y - shot.corners[0].y
);
const grew = span(near) / span(flat);
check(`getting closer draws the same room ${SKETCH_STEP} times bigger, exactly`,
  Math.abs(grew - SKETCH_STEP) < 0.001, `it grew by ${grew.toFixed(4)}`);

check('and a grid square grows with it, because a square is six inches of floor',
  near.square !== null && flat.square !== null
    && Math.abs(near.square / flat.square - SKETCH_STEP) < 0.001,
  `${flat.square} became ${near.square}`);

let said = await page.locator('body').innerText();
check('the board still says a square is six inches — a zoom is not a finer grid',
  said.includes(ONE_SQUARE), said.slice(said.indexOf('one square'), said.indexOf('one square') + 60));

/* ---------------------------------------------- and back out, to the same place */

await further.click();
await page.waitForTimeout(250);
const back = await drawing();

check('going further out puts every corner back exactly where it was, not nearly',
  JSON.stringify(back.corners) === JSON.stringify(flat.corners),
  `${JSON.stringify(flat.corners)} then ${JSON.stringify(back.corners)}`);
check('and every length is the same string it was before either press',
  JSON.stringify(back.lengths) === JSON.stringify(flat.lengths),
  `${flat.lengths.join(' | ')} then ${back.lengths.join(' | ')}`);
check('and the grid is back to the width it was, to a hundredth of a pixel',
  back.square !== null && Math.abs(back.square - flat.square) < HAIR,
  `${flat.square} then ${back.square}`);

/* -------------------------------------- a control that cannot do anything */

// At the widest view there is nothing further out to go. `Room3D` answered that
// by disabling both ends and the drawing board did not, so this was a live
// button that did nothing whatever when it was pressed -- the complaint that
// started `check-controls.py`. It is disabled now, and both halves of that are
// checked here: that it says so, and that pressing it anyway moves nothing.
//
// `force: true` because a plain `click()` waits for a disabled control to
// become actionable and then times out after thirty seconds -- which is what
// this part did once the button was fixed and this block was not: it died here
// having reported nothing about the two facts below.
const beforeDead = await drawing();
const deadSays = await further.isDisabled();
await further.click({ force: true });
await page.waitForTimeout(250);
const afterDead = await drawing();
check('pressing Further out at the widest view really does change nothing',
  JSON.stringify(afterDead) === JSON.stringify(beforeDead),
  'the widest view is not the widest view');
check('and the drawing board says so, rather than offering a button that does nothing',
  deadSays === true,
  'Further out is live at the widest view and does nothing when pressed');

/* ==========================================================================
   2. The same room in three dimensions.

      A scan this time, and Sam's own: the labels on it are readings a
      contractor would order material off, which is what makes "the numbers did
      not move" worth stating.
   ========================================================================== */

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await loadScan(page, SCAN);
await section(page, 'Plan');
await page.getByRole('tab', { name: '3D' }).click();
await page.waitForTimeout(600);

const solid = page.locator(`svg[aria-label="${SCAN} in three dimensions"]`);
check('the room draws itself in three dimensions and says which room it is',
  (await solid.count()) === 1, `${await solid.count()} drawings`);

// The same guard, for the same reason, on the second half's subject.
if ((await solid.count()) !== 1) {
  check('there is nothing more to walk without the room drawn in three dimensions', false,
    'every check below needs the three-dimensional drawing');
  report(TITLE);
  await ctx.close();
  await browser.close();
  process.exit(1);
}

/**
 * What the three-dimensional drawing is saying.
 *
 * `readings` is a map from the name of a wall, an opening or a door to the
 * measurement printed under it — the two `<tspan>`s of one label. Read as a map
 * rather than as a list because turning the room changes WHICH walls are drawn,
 * and the check that matters is about the ones drawn in both.
 */
const solidView = () =>
  solid.evaluate((svg) => ({
    viewBox: svg.getAttribute('viewBox'),
    faces: [...svg.querySelectorAll('polygon')].map((p) => p.getAttribute('points')),
    readings: Object.fromEntries(
      [...svg.querySelectorAll('text')]
        .map((t) => [...t.querySelectorAll('tspan')].map((s) => s.textContent))
        .filter((pair) => pair.length === 2)
    ),
  }));

const straight = page.getByRole('button', { name: 'Straighten up' });
at = await reachable(closer);
check('Closer can be brought whole onto a phone screen on the three-dimensional room', at.ok, at.said);
at = await reachable(further);
check('and so can Further out on the three-dimensional room', at.ok, at.said);
at = await reachable(straight);
check('and so can Straighten up, which starts below the fold at this height', at.ok, at.said);

check('at the widest view the room says there is nothing further out to go',
  (await further.isDisabled()) === true, 'Further out is live at the widest view');

const wide = await solidView();
check('the whole room is what the widest view shows',
  wide.viewBox === '0 0 1000 1000', String(wide.viewBox));

await closer.click();
await page.waitForTimeout(300);
const close = await solidView();

check('getting closer to the room moves no reading on it',
  JSON.stringify(close.readings) === JSON.stringify(wide.readings),
  JSON.stringify(wide.readings));
check('and it really did get closer — the same drawing through a smaller window',
  close.viewBox !== wide.viewBox
    && Math.abs(Number(close.viewBox.split(' ')[2]) * ROOM_STEP - 1000) < 0.01,
  `${wide.viewBox} became ${close.viewBox}`);
check('and now there is somewhere further out to go',
  (await further.isDisabled()) === false, 'Further out is still refusing');

await further.click();
await page.waitForTimeout(300);
const backOut = await solidView();
check('going further out puts the room back exactly where it was',
  backOut.viewBox === wide.viewBox && JSON.stringify(backOut.faces) === JSON.stringify(wide.faces),
  `${wide.viewBox} then ${backOut.viewBox}`);

/* --------------------------------------------- turning it, which is not zooming */

const where = await solid.boundingBox();
await page.mouse.move(where.x + where.width * 0.3, where.y + where.height * 0.5);
await page.mouse.down();
await page.mouse.move(where.x + where.width * 0.75, where.y + where.height * 0.25, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(400);
const turned = await solidView();

check('dragging really turns the room rather than doing nothing',
  JSON.stringify(turned.faces) !== JSON.stringify(wide.faces),
  'every face is where it was after a drag across the room');

// The point of the whole file, said about the readings rather than about the
// geometry: turning a room changes which walls you can see and what shape each
// one is drawn as. It cannot change what any of them measures.
const both = Object.keys(turned.readings).filter((name) => name in wide.readings);
const moved = both.filter((name) => turned.readings[name] !== wide.readings[name]);
check('and every wall that is drawn both before and after carries the same reading',
  both.length > 0 && moved.length === 0,
  moved.length === 0
    ? `only ${both.length} labels were drawn in both`
    : moved.map((n) => `${n}: ${wide.readings[n]} became ${turned.readings[n]}`).join(' | '));

/* ------------------------------------------------------------ straighten up */

// Zoomed AND turned, because straightening one and leaving the other is the
// failure this control's own comment names: "Straightening the view and leaving
// it magnified eight times is not straightening it."
await closer.click();
await page.waitForTimeout(200);
await closer.click();
await page.waitForTimeout(200);
const crooked = await solidView();
check('the room can be both turned and magnified at once',
  crooked.viewBox !== wide.viewBox
    && JSON.stringify(crooked.faces) !== JSON.stringify(wide.faces),
  crooked.viewBox);

at = await reachable(straight);
check('Straighten up is still whole on the screen once the room has been moved', at.ok, at.said);
await straight.click();
await page.waitForTimeout(500);
const settled = await solidView();

check('Straighten up puts the angle back',
  JSON.stringify(settled.faces) === JSON.stringify(wide.faces),
  'the room is still turned');
check('and the zoom with it — straightening a magnified room straightens the zoom too',
  settled.viewBox === wide.viewBox, `${wide.viewBox} wanted, ${settled.viewBox} got`);
check('and it moved no reading on the way',
  JSON.stringify(settled.readings) === JSON.stringify(wide.readings),
  JSON.stringify(settled.readings));

/* ------------------------------ and it does not quietly leave the mode it is in */

const inside = page.getByRole('button', { name: 'Stand inside' });
await inside.scrollIntoViewIfNeeded();
await inside.click();
await page.waitForTimeout(500);
check('standing inside the room is a mode the screen says it is in',
  (await page.getByRole('button', { name: 'Back outside' }).count()) === 1,
  (await page.locator('main').innerText()).slice(0, 200));

await closer.click();
await page.waitForTimeout(250);
at = await reachable(straight);
check('Straighten up is reachable from inside the room as well', at.ok, at.said);
await straight.click();
await page.waitForTimeout(500);
check('and straightening up from inside stands you straight, it does not walk you out',
  (await page.getByRole('button', { name: 'Back outside' }).count()) === 1,
  'straightening up left the mode it was pressed inside');

check('viewing: no console or page errors', noise().length === 0, noise().join(' | '));

const bad = report(TITLE);
await ctx.close();
await browser.close();
process.exit(bad > 0 ? 1 : 0);

/* ==========================================================================
   What this part found and could not fix, and who has to.

   * **`Sketch.tsx`'s Further out is live at the widest view and does nothing.**
     `Room3D.tsx` disables both ends of its zoom — `disabled={box.size >= SIZE}`
     — and the drawing board does not, so at the widest view the button is
     pressable, changes nothing, and gives no signal that it cannot. Measured
     above: the drawing is byte-identical before and after the press, and
     `isDisabled()` is false. It is the same one line at the other end, where
     `Closer` stops at eight times. `Sketch.tsx` is not this part's file; the
     exact change is in the integration note.

   * **The Floor screen's doorway dots have no accessible name and no role.**
     Joining two rooms is two taps on `<g onClick>` elements with nothing but
     `<circle>`s inside them: no `role`, no `aria-label`, no `tabindex`. Every
     other tappable thing on a drawing in this app is a `role="button"` with a
     name — a wall, a facet, a mark. Nothing in `check-controls.py` can see
     this, because a control with no name is not a name that can be undriven.
     Noticed while driving `Start the joins again` in `a47`; `Floor.tsx` is not
     this part's file either.

   What is NOT proven here, and cannot be without a device: that a pinch on a
   real phone zooms about the fingers the way the buttons zoom about the middle.
   `Room3D` has a two-finger path of its own and no mouse can drive it; the
   button path above is the one a thumb uses and the one that had never been
   driven at all.
   ========================================================================== */
