/**
 * The website, generated from data.
 *
 * ## Why a generator and not thirty-four hand-written files
 *
 * Because thirty-four hand-written files means thirty-four chances to leave a
 * canonical URL pointing at the wrong page, thirty-four `<title>` tags to keep
 * under sixty characters, and one page that quietly never made it into the
 * sitemap. Every one of those is invisible until it costs you a ranking.
 *
 * Here there is one template per kind of page and one list of guides. A change
 * to the byline changes every guide. A new guide is an entry in an array. And
 * `tools/check.mjs` re-reads the OUTPUT afterwards and refuses to pass if any
 * page has a dead internal link, a missing canonical, unparseable structured
 * data, or no inbound link from anywhere.
 *
 *   node site/build.mjs
 *
 * Writes to `site/dist/`. Netlify runs exactly this.
 */
import { mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SITE, PEOPLE, NAV, CLAIMS, NOT_CLAIMED } from './content/site.mjs';
import { TEMPLATES, TEMPLATE_GROUPS } from './content/templates.mjs';
import { CONTRACTOR } from './content/guides/contractor.mjs';
import { RESTORATION } from './content/guides/restoration.mjs';
import { COMPARE } from './content/guides/compare.mjs';
import { HOMEOWNER } from './content/guides/homeowner.mjs';
import { EXPLAINERS } from './content/guides/explainers.mjs';
import { CALCULATORS } from './content/calculators.mjs';
import { buildPdfs } from './tools/pdfs.mjs';
import { buildEngine, UI_FILE } from './tools/engine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, 'dist');

const GUIDES = [...CONTRACTOR, ...RESTORATION, ...COMPARE, ...HOMEOWNER, ...EXPLAINERS];

/** When the content last changed. Passed in so a rebuild is reproducible. */
const UPDATED = process.env.TRUELINE_SITE_DATE ?? new Date().toISOString().slice(0, 10);

const AUDIENCE = {
  contractor:  { label: 'Contractors', blurb: 'Takeoff, estimating, proposals and getting paid.' },
  restoration: { label: 'Restoration', blurb: 'Water losses, documentation and what an adjuster needs.' },
  compare:     { label: 'Choosing a tool', blurb: 'What to compare, and what the categories actually are.' },
  homeowner:   { label: 'Homeowners', blurb: 'Reading a quote, and knowing what to ask for.' },
};

/* --------------------------------------------------------------- helpers */

const esc = (s) => String(s)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

/** Strips the inline markup guide bodies are allowed, for meta and JSON-LD. */
const plain = (s) => String(s).replace(/<[^>]+>/g, '').replaceAll('&nbsp;', ' ').trim();

const url = (path) => SITE.origin + path;

/**
 * The reviewer, or nobody.
 *
 * `PEOPLE.trade.name` is empty until Gilbert's own name and description arrive.
 * Until then no reviewer appears anywhere — not in a byline and not in
 * structured data — because inventing either would be telling Google something
 * false about a named human being. See `content/site.mjs`.
 */
const REVIEWER = PEOPLE.trade.name.trim() === '' ? null : PEOPLE.trade;

/**
 * The one inline script on the site, and the only reason `script-src` cannot
 * simply be 'self'.
 *
 * It has to be inline and it has to be synchronous: a theme applied after the
 * first paint is a white flash on a dark site, on every page load, and this
 * site is read on a phone in a truck. An external file would still block, but
 * it would put a round trip in front of 476 bytes on the critical path.
 *
 * So it stays inline and the Content-Security-Policy carries its sha256
 * instead of 'unsafe-inline'. The hash is computed from THIS string at build
 * time and written into `_headers`, so editing the script cannot leave the
 * header describing the old one -- which is the failure mode of every
 * hand-copied CSP hash.
 */
const NO_FLASH = `
  /*
    Before a pixel is painted. A theme applied after first paint is a white
    flash on a dark site, on every page load, on the slowest connection -- and
    this site is read on a phone in a truck.
  */
  try {
    var chose = localStorage.getItem('trueline.ground');
    if (chose === 'light' || chose === 'dark') {
      document.documentElement.setAttribute('data-theme', chose);
    }
  } catch (e) { /* private browsing has no store, and dark is the default */ }
`;

/* ---------------------------------------------------------------- the shell */

