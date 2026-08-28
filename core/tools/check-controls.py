#!/usr/bin/env python3
"""Every control the web app draws is driven by something in the audit.

    python3 core/tools/check-controls.py

## The bug this is the answer to, four times in two days

Four controls in this app existed, worked, were tested, and could not be found
by the person who needed them:

  * `PaywallView` compiled, was in the target and passed nine Swift checkers,
    and nothing in the app ever presented it — so every paid gate refused a
    contractor with no way to buy.
  * The mark button "refused" 280 pixels above the button being pressed. Sam
    reported it as a dead button. It was working.
  * "Photograph it" lived inside a collapsed row whose only hint was the word
    "Open" in 12px grey beside an em-dash, with no `aria-expanded`. Sam
    reported he could not attach a photograph. He could.
  * A tapped wall had 73% of its highlight painted out by its own doorways.

Every one of them was in the same state before it was found: **no part of the
audit had ever named that control.** Nothing had driven it, so nothing had ever
had the chance to notice it could not be reached, was in the wrong place, or
drew the wrong thing.

`check-doors.py` proves every *screen* has something that opens it. This is the
other half of that sentence, one level down: a *control* nobody has ever driven
is a control nobody has ever proved a person can reach.

## What it checks, exactly

Two lists, compared.

  1. **Drawn** — the accessible name of every control in `web/src/**.tsx`: the
     `aria-label` of a button or a box, the text inside a `<button>` that has
     no `aria-label`, and the label handed to a local component that renders a
     box from it (`<Field label="Day">`, `<Measure name="the ceiling height">`).
  2. **Driven** — every name any part of `web/audit/*.mjs` reaches for:
     `getByRole('button', { name: ... })`, `getByLabel(...)`, the other
     `getByRole` roles in use, `getByPlaceholder`, `getByText`, and the
     `[aria-label="..."]` written into a raw CSS `locator()`.

A drawn name that no part names is reported. That is the whole check.

## Why this does not cry wolf

A checker with thirty findings has none, so three kinds of honesty are built in.

**A name nothing can know is never a failure.** `aria-label={label}`, inside
the component that receives it, has nothing to compare. Names are sorted into
three kinds, and the third of them can never be reported:

  * *literal* — the whole name is a string in the source. Compared exactly.
  * *partly known* — a name with a literal head, like `Set ${name}` or
    `Take {what} off the calendar`, or a name that is one of a short list, like
    `{busy ? 'Keeping it…' : none ? 'Photograph it' : 'Another'}`. A head is
    driven if any audit name begins with it, or if any audit regex matches it:
    an audit asking for `Set the length of wall-1`, or for
    `/^Set the length of/`, is plainly driving `Set ${name}`. A list is driven
    if any one of its words is. A head shorter than four characters is not
    evidence of anything and the name is treated as opaque instead.
  * *opaque* — the name is entirely an expression: `{VISIT_TITLE[which]}`,
    `{label}` inside the component that receives it. Nothing static can say
    what it reads. These are counted and printed as a number, never as a
    finding, because a checker that fails on what it cannot know teaches people
    to ignore it.

**A regular expression counts as driving.** Most of the audit reaches for
`/^Wall /` rather than a full name, and that really does drive every wall
button. Regexes are applied to the literal names, and their own literal head is
used against the prefixed ones.

**An excuse costs a sentence.** `controls-on-purpose.json` holds the controls
that genuinely should not be in an audit, each with a written reason, and a
reason under forty characters is refused as loudly as an undriven control —
exactly as `reachable-on-purpose.json` does it. The point of the file is that
somebody had to write a sentence they were willing to sign.

## What it does NOT check

That the control can be reached *by a person*. Naming a control in an audit is
proof somebody thought about it, not proof it is on the screen; the audit part
itself is what proves the second thing, at a real phone height. This check is
the gate in front of that: you cannot have driven what you never named.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'web' / 'src'
AUDIT = ROOT / 'web' / 'audit'
ON_PURPOSE = Path(__file__).resolve().parent / 'controls-on-purpose.json'

# A literal head shorter than this is not evidence that anything was driven.
# `Set ${name}` gives "Set " and that is a real head; a template that begins
# with `${x}` gives "" and would otherwise match every audit name in the file.
SHORTEST_USEFUL_PREFIX = 4

# The same length `reachable-on-purpose.json` demands, for the same reason: a
# reason shorter than a sentence is not a reason.
SHORTEST_REAL_REASON = 40


# ------------------------------------------------------------------ reading

def stripComments(text: str) -> str:
    """Block comments out.

    Only block comments, and only outside JSX. Every file in `web/src` opens
    with a long paragraph naming the controls it draws, and counting those as
    controls would make the drawn list a list of prose. `//` is deliberately
    left alone: it appears inside `https://` and inside JSX text, and a regex
    cannot tell those from a comment without a parser.
    """
    # The newlines inside a comment are kept, so every line number this check
    # prints is the line number in the file somebody is about to open. A
    # comment replaced by one space moves every finding below it up by however
    # many lines that paragraph was, and these files open with twenty.
    return re.sub(r'/\*.*?\*/',
                  lambda at: '\n' * at.group(0).count('\n'), text, flags=re.S)


def openTagEnd(text: str, at: int) -> int:
    """Index of the `>` that closes the JSX tag opening at `at`.

    Braces are counted and quotes are skipped, because a tag's attributes hold
    whole expressions — `onClick={() => setKind(which)}` has a `>` in it and a
    naive search for the next one lands in the middle of an arrow function.

    A backslash escapes the next character, and skipping that used to be
    missing. `Edit.tsx` has

        setMoveWants('Type where this wall really is first — 12\' 4".')

    inside an `onClick`, and the `\'` closed the string early. The scan then
    desynchronised and the tag never ended where it should. Measured across
    `web/src/**.tsx` before this line existed: **six controls were never
    harvested at all** and **three were harvested under another control's
    name** — the `Move it` button was recorded as `How high this wall stands`,
    which is the aria-label of an input forty lines below it.

    That is the worst thing this tool can do. A checker that quietly reports a
    control under the wrong name is not a checker that missed something; it is
    one that says the wrong thing confidently, and the count going down looks
    like progress.
    """
    depth = 0
    quote = ''
    i = at
    while i < len(text):
        ch = text[i]
        if quote:
            if ch == '\\':
                i += 2
                continue
            if ch == quote:
                quote = ''
        elif ch == '/' and text[i:i + 2] == '//' and depth > 0:
            # A line comment inside a handler. `stripComments` takes out the
            # `{/* ... */}` kind and leaves this one, because this one lives
            # INSIDE an expression the tag needs kept.
            #
            # It has to be skipped whole, and the reason is an apostrophe: a
            # comment reading `without this the button's handler could be dead`
            # opened a quote here that never closed, the scan ran past the end
            # of the tag, and `attribute(tag, 'onClick')` came back None. The
            # control was then invisible. Found by `check-the-checks.py` when a
            # deliberately broken file went green.
            #
            # `depth > 0` because a `//` outside braces is not a comment in JSX
            # -- it is text on the page.
            newline = text.find('\n', i)
            if newline == -1:
                return -1
            i = newline
        elif ch in '"\'`':
            quote = ch
        elif ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
        elif ch == '>' and depth == 0:
            return i
        i += 1
    return -1


def attribute(tag: str, name: str) -> str | None:
    """The raw source of one attribute's value — `"a"`, `{...}` — or None."""
    found = re.search(rf'\b{re.escape(name)}\s*=\s*', tag)
    if not found:
        return None
    rest = tag[found.end():]
    if rest[:1] in ('"', "'"):
        quote = rest[0]
        end = rest.find(quote, 1)
        return rest[:end + 1] if end > 0 else None
    if rest[:1] == '{':
        depth = 0
        quote = ''
        for i, ch in enumerate(rest):
            if quote:
                if ch == quote:
                    quote = ''
                continue
            if ch in '"\'`':
                quote = ch
            elif ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    return rest[:i + 1]
    return None


