#!/usr/bin/env python3
"""Finds a block a control opens that nothing on the screen can shut again.

    python3 core/tools/check-collapse.py

## The bug this is the answer to

> "WHEN YOU DROPDOWN ANY MENU, HAVE A WAY TO COLLAPSE THEM BACK"
>                                                          -- Sam

Tapping a control in this app opens a block of fields. Rename a wall, move it,
cut it in two, notch a corner, write down a price, add an item to the rate book.
Several of them opened and then sat there: the panel had grown by a screen and a
half, and the only ways back were to change the thing you did not want to change
or to scroll past it for the rest of the job. On a phone held in one hand at the
top of a ladder, a block that will not fold is dead weight in front of the next
thing somebody needs.

It is the twin of the bug `check-controls.py` exists for. That one asks whether
anybody has ever proved a control can be REACHED. This one asks whether, once
reached, it can be PUT DOWN.

## What it checks, exactly

Only the state that actually draws a block, which is what keeps the output
short enough to read.

  1. **A disclosure's state.** `useState(false)` or `useState<... | null>(null)`
     -- the two shapes this codebase writes one in. Nothing else is looked at:
     a counter, a string of typed text and a "did the save land" flag are all
     `useState` and none of them opens anything. Nor is a state its own setter
     is handed back changed: `setShape(addCorner(shape, at))` in `Sketch.tsx` is
     a room somebody is drawing, not a menu somebody dropped down, and the tell
     is that the new value was built out of the old one.
  2. **That gates a block worth folding.** The name, or a `const` derived from
     it, has to gate real JSX -- `{open && (`, `{showing ? (` -- and what it
     gates has to hold something to do: a button, a box, a form. A state that
     only swaps one sentence for another is not a menu and is never reported.
  3. **Opened by something a person presses.** At least one call that can put a
     truthy value in it, written inside an `onClick` or an `onSubmit`. Sam said
     "WHEN YOU DROPDOWN", and a block a `useEffect` reveals is not a menu
     anybody dropped down.
  4. **And then: what sets it back.** A call passing `false` or `null`, or a
     toggle -- `setOpen(!open)`, `setOpen(showing ? null : id)`, which is one
     call that does both jobs and is the shape every disclosure here uses.

Three answers, and each is its own paragraph of output:

  * nothing sets it back at all -- the block is open for the rest of the visit;
  * something does, but not from anything a person presses, so it folds only as
    a side effect of the thing working and a refusal leaves somebody holding a
    panel they cannot put down;
  * something does, and it is on nothing anybody would press -- a `<div>` that
    closes when you tap it, with nothing on the screen saying so. A callback
    handed to a component (`<RateBook onDone={...} />`) counts as a way back:
    this check cannot see inside the child, and a39 is what proves the child
    really draws one.

## What it cannot see, and says so rather than guessing

**Whether the way back is FINDABLE.** A `setOpen(false)` on a button in the
source is proof the way back exists, not proof it is where a thumb is or that
its word means anything. That is what `web/audit/a39-collapse.mjs` is for: it
opens each one in a real browser at 430 by 800, presses the way back, and checks
the block actually went away.

**A call one function removed from the button.** `PriceList.tsx` opens its
mapping form from `read(file)`, which the file box calls; nothing here follows a
value out of the handler and into a function, so that form is not counted as
opened by a control. Guessing across a call boundary is how a checker starts
reporting things that are not true, and a missed finding is the cheaper of the
two mistakes.

**A full-screen overlay with nothing in it but a picture.** `DamagePhotos.tsx`
still opens one that closes only when you tap the photograph, and says so
nowhere; `Vendor.tsx` had the same one and now has a Close button on it, which
`WallPhotos.tsx` has had all along. This check does not look at them, because
what makes a block a block here is having something to DO inside it -- and a
picture is not that. Adding `role="dialog"` to `WORTH_FOLDING` would find both,
and the day `DamagePhotos.tsx` grows its own Close is the day to do it. Turning
it on first would leave this check red over a file nobody is fixing, which is
how a checker stops being read.

**A block a parent unmounts.** Switching tabs takes every open panel in the old
one off the screen. That is a real way back and this check knows nothing about
it, which is the direction that costs a finding rather than hides one.

**A block whose state lives somewhere else entirely** -- passed in as a prop,
held in a store. Nothing here follows a value across a file boundary.

`collapse-on-purpose.json` holds the ones that genuinely should stay, each with
a written reason, and a reason under forty characters is refused as loudly as a
block that will not fold -- exactly as `reachable-on-purpose.json` and
`controls-on-purpose.json` do it. The point of the file is that somebody had to
write a sentence they were willing to sign.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'web' / 'src'
ON_PURPOSE = Path(__file__).resolve().parent / 'collapse-on-purpose.json'

# The same length the other two excuse files demand, for the same reason: a
# reason shorter than a sentence is not a reason.
SHORTEST_REAL_REASON = 40

# What makes a gated block a block rather than a sentence. A menu somebody has
# to fold away is one with things to do in it; a paragraph that appears when a
# flag flips is not what Sam was scrolling past.
WORTH_FOLDING = re.compile(
    r'<(?:button|input|textarea|select|label|form)\b'   # something to do
    r'|<[A-Z]\w*\b'                                     # or a screen of them
)


def stripComments(text: str) -> str:
    """Comments out, newlines kept.

    Every file in `web/src` opens with a long paragraph and several of them
    quote the very code this check is looking for. The newlines stay so every
    line number printed is the line number in the file somebody is about to
    open -- these files open with twenty lines of prose and more inside.

    A `//` line goes too, and only a whole one: a comment is prose, prose has
    apostrophes in it, and the brace matching below counts quotes. `Openings.tsx`
    has the line "worked back from the window's centre" sitting in the middle of
    the very block this check wants to read, and that one apostrophe swallowed
    the rest of the file. A `//` with code in front of it is left alone, because
    `https://` is not a comment and no regex can tell those apart.
    """
    text = re.sub(r'/\*.*?\*/',
                  lambda at: '\n' * at.group(0).count('\n'), text, flags=re.S)
    return re.sub(r'^[ \t]*//[^\n]*', '', text, flags=re.M)


def balanced(text: str, at: int, opener: str, closer: str) -> int:
    """Index just past the `closer` that matches the `opener` at `at`.

    Quotes are skipped, because these are JSX attribute expressions and an
    arrow function inside one holds braces, brackets and apostrophes in prose.
    """
    depth = 0
    quote = ''
    i = at
    while i < len(text):
        ch = text[i]
        if quote:
            if ch == quote and text[i - 1] != '\\':
                quote = ''
        elif ch in '"\'`':
            quote = ch
        elif ch == opener:
            depth += 1
        elif ch == closer:
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return -1


# ------------------------------------------------------------------ the state

STATE = re.compile(
    r'const\s*\[\s*(?P<name>\w+)\s*,\s*(?P<setter>set\w+)\s*\]\s*='
    r'\s*useState\s*(?P<type><[^=]*?>)?\s*\(\s*(?P<init>[^)]*?)\s*\)'
)


def disclosures(text: str) -> list[tuple[str, str, int]]:
    """Every `useState` that could be holding a block open, with its offset.

    `false` and `null` only. A disclosure starts shut, and those are the two
    ways this codebase writes shut -- `useState(false)` for one block, and
    `useState<string | null>(null)` for a list where one row at a time is open.
    """
    found = []
    for at in STATE.finditer(text):
        init = at.group('init').strip()
        if init not in ('false', 'null'):
            continue
        found.append((at.group('name'), at.group('setter'), at.start()))
    return found


def componentOf(text: str, at: int) -> tuple[int, int]:
    """The body of the component this state is declared in.

    One file draws several screens and they share their vocabulary: `Edit.tsx`
    holds `EditWall` and `RenameRoom`, and each of them has an `open` and a
    `setOpen` of its own. Read whole-file, the way out of ONE of them counts as
    the way out of BOTH -- so taking the Done off the wall panel, which is
    exactly the bug this exists for, left the check silent because the room's
    rename box still had one four hundred lines below.

    Everything about a state is therefore read inside its own component and
    nowhere else. Components here are `function Name(`, every one of them.
    """
    best = (0, len(text))
    for start in re.finditer(r'\bfunction\s+[A-Za-z_]\w*\s*\(', text):
        # Past the whole parameter list first. Every component here is declared
        # `function EditWall({ room, wall }: { … })`, so the first `{` after the
        # name opens the props being destructured, not the body -- and reading
        # that as the body put every state back in the whole file, which is the
        # bug this function was written to end.
        shut = balanced(text, start.end() - 1, '(', ')')
        if shut < 0:
            continue
        brace = text.find('{', shut)
        if brace < 0:
            continue
        end = balanced(text, brace, '{', '}')
        if end < 0 or not (start.start() < at < end):
            continue
        if end - start.start() < best[1] - best[0]:
            best = (start.start(), end)
    return best


def alsoKnownAs(text: str, name: str) -> list[str]:
    """Names a `const` gives this state, so the gate can be found under either.

    `Damage.tsx` and `Openings.tsx` both write `const showing = open === o.id`
    and then gate on `showing`. Following that one hop is the difference
    between reading this codebase and reading a codebase nobody wrote.
    """
    out = [name]
    for at in re.finditer(r'const\s+(\w+)\s*=\s*([^;\n]+)', text):
        if re.search(r'\b' + re.escape(name) + r'\b', at.group(2)):
            out.append(at.group(1))
    return out


def gatesABlock(text: str, names: list[str]) -> bool:
    """Whether one of these names decides that JSX with things to do is drawn.

    Two shapes, because this codebase writes a disclosure both ways. `{open && (`
    and `{showing ? (` draw a block in place -- as does `{changing === key && (`,
    which is the same sentence about one row of a list, so a short run of
    anything is allowed between the name and the `&&`. `if (!open) return (...)`
    swaps the whole panel for the one closed control that opens it -- which is
    how `Edit.tsx`, `Price.tsx` and `Scope.tsx` each do it, and a check that only
    knew the first shape was blind to half the app.
    """
    for name in names:
        for at in re.finditer(r'\{\s*' + re.escape(name)
                              + r'\b[^{}\n]{0,60}?\s*(&&|\?)', text):
            end = balanced(text, text.rindex('{', 0, at.end()), '{', '}')
            if end > 0 and WORTH_FOLDING.search(text[at.end():end]):
                return True
        for at in re.finditer(r'\bif\s*\(\s*!?\s*' + re.escape(name) + r'\s*\)\s*\{', text):
            end = balanced(text, at.end() - 1, '{', '}')
            body = text[at.end():end] if end > 0 else ''
            if 'return' in body and WORTH_FOLDING.search(body):
                return True
    return False


# ---------------------------------------------------------------- the setters

def calls(text: str, setter: str) -> list[tuple[int, str]]:
    """Every call to this setter, as (offset, the argument source)."""
    out = []
    for at in re.finditer(r'\b' + re.escape(setter) + r'\s*\(', text):
        end = balanced(text, at.end() - 1, '(', ')')
        if end < 0:
            continue
        out.append((at.start(), text[at.end():end - 1].strip()))
    return out


def canShut(argument: str, name: str) -> bool:
    """Whether this call can put the block away.

    Three shapes, all of them in the tree today. `setOpen(false)` and
    `setOpen(null)` say it outright. `setOpen(!open)` is a toggle, so the
    second press is the way back. `setOpen(showing ? null : o.id)` is the row
    that shuts itself when it is the one already open -- the pattern
    `Damage.tsx` uses and the one every disclosure here is modelled on.
    """
    if argument in ('false', 'null'):
        return True
    if re.match(r'!\s*' + re.escape(name) + r'\b', argument):
        return True
    if '?' in argument and re.search(r'[?:]\s*(false|null)\b', argument):
        return True
    return False


def editsItself(argument: str, name: str) -> bool:
    """Whether this call hands the state back to itself, changed.

    `setShape(wouldClose(shape, at) ? close(shape) : addCorner(shape, at))` is
    somebody drawing a room, and `Sketch.tsx` holds it in a `useState<Shape |
    null>(null)` that looks exactly like a disclosure's from the outside. The
    difference is that a disclosure never reads its own state except to flip it
    -- `!open` -- or to ask whether this row is the open one -- `open === o.id`.
    Anything else built out of the old value is a value somebody is editing.
    """
    rest = re.sub(r'!\s*' + re.escape(name) + r'\b', '', argument)
    rest = re.sub(re.escape(name) + r'\s*(?:===|!==)\s*[\w.\[\]\'"]+', '', rest)
    return re.search(r'\b' + re.escape(name) + r'\b', rest) is not None


def canOpen(argument: str) -> bool:
    """Whether this call can put the block on the screen.

    A toggle and a `x ? null : id` do both jobs in one call, which is why these
    two questions are asked separately rather than sorting each call into one
    bucket. Sorting them was the first version, and it made every correctly
    written disclosure in the app invisible to this check -- `Damage.tsx` has
    exactly one call to its setter and it is a toggle.
    """
    return argument not in ('false', 'null')


HANDLER = re.compile(r'\bon[A-Z]\w*\s*=\s*\{')


def handlers(text: str) -> list[tuple[int, int, str]]:
    """Every `onSomething={...}`, as (start, end, the element it is written on).

    The element is the tag name immediately before it, which is where an
    attribute always is. It is the difference between a way back a person can
    see and one that only exists for whoever taps the right pixel: `WallPhotos`
    has always put a "Close the photograph" button on its full-size view, and
    the shelf-tag view next door closed when you tapped the picture and said so
    nowhere until one was put on that too.
    """
    out = []
    for at in HANDLER.finditer(text):
        end = balanced(text, at.end() - 1, '{', '}')
        if end < 0:
            continue
        tag = re.search(r'<\s*([A-Za-z][\w.]*)[^<]*$', text[:at.start()])
        out.append((at.start(), end, tag.group(1) if tag else '?'))
    return out


def pressable(tag: str) -> bool:
    """Whether a way back written on this element is one anybody can find.

    A `<button>` is. So is a prop on a component -- `<RateBook onDone={...} />`
    hands the closing over to a child that draws its own control, and nothing
    static can or should follow it there. What is not: an `onClick` on a
    `<div>`, an `<img>`, an `<li>`. Those work and they are invisible, which is
    the same state four of this project's worst bugs were found in.
    """
    return tag == 'button' or tag[:1].isupper()


def inside(where: int, spans: list[tuple[int, int, str]]) -> str | None:
    """The element whose handler this call is written in, if it is in one."""
    for start, end, tag in spans:
        if start <= where < end:
            return tag
    return None


def excused() -> dict[str, str]:
    """Blocks that deliberately stay open, and the reason each one does.

    Keyed `web/src/File.tsx: theState`, which is exactly how this check prints
    a finding, so the key can be copied straight out of the output.
    """
    if not ON_PURPOSE.exists():
        return {}
    raw = json.loads(ON_PURPOSE.read_text(encoding='utf-8'))
    return {k: v for k, v in raw.items() if not k.startswith('_')}


def main() -> int:
    if not SRC.is_dir():
        print('web/src is missing, so no block can be looked at')
        return 1

    sources = {p: stripComments(p.read_text(encoding='utf-8'))
               for p in sorted(SRC.rglob('*.tsx'))}
    if not sources:
        print('no screens were found in web/src, so the patterns have drifted')
        return 1

    allowed = excused()
    stuck: list[str] = []
    consequence: list[str] = []
    unpressable: list[str] = []
    onPurpose: set[str] = set()
    thin: list[str] = []
    seen: set[str] = set()
    checked = 0

    for path, whole in sources.items():
        rel = str(path.relative_to(ROOT)).replace('\\', '/')
        for name, setter, where in disclosures(whole):
            start, stop = componentOf(whole, where)
            text = whole[start:stop]
            at = whole.count('\n', 0, where) + 1
            spans = handlers(text)
            if not gatesABlock(text, alsoKnownAs(text, name)):
                continue
            made = calls(text, setter)
            if any(editsItself(arg, name) for _, arg in made):
                continue
            opens = [c for c in made if canOpen(c[1])]
            backs = [c for c in made if canShut(c[1], name)]
            if not any(inside(where, spans) for where, _ in opens):
                continue
            checked += 1
            key = f'{rel}: {name}'
            seen.add(key)

            if key in allowed:
                onPurpose.add(key)
                continue

            if not backs:
                stuck.append(f'{key} (line {at}) — {len(opens)} call(s) open it '
                             f'and nothing sets it back')
                continue

            pressed = [tag for tag in (inside(where, spans) for where, _ in backs)
                       if tag is not None]
            if not pressed:
                consequence.append(f'{key} (line {at}) — it folds when the work '
                                   f'lands and from nothing anybody presses')
            elif not any(pressable(tag) for tag in pressed):
                unpressable.append(f'{key} (line {at}) — the only way back is on '
                                   f'<{pressed[0]}>, which nothing says is pressable')

    for key, reason in allowed.items():
        if not isinstance(reason, str) or len(reason) < SHORTEST_REAL_REASON:
            thin.append(f'{key} — its reason in {ON_PURPOSE.name} is too thin to be one')
        elif key not in seen:
            thin.append(f'{key} — no block in web/src opens on this any more; delete the entry')

    if stuck:
        print('Opened, and nothing on the screen sets it back:')
        for one in stuck:
            print(f'  {one}')
        print()
    if consequence:
        print('Folded only by the work landing, so a refusal leaves it open:')
        for one in consequence:
            print(f'  {one}')
        print()
    if unpressable:
        print('A way back that nothing announces as one:')
        for one in unpressable:
            print(f'  {one}')
        print()

    bad = stuck + consequence + unpressable
    if bad or thin:
        if thin:
            print(f'Excused in {ON_PURPOSE.name} with nothing behind it:')
            for one in thin:
                print(f'  {one}')
            print()
        print('    Sam: "WHEN YOU DROPDOWN ANY MENU, HAVE A WAY TO COLLAPSE THEM BACK."')
        print('    `web/src/Disclosure.tsx` is the shared way back — a header that')
        print('    toggles, says Open or Close, and tells you what is inside it while')
        print(f'    it is shut. Use it, or say why this one stays in {ON_PURPOSE.name}.')
        print()
        print(f'{checked} block(s) a control opens, {len(bad)} of them without a way back, '
              f'{len(onPurpose)} excused on purpose, {len(thin)} excuse(s) with nothing behind them.')
        return 1

    print(f'{checked} block(s) a control opens in web/src, and every one of them can be '
          f'folded back by something a person presses, or is one of {len(onPurpose)} '
          f'excused in {ON_PURPOSE.name} with a written reason.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
