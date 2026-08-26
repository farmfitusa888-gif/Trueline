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

## The state seventeen parts never tried

**A18 exists because 264 checks walked past a bug the first hour on a phone
found.** Every paid screen in the app — Takeoff, Price, Agreement, Work,
Insurance — was drawing an empty panel. Not a paywall. Nothing.

The reason nothing here saw it is worth writing down, because it is the shape of
the next one too. A10 tests the gate from both sides, properly, and it does it
by loading a room through the file picker and then calling `setSubscribed` on a
page that is already up. **That is a state the phone is never in.** On a phone
the app hands the room over to a page that may not have run its modules yet, so
the payload is parked on the window for the page to collect — and the parked
payload carried the room and nothing else. The subscription answer was dropped,
and `Gate` returned `null` for good.

So A18 does two things nothing else did:

1. It parks the payload **before the page loads**, which is what actually
   happens, rather than talking to a page that is already running.
2. It asserts a rule rather than a screen: **no panel is ever empty**, in any
   state, including the one where the app never answers at all. Eight sections,
   three states, twenty-four checks that do not care what the screen is
   supposed to say — only that it says something.

That second one is the check worth copying. Every other part in this folder
tests that a specific screen shows specific words, and a screen showing nothing
passes none of them and fails none of them either, because nothing asks.

It found two more real things on its first run, neither of which anybody had
reported:

- Standing inside a room, two of three wall labels landed at x = 3920 and
  x = -3536 in a 386-pixel picture. A perspective view projects a wall you are
  nearly parallel to thousands of pixels off both sides; the SVG clips it so it
  looks ordinary, and the label goes with it. One label appeared where there
  should have been three, and it looked like a feature that worked.
- **Tapping a wall in the 3D view had never done anything**, in either the orbit
  or the inside view, for as long as the screen has existed. The view captured
  the pointer on `pointerdown`, and a captured pointer sends the `click` that
  follows to the capturing element rather than to the polygon under the finger.
  The screen said "Tap a wall to measure it" the whole time.

## Do not touch the tree while it is running

Twice in one afternoon a part came back failed and the failure was the harness,
not the app:

- `npm run build` under the running preview server — A12 died mid-navigation on
  `ERR_HTTP_RESPONSE_CODE_FAILURE`, because `dist` was being rewritten while a
  page was loading out of it.
- A handbook card added while the audit was in flight — A13 reported "56 on
  screen, 57 in the source", which was exactly true and entirely self-inflicted:
  the root `prebuild` is what copies `docs/handbook.html` into `web/public`, and
  it had run before the edit.

Both cost a full re-run and a few minutes of believing a real bug had appeared.
The audit builds and serves from the working tree, so an edit during a run is a
change to the thing being measured. Start it, leave it alone, read it when it
finishes.

## What it does not cover

The iOS half. Capture, the AR walk, the CloudKit backup and the navigation are
Swift, and nothing in this repository has compiled them. `docs/on-the-phone.md`
is the list for that, and it has to be walked on a phone by a person.