function shell({ title, description, path, body, jsonLd, ogType = 'website', head = '' }) {
  const canonical = url(path);
  // The wordmark to the left of this bar is itself the link home, so a "Trueline"
  // entry here is the same destination twice in one row -- a self-referencing
  // duplicate that costs the width four real sections need on a 320px screen and
  // gives a crawler nothing. It is dropped rather than hidden: hiding it was what
  // made the bar look like it had lost links on a phone.
  const nav = NAV.filter((item) => item.href !== '/').map((item) => {
    const here = item.href === path || (item.href !== '/' && path.startsWith(item.href));
    return `<a href="${item.href}"${here ? ' aria-current="page"' : ''}>${esc(item.label)}</a>`;
  }).join('\n        ');

  const structured = (Array.isArray(jsonLd) ? jsonLd : [jsonLd]).filter(Boolean)
    .map((d) => `<script type="application/ld+json">${JSON.stringify(d)}</script>`).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta name="author" content="${esc(PEOPLE.builder.name)}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="${esc(SITE.name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${url('/img/plan.png')}">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${url('/img/plan.png')}">
<meta name="theme-color" content="#E7E9EA" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#14181B" media="(prefers-color-scheme: dark)">
<meta name="color-scheme" content="dark light">
<script>${NO_FLASH}</script>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<!-- The typefaces are ours, on this origin. A third-party stylesheet here
     costs a DNS lookup, a TLS handshake and a round trip BEFORE the browser
     learns which font files it needs -- and the page cannot be read on a job
     with no signal. Vendored by site/tools/fonts.mjs; the two faces the first
     screen is drawn in are preloaded so they start with the stylesheet rather
     than after it. -->
<link rel="preload" href="/fonts/saira-condensed-700-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/plex-sans-400-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/fonts/fonts.css">
<link rel="stylesheet" href="/style.css">
${head}${structured}
</head>
<body>
<header class="bar">
  <div class="wrap">
    <a class="mark" href="/">
      <svg viewBox="0 0 32 32" aria-hidden="true" fill="none">
        <path d="M3 24h26" stroke="currentColor" stroke-width="2.2" stroke-linecap="square"/>
        <path d="M7 24v-5M12 24v-8M17 24v-5M27 24v-5" stroke="currentColor" stroke-width="1.6"/>
        <path d="M22 24V11" stroke="var(--yellow)" stroke-width="2.6"/>
      </svg>
      <span>True<span class="b">line</span></span>
    </a>
    <nav aria-label="Sections">
        ${nav}
    </nav>
  </div>
</header>
<div class="scale" data-scale aria-hidden="true" hidden><svg xmlns="http://www.w3.org/2000/svg"></svg></div>
<main id="main">
${body}
</main>
<footer>
  <div class="wrap">
    <div class="cols">
      <div>
        <p class="foot-h" id="foot-trueline">Trueline</p>
        <ul aria-labelledby="foot-trueline">
          <li><a href="/">What it is</a></li>
          <li><a href="/about/">About</a></li>
          <li><a href="mailto:${SITE.email}">${SITE.email}</a></li>
        </ul>
      </div>
      <div>
        <p class="foot-h" id="foot-guides">Guides</p>
        <ul aria-labelledby="foot-guides">
          ${Object.entries(AUDIENCE).map(([k, a]) =>
            `<li><a href="/guides/#${k}">${esc(a.label)}</a></li>`).join('\n          ')}
        </ul>
      </div>
      <div>
        <p class="foot-h" id="foot-calculators">Calculators</p>
        <ul aria-labelledby="foot-calculators">
          ${CALCULATORS.map((c) =>
            `<li><a href="/calculators/${c.slug}/">${esc(c.title)}</a></li>`).join('\n          ')}
        </ul>
      </div>
      <div>
        <p class="foot-h" id="foot-free">Free templates</p>
        <ul aria-labelledby="foot-free">
          ${TEMPLATE_GROUPS.map((g) =>
            `<li><a href="/templates/#${g.id}">${esc(g.title)}</a></li>`).join('\n          ')}
        </ul>
      </div>
    </div>
    <p class="fine">
      ${esc(SITE.name)} · built for one remodeling contractor and now in testing with him ·
      no server, no account, nothing uploaded
    </p>
    <!--
      The light palette's only door. The site is dark, deliberately, and no
      longer follows the visitor's operating system into light -- but somebody
      reading a guide in a bright cab should be able to have it, and a palette
      with no route to it is a palette nobody maintains. It is hidden until the
      script takes it, because a control that cannot work without JavaScript
      should not be drawn to somebody who has none.
    -->
    <button type="button" class="ground" data-ground hidden aria-pressed="false">
      <span data-ground-says>Light background</span>
    </button>
  </div>
</footer>
<script type="module" src="/site.js"></script>
</body>
</html>
`;
}

/* -------------------------------------------------------------- structured */

const ORGANISATION = {
  '@type': 'Organization',
  '@id': url('/#org'),
  name: SITE.name,
  url: SITE.origin,
  email: SITE.email,
  description: SITE.description,
};

const BUILDER = {
  '@type': 'Person',
  '@id': url('/about/#builder'),
  name: PEOPLE.builder.name,
  description: PEOPLE.builder.bio,
  url: url('/about/'),
};

const REVIEWER_LD = REVIEWER ? {
  '@type': 'Person',
  '@id': url('/about/#reviewer'),
  name: REVIEWER.name,
  jobTitle: REVIEWER.role,
  description: REVIEWER.bio,
  url: url('/about/'),
} : null;

const crumbs = (trail) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: trail.map((c, i) => ({
    '@type': 'ListItem', position: i + 1, name: c.name, item: url(c.path),
  })),
});

/* ------------------------------------------------------------ guide blocks */

function renderBlocks(blocks, extras = {}) {
  const out = [];
  for (const b of blocks) {
    // A calculator page says where its own form goes, so the argument for the
    // arithmetic can come before the box and the worked example after it.
    if (b.form) {
      if (!extras.form) throw new Error('A { form: true } block on a page with no calculator.');
      out.push(extras.form);
      continue;
    }
    if (b.h2) { out.push(`<h2 id="${slugify(b.h2)}">${b.h2}</h2>`); continue; }
    if (b.p) { out.push(`<p>${b.p}</p>`); continue; }
    if (b.ul) { out.push(`<ul class="plain">${b.ul.map((li) => `<li>${li}</li>`).join('')}</ul>`); continue; }
    // Formula BEFORE note, and it matters. A block carrying both is a formula
    // with its workings under it, and the note branch tested first swallowed
    // every one of them: eleven equations across the guides rendered as bare
    // notes with the equation itself dropped, the `.formula` rule in the
    // stylesheet went unused on every page, and nothing anywhere said so.
    // `tools/calc-truth.mjs` is what found it, by asking whether a figure the
    // engine worked out was actually on the page.
    if (b.formula) {
      out.push(`<div class="formula"><div class="eq">${b.formula}</div>${
        b.note ? `<div class="why">${b.note}</div>` : ''}</div>`);
      continue;
    }
    if (b.note) { out.push(`<div class="note"><p>${b.note}</p></div>`); continue; }
    if (b.table) {
      out.push(`<div class="scroll"><table><thead><tr>${
        b.table.head.map((h) => `<th>${h}</th>`).join('')
      }</tr></thead><tbody>${
        b.table.rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')
      }</tbody></table></div>`);
      continue;
    }
    if (b.steps) {
      out.push(`<ol class="steps">${b.steps.map((s) =>
        `<li><div><h3>${s.h3}</h3><p>${s.p}</p></div></li>`).join('')}</ol>`);
      continue;
    }
    if (b.shot) {
      out.push(`<figure class="rise"><img src="/img/${b.shot}.png" alt="${
        esc(plain(b.caption))}" loading="lazy" decoding="async" width="812">` +
        `<figcaption>${b.caption}</figcaption></figure>`);
      continue;
    }
    throw new Error('Unknown block: ' + JSON.stringify(Object.keys(b)));
  }
  return out.join('\n');
}

const slugify = (s) => plain(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* ------------------------------------------------------------- the pages */

function guidePage(guide) {
  const path = `/guides/${guide.slug}/`;
  const headings = guide.blocks.filter((b) => b.h2).map((b) => b.h2);
  const template = guide.download ? TEMPLATES.find((t) => t.id === guide.download) : null;
  const related = guide.related.map((slug) => GUIDES.find((g) => g.slug === slug)).filter(Boolean);

  const article = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': url(path) + '#article',
    headline: guide.metaTitle,
    name: guide.title,
    description: guide.description,
    inLanguage: 'en-US',
    datePublished: UPDATED,
    dateModified: UPDATED,
    author: BUILDER,
    ...(REVIEWER_LD ? { reviewedBy: REVIEWER_LD } : {}),
    publisher: ORGANISATION,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url(path) },
    keywords: guide.keywords.join(', '),
    articleSection: AUDIENCE[guide.audience].label,
    timeRequired: `PT${guide.minutes}M`,
    image: url('/img/plan.png'),
  };

  const faq = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: guide.faq.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: plain(f.a) },
    })),
  };

  const body = `
<article class="wrap">
  <div class="narrow guide-head">
    <p class="eyebrow"><a href="/guides/#${guide.audience}" style="color:inherit;text-decoration:none">${
      esc(AUDIENCE[guide.audience].label)}</a></p>
    <h1>${esc(guide.title)}</h1>
    <p class="lede" style="max-width:56ch">${guide.standfirst}</p>
    <div class="meta">
      <span class="byline">
        <span>By <a href="/about/">${esc(PEOPLE.builder.name)}</a></span>
        ${REVIEWER ? `<span>Reviewed by ${esc(REVIEWER.name)}, ${esc(REVIEWER.role)}</span>` : ''}
      </span>
      <span>Updated ${UPDATED}</span>
      <span>${guide.minutes} min</span>
    </div>

    <nav class="toc" aria-label="On this page">
      <p>On this page</p>
      <ol>${headings.map((h) => `<li><a href="#${slugify(h)}">${esc(h)}</a></li>`).join('')}</ol>
    </nav>

    ${renderBlocks(guide.blocks)}

    ${template ? `<div class="note"><p><strong>Free download:</strong>
      <a href="/downloads/${template.file}">${esc(template.title)}</a> — a blank PDF to print,
      generated by the same code that produces the app’s own documents.
      <a href="/templates/">All the templates</a>.</p></div>` : ''}

    <h2 id="questions">Questions people ask</h2>
    <dl class="faq">
      ${guide.faq.map((f) => `<dt>${esc(f.q)}</dt><dd>${f.a}</dd>`).join('\n      ')}
    </dl>

    <hr class="rule">

    <h2 id="the-app">Where this fits with Trueline</h2>
    <p>${esc(SITE.name)} is an iPhone app that measures a room, takes it off, prices it from
      your own rate book and turns it into a proposal — with every length carrying whether it
      was scanned, drawn or measured, right onto the document a client reads.
      <a href="/">See how it works</a>, or
      <a href="/templates/">take the free templates</a> and use them with whatever you
      already have.</p>

    <h2 id="read-next">Read next</h2>
    <div class="next">
      ${related.map((r) => `<a href="/guides/${r.slug}/">
        <span class="k">${esc(AUDIENCE[r.audience].label)}</span>
        <span class="t">${esc(r.title)}</span></a>`).join('\n      ')}
    </div>
  </div>
</article>`;

  return {
    path,
    html: shell({
      title: `${guide.metaTitle} | ${SITE.name}`,
      description: guide.description,
      path, body, ogType: 'article',
      jsonLd: [article, faq, crumbs([
        { name: 'Trueline', path: '/' },
        { name: 'Guides', path: '/guides/' },
        { name: guide.title, path },
      ])],
    }),
  };
}

