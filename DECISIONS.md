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

## OpenPlan3D's licence — MIT, read not assumed

`LICENSE` at `laanlabs/openPlan3D`, read directly rather than taken from a summary:
**MIT, copyright 2026 theLodgeStudio.**

Use, copy, modify, merge, publish, distribute, sublicense and sell are all permitted,
including inside a closed-source commercial product. The single condition is that the
copyright notice and permission notice travel with any copy or substantial portion.

**So their code can be used.** No copyleft, nothing that touches Trueline's licensing or
its sale. The cost is a `NOTICES` file in the repository and an acknowledgement in the app.

An earlier note in this file warned that a GPL licence would force Trueline open source.
That warning was disproportionate in a second way as well: copying *features* never carries
a licence obligation at all — functionality and UI ideas are not protected by copyright.
Only copied source would have attached one.

Their editor is SvelteKit and Three.js. The renderer, the interaction and the exporters are
the expensive, model-agnostic parts and are worth taking. Their data model is not: every
differentiator in Trueline — nanometre integers, per-dimension provenance, zones with virtual
boundaries — lives in the model, and adopting theirs would give all of it away.

## Photos during capture

Verified: `RoomCaptureSession` exposes its underlying `ARSession`, and from iOS 17 RoomPlan
accepts a custom `ARSession` with an `ARWorldTrackingConfiguration`. Every `ARFrame` carries
the camera transform and intrinsics, and `arFrameReferenceOriginTransform` (returned in
`didEndWith`) puts them in the finished room's coordinate space.

- **Stills with poses**, not video. A photo you can tap is worth more on site than footage
  to scrub, and a still pins to a wall while a video does not.
- **Automatic on a new viewpoint, plus a shutter button.** Capture when the camera has moved
  or turned enough to see something genuinely new, rather than on a timer — a timer produces
  duplicates down a slow wall and misses a fast corner.
- **In manual draw mode too, as an option the user turns on.** Somebody typing a room off a
  tape still wants the wall photographed. There is no ARKit pose to hang it on, so those
  photos attach to the wall the user was editing rather than to a camera position.
- **Attached to the wall they see, browsable as a project roll, and exportable into the client
  PDF.** They stay on the device until a deliberate sync, and behave as ordinary project data
  under normal roles after that.
- **Never retain `ARFrame` objects** — the ARSession delegate holding frames is a known memory
  problem. Copy the pixel buffer and the transform, then release.
- A high-resolution still capture during an active session was **not** verified. Frames from
  the AR session are video resolution until somebody checks otherwise.

## Obstruction — proving why a wall is uncertain

Built. RoomPlan returns detected objects separately from walls, with positions, so the app
works out which walls something was standing against and how much of each that hides.

- Footprints arrive as axis-aligned boxes computed on the device. An object at an angle gets
  a box larger than itself and therefore over-reports how much it blocks. That is the safe
  direction: it sends somebody to check a wall that turned out fine, rather than leaving a
  bad dimension unflagged.
- **Reach defaults to six inches** — roughly where furniture stops leaving the wall-floor
  joint visible. It is a default, not a fact, and it is a parameter so real captures can
  replace it.
- The punch list ranks by floor area at stake multiplied by the share of the wall that was
  blocked, so a long uncertain wall nobody could see outranks a short one merely guessed at.
- A verified wall never appears, whatever stands in front of it. What the sensor could see
  stopped mattering the moment a person signed for the number.

## What to take from them, and what it costs

### The DXF recommendation was wrong, and here is the correction

I recommended lifting their DXF exporter as "weeks saved". Checking it: their DXF export
uses the **`dxf-writer`** npm package — MIT, version 1.18.4, last published about four years
ago — which supports line, polyline, 3DFace, arc, circle and text. **It has no DIMENSION
entity.**

So their DXF cannot carry live dimensions either. There is nothing valuable to lift, and the
differentiator needs a writer that emits real `DIMENSION` entities. `@tarikjabiri/dxf`
(`dxfjs/writer`) surfaced as a TypeScript DXF generator and is the candidate — **its
dimension support and its licence have not been verified** and must be before it is promised
to anyone.

### What MIT actually obliges

One thing: ship their copyright notice and permission notice with any copy or substantial
portion. In practice a `NOTICES` file in the repository and an acknowledgements screen in the
app.

It does **not** restrict keeping Trueline closed source, selling it, modifying their code,
declining to contribute anything back, or combining it with proprietary code.

Two costs that are real but not legal:

- **No warranty.** Their bugs become our bugs, and our customers blame us, not them.
- **MIT is silent on patents**, where Apache 2.0 grants them explicitly. Negligible here, but true.

### It cannot jeopardise the photo work — they do not touch

Their code is TypeScript running in a browser. Photo and pose capture is Swift and ARKit
running on the phone. Different language, different device, different process. The single
contact point is that at export time geometry is handed to an exporter, and DXF cannot carry
a photo pose regardless — it is a 2D vector drawing format.

Worth stating once: **at the DXF boundary, provenance and exactness are lost.** DXF stores
floating-point drawing units. That is the format, not their code. What can survive is
confidence as **layers** — verified dimensions on one layer, scanned on another — which
nobody currently does.

### Decided: take the Three.js rendering, nothing else

| | Take renderer only | Take everything including the model |
|---|---|---|
| **Saves** | Months on the 3D scene, camera and wall interaction — the expensive, framework-agnostic part | All of that plus the exporters and editor, immediately |
| **Costs** | An adapter from our model to their render shapes. One boundary to maintain. | Every differentiator |
| **Model** | Ours. Nanometre integers, per-dimension provenance, zones. | Theirs |

Why the split is right rather than merely cautious: **floats are correct for rendering.**
Nothing needs exact arithmetic to draw a wall on a screen. Three.js is float throughout, and
that is fine — it is the same principle as metres becoming nanometres at the device boundary.
Exact model, float renderer, quantise once between them.

The pitfall of the other path is not aesthetic. Per-dimension provenance is what the
confidence badges, the punch list, the obstruction proof and mixed-mode capture are all built
on. A model without it cannot have them bolted on — retrofitting a model touches every place
a number flows, where an adapter touches one boundary. And commercially, adopting their model
makes Trueline "OpenPlan3D but paid", which is not a product.

**Not verified:** their source has not been read. The stack is confirmed as SvelteKit,
Three.js, Tailwind, TypeScript, jsPDF, `dxf-writer` and optional Firebase sync, with test
files named `test-orthogonal.ts`, `test-room-polygons.ts` and `test-furniture-rotation.ts`.
Whether their storage model is separate from their render model is unknown, and someone
should read it before the adapter is designed.

### Web framework

**React 19 + Vite + Tailwind**, matching Plumbline exactly. One framework across both
products, so the seam to Plumbline stays cheap. Their Three.js code ports into React; only
the SvelteKit shell is discarded, and that is the least valuable part of it.

## DXF with dimensions — verified, with the trap named

`@tarikjabiri/dxf` v2.8.9, **MIT licence**, read from its own package manifest. It emits real
`DIMENSION` entities. Proven by writing a file and reading it back with `ezdxf`, a different
parser: three DIMENSION entities on named layers, zero audit errors, and the horizontal and
vertical dimensions measuring exactly 148.5 and 96 as written.

**The trap:** `addAlignedDim` does not write the angle (group code 50), so a consumer that
measures by projecting along it reads the horizontal component rather than the true length —
120 where it should be 150. Confirmed against `ezdxf` writing its own aligned dimension over
the same geometry, which does set the angle and does read back 150.

**Verified in real CAD.** LibreCAD, rendering through its own engine, draws all three
dimensions correctly: 148.50 on the verified layer in green, and 150.00 for the aligned
diagonal on the scanned layer in yellow. The render is kept at `core/tools/librecad-render.png`.

### Two earlier alarms in this file were wrong

Both came from treating `ezdxf` helpers as though they were CAD.

- *"Aligned dimensions measure 120 instead of 150."* `ezdxf`'s `get_measurement()` projects
  along an `angle` attribute the writer omits. Real CAD measures from the definition points
  and shows 150.00. **`addAlignedDim` is fine.**
- *"The dimensions do not render."* `ezdxf`'s renderer needs a stored geometry block. Real
  CAD regenerates the graphics from the definition points, as AutoCAD does. **They render.**

A parser is not a renderer, and a renderer library is not CAD. Verify against what the
customer opens.

### The defect that is real: `$INSUNITS`

`@tarikjabiri/dxf` writes **`$INSUNITS = 0`** — unitless. LibreCAD printed a blank sheet until
the header was forced to millimetres, because with no declared unit a CAD application guesses
the scale.

For a contractor that is a plan that prints at the wrong size, which is worse than one that
does not print, because it looks correct. **Trueline sets `$INSUNITS` explicitly on every
export.** One header value, not optional.

Nothing needs writing to generate dimension geometry, and no Python export service is needed.
Both were proposed on the strength of the two wrong findings above and are withdrawn.

## Autodesk Viewer — the authoritative test, and what it showed

Sam opened `sample-plan.dxf` in Autodesk's own free viewer. It drew the dimension
**geometry** — extension lines, dimension lines, and the layer colours, so confidence as
layers is confirmed in Autodesk's engine — and **no text whatsoever**. No 148.50, no 150.00.

The cause is group code 11, the text midpoint. Without it Autodesk draws the lines and omits
the number, so a plan looks finished and carries no figures. **LibreCAD regenerates the text
and hides the problem**, which is how it survived a CAD check that passed.

That makes the earlier correction in this file wrong in turn. The order of findings went:
`ezdxf` says the dimensions are broken → LibreCAD says they are fine and `ezdxf` was wrong →
Autodesk says `ezdxf` was right after all. **The lesson is not "verify in CAD", it is "verify
in the CAD the customer uses."**

Two distinct mechanisms, not to be conflated again:

| Consumer | Draws dimensions from | Needs |
|---|---|---|
| Autodesk Viewer, AutoCAD | regenerates the lines itself | `middlePoint` (group 11) for the text |
| LibreCAD | regenerates lines and text | neither — which is why it hid this |
| `ezdxf` renderer | the stored geometry block only | a generated block (still absent) |

