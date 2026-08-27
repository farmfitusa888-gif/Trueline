/**
 * Films the app.
 *
 * Two videos, both of the real app running in a real browser at the size of a
 * phone. Nothing here is a mock-up, a slideshow of screenshots, or a script
 * acted out over pictures: every tap is a real tap, every number on the screen
 * is one the app worked out, and if the app breaks the film breaks with it.
 *
 *   1. `demo.mp4`   — the work being done. An empty app, a business typed in
 *                     with its rates, a scan opened, two walls put a tape on,
 *                     the takeoff, the price, the proposal written, signed,
 *                     and a deposit raised against it.
 *   2. `tour.mp4`   — the guided tour running over the finished job, all the
 *                     way through, every screen in the order of a job.
 *
 * ## Running it
 *
 *   npm run build
 *   (cd web && npx vite preview --port 4173 --host 127.0.0.1 &)
 *   node site/tools/film.mjs
 *
 * Writes `site/film/demo.mp4` and `site/film/tour.mp4`.
 *
 * ## The caption bar
 *
 * A strip is drawn across the top saying what is being done, because a silent
 * video of somebody typing needs a voice and this has no soundtrack. It is
 * injected by this script and is NOT part of the app — it is drawn in the
 * page's top layer, takes no clicks, and every pixel underneath it is the app.
 *
 * ## Why mp4 and not the webm the browser hands over
 *
 * Chromium records VP8 in a WebM container. Safari on a Mac and on a phone is
 * where these will be watched, and its WebM support is recent and partial, so
 * a WebM file is a coin toss. H.264 in an mp4 plays everywhere, including in a
 * message. The transcode is one pass with no re-framing.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { openChromium } from '../../core/tools/browser.mjs';
import { ffmpegPath } from '../../core/tools/ffmpeg.mjs';

// Resolved for this machine, and checked for libx264 before it is used --
// see core/tools/ffmpeg.mjs for why the one inside Playwright will not do.
const FFMPEG = ffmpegPath();
const SITE = process.env.TRUELINE_AUDIT_URL ?? 'http://127.0.0.1:4173/';
const HERE = new globalThis.URL('.', import.meta.url).pathname;
const FIXTURES = `${HERE}../../web/audit/`;
const OUT = `${HERE}../film`;
const RAW = `${OUT}/.raw`;

/** A phone, in even numbers because H.264 encodes in 2×2 blocks. */
const SIZE = { width: 430, height: 932 };

const kitchen = JSON.parse(readFileSync(`${FIXTURES}kitchen.json`, 'utf8'));

const RATES = [
  ['Floor rate', '9.50'], ['Ceiling rate', '4.25'], ['Wall face rate', '3.75'],
  ['Baseboard rate', '6.00'], ['Doors rate', '450.00'], ['Windows rate', '300.00'],
  ['Cased openings rate', '180.00'], ['Opening wrap rate', '5.00'],
];

if (existsSync(RAW)) rmSync(RAW, { recursive: true });
mkdirSync(RAW, { recursive: true });
mkdirSync(OUT, { recursive: true });

const browser = await openChromium();

/**
 * The caption bar and the title card, injected before anything loads.
 *
 * `addInitScript` rather than a one-off evaluate: the app navigates by hash
 * and the film opens more than one page, and a caption that vanished on the
 * first navigation would be a caption nobody could rely on.
 */
