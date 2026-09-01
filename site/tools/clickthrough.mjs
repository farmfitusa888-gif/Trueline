/**
 * Drives the built site in a real browser, at real phone and desktop widths,
 * and refuses to pass if anything overflows sideways or dies in the console.
 *
 *   node site/tools/clickthrough.mjs            every page, every width
 *   node site/tools/clickthrough.mjs --shots    and write screenshots
 *
 * ## What it measures rather than assumes
 *
 * A sideways scroll on a phone is the one layout bug that cannot be seen in
 * the markup: it comes from a real element being wider than a real viewport,
 * and only a browser at that width knows. So every page is opened at every
 * width in WIDTHS, `documentElement.scrollWidth` is compared against the
 * viewport, and the widest element on the page is named when it is over.
 *
 * The title bar is checked the same way: it must be one row (every link's
 * midline within a few pixels of the others), every link must be visible, and
 * it must still be at the top of the screen after scrolling to the bottom.
 */
import { readdirSync, statSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { openChromium } from '../../core/tools/browser.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, '../dist');
const SHOTS = join(HERE, '../../.build/site-shots');
const wantShots = process.argv.includes('--shots');

const WIDTHS = [
  { w: 320, h: 568, name: 'iPhone SE (320)' },
  { w: 360, h: 780, name: 'Android (360)' },
  { w: 390, h: 844, name: 'iPhone 14/15 (390)' },
  { w: 430, h: 932, name: 'iPhone Pro Max (430)' },
  { w: 768, h: 1024, name: 'iPad portrait (768)' },
  { w: 1280, h: 900, name: 'Laptop (1280)' },
  { w: 1920, h: 1080, name: 'Desktop (1920)' },
];

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.pdf': 'application/pdf', '.xml': 'application/xml', '.txt': 'text/plain',
  '.woff2': 'font/woff2', '.json': 'application/json' };

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) walk(f, out); else out.push(relative(DIST, f));
  }
  return out;
}

/**
 * The `_headers` file Cloudflare will serve, parsed and applied here.
 *
 * Without this the sweep tests a site with no Content-Security-Policy and the
 * live site has one -- so the run that matters is the one nobody does. A CSP
 * that blocks a stylesheet, a font or a script shows up as a console error,
 * and a console error already fails this part; enforcing the real header is
 * what turns "the CSP looks right" into "the CSP was run against every page".
 */
function readHeaderRules() {
  const file = join(DIST, '_headers');
  if (!existsSync(file)) return [];
  const rules = [];
  let current = null;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    if (!raw.startsWith(' ') && !raw.startsWith('\t')) {
      current = { pattern: raw.trim(), headers: [] };
      rules.push(current);
      continue;
    }
    const at = raw.indexOf(':');
    if (at > 0 && current) current.headers.push([raw.slice(0, at).trim(), raw.slice(at + 1).trim()]);
  }
  return rules;
}
const HEADER_RULES = readHeaderRules();

function headersFor(path) {
  const out = {};
  for (const rule of HEADER_RULES) {
    // Cloudflare's matching, as far as this site uses it: a trailing /* is a
    // prefix, anything else is exact.
    const hit = rule.pattern.endsWith('/*')
      ? path.startsWith(rule.pattern.slice(0, -1))
      : rule.pattern === '/*' || rule.pattern === path;
    if (hit) for (const [k, v] of rule.headers) out[k] = v;
  }
  return out;
}

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  const candidates = path.endsWith('/') ? [join(DIST, path, 'index.html')] : [join(DIST, path)];
  for (const file of candidates) {
    try {
      const body = await readFile(file);
      const ext = file.slice(file.lastIndexOf('.'));
      res.writeHead(200, { 'content-type': TYPES[ext] ?? 'application/octet-stream',
                           ...headersFor(path) });
      return res.end(body);
    } catch { /* fall through */ }
  }
  res.writeHead(404, { 'content-type': 'text/html' });
  res.end(await readFile(join(DIST, '404.html')).catch(() => 'not found'));
});

const port = await new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server.address().port)));
const BASE = `http://127.0.0.1:${port}`;

const urls = walk(DIST).filter((f) => f.endsWith('.html') && f !== '404.html')
  .map((f) => '/' + f.replace(/index\.html$/, ''));

const problems = [];
const offsite = [];
let checks = 0;
const ok = (cond, what) => { checks += 1; if (!cond) problems.push(what); };

const browser = await openChromium();
if (wantShots) mkdirSync(SHOTS, { recursive: true });

console.log(`Driving ${urls.length} pages at ${WIDTHS.length} widths — ${urls.length * WIDTHS.length} page loads\n`);