/* ------------------------------------------------------------- calculators */

/**
 * The compass headings a run can go, in the order somebody walks them.
 *
 * Four rather than an angle, deliberately, and it is the engine's own choice
 * rather than a simplification made for the web: `core/src/room.ts` stores a
 * square wall as a heading and an angled one as an exact run, because an angle
 * in degrees has no exact representation and every corner in the room would
 * then depend on a rounding.
 */
const HEADINGS = ['north', 'east', 'south', 'west'];

/**
 * How many runs a walked room may have on this form.
 *
 * Ten, which takes an L, a U, a bay and most of what a remodeler measures. It
 * is a limit of the form and not of the engine — the app itself has no cap —
 * and the calculator page says so rather than letting somebody with an
 * eleven-sided room conclude the arithmetic cannot do it.
 */
const WALK_ROWS = 10;

const OPENING_KINDS = [
  { key: 'door', plural: 'doors', label: 'Doors' },
  { key: 'window', plural: 'windows', label: 'Windows' },
  { key: 'cased', plural: 'cased', label: 'Cased openings' },
];

/** One labelled box, with its hint tied to it for a screen reader. */
function box(id, name, label, { hint, value, kind = 'text', mode } = {}) {
  const described = hint ? ` aria-describedby="${id}-hint"` : '';
  return `<div class="calc-field">
      <label for="${id}">${esc(label)}</label>
      <input id="${id}" name="${name}" type="${kind}" autocomplete="off"${
        mode ? ` inputmode="${mode}"` : ''}${
        value === undefined ? '' : ` value="${esc(value)}"`}${described}>
      ${hint ? `<span class="calc-hint" id="${id}-hint">${esc(hint)}</span>` : ''}
    </div>`;
}

/**
 * The form, from the field list on the calculator.
 *
 * Every control is in the HTML, filled in with the example the page works
 * through underneath it. Nothing is drawn by script, so the page a crawler
 * reads and the page a person reads are the same page — and the two controls
 * that genuinely cannot work without JavaScript, the shape switch and the
 * submit button, are `hidden` in the markup until `calc.js` has attached to
 * them. A switch that does nothing is worse than no switch.
 */
