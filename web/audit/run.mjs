import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Builds, serves, and walks the whole app.
 *
 * One command, because an audit somebody has to set up by hand is an audit
 * nobody runs. It starts the preview server, waits for it to answer, runs every
 * part in order and reports the total. The server is stopped whatever
 * happens, including a part that throws.
 */

const here = dirname(fileURLToPath(import.meta.url));
const web = dirname(here);
const PORT = process.env.TRUELINE_AUDIT_PORT ?? '4173';
const url = `http://127.0.0.1:${PORT}/`;

const server = spawn('npx', ['vite', 'preview', '--port', PORT, '--host', '127.0.0.1'], {
  cwd: web,
  stdio: 'ignore',
});

async function waitForIt() {
  for (let tries = 0; tries < 40; tries += 1) {
    try {
      const answer = await fetch(url);
      if (answer.ok) return true;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

const parts = [
  'a1-core.mjs',
  'a2-edits.mjs',
  'a3-draw.mjs',
  'a4-business.mjs',
  'a5-claim.mjs',
  'a6-persist.mjs',
  'a7-client.mjs',
  'a8-agree.mjs',
  'a9-trade.mjs',
  'a10-gate.mjs',
  'a11-work.mjs',
  'a12-everything.mjs',
  'a13-handbook.mjs',
  'a14-inside.mjs',
  'a15-openplan.mjs',
  'a16-navigation.mjs',
  'a17-takeoff.mjs',
  'a18-handover.mjs',
  'a19-money.mjs',
  'a20-drafts.mjs',
  'a21-tour.mjs',
  'a22-voice.mjs',
  'a23-scope.mjs',
  'a24-change.mjs',
  'a25-entitlement.mjs',
  'a26-vendor.mjs',
  'a27-signed-back.mjs',
  'a28-photos.mjs',
  'a29-tapped.mjs',
  'a30-ceiling.mjs',
  'a31-mark.mjs',
  'a32-claim-money.mjs',
  'a33-howmuch.mjs',
  'a34-naming.mjs',
  'a35-returned.mjs',
  'a36-address.mjs',
  'a37-scanphotos.mjs',
  'a38-sent.mjs',
  'a39-collapse.mjs',
  'a40-ceiling.mjs',
  'a41-fieldsheet.mjs',
  'a42-forms.mjs',
  'a43-corrections.mjs',
  'a44-pricebook.mjs',
  'a45-takeoff-controls.mjs',
  'a46-viewing.mjs',
  'a47-drawing-controls.mjs',
  'a48-withdraw.mjs',
  'a49-notsaved.mjs',
  'a50-readable.mjs',
  'a53-drawings.mjs',
];

/**
 * A part that is on disk and not in that list is a part nobody runs.
 *
 * The list is written out by hand because the ORDER is deliberate — a1 walks
 * the cold start, a8 signs what a5 priced — and a directory listing sorts
 * a10 before a2. But a hand-written list is a list somebody forgets, and four
 * parts had already been written and left out of it. So the list is checked
 * against the directory before anything runs, and a missing name stops the
 * audit rather than passing quietly with a part left out.
 */
const onDisk = (await readdir(here))
  .filter((name) => /^a\d+-.*\.mjs$/.test(name))
  .sort();
const forgotten = onDisk.filter((name) => !parts.includes(name));
const gone = parts.filter((name) => !onDisk.includes(name));
if (forgotten.length > 0 || gone.length > 0) {
  server.kill();
  if (forgotten.length > 0) console.error(`Not in run.mjs, so never run: ${forgotten.join(', ')}`);
  if (gone.length > 0) console.error(`In run.mjs but not on disk: ${gone.join(', ')}`);
  process.exit(1);
}

function run(part) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(here, part)], {
      stdio: 'inherit',
      env: { ...process.env, TRUELINE_AUDIT_URL: url },
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

let failed = 0;
try {
  if (!await waitForIt()) {
    console.error(`The preview server never answered on ${url}. Run "npm run build" first.`);
    process.exitCode = 1;
  } else {
    for (const part of parts) failed += (await run(part)) === 0 ? 0 : 1;
    console.log(
      failed === 0
        ? `\nAll ${parts.length} parts passed.`
        : `\n${failed} of ${parts.length} parts had a failure.`
    );
    process.exitCode = failed === 0 ? 0 : 1;
  }
} finally {
  server.kill();
}
