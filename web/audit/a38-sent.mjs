import { createHash } from 'node:crypto';
import { openChromium } from '../../core/tools/browser.mjs';
import { check, report, reportEvenIfItDies, section, SP, URL } from './lib.mjs';

// Say what was learned even if this part dies part way through.
reportEvenIfItDies('A38 — the record that a document left this phone');

/**
 * The record that a document left this phone — driven through the real app.
 *
 * ## What was missing
 *
 * `sheet.ts` built a file, handed it to the phone, and wrote nothing down.
 * Three screens already speak in generalities because of it: the batch photo
 * delete cannot say how many of these pictures are already with the adjuster,
 * a proposal can go out and come back signed with nothing knowing which
 * version left, and a contractor cannot answer "did I send that estimate?"
 * from the app. `core/src/sent.ts` is the record; this part is the proof that
 * the app actually writes it when somebody presses a button.
 *
 * ## What it proves, and how
 *
 * Every fingerprint below is computed **on this side**, with `node:crypto`,
 * from the bytes the browser actually downloaded. A record that agrees with
 * itself proves nothing: the failure this feature has is a log that looks
 * perfect and describes a different file from the one that went. Only a hash
 * taken outside the app can see that.
 *
 * Five properties, in the order they would break:
 *
 *   1. Sending a real document writes one record, and that record's
 *      fingerprint is the fingerprint of the file that left.
 *   2. The same document sent twice keeps both sendings.
 *   3. A document changed between sendings is detectable — two records, two
 *      different fingerprints, and the older one no longer matches.
 *   4. Nothing anywhere claims delivery, a recipient, or a read receipt, and
 *      the screen no longer answers a share with the word "Sent."
 *   5. Cancelling out of the share sheet records nothing at all. That is the
 *      one honest negative iOS gives back and it has to be used.
 *
 * ## Two things about how it runs
 *
 * It runs at **430 by 800** — a real phone with the browser's chrome taken off
 * — rather than the 430 by 1600 the shared `open()` uses, because the message
 * the app puts on screen after a send is the thing being read here and a
 * window taller than any phone ever made cannot fail a check about seeing it.
 * The height is set here rather than in `lib.mjs`, which several parts share.
 *
 * And it runs on `dining.json`, Sam's own scan: nine walls, three doors, an
 * eleven-corner outline that is not a rectangle.
 *
 * The share-sheet phases install `navigator.share` and `navigator.canShare`
 * before the bundle runs. Chromium on a desktop has neither, so the branch of
 * `sendFile` that every iPhone takes would otherwise never be executed by any
 * check in this repository. Nothing of the app is stubbed — only the browser
 * API the phone provides, and it is made to behave the two ways a phone
 * behaves: resolving, and rejecting with `AbortError` when somebody backs out.
 */

const LOG = 'trueline.handovers.v1';

// 430 by 800: an iPhone 15 Pro Max with the browser's own chrome taken off.
const PHONE = { width: 430, height: 800 };

const browser = await openChromium();
const problems = [];

/** A page at phone height, optionally with a share sheet on it. */
async function phone({ share = 'none' } = {}) {
  const ctx = await browser.newContext({ viewport: PHONE, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  if (share !== 'none') {
    await page.addInitScript((behaviour) => {
      window.__shared = [];
      Object.defineProperty(Navigator.prototype, 'canShare', {
        value: () => true,
        configurable: true,
      });
      Object.defineProperty(Navigator.prototype, 'share', {
        value: async (data) => {
          window.__shared.push({
            title: data.title,
            names: (data.files ?? []).map((f) => f.name),
          });
          // What iOS does when somebody opens the sheet and backs out of it.
          if (behaviour === 'cancels') throw new DOMException('cancelled', 'AbortError');
        },
        configurable: true,
      });
    }, share);
  }
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.setInputFiles('input[type=file][accept="application/json,.json"]', `${SP}/dining.json`);
  await page.waitForTimeout(800);
  return { ctx, page };
}

/** The record, as the app has actually written it into this browser. */
async function log(page) {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), LOG);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return 'unreadable';
  }
}

