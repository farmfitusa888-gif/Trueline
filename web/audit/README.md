# The click-through

`npm run audit` from the top of the repository. It builds the web bundle,
serves it, and drives the whole app in a real browser — 105 checks across seven
parts, every fixture it needs in this folder.

```
npm run audit
```

## What it covers

| Part | What it walks |
|---|---|
| `a1-core` | Opening screen, loading a scan, the plan, wall selection by keyboard, the 3D view, the takeoff, ceiling height, wall thickness, typing a tape reading |
| `a2-edits` | Openings, measuring one, a refusal with numbers in it, undo, the picture, the CAD file, the spreadsheet |
| `a3-draw` | Drawing a room by hand with no scan: the closing wall worked out, and a room that reads measured rather than scanned |
| `a4-business` | The profile, the units switch both ways, the letterhead reaching the drawing, the price book, marking a job won |
| `a5-claim` | Insurance mode end to end: the claim, a damaged area with its openings deducted, a cut height, a drying curve, a photograph, the scope, and the claim document opened offline |
| `a6-persist` | A correction surviving a reload, two scans keeping two sets of work, renaming, and a moved wall that never reads as measured |
| `a7-client` | The findings, an override refused without a reason, and the client file opened offline with nothing fetched |

## Why it is written the way it is

**Every check states what should be true, not what the code does.** Several were
written before the thing they check worked, and the point of the exercise is
that a check which merely describes the current behaviour cannot fail.

**It drives the app the way a person does** — by accessible name, by keyboard
where a keyboard is the harder path. That is what makes it able to find the
things unit tests cannot see, and it found two on the first run:

- Every tape-reading box was named after its own placeholder — "e.g. 20'" — so
  with a wall, a ceiling and a door open at once, a screen reader announced
  three identical fields and three buttons called "Set".
- The business toggle kept the accessible name "Your business" while showing
  the word "Close", so it announced the opposite of what it did.

**A refusal is a feature and is checked as one.** An opening pushed past the end
of its wall, an override with no reason, a split that would leave two identical
walls — each has a check that it is refused *and* that the refusal says enough
to act on.

**Anything that leaves the building is opened offline.** The client file and the
claim document are both loaded from `file://` with the network watched, and the
check fails if a single request goes out.

## The sample supplier lists

`lists/` holds six files shaped like what real suppliers hand a contractor.
**Every price in them is invented** — see `lists/README.md` — and they are run
through the importer by `core/src/test/pricelist-shapes.test.ts`, which pins
exactly what each one produces.

## The complete click-through

`a12-everything.mjs` is different from the others and is meant to be. The
eleven before it check features somebody named. This one names nothing: it
walks out from each of the eight sections, finds every button, link, box and
list on the screen, presses each one from its own fresh copy of the app, and
asks four things of it.

1. **Does it have a name a screen reader can say?**
2. **Is that name its own on that screen?** Two controls answering to one name
   is the bug class that has already bitten this app twice.
3. **Does the app survive it?** Nothing thrown, and the navigation still there
   afterwards — a screen you cannot leave is a dead app.
4. **Does it *do* anything?** A button that changes nothing on screen,
   downloads nothing and prints nothing is invisible to every other test here.

Most of the app is behind another control, so it crawls: every state is a path
of names from a fresh app — `Insurance → Yes, this is an insurance job → Mark
the damage` — and to press a control it starts a fresh app and replays the
path. Starting fresh every time is slower than clicking forward and it is the
only way one control's mess cannot be mistaken for the next control's bug. It
takes several minutes.

It found four real things on its first run:

- The "Every dimension" list named each row by its length and nothing else, so
  a rectangular room produced two rows called "20', scanned" and two called
  "21', scanned" — indistinguishable on screen and to a screen reader alike.
- Seven forms answered an empty box by doing **absolutely nothing**. On a phone
  that is indistinguishable from a broken app, and the next move is to press
  harder. They all say what they want now.
- Two "Set" buttons had no accessible name beyond the word "Set", on screens
  where there was more than one of them.

Two of its findings were the harness being wrong rather than the app, and both
were fixed by making the check smarter rather than by excusing the control: a
print button is proved by counting the print call, and an option that is
already the chosen one is expected to change nothing when pressed again.

## What it does not cover

The iOS half. Capture, the AR walk, the CloudKit backup and the navigation are
Swift, and nothing in this repository has compiled them. `docs/on-the-phone.md`
is the list for that, and it has to be walked on a phone by a person.
