#!/usr/bin/env python3
"""The unlocks that must not ship, and the switch that must not ship on.

    python3 core/tools/check-paywall.py [root]
    python3 core/tools/check-paywall.py --release [root]

## What this guards

Three ways this app can give itself away, each of which is silent.

**1. The tester unlock.** `Subscription.testing` unlocks every paid screen. It
exists because on a real phone with nothing on sale StoreKit has nothing to sell
and nothing to restore, so the takeoff, the price, the proposal, the claim and
the exports all correctly showed a paywall to the two people testing the app.
Reported, exactly, as *"takeoff still doesn't work"*. It is compiled out of a
Release build by `#if DEBUG`.

**2. The free-until-launch switch.** `Subscription.onSale` is `false` while
Trueline is not on the App Store, and while it is `false` every paid feature is
on for everybody, on every build:

    > "WE NEED EVERYTHING TO BE FREE UNTIL WE LAUNCH ON THE APP STORE"

That is right up to the day it is wrong. It is NOT `#if DEBUG` and must not be:
the people testing before launch are on TestFlight and a TestFlight build is a
Release build, so a giveaway written that way would show them a paywall and sell
them nothing. Which means it is a switch a person flips, and a switch a person
flips is a switch a person forgets. Submit with it still `false` and every App
Store customer gets the whole product for nothing, from the first day, with no
symptom at all except that nobody ever pays.

    python3 core/tools/check-paywall.py --release

is the answer to that. Run it on the build that is going on sale.

**3. Anything else that simply turns `subscribed` on.** A refactor, a merge,
somebody simplifying a branch that looks redundant.

## What it checks

  1. `static var testing` is declared, its body has a `#if DEBUG` before it
     returns true, and a `#else` that returns false.
  2. `Subscription.onSale` is a `static let` with a plain `true` or `false` on
     it -- a `var`, or an expression, is something that can move at runtime, and
     what a build does about money has to be decided by what is written down.
  3. `freeUntilLaunch` is `!onSale` and nothing else, and the line that decides
     `subscribed` actually consults it. A switch nothing reads is a switch that
     does not work, which is worse than one that is on.
  4. `PaywallView` names the mode while it is on, because a giveaway that is
     invisible on the screen is a giveaway that ships still running.
  5. `PaywallView` can tell "still asking the store" from "the store has nothing
     to sell" -- see `productsKnown`. An empty product list with no error is
     what comes back while the in-app purchases are waiting to be approved, and
     a paywall that spins forever on it is a rejection.
  6. Nothing anywhere sets `subscribed` to true outright, including as one arm
     of an `||`.
  7. With `--release`: `onSale` is `true`.

## What it does not check

That the app's Release configuration does not define DEBUG. `check-pbxproj.py`
reads the build settings; this reads the Swift.
"""
import re
import sys
from pathlib import Path

ARGS = [a for a in sys.argv[1:] if not a.startswith('-')]
FLAGS = [a for a in sys.argv[1:] if a.startswith('-')]

# `--release` means "this is the build that is going on sale", which is not the
# same thing as `-configuration Release`: TestFlight is Release too, and
# TestFlight is exactly where the giveaway is supposed to still be running. The
# flag names the submission, not the compiler setting.
GOING_ON_SALE = '--release' in FLAGS or '--launch' in FLAGS

ROOT = Path(ARGS[0]).resolve() if ARGS else Path(__file__).resolve().parents[2]
IOS = ROOT / 'ios'
FILE = IOS / 'Trueline' / 'Subscription.swift'
PAYWALL = IOS / 'Trueline' / 'PaywallView.swift'

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


def testerUnlock(source: str, problems: list[str]) -> None:
    """The `#if DEBUG` round the tester unlock, exactly as it was."""
    found = re.search(r'static\s+var\s+testing\s*:\s*Bool', source)
    if not found:
        # Gone is fine -- once the app is on sale this should be deleted. What
        # is not fine is it existing without its guard, which is checked here.
        print('No tester unlock in the app. Nothing to guard.')
        return

    body = bodyOf(source, found.end())
    if '#if DEBUG' not in body:
        problems.append('`Subscription.testing` has no `#if DEBUG` in it.')
        return
    debugHalf = body.split('#if DEBUG', 1)[1].split('#else', 1)[0]
    if 'return true' not in debugHalf:
        problems.append('the `#if DEBUG` half of `Subscription.testing` does not return true')
    if '#else' not in body:
        problems.append('`Subscription.testing` has a `#if DEBUG` and no `#else`, '
                        'so a Release build would not compile')
        return
    releaseHalf = body.split('#else', 1)[1]
    if 'return false' not in releaseHalf:
        problems.append('the `#else` half of `Subscription.testing` does not return false')


