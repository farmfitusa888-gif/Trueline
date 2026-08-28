#!/usr/bin/env python3
"""The four ways a scanner lies about the scan it just took.

    python3 core/tools/check-scan.py [root]

## The report this exists for

Sam's phone, 2026-08-27, one message, four separate faults:

> "THE ROOM SCANNER IS NOT WORKING PROPERLY: FIRST ITS SCANNING THE WALLS AND
>  MAKING LINES AND WHEN I HIT DONE, IT BUILDS IT, BUT THERES NO PICS THERE AND
>  THE BLUEPRINT IS JUST A SQUARE AND THE 3D IS HALF A BOX, AND THEN WHEN I GO
>  BACK TO SCANNER, IT SAYS THERE WAS A LOT OF PICS THERE AND IT RESETS FOR THE
>  NEXT SCAN BUT THE NEXT SCAN STARTS LIKE THIS BLACK CAMERA SCREEN."

Every one of them was a lifecycle mistake, and every one of them looked
perfectly reasonable in the diff that introduced it. Not one was a wrong
calculation, an unhandled error or a name a compiler could have caught -- so
none of the checkers already in this folder had anything to say, and the whole
thing reached a contractor standing in somebody's kitchen.

The four rules below are those four faults, written down. Each says what it
refuses and quotes the sentence from that report it belongs to.

## What it checks

1. **A camera preview handed to SwiftUI once and never replaceable.**
   `makeUIView` returning a view it was given rather than one it built, with an
   empty `updateUIView` underneath it. SwiftUI asks for that view exactly once,
   so the screen can never show a second one -- and a `RoomCaptureView` whose
   session has been stopped draws nothing. That is the black camera screen,
   with a live session reporting wall lengths over the top of it.

2. **Something the session publishes about one scan that `reset()` leaves
   set.** Every `@Published` on `ScanSession` describes the scan that is
   happening now. One that survives into the next scan is the app stating a
   fact about a room nobody is standing in: the photograph count that said
   "there was a lot of pics there" before a single frame of the new scan had
   arrived.

3. **A delegate callback that writes down a result without checking whose it
   is.** `RoomBuilder` takes seconds on a big room, and RoomPlan delivers when
   it is ready rather than when anybody is waiting. A callback that stores its
   room without asking whether that session is still the live one puts a room
   from a walk that was abandoned into the place the next scan reads from --
   the square blueprint and the half box.

4. **A photograph moved with `try?`.** `photos.json` is written before the
   pictures are carried across, listing every one of them by name. A move whose
   error is swallowed leaves a room claiming evidence its folder does not hold,
   and nothing downstream can tell that from a walk where nobody took any.

## What it does not check

Anything that needs a running phone: whether RoomPlan actually redraws, whether
a rebuilt view attaches in time, whether a scan is any good. There is no Mac and
no device here. These are four textual invariants that were each true before the
bug and false after it, which is the most a file can promise.
"""
import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[2]
IOS = ROOT / 'ios'

# The files one scan passes through, start to finish. Rule 4 is scoped to these
# on purpose: every other place in the app that moves a file is moving somebody
# else's file for somebody else's reason, and a checker that wandered into them
# would be making rules for code it has not read.
SCANNER = [
    'ScanScreen.swift',
    'ScanModel.swift',
    'ScanSession.swift',
    'CaptureWriter.swift',
    'PhotoRecorder.swift',
    'ReviewScreen.swift',
]

COMMENT = re.compile(r'//[^\n]*')
BLOCK_COMMENT = re.compile(r'/\*.*?\*/', re.S)
STRING = re.compile(r'"(?:[^"\\\n]|\\.)*"')


def scrub(source: str) -> str:
    """Comments and string bodies blanked, offsets kept.

    Kept the same length so a line number worked out from an offset in the
    scrubbed text is the line number in the file somebody has open. A checker
    that points at the wrong line is a checker people stop reading.
    """
    def blank(m: re.Match) -> str:
        return ''.join(c if c == '\n' else ' ' for c in m.group(0))
    return STRING.sub(blank, COMMENT.sub(blank, BLOCK_COMMENT.sub(blank, source)))


