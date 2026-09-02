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
import { createHash } from 'node:crypto';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CALCULATORS } from '../content/calculators.mjs';
import { TEMPLATES, TEMPLATE_GROUPS } from '../content/templates.mjs';
import { coolingNoticeLines } from './pdfs.mjs';
import { verifyCalculators } from './calc-truth.mjs';

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

/**
 * The page without its title bar and its footer.
 *
 * Every "does this page link to enough of its neighbours" rule below has to
 * count links the author put in the body, and the footer lists every calculator
 * on every page — so counting the whole document made the cross-link rule for
 * calculators pass on a page with no cross-links in it at all. It was written,
 * it went green, and it was measuring nothing. Found by breaking it on purpose
 * and watching it stay green.
 */
const inMain = (html) => /<main[^>]*>([\s\S]*?)<\/main>/.exec(html)?.[1] ?? html;

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
        || target.startsWith('/film/') || target.startsWith('/fonts/')) {
      if (!files.includes(target.slice(1))) say(path, `dead asset link ${target}`);
      continue;
    }
    if (['/style.css', '/site.js', '/favicon.svg', '/apple-touch-icon.png',
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
// Calculators too. A calculator nothing links to is exactly as lost as a guide
// nothing links to, and it took longer to build.
const reachable = [...pages.keys()]
  .filter((p) => (p.startsWith('/guides/') || p.startsWith('/calculators/'))
    && p !== '/guides/' && p !== '/calculators/');
const orphans = reachable.filter((p) => (inbound.get(p) ?? 0) < 1);
if (orphans.length) problems.push(`${orphans.length} pages with no inbound link: ${orphans.join(', ')}`);

const thin = guidePages.filter((p) => {
  const text = pages.get(p).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
  return text.split(/\s+/).filter(Boolean).length < 800;
});
if (thin.length) problems.push(`${thin.length} guides under 800 words: ${thin.join(', ')}`);

/* --- every guide links out to at least 3 others and to a money page --- */
for (const p of guidePages) {
  const html = inMain(pages.get(p));
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

  /* The two hosts must state the same policy, character for character.

     Everything below this reads `netlify.toml`, and Cloudflare -- the host this
     is actually deployed to -- reads `_headers`. So the whole of this section
     was checking a file the live site does not use, and it went green while the
     two drifted: netlify.toml went on naming fonts.googleapis.com and setting
     `font-src` to gstatic long after the typefaces were vendored onto this
     origin. A deploy to the fallback host would have blocked every font on the
     site, and the only moment anybody would have found out is the moment the
     fallback was needed.

     A second host that has not been checked is not a way out. */
  const headersFile = join(DIST, '_headers');
  const served = existsSync(headersFile)
    ? (/Content-Security-Policy:\s*(.+)/.exec(readFileSync(headersFile, 'utf8'))?.[1]?.trim() ?? '')
    : '';
  if (!served) {
    problems.push('site/dist/_headers has no Content-Security-Policy, so the deployed site has none');
  } else if (served !== policy) {
    problems.push('the two hosts disagree about the Content-Security-Policy.\n'
      + `      _headers (Cloudflare, live): ${served}\n`
      + `      netlify.toml (the fallback): ${policy}`);
  }
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

    /* Every inline script has to be named in the policy, by hash.

       This is not hypothetical and it is not new: the six lines in the <head>
       that apply a saved light or dark choice before first paint were being
       refused by the browser on the live site, every page load, since the CSP
       was written. Nothing looked broken -- the site is dark by default -- so
       the theme control simply did nothing for anybody who had used it, and
       there was no way to find that out from the build.

       The hash is computed over the exact text between the tags, which is what
       a browser does, so editing that script by one character invalidates it
       and this fails. `application/ld+json` is data rather than script and is
       not governed by script-src. */
    const INLINE = /<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")[^>]*>([\s\S]*?)<\/script>/g;
    const allowsInline = /(^|;)\s*script-src\b[^;]*'unsafe-inline'/.test(policy);
    const named = new Set();
    for (const [path, html] of pages) {
      for (const [, body] of html.matchAll(INLINE)) {
        const hash = 'sha256-' + createHash('sha256').update(body, 'utf8').digest('base64');
        if (allowsInline || policy.includes(`'${hash}'`)) continue;
        if (named.has(hash)) continue;
        named.add(hash);
        problems.push(
          `${path} has an inline <script> the deployed CSP will refuse to run. Add `
          + `'${hash}' to script-src in site/netlify.toml, or move the script to a file.`);
      }
    }
  }
}

/* --- the calculators ---

   A guide that goes wrong is visibly wrong: a paragraph reads badly, a link
   404s, the word count check catches a stub. A calculator that goes wrong is
   invisible. It prints a confident figure in the same typeface as a correct
   one and the first person to find out is somebody who ordered against it.

   So a calculator page is checked for two separate things. Here: that the page
   is actually wired to the engine — the form is there, the script that drives
   it is there, the engine it imports was built, and the page degrades into
   something readable when it is not. And in `calc-truth.mjs`, called below:
   that the arithmetic itself agrees with figures nobody derived by running it.
   --- */

const calculatorPages = [...pages.keys()]
  .filter((p) => p.startsWith('/calculators/') && p !== '/calculators/');

if (calculatorPages.length !== CALCULATORS.length) {
  problems.push(`${CALCULATORS.length} calculators are defined and `
    + `${calculatorPages.length} pages were built for them`);
}

for (const p of calculatorPages) {
  const html = pages.get(p);

  const forms = [...html.matchAll(/data-calc="([^"]+)"/g)];
  if (forms.length !== 1) {
    problems.push(`${p} has ${forms.length} calculator forms on it; it should have exactly one`);
  }
  if (!/data-out\b/.test(html)) say(p, 'a calculator with nowhere to put the answer');
  if (!/<noscript>/.test(html)) {
    say(p, 'a calculator with no <noscript> — with scripting off it is a dead form');
  }
  // The arithmetic has to be argued on the page as well as done by it. A
  // calculator with no formula on it is a black box, and a black box is exactly
  // what this site exists to be the opposite of.
  if (!html.includes('class="formula"')) say(p, 'no formula shown anywhere on the page');

  // Inside <main> only. The footer lists every calculator on every page, so
  // counting the whole document made this rule unfailable.
  const body = inMain(html);
  const calculators = new Set(
    [...body.matchAll(/href="(\/calculators\/[^"#?]+\/)"/g)].map((m) => m[1]));
  calculators.delete(p);
  if (calculators.size < 2) {
    say(p, `links to only ${calculators.size} other calculator(s) from its own body`);
  }
  const guides = new Set([...body.matchAll(/href="(\/guides\/[^"#?]+\/)"/g)].map((m) => m[1]));
  if (guides.size < 1) say(p, 'never links to a guide from its own body');
  if (!html.includes('href="/"') && !html.includes('href="/templates/"')) {
    say(p, 'never links to a money page');
  }

  const words = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ')
    .split(/\s+/).filter(Boolean).length;
  if (words < 700) say(p, `${words} words — a calculator still has to explain itself`);
}

/* --- the engine the calculators load actually exists --- */

for (const asset of ['calc-engine.js', 'calc.js']) {
  if (!files.includes(asset)) {
    problems.push(`${asset} was not built; every calculator page would load nothing`);
  }
}

/* --- the free forms --- */

for (const template of TEMPLATES) {
  const file = `downloads/${template.file}`;
  if (!files.includes(file)) {
    problems.push(`the "${template.title}" PDF was never written to ${file}`);
    continue;
  }
  // A PDF that generated but is empty is a download that looks like it works.
  const size = statSync(join(DIST, file)).size;
  if (size < 1200) problems.push(`${file} is only ${size} bytes — that is not a form`);

  if (!TEMPLATE_GROUPS.some((g) => g.id === template.group)) {
    problems.push(`the "${template.title}" template is in group "${template.group}", `
      + 'which is not one of the shelves on the templates page');
  }
  if (!pages.has(`/guides/${template.guide}/`)) {
    problems.push(`the "${template.title}" template points at /guides/${template.guide}/, `
      + 'which does not exist');
  }
}
for (const group of TEMPLATE_GROUPS) {
  if (!TEMPLATES.some((t) => t.group === group.id)) {
    problems.push(`the "${group.title}" shelf on the templates page has nothing on it`);
  }
}

/* --- the one form whose words are not ours ---

   The cancellation notice is built by filling the blanks in the § 429.1(b) form
   that `core/src/cooling.ts` produces. If that wording ever changes shape, the
   substitution stops finding the blanks — and the failure mode is a legal
   notice printed with `[[SELLER-NAME]]` across it, or worse, with a specimen
   date on it that a buyer might rely on. Checked rather than trusted. --- */

{
  const { lines, statement, copies } = coolingNoticeLines();
  if (copies !== 2) {
    problems.push(`the cancellation notice says it wants ${copies} copies; 16 CFR 429.1(b) `
      + 'wants it in duplicate');
  }
  if (!statement.startsWith('You, the buyer, may cancel this transaction')) {
    problems.push('the § 429.1(a) statement is not the sentence the rule requires');
  }
  const form = lines.join('\n');
  for (const leak of ['[[', ']]', '2026', 'January']) {
    if (form.includes(leak)) {
      problems.push(`the cancellation notice still has "${leak}" in it — a blank did not get `
        + 'blanked, and a legal notice with a hole or a specimen date on it is worse than none');
    }
  }
  if (!form.includes('I HEREBY CANCEL THIS TRANSACTION.')) {
    problems.push('the cancellation notice is missing the line the buyer signs under');
  }
  if (!/_{10,}/.test(form)) {
    problems.push('the cancellation notice has no blanks on it, so there is nothing to fill in');
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

/* --- and the arithmetic itself, against figures nobody derived by running it --- */

for (const problem of await verifyCalculators(DIST)) problems.push(problem);

const words = guidePages.reduce((total, p) => total
  + pages.get(p).replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ')
      .split(/\s+/).filter(Boolean).length, 0);

console.log(`${pages.size} pages · ${guidePages.length} guides · `
  + `${calculatorPages.length} calculators · ${TEMPLATES.length} PDFs · `
  + `${words.toLocaleString()} words`);
console.log(`${listed.size} in the sitemap · ${orphans.length} orphans · `
  + `${problems.filter((p) => p.includes('dead internal link')).length} dead links · `
  + `${problems.filter((p) => p.includes('does not parse')).length} broken JSON-LD`);

// The SEO rules that are about the whole set rather than one page -- a title
// that is the same as another page's, a description over the length Google
// shows, a heading level skipped. They live in seo-report.mjs so they can be
// read as a report while they are being fixed; imported here they become the
// same kind of failure as a dead link, so a fixed one cannot quietly come back.
const { findings: seo } = await import('./seo-report.mjs');
for (const f of seo) problems.push(f);
console.log(`${seo.length} SEO finding(s) across titles, descriptions, headings, `
  + `canonicals, social cards and structured data`);

if (problems.length) {
  console.log('');
  for (const p of problems) console.log('  ✗ ' + p);
  console.log(`\n${problems.length} problem(s).`);
  process.exit(1);
}
console.log('\nEvery page: canonical, metadata, parsing structured data, no dead links, '
  + 'no orphans, in the sitemap.');
