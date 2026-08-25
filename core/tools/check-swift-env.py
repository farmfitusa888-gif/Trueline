#!/usr/bin/env python3
"""Finds a SwiftUI environment value that is used but never declared.

    python3 core/tools/check-swift-env.py [file ...]

## Why this exists, and why it is separate

`check-swift.py` asks whether a file is Swift. This asks something the grammar
cannot: whether a name the file uses exists. `ScanScreen.swift` called
`dismiss()` with no `@Environment(\\.dismiss) private var dismiss` anywhere in
it -- a file that parses perfectly and does not compile, and the error Xcode
gives is "cannot find 'dismiss' in scope".

It is a real gap in what can be checked from Linux and it cost a build. There
is no Swift compiler on this machine and `download.swift.org` is refused by the
network's egress policy, so the general version of this check -- name
resolution -- is not available. This is the narrow version: a fixed list of
SwiftUI environment values, each of which is only ever reachable through an
`@Environment` declaration, looked for in files that use them.

## What it deliberately does not claim

It finds one class of mistake, not every undefined name. A file that passes
this can still fail to compile for a hundred other reasons, and Xcode is still
the first real compiler this code meets. Narrow and certain beats broad and
guessing -- a checker that cries wolf gets switched off.
"""
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# Environment values that have no other way of existing in a view. Each is here
# because there is no global, no free function and no type member by that name:
# if a view says it, the view must have declared it.
VALUES = {
    'dismiss': 'dismiss',
    'openURL': 'openURL',
    'openWindow': 'openWindow',
    'requestReview': 'requestReview',
    'undoManager': 'undoManager',
    'refresh': 'refresh',
    'scenePhase': 'scenePhase',
    'colorScheme': 'colorScheme',
    'horizontalSizeClass': 'horizontalSizeClass',
    'verticalSizeClass': 'verticalSizeClass',
    'dynamicTypeSize': 'dynamicTypeSize',
    'accessibilityReduceMotion': 'accessibilityReduceMotion',
    'displayScale': 'displayScale',
    'isPresented': 'isPresented',
}


def strip(source: str) -> str:
    """Comments and string bodies out, so a word in prose is not a use."""
    source = re.sub(r'/\*.*?\*/', ' ', source, flags=re.S)
    source = re.sub(r'//[^\n]*', ' ', source)
    source = re.sub(r'"""(?:.|\n)*?"""', '""', source)
    source = re.sub(r'"(?:\\.|[^"\\\n])*"', '""', source)
    return source


def declared(source: str, name: str) -> bool:
    """Whether the file has any right to say this name.

    Two ways it can. The environment declaration is the one being looked for --
    `@Environment(\\.dismiss) private var dismiss`, matched on the key path
    because the variable it binds to can be called anything.

    The second way is the file declaring a member of its own with that name, and
    it has to be allowed. `refresh` is an environment value *and* what both
    `ProjectStore` and `Subscription` sensibly call their own reload method, and
    a bare `refresh()` inside either of them is a call to their own. Without
    this the check reported two compile errors in code that compiles, which is
    how a checker gets switched off.
    """
    if re.search(r'@Environment\(\s*\\\.' + re.escape(name) + r'\s*\)', source):
        return True
    return re.search(r'\b(?:func|var|let)\s+' + re.escape(name) + r'\b', source) is not None


def used(source: str, name: str) -> list[int]:
    """Line numbers where the bare name is used as a value or a call."""
    hits = []
    for number, line in enumerate(source.split('\n'), start=1):
        for match in re.finditer(r'(?<![\w.$\\])' + re.escape(name) + r'\b', line):
            after = line[match.end():].lstrip()
            before = line[:match.start()].rstrip()
            # A declaration of it, a parameter called it, or a label -- none of
            # those is a use of the environment value.
            if before.endswith(('var', 'let', 'func', 'case')):
                continue
            if after.startswith(':'):
                continue
            hits.append(number)
    return hits


def main(argv: list[str]) -> int:
    files = [Path(a) for a in argv] or sorted((ROOT / 'ios').rglob('*.swift'))
    bad = 0
    for path in files:
        raw = path.read_text(encoding='utf-8')
        source = strip(raw)
        for name, key in VALUES.items():
            if declared(source, key):
                continue
            lines = used(source, name)
            if not lines:
                continue
            bad += 1
            rel = os.path.relpath(path, ROOT)
            print(f'{rel}:{lines[0]}: uses `{name}` with no @Environment(\\.{key}) in the file')
            print(f'    Xcode will say: cannot find \'{name}\' in scope')

    if bad:
        print()
        print(f'{bad} undeclared environment value(s). Each is a compile error.')
        return 1
    print(f'{len(files)} Swift files: every SwiftUI environment value they use is declared')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