/** Every rate on the job set to one figure, so the money in the file is known. */
async function charge(page, amount) {
  await section(page, 'Price');
  // Idempotent: the rate panel stays open once it has been opened, and the
  // control that opened it is called "Done" from then on.
  if ((await page.getByRole('heading', { name: 'What you charge' }).count()) === 0) {
    await page.getByRole('button', { name: /Set your rates|Your rates/ }).first().click();
    await page.waitForTimeout(300);
  }
  const rates = page
    .locator('section', { has: page.getByRole('heading', { name: 'What you charge' }) })
    .first();
  for (const box of await rates.getByRole('textbox').all()) {
    await box.fill(amount);
    await box.blur();
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(300);
}

function sender(page) {
  return page
    .locator('section', { has: page.getByRole('heading', { name: 'Send the drawing' }) })
    .first();
}

/** SHA-256 of what the browser actually downloaded. Taken outside the app. */
async function fingerprintOfDownload(download) {
  const hash = createHash('sha256');
  const stream = await download.createReadStream();
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

/* ==========================================================================
   1. A real document goes out, and the record is of that document.
   ========================================================================== */

{
  const { ctx, page } = await phone();
  check('nothing is on the record before anything has been sent', (await log(page)) === null);

  await charge(page, '5.00');
  await section(page, 'Files');
  await page.waitForTimeout(300);

  const [first] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    sender(page).getByRole('button', { name: /Send to the client/ }).click(),
  ]);
  const wentOut = await fingerprintOfDownload(first);
  await page.waitForTimeout(900);

  let kept = await log(page);
  check('sending a document writes exactly one record',
    Array.isArray(kept) && kept.length === 1, JSON.stringify(kept)?.slice(0, 400));

  const one = Array.isArray(kept) ? kept[0] : {};
  check('the record names the file that went',
    one.document === first.suggestedFilename(),
    `record "${one.document}" vs file "${first.suggestedFilename()}"`);
  check('and says what it was, in the words the screen used',
    typeof one.says === 'string' && one.says.length > 0, one.says);

  // The whole point. Hashed here, from the bytes that left the browser.
  check('the fingerprint on the record is the fingerprint of the file that actually went',
    one.fingerprint === wentOut, `recorded ${one.fingerprint}, file ${wentOut}`);
  check('and it is a SHA-256, in the one spelling everything else in the app uses',
    /^[0-9a-f]{64}$/.test(one.fingerprint ?? ''), one.fingerprint);

  check('the size on the record is the size of the file that went',
    one.bytes === (await first.createReadStream().then(async (s) => {
      let n = 0;
      for await (const chunk of s) n += chunk.length;
      return n;
    })), `recorded ${one.bytes}`);

  check('the time is ISO 8601 with the offset, not a bare local clock reading',
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:Z|[+-]\d\d:\d\d)$/.test(one.at ?? ''), one.at);
  check('and it is a time somebody could put a date on',
    Number.isFinite(Date.parse(one.at ?? '')), one.at);

  // A desktop browser has no share sheet, so this went to the downloads
  // folder, and the record says that rather than implying it went to anybody.
  check('a file that went to this device says so, and does not imply it went further',
    one.how === 'saved', `how=${one.how}`);

  /* ==================================================================
     2. The same document, sent again. Both are kept.
     ================================================================== */

  const [again] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    sender(page).getByRole('button', { name: /Send to the client/ }).click(),
  ]);
  await fingerprintOfDownload(again);
  await page.waitForTimeout(900);

  kept = await log(page);
  check('the same document sent twice keeps both sendings, not just the last',
    Array.isArray(kept) && kept.length === 2, `${kept?.length} records`);
  check('and both are of the same document',
    kept?.[0]?.document === kept?.[1]?.document, JSON.stringify(kept?.map((k) => k.document)));

  /* ==================================================================
     3. Now the document changes. The record can see it.
     ================================================================== */

  await charge(page, '9.25');
  await section(page, 'Files');
  await page.waitForTimeout(300);

  const [third] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    sender(page).getByRole('button', { name: /Send to the client/ }).click(),
  ]);
  const afterChange = await fingerprintOfDownload(third);
  await page.waitForTimeout(900);

  kept = await log(page);
  check('a third sending is kept too', Array.isArray(kept) && kept.length === 3, `${kept?.length}`);
  check('the document changed between sendings, and the file really is different',
    afterChange !== wentOut, `${wentOut.slice(0, 12)} vs ${afterChange.slice(0, 12)}`);
  check('the record shows it changed: the last fingerprint is not the first',
    kept?.[2]?.fingerprint === afterChange && kept?.[0]?.fingerprint === wentOut,
    JSON.stringify(kept?.map((k) => k.fingerprint.slice(0, 12))));
  // Spelled out rather than `kept[0] !== kept[2]`: with a log that keeps only
  // the last sending, `kept[2]` is undefined and "not equal" is trivially true.
  // Watched passing on a broken log once, which is once too often.
  check('so the copy the client is holding from the first send is detectably not this one',
    kept?.length === 3 && kept[0].fingerprint !== kept[2].fingerprint,
    `${kept?.length} records`);

  /* ==================================================================
     4. Nothing on the record claims delivery.
     ================================================================== */

  const written = JSON.stringify(kept);
  check('no record carries a recipient, a delivery, or a read receipt',
    !/deliver|recipient|receipt|"to"\s*:|"read"\s*:|"opened"/i.test(written), written.slice(0, 300));
  check('and no record says a document was sent',
    !/"sent/i.test(written) && !/\bwas sent\b/i.test(written), written.slice(0, 300));

  const told = await sender(page).innerText();
  check('a file that went to this device is described as saved, with its name',
    /Saved as .+\.html\./.test(told), told.slice(-300));

  check('the record survives the page being put down and picked up again',
    await (async () => {
      await page.reload({ waitUntil: 'networkidle' });
      const back = await log(page);
      return Array.isArray(back) && back.length === 3 && back[0].fingerprint === wentOut;
    })(), 'the log did not come back');

  await ctx.close();
}

