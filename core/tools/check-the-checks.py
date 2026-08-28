#!/usr/bin/env python3
"""Breaks the real files on purpose and proves every checker notices.

    python3 core/tools/check-the-checks.py

## Why this exists, which is the least comfortable paragraph in the repository

Twice in this project a checker printed a green tick over the very bug it had
been written to catch.

  * `check-swift-names.py` skipped any struct whose body contained an `init`.
    `CorrectView` holds a nested `class Coordinator` with one, so the single
    struct the check existed for was the single struct it never looked at.
  * The `weak` check searched every protocol under `ios/` and found the
    repository's already-fixed declaration while it was supposed to be reading a
    deliberately broken copy. It reported the broken file as clean.

Both times the tell was identical: **it went green on a file that was wrong on
purpose.** A checker that has never been watched failing is not a checker, it is
a comment that runs.

So this takes the actual files out of the actual repository, makes the actual
mistake in them -- the `@MainActor` that produced Sam's compile error, the
argument order Xcode refused, the `weak` on an unbound protocol, the missing
`import Combine` -- and fails if the checker does not say so. Then it puts the
file back and fails if the checker still complains.

Nothing in here is a fixture written to be caught. Every mutation below is the
undoing of a fix that was made in response to a real error from a real compiler
on Sam's Mac, quoted in the file it was made in.

## Where it runs

In a copy. Each checker resolves the project root from its own path, so the
tree is rebuilt under a temporary directory -- `core/tools/`, `ios/` -- and the
checkers run against that. The working tree is never written to, which matters:
a harness that edits your files and restores them is one interrupted run away
from leaving a deliberate bug in the repository.
"""
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

GREEN, RED, DIM, OFF = '\033[32m', '\033[31m', '\033[2m', '\033[0m'


class Bench:
    """A throwaway copy of the parts of the project the checkers read."""

    def __init__(self, where: Path):
        self.where = where
        (where / 'core').mkdir(parents=True, exist_ok=True)
        shutil.copytree(ROOT / 'core' / 'tools', where / 'core' / 'tools',
                        ignore=shutil.ignore_patterns('__pycache__'))
        shutil.copytree(ROOT / 'ios', where / 'ios')
        # The web sources the checkers read. `check-bridge.py` needs two named
        # files; `check-controls.py` needs every screen in `web/src` and every
        # part of the audit, because its whole question is which of the one is
        # named by the other.
        #
        # Source files only, and still not the whole of `web/`: that folder
        # carries node_modules, a build directory and the audit's fixtures — a
        # scan, a supplier price list, a photograph — and copying them would
        # turn every run of this harness into a several-second file copy for no
        # gain. A checker that reads a `.jpg` does not exist.
        # The shell scripts at the top of the repository. `check-bash32.py`
        # reads every `.sh` in the tree, and the one whose bug it exists for is
        # one of these rather than one under `core/tools`.
        for path in sorted(ROOT.glob('*.sh')):
            shutil.copy2(path, where / path.name)
        for folder, suffixes in (('web/src', ('.tsx', '.ts')),
                                 ('web/audit', ('.mjs',))):
            for path in sorted((ROOT / folder).rglob('*')):
                if path.suffix not in suffixes:
                    continue
                rel = path.relative_to(ROOT)
                (where / rel).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, where / rel)

    def read(self, rel: str) -> str:
        return (self.where / rel).read_text(encoding='utf-8')

    def write(self, rel: str, text: str) -> None:
        (self.where / rel).write_text(text, encoding='utf-8')

    def restore(self, rel: str) -> None:
        shutil.copy2(ROOT / rel, self.where / rel)

    def run(self, tool: str, *args: str) -> tuple[int, str]:
        done = subprocess.run(
            [sys.executable, str(self.where / 'core' / 'tools' / tool), *args],
            capture_output=True, text=True, cwd=self.where,
        )
        return done.returncode, done.stdout + done.stderr


failures: list[str] = []


def expect(what: str, code: int, output: str, *, fires: bool,
           saying: str = '', notSaying: str = '') -> None:
    """A checker must have complained, and must have said the right thing.

    `notSaying` is for the checkers whose quiet state is not silence. Most of
    these tools are green on the repository as it stands, so "did it exit 0"
    answers everything. `check-controls.py` is not: it stands at seventy-nine
    findings today, and a mutation that adds an eightieth would be invisible to
    an exit code. So the mutation is watched by name — the checker must say
    this control before the break and must stop saying it after.
    """
    wrong = []
    if fires and code == 0:
        wrong.append('it passed, and the file was broken on purpose')
    if not fires and code != 0:
        wrong.append(f'it complained about a file that is correct:\n{output.strip()}')
    if fires and saying and saying not in output:
        wrong.append(f'it complained, but never said {saying!r}. It said:\n{output.strip()}')
    if notSaying and notSaying in output:
        wrong.append(f'it said {notSaying!r}, and nothing was broken to make it')
    if wrong:
        failures.append(f'{what}: {wrong[0]}')
        print(f'  {RED}✗{OFF} {what}')
        for line in wrong[0].split('\n'):
            print(f'      {DIM}{line}{OFF}')
    else:
        print(f'  {GREEN}✓{OFF} {what}')


# ---------------------------------------------------------------- swift names

