import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FREE, PAID, TITLE, WHAT_IT_DOES } from '../../core/src/entitlement.ts';
import { openChromium } from '../../core/tools/browser.mjs';
import { check, HEIGHT, noise, open, openAsApp, pick, report, reportEvenIfItDies, section, SECTIONS, SP, URL } from './lib.mjs';

// Say what was learned even if this part dies part way through.
reportEvenIfItDies('A52 — the browser version, with no phone under it');

/**
 * A52 — the browser version, driven with no phone under it.
 *
 * ## What this part is about
 *
 * These screens have always run in an ordinary browser: every other part of this
 * audit drives them in one, and the root deploy config has always published
 * `web/dist` as a static site with no backend. So the browser version was built.
 * What it did not do was **say so**. Somebody arriving with no iPhone met one
 * box — *"Open a scan · Drop the room.json from a RoomPlan export"* — and no way
 * to learn that they could draw the room by hand and then do every other thing
 * this app does.
 *
 * So the first half of this part is about **what a person is told**, which is
 * the only thing that was actually missing, and the second half is about the two
 * things that were missing underneath it:
 *
 *   - **A browser is not a filing cabinet.** Safari deletes everything a site
 *     has stored after seven days of browsing without a visit; any browser may
 *     clear it sooner under storage pressure. The app now asks to be exempted,
 *     reports what the browser answered rather than what it hoped, and nags for
 *     a file once there is work to lose — and is quiet before there is.
 *   - **A room could not leave the browser and could not come back.** Handed its
 *     own saved job through the file picker the app said *"The scan has no
 *     walls."* — a wrong sentence about a perfectly good file. Measured, before
 *     the change this part checks.
 *
 * ## `open()`, never `openAsApp()`
 *
 * Every check here runs on a page with no `webkit.messageHandlers` under it,
 * which is what `insideApp()` reads. One block uses `openAsApp` on purpose, to
 * check the front door is NOT in the way on a phone — where the app itself is
 * the answer to "what is this", and a page explaining that a LiDAR scan needs
 * an iPhone, on an iPhone, is noise.
 *
 * At the harness default, 430x800: whether a person can SEE the line that says
 * their room is nowhere is the whole question, and it cannot fail in a window
 * with no fold.
 *
 * ## What it does not do
 *
 * A1 already drives the empty state and the takeoff, and A3 already drives both
 * ways of drawing a room. Neither is repeated. What is checked here is the part
 * neither of them can see: that the whole path — draw, price, agree — is open
 * with no phone at all, and that the work can be got out of the browser again.
 */

/**
 * Presses a control, or says it was not there, and never throws.
 *
 * Takes the locator rather than a name, so that every control this part drives
 * is written out at the call site as `getByRole('button', { name: '...' })` —
 * which is what `core/tools/check-controls.py` reads. A helper that took the
 * name as a string hid three controls from it and added three findings.
 *
 * A49 states the rule this follows: a part that throws reports **nothing**, so
 * the one mutation a file exists to catch kills the run instead of turning it
 * red. Measured here — taking the job-file branch out of the picker left this
 * part with no room on screen, and it died on the first click of part 7 having
 * printed not one line about the eight checks that had already failed.
 */
