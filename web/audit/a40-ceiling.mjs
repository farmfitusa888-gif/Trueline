import { readFileSync } from 'node:fs';
import { check, noise, openAsApp, report, section, sentTo, SP } from './lib.mjs';

/**
 * Marks, photographs and voice notes on the ceiling — driven through the app.
 *
 * A wall has had all three since the day `Damage.tsx` was written. The ceiling
 * became a real surface — scoped, priced, tappable on the plan — and had none
 * of them, which left the single most common thing a restoration contractor
 * photographs with nowhere to go. `damage.ts` had said so about itself for
 * months:
 *
 * > "RoomPlan maps walls and floors. It does not map ceilings, and a water
 * >  stain on a ceiling is the single most common thing an adjuster is shown."
 *
 * ## What this part is really checking
 *
 * That the ceiling got the wall's feature and not a lookalike, and that the one
 * thing which genuinely could not be copied — **where the mark is** — was
 * answered honestly rather than faked.
 *
 * A wall mark is two lengths along the wall and a height off the floor, all
 * three read off a tape hooked in a corner somebody can put a thumb on. A
 * ceiling has no corner to hook a tape in, no *along* and no height. So a mark
 * on it says **how much of the ceiling** and never **where on it** — and the
 * checks below are written to fail if a position box ever appears, if a square
 * footage is ever asked for instead of two tape readings, or if a figure the
 * contractor taped is ever presented as something the room measured.
 *
 * ## Why it runs at 430 by 800
 *
 * Because the bug this feature is most likely to reproduce is not a wrong
 * number, it is a refusal nobody can see:
 *
 * > "MARK BUTTON DOESNT WORK IN THE WALL SECTION WHEN CLICKED"
 *
 * It worked. The refusal was 280 px above the thumb that pressed the button. At
 * 1600 px nothing is ever below the fold and no check about whether a person
 * can SEE something can fail, so this part is run with
 * `TRUELINE_AUDIT_HEIGHT=800` — an iPhone 15 Pro Max with the browser's chrome
 * taken off.
 *
 * ## The scan
 *
 * `dining.json`, Sam's own dining and living room: eleven walls, two open
 * spans, an outline that is not a rectangle. Not the perfect 21 by 20 box every
 * other part uses.
 *
 * Every figure is worked out here rather than read off the screen being tested,
 * except the two that are deliberately cross-checked between screens: the whole
 * ceiling's area is asserted to be the same number the sheet charges against
 * the ceiling, because a panel that agreed only with itself would prove
 * nothing.
 *
 * ## Every check here has been watched failing
 *
 * A check that has never been red is a comment that runs. Each of the 48 below
 * was watched going red against a build with one thing deliberately broken in
 * it, and green again with it put back — 36 mutations in all, in a copy of the
 * tree rather than in it, the way `check-the-checks.py` works. Among them:
 *
 *   - the ceiling panel never handed its marks, which is the app exactly as it
 *     stands before the App.tsx wiring lands;
 *   - the mark screen asking how far from the corner it starts, and asking for
 *     a square footage instead of two tape readings;
 *   - the refusal moved back above the fields, where it was when Sam reported
 *     the button as dead;
 *   - a patch bigger than the ceiling taken as it comes, and the refusal with
 *     the ceiling's own figure taken out of it;
 *   - the two readings added instead of multiplied;
 *   - the workings calling a taped figure a measured one;
 *   - a spot on the ceiling given an area to price;
 *   - a ceiling mark carrying a wall's board and base;
 *   - `validateVoiceNote` put back the way it is today, so a recording about
 *     the ceiling is refused and lost;
 *   - the panel working the ceiling's area out for itself instead of asking
 *     the sheet for it.
 */

const dining = JSON.parse(readFileSync(`${SP}/dining.json`, 'utf8'));

const TITLE = 'A40 — marks, photographs and voice on the ceiling';

/**
 * A part that dies still says what it had proved.
 *
 * Several of the mistakes this part was watched failing on do not produce a
 * wrong answer — they make a control that is not there, and the script throws
 * reaching for it. Without this the run ends with a stack trace, no report and
 * every check that HAD passed thrown away, which reads like a broken audit
 * rather than a broken app.
 */
