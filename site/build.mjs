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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SITE, PEOPLE, NAV, CLAIMS, NOT_CLAIMED } from './content/site.mjs';
import { TEMPLATES } from './content/templates.mjs';
import { CONTRACTOR } from './content/guides/contractor.mjs';
import { RESTORATION } from './content/guides/restoration.mjs';
import { COMPARE } from './content/guides/compare.mjs';
import { HOMEOWNER } from './content/guides/homeowner.mjs';
import { buildPdfs } from './tools/pdfs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, 'dist');

const GUIDES = [...CONTRACTOR, ...RESTORATION, ...COMPARE, ...HOMEOWNER];

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

/* ---------------------------------------------------------------- the shell */

function shell({ title, description, path, body, jsonLd, ogType = 'website', head = '' }) {
  const canonical = url(path);
  const nav = NAV.map((item) => {
    const here = item.href === path || (item.href !== '/' && path.startsWith(item.href));
    return `<a href="${item.href}"${here ? ' aria-current="page"' : ''}${
      item.href === '/' ? ' class="hide-sm"' : ''}>${esc(item.label)}</a>`;
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
<meta name="theme-color" content="#F7F3EA" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#10171E" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700;800&family=IBM+Plex+Mono:wght@400;500&family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&display=swap">
<link rel="stylesheet" href="/style.css">
${head}${structured}
</head>
<body>
<header class="bar">
  <div class="wrap">
    <a class="mark" href="/">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="6" fill="currentColor"/>
        <path d="M7 23h18M7 23V9" stroke="var(--paper)" stroke-width="2.4" stroke-linecap="round"/>
        <path d="M11 23v-4M16 23v-8M21 23v-6" stroke="var(--amber)" stroke-width="1.6" stroke-linecap="round"/>
      </svg>
      <span>True<span style="color:var(--amber)">line</span></span>
    </a>
    <nav aria-label="Sections">
        ${nav}
    </nav>
  </div>
</header>
<main id="main">
${body}
</main>
<footer>
  <div class="wrap">
    <div class="cols">
      <div>
        <h4>Trueline</h4>
        <ul>
          <li><a href="/">What it is</a></li>
          <li><a href="/about/">About</a></li>
          <li><a href="mailto:${SITE.email}">${SITE.email}</a></li>
        </ul>
      </div>
      <div>
        <h4>Guides</h4>
        <ul>
          ${Object.entries(AUDIENCE).map(([k, a]) =>
            `<li><a href="/guides/#${k}">${esc(a.label)}</a></li>`).join('\n          ')}
        </ul>
      </div>
      <div>
        <h4>Free templates</h4>
        <ul>
          ${TEMPLATES.map((t) => `<li><a href="/templates/">${esc(t.title)}</a></li>`).join('\n          ')}
        </ul>
      </div>
    </div>
    <p class="fine">
      ${esc(SITE.name)} · built for one remodeling contractor and now in testing with him ·
      no server, no account, nothing uploaded
    </p>
  </div>
</footer>
<script type="module" src="/room3d.js"></script>
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

function renderBlocks(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.h2) { out.push(`<h2 id="${slugify(b.h2)}">${b.h2}</h2>`); continue; }
    if (b.p) { out.push(`<p>${b.p}</p>`); continue; }
    if (b.ul) { out.push(`<ul class="plain">${b.ul.map((li) => `<li>${li}</li>`).join('')}</ul>`); continue; }
    if (b.note) { out.push(`<div class="note"><p>${b.note}</p></div>`); continue; }
    if (b.formula) {
      out.push(`<div class="formula"><div class="eq">${b.formula}</div>${
        b.note ? `<div class="why">${b.note}</div>` : ''}</div>`);
      continue;
    }
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

function homePage() {
  const body = `
<section class="hero">
  <div class="wrap hero-grid">
    <div>
      <p class="eyebrow">iPhone · no server · no account</p>
      <h1>${esc(SITE.tagline)}</h1>
      <p class="lede">${esc(SITE.description)}</p>
      <p style="display:flex;gap:.7rem;flex-wrap:wrap;margin-top:1.6rem">
        <a class="btn btn-solid" href="#get-it">Get it when it opens</a>
        <a class="btn btn-line" href="/guides/">Read the guides</a>
      </p>
    </div>
    <div class="stage" data-room3d aria-label="A room in three dimensions. Drag to turn it.">
      <canvas></canvas>
      <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <style>
          .dim { stroke: var(--ink-quiet); stroke-width: 1; }
          .tick { stroke: var(--amber); stroke-width: 1.4; }
          .fig { font: 500 13px var(--f-mono); fill: var(--ink); text-anchor: middle;
                 dominant-baseline: middle; paint-order: stroke;
                 stroke: var(--paper-sunk); stroke-width: 4px; }
        </style>
      </svg>
      <span class="hint">Drag to turn</span>
      <span class="block">21′ × 20′ · 420 sq ft<br><b>SCANNED</b></span>
    </div>
  </div>
</section>

<hr class="rule">

<section class="wrap rise">
  <p class="eyebrow">The one thing it will not do</p>
  <h2 style="margin-top:0">Tell you a scan is a measurement</h2>
  <p style="max-width:58ch">Every length in this app carries where it came from, and the word
    is on the drawing. A length the phone found is <span class="tag tag-scanned">Scanned</span>.
    A length you put a tape on is <span class="tag tag-measured">Measured</span>. A room drawn
    on a grid says <span class="tag tag-scanned">Drawn</span>.</p>
  <p style="max-width:58ch">Until a tape has been on one wall running each way, every document
    says so, on its face, where a client will read it. That is the whole product. A number you
    cannot defend line by line to a homeowner is worse than no number.</p>
</section>

<section class="wrap rise" style="margin-top:3rem">
  <figure>
    <img src="/img/plan.png" alt="A dimensioned plan of a scanned kitchen, marked SCANNED"
         loading="lazy" decoding="async" width="812">
    <figcaption>A real plan, off a real scan. The line under it says the numbers came from a
      scanner rather than a tape — and it stays there until somebody changes that.</figcaption>
  </figure>
</section>

<hr class="rule">

<!-- The two films.

     Not a promo cut and not a screen recording of somebody's best take: both
     are produced by site/tools/film.mjs, which drives the real app in a real
     browser at the size of a phone and encodes what happened. Every tap is a
     real tap and every number on screen is one the app worked out, so if the
     app breaks the film breaks with it.

     preload="none" on purpose. Four megabytes that nobody asked for is four
     megabytes of somebody's data on a job site, and the poster frame is the
     plan that is already on this page and already cached. -->
<section class="wrap rise" id="watch" style="margin-top:3rem">
  <p class="eyebrow">Watch it work</p>
  <h2 style="margin-top:0">Two films, of the real app</h2>
  <p style="max-width:58ch">Neither is a mock-up or a best take. Both were filmed by driving
    the app itself, so every tap is a real tap and every figure on screen is one it worked
    out. If the app changes, the films are re-shot from it.</p>

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
</section>

<hr class="rule">

<section class="wrap rise">
  <p class="eyebrow">How a job goes through it</p>
  <ol class="steps" style="max-width:60ch">
    <li><div><h3>Walk the room</h3><p>The phone finds the walls, the doors and the windows in
      about ninety seconds. No LiDAR? Tap the corners onto a grid, or point at each one
      through the camera.</p></div></li>
    <li><div><h3>Put a tape on it</h3><p>One wall running each way. The app tells you which
      walls are worth measuring and why — an error on the longest wall costs the most floor
      area.</p></div></li>
    <li><div><h3>Take it off</h3><p>Floor, ceiling, wall face, baseboard, framing, every door
      and window deducted. The arithmetic is shown rather than hidden.</p></div></li>
    <li><div><h3>Price it from your own book</h3><p>Your rates, typed once. No averages, no
      market data. Every line is a number you set times a number the room measured.</p></div></li>
    <li><div><h3>Get it signed</h3><p>A proposal in sentences, an exclusions list, and a
      signature record: who signed, when, the exact words, and a fingerprint of the
      document.</p></div></li>
    <li><div><h3>Bill against what was signed</h3><p>Deposits, progress payments and the final,
      built from the signed scope. Anything that changes becomes a change order.</p></div></li>
  </ol>
</section>

<hr class="rule">

<section class="wrap rise">
  <p class="eyebrow">What is in it</p>
  <div class="cards" style="margin-top:1.5rem">
    <div class="card"><h3>The drawing</h3><p>A plan with real dimension lines, doors, windows,
      north and your letterhead. Blueprint or 3D — walk through the room, or take the roof off
      the whole floor.</p></div>
    <div class="card"><h3>The takeoff</h3><p>Every quantity with its workings, as a sheet you
      can send, copy, or open in a spreadsheet.</p></div>
    <div class="card"><h3>Insurance</h3><p>Mark damage while standing in front of it.
      Photographs, moisture readings over time, a claim document, and ESX for Xactimate.</p></div>
    <div class="card"><h3>Scheduling and invoicing</h3><p>Days into your own calendar. Invoices
      off the signed scope. A QuickBooks export. No monthly service behind any of it.</p></div>
    <div class="card"><h3>Your business, once</h3><p>Licence number, insurance, logo and rates
      typed one time and on every document after that.</p></div>
    <div class="card"><h3>Written on the phone</h3><p>On an iPhone that supports Apple
      Intelligence it will draft the scope paragraph and the loss description from figures it
      already has — free, offline, nothing leaves the device. You read every word first.</p></div>
  </div>
</section>

<hr class="rule">

<section class="wrap rise">
  <p class="eyebrow">Where your work lives</p>
  <div class="scroll">
    <table>
      <thead><tr><th>Thing</th><th>Where it is</th><th>What that means</th></tr></thead>
      <tbody>
        <tr><td>The rooms</td><td>A folder per scan on your phone</td>
          <td>Visible in the Files app. AirDrop one, mail one, copy one off. No account needed
            to read your own work.</td></tr>
        <tr><td>The backup</td><td>Your own iCloud</td>
          <td>Not ours — yours. A corrected room is a few kilobytes, so a free iCloud account
            holds a very large number of them.</td></tr>
        <tr><td>The photographs</td><td>On the phone</td>
          <td>A scan’s pictures run to tens of megabytes. Sending them up would fill your
            iCloud with one job, so that is a decision per job rather than a default.</td></tr>
        <tr><td>Everything else</td><td>Nowhere</td>
          <td>There is no Trueline server. Nothing is uploaded, nothing is analysed, and there
            is no way for one person’s house to reach another’s.</td></tr>
      </tbody>
    </table>
  </div>
</section>

<hr class="rule">

<section class="wrap rise">
  <p class="eyebrow">What it costs</p>
  <h2 style="margin-top:0">Free to measure. Paid to price.</h2>
  <p style="max-width:56ch">Measuring, the drawing and the 3D view are free and will stay free.
    The takeoff, the pricing, the proposal, the change orders, the claim document and the
    exports are the subscription: <strong>$${SITE.price.monthly} a month, or
    $${SITE.price.yearly} a year</strong>. One seat, no per-project fee, and no charge for a
    client to open something you sent them.</p>
  <div class="note"><p><strong>Not on the App Store yet.</strong> Trueline is in testing with a
    working remodeling contractor. The prices above are what it will be sold for; nothing is on
    sale today, and this page will say so until it is.</p></div>
</section>

<section class="wrap" id="get-it">
  <div class="signup rise">
    <p class="eyebrow" style="margin-bottom:.5rem">Get it when it opens</p>
    <h2 style="margin:0 0 .4rem">One email, when there is something to install.</h2>
    <p style="max-width:52ch;margin:0">No newsletter, no drip sequence, no sharing it with
      anybody. If you would rather just write:
      <a href="mailto:${SITE.email}">${SITE.email}</a>.</p>
    <form name="waitlist" method="POST" data-netlify="true" action="/thanks/">
      <input type="hidden" name="form-name" value="waitlist">
      <p style="display:none"><label>Leave this empty <input name="bot-field"></label></p>
      <label class="visually-hidden" for="trade" style="position:absolute;left:-9999px">Your trade</label>
      <input id="trade" type="text" name="trade" placeholder="Your trade — remodeler, restoration…" autocomplete="organization-title">
      <label class="visually-hidden" for="email" style="position:absolute;left:-9999px">Email address</label>
      <input id="email" type="email" name="email" placeholder="you@yourcompany.com" required autocomplete="email">
      <button class="btn btn-solid" type="submit">Tell me when</button>
    </form>
    <p class="fine">Stored by Netlify as form submissions. Nothing else happens to it.</p>
  </div>
</section>

<section class="wrap rise">
  <p class="eyebrow">Start here</p>
  <div class="next" style="margin-top:1rem">
    ${['drywall-takeoff', 'document-water-damage', 'magicplan-alternative', 'estimate-should-include']
      .map((slug) => GUIDES.find((g) => g.slug === slug))
      .map((g) => `<a href="/guides/${g.slug}/">
        <span class="k">${esc(AUDIENCE[g.audience].label)}</span>
        <span class="t">${esc(g.title)}</span></a>`).join('\n    ')}
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
  const groups = Object.entries(AUDIENCE).map(([key, meta]) => {
    const mine = GUIDES.filter((g) => g.audience === key);
    return `
  <section id="${key}" class="rise" style="margin-top:3rem">
    <p class="eyebrow">${esc(meta.label)} · ${mine.length} guides</p>
    <h2 style="margin-top:0">${esc(meta.blurb)}</h2>
    <div class="next" style="margin-top:1.4rem">
      ${mine.map((g) => `<a href="/guides/${g.slug}/">
        <span class="k">${g.minutes} min</span>
        <span class="t">${esc(g.title)}</span></a>`).join('\n      ')}
    </div>
  </section>`;
  }).join('\n');

  const body = `
<div class="wrap">
  <div class="guide-head">
    <p class="eyebrow">${GUIDES.length} guides</p>
    <h1>How to measure it, price it and get paid for it</h1>
    <p class="lede">Written for people who do this work. No affiliate links, no prices invented
      for a market nobody here knows, and nothing claimed that has not been established.</p>
  </div>
  ${groups}
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
  <div class="cards narrow" style="margin-top:2.5rem;grid-template-columns:1fr">
    ${TEMPLATES.map((t) => `<div class="card rise">
      <h3>${esc(t.title)}</h3>
      <p style="margin-top:.4rem">${esc(t.blurb)}</p>
      <p style="margin-top:.9rem">
        <a class="btn btn-line" href="/downloads/${t.file}" download>Download the PDF</a>
        <a href="/guides/${t.guide}/" style="margin-left:1rem;font-size:.92rem">Read the guide</a>
      </p>
    </div>`).join('\n    ')}
  </div>
  <div class="narrow">
    <div class="note" style="margin-top:2.5rem"><p>No sign-up, no email wall. If they are
      useful, the thing that helps is linking to them.</p></div>
  </div>
</div>`;

  return {
    path: '/templates/',
    html: shell({
      title: `Free contractor forms and templates | ${SITE.name}`,
      description:
        'Blank estimate, proposal, change order, takeoff sheet and water damage log — real '
        + 'PDFs, free, no email required.',
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
      title: `About Trueline`,
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
  templatesPage(),
  aboutPage(),
  thanksPage(),
  notFound(),
  ...GUIDES.map(guidePage),
];

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

for (const page of pages) write(page);

/* Assets. */
cpSync(join(HERE, 'src/style.css'), join(DIST, 'style.css'));
cpSync(join(HERE, 'src/room3d.js'), join(DIST, 'room3d.js'));
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

console.log(`${pages.length} pages · ${GUIDES.length} guides · ${pdfs.length} PDFs · ${indexable.length} in the sitemap`);
