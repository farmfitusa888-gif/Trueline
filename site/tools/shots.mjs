/**
 * Photographs the built site, in both themes and at both widths.
 *
 * Because "it should look right" is not a check. This opens the real files in a
 * real browser and reports what it measured: contrast on the text that
 * matters, whether the page scrolls sideways, whether WebGL came up, and
 * whether anything threw.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const CHROME = process.env.TRUELINE_CHROME
  ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// Over HTTP, not file://. Absolute paths like /style.css resolve to the
// filesystem root under file://, and a module script is blocked by CORS — so a
// file:// run reports a perfectly good site as broken in every way at once.
const DIST = process.env.TRUELINE_SITE_URL ?? 'http://127.0.0.1:4190/';
const OUT = '/tmp/site-shots';
mkdirSync(OUT, { recursive: true });

const lum = (rgb) => {
  const [r, g, b] = String(rgb).match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};

const browser = await chromium.launch({ executablePath: CHROME });
const pages = [
  ['home', 'index.html'],
  ['guides', 'guides/index.html'],
  ['guide', 'guides/drywall-takeoff/index.html'],
  ['templates', 'templates/index.html'],
];

let worst = 99;
for (const scheme of ['light', 'dark']) {
  for (const [width, tag] of [[390, 'phone'], [1280, 'desk']]) {
    const ctx = await browser.newContext({
      viewport: { width, height: 900 }, colorScheme: scheme, deviceScaleFactor: 2,
    });
    for (const [name, file] of pages) {
      const page = await ctx.newPage();
      const trouble = [];
      page.on('pageerror', (e) => trouble.push('threw: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error') trouble.push('console: ' + m.text()); });
      await page.goto(DIST + file.replace(/index\.html$/, ''), { waitUntil: 'load' });
      await page.waitForTimeout(700);

      const sideways = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1);
      const read = await page.evaluate(() => {
        const body = getComputedStyle(document.body);
        const p = document.querySelector('p:not(.eyebrow)');
        const quiet = document.querySelector('.lede') ?? p;
        const small = document.querySelector('.eyebrow');
        return {
          bg: body.backgroundColor,
          body: p ? getComputedStyle(p).color : body.color,
          quiet: quiet ? getComputedStyle(quiet).color : body.color,
          small: small ? getComputedStyle(small).color : body.color,
        };
      });
      const c = {
        body: contrast(read.body, read.bg),
        quiet: contrast(read.quiet, read.bg),
        small: contrast(read.small, read.bg),
      };
      worst = Math.min(worst, c.body, c.quiet, c.small);

      const webgl = name === 'home'
        ? await page.evaluate(() => document.querySelector('[data-room3d]')?.dataset.webgl ?? 'none')
        : '—';

      console.log(
        `${scheme.padEnd(5)} ${tag.padEnd(5)} ${name.padEnd(9)}`
        + ` sideways:${sideways ? 'YES' : 'no '}`
        + ` body ${c.body.toFixed(1)}:1  quiet ${c.quiet.toFixed(1)}:1  label ${c.small.toFixed(1)}:1`
        + ` webgl:${webgl}`
        + (trouble.length ? '  ' + trouble.join(' | ') : ''));

      if (scheme === 'light' && tag === 'phone') {
        await page.screenshot({ path: `${OUT}/${name}-phone.png`, fullPage: name !== 'home' });
      }
      if (scheme === 'dark' && tag === 'desk' && name === 'home') {
        await page.screenshot({ path: `${OUT}/home-dark.png` });
      }
      if (scheme === 'light' && tag === 'desk' && name === 'home') {
        await page.screenshot({ path: `${OUT}/home-desk.png` });
      }
      await page.close();
    }
    await ctx.close();
  }
}
await browser.close();
console.log(`\nworst contrast anywhere: ${worst.toFixed(1)}:1 (WCAG AA wants 4.5)`);
console.log('shots in ' + OUT);