# ------------------------------------------------------------------- names

class Name:
    """One accessible name as the source gives it, and how much of it is known.

    `kind` is one of three. `literal` — the whole name is in the source, and
    `alternatives` holds it alone. `opaque` — nothing about it is knowable.
    `prefixed` — partly known, in one of two ways: `text` is the literal head
    of a template, or `alternatives` holds every word a chain of `? :` can put
    on the button and `text` is empty. Never both.

    The second of those exists because `{open ? 'Close' : 'Your business'}` is
    one button with two names, and an audit that drives it under either one has
    driven it. The bug where the business toggle kept the accessible name "Your
    business" while showing the word "Close" is exactly this shape.
    """

    def __init__(self, kind: str, text: str, alternatives: list[str] | None = None):
        self.kind = kind
        self.text = text
        self.alternatives = alternatives or ([text] if kind == 'literal' else [])


LITERAL = re.compile(r'''^\s*(['"])(.*?)\1\s*$''', re.S)
STRINGS = re.compile(r'''(['"])((?:\\.|(?!\1).)*)\1''', re.S)


def ternaryLiterals(expression: str) -> list[str] | None:
    """Every word a chain of `? :` between string literals can put on screen.

    One button, several names. The photograph control reads

        {busy ? 'Keeping it…' : photos.length === 0 ? 'Photograph it' : 'Another'}

    and it is the control from the third bug — the one Sam could not find. An
    audit that drives it under any one of those three names has touched it, so
    all three are collected and any of them counts.

    The shape is confirmed by counting rather than parsed: a chain of n string
    literals has n-1 `?` and n-1 `:`, and anything with a call, a template or a
    second expression in a value position will not add up. Optional chaining
    and `??` are removed first, because they are not this kind of question.
    """
    plain = expression.replace('?.', '.').replace('??', '||')
    literals = [collapse(body) for _, body in STRINGS.findall(plain)]
    if len(literals) < 2:
        return None
    if plain.count('?') != len(literals) - 1 or plain.count('?') != plain.count(':'):
        return None
    return literals