function gaveUp(why) {
  check('the part ran to the end', false, String(why).split('\n')[0]);
  process.exit(report(TITLE) === 0 ? 0 : 1);
}
process.on('unhandledRejection', gaveUp);
process.on('uncaughtException', gaveUp);

/* --------------------------------------------------------- the arithmetic */

/** The patch this part marks: six foot by four. Worked out here, not read off. */
const ONE_WAY_FT = 6;
const OTHER_WAY_FT = 4;
const PATCH_SQ_FT = ONE_WAY_FT * OTHER_WAY_FT; //                       24 sq ft

/** And one that cannot fit: forty by forty is 1600 sq ft of dining room. */
const TOO_BIG_FT = 40;
const TOO_BIG_SQ_FT = TOO_BIG_FT * TOO_BIG_FT; //                     1600 sq ft

/** Every number on a screen, in the order it is printed. */
const figures = (text) => (text.match(/[\d,]+\.\d+/g) ?? []).map((n) => n.replace(/,/g, ''));

/**
 * Fill a box and make sure it took.
 *
 * These inputs are controlled by React, and a `fill` landing in the same frame
 * as the re-render that opened the form is occasionally swallowed. Filling and
 * reading the box back is the whole fix — the same guard `a22-voice` keeps.
 */
async function type(page, label, value) {
  const field = page.getByLabel(label);
  for (let go = 0; go < 3; go += 1) {
    await field.fill(value);
    await page.waitForTimeout(120);
    if ((await field.inputValue()) === value) return;
  }
  throw new Error(`"${label}" would not take "${value}"`);
}

/** Opens the ceiling by tapping the empty middle of the plan, as a person does. */
async function openTheCeiling(page) {
  await section(page, 'Plan');
  await page.waitForTimeout(300);
  const wayIn = page.getByRole('button', { name: 'The ceiling', exact: true }).first();
  if ((await wayIn.getAttribute('aria-pressed')) !== 'true') {
    await wayIn.click();
    await page.waitForTimeout(400);
  }
  return wayIn;
}

const panel = (page) => page.locator('[data-surface="ceiling"]').first();
const marks = (page) => page.locator('[data-marks="ceiling"]').first();

/* ==========================================================================
   1. The ceiling has somewhere to say what is wrong with it.
   ========================================================================== */

const { ctx, page } = await openAsApp({
  subscribed: true,
  room: dining,
  fileName: 'Dining 2026-08-28 0900',
  recordable: true,
  transcribes: true,
});

/*
 * The claim, first, because it is the job this feature exists for and because
 * it decides which words the mark screen offers. A restoration contractor turns
 * it on before he walks the room; a condition note on an ordinary job is the
 * wall's own path and `a22-voice` holds it.
 */
await section(page, 'Insurance');
await page.getByRole('button', { name: 'Turn it on' }).click();
await page.waitForTimeout(400);

await section(page, 'Takeoff');
const takeoffBefore = await page.locator('[data-panel="takeoff"]').innerText();

await openTheCeiling(page);
check('the ceiling panel opens from the middle of the plan',
  (await panel(page).count()) === 1, `${await panel(page).count()} panels`);
check('and it now has somewhere to say what is wrong with it',
  (await marks(page).count()) === 1, `${await marks(page).count()} mark sections`);

/*
 * What the panel says the ceiling is, read while nothing is marked on it.
 *
 * Read here rather than at §11 on purpose: once there are marks in the panel,
 * a mark's own square footage is also inside it, and a check that read the
 * first figure it found would happily pass off a 24 sq ft patch as the whole
 * ceiling. Nothing is marked yet, so this is the ceiling's own line and
 * nothing else.
 */
const areaOnPanel = /([\d,]+\.\d) sq ft/.exec(await panel(page).innerText())?.[1] ?? '';
check('the panel says what the ceiling is', areaOnPanel !== '', `"${areaOnPanel}"`);