def swiftNames(bench: Bench) -> None:
    print('check-swift-names.py — the seven things it claims to find')

    code, out = bench.run('check-swift-names.py')
    expect('says nothing about the repository as it stands', code, out, fires=False)

    # 1. The isolation error Sam's Xcode gave on 2026-08-25. `PinRecorder` was
    #    @MainActor and `CaptureWriter.write` is a plain static function.
    rel = 'ios/Trueline/PinRecorder.swift'
    bench.write(rel, bench.read(rel).replace(
        'final class PinRecorder {', '@MainActor\nfinal class PinRecorder {'))
    code, out = bench.run('check-swift-names.py')
    expect('@MainActor back on PinRecorder', code, out,
           fires=True, saying='CaptureWriter.swift')
    bench.restore(rel)

    # 2. The argument order Xcode refused in ReviewScreen. `CorrectView`
    #    declares `subscribed` and `onVisits` sixth and seventh; passing them
    #    first is "incorrect argument labels in call".
    rel = 'ios/Trueline/ReviewScreen.swift'
    was = bench.read(rel)
    swapped = reorderFirstCall(was, 'CorrectView')
    if swapped is None:
        failures.append('could not find a CorrectView(...) call to reorder')
        print(f'  {RED}✗{OFF} arguments to CorrectView out of order (no call found)')
    else:
        bench.write(rel, swapped)
        code, out = bench.run('check-swift-names.py')
        expect('arguments to CorrectView out of order', code, out,
               fires=True, saying='out of order')
        bench.restore(rel)

    # 2b. The same thing, on two properties that carry DEFAULTS.
    #
    #     Swift puts a defaulted stored property in the memberwise initialiser
    #     as a parameter that may be omitted -- omitted, but not reordered. The
    #     checker used to leave those out of its list of labels entirely, so
    #     `set(passed) - set(labels)` came out non-empty, the call was written
    #     off as "some other overload", and the ordering check went quiet on it.
    #
    #     That is not a hypothetical: `CorrectView` grew `reportsJSON`,
    #     `onTrouble` and `onWebError` on 2026-08-26 and the check stopped
    #     looking at the very call it exists for. This case is here so it
    #     cannot happen again quietly.
    rel = 'ios/Trueline/WebScreen.swift'
    was = bench.read(rel)
    swapped = was.replace(
        'reportsJSON: diagnostics?.asJSON() ?? Data(),\n            onTrouble: act,',
        'onTrouble: act,\n            reportsJSON: diagnostics?.asJSON() ?? Data(),',
    )
    if swapped == was:
        failures.append('WebScreen no longer passes reportsJSON then onTrouble')
        print(f'  {RED}✗{OFF} two defaulted arguments out of order (nothing to swap)')
    else:
        bench.write(rel, swapped)
        code, out = bench.run('check-swift-names.py')
        expect('two defaulted arguments out of order', code, out,
               fires=True, saying='out of order')
        bench.restore(rel)

    # 2b2. The same swap again, with the property written WITHOUT its type.
    #
    #      `var unlockSeed = ""` is ordinary Swift and is in the memberwise
    #      initialiser exactly as an annotated one is. `DEFAULTED` used to insist
    #      on the `: Type`, so a property written that way was invisible, the
    #      call passing it was written off as "some other overload", and the
    #      ordering check went silent on it -- the same failure 2b records,
    #      arriving by a second door. It arrived for real: `WebScreen` grew
    #      `var unlockSeed = ""` on 2026-08-28 and 2b went green on a file
    #      broken on purpose. This is that case, kept.
    both = bench.read(rel).replace('    var unlockSeed: String = ""', '    var unlockSeed = ""')
    if both == bench.read(rel):
        failures.append('WebScreen no longer declares unlockSeed with a type')
        print(f'  {RED}✗{OFF} a defaulted property with no type annotation (nothing to unannotate)')
    else:
        bench.write(rel, both.replace(
            'reportsJSON: diagnostics?.asJSON() ?? Data(),\n            onTrouble: act,',
            'onTrouble: act,\n            reportsJSON: diagnostics?.asJSON() ?? Data(),',
        ))
        code, out = bench.run('check-swift-names.py')
        expect('out of order, with the new property written without its type', code, out,
               fires=True, saying='out of order')
        bench.restore(rel)

    # 2c. Overlapping exclusive access -- the error Xcode gave on 2026-08-26,
    #     restored exactly as it was written.
    #
    #     `withUnsafePointer(to: &info.machine)` whose closure then reads
    #     `MemoryLayout.size(ofValue: info.machine)`. The file parses, every
    #     name in it is declared, the argument order is right, and it does not
    #     compile. Nothing else in this repository could see it.
    rel = 'ios/Trueline/Diagnostics.swift'
    was = bench.read(rel)
    broken = was.replace(
        """        let machine = withUnsafeBytes(of: info.machine) { bytes in""",
        """        let machine = withUnsafePointer(to: &info.machine) { pointer in
            pointer.withMemoryRebound(
                to: CChar.self,
                capacity: MemoryLayout.size(ofValue: info.machine)
            ) { String(cString: $0) }
        }
        let unused = withUnsafeBytes(of: info.machine) { bytes in""",
    )
    if broken == was:
        failures.append('Diagnostics.swift no longer reads utsname the safe way')
        print(f'  {RED}✗{OFF} overlapping accesses inside an inout closure (nothing to break)')
    else:
        bench.write(rel, broken)
        code, out = bench.run('check-swift-names.py')
        expect('overlapping accesses inside an inout closure', code, out,
               fires=True, saying='overlapping accesses')
        bench.restore(rel)

    # 2d. An argument a hand-written `init` does not take.
    #
    #     Xcode, on 2026-08-26, on the very build that was meant to carry six
    #     fixes to a phone:
    #
    #         RootTabs.swift:86:30: error: extra argument 'onClose' in call
    #
    #     `ScanScreen` builds its @StateObject from `store`, so it writes its own
    #     init -- and a struct that writes its own gets no memberwise one, so
    #     adding a stored property adds no parameter. The file parsed, every name
    #     was declared, the argument order was right, and nothing here looked at
    #     what a hand-written signature actually takes.
    rel = 'ios/Trueline/ScanScreen.swift'
    was = bench.read(rel)
    # Written against the shape of the signature rather than its full text, so
    # adding a later parameter -- `markingInto` was added the day this comment
    # was written -- does not silently stop the mutation happening. When it did
    # stop, only the `self.onClose = onClose` line was removed, which is not a
    # signature change at all: the checker correctly said nothing and this
    # harness reported the checker as broken.
    broken = re.sub(
        r'\n\s*onClose: @escaping \(\) -> Void,?(?=\n)', '', was, count=1
    ).replace('        self.onClose = onClose\n', '')
    if broken == was:
        failures.append('ScanScreen no longer writes its own init taking onClose')
        print(f'  {RED}✗{OFF} an argument a hand-written init does not take (nothing to break)')
    else:
        bench.write(rel, broken)
        code, out = bench.run('check-swift-names.py')
        expect('an argument a hand-written init does not take', code, out,
               fires=True, saying='extra argument')
        bench.restore(rel)

    # 3. `weak` on a protocol with no class bound -- the first error a real
    #    compiler ever gave this project.
    rel = 'ios/Trueline/ARMeasureSession.swift'
    bench.write(rel, bench.read(rel).replace(
        'protocol ARSCNViewProviding: AnyObject', 'protocol ARSCNViewProviding'))
    code, out = bench.run('check-swift-names.py')
    expect('weak on a protocol that is not class-bound', code, out,
           fires=True, saying='not class-bound')
    bench.restore(rel)

    # 4. ObservableObject without Combine -- seven files at once, the first
    #    time this was built.
    rel = 'ios/Trueline/ProjectStore.swift'
    bench.write(rel, bench.read(rel).replace('import Combine\n', '', 1))
    code, out = bench.run('check-swift-names.py')
    expect('ObservableObject with no import Combine', code, out,
           fires=True, saying='Combine')
    bench.restore(rel)

    # 5. `dismiss()` with no @Environment declaring it.
    #
    #    This used to point at `ScanScreen`, which is where the bug happened.
    #    ScanScreen does not call `dismiss()` any more: it is the root of a tab
    #    now, where dismissing is silently nothing, and Close takes an `onClose`
    #    from whoever put it on screen. `DeadCaptureScreen` is genuinely pushed
    #    and genuinely dismisses, so the case moved with the behaviour rather
    #    than being deleted for being inconvenient.
    rel = 'ios/Trueline/DeadCaptureScreen.swift'
    was = bench.read(rel)
    stripped = '\n'.join(
        line for line in was.split('\n') if '@Environment(\\.dismiss)' not in line
    )
    if stripped == was:
        failures.append('DeadCaptureScreen no longer declares @Environment(\\.dismiss)')
        print(f'  {RED}✗{OFF} dismiss() with nothing declaring it (nothing to remove)')
    else:
        bench.write(rel, stripped)
        code, out = bench.run('check-swift-names.py')
        expect('dismiss() with nothing declaring it', code, out,
               fires=True, saying='dismiss')
        bench.restore(rel)


def reorderFirstCall(source: str, name: str) -> str | None:
    """Swaps the first two labelled arguments of the first `Name(...)` call."""
    at = source.find(f'{name}(')
    if at == -1:
        return None
    opened = at + len(name)
    depth = 0
    for i in range(opened, len(source)):
        if source[i] in '([{':
            depth += 1
        elif source[i] in ')]}':
            depth -= 1
            if depth == 0:
                closed = i
                break
    else:
        return None
    inner = source[opened + 1:closed]
    pieces, depth, start = [], 0, 0
    for k, ch in enumerate(inner):
        if ch in '([{':
            depth += 1
        elif ch in ')]}':
            depth -= 1
        elif ch == ',' and depth == 0:
            pieces.append(inner[start:k])
            start = k + 1
    pieces.append(inner[start:])
    if len(pieces) < 2:
        return None
    # Last to the front: the further it moves, the less this depends on which
    # two arguments happen to be adjacent.
    pieces = [pieces[-1].strip(), *[p.strip() for p in pieces[:-1]]]
    return source[:opened + 1] + ', '.join(pieces) + source[closed:]


