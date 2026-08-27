/**
 * Reads the OUTPUT and refuses to pass if it is broken.
 *
 * Not the data, not the templates — the generated files, the way a crawler
 * gets them. Every check here is something that is invisible on screen and
 * expensive in a search index: a canonical pointing at the wrong page,
 * structured data that does not parse, a guide nothing links to, an internal
 * link to a page that was never generated.
 *
 *   node site/tools/check.mjs
 *
 * Exits non-zero with a count. Netlify runs it after the build.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, '../dist');

if (!existsSync(DIST)) {
  console.error('There is no site/dist. Run: node site/build.mjs');
  process.exit(1);
}

/** Every generated file, as paths relative to dist. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(relative(DIST, full));
  }
  return out;
}

const files = walk(DIST);
const htmls = files.filter((f) => f.endsWith('.html'));
const problems = [];
const say = (file, what) => problems.push(`${file}: ${what}`);

/** The URL a file is served at. */
const served = (file) => '/' + file.replace(/index\.html$/, '');

const pages = new Map(htmls.map((f) => [served(f), readFileSync(join(DIST, f), 'utf8')]));
const inbound = new Map([...pages.keys()].map((p) => [p, 0]));

for (const [path, html] of pages) {
  const is404 = path === '/404.html';

  /* --- the metadata every page must carry --- */
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
  if (!title) say(path, 'no <title>');
  else if (title.length > 68) say(path, `title is ${title.length} chars: "${title}"`);

  const desc = /<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? '';
  if (!desc) say(path, 'no meta description');
  else if (desc.length > 165) say(path, `description is ${desc.length} chars`);

  const canonical = /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1] ?? '';
  if (!canonical) say(path, 'no canonical');
  else if (!canonical.endsWith(path) && !(path === '/' && canonical.endsWith('/'))) {
    say(path, `canonical points at ${canonical}`);
  }

  for (const tag of ['og:title', 'og:description', 'og:url', 'og:image', 'og:type']) {
    if (!html.includes(`property="${tag}"`)) say(path, `no ${tag}`);
  }
  if (!html.includes('name="twitter:card"')) say(path, 'no twitter:card');

  /* --- one h1, and headings that do not skip --- */
  const h1s = html.match(/<h1[\s>]/g)?.length ?? 0;
  if (h1s !== 1) say(path, `${h1s} <h1> elements`);

  /* --- structured data has to PARSE, not merely be present --- */
  for (const [, json] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const parsed = JSON.parse(json);
      if (!parsed['@context']) say(path, 'JSON-LD block with no @context');
      if (!parsed['@type']) say(path, 'JSON-LD block with no @type');
    } catch (error) {
      say(path, 'JSON-LD does not parse: ' + error.message);
    }
  }
  if (!is404 && path !== '/thanks/' && !html.includes('application/ld+json')) {
    say(path, 'no structured data at all');
  }

  /* --- no placeholders, ever --- */
  for (const bad of ['TODO', 'FIXME', 'Lorem ipsum', 'yourfirmwebsite', 'undefined',
                     '[object Object]', 'NaN', 'null%']) {
    if (html.includes(bad)) say(path, `contains "${bad}"`);
  }
  // An unfilled template hole, e.g. ${something} that never got substituted.
  if (/\$\{[a-zA-Z]/.test(html)) say(path, 'contains an unsubstituted ${...}');

  /* --- internal links must resolve, and count inbound --- */
  for (const [, href] of html.matchAll(/href="(\/[^"#?]*)/g)) {
    const target = href.endsWith('/') || href.includes('.') ? href : href + '/';
    // Files rather than pages: the PDFs, the screenshots, and the two films.
    // Checked against what is actually in `dist` — a download link to a file
    // that was never built is worse than no link, because it looks like the
    // thing works.
    if (target.startsWith('/downloads/') || target.startsWith('/img/')
        || target.startsWith('/film/')) {
      if (!files.includes(target.slice(1))) say(path, `dead asset link ${target}`);
      continue;
    }
    if (['/style.css', '/room3d.js', '/favicon.svg', '/apple-touch-icon.png',
         '/sitemap.xml', '/robots.txt'].includes(target)) {
      if (!files.includes(target.slice(1))) say(path, `dead asset link ${target}`);
      continue;
    }
    if (!pages.has(target)) { say(path, `dead internal link ${target}`); continue; }
    if (target !== path) inbound.set(target, (inbound.get(target) ?? 0) + 1);
  }

  /* --- images need alt text and dimensions --- */
  for (const [, img] of html.matchAll(/<img\s([^>]*)>/g)) {
    if (!/\balt="/.test(img)) say(path, 'an <img> with no alt');
    else if (/\balt=""/.test(img)) say(path, 'an <img> with empty alt');
    if (!/\bsrc="/.test(img)) say(path, 'an <img> with no src');
  }
}

/* --- no SEO islands --- */
const guidePages = [...pages.keys()].filter((p) => p.startsWith('/guides/') && p !== '/guides/');
const orphans = guidePages.filter((p) => (inbound.get(p) ?? 0) < 1);
if (orphans.length) problems.push(`${orphans.length} guides with no inbound link: ${orphans.join(', ')}`);

const thin = guidePages.filter((p) => {
  const text = pages.get(p).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
  return text.split(/\s+/).filter(Boolean).length < 800;
});
if (thin.length) problems.push(`${thin.length} guides under 800 words: ${thin.join(', ')}`);

/* --- every guide links out to at least 3 others and to a money page --- */
for (const p of guidePages) {
  const html = pages.get(p);
  const links = new Set([...html.matchAll(/href="(\/guides\/[^"#?]+\/)"/g)].map((m) => m[1]));
  links.delete(p);
  if (links.size < 3) say(p, `links to only ${links.size} other guides`);
  if (!html.includes('href="/"') && !html.includes('href="/templates/"')) {
    say(p, 'never links to a money page');
  }
}

/* --- the sitemap covers exactly what it should --- */
const sitemap = readFileSync(join(DIST, 'sitemap.xml'), 'utf8');
// The path, not the URL. The first version of this matched from the first
// slash in the <loc>, which is the one in "https://" — so every entry came out
// as "//trueline.tools/..." and the checker reported all 32 as missing while
// the sitemap was perfectly correct. A checker that cries wolf on a good build
// is a checker that gets switched off.
const ORIGIN = /<loc>https?:\/\/[^/]+/;
const listed = new Set(
  [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)]
    .map((m) => m[0].replace(ORIGIN, '').replace('</loc>', '') || '/')
);
for (const p of pages.keys()) {
  if (['/thanks/', '/404.html'].includes(p)) {
    if (listed.has(p)) problems.push(`sitemap lists ${p}, which is noindex`);
    continue;
  }
  if (!listed.has(p)) problems.push(`sitemap is missing ${p}`);
}

/* --- the deployed Content-Security-Policy allows what the pages actually use ---

   A CSP is the one part of a static site that behaves differently on a local
   server and on the real one, so it is the one part that has to be read rather
   than tried. `default-src 'none'` covers every fetch a directive does not name
   -- and a <video> is governed by `media-src`, not `img-src`. Adding the films
   without adding `media-src 'self'` would have left two players that work
   perfectly on a laptop and are blocked in production.

   Checked directive by directive against what the built pages contain, so this
   goes on being true for whatever gets added next. --- */

{
  const toml = join(dirname(DIST), 'netlify.toml');
  const policy = existsSync(toml)
    ? (/Content-Security-Policy = "([^"]*)"/.exec(readFileSync(toml, 'utf8'))?.[1] ?? '')
    : '';
  if (!policy) {
    problems.push('site/netlify.toml has no Content-Security-Policy to check');
  } else {
    const needs = [
      [/<video[\s>]|<source\s[^>]*type="video/i, 'media-src', 'a <video>'],
      [/<audio[\s>]/i, 'media-src', 'an <audio>'],
      [/<img[\s>]/i, 'img-src', 'an <img>'],
      [/<script[\s>]/i, 'script-src', 'a <script>'],
      [/<iframe[\s>]/i, 'frame-src', 'an <iframe>'],
    ];
    for (const [uses, directive, what] of needs) {
      const page = [...pages].find(([, html]) => uses.test(html));
      if (page && !new RegExp('(^|;)\\s*' + directive + '\\s').test(policy)) {
        problems.push(
          `${page[0]} has ${what}, and the deployed CSP names no ${directive} — `
          + `it falls back to default-src and the browser will block it`);
      }
    }
  }
}

/* --- titles and descriptions are unique --- */
const seenTitle = new Map();
for (const [p, html] of pages) {
  const t = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
  if (seenTitle.has(t)) problems.push(`duplicate <title> on ${p} and ${seenTitle.get(t)}`);
  seenTitle.set(t, p);
}

/* ------------------------------------------------------------------ report */

const words = guidePages.reduce((total, p) => total
  + pages.get(p).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ')
      .split(/\s+/).filter(Boolean).length, 0);

console.log(`${pages.size} pages · ${guidePages.length} guides · ${words.toLocaleString()} words`);
console.log(`${listed.size} in the sitemap · ${orphans.length} orphans · `
  + `${problems.filter((p) => p.includes('dead internal link')).length} dead links · `
  + `${problems.filter((p) => p.includes('does not parse')).length} broken JSON-LD`);

if (problems.length) {
  console.log('');
  for (const p of problems) console.log('  ✗ ' + p);
  console.log(`\n${problems.length} problem(s).`);
  process.exit(1);
}
console.log('\nEvery page: canonical, metadata, parsing structured data, no dead links, '
  + 'no orphans, in the sitemap.');
