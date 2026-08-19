# Blueprint app — market research and product direction

Research date: 2026-08-19. Every claim below is sourced. Provenance is labelled:
**[vendor]** = read off the company's own pricing/help page, **[review]** = reported by a
third-party review or comparison site and not independently confirmed against a billing
page, **[docs]** = Apple/Google developer documentation, **[std]** = W3C or standards body.

Nothing in this document is estimated, inferred, or filled in. Where a number could not be
found, it says so.

---

## 1. The decision that shapes everything: photos alone will not measure a room

The request was "take a series of pictures and group them together in 3D... or the app can
also take measurements while taking the pictures". The measurement half of that is the hard
half, and the capture technology decides whether it is possible at all.

| Method | Accuracy on interior walls | Source |
|---|---|---|
| iPhone LiDAR, properly processed with drift correction | ~1/2 inch on rooms up to 40 ft | [review] scanmanifold |
| iPhone LiDAR, raw through default Apple frameworks | ±2–4 inches across a 20 ft room | [review] scanmanifold |
| Apple RoomPlan output | drift up to ±5 cm per wall | [review] it-jim |
| Photogrammetry (photos only) | ±5–15 cm per wall | [review] amrax |

Photogrammetry fails indoors for a specific, unfixable reason: **plain painted drywall has
no texture for the solver to match against.** It wins on small objects, textures and organic
shapes; it loses on flat interior surfaces, which is the entire subject of a floor plan.

The conclusion is not "photos are useless". Photos are the visual record, the AI input, and
the client-facing evidence. But **depth capture measures, and the human's typed number
overrides.** That ordering is the product.

## 2. Why this must be a native iOS app

| Capability | Browser on iPhone/iPad | Native iOS |
|---|---|---|
| WebXR handheld AR | **Not supported in Safari, 2026** [review] xrdoctors, testmuai | n/a |
| Depth sensing / plane / mesh detection | limited or none in Safari [review] | full |
| LiDAR access | none from the browser | full |
| Structured room model (walls/doors/windows) | none | RoomPlan, free [docs] |

The WebXR Depth Sensing Module is a W3C **Working Draft**, not a shipped Safari feature
[std]. Workarounds exist — 8th Wall runs its own SLAM on the camera feed inside stock Safari,
Variant Launch injects WebXR via App Clips — but none of them gets to LiDAR, and LiDAR is
where the accuracy is.

**iOS-native scanner. Web for everything else.** The projects list, the 2D/3D viewer, the
builder, accounts, sharing and PDF output all run fine in a browser on any tablet.

## 3. iOS has a free head start. Android does not.

Apple's **RoomPlan** returns a *parametric* room — walls, doors, windows, openings, and a
fixed set of furniture — not just a point cloud [docs].

