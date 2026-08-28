import test from 'node:test';
import assert from 'node:assert/strict';

import { PaletteError, TONES, onPaper } from '../design.ts';

/**
 * The black square.
 *
 * > "PIC 2: NO IMAGE IN THE HTML FILE"
 *
 * A `var()` cannot leave the document that declares it, and CSS does not treat
 * an unresolvable one as absent — it invalidates the whole declaration, so
 * `fill` falls back to black. Every drawing this app hands over is serialised
 * out of the app's own document, so every one of them has to be resolved on the
 * way. These are the tests that keep it resolved.
 */

test('a token becomes the channels of its light value', () => {
  // --c-ink is `ink` on the light ground. Read from TONES rather than typed in,
  // so a palette change moves the expectation with it.
  const hex = TONES.ink!.light;
  const n = parseInt(hex.slice(1), 16);
  const channels = `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
  assert.equal(
    onPaper('<rect fill="rgb(var(--c-ink))"/>'),
    `<rect fill="rgb(${channels})"/>`
  );
});

test('a camelCase tone is found under its kebab-case name', () => {
  // `refuseSoft` in TypeScript is `--c-refuse-soft` in the drawing, and getting
  // that conversion wrong throws rather than going black.
  assert.doesNotThrow(() => onPaper('<rect fill="rgb(var(--c-refuse-soft))"/>'));
});

test('every colour in the palette resolves', () => {
  // The one that matters. A tone nobody converted is a tone that prints black
  // the first time somebody paints with it.
  for (const name of Object.keys(TONES)) {
    const token = `--c-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
    assert.doesNotThrow(
      () => onPaper(`<rect fill="rgb(var(${token}))"/>`),
      `${name} does not resolve as ${token}`
    );
  }
});

test('nothing is left that would resolve to nothing', () => {
  const svg =
    '<svg><rect fill="rgb(var(--c-raise))"/><line stroke="rgb(var(--c-ink))"/>' +
    '<line stroke="rgb(var(--c-refuse))"/></svg>';
  const out = onPaper(svg);
  assert.ok(!out.includes('var('), out);
  assert.ok(!out.includes('--c-'), out);
});

test('an unknown token is refused, not left in', () => {
  // Leaving it would put the black square back on a document somebody pays off.
  assert.throws(
    () => onPaper('<rect fill="rgb(var(--c-nosuchcolour))"/>'),
    (error: unknown) =>
      error instanceof PaletteError && /--c-nosuchcolour/.test((error as Error).message)
  );
});

test('a var() that is not a colour travels untouched', () => {
  // Stroke widths ride on the element's own inline style and resolve perfectly
  // well. Resolving them here would be this function knowing about things that
  // are not its business.
  const svg = '<line style="stroke-width: var(--picked-width)"/>';
  assert.equal(onPaper(svg), svg);
});

test('resolving twice changes nothing', () => {
  // `claimFile` resolves what it is handed, and `planSvg` now hands it
  // something already resolved. Both orders have to be safe.
  const once = onPaper('<rect fill="rgb(var(--c-raise))"/>');
  assert.equal(onPaper(once), once);
});
