import { readFileSync } from 'node:fs';
import { openChromium } from '../../core/tools/browser.mjs';
import { check, noise, openAsApp, payingBrowser, pick, report, reportEvenIfItDies, section, sentTo, SP, URL } from './lib.mjs';

// Say what was learned even if this part dies part way through.
reportEvenIfItDies('A22 — what was said, and what was marked');

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

/**
 * Fill a box and make sure it took.
 *
 * These inputs are controlled by React, and a `fill` landing in the same frame
 * as the re-render that opened the form is occasionally swallowed: the value
 * goes in, the component re-renders from state that has not caught up, and the
 * box comes back empty or holding what it held before. It failed here once in
 * about four runs and produced a mark five feet wide where nine was typed,
 * which reads as a bug in the app and is not one. Filling and then reading the
 * box back is the whole fix.
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
// The three boxes were "from", "to" and "up to" when this was written, and are
// now where it starts, how wide it is and how high it goes -- the same mark
// described the way somebody holds a tape rather than the way a rectangle is
// stored. 4 and 13 became 4 and 9, which is the same nine feet of wall: the
// check below still reads "9' along wall-1".
await type(page, 'How far from the corner it starts', '4');
await type(page, 'How wide it is', '9');
await type(page, 'How high up the wall it goes', `2'`);
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
/*
 * The heading, as `core/src/fieldlist.ts` writes it.
 *
 * It was `MARKED ON THESE WALLS` and became `MARKED IN THIS ROOM — N` when the
 * ceiling became markable, because a mark on a ceiling is not on a wall. This
 * part was not updated with it, so it went red on the heading and then read the
 * two checks under it off `indexOf(...) === -1` -- `slice(-1)` is the last
 * character of the sheet, which contains no quantity and passes for ever.
 *
 * Named once, here, so a third rename fails one check rather than silently
 * turning two of them off.
 */
const MARKS_HEAD = 'MARKED IN THIS ROOM';
check('the condition note is on the sheet somebody carries',
  new RegExp(`${MARKS_HEAD} — \\d+`).test(sheet), sheet.slice(0, 400));
check('and the heading it is filed under is really on the sheet, not missing',
  sheet.indexOf(MARKS_HEAD) >= 0 && sheet.indexOf('SAID ABOUT THESE WALLS') >= 0,
  `${MARKS_HEAD} at ${sheet.indexOf(MARKS_HEAD)}, ` +
    `SAID ABOUT THESE WALLS at ${sheet.indexOf('SAID ABOUT THESE WALLS')}`);
check('with what it is and where, in the words that were typed',
  /wall-1 — rot/.test(sheet) && /sill plate is soft here/.test(sheet),
  sheet.slice(sheet.indexOf('MARKED'), sheet.indexOf('MARKED') + 400));
check('and what was said out loud about the wall',
  /SAID ABOUT THESE WALLS/.test(sheet) && /R-13 behind it/.test(sheet),
  sheet.slice(sheet.indexOf('SAID ABOUT'), sheet.indexOf('SAID ABOUT') + 400));
check('and no quantity anywhere on it',
  sheet.indexOf(MARKS_HEAD) >= 0 && !/sq ft/.test(sheet.slice(sheet.indexOf(MARKS_HEAD))),
  sheet.slice(sheet.indexOf(MARKS_HEAD), sheet.indexOf(MARKS_HEAD) + 500));

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
await type(page, 'How far from the corner it starts', '0');
await type(page, 'How wide it is', '9');
await type(page, 'How high up the wall it goes', `2'`);
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


/* ========================================================================
   7. The transcript, at the length somebody actually talks for, on a phone.

   ## The complaint

       "THE TRANSCRIBING IS IN A TEXT BOX AND YOU HAVE TO SCROLL AND CANT SEE
        EVERYTHING."

   with a recording that came back as *"There was just a lot of mold and mildew
   and garbage on the wall so I got rid of it and now we're gonna replace it
   with another drywall piece and"* -- cut off mid-sentence in a three-line box.

   That transcript is the artefact he opens six weeks later to remember what he
   said, and it was being served three lines at a time behind a scrollbar
   halfway down a scrolling page. Everything above in this part checks that the
   words are RIGHT. This checks that they can be READ.

   ## Why this opens its own browser

   Same reason as `a21-tour`: the shared harness opens 430 x 1600, and 1600 is
   not a phone. In a window that tall the page barely scrolls, so no check about
   whether a box is hiding the end of a sentence can fail in it. This opens
   430 x 800 and leaves `lib.mjs` alone.

   The sentence used is his, in full, from the recording in the complaint --
   including the words that are the whole reason this box stays editable rather
   than becoming a paragraph: jamb, kerf, R-13.
   ======================================================================== */

