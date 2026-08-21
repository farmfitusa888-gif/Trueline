# Trueline

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

1. **One room, done properly** — scan, correct, 2D + 3D, dimensioned PDF.
2. **Stitch rooms into a floor** — the hard problem, taken while the codebase is small.
3. Projects, accounts, sharing · client output · scan → quantities → price.

Then: multiple floors with stairs, exteriors, site and lot. Android once the data format
is proven.

## Status

| | |
|---|---|
| Tests | **162 passing, 0 failing** (`npm test`) |
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

Also built: **section and dollhouse views** — the ceiling comes off when you look down at the
room, a cut plane slides to any height, and the walls between you and the room come down for an
oblique view. Exact integer geometry, so a viewpoint gives the same answer on every device.

Also built: **the import guard**. A RoomPlan scan always closes perfectly — two real exports,
every wall end meeting its neighbour to within a thousandth of a millimetre — so a closed room
proves nothing about an imported one. A room whose walls were all scanned cannot be issued as a
dimensioned drawing until a person has put a tape on one wall per axis, and the error the
closure check is hiding is reported as a number rather than a shrug.

Checked against real scans: `core/tools/inspect-roomplan.py` reads a RoomPlan export and prints
what it actually contains. Run against Sam's kitchen and garage it found two of the room model's
assumptions wrong, one field missing, and the closure trap above; all of it is written up in
`DECISIONS.md`.

Not built yet: the iOS scanner, the web viewer, the API, anything with a screen.

```bash
cd trueline && npm install && npm test && npm run typecheck
```