async function press(control) {
  if ((await control.count()) === 0) return false;
  try {
    await control.first().click({ timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/* ========================================================================== */
/*  1. What a browser visitor is told                                         */
/* ========================================================================== */

{
  const { browser, page } = await open();
  const first = await page.locator('body').innerText();

  check('the front door says a room can be drawn by hand here',
    /Draw a room by hand/.test(first) && /tap its corners/i.test(first), first.slice(0, 400));
  check('and typed in wall by wall from readings you already have',
    /type it in wall by wall/i.test(first), first.slice(0, 600));
  check('and that a scan you already have opens here',
    /room\.json/.test(first) && /RoomPlan export/.test(first), first.slice(0, 600));
  check('and that a job file somebody sent you opens here',
    /Trueline job file/.test(first), first.slice(0, 800));

  // What the front door says is free and what it says is paid is checked in
  // part 8, against `entitlement.ts` itself, so it cannot be listed twice.

  check('it says what needs the iPhone: the LiDAR scan',
    /LiDAR scan/.test(first), first.slice(0, 1200));
  check('and why, rather than just that it does',
    /depth sensor/.test(first) && /no way to fake one/.test(first), first.slice(0, 1400));
  check('and that a mark pinned during a capture needs the phone too',
    /pinned during a capture/i.test(first) && /capture running underneath/.test(first),
    first.slice(0, 1600));
  check('and it says what you can do instead of that one',
    /mark the same damage here afterwards/i.test(first), first.slice(0, 1600));

  check('the promise is there: nothing is uploaded',
    /Nothing is uploaded/.test(first), first.slice(0, 1800));
  check('and it says where the room actually is',
    /read in this browser and kept in this browser/.test(first), first.slice(0, 1800));
  check('and that there is no server and no account',
    /no Trueline server/.test(first) && /no account/.test(first), first.slice(0, 1800));

  /* --------------------------------- and the part it would be easier to skip */

  check('it does not stop at the promise — it says a browser may clear the work',
    /not a safe place to keep your work/i.test(first), first.slice(0, 2400));
  check('and it names the rule rather than waving at it',
    /seven days/.test(first) && /tracking-prevention/.test(first), first.slice(0, 2400));
  check('and it does not pretend the number is ours to promise',
    /exact number is Apple/.test(first), first.slice(0, 2400));
  check('and it names the other way storage goes: a machine short of space',
    /short of space/.test(first), first.slice(0, 2400));
  check('and it says what to do about it, in the imperative',
    /save the job file/i.test(first), first.slice(0, 2600));
  check('nothing on the front door calls a browser a safe place',
    !/\b(safely|backed up|your work is safe|a backup)\b/i.test(first),
    (first.match(/.{0,60}(safely|backed up|a backup).{0,60}/i) || [''])[0]);

  check('the front door: no console or page errors', noise().length === 0, noise().join(' | '));
  await browser.close();
}

/* ========================================================================== */
/*  2. And it is not in the way on a phone                                    */
/* ========================================================================== */

{
  const { browser, page } = await openAsApp({ subscribed: true });
  const inside = await page.locator('body').innerText();
  check('inside the app the front door is not drawn',
    !/Trueline, in your browser/.test(inside) && !/What needs the iPhone/.test(inside),
    inside.slice(0, 400));
  await browser.close();
}

/* ========================================================================== */
/*  3. Drawing a room by hand, end to end, with no phone                      */
/* ========================================================================== */

{
  const { browser, page } = await open();

  await page.getByRole('button', { name: /Draw it by hand|Draw the room/i }).click();
  await page.waitForTimeout(400);
  await page.getByLabel('What to call it').fill('browser shop');
  await page.getByRole('button', { name: 'Start drawing' }).click();
  await page.waitForTimeout(400);

  const board = page.locator('svg[role="application"]');
  const tap = async (fx, fy) => {
    const box = await board.boundingBox();
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    await page.waitForTimeout(240);
  };
  await tap(0.28, 0.70);
  await tap(0.72, 0.70);
  await tap(0.72, 0.34);
  await tap(0.28, 0.34);
  await board.locator('circle').first().click();
  await page.waitForTimeout(350);
  await page.getByRole('button', { name: 'Open it' }).click();
  await page.waitForTimeout(800);

  let t = await page.locator('body').innerText();
  check('a room drawn by hand opens, with no phone anywhere near it',
    /browser shop/.test(t), t.slice(0, 300));

  // The front door's own claim, checked: everything after the room is here.
  const shut = [];
  for (const name of SECTIONS) {
    try {
      await section(page, name);
    } catch {
      shut.push(name);
    }
  }
  check('every part of the room opens in a browser that has pasted a code',
    shut.length === 0, `would not open: ${shut.join(', ')}`);

  await section(page, 'Takeoff');
  t = await page.locator('body').innerText();
  check('the takeoff of a hand-drawn room carries real quantities',
    /\d+\.\d sq ft/.test(t), t.slice(0, 400));

  check('drawing end to end: no console or page errors', noise().length === 0, noise().join(' | '));
  await browser.close();
}

/* ========================================================================== */
/*  4. The nag — quiet before there is work, loud after                       */
/* ========================================================================== */

/** What the browser itself says about persistence, asked directly. */
const persistedIn = (page) =>
  page.evaluate(async () => {
    try {
      return (await navigator.storage.persisted()) === true;
    } catch {
      return false;
    }
  });

/**
 * What the keep-a-copy panel says, or nothing when it is not on the screen.
 *
 * Never throws. `innerText` on a locator that finds nothing does, and a part
 * that throws reports nothing at all — which is how the one mutation this file
 * exists to catch would kill the run instead of turning it red. Measured: with
 * the job-file branch taken out of the picker, this part died in part 6 having
 * printed not a line about it.
 */
const panelText = async (page) => {
  const panel = page.locator('[data-keep="job"]').first();
  return (await panel.count()) === 0 ? '' : panel.innerText();
};

/**
 * Opens the fold the persistence answer sits behind while nothing is at risk.
 *
 * It is folded on purpose: every line above the room is a line the room is
 * pushed down by, and with nothing in the room to lose there is nothing urgent
 * to say. It is drawn outright the moment the panel is nagging. This is a
 * person tapping the summary, which is the only way anybody reads it.
 */
async function openTheAnswer(page) {
  const fold = page.locator('[data-keep="job"] details', { hasText: 'said about keeping it' });
  if ((await fold.count()) === 0) return;
  await fold.first().locator('summary').click();
  await page.waitForTimeout(200);
}

let jobFileOnDisk = null;

{
  const { browser, ctx, page } = await open();
  await page.setInputFiles('input[type=file][accept="application/json,.json"]', `${SP}/garage.json`);
  await page.waitForTimeout(900);

  /* ------------------------------------------ nothing to lose, nothing said */

  let panel = await panelText(page);
  check('on a scan nobody has touched, the panel is quiet about losing work',
    /nothing here to lose/i.test(panel), panel.slice(0, 400));
  check('and there is no alarm, because there is nothing to be alarmed about',
    (await page.locator('[data-keep="alarm"]').count()) === 0);

  /* ------------------------------- the persistence answer, and whether it is true */

  const refusedHere = await persistedIn(page);
  check('the browser was asked to keep the storage and answered no',
    refusedHere === false, String(refusedHere));
  await openTheAnswer(page);
  panel = await panelText(page);
  check('and the screen reports that answer rather than a hopeful one',
    /said no/.test(panel) && !/agreed to keep/.test(panel), panel.slice(0, 600));
  check('and says what the answer means for this room',
    /may clear this room whenever it wants the space/.test(panel), panel.slice(0, 600));

  /* ------------------------------------------------- and now there is work */

  await pick(page, /^Wall wall-1,/);
  await page.getByRole('textbox', { name: 'the length of wall-1' }).fill(`20' 3"`);
  await page.getByRole('button', { name: 'Set the length of wall-1' }).click();
  await page.waitForTimeout(900);

  panel = await panelText(page);
  check('once a wall is measured, the room says it is in no file',
    /not in a file anywhere/i.test(
      panel + (await page.locator('[data-keep="alarm"]').first().innerText().catch(() => ''))),
    panel.slice(0, 400));
  check('and names the work rather than talking about storage',
    /1 wall you measured yourself/.test(panel), panel.slice(0, 400));
  check('and says this room has never been written to a file',
    /never been written to one/.test(panel), panel.slice(0, 500));

  const alert = page.locator('[data-keep="alarm"]').first();
  const isAlert = (await alert.count()) === 1
    && (await alert.getAttribute('role')) === 'alert';
  check('it is an alert, so it is announced rather than only drawn', isAlert, String(isAlert));

  // From the top of the room, which is where somebody arriving at it is. Taping
  // a wall scrolls the page down to the box being typed in.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  const box = isAlert ? await alert.boundingBox() : null;
  const window = page.viewportSize();
  check('the whole of it is on the screen the moment the room opens',
    box !== null && box.y >= 0 && box.y + box.height <= window.height,
    box === null ? 'there is no banner to see' : JSON.stringify({ box, window }));

  // And it gets OUT OF THE WAY. This is the opposite of what `a49` asks of the
  // banner about the phone, on purpose and for a measured reason: that one is
  // rare, this one is on for nearly every browser visitor who has done
  // anything, and made sticky it sat on top of the controls underneath and
  // broke six checks in `a24-change` — the change order could not be signed.
  // A warning that is almost always there and follows the screen down is not a
  // warning, it is an obstacle in front of the work.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);
  const after = isAlert ? await alert.boundingBox() : null;
  check('and scrolled away from, it is not left sitting on top of the work',
    after !== null && after.y + after.height <= 0,
    after === null ? 'there is no banner to see' : JSON.stringify({ after, window }));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);

  check('nothing in the panel calls browser storage safe, or a backup',
    !/\b(safely|safe place to keep|backed up|a backup|is safe)\b/i.test(panel),
    (panel.match(/.{0,60}(safely|backed up|a backup|is safe).{0,60}/i) || [''])[0]);
  check('and it never calls the room saved without saying where',
    !/\bsaved\b(?!.*(?:file|browser))/i.test(panel.replace(/Save the job file/g, '')),
    panel.slice(0, 600));

  /* ------------------------------------------------- writing the file quiets it */

  const saving = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Write the job to a file' }).click();
  const download = await saving;
  jobFileOnDisk = join(tmpdir(), 'a52-' + download.suggestedFilename());
  await download.saveAs(jobFileOnDisk);
  await page.waitForTimeout(900);

  check('the file is named after the room, not after the app',
    /garage/.test(download.suggestedFilename()), download.suggestedFilename());

  // The panel is in its other place now — quiet, and under the room rather than
  // over it. Same component, same words; `panelText` finds it either way.
  panel = await panelText(page);
  check('writing the file stops the nagging',
    (await page.locator('[data-keep="alarm"]').count()) === 0, panel.slice(0, 400));
  check('and the panel says where the work now is, in both places',
    /is in the job file you wrote/.test(panel) && /and in this browser/.test(panel),
    panel.slice(0, 500));

  /* ---------------------------------------------- and it comes back with new work */

  await pick(page, /^Wall wall-2,/);
  await page.getByRole('textbox', { name: 'the length of wall-2' }).fill(`21' 6"`);
  await page.getByRole('button', { name: 'Set the length of wall-2' }).click();
  await page.waitForTimeout(900);
  panel = await panelText(page);
  check('a second measurement brings the line straight back',
    (await page.locator('[data-keep="alarm"]').count()) === 1, panel.slice(0, 400));
  check('and it says the file it has is older than the screen',
    /older than what is on this screen/.test(panel), panel.slice(0, 600));

  check('the nag: no console or page errors', noise().length === 0, noise().join(' | '));
  await browser.close();
}

/* ========================================================================== */
/*  5. Both answers, and whether the screen reports the one it was given       */
/* ========================================================================== */

/**
 * A browser that answers the persistence question a given way, and remembers
 * being asked.
 *
 * ## Why the browser is the double here, and not the app
 *
 * The claim being checked is "whatever the browser says is what the screen
 * says", and it has two sides. Headless Chromium genuinely answers **no** — it
 * is checked against the real one above — but nothing this harness can do makes
 * it answer yes: `Browser.grantPermissions` with `durableStorage` is accepted
 * and leaves `navigator.permissions.query({name: "persistent-storage"})` at
 * `prompt`, and `persist()` still returns false. Measured, both ways round.
 *
 * So the browser is the thing replaced, and only the browser. Nothing in the
 * app is stubbed, mocked or told anything: it calls the same
 * `navigator.storage.persist()` it always calls and prints whatever comes back.
 * That is exactly the question — and it also lets the harness see **that the
 * call happened at all**, which no amount of reading the screen can prove.
 */
async function openSaying(answer) {
  const browser = await openChromium();
  const ctx = await browser.newContext({ viewport: { width: 430, height: HEIGHT } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.addInitScript((says) => {
    window.__askedToKeep = [];
    const fake = {
      persist: async () => {
        window.__askedToKeep.push('persist');
        return says;
      },
      persisted: async () => {
        window.__askedToKeep.push('persisted');
        return says;
      },
      estimate: async () => ({ quota: 0, usage: 0 }),
    };
    Object.defineProperty(navigator, 'storage', { get: () => fake, configurable: true });
  }, answer);
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('body', { timeout: 60000 });
  return { browser, page, errors };
}

for (const [answer, name] of [[true, 'a browser that agrees'], [false, 'a browser that refuses']]) {
  const { browser, page, errors } = await openSaying(answer);
  await page.setInputFiles('input[type=file][accept="application/json,.json"]', `${SP}/garage.json`);
  await page.waitForTimeout(900);

  const asked = await page.evaluate(() => window.__askedToKeep ?? []);
  check(`${name}: the app actually asks, rather than assuming`,
    asked.length > 0, JSON.stringify(asked));

  await openTheAnswer(page);
  const panel = await panelText(page);
  if (answer) {
    check(`${name}: the screen reports the yes it was given`,
      /agreed to keep/.test(panel) && !/said no/.test(panel), panel.slice(0, 600));
    check(`${name}: and still refuses to call it a promise`,
      /not a promise it made/.test(panel) && /can still be cleared/.test(panel),
      panel.slice(0, 600));
  } else {
    check(`${name}: the screen reports the no it was given`,
      /said no/.test(panel) && !/agreed to keep/.test(panel), panel.slice(0, 600));
    check(`${name}: and says what that means for this room`,
      /may clear this room whenever it wants the space/.test(panel), panel.slice(0, 600));
  }
  check(`${name}: no console or page errors`, errors.length === 0, errors.join(' | '));
  await browser.close();
}

/* ========================================================================== */
/*  6. A job file opens back                                                  */
/* ========================================================================== */

{
  check('a job file was written to disk to open back', jobFileOnDisk !== null,
    'nothing was saved in part 4, so there is nothing to open');

  const { browser, page } = await open();
  await page.setInputFiles('input[type=file][accept="application/json,.json"]', jobFileOnDisk);
  await page.waitForTimeout(1200);
  const t = await page.locator('body').innerText();

  // The exact sentence the app used to answer with. It is the regression.
  check('a fresh browser does not call its own job file a scan with no walls',
    !/The scan has no walls/.test(t), t.slice(0, 400));
  check('the job opens as the room it is', /garage/i.test(t), t.slice(0, 300));

  const walls = [];
  for (const l of await page.getByRole('button', { name: /^Wall / }).all()) {
    walls.push(await l.getAttribute('aria-label'));
  }
  check('and it comes back carrying the measurement that was in it',
    walls.some((l) => /20' 3"/.test(l || '')), walls.join(' | '));

  const panel = await panelText(page);
  check('and the browser it arrived in does not nag about work already in a file',
    /nothing here to lose|is in the job file/.test(panel) ||
      (await page.locator('[data-keep="alarm"]').count()) === 1,
    panel.slice(0, 400));

  check('opening a job file: no console or page errors', noise().length === 0, noise().join(' | '));
  await browser.close();
}

/* ========================================================================== */
/*  7. The link                                                               */
/* ========================================================================== */

/**
 * A job with photographs in it, written here rather than recorded.
 *
 * The poses are arithmetic, not a walk of a real room — what is being checked is
 * what the link refuses and why, not where a camera stood, and A37 is where a
 * real walk is driven. Every record is structurally what `photo.ts` describes,
 * including the tagged nanometres `persist.ts` writes, and every one of them
 * carries different digits so the deflate cannot collapse the lot into nothing
 * and make the length check meaningless.
 */
/** Half the horizontal field of a phone in portrait, in radians. */
const HALF_FIELD = 0.46;

function withPhotographs(project, count) {
  const job = JSON.parse(project);
  const nm = (v) => ({ $nm: String(BigInt(Math.round(v))) });
  const photos = [];
  for (let i = 0; i < count; i += 1) {
    const a = (i * 137.508 * Math.PI) / 180;
    const r = 300_000_000 + i * 4_137_119;
    const th = a + i * 0.017;
    photos.push({
      id: `frame-${String(i).padStart(4, '0')}-${((i * 2654435761) % 1e9).toString(36)}`,
      takenAt: new Date(Date.UTC(2026, 7, 19, 14, i % 60, (i * 7) % 60, (i * 137) % 1000)).toISOString(),
      trigger: i % 5 === 0 ? 'manual' : 'automatic',
      fileName: `frame-${String(i).padStart(4, '0')}.jpg`,
      upright: [0, 90, 180, 270][i % 4],
      // A real wedge, not four numbers that look like one: `photo.ts` refuses a
      // frustum whose edges are the wrong way round, and refuses it by throwing
      // -- which takes the whole page with it. So the edges are a proper
      // half-field either side of the heading, and only the heading and the
      // standing point move from photograph to photograph.
      pose: {
        at: { x: nm(r * Math.cos(a)), y: nm(r * Math.sin(a)) },
        forward: { x: nm(1_000_000 * Math.cos(th)), y: nm(1_000_000 * Math.sin(th)) },
        leftEdge: { x: nm(1_100_003 * Math.cos(th + HALF_FIELD)), y: nm(1_100_003 * Math.sin(th + HALF_FIELD)) },
        rightEdge: { x: nm(1_050_007 * Math.cos(th - HALF_FIELD)), y: nm(1_050_007 * Math.sin(th - HALF_FIELD)) },
      },
    });
  }
  return JSON.stringify({ ...job, extras: { ...job.extras, photos } });
}

let theLink = null;

{
  const { browser, page } = await open();
  await page.setInputFiles('input[type=file][accept="application/json,.json"]', jobFileOnDisk);
  await page.waitForTimeout(1000);

  const asked = await press(page.getByRole('button', { name: 'Make a link to this room' }));
  await page.waitForTimeout(600);
  check('a room opened from a job file offers to be put in a link', asked,
    'there was no "Make a link to this room" to press, so no room was open');

  const panel = asked ? await panelText(page) : '';
  check('a room with no photographs in it can be put in a link',
    /This link has a customer/.test(panel), panel.slice(0, 600));
  check('and the link says plainly that it holds a customer’s room',
    /has a customer’s room inside it/.test(panel), panel.slice(0, 800));
  check('and that anyone forwarded it has that room',
    /anyone who is forwarded the link has the room/.test(panel), panel.slice(0, 900));
  check('and it says not to put it in a group chat',
    /not into a group chat/.test(panel), panel.slice(0, 900));
  check('and it says why nothing is uploaded by it',
    /never sends to any server/.test(panel), panel.slice(0, 900));
  check('and that it carries no photographs',
    /carries no photographs/.test(panel), panel.slice(0, 1000));

  const box = page.getByRole('textbox', { name: 'The link to this room' });
  theLink = (await box.count()) === 1 ? await box.inputValue() : '';
  check('the link carries the room in the fragment, where a server never sees it',
    theLink.includes('#room=') && theLink.indexOf('#') < theLink.indexOf('room='),
    theLink.slice(0, 120));
  check('and it is short enough to be a link somebody sends',
    theLink.length < 8000, `${theLink.length} characters`);
  console.log(`link for a corrected garage: ${theLink.length} characters`);

  await press(page.getByRole('button', { name: 'Copy the link' }));
  await page.waitForTimeout(400);
  const afterCopy = await panelText(page);
  check('copying says what happened either way, rather than nothing',
    /on the clipboard|copy it by hand/.test(afterCopy), afterCopy.slice(0, 900));

  await press(page.getByRole('button', { name: 'Done with the link' }));
  await page.waitForTimeout(300);
  check('and the link can be put away again',
    !/has a customer’s room inside it/.test(await panelText(page)));

  await browser.close();
}

/* ------------------------------------------------ what the link refuses to do */

{
  const project = readFileSync(jobFileOnDisk, 'utf8');

  const few = join(tmpdir(), 'a52-eight-photographs.json');
  writeFileSync(few, withPhotographs(project, 8));
  const many = join(tmpdir(), 'a52-many-photographs.json');
  writeFileSync(many, withPhotographs(project, 120));

  const refusalFor = async (file) => {
    const { browser, page } = await open();
    await page.setInputFiles('input[type=file][accept="application/json,.json"]', file);
    await page.waitForTimeout(1200);
    await press(page.getByRole('button', { name: 'Make a link to this room' }));
    await page.waitForTimeout(700);
    const said = await panelText(page);
    const errors = noise().slice();
    await browser.close();
    return { said, errors };
  };

  const withEight = await refusalFor(few);
  check('a room with photographs in it is refused a link',
    /8 photographs/.test(withEight.said), withEight.said.slice(0, 900));
  check('and the refusal says why the pictures cannot travel',
    /never its bytes/.test(withEight.said) && /every photograph missing/.test(withEight.said),
    withEight.said.slice(0, 1000));
  check('and it says what to do instead',
    /Save the job file and send that instead/.test(withEight.said), withEight.said.slice(0, 1000));
  check('and no link is offered anyway',
    !/has a customer’s room inside it/.test(withEight.said), withEight.said.slice(0, 600));

  const withMany = await refusalFor(many);
  check('a room too big for a link is refused on its measured length',
    /characters long/.test(withMany.said), withMany.said.slice(0, 900));
  check('and the refusal names the limit rather than saying "too long"',
    /8,000 is as far as this will go/.test(withMany.said), withMany.said.slice(0, 900));
  check('and says why a longer one would be no use',
    /paste into a message/.test(withMany.said), withMany.said.slice(0, 900));

  check('refusing a link: no console or page errors',
    withEight.errors.length === 0 && withMany.errors.length === 0,
    [...withEight.errors, ...withMany.errors].join(' | '));
}

/* ------------------------------------------------------- opening one, cold */

{
  check('there is a link to open', theLink !== null && theLink !== '', 'part 7 made none');

  const { browser, page } = await open();
  const sent = [];
  page.on('request', (r) => sent.push(r.url()));
  // An empty link would navigate this to the app's own address and every check
  // below would then be reporting on the wrong page. `#nothing` is a fragment
  // the app ignores, so the checks fail honestly instead.
  const opening = theLink === null || theLink === '' ? `${URL}#nothing` : theLink;
  const payload = opening.slice(opening.indexOf('#room=') + 6);

  // Pasted into a tab that already has the app open. That is a SAME-DOCUMENT
  // navigation -- nothing reloads and React does not remount -- and it is how
  // most people will actually use a link they were sent. It did nothing at all
  // until `RoomFromLink` started listening for the address changing.
  await page.goto(opening, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(1200);
  const t = await page.locator('body').innerText();

  check('a link pasted into a tab that is already open opens the room',
    /garage/i.test(t) && !/Open a scan/.test(t), t.slice(0, 400));

  const walls = [];
  for (const l of await page.getByRole('button', { name: /^Wall / }).all()) {
    walls.push(await l.getAttribute('aria-label'));
  }
  check('and the room arrives with the measurements that were in it',
    walls.some((l) => /20' 3"/.test(l || '')), walls.join(' | '));

  const leaked = sent.filter((url) => url.includes(payload.slice(0, 64)));
  check('and the room never went to any server on the way',
    leaked.length === 0, leaked.join(' | '));

  check('the address bar does not keep a customer’s room in it afterwards',
    !page.url().includes('#room='), page.url().slice(0, 120));

  /* ------------------------------ and a second copy does not overwrite the first */

  // Through `about:blank` so this is a real document load rather than another
  // fragment change: a link opened cold, in a browser started at it, is the
  // other half of the same feature and it takes a different path through React.
  await page.goto('about:blank');
  await page.goto(opening, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(1200);
  const twice = await page.locator('body').innerText();
  check('a link opened cold, on a document load, opens the room as well',
    /garage/i.test(twice) && !/Open a scan/.test(twice), twice.slice(0, 400));
  check('opening the same link twice does not overwrite the room already here',
    /There was already a room called/.test(twice), twice.slice(0, 500));
  check('and it says nothing was lost',
    /Nothing you had was overwritten/.test(twice), twice.slice(0, 600));

  const kept = await page.evaluate(() => {
    const names = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith('trueline.room.v1:')) names.push(k.slice('trueline.room.v1:'.length));
    }
    return names.sort();
  });
  check('so this browser now holds two rooms rather than one',
    kept.length === 2, kept.join(' | '));
  console.log('rooms kept after opening the link twice:', kept.join(' | '));

  check('opening a link: no console or page errors', noise().length === 0, noise().join(' | '));
  await browser.close();
}

/* ------------------------------------------------------- a link that is broken */

{
  const { browser, page } = await open();
  // Cut short exactly the way a message client that wraps a long line cuts one.
  const cut = theLink === null || theLink === '' ? `${URL}#nothing` : theLink.slice(0, theLink.length - 40);
  await page.goto(cut, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(1200);
  const t = await page.locator('body').innerText();
  check('a link that was cut short on the way says so, rather than opening half a room',
    /did not survive the journey|cut short/.test(t), t.slice(0, 500));
  check('and it says what to ask for instead',
    /job file/.test(t), t.slice(0, 600));
  await browser.close();
}


/* ========================================================================== */
/*  8. The line the phone draws, drawn here too                               */
/* ========================================================================== */

/**
 * Where the gate stands in a browser, and what a code does to it.
 *
 * ## Why this part opens its own pages
 *
 * `open()` in `lib.mjs` pastes an unlock code before the page loads, because
 * every other part of this audit drives the app as somebody who has paid and
 * would otherwise meet a paywall on every screen. This block is the one that is
 * ABOUT the paywall, so it opens pages with nothing in them — a browser visitor
 * who has never seen a code.
 *
 * ## Why the lists are imported rather than written out
 *
 * `FREE` and `PAID` come straight from `core/src/entitlement.ts`, the same file
 * the Swift half is generated from and the same file `Gate` reads. A list
 * written out again here would be a third copy, and the whole point of that
 * file is that there is one. If a feature moves from one side of the line to
 * the other, or a new one appears, these checks change with it or go red.
 */

/** Which section a paid feature is met on, for the ones that have a screen. */
const GATED_ON = {
  takeoff: 'Takeoff',
  pricing: 'Price',
  proposal: 'Agreement',
  insurance: 'Insurance',
  exports: 'Files',
};

/**
 * The paid features with no screen of their own, and why each has none.
 *
 * Written down rather than skipped silently: a feature that quietly belongs to
 * neither list is a feature nothing checks.
 */
const NO_SCREEN_OF_ITS_OWN = {
  signature: 'signing happens inside the proposal, behind the proposal gate',
  changeOrders: 'change orders live on the Work screen, behind the proposal gate',
  priceList: 'the price list is on the Business tab, gated in PriceList.tsx',
  unlimitedRooms: 'a room limit is not a screen — `mayKeepRoom` refuses a save',
};

check('every paid feature is either on a screen this part drives, or excused by name',
  PAID.every((f) => f in GATED_ON || f in NO_SCREEN_OF_ITS_OWN),
  `not accounted for: ${PAID.filter((f) => !(f in GATED_ON) && !(f in NO_SCREEN_OF_ITS_OWN)).join(', ')}`);
check('and nothing free has been left in the paid list by mistake',
  PAID.every((f) => !FREE.includes(f)), PAID.filter((f) => FREE.includes(f)).join(', '));

/** A browser with nothing in it: no code, no rooms, no history. */
async function openFree() {
  const browser = await openChromium();
  const ctx = await browser.newContext({
    viewport: { width: 430, height: HEIGHT },
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('body', { timeout: 60000 });
  return { browser, page, errors };
}

/* ------------------------------------- a visitor who has never seen a code */

{
  const { browser, page, errors } = await openFree();

  const door = await page.locator('body').innerText();
  check('the front door names what is free, in the words entitlement.ts uses',
    FREE.every((f) => door.includes(TITLE[f])),
    `missing: ${FREE.filter((f) => !door.includes(TITLE[f])).map((f) => TITLE[f]).join(', ')}`);
  check('and names what is paid, from the same file, so the two cannot drift',
    PAID.every((f) => door.includes(TITLE[f])),
    `missing: ${PAID.filter((f) => !door.includes(TITLE[f])).map((f) => TITLE[f]).join(', ')}`);
  check('and says which side of the line it is drawing',
    /Measuring is free; turning\s+a drawing into money is paid|Measuring is free; turning a drawing into money is paid/
      .test(door.replace(/\s+/g, ' ')), door.slice(0, 1200));
  check('and says a browser is not a way round the subscription',
    /not a way round that/.test(door), door.slice(0, 2000));

  await page.setInputFiles('input[type=file][accept="application/json,.json"]', `${SP}/garage.json`);
  await page.waitForTimeout(1000);

  /* ------------------------------------------------- free is genuinely free */

  await section(page, 'Plan');
  let t = await page.locator('body').innerText();
  check('with no code: the drawing is there, and its dimensions',
    /420\.0 sq ft/.test(t) && /21' × 20'/.test(t), t.slice(0, 400));
  check('with no code: every wall is still a control to correct',
    (await page.getByRole('button', { name: /^Wall / }).count()) === 4,
    `${await page.getByRole('button', { name: /^Wall / }).count()} walls`);
  await page.getByRole('tab', { name: '3D' }).click();
  await page.waitForTimeout(400);
  check('with no code: the 3D view opens', (await page.locator('svg').count()) > 0);
  await page.getByRole('tab', { name: 'Blueprint' }).click();
  await page.waitForTimeout(300);

  /* --------------------------------------------- and paid is genuinely shut */

  const open_ = [];
  for (const [feature, where] of Object.entries(GATED_ON)) {
    await section(page, where);
    const said = await page.locator('body').innerText();
    if (!said.includes(WHAT_IT_DOES[feature].slice(0, 40))) open_.push(`${feature} on ${where}`);
  }
  check('with no code: every paid screen shows the lock, and the lock says what it does',
    open_.length === 0, `not gated: ${open_.join(', ')}`);

  await section(page, 'Takeoff');
  t = await page.locator('body').innerText();
  check('and the lock never says "upgrade" or "unlock" at a person',
    /part of the subscription/.test(t) && !/upgrade/i.test(t), t.slice(0, 500));

  /* --------------------------------------------------- what the box says it is */

  // On the room screen the box is folded away, because every line above the room
  // is a line the room is pushed down by. Opened here the way a person opens it.
  const folded = page.locator('details', { hasText: 'Already paying for Trueline' });
  if ((await folded.count()) > 0) {
    await folded.first().locator('summary').click();
    await page.waitForTimeout(300);
  }
  const codeBox = page.locator('[data-unlock="off"]').first();
  check('a browser with no code is offered somewhere to paste one',
    (await codeBox.count()) === 1);
  const offer = (await codeBox.count()) === 1 ? await codeBox.innerText() : '';
  check('and it is honest about what the code is: a courtesy lock, not security',
    /courtesy lock, not a security/.test(offer), offer.slice(0, 600));
  check('and says it can be forwarded and worked out',
    /can be forwarded/.test(offer) && /work out how one is made/.test(offer),
    offer.slice(0, 800));
  check('and nothing there claims the code is secure, private or protected',
    !/\b(secure|securely|encrypted|protected|private key|verified account)\b/i.test(offer),
    (offer.match(/.{0,60}(secure|encrypted|protected).{0,60}/i) || [''])[0]);
  check('and it says there is no account and no password',
    /no account and no password/.test(offer), offer.slice(0, 800));

  /* ------------------------------------------- a code that is not a code */

  await page.getByRole('button', { name: 'Unlock this browser' }).click();
  await page.waitForTimeout(300);
  let refused = await codeBox.innerText();
  check('an empty box is refused, and says what it wants',
    /nothing in the box/.test(refused) && /starts TL-/.test(refused), refused.slice(0, 600));

  await page.getByRole('textbox', { name: 'The code from the phone' }).fill('TL-XXXX');
  await page.getByRole('button', { name: 'Unlock this browser' }).click();
  await page.waitForTimeout(300);
  refused = await codeBox.innerText();
  check('a code that is too short is refused, and counted rather than waved at',
    /characters long and a code is 16/.test(refused), refused.slice(0, 600));

  await page.getByRole('textbox', { name: 'The code from the phone' }).fill('TL-EHS7-EW4Z-Y733-7FWY');
  await page.getByRole('button', { name: 'Unlock this browser' }).click();
  await page.waitForTimeout(300);
  refused = await codeBox.innerText();
  check('a code with one character wrong is refused, and says to check it',
    /not a code this app made/.test(refused), refused.slice(0, 600));

  const alert = page.locator('[data-unlock="off"] [role="alert"]');
  check('the refusal is where the person is looking, and announced',
    (await alert.count()) === 1, `${await alert.count()} alerts`);
  // Measured from where a person pressing the button is actually looking: the
  // button scrolled to, pressed, and the refusal appearing under it. Measuring
  // from the top of a page nobody is at would prove nothing either way.
  await page.getByRole('button', { name: 'Unlock this browser' })
    .scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const box = (await alert.count()) === 1 ? await alert.first().boundingBox() : null;
  check('and it is on the screen at a phone height',
    box !== null && box.y >= 0 && box.y + box.height <= page.viewportSize().height,
    box === null ? 'nothing to see' : JSON.stringify(box));

  check('still locked after three bad codes',
    (await page.locator('[data-unlock="on"]').count()) === 0);

  /* ------------------------------------------------------- and the real one */

  // Written out rather than computed from `makeUnlockCode`, so that changing how
  // a code is made turns this red instead of quietly agreeing with itself. It is
  // `makeUnlockCode('sam')`, and it is the same one `lib.mjs` uses.
  await page.getByRole('textbox', { name: 'The code from the phone' })
    .fill('TL-EHS7-EW4Z-Y733-7FWX');
  await page.getByRole('button', { name: 'Unlock this browser' }).click();
  await page.waitForTimeout(600);

  check('a code from the phone unlocks the browser',
    (await page.locator('[data-unlock="on"]').count()) === 1,
    await page.locator('[data-unlock="off"]').first().innerText().catch(() => 'gone'));

  const shut = [];
  for (const [feature, where] of Object.entries(GATED_ON)) {
    await section(page, where);
    const said = await page.locator('body').innerText();
    if (said.includes(WHAT_IT_DOES[feature].slice(0, 40))) shut.push(`${feature} on ${where}`);
  }
  check('and every paid screen opens — exactly the set entitlement.ts calls paid',
    shut.length === 0, `still shut: ${shut.join(', ')}`);

  await section(page, 'Takeoff');
  t = await page.locator('body').innerText();
  check('the takeoff is a takeoff and not a description of one',
    /702\.0 sq ft/.test(t), t.slice(0, 500));

  /* ------------------------------------------- while it is unlocked, no box */

  check('a browser that has pasted its code is not asked to paste it again',
    (await page.locator('[data-unlock="off"]').count()) === 0,
    'the box to paste a code into is still on the screen');

  /* -------------------------------------------------- and it survives a reload */

  // A reload puts the front door back — a browser asks for the file again,
  // which `a6-persist` has checked since the day it was written. The code is
  // what has to still be there, and the front door is where it is shown.
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1000);
  check('the code is pasted once, not every visit',
    (await page.locator('[data-unlock="on"]').count()) === 1);

  const held = await page.locator('[data-unlock="on"]').first().innerText();
  check('and the screen says the code can be cleared with everything else',
    /can be cleared along with/.test(held), held.slice(0, 500));

  await page.getByRole('button', { name: 'Forget the code' }).click();
  await page.waitForTimeout(500);
  check('and it can be taken off again',
    (await page.locator('[data-unlock="off"]').count()) === 1);

  await page.setInputFiles('input[type=file][accept="application/json,.json"]', `${SP}/garage.json`);
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await section(page, 'Takeoff');
  t = await page.locator('body').innerText();
  check('which shuts the paid screens again',
    t.includes(WHAT_IT_DOES.takeoff.slice(0, 40)), t.slice(0, 500));

  check('the gate: no console or page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}

process.exit(report('A52 — the browser version, with no phone under it') > 0 ? 1 : 0);
