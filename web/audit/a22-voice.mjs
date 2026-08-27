import { readFileSync } from 'node:fs';
import { check, noise, openAsApp, pick, report, section, sentTo, SP } from './lib.mjs';

/**
 * Talking at a wall, and marking one on a job nobody is claiming for.
 *
 * Two features, one part, because they are the same screen: a mark is what
 * somebody found, and a recording is them saying why it matters. What is checked
 * here is every property that decides whether either is trustworthy.
 *
 * **Nothing is offered where the phone cannot do it.** Not greyed, not
 * explained — absent, along with every word about it. A browser and an older
 * iPhone see exactly the screens they always saw. The same rule `a20-drafts`
 * checks for the model, and the same reason: somebody who cannot have a feature
 * should never learn it exists.
 *
 * **The recording survives everything.** It reaches the room before a word is
 * transcribed, so a recogniser that is missing, refused or slow costs a
 * transcript and never somebody's own voice.
 *
 * **A transcript is marked until a person has read it.** A contractor's
 * vocabulary is where a recogniser slips, so the words can be corrected — and
 * the moment somebody types in the box it stops being the phone's sentence and
 * becomes theirs.
 *
 * **A condition note prices nothing.** On a job with no claim on it a mark
 * carries no area anywhere a person can see, no cut height and no drying curve,
 * and it lands on the field sheet, which is the sheet somebody actually carries.
 *
 * Neither the microphone nor the recogniser is exercised — there is no iPhone in
 * a Linux container. What is exercised is every line of the path up to them:
 * what appears, what does not, what is sent, and what happens to each answer.
 */

const kitchen = JSON.parse(readFileSync(`${SP}/kitchen.json`, 'utf8'));
const room = (extra) => ({ subscribed: true, room: kitchen, fileName: 'Kitchen', ...extra });

/** The wall panel opens by picking a wall on the drawing. */
async function openAWall(page) {
  await section(page, 'Plan');
  await pick(page, /^Wall wall-1,/);
  await page.waitForTimeout(200);
}

/** The last thing the page asked the app to do about a recording. */
async function lastAsk(page) {
  return (await sentTo(page, 'voice')).at(-1) ?? {};
}

/* ========================================================================
   1. A phone that cannot record is offered nothing, and told nothing.
   ======================================================================== */

{
  // `recordable` absent is what an older build hands over, and what the Floor
  // and Business tabs hand over on every build: no room open, nowhere to write.
  const { ctx, page } = await openAsApp(room({}), {});
  await openAWall(page);
  const panel = await page.locator('[data-panel="plan"]').innerText();

  check('no Record button where the phone cannot record',
    (await page.getByRole('button', { name: /^Record/ }).count()) === 0, panel.slice(0, 400));
  check('and not a word about recordings or transcripts either',
    !/recording|transcript|Say what is wrong/i.test(panel), panel.slice(0, 600));
  // The wall panel is otherwise exactly the screen it has always been.
  check('the wall still shows its tape box and everything else it always had',
    /Put a tape on it/.test(panel) && /Change this wall/.test(panel), panel.slice(0, 600));

  check('a quiet phone: no console or page errors', noise().length === 0, noise().join(' | '));
  await ctx.close();
}

/* ========================================================================
   2. A phone that can. The recording lands first, the words land after.
   ======================================================================== */

const { ctx, page } = await openAsApp(room({ recordable: true, transcribes: true }), {});
await openAWall(page);

let panel = await page.locator('[data-panel="plan"]').innerText();
check('a phone that can record is offered it',
  (await page.getByRole('button', { name: 'Record a note' }).count()) === 1, panel.slice(0, 500));
check('and told, before talking, that this phone writes it down',
  /written down on this phone/.test(panel), panel.slice(0, 800));

await page.getByRole('button', { name: 'Record a note' }).click();
await page.waitForTimeout(300);

let ask = await lastAsk(page);
check('pressing it asks the app to start, and nothing else',
  ask.action === 'start' && typeof ask.id === 'string' && ask.id !== '', JSON.stringify(ask));
check('no file name, no folder and no instruction goes across',
  Object.keys(ask).sort().join(',') === 'action,id,version', Object.keys(ask).join(','));