# -------------------------------------------------------------------- pbxproj

def pbxproj(bench: Bench) -> None:
    print('pbxproj-diff.py — a reorder is not a change, and a change is')
    rel = 'ios/Trueline.xcodeproj/project.pbxproj'
    mine = bench.where / rel
    theirs = bench.where / 'shuffled.pbxproj'

    # What Xcode does every time it opens the project: the same build files,
    # written in a different order. `git diff` called this 38 changed lines.
    text = mine.read_text(encoding='utf-8')
    lines = text.split('\n')
    entries = [i for i, l in enumerate(lines) if '/* Sources */ = {isa = PBXBuildFile' in l
               or (' = {isa = PBXBuildFile;' in l)]
    if len(entries) < 2:
        failures.append('no PBXBuildFile entries found to shuffle')
        print(f'  {RED}✗{OFF} a reorder produces nothing (nothing to reorder)')
    else:
        moved = lines[:]
        for a, b in zip(entries, reversed(entries)):
            moved[a] = lines[b]
        theirs.write_text('\n'.join(moved), encoding='utf-8')
        code, out = bench.run('pbxproj-diff.py', str(mine), str(theirs))
        expect('build files reordered — nothing to report', code, out, fires=False)

    # A real edit: the signing team changed.
    body = mine.read_text(encoding='utf-8')
    if 'DEVELOPMENT_TEAM' not in body:
        failures.append('project.pbxproj no longer mentions DEVELOPMENT_TEAM')
        print(f'  {RED}✗{OFF} a changed build setting is reported (no setting to change)')
        return
    import re as _re
    changed = _re.sub(r'DEVELOPMENT_TEAM = [^;]+;', 'DEVELOPMENT_TEAM = ZZZZZZZZZZ;', body)
    theirs.write_text(changed, encoding='utf-8')
    code, out = bench.run('pbxproj-diff.py', str(mine), str(theirs))
    expect('a changed build setting is reported', code, out,
           fires=True, saying='DEVELOPMENT_TEAM')

    # A file dropped out of the build, which is how a target silently stops
    # compiling something.
    gone = _re.sub(r'^\s*\w+ /\* CaptureWriter\.swift in Sources \*/.*\n', '',
                   body, count=1, flags=_re.M)
    if gone != body:
        theirs.write_text(gone, encoding='utf-8')
        code, out = bench.run('pbxproj-diff.py', str(mine), str(theirs))
        expect('a file dropped from the build is reported', code, out,
               fires=True, saying='FILE-')


# -------------------------------------------------------------------- xcscheme

def xcscheme(bench: Bench) -> None:
    """The scheme tool, judged by the rule setup-mac.sh actually applies.

    `xcscheme-diff.py` prints every difference and exits 1 for any of them,
    which is right for a tool somebody runs by hand. What decides whether a
    pull is stopped is narrower, and it lives in setup-mac.sh: it counts the
    lines beginning `-`, because a `-` means something the repository's scheme
    had is gone or has different attributes, and a `+` on its own is Xcode
    filling in something the file did not have.

    So the assertions below are on that count and not on the exit code. The
    first draft of this harness asserted on the exit code, called the tool
    broken for correctly reporting a `TestAction` Xcode had added, and was
    itself the thing that was wrong -- which is the failure mode this whole
    file is about, one level up.
    """
    print("xcscheme-diff.py — Xcode's bookkeeping against a real edit")
    rel = 'ios/Trueline.xcodeproj/xcshareddata/xcschemes/Trueline.xcscheme'
    mine = bench.where / rel
    theirs = bench.where / 'other.xcscheme'
    base = mine.read_text(encoding='utf-8')

    # The rule being tested is only worth testing if setup-mac.sh still holds
    # it. If somebody changes the script to count every line again, this says
    # so rather than quietly testing something nothing does.
    script = (ROOT / 'setup-mac.sh').read_text(encoding='utf-8')
    if "grep -c '^-'" not in script:
        failures.append("setup-mac.sh no longer counts only the `-` lines from "
                        'xcscheme-diff.py, so the rule tested below is not the rule '
                        'that runs')
        print(f'  {RED}✗{OFF} setup-mac.sh still counts only removals')
    else:
        print(f'  {GREEN}✓{OFF} setup-mac.sh still counts only removals')

    def stops(text: str) -> tuple[bool, str]:
        """Whether this scheme would stop a pull, and what the tool said."""
        theirs.write_text(text, encoding='utf-8')
        _, out = bench.run('xcscheme-diff.py', str(mine), str(theirs))
        return any(line.startswith('-') for line in out.split('\n')), out

    def expectScheme(what: str, text: str, *, blocks: bool, saying: str = '') -> None:
        blocked, out = stops(text)
        if blocked != blocks:
            failures.append(
                f'{what}: ' + ('it let a real edit through' if blocks else
                               "it would stop a pull over Xcode's own bookkeeping")
                + (f'\n{out.strip()}' if out.strip() else '')
            )
            print(f'  {RED}✗{OFF} {what}')
            for line in (out.strip() or '(it printed nothing)').split('\n'):
                print(f'      {DIM}{line}{OFF}')
            return
        if blocks and saying and saying not in out:
            failures.append(f'{what}: stopped the pull without ever saying {saying!r}')
            print(f'  {RED}✗{OFF} {what}')
            print(f'      {DIM}{out.strip()}{OFF}')
            return
        print(f'  {GREEN}✓{OFF} {what}')

    # Xcode noting which Xcode it is. This alone stopped a pull.
    expectScheme('a version bump does not stop a pull',
                 base.replace('LastUpgradeVersion = "1500"', 'LastUpgradeVersion = "1620"')
                     .replace('version = "1.7"', 'version = "2.0"'),
                 blocks=False)

    # Xcode reflowing an element it wrote on one line. The allowlist this
    # replaced did not have `<BuildAction` alone on a line in it.
    expectScheme('a reflowed element does not stop a pull',
                 base.replace(
                     '<BuildAction parallelizeBuildables = "YES" '
                     'buildImplicitDependencies = "YES">',
                     '<BuildAction\n      parallelizeBuildables = "YES"\n'
                     '      buildImplicitDependencies = "YES">'),
                 blocks=False)

    # Xcode adding the TestAction any scheme without one gets. Six phantom
    # removals came out of this, and it stopped Sam's pull twice.
    added = base.replace('   <LaunchAction', """   <TestAction buildConfiguration = "Debug" shouldUseLaunchSchemeArgsEnv = "YES">
      <Testables>
      </Testables>
   </TestAction>
   <LaunchAction""", 1)
    expectScheme('a TestAction Xcode added does not stop a pull', added, blocks=False)

    # And the things that are real.
    expectScheme('Run switched from Debug to Release stops a pull',
                 base.replace('<LaunchAction buildConfiguration = "Debug"',
                              '<LaunchAction buildConfiguration = "Release"'),
                 blocks=True, saying='LaunchAction')
    expectScheme('a target that stopped building for Run stops a pull',
                 base.replace('buildForRunning = "YES"', 'buildForRunning = "NO"'),
                 blocks=True, saying='buildForRunning=NO')

    # The one that matters most: Xcode's own addition AND a real edit at once.
    # The addition must not hide the edit.
    expectScheme('a real edit underneath a TestAction still stops a pull',
                 added.replace('<LaunchAction buildConfiguration = "Debug"',
                               '<LaunchAction buildConfiguration = "Release"'),
                 blocks=True, saying='LaunchAction')


    # 8. And the other way round: a framework named in PROSE is not a use.
    #
    #    `ARMeasureSession.swift` explains, in a doc comment, that a
    #    `@StateObject` on a tab lives as long as the app -- which is why the
    #    camera never came back. The check read imports and uses off the same
    #    raw text and reported the file as missing `import SwiftUI`: a compile
    #    error the compiler would never have. A false positive is how a check
    #    gets switched off, so it is worth a case of its own.
    rel = 'ios/Trueline/PinRecorder.swift'
    was = bench.read(rel)
    bench.write(rel, '/// A note about @StateObject and @ObservedObject on a tab.\n' + was)
    code, out = bench.run('check-swift-names.py')
    expect('SwiftUI named in a comment is not a use of it', code, out, fires=False)
    bench.restore(rel)


