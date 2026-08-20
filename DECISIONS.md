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
