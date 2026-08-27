import { readFileSync } from 'node:fs';
import { check, noise, openAsApp, report, section, SP } from './lib.mjs';

/**
 * The ceiling, as a surface somebody works on — driven through the real app.
 *
 * > "ON THE 3D MODEL I TOLD YOU THAT I DIDNT WANT THE CEILING BEING RENDERED
 * >  AND ITS GREAT, BUT WHAT IF I HAVE TO SCAN A CEILING OR POINT IT UP TO
 * >  SOMETHING SIMILAR, HOW WOULD THAT WORK?"
 *
 * Every figure below is worked out **here**, on paper, from the scan file — not
 * read back off the screen that is being tested. `garage.json` is 6.096 m by
 * 6.4008 m by 2.7432 m high, with one 0.9144 by 2.032 m door and one 1.2192 m
 * square window, both on the south wall. In feet that is a 20 by 21 ft room, 9
 * ft up, with a 3 by 6'8" door and a 4 by 4 window, and so:
 *
 *   - the floor, and the ceiling that follows it: 20 x 21   = 420.0 sq ft
 *   - the walls, corner to corner:                2 x (20+21) = 82.00 lf
 *   - their face, less the two openings:  82 x 9 - 20 - 16 = 702.0 sq ft
 *   - the base, less the door but not the window:  82 - 3 =  79.00 lf
 *
 * A screen that agrees with itself proves nothing. These are the numbers the
 * app has to produce, and — the whole point of this part — the numbers it has
 * to go on producing once a ceiling panel exists.
 *
 * The properties, in the order they would break:
 *
 *   1. The ceiling has a panel of its own, and its area is the sheet's own
 *      ceiling line rather than a second sum that can drift.
 *   2. Nothing moves. Opening the ceiling, looking up at it and putting the
 *      walls back leaves every figure on the Takeoff and the Price identical,
 *      character for character.
 *   3. Deciding something on the ceiling moves exactly the ceiling and nothing
 *      else, by an amount worked out here.
 *   4. Looking up is a mode, never the default, and it puts the room back
 *      exactly as it was.
 *   5. One screen, one control per name — the failure this panel caused the
 *      first time it was written, with two "Say what is being done" buttons
 *      four inches apart.
 */

const garage = JSON.parse(readFileSync(`${SP}/garage.json`, 'utf8'));

const TITLE = 'A30 — the ceiling as a surface you can work on';

/**
 * A part that dies still says what it had proved.
 *
 * Two of the four deliberate mistakes this part was watched failing on — the
 * look-up view left on by default, and a second copy of the room-wide controls
 * — do not produce a wrong answer. They make a control that is not there, or
 * two that are, and the script throws reaching for it. Without this the run
 * ended with a stack trace, no report and every check that HAD passed thrown
 * away, which reads exactly like a broken audit rather than a broken app.
 */
function gaveUp(why) {
  check('the part ran to the end', false, String(why).split('\n')[0]);
  process.exit(report(TITLE) === 0 ? 0 : 1);
}
// Both, and it has to be both. A top-level `await` that rejects in an ES module
// is delivered as an *uncaught exception*, not as an unhandled rejection, so a
// handler for one of the two catches half the ways this can end.
process.on('unhandledRejection', gaveUp);
process.on('uncaughtException', gaveUp);

/*
 * The room, worked out here rather than asked for — in whole inches, and every
 * step of it an integer.
 *
 * An inch is 25.4 mm exactly, so the scan's metres are whole inches exactly:
 * 6.096 m is 6096 mm is 240 in, 6.4008 m is 252 in, 2.7432 m is 108 in, the
 * door is 36 by 80 in and the window 48 by 48 in. Dividing in feet instead put
 * the wall face at 701.9999999999999 and failed a check the app had passed —
 * which is the same reason nothing in this app measures a building with a
 * float, and the reason this part does not either.
 */