# ---------------------------------------------------------------------- doors

def doors(bench: Bench) -> None:
    """The three shapes of "a screen nobody can reach".

    Each of these is the undoing of a fix made this week, after the grid in
    `Sketch.tsx` turned out to be openable exactly one way: start a scan, let it
    fail, open the dead capture, and take a way out.

    The first version of `check-doors.py` passed two of these three, and it is
    worth writing down which, because both are the same mistake twice:

      * With the only `NavigationLink(value: Route.newDraw)` deleted it still
        found `case .newDraw:` in the destination switch and called that a door.
        A branch in a switch is the room, not the way in.
      * With `opensOn: .draw` deleted it still found `scene.draw(corners:)` and
        the sentence "Or draw one above". A bare word is not a route.

    Both went green on a file broken on purpose, which is the one failure this
    whole harness exists to make impossible.
    """
    print('check-doors.py — a route with no door, and a door onto nothing')

    code, out = bench.run('check-doors.py')
    expect('says nothing about the repository as it stands', code, out, fires=False)

    # 1. The door itself: the row on the Rooms tab that opens the grid.
    rel = 'ios/Trueline/ProjectsScreen.swift'
    dead = 'ios/Trueline/DeadCaptureScreen.swift'
    bench.write(rel, bench.read(rel).replace(
        'NavigationLink(value: Route.newDraw) {', 'NavigationLink(value: Route.newScan) {'))
    bench.write(dead, bench.read(dead).replace('path = [.newDraw]', 'path = [.newMeasure]'))
    code, out = bench.run('check-doors.py')
    expect('the Draw a room row taken off the Rooms tab', code, out,
           fires=True, saying='has no door')
    bench.restore(rel)
    bench.restore(dead)

    # 2. The room behind it: the branch that actually builds the screen.
    was = bench.read(rel)
    at = was.find('case .newDraw:')
    end = was.find('case .open(let entry):', at)
    if at < 0 or end < 0:
        failures.append('could not find the .newDraw branch to remove')
        print(f'  {RED}✗{OFF} the destination behind Draw a room removed (no branch found)')
    else:
        bench.write(rel, was[:at] + was[end:])
        code, out = bench.run('check-doors.py')
        expect('the destination behind Draw a room removed', code, out,
               fires=True, saying='door onto nothing')
        bench.restore(rel)

    # 3. The web route: the one thing that loads the bundle on the grid.
    rel = 'ios/Trueline/DrawScreen.swift'
    bench.write(rel, bench.read(rel).replace('opensOn: .draw,', 'opensOn: .room,'))
    code, out = bench.run('check-doors.py')
    expect('the only screen that opens the bundle on the grid', code, out,
           fires=True, saying='Opening.draw')
    bench.restore(rel)

    # 4. A screen in its own file that nothing ever presents.
    #
    # The fourth time. `PaywallView` compiled, was in the target, passed every
    # Swift checker, and no phone could show it: it is presented from a `.sheet`
    # rather than pushed as a `Route`, so the two enums above knew nothing about
    # it. Every gate in the app refused a contractor and offered him no way to
    # buy — a lost sale on each one, and a 3.1.1 rejection the day it goes on
    # sale. The route half asks "can this case be reached"; this asks the other
    # half, "does anything put this screen on the glass".
    rel = 'ios/Trueline/ProjectsScreen.swift'
    was = bench.read(rel)
    at = was.find('.sheet(isPresented: $showingPaywall) {')
    if at < 0:
        failures.append('could not find the paywall sheet to remove')
        print(f'  {RED}✗{OFF} the paywall left with nothing presenting it (no sheet found)')
    else:
        end = was.find('        }\n', was.find('onClose: { showingPaywall = false }', at))
        bench.write(rel, was[:at] + was[end + len('        }\n'):])
        code, out = bench.run('check-doors.py')
        expect('the paywall left with nothing presenting it', code, out,
               fires=True, saying='nothing ever presents')
        bench.restore(rel)


# ------------------------------------------------------------------- bridge

def bridge(bench: Bench) -> None:
    """A channel name that does not match on both sides.

    The page talks to the app through named message handlers. The name is a
    string in three places written months apart — `handler('x')` in
    `bridge.ts`, `add(..., name: "x")` and `case "x":` in `CorrectView.swift` —
    and a fourth, the fake handler list in `web/audit/lib.mjs` that every
    browser audit installs.

    Nothing compared them until `haptic` became the tenth channel. A typo on any
    one of the four compiles, ships, passes every test, and does nothing on a
    phone: `handler()` returns undefined for a name nobody registered, and every
    caller correctly and quietly does nothing. That politeness is right in a
    browser, where there is no app, and it is exactly what hides the mistake.

    Four mutations, one per list.
    """
    print('check-bridge.py — a channel name that does not match on both sides')

    code, out = bench.run('check-bridge.py')
    expect('says nothing about the repository as it stands', code, out, fires=False)

    native = 'ios/Trueline/CorrectView.swift'
    web = 'web/src/bridge.ts'
    fakes = 'web/audit/lib.mjs'

    bench.write(native, bench.read(native).replace(
        'add(context.coordinator, name: "haptic")', 'add(context.coordinator, name: "hpatic")'))
    code, out = bench.run('check-bridge.py')
    expect('a typo in the app\'s registration', code, out,
           fires=True, saying='never registers it')
    bench.restore(native)

    bench.write(native, bench.read(native).replace('case "haptic":', 'case "hpatic":'))
    code, out = bench.run('check-bridge.py')
    expect('registered, but the switch spells it differently', code, out,
           fires=True, saying='handles nothing when it arrives')
    bench.restore(native)

    bench.write(web, bench.read(web).replace("handler('haptic')", "handler('hpatic')"))
    code, out = bench.run('check-bridge.py')
    expect('the page posting to a name nobody registered', code, out,
           fires=True, saying='never registers it')
    bench.restore(web)

    # The LAST channel in the list, whatever it is called today.
    #
    # This used to name two channels literally and drop one of them. Adding
    # `barcode` to the list on 2026-08-28 made that string stop matching, so the
    # mutation became a no-op and this case passed on a file nothing had changed
    # — a checker going green because the test forgot to break anything. Found
    # by the pre-push hook, which is what it is for.
    #
    # Read off the file instead: the newest channel is the one somebody actually
    # forgets to add here, so it is the right one to take away.
    inList = bench.read(fakes)
    opens = inList.index('for (const name of [')
    shuts = inList.index(']', opens)
    names = [one.strip() for one in inList[opens + len('for (const name of ['):shuts].split(',')]
    bench.write(fakes, inList[:opens] + 'for (const name of ['
                + ', '.join(names[:-1]) + inList[shuts:])
    code, out = bench.run('check-bridge.py')
    expect('a channel no browser audit can see', code, out,
           fires=True, saying='no browser audit can see it')
    bench.restore(fakes)


# ----------------------------------------------------------------- portable

