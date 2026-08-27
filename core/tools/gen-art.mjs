/**
 * Draws the app icon and the launch screen, from the mark and the tokens.
 *
 *     node --experimental-strip-types core/tools/gen-art.mjs
 *     node --experimental-strip-types core/tools/gen-art.mjs --check
 *
 * ## Why these are generated rather than drawn once and kept
 *
 * The icon on disk before this was made by hand in an earlier session. It was
 * right, and it was right by coincidence: nothing tied it to the palette, so
 * the first time a colour moved it would have quietly become the only place in
 * the app still wearing the old one. The mark has the same problem in the other
 * direction -- it lives in `web/src/Mark.tsx` for the screens, and a second
 * hand-drawn copy inside a PNG is a second mark to keep in step.
 *
 * So both come from here: the geometry is the mark's own, the colours are
 * `core/src/design.ts`, and `--check` fails if what is on disk is not what this
 * would draw.
 *
 * ## What it writes
 *
 *   Assets.xcassets/AppIcon.appiconset/     light, dark and tinted, 1024
 *   Assets.xcassets/LaunchGround.colorset/  the ground, following the phone
 *   Assets.xcassets/LaunchMark.imageset/    the mark, light and dark, 1x-3x
 *
 * iOS 18 asks for three icons rather than one: the normal one, a dark one for a
 * dark home screen, and a tinted one it recolours itself. Ship one and the
 * system makes the other two by guessing, which on a dark icon means a muddy
 * grey square.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openChromium } from './browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const assets = join(root, 'ios', 'Trueline', 'Assets.xcassets');

const { NEUTRAL, MEANING } = await import(join(root, 'core', 'src', 'design.ts'));

/**
 * The mark, at whatever size is asked for.
 *
 * The geometry is lifted from `web/src/Mark.tsx` and is checked against it
 * below, so the icon and the wordmark on every screen are the same drawing:
 * a dimension line with end ticks -- a true length, the thing a tape gives you
 * and a scanner only estimates -- over a plumb line with the bob on the end.
 */
function mark(ink, bob) {
  return `<g stroke="${ink}" stroke-linecap="butt">
      <line x1="224" y1="300" x2="800" y2="300" stroke-width="46"/>
      <line x1="234" y1="234" x2="234" y2="366" stroke-width="24"/>
      <line x1="790" y1="234" x2="790" y2="366" stroke-width="24"/>
      <line x1="512" y1="300" x2="512" y2="596" stroke-width="46"/>
    </g>
    <polygon points="512,584 578,646 578,690 512,800 446,690 446,646" fill="${bob}"/>`;
}

/**
 * The icon.
 *
 * The mark sits in the middle at 62% of the square, which is close to what
 * Apple's own grid asks for and, more to the point, is what keeps the end ticks
 * off the corner radius at 40 pixels -- the size it will actually be in a
 * folder on a phone with sixty apps on it.
 *
 * `transparent` produces the tinted variant, which iOS recolours itself: it
 * wants the artwork as a greyscale mask on nothing, and anything it is given a
 * background for comes back as a grey square.
 */
function icon(ground, ink, bob) {
  // The mark's own INK box, not its viewBox. The viewBox in `Mark.tsx` carries
  // slack on every side, and scaling to it drew an icon with the mark small and
  // sitting high in a field of graphite. What is actually drawn runs from the
  // outside of the left tick to the outside of the right one, and from the top
  // of the ticks to the point of the bob.
  const LEFT = 234 - 12, RIGHT = 790 + 12;   // tick centres, less/plus half a stroke
  const TOP = 234 - 12, BOTTOM = 800;        // tick top, to the bob's point
  const w = RIGHT - LEFT;
  const h = BOTTOM - TOP;

  // 68% of the square. Enough presence to read at 40 pixels in a folder, and
  // still clear of the corner radius the system rounds off.
  const fill = 1024 * 0.68;
  const scale = fill / Math.max(w, h);
  const x = (1024 - w * scale) / 2;
  const y = (1024 - h * scale) / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  ${ground === 'transparent' ? '' : `<rect width="1024" height="1024" fill="${ground}"/>`}
  <g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(5)}) translate(${-LEFT} ${-TOP})">
    ${mark(ink, bob)}
  </g>
</svg>`;
}

/** The launch mark: the same drawing, transparent, for the asset catalogue. */
function launchMark(ink, bob) {
  // Cropped to the ink, the same as the icon, so the launch screen and the home
  // screen show the mark at the same weight rather than one of them padded.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="580" height="578" viewBox="222 222 580 578">
  ${mark(ink, bob)}
</svg>`;
}