let marking = await marks(page).innerText();
check('with nothing claimed to be marked on a ceiling nobody has looked at',
  /Nothing marked on the ceiling/.test(marking), marking.slice(0, 400));

/* ==========================================================================
   2. Three ways in, meaning the three things a wall's three mean — and not one
      of them asking where on the ceiling it is.
   ========================================================================== */

const partWay = marks(page).getByRole('button', { name: '+ part of the ceiling', exact: true });
const wholeWay = marks(page).getByRole('button', { name: '+ the whole ceiling', exact: true });
const spotWay = marks(page).getByRole('button', { name: '+ a spot', exact: true });

check('part of it, all of it, or a spot on it — the same three a wall offers',
  (await partWay.count()) === 1 && (await wholeWay.count()) === 1 && (await spotWay.count()) === 1,
  `part ${await partWay.count()}, whole ${await wholeWay.count()}, spot ${await spotWay.count()}`);
check('and it says out loud that a mark on a ceiling has no place on it',
  /how much of the ceiling and never where on it/.test(marking), marking.slice(0, 600));

await partWay.click();
await page.waitForTimeout(400);
marking = await marks(page).innerText();

const oneWayBox = page.getByLabel('How far the damage runs one way across the ceiling');
const otherWayBox = page.getByLabel('How far the damage runs the other way across the ceiling');
check('a patch of ceiling asks for two tape readings',
  (await oneWayBox.count()) === 1 && (await otherWayBox.count()) === 1,
  `${await oneWayBox.count()} and ${await otherWayBox.count()}`);

// The whole of the positioning decision, as a check. Nothing may ask how far
// from a corner, how far along, or how high — a ceiling has none of the three,
// and a box asking for one would be a box nobody standing under it can fill in.
const asked = await marks(page).evaluate((el) =>
  [...el.querySelectorAll('input')].map((i) => i.getAttribute('aria-label') ?? '').join(' | ')
);
check('and never where on the ceiling it is: no corner, no along, no height',
  !/corner|along|high|how far up/i.test(asked), asked);

// And never a square footage. He is on a ladder with his head back; four times
// three done up there is a sum nothing afterwards can catch, because 12 is a
// perfectly valid area and the mark simply comes out the wrong size.
check('nor an area he has to multiply out himself',
  !/(sq ft|square feet|area)/i.test(asked) &&
    !/type the area|square feet of it/i.test(marking),
  asked);
check('it says whose figure the reading is, and that the record is a rectangle',
  /your reading and not the room/.test(marking) && /rectangle the\s+damage fits inside/.test(marking),
  marking.slice(0, 900));

/* ==========================================================================
   3. A refusal you cannot see is a button that does not work.

      The same property `a31-mark` holds for a wall, at the same phone height,
      on the screen where it has never been checked.
   ========================================================================== */

await type(page, 'How far the damage runs one way across the ceiling', String(ONE_WAY_FT));
await type(page, 'How far the damage runs the other way across the ceiling', String(OTHER_WAY_FT));

const markIt = marks(page).getByRole('button', { name: 'Mark it', exact: true });
await markIt.scrollIntoViewIfNeeded();
await markIt.click();
await page.waitForTimeout(600);

// Measured after the click, not before it. The refusal puts the cursor in the
// description box and scrolls it into view, so the button has moved by the time
// the message exists — and comparing where the message IS against where the
// button WAS reports a distance neither of them was ever at.
const buttonBox = await markIt.boundingBox();
let says = await page.getByRole('status').filter({ hasText: 'Say what the damage is first' }).all();
check('marking with no description says why, rather than doing nothing',
  says.length >= 1, `${says.length} messages`);

let nearest = Infinity;
let onScreen = false;
for (const say of says) {
  const box = await say.boundingBox();
  if (!box) continue;
  nearest = Math.min(nearest, Math.abs(box.y - buttonBox.y));
  if (box.y >= 0 && box.y <= page.viewportSize().height) onScreen = true;
}
check('and the reason is on the screen at a real phone height', onScreen, `nearest ${nearest}px`);
check('and beside the button that was pressed, not in a panel above it',
  nearest < 150, `nearest message is ${nearest.toFixed(0)}px from the button`);

