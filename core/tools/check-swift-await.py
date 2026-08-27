#!/usr/bin/env python3
"""An SDK call that is async or throwing, written as if it were neither.

    python3 core/tools/check-swift-await.py [root]

## The build error this is the answer to

    CorrectView.swift:292:21: error: call can throw, but it is not marked with
                              'try' and the error is not handled
    CorrectView.swift:292:21: error: expression is 'async' but is not marked
                              with 'await'

Both from one line: `webView.evaluateJavaScript("...")`. WebKit has two of
those. The one taking a completion handler is ordinary and returns
immediately; the one that does not is `async throws`, and inside a `Task` that
is the overload the compiler picks. The same file calls the callback form
sixteen lines away and compiles fine, which is exactly why nobody looks twice.

There is no Swift compiler on the machine most of this is written on, so this
reached Sam's Mac like the three before it.

## What it checks

A list -- written out below, one line each, with what it is -- of SDK calls
this project makes that are `async` or `async throws` in a modern SDK. Every
call to one of them that is NOT the completion-handler overload must carry
`await`, and `try` as well when it can throw.

## How it tells the two overloads apart

A trailing closure, or a `completionHandler:` argument. That is the whole
difference, and it is the difference the compiler uses too.

## What it does NOT do, and this is the important half

**It refuses to check a name this project also declares.** `save`, `record` and
`data` are on the list because CloudKit and URLSession have async ones -- and
this repository has its own `save(kind:when:)`, its own `record(_:)` and its own
`record(webError:at:stack:)`, none of which are async. The first version of this
flagged all seven, which would have been seven reasons to stop reading its
output.

So every `func` name declared under `ios/` is collected first, and any API whose
name collides is dropped and REPORTED as dropped. What is left is checked
properly. A checker with false positives is worse than no checker, because the
first thing anybody does with one is learn to ignore it.

It also knows only the calls on its list. An async API this project starts using
tomorrow is invisible until somebody adds the line -- the honest limit of a
checker written on a machine with no SDK to ask.
"""
import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[2]
IOS = ROOT / 'ios'

# What to look for, as PATTERNS rather than as bare names.
#
# The first version of this listed names, and a bare name is not enough. `save`,
# `record` and `data` are all real async APIs somewhere, and all three are also
# `String.data(using:)`, this project's own `save(kind:when:)` and its own
# `record(webError:at:stack:)`. Listing them by name produced seven false
# positives in one run, which is seven reasons to stop reading the output.
#
# So each entry names enough of the call to be sure: the receiver where the
# receiver is what distinguishes it (`AppStore.sync`), or the first argument
# label where that does (`.data(from:`, `.record(for:`). Anything that cannot
# be pinned down that way is left off the list and said to be left off, in the
# comment at the end.
#
# pattern -> (throws, what it is)
ASYNC_APIS = {
    r'\.evaluateJavaScript\s*\(':
        (True, 'WKWebView, the overload with no completion handler'),
    r'\.callAsyncJavaScript\s*\(': (True, 'WKWebView'),
    r'\.requestFullAccessToEvents\s*\(': (True, 'EKEventStore, iOS 17 and later'),
    r'\.requestWriteOnlyAccessToEvents\s*\(': (True, 'EKEventStore, iOS 17 and later'),
    r'\bAppStore\.sync\s*\(': (True, 'AppStore.sync(), StoreKit 2'),
    r'\bProduct\.products\s*\(': (True, 'Product.products(for:), StoreKit 2'),
    r'\.purchase\s*\(': (True, 'Product.purchase(), StoreKit 2'),
    r'\.accountStatus\s*\(': (True, 'CKContainer.accountStatus(), the async form'),
    r'\.deleteRecord\s*\(withID:': (True, 'CKDatabase.deleteRecord(withID:), CloudKit'),
    r'\.records\s*\(matching:': (True, 'CKDatabase.records(matching:), CloudKit'),
    r'\.record\s*\(for:': (True, 'CKDatabase.record(for:), CloudKit'),
    r'\.save\s*\(\s*record\b': (True, 'CKDatabase.save(_:), CloudKit async form'),
    r'\.respond\s*\(to:': (True, 'LanguageModelSession.respond(to:), Foundation Models'),
    r'\.data\s*\(from:': (True, 'URLSession.data(from:)'),
    r'\.data\s*\(for:': (True, 'URLSession.data(for:)'),
}

