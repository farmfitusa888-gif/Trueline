/**
 * Finding an ffmpeg that can write H.264, on whatever machine this is.
 *
 * ## Why not just use the one Playwright ships
 *
 * There is an `ffmpeg` inside every Playwright install, and it is the wrong
 * one: it is built to write the VP8 that `recordVideo` produces and nothing
 * else. A film encoded with it is a WebM, and WebM in Safari — on a Mac and on
 * a phone, which is where these get watched — is recent, partial and a coin
 * toss. H.264 in an mp4 plays everywhere, including inside a message.
 *
 * So a build that cannot write H.264 is no use here, and picking it silently
 * would be worse than not finding one at all. Every candidate is asked whether
 * it has `libx264` before it is handed back.
 *
 * ## The order
 *
 *  1. `TRUELINE_FFMPEG`, if it is set — including when it is wrong, because a
 *     resolver that quietly used a different encoder than the one it was given
 *     is impossible to debug.
 *  2. `ffmpeg` on the PATH. On a Mac that is `brew install ffmpeg`; on most
 *     Linux boxes it is the system package. Either way it is the one somebody
 *     chose.
 *  3. The build that comes with the `imageio-ffmpeg` Python wheel, which is a
 *     full GPL build with x264 in it and installs with one pip command on any
 *     platform.
 *  4. Otherwise, say what to type.
 *
 * This file exists because `site/tools/film.mjs` had an absolute path to an
 * unpacked wheel inside one container baked into it — the same mistake, in the
 * same week, as the browser path that stopped `npm run verify` on Sam's Mac.
 * `core/tools/check-portable.py` now fails the build for either.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/** Whether this build can write the codec the films are in. */
export function writesH264(path) {
  try {
    const out = execFileSync(path, ['-hide_banner', '-h', 'encoder=libx264'], {
      stdio: 'pipe', encoding: 'utf8', timeout: 15000,
    });
    return /libx264/.test(out);
  } catch {
    return false;
  }
}

function onThePath() {
  try {
    const found = execFileSync('sh', ['-c', 'command -v ffmpeg'], {
      stdio: 'pipe', encoding: 'utf8', timeout: 10000,
    }).trim();
    return found || null;
  } catch {
    return null;
  }
}

function fromTheWheel() {
  for (const python of ['python3', 'python']) {
    try {
      const found = execFileSync(
        python,
        ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'],
        { stdio: 'pipe', encoding: 'utf8', timeout: 20000 }
      ).trim();
      if (found && existsSync(found)) return found;
    } catch {
      // No Python, or the wheel is not installed. Next candidate.
    }
  }
  return null;
}

/** An ffmpeg that can write H.264. Throws with the command to run when there is none. */
export function ffmpegPath() {
  const asked = process.env.TRUELINE_FFMPEG;
  if (asked) {
    if (!existsSync(asked)) {
      throw new Error(`TRUELINE_FFMPEG is set to ${asked} and there is nothing there.`);
    }
    if (!writesH264(asked)) {
      throw new Error(`TRUELINE_FFMPEG points at an ffmpeg with no libx264 in it: ${asked}`);
    }
    return asked;
  }

  const tried = [];
  for (const candidate of [onThePath(), fromTheWheel()]) {
    if (!candidate) continue;
    if (writesH264(candidate)) return candidate;
    tried.push(candidate);
  }

  throw new Error(
    (tried.length
      ? `Found ffmpeg at ${tried.join(' and ')}, and none of them can write H.264.\n\n`
      : 'No ffmpeg on this machine.\n\n')
    + 'The films are H.264 in an mp4 so they play in Safari and in a message.\n'
    + 'Get one that can write it:\n'
    + '\n    brew install ffmpeg          # macOS\n'
    + '    pip install imageio-ffmpeg   # anywhere with Python\n\n'
    + 'Or point TRUELINE_FFMPEG at one you already have.'
  );
}
