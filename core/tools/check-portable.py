#!/usr/bin/env python3
"""Nothing that runs on Sam's Mac may hard-code a path from this container.

    python3 core/tools/check-portable.py [root]

## The bug this is the answer to

Eight tools had the same line copied into them, one at a time, over months:

    process.env.TRUELINE_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

That path is real inside one Linux container and nowhere else on earth. It was
harmless while every one of those tools only ever ran in that container -- and
then `check-art` went into `npm run verify`, which is the command Sam runs on
his Mac before he builds. It stopped dead:

    browserType.launch: Failed to launch chromium because executable doesn't
    exist at /opt/pw-browsers/chromium-1194/chrome-linux/chrome

The one command that says whether the repository is sound could not pass on the
machine that ships the app. Nothing caught it because nothing was looking: the
container it was written in is the container it was tested in.

## What it checks

Every tracked source file, for an absolute path rooted in a directory that only
exists in a development container -- `/opt/`, `/workspace/`, `/root/`, and a
home directory belonging to somebody in particular.

`core/tools/browser.mjs` is the one exception, and it is exempt for a reason
worth writing down: it is the file whose whole job is to know about machines,
it names those paths as candidates to be checked against the disk rather than
as answers, and every branch of it is tested against a fake disk describing a
machine that is not this one.

## What it does NOT check

It reads text. A path assembled at runtime out of pieces -- or read from a
configuration file with a container path in it -- goes straight past. What
catches those is running the thing on a Mac, which is the check this exists to
stop wasting.
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[2]

# Four files may name these paths, and each has to earn it:
#
#   * `browser.mjs` is the file whose whole job is to know about machines. It
#     names them as candidates to be checked against the disk, never as
#     answers, and every branch of it is tested against a fake disk describing
#     a machine that is not this one.
#   * This file quotes the mistake in the paragraph explaining the mistake.
#   * `check-the-checks.py` writes the mistake into a throwaway file on purpose
#     and fails if this checker does not notice. A checker nobody has watched
#     failing is not a checker.
#   * `browser.test.ts` describes machines that are not this one -- a Mac with
#     Playwright installed the ordinary way, this container with a build number
#     that does not match the package's, a machine with nothing -- as fake
#     disks, and asks what would be chosen on each. Naming the container's real
#     layout is the point of one of those cases.
#
# Nothing else. If a fifth file ever needs to be here, the reason goes in this
# comment before the name goes in the set.
EXEMPT = {
    'core/tools/browser.mjs',
    'core/tools/check-portable.py',
    'core/tools/check-the-checks.py',
    'core/src/test/browser.test.ts',
}

# Where a container puts things and a Mac does not.
CONTAINER = re.compile(
    r"""['"](/opt/[^'"\s]+|/workspace/[^'"\s]+|/root/[^'"\s]+|/home/[a-z][^'"\s/]*/[^'"\s]+)['"]"""
)

LOOK_AT = {'.mjs', '.js', '.ts', '.tsx', '.py', '.sh', '.swift', '.json', '.yml', '.yaml'}

# Generated or vendored trees: what is in them is decided elsewhere, and a
# source map or a lockfile naming a build machine is not this project's doing.
SKIP = ('node_modules/', 'web/dist/', 'ios/Trueline/Web/', 'site/build/', 'docs/build/out/')


def tracked(root: Path) -> list[str]:
    """Every file git knows about, and every new one it does not yet.

    `--others --exclude-standard` matters: a checker that only read committed
    files would go green on a brand new tool right up until the moment it was
    committed, which is exactly when nobody is looking any more. Ignored files
    stay ignored -- `node_modules` is not this project's doing.
    """
    try:
        done = subprocess.run(
            ['git', '-C', str(root), 'ls-files', '--cached', '--others', '--exclude-standard'],
            capture_output=True, text=True, check=True)
        names = [line for line in done.stdout.splitlines() if line]
        if names:
            return names
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass
    return [str(p.relative_to(root)) for p in root.rglob('*') if p.is_file()]


def main() -> int:
    bad: list[str] = []
    looked = 0
    for name in tracked(ROOT):
        if name in EXEMPT or any(name.startswith(s) for s in SKIP):
            continue
        path = ROOT / name
        if path.suffix not in LOOK_AT or not path.is_file():
            continue
        try:
            text = path.read_text(encoding='utf-8')
        except (UnicodeDecodeError, OSError):
            continue
        looked += 1
        for line_number, line in enumerate(text.splitlines(), 1):
            for found in CONTAINER.finditer(line):
                bad.append(f'{name}:{line_number}  {found.group(1)}')

    if bad:
        print('A path that only exists in a development container, in code that '
              'runs on a Mac:\n')
        for one in bad:
            print(f'  {one}')
        print('\nThis is how `npm run verify` stopped working on the machine the app '
              'is built on.')
        print('Resolve it at run time instead. `core/tools/browser.mjs` is the '
              'pattern: candidates,')
        print('checked against the disk, and a message naming the command to run '
              'when there are none.')
        return 1

    print(f'{looked} source files: no container path baked into any of them')
    return 0


if __name__ == '__main__':
    sys.exit(main())