const hex = (tone, which) => tone[which];

const ART = [
  // The icon. Its ground is the darkest neutral in both, because a home screen
  // is not the app and the icon should read as one thing wherever it sits.
  { path: 'AppIcon.appiconset/icon-1024.png', w: 1024, h: 1024,
    svg: icon(hex(NEUTRAL.ground, 'dark'), '#F5F7F8', hex(MEANING.accent, 'light')) },
  { path: 'AppIcon.appiconset/icon-1024-dark.png', w: 1024, h: 1024,
    svg: icon('#000000', '#F5F7F8', hex(MEANING.accent, 'light')) },
  { path: 'AppIcon.appiconset/icon-1024-tinted.png', w: 1024, h: 1024,
    svg: icon('transparent', '#FFFFFF', '#FFFFFF') },
];

for (const [scale, px] of [[1, 166], [2, 332], [3, 498]]) {
  ART.push({
    path: `LaunchMark.imageset/mark-${scale}x.png`,
    w: px, h: Math.round((px * 578) / 580),
    svg: launchMark(hex(NEUTRAL.ink, 'light'), hex(MEANING.accent, 'light')),
  });
  ART.push({
    path: `LaunchMark.imageset/mark-dark-${scale}x.png`,
    w: px, h: Math.round((px * 578) / 580),
    svg: launchMark(hex(NEUTRAL.ink, 'dark'), hex(MEANING.accent, 'dark')),
  });
}

const CONTENTS = {
  'AppIcon.appiconset/Contents.json': {
    images: [
      { filename: 'icon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' },
      { appearances: [{ appearance: 'luminosity', value: 'dark' }],
        filename: 'icon-1024-dark.png', idiom: 'universal', platform: 'ios', size: '1024x1024' },
      { appearances: [{ appearance: 'luminosity', value: 'tinted' }],
        filename: 'icon-1024-tinted.png', idiom: 'universal', platform: 'ios', size: '1024x1024' },
    ],
    info: { author: 'trueline', version: 1 },
  },
  'LaunchMark.imageset/Contents.json': {
    images: [1, 2, 3].flatMap((s) => [
      { filename: `mark-${s}x.png`, idiom: 'universal', scale: `${s}x` },
      { appearances: [{ appearance: 'luminosity', value: 'dark' }],
        filename: `mark-dark-${s}x.png`, idiom: 'universal', scale: `${s}x` },
    ]),
    info: { author: 'trueline', version: 1 },
  },
  'LaunchGround.colorset/Contents.json': {
    colors: [
      { color: colour(hex(NEUTRAL.ground, 'light')), idiom: 'universal' },
      { appearances: [{ appearance: 'luminosity', value: 'dark' }],
        color: colour(hex(NEUTRAL.ground, 'dark')), idiom: 'universal' },
    ],
    info: { author: 'trueline', version: 1 },
  },
};

/** A hex as the asset catalogue wants it: floating-point components. */
function colour(h) {
  const n = parseInt(h.slice(1), 16);
  const f = (v) => (v / 255).toFixed(3);
  return {
    'color-space': 'srgb',
    components: {
      alpha: '1.000',
      red: f((n >> 16) & 255), green: f((n >> 8) & 255), blue: f(n & 255),
    },
  };
}

/* ------------------------------------------------- the mark cannot drift */

// The geometry above is the screens' own. If `Mark.tsx` is edited and this is
// not, the app icon becomes a picture of a mark the app no longer uses -- so
// the numbers are read back out of it and compared.
const source = readFileSync(join(root, 'web', 'src', 'Mark.tsx'), 'utf8');
const mine = mark('X', 'Y').replace(/\s+/g, ' ').match(/x1="[^"]*"|points="[^"]*"/g) ?? [];
for (const bit of mine) {
  if (!source.includes(bit)) {
    console.error(`web/src/Mark.tsx no longer has ${bit}.`);
    console.error('The icon is drawn from the same geometry as the wordmark on every');
    console.error('screen. Update core/tools/gen-art.mjs to match, then regenerate.');
    process.exit(1);
  }
}

/* ------------------------------------------------------------------ draw */

