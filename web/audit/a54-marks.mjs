import { readFileSync } from 'node:fs';
import { openChromium } from '../../core/tools/browser.mjs';
import {
  HEIGHT, SP, URL,
  check, loadScan, noise, open, openAsApp, pick, report, reportEvenIfItDies, section, sentTo,
} from './lib.mjs';

// Say what was learned even if this part dies part way through.
reportEvenIfItDies('A54 — what is wrong with the wall, and the evidence on it');

/**
 * The ten controls on the marking screens that nothing had ever driven.
 *
 * `check-controls.py` stood at eighteen undriven controls this morning, and ten
 * of them were here: the whole-wall mark and the button that makes it, the box
 * a flood cut is typed into and the way back from it, the meter scale beside a
 * moisture reading, the ceiling height every square foot of wall is built on,
 * taking one photograph off a mark, shutting a photograph that fills the
 * screen, taking a recording off a wall, and shutting one of the walk's own
 * photographs.
 *
 * Every one of them is evidence or the size of a claim, and both of those are
 * money. So none of the checks below reads a figure off a screen and asserts it
 * equals itself. The room is measured first — the ceiling set to exactly eight
 * feet through the control this part is here to drive, wall-1 taped to exactly
 * twelve — and after that every area on the screen is a number worked out in
 * this file from two numbers somebody typed.
 *
 * ## What each one could get wrong
 *
 *   * **`the ceiling height`** — every square foot of board and paint on every
 *     wall is built on it. A whole-wall mark on a twelve-foot wall under an
 *     eight-foot ceiling is 96 square feet, and 108 when the ceiling is told it
 *     is nine. If the height a person types does not reach the claim, the claim
 *     is for the wrong number of square feet and nothing on the screen says so.
 *   * **`+ the whole wall` and `Mark the whole of …`** — the button has to name
 *     the wall it is about to mark, and the mark has to come to the whole of
 *     that wall's face and its whole run of base.
 *   * **`the cut height`** — where to cut is a decision about somebody's
 *     building and the damage is what was seen. The two have to stay apart on
 *     the claim: the area follows the cut, the sentence keeps the height the
 *     damage actually reached, and a cut BELOW the damage is refused.
 *   * **`Follow the damage instead`** — the way back from that decision, and it
 *     has to put the area back exactly, not approximately.
 *   * **`Meter scale`** — two readings on two scales are never a curve. A
 *     drying trend drawn across a scale change is a fabricated trend on a
 *     document somebody is paid against, and the app has to list them instead.
 *   * **`Take it off`** on a photograph — takes that one and no other, by name,
 *     and it comes off the claim document with it.
 *   * **`Close the damage photograph`** and **`Close the photograph`** — a
 *     picture filling a phone is the one place where "how do I get out of this"
 *     has no answer but a button, and the picture it enlarged has to be the one
 *     that was tapped.
 *   * **`Take off the recording from …`** — the recording that goes is the one
 *     named, the other stays, and what the app is handed to write into the
 *     scan's folder loses one file name and keeps the other.
 */

/* ===================================================================
   This side's arithmetic. Lengths in sixteenths of an inch, areas in
   hundredths of a square foot, so nothing here is ever a float that
   has to be compared with a tolerance.
   =================================================================== */

/** Feet, as hundredths of a foot. 1.5 -> 150n. */
const feet = (value) => BigInt(Math.round(value * 100));

/** An area in hundredths of a square foot, written the way the app writes it. */
function sqft(hundredthsOfSquareFoot) {
  const whole = hundredthsOfSquareFoot / 100n;
  const tenth = (hundredthsOfSquareFoot % 100n) / 10n;
  return `${whole.toLocaleString('en-US')}.${tenth} sq ft`;
}

/** Wide by high, both in feet, as the area the app prints. */
const area = (wide, high) => sqft((feet(wide) * feet(high)) / 100n);

// The harness's own arithmetic, checked before anything is trusted to it.
if (area(6, 1.5) !== '9.0 sq ft') throw new Error('the audit cannot multiply; fix it first');
if (area(12, 8) !== '96.0 sq ft') throw new Error('the audit cannot multiply; fix it first');
if (area(12, 9) !== '108.0 sq ft') throw new Error('the audit cannot carry; fix it first');
if (sqft(120_00n) !== '120.0 sq ft') throw new Error('the audit cannot spell an area; fix it first');

/* ==================================================================== */

