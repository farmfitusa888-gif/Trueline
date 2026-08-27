/**
 * Finding the browser, on whatever machine this is.
 *
 * ## The bug this is the answer to
 *
 * Every tool here that drives a browser had the same line copied into it:
 *
 *     process.env.TRUELINE_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
 *
 * That path is real in one container and nowhere else. `npm run verify` runs
 * `check-art`, `check-art` launches a browser, and on a Mac it died with
 * *"Failed to launch chromium because executable doesn't exist at
 * /opt/pw-browsers/chromium-1194/chrome-linux/chrome"* — so the one command
 * that is supposed to say whether the repository is sound could not pass on
 * the machine the app is actually built on.
 *
 * ## Why `chromium.executablePath()` alone is not enough
 *
 * It is the right first answer and it is wrong here: it returns the path for
 * the build number the installed `playwright` package expects, and a machine
 * can perfectly well have a working browser under a different number. In the
 * container this repository is developed in, `executablePath()` returns
 * `chromium-1234/chrome-linux64/chrome` and what is on disk is
 * `chromium-1194/chrome-linux/chrome`. A resolver that trusted it would have
 * moved the failure from the Mac to the container instead of fixing it.
 *
 * So: ask, then look, then say exactly what to type. Every candidate is
 * checked against the disk before it is handed back, because a path that does
 * not exist is not an answer.
 */
import { existsSync, readdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

/** Where Playwright keeps browsers, unless it was told otherwise. */
export function browserRoots(env = process.env, os = platform()) {
  if (env.PLAYWRIGHT_BROWSERS_PATH) return [env.PLAYWRIGHT_BROWSERS_PATH];
  if (os === 'darwin') return [join(homedir(), 'Library', 'Caches', 'ms-playwright')];
  if (os === 'win32') {
    return [join(env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'ms-playwright')];
  }
  return [join(homedir(), '.cache', 'ms-playwright')];
}

/** Where the executable sits inside one unpacked build, per platform. */
const INSIDE = [
  'chrome-linux/chrome',
  'chrome-linux64/chrome',
  'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
  'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium',
  'chrome-win/chrome.exe',
];

/**
 * The first candidate that is actually on disk, or null.
 *
 * `exists` and `list` are parameters so this can be tested against a machine
 * that is not this one — which is the only way to check the Mac branch from
 * Linux and the Linux branch from a Mac. `core/test/browser.test.ts` does both.
 */
export function pickFrom(
  { asked, playwright, roots },
  exists = existsSync,
  list = (dir) => { try { return readdirSync(dir); } catch { return []; } }
) {
  // What somebody typed wins outright, including when it is wrong: a resolver
  // that quietly used a different browser than the one it was handed would be
  // impossible to debug.
  if (asked) return exists(asked) ? asked : null;

  if (playwright && exists(playwright)) return playwright;

  // Any unpacked build under any root, highest build number first — a newer
  // Chromium is the better guess when there is more than one lying about.
  const builds = [];
  for (const root of roots) {
    for (const entry of list(root)) {
      const number = /^chromium-(\d+)$/.exec(entry);
      if (number) builds.push({ at: join(root, entry), number: Number(number[1]) });
    }
  }
  builds.sort((a, b) => b.number - a.number);
  for (const build of builds) {
    for (const inside of INSIDE) {
      const path = join(build.at, inside);
      if (exists(path)) return path;
    }
  }

  // A bare `chromium` beside the numbered builds — how some prepared images
  // point at whichever one they installed.
  for (const root of roots) {
    const plain = join(root, 'chromium');
    if (exists(plain)) return plain;
    for (const inside of INSIDE) {
      const path = join(plain, inside);
      if (exists(path)) return path;
    }
  }
  return null;
}

/** What Playwright thinks, or null when it will not say. */
function whatPlaywrightThinks() {
  try {
    return chromium.executablePath();
  } catch {
    // Thrown when no browser has ever been installed for this package. That is
    // not an error here — it is one candidate of several coming back empty.
    return null;
  }
}

/**
 * The browser to drive, as a path.
 *
 * Throws with the exact command to run when there is none, rather than letting
 * Playwright fail later with a path nobody on this machine chose.
 */
export function chromePath() {
  const asked = process.env.TRUELINE_CHROME;
  const found = pickFrom({
    asked,
    playwright: whatPlaywrightThinks(),
    roots: browserRoots(),
  });
  if (found) return found;
  throw new Error(
    asked
      ? `TRUELINE_CHROME is set to ${asked} and there is nothing there.`
      : 'No Chromium on this machine. Install the one this repo drives with:\n'
        + '\n    npx playwright install chromium\n\n'
        + 'Or point TRUELINE_CHROME at a Chromium you already have.'
  );
}

/** `chromium.launch`, with the browser this machine actually has. */
export function openChromium(options = {}) {
  return chromium.launch({ executablePath: chromePath(), ...options });
}