def fromExpression(source: str) -> Name:
    """What is knowable about the value of a JSX attribute expression."""
    inner = source.strip()
    if inner.startswith('{') and inner.endswith('}'):
        inner = inner[1:-1].strip()

    plain = LITERAL.match(inner)
    if plain:
        return Name('literal', collapse(plain.group(2)))

    # `x ? 'Close' : 'Your business'` — both are real names of this control.
    chain = ternaryLiterals(inner)
    if chain:
        return Name('prefixed', '', chain)

    if inner.startswith('`') and inner.endswith('`'):
        body = inner[1:-1]
        if '${' not in body:
            return Name('literal', collapse(body))
        head = collapse(body[:body.index('${')])
        if len(head) >= SHORTEST_USEFUL_PREFIX:
            return Name('prefixed', head)
    return Name('opaque', inner)


def collapse(text: str) -> str:
    """JSX collapses runs of whitespace, and so does an accessible name."""
    return re.sub(r'\s+', ' ', text).strip()


TAG = re.compile(r'</?[A-Za-z][^>]*?/?>', re.S)
BRACES = re.compile(r'\{(?:[^{}]|\{[^{}]*\})*\}', re.S)


def fromChildren(inner: str) -> Name:
    """The accessible name a `<button>` gets from what is written inside it.

    Nested tags go and their text stays, which is what a browser does. What is
    left is either plain words — a literal name — or words with an expression
    somewhere in them.
    """
    text = TAG.sub(' ', inner)
    if '{' not in text:
        return Name('literal', collapse(text))

    # A button whose whole content is one expression is named by that
    # expression, and the commonest one in this app is a toggle:
    # `{open ? 'Close' : 'Your business'}`. Both words are real names of that
    # one control — the audit that caught the business toggle keeping the
    # accessible name "Your business" while showing "Close" is this shape —
    # and treating the pair as unknowable throws away two literals somebody
    # can actually check.
    lone = collapse(text)
    if lone.startswith('{') and lone.endswith('}') and BRACES.fullmatch(lone):
        return fromExpression(lone)

    # `{' '}` and `{'\u2014'}` are text somebody had to escape, not a value.
    text = re.sub(r'''\{\s*(['"])(.*?)\1\s*\}''', r'\2', text, flags=re.S)
    if '{' not in text:
        return Name('literal', collapse(text))

    head = collapse(text[:text.index('{')])
    if len(head) >= SHORTEST_USEFUL_PREFIX:
        return Name('prefixed', head)
    return Name('opaque', collapse(BRACES.sub('{}', text)))


# ------------------------------------------------------------------ harvest

BOXES = ('input', 'textarea', 'select')


def balanced(text: str, at: int, opener: str, closer: str) -> tuple[str, int] | None:
    """What is between the bracket at `at` and its partner, and where that is."""
    if at >= len(text) or text[at] != opener:
        return None
    depth = 0
    for i in range(at, len(text)):
        if text[i] == opener:
            depth += 1
        elif text[i] == closer:
            depth -= 1
            if depth == 0:
                return text[at + 1:i], i
    return None


def functionBody(text: str, opensAt: int) -> tuple[str, str] | None:
    """The parameters and the body of the function whose `(` is at `opensAt`.

    Both halves have to be the real ones, and getting either wrong turned this
    check into the thing it exists to prevent.

    Bounding the body by a fixed number of characters read into the NEXT
    function in the file: `Row` in `Edit.tsx` is a heading with no box of its
    own, and a window that ran past its closing brace found an `<input>` four
    functions later and called every `<Row label=...>` in the file a control —
    ten headings reported as undriven controls.

    And the body does not begin at the parameter list. Every component here is
    `function F({ a }: { readonly a: string }) {`, so the first `{` after the
    parameters is a TypeScript type rather than a body. Reading that one found
    no `<input>` anywhere and quietly harvested nothing at all.
    """
    params = balanced(text, opensAt, '(', ')')
    if params is None:
        return None
    opens = text.find('{', params[1])
    if opens < 0:
        return None
    body = balanced(text, opens, '{', '}')
    return (params[0], body[0]) if body else None