const focused = await page.evaluate(() => {
  const el = document.activeElement;
  return el instanceof HTMLInputElement ? (el.placeholder ?? '') : '';
});
check('with the cursor in the box it is asking about',
  /popcorn coming away|staining round the waste pipe/.test(focused), `focused: "${focused}"`);

check('and nothing was marked', /Nothing marked on the ceiling/.test(await marks(page).innerText()));

/* ==========================================================================
   4. A patch cannot be bigger than the ceiling it is part of, and the refusal
      says both figures rather than clamping it.
   ========================================================================== */

await marks(page).getByRole('button', { name: 'Water', exact: true }).click();
await page.getByPlaceholder('staining round the waste pipe from the bathroom above')
  .fill('water staining round the light');
await type(page, 'How far the damage runs one way across the ceiling', String(TOO_BIG_FT));
await type(page, 'How far the damage runs the other way across the ceiling', String(TOO_BIG_FT));
await markIt.scrollIntoViewIfNeeded();
const bigBox = await markIt.boundingBox();
await markIt.click();
await page.waitForTimeout(500);

const refusals = await page.getByRole('status').filter({ hasText: 'cannot be bigger' }).all();
check('a patch bigger than the ceiling is refused rather than quietly cut down',
  refusals.length >= 1, `${refusals.length} refusals`);

let refusedText = '';
let refusedNear = Infinity;
for (const one of refusals) {
  refusedText += await one.innerText();
  const box = await one.boundingBox();
  if (box) refusedNear = Math.min(refusedNear, Math.abs(box.y - bigBox.y));
}
check('the refusal carries the patch he typed, in square feet',
  new RegExp(`${TOO_BIG_SQ_FT}\\.0 sq ft`).test(refusedText), refusedText.slice(0, 300));
check('and what the ceiling actually is, which is the useful half of the answer',
  /the whole ceiling of "[^"]*" is [\d,]+\.\d sq ft/.test(refusedText), refusedText.slice(0, 300));
check('and it is beside the button, not in a banner at the top of the app',
  refusedNear < 150, `${refusedNear.toFixed(0)}px from the button`);
check('and still nothing was marked',
  /Nothing marked on the ceiling/.test(await marks(page).innerText()));

/* ==========================================================================
   5. Six foot by four. It lands, and it says what it is.
   ========================================================================== */

await type(page, 'How far the damage runs one way across the ceiling', String(ONE_WAY_FT));
await type(page, 'How far the damage runs the other way across the ceiling', String(OTHER_WAY_FT));
await markIt.click();
await page.waitForTimeout(600);

marking = await marks(page).innerText();
check('a patch of ceiling can be marked, and is listed',
  /1 mark on the ceiling/.test(marking) && /water staining round the light/.test(marking),
  marking.slice(0, 600));

const row = marks(page).getByRole('button', { name: /water staining round the light/ }).first();
check('and the claim carries it at the area those two readings make',
  new RegExp(`${PATCH_SQ_FT}\\.0 sq ft`).test(await row.innerText()), await row.innerText());
check('the row says out loud that it opens, for anybody not looking at it',
  (await row.getAttribute('aria-expanded')) === 'false', await row.getAttribute('aria-expanded'));
check('and says what is missing without being opened at all',
  /No photograph yet/.test(await row.innerText()), await row.innerText());

await row.click();
await page.waitForTimeout(500);
const open = await marks(page).innerText();
check('opened, it says the two readings that were taken',
  new RegExp(`${ONE_WAY_FT}' by ${OTHER_WAY_FT}'`).test(open), open.slice(0, 800));
check('and that what is recorded is the rectangle round the damage',
  /rectangle it fits inside/.test(open), open.slice(0, 800));
check('and that it was taped rather than measured off the room',
  /taped across it rather than measured off the room/.test(open), open.slice(0, 800));

/* ==========================================================================
   6. The photograph, which is the thing that cannot be taken again.
   ========================================================================== */