/** The room this part measures, so every figure below is exact. */
const CEILING = 8;
const TALLER = 9;
const WALL = 12;
/** The patch: two feet from the corner, six feet of it, seen to eighteen inches. */
const PATCH_WIDE = 6;
const SEEN_TO = 1.5;
/** Where he decided to cut, which is not what he saw. */
const CUT_TO = 4;

const WHAT = 'supply line let go behind the radiator';

const { browser, ctx, page } = await open();
await loadScan(page, 'dining.json');

const plan = page.locator('[data-panel="plan"]');
const claim = page.locator('[data-panel="claim"]');

/** Every photograph on the open mark's strip, by name, in the strip's order. */
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

/**
 * The claim document, drawn fresh.
 *
 * The control is a toggle — it says "The report" while the details are showing
 * and "The details" while the report is — so it is pressed only when the report
 * is not already up. Pressing it blind takes the document away on the second
 * call and every check after that reads the wrong screen.
 */
async function theClaim() {
  await section(page, 'Insurance');
  const toReport = claim.getByRole('button', { name: 'The report', exact: true });
  if ((await toReport.count()) === 1) {
    await toReport.click();
    await page.waitForTimeout(700);
  }
  return claim.innerText();
}

/* ==========================================================================
   1. `the ceiling height` — the number every square foot is built on.
   ========================================================================== */

await section(page, 'Insurance');
await page.getByRole('button', { name: 'Turn it on' }).click();
await page.waitForTimeout(400);

await section(page, 'Room');
await page.waitForTimeout(300);
const room = page.locator('[data-panel="room"]');
check('the room says the ceiling height is the scanner’s and not a measurement',
  /took this from the tallest wall it saw/.test(await room.innerText()),
  (await room.innerText()).slice(0, 700));

await page.getByLabel('the ceiling height', { exact: true }).fill(`${CEILING}'`);
await page.getByRole('button', { name: 'Set the ceiling height' }).click();
await page.waitForTimeout(500);
check('a ceiling height put on a tape is recorded as measured, not as a guess',
  /Measured\. Every square foot of drywall and paint is built on this/
    .test(await room.innerText()),
  (await room.innerText()).slice(0, 700));

await section(page, 'Plan');
await pick(page, /^Wall wall-1,/);
await page.waitForTimeout(300);
await page.getByLabel('the length of wall-1', { exact: true }).fill(`${WALL}'`);
await page.getByRole('button', { name: 'Set the length of wall-1' }).click();
await page.waitForTimeout(700);

check('the height typed into the ceiling box is the height the wall now stands',
  new RegExp(`wall-1 straight on — ${WALL}' by ${CEILING}'`).test(await plan.innerText()),
  /wall-1 straight on[^\n]*/.exec(await plan.innerText())?.[0] ?? 'no wall header');

/* ==========================================================================
   2. `the cut height`, and `Follow the damage instead`.
   ========================================================================== */

await plan.getByRole('button', { name: '+ damaged area' }).click();
await page.waitForTimeout(300);
await plan.getByRole('button', { name: 'Water', exact: true }).click();
await page.getByPlaceholder('water line along the bottom of the wall').fill(WHAT);
await page.getByLabel('How far from the corner it starts').fill(`2'`);
await page.getByLabel('How wide it is').fill(`${PATCH_WIDE}'`);
await page.getByLabel('How high up the wall it goes').fill('18"');
await plan.getByRole('button', { name: 'Mark it' }).click();
await page.waitForTimeout(700);

const patchRow = plan.getByRole('button', { name: new RegExp(WHAT) }).first();
check('the damaged area is marked, at the area worked out here from what was typed',
  (await patchRow.innerText()).includes(area(PATCH_WIDE, SEEN_TO)),
  `worked out ${area(PATCH_WIDE, SEEN_TO)} for ${PATCH_WIDE}' by ${SEEN_TO}', ` +
    `row said ${JSON.stringify(await patchRow.innerText())}`);

await patchRow.click();
await page.waitForTimeout(500);
check('the cut height is asked for, and says it is a decision rather than an observation',
  (await page.getByLabel('the cut height', { exact: true }).count()) === 1
  && /What you decided, kept apart from what you saw/.test(await plan.innerText()),
  (await plan.innerText()).slice(-1500));
check('and there is no way back from a decision nobody has made yet',
  (await plan.getByRole('button', { name: 'Follow the damage instead' }).count()) === 0,
  'the way back was offered before there was anything to go back from');

// A cut BELOW what the damage reached is not a cut, it is a mistake. And a
// refusal a thumb cannot see is the same thing as a button that does nothing,
// which is the bug A31 exists for, so where it lands is measured as well.
const setCut = page.getByRole('button', { name: 'Set the cut height' });
await page.getByLabel('the cut height', { exact: true }).fill(`1'`);
await setCut.click();
await page.waitForTimeout(600);