{
  const HIS = 'There was just a lot of mold and mildew and garbage on the wall so I got rid '
    + 'of it and now we’re gonna replace it with another drywall piece and I had to cut the '
    + 'jamb back about a quarter inch to get it to sit flat, so the trim is off by a kerf on '
    + 'the left side, and behind all of it there is R-13 that got soaked through and that is '
    + 'coming out too before anything goes back on.';

  const browser = await openChromium();
  const ctx2 = await browser.newContext({ viewport: { width: 430, height: 800 } });
  // A paying contractor's browser, the way `open()` makes one. See `payingBrowser`.
  await payingBrowser(ctx2);
  const phone = await ctx2.newPage();
  const shouted = [];
  phone.on('console', (m) => { if (m.type() === 'error') shouted.push('console: ' + m.text()); });
  phone.on('pageerror', (e) => shouted.push('pageerror: ' + e.message));
  await phone.addInitScript((parked) => {
    window.__sent = {};
    window.webkit = { messageHandlers: {} };
    for (const name of ['saved', 'thumbnail', 'company', 'photo', 'calendar', 'trouble',
      'mark', 'draft', 'voice', 'haptic']) {
      window.__sent[name] = [];
      window.webkit.messageHandlers[name] = {
        postMessage(body) { window.__sent[name].push(body); },
      };
    }
    window.truelinePayload = parked;
  }, room({ recordable: true, transcribes: true }));
  await phone.goto(URL, { waitUntil: 'networkidle' });
  await phone.waitForTimeout(700);

  await section(phone, 'Plan');
  await pick(phone, /^Wall wall-1,/);
  await phone.waitForTimeout(300);

  await phone.getByRole('button', { name: 'Record a note' }).click();
  await phone.waitForTimeout(300);
  const which = (await sentTo(phone, 'voice')).at(-1)?.id;
  await phone.evaluate((it) => window.trueline.heard(it, { started: true }), which);
  await phone.getByRole('button', { name: /^Stop/ }).click();
  await phone.waitForTimeout(200);
  await phone.evaluate(
    (it) => window.trueline.heard(it, {
      kept: { fileName: 'voice-1756300009-77778888.m4a', milliseconds: 74_000 },
    }),
    which
  );
  await phone.waitForTimeout(300);
  await phone.evaluate(
    ([it, said]) => window.trueline.heard(it, { transcript: said }), [which, HIS]);
  await phone.waitForTimeout(500);

  /**
   * The box, measured rather than described.
   *
   * `hidden` is the whole complaint as one number: how many pixels of what
   * somebody said are inside the element and not on the screen. On a `rows={2}`
   * textarea holding a minute of talking it is around a hundred and ten.
   */
  const box = () => phone.evaluate(() => {
    const el = document.querySelector('textarea[aria-label="What was said, as text"]');
    if (!el) return null;
    const style = getComputedStyle(el);
    const fixed = [];
    for (let up = el.parentElement; up && up !== document.body; up = up.parentElement) {
      const how = getComputedStyle(up).position;
      if (how === 'fixed' || how === 'sticky') fixed.push(`${up.tagName}:${how}`);
    }
    return {
      height: Math.round(el.getBoundingClientRect().height),
      hidden: el.scrollHeight - el.clientHeight,
      inside: el.scrollTop,
      overflow: style.overflowY,
      resize: style.resize,
      room: Number.parseFloat(style.scrollMarginBottom),
      line: Number.parseFloat(style.lineHeight),
      words: el.value.length,
      fixed,
      page: document.documentElement.scrollHeight > window.innerHeight,
    };
  });

  const one = await box();
  check('the transcript is in a box on the screen at all', one !== null);
  check('and it arrives marked as the phone’s, before anybody has read it',
    /Written by this phone/.test(await phone.locator('[data-panel="plan"]').innerText()));
  check('and not one pixel of what he said is hidden inside it',
    one.hidden === 0, `${one.hidden}px of the transcript is inside the box and not on screen`);
  check('and the box is as tall as the words rather than three lines tall',
    one.height >= one.line * 5, `${one.height}px, one line is ${one.line}px`);
  check('the whole of it is there to read',
    one.words === HIS.length, `${one.words} of ${HIS.length} characters`);
  check('there is no scrollbar in it to find',
    one.overflow === 'hidden', one.overflow);
  check('and no drag handle that could only make it wrong',
    one.resize === 'none', one.resize);

  // The other half of "you have to scroll": what somebody scrolls should be the
  // page, the way they scroll everything else on this screen.
  await phone.evaluate(() => {
    const el = document.querySelector('textarea[aria-label="What was said, as text"]');
    el.scrollTop = 400;
  });
  const still = await box();
  check('and nothing scrolls inside it when you try', still.inside === 0, String(still.inside));
  check('the page is what scrolls instead', still.page);

  // The keyboard. It covers the bottom of the window, and a browser asked to
  // put a focused field "in view" will happily put it against the top of the
  // keys. Two things keep the line being corrected above them: room asked for
  // underneath the box, and the box being in the ordinary flow of the page
  // rather than pinned to an edge the keyboard is about to cover.
  check('there is room asked for under the box, for the on-screen keyboard',
    still.room >= 64, `scroll-margin-bottom is ${still.room}px`);
  check('and nothing between it and the page is pinned to an edge',
    still.fixed.length === 0, still.fixed.join(', '));

  await phone.getByLabel('What was said, as text').first().click();
  await phone.waitForTimeout(200);
  check('it is still a box somebody can type in — the phone gets jamb and R-13 wrong',
    await phone.evaluate(() =>
      document.activeElement?.getAttribute('aria-label') === 'What was said, as text'));

  /* ---- A long one. Ten minutes of a walk-round is not an edge case. ---- */

  const LONG = `${HIS} `.repeat(6).trim();
  await phone.getByLabel('What was said, as text').first().fill(LONG);
  await phone.waitForTimeout(400);
  const big = await box();
  check('a very long recording is shown in full as well',
    big.hidden === 0 && big.words === LONG.length,
    `${big.hidden}px hidden, ${big.words} of ${LONG.length} characters`);
  check('and the box grew with it rather than putting the scrollbar back',
    big.height > one.height * 3, `${big.height}px against ${one.height}px`);

  // Growing the box must not move the page under somebody's thumb. Measuring
  // the words means clearing the height for one frame, which shortens the
  // document; a browser scrolled near the bottom clamps its scroll position to
  // the shorter document and does not put it back. So: sit at the bottom, make
  // the box re-measure without touching the caret, and the page must not move.
  await phone.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await phone.waitForTimeout(400);
  const wasAt = await phone.evaluate(() => Math.round(window.scrollY));
  await phone.evaluate(() => {
    const el = document.querySelector('textarea[aria-label="What was said, as text"]');
    const put = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    put.call(el, `${el.value} on.`);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await phone.waitForTimeout(400);
  const nowAt = await phone.evaluate(() => Math.round(window.scrollY));
  check('and re-measuring it does not walk the page up the screen',
    Math.abs(nowAt - wasAt) <= 4, `page moved from ${wasAt} to ${nowAt}`);

  /* ---- Back down, and back again after leaving the screen. ---- */

  await phone.getByLabel('What was said, as text').first().fill('mould on wall three');
  await phone.waitForTimeout(400);
  const small = await box();
  check('cutting it back down shrinks the box again',
    small.height < one.height && small.hidden === 0, `${small.height}px, ${small.hidden}px hidden`);

  // A textarea measured while its panel is `hidden` has a scrollHeight of zero,
  // and a box fitted to zero stays flat: the words have not changed, so nothing
  // would ever measure it again. This is that round trip.
  await section(phone, 'Takeoff');
  await phone.waitForTimeout(300);
  await section(phone, 'Plan');
  await phone.waitForTimeout(500);
  await phone.getByLabel('What was said, as text').first().fill(HIS);
  await phone.waitForTimeout(400);
  const again = await box();
  check('and it is still the right height after leaving this screen and coming back',
    again.hidden === 0 && again.height >= one.line * 5,
    `${again.height}px, ${again.hidden}px hidden`);

  // Correcting it is still what the box is for. This is the rule part 2 checks,
  // on the screen size where the box has just changed shape -- a box that grew
  // beautifully and stopped saving what was typed in it would be a worse bug
  // than the one being fixed.
  await phone.getByLabel('What was said, as text').first()
    .fill(HIS.replace('R-13', 'R-13 batt'));
  await phone.getByLabel('What was said, as text').first().blur();
  await phone.waitForTimeout(500);
  const wall = await phone.locator('[data-panel="plan"]').innerText();
  check('typing in the taller box still makes the words theirs',
    !/Written by this phone/.test(wall), wall.slice(0, 500));
  check('and the recording is untouched by any of it',
    (await phone.locator('audio[src=\"voice/voice-1756300009-77778888.m4a\"]').count()) === 1);
  const written = (await sentTo(phone, 'saved')).at(-1)?.project ?? '';
  check('and every word of the corrected transcript is in what the app was given to keep',
    written.includes('R-13 batt') && written.includes('mold and mildew'),
    written.slice(0, 200));

  check('the transcript on a phone: no console or page errors', shouted.length === 0,
    shouted.join(' | '));
  await browser.close();
}

check('marks: no console or page errors', noise().length === 0, noise().join(' | '));
await ctx.close();

process.exit(report('A22 — what was said, and what was marked') === 0 ? 0 : 1);
