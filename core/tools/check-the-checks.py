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


def expect(what: str, code: int, output: str, *, fires: bool, saying: str = '') -> None:
    """A checker must have complained, and must have said the right thing."""
    wrong = []
    if fires and code == 0:
        wrong.append('it passed, and the file was broken on purpose')
    if not fires and code != 0:
        wrong.append(f'it complained about a file that is correct:\n{output.strip()}')
    if fires and saying and saying not in output:
        wrong.append(f'it complained, but never said {saying!r}. It said:\n{output.strip()}')
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


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        bench = Bench(Path(tmp))
        swiftNames(bench)
        print()
        doors(bench)
        print()
        pbxproj(bench)
        print()
        xcscheme(bench)
        print()
        portable(bench)

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