check('a ceiling mark reaches the camera, exactly as a wall mark does',
  (await marks(page).getByRole('button', { name: /Photograph it|^Another$/ }).count()) === 1,
  `${await marks(page).getByRole('button', { name: /Photograph it|^Another$/ }).count()} found`);

/* ==========================================================================
   7. And what he said about it, which is the half a photograph cannot carry.
   ========================================================================== */

const record = marks(page).getByRole('button', { name: 'Record a note' });
check('and the microphone, on a phone that has one',
  (await record.count()) === 1, `${await record.count()} found`);

await record.click();
await page.waitForTimeout(300);
const asked1 = (await sentTo(page, 'voice')).at(-1) ?? {};
check('pressing it asks the app to start a recording',
  asked1.action === 'start' && typeof asked1.id === 'string' && asked1.id !== '',
  JSON.stringify(asked1));

const noteId = asked1.id;
await page.evaluate((which) => window.trueline.heard(which, { started: true }), noteId);
await page.waitForTimeout(200);
await marks(page).getByRole('button', { name: /^Stop/ }).click();
await page.waitForTimeout(200);
await page.evaluate(
  (which) =>
    window.trueline.heard(which, {
      kept: { fileName: 'voice-1756400000-ceiling01.m4a', milliseconds: 9_000 },
    }),
  noteId
);
await page.waitForTimeout(500);

marking = await marks(page).innerText();
check('the recording is kept on the ceiling mark, before a word is written down',
  /1 recording/.test(marking) && /0:09/.test(marking), marking.slice(0, 900));
check('with a player pointed at the scan’s own folder',
  (await page.locator('audio[src="voice/voice-1756400000-ceiling01.m4a"]').count()) === 1);

await page.evaluate(
  (which) => window.trueline.heard(which, { transcript: 'stain is over the bathroom waste' }),
  noteId
);
await page.waitForTimeout(400);
const said = page.getByLabel('What was said, as text');
check('and the transcript lands on it, kept with the recording',
  (await said.inputValue()) === 'stain is over the bathroom waste', await said.inputValue());
check('marked as the phone’s until a person has read it',
  /Written by this phone/.test(await marks(page).innerText()));

const saved = (await sentTo(page, 'saved')).at(-1)?.project ?? '';
check('and both are in what the app was handed to write into the scan’s folder',
  saved.includes('voice-1756400000-ceiling01.m4a') &&
    saved.includes('stain is over the bathroom waste'),
  saved.slice(0, 200));

/* ==========================================================================
   8. A spot claims no area, and says so.
   ========================================================================== */

await openTheCeiling(page);
await marks(page).getByRole('button', { name: '+ a spot', exact: true }).click();
await page.waitForTimeout(400);
const spotting = await marks(page).innerText();
check('a spot on the ceiling promises no size and says none is invented',
  /No size, and none is invented/.test(spotting), spotting.slice(0, 800));

// And the way back out of it, which Sam asked for by name: "WHEN YOU DROPDOWN
// ANY MENU, HAVE A WAY TO COLLAPSE THEM BACK". A form that only opens is a
// screen and a half of dead weight in front of the next thing somebody needs.
await marks(page).getByRole('button', { name: 'Never mind', exact: true }).click();
await page.waitForTimeout(400);
check('and the form folds back up again, without marking anything',
  (await marks(page).getByRole('button', { name: 'Mark a spot on the ceiling' }).count()) === 0 &&
    (await marks(page).getByRole('button', { name: '+ a spot', exact: true }).count()) === 1,
  (await marks(page).innerText()).slice(0, 400));

await marks(page).getByRole('button', { name: '+ a spot', exact: true }).click();
await page.waitForTimeout(400);
await marks(page).getByRole('button', { name: 'Impact', exact: true }).click();
await page.getByPlaceholder('staining round the waste pipe from the bathroom above')
  .fill('nail pop over the table');
await marks(page).getByRole('button', { name: 'Mark a spot on the ceiling', exact: true }).click();
await page.waitForTimeout(600);
marking = await marks(page).innerText();
check('and it can be marked', /2 marks on the ceiling/.test(marking), marking.slice(0, 400));

