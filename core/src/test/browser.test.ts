import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error -- a tool, in plain JavaScript, with no types file. Reached
// from a test on purpose: this is the code that decides whether `npm run
// verify` can run at all on somebody's machine, and it was wrong on every
// machine but one.
import { browserRoots, pickFrom } from '../../tools/browser.mjs';

/**
 * Finding the browser on a machine that is not this one.
 *
 * ## The bug
 *
 * Eight tools each had the same path copied into them:
 *
 *     process.env.TRUELINE_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
 *
 * That is real inside one Linux container and nowhere else. `npm run verify`
 * runs `check-art`, `check-art` drives a browser, and on the Mac the app is
 * actually built on it stopped dead:
 *
 *     browserType.launch: Failed to launch chromium because executable doesn't
 *     exist at /opt/pw-browsers/chromium-1194/chrome-linux/chrome
 *
 * So the one command that says whether the repository is sound could not pass
 * on the machine that ships it.
 *
 * ## Why these tests take `exists` and `list` as parameters
 *
 * There is no other way to check the Mac branch from Linux, or the Linux
 * branch from a Mac. Every case below describes a real machine — a Mac with
 * Playwright installed the normal way, this container with a build number that
 * does not match the package's, a machine with nothing — and asks what would
 * be picked there. A test that could only describe the machine it runs on
 * would be the same mistake one level up.
 */

/** A fake disk: these paths exist, nothing else does. */
const disk = (...paths: readonly string[]) => {
  const there = new Set(paths);
  return {
    exists: (p: string) => there.has(p),
    list: (dir: string) => {
      const kids = new Set<string>();
      for (const p of there) {
        if (!p.startsWith(dir + '/')) continue;
        kids.add(p.slice(dir.length + 1).split('/')[0]!);
      }
      return [...kids];
    },
  };
};

test('finding a browser', async (t) => {
  await t.test('a Mac with Playwright installed the ordinary way', () => {
    const root = '/Users/sam/Library/Caches/ms-playwright';
    const app = `${root}/chromium-1234/chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium`;
    const { exists, list } = disk(app);
    assert.equal(
      pickFrom({ asked: undefined, playwright: app, roots: [root] }, exists, list),
      app
    );
  });

  await t.test('the container, where the installed build is not the expected one', () => {
    // What `chromium.executablePath()` returns here is 1234; what is on disk is
    // 1194. A resolver that trusted Playwright would fail on this machine, and
    // one that only ever used the hard-coded path failed on every other.
    const root = '/opt/pw-browsers';
    const real = `${root}/chromium-1194/chrome-linux/chrome`;
    const { exists, list } = disk(real);
    assert.equal(
      pickFrom(
        { asked: undefined, playwright: `${root}/chromium-1234/chrome-linux64/chrome`, roots: [root] },
        exists, list
      ),
      real
    );
  });

  await t.test('two builds lying about: the newer one', () => {
    const root = '/opt/pw-browsers';
    const old = `${root}/chromium-1100/chrome-linux/chrome`;
    const recent = `${root}/chromium-1194/chrome-linux/chrome`;
    const { exists, list } = disk(old, recent);
    assert.equal(
      pickFrom({ asked: undefined, playwright: null, roots: [root] }, exists, list),
      recent
    );
  });

  await t.test('a prepared image that points at one with a bare name', () => {
    const root = '/opt/pw-browsers';
    const { exists, list } = disk(`${root}/chromium`);
    assert.equal(
      pickFrom({ asked: undefined, playwright: null, roots: [root] }, exists, list),
      `${root}/chromium`
    );
  });

  await t.test('a machine with no browser at all says so, rather than guessing', () => {
    const { exists, list } = disk();
    assert.equal(
      pickFrom({ asked: undefined, playwright: null, roots: ['/nowhere'] }, exists, list),
      null
    );
  });

  await t.test('what somebody typed wins, even over a browser that is installed', () => {
    const root = '/opt/pw-browsers';
    const mine = '/Applications/Chromium.app/Contents/MacOS/Chromium';
    const { exists, list } = disk(mine, `${root}/chromium-1194/chrome-linux/chrome`);
    assert.equal(
      pickFrom({ asked: mine, playwright: null, roots: [root] }, exists, list),
      mine
    );
  });

  await t.test('and a typed path that is not there is null, never something else', () => {
    // Silently driving a different browser than the one somebody named is the
    // kind of failure nobody can debug.
    const root = '/opt/pw-browsers';
    const { exists, list } = disk(`${root}/chromium-1194/chrome-linux/chrome`);
    assert.equal(
      pickFrom({ asked: '/tmp/typo', playwright: null, roots: [root] }, exists, list),
      null
    );
  });
});

test('where to look, per machine', async (t) => {
  await t.test('a Mac', () => {
    assert.deepEqual(browserRoots({}, 'darwin').length, 1);
    assert.match(browserRoots({}, 'darwin')[0], /Library\/Caches\/ms-playwright$/);
  });

  await t.test('Linux', () => {
    assert.match(browserRoots({}, 'linux')[0], /\.cache\/ms-playwright$/);
  });

  await t.test('Windows', () => {
    assert.match(
      browserRoots({ LOCALAPPDATA: 'C:\\Users\\sam\\AppData\\Local' }, 'win32')[0],
      /ms-playwright$/
    );
  });

  await t.test('and PLAYWRIGHT_BROWSERS_PATH beats all three', () => {
    assert.deepEqual(
      browserRoots({ PLAYWRIGHT_BROWSERS_PATH: '/opt/pw-browsers' }, 'darwin'),
      ['/opt/pw-browsers']
    );
  });
});
