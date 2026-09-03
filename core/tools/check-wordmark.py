#!/usr/bin/env python3
"""A name the product no longer uses, hiding where grep cannot see it.

## The bug this exists for

On 2026-09-02 the product was renamed from Trueline to ScanToBid. The rename
was done by searching every file for `Trueline` and every one of those was
fixed. The app still said Trueline at the top of every screen.

The wordmark is not written as a word. It is written as two elements so the
second half can be a different colour:

    True<span className="text-[#B8590A]">line</span>

There is no string `Trueline` in that line, so no search for one can match it.
The same drawing appeared on the masthead of all six pages of the printed field
card, and neither was found by any amount of grepping. What found them was
reading the file by eye, which does not scale and did not happen for a day.

## What this checks

Every text file in the repository is read twice:

  1. as it is, and
  2. with its tags removed -- `True<span>line</span>` becomes `Trueline`.

A former name that appears only in the second reading is, by construction, a
name split across markup. It cannot be an identifier or a path, because those
do not contain tags. So this needs no list of exceptions for the split case and
reports it as a certainty rather than a suspicion.

The contiguous case is left to `grep`, which already does it well, except for
the handful of identifiers listed in `former-names.json` -- bundle ids, storage
keys, folder names -- which are deliberately unchanged because renaming them
would orphan data already on somebody's phone.

## What it does not cover, said plainly

A name split across a newline INSIDE one element (`True\n  line`) is not
reported, because after the tags come out that reads as two words with a space
between them, which is what it looks like on screen too. A name assembled at
run time from pieces (`'True' + suffix`) is not reported either; nothing in
this repository does that, and a checker that guessed at it would cry wolf.
"""
import html
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
CONFIG = HERE / 'former-names.json'

# Files whose contents a person can end up reading: markup, source that emits
# markup, and documents. Binary and generated bundles are left out -- the
# bundle is rebuilt from the source, so the source is where a fix belongs.
SUFFIXES = {
    '.html', '.htm', '.svg', '.xml', '.md', '.txt',
    '.tsx', '.jsx', '.ts', '.js', '.mjs', '.cjs',
    '.py', '.swift', '.css', '.json',
}

# The built bundle is skipped because it is rebuilt from web/src; a fix there
# would be undone by the next build. This checker and its list are skipped
# because both have to quote the bug to explain it, and a checker that fails on
# its own worked example is a checker nobody can read.
SKIP = (
    'node_modules/', 'dist/', '__pycache__/', 'ios/Trueline/Web/', '.min.',
    'core/tools/check-wordmark.py', 'core/tools/former-names.json',
    'core/tools/check-the-checks.py',
)

TAG = re.compile(r'<[^<>]{0,400}?>', re.DOTALL)


def files() -> list[Path]:
    """Tracked and untracked alike. A file added in the same commit as the bug
    is exactly the file a check that only reads the index would miss."""
    done = subprocess.run(
        ['git', 'ls-files', '--cached', '--others', '--exclude-standard'],
        cwd=ROOT, capture_output=True, text=True,
    )
    if done.returncode != 0:
        # Not a checkout. `check-the-checks.py` runs every tool against a
        # throwaway copy of the project, which has no .git in it, and a checker
        # that can only work inside a repository is a checker that cannot be
        # checked.
        out = [p.relative_to(ROOT).as_posix() for p in sorted(ROOT.rglob('*'))]
    else:
        out = done.stdout.split('\n')
    keep = []
    for rel in out:
        if not rel or any(s in rel for s in SKIP):
            continue
        path = ROOT / rel
        if path.suffix.lower() in SUFFIXES and path.is_file():
            keep.append(path)
    return keep


def main() -> int:
    config = json.loads(CONFIG.read_text())
    gone = [entry['name'] for entry in config['gone']]
    allowed = [entry['text'] for entry in config['allowed']]
    if not gone:
        print('No former names to look for.')
        return 0

    found: list[tuple[str, int, str, str]] = []
    read = 0

    for path in files():
        try:
            raw = path.read_text(encoding='utf-8')
        except (UnicodeDecodeError, OSError):
            continue
        read += 1
        rel = path.relative_to(ROOT).as_posix()

        for name in gone:
            # Only lines that could hide a split name are worth the work: the
            # first half of the name followed by a tag.
            for number, line in enumerate(raw.split('\n'), start=1):
                if name in line:
                    continue                      # contiguous; grep's job
                bare = html.unescape(TAG.sub('', line))
                if name not in bare:
                    continue
                if any(a in bare for a in allowed):
                    continue
                found.append((rel, number, name, line.strip()[:120]))

    if found:
        print(f'A name the product no longer uses, split across markup:\n')
        for rel, number, name, line in found:
            print(f'  {rel}:{number}')
            print(f'    reads as "{name}" once the tags come out')
            print(f'    {line}')
            print()
        print('Each of these is a wordmark written across two elements, so no')
        print('search for the whole name can find it. Fix the source, not the')
        print('built output, and re-run.')
        return 1

    names = ', '.join(gone)
    print(f'{read} text files read with their tags removed.')
    print(f'  no split wordmark spells {names}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
