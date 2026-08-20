# Blueprint app — decisions locked

Every line below came from an explicit answer, not an assumption. Nothing here is my
guess. Recorded 2026-08-19.

## Product

| Decision | Answer |
|---|---|
| Repository | New standalone repo, `trueline`, clean API seam to Plumbline later. |
| Business intent | **Sell it.** Start with the friend's company, onboard other contractors after. |
| Tenancy | **Company isolation in the schema from commit one**, used later. Not a retrofit. |
| First useful version | **One room, done properly** — scan, correct any measurement by typing the real number, 2D + 3D, dimensioned PDF out. |
| Second | **Stitch rooms into a floor.** The hard problem taken early, while the codebase is small. |

## Capture

| Decision | Answer |
|---|---|
| Devices | iPhone Pro / iPad Pro — LiDAR present |
| Architecture | **Native iOS scanner** + web for projects, viewer, builder, accounts |
| Why not web-only | WebXR is unsupported in Safari on iOS in 2026; there is no browser path to LiDAR |
| Apple Developer account | **Already held.** No purchase needed, no money gate open. |
| Test hardware | **Both** Sam and the friend have LiDAR devices |
| Android | Deferred. ARCore has no RoomPlan equivalent; data format designed so it can arrive without a rewrite. |
| Offline | **Full offline.** Scan, correct, photograph and annotate with no signal; sync with real conflict resolution when it returns. |

## Measurement

| Decision | Answer |
|---|---|
| Authority | Depth capture measures. **The human's typed number overrides it.** |
| Units | **Feet and inches with fractions by default, per-user metric toggle.** One canonical unit stored underneath so nothing rounds twice. |
| Confidence | Every dimension marked scanned (±) or human-verified (exact), visible on screen and on exports. |
| Photos | Visual record and evidence. Never the ruler. |

## Scope — roadmap, not v1

Interiors first. Then, all confirmed on the roadmap:

- **Multiple floors with stairs** — Apple's own merge refuses to cross floors; this is real
  engineering and it is what "houses" means.
- **Building exteriors** — roofs, elevations, siding. Photos work outdoors where texture exists.
- **Site and lot** — driveways, decks, setbacks, outbuildings, grade.

"Interiors only, forever" was selected alongside these three and confirmed as a mis-click.

## Outputs — all four confirmed

1. **Price the job off it** — quantities to dollars, through the seam to Plumbline.
2. **Show the client** — dimensioned PDF, 3D walkthrough link with no login.
3. **Hand to an architect** — DXF/DWG **with dimensions intact**, which magicplan's own help
   page admits theirs lack.
4. **Insurance restoration** — Xactimate ESX export.

## Occlusion-aware confidence

Raised by Sam while planning the first capture, and it is a feature rather than a caveat.

RoomPlan returns detected objects — 16 categories: storage, sofa, table, chair, bed,
refrigerator, oven, stove, dishwasher, washer/dryer, fireplace, sink, bathtub, toilet, stairs,
TV — as records separate from the walls. Their positions are therefore known.

So the app can work out **which walls it could not actually see**, mark those lower confidence
without being told, and push them to the top of the verification punch list: *"these three walls
had furniture against them — put a tape on these first."* No competitor does this, and the data
needed for it is already in every scan.

Background: Apple names furniture occlusion as a known RoomPlan limitation. On iOS 17 walls
could encroach into the room where furniture sat flush against them, improved in iOS 18. Sam's
test device runs iOS 26.6, far downstream of both, and no findings specific to RoomPlan on iOS 26
were located — his capture is the evidence, not the published complaints.

## Open plans — zones and virtual boundaries

A kitchen running into a dining area running into a living room is one continuous space
that has to be priced as three rooms. The advice the field currently gives is to lay
painter's tape on the customer's floor so the scanner sees a corner.

**A divider is never a wall.** Split an open plan with a wall and the estimate carries
drywall, paint and baseboard for a surface nobody will build. So there are two kinds of edge:

| Edge | Carries |
|---|---|
| **built** — a real wall | drywall, paint, baseboard, cost |
| **virtual** — a line somebody drew | floor and ceiling area only. Nothing else. |

Decided with Sam:

- **Pony walls, breakfast bars and half walls are built**, at their own height rather than
  the room's, because they genuinely get finished and genuinely cost money. `Wall.height`
  is set only when a wall is not full height.
- **Zones are suggested, never imposed.** RoomPlan already detects a stove, refrigerator,
  dishwasher, sofa and table, so the app proposes "kitchen here, living there" and the user
  accepts, drags or deletes. Fast on the common case, never in charge.
- **Zones and the whole are always reported together**, and the total is always exactly the
  sum. Nobody has to add up a list of rooms to find out whether it reconciles — `report()`
  refuses to produce one that does not.
- **Boundaries snap to what is already there** — the jamb of a cased opening, a column, the
  end of an island, a change of flooring. That is the answer to the painter's tape: you tap
  the thing that exists rather than marking the floor.
- **A boundary is a decision, not a measurement.** It records who declared it and when, and
  carries no tolerance, because nobody measured anything.
- **An opening straddling a boundary is credited to each side by how much of it is on that
  side**, by clipping the opening's span to the zone's stretch of wall. Attributing it whole
  to one side would put a door in a room it is only half in.

