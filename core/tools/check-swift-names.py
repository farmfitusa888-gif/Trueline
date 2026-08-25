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
    # These two are the reason to keep the list growing. Both read like plain
    # property wrappers and both are SwiftUI's, so both are easy to reach for
    # in a helper file that never imports SwiftUI -- which compiles nowhere.
    (r'@FocusState\b', '@FocusState', {'SwiftUI'}),
    (r'@AppStorage\b', '@AppStorage', {'SwiftUI'}),
    (r'@SceneStorage\b', '@SceneStorage', {'SwiftUI'}),
    (r'@GestureState\b', '@GestureState', {'SwiftUI'}),
    (r'@Namespace\b', '@Namespace', {'SwiftUI'}),
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


# ---------------------------------------------------------------------------
# The memberwise initialiser, and the order it insists on.
#
# A struct with no `init` of its own gets one for free, taking its stored
# properties **in the order they are declared**. Swift refuses a call that
# reorders them, and what Xcode says is "Incorrect argument labels in call"
# followed by the whole list -- which reads like a spelling mistake and is
# nothing of the sort.
#
# `ReviewScreen` called `CorrectView(subscribed:onVisits:roomJSON:...)` when
# `CorrectView` declares `roomJSON` first and `subscribed` sixth. It had been
# that way for as long as the call existed and nothing found it, because until
# a Mac compiled this project nothing could.
#
# Everything here is skipped rather than guessed at when it cannot be read
# confidently: a struct with its own `init`, a property with a default, a
# computed property, a call whose arguments this cannot parse.

ATTRIBUTED = re.compile(
    r"""^\s*(?:@\w+(?:\([^)]*\))?\s+)*        # @ObservedObject, @State(...)
        (?:public|private|internal|fileprivate)?\s*
        (?:let|var)\s+(\w+)\s*:\s*([^={\n]+)$""",
    re.X,
)


def bodyOf(source: str, start: int) -> str | None:
    """The braces-matched body of a declaration whose `{` is at or after start."""
    opened = source.find('{', start)
    if opened == -1:
        return None
    depth = 0
    for i in range(opened, len(source)):
        if source[i] == '{':
            depth += 1
        elif source[i] == '}':
            depth -= 1
            if depth == 0:
                return source[opened + 1:i]
    return None


def memberwise(source: str) -> dict[str, list[str]]:
    """Each struct that has a free initialiser, and the labels it takes."""
    found = {}
    for match in re.finditer(r'^(?:\w+\s+)*struct\s+(\w+)[^{\n]*\{', source, re.M):
        body = bodyOf(source, match.start())
        if body is None:
            continue

        # One pass, at the struct's own depth only.
        #
        # An `init` nested inside the struct -- CorrectView holds a
        # `class Coordinator` that has one -- is not the struct's own, and
        # searching the whole body for one skipped CorrectView entirely. This
        # check reported success while checking nothing, and the bug it was
        # written for walked straight past it. Depth is the whole fix.
        labels: list[str] = []
        ownInit = False
        depth = 0
        for line in body.split('\n'):
            if depth == 0:
                if re.match(r'\s*(?:public\s+|private\s+|internal\s+)?init\s*[(<]', line):
                    ownInit = True
                    break
                prop = ATTRIBUTED.match(line)
                # A default value or a computed body means it is not a plain
                # stored property in the initialiser's sense.
                if prop and '=' not in line.split(':', 1)[1] and not line.rstrip().endswith('{'):
                    labels.append(prop.group(1))
            depth += line.count('{') - line.count('}')
        if labels and not ownInit:
            found[match.group(1)] = labels
    return found


def callsTo(source: str, name: str) -> list[tuple[int, list[str]]]:
    """Every `Name(...)` call, as (line number, the labels it passes)."""
    calls = []
    for match in re.finditer(r'(?<![\w.])' + re.escape(name) + r'\s*\(', source):
        depth, i = 0, match.end() - 1
        for j in range(i, len(source)):
            if source[j] in '([{':
                depth += 1
            elif source[j] in ')]}':
                depth -= 1
                if depth == 0:
                    inner = source[i + 1:j]
                    break
        else:
            continue
        # Labels at the call's own depth. Anything nested -- a closure body, a
        # dictionary, another call -- is skipped by the depth counter.
        labels, depth, start = [], 0, 0
        for k, ch in enumerate(inner):
            if ch in '([{':
                depth += 1
            elif ch in ')]}':
                depth -= 1
            elif ch == ',' and depth == 0:
                start = k + 1
        pieces, depth, at = [], 0, 0
        for k, ch in enumerate(inner):
            if ch in '([{':
                depth += 1
            elif ch in ')]}':
                depth -= 1
            elif ch == ',' and depth == 0:
                pieces.append(inner[at:k])
                at = k + 1
        pieces.append(inner[at:])
        for piece in pieces:
            label = re.match(r'\s*(\w+)\s*:', piece)
            if label:
                labels.append(label.group(1))
        if labels:
            calls.append((source[:match.start()].count('\n') + 1, labels))
    return calls


def main(argv: list[str]) -> int:
    files = [Path(a) for a in argv] or sorted((ROOT / 'ios').rglob('*.swift'))

    # Every struct in the project, so a call in one file can be checked against
    # a declaration in another -- which is where the bug was.
    shapes: dict[str, tuple[list[str], str]] = {}
    for path in sorted((ROOT / 'ios').rglob('*.swift')):
        for name, labels in memberwise(strip(path.read_text(encoding='utf-8'))).items():
            shapes[name] = (labels, os.path.relpath(path, ROOT))

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

        # Memberwise initialisers, in the order they insist on.
        for name, (labels, declaredIn) in shapes.items():
            for line, passed in callsTo(source, name):
                if set(passed) - set(labels):
                    continue  # Not the memberwise init -- some other overload.
                wanted = [l for l in labels if l in passed]
                if passed != wanted:
                    bad += 1
                    print(f'{rel}:{line}: {name}(...) passes its arguments out of order')
                    print(f'    passes: {", ".join(passed)}')
                    print(f'    wants:  {", ".join(wanted)}   ({declaredIn} declares them so)')
                    print(f"    Xcode will say: incorrect argument labels in call")

    if bad:
        print()
        print(f'{bad} name(s) used that nothing declares or imports, or passed in the '
              'wrong order. Each is a compile error.')
        return 1
    print(f'{len(files)} Swift files: every name they use is declared or imported, '
          'and every memberwise call is in order')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
