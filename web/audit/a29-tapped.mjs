import { readFileSync } from 'node:fs';
import { openChromium } from '../../core/tools/browser.mjs';
import { check, contrast, noise, openAsApp, payingBrowser, pick, report, reportEvenIfItDies, section, sentTo, SP, URL } from './lib.mjs';

// Say what was learned even if this part dies part way through.
reportEvenIfItDies('A29 — knowing you tapped the wall');

/**
 * Tapping a wall, and being able to tell that you did.
 *
 * > "WHEN YOU SELECT THE WALL TO MAKE CHANGES TO, THE WALL IS SUPPOSED TO
 * >  ANIMATE, BUT YOU CANT SEE MUCH OF A DIFFERENCE, AND YOU DONT EVEN KNOW
 * >  THAT YOU CLICKED IT. WHAT CAN WE DO TO FIX THAT?"
 *
 * ## What was there, and why no check saw it
 *
 * A selected wall got one extra element and nothing else on the drawing moved:
 *
 *     <line ... stroke="rgb(var(--c-focus))" strokeWidth={16} strokeOpacity={0.28} />
 *
 * A 28%-opacity halo, behind the wall, in a blue a hair off the sheet's own
 * grey, under the finger that put it there. Eight audit parts select a wall on
 * their way to something else and every one of them was satisfied by
 * `aria-pressed="true"` — which was true, and told nobody anything about
 * whether a person could see it. **A check that reads an attribute proves the
 * state changed, not that the drawing did.**
 *
 * So nothing here asserts a class name or an attribute this app wrote. Every
 * number below comes out of `getComputedStyle` on the live drawing, and the
 * ones that are about being able to see something go through `contrast()`,
 * which is WCAG's own formula and does not care what the code intended.
 *
 * ## The five things that have to be true
 *
 *   1. The tapped wall's **own line** changes — colour and width, not just a
 *      halo behind it, because a halo is the part a thumb lands on.
 *   2. The rest of the drawing **drops back**, and stays readable while it does.
 *      Sam's own condition: somebody comparing the tapped wall to the one
 *      opposite still has to be able to see the one opposite.
 *   3. It **pulses twice and stops**, and settles exactly where it started.
 *   4. Somebody who asked for **no motion** gets none, and still gets all of
 *      part 1 — the thick amber has to carry the message on its own.
 *   5. The **phone taps the finger**, once per pick, through a real message
 *      handler; and outside the app the same tap does nothing and throws
 *      nothing.
 *
 * Throughout, the wall stays a `role="button"` with `aria-pressed` and is
 * picked with the keyboard rather than the mouse — `pick()` focuses it and
 * presses Enter — so the screen-reader path is what every measurement above is
 * measured through.
 */

const ROOM = JSON.parse(readFileSync(`${SP}/kitchen.json`, 'utf8'));
const HANDED = { fileName: 'Kitchen', room: ROOM, subscribed: true };

/**
 * WCAG 1.4.11's floor for a graphic somebody has to make out.
 *
 * The rule this part holds the dimming to. `Plan.tsx` picks 0.7 as the lowest
 * opacity at which every wall colour that carries a measurement still clears
 * it; this is where that claim gets tested against the real composite rather
 * than against the arithmetic in the comment.
 */
const READABLE = 3;

/** An `rgb(...)` string from a `--c-*` token, which is stored as bare channels. */
const tone = (channels) => `rgb(${channels.trim().split(/\s+/).join(', ')})`;

/**
 * What a colour actually looks like once its group's opacity is applied.
 *
 * The whole point of the dimming check. `getComputedStyle` on a dimmed wall
 * reports the stroke it was *told* to paint — `opacity` on the parent group is
 * a compositing instruction and never touches the child's computed colour — so
 * reading the stroke and calling it legible would be reading the code's
 * intention back to itself. This is what reaches the eye.
 */
function composited(rgb, alpha, ground) {
  const [c, g] = [rgb, ground].map((v) => String(v).match(/[\d.]+/g).slice(0, 3).map(Number));
  return `rgb(${c.map((v, i) => Math.round(alpha * v + (1 - alpha) * g[i])).join(', ')})`;
}