def launchSwitch(source: str, problems: list[str]) -> str | None:
    """The one line that decides whether anything is charged for at all.

    Returns 'true', 'false', or None when it could not be read -- and a switch
    that cannot be read is reported rather than assumed, because assuming it is
    off is exactly the mistake this whole file exists to stop.
    """
    if re.search(r'static\s+var\s+onSale\b', source):
        problems.append('`Subscription.onSale` is a `var`. It has to be a `let`: a switch '
                        'anything can move at runtime is not a decision made in the source.')
        return None

    said = re.search(r'static\s+let\s+onSale\s*(?::\s*Bool\s*)?=\s*(true|false)\s*$',
                     source, re.M)
    if not said:
        problems.append('`Subscription.onSale` is not declared as `static let onSale = true` '
                        'or `= false`. That line is the free-until-launch switch and it has '
                        'to be a plain word somebody can read and flip.')
        return None
    onSale = said.group(1)

    # The switch has to be wired to something. One that nothing reads is worse
    # than one left on, because it looks handled.
    if not re.search(r'static\s+var\s+freeUntilLaunch\s*:\s*Bool\s*\{\s*!\s*onSale\s*\}', source):
        problems.append('`freeUntilLaunch` is not `{ !onSale }`. The giveaway and the '
                        'switch have to be the same fact said once.')

    decides = re.search(r'^\s*subscribed\s*=\s*(.+)$', source, re.M)
    if not decides:
        problems.append('nothing in `Subscription` assigns `subscribed`, so no screen in '
                        'this app can be gated at all')
    elif 'freeUntilLaunch' not in decides.group(1):
        problems.append('the line that decides `subscribed` does not consult '
                        '`freeUntilLaunch`, so the free-until-launch switch does nothing. '
                        f'It reads: subscribed = {decides.group(1).strip()}')

    return onSale


def paywallScreen(problems: list[str]) -> None:
    """The two things the screen itself has to be able to say."""
    if not PAYWALL.exists():
        problems.append(f'{PAYWALL.name} is not there, so there is no paywall to check.')
        return
    text = COMMENT.sub('', PAYWALL.read_text(encoding='utf-8'))

    if 'freeUntilLaunch' not in text and 'onSale' not in text:
        problems.append('`PaywallView` never mentions `freeUntilLaunch`, so while everything '
                        'is free the screen selling it says nothing about that. A mode nobody '
                        'can see on the screen is a mode that ships still switched on.')

    if 'productsKnown' not in text:
        problems.append('`PaywallView` never reads `productsKnown`, so it cannot tell "still '
                        'asking the store" from "the store has nothing to sell". An empty '
                        'product list with no error is what StoreKit returns while the in-app '
                        'purchases are waiting to be approved, and a paywall that spins on '
                        'that spins forever, in front of an App Review tester.')


def nothingElseTurnsItOn(problems: list[str]) -> None:
    """Any assignment that puts `true` into `subscribed`, on its own or as an arm of an `||`."""
    for path in sorted(IOS.rglob('*.swift')):
        text = COMMENT.sub('', path.read_text(encoding='utf-8'))
        for hit in re.finditer(r'\bsubscribed\s*=\s*(.+)', text):
            if not re.search(r'\btrue\b', hit.group(1)):
                continue
            line = text[:hit.start()].count('\n') + 1
            problems.append(f'{path.relative_to(ROOT)}:{line} sets `subscribed` to true '
                            f'outright: subscribed = {hit.group(1).strip()}')


def main() -> int:
    if not FILE.exists():
        print(f'{FILE.relative_to(ROOT)} is not there.')
        return 1
    source = COMMENT.sub('', FILE.read_text(encoding='utf-8'))

    problems: list[str] = []
    testerUnlock(source, problems)
    onSale = launchSwitch(source, problems)
    paywallScreen(problems)
    nothingElseTurnsItOn(problems)

    if problems:
        print('The paid screens are not guarded the way they have to be:\n')
        for one in problems:
            print(f'  {one}')
        print('\nEvery paid screen in this app is behind `subscribed`, and every one of')
        print('the lines above is a way for that to stop being true quietly: a tester')
        print('unlock that survives into Release, a free-until-launch switch nothing')
        print('reads or nobody can see, or something that simply sets `subscribed`.')
        print('Each of them gives the whole product away, and the only symptom is')
        print('that nobody ever pays.')
        return 1

    if GOING_ON_SALE and onSale != 'true':
        print('This build is going on sale with everything still free.\n')
        print('  ios/Trueline/Subscription.swift says  static let onSale = false')
        print('\nThat is the free-until-launch switch, and while it is false every paid')
        print('feature is on for everybody. It is right for TestFlight and it is right')
        print('today. It is wrong for the binary you are about to submit: every App')
        print('Store customer would get the takeoff, the pricing, the proposals, the')
        print('change orders, the claim documents and every export for nothing, from')
        print('the first day, and the only symptom is that nobody ever pays.')
        print('\nApp Review does not need it either. Reviewers test in-app purchases in')
        print("Apple's sandbox, where a purchase costs them nothing.")
        print('\nChange that line to  static let onSale = true  and archive again.')
        return 1

    print('the tester unlock is inside `#if DEBUG`, and nothing else turns the '
          'subscription on')
    print(f'the free-until-launch switch reads  static let onSale = {onSale}  '
          + ('and this build is going on sale' if GOING_ON_SALE
             else '(not checked against a build going on sale -- pass --release for that)'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
