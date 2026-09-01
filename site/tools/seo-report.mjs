/**
 * Measures the built site and prints what it finds. Report only, no opinions
 * baked in as failures -- the failures come after, in check.mjs, once the
 * numbers below have been read and the real problems fixed.
 *
 *   node site/tools/seo-report.mjs
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = (process.argv[1] ?? '').endsWith('seo-report.mjs');
const note = (...a) => { if (CLI) console.log(...a); };
const DIST = join(HERE, '../dist');
if (!existsSync(DIST)) { console.error('No site/dist. Run: node site/build.mjs'); process.exit(1); }

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) walk(f, out); else out.push(relative(DIST, f));
  }
  return out;
}
const files = walk(DIST);
const htmls = files.filter((f) => f.endsWith('.html'));
const served = (f) => '/' + f.replace(/index\.html$/, '');
const attr = (html, re) => re.exec(html)?.[1] ?? null;

const pages = htmls.map((f) => {
  const html = readFileSync(join(DIST, f), 'utf8');
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => m[1].replace(/<[^>]+>/g, '').trim());
  const headings = [...html.matchAll(/<h([1-6])[^>]*>/gi)].map((m) => Number(m[1]));
  return {
    file: f,
    url: served(f),
    title: attr(html, /<title>([\s\S]*?)<\/title>/i),
    desc: attr(html, /<meta name="description" content="([^"]*)"/i),
    canonical: attr(html, /<link rel="canonical" href="([^"]*)"/i),
    ogTitle: attr(html, /<meta property="og:title" content="([^"]*)"/i),
    ogDesc: attr(html, /<meta property="og:description" content="([^"]*)"/i),
    ogImage: attr(html, /<meta property="og:image" content="([^"]*)"/i),
    ogUrl: attr(html, /<meta property="og:url" content="([^"]*)"/i),
    twCard: attr(html, /<meta name="twitter:card" content="([^"]*)"/i),
    twImage: attr(html, /<meta name="twitter:image" content="([^"]*)"/i),
    lang: attr(html, /<html[^>]*\blang="([^"]*)"/i),
    themeColor: attr(html, /<meta name="theme-color"[^>]*content="([^"]*)"/i),
    viewport: attr(html, /<meta name="viewport" content="([^"]*)"/i),
    robots: attr(html, /<meta name="robots" content="([^"]*)"/i),
    noindex: /<meta name="robots" content="[^"]*noindex/i.test(html),
    jsonLdTypes: [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .flatMap((m) => { try { const d = JSON.parse(m[1]); return (Array.isArray(d) ? d : [d]).map((x) => x['@type']); } catch { return ['UNPARSEABLE']; } }),
    h1s, headings,
    words: (html.match(/<main[^>]*>([\s\S]*?)<\/main>/)?.[1] ?? html)
      .replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length,
    bytes: Buffer.byteLength(html),
  };
});

export const findings = [];
const fail = (what) => findings.push(what);

function dupes(key, label) {
  const seen = new Map();
  for (const p of pages) {
    const v = p[key];
    if (v === null) continue;
    if (!seen.has(v)) seen.set(v, []);
    seen.get(v).push(p.url);
  }
  const bad = [...seen.entries()].filter(([, urls]) => urls.length > 1);
  note(`\n## Duplicate ${label}: ${bad.length}`);
  for (const [v, urls] of bad) {
    note(`  "${String(v).slice(0, 70)}"\n    ${urls.join('\n    ')}`);
    fail(`duplicate ${label}: "${String(v).slice(0, 60)}" on ${urls.join(' and ')}`);
  }
  return bad.length;
}

// A page carrying `noindex` is not in the index, so a rule about its title
// length or its word count is a rule about nothing. Excluding them is not
// looking away: the count of them is printed, so a page that quietly became
// noindex cannot hide behind the exclusion.
const all = [...pages];
const skipped = all.filter((p) => p.noindex);
pages.length = 0;
pages.push(...all.filter((p) => !p.noindex));
note(`# ${all.length} HTML pages in site/dist — ${pages.length} indexable, ${skipped.length} noindex (${skipped.map((p) => p.url).join(', ') || 'none'})`);
let issues = 0;
issues += dupes('title', 'titles');
issues += dupes('desc', 'meta descriptions');

const h1text = new Map();
for (const p of pages) for (const h of p.h1s) { if (!h1text.has(h)) h1text.set(h, []); h1text.get(h).push(p.url); }
const dupH1 = [...h1text.entries()].filter(([, u]) => u.length > 1);
note(`\n## Duplicate H1 text: ${dupH1.length}`);
for (const [v, u] of dupH1) {
  note(`  "${v.slice(0, 70)}"  ${u.join(' ')}`);
  fail(`duplicate H1 "${v.slice(0, 60)}" on ${u.join(' and ')}`);
}
issues += dupH1.length;

const report = (label, list, show = (p) => p.url) => {
  note(`\n## ${label}: ${list.length}`);
  for (const p of list.slice(0, 40)) note('  ' + show(p));
  if (list.length > 40) note(`  ... and ${list.length - 40} more`);
  for (const p of list) fail(`${p.url}: ${label}`);
  return list.length;
};

issues += report('Pages with no H1', pages.filter((p) => p.h1s.length === 0));
issues += report('Pages with more than one H1', pages.filter((p) => p.h1s.length > 1), (p) => `${p.url}  (${p.h1s.length})`);
issues += report('Title longer than 60 chars', pages.filter((p) => p.title && p.title.length > 60), (p) => `${p.title.length}  ${p.url}  ${p.title}`);
issues += report('Title shorter than 15 chars', pages.filter((p) => p.title && p.title.length < 15), (p) => `${p.title.length}  ${p.url}`);
issues += report('Description longer than 158', pages.filter((p) => p.desc && p.desc.length > 158), (p) => `${p.desc.length}  ${p.url}`);
issues += report('Description shorter than 70', pages.filter((p) => p.desc && p.desc.length < 70), (p) => `${p.desc.length}  ${p.url}`);
issues += report('No og:image', pages.filter((p) => !p.ogImage));
issues += report('No og:title', pages.filter((p) => !p.ogTitle));
issues += report('No og:url', pages.filter((p) => !p.ogUrl));
issues += report('No twitter:image', pages.filter((p) => !p.twImage));
issues += report('No lang on <html>', pages.filter((p) => !p.lang));
issues += report('No theme-color', pages.filter((p) => !p.themeColor));
issues += report('No viewport', pages.filter((p) => !p.viewport));
issues += report('Canonical does not match its own URL', pages.filter((p) => p.canonical && !p.canonical.endsWith(p.url)), (p) => `${p.url}  ->  ${p.canonical}`);
issues += report('No BreadcrumbList', pages.filter((p) => !p.jsonLdTypes.includes('BreadcrumbList') && p.url !== '/' && !p.url.startsWith('/404')));
issues += report('Thin: under 300 words in <main>', pages.filter((p) => p.words < 300), (p) => `${p.words}w  ${p.url}`);

// Heading hierarchy: a jump from h2 to h4 with no h3 between.
const jumps = pages.filter((p) => {
  let last = 0;
  for (const h of p.headings) { if (last && h > last + 1) return true; last = h; }
  return false;
});
issues += report('Heading level skipped (h2 -> h4)', jumps);

note(`\n## Structured data types in use`);
const types = new Map();
for (const p of pages) for (const t of p.jsonLdTypes) types.set(t, (types.get(t) ?? 0) + 1);
for (const [t, n] of [...types].sort((a, b) => b[1] - a[1])) note(`  ${String(n).padStart(3)}  ${t}`);

note(`\n## Page weight`);
const sorted = [...pages].sort((a, b) => b.bytes - a.bytes);
for (const p of sorted.slice(0, 5)) note(`  ${(p.bytes / 1024).toFixed(0)}kB  ${p.url}`);
note(`  total HTML ${(pages.reduce((s, p) => s + p.bytes, 0) / 1024).toFixed(0)}kB`);

note(`\n=== ${issues} thing(s) worth looking at ===`);
if (issues !== findings.length) {
  console.error(`the printed count (${issues}) and the collected findings (${findings.length}) disagree`);
  process.exitCode = 1;
}