/**
 * Everything the drawing is currently saying about one wall, measured.
 *
 * Every reader below goes through `?.`, for the reason `sentTo` in `lib.mjs`
 * gives: a part asking "did the casing appear" should get `undefined` and fail
 * its own check with a number beside it, not a TypeError two lines later. The
 * first run of this file against a deliberately reverted `Plan.tsx` did exactly
 * that -- it threw on the missing casing and printed no report at all, which is
 * a check that cannot be watched failing.
 *
 * The hit target, the casing and the wall's own line are three `<line>`
 * children of one `<g>`, told apart by what they are rather than by their
 * order: the hit target is the transparent one, the casing carries the class
 * the stylesheet animates, and the wall is what is left. Reading them by index
 * would break the first time somebody adds an element to a wall.
 */
async function wall(page, label) {
  return page.evaluate((name) => {
    const group = [...document.querySelectorAll('svg g[role="button"]')].find((g) =>
      (g.getAttribute('aria-label') ?? '').startsWith(name)
    );
    if (!group) return null;
    const read = (el) => {
      const s = getComputedStyle(el);
      return {
        stroke: s.stroke,
        width: parseFloat(s.strokeWidth),
        strokeOpacity: parseFloat(s.strokeOpacity),
        animation: s.animationName,
        iterations: s.animationIterationCount,
      };
    };
    const lines = [...group.querySelectorAll(':scope > line')];
    const casing = lines.find((l) => l.classList.contains('trueline-picked-halo'));
    const band = lines.find((l) => l.classList.contains('trueline-picked-band'));
    // The LAST painted line that is not the casing, not the first. Written as
    // `find` this measured the wrong element the moment the drawing was
    // reverted on purpose: the old selection drew its halo BEFORE the wall, so
    // "the first painted line" was the halo, and two checks passed by
    // comparing the halo to itself. The wall's own line is the last thing its
    // group paints, and `lines` below pins the count so a wall that grows
    // another element fails loudly instead of being measured wrongly.
    const painted = lines.filter(
      (l) => !l.classList.contains('trueline-picked-halo')
        && !l.classList.contains('trueline-picked-band')
        && getComputedStyle(l).stroke !== 'rgba(0, 0, 0, 0)'
    );
    const body = painted[painted.length - 1];
    return {
      lines: lines.length,
      pressed: group.getAttribute('aria-pressed'),
      role: group.getAttribute('role'),
      focusable: group.getAttribute('tabindex'),
      named: group.getAttribute('aria-label'),
      opacity: parseFloat(getComputedStyle(group).opacity),
      body: body ? read(body) : null,
      band: band ? read(band) : null,
      casing: casing ? read(casing) : null,
    };
  }, label);
}

/** The rest of the sheet: what is dimmed and what is not. */
async function sheet(page) {
  return page.evaluate(() => {
    const opacity = (sel) => {
      const el = document.querySelector(sel);
      return el ? parseFloat(getComputedStyle(el).opacity) : null;
    };
    const root = getComputedStyle(document.documentElement);
    return {
      styles: document.querySelectorAll('svg style').length,
      // One per wall, in the same order the walls are drawn in. Read as a list
      // rather than as "the first one": the first one belongs to whichever wall
      // is drawn first, which on a picked plan is the one that does NOT dim.
      dimensions: [...document.querySelectorAll('svg g[aria-hidden="true"]')].map(
        (g) => parseFloat(getComputedStyle(g).opacity)
      ),
      titleBlock: opacity('svg g[transform^="translate(0 "]'),
      accent: root.getPropertyValue('--c-accent'),
      // What a picked wall is drawn in: the one colour on this sheet that is
      // not a provenance, and the furthest thing from the ground on either
      // theme — near white on dark, which is what Sam asked for.
      ink: root.getPropertyValue('--c-ink'),
      raise: root.getPropertyValue('--c-raise'),
      scanned: root.getPropertyValue('--c-scanned'),
    };
  });
}

/* ==========================================================================
   1 and 2. The tapped wall, and the drawing around it. Measured before and
   after, on the same two walls, in one page.
   ========================================================================== */

const { browser, ctx, page } = await openAsApp(HANDED);
await section(page, 'Plan');
await page.waitForTimeout(400);

const paint = await sheet(page);
const PICKED = tone(paint.ink);
const SHEET = tone(paint.raise);

check('nothing is selected, so the drawing carries no selection stylesheet at all',
  paint.styles === 0, `${paint.styles} <style> elements on an untouched plan`);

const restingPicked = await wall(page, 'Wall wall-1,');
const restingOther = await wall(page, 'Wall wall-3,');
check('every wall on the plan is a button that says whether it is picked',
  restingPicked.role === 'button' && restingPicked.pressed === 'false'
  && restingPicked.focusable === '0' && /^Wall wall-1, /.test(restingPicked.named),
  JSON.stringify(restingPicked));