def labelledComponents(sources: dict[Path, str]) -> dict[str, list[str]]:
    """Local components that turn a prop into the name of a box.

    `<Field label="Day">` draws a box a person types into and a screen reader
    calls "Day", and a good share of the app's boxes are drawn that way — four
    files declare a `Field` of their own. Finding them means knowing which
    components do it, and the honest test is the component's own body:
    it must contain a real `<input>`, `<textarea>` or `<select>`, and it must
    use the prop.

    That test is why `Row` in `Edit.tsx` — `label` above some children, no box
    of its own — is correctly left out while `Field` and `Measure` are in. A
    rule that took every component with a `label` prop would have called seven
    headings controls.
    """
    found: dict[str, set[str]] = {}
    for text in sources.values():
        for at in re.finditer(r'\bfunction\s+([A-Z]\w*)\s*(?=\()', text):
            name = at.group(1)
            shape = functionBody(text, at.end())
            if shape is None:
                continue
            props, body = shape
            if not any(f'<{box}' in body for box in BOXES):
                continue
            for prop in ('label', 'name'):
                if not re.search(rf'\b{prop}\b', props):
                    continue
                # The prop has to end up as the box's NAME. `Measure` takes
                # both a `name` and a `label`, and the label is the grey hint
                # inside the box — harvesting it collected three controls
                # called "e.g." and no browser ever announces one of those.
                # So: written onto the box as `aria-label`, or shown as the
                # only content of the element that labels it.
                if (f'aria-label={{{prop}}}' in body
                        or re.search(rf'>\s*\{{{prop}\}}\s*<', body)):
                    found.setdefault(name, set()).add(prop)
    return {k: sorted(v) for k, v in found.items()}


def readAloudAsMore(sources: dict[Path, str]) -> list[tuple[str, str, str]]:
    """Components whose box a browser will call something longer than the source says.

    A `<label>` that WRAPS its box names that box with **all** of its own text,
    not just the bit that looks like a label. So

        <label>
          {label}
          {hint && <span>{hint}</span>}
          <input ... />
        </label>

    draws a box a screen reader announces as *"Licence number Some states
    require this on anything given to a homeowner."* -- and the licence field
    really did, along with the business address, the insurance line, the date of
    loss, and a ceiling tickbox carrying sixty words. It is also why
    `getByLabel('Licence number', { exact: true })` found nothing at all.

    This checker was the optimistic one: it read `>{label}<` and recorded the
    short name, so the name it reported and the name the browser computed were
    two different strings and it said nothing about the gap. It is exactly the
    failure it exists to catch, one level in: a control whose real name nobody
    is checking.

    The fix everywhere was `aria-label={label}` on the box itself, which wins
    over the wrapping label. So the rule is: a wrapping `<label>` carrying more
    than the prop, and no `aria-label` on the box, is reported. A label element
    holding nothing but the prop is correct and is left alone.
    """
    out: list[tuple[str, str, str]] = []
    for path, text in sources.items():
        for at in re.finditer(r'\bfunction\s+([A-Z]\w*)\s*(?=\()', text):
            name = at.group(1)
            shape = functionBody(text, at.end())
            if shape is None:
                continue
            props, body = shape
            if not any(f'<{box}' in body for box in BOXES):
                continue
            for prop in ('label', 'name'):
                if not re.search(rf'\b{prop}\b', props):
                    continue
                if f'aria-label={{{prop}}}' in body:
                    continue  # named outright; the wrapper cannot win
                if not re.search(rf'>\s*\{{{prop}\}}\s*<', body):
                    continue
                # Does a <label> wrap a box, and does it carry anything else?
                for label in re.finditer(r'<label\b', body):
                    end = openTagEnd(body, label.start())
                    if end is None:
                        continue
                    shut = body.find('</label>', end)
                    if shut == -1:
                        continue
                    inside = body[end + 1:shut]
                    if not any(f'<{box}' in inside for box in BOXES):
                        continue
                    if not re.search(rf'\{{{prop}\}}', inside):
                        continue
                    # Everything in there that is not the prop and not a box.
                    rest = re.sub(rf'\{{{prop}\}}', '', inside)
                    rest = re.sub(r'<[^>]*>', ' ', rest)
                    words = re.sub(r'\s+', ' ', rest).strip()
                    if len(words) >= 8:
                        out.append((
                            f'{path}: {name}',
                            prop,
                            f'a <label> wraps the box and carries {len(words)} more '
                            f'characters, so the browser reads all of it',
                        ))
                    break
    return out


