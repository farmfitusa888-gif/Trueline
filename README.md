<img src="./assets/logo/trueline-wordmark.svg" alt="Trueline" width="380">

Scan a building, correct it by hand, get a blueprint.

LiDAR capture on iOS, 2D and 3D on the web, and — the part nobody else does — a typed
measurement that re-solves the whole model around it.

## Why this exists

A remodeler still spends 8 to 24 hours measuring one house by hand. Six scanning apps
already exist and none of them does this job: Hover owns exteriors, magicplan owns insurance
restoration, Polycam owns raw 3D and paywalls the dimensions, Canvas pays humans to redraw
your scan, Matterport says outright that its floor plans "should not be used for construction
or renovation planning."

The contractor doing interior as-builts to price a job is served by pieces of all of them and
the whole of none.

Full research: [`MARKET-RESEARCH.md`](./MARKET-RESEARCH.md). Decisions: [`DECISIONS.md`](./DECISIONS.md).

## The rules this is built on

- **Depth capture measures. The human's typed number overrides it.** Photos are the visual
  record and the evidence — never the ruler.
- **Every dimension is marked scanned (±) or human-verified (exact)**, on screen and on every
  export. Somebody ordering cabinets needs to know which is which.
- **A correction propagates.** Type one wall's real width and every connected room, corner,
  opening and quantity moves with it. Editing a number without re-solving is what every
  competitor already does.
- **Dimensions are never paywalled.**
- **Full offline.** Scan, correct, photograph and annotate with no signal; sync with real
  conflict resolution when it returns.
- **AI writes language, never facts and never money.** Every figure comes from geometry or SQL.

## Shape

| Piece | Runs where | Why |
|---|---|---|
| Scanner | Native iOS (LiDAR / RoomPlan) | WebXR is unsupported in Safari on iOS; there is no browser path to LiDAR |
| Projects, builder, 2D/3D viewer, accounts | Web | Works on any tablet or desktop, no install |
| Ledger / estimating seam | Plumbline, over an API | Separate product, clean boundary |

## Build order

1. **One room, done properly** — scan, correct, 2D + 3D, dimensioned CAD out. **Done.**
2. **Stitch rooms into a floor** — the hard problem, taken while the codebase was small.
   **Done:** rooms joined by tapping the same door in each, placed exactly, with loop
   closure reported rather than smoothed away.
3. **Out the door** — takeoff, price book, priced quote, one self-contained file a
   homeowner opens with no app and no login. **Done.**

Next, in `docs/v3.md`: scan → priced scope, the hosted client link, re-scan and diff,
exteriors. Then multiple floors with stairs, site and lot. Android once the data format
is proven.

## Status

| | |
|---|---|
| Tests | **462 passing, 0 failing** (`npm test`) |
| Typecheck | clean (`npm run typecheck`) |
| Verified against | Node 22.22 |

Built so far: `core/` — the measurement layer and the geometry on top of it. Exact lengths in bigint nanometres,
feet-inches-fractions parsing and formatting, metric, and the provenance model that marks
every number scanned, verified or derived and refuses to let a sensor's guess read like a fact.

Also built: the rectilinear solver that re-closes a room around a typed measurement, and the
zone model that splits an open plan into named areas without pretending there is a wall
between them.

Also built: **manual draw mode** — a room typed in wall by wall, with the closing wall worked
out rather than asked for, and the DXF completion that gives every dimension the geometry a
viewer needs to draw it.

Also built: **angled walls**. Almost every wall in a real scan is square to within a
thousandth of a degree — but not all of them, and a 203 mm corner chamfer at 70° is ordinary
rather than exotic. A wall may now carry an exact run in x and y instead of a compass heading.
The run is the truth and the length is derived from it, so the room still closes on exact
integers; the angled wall is held fixed while the square ones absorb the error, because
stretching a chamfer to make the arithmetic work would quietly change its angle.

Also built: **section and dollhouse views** — the ceiling comes off when you look down at the
room, a cut plane slides to any height, and the walls between you and the room come down for an
oblique view. Exact integer geometry, so a viewpoint gives the same answer on every device.

Also built: **the import guard**. A RoomPlan scan always closes perfectly — two real exports,
every wall end meeting its neighbour to within a thousandth of a millimetre — so a closed room
proves nothing about an imported one. A room whose walls were all scanned cannot be issued as a
dimensioned drawing until a person has put a tape on one wall per axis, and the error the
closure check is hiding is reported as a number rather than a shrug.

Also built: **the RoomPlan importer**. The floor polygon says what the outline is; the walls say
where it is. An edge with no wall across it becomes an open span rather than a hole in the data;
a wall on no edge of the outline is left out and listed; a real angle survives and sensor noise
is straightened. Run against Sam's kitchen and garage it produces 175.3 and 418.0 sq ft — the
areas of the outlines they came from — and both rooms are refused as drawings until somebody
measures them.

Checked against real scans: `core/tools/inspect-roomplan.py` reads a RoomPlan export and prints
what it actually contains. Run against Sam's kitchen and garage it found two of the room model's
assumptions wrong, one field missing, and the closure trap above; all of it is written up in
`DECISIONS.md`.

**There is a screen.** `web/` is the web shell, and its first page is the import-correction
screen: drop a RoomPlan `room.json` on it and you get the plan, every dimension marked scanned
or measured, what the scanner could not see and why, and a box to type the real number into —
after which the whole room re-solves around what you said. No server, nothing uploaded.

It keeps your corrections in the browser between visits, and it produces **a list to carry** —
the four walls worth a tape, ranked, as plain text you can send to a phone or print. `netlify.toml`
deploys the whole thing as a static site with no backend.

**The scanner is written** — `ios/`, a SwiftUI app on Apple's RoomPlan. It shows wall lengths
live while you walk, photographs the room every two seconds and on a shutter press with the
camera's exact pose attached to each shot, and hands the finished scan straight to the
correction screens running in a web view inside the same app. One measurement engine, not two.
**It has not been compiled** — this repository is developed on Linux, where there is no Xcode —
so it needs a first build on a Mac. `ios/README.md` has the steps.

**AR measure is built too** — for a phone with no LiDAR: tap each corner, walk to the next, and
finish by tapping the first corner again. That closing tap is not part of the room; it is the
measurement of how well the pointing went, and it is where the band on every wall comes from.
Nobody publishes how accurately a person can place a point in AR by eye, so rather than invent a
figure, the app asks you to produce one.

Either way the room is corrected identically — same plan, same solver, same words. **How a room
was captured changes nothing about how it is corrected.**

`ios/Trueline.xcodeproj` is checked in: open it, set your signing team, press Run.

Not built yet: manual draw's screen, the API, accounts, exports.

```bash
cd trueline && npm install && npm test && npm run typecheck
npm run dev          # then drop a room.json on the page
```