**Fixed at the source.** The library exposes `middlePoint`, `blockName` and
`ActualMeasurement`; the generator never set them. It sets `middlePoint` now, and
`verify-in-cad.sh` asserts group 11 on every dimension directly rather than inferring it from
a render that might regenerate.

The missing geometry block remains, and matters only for consumers that draw from the block
rather than regenerating. It is recorded as known and unfixed rather than quietly ignored.

## Autodesk Viewer — the UX reference for Trueline's web viewer

Sam's reaction to it was strong and specific, so it is written down rather than remembered.
What it does that Trueline should take:

- **Drag and drop, no install, no account** to see a drawing. The client-facing share link
  should work exactly like this — a homeowner should never make an account to look at a plan.
- **A layer panel that toggles.** Trueline's confidence layers are already this: let a client
  or an architect switch verified dimensions on and off.
- **Fit, Pan, Zoom, Measure, Markup as a persistent bottom bar**, plain-worded and always
  reachable, rather than buried in menus.
- **Measure as a first-class tool on the model**, not a mode you have to find.
- **Screenshot and Share as top-level actions.** Sending a client a view of their own house
  is the thing Matterport built a business on.
- **Properties beside the drawing**, so selecting something tells you what it is.
- Progressive load rather than a spinner: the drawing appears as it arrives.

## DXF status — what is proven and what is not

**Verified by hand in Autodesk Viewer**, which is the customer's tool and the only
verification that counts here:

- **Geometry is exact.** Measure returned 150.000" on the aligned diagonal and 96.000" on the
  vertical.
- **Confidence as layers works.** Toggling `DIM-VERIFIED` off removed the green and left the
  yellow.

**Not verified: dimension text does not render.** Three attempts have failed, and the claim
"a DXF that keeps its dimensions" **must not be made to a customer** until numbers are seen
in the viewer. It was reported working twice off automated checks and was wrong both times.

**Verification of this claim is manual and cannot be automated from here.** Upload to
Autodesk Viewer, drive the Measure tool, toggle the layers, look.

The LibreCAD blank page is isolated: our file has no `LAYOUT` objects, which is where paper
size and plot settings live, and `@tarikjabiri/dxf` has no API to write them. That is a
printing limitation rather than a drawing-validity one.

## Confidence as DXF layers — verified in Autodesk

Provenance and exactness die at the DXF boundary, because DXF stores floating-point drawing
units. What survives is **which layer a dimension sits on**, and that is enough:

| Layer | Holds |
|---|---|
| `TRUELINE-WALLS` | the geometry |
| `DIM-VERIFIED` | dimensions a person put a tape on |
| `DIM-SCANNED` | dimensions a sensor produced |
| `DIM-ESTIMATED` | dimensions read off an older drawing |

An architect opening the file sees, per dimension, whether somebody stood behind the number —
by toggling a layer. No competitor does this, and it costs nothing once layers are being
emitted anyway. Verified working in the proof above: the entities came back on
`DIM-VERIFIED` and `DIM-SCANNED` as written.

## Their model layer — read, and it settles the adapter question

`src/lib/models/types.ts`, quoted:

```ts
export interface Point { x: number; y: number; }
export interface Measurement { id: string; x1: number; y1: number; x2: number; y2: number; }
export interface Room { id: string; name: string; walls: string[]; area: number;
                        floorTexture: string; /* ... */ }
```

- Coordinates and lengths are JavaScript `number` — floating point throughout.
- Units are inconsistent: "world units" for coordinates, centimetres for furniture.
- `Wall` carries `color`, `texture`, `interiorColor`, `exteriorTexture` — presentation, not measurement.
- `Room.area` is **stored**, not derived, so it can drift from the walls it claims to describe.
- **No provenance, no confidence, no tolerance, no zones or virtual boundaries.**

Their `Measurement` is not a measurement. It is an annotation line with no value and no units.

This is a rendering model, which is exactly what it should be for what it does — and it
confirms taking the renderer and not the model. It also answers the cost question:
**the adapter is an afternoon, not a fortnight.** It runs one way only, ours to theirs, for
drawing; their shape is simpler than ours; and `corners()` already produces the start and end
points their `Wall` wants.

## Three gaps Sam found by using the reference app

Found by scanning real rooms rather than reading a feature list, which is why they are worth
more than anything on a comparison table.

### 1. It shows no measurements. We already compute them.

Sam scanned four rooms and saw no dimensions or areas anywhere. Trueline computes area
exactly from the closed polygon — `area()` returns square nanometres by the shoelace formula
and `formatSquareFeet()` renders it — and it carries a tolerance derived from the walls it
came from, so a scanned room shows a band and a typed room shows none.

That is not a feature to add. It is built, tested, and it is the whole point: **a floor plan
without numbers on it is a picture.**

### 2. The ceiling hides the room from above

Scanning part of the ceiling leaves a partial roof on the model, and from a top view it
blocks everything underneath. The model is right; the view is wrong.

**The viewer hides the ceiling when the camera is above it.** Not a setting somebody has to
find — looking down at a room means wanting to see into it, and there is no case where a
person is looking straight down and wants an obstruction. On top of that:

- a **cut-plane slider** to take a horizontal section at any height, which is how a floor plan
  is defined anyway
- a **dollhouse view** — walls at full height, no ceiling, seen from above at an angle. This
  is the single view Matterport built a business on, and it costs us nothing because the
  geometry is already there.

Note also that this is not a scanning mistake to correct on the field card. Ceiling height is
wanted, and RoomPlan needs the wall to be seen up to it. The fix belongs in the viewer.

### 3. Photos need batch delete — and one thing better than that

Today, in the reference app, photos are deleted one at a time. Trueline gets checkboxes,
select-all-in-room, and a single delete with a confirmation and an undo window.

**What the checkbox version cannot do, and ours can:** every Trueline photo knows which walls
it sees. So deleting can warn — *"this is the only photo showing the north wall"* — before the
evidence for a dimension disappears. `unphotographedWalls()` already computes exactly that.
Nobody can offer this without per-photo poses, which is the same reason nobody can offer
per-dimension confidence.

## What a real RoomPlan export actually contains

Everything above about RoomPlan came from Apple's documentation. This section came from
Sam's own kitchen: an iPhone 14 Pro, iOS 26.6, RoomPlan export version 2, 292 frames over
2 minutes 27 seconds, of a kitchen with furniture and appliances in it. Reproduce any line
below with `core/tools/inspect-roomplan.py <scan>/JSON`.

Six assumptions the room model was built on were checked. Four held, two were wrong, and one
turned up a field the model was missing.

### Held

**Wall thickness is not exported at all.** Every wall, door, window and floor comes back with
`dimensions[2] == 0`. This is stronger than the assumption in `render.ts`, which treated
RoomPlan's uniform ~160 mm as a rough figure to be improved on. There is no figure. Any
thickness Trueline draws is one Trueline chose, `ROOMPLAN_ASSUMED_THICKNESS` is the only
source of it, and the drawing has to say so rather than imply a measurement.

**Openings sit exactly on their wall and inside it.** All three openings in the scan project
onto their parent wall with an off-plane error under 0.005 mm and a span that fits within the
wall's length. `Opening.offsetFromStart` is directly computable from the export; no fitting,
no clamping.

**Object categories are a single-key object, not a string.** `{"storage": {}}`, and the same
encoding for confidence. Anything reading this format with a plain string comparison gets
nothing. Categories seen in one kitchen: `chair`, `oven`, `sink`, `storage`, `stove`. Object
confidence was `low` on five of six — which is the point of `obstruction.ts`: these are hints
about what blocked the scan, never facts about the room.

**Camera poses compose with the room model.** Inverting `referenceOriginTransform` and
applying it to each frame's `cameraPoseARFrame` puts all 292 cameras between 1.293 m and
2.012 m above the floor plane, inside the footprint. That is a phone held at chest and eye
height, which is what happened. The composition `photo.ts` depends on is correct.

### Wrong

**Closure error is not something the solver will see.** Expected some millimetres of drift to
distribute. Found zero: every wall end that meets another meets it at a gap of 0.000 mm.
RoomPlan hands back an already-closed, already-rectified polygon. The ±5 cm per wall Apple
documents is still in there — it is just systematic, and invisible to a closure check.

The consequence matters. **A scan that closes perfectly is not a scan that is right.** On
import, `solve()` will report no adjustment and no wall beyond tolerance, and that must never
be presented as agreement between measurements. The value of verification is entirely in what
happens next: a person types one exact number, that contradicts the pre-closed polygon, and
the other walls have to move. The verification punch list is not a fallback for when a scan
fails to close — it is the whole mechanism.

**Not every wall is square, and not every wall is on the outline.** Seven of the eight walls
are square to each other to within 0.001° — RoomPlan snaps to a right-angle grid. The eighth
is a 203 mm stub at 70.441°, a real corner chamfer, and it is in the floor polygon too. So the
rectilinear solver in `room.ts` cannot be the only path: short off-grid stubs are ordinary.

Worse for a naive importer: the floor outline is 20.0873 m round and the walls add up to
17.8797 m. One wall (1.3167 m) has both ends meeting nothing — a fragment of the space next
door, caught through a doorway. Two floor edges totalling 3.5243 m have no wall at all.

That last part is the open-plan problem showing up in the very first real scan, and it is what
`zone.ts` was built for: **an outline legitimately contains edges that are not built walls.**
A virtual edge bounds floor and ceiling and carries no drywall, paint or baseboard. Sam asked
for this before there was any evidence it was needed; there is now.

### The field the model was missing

`Opening` had width, height and offset along the wall, and no sill height. Doors do not need
one — both doors in the scan sit within 0.1 mm of the floor, because that is what a door is.
A window does. This one works out at 927 mm above the floor, a normal kitchen sill, and
**nothing in the export says so**: it is recovered by subtracting half the window's height
from its centre and comparing against the floor plane.

