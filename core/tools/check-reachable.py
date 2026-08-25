#!/usr/bin/env python3
"""Finds anything the measurement layer exports that nothing ever calls.

    python3 core/tools/check-reachable.py

## Why

`section.ts` held a dollhouse, a cut plane and a walkthrough for weeks and
nothing in the app called any of it. Sam found the same thing by hand once
before -- "I couldn't even use the insurance mode, no way to get there" -- and
both times the code was finished, tested and invisible.

A feature nothing reaches is not built. This is the check that says so, and it
answers "what is left" with a list rather than with somebody's memory.

## What counts as reached

Imported by name, anywhere outside its own file and outside a test. A test
importing something is not the same as a person being able to use it: every one
of `section.ts`'s exports was tested and none of them was reachable.

So a symbol reached only by tests is reported separately -- proven and
unreachable, which is the exact shape of the bug this exists for.
"""
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CORE = ROOT / 'core' / 'src'

# Functions only, and that is the whole design of this check.
#
# The first version looked at every export and produced two hundred findings,
# which is the same as producing none. Types, interfaces and `Error` subclasses
# make up almost all of them and almost none is a problem: a type is used as a
# type, and an error is thrown where it is declared and caught elsewhere by
# `instanceof`, neither of which a name search models.
#
# A function is different. A function nobody calls is either dead or a feature
# nobody can reach, and both are worth a line of output. Constants are left out
# for the same reason as types -- `CONVENTIONAL_CUT_HEIGHT` being referenced
# only by the module that defines it says nothing.
def exports(text: str) -> list[str]:
    return re.findall(r'^export\s+(?:async\s+)?function\s+([A-Za-z_]\w*)', text, re.M)


def main() -> int:
    sources = {}
    for path in sorted(CORE.rglob('*.ts')):
        sources[path] = path.read_text(encoding='utf-8')

    web = {}
    for path in sorted((ROOT / 'web' / 'src').rglob('*.ts*')):
        web[path] = path.read_text(encoding='utf-8')
    for path in sorted((ROOT / 'web' / 'audit').rglob('*.mjs')):
        web[path] = path.read_text(encoding='utf-8')

    unused = []
    testOnly = []

    for path, text in sources.items():
        if '/test/' in str(path).replace(os.sep, '/'):
            continue
        for name in exports(text):
            pattern = re.compile(r'\b' + re.escape(name) + r'\b')
            inApp = False
            inTest = False
            for other, body in {**sources, **web}.items():
                if other == path:
                    continue
                if not pattern.search(body):
                    continue
                if '/test/' in str(other).replace(os.sep, '/'):
                    inTest = True
                else:
                    inApp = True
            rel = os.path.relpath(path, ROOT)
            if not inApp and not inTest:
                unused.append(f'{rel}: {name} — nothing references it at all')
            elif not inApp:
                testOnly.append(f'{rel}: {name} — tested, and nothing else calls it')

    if unused:
        print('Exported and never referenced:')
        for line in unused:
            print(f'  {line}')
        print()
    if testOnly:
        print('Proven and unreachable — the shape of the bug this check exists for:')
        for line in testOnly:
            print(f'  {line}')
        print()
    if not unused and not testOnly:
        print('Every function the measurement layer exports is called by something '
          'that is not a test.')
        return 0
    print(f'{len(unused)} function(s) nothing references, '
          f'{len(testOnly)} reachable only from tests.')
    return 1


if __name__ == '__main__':
    sys.exit(main())
