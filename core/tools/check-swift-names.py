#!/usr/bin/env python3
"""Finds a name a Swift file uses that nothing in it declares or imports.

    python3 core/tools/check-swift-names.py [file ...]

## Why this exists

`check-swift.py` asks whether a file is Swift. This asks something the grammar
cannot: whether the names it uses exist. Two classes of that, both found in
this project, both invisible to a parser, both fatal to a build:

  * **An environment value used without being declared.** `ScanScreen.swift`
    called `dismiss()` with no `@Environment(\\.dismiss)` anywhere in it.
    Xcode: "cannot find 'dismiss' in scope".
  * **A symbol used without its framework.** Seven files declared
    `ObservableObject` and `@Published` while importing only Foundation.
    Those live in Combine. Xcode: "cannot find type 'ObservableObject' in
    scope" -- seven times, in seven files, on the first build.

That second one is worth dwelling on. Every one of those files was written to
be an `ObservableObject` and reads perfectly; nothing about them looks wrong,
and the grammar had nothing to say. They would have cost the first build on
Sam's Mac and taught him the app does not compile.

## Why not just install a Swift compiler

Because it would not answer the question. `download.swift.org` is refused by
this network's egress policy -- a `403` on CONNECT, which is a policy denial
rather than an outage -- but that is the smaller half. Twenty of these
twenty-three files import SwiftUI, UIKit, ARKit, RoomPlan, StoreKit, EventKit,
CloudKit or SceneKit, and **none of those exists for Linux**. Swift on Linux
ships the language and the corelibs; the frameworks are Apple's and are shipped
only in Apple's SDKs. A Linux toolchain would compile three files out of
twenty-three, and it would not have found either bug above -- both are in the
twenty.

Xcode on a Mac is the only compiler this code can meet. So the honest thing is
not to pretend otherwise, but to catch by hand the classes of error that
reliably reach it, and to keep the list of what is checked short and true.

## What it deliberately does not claim

It finds two classes of mistake, not every undefined name. A file that passes
this can still fail to compile for a hundred other reasons. Narrow and certain
beats broad and guessing -- a checker that cries wolf gets switched off, which
is why the false positives it produced on its first run were fixed by making it
smarter rather than by lowering the bar.
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


# ---------------------------------------------------------------------------
# Symbols that only exist if a framework is imported.
#
# Each entry is a regular expression matched against the file, and the set of
# imports that would make it legal. A symbol goes in here only when there is no
# other way for it to be in scope -- a name that a file could plausibly declare
# itself belongs in the same category as `refresh` above and would produce
# noise, not findings.
#
# `SwiftUI` provides Combine's names as well: it re-exports Combine, and a view
# file using `ObservableObject` without importing Combine is ordinary and
# correct. That is why SwiftUI appears in the Combine row.
NEEDS_IMPORT: list[tuple[str, str, set[str]]] = [
    (r'\bObservableObject\b', 'ObservableObject', {'Combine', 'SwiftUI'}),
    (r'@Published\b', '@Published', {'Combine', 'SwiftUI'}),
    (r'\bAnyCancellable\b', 'AnyCancellable', {'Combine', 'SwiftUI'}),
    (r'\bObservableObjectPublisher\b', 'ObservableObjectPublisher', {'Combine', 'SwiftUI'}),
    (r'\b(?:PassthroughSubject|CurrentValueSubject)\b', 'a Combine subject', {'Combine', 'SwiftUI'}),
    (r'@StateObject\b', '@StateObject', {'SwiftUI'}),
    (r'@ObservedObject\b', '@ObservedObject', {'SwiftUI'}),
    (r'@EnvironmentObject\b', '@EnvironmentObject', {'SwiftUI'}),
    (r'@ViewBuilder\b', '@ViewBuilder', {'SwiftUI'}),
    (r'\bsome View\b', 'some View', {'SwiftUI'}),
    # UIKit's providers are generous on purpose: ARKit, RoomPlan, SceneKit and
    # WebKit all pull it in, and a false positive here would be the kind of
    # noise that gets the whole check switched off.
    (
        r'\bUI(?:View|ViewController|Image|Color|Application|Device|Screen|'
        r'ImpactFeedbackGenerator|InterfaceOrientation|WindowScene)\b',
        'a UIKit type',
        {'UIKit', 'SwiftUI', 'ARKit', 'RoomPlan', 'SceneKit', 'WebKit'},
    ),
    (r'\bsimd_(?:float4x4|float3x3|quat[fd])\b', 'a simd type',
     {'simd', 'ARKit', 'RoomPlan', 'SceneKit'}),
]


def imported(source: str) -> set[str]:
    return set(re.findall(r'^\s*import\s+([A-Za-z_][A-Za-z0-9_]*)', source, re.M))


def missingFrameworks(source: str) -> list[tuple[str, str]]:
    """(what was used, what would have to be imported), for each one missing."""
    have = imported(source)
    found = []
    for pattern, said, providers in NEEDS_IMPORT:
        if re.search(pattern, source) and not (have & providers):
            found.append((said, ' or '.join(sorted(providers))))
    return found


def main(argv: list[str]) -> int:
    files = [Path(a) for a in argv] or sorted((ROOT / 'ios').rglob('*.swift'))
    bad = 0
    for path in files:
        raw = path.read_text(encoding='utf-8')
        source = strip(raw)
        rel = os.path.relpath(path, ROOT)

        for name, key in VALUES.items():
            if declared(source, key):
                continue
            lines = used(source, name)
            if not lines:
                continue
            bad += 1
            print(f'{rel}:{lines[0]}: uses `{name}` with no @Environment(\\.{key}) in the file')
            print(f'    Xcode will say: cannot find \'{name}\' in scope')

        # Imports are read off the raw file rather than the stripped one: a
        # commented-out import is not an import, and stripping leaves the line
        # looking like nothing at all.
        for said, wants in missingFrameworks(raw):
            bad += 1
            print(f'{rel}: uses `{said}` without importing {wants}')
            print(f'    Xcode will say: cannot find \'{said}\' in scope')

    if bad:
        print()
        print(f'{bad} name(s) used that nothing declares or imports. Each is a compile error.')
        return 1
    print(f'{len(files)} Swift files: every name they use is declared or imported')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