await marks(page).getByRole('button', { name: /nail pop over the table/ }).first().click();
await page.waitForTimeout(400);
check('and it says it is a marker rather than a measurement',
  /a marked spot on the ceiling — no area/.test(await marks(page).innerText()),
  (await marks(page).innerText()).slice(0, 900));

/* ==========================================================================
   9. Two marks on the ceiling, and the room's own takeoff has not moved.

      Two sheets, deliberately, and never one. A takeoff answers what this room
      needs; a scope answers what this loss needs. A mark that quietly moved the
      takeoff would be a homeowner billed for a carrier's work.
   ========================================================================== */

await section(page, 'Takeoff');
check('marking a ceiling moves nothing on the room’s own sheet',
  (await page.locator('[data-panel="takeoff"]').innerText()) === takeoffBefore,
  'the takeoff changed when a mark was made');

/* ==========================================================================
   10. On a claim, it prices — the same way a wall mark prices.
   ========================================================================== */

await section(page, 'Insurance');
await page.waitForTimeout(300);
const insurance = page.locator('[data-panel="claim"]');
const scoped = await insurance.innerText();
check('the claim takes the ceiling finish out at the patch’s own area',
  new RegExp(`Remove ceiling finish[\\s\\S]{0,120}?${PATCH_SQ_FT}\\.0`).test(scoped),
  scoped.slice(0, 1400));
check('and puts it back at the same figure',
  new RegExp(`Replace ceiling finish[\\s\\S]{0,120}?${PATCH_SQ_FT}\\.0`).test(scoped),
  scoped.slice(0, 1400));
check('and never bills wall board or baseboard for a ceiling',
  !/Remove wall board|Remove baseboard/.test(scoped), scoped.slice(0, 1400));
check('the spot is on the claim as something seen, and never as work',
  /Marked and not on this sheet:[^.]*nail pop over the table/.test(scoped) &&
    /nobody can price a marker/.test(scoped),
  scoped.slice(0, 1800));

/* ==========================================================================
   11. The whole ceiling is the sheet's own ceiling, and not a second sum.
   ========================================================================== */

await openTheCeiling(page);
await marks(page).getByRole('button', { name: '+ the whole ceiling', exact: true }).click();
await page.waitForTimeout(400);
await page.getByPlaceholder('staining round the waste pipe from the bathroom above')
  .fill('the whole ceiling came down');
await marks(page).getByRole('button', { name: 'Mark the whole ceiling', exact: true }).click();
await page.waitForTimeout(600);

await marks(page).getByRole('button', { name: /the whole ceiling came down/ }).first().click();
await page.waitForTimeout(400);
const whole = await marks(page).innerText();
check('marking the whole ceiling charges the area the panel and the sheet agree on',
  whole.includes(`${areaOnPanel} sq ft`),
  `${areaOnPanel} sq ft not found in the opened mark: ${whole.slice(0, 700)}`);

await section(page, 'Takeoff');
const ceilingLine = /Ceiling\n[\s\S]{0,200}?([\d,]+\.\d) sq ft/.exec(
  await page.locator('[data-panel="takeoff"]').innerText()
)?.[1];
check('and that is the same ceiling the room’s own sheet charges — not a second sum',
  ceilingLine === areaOnPanel, `panel ${areaOnPanel}, sheet ${ceilingLine}`);

/* ==========================================================================
   12. Taking a mark off takes it off.
   ========================================================================== */

await openTheCeiling(page);
const before = figures(await marks(page).innerText()).length;
await marks(page).getByRole('button', { name: 'Take this mark off' }).first().click();
await page.waitForTimeout(500);
marking = await marks(page).innerText();
check('a ceiling mark can be taken off again',
  /2 marks on the ceiling/.test(marking) && !/the whole ceiling came down/.test(marking),
  `${before} figures before; now: ${marking.slice(0, 400)}`);

check('the ceiling: no console or page errors', noise().length === 0, noise().join(' | '));
await ctx.close();

process.exit(report(TITLE) === 0 ? 0 : 1);