/**
 * What the art was drawn FROM, and what came out.
 *
 * ## Why `--check` no longer renders anything
 *
 * It used to take a fresh screenshot and compare it to the committed PNG byte
 * for byte. That is a check on the renderer, not on this repository: two
 * Chromium builds encode the same picture differently, and antialias it
 * differently too. So the moment `check-art` went into `npm run verify` it
 * started failing on Sam's Mac —
 *
 *     AppIcon.appiconset/icon-1024.png is out of date.
 *     LaunchMark.imageset/mark-1x.png is out of date.
 *     ... eight more
 *
 * — on art nobody had touched. There was nothing to regenerate. The check was
 * asking a question with a different right answer on every machine.
 *
 * What it is actually for is one sentence: **nobody changed the mark or the
 * colour tokens and left the art behind.** That is a statement about the
 * INPUTS, so the inputs are what is recorded and compared. The exact SVG
 * string that was rendered is hashed, and so is the PNG that came out of it —
 * the first catches art that no longer matches the mark, the second catches a
 * PNG that was edited, truncated or lost.
 *
 * `--check` therefore needs no browser at all, which is also why it is fast.
 *
 * ## What this gives up, and it is worth saying
 *
 * A PNG regenerated on a different machine has different bytes and a different
 * stamp, and both get committed together. That is correct — the committed PNG
 * is the artifact — but it does mean this cannot tell you that two machines
 * would draw the same picture. Nothing portable can, and the thing that would
 * have caught the bug this replaced is a person looking at the icon.
 */
// Beside the catalogue, never inside it. `Assets.xcassets` is a folder
// reference that `actool` compiles whole, and a JSON file it does not
// recognise at the root of one is at best a warning and at worst another
// build somebody cannot run.
const STAMP = join(root, 'ios', 'art.stamp.json');
const fingerprint = (text) => createHash('sha256').update(text).digest('hex').slice(0, 32);

/** The exact string handed to the renderer, so the hash is of what is drawn. */
function pageFor(art) {
  return `<style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style>`
    + art.svg.replace('width="1024" height="1024"', `width="${art.w}" height="${art.h}"`)
             .replace(/width="580" height="578"/, `width="${art.w}" height="${art.h}"`);
}

const check = process.argv.includes('--check');
let bad = false;

for (const [path, json] of Object.entries(CONTENTS)) {
  const file = join(assets, path);
  const want = JSON.stringify(json, null, 2) + '\n';
  if (check) {
    const have = existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (have !== want) { console.error(`${path} is out of date.`); bad = true; }
  } else {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, want);
  }
}

/* --------------------------------------------------- the art, or its stamp */

if (check) {
  let stamped = {};
  try {
    stamped = JSON.parse(readFileSync(STAMP, 'utf8'));
  } catch {
    console.error('There is no art.stamp.json. The art has never been generated by a build');
    console.error('that records what it was drawn from.');
    bad = true;
  }
  for (const art of ART) {
    const was = stamped[art.path];
    if (!was) {
      console.error(`${art.path} has no stamp — it was never recorded.`);
      bad = true;
      continue;
    }
    if (was.source !== fingerprint(pageFor(art))) {
      console.error(`${art.path} is drawn from a mark or a colour that has changed since.`);
      bad = true;
    }
    const file = join(assets, art.path);
    const have = existsSync(file) ? readFileSync(file) : Buffer.alloc(0);
    if (have.length === 0) {
      console.error(`${art.path} is missing or empty.`);
      bad = true;
    } else if (was.png !== fingerprint(have)) {
      console.error(`${art.path} has been changed since it was generated.`);
      bad = true;
    }
  }

  if (bad) {
    console.error('\nRegenerate:  node --experimental-strip-types core/tools/gen-art.mjs');
    process.exit(1);
  }
  console.log(`${ART.length} pieces of art match the mark, the tokens, and their own stamps`);
  process.exit(0);
}

const browser = await openChromium();
const stamp = {};

for (const art of ART) {
  const page = await browser.newPage({
    viewport: { width: art.w, height: art.h },
    deviceScaleFactor: 1,
  });
  await page.setContent(pageFor(art));
  const shot = await page.screenshot({ omitBackground: true });
  await page.close();

  const file = join(assets, art.path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, shot);
  stamp[art.path] = { source: fingerprint(pageFor(art)), png: fingerprint(shot) };
  console.log(`wrote ${art.path}  ${art.w}x${art.h}`);
}

await browser.close();

writeFileSync(STAMP, JSON.stringify(stamp, null, 2) + '\n');
console.log(`wrote ${ART.length} pieces of art and the stamp of what each was drawn from`);