check('and no wall is held back while nothing is picked',
  restingPicked.opacity === 1 && restingOther.opacity === 1,
  `${restingPicked.opacity} and ${restingOther.opacity}`);
check('an untouched wall is a hit target and a line, and nothing else',
  restingPicked.lines === 2 && restingOther.lines === 2,
  `${restingPicked.lines} and ${restingOther.lines} <line> children`);

// Focus, then Enter. The keyboard path and the screen-reader path are the same
// path, so everything measured from here down is measured through it.
await pick(page, /^Wall wall-1,/);
// Past two beats of 480 ms, so every number below is the settled state rather
// than a frame of the animation.
await page.waitForTimeout(1400);

const picked = await wall(page, 'Wall wall-1,');
const other = await wall(page, 'Wall wall-3,');
const after = await sheet(page);

/**
 * What colour the picked wall's own dimension number is drawn in.
 *
 * This is where provenance lives while a wall is selected, so it is read from
 * the DOM rather than assumed. `Label` draws two elements — a halo and the
 * text — so the fill is taken from the one that is not the halo.
 */
const pickedLabel = await page.evaluate(() => {
  const group = [...document.querySelectorAll('[data-panel="plan"] g[role="button"]')]
    .find((g) => (g.getAttribute('aria-label') || '').startsWith('Wall wall-1,'));
  if (!group) return null;
  const texts = [...group.querySelectorAll('text')];
  const inked = texts.map((n) => getComputedStyle(n).fill)
    .filter((f) => f && f !== 'none' && !/rgba\(0, 0, 0, 0\)/.test(f));
  return inked.length > 0 ? inked[inked.length - 1] : null;
});

check('the keyboard picks a wall and the wall says so',
  picked.pressed === 'true' && other.pressed === 'false',
  `picked ${picked.pressed}, other ${other.pressed}`);
check('and it is still a named button afterwards',
  picked.role === 'button' && picked.named === restingPicked.named, JSON.stringify(picked));

/* --------------------------------------------- the mark AT the wall changed */

check('the tapped wall is drawn inside a thick band of ink — near white on a dark sheet, at the wall itself',
  picked.band?.stroke === PICKED, `${picked.band?.stroke}, wanted ${PICKED}`);
check('and it is the palette’s own accent rather than a hex somebody typed here',
  /^rgb\(\d+, \d+, \d+\)$/.test(PICKED) && PICKED !== tone(paint.scanned),
  `--c-ink ${PICKED}, --c-scanned ${tone(paint.scanned)}`);

const grew = picked.band?.width / restingPicked.body?.width;
check('the mark at that wall gets thick — a measured multiple of what was there',
  grew >= 2.5, `${restingPicked.body?.width} → ${picked.band?.width} (×${grew.toFixed(2)})`);
check('and it is thicker than the wall opposite is, right now, on the same drawing',
  picked.band?.width > other.body?.width * 2,
  `picked ${picked.band?.width}, other ${other.body?.width}`);
check('no unpicked wall has a band',
  other.band === null, JSON.stringify(other.band));

// Provenance, and where it went.
//
// The first version of this feature painted the wall's own line amber outright
// and `a6-persist` caught it: a wall somebody had DRAGGED stopped being drawn in
// `--c-adjusted` for as long as it was selected, so the drawing stopped saying
// "this one was moved by hand" about the wall a person was moving by hand.
//
// The answer then was to keep the wall's own line on top of the band. That was
// sound, and it cost the feature: a thin coloured line down the middle of a
// white band is most of what a person sees, and Sam said twice — the second
// time after building it — that a tapped wall was still not noticeable.
//
// So the picked wall IS drawn in the picked colour now, and provenance moved
// rather than disappearing: this wall's own dimension number is drawn in its
// confidence colour, right beside it, and every other wall on the sheet still
// carries its own. The invariant is "a picked wall still says where its number
// came from", not "the wall's own line is untouched" — so that is what is
// checked, and it is checked on the thing that actually carries it.
check('the picked wall is drawn in the picked colour outright, not just banded',
  picked.body?.stroke === PICKED,
  `${picked.body?.stroke}, wanted ${PICKED}`);
check('and it is thick with it, not a hairline',
  picked.body?.width >= 24, `${picked.body?.width}`);