def drawn(sources: dict[Path, str]) -> list[tuple[str, int, str, Name]]:
    """Every control the app draws, as (file, line, what it is, its name)."""
    wrappers = labelledComponents(sources)
    controls: list[tuple[str, int, str, Name]] = []

    for path, raw in sources.items():
        text = stripComments(raw)
        rel = str(path.relative_to(ROOT))

        def line(at: int) -> int:
            return text.count('\n', 0, at) + 1

        # Buttons. `aria-label` wins over the words inside, exactly as it does
        # in a browser — and getting that backwards is how a control ends up
        # announced as one thing and reachable as another.
        for at in re.finditer(r'<button\b', text):
            end = openTagEnd(text, at.start())
            if end < 0:
                continue
            tag = text[at.start():end]
            label = attribute(tag, 'aria-label')
            if label is not None:
                controls.append((rel, line(at.start()), 'button', fromExpression(label)))
                continue
            if text[end - 1] == '/':
                continue                     # self-closing: no words inside
            close = text.find('</button>', end)
            if close < 0:
                continue
            inner = text[end + 1:close]
            name = fromChildren(inner)
            # A button whose only child is a picture is named by that
            # picture's `alt`, exactly as a browser names it. `Vendor.tsx`
            # has one — a thumbnail of the price tag — and reading only the
            # words inside it called the control nameless.
            if name.kind == 'literal' and not name.text:
                for where in ('alt', 'aria-label'):
                    borrowed = attribute(inner, where)
                    if borrowed is not None:
                        name = fromExpression(borrowed)
                        break
            controls.append((rel, line(at.start()), 'button', name))

        # Boxes with a name of their own written on them.
        for box in BOXES:
            for at in re.finditer(rf'<{box}\b', text):
                end = openTagEnd(text, at.start())
                if end < 0:
                    continue
                label = attribute(text[at.start():end], 'aria-label')
                if label is not None:
                    controls.append((rel, line(at.start()), box, fromExpression(label)))

        # Boxes drawn by a component that was handed their name.
        for component, props in wrappers.items():
            for at in re.finditer(rf'<{component}\b', text):
                end = openTagEnd(text, at.start())
                if end < 0:
                    continue
                tag = text[at.start():end]
                for prop in props:
                    value = attribute(tag, prop)
                    # The component's own body uses the prop as a variable;
                    # only a call site passing something can name a control.
                    if value is not None:
                        controls.append((rel, line(at.start()), component,
                                         fromExpression(value)))
    return controls


# ------------------------------------------------------------------- driven

# `name:` inside a Playwright locator's options, in all four forms the audit
# uses: 'a string', "a string", `a template`, /a regex/, and a bare variable.
NAMED = re.compile(
    r'''name\s*:\s*(?:
        (?P<q>['"])(?P<lit>(?:\\.|(?!(?P=q)).)*)(?P=q)
      | `(?P<tpl>(?:\\.|[^`])*)`
      | /(?P<re>(?:\\.|\[[^\]]*\]|[^/\\])+)/(?P<flags>[a-z]*)
      | new\s+RegExp\(\s*(?P<rq>['"`])(?P<rsrc>(?:\\.|(?!(?P=rq)).)*)(?P=rq)\s*[,)]
      | (?P<var>[A-Za-z_$][\w$.]*)
    )''',
    re.X | re.S,
)

# The one-argument locators: getByLabel('x'), getByPlaceholder(/y/), getByText.
BY = re.compile(
    r'''getBy(?:Label|Placeholder|Text|TestId)\(\s*(?:
        (?P<q>['"])(?P<lit>(?:\\.|(?!(?P=q)).)*)(?P=q)
      | `(?P<tpl>(?:\\.|[^`])*)`
      | /(?P<re>(?:\\.|\[[^\]]*\]|[^/\\])+)/(?P<flags>[a-z]*)
      | new\s+RegExp\(\s*(?:(?P<rq>['"`])(?P<rsrc>(?:\\.|(?!(?P=rq)).)*)(?P=rq))
      | (?P<var>[A-Za-z_$][\w$.]*)
    )''',
    re.X | re.S,
)

# `input[aria-label="Ceiling on the ceiling"]` and `svg[aria-label^="Plan of"]`
# written into a raw CSS selector. Six parts reach for controls this way.
SELECTOR = re.compile(r'aria-label\s*(\^?)=\s*"([^"]*)"')


