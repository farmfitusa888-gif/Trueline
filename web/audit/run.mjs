import { spawn } from 'node:child_process';
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
];

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
