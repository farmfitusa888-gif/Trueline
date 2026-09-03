/**
 * Rasterises assets/logo/*.png from the SVGs beside them.
 *
 *     node core/tools/gen-logo.mjs
 *     node core/tools/gen-logo.mjs --check
 *
 * ## Why this exists
 *
 * assets/logo/README.md said the PNGs were rendered from the SVGs and must not
 * be hand-edited. That was true of how they were made once and false of the
 * repository: there was no script, so "rasterise again" meant somebody doing it
 * by hand in a way nobody else could repeat. The first time the mark changed,
 * the PNGs would have quietly gone on showing the old one.
 *
 * `--check` compares a hash of the SVG each PNG was drawn from, not the PNG
 * bytes, for the same reason `gen-art.mjs --check` does: two Chromium builds
 * antialias the same picture differently, so a byte comparison fails on art
 * nobody touched. What is being asserted is that nobody changed a mark and left
 * its rasters behind.
 *
 * The App Store icon must have no alpha channel, which Apple requires: the icon
 * SVGs paint their own ground across the whole square and are shot over an
 * opaque page, so nothing transparent can reach the file. The wordmark is the
 * opposite -- ink on nothing -- and is shot transparent, because a baked ground
 * would make it useless anywhere but on that exact colour.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openChromium } from './browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const logo = join(root, 'assets', 'logo');

const MARK = join(logo, 'scantobid-mark.svg');
const WORDMARK = join(logo, 'scantobid-wordmark.svg');

/** What to draw, from which SVG, at what size. */
const JOBS = [
  // The icons carry their own ground inside the SVG, so they are shot over an
  // opaque page and land with no alpha channel -- which is what the App Store
  // requires of the 1024.
  ...[1024, 512, 256, 180, 120, 64].map((px) => ({
    out: join(logo, `scantobid-icon-${px}.png`), src: MARK, w: px, h: px, ground: '#14181B',
  })),
  // The lockup is ink on nothing, so it is shot transparent -- a baked ground
  // would make it useless on anything but that exact colour.
  { out: join(logo, 'scantobid-wordmark.png'), src: WORDMARK, w: 2128, h: 600, ground: null },
  // The icon the app actually ships, and the one the site serves to iOS.
  { out: join(root, 'web', 'public', 'apple-touch-icon.png'), src: MARK, w: 180, h: 180, ground: '#14181B' },
];

const STAMP = join(logo, 'rendered-from.json');
const digest = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

const want = {};
for (const job of JOBS) {
  const rel = job.out.slice(root.length + 1);
  want[rel] = `${digest(readFileSync(job.src, 'utf8'))}@${job.w}x${job.h}@${job.ground ?? 'clear'}`;
}

if (process.argv.includes('--check')) {
  const have = existsSync(STAMP) ? JSON.parse(readFileSync(STAMP, 'utf8')) : {};
  const wrong = [];
  for (const [rel, stamp] of Object.entries(want)) {
    if (!existsSync(join(root, rel))) wrong.push(`${rel} is missing`);
    else if (have[rel] !== stamp) wrong.push(`${rel} was drawn from a different mark`);
  }
  for (const rel of Object.keys(have)) {
    if (!(rel in want)) wrong.push(`${rel} is stamped and is no longer drawn`);
  }
  if (wrong.length) {
    for (const line of wrong) console.error(line);
    console.error('\nThe logo PNGs no longer match the SVGs they are drawn from.');
    console.error('Regenerate them with:  npm run logo');
    process.exit(1);
  }
  console.log(`${JOBS.length} logo raster(s) match the marks they were drawn from.`);
  process.exit(0);
}

const browser = await openChromium();
for (const job of JOBS) {
  const svg = readFileSync(job.src, 'utf8');
  const page = await browser.newPage({
    viewport: { width: job.w, height: job.h },
    deviceScaleFactor: 1,
  });
  // No page margin and no scrollbars, so the SVG is the whole shot. The icon
  // must land with no alpha channel, so it is drawn over its own ground rather
  // than over the transparent default.
  await page.setContent(
    `<!doctype html><meta charset="utf-8">
     <style>html,body{margin:0;padding:0;overflow:hidden;background:${job.ground ?? 'transparent'}}
     svg{display:block;width:${job.w}px;height:${job.h}px}</style>${svg}`,
    { waitUntil: 'load' },
  );
  await page.screenshot({ path: job.out, omitBackground: job.ground === null });
  await page.close();
  console.log(`wrote ${job.out.slice(root.length + 1)}  ${job.w}x${job.h}`);
}
await browser.close();

writeFileSync(STAMP, `${JSON.stringify(want, null, 2)}\n`);
console.log(`wrote ${JOBS.length} raster(s) and the stamp of what each was drawn from`);
