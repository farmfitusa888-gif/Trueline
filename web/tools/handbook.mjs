/**
 * Puts the handbook inside the app, so it works in a basement.
 *
 * `docs/handbook.html` is the one copy of the handbook and it is written for
 * the web, where it is published as a page in its own right. That publishing
 * path wraps it in a document skeleton, so the file itself deliberately has no
 * `<!doctype>`, `<html>` or `<head>`. This adds them, and three other things
 * the app's copy needs that the published copy does not:
 *
 *   * **No webfonts.** A contractor in a basement has no signal, and a font
 *     that fails to load silently changes every line break in the document.
 *     The stacks already name real fallbacks; this removes the links so the
 *     fallbacks are what is used, every time, predictably.
 *   * **A way back.** Inside the app this opens in the same web view, so
 *     without a link out of it the handbook is a room with no door.
 *   * **A viewport.** It is read on a phone.
 *
 * Run automatically before every web build -- `prebuild` in web/package.json --
 * so the copy in the app can never be older than the copy in `docs/`.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = dirname(here);
const repo = dirname(web);

const SOURCE = join(repo, 'docs', 'handbook.html');
const OUT = join(web, 'public', 'handbook.html');

const BACK = `
<style>
  .back-to-app {
    position:sticky; top:0; z-index:30;
    display:block; padding:12px 0; margin:0 0 4px;
    font-family:"IBM Plex Mono","DejaVu Sans Mono",monospace; font-size:13px;
    letter-spacing:.06em; text-transform:uppercase;
    color:var(--amber); text-decoration:none; background:var(--ground);
  }
  .back-to-app:focus-visible { outline:2px solid var(--amber); outline-offset:3px; }
  @media print { .back-to-app { display:none; } }
</style>
<div class="wrap"><a class="back-to-app" href="./index.html">&larr; Back to Trueline</a></div>
`;

function main() {
  let doc = readFileSync(SOURCE, 'utf8');

  // The fonts. Removed rather than inlined: the faces are 300 KB the app does
  // not need, and every stack in the file already names a fallback.
  doc = doc.replace(/<link rel="preconnect"[^>]*>\s*/g, '');
  doc = doc.replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>\s*/g, '');
  if (/https:\/\/fonts\./.test(doc)) {
    throw new Error('handbook.html still reaches for a font off the device');
  }

  const title = doc.match(/<title>(.*?)<\/title>/)?.[1] ?? 'The Trueline Handbook';

  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
</head>
<body>
${BACK}
${doc}
</body>
</html>
`;

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, page);
  const cards = (doc.match(/^      \{ t: /gm) ?? []).length;
  console.log(`handbook → web/public/handbook.html (${cards} cards, ${Math.round(page.length / 1024)} KB)`);
}

main();
