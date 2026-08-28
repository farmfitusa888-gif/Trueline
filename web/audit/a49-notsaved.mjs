import { readFileSync } from 'node:fs';
import { check, openAsApp, pick, report, reportEvenIfItDies, sentTo, SP } from './lib.mjs';

// Say what was learned even if this part dies part way through.
reportEvenIfItDies('A49 — the phone would not take it, and the app said so');

/**
 * A49 — when the phone will not take the room, the app says so.
 *
 * ## The room with 53 photographs in it
 *
 * > "i accidentally deleted a room file from my phone, can i get it back? ...
 * >  the reason i accidentally deleted it was because when i renamed the file,
 * >  it didnt reflect in the room screen"
 *
 * Two separate faults produced that. One was a name with two writers, fixed.
 * The other is this one: `handBack` in `web/src/bridge.ts` posted the corrected
 * room to the app and **swallowed any failure**. Its own comment argued the
 * copy in `localStorage` still existed — true, and not the point. A web view's
 * store is cleared by the system whenever it wants the room back; the copy in
 * the scan's folder and in iCloud is the one that survives. So a room could be
 * corrected, look saved, and exist nowhere but a cache.
 *
 * It was the last silent catch on the path between a correction and the phone's
 * disk. Sam, asked what it should do instead: **"Stop and say it plainly, in
 * your way."** A red line where he is looking, that stays until a save actually
 * goes through.
 *
 * ## What this part does that no other one can
 *
 * `openAsApp(..., { refuses: ['saved'] })` installs an app that is **here** and
 * throws when handed the room — which is a different state from no app at all,
 * and the only one of the two that is a failure. Until the harness could make
 * that state, nothing could check what the screen says in it.
 *
 * Run at 430x800, the harness default, because "is the line where he is
 * looking" is the whole question and it cannot fail in a window with no fold.
 */

const room = JSON.parse(readFileSync(SP + '/dining.json', 'utf8'));

/* ------------------------------------- an app that is here and takes the room */

{
  const { browser, page } = await openAsApp({ room, fileName: 'dining.json' });

  await pick(page, /^Wall wall-1,/);
  // 13' 6" and not something rounder: wall-1 of Sam's dining room measures
  // 13' 5 1/4" and carries an opening, and the app rightly refuses a length
  // that would shrink that opening below nothing. A fixture number the app
  // refuses proves nothing about saving.
  await page.getByRole('textbox', { name: 'the length of wall-1' }).fill(`13' 6"`);
  await page.getByRole('button', { name: 'Set the length of wall-1' }).click();
  await page.waitForTimeout(600);

  const handed = await sentTo(page, 'saved');
  check('the working app is handed the corrected room', handed.length > 0, String(handed.length));

  const t = await page.locator('body').innerText();
  check('and says nothing about it not being saved',
    !/not saved on your phone/i.test(t), t.slice(0, 300));

  await browser.close();
}

/* ------------------------------- an app that is here and refuses to take it */

{
  const { browser, page } = await openAsApp(
    { room, fileName: 'dining.json' },
    { refuses: ['saved'] }
  );

  await pick(page, /^Wall wall-1,/);
  // 13' 6" and not something rounder: wall-1 of Sam's dining room measures
  // 13' 5 1/4" and carries an opening, and the app rightly refuses a length
  // that would shrink that opening below nothing. A fixture number the app
  // refuses proves nothing about saving.
  await page.getByRole('textbox', { name: 'the length of wall-1' }).fill(`13' 6"`);
  await page.getByRole('button', { name: 'Set the length of wall-1' }).click();
  await page.waitForTimeout(600);

  const t = await page.locator('body').innerText();
  check('the refusal is said, in the words a person would use',
    /This is not saved on your phone yet/.test(t), t.slice(0, 600));
  check('and it says what to do about it',
    /Close the app and open it again/.test(t), t.slice(0, 600));
  check('and that it will not go away on its own',
    /stays until one goes through/.test(t), t.slice(0, 600));

  // Never "saved", never a tick, never anything that reads as success.
  check('nothing on the screen calls it saved',
    !/\bSaved\b/.test(t) || /not saved on your phone/i.test(t), t.slice(0, 600));

  const alert = page.locator('[role="alert"]', { hasText: 'not saved on your phone' }).first();
  // Counted before anything is asked of it. A `boundingBox` or an `evaluate` on
  // a locator that finds nothing throws, and a part that throws reports NOTHING
  // -- so the one mutation this file exists to catch, putting the silent catch
  // back, would kill the run instead of turning it red. The four checks below
  // fail legibly when the banner is absent, which is what a failing check is
  // for.
  const there = (await alert.count()) === 1;
  check('it is an alert, so it is announced rather than only drawn', there, String(there));

  /* --------------------------------- and it is where the person is looking */

  // Red, not amber. The two failures are not the same size: a browser store
  // that refused loses the room when the tab closes; the app refusing means the
  // durable copy does not exist at all. `App.tsx` picks the colour off
  // `SaveTrouble.where`, never off the words.
  //
  // Compared against the page's OWN refusal tone rather than a threshold on the
  // channels: `--c-refuse-soft` on paper is a pale pink, and any rule loose
  // enough to call that red would call the amber note red too. This asks the
  // only question worth asking -- is this the colour the app paints refusals?
  const painted = !there ? null : await alert.evaluate((node) => {
    const seen = getComputedStyle(node).backgroundColor;
    const want = (name) => {
      const channels = getComputedStyle(document.documentElement)
        .getPropertyValue(name).trim();
      const probe = document.createElement('div');
      probe.style.backgroundColor = `rgb(${channels})`;
      document.body.append(probe);
      const value = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return value;
    };
    return { seen, refuse: want('--c-refuse-soft'), note: want('--c-scanned-soft') };
  });
  check('it is painted in the app\u2019s own refusal colour, not its note colour',
    painted !== null && painted.seen === painted.refuse && painted.seen !== painted.note,
    painted === null ? 'there is no banner to paint' : JSON.stringify(painted));

  const box = there ? await alert.boundingBox() : null;
  const window = page.viewportSize();
  check('the whole of it is on the screen at a phone height',
    box !== null && box.y >= 0 && box.y + box.height <= window.height,
    box === null ? 'there is no banner to see' : JSON.stringify({ box, window }));

  // Scrolled to the bottom of a long room screen, it must still be there. A
  // banner at the top of a page somebody scrolls is a banner somebody scrolls
  // past, and this is the one that says a room is not on the phone.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);
  const after = there ? await alert.boundingBox() : null;
  check('and it is still there after scrolling to the foot of the screen',
    after !== null && after.y >= 0 && after.y + after.height <= window.height,
    after === null ? 'there is no banner to see' : JSON.stringify({ after, window }));

  /* ------------------------------------ the browser copy was still written */

  // The weaker copy is written whatever the app said. It is not nothing: it is
  // what lets the next save hand the whole room over again.
  const kept = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.includes('dining')) return localStorage.getItem(key) ?? '';
    }
    return '';
  });
  // 13' 6" is 162 inches, and this app keeps lengths as exact nanometres:
  // 162 x 25,400,000. Asserted as that integer rather than as the string on
  // screen, because the string is a rendering and the number is the record.
  const wall1 = JSON.parse(kept || '{}')?.room?.walls?.[0]?.length?.value?.$nm;
  check('the correction is in the browser even though the app would not take it',
    wall1 === String(162n * 25400000n), String(wall1));

  await browser.close();
}

process.exit(report('A49 — the phone would not take it, and the app said so') > 0 ? 1 : 0);