class Driven:
    """Every name the audit reaches for, in the three shapes it reaches."""

    def __init__(self) -> None:
        self.literals: set[str] = set()
        self.patterns: list[re.Pattern[str]] = []
        self.heads: set[str] = set()          # literal starts, from any shape
        self.unknowable = 0                   # `name: what` — a variable

    def addLiteral(self, text: str) -> None:
        text = collapse(unescape(text))
        if text:
            self.literals.add(text)
            self.heads.add(text)

    def addTemplate(self, text: str) -> None:
        """A template drives whatever its literal head names."""
        body = unescape(text)
        if '${' not in body:
            self.addLiteral(body)
            return
        head = collapse(body[:body.index('${')])
        if len(head) >= SHORTEST_USEFUL_PREFIX:
            self.heads.add(head)
        else:
            self.unknowable += 1

    def addPattern(self, source: str, flags: str) -> None:
        try:
            compiled = re.compile(source, re.I if 'i' in flags else 0)
        except re.error:
            self.unknowable += 1
            return
        # A pattern that matches the empty string matches every control in the
        # app, so it is evidence about none of them. `a9-trade.mjs` builds one
        # out of `new RegExp('^' + name)`; taking the `'^'` at face value made
        # this whole check pass on a tree with thirteen real findings in it.
        if compiled.search(''):
            self.unknowable += 1
            return
        self.patterns.append(compiled)
        # A regex has a literal head too: `/^Set the length of/` says plainly
        # which control it is for, and that head is what matches a control
        # whose own name is `Set ${name}`.
        head = literalHead(source)
        if len(head) >= SHORTEST_USEFUL_PREFIX:
            self.heads.add(head)

    def names(self, text: str) -> bool:
        if text in self.literals:
            return True
        if any(p.search(text) for p in self.patterns):
            return True
        return False

    def beginsWith(self, head: str) -> bool:
        """Whether anything the audit asks for starts with this control's head."""
        return any(asked.startswith(head) for asked in self.heads)


def unescape(text: str) -> str:
    return text.replace('\\n', ' ').replace("\\'", "'").replace('\\"', '"')


def literalHead(source: str) -> str:
    """The plain words a regular expression starts with, and no more.

    `^Take .* off` gives "Take ". Everything from the first metacharacter on is
    thrown away rather than guessed at, because a head that is wrong is worse
    than no head: it would quietly excuse a control nobody drives.
    """
    if source.startswith('^'):
        source = source[1:]
    out = []
    i = 0
    while i < len(source):
        ch = source[i]
        if ch == '\\':
            if i + 1 < len(source) and source[i + 1] in '\\^$.|?*+()[]{}/':
                out.append(source[i + 1])
                i += 2
                continue
            break
        if ch in '.|?*+()[]{}$':
            break
        # A quantifier binds to the character before it, so that one is not
        # part of the head either: `Walls?` starts with "Wall", not "Walls".
        if i + 1 < len(source) and source[i + 1] in '?*+{':
            break
        out.append(ch)
        i += 1
    return collapse(''.join(out))


def driven(sources: dict[Path, str]) -> Driven:
    found = Driven()
    for text in sources.values():
        for pattern in (NAMED, BY):
            for at in pattern.finditer(text):
                if at.group('lit') is not None:
                    found.addLiteral(at.group('lit'))
                elif at.group('tpl') is not None:
                    found.addTemplate(at.group('tpl'))
                elif at.group('re') is not None:
                    found.addPattern(at.group('re'), at.group('flags') or '')
                elif at.group('rsrc') is not None:
                    found.addPattern(at.group('rsrc'), '')
                else:
                    found.unknowable += 1
        for prefixed, value in SELECTOR.findall(text):
            if prefixed:
                head = collapse(value)
                if len(head) >= SHORTEST_USEFUL_PREFIX:
                    found.heads.add(head)
            else:
                found.addLiteral(value)
    return found


# ------------------------------------------------------------------ excused

def excused() -> dict[str, str]:
    """Controls no audit should drive, and the reason each one stays out.

    Keyed by the control's name, not by its file, because the same button is
    drawn in three places and a person reading this file is looking for a
    control rather than for a line number. A control with a list of names is
    keyed by all of them joined with ` / `, which is how this check prints it,
    so the key can be copied straight out of the output.
    """
    if not ON_PURPOSE.exists():
        return {}
    raw = json.loads(ON_PURPOSE.read_text(encoding='utf-8'))
    return {k: v for k, v in raw.items() if not k.startswith('_')}


# --------------------------------------------------------------------- main

# ------------------------------- a handler a parent's onClick makes invisible

# The elements a person does not press: they hold things, they are not controls.
HOLDER = re.compile(r'<(div|section|li|ul|form|article|aside|header|footer|main|nav)\b')
PRESSABLE = re.compile(r'<(button|a)\b')


