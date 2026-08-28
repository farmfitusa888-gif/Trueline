/**
 * The app's engine, bundled for a browser.
 *
 * The calculators on this site are not a form with some arithmetic typed into
 * it. They import `core/src/*.ts` — the same modules the iPhone app runs — and
 * this is the only step between those files and the browser: esbuild strips the
 * TypeScript types and resolves the imports. Nothing is rewritten, nothing is
 * reimplemented, and no arithmetic is added.
 *
 * Two files come out, and it is two rather than one on purpose:
 *
 *   /calc-engine.js  the engine. Imported by every calculator page, so the
 *                    browser fetches it once and has it for the other four.
 *                    It touches no DOM, which is what lets `tools/calc-truth.mjs`
 *                    load exactly these bytes in Node and check them against
 *                    the source they were built from.
 *   /calc.js         the wiring. Reads the form, prints the result, and imports
 *                    the engine by URL rather than bundling a second copy of it.
 *
 * ## Where esbuild comes from
 *
 * The same place `pdf-lib` comes from for `tools/pdfs.mjs`: the repository's
 * own `node_modules`, hoisted by npm across the workspaces. It is not vendored
 * and it is not optional — a build that cannot bundle the engine must fail
 * loudly here rather than deploy five calculator pages whose scripts 404.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The URL the wiring imports the engine from, and the file it is written to. */
export const ENGINE_URL = '/calc-engine.js';
export const ENGINE_FILE = 'calc-engine.js';
export const UI_FILE = 'calc.js';

const BANNER =
  '/* Trueline. The arithmetic below is core/src/*.ts — the same code the iPhone app\n' +
  '   runs — with its TypeScript types stripped and its imports resolved. Lengths are\n' +
  '   whole nanometres and money is whole cents. There is not a floating-point number\n' +
  '   in any measurement, here or in the app. */';

export async function buildEngine(into) {
  let esbuild;
  try {
    esbuild = await import('esbuild');
  } catch (error) {
    throw new Error(
      'The calculators need esbuild to put core/src on a page, and it is not installed. ' +
        'Run `npm install` at the top of the repository. (' + error.message + ')'
    );
  }

  const common = {
    bundle: true,
    format: 'esm',
    // bigint literals are ES2020. Nothing here needs anything newer, and a
    // lower target would make esbuild refuse rather than silently produce
    // floating-point arithmetic — which is the failure worth being loud about.
    target: 'es2020',
    platform: 'browser',
    charset: 'utf8',
    // Deliberately unminified. A contractor who wants to check what this page
    // did to his numbers can read the file it did it with.
    minify: false,
    banner: { js: BANNER },
    legalComments: 'none',
    write: true,
  };

  await esbuild.build({
    ...common,
    entryPoints: [join(HERE, '../src/calc/engine.mjs')],
    outfile: join(into, ENGINE_FILE),
  });

  await esbuild.build({
    ...common,
    entryPoints: [join(HERE, '../src/calc/ui.mjs')],
    outfile: join(into, UI_FILE),
    // Left as a URL for the browser to fetch, rather than a second copy of the
    // engine inside the wiring.
    external: [ENGINE_URL],
  });

  return [ENGINE_FILE, UI_FILE].map((file) => ({
    file,
    bytes: readFileSync(join(into, file)).length,
  }));
}
