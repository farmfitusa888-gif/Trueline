import { readFileSync } from 'node:fs';
import { openChromium } from '../../core/tools/browser.mjs';
import { check, URL, SP, pick, report, section } from './lib.mjs';

/**
 * Taking the walk's own photographs off, without losing the wrong ones.
 *
 * > "BUILD IT!" — batch photo delete. Deleting photographs one at a time on a
 * > phone, after a scan that took fifty of them, is unusable.
 *
 * A28 covers the other batch delete: the photographs somebody takes of a damage
 * mark. This one covers the frames **the scan itself takes** — the fifty — which
 * had no delete anywhere in the app at all, and which are the ones that were
 * being described. They live in `Loaded.photos`, they carry camera poses, and
 * `WallPhotos` is where a person meets them.
 *
 * ## Why every check here is written the way it is
 *
 * Sam has already lost real work in this app once. A room with **53
 * photographs** went by accident, because a rename had not shown up on the room
 * screen and there was no way to tell one file from another before it was too
 * late. The failure a batch delete produces is silent: the screen looks right,
 * the count adds up, and the photograph that is gone is the one nobody can take
 * again.
 *
 * So nothing here is checked by reading a number the app printed. Every frame is
 * read off the page **by its own file name**, the set to delete is chosen on
 * this side, and the survivors are compared by identity — on the wall that was
 * deleted from and on every other wall in the room. Three going and three coming
 * back is exactly what taking the wrong three looks like.
 *
 * ## What it runs on
 *
 * Sam's own dining/living scan: nine walls, two open spans, an eleven-corner
 * outline that is not a rectangle. The camera poses are built here from **that
 * scan's own wall transforms**, in the scan's own ARKit world coordinates — a
 * person standing back from each real wall and shooting it, 1.5 m up, holding
 * the phone in portrait the way both of Sam's real captures measure. They are
 * not recorded frames and this file does not pretend they are; they are a walk
 * of a real room, and `importPhotos` places every one of them.
 *
 * Two walks, because they ask different questions:
 *
 *   - **54 frames**, which is the batch that was complained about. In a room
 *     walked that thoroughly nothing is anybody's last photograph, so the
 *     warning about that has to stay quiet — a warning that fires every time is
 *     a warning nobody reads on the day it is right.
 *   - **9 frames**, the same room walked in a hurry. Now there are walls with
 *     exactly one photograph, and the app has to say so before one goes.
 *
 * And it runs at a **real phone height**, 430 by 800, not the shared harness's
 * 430 by 1600 where nothing is ever below the fold. A confirmation a thumb
 * cannot see is the same thing as a control that does not work, which is what
 * A31 was written for.
 */

/* ========================================================================== */
/*  A walk of the real room, from the real room's own wall transforms.        */
/* ========================================================================== */

const scan = JSON.parse(readFileSync(`${SP}/dining.json`, 'utf8'));

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
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * Somebody walking the room and shooting each wall, `perWall` times each.
 *
 * Every camera stands in front of a wall RoomPlan actually recorded, backed off
 * toward the middle of the floor, 1.5 m up. The camera's own X axis points at
 * the floor, which is a phone held upright — the number `capture.ts` measured
 * across all 55 photographs of Sam's garage was -0.978 against world up, and
 * that is the orientation this reproduces. One lens for the whole walk, so the
 * wedge it casts on the plan is about 53 degrees across: a phone in portrait.
 */