check("and the wall's own number still says where the measurement came from",
  pickedLabel !== null && pickedLabel === restingPicked.body?.stroke,
  `label ${pickedLabel}, wall was ${restingPicked.body?.stroke}`);

check('there is a casing round the band as well, in the same ink and wider still',
  picked.casing !== null && picked.casing?.stroke === PICKED
  && picked.casing?.width > picked.band?.width,
  JSON.stringify(picked.casing));
check('so a picked wall is a hit target, a casing, a band and a line — four, not two',
  picked.lines === 4 && other.lines === 2, `${picked.lines} picked, ${other.lines} not`);
check('and no unpicked wall has a casing',
  other.casing === null, JSON.stringify(other.casing));

check('the amber is legible against the sheet it is drawn on',
  contrast(PICKED, SHEET) >= READABLE,
  `${contrast(PICKED, SHEET).toFixed(2)}:1 against ${SHEET}`);

/* ------------------------------------------------------- everything else dims */

check('an unselected wall is held back by an amount it was not before',
  other.opacity < restingOther.opacity,
  `${restingOther.opacity} with nothing picked, ${other.opacity} with one picked`);
check('the picked wall is not held back at all',
  picked.opacity === 1, String(picked.opacity));

// The floor, against the real composite rather than against the stroke the
// element was told to paint. `opacity` on the group never reaches the child's
// computed colour, so reading the stroke here would prove nothing.
const dimmed = composited(other.body?.stroke, other.opacity, SHEET);
const readable = contrast(dimmed, SHEET);
// `other.opacity < 1` is part of the assertion rather than assumed by it: a
// drawing that dims nothing composites to itself and would be "readable"
// forever, which is how this check passed against the reverted plan.
check('and the wall opposite is still readable while it is held back',
  other.opacity < 1 && readable >= READABLE,
  `${other.body?.stroke} at ${other.opacity} is ${dimmed} — ${readable.toFixed(2)}:1, floor ${READABLE}`);
check('the drop is real rather than cosmetic: at least a fifth of the way down',
  other.opacity <= 0.8, String(other.opacity));

// Every dimension on the sheet except the picked wall's own, which stays where
// it was: the number beside the wall somebody tapped is half of what they
// tapped it to read, and holding it back would dim the thing being pointed at.
const held = after.dimensions.filter((o) => o < 1);
check('the notation goes further back than the building does',
  held.length === after.dimensions.length - 1 && Math.max(...held) < other.opacity,
  `dimension lines ${JSON.stringify(after.dimensions)}, walls ${other.opacity}`);
check("and the picked wall's own dimension is not held back with them",
  after.dimensions.filter((o) => o === 1).length === 1,
  JSON.stringify(after.dimensions));
check('and the title block does not dim — a sheet still says whose it is',
  after.titleBlock === 1, String(after.titleBlock));

/* ==========================================================================
   3. Two beats, then it stops.
   ========================================================================== */

check('the casing is what animates, and it is a real animation',
  picked.casing?.animation === 'trueline-picked', picked.casing?.animation);
check('it runs twice and then stops, rather than pulsing forever on a drawing',
  picked.casing?.iterations === '2', picked.casing?.iterations);
check('neither the band nor the wall line animates — only the casing round them',
  picked.body?.animation === 'none' && picked.band?.animation === 'none',
  `line ${picked.body?.animation}, band ${picked.band?.animation}`);
check('the stylesheet appears only once something is picked',
  after.styles === 1, `${after.styles} <style> elements`);

// Settling. Read mid-flight and again after both beats: the keyframes start and
// end where the element's own attributes are, so the second reading has to be
// the resting width. A pulse that ended somewhere else would leave the drawing
// permanently the wrong size and nothing else here would notice.
await pick(page, /^Wall wall-2,/);
await page.waitForTimeout(240);
const midBeat = await wall(page, 'Wall wall-2,');
await page.waitForTimeout(1400);
const settled = await wall(page, 'Wall wall-2,');
check('the casing really moves during the pulse rather than only changing opacity',
  midBeat.casing?.width > settled.casing?.width,
  `${midBeat.casing?.width} mid-beat, ${settled.casing?.width} settled`);
check('and it settles back exactly where its own attributes put it',
  settled.casing?.width === settled.band?.width + 14,
  `casing ${settled.casing?.width}, band ${settled.band?.width}`);
