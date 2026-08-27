#!/usr/bin/env python3
"""A type that says it is Hashable, holding something that is not.

    python3 core/tools/check-swift-conform.py

## The build error this is the answer to

    ios/Trueline/ProjectStore.swift:15:12: error: type 'ProjectStore.Entry'
    does not conform to protocol 'Hashable'

`ProjectStore.Entry` is what `NavigationLink(value:)` carries, so it has to
hash. Swift SYNTHESISES that conformance -- but only when every stored property
already has it. `Entry` grew a `card: RoomCard`, `RoomCard` was declared
`Codable, Equatable`, and the synthesis quietly stopped being possible. One
word missing in one file, three files away from the error.

Nothing here could catch it. There is no Swift compiler on the machine this
project is written on, `check-swift.py` reads the grammar, and
`check-swift-names.py` finds names that do not exist -- and every name in this
one existed. It reached Sam's Mac, which is the only compiler this project has.

## What it checks

For every `struct` or `enum` in `ios/` that lists `Hashable`, `Equatable`,
`Codable`, `Encodable` or `Decodable` and does NOT write the requirement by
hand, every stored property's type must have that conformance too.

## What it deliberately does not do

It only complains about a property whose type is declared **in this
repository** and demonstrably lacks the conformance. A type from Foundation,
SwiftUI or ARKit is counted as unchecked and reported as a number, never as a
failure: guessing at what Apple's types conform to would produce noise, and a
checker people learn to ignore is worse than no checker.

So the number it prints is the honest one -- properties it could actually
decide about -- and it is the shape of the real bug: our own type, our own
missing word.
"""
import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[2]
IOS = ROOT / 'ios'

# Conformances that Swift synthesises, and what writing one by hand looks like.
SYNTHESISED = {
    'Hashable': ('func hash(into', 'static func ==', 'func ==('),
    'Equatable': ('static func ==', 'func ==('),
    'Encodable': ('func encode(to',),
    'Decodable': ('init(from',),
}
# Codable is both, and is spelled as one word.
BOTH = {'Codable': ('Encodable', 'Decodable'), 'Hashable': ('Hashable', 'Equatable')}

# Standard library and Foundation types that have all of the above.
KNOWN_GOOD = {
    'String', 'Int', 'Int8', 'Int16', 'Int32', 'Int64', 'UInt', 'UInt8', 'UInt16',
    'UInt32', 'UInt64', 'Double', 'Float', 'CGFloat', 'Bool', 'Date', 'URL', 'UUID',
    'Data', 'TimeInterval', 'Character', 'Decimal', 'IndexPath', 'DateComponents',
    'Locale', 'TimeZone', 'Measurement', 'PersonNameComponents', 'CGPoint', 'CGSize',
    'CGRect', 'CGVector',
}

COMMENT = re.compile(r'//[^\n]*')
# A declaration and the names after its colon, up to the opening brace.
DECL = re.compile(
    r'^(?P<indent>[ \t]*)(?:public |internal |private |fileprivate |final |@\w+\s+)*'
    r'(?P<kind>struct|enum|class)\s+(?P<name>\w+)\s*(?::(?P<conforms>[^{]*))?\{',
    re.M)
# A stored property. `var x: T {` is computed and does not count.
STORED = re.compile(
    r'^[ \t]*(?:@\w+(?:\([^)]*\))?\s+)*'
    r'(?:public |internal |private(?:\(set\))? |fileprivate |weak |unowned )*'
    r'(?P<let>let|var)\s+(?P<name>\w+)\s*:\s*(?P<type>[^=\n{]+?)\s*(?:=[^\n]*)?$',
    re.M)
STATIC = re.compile(r'^[ \t]*(?:public |private |internal )*static\b', re.M)


def strip(source: str) -> str:
    """Comments out, so a conformance named in prose is not a conformance."""
    return COMMENT.sub('', source)


def bodyOf(source: str, brace_at: int) -> str:
    """From the opening brace to its match."""
    depth = 0
    for i in range(brace_at, len(source)):
        if source[i] == '{':
            depth += 1
        elif source[i] == '}':
            depth -= 1
            if depth == 0:
                return source[brace_at + 1:i]
    return source[brace_at + 1:]