const id = ask.id;
await page.evaluate((which) => window.trueline.heard(which, { started: true }), id);
await page.waitForTimeout(250);
check('once it is running there is a Stop button',
  (await page.getByRole('button', { name: /^Stop/ }).count()) === 1);

await page.getByRole('button', { name: /^Stop/ }).click();
await page.waitForTimeout(250);
ask = await lastAsk(page);
check('Stop asks the app to stop, on the same recording',
  ask.action === 'stop' && ask.id === id, JSON.stringify(ask));

// The recording, on its own, before any transcription has been attempted.
await page.evaluate(
  (which) =>
    window.trueline.heard(which, {
      kept: { fileName: 'voice-1756300000-ab12cd34.m4a', milliseconds: 14_200 },
    }),
  id
);
await page.waitForTimeout(300);
panel = await page.locator('[data-panel="plan"]').innerText();
check('the recording is in the room before a word has been written down',
  /1 recording/.test(panel), panel.slice(0, 700));
check('and it says how long it runs, rounded down', /0:14/.test(panel), panel.slice(0, 700));
check('with a player pointed at the scan’s own folder',
  (await page.locator('audio[src="voice/voice-1756300000-ab12cd34.m4a"]').count()) === 1);

// And the words, a moment later.
await page.evaluate(
  (which) => window.trueline.heard(which, { transcript: 'the jamb is split at the top' }),
  id
);
await page.waitForTimeout(300);
const said = page.getByLabel('What was said, as text');
check('the words land in the box under the recording',
  (await said.inputValue()) === 'the jamb is split at the top', await said.inputValue());
panel = await page.locator('[data-panel="plan"]').innerText();
check('and are marked as the phone’s until somebody has read them',
  /Written by this phone/.test(panel), panel.slice(0, 900));

// Correcting it. This is the whole reason the text is editable: a recogniser
// hears "gym" for "jamb", and what goes on a sheet has to be the contractor's
// own sentence.
await said.fill('the jamb is split at the top — R-13 behind it');
await said.blur();
await page.waitForTimeout(400);
panel = await page.locator('[data-panel="plan"]').innerText();
check('typing in it makes it theirs, and the phone’s mark goes',
  !/Written by this phone/.test(panel), panel.slice(0, 900));
check('and the recording itself is untouched — it still plays',
  (await page.locator('audio[src="voice/voice-1756300000-ab12cd34.m4a"]').count()) === 1);

// It has to survive the app being closed, which means it has to be in the
// project the app was handed to write into the scan's folder.
const saves = await sentTo(page, 'saved');
const savedNow = saves.at(-1)?.project ?? '';
check('the recording and its words are in what the app was given to keep',
  savedNow.includes('voice-1756300000-ab12cd34.m4a') && savedNow.includes('R-13 behind it'),
  savedNow.slice(0, 200));

check('recording: no console or page errors', noise().length === 0, noise().join(' | '));

/* ========================================================================
   3. A phone that records but cannot write it down.
   ======================================================================== */

{
  const quiet = await openAsApp(room({ recordable: true }), {});
  await openAWall(quiet.page);
  let text = await quiet.page.locator('[data-panel="plan"]').innerText();
  check('a phone with no transcription says so before anybody talks',
    /cannot write it down/.test(text), text.slice(0, 800));
  check('and still offers to record, because the recording is the record',
    (await quiet.page.getByRole('button', { name: 'Record a note' }).count()) === 1);

  await quiet.page.getByRole('button', { name: 'Record a note' }).click();
  await quiet.page.waitForTimeout(250);
  const which = (await lastAsk(quiet.page)).id;
  await quiet.page.evaluate((it) => window.trueline.heard(it, { started: true }), which);
  await quiet.page.getByRole('button', { name: /^Stop/ }).click();
  await quiet.page.waitForTimeout(200);
  await quiet.page.evaluate(
    (it) =>
      window.trueline.heard(it, {
        kept: { fileName: 'voice-1756300001-ffffffff.m4a', milliseconds: 6_000 },
        noTranscript: 'this phone has no on-device model for its language.',
      }),
    which
  );
  await quiet.page.waitForTimeout(300);
  text = await quiet.page.locator('[data-panel="plan"]').innerText();
  check('the recording is kept anyway', /1 recording/.test(text) && /0:06/.test(text),
    text.slice(0, 800));
  check('and the screen says plainly why there is no transcript',
    /No transcript — this phone has no on-device model/.test(text), text.slice(0, 900));
  check('with an empty box somebody can type into themselves',
    (await quiet.page.getByLabel('What was said, as text').inputValue()) === '');

  check('no transcription: no console or page errors', noise().length === 0, noise().join(' | '));
  await quiet.ctx.close();
}