const refused = page.getByRole('alert').filter({ hasText: 'below the top of the damage' });
check('a cut below the top of the damage is refused, and names both heights',
  (await refused.count()) === 1
  && new RegExp(`The cut is set at 1', below the top of the damage at 1' 6"`)
    .test(await refused.innerText()),
  (await page.locator('body').innerText()).slice(0, 900));

const tall = page.viewportSize().height;
const said = (await refused.count()) === 1 ? await refused.boundingBox() : null;
const pressed = await setCut.boundingBox();
check('and the refusal is on the screen at a real phone height, where the thumb is',
  said !== null && pressed !== null
  && said.y >= 0 && said.y <= tall && pressed.y >= 0 && pressed.y <= tall,
  `viewport ${tall}, refusal at ${said ? Math.round(said.y) : 'nowhere'}, ` +
    `button at ${pressed ? Math.round(pressed.y) : 'nowhere'}`);

check('and the area did not move on a refusal',
  (await patchRow.innerText()).includes(area(PATCH_WIDE, SEEN_TO)),
  await patchRow.innerText());
check('and no cut was recorded, so there is still nothing to go back from',
  (await plan.getByRole('button', { name: 'Follow the damage instead' }).count()) === 0,
  'a refused cut was recorded anyway');

if ((await refused.count()) === 1) {
  await refused.getByRole('button', { name: 'Close' }).click();
  await page.waitForTimeout(300);
}

await page.getByLabel('the cut height', { exact: true }).fill(`${CUT_TO}'`);
await page.getByRole('button', { name: 'Set the cut height' }).click();
await page.waitForTimeout(600);

check('a cut height typed in reaches the area, to a tenth of a square foot',
  (await patchRow.innerText()).includes(area(PATCH_WIDE, CUT_TO)),
  `worked out ${area(PATCH_WIDE, CUT_TO)} for ${PATCH_WIDE}' by ${CUT_TO}', ` +
    `row said ${JSON.stringify(await patchRow.innerText())}`);
check('and the workings keep the decision and the observation apart, in one sentence',
  new RegExp(`${PATCH_WIDE}' along wall-1, cut from 0" to ${CUT_TO}' — the damage was seen to 1' 6"`)
    .test(await plan.innerText()),
  (await plan.innerText()).slice(-1500));
check('the base still comes off the whole width, because the damage reached the floor',
  new RegExp(`${PATCH_WIDE}' of baseboard in the affected run`).test(await plan.innerText()),
  (await plan.innerText()).slice(-1500));

let paper = await theClaim();
check('the cut reaches the claim document, as the area and as the sentence',
  paper.includes(`${area(PATCH_WIDE, CUT_TO).replace(' sq ft', '')} sq ft of wall face`)
  && new RegExp(`cut from 0" to ${CUT_TO}' — the damage was seen to 1' 6"`).test(paper),
  paper.slice(0, 2500));
check('and the ceiling height that was typed is what the claim paints the wall to',
  paper.includes(`Prime and paint the wall\n${area(WALL, CEILING)}`),
  `worked out ${area(WALL, CEILING)} for a ${WALL}' wall under a ${CEILING}' ceiling, ` +
    `document said ${/Prime and paint the wall\n([^\n]*)/.exec(paper)?.[1] ?? 'nothing'}`);

await section(page, 'Plan');
await page.waitForTimeout(400);
await plan.getByRole('button', { name: 'Follow the damage instead' }).click();
await page.waitForTimeout(600);

check('following the damage again puts the area back exactly where it was',
  (await patchRow.innerText()).includes(area(PATCH_WIDE, SEEN_TO)),
  `worked out ${area(PATCH_WIDE, SEEN_TO)}, row said ${JSON.stringify(await patchRow.innerText())}`);
check('and the workings stop claiming a cut nobody has decided on',
  new RegExp(`${PATCH_WIDE}' along wall-1, 0" to 1' 6" high`).test(await plan.innerText())
  && !/cut from/.test(await plan.innerText()),
  (await plan.innerText()).slice(-1500));
check('and the way back is put away, because there is nothing left to go back from',
  (await plan.getByRole('button', { name: 'Follow the damage instead' }).count()) === 0,
  'the way back is still offered with no cut on the mark');