check('picking a second wall lets the first one go',
  (await wall(page, 'Wall wall-1,')).pressed === 'false');

check('no console or page errors while picking walls', noise().length === 0, noise().join(' | '));

/* ==========================================================================
   3b. The basement. Every number above was measured on the light ground, and
       this app follows the phone from a driveway at one in the afternoon into
       a basement with one bulb in about ten minutes. A dimming floor that only
       holds on white is a floor that fails half the time it is used, and the
       dark palette is not an inversion of the light one -- the ink stops short
       of white and the ground stops short of black -- so the composite has to
       be measured again rather than argued from the first one.
   ========================================================================== */

{
  const night = await openAsApp(HANDED, { scheme: 'dark' });
  await section(night.page, 'Plan');
  await pick(night.page, /^Wall wall-1,/);
  await night.page.waitForTimeout(1400);

  const paintDark = await sheet(night.page);
  const PICKED_DARK = tone(paintDark.ink);
  const GROUND = tone(paintDark.raise);
  const lit = await wall(night.page, 'Wall wall-1,');
  const dark = await wall(night.page, 'Wall wall-3,');

  check('in the dark the picked wall is near white, and thick with it',
    lit.band?.stroke === PICKED_DARK && lit.band?.width === picked.band?.width,
    `${lit.band?.stroke} at ${lit.band?.width} on ${GROUND}`);
  check('and that amber is legible against the dark sheet as well',
    contrast(PICKED_DARK, GROUND) >= READABLE,
    `${contrast(PICKED_DARK, GROUND).toFixed(2)}:1, ${PICKED_DARK} on ${GROUND}`);

  const nightDim = composited(dark.body?.stroke, dark.opacity, GROUND);
  const nightReadable = contrast(nightDim, GROUND);
  check('and the wall opposite survives the same dimming on the dark ground',
    dark.opacity < 1 && nightReadable >= READABLE,
    `${dark.body?.stroke} at ${dark.opacity} is ${nightDim} — ${nightReadable.toFixed(2)}:1`);

  await night.ctx.close();
  await night.browser.close();
}

/* ==========================================================================
   4. Somebody who asked for no motion. The thick amber has to carry it alone.
   ========================================================================== */

{
  const still = await openChromium();
  const stillCtx = await still.newContext({
    viewport: { width: 430, height: 1600 },
    reducedMotion: 'reduce',
  });
  // A paying contractor's browser, the way `open()` makes one. See `payingBrowser`.
  await payingBrowser(stillCtx);
  const stillPage = await stillCtx.newPage();
  await stillPage.addInitScript((parked) => {
    window.truelinePayload = parked;
  }, HANDED);
  await stillPage.goto(URL, { waitUntil: 'networkidle' });
  await stillPage.waitForTimeout(600);
  await section(stillPage, 'Plan');
  await pick(stillPage, /^Wall wall-1,/);
  await stillPage.waitForTimeout(500);

  const quiet = await wall(stillPage, 'Wall wall-1,');
  const quietOther = await wall(stillPage, 'Wall wall-3,');

  check('reduced motion: nothing on the picked wall animates at all',
    quiet.casing?.animation === 'none' && quiet.band?.animation === 'none'
    && quiet.body?.animation === 'none',
    `casing ${quiet.casing?.animation}, band ${quiet.band?.animation}, line ${quiet.body?.animation}`);
  // Both halves of this: the same as the moving version, AND actually the
  // amber. Written only as a comparison it goes green on any build where the
  // two agree, including one where neither of them does anything.
  check('reduced motion: the wall is still thick and inked, to the same numbers',
    quiet.band?.stroke === picked.band?.stroke && quiet.band?.width === picked.band?.width
    && quiet.band?.stroke === PICKED && quiet.band?.width >= 24,
    `${quiet.band?.stroke} at ${quiet.band?.width}, wanted ${PICKED} at 24 or more`);
  check('reduced motion: the casing is still there, at its resting width',
    quiet.casing?.width === quiet.band?.width + 14 && quiet.casing?.stroke === PICKED,
    `${quiet.casing?.width} in ${quiet.casing?.stroke}`);
  check('reduced motion: the rest of the drawing still drops back',
    quietOther.opacity === other.opacity && quietOther.opacity < 1,
    `${quietOther.opacity}, wanted ${other.opacity}`);

  await stillCtx.close();
  await still.close();
}

await ctx.close();
await browser.close();

/* ==========================================================================
   5. The phone taps the finger.
   ========================================================================== */