def portable(bench: Bench) -> None:
    """A container path baked into a tool that runs on a Mac.

    The mistake, exactly as it happened: eight tools each grew the same line,

        process.env.TRUELINE_CHROME ?? '/opt/pw-browsers/chromium-1194/...'

    which is real inside one Linux container and nowhere else. It was harmless
    until `check-art` went into `npm run verify` -- the command Sam runs on his
    Mac before he builds -- and that command then could not pass on the machine
    that ships the app.

    This one gets its own small tree rather than the shared bench: the checker
    reads every tracked source file in a repository, and pointing it at the
    whole copy would make it slow and would couple this test to whatever else
    happens to be in the working tree.
    """
    print('check-portable.py — a container path in code that runs on a Mac')

    where = bench.where / 'portable'
    (where / 'site' / 'tools').mkdir(parents=True, exist_ok=True)
    clean = "const CHROME = process.env.TRUELINE_CHROME ?? null;\n"
    tool = where / 'site' / 'tools' / 'shots.mjs'
    tool.write_text(clean, encoding='utf-8')

    def run() -> tuple[int, str]:
        done = subprocess.run(
            [sys.executable, str(ROOT / 'core' / 'tools' / 'check-portable.py'), str(where)],
            capture_output=True, text=True,
        )
        return done.returncode, done.stdout + done.stderr

    code, out = run()
    expect('says nothing about a tool that resolves its browser at run time',
           code, out, fires=False)

    tool.write_text(
        "const CHROME = process.env.TRUELINE_CHROME\n"
        "  ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';\n",
        encoding='utf-8')
    code, out = run()
    expect('the exact line that stopped npm run verify on the Mac', code, out,
           fires=True, saying='/opt/pw-browsers')

    # And the two other shapes of the same mistake.
    tool.write_text("const OUT = '/workspace/trueline/site/film';\n", encoding='utf-8')
    code, out = run()
    expect('a path under the container\'s checkout', code, out,
           fires=True, saying='/workspace/trueline')

    tool.write_text("const KEY = '/home/somebody/.ssh/id_ed25519';\n", encoding='utf-8')
    code, out = run()
    expect('somebody\'s home directory', code, out, fires=True, saying='/home/somebody')

    # The one file allowed to name them, because knowing about machines is its
    # whole job -- and only under its real name, not any file that copies it.
    (where / 'core' / 'tools').mkdir(parents=True, exist_ok=True)
    (where / 'core' / 'tools' / 'browser.mjs').write_text(
        "const CONTAINER = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';\n",
        encoding='utf-8')
    tool.write_text(clean, encoding='utf-8')
    code, out = run()
    expect('and the resolver itself is allowed to name them', code, out, fires=False)


# --------------------------------------------------------------- conformance

def conformance(bench: Bench) -> None:
    """A type that says it is Hashable, holding something that is not.

    The build error, in full, from Sam's Mac:

        ios/Trueline/ProjectStore.swift:15:12: error: type 'ProjectStore.Entry'
        does not conform to protocol 'Hashable'

    `Entry` is what `NavigationLink(value:)` carries, so it has to hash, and
    Swift synthesises that only when every stored property already does. `Entry`
    grew a `card: RoomCard`; `RoomCard` was declared `Codable, Equatable`. One
    missing word, in a file three away from the error, and no compiler on the
    machine it was written on.

    The mutation below is that exact undoing.
    """
    print('check-swift-conform.py — a conformance Swift cannot synthesise')

    code, out = bench.run('check-swift-conform.py')
    expect('says nothing about the repository as it stands', code, out, fires=False)

    rel = 'ios/Trueline/RoomCard.swift'
    bench.write(rel, bench.read(rel).replace(
        'struct RoomCard: Codable, Hashable {', 'struct RoomCard: Codable, Equatable {'))
    code, out = bench.run('check-swift-conform.py')
    expect('RoomCard put back to Equatable, exactly as it was', code, out,
           fires=True, saying='Entry says it is Hashable')
    expect('and it names the property that carries it', code, out,
           fires=True, saying='card: RoomCard')
    bench.restore(rel)

    # A conformance somebody wrote by hand is not synthesised, so a property
    # that does not conform is the author's business and not an error.
    code, out = bench.run('check-swift-conform.py')
    expect('quiet again once the word is back', code, out, fires=False)


# ------------------------------------------------------------------- awaiting

def awaiting(bench: Bench) -> None:
    """An SDK call that is async or throwing, written as if it were neither.

    From Sam's Mac, both errors from the one line:

        CorrectView.swift:292:21: error: call can throw, but it is not marked
                                  with 'try' and the error is not handled
        CorrectView.swift:292:21: error: expression is 'async' but is not
                                  marked with 'await'

    WebKit has two `evaluateJavaScript`. The one taking a completion handler is
    ordinary; the one that does not is `async throws`, and inside a `Task` that
    is the overload the compiler picks. The same file calls the callback form
    sixteen lines further down and compiles fine, which is why nobody looks
    twice at either.

    The second case below is the one that matters most for this checker's
    usefulness: the callback form must NOT be flagged. An earlier version of
    this checker listed bare names and reported seven of this project's own
    methods -- `save`, `record`, `data` -- as async SDK calls. Seven false
    positives is seven reasons to stop reading a checker's output, so the
    patterns are receiver-qualified now and this proves it.
    """
    print('check-swift-await.py — async written as if it were not')

    code, out = bench.run('check-swift-await.py')
    expect('says nothing about the repository as it stands', code, out, fires=False)

    rel = 'ios/Trueline/CorrectView.swift'
    was = bench.read(rel)

    bench.write(rel, was.replace(
        '_ = try? await webView.evaluateJavaScript(', 'webView.evaluateJavaScript('))
    code, out = bench.run('check-swift-await.py')
    expect('the await taken back off, exactly as it was', code, out,
           fires=True, saying='evaluateJavaScript')
    bench.restore(rel)

    # `try` alone is still a compile error, and a different one.
    bench.write(rel, was.replace(
        '_ = try? await webView.evaluateJavaScript(', '_ = try? webView.evaluateJavaScript('))
    code, out = bench.run('check-swift-await.py')
    expect('try without await', code, out, fires=True, saying='says `await`')
    bench.restore(rel)

    bench.write(rel, was.replace(
        '_ = try? await webView.evaluateJavaScript(', '_ = await webView.evaluateJavaScript('))
    code, out = bench.run('check-swift-await.py')
    expect('await without try', code, out, fires=True, saying='says `try`')
    bench.restore(rel)

    code, out = bench.run('check-swift-await.py')
    expect('and the completion-handler form is never flagged', code, out, fires=False)


# ------------------------------------------------------------------ arguments

def arguments(bench: Bench) -> None:
    """A call that does not pass what the function it calls requires.

        ios/Trueline/DrawScreen.swift:168:116: error: missing argument for
                                              parameter 'card' in call

    `Backup.push` gained a `card:` so a room restored on a second phone would
    remember its own name. Two places call it, in two files. One was updated.

    `check-swift-names.py` reads memberwise initialisers and passed this
    happily: `push` is an ordinary method, and nothing was reading ordinary
    methods' arguments.
    """
    print('check-swift-args.py — a call missing an argument the function needs')

    code, out = bench.run('check-swift-args.py')
    expect('says nothing about the repository as it stands', code, out, fires=False)

    rel = 'ios/Trueline/DrawScreen.swift'
    was = bench.read(rel)
    bench.write(rel, was.replace('                kind: "drawn",\n                card: cardJSON\n',
                                 '                kind: "drawn"\n'))
    code, out = bench.run('check-swift-args.py')
    expect('the card argument taken back off, exactly as it was', code, out,
           fires=True, saying="missing 'card'")
    expect('and it names where the function is declared', code, out,
           fires=True, saying='Backup.swift')
    bench.restore(rel)

    # An argument that HAS a default may be left out, and must not be flagged --
    # otherwise every optional parameter in the project becomes a false alarm.
    code, out = bench.run('check-swift-args.py')
    expect('quiet again once it is back', code, out, fires=False)