// Put the decision back, because a flood cut is what this mark is about.
await page.getByLabel('the cut height', { exact: true }).fill(`${CUT_TO}'`);
await page.getByRole('button', { name: 'Set the cut height' }).click();
await page.waitForTimeout(600);
check('and the cut can be made again after being taken back',
  (await patchRow.innerText()).includes(area(PATCH_WIDE, CUT_TO))
  && (await plan.getByRole('button', { name: 'Follow the damage instead' }).count()) === 1,
  await patchRow.innerText());

/* ==========================================================================
   3. `Meter scale` — and the curve that must not be drawn across one.
   ========================================================================== */

async function logReading(value, scale) {
  await page.getByLabel('Moisture reading').fill(String(value));
  await page.getByLabel('Meter scale').selectOption(scale);
  await plan.getByRole('button', { name: 'Log it' }).click();
  await page.waitForTimeout(400);
}

await logReading(28, 'points');
await logReading(12, 'points');
let panel = await plan.innerText();

check('two readings on one scale are a curve, and the app says which way it is going',
  /Drying: 28 down to 12 points\./.test(panel), panel.slice(-1600));
check('and each reading is listed with the scale it was taken on',
  /28 points/.test(panel) && /12 points/.test(panel), panel.slice(-1600));

paper = await theClaim();
check('both readings reach the claim document on their own scale',
  /28 points/.test(paper) && /12 points/.test(paper), paper.slice(0, 3000));
check('and the drying trend reaches it too, because that is what proves the work was needed',
  /Drying: 28 down to 12 points\./.test(paper), paper.slice(0, 3000));

await section(page, 'Plan');
await page.waitForTimeout(400);
await logReading(9, '%MC');
panel = await plan.innerText();

check('a third reading on a different scale stops the curve rather than continuing it',
  !/Drying: /.test(panel)
  && /These are on different scales, so they are listed rather than compared\./
    .test(panel.replace(/\s+/g, ' '))
  && /Two meters are not one meter\./.test(panel.replace(/\s+/g, ' ')),
  panel.slice(-1600));
check('and the reading itself is kept, on the scale it was taken on',
  /9 %MC/.test(panel), panel.slice(-1600));

paper = await theClaim();
check('and the claim document never shows a trend drawn across a change of meter',
  !/Drying: /.test(paper) && !/Getting wetter: /.test(paper)
  && /listed rather than compared/.test(paper),
  paper.slice(0, 3000));

/* ==========================================================================
   4. `Take it off` and `Close the damage photograph`.
   ========================================================================== */

await section(page, 'Plan');
await page.waitForTimeout(400);
await page.setInputFiles(
  'input[aria-label="Photograph the damage"]',
  [`${SP}/damage-photo.jpg`, `${SP}/damage-photo.jpg`, `${SP}/damage-photo.jpg`]
);
await page.waitForTimeout(7000);

const before = await onTheMark();
check('three photographs attach to the mark, each one its own file',
  before.length === 3 && new Set(before).size === 3, before.join(', '));
check('and there is one way to take each of them off, not one for the strip',
  (await plan.getByRole('button', { name: 'Take it off' }).count()) === 3,
  `${await plan.getByRole('button', { name: 'Take it off' }).count()} controls found`);

await theClaim();
const claimBefore = await onTheClaim();
check('the claim document is carrying all three',
  claimBefore.length === 3 && before.every((name) => claimBefore.includes(name)),
  claimBefore.join(', '));

await section(page, 'Plan');
await page.waitForTimeout(400);

// The middle one, full size. The picture that fills the phone has to be the one
// that was tapped, and there has to be a way out of it that is not the picture.
await plan.getByRole('button', { name: `Damage photograph ${before[1]}` }).click();
await page.waitForTimeout(500);
const bigOne = page.getByRole('dialog', { name: 'Damage photograph, full size' });
check('tapping a photograph opens it full size, as something a screen reader announces',
  (await bigOne.count()) === 1, `${await bigOne.count()} dialogs`);
check('and the picture filling the phone is the one that was tapped, by name',
  (await bigOne.locator('img').getAttribute('alt')) === `Damage photograph ${before[1]}`,
  await bigOne.locator('img').getAttribute('alt'));
const shutIt = page.getByRole('button', { name: 'Close the damage photograph' });
check('and the way out of it is a control with a name, not the picture itself',
  (await shutIt.count()) === 1,
  'the only way out of a black rectangle is tapping the black rectangle');