Android's **ARCore Depth API** reaches over 87% of active Android devices as of October 2025
and works without a time-of-flight sensor, computing depth from motion [docs Google]. But it
returns raw depth only. **ARCore has no RoomPlan equivalent**; there is an open feature
request on the ARCore Android SDK asking for exactly that, with no ship date [github
google-ar/arcore-android-sdk#1772].

Android is therefore not "the same app on another platform". It is: build wall-plane fitting,
corner solving, and opening detection from scratch. That is its own project. Defer it, and
design the data format so it can arrive later without a rewrite.

### RoomPlan's real limits — these are the things to engineer around, not away

- Walls are modelled at a **uniform ~16 cm thickness** regardless of reality; anything over
  ~50 cm splits into two thin walls [review] it-jim. (Handling improved in iOS 18 [review].)
- Only a **fixed set of common household objects** is recognised.
- **Double doors and door/window combinations merge incorrectly.**
- Apple recommends a max scan area of about **9×9 m (30×30 ft)**; longer sessions drift,
  overheat, and degrade tracking [review, consistent with Apple guidance].
- A scanning session **should not exceed five minutes** [review].
- Multi-room merging: each room arrives **in its own coordinate system**, and Apple's own
  merge is limited to **a single floor, a single horizontal plane** [docs Apple, "Merging
  multiple scans into a single structure"].
- Merging simplifies geometry and "optimises the final model's appearance at the expense of
  accuracy" [review] it-jim.

**That last cluster is the whole opportunity.** Multi-room and multi-storey stitching is
where every consumer scanning app visibly falls apart, and it is exactly what "multiple
rooms, houses, buildings" requires.

---

## 4. The field: what already exists

| Product | Capture | What you get | Price | Exports | Best at |
|---|---|---|---|---|---|
| **magicplan** | iPhone LiDAR + manual sketch | 2D floor plan, 3D, estimates | ~$33.33/mo [review softwareworld]; free Starter = 2 complete projects, no time limit [review] | PDF, DXF, IFC, **ESX to Xactimate** (Pro, US/CA) [vendor] | Restoration & insurance claims |
| **Polycam** | LiDAR + photogrammetry | 3D mesh, point cloud, floor plans | ~$150/yr Basic [review]; $36/mo Business for 20 plans [review] | 15+ formats: OBJ, FBX, STL, DXF, LAS, PLY, PDF, SVG, CSV — **full set gated to Business/Enterprise** [vendor] | General 3D capture, export breadth |
| **CubiCasa** | phone walk-through | 2D + 3D floor plans | $22.99–$29.99 per scan one-time [review capterra]; **$460–$600 per scan** on some plans [review] | floor plan formats; has an Integrate API for developers [vendor] | Real-estate volume, API integration |
| **Canvas / Twindo** | iPad Pro LiDAR | scan + **human** Scan-to-CAD service, 1–2 day turnaround | ~$29/mo Essentials [review] | CAD | AEC scan-to-CAD, accuracy via humans |
| **Matterport** | Pro3 camera (~$6,000) or phone | hosted 3D tour, AI schematic floor plan | $65/mo (5 spaces) to ~$309/mo Business; pro scan service $350–$1,000/home [review] | tour link, embed | Marketing tours |
| **Hover** | smartphone **photos** | exterior 3D property model, takeoffs | $99/mo + **$29–$139 per project** [review] | 50+ integrations incl. Xactimate, JobNimbus, CompanyCam, AccuLynx | **Exteriors** — roofing, siding |
| **RoomScan Pro / AR Plan 3D** | LiDAR / AR | floor plans with manual editing | app-store tier | varies | Manual correction UX |
| **Measure Square** | AI + CV on plans/scans | AI takeoff, room detection | not found | — | Flooring takeoff |

**Matterport's own caveat is worth quoting:** its AI floor plans are "visual representations
of the layout but **not CAD-accurate drawings and should not be used for construction or
renovation planning**" [review thefuture3d, describing Matterport's positioning]. The most
famous name in the category explicitly disclaims the use case your friend has.

### Two structural facts about this market

1. **Nobody owns interiors + accuracy + estimating in one product.** Hover owns exteriors.
   magicplan owns insurance restoration. Polycam owns raw 3D. Canvas owns scan-to-CAD by
   paying humans to do it. CubiCasa owns real-estate volume. The **remodeler doing interior
   as-builts to price a job** is served by pieces of all of them and the whole of none.
2. **Everyone charges per scan or per project.** Hover $29–$139/project. CubiCasa per scan.
   Matterport per space. The reviews are explicit that this "punishes low-volume
   contractors" [review contractortoolstack] — under 10 jobs/month the math stops working.
   A flat seat price is a genuine competitive weapon here.

---

## 5. What users actually complain about

Collected from app-store review aggregators and review sites. These are reported user
complaints, not my testing.

**Polycam** [review appsupports, getapp, sourceforge]
- Pricing structure, "perceived misleading free trials", unexpected subscription charges.
- **Dimensions and floor plan details are locked behind higher tiers** — users call these
  "essential to using the application".
- Crashes and processing failures; "scans stop working mid-scan"; app closes without
  producing a floor plan.
- **Users reported losing hundreds of scans after upgrading**, with no remedy.
- Export UX: exports every file type instead of letting you pick one; can't save to camera roll.

**magicplan** [review softwareworld, bizwarely, justuseapp, softwareadvice]
- Subscription cost called prohibitive for smaller businesses and independent contractors;
  unclear ROI for infrequent users.
- Mixed accuracy reports — some users report solid results with reliable door/window
  detection, others report measurement discrepancies that propagate into layout errors.
- A user reported the 2-sketch free intro being consumed by the app *copying* their one plan.

**Floor plan tools generally** [review coohom, others]
- **"The biggest frustration is export limitations, not design features."** Free tiers cap
  exports and image resolution — the tool looks great until you need to hand something to a
  client or a contractor.
- **Missing user roles and permissions, version control, and communication tools.**
- **Seat limits push teams into credential sharing**, which is a security problem and a
  growth blocker.

**The as-built workflow itself** [review existingconditions, iscano, bimheroes, asbuiltdrawings]
- Professionals spend **8 to 24 hours** measuring and documenting a single residential space.
- Miss one measurement and it's another trip to the site.
- Teams trust decades-old CAD files that don't show undocumented renovations or structural
  sag — "artifacts, not reality".
- Errors stay hidden until framing or equipment placement, then get paid for through RFIs,
  redesign, rework and coordination churn.
- Tape-measure verification on irregular existing buildings is "slow, selective, and easy to
  get wrong".

---

## 6. What users wish they had — the gap list

Derived directly from the complaints above plus the technical limits in §3. Each line is a
feature we can build.

1. **A correction layer that re-solves.** Type the real number for one wall and have every
   connected room, corner, opening and quantity update around it. Existing apps let you edit
   a value; they do not propagate it. This is the single highest-value differentiator.
2. **Multi-room and multi-storey stitching that survives.** Apple merges one floor, one
   plane. Houses have stairs. Corner-anchored capture plus loop closure — the SLAM technique
   where revisiting a known area corrects accumulated trajectory error [review oxmaint] — is
   the known answer.
3. **Dimensions that are never paywalled.** The thing Polycam users are angriest about.
4. **Exports that keep their dimensions.** magicplan's own help page states DXF export to
   SketchUp/AutoCAD **does not include dimensions** [vendor]. Shipping a DXF that keeps them
   is a small engineering job and a large sales line.
5. **Real roles and permissions, and enough seats not to force password sharing.**
6. **Version history on a plan.** Which measurement changed, who changed it, when, and what
   it was before. Nobody in this list offers it and every remodeler needs it when a client
   disputes a number.
7. **Flat pricing.** No per-scan meter.
8. **Offline capture in a basement with no signal**, syncing when it comes back.
9. **Wall thickness that is real**, not RoomPlan's uniform 16 cm — with a fast way to say
   "these are 2x4 walls, these are 2x6, this one is masonry".
10. **Confidence shown honestly.** Mark which dimensions are scanned (±) versus
    human-verified (exact). A contractor ordering cabinets needs to know which is which. No
    competitor does this, and it is nearly free to build.

## 7. Ideas beyond what the field does

Ordered by value to a remodeler, not by novelty.

- **Scan → scope → price.** Areas, wall runs, opening counts and ceiling heights fall out of
  the model for free. Turn them into quantities: drywall SF, paint SF less openings, flooring
  SF plus waste, baseboard LF, trim LF. This is the bridge to the Plumbline estimator and the
  reason the whole thing pays for itself. Prices come from the company's own accepted-estimate
  history, never invented.
- **A verification punch list.** After a scan, the app lists the dimensions it is least sure
  about and asks for a tape check on those specific ones. Turns 8–24 hours of measuring into
  a 20-minute walk plus six checks.
- **Before/after and progress overlay.** Re-scan the same room mid-job; diff it against the
  as-built. Shows the client what changed and catches framing that went in wrong.
- **Anchor points that survive.** Drop a persistent marker at a corner so a re-scan next
  week lands in the same coordinate system instead of drifting into a new one.
- **Photo pins on the plan.** Every photo attaches to the point in the model it was taken
  from, so "the outlet behind the fridge" is findable six weeks later.
- **Hidden-condition notes in 3D.** Mark where the joists run, where the stack is, where
  they found knob-and-tube — pinned in space, not in a note file.
- **Client-shareable link with a 3D walkthrough and no login.** Matterport's whole business
  is this one feature.
- **Xactimate ESX export** if he touches insurance restoration work at all — magicplan's
  strongest moat is exactly this integration [vendor], and it is why restoration contractors
  pay $33/mo.
- **Exterior later.** Hover proves photos-only works outside, where there is texture — brick,
  siding, shingles, sky edges. The technique that fails indoors succeeds outdoors.
- **AI writes words, never numbers.** A drafted scope of work from the model. Every figure
  in it comes from the geometry or from SQL, never from the model's imagination.

---

## 8. Where this app wins

> Everyone else sells a scan. This sells a **measured building that a human has signed off
> on**, that gets more accurate every time somebody checks a number, and that turns into a
> priced scope.

The wedge, in order of defensibility:

1. **The correction layer** — typed exact measurements that re-solve the whole model.
2. **Stitching that holds across rooms and floors** where Apple's own merge gives up.
3. **Confidence marking** — scanned vs. verified, visible on every dimension.
4. **Flat seat pricing** against a market that meters per scan.
5. **Scan → priced scope**, through the seam to Plumbline.

## 9. What could not be researched from here

Stated plainly rather than guessed:

- CubiCasa's API pricing is not published; it requires contacting them [vendor].
- Measure Square's pricing was not found.
- Canvas/Twindo and PLNAR feature detail beyond the summary above was not found.
- I have no LiDAR device in this environment. **No accuracy figure in this document was
  measured by me.** All of them are cited from published sources and must be re-validated
  against your friend's actual device and actual rooms before any of them are repeated to a
  customer.

## Sources

Apple RoomPlan merging — developer.apple.com/documentation/RoomPlan/merging-multiple-scans-into-a-single-structure ·
RoomPlan critique — it-jim.com/blog/roomplan-framework-by-apple ·
ARCore Depth — developers.google.com/ar/develop/java/depth/developer-guide ·
ARCore room-scanning request — github.com/google-ar/arcore-android-sdk/issues/1772 ·
WebXR on iOS — xrdoctors.pro/blog/webxr-on-ios-what-actually-works · testmuai.com/learning-hub/webxr-compatible-browsers ·
WebXR Depth Sensing Module — w3.org/TR/2025/WD-webxr-depth-sensing-1-20250521 ·
LiDAR accuracy — scanmanifold.com/blog-posts/lidar-on-iphone-how-accurate-is-it-plus-the-biggest-errors-that-manifold-corrects ·
LiDAR vs photogrammetry — amrax.ai/blog/lidar-vs-photogrammetry ·
magicplan exports — help.magicplan.app/export-formats · help.magicplan.app/ifc-and-bim ·
magicplan Xactimate — magicplan.app/integrations/xactimate · help.magicplan.app/xactimate-integration ·
magicplan reviews — softwareworld.co/software/magicplan-reviews · bizwarely.com/articles/magicplan-app-review-floor-plans ·
Polycam exports — learn.poly.cam/hc/en-us/articles/27756102599572-What-File-Types-Can-Polycam-Export ·
Polycam negative reviews — appsupports.co/1532482376/polycam-lidar-3d-scanner/negative-reviews ·
CubiCasa pricing — cubi.casa/pricing · cubi.casa/developers · capterra.com/p/193054/CubiCasa ·
Hover — contractortoolstack.com/software/hover · roofingsoftwareguide.com/guides/hover-pricing ·
Matterport — thefuture3d.com/learn/matterport-cost-guide · scanmanifold.com/blog-posts/matterport-pricing-2026-contractors ·
As-built workflow — existingconditions.com/service/as-built-drawings · iscano.com/laser-scanning-lidar-best-practices/as-built-documentation-best-practices · bimheroes.com/building-remodeling ·
Loop closure / drift — oxmaint.com/blog/post/best-3d-mapping-robots-facility-maintenance-lidar-2026 ·
Multi-storey scanning — poly.cam/blog/how-to-scan-a-building-interior-exterior-and-multi-story-workflows ·
Wall editing UX — apps.apple.com/us/app/ar-plan-measure-room-scanner/id1459846158 · apps.apple.com/ca/app/roomscan-classic/id673673795
