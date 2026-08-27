#!/usr/bin/env python3
"""The web half and the phone half agree about what the channels are called.

    python3 core/tools/check-bridge.py

## The bug this is the answer to

The page inside the app talks to the app by posting to a named message handler.
The name is a string on both sides and nothing has ever compared the two lists:

    web/src/bridge.ts            handler('haptic')
    ios/Trueline/CorrectView.swift
                                 add(context.coordinator, name: "haptic")
                                 case "haptic":

Three lists, three strings, written months apart. A typo on any one of them is
a feature that compiles, ships, passes every test, and silently does nothing on
a phone — because `handler()` returns `undefined` when the name is not
registered, and every caller in `bridge.ts` correctly and quietly does nothing
in that case. That politeness is right for a browser, where there IS no app; it
is exactly what hides the mistake on a phone.

`haptic` was the tenth channel. It was written by one session in two files at
once and got it right. The eleventh will be written by somebody reading only one
of them.

This is the same family as `check-doors.py`: work that is finished and cannot be
reached is indistinguishable from work that was never done.

## The four lists, and what each one being wrong costs

  1. **Asked for** — `handler('x')` in `bridge.ts`. The web wants channel x.
  2. **Registered** — `add(..., name: "x")` in `CorrectView.swift`. The app is
     listening on x.
  3. **Handled** — `case "x":` in the same file's message switch. Something
     happens when x arrives.
  4. **Faked** — the handler list in `web/audit/lib.mjs`, which every browser
     audit installs so it can prove a message was sent. A channel missing here
     cannot be tested at all, and its audit checks pass vacuously.

Asked-for but not registered: the feature is dead on the phone.
Registered but not handled: the message lands and nothing happens.
Registered but never asked for: dead code, or a rename half-done.
Not faked: no audit can ever see it, so nothing will notice the first three.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BRIDGE = ROOT / 'web' / 'src' / 'bridge.ts'
NATIVE = ROOT / 'ios' / 'Trueline' / 'CorrectView.swift'
FAKES = ROOT / 'web' / 'audit' / 'lib.mjs'

# Channels the app registers for its own reasons and the page never posts to.
# Each needs a sentence, for the same reason `reachable-on-purpose.json` does.
NOT_FROM_THE_PAGE: dict[str, str] = {}


def strip(text: str) -> str:
    """Comments out, so a channel named in prose is not counted as a use."""
    text = re.sub(r'/\*.*?\*/', ' ', text, flags=re.S)
    return re.sub(r'//[^\n]*', ' ', text)


def askedFor(source: str) -> set[str]:
    return set(re.findall(r"handler\(\s*['\"]([a-zA-Z]+)['\"]\s*\)", source))


def registered(source: str) -> set[str]:
    return set(re.findall(r'\.add\([^)]*name:\s*"([a-zA-Z]+)"', source))


def handled(source: str) -> set[str]:
    return set(re.findall(r'case\s+"([a-zA-Z]+)"\s*:', source))


def faked(source: str) -> set[str]:
    match = re.search(r"for \(const name of \[([^\]]*)\]\)", source)
    if not match:
        return set()
    return set(re.findall(r"'([a-zA-Z]+)'", match.group(1)))


def main() -> int:
    for path in (BRIDGE, NATIVE, FAKES):
        if not path.exists():
            print(f'{path.relative_to(ROOT)} is missing, so the channels cannot be compared')
            return 1

    web = strip(BRIDGE.read_text(encoding='utf-8'))
    app = strip(NATIVE.read_text(encoding='utf-8'))
    audit = strip(FAKES.read_text(encoding='utf-8'))

    asks = askedFor(web)
    adds = registered(app)
    does = handled(app)
    fakes = faked(audit)

    if not asks or not adds:
        print('no channels found on one side, which means the patterns have drifted')
        return 1

    bad = 0

    for name in sorted(asks - adds):
        bad += 1
        print(f'`{name}` — the page posts to it, the app never registers it')
        print('    On a phone this does nothing at all, quietly, for ever. Register it in')
        print('    CorrectView.swift or stop asking for it in bridge.ts.')

    for name in sorted(adds - does):
        bad += 1
        print(f'`{name}` — the app registers it and handles nothing when it arrives')
        print('    The message lands and is dropped. Add a `case` to the switch.')

    for name in sorted(adds - asks - set(NOT_FROM_THE_PAGE)):
        bad += 1
        print(f'`{name}` — the app listens on it and nothing on the page ever posts to it')
        print('    Either a rename that was only half done, or dead code. If the app really')
        print('    does need it for something else, say so in NOT_FROM_THE_PAGE.')

    for name in sorted(adds - fakes):
        bad += 1
        print(f'`{name}` — no browser audit can see it')
        print('    `openAsApp` in web/audit/lib.mjs installs a fake handler per channel, and')
        print('    this one is not in the list — so `sentTo` returns nothing for it and any')
        print('    check about it passes without proving anything.')

    if bad:
        print()
        print(f'{bad} problem(s) between the page and the app.')
        return 1

    print(f'{len(adds)} channels between the page and the app: every one is asked for, '
          'registered, handled, and visible to the audit')
    return 0


if __name__ == '__main__':
    sys.exit(main())