def bodyAt(text: str, brace: int) -> tuple[str, int]:
    """The text between a `{` and the `}` that closes it, and where that is."""
    depth = 0
    for i in range(brace, len(text)):
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
            if depth == 0:
                return text[brace + 1:i], i
    return text[brace + 1:], len(text)


def lineOf(text: str, offset: int) -> int:
    return text[:offset].count('\n') + 1


def funcBody(text: str, name: str) -> tuple[str, int] | None:
    """One function's body and the offset it starts at, by name."""
    found = re.search(r'\bfunc\s+' + re.escape(name) + r'\s*\([^\n]*?\{', text)
    if not found:
        return None
    brace = text.rindex('{', found.start(), found.end())
    body, _ = bodyAt(text, brace)
    return body, found.start()


TYPE = re.compile(r'\b(?:struct|final class|class|enum|extension|actor)\s+(\w+)[^{\n]*\{')


def typesIn(text: str) -> list[tuple[str, str, int]]:
    """(name, body, offset) for every type declaration in a file."""
    found = []
    for match in TYPE.finditer(text):
        brace = text.index('{', match.end() - 1)
        body, _ = bodyAt(text, brace)
        found.append((match.group(1), body, match.start()))
    return found


# ------------------------------------------------------- 1. the black camera

MAKE = re.compile(r'func\s+makeUIView\s*\(\s*context\s*:\s*Context\s*\)\s*->\s*(\w+)\s*\{')


def previewCannotBeReplaced(rel: str, raw: str, text: str) -> list[str]:
    """`makeUIView` hands back a view it did not build, and nothing swaps it.

    The two halves together are the fault, and neither alone is.

      * Building the view inside `makeUIView` is the ordinary case -- every
        other representable in this app does it, and a view SwiftUI built is a
        view SwiftUI will rebuild when its identity changes.
      * An empty `updateUIView` is ordinary too, on a view that never changes.

    Handing back a stored view AND never updating is the combination that
    cannot recover: SwiftUI took a permanent reference to a specific object, and
    when the model replaces that object the screen goes on showing the dead one.
    On a `RoomCaptureView` whose session has been stopped, "the dead one" draws
    a black rectangle -- while the new session, which is perfectly alive,
    reports wall lengths and a photograph count over the top of it.
    """
    bad = []
    for name, body, offset in typesIn(text):
        if 'UIViewRepresentable' not in text[offset:offset + 200]:
            continue
        made = MAKE.search(body)
        if not made:
            continue
        returns = made.group(1)
        built, _ = bodyAt(body, body.index('{', made.end() - 1))
        # A view it built itself. `UIView(`, `ARSCNView(`, `WKWebView(` -- the
        # return type's own initialiser, anywhere in the body.
        if re.search(r'\b' + re.escape(returns) + r'\s*\(', built):
            continue
        update = funcBody(body, 'updateUIView')
        if update is None:
            continue
        if update[0].strip():
            continue
        bad.append(
            f'{rel}:{lineOf(raw, offset)}  {name} hands SwiftUI a view it was given, '
            f'and never swaps it.\n'
            f'      `makeUIView` returns a stored {returns} and `updateUIView` is empty, so\n'
            f'      the object SwiftUI took on the first render is the only one this screen\n'
            f'      can ever show. Replace the view in the model and the screen keeps the\n'
            f'      dead one -- which for a stopped capture session is a black picture with\n'
            f'      live numbers on top of it.\n'
            f'      Hold a plain container and put the current view inside it in '
            f'`updateUIView`.')
    return bad


# ------------------------------------------------ 2. what reset leaves behind

PUBLISHED = re.compile(r'@Published[^\n]*?\b(?:let|var)\s+(\w+)', re.M)
# `x = ...`, `x += ...`, and `self.x = ...`. Not `x == y`, which is a question.
def assigned(body: str, name: str) -> bool:
    return re.search(r'(?<![.\w])(?:self\.)?' + re.escape(name) + r'\s*(?:\+=|-=|=(?!=))',
                     body) is not None


