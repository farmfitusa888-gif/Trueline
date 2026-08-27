#!/usr/bin/env python3
"""The tester unlock exists in debug builds and in no other kind.

    python3 core/tools/check-paywall.py [root]

## What this guards

`Subscription.testing` unlocks every paid screen. It exists because nothing is
on sale yet: on a real phone StoreKit has nothing to sell and nothing to
restore, so the takeoff, the price, the proposal, the claim and the exports all
correctly showed a paywall to the two people testing the app. Reported, exactly,
as *"takeoff still doesn't work"*.

It is compiled out of a Release build by `#if DEBUG`. If that guard is ever
removed -- by a refactor, by a merge, by somebody simplifying a branch that
looks redundant -- the App Store build gives the entire product away, silently,
and the only way to find out is that nobody ever pays.

That is not something to leave to memory.

## What it checks

  1. `static var testing` is declared, and its body has a `#if DEBUG` before it
     returns true, and a `#else` that returns false.
  2. Nothing else anywhere assigns `subscribed = true`.

## What it does not check

That the app's Release configuration does not define DEBUG. `check-pbxproj.py`
reads the build settings; this reads the Swift.
"""
import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[2]
IOS = ROOT / 'ios'
FILE = IOS / 'Trueline' / 'Subscription.swift'

COMMENT = re.compile(r'//[^\n]*')


def bodyOf(text: str, at: int) -> str:
    depth = 0
    start = text.find('{', at)
    if start < 0:
        return ''
    for i in range(start, len(text)):
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
            if depth == 0:
                return text[start + 1:i]
    return ''


def main() -> int:
    if not FILE.exists():
        print(f'{FILE.relative_to(ROOT)} is not there.')
        return 1
    source = COMMENT.sub('', FILE.read_text(encoding='utf-8'))

    found = re.search(r'static\s+var\s+testing\s*:\s*Bool', source)
    if not found:
        # Gone is fine -- once the app is on sale this should be deleted. What
        # is not fine is it existing without its guard, which is checked below.
        print('No tester unlock in the app. Nothing to guard.')
        return 0

    body = bodyOf(source, found.end())
    problems = []
    if '#if DEBUG' not in body:
        problems.append('`Subscription.testing` has no `#if DEBUG` in it.')
    else:
        debugHalf = body.split('#if DEBUG', 1)[1].split('#else', 1)[0]
        if 'return true' not in debugHalf:
            problems.append('the `#if DEBUG` half of `Subscription.testing` does not return true')
        if '#else' not in body:
            problems.append('`Subscription.testing` has a `#if DEBUG` and no `#else`, '
                            'so a Release build would not compile')
        else:
            releaseHalf = body.split('#else', 1)[1]
            if 'return false' not in releaseHalf:
                problems.append('the `#else` half of `Subscription.testing` does not return false')

    # And nothing anywhere else simply turns it on.
    for path in sorted(IOS.rglob('*.swift')):
        text = COMMENT.sub('', path.read_text(encoding='utf-8'))
        for hit in re.finditer(r'\bsubscribed\s*=\s*true\b', text):
            line = text[:hit.start()].count('\n') + 1
            problems.append(f'{path.relative_to(ROOT)}:{line} sets `subscribed = true` outright')

    if problems:
        print('The paid screens are not guarded the way they have to be:\n')
        for one in problems:
            print(f'  {one}')
        print('\nEvery paid screen in this app is behind `subscribed`. Without the')
        print('`#if DEBUG`, a Release build -- which is what TestFlight and the App')
        print('Store get -- gives the whole product away, and the only symptom is')
        print('that nobody ever pays.')
        return 1

    print('the tester unlock is inside `#if DEBUG`, and nothing else turns the '
          'subscription on')
    return 0


if __name__ == '__main__':
    sys.exit(main())