{
  // `openAsApp` installs the handlers the phone has, and `haptic` is newer than
  // that list. `lib.mjs` belongs to somebody else, so the handler is added here
  // on top of the ones it already parked and the page reloaded through both
  // init scripts — which is also a fair test of the real thing, where the
  // handlers exist before a line of the bundle runs.
  const app = await openAsApp(HANDED);
  await app.page.addInitScript(() => {
    window.__sent = window.__sent ?? {};
    window.__sent.haptic = [];
    window.webkit = window.webkit ?? { messageHandlers: {} };
    window.webkit.messageHandlers.haptic = {
      postMessage(body) {
        window.__sent.haptic.push(body);
      },
    };
  });
  await app.page.reload({ waitUntil: 'networkidle' });
  await app.page.waitForTimeout(600);
  await section(app.page, 'Plan');

  check('nothing has been asked of the phone before anybody touches anything',
    (await sentTo(app.page, 'haptic')).length === 0);

  await pick(app.page, /^Wall wall-1,/);
  await app.page.waitForTimeout(200);
  const first = await sentTo(app.page, 'haptic');
  check('picking a wall asks the phone to tap the finger that did it',
    first.length === 1, JSON.stringify(first));
  check('and it goes across with a version on it, like everything else on the bridge',
    first[0] !== undefined && Number.isInteger(first[0].version),
    JSON.stringify(first[0]));
  check('and it carries nothing else — the app decides what a tap feels like',
    first[0] !== undefined && Object.keys(first[0]).join() === 'version',
    JSON.stringify(first[0]));

  // Letting go is not landing on something. A haptic that fired both ways would
  // teach a thumb that the feeling means nothing in particular.
  await app.page.getByRole('button', { name: /^Wall wall-1,/ }).first().press('Enter');
  await app.page.waitForTimeout(300);
  check('letting a wall go does not buzz the phone',
    (await sentTo(app.page, 'haptic')).length === 1,
    JSON.stringify(await sentTo(app.page, 'haptic')));

  await pick(app.page, /^Wall wall-2,/);
  await app.page.waitForTimeout(200);
  check('and the next wall picked asks again',
    (await sentTo(app.page, 'haptic')).length === 2,
    JSON.stringify(await sentTo(app.page, 'haptic')));

  check('no console or page errors inside the app either',
    noise().length === 0, noise().join(' | '));

  await app.ctx.close();
  await app.browser.close();
}

/* ------------------------------------------------------------------------ */
/* A browser is not a phone. There is nothing to ask, and asking must cost
   nothing — no throw, no error in the console, and a wall that picks exactly as
   well as it does on a phone. This is the same page as parts 1-3, which ran
   with no `haptic` handler on it at all and finished green: the two `noise()`
   checks above are the proof, and this one says out loud that it was the point. */

{
  const plain = await openChromium();
  const plainCtx = await plain.newContext({ viewport: { width: 430, height: 1600 } });
  // A paying contractor's browser, the way `open()` makes one. See `payingBrowser`.
  await payingBrowser(plainCtx);
  const plainPage = await plainCtx.newPage();
  const trouble = [];
  plainPage.on('console', (m) => { if (m.type() === 'error') trouble.push(m.text()); });
  plainPage.on('pageerror', (e) => trouble.push(e.message));
  await plainPage.addInitScript((parked) => { window.truelinePayload = parked; }, HANDED);
  await plainPage.goto(URL, { waitUntil: 'networkidle' });
  await plainPage.waitForTimeout(600);

  const asked = await plainPage.evaluate(() => window.webkit?.messageHandlers?.haptic !== undefined);
  check('a browser has no phone to ask', asked === false, 'a message handler exists outside the app');

  await section(plainPage, 'Plan');
  await pick(plainPage, /^Wall wall-1,/);
  await plainPage.waitForTimeout(500);
  const outside = await wall(plainPage, 'Wall wall-1,');
  check('and the wall still picks, thick and inked, with nothing to tap the finger',
    outside.pressed === 'true' && outside.band?.stroke === PICKED
    && outside.band?.width === picked.band?.width,
    JSON.stringify(outside.band));
  check('asking for a feeling that cannot happen throws nothing',
    trouble.length === 0, trouble.join(' | '));

  await plainCtx.close();
  await plain.close();
}

const bad = report('A29 — knowing you tapped the wall');
process.exit(bad > 0 ? 1 : 0);
