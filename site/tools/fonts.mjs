/**
 * Vendors the site's typefaces, so no page waits on a third party to draw text.
 *
 *   node site/tools/fonts.mjs        download and write site/src/fonts/
 *
 * ## Why
 *
 * The site linked `fonts.googleapis.com` in its <head>. That is a render-
 * blocking stylesheet on another origin: the browser must open a connection,
 * fetch a CSS file, parse it, and only then start fetching the font files it
 * names -- two round trips before a single word is drawn in the right face.
 * It also means the site does not work on a job with no signal, and that every
 * visitor's IP reaches Google before it reaches anything of ours.
 *
 * Self-hosted, the fonts are on the same connection as the page, start
 * downloading as soon as the stylesheet is parsed, and are cached with
 * everything else.
 *
 * Only the `latin` and `latin-ext` subsets are kept. The site is in English;
 * carrying Cyrillic and Vietnamese for it would be a download nobody uses.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../src/fonts');

// A modern browser's user agent, because Google serves woff2 only to one.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const FAMILIES = [
  { css: 'IBM+Plex+Mono:wght@400;500', file: 'plex-mono' },
  { css: 'IBM+Plex+Sans:wght@400;500;600', file: 'plex-sans' },
  { css: 'Saira+Condensed:wght@600;700', file: 'saira-condensed' },
];
const KEEP = new Set(['latin', 'latin-ext']);

mkdirSync(OUT, { recursive: true });
const blocks = [];
let files = 0, bytes = 0;

for (const family of FAMILIES) {
  const url = `https://fonts.googleapis.com/css2?family=${family.css}&display=swap`;
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  const css = await res.text();

  // Google's CSS is a run of `/* subset */ @font-face { ... }` blocks.
  const parts = css.split('/*').slice(1);
  for (const part of parts) {
    const subset = part.slice(0, part.indexOf('*/')).trim();
    if (!KEEP.has(subset)) continue;
    const face = part.slice(part.indexOf('*/') + 2);
    const src = /url\((https:\/\/[^)]+\.woff2)\)/.exec(face)?.[1];
    const weight = /font-weight:\s*(\d+)/.exec(face)?.[1] ?? '400';
    const style = /font-style:\s*(\w+)/.exec(face)?.[1] ?? 'normal';
    const range = /unicode-range:\s*([^;]+);/.exec(face)?.[1]?.trim();
    const name = /font-family:\s*'([^']+)'/.exec(face)?.[1];
    if (!src || !name) throw new Error(`could not read a face out of ${family.css}`);

    const bin = Buffer.from(await (await fetch(src, { headers: { 'user-agent': UA } })).arrayBuffer());
    const out = `${family.file}-${weight}${style === 'italic' ? '-italic' : ''}-${subset}.woff2`;
    writeFileSync(join(OUT, out), bin);
    files += 1; bytes += bin.length;

    blocks.push(`@font-face {
  font-family: '${name}';
  font-style: ${style};
  font-weight: ${weight};
  font-display: swap;
  src: url('/fonts/${out}') format('woff2');${range ? `\n  unicode-range: ${range};` : ''}
}`);
  }
}

writeFileSync(join(OUT, 'fonts.css'),
  '/* Written by site/tools/fonts.mjs. Do not edit; re-run that instead. */\n'
  + blocks.join('\n') + '\n');
console.log(`${files} font files (${(bytes / 1024).toFixed(0)}kB) + fonts.css in site/src/fonts`);