function calculatorForm(calculator) {
  const id = (name) => `${calculator.slug}-${name}`;
  const parts = [];

  for (const spec of calculator.form) {
    if (spec.shape) {
      const start = spec.start ?? 'rect';
      const walk = spec.walk ?? [];
      const rows = Array.from({ length: WALK_ROWS }, (_, i) => {
        const step = walk[i];
        const heading = step ? step.heading : HEADINGS[(i + 1) % HEADINGS.length];
        return `<div class="walk-row" data-walk-row>
            <span class="walk-n">${i + 1}</span>
            <select name="heading" aria-label="Direction of run ${i + 1}">
              ${HEADINGS.map((h) =>
                `<option value="${h}"${h === heading ? ' selected' : ''}>${h}</option>`).join('')}
            </select>
            <input name="run" type="text" autocomplete="off"
              aria-label="Length of run ${i + 1}"${
              step ? ` value="${esc(step.said)}"` : ''}>
          </div>`;
      }).join('\n          ');

      parts.push(`<fieldset class="calc-switch" data-shape-switch hidden>
      <legend>How is this room shaped?</legend>
      <label><input type="radio" name="shape" value="rect"${
        start === 'rect' ? ' checked' : ''}> A rectangle</label>
      <label><input type="radio" name="shape" value="walk"${
        start === 'walk' ? ' checked' : ''}> Walk the walls</label>
    </fieldset>
    <div data-shape="rect"${start === 'rect' ? '' : ' hidden'}>
      <div class="calc-grid">
        ${box(id('width'), 'width', 'Room width', {
          hint: 'Corner to corner, one way. A bare number means feet.', value: spec.width })}
        ${box(id('depth'), 'depth', 'Room depth', {
          hint: 'Corner to corner, the other way.', value: spec.depth })}
      </div>
    </div>
    <div data-shape="walk"${start === 'walk' ? '' : ' hidden'}>
      <p class="calc-hint">Every straight run, in order, all the way round to where you
        started. Leave the rest blank.</p>
      <div class="walk">
          ${rows}
      </div>
    </div>`);
      continue;
    }

    if (spec.openings) {
      const prefill = spec.prefill ?? {};
      parts.push(`<fieldset class="calc-openings">
      <legend>Openings</legend>
      <p class="calc-hint">Doors and cased openings come out of the wall face and out of the
        baseboard. Windows come out of the wall face only — base runs under a window.</p>
      ${OPENING_KINDS.map((kind) => `<div class="open-row">
        ${box(id(kind.plural), kind.plural, kind.label, {
          mode: 'numeric', value: prefill[kind.plural] ?? '0' })}
        ${box(id(`${kind.key}Width`), `${kind.key}Width`, 'each, wide', {
          value: prefill[`${kind.key}Width`] })}
        ${box(id(`${kind.key}Height`), `${kind.key}Height`, 'each, high', {
          value: prefill[`${kind.key}Height`] })}
      </div>`).join('\n      ')}
    </fieldset>`);
      continue;
    }

    if (spec.select) {
      parts.push(`<div class="calc-field">
      <label for="${id(spec.select)}">${esc(spec.label)}</label>
      <select id="${id(spec.select)}" name="${spec.select}">
        ${spec.options.map((o) =>
          `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('\n        ')}
      </select>
    </div>`);
      continue;
    }

    if (spec.check) {
      parts.push(`<div class="calc-check">
      <input id="${id(spec.check)}" name="${spec.check}" type="checkbox"${
        spec.on ? ' checked' : ''}>
      <label for="${id(spec.check)}">${esc(spec.label)}</label>
    </div>`);
      continue;
    }

    const name = spec.text ?? spec.money;
    parts.push(box(id(name), name, spec.label, {
      hint: spec.hint,
      value: spec.prefill,
      mode: spec.money ? 'decimal' : undefined,
    }));
  }

  return `<form class="calc" data-calc="${calculator.calc}" novalidate>
    ${parts.join('\n    ')}
    <p class="calc-act">
      <button class="btn btn-solid" type="submit" data-calc-go hidden>Work it out</button>
    </p>
    <div class="calc-out" data-out role="status" aria-live="polite"></div>
    <noscript><div class="note"><p>This calculator needs JavaScript, and it is switched off.
      The formula it uses and a worked example are on this page in plain text either side of
      this form, so the page still answers the question — it just will not do the arithmetic
      for your room.</p></div></noscript>
    <p class="calc-fine">Everything happens in this browser. Nothing you type is sent
      anywhere, and there is nothing here to send it to.</p>
  </form>`;
}

function calculatorPage(calculator) {
  const path = `/calculators/${calculator.slug}/`;
  const headings = calculator.blocks.filter((b) => b.h2).map((b) => b.h2);
  const others = calculator.related.calculators
    .map((slug) => CALCULATORS.find((c) => c.slug === slug)).filter(Boolean);
  const guides = calculator.related.guides
    .map((slug) => GUIDES.find((g) => g.slug === slug)).filter(Boolean);

  const application = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    '@id': url(path) + '#app',
    name: calculator.title,
    url: url(path),
    applicationCategory: 'BusinessApplication',
    browserRequirements: 'Requires JavaScript.',
    description: calculator.description,
    inLanguage: 'en-US',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: SITE.price.currency },
    author: BUILDER,
    publisher: ORGANISATION,
    datePublished: UPDATED,
    dateModified: UPDATED,
    keywords: calculator.keywords.join(', '),
  };

  const faq = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: calculator.faq.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: plain(f.a) },
    })),
  };

  const body = `
<article class="wrap">
  <div class="narrow guide-head">
    <p class="eyebrow"><a href="/calculators/" style="color:inherit;text-decoration:none">Calculators</a></p>
    <h1>${esc(calculator.title)}</h1>
    <p class="lede" style="max-width:56ch">${calculator.standfirst}</p>
    <div class="meta">
      <span class="byline"><span>By <a href="/about/">${esc(PEOPLE.builder.name)}</a></span></span>
      <span>Updated ${UPDATED}</span>
      <span>${calculator.minutes} min</span>
      <span>Runs the app’s own engine</span>
    </div>

    <nav class="toc" aria-label="On this page">
      <p>On this page</p>
      <ol>${headings.map((h) => `<li><a href="#${slugify(h)}">${esc(h)}</a></li>`).join('')}</ol>
    </nav>

    ${renderBlocks(calculator.blocks, { form: calculatorForm(calculator) })}

    <h2 id="questions">Questions people ask</h2>
    <dl class="faq">
      ${calculator.faq.map((f) => `<dt>${esc(f.q)}</dt><dd>${f.a}</dd>`).join('\n      ')}
    </dl>

    <hr class="rule">

    <h2 id="the-engine">This is the app’s arithmetic, not a copy of it</h2>
    <p>The figures above are not worked out by anything written for this page. The form hands
      what you typed to ${esc(SITE.name)}’s own measuring engine — the same modules the iPhone
      app runs — and prints what comes back. Lengths are held as whole nanometres and money as
      whole cents, so there is no floating-point number anywhere in a measurement, here or in
      the app.</p>
    <p>The one thing a web form cannot do is know whether anybody put a tape on the wall. That
      is the whole of the difference between this page and
      <a href="/">the app it comes out of</a>: Trueline carries where every length came from —
      scanned, drawn or measured — onto the drawing, the takeoff and the proposal a client
      reads. You can also <a href="/templates/">take the blank forms</a> and use them with
      whatever you already have.</p>

    <h2 id="read-next">The rest of them</h2>
    <div class="next">
      ${others.map((c) => `<a href="/calculators/${c.slug}/">
        <span class="k">Calculator · ${c.minutes} min</span>
        <span class="t">${esc(c.title)}</span></a>`).join('\n      ')}
    </div>
    <h2 id="guides">And the guides behind them</h2>
    <div class="next">
      ${guides.map((g) => `<a href="/guides/${g.slug}/">
        <span class="k">${esc(AUDIENCE[g.audience].label)} · ${g.minutes} min</span>
        <span class="t">${esc(g.title)}</span></a>`).join('\n      ')}
    </div>
  </div>
</article>`;

  return {
    path,
    html: shell({
      title: `${calculator.metaTitle} | ${SITE.name}`,
      description: calculator.description,
      path, body, ogType: 'article',
      head: `<script type="module" src="/${UI_FILE}"></script>\n`,
      jsonLd: [application, faq, crumbs([
        { name: 'Trueline', path: '/' },
        { name: 'Calculators', path: '/calculators/' },
        { name: calculator.title, path },
      ])],
    }),
  };
}

function calculatorsIndex() {
  const body = `
<div class="wrap">
  <div class="guide-head narrow">
    <p class="eyebrow">${CALCULATORS.length} calculators · free · nothing leaves your browser</p>
    <h1>Calculators that run the real engine</h1>
    <p class="lede">Not a form with some arithmetic typed into it. Each one imports
      ${esc(SITE.name)}’s own measuring code — whole nanometres, whole cents, no floating-point
      number in any measurement — so the answer here is the answer the app gives.</p>
  </div>
  <div class="cards narrow" style="margin-top:2.5rem;grid-template-columns:1fr">
    ${CALCULATORS.map((c) => `<div class="card rise">
      <h2><a href="/calculators/${c.slug}/">${esc(c.title)}</a></h2>
      <p style="margin-top:.4rem">${esc(c.standfirst)}</p>
      <p style="margin-top:.9rem"><a class="btn btn-line"
        href="/calculators/${c.slug}/">Open it</a></p>
    </div>`).join('\n    ')}
  </div>
  <div class="narrow">
    <div class="note" style="margin-top:2.5rem"><p>Every one of these refuses to invent a
      number. There is no assumed waste figure, no assumed paint coverage and no material
      price anywhere on this site — those are facts about your job and your supplier, and a
      figure made up here would end up underneath somebody’s order.
      <a href="/guides/">The guides</a> explain the method;
      <a href="/templates/">the blank forms</a> are free.</p></div>
  </div>
</div>`;

  return {
    path: '/calculators/',
    html: shell({
      title: `Contractor calculators | ${SITE.name}`,
      description:
        `${CALCULATORS.length} free calculators for takeoff and pricing — markup and margin, `
        + 'drywall sheets, paint, baseboard and the square footage of an odd-shaped room.',
      path: '/calculators/', body,
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: 'Trueline calculators',
          url: url('/calculators/'),
          publisher: ORGANISATION,
          hasPart: CALCULATORS.map((c) => ({
            '@type': 'WebApplication',
            name: c.title,
            applicationCategory: 'BusinessApplication',
            url: url(`/calculators/${c.slug}/`),
          })),
        },
        crumbs([{ name: 'Trueline', path: '/' }, { name: 'Calculators', path: '/calculators/' }]),
      ],
    }),
  };
}

function homePage() {
  const guide = (slug) => GUIDES.find((g) => g.slug === slug);
  /* Three guides, by name and by hand. A link to the index is a link to a
     shelf; a link to a guide is a link to something worth reading. */
  const trio = ['drywall-takeoff', 'document-water-damage', 'magicplan-alternative'].map(guide);
  const rates = guide('contractor-rate-book');

  const body = `
<section class="hero" data-mark="Room">
  <div class="wrap">
    <div class="hero-head">
      <div>
        <p class="eyebrow">iPhone · no server · no account</p>
        <h1>${esc(SITE.tagline)}</h1>
      </div>
      <div>
        <p class="lede">${esc(SITE.description)}</p>
        <p class="hero-act">
          <a class="btn btn-solid" href="#get-it">Get on the TestFlight list</a>
          <a class="btn btn-line" href="#watch">Watch it work</a>
        </p>
      </div>
    </div>

    <!-- The hero is the room.
         The stage below is the app's own 21' × 20' kitchen, drawn in WebGL, and
         it is the same geometry the Blueprint view draws in flat SVG. Every
         control is here in the HTML and "hidden" until site.js has actually
         attached to it, so the page never shows a switch that does nothing.
         With no WebGL the 3D button is removed and Blueprint — which needs no
         GPU — becomes the view. With no JavaScript at all, the <noscript> plan
         is what shows. -->
    <div class="stage" data-room3d data-view="3d" data-furn="on" data-dims="on" data-labels="off">
      <canvas role="img" aria-label="The kitchen in three dimensions, 21 feet by 20 feet with a 9 foot ceiling. Drag to turn it."></canvas>
      <svg class="over" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"></svg>
      <svg class="plan" xmlns="http://www.w3.org/2000/svg" role="img" hidden
           aria-label="The same kitchen in plan: 21 feet by 20 feet, a door on the west wall and a window on the north."></svg>
      <span class="hint">Drag to turn</span>
      <span class="block">21′ × 20′ · 420 sq ft<br><b>SCANNED</b></span>
      <noscript><img src="/img/plan.png" width="812"
        alt="A dimensioned plan of the scanned kitchen, marked SCANNED"></noscript>
    </div>
    <div class="panel" data-room-panel hidden>
      <span class="lab">View</span>
      <div class="grp grp--view" role="group" aria-label="View">
        <button class="sw" type="button" data-view-btn="3d" aria-pressed="true">3D</button>
        <button class="sw" type="button" data-view-btn="plan" aria-pressed="false">Blueprint</button>
      </div>
      <span class="lab">Show</span>
      <div class="grp" role="group" aria-label="Show">
        <button class="sw" type="button" data-toggle="furn" aria-pressed="true">Furniture</button>
        <button class="sw" type="button" data-toggle="dims" aria-pressed="true">Measurements</button>
        <button class="sw" type="button" data-toggle="labels" aria-pressed="false">Labels</button>
      </div>
      <span class="spacer"></span>
      <span class="note-t">The app’s own kitchen · 21′ × 20′ × 9′</span>
    </div>
  </div>
</section>

<section class="band" data-mark="Proof">
  <div class="wrap proof">
    <figure class="rise">
      <img src="/img/plan.png" alt="A dimensioned plan of a scanned kitchen, marked SCANNED"
           loading="lazy" decoding="async" width="812">
      <figcaption>A real plan, off a real scan. The line under it says the numbers came from a
        scanner rather than a tape — and it stays there until somebody changes that.</figcaption>
    </figure>
    <div class="rise">
      <p class="eyebrow">What it puts on the drawing</p>
      <h2>Every length says where it came from</h2>
      <p>A length the phone found is <span class="nb"><span class="tag tag-scanned">Scanned</span>.</span>
        A length you put a tape on is <span class="nb"><span class="tag tag-measured">Measured</span>.</span>
        A room drawn on a grid says <span class="nb"><span class="tag tag-scanned">Drawn</span>.</span></p>
      <p>Until a tape has been on one wall running each way, every document says so, on its
        face, where a client will read it. A number you cannot defend line by line to a
        homeowner is worse than no number.</p>
      <p><a href="/about/#true">Every claim on this site, and how to check it</a></p>
    </div>
  </div>
</section>

<section class="band band--sunk" data-mark="Price">
  <div class="wrap">
    <p class="eyebrow">What it costs</p>
    <h2>Free to measure. Paid to price.</h2>
    <p class="lede">One seat, no per-project fee, and no charge for a
      client to open something you sent them.</p>
    <div class="plate rise" style="margin-top:1.6rem">
      <div class="fig">
        <span class="big">$${SITE.price.monthly}</span>
        <span class="unit">per month</span>
        <span class="alt">or $${SITE.price.yearly} a year</span>
      </div>
      <div class="split">
        <div>
          <h3>Free, and staying free</h3>
          <ul>
            <li>Measuring the room</li>
            <li>The drawing</li>
            <li>The room in 3D</li>
          </ul>
        </div>
        <div>
          <h3>The subscription</h3>
          <ul>
            <li>The takeoff</li>
            <li>The pricing</li>
            <li>The proposal and change orders</li>
            <li>The claim document</li>
            <li>The exports</li>
          </ul>
        </div>
      </div>
    </div>
    <div class="note"><p><strong>Not on the App Store yet.</strong> Trueline is in testing with
      a working remodeling contractor. The prices above are what it will be sold for; nothing is
      on sale today, and this page will say so until it is.
      <a href="#get-it">Leave an email for the TestFlight link.</a></p></div>
  </div>
</section>

<!-- The two films.

     Not a promo cut and not a screen recording of somebody's best take: both
     are produced by site/tools/film.mjs, which drives the real app in a real
     browser at the size of a phone and encodes what happened. Every tap is a
     real tap and every number on screen is one the app worked out, so if the
     app breaks the film breaks with it.

     preload="none" on purpose. Four megabytes that nobody asked for is four
     megabytes of somebody's data on a job site, and the poster frame is the
     plan that is already on this page and already cached. -->
<section class="band" id="watch" data-mark="Films">
  <div class="wrap">
    <p class="eyebrow">Watch it work</p>
    <h2>Two films, of the real app</h2>
    <p>Neither is a mock-up or a best take. Both were filmed by driving
      the app itself, so every tap is a real tap and every figure on screen is one it worked
      out.</p>

    <div class="films">
      <figure>
        <video controls playsinline preload="none" poster="/film/demo-poster.jpg" width="430"
               aria-label="The work being done: a kitchen scanned, measured, priced, signed and invoiced">
          <source src="/film/demo.mp4" type="video/mp4">
          Your browser will not play this. <a href="/film/demo.mp4">Download it instead.</a>
        </video>
        <figcaption><strong>The job, end to end — 1:42.</strong> An empty app, a business and
          eight rates typed once, a scan opened, two walls put a tape on, the takeoff, the price,
          the proposal written and signed, a deposit raised, the damage marked and metered, and
          the files that leave.</figcaption>
      </figure>

      <figure>
        <video controls playsinline preload="none" poster="/film/tour-poster.jpg" width="430"
               aria-label="The guided tour: every screen in the app, over a finished kitchen">
          <source src="/film/tour.mp4" type="video/mp4">
          Your browser will not play this. <a href="/film/tour.mp4">Download it instead.</a>
        </video>
        <figcaption><strong>Every screen — 1:54.</strong> The guided tour that ships inside the
          app, running over a finished kitchen: the drawing, the room in 3D, the takeoff, the
          price, the proposal, the signature, the change orders, the calendar, the invoice, the
          claim and the files.</figcaption>
      </figure>
    </div>
  </div>
</section>

<section class="band" data-mark="Method">
  <div class="wrap duo">
    <div>
      <p class="eyebrow">How a job goes through it</p>
      <h2>Walk in. Leave with it signed.</h2>
      <p style="font-size:.97rem">Six steps, in the order they happen on site.</p>
      <p><a href="/guides/${rates.slug}/">${esc(rates.title)}</a></p>
    </div>
    <ol class="steps steps--grid">
      <li><div><h3>Walk the room</h3><p>The phone finds the walls, the doors and the windows in
        about ninety seconds. No LiDAR? Tap the corners onto a grid.</p></div></li>
      <li><div><h3>Put a tape on it</h3><p>One wall running each way. The app says which walls
        are worth measuring, and why.</p></div></li>
      <li><div><h3>Take it off</h3><p>Floor, ceiling, wall face, baseboard, framing, every door
        and window deducted. The arithmetic is shown rather than hidden.</p></div></li>
      <li><div><h3>Price it from your own book</h3><p>Your rates, typed once. No averages, no
        market data — a number you set times a number the room measured.</p></div></li>
      <li><div><h3>Get it signed</h3><p>A proposal in sentences, an exclusions list, and a
        record of who signed, when, and the exact words.</p></div></li>
      <li><div><h3>Bill against what was signed</h3><p>Deposits, progress payments and the
        final. Anything that changes becomes a change order.</p></div></li>
    </ol>
  </div>
</section>

<section class="band band--sunk" data-mark="Spec">
  <div class="wrap duo">
    <div>
      <p class="eyebrow">Specification</p>
      <h2>What is in it, and where it lives</h2>
      <p style="font-size:.97rem">There is no Trueline server. Nothing is
        uploaded, nothing is analysed, and there is no way for one person’s house to reach
        another’s.</p>
      <p><a href="/templates/">Take the blank forms, free</a></p>
    </div>
    <dl class="spec">
      <div><dt>The drawing</dt><dd>A plan with real dimension lines, doors, windows, north and
        your letterhead. Blueprint or 3D.</dd></div>
      <div><dt>The takeoff</dt><dd>Every quantity with its workings, as a sheet you can send,
        copy, or open in a spreadsheet.</dd></div>
      <div><dt>Insurance</dt><dd>Damage marked while you stand in front of it. Photographs,
        moisture readings over time, a claim document, and ESX for Xactimate.</dd></div>
      <div><dt>Scheduling</dt><dd>Days into your own calendar. Invoices off the signed scope. A
        QuickBooks export.</dd></div>
      <div><dt>Your business</dt><dd>Licence number, insurance, logo and rates typed one time
        and on every document after that.</dd></div>
      <div><dt>Written on the phone</dt><dd>On an iPhone with Apple Intelligence it drafts the
        scope paragraph and the loss description from figures it already has — free, offline,
        nothing leaves the device. You read every word first.</dd></div>
      <div><dt>The rooms</dt><dd>A folder per scan, visible in the Files app. AirDrop one, mail
        one, copy one off. No account needed to read your own work.</dd></div>
      <div><dt>The backup</dt><dd>Your own iCloud — not ours. A corrected room is a few
        kilobytes, so a free iCloud account holds a very large number of them.</dd></div>
      <div><dt>The photographs</dt><dd>On the phone. A scan’s pictures run to tens of megabytes,
        so sending them up is a decision per job rather than a default.</dd></div>
    </dl>
  </div>
</section>

<section class="band" data-mark="Guides">
  <div class="wrap">
    <p class="eyebrow">Start here</p>
    <h2>Three that are worth the time</h2>
    <div class="next" style="margin-top:1.4rem">
      ${trio.map((g) => `<a href="/guides/${g.slug}/">
        <span class="k">${esc(AUDIENCE[g.audience].label)} · ${g.minutes} min</span>
        <span class="t">${esc(g.title)}</span></a>`).join('\n      ')}
    </div>
    <p style="margin-top:1.2rem"><a href="/guides/">All ${GUIDES.length} guides, by trade</a></p>
  </div>
</section>

<section class="band band--sunk" data-mark="Sums">
  <div class="wrap duo">
    <div>
      <p class="eyebrow">${CALCULATORS.length} calculators · free</p>
      <h2>Do the sum here, with the app’s own arithmetic</h2>
      <p style="font-size:.97rem">Not a form with some arithmetic typed into it. Each one
        imports the same measuring code the app runs — whole nanometres, whole cents, no
        floating-point number in any measurement — so the answer on the web page is the answer
        on the phone. None of them will invent a waste figure, a coverage rate or a price.</p>
      <p><a href="/calculators/">All ${CALCULATORS.length} of them</a></p>
    </div>
    <ul class="rows">
      ${CALCULATORS.map((c) => `<li><a href="/calculators/${c.slug}/">
        <span class="t">${esc(c.title)}</span>
        <span class="m">${c.minutes} min</span></a></li>`).join('\n      ')}
    </ul>
  </div>
</section>

<section class="band" id="get-it" data-mark="Email">
  <div class="wrap">
    <div class="signup rise">
      <p class="eyebrow" style="margin-bottom:.6rem">The one thing this page asks for</p>
      <h2>Leave an email. Get the TestFlight link.</h2>
      <p style="max-width:52ch;margin:0">One email, when there is something to install. No
        newsletter, no drip sequence, no sharing it with anybody. If you would rather just write:
        <a href="mailto:${SITE.email}">${SITE.email}</a>.</p>
      <form name="waitlist" method="POST" data-netlify="true" action="/thanks/">
        <input type="hidden" name="form-name" value="waitlist">
        <p style="display:none"><label>Leave this empty <input name="bot-field"></label></p>
        <label class="visually-hidden" for="trade">Your trade</label>
        <input id="trade" type="text" name="trade" placeholder="Your trade — remodeler, restoration…" autocomplete="organization-title">
        <label class="visually-hidden" for="email">Email address</label>
        <input id="email" type="email" name="email" placeholder="you@yourcompany.com" required autocomplete="email">
        <button class="btn btn-solid" type="submit">Tell me when</button>
      </form>
      <p class="fine">Stored by Netlify as form submissions. Nothing else happens to it.</p>
    </div>
  </div>
</section>`;

  return {
    path: '/',
    html: shell({
      title: `${SITE.name} — ${SITE.tagline}`,
      description: SITE.description,
      path: '/', body,
      jsonLd: [
        { '@context': 'https://schema.org', ...ORGANISATION },
        {
          '@context': 'https://schema.org',
          '@type': 'SoftwareApplication',
          name: SITE.name,
          applicationCategory: 'BusinessApplication',
          operatingSystem: 'iOS',
          description: SITE.description,
          url: SITE.origin,
          author: BUILDER,
          publisher: ORGANISATION,
          offers: {
            '@type': 'Offer',
            price: String(SITE.price.monthly),
            priceCurrency: SITE.price.currency,
            availability: 'https://schema.org/PreOrder',
            url: url('/#get-it'),
          },
        },
      ],
    }),
  };
}

function guidesIndex() {
  /* Four shelves in the order somebody arrives at them, not in whatever order
     the four data files happen to import. */
  const ORDER = ['contractor', 'restoration', 'compare', 'homeowner'];
  /* The one to hand somebody first. Written down rather than "the first in the
     array", because which guide opens a shelf is an editorial decision and it
     should not change silently when a guide is added. */
  const LEAD = {
    contractor: 'drywall-takeoff',
    restoration: 'document-water-damage',
    compare: 'magicplan-alternative',
    homeowner: 'estimate-should-include',
  };
  const MARK = { contractor: 'Trade', restoration: 'Resto', compare: 'Compare', homeowner: 'Owner' };

  const counts = Object.fromEntries(
    ORDER.map((key) => [key, GUIDES.filter((g) => g.audience === key).length]));

  const shelves = ORDER.map((key) => {
    const meta = AUDIENCE[key];
    const mine = GUIDES.filter((g) => g.audience === key);
    const lead = mine.find((g) => g.slug === LEAD[key]) ?? mine[0];
    const rest = mine.filter((g) => g !== lead);
    return `
    <section class="shelf" id="${key}" data-mark="${esc(MARK[key])}">
      <p class="eyebrow">${counts[key]} guides</p>
      <h2>${esc(meta.label)}</h2>
      <p class="blurb">${esc(meta.blurb)}</p>
      <a class="lead" href="/guides/${lead.slug}/">
        <span class="k">Start here · ${lead.minutes} min</span>
        <span class="t">${esc(lead.title)}</span>
        <span class="d">${esc(lead.description)}</span>
      </a>
      <ul class="rows">
        ${rest.map((g) => `<li><a href="/guides/${g.slug}/">
          <span class="t">${esc(g.title)}</span>
          <span class="m">${g.minutes} min</span></a></li>`).join('\n        ')}
      </ul>
    </section>`;
  }).join('\n');

  const body = `
<div class="wrap">
  <div class="guide-head">
    <p class="eyebrow">${GUIDES.length} guides · free · no sign-up</p>
    <h1>How to measure it, price it and get paid for it</h1>
    <p class="lede">Written for people who do this work. No affiliate links, no prices invented
      for a market nobody here knows, and nothing claimed that has not been established.</p>
    <p style="margin-top:1rem">Want the sum rather than the method?
      <a href="/calculators/">The ${CALCULATORS.length} calculators</a> run the app’s own
      engine on figures you type.</p>
  </div>

  <div class="index-grid" style="margin-top:2.75rem">
    <nav class="index-nav" aria-label="Guides by trade">
      <ol>
        ${ORDER.map((key) => `<li><a href="#${key}"><span>${esc(AUDIENCE[key].label)}</span>
          <b>${counts[key]}</b></a></li>`).join('\n        ')}
      </ol>
    </nav>
    <div>${shelves}
    </div>
  </div>
</div>`;

  return {
    path: '/guides/',
    html: shell({
      title: `Guides for contractors and restoration crews | ${SITE.name}`,
      description:
        `${GUIDES.length} in-depth guides on takeoff, estimating, proposals, water damage `
        + 'documentation and choosing a measuring app.',
      path: '/guides/', body,
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: 'Trueline guides',
          url: url('/guides/'),
          publisher: ORGANISATION,
          hasPart: GUIDES.map((g) => ({
            '@type': 'Article',
            headline: g.metaTitle,
            url: url(`/guides/${g.slug}/`),
          })),
        },
        crumbs([{ name: 'Trueline', path: '/' }, { name: 'Guides', path: '/guides/' }]),
      ],
    }),
  };
}

function templatesPage() {
  const body = `
<div class="wrap">
  <div class="guide-head narrow">
    <p class="eyebrow">Free · no email required</p>
    <h1>Blank forms you can print</h1>
    <p class="lede">Generated by the same code that produces the app’s own documents, so a
      blank one and a filled-in one are the same form. Take them and use them with whatever
      you already have.</p>
  </div>
  <div class="narrow" style="margin-top:2.5rem">
    ${TEMPLATE_GROUPS.map((group) => {
      const mine = TEMPLATES.filter((t) => t.group === group.id);
      if (mine.length === 0) throw new Error(`Template group "${group.id}" is empty.`);
      return `<section id="${group.id}">
      <h2>${esc(group.title)}</h2>
      <p class="blurb">${esc(group.blurb)}</p>
      <div class="cards" style="grid-template-columns:1fr">
        ${mine.map((t) => `<div class="card rise">
          <h3>${esc(t.title)}</h3>
          <p style="margin-top:.4rem">${esc(t.blurb)}</p>
          <p style="margin-top:.9rem">
            <a class="btn btn-line" href="/downloads/${t.file}" download>Download the PDF</a>
            <a href="/guides/${t.guide}/" style="margin-left:1rem;font-size:.92rem">Read the guide</a>
          </p>
        </div>`).join('\n        ')}
      </div>
    </section>`;
    }).join('\n    ')}
    <div class="note" style="margin-top:2.5rem"><p>No sign-up, no email wall. If they are
      useful, the thing that helps is linking to them.</p></div>
    <div class="note"><p><strong>There is no blank lien waiver here, on purpose.</strong>
      A waiver is an operative legal instrument, some states prescribe the exact wording and
      give no effect to any other, and nobody here can check which state yours is. So what is
      offered is the half that is not state-specific — a sheet for recording which waivers were
      asked for and received — and the waiver itself has to come from your own state or your
      own attorney. Printing one written from memory is how a contractor loses a lien.</p></div>
  </div>
</div>`;

  return {
    path: '/templates/',
    html: shell({
      title: `Free contractor forms and templates | ${SITE.name}`,
      description:
        `${TEMPLATES.length} blank forms as real PDFs — estimate, proposal, change order, `
        + 'takeoff, moisture log, scope sheet, photo log, punch list. Free, no email.',
      path: '/templates/', body,
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: 'Free contractor templates',
          itemListElement: TEMPLATES.map((t, i) => ({
            '@type': 'ListItem', position: i + 1, name: t.title,
            url: url(`/downloads/${t.file}`),
          })),
        },
        crumbs([{ name: 'Trueline', path: '/' }, { name: 'Free templates', path: '/templates/' }]),
      ],
    }),
  };
}

function aboutPage() {
  const body = `
<div class="wrap narrow">
  <div class="guide-head">
    <p class="eyebrow">About</p>
    <h1>Who makes this, and what it will and will not say</h1>
  </div>

  <h2 id="who">Who</h2>
  <p><strong>${esc(PEOPLE.builder.name)}</strong> — ${esc(PEOPLE.builder.role)}.
    ${esc(PEOPLE.builder.bio)}</p>
  ${REVIEWER ? `<p><strong>${esc(REVIEWER.name)}</strong> — ${esc(REVIEWER.role)}.
    ${esc(REVIEWER.bio)} He reviews the trade guides on this site.</p>` : ''}

  <h2 id="true">What this site claims, and how you can check it</h2>
  <div class="scroll">
    <table>
      <thead><tr><th>Claim</th><th>How it can be checked</th></tr></thead>
      <tbody>
        ${CLAIMS.map((c) => `<tr><td>${esc(c.say)}</td><td>${esc(c.how)}</td></tr>`).join('\n        ')}
      </tbody>
    </table>
  </div>

  <h2 id="not-claimed">What it deliberately does not claim</h2>
  <ul class="plain">
    ${NOT_CLAIMED.map((n) => `<li>${esc(n)}</li>`).join('\n    ')}
  </ul>
  <div class="note"><p>Nobody has yet run a scan against a tape and recorded the difference.
    Until somebody does, this site says nothing about how close a scan is — which is convenient,
    because that is also the product’s whole argument.</p></div>

  <h2 id="guides">About the guides</h2>
  <p>They exist to be useful on their own. No affiliate links, no invented prices for a market
    nobody here knows, and no paraphrasing of a standard nobody here has in front of them.
    Where a guide describes the IICRC S500 it says to buy the standard, because that is the
    honest advice.</p>

  <h2 id="contact">Contact</h2>
  <p>Write to <a href="mailto:${SITE.email}">${SITE.email}</a>. Corrections especially — if
    something on this site is wrong, saying so gets it changed.</p>
</div>`;

  return {
    path: '/about/',
    html: shell({
      title: `About Trueline: Built With One Contractor`,
      description:
        'Who builds Trueline, what this site claims, how each claim can be checked, and what '
        + 'it deliberately does not claim.',
      path: '/about/', body,
      jsonLd: [
        { '@context': 'https://schema.org', '@type': 'AboutPage', url: url('/about/'),
          publisher: ORGANISATION, mainEntity: BUILDER },
        crumbs([{ name: 'Trueline', path: '/' }, { name: 'About', path: '/about/' }]),
      ],
    }),
  };
}

function thanksPage() {
  const body = `
<div class="wrap narrow" style="padding-top:5rem;min-height:50vh">
  <p class="eyebrow">Got it</p>
  <h1>That is on the list.</h1>
  <p class="lede">One email, when there is something to install. Nothing else.</p>
  <p style="margin-top:2rem"><a class="btn btn-line" href="/guides/">Read the guides</a></p>
</div>`;
  return {
    path: '/thanks/',
    html: shell({
      title: `Thanks | ${SITE.name}`,
      description: 'Your email is on the list.',
      path: '/thanks/', body,
      head: '<meta name="robots" content="noindex, follow">\n',
      jsonLd: null,
    }),
  };
}

function notFound() {
  const body = `
<div class="wrap narrow" style="padding-top:5rem;min-height:50vh">
  <p class="eyebrow">404</p>
  <h1>That page is not here.</h1>
  <p class="lede">It may have moved, or it may never have existed.</p>
  <p style="margin-top:2rem">
    <a class="btn btn-solid" href="/">Start again</a>
    <a class="btn btn-line" href="/guides/" style="margin-left:.6rem">All ${GUIDES.length} guides</a>
  </p>
</div>`;
  return {
    path: '/404.html',
    html: shell({
      title: 'Not found | ' + SITE.name,
      description: 'That page is not here.',
      path: '/404.html', body,
      head: '<meta name="robots" content="noindex, nofollow">\n',
      jsonLd: null,
    }),
    file: '404.html',
  };
}

/* ---------------------------------------------------------------- writing */

function write(page) {
  const file = page.file
    ?? (page.path === '/' ? 'index.html' : page.path.replace(/^\//, '') + 'index.html');
  const full = join(DIST, file);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, page.html);
  return file;
}

const pages = [
  homePage(),
  guidesIndex(),
  calculatorsIndex(),
  templatesPage(),
  aboutPage(),
  thanksPage(),
  notFound(),
  ...GUIDES.map(guidePage),
  ...CALCULATORS.map(calculatorPage),
];

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

for (const page of pages) write(page);

/* Assets. */
cpSync(join(HERE, 'src/fonts'), join(DIST, 'fonts'), { recursive: true });
// Cloudflare Pages reads _headers and _redirects from the root of whatever
// folder is dropped on it, so they are files in the output rather than
// settings in a dashboard -- which means they are in git, reviewed, and they
// travel with the build that needs them.
{
  // The hash of the inline script above, written into the policy as the build
  // emits it. `@NO_FLASH_HASH@` in src/host/_headers is replaced here; if the
  // placeholder is ever removed the build stops rather than shipping a policy
  // that blocks its own script.
  const digest = createHash('sha256').update(NO_FLASH, 'utf8').digest('base64');
  const headers = readFileSync(join(HERE, 'src/host/_headers'), 'utf8');
  if (!headers.includes('@NO_FLASH_HASH@')) {
    throw new Error('src/host/_headers no longer has @NO_FLASH_HASH@ in its '
      + 'Content-Security-Policy, so the inline theme script would be blocked');
  }
  writeFileSync(join(DIST, '_headers'), headers.replaceAll('@NO_FLASH_HASH@', `sha256-${digest}`));
}
cpSync(join(HERE, 'src/host/_redirects'), join(DIST, '_redirects'));
cpSync(join(HERE, 'src/style.css'), join(DIST, 'style.css'));
cpSync(join(HERE, 'src/site.js'), join(DIST, 'site.js'));
// The films, if they have been shot. `node site/tools/film.mjs` makes them,
// and the page above degrades to a download link rather than a broken player
// when they are absent — which is what a checkout with no films in it looks
// like, and it must not fail the build.
if (existsSync(join(HERE, 'film'))) {
  mkdirSync(join(DIST, 'film'), { recursive: true });
  for (const name of ['demo.mp4', 'tour.mp4', 'demo-poster.jpg', 'tour-poster.jpg']) {
    const from = join(HERE, 'film', name);
    if (existsSync(from)) cpSync(from, join(DIST, 'film', name));
  }
}

if (existsSync(join(HERE, 'src/shots'))) {
  cpSync(join(HERE, 'src/shots'), join(DIST, 'img'), { recursive: true });
}
const icon = readFileSync(join(HERE, 'src/favicon.svg'), 'utf8');
writeFileSync(join(DIST, 'favicon.svg'), icon);
if (existsSync(join(HERE, '../web/public/apple-touch-icon.png'))) {
  cpSync(join(HERE, '../web/public/apple-touch-icon.png'), join(DIST, 'apple-touch-icon.png'));
}

const pdfs = await buildPdfs(join(DIST, 'downloads'));

/* The engine the calculators run: core/src, bundled for a browser. */
const engine = await buildEngine(DIST);

/* Sitemap — every indexable page, and nothing that is not. */
const indexable = pages.filter((p) => !['/thanks/', '/404.html'].includes(p.path));
writeFileSync(join(DIST, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
  + indexable.map((p) =>
      `  <url><loc>${url(p.path)}</loc><lastmod>${UPDATED}</lastmod>`
      + `<priority>${p.path === '/' ? '1.0' : p.path === '/guides/' ? '0.9' : '0.8'}</priority></url>`
    ).join('\n')
  + `\n</urlset>\n`);

writeFileSync(join(DIST, 'robots.txt'),
  `User-agent: *\nAllow: /\nDisallow: /thanks/\n\nSitemap: ${url('/sitemap.xml')}\n`);

console.log(`${pages.length} pages · ${GUIDES.length} guides · ${CALCULATORS.length} calculators `
  + `· ${pdfs.length} PDFs · ${indexable.length} in the sitemap`);
console.log(`engine: ${engine.map((e) => `${e.file} ${(e.bytes / 1024).toFixed(1)}kB`).join(' · ')}`);
// Said every time, because opening dist/index.html by double-clicking it does
// not work and does not look like it does not work: every link and stylesheet
// on this site is an absolute path, and under `file://` an absolute path
// resolves to the root of the disk. The page then loads with no CSS at all --
// which renders as one enormous purple shape, not as a blank page, so it reads
// as a broken site rather than as a wrong way to open one.
console.log('Look at it with:  npm run site-open   (a real server, on 127.0.0.1:4180)');
