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
