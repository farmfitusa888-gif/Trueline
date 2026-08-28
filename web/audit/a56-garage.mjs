/**
 * A56 — the garage that came back as a square.
 *
 * ## The report
 *
 * > "I JUST SCANNED MY ENTIRE GARAGE AND WHEN IT FINISHED THERE WAS JUST A
 * >  GENERIC SQUARE BLUEPRINT AND 3D. WHAT IT SEEMS LIKE IS THE SCAN IS BEING
 * >  DONE BUT NOT BEING SAVED AND PUT INTO ROOMS PROPERLY."
 *
 * The folder came back with the report. It held a real capture — five walls, a
 * garage door, two windows, sixty photographs — and beside it a `corrected.json`
 * holding a four-walled 15-by-11 room drawn on a grid two days earlier and
 * called "Draft". A corrected room outranks a capture on the way to this page,
 * so the drawing won every time and the garage was never on the screen.
 *
 * This drives the real capture and the real drawing through the real bridge, in
 * the state the phone actually produced. `web/audit/garage-scan.json` is that
 * capture, geometry only.
 */
import { readFileSync } from 'node:fs';
import { check, HEIGHT, noise, openAsApp, report, reportEvenIfItDies, section } from './lib.mjs';

reportEvenIfItDies('A56 — the garage that came back as a square');

const SCAN = JSON.parse(readFileSync(new URL('./garage-scan.json', import.meta.url), 'utf8'));

/**
 * The drawing that was sitting in the garage's folder, byte for byte.
 *
 * Not written here. This is `corrected.json` off Sam's phone: a four-walled
 * room 15 by 11, `id: "drawn:1787736652238"`, `fileName: "Room"`, every wall
 * carrying a tape reading he took on 2026-08-26 — two days before the garage
 * was scanned. Reconstructing it by hand would have been this part agreeing
 * with itself about the shape of the thing it is meant to catch.
 */
const THE_DRAWING = readFileSync(new URL('./garage-strayed.json', import.meta.url), 'utf8');

/* ========================================================================== */
/*  1. The capture on its own opens as the garage it is                       */
/* ========================================================================== */

{
  const { browser, page } = await openAsApp({
    subscribed: true,
    fileName: 'Room 2026-08-28 1213',
    room: SCAN,
  });
  await section(page, 'Room');
  await page.waitForTimeout(500);
  const said = await page.locator('body').innerText();

  check('a real capture opens as the room it is, not as a square',
    /21' 4 1\/4"/.test(said) && /19' 3 11\/16"/.test(said), said.slice(0, 900));
  check('and the garage door is on it, as a gap rather than a wall',
    /9' 9 1\/8"/.test(said), said.slice(0, 1200));
  check('and it says nothing has had a tape on it, because nothing has',
    /no wall here has had a tape on it|Scanned/i.test(said), said.slice(0, 1200));
  check('and no banner about strayed corrections, because there are none',
    (await page.locator('[data-stray="yes"]').count()) === 0);
  check('the capture alone: no console or page errors', noise().length === 0, noise().join(' | '));
  await browser.close();
}

/* ========================================================================== */
/*  2. The capture WITH somebody else's corrections beside it                 */
/* ========================================================================== */

{
  const { browser, page } = await openAsApp({
    subscribed: true,
    fileName: 'Room 2026-08-28 1213',
    room: SCAN,
    // Exactly what was in that folder, and it used to win.
    saved: THE_DRAWING,
  });
  await section(page, 'Room');
  await page.waitForTimeout(500);
  const said = await page.locator('body').innerText();

  check('the drawing does not win: the garage is what is on the screen',
    /21' 4 1\/4"/.test(said), said.slice(0, 900));
  check('and the 15 by 11 room that was filed with it is nowhere on it',
    !/15'\s*0"/.test(said) && !/\bDraft\b/.test(said), said.slice(0, 900));

  const banner = page.locator('[data-stray="yes"]').first();
  check('and the app says why, rather than swapping them silently',
    (await banner.count()) === 1,
    'the capture was drawn and nothing said the corrections had been set aside');
  const why = (await banner.count()) === 1 ? await banner.innerText() : '';
  check('it names what happened in words a contractor can act on',
    /different room/.test(why) && /shared a name/.test(why), why.slice(0, 400));
  check('and it promises nothing was deleted, because nothing was',
    /Nothing has been deleted/.test(why), why.slice(0, 400));

  // The banner has to be on the screen where somebody arriving at the room is.
  const box = (await banner.count()) === 1 ? await banner.boundingBox() : null;
  check('and the whole of it is on the screen the moment the room opens',
    box !== null && box.y >= 0 && box.y + box.height <= HEIGHT,
    box === null ? 'there is no banner to see' : JSON.stringify(box));

  check('the stray correction: no console or page errors',
    noise().length === 0, noise().join(' | '));
  await browser.close();
}

/* ========================================================================== */
/*  3. A correction that IS of this capture is still king                     */
/* ========================================================================== */

{
  // The same file, with one thing changed: the id is the CAPTURE's own, which
  // is the whole of what makes a saved room a correction of it rather than a
  // different room. Everything else about it is untouched.
  const asJson = JSON.parse(THE_DRAWING);
  const corrected = JSON.stringify({
    ...asJson,
    fileName: 'Room 2026-08-28 1213',
    room: {
      ...asJson.room,
      id: 'roomplan:00359271-76DF-46E2-8396-20E9C56E828C',
      name: 'The bay',
    },
  });

  const { browser, page } = await openAsApp({
    subscribed: true,
    fileName: 'Room 2026-08-28 1213',
    room: SCAN,
    saved: corrected,
  });
  await section(page, 'Room');
  await page.waitForTimeout(500);
  const said = await page.locator('body').innerText();
  // The name is drawn on the plan rather than in the wall list, so it is read
  // from where it is written.
  await section(page, 'Plan');
  await page.waitForTimeout(400);
  const drawn = await page.locator('body').innerText();

  // 15' by 11' — the drawing's own numbers, which is exactly the point: the
  // capture is 21' by 19' and it is NOT what is on the screen here.
  check('a correction of THIS capture still outranks it, which is the whole point',
    /The bay/.test(drawn) && /15'/.test(said) && /11'/.test(said)
    && !/21' 4 1\/4"/.test(said),
    `bay=${/The bay/.test(said)} 15=${/15'/.test(said)} 11=${/11'/.test(said)} `
    + `capture=${/21' 4 1\/4"/.test(said)} :: ` + said.slice(0, 300).replace(/\n/g, ' | '));
  check('and nothing is said about strays, because there is no stray',
    (await page.locator('[data-stray="yes"]').count()) === 0);
  check('a real correction: no console or page errors', noise().length === 0, noise().join(' | '));
  await browser.close();
}

const bad = report('A56 — the garage that came back as a square');
process.exit(bad > 0 ? 1 : 0);