# -------------------------------------------------------------------- paywall

def paywall(bench: Bench) -> None:
    """The tester unlock, and the one thing that must never happen to it.

    Every paid screen is behind `subscribed`. `Subscription.testing` turns that
    on so the two people testing the app can reach the takeoff before anything
    is on sale -- and it is compiled out of Release by `#if DEBUG`. Lose the
    guard and the App Store build gives the product away, with no symptom except
    that nobody ever pays.
    """
    print('check-paywall.py — the tester unlock, and its guard')

    code, out = bench.run('check-paywall.py')
    expect('says nothing about the repository as it stands', code, out, fires=False)

    rel = 'ios/Trueline/Subscription.swift'
    was = bench.read(rel)

    bench.write(rel, was.replace(
        '        #if DEBUG\n        return true\n        #else\n        return false\n        #endif',
        '        return true'))
    code, out = bench.run('check-paywall.py')
    expect('the #if DEBUG taken off the unlock', code, out,
           fires=True, saying='no `#if DEBUG`')
    bench.restore(rel)

    # And the other way in: somebody simply turning it on somewhere else.
    other = 'ios/Trueline/PaywallView.swift'
    before = bench.read(other)
    bench.write(other, before.replace(
        'struct PaywallView: View {',
        'struct PaywallView: View {\n    func cheat() { subscription.subscribed = true }'))
    code, out = bench.run('check-paywall.py')
    expect('anything else that sets subscribed = true', code, out,
           fires=True, saying='outright')
    bench.restore(other)

    code, out = bench.run('check-paywall.py')
    expect('quiet again once both are back', code, out, fires=False)


# ------------------------------------------------------------------ controls

def controls(bench: Bench) -> None:
    """A control the app draws that no part of the audit has ever named.

    This is the shape all four of the reachability bugs were in before somebody
    found them by hand. `PaywallView` compiled, was in the target and passed
    nine Swift checkers, and nothing presented it. "Photograph it" was inside a
    collapsed row that gave no sign it opened. The mark button was refusing
    280px above the thumb pressing it. Every time, the control was finished and
    no script had ever asked for it by name, so nothing had ever had the chance
    to notice.

    Three mutations, and the first two are the undoing of a real audit line.

    The quiet state used to be noise: `check-controls.py` stood at seventy-nine
    findings, so an exit code could not tell an eightieth from the seventy-nine
    and every mutation had to be watched by name instead. **The backlog is
    gone** — every control in `web/src` is driven by a part of the audit and
    the excuse file is empty — so silence means silence again and an exit code
    answers each one. The `notSaying` machinery stays in `expect` for the next
    checker that needs it.
    """
    print('check-controls.py — a control nothing in the audit drives')

    # 1. Driven, but never by name. `a6-persist.mjs` renames a wall through
    #    `getByRole('textbox', { name: 'What to call this wall' })`, and it is
    #    the only part in the repository that says those words. Reach for the
    #    same box positionally instead and the audit still passes, still types
    #    into it, still proves the rename survives a reload — and no longer
    #    proves anybody could find the box. That is the paywall's exact state:
    #    working, tested, and unreachable as far as any evidence goes.
    #
    #    Two parts name it now, not one -- `a39-collapse.mjs` reaches for the
    #    same box when it proves the rename row folds. So the mutation has to
    #    take the name out of BOTH, or the check is right to stay quiet and this
    #    assertion is the thing that is wrong. Coverage growing is the good
    #    outcome; a mutation that no longer isolates is stale, not a failure.
    named = '`What to call this wall`'
    rel = 'web/audit/a6-persist.mjs'
    also = 'web/audit/a39-collapse.mjs'

    code, out = bench.run('check-controls.py')
    expect('the rename box is driven by name as the repository stands',
           code, out, fires=False)

    #    The stand-in has to match NOTHING: `check-controls.py` reads a regex
    #    locator as well as a literal one, so a looser pattern over the same
    #    words would still count as driving it and the mutation would prove
    #    nothing.
    bench.write(also, bench.read(also).replace(
        "{ name: 'What to call this wall' }", "{ name: 'a box by no name' }"))
    bench.write(rel, bench.read(rel).replace(
        "getByRole('textbox', { name: 'What to call this wall' })",
        "getByRole('textbox').first()"))
    code, out = bench.run('check-controls.py')
    expect('both parts that named it reaching for it another way instead',
           code, out, fires=True, saying=named)
    bench.restore(rel)
    bench.restore(also)

    code, out = bench.run('check-controls.py')
    expect('and quiet about it again once the name is back', code, out,
           fires=False)

    # 2. Whole parts deleted. The mark button is the one Sam reported as dead,
    #    and the control's name is built as `Mark a spot on ${wall.id}`, so what
    #    drives it is anything naming something that starts `Mark a spot on `.
    #    Two parts do: `a31-mark.mjs`, and `a40-ceiling.mjs` through the
    #    ceiling's own `Mark a spot on the ceiling` -- which begins with the
    #    same head and therefore counts, generously and on purpose.
    #
    #    Both go, or the check is right to stay quiet.
    mark = '`Mark a spot on`'
    parts = ['web/audit/a31-mark.mjs', 'web/audit/a40-ceiling.mjs']

    code, out = bench.run('check-controls.py')
    expect('the mark controls are driven as the repository stands',
           code, out, fires=False)

    for part in parts:
        (bench.where / part).unlink()
    code, out = bench.run('check-controls.py')
    expect('every part that drives the mark controls, deleted', code, out,
           fires=True, saying=mark)
    for part in parts:
        bench.restore(part)

    code, out = bench.run('check-controls.py')
    expect('and quiet about them again once the parts are back', code, out,
           fires=False)

    # 2b. A control the browser calls something else entirely.
    #
    #     A `<label>` that WRAPS its box names that box with all of its own
    #     text. `PriceList.tsx`'s column picker announced as
    #     "The price— pick a column —" plus every column header in the select,
    #     and `getByLabel('The price', { exact: true })` found nothing. This
    #     checker was the optimistic one: it read the short name out of the
    #     source and said nothing about the gap, which is its own failure mode
    #     one level in. `aria-label` on the box is what wins over the wrapper.
    louder = '`label`'
    rel = 'web/src/PriceList.tsx'

    code, out = bench.run('check-controls.py')
    expect('no control is announced as more than the source says it is',
           code, out, fires=False)

    bench.write(rel, bench.read(rel).replace('        aria-label={label}\n', '', 1))
    code, out = bench.run('check-controls.py')
    expect('the column picker left to be named by the label wrapped round it',
           code, out, fires=True, saying=louder)
    bench.restore(rel)

    code, out = bench.run('check-controls.py')
    expect('and quiet once the box is named outright again', code, out, fires=False)

    # 3. An excuse with no argument behind it. `controls-on-purpose.json` is
    #    the pressure valve on this check and therefore the way to make it
    #    meaningless. Four words is not a reason.
    rel = 'core/tools/controls-on-purpose.json'
    was = bench.read(rel)
    bench.write(rel, was.rstrip().rstrip('}').rstrip()
                + ',\n  "Never mind": "we might need it"\n}\n')
    code, out = bench.run('check-controls.py')
    expect('a control excused with four words instead of a reason', code, out,
           fires=True, saying='too thin to be one')
    bench.restore(rel)

    # 4. A real reason, on a control the audit drives after all. The entry is
    #    then a lie by omission -- it says nobody should reach this, while
    #    a11-work.mjs presses it -- and the file has to say so or it silently
    #    grows entries that mean nothing.
    bench.write(rel, was.rstrip().rstrip('}').rstrip()
                + ',\n  "Put it in the calendar": "A long and entirely '
                  'respectable sentence, written by somebody willing to sign '
                  'it, about a control that is in fact driven by a11-work.mjs."'
                  '\n}\n')
    code, out = bench.run('check-controls.py')
    expect('an excuse for a control the audit drives anyway', code, out,
           fires=True, saying='the excuse is spent')
    bench.restore(rel)


    # 4. A control whose own handler nothing can watch failing.
    #
    #    The blind spot this checker had for as long as it existed: a button
    #    inside a backdrop that closes on a tap is pressed by the audit, counted
    #    as driven, and its handler could be a no-op. That was measured -- a
    #    no-op left the whole suite green -- and written down in
    #    `a54-marks.mjs` as a thing no checker could see. It can be seen now.
    rel = 'web/src/DamagePhotos.tsx'
    was = bench.read(rel)
    bench.write(rel, was.replace(
        """            onClick={(event) => {""",
        """            onClick={() => {""", 1).replace(
        """              event.stopPropagation();
              setBig(false);""",
        """              setBig(false);""", 1))
    code, out = bench.run('check-controls.py')
    expect('a control inside a backdrop that does not stop the click', code, out,
           fires=True, saying='makes invisible')
    bench.restore(rel)

    code, out = bench.run('check-controls.py')
    expect('and quiet again once the click stops at the control', code, out, fires=False)