const SQ_IN = 144; //  one square foot
const WIDE = 240;
const DEEP = 252;
const HIGH = 108;
const RUN_IN = 2 * (WIDE + DEEP); //                                     984 in
const CEILING_SQ_FT = (WIDE * DEEP) / SQ_IN; //                      420 sq ft
const RUN_LF = RUN_IN / 12; //                                          82 lf
const FACE_SQ_FT = (RUN_IN * HIGH - 36 * 80 - 48 * 48) / SQ_IN; //   702 sq ft
const BASE_LF = (RUN_IN - 36) / 12; //                                  79 lf

const RATES = [
  ['Floor rate', '9.50'],
  ['Ceiling rate', '4.25'],
  ['Wall face rate', '3.75'],
  ['Baseboard rate', '6.00'],
];
const CEILING_RATE = 4.25;

const cash = (text) => Number(String(text).replace(/[^0-9.]/g, ''));

/** The quantity the takeoff is showing against one item. */
function quantityOf(panel, item) {
  const line = new RegExp(`(?:^|\\n)${item}\\n[\\s\\S]{0,200}?([\\d,]+\\.?\\d*) (sq ft|lf|ea)`).exec(panel);
  return line ? Number(line[1].replace(/,/g, '')) : null;
}

/** Every number on a screen, in the order it is printed. */
const figures = (text) => (text.match(/[\d,]+\.\d+/g) ?? []).map((n) => n.replace(/,/g, ''));

const totalOn = (text) => cash(/Total\n\$([\d,]+\.\d{2})/.exec(text)?.[1] ?? '0');

/* ==========================================================================
   0. A rate book, so there is money to move — or fail to.
   ========================================================================== */

const shop = await openAsApp({ subscribed: true }, {});
await shop.page.goto(shop.page.url() + '#business', { waitUntil: 'networkidle' });
await shop.page.waitForTimeout(600);
for (const [label, typed] of RATES) {
  const box = shop.page.getByLabel(label);
  await box.fill(typed);
  await box.blur();
  await shop.page.waitForTimeout(80);
}
const sent = await shop.page.evaluate(() => window.__sent?.company ?? []);
const company = sent.at(-1)?.company ?? '';
check('a rate book with a ceiling rate in it', /Ceiling/.test(company), company.slice(0, 200));
await shop.ctx.close();

const { ctx, page } = await openAsApp({
  company,
  subscribed: true,
  room: garage,
  fileName: 'Garage 2026-08-27 0900',
});

const takeoff = page.locator('[data-panel="takeoff"]');
const price = page.locator('[data-panel="price"]');
const plan = page.locator('[data-panel="plan"]');

/* ==========================================================================
   1. The sheet, before anybody has touched anything, against the arithmetic
      at the top of this file.
   ========================================================================== */

await section(page, 'Takeoff');
const asFound = await takeoff.innerText();

check('the ceiling is on the sheet at the room’s own area',
  quantityOf(asFound, 'Ceiling') === CEILING_SQ_FT,
  `${quantityOf(asFound, 'Ceiling')}, and 20 x 21 is ${CEILING_SQ_FT}`);
check('and so is everything else, at the figures worked out here',
  quantityOf(asFound, 'Floor') === CEILING_SQ_FT &&
    quantityOf(asFound, 'Wall face') === FACE_SQ_FT &&
    quantityOf(asFound, 'Baseboard') === BASE_LF,
  `floor ${quantityOf(asFound, 'Floor')}/${CEILING_SQ_FT}, ` +
    `face ${quantityOf(asFound, 'Wall face')}/${FACE_SQ_FT}, ` +
    `base ${quantityOf(asFound, 'Baseboard')}/${BASE_LF}`);

await section(page, 'Price');
const pricedAsFound = await price.innerText();
const totalAsFound = totalOn(pricedAsFound);
check('and there is money against it', totalAsFound > 0, `${totalAsFound}`);

/* Every figure on both screens, before the ceiling panel is touched at all. */
const takeoffBefore = await (await section(page, 'Takeoff'), takeoff.innerText());
const priceBefore = await (await section(page, 'Price'), price.innerText());

/* ==========================================================================
   2. The ceiling has a panel, and its area is the sheet's number.
   ========================================================================== */