async function drive(size) {
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h },
    deviceScaleFactor: 1, isMobile: size.w < 768, hasTouch: size.w < 768 });
  const page = await ctx.newPage();
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('about:')) return route.continue();
    offsite.push(u);
    return route.abort();
  });
  const noise = [];
  page.on('console', (m) => { if (m.type() === 'error') noise.push(m.text()); });
  page.on('pageerror', (e) => noise.push(e.message));

  let worst = 0, worstAt = '';
  for (const url of urls) {
    noise.length = 0;
    await page.goto(BASE + url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(60);

    const m = await page.evaluate(() => {
      const doc = document.documentElement;
      const over = [];
      if (doc.scrollWidth > window.innerWidth) {
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect();
          if (r.right > window.innerWidth + 1 || r.left < -1) {
            over.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string'
              ? '.' + el.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.') : ''}`
              + ` right=${Math.round(r.right)}`);
          }
          if (over.length > 3) break;
        }
      }
      const links = [...document.querySelectorAll('.bar nav a')];
      const boxes = links.map((a) => a.getBoundingClientRect());
      const bar = document.querySelector('.bar');
      return {
        scrollWidth: doc.scrollWidth, innerWidth: window.innerWidth, over,
        navCount: links.length,
        navHidden: links.filter((a) => a.getBoundingClientRect().width === 0).length,
        navTopSpread: boxes.length ? Math.round(Math.max(...boxes.map((b) => b.top))
          - Math.min(...boxes.map((b) => b.top))) : 0,
        navHeight: boxes.length ? Math.round(Math.max(...boxes.map((b) => b.height))) : 0,
        navTops: boxes.map((b) => Math.round(b.top)),
        navWrapped: links.filter((a) => a.getClientRects().length > 1)
          .map((a) => a.textContent.trim()),
        barPosition: bar ? getComputedStyle(bar).position : 'none',
        smallTargets: [...document.querySelectorAll('a, button')]
          .filter((e) => { const r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && r.height < 24; }).length,
      };
    });

    const slack = m.scrollWidth - m.innerWidth;
    if (slack > worst) { worst = slack; worstAt = url; }
    ok(slack <= 0, `${size.name} ${url}: scrolls sideways by ${slack}px — ${m.over.join(', ') || 'no element identified'}`);
    ok(m.navCount >= 4, `${size.name} ${url}: only ${m.navCount} links in the title bar`);
    ok(m.navHidden === 0, `${size.name} ${url}: ${m.navHidden} title-bar link(s) hidden`);
    ok(m.navTopSpread < Math.max(4, m.navHeight / 2),
       `${size.name} ${url}: the title bar wrapped — link tops ${m.navTops.join(', ')}`);
    ok(m.navWrapped.length === 0,
       `${size.name} ${url}: title-bar link(s) wrap onto two lines — ${m.navWrapped.join(', ')}`);
    ok(m.barPosition === 'sticky', `${size.name} ${url}: the title bar is ${m.barPosition}, not sticky`);
    ok(noise.length === 0, `${size.name} ${url}: console — ${noise.slice(0, 2).join(' | ')}`);
  }

  // The bar has to still be there after scrolling to the bottom of a long page.
  let stuck = { top: 0, scrolled: 0, page: 'none' };
  for (const candidate of ['/guides/three-day-right-to-cancel/', '/guides/drywall-takeoff/',
                           '/guides/', '/calculators/paint/', '/']) {
    await page.goto(BASE + candidate, { waitUntil: 'load' });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(120);
    const m = await page.evaluate(() => {
      const b = document.querySelector('.bar').getBoundingClientRect();
      return { top: Math.round(b.top), scrolled: Math.round(window.scrollY) };
    });
    stuck = { ...m, page: candidate };
    if (m.scrolled > 0) break;
  }
  ok(stuck.scrolled > 0, `${size.name}: no page on the site scrolled, so the bar was never tested`);
  ok(stuck.top <= 1,
     `${size.name}: on ${stuck.page}, after scrolling ${stuck.scrolled}px the bar sat at top=${stuck.top}, so it is not pinned`);

  if (wantShots) {
    for (const [name, url] of [['home', '/'], ['guides', '/guides/'], ['guide', '/guides/drywall-takeoff/'],
                               ['calculators', '/calculators/'], ['calculator', '/calculators/paint/']]) {
      await page.goto(BASE + url, { waitUntil: 'load' });
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(SHOTS, `${size.w}-${name}.png`), fullPage: false });
    }
  }

  console.log(`  ${String(size.w).padStart(4)}px  ${urls.length} pages · widest overflow ${worst}px${worst ? ' at ' + worstAt : ''}`);
  await ctx.close();
}

// The widths are independent -- each is its own browser context reading the
// same static files -- so they run together. Serially this was 301 page loads
// one after another and it did not finish inside ten minutes.
await Promise.all(WIDTHS.map(drive));

await browser.close();
server.close();

// A self-hosted site asks for nothing from anywhere else. If it does, the
// third-party stylesheet that was just removed has crept back in.
ok(offsite.length === 0, `${offsite.length} request(s) went off this machine: `
  + [...new Set(offsite)].slice(0, 3).join(', '));

console.log(`\n${checks} checks`);
if (problems.length) {
  const shown = problems.slice(0, 25);
  for (const p of shown) console.log('  ✗ ' + p);
  if (problems.length > shown.length) console.log(`  ... and ${problems.length - shown.length} more`);
  console.log(`\n${problems.length} problem(s).`);
  process.exit(1);
}
console.log('Every page, every width: no sideways scroll, one sticky row of links, no console errors.');
if (wantShots) console.log(`Screenshots in ${SHOTS}`);