/* ==========================================================================
   5. The share sheet — the path every iPhone takes, and the words on screen.
   ========================================================================== */

{
  const { ctx, page } = await phone({ share: 'accepts' });
  await charge(page, '5.00');
  await section(page, 'Files');
  await page.waitForTimeout(300);

  await sender(page).getByRole('button', { name: /Send to the client/ }).click();
  await page.waitForTimeout(1500);

  const handed = await page.evaluate(() => window.__shared ?? []);
  check('the file goes to the phone\'s share sheet when there is one',
    handed.length === 1 && /\.html$/.test(handed[0]?.names?.[0] ?? ''), JSON.stringify(handed));

  const kept = await log(page);
  check('a share writes a record too', Array.isArray(kept) && kept.length === 1, `${kept?.length}`);
  check('and it says the file was handed over, which is the part the app can stand behind',
    kept?.[0]?.how === 'handed', `how=${kept?.[0]?.how}`);
  check('the record still carries the fingerprint of the version that went',
    /^[0-9a-f]{64}$/.test(kept?.[0]?.fingerprint ?? ''), kept?.[0]?.fingerprint);

  // The exact words. "Sent." was what this said, and "sent" in a dispute is a
  // claim about somebody else's phone that this app cannot stand behind.
  const told = await sender(page).innerText();
  check('the screen does not answer a share with the word "Sent"',
    !/\bSent\b/.test(told), told.slice(-300));
  check('it says the document was handed over',
    /Handed over/.test(told), told.slice(-300));
  check('and says in the same breath that delivery is not something it can confirm',
    /cannot confirm it was delivered/.test(told), told.slice(-300));

  // The message has to be where a thumb is, not 280px above it on a real phone.
  // Counted before it is measured. A locator that finds nothing throws on
  // `boundingBox`, and a check that takes the whole run down with it hides the
  // thirty-one results either side of it — which is exactly what happened the
  // first time the wording was reverted to watch this fail.
  const message = page.getByText(/Handed over/).first();
  const box = (await message.count()) > 0 ? await message.boundingBox() : null;
  check('and the message is on the screen at a phone height, not below the fold',
    box !== null && box.y >= 0 && box.y <= PHONE.height,
    box ? `at y=${box.y.toFixed(0)} in an ${PHONE.height}px window` : 'no box');

  await ctx.close();
}

/* ==========================================================================
   6. Backing out of the share sheet. The one honest negative iOS gives back.
   ========================================================================== */

{
  const { ctx, page } = await phone({ share: 'cancels' });
  await charge(page, '5.00');
  await section(page, 'Files');
  await page.waitForTimeout(300);

  await sender(page).getByRole('button', { name: /Send to the client/ }).click();
  await page.waitForTimeout(1500);

  const handed = await page.evaluate(() => window.__shared ?? []);
  check('the share sheet was opened', handed.length === 1, JSON.stringify(handed));

  const kept = await log(page);
  check('changing your mind at the share sheet records nothing at all',
    kept === null || (Array.isArray(kept) && kept.length === 0), JSON.stringify(kept));

  const told = await sender(page).innerText();
  check('and the screen does not say anything went out',
    !/Handed over/.test(told) && !/Saved as/.test(told), told.slice(-300));

  await ctx.close();
}

check('no console or page errors across the whole run', problems.length === 0, problems.join(' | '));

const bad = report('A38 — the record that a document left this phone');
await browser.close();
process.exit(bad > 0 ? 1 : 0);
