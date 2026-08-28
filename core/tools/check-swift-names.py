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
  * **A nonisolated static function reaching into a main-actor object.**
    `CaptureWriter.write` is a plain static function that puts a scan on disk,
    and it read `pins.isEmpty` off a `PinRecorder` that was marked
    `@MainActor` while its twin `PhotoRecorder` was not. Xcode: "main
    actor-isolated property 'isEmpty' can not be referenced from a nonisolated
    context".
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
    """(what was used, what would have to be imported), for each one missing.

    The two halves read different text, and they have to:

      * **imports** come off the raw file, because a commented-out import is not
        an import and stripping leaves the line looking like nothing at all;
      * **uses** come off the stripped file, because a doc comment explaining
        that `@StateObject` on a tab lives as long as the app is prose about
        SwiftUI, not a use of it.

    Reading both off the raw file reported `ARMeasureSession.swift` as missing
    `import SwiftUI` for a sentence in a comment — a compile error the compiler
    would never have, which is exactly the kind of false positive that gets a
    whole check switched off.
    """
    have = imported(source)
    uses = strip(source)
    found = []
    for pattern, said, providers in NEEDS_IMPORT:
        if re.search(pattern, uses) and not (have & providers):
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

# A stored property that carries its own default -- `var everyRoom: [Data] = []`.
#
# Swift puts these in the memberwise initialiser too, as a parameter with a
# default value. Leaving them out is not a smaller claim, it is a wrong one:
# `set(passed) - set(labels)` then contains the defaulted label, the call is
# written off as "some other overload", and the ordering check silently stops
# looking at it. That is exactly what happened when `CorrectView` grew
# `reportsJSON`, `onTrouble` and `onWebError` -- three defaulted properties, and
# the check went quiet on the very call it was written for.
#
# `var` and not `let`: a `let` with a default cannot be set, so Swift leaves it
# out of the initialiser altogether. Nothing private and nothing carrying a
# property wrapper: `@State private var tab: Tab = .rooms` is a SwiftUI view's
# own state, and no call site anywhere passes one.
#
# The type annotation is OPTIONAL, and that is not tidiness. `var unlockSeed =
# ""` is ordinary Swift, it is in the memberwise initialiser exactly as an
# annotated one is, and this pattern used to require the `: Type` -- so a
# property written that way was invisible here, the call passing it was written
# off as "some other overload", and the ordering check went silent on it. That
# is the same failure the paragraph above records, arriving by a second door:
# `WebScreen` grew `var unlockSeed = ""` on 2026-08-28 and this stopped looking
# at the call it exists for. Found by `check-the-checks.py`, which is what that
# file is for.
DEFAULTED = re.compile(
    r"""^\s*(?:internal\s+|public\s+)?
        var\s+(\w+)\s*(?::\s*[^={\n]+)?=""",
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
                # A computed body is not a stored property at all.
                if prop and '=' not in line.split(':', 1)[1] and not line.rstrip().endswith('{'):
                    labels.append(prop.group(1))
                    continueLine = True
                else:
                    continueLine = False
                # And the same property with a default on it, which Swift still
                # takes -- as a parameter that may be omitted, in this position.
                if not continueLine:
                    withDefault = DEFAULTED.match(line)
                    if withDefault:
                        labels.append(withDefault.group(1))
            depth += line.count('{') - line.count('}')
        if labels and not ownInit:
            found[match.group(1)] = labels
    return found


def handWritten(source: str) -> dict[str, list[str]]:
    """Each struct that writes its own `init`, and exactly what that one takes.

    ## Why this is separate from `memberwise`

    `memberwise` describes the initialiser Swift *generates*, and it correctly
    gives up on a struct that declares its own -- a hand-written `init` replaces
    the generated one entirely, so the property list says nothing about what a
    call may pass.

    Giving up meant such a struct was checked against nothing at all.
    `ScanScreen` builds its `@StateObject` from `store`, which a generated
    initialiser cannot do, so it writes its own -- and when `onClose` was added
    as a stored property the hand-written `init` did not grow a parameter for
    it. Xcode, on 2026-08-26:

        RootTabs.swift:86:30: error: extra argument 'onClose' in call

    The file parsed. Every name in it was declared. The argument order was
    right, because order was all anything looked at. Nothing here could see it,
    and it cost a whole build.

    So a hand-written `init`'s own labels are read, and a call that passes one it
    does not take is an error -- a stronger check than the memberwise one,
    because a hand-written signature is exact.
    """
    found: dict[str, list[str]] = {}
    for match in re.finditer(r'^(?:\w+\s+)*struct\s+(\w+)[^{\n]*\{', source, re.M):
        body = bodyOf(source, match.start())
        if body is None:
            continue

        # The struct's own `init`, at its own depth. A nested class's is not it --
        # the same trap `memberwise` documents above.
        depth = 0
        at = None
        lines = body.split('\n')
        for i, line in enumerate(lines):
            if depth == 0 and re.match(
                r'\s*(?:public\s+|private\s+|internal\s+|fileprivate\s+)?init\s*\(', line
            ):
                at = i
                break
            depth += line.count('{') - line.count('}')
        if at is None:
            continue

        rest = '\n'.join(lines[at:])
        opened = rest.index('(')
        depth = 0
        closed = None
        for i in range(opened, len(rest)):
            if rest[i] in '([{':
                depth += 1
            elif rest[i] in ')]}':
                depth -= 1
                if depth == 0:
                    closed = i
                    break
        if closed is None:
            continue

        pieces = []
        piece = ''
        depth = 0
        for ch in rest[opened + 1:closed]:
            if ch in '([{':
                depth += 1
            elif ch in ')]}':
                depth -= 1
            if ch == ',' and depth == 0:
                pieces.append(piece)
                piece = ''
            else:
                piece += ch
        pieces.append(piece)

        names = []
        for one in pieces:
            # `label name: Type`, `name: Type`, or `_ name: Type`. The label is
            # what a caller writes; `_` means it writes nothing.
            label = re.match(r'\s*([\w_]+)(?:\s+[\w_]+)?\s*:', one)
            if label and label.group(1) != '_':
                names.append(label.group(1))
        if names:
            found[match.group(1)] = names
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


# ---------------------------------------------------------------------------
# `weak` on something that might not be a class.
#
# A weak reference works by being zeroed when what it points at goes away, and
# only a class has an identity to go away. So `weak var x: SomeProtocol?` is
# refused unless the protocol says it is class-only -- `: AnyObject`.
#
# Xcode: "'weak' must not be applied to non-class-bound 'any Something';
# consider adding a protocol conformance that has a class bound". That was the
# first error a real compiler ever gave this project, on a protocol whose only
# conformer is a final class -- so the bound was always true and never said.

WEAK = re.compile(r'^\s*(?:@\w+\s+)*(?:private\s+|public\s+|internal\s+)?weak\s+var\s+\w+\s*:\s*([A-Za-z_]\w*)\??')


def classBound(source: str, name: str) -> bool | None:
    """Whether a protocol is class-only. None when it is not a protocol here.

    A type this file does not declare -- `ARSCNView`, `UIView`, anything from
    a framework -- returns None and is left alone. Guessing about a name whose
    declaration is not in front of us is how a checker starts crying wolf.
    """
    found = re.search(
        r'^(?:\w+\s+)*protocol\s+' + re.escape(name) + r'\s*(:[^{\n]*)?\{', source, re.M
    )
    if not found:
        return None
    inherits = found.group(1) or ''
    return bool(re.search(r'\b(AnyObject|class)\b', inherits))


def overlappingAccess(source: str) -> list[tuple[int, str]]:
    """`withUnsafePointer(to: &x)` whose closure reads `x` again.

    Xcode's own words, on `Diagnostics.swift` on 2026-08-26:

        error: overlapping accesses to 'info.machine', but modification
        requires exclusive access; consider copying to a local variable

    The inout argument opens an exclusive access to that storage for as long as
    the closure runs. Anything inside it that names the same storage is a second
    access while the first is still open, and Swift refuses it. The classic way
    to write this bug is the standard `utsname` incantation that every project
    copies off the internet, where the capacity argument reads the very field
    the pointer was taken of.

    It is a compile error and nothing else in this repository can see it: the
    file parses perfectly, every name in it is declared, and the argument order
    is right. It cost a whole build on Sam's Mac.

    The fix, in both senses: `withUnsafeBytes(of: value)` by value, which takes a
    copy and has nothing to overlap with.
    """
    found = []
    for match in re.finditer(r'withUnsafe(?:Pointer|Bytes|MutablePointer|MutableBytes)'
                             r'\s*\(\s*(?:to|of)\s*:\s*&\s*([\w.]+)', source):
        held = match.group(1)
        body = bodyOf(source, match.end())
        if body is None:
            continue
        # The same storage, or anything rooted at it: `info` and `info.machine`
        # are the same access as far as exclusivity is concerned.
        root = held.split('.')[0]
        for again in re.finditer(r'(?<![\w.])' + re.escape(root) + r'(?![\w])', body):
            # `$0` and the closure's own parameter are the copy, not the source.
            found.append((source[:match.start()].count('\n') + 1, held))
            break
    return found


def weakOnAStruct(source: str, everywhere: str) -> list[tuple[int, str]]:
    """Every `weak var` whose type is a protocol with no class bound."""
    bad = []
    for number, line in enumerate(source.split('\n'), start=1):
        match = WEAK.match(line)
        if not match:
            continue
        bound = classBound(everywhere, match.group(1))
        if bound is False:
            bad.append((number, match.group(1)))
    return bad


# ---------------------------------------------------------------------------
# A `static func` that is handed a main-actor object and then touches it.
#
# `CaptureWriter` is a plain `enum` with a `static func write(...)` that puts a
# scan on disk. It takes the two recorders and reads `pins.isEmpty` and calls
# `pins.manifest()`. `PinRecorder` had been marked `@MainActor`; its twin
# `PhotoRecorder` never was. So the same two lines compiled for one and not for
# the other:
#
#     CaptureWriter.swift:83: main actor-isolated property 'isEmpty' can not be
#     referenced from a nonisolated context
#     CaptureWriter.swift:84: call to main actor-isolated instance method
#     'manifest()' in a synchronous nonisolated context
#
# A static function is the one place this can be said with certainty. An
# instance method inherits whatever the type is isolated to, and a SwiftUI view
# picks up isolation on `body` by conformance -- guessing at either would make
# this cry wolf. A `static func` on a type that is not `@MainActor` is
# nonisolated, full stop, and if it reaches into a main-actor object through a
# parameter, that is a compile error every time.

MAIN_ACTOR = re.compile(
    r'@MainActor[\s\n]+(?:(?:public|private|internal|fileprivate|final|open)\s+)*'
    r'(?:class|struct|enum|actor)\s+(\w+)'
)

STATIC_FUNC = re.compile(
    r'^[ \t]*(?:(?:@\w+(?:\([^)]*\))?)[ \t]+)*'
    r'(?:(?:public|private|internal|fileprivate|final|open|nonisolated)\s+)*'
    r'static\s+func\s+(\w+)\s*(?:<[^>]*>)?\s*\(',
    re.M,
)


def mainActorTypes(everywhere: str) -> set[str]:
    """Every type in the project declared `@MainActor`."""
    return set(MAIN_ACTOR.findall(everywhere))


def isolatedSpans(source: str) -> list[tuple[int, int]]:
    """Character ranges of this file that sit inside a `@MainActor` type.

    A `static func` written inside one of these is isolated too, so it may
    touch whatever it likes and nothing here has anything to say about it.
    """
    spans = []
    for match in MAIN_ACTOR.finditer(source):
        opened = source.find('{', match.end())
        if opened == -1:
            continue
        depth = 0
        for i in range(opened, len(source)):
            if source[i] == '{':
                depth += 1
            elif source[i] == '}':
                depth -= 1
                if depth == 0:
                    spans.append((opened, i))
                    break
    return spans


def parameters(source: str, openParen: int) -> list[tuple[str, str]]:
    """The (name, type) pairs of a parameter list whose `(` is at openParen."""
    depth = 0
    for j in range(openParen, len(source)):
        if source[j] in '([{<':
            depth += 1
        elif source[j] in ')]}>':
            depth -= 1
            if depth == 0:
                inner = source[openParen + 1:j]
                break
    else:
        return []
    pairs, depth, at, pieces = [], 0, 0, []
    for k, ch in enumerate(inner):
        if ch in '([{<':
            depth += 1
        elif ch in ')]}>':
            depth -= 1
        elif ch == ',' and depth == 0:
            pieces.append(inner[at:k])
            at = k + 1
    pieces.append(inner[at:])
    for piece in pieces:
        # `label name: Type`, `name: Type`, `_ name: Type`. The name a body
        # says is always the last word before the colon.
        found = re.match(r'\s*(?:\w+\s+)?(\w+)\s*:\s*(.+)$', piece, re.S)
        if not found:
            continue
        kind = found.group(2).strip()
        kind = re.sub(r'^(?:inout|borrowing|consuming|@\w+)\s+', '', kind).strip()
        kind = kind.split('=')[0].strip().rstrip('?!')
        pairs.append((found.group(1), kind))
    return pairs


def reachesIntoTheMainActor(source: str, actors: set[str]) -> list[tuple[int, str, str, str]]:
    """Static funcs that take a main-actor object and use a member of it."""
    isolated = isolatedSpans(source)
    bad = []
    for match in STATIC_FUNC.finditer(source):
        if any(start < match.start() < end for start, end in isolated):
            continue
        openParen = match.end() - 1
        body = bodyOf(source, openParen)
        if body is None:
            continue
        for name, kind in parameters(source, openParen):
            if kind not in actors:
                continue
            touch = re.search(r'(?<![\w.])' + re.escape(name) + r'\.(\w+)', body)
            if touch:
                line = source[:match.start()].count('\n') + 1
                bad.append((line, match.group(1), f'{name}.{touch.group(1)}', kind))
    return bad


def main(argv: list[str]) -> int:
    files = [Path(a) for a in argv] or sorted((ROOT / 'ios').rglob('*.swift'))

    # Every struct in the project, so a call in one file can be checked against
    # a declaration in another -- which is where the bug was.
    shapes: dict[str, tuple[list[str], str]] = {}
    # Structs that declare their own `init`. Kept apart from `shapes` because
    # the rule is different: a generated initialiser forgives an omission, and a
    # hand-written signature forgives nothing it did not name.
    written: dict[str, tuple[list[str], str]] = {}
    for path in sorted((ROOT / 'ios').rglob('*.swift')):
        text = strip(path.read_text(encoding='utf-8'))
        for name, labels in memberwise(text).items():
            shapes[name] = (labels, os.path.relpath(path, ROOT))
        # And the ones that write their own, whose signature is exact.
        for name, labels in handWritten(text).items():
            written[name] = (labels, os.path.relpath(path, ROOT))

    # Every protocol in the project, so a `weak var` in one file can be checked
    # against a declaration in another.
    #
    # The files actually being checked come FIRST, and that ordering is the
    # whole correctness of it: `classBound` takes the first declaration it
    # finds, so a file passed on the command line is read as itself rather than
    # as whatever the repository says about a protocol of the same name. The
    # first version put the repository first, and re-breaking a copied file to
    # test the check gave a clean bill of health -- it was reading the fixed
    # protocol out of the repo the whole time.
    everywhere = '\n'.join(
        [strip(p.read_text(encoding='utf-8')) for p in files]
        + [strip(p.read_text(encoding='utf-8')) for p in sorted((ROOT / 'ios').rglob('*.swift'))]
    )

    # Every type in the project that is pinned to the main actor. Read from the
    # same `everywhere`, and for the same reason: a static function in one file
    # is handed an object declared in another, and only the declaration says
    # which thread it belongs to.
    actors = mainActorTypes(everywhere)

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

        for line, held in overlappingAccess(source):
            bad += 1
            print(f'{rel}:{line}: the closure reads `{held}` while `&{held}` is '
                  f'still borrowed')
            print(f'    Xcode will say: overlapping accesses to \'{held}\', but '
                  'modification requires exclusive access')
            print('    Fix: withUnsafeBytes(of: value) by value, or copy what you '
                  'need into a local first')

        for line, kind in weakOnAStruct(source, everywhere):
            bad += 1
            print(f'{rel}:{line}: `weak` on {kind}, which is not class-bound')
            print(f'    Xcode will say: \'weak\' must not be applied to '
                  f'non-class-bound \'any {kind}\'')
            print(f'    Fix: protocol {kind}: AnyObject')

        for line, func, touched, kind in reachesIntoTheMainActor(source, actors):
            bad += 1
            print(f'{rel}:{line}: static `{func}` reaches into `{touched}`, '
                  f'and {kind} is @MainActor')
            print(f'    Xcode will say: main actor-isolated member of \'{kind}\' can not be '
                  'referenced from a nonisolated context')
            print(f'    Fix: take @MainActor off {kind}, or make {func} async and await it')

        # Hand-written initialisers, which take exactly what they say.
        for name, (labels, declaredIn) in written.items():
            for line, passed in callsTo(source, name):
                extra = [p for p in passed if p not in labels]
                if not extra:
                    continue
                bad += 1
                print(f'{rel}:{line}: {name}(...) passes {extra[0]!r}, and the '
                      f'init in {declaredIn} does not take it')
                print(f"    Xcode will say: extra argument '{extra[0]}' in call")
                print(f'    Fix: add it to {name}\'s own init, or stop passing it. '
                      f'That init takes: {", ".join(labels)}')

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