# ------------------------------------------------------------------ collapse

def collapse(bench: Bench) -> None:
    """A block a control opens that nothing on the screen shuts again.

    Sam: "WHEN YOU DROPDOWN ANY MENU, HAVE A WAY TO COLLAPSE THEM BACK." Six
    blocks opened together the moment "Change this wall" was tapped, the claim
    put fourteen boxes on the screen at once, and the rate book carried an
    eight-box form whether or not anybody was inventing an item. None of them
    folded.

    Six mutations, and every one of them is the undoing of a real fix. The
    first two are the wall panel's own way out, taken away and then made
    invisible; the third is the shape where a block folds only when the work
    lands, so a refusal leaves somebody holding a panel they cannot put down;
    the fourth is the opening row that opens and never shuts; the last two are
    the excuse file, which has to be as hard to satisfy as the check itself.

    The quiet state here IS silence -- `check-collapse.py` is green on the
    repository as it stands -- so an exit code answers each one.
    """
    print('check-collapse.py — a block that opens and will not fold back')

    code, out = bench.run('check-collapse.py')
    expect('says nothing about the repository as it stands', code, out, fires=False)

    # 1. The Done that shuts the wall panel, doing nothing instead.
    rel = 'web/src/Edit.tsx'
    bench.write(rel, bench.read(rel).replace(
        'onClick={() => setOpen(false)}', 'onClick={() => setName(name)}'))
    code, out = bench.run('check-collapse.py')
    expect('the way out of "Change this wall" taken away', code, out,
           fires=True, saying='nothing sets it back')
    bench.restore(rel)

    # 2. The same way out, on a <div>: it works, and nothing says it is there.
    bench.write(rel, bench.read(rel).replace(
        '''        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-11 shrink-0 text-sm text-slate-500 underline underline-offset-4"
        >
          Done
        </button>''',
        '''        <div
          onClick={() => setOpen(false)}
          className="min-h-11 shrink-0 text-sm text-slate-500 underline underline-offset-4"
        >
          Done
        </div>'''))
    code, out = bench.run('check-collapse.py')
    expect('that same way out turned into a div nothing announces', code, out,
           fires=True, saying='which nothing says is pressable')
    bench.restore(rel)

    # 3. Folded by the work landing rather than by anybody pressing anything,
    #    which is the state a refused save leaves somebody in.
    rel = 'web/src/Scope.tsx'
    was = bench.read(rel).replace(
        '  const [editing, setEditing] = useState(false);',
        '  const [editing, setEditing] = useState(false);\n'
        '  function finish() { setEditing(false); }')
    bench.write(rel, was.replace('onClick={() => setEditing(false)}', 'onClick={finish}'))
    code, out = bench.run('check-collapse.py')
    expect('the restoration rate sheet folding only inside a function', code, out,
           fires=True, saying='Folded only by the work landing')
    bench.restore(rel)

    # 4. The row that opens a door's sizes, with the toggle taken out of it.
    rel = 'web/src/Openings.tsx'
    bench.write(rel, bench.read(rel).replace(
        'setOpen(showing ? null : o.id)', 'setOpen(o.id)'))
    code, out = bench.run('check-collapse.py')
    expect('an opening row that opens and never shuts again', code, out,
           fires=True, saying='nothing sets it back')
    bench.restore(rel)

    # 5. An excuse with no argument behind it.
    rel = 'core/tools/collapse-on-purpose.json'
    was = bench.read(rel)
    bench.write(rel, was.rstrip().rstrip('}').rstrip()
                + ',\n  "web/src/Edit.tsx: open": "we might need it"\n}\n')
    code, out = bench.run('check-collapse.py')
    expect('a block excused with four words instead of a reason', code, out,
           fires=True, saying='too thin to be one')
    bench.restore(rel)

    # 6. A real reason, on a block that is not there any more.
    bench.write(rel, was.rstrip().rstrip('}').rstrip()
                + ',\n  "web/src/Nowhere.tsx: ghost": "A long and entirely '
                  'respectable sentence, written by somebody willing to sign it, '
                  'about a block that no longer exists anywhere in web/src."\n}\n')
    code, out = bench.run('check-collapse.py')
    expect('an excuse for a block nothing in web/src draws', code, out,
           fires=True, saying='delete the entry')
    bench.restore(rel)

    code, out = bench.run('check-collapse.py')
    expect('and quiet again once every one of them is put back', code, out, fires=False)


# ------------------------------------------------------------------ only once

def onlyOnce(bench: Bench) -> None:
    """Two stored properties of the same name in one type.

        ProjectsScreen.swift:39:24: error: invalid redeclaration of 'looking'

    `ProjectsScreen` already had `@State private var looking = ""` for the
    search box. A second `looking` was added thirty lines above it for
    something else, and both declarations read perfectly well on their own.

    The second case matters as much as the first: `RoomCard` has a `static let
    schema` and an instance `var schema`, which is legal Swift and deliberate.
    An earlier version of this checker counted them together and called a
    correct file a compile error.
    """
    print('check-swift-once.py — a stored property declared twice')

    code, out = bench.run('check-swift-once.py')
    expect('says nothing about the repository as it stands', code, out, fires=False)

    rel = 'ios/Trueline/ProjectsScreen.swift'
    bench.write(rel, bench.read(rel).replace(
        '@State private var askingICloud = false', '@State private var looking = false'))
    code, out = bench.run('check-swift-once.py')
    expect('the name put back the way the compiler refused it', code, out,
           fires=True, saying="declares `looking` twice")
    bench.restore(rel)

    code, out = bench.run('check-swift-once.py')
    expect('and a static beside an instance of the same name is left alone',
           code, out, fires=False)


