import { readFileSync } from 'node:fs';
import { SECTIONS, SP, check, contrast, noise, openAsApp, report, section } from './lib.mjs';

/**
 * A50 — every word on every screen, against the ground it is actually painted on.
 *
 * ## The bug this exists for
 *
 * `web/tailwind.config.js` built its custom-property names by interpolating the
 * TypeScript tone name straight in, so ten camelCase tones asked for a property
 * `tokens.css` never declares. CSS does not treat an unresolvable `var()` as
 * absent — it voids the whole declaration — so fifteen utilities painted
 * **nothing at all**, silently, with no console error: every soft and edge tint
 * in the app, and the pressed state of three buttons. A refusal banner meant to
 * be red was a transparent rectangle.
 *
 * Nothing caught it. Two things had to be true at once for that: no check read
 * the colour a person actually sees, and the failure mode of a broken colour in
 * CSS is silence rather than an error.
 *
 * So this part reads the colour a person actually sees. **The ground is walked
 * up the tree**, past every transparent ancestor, exactly the way the browser
 * composites it — which is the specific thing that would have caught the bug,
 * because the ancestor a transparent tint falls through to is the page itself.
 *
 * WCAG AA is the bar: 4.5:1 for body text, 3:1 for text at 24px, or at 18.66px
 * when it is bold. Not a house rule — the same numbers a contractor's own
 * accessibility obligations are written against.
 *
 * Both grounds, because this app follows the phone from a driveway in full sun
 * to a basement with one bulb, and a palette is only as good as its worse half.
 */

const room = JSON.parse(readFileSync(SP + '/dining.json', 'utf8'));

/** The colour actually behind a node: the first ancestor that paints. */
const GROUND = `(node) => {
  for (let at = node; at; at = at.parentElement) {
    const paint = getComputedStyle(at).backgroundColor;
    const parts = String(paint).match(/[\\d.]+/g) || [];
    const alpha = parts.length > 3 ? Number(parts[3]) : 1;
    if (alpha > 0.99) return paint;
  }
  return getComputedStyle(document.documentElement).backgroundColor;
}`;

async function unreadable(page) {
  return page.evaluate(
    ([groundSource]) => {
      const groundOf = eval(groundSource);
      const out = [];
      for (const node of document.querySelectorAll('body *')) {
        // Its own words, not its children's. A wrapper reports the text of
        // everything inside it and would blame the wrong element.
        const own = [...node.childNodes]
          .filter((child) => child.nodeType === 3)
          .map((child) => child.textContent.trim())
          .join(' ')
          .trim();
        if (own.length < 2) continue;

        const box = node.getBoundingClientRect();
        if (box.width < 1 || box.height < 1) continue;
        const style = getComputedStyle(node);
        if (style.visibility === 'hidden' || style.opacity === '0') continue;
        if (node.closest('[hidden]') || node.closest('[aria-hidden="true"]')) continue;

        out.push({
          says: own.slice(0, 60),
          ink: style.color,
          ground: groundOf(node),
          size: parseFloat(style.fontSize),
          weight: Number(style.fontWeight) || 400,
          where: node.tagName.toLowerCase() + (node.className ? '.' + String(node.className).split(/\s+/)[0] : ''),
        });
      }
      return out;
    },
    [GROUND]
  );
}

/** WCAG AA: 3:1 for large text, 4.5:1 for the rest. */
function needs(one) {
  const large = one.size >= 24 || (one.size >= 18.66 && one.weight >= 700);
  return large ? 3 : 4.5;
}

for (const scheme of ['light', 'dark']) {
  const { browser, page } = await openAsApp({ room, fileName: 'dining.json' }, { scheme });
  const bad = [];
  let read = 0;

  for (const name of SECTIONS) {
    await section(page, name);
    await page.waitForTimeout(350);
    for (const one of await unreadable(page)) {
      read += 1;
      const ratio = contrast(one.ink, one.ground);
      if (ratio < needs(one)) bad.push({ ...one, ratio: Number(ratio.toFixed(2)), on: name });
    }
  }

  check(`every screen has words on it to read (${scheme})`, read > 200, String(read));
  check(
    `every word on every screen is readable against the ground it is painted on (${scheme})`,
    bad.length === 0,
    bad.slice(0, 6).map((b) => `${b.on}: "${b.says}" ${b.ratio}:1 ${b.ink} on ${b.ground}`).join(' | ') +
      (bad.length > 6 ? ` (+${bad.length - 6} more)` : '')
  );

  // A ground that is the page's own where a tint was asked for is the shape of
  // the bug itself: the tint resolved to nothing and the text fell through to
  // whatever was behind it. Reported separately because it reads as a palette
  // fault rather than a contrast one.
  const grounds = new Set(bad.map((b) => b.ground));
  check(
    `nothing is unreadable because its own background painted nothing (${scheme})`,
    bad.length === 0 || grounds.size > 1 || bad.length < 3,
    [...grounds].join(' | ')
  );

  check(`no console or page errors while reading every screen (${scheme})`,
    noise().length === 0, noise().join(' | '));
  await browser.close();
}

process.exit(report('A50 — readable on both grounds, on the colour actually painted') > 0 ? 1 : 0);