`Opening.sillHeight` is now an optional `Measurement` — recovered, so it carries provenance
like anything else. A window without one cannot be sectioned honestly, and `section.ts` names
it and asks rather than picking a number.

### Two smaller facts worth keeping

- **Wall heights vary inside one room.** Seven walls at 2.4257 m, one at 2.13 m. `Wall.height`
  being optional and per-wall is not an edge case for pony walls; it is the first scan.
- **Coverage is not automatic.** The camera never entered the far half of the room: it spans
  2.8 m of a room 5.8 m deep. Tracking stayed `normal` for 290 of 292 frames and motion
  quality averaged 0.91, so nothing warned about it. A scan can be clean and still leave walls
  with no photograph on them, which is exactly what `unphotographedWalls()` is for.

## Seeing inside the model — built

Decision 2 above is now `core/src/section.ts`, 24 tests. All of it is exact integer geometry,
so the same viewpoint gives the same answer on every device, and none of it needs a renderer
to test.

- `aboveCeiling()` — level with the ceiling counts as above.
- `cutAt()` — a horizontal plane at any height. Walls shorter than the plane are drawn whole
  and reported as not cut, so the renderer poché's only the faces the plane really passes
  through. That case is the 2.13 m wall from Sam's kitchen, not a hypothetical.
- `dollhouse()` — no ceiling, and the walls the viewer is standing outside of come down.
  Outward normals are read off the polygon's winding rather than assumed, so it works whichever
  way the room was walked. A camera exactly flush with a wall does not delete it.
- `sectionFor()` — the auto rule: inside is a walkthrough, straight overhead is a plan,
  oblique overhead is the dollhouse. A dragged slider always wins over the rule.
- `cutStops()` — the slider's stops are the room's own features: the conventional 4'0"
  section, the top of every part-height wall, and every known sill and head.

`toRenderSection()` in `render.ts` carries the result across the exact-to-float boundary, in
the same one place everything else crosses it. A wall clipped to 4'0" for a drawing is still
an 8'0" wall on the take-off.

## A second scan — the garage, and what two scans settle

308 KB of JSON off the same phone: 5 walls, 314 frames, 4 minutes, section label `unidentified`.
Not an empty room — one `storage` object, and a large opening. It confirms three findings and
adds two.

**Confirmed: the scan always closes.** Every wall end meets its neighbour at 0.000 mm, with one
at 0.001 mm. Two scans, two closed polygons. This is the normal state, not a coincidence, and
the 0.001 mm says the importer must compare with a tolerance rather than for equality.

**Confirmed: wall heights vary inside one room.** Three of them here — 2.13 m, 1.95 m, 1.62 m —
in a single garage.

**Confirmed: thickness is never exported.** All zeros again.

### New: dangling wall ends are two different things

Both scans have wall ends that meet nothing. They are not the same problem:

| | Garage | Kitchen |
|---|---|---|
| Dangling ends | wall 3B, wall 4A | wall 2A, wall 4B, **and both ends of wall 6** |
| Gap between them | 4.8144 m, one straight run | 2.7383 m direct, 3.5243 m round two edges |
| Floor edges with no wall | one, 4.8144 m | two, 2.5646 m + 0.9597 m |
| What it is | the garage door opening | the opening into the next room, turning a corner |

In both cases the wall-less floor edges account for the gap **exactly**: 4.8144 m in the garage,
and in the kitchen an L of 2.5646 + 0.9597 whose diagonal is 2.7383 m — the direct distance
between the two dangling ends, to four decimal places.

So a dangling end is usually not garbage. It is **the flank of an opening too wide for RoomPlan
to call a door**, and the gap between two of them is a virtual edge in the sense `zone.ts`
already means: it bounds floor and ceiling and carries no drywall, paint or baseboard.

The exception is real and separable: the kitchen's wall 6 (1.3167 m) has **both** ends dangling
and no matching floor edge at all. It is a fragment of the room next door, caught through the
doorway. Matching wall lengths against floor-edge lengths separates the two cases cleanly —
every garage wall is on the outline, and in the kitchen exactly one is not.

### New: RoomPlan snaps the walls but not the floor polygon

Every garage wall is square to within 0.001°. Its floor polygon is not: one edge sits at
**-89.665°**, which over 4.8144 m is 28 mm of drift. So the two sources disagree about whether
the room is rectilinear, and picking one is a decision rather than a detail.

### New: scanned opening sizes are not usable