/*
 * Where the way out is, at a real phone height.
 *
 * The picture is `max-h-full` inside a box that fills the screen, and the
 * control sits under it. A tall photograph that pushed it past the bottom would
 * leave somebody holding a black rectangle with the only exit off the screen,
 * which is the same thing as no exit — and this is the one screen in the app
 * where there is nothing else to press.
 *
 * This is also the check that carries the weight for this control, because its
 * handler alone cannot be watched failing from outside: the dialog closes on a
 * click anywhere inside it, so a dead handler on the button is invisible. What
 * can be watched failing is the control going missing or going off the screen,
 * and both are what actually happened to the four controls this whole checker
 * was written for.
 */
const exit = (await shutIt.count()) === 1 ? await shutIt.boundingBox() : null;
check('and it is inside the phone, not under the bottom edge of a full-height picture',
  exit !== null && exit.y >= 0 && exit.y + exit.height <= page.viewportSize().height,
  `viewport ${page.viewportSize().height}, control at ` +
    `${exit ? `${Math.round(exit.y)}–${Math.round(exit.y + exit.height)}` : 'nowhere'}`);

await shutIt.click();
await page.waitForTimeout(400);
check('closing it puts the phone back, and takes nothing off the mark',
  (await page.getByRole('dialog', { name: 'Damage photograph, full size' }).count()) === 0
  && JSON.stringify(await onTheMark()) === JSON.stringify(before),
  (await onTheMark()).join(', '));

// The middle one off. By position in the strip, which is the only thing a thumb
// has to go on, and checked by NAME, which is the only thing that proves it.
await plan.getByRole('button', { name: 'Take it off' }).nth(1).click();
await page.waitForTimeout(700);
const after = await onTheMark();

check('taking one off takes exactly that one, by name',
  !after.includes(before[1]), `${before[1]} is still on the mark`);
check('and the other two are untouched, in the order they were in',
  JSON.stringify(after) === JSON.stringify([before[0], before[2]]),
  `${before.join(', ')} became ${after.join(', ')}`);
check('and the app says how many went, and offers them back',
  /1 photograph deleted\. They can go back until you leave this screen\./
    .test(await plan.getByRole('status').first().innerText())
  && (await plan.getByRole('button', { name: 'Put them back' }).count()) === 1,
  await plan.getByRole('status').first().innerText());

await theClaim();
const claimNow = await onTheClaim();
check('and it comes off the claim document with it, and only it',
  claimNow.length === 2 && !claimNow.includes(before[1])
  && claimNow.includes(before[0]) && claimNow.includes(before[2]),
  `${claimBefore.join(', ')} became ${claimNow.join(', ')}`);

/* ==========================================================================
   5. `+ the whole wall` and `Mark the whole of …` — and the ceiling height
      arriving in the size of the claim.
   ========================================================================== */

await section(page, 'Plan');
await page.waitForTimeout(400);
check('a wall can be marked whole, and the control says which wall',
  (await plan.getByRole('button', { name: '+ the whole wall' }).count()) === 1,
  'there is no way to mark a whole wall');

await plan.getByRole('button', { name: '+ the whole wall' }).click();
await page.waitForTimeout(300);
await plan.getByRole('button', { name: 'Water', exact: true }).click();
await page.getByPlaceholder('water line along the bottom of the wall')
  .fill('the whole wall went and the base with it');

const markWhole = plan.getByRole('button', { name: `Mark the whole of wall-1` });
check('the button names the wall it is about to mark, rather than "this one"',
  (await markWhole.count()) === 1, `${await markWhole.count()} controls found`);

await markWhole.click();
await page.waitForTimeout(800);
const wholeRow = plan.getByRole('button', { name: /the whole wall went and the base with it/ }).first();

check('marking a wall whole comes to its whole face, worked out here from what was typed',
  (await wholeRow.innerText()).includes(area(WALL, CEILING)),
  `worked out ${area(WALL, CEILING)} for ${WALL}' by ${CEILING}', ` +
    `row said ${JSON.stringify(await wholeRow.innerText())}`);

await wholeRow.click();
await page.waitForTimeout(500);
check('and the workings say it is the whole of that wall, at its own two dimensions',
  new RegExp(`the whole of wall-1, ${WALL}' by ${CEILING}', less every opening`)
    .test(await plan.innerText()),
  (await plan.innerText()).slice(-1500));
check('and the whole run of base comes off with it',
  new RegExp(`${WALL}' of baseboard in the affected run`).test(await plan.innerText()),
  (await plan.innerText()).slice(-1500));

// The payoff. The ceiling height is not a label: change it and the size of the
// claim on this wall changes by exactly twelve square feet a foot.
await section(page, 'Room');
await page.waitForTimeout(400);
await page.getByLabel('the ceiling height', { exact: true }).fill(`${TALLER}'`);
await page.getByRole('button', { name: 'Set the ceiling height' }).click();
await page.waitForTimeout(600);
await section(page, 'Plan');
await page.waitForTimeout(500);