def shadowedHandlers(sources: dict[Path, str]) -> list[str]:
    """A control whose own handler no audit can ever watch failing.

    ## The blind spot

    `web/src/DamagePhotos.tsx` draws a full-screen photograph in a
    `<div onClick={() => setBig(false)}>`, and puts a **Close** button inside
    it whose handler does the same thing. Click the button and the picture
    closes — whether or not the button's own handler runs, because the click
    bubbles to the div. Replace that handler with a no-op, rebuild, run the
    whole audit: every check stays green. It was tried.

    So the button is driven, `check-controls.py` counts it as driven, and the
    one fact worth knowing about it — that pressing it does what it says — is
    not established by anything. Every reachability check in this repository is
    blind to it by construction.

    ## What this asks for

    Not that a holder may never have an `onClick`. A backdrop that closes on a
    tap is a real and good thing. It asks that a control **inside** one stops
    the click going any further, with `stopPropagation`, so that the control's
    own handler is what ran. That is one line, it makes the control's behaviour
    provable, and it is what a person pressing the button means anyway: they
    pressed the button, not the sheet behind it.
    """
    bad = []
    for path, source in sorted(sources.items()):
        text = stripComments(source)
        rel = str(path.relative_to(ROOT))
        for holder in HOLDER.finditer(text):
            end = openTagEnd(text, holder.start())
            if end == -1:
                continue
            tag = text[holder.start():end + 1]
            # Presence by regex and not by `attribute`, which reads the value
            # with a brace counter of its own and comes back empty on a handler
            # carrying a line comment with an apostrophe in it. This check needs
            # two facts about the tag and both are in the tag's own text.
            if not re.search(r'\bonClick\s*=', tag):
                continue
            # The holder's subtree, by tag depth from its own opening tag.
            #
            # `openTagEnd` and not `TAG`, and that is the whole of it: `TAG` is
            # a naive scan to the next `>`, and this very div carries
            # `onClick={() => setBig(false)}`. The `>` in the arrow ended the
            # tag, the depth count desynchronised, and this check found nothing
            # at all on the two files it was written for. `check-the-checks.py`
            # caught it. It is the same trap `openTagEnd`'s own docstring
            # records, arriving in a second place.
            name = holder.group(1)
            depth = 1
            close = len(text)
            i = end + 1
            while i < len(text):
                nextClose = text.find(f'</{name}', i)
                if nextClose == -1:
                    break
                nextOpen = text.find(f'<{name}', i)
                # `<divider` is not a `<div`. Anything word-ish after the name
                # makes it a different element.
                while nextOpen != -1 and re.match(r'\w', text[nextOpen + 1 + len(name):] or ' '):
                    nextOpen = text.find(f'<{name}', nextOpen + 1)
                if nextOpen != -1 and nextOpen < nextClose:
                    opened = openTagEnd(text, nextOpen)
                    if opened == -1:
                        break
                    if text[opened - 1] != '/':
                        depth += 1
                    i = opened + 1
                    continue
                depth -= 1
                if depth == 0:
                    close = nextClose
                    break
                i = nextClose + len(name) + 2
            inside = text[end + 1:close]
            for control in PRESSABLE.finditer(inside):
                at = openTagEnd(inside, control.start())
                if at == -1:
                    continue
                own = inside[control.start():at + 1]
                if not re.search(r'\bonClick\s*=', own) or 'stopPropagation' in own:
                    continue
                # The CONTROL's line, not the holder's: the fix goes on the
                # control. `inside` starts at `end + 1`, so its offsets are
                # counted from there rather than from the top of the file.
                line = text[:end + 1 + control.start()].count('\n') + 1
                bad.append(
                    f'{rel}:{line}  a <{control.group(1)}> inside a <{name}> that has its own\n'
                    f'      onClick, and the control does not stop the click going further. The\n'
                    f'      parent fires whether or not the control\'s handler ran, so a dead\n'
                    f'      handler here is invisible to every audit that presses it -- measured:\n'
                    f'      replacing one with a no-op left the whole suite green.\n'
                    f'      Add `event.stopPropagation()` so pressing the control is what acts.')
    return bad