// Sam's own words: "tapping the room's floor fill on the plan — the empty
// middle, not a wall — opens the ceiling the way tapping a wall opens that
// wall." So that is the way in, and the way in is what gets tested: a panel
// reachable only by a route nobody was told about is a panel nobody has.
await section(page, 'Plan');
await page.waitForTimeout(300);

const wayIn = page.getByRole('button', { name: 'The ceiling', exact: true }).first();
check('the empty middle of the plan is a control, and it says what it opens',
  (await wayIn.count()) === 1, `${await wayIn.count()} found`);
check('and the drawing says so, rather than leaving it to be discovered',
  /Tap the middle of the room for the ceiling/.test(await page.locator('[data-panel="plan"]').innerText()));

await wayIn.click();
await page.waitForTimeout(400);
const panel = page.locator('[data-surface="ceiling"]');
check('the ceiling has a panel of its own', (await panel.count()) === 1,
  `${await panel.count()} of them`);

const ceilingPanel = await panel.innerText();
const shown = Number((/([\d,]+\.\d) sq ft/.exec(ceilingPanel) ?? [])[1]?.replace(/,/g, ''));
check('with the ceiling’s area on it, to the square foot worked out here',
  shown === CEILING_SQ_FT, `${shown}, and 20 x 21 is ${CEILING_SQ_FT}`);
check('and the sheet charges that same area against the ceiling',
  shown === quantityOf(asFound, 'Ceiling'),
  `panel ${shown}, sheet ${quantityOf(asFound, 'Ceiling')}`);
check('it says where the number comes from, rather than leaving it to be guessed',
  /follows the floor/.test(ceilingPanel) && /not a second sum/.test(ceilingPanel),
  ceilingPanel.slice(0, 400));
// Asserted by substance, not by one sentence. The panel says this in whichever
// words `WorkOn` puts in it, and those words legitimately differ depending on
// whether this panel is the place that carries the room-wide way in. What must
// be true wherever the panel lives is that it says the ceiling is being priced
// as replaced, and that the way to say otherwise is on the ceiling's own panel
// rather than on some other screen — which is the whole reason it has a panel.
check('it says the ceiling is priced as replaced until somebody says otherwise',
  /priced as if it were being replaced/.test(ceilingPanel) && /the whole ceiling/.test(ceilingPanel),
  ceilingPanel.slice(0, 700));
const sayIt = panel.getByRole('button', { name: 'Say what is being done' });
check('and the way to say otherwise is on the ceiling’s own panel, not on another screen',
  (await sayIt.count()) === 1, `${await sayIt.count()} of them inside the panel`);

/* ==========================================================================
   3. Where a measurement taken by pointing the phone up lands.
   ========================================================================== */

check('the panel has somewhere for what was measured by pointing the phone up',
  /Measured by pointing the phone up/.test(ceilingPanel), ceilingPanel.slice(0, 900));
check('and says how one gets there, rather than being an empty box',
  /AR Measure/.test(ceilingPanel) && /soffit/.test(ceilingPanel),
  ceilingPanel.slice(0, 900));
check('nothing is claimed to have been measured on a room nobody has pointed a phone at',
  /Nothing yet/.test(ceilingPanel), ceilingPanel.slice(0, 900));

/* ==========================================================================
   4. It behaves like a wall — and it is in exactly one place.

      "Opens the ceiling the way tapping a wall opens that wall" is two
      properties, not one: tapping opens it, and tapping again closes it. A
      panel that only opens is a panel that is stuck on the screen.

      And it has to have LEFT the Room tab. While it was in both places a
      contractor could untick the ceiling on the plan and find it still ticked
      on the room, which is the failure `ceilingHere` exists to prevent and
      which no other check in this repository would see.
   ========================================================================== */