check('a foot on the ceiling height is a wall’s length of square feet on the claim',
  (await wholeRow.innerText()).includes(area(WALL, TALLER)),
  `worked out ${area(WALL, TALLER)} at ${TALLER}', was ${area(WALL, CEILING)} at ${CEILING}'; ` +
    `row said ${JSON.stringify(await wholeRow.innerText())}`);
check('and the patch, which was cut to a height somebody decided, does not move with it',
  (await patchRow.innerText()).includes(area(PATCH_WIDE, CUT_TO)),
  `worked out ${area(PATCH_WIDE, CUT_TO)}, row said ${JSON.stringify(await patchRow.innerText())}`);

paper = await theClaim();
const affected = (feet(WALL) * feet(TALLER) + feet(PATCH_WIDE) * feet(CUT_TO)) / 100n;
check('the claim adds the two marks up, to a tenth of a square foot',
  paper.includes(`${sqft(affected).replace(' sq ft', '')} sq ft of`),
  `worked out ${sqft(affected)} = ${area(WALL, TALLER)} + ${area(PATCH_WIDE, CUT_TO)}, ` +
    `document said ${/Wall face affected\n([^\n]*)/.exec(paper)?.[1] ?? 'nothing'}`);
check('and the taller ceiling reaches the paint on the claim, to a tenth of a square foot',
  paper.includes(`Prime and paint the wall\n${area(WALL, TALLER)}`),
  `worked out ${area(WALL, TALLER)} at ${TALLER}', was ${area(WALL, CEILING)} at ${CEILING}'; ` +
    `document said ${/Prime and paint the wall\n([^\n]*)/.exec(paper)?.[1] ?? 'nothing'}`);

check('marking and measuring: no console or page errors', noise().length === 0, noise().join(' | '));
await ctx.close();
await browser.close();

/* ==========================================================================
   6. `Take off the recording from …` — on a phone that can record.
   ========================================================================== */

{
  const kitchen = JSON.parse(readFileSync(`${SP}/kitchen.json`, 'utf8'));
  const { ctx: c, page: p, browser: b } = await openAsApp({
    subscribed: true, room: kitchen, fileName: 'Kitchen', recordable: true, transcribes: true,
  });
  const wall = p.locator('[data-panel="plan"]');

  await section(p, 'Plan');
  await pick(p, /^Wall wall-1,/);
  await p.waitForTimeout(300);

  /** One recording, taken the way the phone takes one: start, stop, file, words. */
  async function recordOne(fileName, milliseconds, words) {
    await wall.getByRole('button', { name: /^Record a note$|^Record another$/ }).first().click();
    await p.waitForTimeout(250);
    const id = (await sentTo(p, 'voice')).at(-1).id;
    await p.evaluate((which) => window.trueline.heard(which, { started: true }), id);
    await p.waitForTimeout(200);
    await wall.getByRole('button', { name: /^Stop/ }).click();
    await p.waitForTimeout(200);
    await p.evaluate(
      ([which, file, ms]) => window.trueline.heard(which, { kept: { fileName: file, milliseconds: ms } }),
      [id, fileName, milliseconds]
    );
    await p.waitForTimeout(300);
    await p.evaluate(([which, text]) => window.trueline.heard(which, { transcript: text }), [id, words]);
    await p.waitForTimeout(400);
  }

  await recordOne('voice-1756300000-aaaaaaaa.m4a', 14_200, 'the jamb is split at the top');
  await recordOne('voice-1756300001-bbbbbbbb.m4a', 6_000, 'R-13 behind this wall');

  let said = await wall.innerText();
  check('two recordings are on the wall, each with its own length',
    /2 recordings/.test(said) && /0:14/.test(said) && /0:06/.test(said), said.slice(-1400));

  const takeOff = wall.getByRole('button', { name: /^Take off the recording from / });
  check('each recording has its own way off the wall',
    (await takeOff.count()) === 2, `${await takeOff.count()} controls found`);

  const kept = (await sentTo(p, 'saved')).at(-1)?.project ?? '';
  check('and both are in what the app was handed to write into the scan’s folder',
    kept.includes('voice-1756300000-aaaaaaaa.m4a')
    && kept.includes('voice-1756300001-bbbbbbbb.m4a'),
    kept.slice(0, 300));

  await takeOff.first().click();
  await p.waitForTimeout(700);
  said = await wall.innerText();

  check('taking one off leaves one, and says so',
    /1 recording/.test(said) && !/2 recordings/.test(said), said.slice(-1400));
  check('and the one that stayed is the other one, by its own length',
    /0:06/.test(said) && !/0:14/.test(said), said.slice(-1400));
  // The words live in a box, not in the page's text, so they are read back as
  // a value. `innerText` never sees what is inside an input, and a check that
  // asked the panel for them would pass on a screen that had lost them.
  const boxes = await wall.getByLabel('What was said, as text').all();
  const words = [];
  for (const box of boxes) words.push(await box.inputValue());
  check('and its words are still in the box under it, untouched',
    words.length === 1 && words[0] === 'R-13 behind this wall',
    `${words.length} boxes: ${JSON.stringify(words)}`);

  const now = (await sentTo(p, 'saved')).at(-1)?.project ?? '';
  check('and the recording that went is gone from what the app keeps, by file name',
    !now.includes('voice-1756300000-aaaaaaaa.m4a')
    && now.includes('voice-1756300001-bbbbbbbb.m4a'),
    now.slice(0, 300));

  /**
   * Two recordings made on one day, and what the control is called.
   *
   * `recordedAt` is the moment the recording landed, so a contractor who walks
   * a room and speaks four times gets four buttons with the SAME accessible
   * name. Measured here rather than assumed: the names are read off the two
   * controls and compared. Anybody listening to this screen rather than looking
   * at it is offered the same sentence twice, and the fix is in
   * scratchpad/integration/drive-last.md.
   */
  await recordOne('voice-1756300002-cccccccc.m4a', 9_000, 'the sill is soft under the window');
  const names = [];
  for (const control of await wall.getByRole('button', { name: /^Take off the recording from / }).all()) {
    names.push(await control.getAttribute('aria-label'));
  }
  check('two recordings on one wall are two controls with two different names',
    new Set(names).size === names.length,
    `${names.length} controls and ${new Set(names).size} distinct name(s): ` +
      `${names.join(' | ')}. Voice.tsx names the control from the DAY the recording ` +
      'landed and a contractor records several in one walk, so every one of them is ' +
      'offered under the same sentence. The fix is in ' +
      'scratchpad/integration/drive-last.md.');

  check('recordings: no console or page errors', noise().length === 0, noise().join(' | '));
  await c.close();
  await b.close();
}