Scanning an open plan: **one capture, then split in the app.** Scanning the kitchen and the
living room separately would create two coordinate systems for one continuous floor and
invent a seam that is not in the building. Above ~30 x 30 ft it has to be split anyway, and
that is the hardest case in the product — there are no walls to align on, so the captures
must overlap generously and share a feature (a column, a fireplace, a full corner).

## Capture modes — all four, in this order

OpenPlan3D is the reference. What was verified of it: RoomPlan LiDAR capture with walls,
doors, windows and furniture detected; a 3D dollhouse and a 2D plan for review; an editor
that drags walls with live dimensions, splits walls and labels rooms; export to PNG, SVG,
DXF, PDF and USDZ; free, open source, no account; App Store listing says LiDAR required.
**Its licence has not been read and must be before anything structural is borrowed.**

All four modes are committed. The order below is sequencing, not scope — every mode below
ships, and each step is usable before the next begins.

| # | Mode | Why here | Ships |
|---|---|---|---|
| 1 | **Manual draw / type** | Needs no camera, no LiDAR, no hardware in CI. Exercises the solver end to end and forces the data model, the 2D/3D viewer and the PDF to exist. | A complete product on any device: sketch a room, type the tape numbers, get a dimensioned plan. |
| 2 | **LiDAR scan** | Capture now has somewhere to land. Feeds the same `Room` the manual mode produces. | The headline feature, on a model already proven. |
| 3 | **AR measure, no LiDAR** | Same capture pipeline, different sensor, wider tolerance. Mostly reuse by this point. | Every ARKit iPhone, which matters for crews on mixed devices. |
| 4 | **Trace an existing plan** | A different input, but the model and the editor already exist. | The drawer full of old blueprints nobody else can digitise. |

**The reason the order is not LiDAR first:** capture built before there is a model to put it
in gets built twice. Manual mode is the cheapest complete path through the whole system.

### What makes this better than three separate modes

Every mode produces **the same `Room` of the same `Measurement`s**. Only the provenance
differs:

| Mode | Provenance | Tolerance |
|---|---|---|
| LiDAR | `scanned` | tight, from the measured device figure |
| AR without LiDAR | `scanned` | wider |
| Typed from a tape | `verified` | none — a person signed it |
| Traced from an old drawing | `estimated` | from the drawing's scale |

So **the modes mix inside one room**: scan what you can walk, AR-measure the alcove behind
the furnace, type what the 1998 blueprint says about the wall behind the built-ins. Every
number says where it came from and the punch list ranks what to go verify. None of the apps
researched can do this, because none of them carry confidence per dimension.

`estimated` is a fourth provenance kind and is not built yet.

### Manual mode interaction

All three, user picks — typed-first as the launch default, because hitting an exact fraction
by dragging with gloves on is miserable:

- **Typed-first** (default) — tap a wall, type `12' 4 1/2"`, the room re-solves and closes.
- **Drag with live dimensions** — familiar from every floor plan editor.
- **Sketch then interview** — draw a rough outline, then the app asks for each wall in turn.

### Exports — all five

1. **PDF**, dimensioned — v1, the output bar already chosen.
2. **DXF with dimensions intact** — the differentiator. magicplan's own help page admits
   theirs drops dimensions.
3. **USDZ** — opens on any iPhone with no app installed, which makes it the best way to send
   a client a walkthrough.
4. **PNG / SVG** — cheap once the plan renders.

### Positioning

Sell on the correction layer and the confidence first; the scan-to-priced-scope seam through
Plumbline is why the subscription renews. Free tools capture — Trueline gets the number right
and proves who stands behind it, which cannot be copied without rebuilding the data model
underneath it.

## The wedge, most defensible first

1. The **correction layer** — a typed exact measurement re-solves the whole model.
2. **Stitching that holds** across rooms and floors, where Apple's merge gives up.
3. **Confidence marking** — scanned vs. verified on every dimension.
4. **Flat seat pricing** against a market that meters per scan.
5. **Scan → priced scope.**

## Name

**Trueline.** Chosen after screening four candidates for conflicts:

| Candidate | Finding | Verdict |
|---|---|---|
| Datum | Datum Tech Solutions (Boise, 2012) sells 3D laser scanning and BIM software — same market. Also Datum Software, Datum Technologies Group, Datum Technology UK. | Rejected |
| Chalkline | Chalkline, Inc. (2014) makes AECO construction specification software (VisiSpecs). | Rejected |
| Storyframe | An app named Storyframe already ships on both the iOS App Store and Google Play. | Rejected |
| **Trueline** | Only regional contracting companies (True Line Construction, TrueLine Infrastructure). No current construction-software brand found. | **Chosen** |

**Not checked, and not checkable from the build container:** domain registration, App Store
Connect name availability, USPTO trademark. Outbound connections to those hosts are refused by
this environment's network policy. A real trademark clearance is a lawyer's job and must happen
before any money goes into branding.

## Still open

- Nothing. Build proceeds.

## Standing constraints carried from Plumbline

- Never make anything up. No claimed verification that did not run.
- No stubs, placeholders or TODOs shipped as done.
- AI writes language, never facts and never money. Every figure comes from geometry or SQL.
- All questions asked through the question pop-up, four at a time, never buried in prose.
