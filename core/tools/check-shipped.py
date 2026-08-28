#!/usr/bin/env python3
"""The bundle the phone actually runs, against the source it came from.

## The bug this exists for

`ios/Trueline/Web/` is a checked-in copy of `web/dist` — the correction
screens, as Xcode ships them. It is tracked rather than built, so that opening
the project and pressing Run works without anybody remembering an npm command.

That is the whole hazard. `npm run ship-web` regenerates it, and nothing made
anyone run it. Measured on 2026-08-28: the committed bundle was last shipped
twenty-one commits earlier, so the phone was still running the black-square
drawing, the grey text, the two-writer room name and a paywall reading "Up to
1 rooms kept" — every one of them fixed in `web/src` and none of them on the
phone. The web audit was green the whole time, because the audit drives
`web/dist` and the phone runs this.

It cost something else too. A contractor who ran `ship-web` on his own machine
got a working app and a dirty tree, and then every `git pull` refused with
"your local changes would be overwritten" — pointing at a file he never
edited.

So the rule is: **the shipped bundle is newer than every source file it is
built from.** Not "is it committed" — a stale commit is exactly what happened.

Run it with:  python3 core/tools/check-shipped.py
Fix it with:  npm run ship-web
"""

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parents[2]
SHIPPED = HERE / 'ios' / 'Trueline' / 'Web'
# Everything the bundle is built from. `core/src` is in it because the web half
# imports the measurement engine directly -- a fix to `design.ts` reaches the
# phone only through this copy.
SOURCE = [HERE / 'web' / 'src', HERE / 'core' / 'src', HERE / 'web' / 'index.html']


def newest(where: Path) -> tuple[float, str]:
    """The newest file under `where`, and which one it is."""
    if where.is_file():
        return where.stat().st_mtime, str(where.relative_to(HERE))
    best, name = 0.0, ''
    for root, dirs, files in os.walk(where):
        dirs[:] = [d for d in dirs if d != 'node_modules' and not d.startswith('.')]
        for one in files:
            if one.startswith('.'):
                continue
            path = Path(root) / one
            when = path.stat().st_mtime
            if when > best:
                best, name = when, str(path.relative_to(HERE))
    return best, name


def main() -> int:
    if not SHIPPED.is_dir():
        print('There is no bundle for the phone at all. Run:  npm run ship-web')
        return 1

    built, _ = newest(SHIPPED)
    worst = 0.0
    blame = ''
    for one in SOURCE:
        when, name = newest(one)
        if when > worst:
            worst, blame = when, name

    if worst <= built:
        print('the bundle Xcode ships is newer than every source file it is built from')
        return 0

    behind = round((worst - built) / 60)
    print('The bundle the phone runs is older than the code it is built from.')
    print(f'  {blame} is {behind} minute(s) newer than anything in ios/Trueline/Web.')
    print()
    print('Xcode ships that folder as it stands, so every fix since then is in the')
    print('repository and not on the phone. The web audit cannot see this: it drives')
    print('web/dist, and the phone runs this copy.')
    print()
    print('Fix it with:  npm run ship-web')
    return 1


if __name__ == '__main__':
    sys.exit(main())