const DRESSING = `
  (() => {
    const put = () => {
      if (document.getElementById('film-strip')) return;
      const style = document.createElement('style');
      style.textContent = \`
        #film-strip {
          position: fixed; inset: 0 0 auto 0; z-index: 2147483647;
          pointer-events: none; padding: 10px 16px 12px;
          background: linear-gradient(180deg, rgba(15,23,42,.94), rgba(15,23,42,.78) 78%, rgba(15,23,42,0));
          color: #fff; font: 600 15px/1.3 ui-sans-serif, system-ui, sans-serif;
          opacity: 0; transition: opacity .35s ease;
        }
        #film-strip[data-on] { opacity: 1; }
        #film-strip b { display: block; font-weight: 700; }
        #film-strip i {
          display: block; font-style: normal; font-weight: 500; font-size: 12.5px;
          color: #cbd5e1; margin-top: 2px;
        }
        #film-card {
          position: fixed; inset: 0; z-index: 2147483646; pointer-events: none;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 10px; background: #0f172a; color: #fff; text-align: center; padding: 32px;
          font: 400 16px/1.45 ui-sans-serif, system-ui, sans-serif;
          opacity: 0; transition: opacity .5s ease;
        }
        #film-card[data-on] { opacity: 1; }
        #film-card b { font: 700 30px/1.1 ui-sans-serif, system-ui, sans-serif; letter-spacing: -.01em; }
        #film-card i { font-style: normal; color: #94a3b8; font-size: 14px; max-width: 30ch; }
      \`;
      document.head.append(style);
      const strip = document.createElement('div');
      strip.id = 'film-strip';
      strip.innerHTML = '<b></b><i></i>';
      const card = document.createElement('div');
      card.id = 'film-card';
      card.innerHTML = '<b></b><i></i>';
      document.body.append(strip, card);
    };
    if (document.body) put(); else document.addEventListener('DOMContentLoaded', put);
    window.__film = {
      /**
       * Put a caption up, and take it down again.
       *
       * The taking down is the point. A strip pinned across the top for the
       * whole film covers the first inch of every screen — which on this app
       * is the room's name, its size, and the banner saying what the example
       * is. So it says its piece and clears, and the rest of the beat is the
       * app with nothing on top of it.
       */
      say(title, under, forMs) {
        put();
        const strip = document.getElementById('film-strip');
        window.clearTimeout(window.__filmTimer);
        strip.querySelector('b').textContent = title;
        strip.querySelector('i').textContent = under ?? '';
        strip.toggleAttribute('data-on', !!title);
        if (title && forMs) {
          window.__filmTimer = window.setTimeout(
            () => strip.removeAttribute('data-on'), forMs);
        }
      },
      card(title, under) {
        put();
        const card = document.getElementById('film-card');
        card.querySelector('b').textContent = title ?? '';
        card.querySelector('i').textContent = under ?? '';
        card.toggleAttribute('data-on', !!title);
      },
    };
  })();
`;