def bare(kind: str) -> list[str]:
    """The type names inside a written type, with the wrappers taken off.

    `[String: RoomCard]?` is two names. `Set<Entry>` is one. An unwrapping that
    misses something is fine -- what comes out is looked up, and a name that is
    not one of ours is counted as unchecked.
    """
    text = kind.strip().rstrip('?!')
    text = re.sub(r'^\s*(?:Set|Array|Optional|Dictionary)\s*<(.*)>\s*$', r'\1', text)
    text = text.strip()
    if text.startswith('[') and text.endswith(']'):
        text = text[1:-1]
    names = []
    for piece in re.split(r'[,:<>\[\]]', text):
        piece = piece.strip()
        if not piece:
            continue
        # `ProjectStore.Entry` is looked up under `Entry`, which is how the
        # declarations below are keyed. Two nested types sharing a short name
        # would confuse this, and there are none.
        names.append(piece.split('.')[-1])
    return names


def declarations() -> dict[str, dict]:
    """Every type declared under ios/, with what it claims and what it holds."""
    found: dict[str, dict] = {}
    for path in sorted(IOS.rglob('*.swift')):
        raw = path.read_text(encoding='utf-8')
        source = strip(raw)
        for match in DECL.finditer(source):
            name = match.group('name')
            conforms = {c.strip() for c in (match.group('conforms') or '').split(',') if c.strip()}
            body = bodyOf(source, source.index('{', match.end() - 1))
            # Only this type's own level: a nested type's properties are its own.
            own = re.sub(r'\{[^{}]*\}', '', body)
            props = []
            for prop in STORED.finditer(own):
                line = own[own.rfind('\n', 0, prop.start()) + 1:prop.end()]
                if STATIC.match(line):
                    continue
                props.append((prop.group('name'), prop.group('type')))
            found[name] = {
                'file': str(path.relative_to(ROOT)),
                'line': source[:match.start()].count('\n') + 1,
                'kind': match.group('kind'),
                'conforms': conforms,
                'body': body,
                'props': props,
                'payloads': re.findall(r'^\s*case\s+\w+\((.*?)\)\s*$', body, re.M),
            }
    return found


def has(name: str, want: str, decls: dict[str, dict]) -> bool | None:
    """True, False, or None for a type this cannot decide about."""
    if name in KNOWN_GOOD:
        return True
    decl = decls.get(name)
    if decl is None:
        return None
    claimed = set(decl['conforms'])
    for word, gives in BOTH.items():
        if word in claimed:
            claimed.update(gives)
    if want in claimed:
        return True
    # An enum with no stored properties and no payloads is Hashable/Equatable
    # for free, whether or not it says so.
    if decl['kind'] == 'enum' and not decl['props'] and not decl['payloads']:
        return want in ('Hashable', 'Equatable') or want in claimed
    return False


def main() -> int:
    decls = declarations()
    bad: list[str] = []
    decided = 0
    unknown = 0

    for name, decl in sorted(decls.items()):
        claimed = set(decl['conforms'])
        for word, gives in BOTH.items():
            if word in claimed:
                claimed.update(gives)

        for want, byHand in SYNTHESISED.items():
            if want not in claimed:
                continue
            if any(mark in decl['body'] for mark in byHand):
                continue  # written by hand; nothing to synthesise
            held = [(p, t) for p, t in decl['props']]
            for payload in decl['payloads']:
                for piece in payload.split(','):
                    held.append((f'associated value', piece.split(':')[-1]))
            for prop, kind in held:
                for inner in bare(kind):
                    answer = has(inner, want, decls)
                    if answer is None:
                        unknown += 1
                        continue
                    decided += 1
                    if not answer:
                        where = decls[inner]
                        bad.append(
                            f"{decl['file']}:{decl['line']}  {name} says it is {want}, "
                            f"but holds `{prop}: {kind}`\n"
                            f"      and {inner} ({where['file']}) is not {want}. "
                            f"Swift will refuse to synthesise it."
                        )

    if bad:
        print('A type that claims a conformance Swift cannot synthesise for it:\n')
        for one in sorted(set(bad)):
            print(f'  {one}\n')
        print('This is a compile error, and it is the shape of the one that reached')
        print("Sam's Mac: ProjectStore.Entry grew a RoomCard, RoomCard was only")
        print('Equatable, and the entry stopped conforming three files away.')
        return 1

    print(f'{len(decls)} Swift types: every synthesised conformance holds '
          f'({decided} properties decided, {unknown} from outside this repo not checked)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