def resetLeavesSomethingSet(rel: str, raw: str, text: str) -> list[str]:
    """A `@Published` on `ScanSession` that `reset()` does not put back.

    `ScanSession` is one scan. Every value it publishes -- the walls found so
    far, how many photographs have been taken, what the coaching is saying -- is
    a statement about the room somebody is standing in right now. Carrying one
    into the next scan is the app telling somebody something that is not true
    about the room they are in, and it is invisible in review because the line
    that would have cleared it is a line nobody wrote.

    > "IT SAYS THERE WAS A LOT OF PICS THERE"

    That was `photoCount`, still holding the last room's total, on a scan that
    had not taken a photograph yet.

    Assignments are counted through the calls `reset()` makes inside the same
    type as well as in its own body, because clearing a value in the function
    that owns it -- `stop()` putting `isRunning` down -- is right and should not
    have to be repeated.
    """
    session = next((body for name, body, _ in typesIn(text) if name == 'ScanSession'), None)
    if session is None:
        return []
    reset = funcBody(session, 'reset')
    if reset is None:
        return [f'{rel}  ScanSession has no reset(), and a scanner on a tab needs one.']

    reach = reset[0]
    # One level of the calls reset() makes, then one more. Two is enough for
    # `reset -> retire -> stop` and stops well short of walking the whole file.
    for _ in range(2):
        for call in set(re.findall(r'(?<![.\w])(\w+)\s*\(\s*\)', reach)):
            called = funcBody(session, call)
            if called is not None:
                reach += '\n' + called[0]

    bad = []
    for match in PUBLISHED.finditer(session):
        name = match.group(1)
        if assigned(reach, name):
            continue
        # Pointed at the declaration in the file somebody has open, not at the
        # copy of it this check is reading.
        found = re.search(r'@Published[^\n]*?\b(?:let|var)\s+' + re.escape(name) + r'\b', raw)
        line = lineOf(raw, found.start()) if found else 1
        bad.append(
            f'{rel}:{line}  ScanSession publishes `{name}` and reset() never puts it back.\n'
            f'      Everything this class publishes is about the scan that is happening\n'
            f'      now. One that survives into the next scan is the screen stating a fact\n'
            f'      about a room nobody is standing in -- which is exactly what "IT SAYS\n'
            f'      THERE WAS A LOT OF PICS THERE" was.\n'
            f'      Clear it in reset(), or in something reset() calls.')
    return bad


# ------------------------------------------- 3. a result from somebody else's scan

def callbackStoresWithoutChecking(rel: str, raw: str, text: str) -> list[str]:
    """A `RoomCaptureSessionDelegate` callback that writes without `isLive`.

    RoomPlan delivers when it is ready. `stop()` sets a `RoomBuilder` going and
    it takes as long as the room is big, so a callback can land after the person
    has left the tab, after the model has been reset, and after the next scan
    has started. Every one of these callbacks names the session it is speaking
    for; asking whether that is still the live one costs a line and is the
    difference between a room from this walk and a room from the last one.

    > "THE BLUEPRINT IS JUST A SQUARE AND THE 3D IS HALF A BOX"

    That was a `CapturedRoom` built from a few seconds of looking around before
    the real walk began, arriving late, landing in `finished`, and being saved
    by the next press of Done before that scan's own room had been built.

    The check is an ordering one, and it has to respect BLOCKS rather than only
    position -- which the first version did not, and that flaw would have let
    the original bug through.

    `didEndWith` opens with `if let error { guard self.isLive(session) ... }`
    and then goes on to `do { ... self.finished = room }`. A rule that asks only
    "is there an isLive earlier in this body" sees the guard in the error branch
    and calls the success branch protected. It is not: that block closed before
    this one opened. Taking the real guard off `self.finished` left the check
    silent, which was proved by putting the mutation into `check-the-checks.py`
    and watching it NOT fire.

    So a guard protects a write only while the block the guard sits in is still
    open. A guard that asks and then does not act on the answer is still not
    something text can see -- but a body that never asks in the branch that
    writes now is, and that is the mistake that was made.
    """
    bad = []
    for match in re.finditer(r'nonisolated\s+func\s+captureSession\s*\(', text):
        brace = text.find('{', match.end())
        if brace < 0:
            continue
        body, _ = bodyAt(text, brace)

        # Where each `isLive(` sits, and where the block containing it closes.
        # Everything between the two is guarded; everything after it is not.
        asked = []
        for m in re.finditer(r'\bisLive\s*\(', body):
            depth = 0
            ends = len(body)
            for i in range(m.start(), len(body)):
                if body[i] == '{':
                    depth += 1
                elif body[i] == '}':
                    if depth == 0:
                        ends = i
                        break
                    depth -= 1
            asked.append((m.start(), ends))

        for write in re.finditer(r'\bself\.([\w.]+)\s*(?:\+=|=(?!=))', body):
            if any(at < write.start() < closes for at, closes in asked):
                continue
            bad.append(
                f'{rel}:{lineOf(raw, match.start())}  a capture-session callback stores '
                f'`{write.group(1)}` without asking whose scan it is.\n'
                f'      RoomPlan answers when it is ready, not when anybody is waiting. On a\n'
                f'      big room `RoomBuilder` runs for seconds, so this line is reached long\n'
                f'      after Done was pressed -- and writing a room from a session that is\n'
                f'      over into the place the NEXT scan reads from is the square blueprint\n'
                f'      and the half box.\n'
                f'      Guard on isLive(session) before writing anything down.')
    return bad