def scanLifecycle(bench: Bench) -> None:
    """The four ways the scanner lost a scan on Sam's phone, 2026-08-27.

    None of these is a compile error and none is a wrong number, which is why
    all four reached a contractor standing in a kitchen. Each mutation below
    puts one of them back exactly as it was.
    """
    print('check-scan.py — a scanner that cannot finish a job')

    code, out = bench.run('check-scan.py')
    expect('says nothing about the scanner as it stands', code, out, fires=False)

    # 1. The black camera screen: a stored view handed to SwiftUI once.
    rel = 'ios/Trueline/ScanScreen.swift'
    was = bench.read(rel)
    bench.write(rel, was[:was.index('private struct CaptureViewport')] + (
        'private struct CaptureViewport: UIViewRepresentable {\n'
        '    let session: ScanSession\n'
        '\n'
        '    func makeUIView(context: Context) -> RoomCaptureView { session.captureView }\n'
        '    func updateUIView(_ view: RoomCaptureView, context: Context) {}\n'
        '}\n'))
    code, out = bench.run('check-scan.py')
    expect('a viewport that hands over a stored view and never swaps it',
           code, out, fires=True, saying='hands SwiftUI a view it was given')
    bench.restore(rel)

    # 2. "IT SAYS THERE WAS A LOT OF PICS THERE": the count from the last room.
    rel = 'ios/Trueline/ScanSession.swift'
    bench.write(rel, bench.read(rel).replace('        photoCount = 0\n', '', 1))
    code, out = bench.run('check-scan.py')
    expect('reset() leaving photoCount holding the last scan total', code, out,
           fires=True, saying='publishes `photoCount` and reset() never puts it back')
    bench.restore(rel)

    # 3. The square blueprint: a room stored without asking whose session it is.
    was = bench.read(rel)
    bench.write(rel, was.replace(
        '                guard self.isLive(session) else { return }\n'
        '                self.finished = room\n',
        '                self.finished = room\n'))
    code, out = bench.run('check-scan.py')
    expect('didEndWith storing a room from a session that may be over', code, out,
           fires=True, saying='without asking whose scan it is')
    bench.restore(rel)

    # 4. "THERES NO PICS THERE": the move whose error was swallowed.
    rel = 'ios/Trueline/ScanModel.swift'
    was = bench.read(rel)
    bench.write(rel, was.replace(
        '            let lost = CaptureWriter.placePhotographs(\n'
        '                from: scratch.appendingPathComponent("photos", isDirectory: true),\n'
        '                into: folder,\n'
        '                listed: recorder.records.map { $0.fileName }\n'
        '            )\n'
        '            if !lost.isEmpty {\n'
        '                session.reportFailure(CaptureWriter.saying(lost: lost, stillIn: scratch))\n'
        '            }\n'
        '            store.refresh()\n',
        '            try? FileManager.default.moveItem(\n'
        '                at: scratch.appendingPathComponent("photos"),\n'
        '                to: folder.appendingPathComponent("photos")\n'
        '            )\n'
        '            store.refresh()\n'))
    code, out = bench.run('check-scan.py')
    expect('save() carrying the photographs across with try?', code, out,
           fires=True, saying='a photograph is moved with `try?`')
    bench.restore(rel)

    # 5. "A GENERIC SQUARE BLUEPRINT AND 3D", 2026-08-28: the garage that came
    #    back as somebody else's room. `title` crosses the bridge as `fileName`
    #    and `fileName` is the key the web half files the room under, so a scan
    #    filed under the typed name shares a key with every other scan of that
    #    name -- and the same folder reached from the Rooms list comes over
    #    under a different name again.
    rel = 'ios/Trueline/ScanModel.swift'
    bench.write(rel, bench.read(rel).replace(
        '                title: written.folder.lastPathComponent,',
        '                title: name,'))
    code, out = bench.run('check-scan.py')
    expect('a scan filed under the name somebody typed rather than its folder',
           code, out, fires=True, saying='not as its folder')
    bench.restore(rel)

    # 6. The other half of the same report: a capture written into a folder
    #    that already holds one, which inherits its corrected.json -- and a
    #    corrected room outranks a capture all the way to the screen.
    bench.write(rel, bench.read(rel).replace(
        'let folder = store.freeFolder(named: CaptureWriter.folderName',
        'let folder = store.folder(named: CaptureWriter.folderName'))
    code, out = bench.run('check-scan.py')
    expect('a capture given a folder that may already hold one', code, out,
           fires=True, saying='already hold one')
    bench.restore(rel)

    # And the same two in the walk and the drawing, which had them too and
    # which nothing had looked at until this check was written.
    for other, line in [
        ('ios/Trueline/ARMeasureModel.swift', 'a walk'),
        ('ios/Trueline/DrawScreen.swift', 'a drawing'),
    ]:
        bench.write(other, bench.read(other).replace(
            'let folder = store.freeFolder(named: CaptureWriter.folderName',
            'let folder = store.folder(named: CaptureWriter.folderName'))
        code, out = bench.run('check-scan.py')
        expect(f'{line} written into a folder that may already hold one', code, out,
               fires=True, saying='already hold one')
        bench.restore(other)

    code, out = bench.run('check-scan.py')
    expect('and quiet again on all six once they are fixed', code, out, fires=False)


def bashThirtyTwo(bench: Bench) -> None:
    print('check-bash32.py — the bash that macOS does not have')

    code, out = bench.run('check-bash32.py')
    expect('says nothing about the repository as it stands', code, out, fires=False)

    # 1. The line `install-command.sh` was actually written with, on 2026-08-28.
    #    bash 5 runs it. The 3.2 macOS ships dies parsing the file, so the
    #    script that exists to make the build reachable would have produced no
    #    output at all on the only machine it was ever going to run on.
    rel = 'install-command.sh'
    was = bench.read(rel)
    broken = was.replace('"  local root=$quoted_root"', '"  local root=${root@Q}"')
    assert broken != was, 'the line check-bash32 was written for is not there any more'
    bench.write(rel, broken)
    code, out = bench.run('check-bash32.py')
    expect('${root@Q} back in install-command.sh', code, out,
           fires=True, saying='install-command.sh')
    bench.restore(rel)

    # 2. A different construct, in a different file, so the checker is not
    #    trusted on the strength of one pattern out of thirteen.
    rel = 'build.sh'
    was = bench.read(rel)
    bench.write(rel, was.replace('pull=yes', 'declare -A seen\npull=yes', 1))
    code, out = bench.run('check-bash32.py')
    expect('an associative array in build.sh', code, out,
           fires=True, saying='associative array')
    bench.restore(rel)

    # 3. Naming one in prose must stay quiet -- `install-command.sh` explains in
    #    a comment why it does not use `${root@Q}`, and a checker that cannot
    #    tell an explanation from a use makes the explanation unwritable.
    rel = 'build.sh'
    was = bench.read(rel)
    bench.write(rel, '# ${v@Q} and declare -A are bash 4, so they are not used.\n' + was)
    code, out = bench.run('check-bash32.py')
    expect('the same things named in a comment', code, out, fires=False)
    bench.restore(rel)

    code, out = bench.run('check-bash32.py')
    expect('quiet again once the files are put back', code, out, fires=False)


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        bench = Bench(Path(tmp))
        swiftNames(bench)
        print()
        doors(bench)
        print()
        bridge(bench)
        print()
        controls(bench)
        print()
        collapse(bench)
        print()
        pbxproj(bench)
        print()
        xcscheme(bench)
        print()
        portable(bench)
        print()
        conformance(bench)
        print()
        awaiting(bench)
        print()
        arguments(bench)
        print()
        paywall(bench)
        print()
        onlyOnce(bench)
        print()
        scanLifecycle(bench)
        print()
        bashThirtyTwo(bench)

    print()
    if failures:
        print(f'{RED}{len(failures)} check(s) did not do what they claim.{OFF}')
        print('A checker that goes green on a file broken on purpose is worse than')
        print('no checker: it is a reason to stop looking.')
        return 1
    print(f'{GREEN}Every checker was watched failing on a real mistake, '
          f'and going quiet when it was fixed.{OFF}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
