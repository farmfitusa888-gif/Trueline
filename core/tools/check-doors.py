#!/usr/bin/env python3
"""Every screen the app can show has something that opens it.

    python3 core/tools/check-doors.py

## The bug this is the answer to, three times over

Three times now this project has finished a screen, tested it, documented it,
and shipped it with no way to reach it on a phone.

  * The parts of a room -- the takeoff, the proposal, the claim -- were all
    below the fold of one long column. `Sections.tsx` gave them a tab bar.
  * The floor and the contractor's own business details were behind links
    inside a *scan's* page: *"have to go through a project to get to the
    options"*. `RootTabs.swift` made them tabs.
  * Drawing a room by tapping its corners onto a grid -- `Sketch.tsx`, unit
    tested, driven in a real browser by `web/audit/a3-draw.mjs`, written up in
    the handbook -- could be opened exactly one way: start a scan, let it fail,
    open the dead capture, and take one of the ways out of it. A way out is not
    a way in.

The lesson each time is the same sentence: **work that is finished and
unreachable is indistinguishable from work that was never done.** The third time
it happened, this was written.

## What it checks, exactly

Two enums decide what the iOS app can put on the screen:

  * `CorrectView.Opening` -- which screen the web bundle is loaded on.
  * `ProjectsScreen.Route` -- what the Rooms tab can push.

For each case of each, this asks two questions of the whole `ios/` tree:

  1. **Is there a door?** Something, somewhere, that names this case outside its
     own declaration. A route nothing constructs is a screen nobody can get to.
  2. **Is there a room behind it?** For `Route`, a matching `case` in the
     `navigationDestination` switch. A door onto nothing is worse than no door.

## What it does NOT check, and this matters

It cannot tell you that a screen written in `web/` has no route at all -- which
is the exact shape the third bug took, because `draw` was not a case until it
was fixed. Nothing mechanical can: the web bundle's screens are decided by React
state, not by an enum. What this does is stop a route that exists from losing
its door, or being added and never wired -- which is how the first two happened
and how the third would come back.

The check that a *person* can reach the grid is `web/audit/a19-money.mjs`, and
it is a check that drives a browser rather than reads a file. Both are needed.
"""
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# The enums that decide what can be on screen, and where each is declared.
ROUTES = [
    ('CorrectView.Opening', 'ios/Trueline/CorrectView.swift', 'Opening'),
    ('ProjectsScreen.Route', 'ios/Trueline/ProjectsScreen.swift', 'Route'),
]

COMMENT = re.compile(r'//[^\n]*')


def strip(source: str) -> str:
    """Comments out, so a case named only in a comment is not a door.

    The whole value of this check is that it does not count prose. Every one of
    these files explains its routes at length; a checker that reads those
    paragraphs as evidence would pass the day the code was deleted.
    """
    return COMMENT.sub('', source)


def bodyOf(source: str, start: int) -> str | None:
    """The braces of the declaration beginning at `start`."""
    open_at = source.find('{', start)
    if open_at < 0:
        return None
    depth = 0
    for at in range(open_at, len(source)):
        if source[at] == '{':
            depth += 1
        elif source[at] == '}':
            depth -= 1
            if depth == 0:
                return source[open_at + 1:at]
    return None


def casesOf(source: str, enum: str) -> list[str]:
    """Every case name in `enum`, in the order it is declared."""
    found = re.search(rf'\benum\s+{re.escape(enum)}\b', source)
    if not found:
        return []
    body = bodyOf(source, found.end())
    if body is None:
        return []
    names: list[str] = []
    for line in body.split('\n'):
        line = line.strip()
        if not line.startswith('case '):
            continue
        # `case newScan`, `case room = ""`, `case open(ProjectStore.Entry)`,
        # and `case a, b` all in one pass.
        for part in line[len('case '):].split(','):
            name = re.match(r'\s*([A-Za-z_][A-Za-z0-9_]*)', part)
            if name:
                names.append(name.group(1))
    return names


def opened(everywhere: str, declaredIn: str, enum: str, case: str) -> bool:
    """Whether anything outside the declaration actually opens this case.

    A door is the case in **value position** — `path = [.newDraw]`,
    `NavigationLink(value: Route.newDraw)`, `WebScreen(opensOn: .draw)`. Three
    kinds of mention are deliberately not doors, and each of them made this
    check go green on a file that had been broken on purpose:

      * the enum's own body, or every case would be its own door;
      * `case .newDraw:` in the destination switch, which is the room, not the
        way in — cutting the door out of `ProjectsScreen` and leaving the switch
        alone passed the first version of this;
      * `opensOn == .floor`, which asks which screen this is rather than opening
        one.

    And it is the **leading dot** that is searched for, or the enum's own name
    in front — `.draw`, `Opening.draw` — never the bare word. `Opening` has a
    case called `draw`, and `ios/` also holds `scene.draw(corners:)`,
    `NSString.draw(at:)` and the sentence "Or draw one above". Matching a bare
    word found all three and called the route reachable with its only door
    deleted.
    """
    found = re.search(rf'\benum\s+{re.escape(enum)}\b', declaredIn)
    body = bodyOf(declaredIn, found.end()) if found else None
    outside = everywhere.replace(body, '') if body else everywhere
    # `.case` where the dot leads (nothing but an operator or a bracket in front
    # of it), or `Enum.case` written out in full.
    door = re.compile(
        rf'(?:(?<![A-Za-z0-9_)\]])\.|\b{re.escape(enum)}\.){re.escape(case)}\b'
    )
    for at in door.finditer(outside):
        before = outside[max(0, at.start() - 24):at.start()]
        if re.search(r'\bcase\s+$', before):
            continue        # a pattern in a switch: the room, not the door
        if re.search(r'[=!]=\s*$', before):
            continue        # a comparison: asking, not opening
        return True
    return False


def handled(source: str, case: str) -> bool:
    """Whether the destination switch has a branch for this route."""
    return re.search(rf'case\s+\.{re.escape(case)}\b', source) is not None


def main(argv: list[str]) -> int:
    bad = 0
    everywhere = '\n'.join(
        strip(p.read_text(encoding='utf-8'))
        for p in sorted((ROOT / 'ios').rglob('*.swift'))
    )

    total = 0
    for label, rel, enum in ROUTES:
        path = ROOT / rel
        if not path.exists():
            print(f'{rel} is missing, so {label} cannot be checked')
            return 1
        source = strip(path.read_text(encoding='utf-8'))
        cases = casesOf(source, enum)
        if not cases:
            print(f'{rel}: no `enum {enum}` with any cases in it')
            return 1
        total += len(cases)

        for case in cases:
            if not opened(everywhere, source, enum, case):
                bad += 1
                print(f'{rel}: `{label}.{case}` has no door — nothing in ios/ opens it')
                print('    A screen nobody can reach is indistinguishable from one that')
                print('    was never written. Give it a button, or delete the case.')
            # Only the pushed routes have a destination switch behind them; the
            # openings are a URL fragment and the web bundle decides the rest.
            if enum == 'Route' and not handled(source, case):
                bad += 1
                print(f'{rel}: `{label}.{case}` has a door onto nothing — no branch '
                      'in navigationDestination')

    if bad:
        print()
        print(f'{bad} route(s) with no way in or no screen behind them.')
        return 1
    print(f'{total} routes: every one of them has something that opens it, '
          'and something behind it')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
