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

## What it does not cover

The iOS half. Capture, the AR walk, the CloudKit backup and the navigation are
Swift, and nothing in this repository has compiled them. `docs/on-the-phone.md`
is the list for that, and it has to be walked on a phone by a person.