await section(page, 'Room');
check('the ceiling is no longer on the room tab, so there is one place to decide it',
  (await page.locator('[data-panel="room"] [data-surface="ceiling"]').count()) === 0 &&
    (await page.locator('input[aria-label="Ceiling on the ceiling"]').count()) === 0,
  `${await page.locator('[data-panel="room"] [data-surface="ceiling"]').count()} panels, ` +
    `${await page.locator('input[aria-label="Ceiling on the ceiling"]').count()} tick boxes`);
// The floor, not a tick box. Nothing has been scoped yet at this point in the
// run, so there is no tick box for anything — the first version of this check
// looked for one and went red against an app that was behaving correctly. What
// is true of an unscoped room is that the room tab is now about the floor and
// says where the ceiling went.
const roomTab = await page.locator('[data-panel="room"]').innerText();
check('and the room tab is about the floor now, and says where the ceiling went',
  /The floor on its own/.test(roomTab) && /opened from the plan/.test(roomTab),
  roomTab.slice(0, 500));

await section(page, 'Plan');
await wayIn.click();
await page.waitForTimeout(300);
check('tapping the middle of the room again closes the ceiling, as tapping a wall does',
  (await panel.count()) === 0 && (await wayIn.getAttribute('aria-pressed')) === 'false',
  `${await panel.count()} panels, pressed=${await wayIn.getAttribute('aria-pressed')}`);

await wayIn.click();
await page.waitForTimeout(300);
check('and tapping it once more opens it again',
  (await panel.count()) === 1 && (await wayIn.getAttribute('aria-pressed')) === 'true',
  `${await panel.count()} panels, pressed=${await wayIn.getAttribute('aria-pressed')}`);

/* ==========================================================================
   5. One screen, one control per name.

      The first version of this panel put a second copy of "Say what is being
      done", "Start from nothing" and "Price it all again" on the screen it was
      on, four inches below the first. This is the check that caught it.
   ========================================================================== */

/**
 * What a screen reader would call every control on one screen.
 *
 * The same order `a12-everything` works it out in — label, then text, then
 * title — and text only for the elements where text IS the name. Falling back
 * to `textContent` on a `<select>` reads out every option in it as one string,
 * which the first version of this did: it reported three controls all called
 * "wall-1 — 20'wall-2 — 21'..." and none of them was a duplicate of anything.
 */
async function namesOn(where) {
  const showing = page.locator(`[data-panel="${where}"]:not([hidden])`);
  // Counted before it is evaluated, and that is the whole of this line's
  // reason to exist. `locator.evaluate` against a selector that matches
  // nothing waits out its full timeout and then throws — so when the ceiling
  // panel moved from the Room tab to the Plan tab, this part did not fail, it
  // hung for thirty seconds and died with a stack trace. A check that cannot
  // find its own screen has to go red and say so.
  if ((await showing.count()) !== 1) return null;
  return showing.evaluate((el) => {
    const names = [];
    for (const c of el.querySelectorAll('button, a, summary, input, select, textarea')) {
      const box = c.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;
      const speaks = /^(button|a|summary)$/i.test(c.tagName);
      let name = (c.getAttribute('aria-label') || '').trim();
      if (!name && c.id) {
        name = (document.querySelector(`label[for="${CSS.escape(c.id)}"]`)?.textContent || '').trim();
      }
      if (!name) name = (c.closest('label')?.textContent || '').trim();
      if (!name && speaks) name = (c.textContent || '').trim();
      if (!name) name = (c.getAttribute('title') || '').trim();
      if (name) names.push(name.replace(/\s+/g, ' '));
    }
    return names;
  });
}

function twiceOver(names) {
  const count = new Map();
  for (const n of names) count.set(n, (count.get(n) ?? 0) + 1);
  return [...count].filter(([, n]) => n > 1).map(([n, k]) => `${k} x "${n}"`);
}

// The plan, because that is where the ceiling opens now. The room screen is
// checked by `a12-everything`, which walks every screen there is.
const named = await namesOn('plan');
check('no two controls on the screen the ceiling opens on answer to the same name',
  named !== null && twiceOver(named).length === 0,
  named === null ? 'the plan panel was not showing at all' : twiceOver(named).join(', '));