def main() -> int:
    if not SRC.is_dir() or not AUDIT.is_dir():
        print('web/src or web/audit is missing, so no control can be compared')
        return 1

    sources = {p: p.read_text(encoding='utf-8') for p in sorted(SRC.rglob('*.tsx'))}
    # Every script in the folder, `lib.mjs` included. The shared helpers drive
    # real controls on behalf of the parts that call them — `section()` clicks
    # a tab, `pick()` selects a wall — and a control driven through a helper is
    # driven.
    parts = {p: p.read_text(encoding='utf-8') for p in sorted(AUDIT.glob('*.mjs'))}
    if not sources or not parts:
        print('no sources or no audit parts were found, so the patterns have drifted')
        return 1

    controls = drawn(sources)
    audit = driven(parts)
    allowed = excused()

    # One control can be drawn in five files; it is one control to a person, so
    # findings are collected by name and every place it is drawn is listed.
    undriven: dict[str, list[tuple[str, int, str]]] = {}
    seen: set[str] = set()
    opaque = 0
    onPurpose: set[str] = set()
    thin: list[str] = []
    stale: set[str] = set()

    for rel, at, what, name in controls:
        if name.kind == 'opaque':
            opaque += 1
            continue
        key = name.text if name.kind == 'prefixed' and not name.alternatives \
            else ' / '.join(name.alternatives)
        seen.add(key)
        if any(audit.names(one) for one in name.alternatives):
            continue
        if name.kind == 'prefixed':
            if name.alternatives and any(audit.beginsWith(one) for one in name.alternatives):
                continue
            # Both directions, and both are real. An audit asking for
            # `Set the length of wall-1` begins with this control's head;
            # `/^How far from the corner it starts/` does not, but it plainly
            # matches the head `How far from the corner it starts, along `,
            # because a regex that matches the beginning of the name matches
            # the beginning of the name.
            if name.text and (audit.beginsWith(name.text) or audit.names(name.text)):
                continue
        if key in allowed:
            onPurpose.add(key)
            continue
        undriven.setdefault(key, []).append((rel, at, what))

    # The excuse file is judged on its own, entry by entry, rather than only
    # when a control happens to reach it. An entry whose control is driven
    # after all never came up in the loop above, so a reason of four words
    # sitting on one was invisible — which is the failure mode this whole file
    # is about, one level up: a rule that only runs sometimes.
    for key, reason in allowed.items():
        if not isinstance(reason, str) or len(reason) < SHORTEST_REAL_REASON:
            thin.append(f'`{key}` — its reason in {ON_PURPOSE.name} is too thin to be one')
        if key not in seen:
            stale.add(f'`{key}` — no control in web/src has this name any more')
        elif key not in onPurpose:
            stale.add(f'`{key}` — the audit drives this one now, so the excuse is spent')

    if undriven:
        # Grouped by the file that draws them, because that is the shape of the
        # work. "FieldSheet.tsx draws three controls nothing has ever pressed"
        # is one afternoon for one person; the same three scattered through an
        # alphabetical list of eighty is a wall nobody climbs. Heaviest file
        # first, so the top of the output is the part of the app with the least
        # evidence behind it.
        print('Controls no part of the audit has ever driven:')
        print()
        byFile: dict[str, list[tuple[int, str, str]]] = {}
        for key, places in undriven.items():
            for rel, at, what in places:
                byFile.setdefault(rel, []).append((at, key, what))
        for rel in sorted(byFile, key=lambda r: (-len(byFile[r]), r)):
            print(f'  {rel} — {len(byFile[rel])}')
            for at, key, what in sorted(byFile[rel]):
                print(f'      {at:>5}  {what:<9} `{key}`')
            print()
        print('    Nothing has ever asked for one of these by name, so nothing has ever')
        print('    had the chance to find out it is off the bottom of the screen, inside a')
        print('    collapsed row, or behind a gate with no way through. Drive it from a')
        print(f'    part in web/audit, or say why it stays out in {ON_PURPOSE.name}.')
        print()

    louder = readAloudAsMore(sources)
    if louder:
        print('Controls a browser will call something longer than the source says:')
        print()
        for where, prop, why in louder:
            print(f'  {where} — `{prop}`')
            print(f'      {why}')
        print()
        print('    A <label> that WRAPS its box names that box with all of its own text.')
        print('    So a field whose source reads `{label}` is announced with the hint')
        print('    beside it as well, and `getByLabel(..., { exact: true })` finds')
        print('    nothing. Put `aria-label={label}` on the box: it wins over the')
        print('    wrapper, and the hint stays on the screen where it belongs.')
        print()

    shadowed = shadowedHandlers(sources)
    if shadowed:
        print('Controls whose own handler nothing can watch failing:')
        print()
        for one in shadowed:
            print(f'  {one}\n')

    if thin:
        print(f'Excused in {ON_PURPOSE.name} with no real reason:')
        for one in thin:
            print(f'  {one}')
        print()

    if stale:
        print(f'Excused in {ON_PURPOSE.name} with nothing left to excuse:')
        for one in sorted(stale):
            print(f'  {one}; delete the entry')
        print()

    print(f'{len(seen)} control names with something literal to compare, '
          f'{opaque} whose name is built at runtime and cannot be checked statically, '
          f'{audit.unknowable} audit locators naming a variable.')

    if undriven or thin or stale or louder or shadowed:
        print(f'{len(undriven)} control name(s) nothing drives, in '
              f'{len({r for p in undriven.values() for r, _, _ in p})} file(s), '
              f'{len(thin)} excused without a reason, '
              f'{len(stale)} stale excuse(s), '
              f'{len(louder)} whose name a browser reads longer than the source, '
              f'{len(shadowed)} whose handler a parent\'s onClick makes invisible.')
        return 1

    print(f'Every one of them is driven by a part of the audit, or is one of '
          f'{len(onPurpose)} excused in {ON_PURPOSE.name} with a written reason.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
