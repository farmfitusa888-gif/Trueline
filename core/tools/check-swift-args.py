#!/usr/bin/env python3
"""A call that does not pass what the function it calls requires.

    python3 core/tools/check-swift-args.py [root]

## The build error this is the answer to

    ios/Trueline/DrawScreen.swift:168:116: error: missing argument for
                                          parameter 'card' in call

`Backup.push` gained a `card:` parameter so a room restored on a second phone
would remember its own name. Two places call it. One was updated. The other --
the drawn-room path, in a different file, on a line long enough that the end of
it runs off the screen -- was not.

`check-swift-names.py` reads memberwise initialisers and passed this: `push` is
an ordinary method, and nothing was reading ordinary methods' arguments. There
is no Swift compiler on the machine this is written on, so it reached Sam's Mac
like the four before it.

## What it checks

Every `func` declared under `ios/`, and every call to one. A call must pass
every parameter that has no default, in the order they are declared.

## How it avoids saying anything it cannot be sure of

A method name here can be a method name in Foundation, SwiftUI or CloudKit,
none of which this machine can read. So a call is only checked when **every
label it passes is a label the local declaration has**. `push(scan:capture:...)`
is unmistakably ours; `push()` on somebody else's array is not, and is skipped.
Calls with no labels at all are skipped for the same reason -- which loses some
coverage, and is the price of never crying wolf.

Overloaded names are checked against every declaration and pass if they satisfy
any one of them.
"""
import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[2]
IOS = ROOT / 'ios'

COMMENT = re.compile(r'//[^\n]*')
STRING = re.compile(r'"(?:[^"\\\n]|\\.)*"')
FUNC = re.compile(r'\bfunc\s+(\w+)\s*(?:<[^>]*>)?\s*\(')


def scrub(source: str) -> str:
    """Comments and string bodies blanked, positions kept."""
    def blank(m: re.Match) -> str:
        return ' ' * (m.end() - m.start())
    return STRING.sub(blank, COMMENT.sub(blank, source))


def closeOf(text: str, open_at: int) -> int:
    pairs = {'(': ')', '[': ']', '{': '}'}
    want = pairs[text[open_at]]
    depth = 0
    for i in range(open_at, len(text)):
        if text[i] in pairs:
            depth += 1
        elif text[i] in ')]}':
            depth -= 1
            if depth == 0:
                return i if text[i] == want else -1
    return -1


def topLevel(text: str) -> list[str]:
    """Split on commas that are not inside brackets."""
    parts, depth, start = [], 0, 0
    for i, ch in enumerate(text):
        if ch in '([{':
            depth += 1
        elif ch in ')]}':
            depth -= 1
        elif ch == ',' and depth == 0:
            parts.append(text[start:i])
            start = i + 1
    parts.append(text[start:])
    return [p for p in (p.strip() for p in parts) if p]


PARAM = re.compile(r'^(?:@\w+(?:\([^)]*\))?\s+)*(\w+|_)(?:\s+(\w+))?\s*:')


def declarations() -> dict[str, list[dict]]:
    """Every func declared under ios/: its labels, and which are required."""
    found: dict[str, list[dict]] = {}
    for path in sorted(IOS.rglob('*.swift')):
        text = scrub(path.read_text(encoding='utf-8'))
        for match in FUNC.finditer(text):
            open_at = text.index('(', match.end() - 1)
            close = closeOf(text, open_at)
            if close < 0:
                continue
            labels, required = [], []
            for param in topLevel(text[open_at + 1:close]):
                shape = PARAM.match(param)
                if not shape:
                    labels, required = [], []
                    break
                outer, inner = shape.group(1), shape.group(2)
                # `outer inner: Type` -- outer is the label. `name: Type` --
                # the one name is both. `_ name: Type` -- no label at all.
                label = outer if inner else outer
                if outer == '_':
                    label = None
                # A default makes the argument optional at the call site.
                after = param[shape.end():]
                hasDefault = '=' in after and after.split('=')[0].count('(') == \
                    after.split('=')[0].count(')')
                if label:
                    labels.append(label)
                    if not hasDefault:
                        required.append(label)
            found.setdefault(match.group(1), []).append({
                'labels': labels,
                'required': required,
                'file': str(path.relative_to(ROOT)),
                'line': text[:match.start()].count('\n') + 1,
            })
    return found


def labelsIn(text: str) -> list[str]:
    """The argument labels a call passes, at its own top level."""
    out, depth, expect = [], 0, True
    i = 0
    while i < len(text):
        ch = text[i]
        if ch in '([{':
            depth += 1
            expect = False
        elif ch in ')]}':
            depth -= 1
        elif ch == ',' and depth == 0:
            expect = True
        elif depth == 0 and expect and (ch.isalpha() or ch == '_'):
            word = re.match(r'\w+', text[i:])
            after = text[i + word.end():].lstrip()
            if after.startswith(':') and not after.startswith('::'):
                out.append(word.group(0))
            expect = False
            i += word.end()
            continue
        elif depth == 0 and not ch.isspace():
            expect = False
        i += 1
    return out


def main() -> int:
    decls = declarations()
    bad: list[str] = []
    checked = 0

    for path in sorted(IOS.rglob('*.swift')):
        raw = path.read_text(encoding='utf-8')
        text = scrub(raw)
        for name, shapes in decls.items():
            for hit in re.finditer(r'(?<![\w])' + re.escape(name) + r'\s*\(', text):
                head = text[text.rfind('\n', 0, hit.start()) + 1:hit.start()]
                if re.search(r'\bfunc\s+$', head):
                    continue
                open_at = text.index('(', hit.start())
                close = closeOf(text, open_at)
                if close < 0:
                    continue
                passed = labelsIn(text[open_at + 1:close])
                if not passed:
                    continue  # unlabelled: cannot tell whose function this is

                # Only ours: every label passed must be one this declaration
                # has. Anything else is somebody else's method of the same name.
                fits = [s for s in shapes if all(p in s['labels'] for p in passed)]
                if not fits:
                    continue
                checked += 1
                if any(all(r in passed for r in s['required']) for s in fits):
                    continue
                best = min(fits, key=lambda s: len([r for r in s['required'] if r not in passed]))
                missing = [r for r in best['required'] if r not in passed]
                line = raw[:hit.start()].count('\n') + 1
                bad.append(
                    f"{path.relative_to(ROOT)}:{line}  {name}(...) is missing "
                    f"{', '.join(repr(m) for m in missing)}\n"
                    f"      declared at {best['file']}:{best['line']} as "
                    f"{name}({':'.join(best['labels'])}:)"
                )

    if bad:
        print('A call that does not pass what the function it calls requires:\n')
        for one in sorted(set(bad)):
            print(f'  {one}\n')
        print('This is a compile error. It is the shape of the one that reached')
        print("Sam's Mac: Backup.push gained a `card:`, two places call it, and")
        print('only one of them was updated.')
        return 1

    print(f'{checked} calls to this project\'s own functions: every one passes '
          f'every argument required')
    return 0


if __name__ == '__main__':
    sys.exit(main())
