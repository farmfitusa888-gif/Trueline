#!/usr/bin/env python3
"""Parses every Swift file with a real Swift grammar and reports syntax errors.

    python3 core/tools/check-swift.py [file ...]

## Why this exists

There is no Swift compiler on the machine this project is written on, and
`download.swift.org` is refused by this network's egress policy, so one cannot
be installed. Every Swift change therefore reached a Mac unparsed, and the
first thing that found a typo was a person plugging in a phone.

tree-sitter's Swift grammar is not a compiler. It cannot tell you that a method
does not exist, that a type does not match, or that an API was renamed in iOS
18 -- Xcode is still the first real compiler this code meets, and that is said
plainly rather than implied away. What it *can* do is refuse a file that is not
Swift: an unbalanced brace, a malformed expression, a `func` with no body, a
string that never closes. That is the whole class of mistake a scripted edit
makes, and it is the class that was reaching the Mac.

## What a failure looks like

The grammar reports an ERROR node at the point it gave up. The line and column
are where the parse broke, which is usually where the mistake is and sometimes
just after it.

## The gaps

The grammar rejects a few things that are valid Swift -- `switch try await x()`,
`if let y = try? await z()`, a nil-coalesced optional cast inside a `guard`.
One file uses all three, and one bad construct throws the parser off for the
rest of the file, so the errors cascade onto ordinary lines like `} else {`.

Two bad answers were considered and rejected. Rewriting the Swift to please the
parser makes working code worse to make a tool quieter. Excusing the reported
*lines* would excuse `} else {` everywhere in the project, which is no checker
at all.

So a file may be excused **by the hash of its contents**, recorded in
swift-parse-gaps.json. The moment anybody edits that file the hash stops
matching and it has to parse or be looked at again deliberately. Every other
file is checked with nothing excused.
"""
import hashlib
import sys
import os
from pathlib import Path

try:
    from tree_sitter import Language, Parser
    import tree_sitter_swift
except ImportError:
    print('The Swift grammar is not installed here, so nothing was checked.')
    print('  pip install tree_sitter tree_sitter_swift')
    # Exit 2, not 0. A missing checker is not a passing check, and reporting it
    # as one is worse than having no checker at all -- setup-mac.sh said "every
    # file parses" on a Mac that had never parsed a thing.
    sys.exit(2)

import json

ROOT = Path(__file__).resolve().parents[2]
SWIFT = ROOT / 'ios' / 'Trueline'
GAPS = Path(__file__).resolve().parent / 'swift-parse-gaps.json'


def problems(tree, source):
    """Every ERROR and MISSING node, innermost first."""
    found = []
    stack = [tree.root_node]
    while stack:
        node = stack.pop()
        if node.type == 'ERROR' or node.is_missing:
            line, col = node.start_point
            text = source.split(b'\n')[line].decode('utf8', 'replace').strip()
            found.append((line + 1, col + 1, 'missing' if node.is_missing else 'error', text))
        stack.extend(node.children)
    return sorted(found)


def main(argv):
    parser = Parser(Language(tree_sitter_swift.language()))
    files = [Path(a) for a in argv] or sorted(SWIFT.glob('*.swift'))
    if not files:
        print(f'No Swift files found under {SWIFT}')
        return 1

    known = json.loads(GAPS.read_text()) if GAPS.exists() else {}

    bad = 0
    excused = []
    for path in files:
        source = path.read_bytes()
        entry = known.get(path.name)
        if entry and entry['sha256'] == hashlib.sha256(source).hexdigest():
            excused.append(f"{path.name} ({entry['why']})")
            continue
        found = problems(parser.parse(source), source)
        if not found:
            continue
        if entry:
            print(f'{path.name} has been edited since it was excused, and still '
                  'does not parse. Either the edit is wrong, or the gap note in '
                  'swift-parse-gaps.json needs its hash updating after somebody '
                  'has read the file.')
        bad += 1
        rel = os.path.relpath(path, ROOT)
        for line, col, kind, text in found[:6]:
            print(f'{rel}:{line}:{col}: {kind} — {text[:100]}')
        if len(found) > 6:
            print(f'  ... and {len(found) - 6} more in this file')

    if bad:
        print()
        print(f'{bad} of {len(files)} Swift files did not parse.')
        print('This is a grammar, not a compiler: it says the file is not Swift,')
        print('not that the code is wrong. Xcode is still the first real compiler.')
        return 1

    for one in excused:
        print(f'  excused, unchanged since it was read: {one}')
    print(f'{len(files) - len(excused)} of {len(files)} Swift files parse')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
