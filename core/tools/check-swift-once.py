#!/usr/bin/env python3
"""Two properties of the same name in one type.

    python3 core/tools/check-swift-once.py [root]

## The build error this is the answer to

    ios/Trueline/ProjectsScreen.swift:39:24: error: invalid redeclaration of 'looking'

`ProjectsScreen` already had `@State private var looking = ""` -- the search
box's text. A second `@State private var looking = false` was added thirty
lines above it for something else entirely, and the file reads top to bottom
perfectly well: the two declarations are far enough apart that nothing about
either one looks wrong.

There is no Swift compiler on the machine this is written on, so it went to
Sam's Mac.

## What it checks

Every `struct`, `class`, `enum` and `extension` under `ios/`, for two stored
properties declared with the same name at the same level. Nested types are
their own scope and are not confused with their parent's.

## What it does not check

Computed properties, functions and initialisers -- Swift allows overloads of
those and telling a legal overload from a redeclaration needs type information
this cannot see. Stored properties cannot be overloaded at all, which is what
makes them checkable with certainty.
"""
import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[2]
IOS = ROOT / 'ios'

COMMENT = re.compile(r'//[^\n]*')
STRING = re.compile(r'"(?:[^"\\\n]|\\.)*"')
DECL = re.compile(
    r'\b(?:struct|class|enum|extension|actor)\s+(\w+)[^{\n]*\{')
# A stored property: `let x` / `var x` with a type or a value, and NOT followed
# by a `{`, which would make it computed.
STORED = re.compile(
    r'^[ \t]*(?:@\w+(?:\([^)]*\))?\s+)*'
    r'(?:public |internal |private(?:\(set\))? |fileprivate |weak |unowned |lazy )*'
    r'(static\s+)?(let|var)\s+(\w+)\s*(?::[^=\n{]+)?(?:=[^\n]*)?$',
    re.M)


def scrub(source: str) -> str:
    def blank(m: re.Match) -> str:
        return ' ' * (m.end() - m.start())
    return STRING.sub(blank, COMMENT.sub(blank, source))


def bodyOf(text: str, brace_at: int) -> tuple[str, int]:
    depth = 0
    for i in range(brace_at, len(text)):
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
            if depth == 0:
                return text[brace_at + 1:i], i
    return text[brace_at + 1:], len(text)


def main() -> int:
    bad: list[str] = []
    types = 0

    for path in sorted(IOS.rglob('*.swift')):
        raw = path.read_text(encoding='utf-8')
        text = scrub(raw)
        for match in DECL.finditer(text):
            body, _ = bodyOf(text, text.index('{', match.end() - 1))
            # This type's OWN level: a nested type's properties are its own
            # scope, and `{ ... }` removal takes those and every closure with
            # them. Two passes, because a nested type can itself nest.
            own = body
            for _ in range(4):
                shorter = re.sub(r'\{[^{}]*\}', '', own)
                if shorter == own:
                    break
                own = shorter
            types += 1
            # Static and instance are DIFFERENT scopes in Swift, and this
            # project uses that deliberately: `RoomCard` has a `static let
            # schema` holding the version string and a `var schema` holding
            # this card's copy of it. Counting them together reported a
            # perfectly legal pair as a compile error, which is the one thing a
            # checker must never do.
            seen: dict[tuple[bool, str], int] = {}
            for prop in STORED.finditer(own):
                name = (prop.group(1) is not None, prop.group(3))
                if name in seen:
                    line = raw[:match.start()].count('\n') + 1
                    bad.append(
                        f'{path.relative_to(ROOT)}:{line}  {match.group(1)} declares '
                        f'`{name[1]}` twice.\n'
                        f'      Stored properties cannot be overloaded. This is '
                        f'"invalid redeclaration".')
                else:
                    seen[name] = 1

    if bad:
        print('A type that declares the same stored property twice:\n')
        for one in sorted(set(bad)):
            print(f'  {one}\n')
        print('This is a compile error. It is the shape of the one that reached')
        print("Sam's Mac: ProjectsScreen already had a `looking` for the search box,")
        print('and a second one was added thirty lines above it for something else.')
        return 1

    print(f'{types} Swift types: no stored property declared twice in any of them')
    return 0


if __name__ == '__main__':
    sys.exit(main())