/* ========================================================================
   4. A refused microphone. Never a dead button.
   ======================================================================== */

{
  const no = await openAsApp(room({ recordable: true, transcribes: true }), {});
  await openAWall(no.page);
  await no.page.getByRole('button', { name: 'Record a note' }).click();
  await no.page.waitForTimeout(200);
  const which = (await lastAsk(no.page)).id;
  await no.page.evaluate(
    (it) =>
      window.trueline.heard(it, {
        refused:
          'Trueline is not allowed to use the microphone, so nothing was recorded. ' +
          'Settings › Trueline › Microphone turns it back on.',
      }),
    which
  );
  await no.page.waitForTimeout(300);
  const text = await no.page.locator('[data-panel="plan"]').innerText();
  check('a refusal is a sentence somebody can act on', /Settings › Trueline › Microphone/.test(text),
    text.slice(0, 900));
  check('the button comes back rather than staying stuck on Starting',
    (await no.page.getByRole('button', { name: 'Record a note' }).count()) === 1);
  check('and nothing was added to the room',
    !/1 recording/.test(text), text.slice(0, 700));
  check('while the rest of the wall panel goes on working',
    /Change this wall/.test(text), text.slice(0, 500));

  check('a refusal: no console or page errors', noise().length === 0, noise().join(' | '));
  await no.ctx.close();
}

/* ========================================================================
   5. A mark on a job nobody is claiming for.
   ======================================================================== */

await openAWall(page);
panel = await page.locator('[data-panel="plan"]').innerText();
check('marking is there with no claim on the job at all',
  /Nothing marked on this wall/.test(panel), panel.slice(0, 700));
check('and it is described as what it is on this job — a note, not a loss',
  /on the sheet you carry and on nothing you price/.test(panel), panel.slice(0, 900));

await page.getByRole('button', { name: '+ part of this wall' }).click();
await page.waitForTimeout(200);
panel = await page.locator('[data-panel="plan"]').innerText();
check('the words offered are conditions, not causes of loss',
  /Out of plumb/.test(panel) && /Rot/.test(panel), panel.slice(0, 800));
check('and no cause-of-loss word is on the screen',
  !/\bWater\b/.test(panel) && !/\bSmoke\b/.test(panel), panel.slice(0, 800));

await page.getByRole('button', { name: 'Rot', exact: true }).click();
await page.getByPlaceholder('sill plate is soft under the window').fill('sill plate is soft here');
await page.getByLabel('From along the wall').fill('4');
await page.getByLabel('To along the wall').fill('13');
await page.getByLabel('How high the damage reaches').fill(`2'`);
await page.getByRole('button', { name: 'Mark it' }).click();
await page.waitForTimeout(400);

let marks = await page.locator('[data-marks]').innerText();
check('the mark is on the wall', /1 mark on this wall/.test(marks), marks.slice(0, 700));
check('and carries no area, because noticing rot is not buying its removal',
  !/sq ft/.test(marks), marks.slice(0, 900));