function walkOf(perWall) {
  const centres = scan.walls.map((w) => col(w.transform, 3));
  const middle = centres
    .reduce((acc, c) => add(acc, c), [0, 0, 0])
    .map((v) => v / centres.length);
  const floorY = col(scan.floors[0].transform, 3)[1];
  const UP = [0, 1, 0];

  const photos = [];
  scan.walls.forEach((wall, w) => {
    const centre = centres[w];
    const alongWall = unit(col(wall.transform, 0));
    for (let k = 0; k < perWall; k += 1) {
      const slide = perWall === 1 ? 0 : (k / (perWall - 1) - 0.5) * wall.dimensions[0] * 0.6;
      const aim = add(centre, mul(alongWall, slide));
      const inward = sub(middle, aim);
      const reach = Math.hypot(inward[0], inward[2]);
      const back = Math.min(1.1 + 0.25 * (k % 3), reach * 0.55);
      const stand = add(aim, mul(unit([inward[0], 0, inward[2]]), back));
      const eye = [stand[0], floorY + 1.5, stand[2]];
      const target = [aim[0], floorY + 1.35, aim[2]];

      const f = unit(sub(target, eye));
      const upInImage = unit(sub(UP, mul(f, dot(f, UP))));
      const rightInImage = unit(cross(f, upInImage));
      // Portrait, so the image's own X axis runs down the world and its Y axis
      // runs across the room. That is why the wedge on the plan comes off the
      // short edge of the frame and not the long one.
      const X = mul(upInImage, -1);
      const Y = rightInImage;
      const Z = mul(f, -1);
      const n = photos.length;
      photos.push({
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

  return {
    schema: 'trueline.photos.v1',
    capturedAt: '2026-08-19T14:00:00Z',
    device: 'iPhone15,3',
    photos,
  };
}

const THOROUGH = walkOf(6); // 54 frames — the batch that was complained about.
const HURRIED = walkOf(1); // 9 frames — the same room, walked in a hurry.

/* ========================================================================== */
/*  A phone, with the app behind it and the scan's folder answering.          */
/* ========================================================================== */

const problems = [];

/**
 * Opens the app the way a phone does: the capture parked before a line of the
 * bundle runs, and the photographs answered out of the scan's own folder.
 *
 * The folder matters. `WallPhotos` builds every `src` as `photos/<file>`, and
 * with nothing serving that path every picture 404s and the strip drops it. On
 * the phone the app answers those requests out of the capture — see
 * `WebBundle.swift` — so this answers them too, with the audit's own JPEG.
 *
 * 430 by 800: an iPhone 15 Pro Max with the browser's own chrome taken off.
 */
async function openPhone(payload) {
  const browser = await openChromium();
  const ctx = await browser.newContext({
    viewport: { width: 430, height: 800 },
    acceptDownloads: true,
  });
  await ctx.route('**/photos/**', (route) =>
    route.fulfill({ path: `${SP}/damage-photo.jpg`, contentType: 'image/jpeg' })
  );
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push('console: ' + m.text());
  });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  await page.addInitScript((parked) => {
    window.__sent = {};
    window.webkit = { messageHandlers: {} };
    for (const name of ['saved', 'thumbnail', 'company', 'photo', 'calendar', 'trouble', 'mark', 'draft', 'voice', 'haptic']) {
      window.__sent[name] = [];
      window.webkit.messageHandlers[name] = {
        postMessage(body) {
          window.__sent[name].push(body);
        },
      };
    }
    window.truelinePayload = parked;
  }, payload);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  return { browser, ctx, page };
}

/* ========================================================================== */
/*  Reading the strip: by name, never by number.                              */
/* ========================================================================== */

const STRIP = { name: 'Photographs of this wall' };

/** A wall, however the plan labels it — an open span is a side of the room too. */
const side = (id) => new RegExp(`^(Wall|Open span) ${id},`);

/** Every side of the room, read off the plan rather than assumed. */
async function sidesOn(page) {
  const labels = await page
    .getByRole('button', { name: /^(Wall|Open span) / })
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label') ?? n.innerText));
  const ids = [];
  for (const label of labels) {
    const found = /^(?:Wall|Open span) ([A-Za-z0-9_-]+),/.exec(label);
    if (found && !ids.includes(found[1])) ids.push(found[1]);
  }
  return ids;
}

/**
 * The file names on the strip, in the order the strip shows them.
 *
 * Off the tiles themselves, because the whole point of putting a file name
 * under every thumbnail is that a person can tell one frame from another before
 * it goes. If a check can read it, so can somebody holding the phone.
 */
async function tileNames(region) {
  const found = await region.locator('li').evaluateAll((nodes) =>
    nodes.map((node) => {
      const hit = /frame-\d{3}\.jpg/.exec(node.innerText ?? '');
      return hit ? hit[0] : '';
    })
  );
  return found.filter((n) => n !== '');
}

/**
 * How many tiles the strip is showing.
 *
 * By the tiles' own buttons rather than by the file names under them, because
 * the names only appear while somebody is picking — which is the point of them.
 */
async function tileCount(region) {
  return region.getByRole('button', { name: /^Photograph / }).count();
}

/** Puts the strip into picking, which is also what lifts the twelve cap. */
async function startPicking(page, region) {
  const button = region.getByRole('button', { name: 'Pick several' });
  if (await button.count()) {
    await button.click();
    await page.waitForTimeout(250);
  }
}

async function stopPicking(page, region) {
  const done = region.getByRole('button', { name: 'Done picking' });
  if (await done.count()) {
    await done.click();
    await page.waitForTimeout(150);
  }
}

/** Every frame this side of the room has, by name — not just the best twelve. */
async function framesOn(page, wallId) {
  await pick(page, side(wallId));
  await page.waitForTimeout(250);
  const region = page.getByRole('region', STRIP);
  if ((await region.count()) === 0) return [];
  await startPicking(page, region);
  const names = await tileNames(region);
  await stopPicking(page, region);
  return names;
}

/**
 * How many photographs the whole scan still holds, straight out of the model.
 *
 * There is no counter on the screen for it, and there should not be — but the
 * confirmation says "N photographs stay in this scan", which is that number
 * worked out by `plannedScanDeletion` from the list it was handed. So one
 * photograph is aimed at, the sentence is read, and the delete is backed out of
 * without touching anything. A count read this way cannot be the count the
 * strip happens to be showing.
 */
async function scanTotal(page, region) {
  await startPicking(page, region);
  await region.getByRole('button', { name: /^Photograph 1 of / }).click();
  await page.waitForTimeout(150);
  await region.getByRole('button', { name: /^Delete 1 photograph$/ }).click();
  await page.waitForTimeout(300);
  const said = await region
    .getByRole('alertdialog', { name: 'Before these photographs go' })
    .innerText();
  await region.getByRole('button', { name: 'Keep them' }).click();
  await page.waitForTimeout(150);
  await stopPicking(page, region);
  const found = /(\d+) photographs? stay in this scan\./.exec(said);
  // The one being aimed at is not staying, so it has to be added back on.
  return found ? Number(found[1]) + 1 : -1;
}

/* ========================================================================== */
/*  1. The thorough walk: fifty-odd frames, and a wall with plenty of them.    */
/* ========================================================================== */

let { browser, ctx, page } = await openPhone({
  room: scan,
  photos: THOROUGH,
  fileName: 'dining',
  subscribed: true,
});

await section(page, 'Plan');
await page.waitForTimeout(400);

const sides = await sidesOn(page);
check('a real scan opens, with every side of the room on it',
  sides.length >= 9, sides.join(', '));

await pick(page, side(sides[0]));
await page.waitForTimeout(400);
const strip = page.getByRole('region', STRIP);
check('a side with photographs has a strip of them', (await strip.count()) === 1);

/**
 * Whether this build can actually delete a scan photograph.
 *
 * `WallPhotos` takes an optional `onPhotos`, and everything to do with deleting
 * is absent without it — not greyed, not dead when pressed: absent. That is
 * deliberate, because a delete button that silently does nothing is the one
 * failure a person cannot tell apart from a delete of the wrong thing. So when
 * the wiring is missing this part proves the control is genuinely gone rather
 * than sitting there, says which file supplies it, and stops.
 */
const wired = (await strip.getByRole('button', { name: 'Pick several' }).count()) === 1;
if (!wired) {
  check('a half-wired build shows no way to pick several', true);
  check('and no delete button either, rather than one that does nothing',
    (await strip.getByRole('button', { name: /^Delete \d+ photograph/ }).count()) === 0);
  check('and no select-all left stranded on the screen',
    (await strip.getByRole('button', { name: 'Select all' }).count()) === 0);
  check('the app is wired to delete a scan photograph', false,
    'App.tsx does not pass onPhotos to WallPhotos, and state.ts has no scanPhotos ' +
      'action. Both edits are in scratchpad/integration/scanphotos.md, ready to apply.');
  const missing = report('A37 — taking the walk\'s own photographs off, on a real scan');
  await ctx.close();
  await browser.close();
  process.exit(missing > 0 ? 1 : 0);
}
check('the app is wired to delete a scan photograph', true);

// Every side's frames, by name, before anything is touched. This is the whole
// room's worth of evidence, and after the delete every one of these lists has
// to be exactly itself minus the ones that were picked.
const before = new Map();
for (const id of sides) before.set(id, await framesOn(page, id));
const everyFrame = new Set([...before.values()].flat());
check('the walk reaches the screen, frame by frame',
  everyFrame.size === THOROUGH.photos.length,
  `${everyFrame.size} on screen, ${THOROUGH.photos.length} in the walk`);

// Everything below identifies frames by their own file names, because a count
// proves nothing: three going and three staying is what taking the wrong three
// looks like. The name under each thumbnail is what makes that possible, so if
// it is not on the screen there is nothing below worth running — and saying so
// beats a stack trace forty lines later.
if (everyFrame.size !== THOROUGH.photos.length) {
  check('the strip can be read frame by frame, which every check below rests on', false,
    `${everyFrame.size} file names read off the tiles for ${THOROUGH.photos.length} frames`);
  const unreadable = report('A37 — taking the walk\'s own photographs off, on a real scan');
  await ctx.close();
  await browser.close();
  process.exit(unreadable > 0 ? 1 : 0);
}

// The side with the most frames on it: the one somebody would actually want to
// thin out, and the one where the twelve cap bites.
const busiest = [...before.entries()].sort((a, b) => b[1].length - a[1].length)[0][0];
await pick(page, side(busiest));
await page.waitForTimeout(300);

const onWall = before.get(busiest);
let t = await strip.innerText();
check('the heading counts every photograph of the wall, not the few it shows',
  new RegExp(`^${onWall.length} photographs of this wall`).test(t.trim()), t.slice(0, 200));
check('and says it is only showing the best twelve',
  /The best 12/.test(t), t.slice(0, 300));
const capped = await tileCount(strip);
check('twelve is what it shows', capped === 12, `${capped} tiles`);

/* ==========================================================================
   2. Picking. Fifty taps is the reason this exists, so select all and clear
      are not conveniences — and the count is never left to be worked out
      from which thumbnails happen to be ringed.
   ========================================================================== */

await startPicking(page, strip);
t = await strip.innerText();
check('picking says how many are picked, in words',
  new RegExp(`0 of ${onWall.length} picked`).test(t), t.slice(0, 300));
check('and picking lifts the twelve, so a wall can be cleared in one go',
  (await tileNames(strip)).length === onWall.length,
  `${(await tileNames(strip)).length} tiles for ${onWall.length} photographs`);
check('there is nothing to delete until something is picked',
  (await strip.getByRole('button', { name: /^Delete \d+ photograph/ }).count()) === 0);

// The 53 photographs went because there was no way to tell one file from
// another. Every tile says which file it is, on screen, before anything goes.
const named = await tileNames(strip);
check('every frame shows its own file name while picking',
  named.length === onWall.length && named.every((n) => /^frame-\d{3}\.jpg$/.test(n)),
  named.join(', '));
check('and no two tiles are the same file',
  new Set(named).size === named.length, named.join(', '));

await strip.getByRole('button', { name: 'Select all' }).click();
await page.waitForTimeout(250);
t = await strip.innerText();
check('select all takes every one',
  new RegExp(`${onWall.length} of ${onWall.length} picked`).test(t), t.slice(0, 300));
check('and every thumbnail says so in words, not only with a ring round it',
  (await strip.getByText('Picked', { exact: true }).count()) === onWall.length,
  `${await strip.getByText('Picked', { exact: true }).count()} of ${onWall.length}`);

await strip.getByRole('button', { name: 'Clear' }).click();
await page.waitForTimeout(250);
check('clear puts them all back',
  new RegExp(`0 of ${onWall.length} picked`).test(await strip.innerText()));
check('and nothing has left the wall by picking or unpicking',
  (await tileNames(strip)).join('|') === named.join('|'));

// Three of them, chosen here rather than by the app: the second, fourth and
// fifth. If the delete is off by one this is where it shows.
const wanted = [named[1], named[3], named[4]];
for (const n of [2, 4, 5]) {
  await strip.getByRole('button', { name: `Photograph ${n} of ${onWall.length}` }).click();
  await page.waitForTimeout(80);
}
check('the count follows the taps',
  new RegExp(`3 of ${onWall.length} picked`).test(await strip.innerText()));

/* ==========================================================================
   3. What it says before anything goes, and where on the screen it says it.
   ========================================================================== */

const deleteButton = strip.getByRole('button', { name: 'Delete 3 photographs' });
await deleteButton.scrollIntoViewIfNeeded();
const buttonBox = await deleteButton.boundingBox();
await deleteButton.click();
await page.waitForTimeout(300);

const asking = strip.getByRole('alertdialog', { name: 'Before these photographs go' });
check('a batch delete asks first', (await asking.count()) === 1);
t = await asking.innerText();

check('it says how many are going, in words', /Delete 3 photographs\./.test(t), t);
check('it says how many are left in the whole scan, not just on this wall',
  new RegExp(`${THOROUGH.photos.length - 3} photographs stay in this scan\\.`).test(t), t);
check('it says which side owns the truth — the record goes, the file stays',
  /picture files stay in the scan's folder/.test(t) &&
    /rather than wiping anything off the phone/.test(t), t);
check('it says what can be taken back, and how far that reaches',
  /put them back until you leave this screen/.test(t) &&
    /do not come back on their own/.test(t), t);
// A room walked this thoroughly has no wall resting on one frame, and a warning
// that fires anyway is a warning nobody reads on the day it is right.
check('it does not cry wolf about a last photograph when there is not one',
  !/only photograph of a wall/.test(t) && !/Afterwards nothing shows/.test(t), t);

// Measured, not guessed. A31's lesson: a warning a thumb cannot see is the same
// thing as a control that does not work.
const tall = page.viewportSize().height;
const askBox = await asking.boundingBox();
check('the warning is on the screen at a real phone height',
  askBox !== null && askBox.y >= 0 && askBox.y <= tall,
  `dialog at y=${askBox ? Math.round(askBox.y) : 'none'}, viewport ${tall}`);
check('and it is beside the button that was pressed, not a panel above it',
  askBox !== null && Math.abs(askBox.y - buttonBox.y) < 150,
  `${askBox ? Math.round(Math.abs(askBox.y - buttonBox.y)) : 'none'}px from the button`);

// Backing out has to be free.
await asking.getByRole('button', { name: 'Keep them' }).click();
await page.waitForTimeout(300);
check('keeping them takes nothing off',
  (await tileNames(strip)).join('|') === named.join('|'), (await tileNames(strip)).join(', '));
check('and the picking is still where it was',
  new RegExp(`3 of ${onWall.length} picked`).test(await strip.innerText()));

/* ==========================================================================
   4. The delete, and putting it back. Checked by name, because three going
      and three staying is also what taking the wrong three looks like.
   ========================================================================== */

await strip.getByRole('button', { name: 'Delete 3 photographs' }).click();
await page.waitForTimeout(200);
await strip.getByRole('button', { name: 'Delete them' }).click();
await page.waitForTimeout(700);

t = await strip.innerText();
check('the screen says what was deleted and how far the undo reaches',
  /3 photographs deleted\./.test(t) && /go back until you leave this screen/.test(t),
  t.slice(0, 600));

await startPicking(page, strip);
const after = await tileNames(strip);
const expected = named.filter((n) => !wanted.includes(n));
check('three of them went', after.length === named.length - 3,
  `${named.length} before, ${after.length} after`);
check('and the ones left are exactly the ones nobody picked, by name',
  after.join('|') === expected.join('|'),
  `left ${after.join(', ')} — expected ${expected.join(', ')}`);
check('none of the three that were picked is still on the wall',
  wanted.every((n) => !after.includes(n)), `${wanted.join(', ')} vs ${after.join(', ')}`);
check('and no photograph appeared that was never there',
  after.every((n) => named.includes(n)), after.join(', '));
await stopPicking(page, strip);

await strip.getByRole('button', { name: 'Put them back' }).click();
await page.waitForTimeout(700);
await startPicking(page, strip);
const back = await tileNames(strip);
check('put them back brings back every one, in the order they were in',
  back.join('|') === named.join('|'), `${back.join(', ')} vs ${named.join(', ')}`);
await stopPicking(page, strip);
const whole = await scanTotal(page, strip);
check('and the whole scan is whole again', whole === THOROUGH.photos.length,
  `scan holds ${whole}`);

/* ==========================================================================
   5. The same three again, this time left off — and every other side of the
      room checked by identity, because a frame of one wall is very often a
      frame of the wall beside it.
   ========================================================================== */

await startPicking(page, strip);
for (const n of [2, 4, 5]) {
  await strip.getByRole('button', { name: `Photograph ${n} of ${onWall.length}` }).click();
  await page.waitForTimeout(80);
}
await strip.getByRole('button', { name: 'Delete 3 photographs' }).click();
await page.waitForTimeout(200);
await strip.getByRole('button', { name: 'Delete them' }).click();
await page.waitForTimeout(700);
await strip.getByRole('button', { name: 'Leave them off' }).click();
await page.waitForTimeout(300);

const left = await scanTotal(page, strip);
check('the scan lost exactly three photographs and no more',
  left === THOROUGH.photos.length - 3, `scan holds ${left}`);

const nowByWall = new Map();
const elsewhereWrong = [];
for (const id of sides) {
  const now = await framesOn(page, id);
  nowByWall.set(id, now);
  const should = before.get(id).filter((n) => !wanted.includes(n));
  if (now.join('|') !== should.join('|')) {
    elsewhereWrong.push(`${id}: ${now.join(',')} — expected ${should.join(',')}`);
  }
}
check('every side of the room lost those three and nothing else',
  elsewhereWrong.length === 0, elsewhereWrong.join(' | '));

/* ==========================================================================
   6. Clearing a wall, which is the thing that was actually asked for — and
      the walls left with nothing, named before it happens rather than after.
   ========================================================================== */

const thinnest = [...nowByWall.entries()]
  .filter(([, list]) => list.length > 0)
  .sort((a, b) => a[1].length - b[1].length)[0][0];
await pick(page, side(thinnest));
await page.waitForTimeout(300);
await startPicking(page, strip);
const thinNames = await tileNames(strip);
await strip.getByRole('button', { name: 'Select all' }).click();
await page.waitForTimeout(200);
await strip.getByRole('button', { name: `Delete ${thinNames.length} photographs` }).click();
await page.waitForTimeout(300);
t = await strip.getByRole('alertdialog', { name: 'Before these photographs go' }).innerText();

const blinded = /Afterwards nothing shows ([^.]+)\./.exec(t);
check('clearing a wall names the walls that will have nothing left', blinded !== null, t);
check('and says which of them gets argued about later', /argued about later/.test(t), t);

await strip.getByRole('button', { name: 'Delete them' }).click();
await page.waitForTimeout(700);

if (blinded) {
  // The warning said which walls go dark. Checked on those walls' own screens,
  // which is a different code path answering the same question.
  const promised = blinded[1]
    .split(/,| and /)
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map((s) => (/^Wall (\d+)$/.test(s) ? `wall-${/^Wall (\d+)$/.exec(s)[1]}` : s));
  const wrong = [];
  for (const id of sides) {
    await pick(page, side(id));
    await page.waitForTimeout(250);
    const dark = (await page.locator('body').innerText()).includes('No photograph shows this wall');
    if (promised.includes(id) !== dark) {
      wrong.push(`${id}: ${dark ? 'has nothing' : 'still has photographs'}`);
    }
  }
  check('exactly the walls it named are the walls with nothing left',
    wrong.length === 0, `named ${promised.join(', ')} — wrong: ${wrong.join(' | ')}`);
}

/* ==========================================================================
   7. Put down and picked up again. A delete that comes back is not a delete,
      and a survivor that does not come back is the 53 photographs.
   ========================================================================== */

await pick(page, side(busiest));
await page.waitForTimeout(300);
await startPicking(page, strip);
const survivorsHere = await tileNames(strip);
await stopPicking(page, strip);

// The saved room, as the app itself would hand it back next time. This is the
// path the finality sentence promises — "the saved room is what opens next
// time" — read out of the browser's own storage rather than made up here.
const saved = await page.evaluate(() => window.localStorage.getItem('trueline.room.v1:dining'));
check('the room was saved after the delete', typeof saved === 'string' && saved.length > 0);

await ctx.close();
await browser.close();

({ browser, ctx, page } = await openPhone({ saved, subscribed: true }));
await section(page, 'Plan');
await page.waitForTimeout(400);
await pick(page, side(busiest));
await page.waitForTimeout(400);
const reopened = page.getByRole('region', STRIP);
await startPicking(page, reopened);
const afterReload = await tileNames(reopened);
check('the survivors come back, by name and in order',
  afterReload.join('|') === survivorsHere.join('|'),
  `${afterReload.join(', ')} vs ${survivorsHere.join(', ')}`);
check('and nothing that was deleted comes back with them',
  [...wanted, ...thinNames].every((n) => !afterReload.includes(n)), afterReload.join(', '));
check('the survivors still have their pictures',
  !(await reopened.innerText()).includes('Not on this device'),
  (await reopened.innerText()).slice(0, 400));
await ctx.close();
await browser.close();

/* ==========================================================================
   8. The same room, walked in a hurry. Now a frame really is the only picture
      of a wall, and that has to be said out loud before it goes.
   ========================================================================== */

({ browser, ctx, page } = await openPhone({
  room: scan,
  photos: HURRIED,
  fileName: 'dining-quick',
  subscribed: true,
}));
await section(page, 'Plan');
await page.waitForTimeout(400);

const quickSides = await sidesOn(page);
let onlyOne = null;
for (const id of quickSides) {
  const list = await framesOn(page, id);
  if (list.length === 1) {
    onlyOne = { id, file: list[0] };
    break;
  }
}
check('a hurried walk leaves a wall with exactly one photograph of it',
  onlyOne !== null, quickSides.join(', '));

if (onlyOne) {
  await pick(page, side(onlyOne.id));
  await page.waitForTimeout(300);
  const quick = page.getByRole('region', STRIP);
  await startPicking(page, quick);
  t = await quick.innerText();
  check('the tile itself says it is the only photograph of a wall',
    /Only photograph of /.test(t), t.slice(0, 400));

  await quick.getByRole('button', { name: /^Photograph 1 of 1$/ }).click();
  await page.waitForTimeout(150);
  await quick.getByRole('button', { name: /^Delete 1 photograph$/ }).click();
  await page.waitForTimeout(300);
  const dialog = quick.getByRole('alertdialog', { name: 'Before these photographs go' });
  t = await dialog.innerText();
  check('the confirmation names it as somebody\'s last photograph',
    /1 of these is the only photograph of a wall\./.test(t), t);
  check('and names the wall that is about to have nothing showing it',
    /Afterwards nothing shows /.test(t), t);
  check('it refuses nothing — it says what happens and lets the person decide',
    (await dialog.getByRole('button', { name: 'Delete them' }).count()) === 1, t);

  await dialog.getByRole('button', { name: 'Delete them' }).click();
  await page.waitForTimeout(700);
  await pick(page, side(onlyOne.id));
  await page.waitForTimeout(400);
  check('and it was telling the truth: that wall now has no photograph at all',
    (await page.locator('body').innerText()).includes('No photograph shows this wall'),
    (await page.locator('body').innerText()).slice(0, 400));
}

check('no console or page errors across the whole run', problems.length === 0, problems.join(' | '));

const bad = report('A37 — taking the walk\'s own photographs off, on a real scan');
await ctx.close();
await browser.close();
process.exit(bad > 0 ? 1 : 0);