/* ==========================================================================
   6. Looking up. A mode somebody turns on, never the default.
   ========================================================================== */

await section(page, 'Plan');
await page.getByRole('tab', { name: '3D' }).click();
await page.waitForTimeout(400);

const drawing = plan.locator('svg[role="img"]').first();
const facesBefore = await plan.locator('svg polygon').count();
const nameBefore = await drawing.getAttribute('aria-label');
const captionBefore = await plan.innerText();

const lookUp = page.getByRole('button', { name: 'Look up' });
check('the 3D view offers a way to look up at the ceiling', (await lookUp.count()) === 1);
const pressedAtFirst = (await lookUp.count()) === 1 ? await lookUp.getAttribute('aria-pressed') : 'absent';
check('and it is off, because the view Sam likes is the one with no ceiling on it',
  pressedAtFirst === 'false' && facesBefore > 1,
  `pressed=${pressedAtFirst}, ${facesBefore} faces drawn`);

await lookUp.click();
await page.waitForTimeout(400);

const facesUp = await plan.locator('svg polygon').count();
const nameUp = await drawing.getAttribute('aria-label');
const captionUp = await plan.innerText();

check('looking up draws the ceiling and nothing else — the walls dropped away',
  facesUp === 1, `${facesUp} faces drawn, expected exactly the ceiling`);
check('and the drawing says so to anybody who cannot see it',
  /ceiling/i.test(nameUp) && /walls dropped away/i.test(nameUp), String(nameUp));
check('the walls are named round the edge, so you can tell which end is which',
  await plan.locator('svg text').evaluateAll((els, ids) => {
    const said = els.map((e) => e.textContent);
    return ids.every((id) => said.some((t) => t.includes(id)));
  }, garage.walls.map((_, i) => `wall-${i + 1}`)),
  await plan.locator('svg text').allTextContents().then((t) => t.join(' | ')));
check('and the ceiling’s area is on the view, the same one the sheet charges',
  new RegExp(`${CEILING_SQ_FT}\\.0 sq ft`).test(captionUp), captionUp.slice(0, 700));
check('it says the walls are dropped away rather than changed',
  /still measured and still on the sheet/.test(captionUp), captionUp.slice(0, 700));

await page.getByRole('button', { name: 'Put the walls back' }).click();
await page.waitForTimeout(400);

check('putting the walls back puts the view back exactly as it was',
  (await plan.locator('svg polygon').count()) === facesBefore &&
    (await drawing.getAttribute('aria-label')) === nameBefore,
  `${await plan.locator('svg polygon').count()} of ${facesBefore} faces, ` +
    `"${await drawing.getAttribute('aria-label')}" was "${nameBefore}"`);
check('and the default view still says what it always said',
  (await plan.innerText()) === captionBefore, 'the caption under the 3D view changed');

/* ==========================================================================
   7. And not one number moved.
   ========================================================================== */

await section(page, 'Takeoff');
const takeoffAfter = await takeoff.innerText();
await section(page, 'Price');
const priceAfter = await price.innerText();

check('opening the ceiling and looking up moved nothing on the takeoff',
  takeoffAfter === takeoffBefore, 'the takeoff screen is not what it was');
check('and nothing on the price',
  priceAfter === priceBefore, 'the price screen is not what it was');

/* ==========================================================================
   8. Deciding something on the ceiling. The first tap moves nothing; taking
      the ceiling off moves the ceiling and only the ceiling.
   ========================================================================== */

// On the plan, and on the ceiling's own panel — the same two taps a person
// makes. Scoped to the panel rather than to the page, so this is provably the
// ceiling's copy of the control and not one belonging to some other surface.
await section(page, 'Plan');
check('the ceiling is still open after walking away to another tab and back',
  (await panel.count()) === 1, `${await panel.count()} panels`);
await panel.getByRole('button', { name: 'Say what is being done' }).first().click();
await page.waitForTimeout(400);