/* ==========================================================================
   7. `Close the photograph` — one of the walk's own frames, filling the phone.
   ========================================================================== */

{
  /**
   * A walk of a real room, from the real room's own wall transforms.
   *
   * Somebody standing back from each wall and shooting it twice, 1.5 m up, the
   * phone held upright. The poses are built here because `photosOfWall` places
   * a photograph against a wall by projecting its camera frustum onto the plan
   * — there is no way to hand the app a photograph of a wall without telling it
   * where the camera stood. It is the same walk `a37-scanphotos` builds, cut to
   * two frames a wall because this section is about one control.
   */
  const scan = JSON.parse(readFileSync(`${SP}/kitchen.json`, 'utf8'));
  const col = (m, c) => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const unit = (a) => {
    const length = Math.hypot(a[0], a[1], a[2]);
    return [a[0] / length, a[1] / length, a[2] / length];
  };

  const centres = scan.walls.map((w) => col(w.transform, 3));
  const middle = centres.reduce((sum, c) => add(sum, c), [0, 0, 0]).map((v) => v / centres.length);
  const floorY = col(scan.floors[0].transform, 3)[1];
  const UP = [0, 1, 0];
  const frames = [];
  scan.walls.forEach((wallOf, w) => {
    const along = unit(col(wallOf.transform, 0));
    for (let k = 0; k < 2; k += 1) {
      const aim = add(centres[w], mul(along, (k - 0.5) * wallOf.dimensions[0] * 0.4));
      const inward = sub(middle, aim);
      const reach = Math.hypot(inward[0], inward[2]);
      const stand = add(aim, mul(unit([inward[0], 0, inward[2]]), Math.min(1.6, reach * 0.6)));
      const eye = [stand[0], floorY + 1.5, stand[2]];
      const target = [aim[0], floorY + 1.35, aim[2]];
      const forward = unit(sub(target, eye));
      const upInImage = unit(sub(UP, mul(forward, dot(forward, UP))));
      const rightInImage = unit(cross(forward, upInImage));
      // Portrait: the image's own X axis runs down the world.
      const X = mul(upInImage, -1);
      const Y = rightInImage;
      const Z = mul(forward, -1);
      const n = frames.length;
      frames.push({
        id: `f-${String(n).padStart(3, '0')}`,
        takenAt: new Date(Date.UTC(2026, 7, 19, 14, 0, n)).toISOString(),
        trigger: k === 0 ? 'manual' : 'automatic',
        fileName: `frame-${String(n).padStart(3, '0')}.jpg`,
        cameraPoseARFrame: [
          X[0], X[1], X[2], 0,
          Y[0], Y[1], Y[2], 0,
          Z[0], Z[1], Z[2], 0,
          eye[0], eye[1], eye[2], 1,
        ],
        intrinsics: [1450, 0, 960, 0, 1450, 720, 0, 0, 1],
        imageWidth: 1920,
        imageHeight: 1440,
        trackingQuality: 'normal',
      });
    }
  });

  /**
   * The app, opened the way the phone opens it, with the scan's folder
   * answering for the pictures.
   *
   * `openAsApp` cannot be used: `WallPhotos` builds every `src` as
   * `photos/<file>`, nothing serves that path here, and a route has to be on
   * the context before the page navigates. The same reason `a37` opens its own.
   */
  const b = await openChromium();
  const c = await b.newContext({ viewport: { width: 430, height: HEIGHT }, acceptDownloads: true });
  await c.route('**/photos/**', (route) =>
    route.fulfill({ path: `${SP}/damage-photo.jpg`, contentType: 'image/jpeg' })
  );
  const p = await c.newPage();
  const trouble = [];
  p.on('console', (m) => { if (m.type() === 'error') trouble.push('console: ' + m.text()); });
  p.on('pageerror', (e) => trouble.push('pageerror: ' + e.message));
  await p.addInitScript((parked) => {
    window.__sent = {};
    window.webkit = { messageHandlers: {} };
    for (const name of ['saved', 'thumbnail', 'company', 'photo', 'calendar', 'trouble', 'mark', 'draft', 'voice', 'haptic']) {
      window.__sent[name] = [];
      window.webkit.messageHandlers[name] = { postMessage(body) { window.__sent[name].push(body); } };
    }
    window.truelinePayload = parked;
  }, {
    subscribed: true,
    room: scan,
    photos: { schema: 'trueline.photos.v1', capturedAt: '2026-08-19T14:00:00Z', device: 'iPhone15,3', photos: frames },
    fileName: 'Kitchen',
  });
  await p.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await p.waitForSelector('body', { timeout: 60000 });
  await p.waitForTimeout(900);

  const wall = p.locator('[data-panel="plan"]');
  await section(p, 'Plan');
  await pick(p, /^Wall wall-1,/);
  await p.waitForTimeout(800);

  const thumbs = wall.getByRole('button', { name: /^Photograph showing / });
  const howMany = await thumbs.count();
  check('the walk’s own photographs of this wall are on the wall’s panel',
    howMany >= 2, `${howMany} frames placed against wall-1`);

  const files = await wall
    .locator('button[aria-label^="Photograph showing "] img')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('src')));
  check('and each of them is its own file',
    new Set(files).size === files.length && files.length === howMany, files.join(', '));
  check('nothing is filling the phone before anything has been tapped',
    (await wall.getByRole('button', { name: 'Close the photograph' }).count()) === 0,
    'a photograph was open before one was opened');

  // The second one, so that "the one that was tapped" is a claim with a way of
  // being wrong. Opening the first and getting the first back proves nothing.
  await thumbs.nth(1).click();
  await p.waitForTimeout(500);
  const shut = wall.getByRole('button', { name: 'Close the photograph' });
  check('tapping one opens it, and the way out of it has a name',
    (await shut.count()) === 1, `${await shut.count()} ways out`);
  check('and the picture filling the phone is the one that was tapped, by its own file',
    (await shut.locator('img').getAttribute('src')) === files[1],
    `tapped ${files[1]}, showing ${await shut.locator('img').getAttribute('src')}`);

  await shut.click();
  await p.waitForTimeout(400);
  check('closing it puts the strip back, whole',
    (await wall.getByRole('button', { name: 'Close the photograph' }).count()) === 0
    && (await thumbs.count()) === howMany,
    `${await thumbs.count()} frames left of ${howMany}`);
  check('and it took no photograph off the scan',
    JSON.stringify(
      await wall.locator('button[aria-label^="Photograph showing "] img')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('src')))
    ) === JSON.stringify(files),
    files.join(', '));

  check('the walk’s photographs: no console or page errors', trouble.length === 0, trouble.join(' | '));
  await c.close();
  await b.close();
}

const bad = report('A54 — what is wrong with the wall, and the evidence on it');
process.exit(bad > 0 ? 1 : 0);