# Async APIs this deliberately does NOT look for, and why. Kept here so the
# next person does not add one back and re-learn the same lesson.
#
#   CKDatabase.save(_:) with a variable not called `record` -- indistinguishable
#     from this project's own save(kind:when:) without knowing the receiver's
#     type, which needs a compiler.
#   EKEventStore.requestAccess(to:) -- the old spelling takes a completion
#     handler as often as not, and both forms exist in the wild.

COMMENT = re.compile(r'//[^\n]*')
STRING = re.compile(r'"(?:[^"\\\n]|\\.)*"')


def scrub(source: str) -> str:
    """Comments and string bodies blanked, keeping every character position.

    Positions matter because the report names a line. A name inside a string --
    and this file writes JavaScript into strings -- is not a call.
    """
    def blank(match: re.Match) -> str:
        return ' ' * (match.end() - match.start())
    return STRING.sub(blank, COMMENT.sub(blank, source))


def closeOf(text: str, open_at: int) -> int:
    """The index of the paren matching the one at `open_at`, or -1."""
    depth = 0
    for i in range(open_at, len(text)):
        if text[i] == '(':
            depth += 1
        elif text[i] == ')':
            depth -= 1
            if depth == 0:
                return i
    return -1


def leadUpTo(text: str, at: int) -> str:
    """The call's own line, plus any lines above it that it continues from.

    `_ = try? await webView.evaluateJavaScript(` is one line. Broken over two,
    the line above ends in a `.`, `=`, `(` or `,` -- so those are followed up,
    and nothing else is. Three lines is further than this project ever wraps.
    """
    start = text.rfind('\n', 0, at) + 1
    lines = [text[start:at]]
    edge = start
    for _ in range(2):
        prev_start = text.rfind('\n', 0, edge - 1) + 1
        if prev_start >= edge:
            break
        prev = text[prev_start:edge - 1]
        if not prev.rstrip().endswith(('.', '=', '(', ',', '?', '{')):
            break
        lines.insert(0, prev)
        edge = prev_start
    return '\n'.join(lines)


def main() -> int:
    bad: list[str] = []
    calls = 0


    for path in sorted(IOS.rglob('*.swift')):
        raw = path.read_text(encoding='utf-8')
        text = scrub(raw)
        for pattern, (throws, what) in ASYNC_APIS.items():
            for hit in re.finditer(pattern, text):
                line_start = text.rfind('\n', 0, hit.start()) + 1
                if re.match(r'\s*(?:@\w+\s+)*(?:public |private |internal |static |final )*func\b',
                            text[line_start:hit.start()]):
                    continue

                close = closeOf(text, text.index('(', hit.start()))
                if close < 0:
                    continue
                after = text[close + 1:close + 40].lstrip()
                inside = text[hit.end():close]
                # The completion-handler overload: a trailing closure, or a
                # handler passed by name. Neither is async, and both are fine.
                if after.startswith('{') or 'completionHandler:' in inside:
                    continue

                calls += 1
                lead = leadUpTo(text, hit.start())
                line = raw[:hit.start()].count('\n') + 1
                where = f'{path.relative_to(ROOT)}:{line}'
                shown = raw[hit.start():hit.start() + 40].split('\n')[0].strip()
                if 'await' not in lead:
                    bad.append(f"{where}  {shown} is async ({what})\n"
                               f"      and nothing here says `await`.")
                elif throws and 'try' not in lead:
                    bad.append(f"{where}  {shown} can throw ({what})\n"
                               f"      and nothing here says `try`.")

    if bad:
        print('An SDK call that is async or throwing, written as if it were neither:\n')
        for one in bad:
            print(f'  {one}\n')
        print('This is a compile error. It is the shape of the one that reached')
        print("Sam's Mac from CorrectView.swift:292 -- WebKit has two")
        print('evaluateJavaScript, and the one without a completion handler is')
        print('`async throws`.')
        return 1

    print(f'{calls} calls to async SDK APIs, against {len(ASYNC_APIS)} patterns: '
          f'every one says await, and try where it can throw')
    return 0


if __name__ == '__main__':
    sys.exit(main())