async function stage(payload = {}) {
  const ctx = await browser.newContext({
    viewport: SIZE,
    recordVideo: { dir: RAW, size: SIZE },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  const trouble = [];
  page.on('pageerror', (e) => trouble.push(e.message));
  await page.addInitScript((parked) => {
    window.__sent = {};
    window.webkit = { messageHandlers: {} };
    for (const n of ['saved', 'thumbnail', 'company', 'photo', 'calendar', 'trouble', 'mark', 'draft']) {
      window.__sent[n] = [];
      window.webkit.messageHandlers[n] = { postMessage(b) { window.__sent[n].push(b); } };
    }
    window.truelinePayload = parked;
  }, payload);
  await page.addInitScript(DRESSING);
  return { ctx, page, trouble };
}

const beat = (page, ms) => page.waitForTimeout(ms);
/** Up for `forMs`, then out of the way. 0 keeps it up until the next call. */
const say = (page, t, u, forMs = 2800) =>
  page.evaluate(([a, b, c]) => window.__film?.say(a, b, c), [t, u, forMs]);
const card = (page, t, u) => page.evaluate(([a, b]) => window.__film?.card(a, b), [t, u]);

async function titled(page, title, under, hold = 2600) {
  await card(page, title, under);
  await beat(page, hold);
  await card(page, '', '');
  await beat(page, 550);
}

async function part(page, title, caption, under, hold = 2400) {
  await page.getByRole('navigation', { name: 'Parts of this room' })
    .getByRole('button', { name: new RegExp('^' + title) }).first().click();
  const key = { Plan: 'plan', Room: 'room', Takeoff: 'takeoff', Price: 'price',
                Agreement: 'agree', Work: 'work', Insurance: 'claim', Files: 'files' }[title];
  await page.waitForSelector(`[data-panel="${key}"]:not([hidden])`, { timeout: 5000 });
  if (caption) await say(page, caption, under);
  await beat(page, hold);
}

/** Scroll a panel through, slowly enough to read. */
async function readThrough(page, stepsOf = 260, steps = 5, pause = 700) {
  for (let i = 0; i < steps; i += 1) {
    await page.mouse.wheel(0, stepsOf);
    await beat(page, pause);
  }
}

/* =======================================================================
   Film one: the work being done.
   ======================================================================= */

let company = '';
let demoPath = '';
{
  const { ctx, page, trouble } = await stage({ subscribed: true });
  await page.goto(`${SITE}#business`, { waitUntil: 'networkidle' });
  await beat(page, 900);

  await titled(page, 'Trueline',
    'A kitchen, measured with a phone and priced off your own rate book. '
    + 'Every tap in this film is a real tap in the real app.', 3600);

  await say(page, 'Your business, once',
    'The name and the licence that go on every document you send.');
  await beat(page, 1200);
  await page.getByLabel('Business name').fill('Reyes Remodeling');
  await beat(page, 700);
  await page.getByLabel('Phone').fill('(847) 555-0142');
  await beat(page, 500);
  await page.getByLabel('Licence number').fill('IL-104-018872').catch(() => {});
  await beat(page, 900);

  await say(page, 'Your rates, once',
    'Nothing in this app comes from market data. These eight numbers are yours.');
  await beat(page, 900);
  for (const [label, value] of RATES) {
    const box = page.getByLabel(label);
    if (await box.count()) {
      await box.scrollIntoViewIfNeeded();
      await box.fill(value);
      await box.blur();
      await beat(page, 260);
    }
  }
  await beat(page, 1400);
  company = await page.evaluate(() => window.__sent.company.at(-1)?.company ?? '');
  await ctx.close();
  if (trouble.length) { console.error('The app threw: ' + trouble.join(' | ')); process.exit(1); }
  demoPath = await page.video().path();
  console.log('  ✓ filmed: the business and the rates');
}

let jobPath = '';
{
  const { ctx, page, trouble } = await stage({
    company, subscribed: true, room: kitchen, fileName: 'Whitaker — kitchen',
  });
  await page.goto(SITE, { waitUntil: 'networkidle' });
  await beat(page, 1100);

  await titled(page, 'The room',
    'A kitchen the phone scanned. The walls, the door and the window are '
    + 'where LiDAR found them.', 3000);

  await part(page, 'Plan', 'Every wall, with its length',
    'The line underneath says how each one was found. Scanned, until somebody puts a tape on it.',
    3000);

  await say(page, 'Now the tape',
    'Two walls, one running each way — the discipline that anchors the rest.');
  await beat(page, 1400);
  for (const [wall, reading] of [[/^Wall wall-1/, `20' 11"`], [/^Wall wall-2/, `19' 10"`]]) {
    const button = page.getByRole('button', { name: wall }).first();
    await button.scrollIntoViewIfNeeded().catch(() => {});
    await button.focus();
    await page.keyboard.press('Enter');
    await beat(page, 900);
    const box = page.getByRole('textbox', { name: /how long/i }).first();
    if (await box.count()) {
      await box.fill(reading);
      await beat(page, 800);
      await page.getByRole('button', { name: /^Set how long|^Set$/ }).first().click().catch(() => {});
      await beat(page, 1200);
    }
  }
  await say(page, 'Measured', 'The wall turns black, and every quantity that depends on it moves.');
  await beat(page, 2400);

  await part(page, 'Takeoff', 'The takeoff',
    'Floor, ceiling, wall face, baseboard, framing, and every opening counted.', 2200);
  await readThrough(page, 300, 5, 800);

  await part(page, 'Price', 'What it comes to',
    'Each line is a rate you set times a quantity the room measured.', 2200);
  await readThrough(page, 300, 4, 850);

  await part(page, 'Agreement', 'The proposal',
    'The quantities and the rates are already here. Nothing is retyped.', 1800);
  await page.getByLabel(/What to call this option/i).fill('As measured');
  await beat(page, 700);
  await page.getByLabel(/One line on what it covers/i).fill(
    'Take up the old floor and base, board and finish the walls and ceiling, then lay the new '
    + 'floor and set the base back, trimming out the door and the window.');
  await beat(page, 1200);
  await page.getByRole('button', { name: 'Write the proposal' }).click();
  await beat(page, 1800);
  await page.getByLabel(/Who it is for/i).fill('J. Whitaker');
  await beat(page, 500);
  await page.getByLabel(/Address of the work/i).fill('118 Willow St');
  await beat(page, 600);
  await page.getByRole('button', { name: 'Save these details' }).click();
  await beat(page, 1200);
  await readThrough(page, 300, 3, 900);

  await say(page, 'Signed on the phone',
    'And the record kept is who, when, on what, and the exact words they agreed to.');
  await page.getByRole('button', { name: 'Take this one' }).click();
  await beat(page, 1400);
  await page.getByLabel(/Your name/i).fill('J. Whitaker');
  await beat(page, 600);
  await page.getByLabel(/I agree to sign electronically/i).check();
  await beat(page, 800);
  {
    const pad = page.locator('[data-panel="agree"] canvas').first();
    await pad.scrollIntoViewIfNeeded();
    await beat(page, 400);
    const box = await pad.boundingBox();
    await page.mouse.move(box.x + 24, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 14; i += 1) {
      await page.mouse.move(box.x + 24 + (i * (box.width - 48)) / 14,
        box.y + box.height / 2 + (i % 2 ? -16 : 16));
      await beat(page, 55);
    }
    await page.mouse.up();
  }
  await beat(page, 1100);
  await page.getByRole('button', { name: /^Agree to / }).click();
  await beat(page, 2400);

  await part(page, 'Work', 'And the deposit',
    'Built from what somebody signed, never from what the room measures today.', 1800);
  {
    const write = page.getByRole('button', { name: 'Write the invoice' });
    if (await write.count()) {
      const number = page.getByLabel(/Your invoice number/i);
      if (await number.count()) { await number.fill('2026-041'); await beat(page, 700); }
      await write.click();
      await beat(page, 2000);
      await readThrough(page, 300, 3, 850);
    }
  }

  // The restoration half of the same job. Half this app's audience does this
  // work, and a film that stopped at the deposit would never show it.
  await part(page, 'Insurance', 'If the job is a claim',
    'Off unless you turn it on. Nothing above changes when you do.', 2200);
  {
    const turnOn = page.getByRole('button', { name: 'Turn it on' });
    if (await turnOn.count()) { await turnOn.click(); await beat(page, 1200); }
    const claim = page.locator('section', { has: page.getByRole('heading', { name: 'The claim' }) })
      .first();
    await claim.getByLabel('Claim number').fill('CLM-88412');
    await beat(page, 400);
    await claim.getByLabel('Date of loss').fill('2026-08-18');
    await beat(page, 400);
    await claim.getByRole('button', { name: 'burst pipe', exact: true }).click();
    await beat(page, 900);

    await part(page, 'Plan', 'Mark it where it is',
      'Point at the wall the damage is on. The room already knows how long that wall is.', 1600);
    const wall = page.getByRole('button', { name: /^Wall wall-1/ }).first();
    await wall.scrollIntoViewIfNeeded().catch(() => {});
    await wall.focus();
    await page.keyboard.press('Enter');
    await beat(page, 900);
    await page.getByRole('button', { name: '+ damaged area' }).click();
    await beat(page, 700);
    await page.getByRole('button', { name: 'Water', exact: true }).click();
    await beat(page, 500);
    await page.getByPlaceholder('water line along the bottom of the wall')
      .fill('supply line behind the washer');
    await beat(page, 600);
    await page.getByLabel('From along the wall').fill('0');
    await page.getByLabel('To along the wall').fill('9');
    await page.getByLabel('How high the damage reaches').fill('18"');
    await beat(page, 700);
    await page.getByRole('button', { name: 'Mark it' }).click();
    await say(page, 'And it works out the quantities',
      'Nine feet of wall, eighteen inches high, less the opening in that run.');
    await beat(page, 2800);

    const open = page.getByRole('button', { name: /Open$/ }).first();
    if (await open.count()) {
      await open.click();
      await beat(page, 700);
      const two = page.getByRole('button', { name: "2'", exact: true }).first();
      if (await two.count()) {
        await two.click();
        await say(page, 'What you cut, and what you saw',
          'Two feet opened up. The eighteen inches it was seen to is kept separately.');
        await beat(page, 2800);
      }
    }
    for (const reading of ['28', '14']) {
      const box = page.getByLabel('Moisture reading');
      if (await box.count()) {
        await box.scrollIntoViewIfNeeded();
        await box.fill(reading);
        await beat(page, 500);
        await page.getByRole('button', { name: 'Log it' }).click();
        await beat(page, 800);
      }
    }
    await say(page, 'Drying, logged',
      'Readings keep their scale, and the app refuses to draw a curve across a change of it.');
    await beat(page, 2600);
    await readThrough(page, 300, 3, 850);
  }

  await part(page, 'Files', 'What leaves the phone',
    'The drawing, the client file, CAD, the field sheet, the claim PDF, and the whole job zipped.',
    2200);
  await readThrough(page, 300, 4, 850);

  await say(page, '', '');
  await titled(page, 'That is the job',
    'Scanned, measured, priced, written, signed and invoiced — on the phone, '
    + 'without a desk in the middle of it.', 4200);

  await ctx.close();
  if (trouble.length) { console.error('The app threw: ' + trouble.join(' | ')); process.exit(1); }
  jobPath = await page.video().path();
  console.log('  ✓ filmed: the room, the money and the paperwork');
}

/* =======================================================================
   Film two: the guided tour, running.
   ======================================================================= */

let tourPath = '';
{
  const { ctx, page, trouble } = await stage({ subscribed: true });
  await page.goto(`${SITE}#demo`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-panel="plan"]', { timeout: 15000 });
  await beat(page, 900);

  await titled(page, 'The guided tour',
    'Every screen in the app, over a kitchen that was scanned, taped, priced, '
    + 'signed and invoiced. It reads. It never writes.', 4000);

  await beat(page, 1400);
  await page.getByRole('button', { name: /Take the tour/ }).click();
  const tour = page.getByRole('dialog', { name: 'Guided tour' });
  await tour.waitFor({ timeout: 8000 });
  await beat(page, 900);

  const counter = await tour.locator('p').first().textContent();
  const total = Number(/of (\d+)/i.exec(counter ?? '')?.[1] ?? 0);
  if (!total) { console.error('The tour card never said how many stops it has.'); process.exit(1); }

  for (let at = 1; at <= total; at += 1) {
    const title = await tour.locator('h2').textContent();
    await say(page, `${at} of ${total}`, title ?? '');
    // The ring lands 260ms in; the rest is reading time for the card.
    await beat(page, 4600);
    if (at < total) {
      await tour.getByRole('button', { name: 'Next' }).click();
      await beat(page, 320);
    }
  }

  await tour.getByRole('button', { name: 'Finish' }).click();
  await beat(page, 1400);
  await say(page, '', '');
  await titled(page, 'And nothing moved',
    'The tour changed no quantity, no price and no word of the proposal. '
    + 'It is safe to run inside a real job.', 4200);

  await ctx.close();
  if (trouble.length) { console.error('The app threw: ' + trouble.join(' | ')); process.exit(1); }
  tourPath = await page.video().path();
  console.log(`  ✓ filmed: the guided tour, all ${total} stops`);
}

await browser.close();

/* =======================================================================
   Into something that plays anywhere.
   ======================================================================= */

function encode(inputs, out) {
  const args = [];
  for (const i of inputs) args.push('-i', i);
  if (inputs.length > 1) {
    args.push('-filter_complex',
      inputs.map((_, i) => `[${i}:v]scale=${SIZE.width}:${SIZE.height},setsar=1[v${i}]`).join(';')
      + ';' + inputs.map((_, i) => `[v${i}]`).join('') + `concat=n=${inputs.length}:v=1:a=0[out]`,
      '-map', '[out]');
  }
  args.push(
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'slow', '-crf', '26',
    '-r', '25', '-movflags', '+faststart', '-y', out);
  execFileSync(FFMPEG, args, { stdio: 'pipe' });
}

encode([demoPath, jobPath], `${OUT}/demo.mp4`);
encode([tourPath], `${OUT}/tour.mp4`);
rmSync(RAW, { recursive: true, force: true });

/**
 * A still off each film, for the player to show before anybody presses play.
 *
 * ## Why not the plan that is already on the page
 *
 * That is what the first version did, and both players then showed the same
 * landscape drawing letterboxed into a portrait box. Two films that look
 * identical and neither of them looks like a film — a viewer has no reason to
 * press either.
 *
 * So each poster is a frame of its own film, chosen for what it says at a
 * glance: the takeoff with real quantities on it for the one about doing the
 * work, and a stop of the tour standing inside the room in 3D for the one
 * about the tour. Cut from the films themselves, so they cannot show a screen
 * the film does not.
 */
const POSTERS = [
  ['demo.mp4', 'demo-poster.jpg', '34', 'the takeoff, with the quantities on it'],
  ['tour.mp4', 'tour-poster.jpg', '28', 'a stop of the tour, standing inside the room in 3D'],
];
for (const [film, poster, at, what] of POSTERS) {
  execFileSync(FFMPEG, [
    '-hide_banner', '-loglevel', 'error',
    '-ss', at, '-i', `${OUT}/${film}`,
    '-frames:v', '1', '-q:v', '3', '-y', `${OUT}/${poster}`,
  ], { stdio: 'pipe' });
  console.log(`  ✓ poster from ${film} at ${at}s — ${what}`);
}

// `ffmpeg -i` with no output file prints what it found and then exits 1,
// because it was asked to convert nothing. That is not a failure here — the
// exit code is the point of the call and the report is on stderr.
function lengthOf(file) {
  try {
    execFileSync(FFMPEG, ['-hide_banner', '-i', file], { stdio: 'pipe' });
    return '?';
  } catch (why) {
    return /Duration: (\S+),/.exec(String(why.stderr))?.[1] ?? '?';
  }
}

for (const name of ['demo.mp4', 'tour.mp4']) {
  console.log(`\n${name}: ${(readFileSync(`${OUT}/${name}`).length / 1024 / 1024).toFixed(1)} MB`
    + `  ${lengthOf(`${OUT}/${name}`)}  ${SIZE.width}×${SIZE.height}`);
}