| | Scanned height | A real door |
|---|---|---|
| Kitchen door 1 | 2.0868 m (6'10") | 2.032 m (6'8") |
| Kitchen door 2 | 2.0985 m (6'11") | 2.032 m |
| Garage door | 1.7011 m (5'7") | — |

Out by more than a foot, in both directions, on two scans. An opening size off a scan may
appear on a drawing, but it must be marked, and nothing may be ordered against it. This is now
a warning in `issue.ts`.

## The import guard — built

Sam's call, and the most important thing in the codebase: **a room whose walls were all scanned
may not go out as a dimensioned drawing.** `core/src/issue.ts`, 14 tests.

The reason is the closure finding. On an imported scan `closure()` returns zero, `solve()`
reports no adjustment and no wall beyond tolerance, and a person reads that as *the measurements
agree*. They have never been compared. The reassurance a closed room normally gives is, on a
scan, worth nothing.

- `closedWithoutBeingChecked()` names the trap exactly: every wall scanned, every one carrying a
  tolerance, and the room closes anyway. A hand-drawn room also closes exactly, and that **does**
  mean something, so the test requires that nothing in it be verified.
- **One tape per axis** is the gate. Not one tape — one per axis, because the model closes on two
  independent equations and a measurement along one constrains nothing along the other. Verify
  the north wall of a rectangle and every east-west dimension is still a guess.
- `unseenError(room, axis)` reports the number the closure check is hiding: the sum of the
  unverified tolerances on that axis. It goes in the blocking message, so the screen says
  *"these could be out by 4 inches"* rather than *"unverified"*.
- `assertIssuable()` throws rather than returning a flag. An export that forgets to check a
  boolean is precisely the failure this file exists to prevent; a thrown error cannot be
  forgotten. Every dimensioned output calls it.
- On-screen views are **not** gated. Looking at a scan is how somebody decides where to put the
  tape. It is issuing that requires a checked drawing.
- `trustLabel()` is blunt on purpose: *Scanned — not checked* / *Partly measured — scanned
  dimensions marked* / *Measured — every dimension checked*. `toRenderModel()` carries it, so the
  badge is on the screen and not only on the export.

Opening sizes and an unverified ceiling height are **warnings**, not gates — they must appear on
the drawing, but they do not stop it going out. That is a deliberately narrower rule than the
wall gate, because Sam's instruction was one tape per axis and widening a gate quietly is its own
kind of dishonesty.

## Four decisions on importing a scan, and the importer that acts on them

Sam decided all four. The importer is `core/src/import-roomplan.ts`, 24 tests, and it has been
run against both real exports.

### 1. Off-grid walls: hybrid

Square walls keep a compass heading; a wall at a genuine angle carries an exact run. Built and
locked — see "Angled walls" in the commit history and `room.ts`. The kitchen's 203 mm chamfer
comes through as a diagonal of 8 inches at its measured angle, and it is held fixed while the
square walls absorb the room's error.

### 2. Which source is the truth: the walls, with the outline straightened onto them

**The floor polygon says what the outline is. The walls say where it is.** The polygon is the
only source with every edge, including the ones with no wall across them. But RoomPlan snaps
its walls to a right-angle grid and does not snap the polygon, so the two disagree, and where
they do the wall wins.

The test for square is a **ratio, not an angle** — a run counts as square when its smaller
component is at most a hundredth of its larger one, which is 0.573°. That is exact integer
arithmetic with no trigonometry, and it is chosen against the three things it has to separate:

| | Off square | Verdict |
|---|---|---|
| RoomPlan's own square walls | 0.001° | square, 500x inside the line |
| The garage's unsnapped floor edge | 0.335° | square — straightened, 28 mm |
| The kitchen's chamfer | 19.6° | a real angle, kept |

Straightening leaves a residual, and it is not hidden: the room fails to close by exactly what
was straightened away, `solve()` shares that out across the scanned walls in proportion to their
tolerances, and the report says how much moved. On the garage that is 28 mm on a 6.5 m room —
one part in three hundred, and every dimension still carries a 50 mm band until somebody
measures one.

### 3. A wall on no edge of the outline is left out, and listed

The kitchen's 1.3167 m fragment of the room next door is dropped, and the report says
*"Left out a 4' 3 13/16" wall … no edge of the floor outline runs between this wall's two ends."*
Visible and arguable, never silent.

### 4. A wall-less edge becomes an open span

Not a cased opening — a garage door is not a cased opening and calling it one would put a header
and jambs on a take-off that has none. `Wall.open` marks a side of the room with no wall across
it: on the outline, bounding floor and ceiling, carrying no drywall, paint or baseboard. `zone.ts`
gains a third edge kind for it, next to built and virtual, because the three are genuinely
different: one takes finishes, one is a line somebody drew, one is a measured hole.

### What the importer does to the two real scans

| | Kitchen | Garage |
|---|---|---|
| Edges out | 9 | 6 |
| Walls | 6 | 5 |
| Open spans | 2, totalling 11' 6 13/16" | 1, at 15' 9 9/16" |
| Diagonals | 1, the 8" chamfer | none |
| Dropped | 1 wall, 4' 3 13/16" | none |
| Largest straightening | 0.0003 mm | 28.1 mm |
| Area | **175.3 sq ft** | **418.0 sq ft** |
| Raw floor polygon area | 175.28 sq ft | 418.01 sq ft |
| Issuable | no | no |

Both areas land on the polygon they came from. Both rooms close. Both are refused as drawings,
which is the guard doing its job.

### Two things the real scans forced

**A garage door is in line with the wall stubs either side of it.** `validate()` refused three
collinear segments in a row. The rule was right for its reason — two built walls on the same
axis are one wall written twice, and the solver would move both to fix one error — but an open
span in line with the wall beside it is a building, not a mistake. The rule now applies only
when both segments are built.

**Areas are held in half square nanometres.** The shoelace formula gives twice the area, and for
a rectilinear room that is always even, so halving it was exact and the unit never had to be
thought about. A room with an angled wall breaks it: a triangle can enclose a genuine half of a
square nanometre, and the kitchen's chamfer does. Halving anyway is a rounding, and a rounded
area does not reconcile — split a room into zones, round each, and the parts stop adding up to
the whole, which `zone.ts` refuses and is right to refuse. So the doubled figure is what is
stored, and the only place it is halved is where it becomes square feet on a screen. Half a
square nanometre is 5 x 10^-19 m². It is carried because carrying it costs nothing and dropping
it costs the guarantee that makes a take-off trustworthy.

## Obstruction, fed from the import and checked against the kitchen

`obstruction.ts` was the only module in core with no real-data validation. The importer already
produced footprints, and the kitchen is the scan with things lying around, so the two were
joined up and run.

**What it found in Sam's kitchen**, six detected objects — two runs of storage, a stove, an
oven, a sink and a chair:

| Wall | Length | Blocked | By |
|---|---|---|---|
| the counter run | 7' 8 5/8" | **995/1000** | storage x2, stove, oven, sink |
| the chamfer | 8" | **1000/1000** | storage x2 |
| beside the counter | 5' 1" | 434/1000 | storage x2 |
| the opening to the next room | 3' 1 13/16" | 11/1000 | storage |
| everything else | — | 0 | — |

Four of the nine edges are behind something. The counter wall — the one a kitchen is priced
off — is a dimension the scanner essentially guessed at, and nothing in the scan says so. The
garage, with one object nowhere near a wall, comes back clean, which is the control.

Two things this forced:

**The blocked test had to work for a wall at an angle.** It compared against an axis, so a
diagonal was silently treated as vertical. It is now a cross product against the wall's own run
— `|cross| <= reach * length` tests the perpendicular distance without ever dividing — and a
dot product for the extent along it. Exact for both kinds, and the axis case falls out of the
general one.

**The temptation to widen the tolerance on a blocked wall was refused.** It is obviously true
that a wall behind cabinets is measured worse than one in clear air, and it would be easy to
multiply its band. There is no published figure for it. Apple documents ±5 cm; nobody documents
±5 cm behind a fridge. So every wall keeps the vendor's number and the blocked share is
reported *beside* it, which is the honest split: one is measured, the other is ours.

Note what this does **not** do to the ranking. Area at stake still dominates: a long clear wall
outranks a short blocked one, because area at stake is what costs money. Blocking is a
multiplier, not an override.

## The import-correction screen — the web shell starts here

`web/`, React 19 + Vite + Tailwind, one screen. Sam's call, and the right one: the importer
named every decision it made and none of those notes went anywhere. *"If that is really a wall,
change it here"* is a confession with no remedy unless "here" exists.

It is also the right **first** screen. A scan closes perfectly whether it is right or wrong, so
the moment that decides whether any of this is worth building is the one where a person
disagrees with a number and types the real one. Projects, accounts and exports are scaffolding
around that moment.

### What it does

- Draws the plan from `toRenderModel`, with every dimension marked scanned or measured — amber
  for the scanner's number, ink for one somebody stood behind, dashed for an edge with no wall,
  red hatching for a wall something was standing against, and faint boxes for what was standing
  there.
- **Type a real measurement on any wall.** The room re-solves, and it says how many other walls
  moved and how many moved further than the scanner's own tolerance.
- **Fix the import's guesses**: open span → wall, or → cased opening.
- Says what is blocking the drawing from being issued, and which wall to measure first.
- Undo, which is exact rather than reconstructed: every edit keeps the room it started from.

### What it deliberately does not do

There is **no server**. A scan is a `room.json` dropped on the page — the file the reference app
already exports — read in the browser and never uploaded. That makes it usable today, on a
phone, on a real scan, before an API exists, and it means the first version cannot leak anybody's
house.

And there is no button for the dropped wall. A wall that is not on this room's outline cannot be
one of its walls, so the card says there is nothing to do about it here and why — rather than
offering an action that pretends.

### `core/src/edit.ts`, and one thing it forced

The screen's operations belong in the model, not in a component: `makeWall`, `makeOpen`,
`makeCased`, `verifyWall`. All four return a new room and leave the old one alone.

`makeWall` turned out not to be a flag flip. A garage door sits **in line** with the stub of wall
either side of it, so closing that opening leaves three collinear segments, which the model
refuses — and rightly, because two built walls on one axis are one wall written twice and the
solver would move both to fix one error. So closing an opening **merges** it with any wall in
line with it: the lengths add, the tolerances add (a merged wall is no surer than its pieces),
and the openings keep their positions along the merged wall. The merge is lossy — the swallowed
segments are gone — which is why undo is the room you were holding, not an inverse operation.

### Readable ids

RoomPlan's identifiers are UUIDs, and the first run of this screen put
*"No north-south dimension has been measured: 373288F9-2F3C-4E65-AB0D-FD2EE8C3727E,
7D348F29-B1AB-4253-8CB2-AA67C796B63C…"* in front of a contractor. The importer now assigns
`wall-1`, `opening-1`, `door-1` in outline order, and keeps the UUIDs in `report.sourceIds` so a
re-scan of the same room can still be matched against this one.

### Verified by driving it

Not by reading the code. The dev server was driven headless at iPad size against both real
scans: import, tap the top punch-list item, type `12' 3 1/2"`, watch three walls move and the
area go from 175.3 to 184.8 sq ft, close an open span into a wall, undo it. No console errors.
Screenshots are not checked in — they are of Sam's house.

## What the web app is and is not — asked directly, answered directly

Sam asked whether it is functional with all the scanning features of OpenPlan3D before hosting it.
**No, and it never will be from a browser.** The distinction matters enough to write down:

| | OpenPlan3D | Trueline web, today |
|---|---|---|
| LiDAR capture | yes | **no — impossible in a browser** |
| AR measure without LiDAR | yes | no |
| Draw a plan manually | yes | no (built in `core`, no screen yet) |
| Read a finished scan | — | **yes** |
| Every dimension marked scanned or measured | no | **yes** |
| Type a real measurement and re-solve the room | no | **yes** |
| Say which wall the scanner could not see | no | **yes** |
| Refuse to issue a drawing nobody checked | no | **yes** |

WebXR is unsupported in Safari on iOS, so there is no browser path to the LiDAR sensor at all —
this was settled in Phase 0 and it is why the scanner is a native iOS app. What is hosted is the
half of the product that is ours: the correction layer. The workflow it supports today is
**scan in OpenPlan3D, correct in Trueline** — export the scan, drop the `room.json` on the page.

That is the right thing to put in front of a first user anyway, because it is the half nobody
else has. Handing somebody a worse scanner teaches nothing.

## The field list — the punch list, off the screen

`core/src/fieldlist.ts`. "Measure these first" was living on a page somebody would have to keep
open while holding a tape, which nobody does. It is now plain text: four lines, what the scanner
said for each, why it is on the list, and a blank to write in.

Deliberately plain — no table that reflows, no character a messaging app mangles, every line
under 72 columns so it prints and reads on a narrow screen. On iOS the Send button reaches
Messages through the Web Share API, which is how it actually gets to whoever is holding the tape.

It carries **what the scanner said** on every line, so the disagreement shows up in the room
rather than back at a desk. And it is generated in `core`, not in a component — a list built in
the UI is a list that will disagree with the screen.

Four lines by default. Ten is a chore nobody finishes.

## Saving the work — exact, and honest about what it is

`core/src/persist.ts`. Somebody spends ten minutes correcting a scan on a tablet in a half-built
kitchen, the phone rings, the tab is dropped. That is not acceptable.

The hard part is the only part: **every length in this model is a bigint and `JSON.stringify`
throws on one.** Converting to `Number` would make the whole thing quietly approximate. So a
bigint is written as `{"$nm":"3657600000"}` — a tagged decimal string, exact both ways and
readable by anybody who opens the file.

The codec is general rather than a hand-written mapper per type, on purpose: a hand-written one
silently drops the field somebody forgot to add. This one cannot lose a field, and `loadProject`
runs the room through `validate()` before returning it, so a corrupt or older payload is refused
loudly rather than half-loaded. A file from a different `SAVE_FORMAT` is refused outright — a
half-understood room is worse than no room, because a person would trust it.

**It is not a backup, and the screen says so.** One browser, one device; clearing site data
clears it. Verified by driving it: correct a scan, reload the page cold, and the dimension list
comes back byte-identical — the measured wall still exactly `12' 3 1/2"` with no band on it.

Why a length still fits a double and an area does not, since it comes up: 100 m is 1e11 nm and a
double is exact to 9e15. A 20 x 12 room is 4.4e19 half-square-nanometres, four orders past that.
The codec exists for the second number.

## Hosting

`netlify.toml`: build from the root, publish `web/dist`, Node 22. No backend to provision, no
secret to set. The content-security policy is `default-src 'self'` with `frame-ancestors 'none'`
— the page loads nothing from anywhere else and must not, and a scan is a file the person chose
rather than a network request. Nobody's house can reach anybody else's, because nothing leaves
the device.

## Correction: the two-app workflow is rejected, and it was never asked for

I recommended hosting the web shell and having Sam's friend scan in OpenPlan3D and correct in
Trueline. **That was wrong and Sam rejected it.** Recorded because the reasoning behind the
rejection is a product decision, not a preference:

- Two apps is not a product. Nobody exports a file from one app to load into another on a job
  site, and asking somebody to is asking them to do the integration work.
- **The scanning is the feature the customer wants.** Sam showed his friend the capture, and that
  is what he responded to. A correction layer with no capture in front of it has nothing to
  correct until somebody else's app has run.
- The stated requirement from the start was one app that scans, measures and photographs at the
  same time. Nothing about that changed; the recommendation drifted.

**Nothing is put in front of a user until Trueline scans.**

## What can and cannot be taken from OpenPlan3D — checked, not assumed

`laanlabs/openPlan3D` was read again, at the repository level rather than the licence file. What
is actually in it:

`src/`, `static/`, `svelte.config.js`, `vite.config.ts`, `firebase.json`, `test-roomplan.json`.
SvelteKit, Three.js, TypeScript, Firebase. **No `.swift` file, no Xcode project, no ARKit or
RoomPlan source anywhere in it.** Its own README describes a *companion iOS app* that scans and
hands data to this web editor over Firebase Storage.

So the MIT grant covers **the web editor only**. The scanner — the thing Sam actually wants — is
a separate closed app and there is no source to integrate. "Integrate the entire code and
workings of OpenPlan3D" is possible for the editor half and impossible for the capture half, and
it is better to know that now than after planning around it.

The capture has to be written. It always did; the roadmap said so from Phase 0. Copying what an
app *does* carries no licence obligation at all, so the feature list is fair game — the code is
simply not there to take.

### What this means for the build

| | Source available | Status |
|---|---|---|
| 2D/3D editor, exporters | MIT, theirs | can take, mostly superseded by `core` + `web/` |
| LiDAR room capture | **none** | write it, on Apple's RoomPlan |
| AR measure without LiDAR | **none** | write it, on ARKit |
| Photos taken during the scan | **none — and nobody has it** | write it; the differentiator |

The last row is worth its own line. Their app hands off a scan. It does not hand off a scan with
every photograph tied to the pose it was taken from. Two real exports proved that composition
works — 292 camera poses landing inside the room model once `referenceOriginTransform` is
inverted — so it is buildable, and it is the thing `photo.ts` and `obstruction.ts` were written
against.

### The constraint on how it gets built

This container is Linux with no Swift toolchain and no Xcode. Swift can be written here; it
cannot be compiled or run here, and it will not be reported as working on the strength of
reading it. Whatever is written has to be built and run by Sam on a Mac, and the parts that can
be verified here — the capture file format, the live-measurement arithmetic, the photo-to-wall
composition — stay in `core` where they are tested.

## The scanner — decided, and written

Sam's four answers, and what each one means:

| | Decision |
|---|---|
| Building it | Mac with Xcode, ready. Swift is written here and built there. |
| Architecture | **Native capture, the web screens embedded.** One measurement engine. |
| Photos | **Automatic every two seconds, plus a shutter.** |
| Storage | **On the phone, with a share button.** No account, no server, no bill. |

### One measurement engine, and why that settled the architecture

Writing the model twice — nanometre integers, provenance, the solver, zones,
obstruction, the issue guard — in Swift *and* TypeScript would mean two models in
two languages, kept in step forever, every bug fixed twice. Small products die of
that. So capture is native because capture has to be, and everything after the
scan is `web/` running in a `WKWebView` inside the same app, with no network
access at all. The app hands the scan across as an argument through
`window.trueline.open(room, photos, name)`; nothing is fetched and nothing is
uploaded.

The one number the native side formats is the live wall length during a scan, and
`Formatting.swift` says in its own comment that it is a glance and not a figure:
it rounds to the half inch, nothing it produces is written anywhere, and the
moment the scan is saved every number a person sees comes from `core` with a band
on it.

### The app writes RoomPlan's own format, on purpose

`CaptureWriter` encodes `CapturedRoom` straight through `JSONEncoder`, producing
exactly the shape the two real exports have. The importer was written against
those exports and is tested against them — nine edges out of the kitchen, six out
of the garage, both landing on the area of the outline they came from. Writing a
different format here would throw all of that verification away and start again.

That retires `CaptureExport.swift` from the `ios-scanner` branch, which invented a
format of its own before there was any real data to check it against.

### Not stealing the ARSession delegate

`ARSession` has exactly one delegate and RoomPlan is using it. Taking it would
break the thing being photographed. So frames come from
`arSession.currentFrame`, polled on a timer — photographs are evidence, not
tracking, and a few a second is more than enough.

### Intrinsics go across row-major, and the transform column-major

Not a mistake, and not a guess: checked against the two real exports.
`cameraPoseARFrame` is column-major (its last four entries are the translation,
and frame 0 of the kitchen scan has them at the origin, which is what a session
start looks like). `intrinsics` in the same files are
`[fx, 0, cx, 0, fy, cy, 0, 0, 1]`, which is the other way round. So
`PhotoRecorder` flattens the transform and *names* the four intrinsics that
matter rather than flattening a matrix and hoping. Getting it wrong is every
photograph claiming the wrong field of view.

## A bug that only real data could find: sub-nanometre rounding was deleting walls

`capture.ts` was run against the 292 real camera poses in the kitchen scan and the
314 in the garage. Every one of them placed, and every one landed between 2'7"
and 6'7" above the floor — a person holding a phone. The composition works.

Then a synthetic test pointed a camera straight at a wall it could plainly see and
got **nothing back**.

The cause: when a wall is wider than the frame, both ends are outside it and the
visible stretch is found by clipping against the two edges of the view. A clipped
point lies *on* an edge by construction — so testing it against that same edge
asks whether a rounded number is exactly zero. It is not. The crossing is rounded
to the nearest nanometre, which lands it a fraction of a nanometre to one side,
and that fraction threw the whole wall away.

Sub-nanometre. Four-billionths of a metre, deleting a twelve-foot wall.

Each clipped point is now tested against the *other* edge only. On the real
kitchen scan the effect was not marginal:

| | Before | After |
|---|---|---|
| Walls found per photo, mean | 0.3 | **1.1** |
| Photos found of the longest wall | 24 | **96** |
| Photos found of the counter wall | 6 | **42** |

Nearly four times the coverage was being discarded, and the failure was silent —
`unphotographedWalls()` would have sent somebody back to photograph a wall it
already had fifty pictures of. Exactly the plausible-but-wrong output this
codebase is built to refuse.

## What is not built, stated plainly

The Swift has **not been compiled**. This container is Linux with no Swift
toolchain and no Xcode. It has been checked by reading, its two file formats are
read by code that is tested against real data, and it will not be called working
until it runs on a phone.

## One app, two ways in, one way to correct

Sam asked whether typing a tape measurement is the process in the new app, and whether it is the
same however the room was captured. **Yes, and it is the most important promise the product
makes.** Written down so it stays true:

> **How a room was captured changes nothing about how it is corrected.**

A LiDAR scan, an AR walk, a traced drawing and a hand-drawn plan all become the same `Room`.
From there it is one plan, one solver, one `verifyWall`, one punch list, one issue guard, one set
of words. Tap a wall, type what your tape says, and every other unverified wall moves in
proportion to how unsure its source was — while the one you measured never moves again.

The only thing that differs is **where the band comes from before anybody measures**, and that is
a fact about the sensor rather than about the room:

| Capture | Band on an unmeasured wall | Where that number comes from |
|---|---|---|
| LiDAR scan | 50 mm | Apple's published figure for RoomPlan |
| AR measure | whatever your closing tap missed by | **your own session** |
| Traced plan | supplied by the caller | the drawing's own scale, or a stated assumption |
| Hand-drawn | none — typed is verified | the person typing it |

## AR measure — built, and where its tolerance comes from

`core/src/trace.ts`, 16 tests. Without a depth sensor there is no scanning; there is a tracked
camera and a floor plane. So the room is **walked**: aim the reticle at the foot of a corner,
tap, walk to the next, tap.

The hard question was the tolerance. Nobody publishes how accurately a person can place a point
in AR by eye, and this codebase does not invent numbers. So the app asks the person to produce
one: **walk back to the corner you started at and tap it again.** The gap between the first tap
and the last is a measurement of how badly the pointing went, taken with the same hand, the same
phone and the same room.

That gap becomes the band on every wall — the **whole** gap, not a share of it, because any one
corner could account for all of it. A bound rather than an average, which is how tolerances
already add everywhere else here. Tap within an inch and every wall carries an inch; tap within a
foot and every wall carries a foot, and the punch list says so.

A trace with no closing tap has no such evidence, and then the caller must supply the tolerance.
There is no default, because a default would be a number nobody measured.

**The squareness test is deliberately looser than the importer's.** RoomPlan snaps its walls to a
grid before anyone sees them, so a scanned wall arrives square to a thousandth of a degree. A
person aiming a phone at a skirting board does not. `TRACE_SQUARE_RATIO` is 20 — 2.86 degrees,
or seven inches of sideways error across a twelve foot wall — because calling a wobbly aim an
angled wall would fill a plan with corners nobody built. A real 3-4-5 chamfer is 36.9 degrees
off, thirteen times outside the line, and survives.

Taps that land mid-wall are folded in rather than becoming a corner that is not there.

## The scan check moved into the app

There was a Python script for reading a capture and saying what it actually contained. It earned
its place — it found two of the room model's assumptions wrong and a missing field. But Sam is
right that asking somebody who has just walked a room with a phone to go and run a Python script
is asking the wrong person to do the wrong thing. **The app put the file there, so the app says
whether it is any good.**

`core/src/health.ts` holds the checks, so the app and the tool both reach the same ones and they
are tested. Run against the two real scans it produces, with no terminal involved:

- *kitchen* — **stop**: closes perfectly and that means nothing yet. **check**: one wall left out
  of this room; two edges with no wall across. **note**: one wall at a real angle; one sill
  worked out rather than read; thickness is not in the file at all.
- *garage* — **stop**: the same closure warning. **check**: one edge with no wall across; **one
  door height the scan probably got wrong (5'7")**. **note**: an edge straightened by 28 mm.

The door finding is the one to point at. Nothing told it that 5'7" was wrong — it knows a door is
nearly always 6'8", and it knows that scanned door heights came back out by more than a foot in
both directions on two real scans, so it says so before anybody orders one.

Severities are `stop`, `check` and `note`, and there is no score out of ten. "87%" tells a
contractor nothing; "the counter wall is the one to tape" tells him what to do next.

## The Xcode project is checked in

It was going to be `brew install xcodegen && xcodegen`, and Sam is right that that is two steps
too many when the thing he wants is to put the app on his phone. `ios/Trueline.xcodeproj` is in
the repository. Open it, set the signing team, press Run.

The object ids in it are derived from file names by hash rather than being random, so
regenerating the file produces the same ids and a diff stays readable — which is the one thing
that normally makes a checked-in `.pbxproj` unbearable.

**It has not been opened by Xcode.** Braces and parentheses balance, every id is distinct, the
`Info.plist` parses as a plist and the scheme parses as XML — all checked here. That is not the
same as Xcode opening it, and it will not be called working until it does.

## The field card grew a sixth page, and where 175.3 sq ft came from

Rev 4 of `docs/scanning-field-card.pdf` adds page 6: walking a room on a phone with no depth
sensor. Six numbered steps, the two-panel diagram of the walk and the closing tap, and a table
of what a walked room does *not* come with — no doors or windows found for you, no measured
ceiling height (8&prime; &plusmn;6&Prime;, marked assumed), no furniture, no photographs. The page exists
because the closing tap is the one thing a person can get wrong that nothing downstream can
repair: it is not a corner, it is the tolerance on every wall in the room, and somebody who does
not know that will skip it.

The masthead changed with it — "how to scan a room / iPhone / iPad LiDAR" became "how to measure
a room / with LiDAR or without". The card is no longer about one sensor.

`ios/README.md` gained the two first-run steps Xcode does not do for you: Developer Mode
(Settings → Privacy & Security, iOS 16+) and trusting the signing certificate (Settings →
General → VPN & Device Management). Both are one-time, both look like the app is broken when
they are missed — the icon installs and the app closes on launch.

**Where the 175.3 sq ft came from.** It is ours, not OpenPlan3D's. The reference app displays no
measurements anywhere in its interface — that is product gap 1 above, and it is why this project
exists. The number is the shoelace area of `floors[0].polygonCorners` in the kitchen `room.json`,
those corners placed by the floor's own transform: **16.2840 m² = 175.279 sq ft**, which the
importer carries through to **175.3 sq ft** on screen. Re-derived from the raw file, twice, by two
independent paths.

The two walls worth a tape in that kitchen, if it can be revisited: **wall-2, 12&prime; 9 7/8&Prime;**
(running east–west) and **wall-1, 11&prime; 7 13/16&Prime;** (running north–south). One each way, because
the two directions are separate sums and measuring one says nothing about the other.

## The mark

Two lines: a dimension line with end ticks across the top, a plumb line with the
bob hanging from the middle. They read as a T. It says what the product is —
a true length and a true vertical — in the two oldest instruments in the trade,
and it survives being 40 px on a home screen, which a word does not.

Ink `#14181B` and amber `#B8590A`, the same two colours the plan and the field
card already use, where amber has always meant *this was measured*. The bob is
the only amber in the mark.

Drawn as SVG and rasterised, not generated: an icon is geometry, and geometry
that is typed out can be changed later without redrawing it. `assets/logo/`
holds the sources and says which file goes where. Nothing was paid for.

## A white screen that had not happened yet

Reading the app back before handing over build instructions turned up a fault
that would have cost the whole first run: the correction screens would have
opened blank.

Two causes, both certain enough to fix without a device:

1. **Vite emitted absolute asset paths.** `/assets/index-xxxx.js` resolves to the
   root of the device's filesystem inside the app, where there is nothing.
   `base: './'` fixes it and changes nothing for a hosted copy.
2. **`loadFileURL` cannot load ES modules.** A `file://` page has an opaque
   origin; a module script is fetched under CORS; an opaque origin fails that
   check. The module never runs and nothing is logged. This is not a bug in the
   bundle — it is what the platform does.

So the bundle is now served, not opened: `WebBundle.swift` is a
`WKURLSchemeHandler` answering `trueline://app/…` out of the app bundle, with
path traversal refused and a content security policy on every response. A real
origin also means `localStorage` belongs to the page, so the data store went from
`.nonPersistent()` to the default one — ten minutes of typing tape readings in a
half-built kitchen now survives the app being closed, which was the whole point
of writing them down.

None of this is compiled yet either. What can be said is that the two failures
are understood rather than guessed at, and that both fixes are the documented
way round them.

## Two coordinate frames, and 286 photographs in the wrong place

Sam said the plan I drew of Gilbert's kitchen looked flipped. Chasing that found
a bug that had been live in the app since photographs were added, and it is the
worst kind: everything it produced was confident, plausible and wrong.

**What was wrong.** A `Room` is a shape, not a place — `corners()` walks the wall
chain from (0, 0), because a chain of headings and lengths has no opinion about
where it starts. Everything else read out of a scan — furniture, camera poses —
came back in the scanner's own metres, counted from wherever somebody pressed
start. Those are two different frames. In Gilbert's kitchen they were **7.93 ft
apart in x and 8.38 ft in y**.

On top of that, `toPhoto` was inverting `referenceOriginTransform` before placing
a pose, on the reasoning that RoomPlan surfaces are in the room's frame while
ARFrames are in the world's. The importer reads surface transforms as world
coordinates, so that rotated the photographer and not the room. Counting camera
positions that land inside the floor polygon settles which is right:

| | with the transform | without it |
|---|---|---|
| Gilbert's kitchen | 172 of 292 | **292 of 292** |
| Sam's garage | 145 of 314 | **250 of 314** |

The 64 left outside the garage are a garage: it has a 15 ft opening across the
front and somebody scanning it stands in the doorway.

**What it cost.** Photographs per wall on the kitchen, before and after:

| | wall-1 | wall-2 | wall-3 | wall-5 | opening-1 |
|---|---|---|---|---|---|
| before | 41 | 21 | 65 | 84 | 76 |
| after | 57 | 75 | 108 | 11 | 9 |

**286 of 292 photographs changed which walls they were said to show.** And the
summary statistic did not move at all: mean walls-in-frame per photo was 1.10
before and 1.10 after. A camera misplaced by eight feet inside a small room
still sees about one wall — just not that one. This is exactly why the number I
reported when photos were built was not evidence of anything.

**The fix.** `RoomFrame` gains an `origin`: where the room's first corner sits in
the datum frame. The importer, the one place that knows both frames, subtracts
it from every footprint and hands it to `toPhoto`. The reference transform is not
applied at all, and `invertRigid` went with it — a function nothing calls is dead
weight.

**What stops it happening again.** Two tests that fail against the old code:
the same scan imported twice, once with the whole building moved 37.4 m by
-18.25 m in the scanner's world, must produce identical footprints; and
furniture must land inside the room it was scanned in. Plus a check on every
capture from now on — `checkCapture` counts photographs taken from outside the
floor outline. Most of them outside is a `stop`, a few is a `note`, because a
few is a garage door.

None of the measurements were wrong. Lengths and areas come from the polygon and
are relative, so the kitchen is still 175.3 sq ft. What was wrong was every
statement relating a photograph or a piece of furniture to a wall.

## The image's axes are not the world's — a 4.5 degree slit

Sam said the bedroom door was on the right in the room and on the left on the
plan. Testing that claim against the camera data found the third bug of the
evening, and the largest.

**What was measured.** ARKit reports the camera in its own landscape frame
whatever way the phone is being held. Both real scans were walked in portrait,
and the numbers are not subtle — the world-y component of the camera's X axis,
the image's "right":

| | median | min | max |
|---|---|---|---|
| kitchen, camera +X | **0.978** | 0.586 | 1.000 |
| kitchen, camera +Y | 0.052 | 0.000 | 0.220 |
| garage, camera +X | **0.946** | 0.312 | 1.000 |

The image's right points at the ceiling. `toPhoto` built its wedge as
`forward ± tan(cx/fx) × cameraX`, which therefore swept the **vertical** field of
view, and its shadow on the plan was a slit:

| | wedge in use | wedge the photo really covers |
|---|---|---|
| kitchen | 4.5° | **61.5°** |
| garage | 4.8° | **68.9°** |

Every answer about which walls a photograph showed came out of a 4.5 degree
slit. That is also why the mean never moved when the frame offset was fixed: a
slit sees about one wall wherever you put it.

**The fix.** The wedge comes from the frustum itself — the four corner rays
`forward ± tan(hx)·right ± tan(hy)·up`, projected onto the plan, and the widest
wedge containing all four, found with exact integer cross products. It never
assumes which image axis is horizontal, so it is right for a phone held any way
up at any tilt.

**What it changed on the real scans.** Kitchen: mean walls per photograph 1.10 →
**2.26**, max 3 → 7, every wall photographed. Garage: 1.89, every wall
photographed, and **20 of 314 frames refused** as pointing too steeply to have a
bearing — somebody looking down at the slab. Refusing those is the point: a
photograph of the floor has no honest answer about which walls it shows, and
`MIN_HORIZONTAL_RAY = 0.15` (about 8.6° off vertical) is where it stops
pretending.

**Tests.** A camera rolled into portrait must cover tens of degrees, not a slit —
that test throws against the old code, because a perfectly upright phone gave it
a wedge of zero width. And a photograph aimed at the floor must be refused by
name rather than failing later as a vector of zero length.

## The plan WAS mirrored. I got this wrong twice.

Sam said a door that was on his right was on the left of the drawing. I told him
it was rotation, not reflection, and gave a derivation. **The derivation was
wrong and he was right.**

Redone: screen-right is world +x and screen-up was world +z, so R x U = -y —
and in a right-handed basis R x U points **toward the viewer**. The viewer was
therefore at -y, underneath the floor, looking up. A view from below the slab.

The physical statement, which is what the test now asserts: **a photographer's
right hand is clockwise from where they are looking, seen from above.** Face the
bottom of a map and your right hand points to its left. Under the old projection
it pointed right. That is the whole bug in one sentence, and no length, area or
closure check has an opinion about it — which is why a suite of 300 tests sat
green over a mirrored drawing for the life of the project.

An independent check found it the hard way: gravity-aligning the photographs
from Sam's own garage and comparing which landmark is left of which against
what the plan says. **0 of 12 landmark pairs agreed; 12 of 12 were mirrored.**

**The fix is a sign, in six places.** `planOrigin`, `planDirection`, the floor
outline, the two object axes in `readObjects`, and the world-to-plan drop in
`capture.ts`, which now has a name — `planFromWorld` — precisely so the question
has one place to be asked and one test to answer it.

**Nothing measured moved.** Verified against all three real scans, before and
after: kitchen 175.3 sq ft, garage 418.0, Sam's garage 411.8, every wall length
identical to the nanometre, and the takeoff unchanged — floor 411.8, wall face
460.5, baseboard 78' 10 1/16". What changed is the compass label on each wall
(north and south swap) and which way round the drawing is.

**The compass was out by twice the heading**, as a consequence, and the unit
test that should have caught it could not: the fixture built a left turn and
paired it with a right-handed bearing, so the mirror cancelled itself. The
fixture now derives the turn from the bearing — one argument, one direction, no
way to pair them wrong — and a new test walks one room with three different
bearings and insists on one north.

The lesson worth keeping: **every check in this codebase was invariant under
reflection.** Lengths, areas, closure, tolerance, the solver. A property that
nothing tests is a property that is free to be wrong, and the way it surfaced
was a man standing in his own garage saying the door is on the other side.

## Three more from the same audit

**Merging two wall stubs kept whichever came first.** `makeWall` on a garage
door merges the stubs either side of it, and the merged wall inherited the first
segment's height — on Sam's garage, 5.94 m of wall at a 572 mm stub's 1950 mm,
with the 2130 mm piece discarded. **16.8 sq ft of drywall and paint left the
takeoff**, the room still closed exactly, and nothing was reported. It takes the
tallest now, and a piece with no height of its own means the ceiling, which is
taller than anything — so the key is removed rather than left behind by the
spread. Two tests, both failing against the old code.

**The frame alarm quoted the wrong numbers.** It filtered the implausible camera
heights and then reported the range over *all* of them, so six frames at 13–15 ft
were described as "between 3' 11" and 15' 6"" because one good photograph was the
minimum. A stop finding that understates its own evidence teaches people to argue
with it.

**Walls that stand short had no check.** Every wall keeps its own scanned height
and the ceiling is the tallest of them, so a wall the scanner read short simply
stands short. The older garage has one at 5'4" against a 7' ceiling, presented
without comment as a pony wall. There was a plausibility check for door heights
and none for walls, and the wall face is what drywall and paint are priced off.

## The plan is not mirrored, and here is why — WRONG, see above

Kept as written, because being able to see the mistake matters more than
tidying it away. The derivation below is the one that got the handedness
backwards; the section above has the correction and the test.

> Screen right is world +x, screen up is world +z, so the direction into the
> screen is x × z = −y. The viewer is above the room looking down.

`R × U` points at the viewer, not away from them. It said the viewer was under
the floor.

## A plan with a north arrow on it

The same drawing had a compass rose. There is no compass in the data — RoomPlan
gives no heading, and the datum is the longest wall, which is a choice this
importer made. `north`, `south`, `east` and `west` in the code are names for the
axes of that datum, not directions in the world, and putting an N on a drawing
asserted something the file does not contain.

Replaced with what the file does contain: the 292 camera positions, drawn as the
path the person actually walked, and the window. A room is oriented by its
window and where somebody started, not by a direction nobody recorded.

## `11.7` is not eleven foot seven

Gilbert taped two walls and both came back "11.7". The parser reads a bare
decimal as feet, so `11.7` is 11' 8 3/8" — an inch and three eighths from what a
person standing in a kitchen means by it, and a verified dimension is treated as
exact from then on, so nothing downstream would ever question it.

Guessing which was meant would be inventing a measurement. So the tape box shows
its reading back instead, live, while there is still a chance to disagree with
it: **Reads as 11' 8 3/8" — For 11 foot 7 type 11'7"**. The parser is unchanged.

## Trueline scanned a real room, and the same garage twice

Sam built the app in Xcode, scanned his own garage with it, and sent the
capture back. It is the first time this pipeline has run end to end on hardware:
55 photographs with poses, a `room.json`, a `room.usdz`, all written by our own
code, all read by the importer without a complaint.

**The two-scanner check, on one garage.**

| | OpenPlan3D, earlier | Trueline, tonight | apart by |
|---|---|---|---|
| area | 418.0 sq ft | 411.8 sq ft | 6.2 sq ft, 1.5% |
| long walls | 21' 5 7/16" | 21' 3 13/16" | **1 5/8"** |
| short wall | 19' 5 13/16" | 19' 3 3/4" | **2 1/16"** |

Both inside RoomPlan's own published ±50 mm, which is ±2". Two independent
captures of one room, through two different apps, agree to within the tolerance
the sensor claims. That is the end-to-end confirmation the project has been
waiting for, and it is still not a measurement: neither number has had a tape on
it, and the walls disagree by more than a wall's worth of drywall.

They disagree structurally too. The earlier scan found the garage door as a
15' 9 9/16" open span between two stub walls; tonight's found four solid walls
with a **16' 11 13/16" "window"** in one of them. Same door, classified two ways
by the same framework on two days.

**What Sam's own capture exposed, all now fixed:**

- The room was called **"unidentified"**. That is RoomPlan's label for a room it
  could not classify — a status, not a name — and it was going straight to the
  screen. The capture's own name is used instead.
- **Two refused photographs raised a red alarm panel** across the top of the
  screen. The first frames of any scan are taken while the phone still points at
  the floor, so that alarm would fire on every scan somebody ever took, and an
  alarm that always fires is furniture. It is a line in the findings now.
- A **17-foot window** went through without comment. `checkCapture` now says so:
  anything past 8 ft is usually a garage door, a slider or a wide opening, and
  the difference is what it costs.

## The 3D view is the plan, seen from somewhere else

Sam asked where the 3D model goes after a scan, and for a toggle between the
blueprint and it, with the walls still tappable on both.

The scanner does write `room.usdz` and Apple's viewer will open it. It is
useless for this: a usdz is a mesh, and a mesh does not know which triangle is
the wall you just measured. You cannot tap it and have the room re-solve.

So `project.ts` draws the model instead — an axonometric dollhouse, near walls
taken off, drag to walk around it — and **every face carries the id of the wall
it came from**. Tapping a wall in 3D opens the same tape box as tapping it on
the plan, and typing a number re-solves the same room. One measurement engine,
two ways of looking at it. Parallel projection, not perspective: nobody should
take a measurement off a drawing where the far end of a wall is drawn shorter
than the near end.

Floats live in that one file and nowhere else in `core`. A projection decides
where ink goes on a screen and never what a wall measures.

**A bug worth keeping.** Openings were sorted by depth like everything else, and
an opening lies in the plane of its own wall — the same distance away. On Sam's
garage the window averaged 7.15 to its wall's 6.46, so it was drawn first and
the wall painted over it. Solids are ordered by depth now, and each wall's
openings follow it immediately: an opening is drawn on its own wall or not at
all.

## The takeoff — the arithmetic that was already written and had no door

Three independent pieces of research landed on the same conclusion this week:
the room is not the product, the **quantity takeoff** is. A remodeler spends two
to three hours after every site visit turning a measure into priced numbers,
most of it unpaid, and the proposal decays if it takes longer than a day or two
to arrive. Contractors pay DocuSketch $42–55 a room and wait seven hours for a
worse version of what a phone already holds.

Every quantity any trade prices off is a pure function of the floor polygon, the
ceiling height and the opening schedule. Drywall and paint: wall face less every
opening. Trim: perimeter less door widths. Flooring and tile: floor area. All of
it was already computed — `quantities()` in `zone.ts` has done exactly this since
it was written, and **nothing has ever called it**, because it takes a `Zone` and
there was no way to make one out of a plain room. Splitting an open plan into
zones is the interesting case; a kitchen with four walls is the common one, and
it had no door.

`wholeRoom(room)` is that door, and `roomQuantities(room)` is the two of them
together. Every wall becomes one edge spanning its whole length, and a wall with
nothing built across it becomes an **open** edge rather than a built one, so a
garage door is not quietly priced as drywall, paint and baseboard.

**On the two real rooms:**

| | Sam's garage | Gilbert's kitchen |
|---|---|---|
| floor / ceiling | 411.8 sq ft | 175.3 sq ft |
| wall face, openings off | 460.5 sq ft | 372.0 sq ft |
| baseboard, doors off | 78&prime; 10 1/16&Prime; | 49&prime; 5 9/16&Prime; |
| open span | — | 11&prime; 6 3/4&Prime; |

The garage checks by hand: its perimeter is 81&prime; 3&Prime; and the baseboard comes back
78&prime; 10&Prime;, which is the perimeter less the 2&prime; 5 1/8&Prime; door exactly — and the
16&prime; 11 13/16&Prime; garage door, which RoomPlan called a window, correctly took
**nothing** off the trim, because a baseboard runs under a window.

**What comes off is the part worth reading twice**, and it is what the tests
pin: a door takes its width out of the baseboard and its whole opening out of
the paintable face; a window takes nothing off the baseboard; an open side takes
no drywall, no paint and no trim and is reported separately so somebody can
price a garage door as a garage door.

The card says whose numbers these are in the same words the rest of the app
uses. Until a tape has been on one wall running each way they are the scanner's,
and printing four figures as though they were facts would undo everything the
provenance model is for.

## Tests that can see a mirror

Every check in this codebase was invariant under reflection, which is why three
hundred green tests sat over a mirrored plan for the life of the project.
`reflection.test.ts` fixes that in two directions.

It **asserts the blindness**: a room and its mirror image have the same wall
lengths, the same perimeter, the same area, close exactly, and produce an
identical takeoff. Those are written down as passing tests so nobody ever again
takes a correct area as evidence of a correct drawing.

And it pins the handful of things that *can* see it: the world-to-plan drop must
reverse handedness, a photographer's right hand must come out clockwise of their
view, and the 3D view must hide different walls for a room than for its
reflection. Reintroducing the mirror — one sign, in one line — turns **twelve**
tests red.

## The takeoff leaves the phone

`takeoff.ts` produces the same numbers in two shapes, because two very different
readers get them. Plain text for a person, in a message: what each number is
for, and whose numbers they are. CSV for a spreadsheet or an estimating package,
where **every row carries its own unit and its own provenance in their own
columns** — a bare number in a cell is how a square foot becomes a linear foot
three steps later, and how a guess becomes a fact.

Both shapes carry the caveat. A takeoff off an unchecked scan that leaves this
device without one is a guess wearing a number's clothes, and nothing downstream
will ever say so again. Once every wall has had a tape on it, the apology
disappears on its own.

Two bugs found writing it, both in the exporter and neither in the model: a
comma in a room name was tested by counting commas, which proves nothing when
four other fields have commas of their own — the test parses the CSV properly
now. And truncating where the screen rounds had the garage reading **411.7 sq ft
in the export and 411.8 on screen**, from one exact value. A tenth of a square
foot is nothing; two of the app's own surfaces disagreeing about a number is
not.

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

## Decisions taken since, in Sam's words

Asked through the pop-up, four at a time, and answered:

| Question | Answer | What it decided |
|---|---|---|
| Prices on the claim document? | **Quantities and evidence only** | The adjuster gets measurements and photographs; the priced scope is a separate sheet sent after the scope is agreed. A test refuses a dollar sign anywhere in the file. |
| One room or the whole job? | **Whole job, tick the rooms** | The send card gathers every room on the device, ticks the ones with damage on them, and totals across the job rather than per room. |
| What a live damage pin captures | **The point and a photograph, automatically** | He is already holding the phone at the damage; that is the one moment the photograph is free. Not built yet — the iOS half. |
| What dragging a wall makes it | **A new kind: adjusted by hand** | A fourth provenance, violet on the plan, which never satisfies "put a tape on one wall running each way". |

## A fourth provenance

`scanned`, `verified`, `derived` — and now `adjusted`. A wall somebody dragged
on a screen is not the sensor's number any more and nobody put a tape on it
either. It carries the band of what it replaced as a **floor** rather than a
guarantee, prints "(moved by hand)" instead of a ± band, and is never counted
as measured anywhere. The rule it protects: if dragging ever produced a
verified measurement, an unchecked scan could be made to claim it had been
measured by nudging four walls.

## One invariant refined, with the reason

"Two collinear built walls are one wall written twice" was absolute. It is now
qualified: **unless they are genuinely different walls** — a pony wall meeting
a full-height one, a 2x6 run meeting a 2x4 partition. The rule's own stated
justification ("the solver would move both to correct one error") does not
apply to those. Compared at *effective* values, not as fields: a wall with no
height stands at the room's ceiling, so an explicit 9' in a 9' room is not a
difference.

That refinement is what makes `splitWall` possible, and `splitWall` requires a
difference rather than allowing one.

## A geometric fact that killed a feature as specified

**You cannot add one wall to a closed rectilinear room.** The walk alternates
axes, so it always has an even number of sides; a fifth wall on a rectangle
cannot close, and it lands in line with a neighbour and gets merged. Driving it
in a browser, a 2 ft alcove swallowed a 14'6" wall and took its name.

So `insertWall` is gone and `notchCorner` replaces it: two walls, out and back,
paid for by the two beside the corner, and the room does not change size.

## Still open

Updated 2026-08-25, after the first compiler this project has ever met.

- **The scanner has never finished compiling.** Xcode on Sam's Mac has now
  refused it five times, and every refusal was real: a signing placeholder
  pointing at itself, `CorrectView(...)` called with its arguments out of
  declaration order, `weak` on a protocol with no class bound, and `PinRecorder`
  marked `@MainActor` while `CaptureWriter.write` reads it from a plain static
  function. All five are fixed. **Nobody has watched the build get to the end**,
  so the next error is the next thing to find out. This is still the largest
  unverified surface in the repository.

  What now stands between the code and a compiler is checked without one:
  `check-swift.py` parses 29 of 30 files -- `Backup.swift` excused against a
  recorded hash, read line by line -- `check-swift-names.py` finds seven classes
  of error a parser cannot see, `check-pbxproj.py` reads the project file,
  `check-doors.py` proves every route the app can push has something that opens
  it, and `check-the-checks.py` breaks the real files on purpose and fails if
  any of those goes green over it. Twenty-three cases. That is not a compiler
  and is not claimed to be one.

- ~~A dollhouse for a whole floor.~~ **Built 2026-08-26.** `floor3d.ts`, behind
  a *Dollhouse* toggle on the floor beside *Blueprint*. All four of the
  Matterport features asked for are now built: walking through a room in
  perspective, measuring anything after leaving it, tags pinned in space, and
  the whole floor with the roof off.

- **The batch photo delete spec** — checkboxes, select-all, and the warning when
  the photo being deleted is the only one showing a wall. Decided (gap 3 above),
  not written.

- **`docs/on-the-phone.md` describes 22 tests and none have been run on a
  phone.** Gilbert's actual kitchen is the first one that matters.

- **`ScanScreen.orientation()` reads `UIApplication.shared` from a nonisolated
  static function.** Under Swift 5 with minimal concurrency checking — which is
  what the project builds as — a main-actor member imported from another module
  is a warning, and it built. Under Swift 6 it is an error. It is left alone
  deliberately: it is only ever called from a SwiftUI gesture closure, which
  runs on the main thread, so nothing is wrong at runtime; and annotating it
  `@MainActor` blind could make a build failure nobody here can compile to rule
  out. The right time to change it is the day `SWIFT_VERSION` moves to 6, when
  the compiler will name it.

- **Rooms drawn by hand before 2026-08-25 used a hard-coded 8' ceiling**,
  whatever the profile said, because *Your business* offered a default ceiling
  that nothing read. Fixed. Any room drawn before then wants its height
  checked before its quantities are trusted.

- **The grid had no door for a day, and this is the third time.** Drawing a
  room by tapping its corners was built, unit tested, driven in a browser and
  written up in the handbook, and on a phone it could be opened exactly one way:
  start a scan, let it fail, open the dead capture, and take a way out. Fixed --
  `#draw`, `DrawScreen.swift`, and a *Draw a room* row at the top of the Rooms
  tab. `check-doors.py` now fails if any route loses its door or gains one with
  no screen behind it. It cannot catch a *web* screen with no route at all,
  which is the shape this one took, and says so in its own header; the check
  that a person can reach the grid is `a19-money.mjs`, which drives a browser.

- **A profile handed over by the app was dropped before anybody was listening.**
  `installBridge` runs in an effect inside `App`; `UnitsProvider` is `App`'s
  parent, and React runs effects children-first. So `openCompany` always fired
  into an empty set. It never showed on a phone that had been used before,
  because the profile is in `localStorage` too -- it breaks exactly where the
  hand-over is the only copy: a new phone restoring from iCloud, or a web view
  whose storage the system reclaimed. Fixed by keeping the last profile in
  `bridge.ts` and replaying it to a listener that subscribes late. Same shape as
  the blank paid screens, one level down.

- **A walked room restored from iCloud came back as a scan.** `Backup.push`
  sends whatever capture a room has in one `capture` field, and `restore` wrote
  every one of them to `room.json` -- so a trace came back onto a second phone
  as a RoomPlan capture no importer could read. The record carries a `kind` now
  (`scanned` / `walked` / `drawn`), and a record written before that field
  existed reads as `scanned`, which is what every one of them actually was.

- **The worked example opened without the rate book that priced it.** A project
  file holds a room; the rate book belongs to the contractor, so `#demo` on a
  phone that had never had a rate typed into it priced every line at nothing.
  `changesSince` then correctly reported that the whole signed scope had been
  removed: the Work screen read *"Agreed $0.00"* under an invoice for $2,889.45,
  and the Agreement screen offered a change order deleting the job. Nothing was
  wrong with the app -- the example was half of what made it. `site/tools/demo.mjs`
  now saves the profile beside the project, and `Units.borrow` lends it to the
  screen for as long as the example is open. Nothing borrowed is written to
  storage or handed to the phone, edits while borrowed stay in memory, and the
  contractor's own profile comes back whichever way somebody leaves. Locked by
  `a21-tour.mjs`, which sets a real profile, opens the example, and checks the
  stored one is untouched to the character.

- **`borrow` had to be stable.** Built fresh on each render it was a new
  dependency every render, so the effect that borrows -- and gives back in its
  cleanup -- tore down and set up continuously: borrow, give back, borrow. Same
  shape one level up: the borrowing effect must depend on the ROUTE only, never
  on `loaded`, which changes the instant the example opens.

- **`npm run verify` could not pass on the Mac the app is built on.** Eight
  tools had grown the same copied line -- `process.env.TRUELINE_CHROME ??
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'` -- a path that is real
  inside one Linux container and nowhere else. Harmless until `check-art` went
  into `verify`, which is the command Sam runs before he builds; then the one
  command that says whether the repository is sound died at
  *"Failed to launch chromium because executable doesn't exist at ..."*.
  `core/tools/browser.mjs` and `browser.py` now resolve it -- what was asked
  for, then what Playwright says if it is on disk, then any unpacked build
  highest-number-first, then a message naming `npx playwright install
  chromium`. Trusting `executablePath()` alone would not have done: in this
  container it returns 1234 and what is installed is 1194, so a resolver that
  believed it would have moved the failure rather than fixed it.
  `core/tools/ffmpeg.mjs` does the same for the films and additionally proves
  the build it picked can write H.264, because Playwright ships a VP8-only one
  and a WebM is a coin toss in Safari. `setup-mac.sh` fetches the browser once.
  Locked by `check-portable.py` in `verify`, watched failing in
  `check-the-checks.py`, and the resolver's own branches tested against fake
  disks describing machines that are not this one.

Everything else: build proceeds.

## Standing constraints carried from Plumbline

- Never make anything up. No claimed verification that did not run.
- No stubs, placeholders or TODOs shipped as done.
- AI writes language, never facts and never money. Every figure comes from geometry or SQL.
- All questions asked through the question pop-up, four at a time, never buried in prose.