# --------------------------------------------- 4. a photograph moved with try?

CARRIED = re.compile(r'try\?[^\n]*\b(?:moveItem|copyItem)\s*\(')


def photographMovedQuietly(rel: str, raw: str, text: str) -> list[str]:
    """`try?` on the call that carries a scan's photographs to its folder.

    `photos.json` is written first and lists every photograph the walk took, by
    name. The pictures follow. A move whose error is swallowed leaves the two
    disagreeing, and the room then claims evidence its own folder does not hold
    -- indistinguishable, from every screen downstream, from a walk where nobody
    took a photograph at all.

    > "IT BUILDS IT, BUT THERES NO PICS THERE"

    Nothing here says the save must fail. The room is real and worth keeping.
    It says the app has to know which pictures did not make it, so it can say
    so and so it can leave them where they still are.
    """
    bad = []
    for match in CARRIED.finditer(text):
        bad.append(
            f'{rel}:{lineOf(raw, match.start())}  a photograph is moved with `try?`.\n'
            f'      photos.json has already been written and already lists it. If this line\n'
            f'      fails, the question mark eats the reason, the save reports success, and\n'
            f'      the room says it holds photographs its folder does not have.\n'
            f'      Move them one at a time and hand back the names that did not land.')
    return bad


# ------------------------------------- 5. a scan filed under a name of its own

# `SavedScan(... title: <something>)`, and what that something is.
FILED_AS = re.compile(
    r'SavedScan\s*\((?P<args>[^)]*)\)',
    re.S,
)
TITLE_ARG = re.compile(r'\btitle\s*:\s*([^,\n]+)')