await page.getByRole('button', { name: /Open$/ }).first().click();
await page.waitForTimeout(250);
marks = await page.locator('[data-marks]').innerText();
check('it still knows exactly where it is — the wall is measured either way',
  /9' along wall-1/.test(marks), marks.slice(0, 1000));
check('no cut height is offered, because nobody is tearing this out',
  !/Cut to/.test(marks), marks.slice(0, 1000));
check('and no drying curve, which is a water-claim instrument',
  !/Moisture readings/.test(marks), marks.slice(0, 1000));
check('a mark can be talked at too',
  (await page.getByRole('button', { name: /^Record/ }).count()) >= 1);

/* -------------------------------------------------- and onto the sheet */

await section(page, 'Files');
await page.waitForTimeout(300);
const carried = page
  .locator('section', { has: page.getByRole('heading', { name: 'Take this list with you' }) })
  .first();
check('the sheet says the marks are on it too',
  /Everything marked on these walls is on it too/.test(await carried.innerText()),
  (await carried.innerText()).slice(0, 400));
// The list itself is in the document whether or not it is expanded, so that
// printing works either way -- but `innerText` only reads what is showing.
await carried.getByRole('button', { name: 'Show' }).click();
await page.waitForTimeout(200);
const sheet = await carried.locator('pre').innerText();
check('the condition note is on the sheet somebody carries',
  /MARKED ON THESE WALLS/.test(sheet), sheet.slice(0, 400));
check('with what it is and where, in the words that were typed',
  /wall-1 — rot/.test(sheet) && /sill plate is soft here/.test(sheet),
  sheet.slice(sheet.indexOf('MARKED'), sheet.indexOf('MARKED') + 400));
check('and what was said out loud about the wall',
  /SAID ABOUT THESE WALLS/.test(sheet) && /R-13 behind it/.test(sheet),
  sheet.slice(sheet.indexOf('SAID ABOUT'), sheet.indexOf('SAID ABOUT') + 400));
check('and no quantity anywhere on it',
  !/sq ft/.test(sheet.slice(sheet.indexOf('MARKED ON THESE WALLS'))),
  sheet.slice(sheet.indexOf('MARKED ON THESE WALLS'), sheet.indexOf('MARKED ON THESE WALLS') + 500));

/* ========================================================================
   6. The same room, once it becomes a claim.
   ======================================================================== */

await section(page, 'Insurance');
const on = page.getByRole('button', { name: 'Turn it on' });
if (await on.count()) { await on.click(); await page.waitForTimeout(300); }

await openAWall(page);
marks = await page.locator('[data-marks]').innerText();
check('the mark somebody already made is still exactly where it was',
  /1 mark on this wall/.test(marks), marks.slice(0, 700));
// Turning insurance on does NOT turn a condition note into a loss. `losses()`
// keeps rot off every insurance screen, so an area shown for it here would be
// a figure promising work that will never appear on the claim.
check('and the rot still carries no area, because it will never reach the claim',
  !/sq ft/.test(marks), marks.slice(0, 900));

await page.getByRole('button', { name: '+ damaged area' }).click();
await page.waitForTimeout(200);
panel = await page.locator('[data-panel="plan"]').innerText();
check('and the words offered are causes of loss',
  /Water/.test(panel) && /Smoke/.test(panel), panel.slice(0, 800));

// A real loss on the same wall, which is the half that does price.
await page.getByRole('button', { name: 'Water', exact: true }).click();
await page.getByPlaceholder('water line along the bottom of the wall')
  .fill('supply line let go overnight');
await page.getByLabel('From along the wall').fill('0');
await page.getByLabel('To along the wall').fill('9');
await page.getByLabel('How high the damage reaches').fill(`2'`);
await page.getByRole('button', { name: 'Mark it' }).click();
await page.waitForTimeout(400);
marks = await page.locator('[data-marks]').innerText();
check('a loss on the same wall does show what it takes',
  /sq ft/.test(marks), marks.slice(0, 900));
check('with both marks side by side on one wall',
  /2 marks on this wall/.test(marks), marks.slice(0, 900));

// The one thing that must never happen: a condition note somebody wrote on an
// ordinary job turning into a line on an insurer's estimate.
await section(page, 'Insurance');
await page.waitForTimeout(400);
const claim = await page.locator('[data-panel="claim"]').innerText();
check('the condition note is NOT on the insurance screens',
  !/sill plate is soft here/.test(claim), claim.slice(0, 900));
check('and neither is the word that made it a condition',
  !/\brot\b/.test(claim), claim.slice(0, 1200));
// The other half of the same rule: the loss on that wall IS priced as tear-out,
// so the filter is doing its job rather than simply emptying the screen.
check('while the loss on the same wall prices as tear-out',
  /water damage/.test(claim) && /Remove wall board/.test(claim), claim.slice(0, 1400));

check('marks: no console or page errors', noise().length === 0, noise().join(' | '));
await ctx.close();

process.exit(report('A22 — what was said, and what was marked') === 0 ? 0 : 1);