await section(page, 'Takeoff');
const scoped = await takeoff.innerText();
check('saying what is being done starts from everything, so no quantity moves',
  figures(scoped).join(' ') === figures(takeoffBefore).join(' '),
  `${figures(scoped).join(' ')}\n was \n${figures(takeoffBefore).join(' ')}`);

await section(page, 'Price');
const scopedPrice = await price.innerText();
const totalScoped = totalOn(scopedPrice);
check('and the money is exactly where it was',
  Math.abs(totalScoped - totalAsFound) < 0.005, `${totalScoped} vs ${totalAsFound}`);

// Now that there is a scope there are tick boxes, and this is where "one place
// to decide it" is finally provable: the ceiling's box is on the ceiling's
// panel and nowhere else, and the floor's is on the room tab and nowhere else.
// Two boxes for one surface is how somebody unticks the ceiling on one screen
// and finds it still ticked on the other.
await section(page, 'Room');
check('the room tab has the floor’s tick box and none for the ceiling',
  (await page.locator('[data-panel="room"] input[aria-label="Floor on the floor"]').count()) === 1 &&
    (await page.locator('[data-panel="room"] input[aria-label="Ceiling on the ceiling"]').count()) === 0,
  `floor ${await page.locator('[data-panel="room"] input[aria-label="Floor on the floor"]').count()}, ` +
    `ceiling ${await page.locator('[data-panel="room"] input[aria-label="Ceiling on the ceiling"]').count()}`);

await section(page, 'Plan');
const box = panel.locator('input[aria-label="Ceiling on the ceiling"]');
check('the ceiling panel carries the decision about the ceiling',
  (await box.count()) === 1 && (await box.isChecked()),
  `${await box.count()} tick boxes, checked=${await box.isChecked()}`);
check('and exactly one tick box for the ceiling exists in the whole app',
  (await page.locator('input[aria-label="Ceiling on the ceiling"]').count()) === 1,
  `${await page.locator('input[aria-label="Ceiling on the ceiling"]').count()} of them`);

await box.uncheck();
await page.waitForTimeout(400);

await section(page, 'Takeoff');
const noCeiling = await takeoff.innerText();
check('taking the ceiling off takes it off the sheet entirely, not down to zero',
  quantityOf(noCeiling, 'Ceiling') === null && !/(^|\n)\s*0(\.0+)? sq ft/.test(noCeiling),
  noCeiling.slice(0, 900));
check('and it is named as being left alone rather than quietly missing',
  /the ceiling/.test(noCeiling), noCeiling.slice(0, 900));
check('the floor, the wall face and the base are untouched by a decision about the ceiling',
  quantityOf(noCeiling, 'Floor') === CEILING_SQ_FT &&
    quantityOf(noCeiling, 'Wall face') === FACE_SQ_FT &&
    quantityOf(noCeiling, 'Baseboard') === BASE_LF,
  `floor ${quantityOf(noCeiling, 'Floor')}, face ${quantityOf(noCeiling, 'Wall face')}, ` +
    `base ${quantityOf(noCeiling, 'Baseboard')}`);

await section(page, 'Price');
const totalWithout = totalOn(await price.innerText());
// 420 sq ft of ceiling at $4.25 is $1,785.00, worked out here.
const ceilingMoney = CEILING_SQ_FT * CEILING_RATE;
check('the money came down by the ceiling, to the cent, and not by a penny more',
  Math.abs(totalAsFound - totalWithout - ceilingMoney) < 0.005,
  `${totalAsFound} - ${totalWithout} = ${(totalAsFound - totalWithout).toFixed(2)}, ` +
    `and 420 x 4.25 is ${ceilingMoney.toFixed(2)}`);

await section(page, 'Plan');
await box.check();
await page.waitForTimeout(400);
await section(page, 'Price');
check('and putting the ceiling back puts the money back exactly',
  Math.abs(totalOn(await price.innerText()) - totalAsFound) < 0.005,
  `${totalOn(await price.innerText())} vs ${totalAsFound}`);

check('the ceiling: no console or page errors', noise().length === 0, noise().join(' | '));
await ctx.close();

process.exit(report(TITLE) === 0 ? 0 : 1);