def filedUnderTheTypedName(rel: str, raw: str, text: str) -> list[str]:
    """A scan filed under the name somebody typed rather than the folder's.

    ## The report this is the answer to

    > "I JUST SCANNED MY ENTIRE GARAGE AND WHEN IT FINISHED THERE WAS JUST A
    >  GENERIC SQUARE BLUEPRINT AND 3D."

    `SavedScan.title` crosses the bridge as `fileName`, and `fileName` is the
    key the web half files a room under -- in that browser's storage and in the
    Rooms list. The folder carries a date; the typed name does not. So every
    scan a contractor called "Garage" shared one key and one room, and the
    second walk overwrote the first.

    Worse, the same folder reached from the Rooms list comes over as
    `folder.lastPathComponent` -- `ProjectStore.load` and `keepMarks` both do
    that -- so one scan had two names depending on which screen you came from,
    and corrections made one way were invisible the other way.

    The rule is narrow and mechanical: whatever builds a `SavedScan` takes its
    title from the folder. Nothing here says which folder, or what it is called.
    """
    bad = []
    for match in FILED_AS.finditer(text):
        title = TITLE_ARG.search(match.group('args'))
        if title is None:
            continue
        said = title.group(1).strip()
        if 'lastPathComponent' in said:
            continue
        # A bare identifier is allowed only when the line that made it, IN THIS
        # SAME METHOD, read the folder. `keepMarks` does exactly that one line
        # above its own `SavedScan`.
        #
        # Scoped to the method and not to the file, and that is the whole of it:
        # searching the file excused `save()` on the strength of a `let name =
        # folder.lastPathComponent` seventy lines earlier in a different
        # function, and the check then passed on the very defect it was written
        # for. `check-the-checks.py` caught that, which is what it is for.
        if re.fullmatch(r'\w+(?:\.\w+)?', said):
            start = max(
                (m.end() for m in re.finditer(r'\n    (?:\w+ )*func\b', text[:match.start()])),
                default=0,
            )
            made = [
                m for m in re.finditer(
                    r'\b(?:let|var)\s+' + re.escape(said.split('.')[0]) + r'\s*=\s*([^\n]+)',
                    text[start:match.start()],
                )
            ]
            if made and 'lastPathComponent' in made[-1].group(1):
                continue
            if said == 'entry.name':
                # `ProjectStore.Entry.name` IS `folder.lastPathComponent`, set
                # in `refresh()` two dozen lines up and nowhere else.
                continue
        bad.append(
            f'{rel}:{lineOf(raw, match.start())}  a scan is filed as `{said}`, not as its folder.\n'
            f'      `title` crosses the bridge as `fileName`, and `fileName` is the key the\n'
            f'      web half files the room under. The folder carries a date and the typed\n'
            f'      name does not, so two scans of the same room share one key and the\n'
            f'      second overwrites the first. Use the folder\'s lastPathComponent.')
    return bad


# --------------------------- 6. a capture written into a folder already in use

MADE_FOLDER = re.compile(r'store\.folder\s*\(\s*named:\s*CaptureWriter\.folderName')


def capturesIntoAResidentFolder(rel: str, raw: str, text: str) -> list[str]:
    """A new capture given a folder without asking whether one is already there.

    `createDirectory(withIntermediateDirectories: true)` succeeds on a folder
    that already exists, so a second scan of the same name in the same second
    writes its `room.json` into the first one's folder and inherits its
    `corrected.json`. A corrected room outranks a capture all the way to the web
    view, so the walk somebody has just finished is never shown at all -- they
    get the older room back, corrections and all.

    `store.freeFolder(named:)` counts up until it finds one nobody is in.
    """
    bad = []
    for match in MADE_FOLDER.finditer(text):
        bad.append(
            f'{rel}:{lineOf(raw, match.start())}  a capture is given a folder that may\n'
            f'      already hold one. `createDirectory` succeeds on a folder that is there,\n'
            f'      so the arriving scan inherits the resident one\'s corrected.json -- and\n'
            f'      a corrected room outranks a capture, so the new walk is never shown.\n'
            f'      Use `store.freeFolder(named:)`.')
    return bad


def main() -> int:
    bad: list[str] = []
    seen = 0

    for path in sorted(IOS.rglob('*.swift')):
        raw = path.read_text(encoding='utf-8')
        text = scrub(raw)
        rel = str(path.relative_to(ROOT))
        seen += 1

        bad += previewCannotBeReplaced(rel, raw, text)
        if path.name == 'ScanSession.swift':
            bad += resetLeavesSomethingSet(rel, raw, text)
            bad += callbackStoresWithoutChecking(rel, raw, text)
        if path.name in SCANNER:
            bad += photographMovedQuietly(rel, raw, text)
        bad += filedUnderTheTypedName(rel, raw, text)
        bad += capturesIntoAResidentFolder(rel, raw, text)

    if bad:
        print('The scanner can lose a scan this way:\n')
        for one in sorted(set(bad)):
            print(f'  {one}\n')
        print('Each of these is one of the four faults in Sam\'s report of 2026-08-27.')
        print('None of them is a compile error and none of them is a wrong number, which')
        print('is why they reached a contractor standing in a kitchen.')
        return 1

    print(f'{seen} Swift files: the camera can be rebuilt, reset() puts every published')
    print('value back, no capture callback stores a room without asking whose it is,')
    print('no photograph is carried across with a swallowed error, every scan is filed')
    print('under its own folder, and no capture is written into a folder already in use')
    return 0


if __name__ == '__main__':
    sys.exit(main())
