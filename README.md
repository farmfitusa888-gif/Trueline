<img src="./assets/logo/trueline-wordmark.svg" alt="Trueline" width="380">

Scan a building, correct it by hand, get a blueprint.

LiDAR capture on iOS, 2D and 3D on the web, and — the part nobody else does — a typed
measurement that re-solves the whole model around it.

## Put it on the phone

Once, to install the command. The first half pulls — `install-command.sh`
arrived in a commit, and a file cannot be run before it has been fetched:

```bash
cd ~/trueline && bash setup-mac.sh --checks-only && bash install-command.sh
```

If that stops with `cd: no such file or directory`, the repo is somewhere else.
Find it:

```bash
find ~ -maxdepth 4 -type d -name trueline
```

After that, one word, from any folder:

```bash
trueline
```

It pulls, puts the built bundle back if a build left it modified, installs what is
missing, rebuilds the web screens, checks the things that have gone wrong before,
finds the phone, compiles, installs and launches. It stops at the first thing that is
actually wrong and says what to do about it.

| | |
|---|---|
| `trueline` | build it and put it on the phone |
| `trueline sim` | the simulator — no cable, no signing team, no device |
| `trueline open` | open the project in Xcode |
| `trueline site` | build the website and show you the folder to drag |
| `trueline check` | every test and check, without building |
| `trueline here` | move this Terminal into the repo |

The word carries the path to the repo inside it, so the folder you are standing in
stops mattering. That is the whole reason it exists: every command here used to begin
`cd ~/trueline &&`, which makes the `cd` the load-bearing part and the part most
easily lost when a line is copied. Without it, `npm` reads the folder you are in,
finds no `package.json`, and stops.

The long way still works, from inside the repo:

```bash
cd ~/trueline && npm run phone
cd ~/trueline && npm run sim
```

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
4. **From a quote to a job that pays** — proposal, signature, the scope that freezes
   when somebody signs it, change orders against it, a calendar, invoices, money
   written down against them, and the insurance mode beside all of it. **Done in the
   web half, never once compiled for the phone** — see *What is not built* below.

Next, in `docs/v3.md`: scan → priced scope, the hosted client link, re-scan and diff,
exteriors. Then multiple floors with stairs, site and lot. Android once the data format
is proven.

## Status

Measured on 28 August 2026, at the last commit, by running the commands named:

| | |
|---|---|
| Tests | **1,303 passing, 0 failing** (`npm test`) |
| Typecheck | clean, both workspaces (`npm run typecheck`) |
| Browser audit | **all 56 parts pass** (`npm run audit`) — builds the app, serves it, drives it in a real browser |
| Handbook | **77 cards, 163 quoted labels, every one of them in the app's source** (`npm run check-guide`) |
| Every exported function reachable | yes, or excused in writing (`npm run what-is-left`) |
| Controls nothing drives | **0, with an empty excuse file** (`npm run what-is-untouched`) — in `npm run verify` now that it is green |
| Every checker watched failing | yes (`npm run check-the-checks`) |
| Run against | Node 22.22.2 |

## What works today

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
**It has never been compiled** — see *What is not built* below.

**AR measure is built too** — for a phone with no LiDAR: tap each corner, walk to the next, and
finish by tapping the first corner again. That closing tap is not part of the room; it is the
measurement of how well the pointing went, and it is where the band on every wall comes from.
Nobody publishes how accurately a person can place a point in AR by eye, so rather than invent a
figure, the app asks you to produce one.

Either way the room is corrected identically — same plan, same solver, same words. **How a room
was captured changes nothing about how it is corrected.**

`ios/Trueline.xcodeproj` is checked in: open it, set your signing team, press Run.

**And a job runs end to end in the web half.** The takeoff, the contractor's own rate book, a
proposal with options, a signature taken on the phone with the evidence written out beside it,
the scope that freezes when somebody signs, change orders priced against that frozen scope, days
in the iPhone's own calendar, invoices built from what was signed rather than from what the room
measures today, and the money that came in written down against them. Insurance is a second mode
beside all of it: mark the damage on the wall, log the cut heights and moisture readings, price
the marks at restoration rates kept apart from the remodel book, and send an adjuster one
document with the drawings, the areas, the photographs and the total on it.

Three of the newer pieces are worth naming because they are the kind of thing that is normally
left out:

- **The FTC three-day notice.** A proposal signed at a kitchen table is a sale under 16 CFR
  Part 429. The app asks one question — where does this get signed — refuses to guess the
  answer, works the deadline out in the rule's own business days (Saturday counts; Sunday and
  federal holidays do not), and prints the notice and two completed cancellation forms on the
  document. With no business address on the profile it prints a block saying the notice could
  not be completed, rather than a form with a blank where the address goes.
- **A signed copy that came back can agree the job**, and the weakness travels with it: the
  agreement, the proposal document, every invoice and the QuickBooks export all say it was
  agreed on a photograph rather than signed on the phone, that nobody watched them sign, and
  that no identity was checked. Both fingerprints — of what went out and of what came back —
  are kept, so neither can be swapped for another.
- **A record of what left this phone**, and it never says "sent". The app hands a file to the
  share sheet and is blind after that, so it records what it can stand behind: which document,
  what it was called, how many bytes, when, and a SHA-256 of the exact bytes that went. Backing
  out of the share sheet records nothing at all.

**There is a handbook.** `docs/handbook.html` — every screen and every button in the app, in
73 cards, with a search box that filters them live and a card for each that says where it is,
what it does, the steps, and how you know it worked. `docs/handbook.pdf` is the same thing
printed. `docs/build/check-guide.py` holds it honest: all 159 labels the handbook quotes have to
exist in the app's own source, so renaming a control fails the check rather than silently
leaving somebody hunting for a button that is not there.

**There is a website.** `site/` builds to static HTML with 28 guides, a real room rendered in
WebGL, and a checker that gates the deploy.

## What is not built

Said plainly, because the alternative is somebody finding out at the wrong moment.

**The scanner has never compiled.** This repository is developed on Linux and there is no Swift
compiler on it. Sixteen Python checkers stand in for one — they parse 32 of the 33 Swift files
(`Backup.swift` is excused against a recorded hash and read by hand), read the Xcode project,
prove every route the app can push has a screen behind it, check every synthesised conformance
against the types actually held, and are themselves broken on purpose by `check-the-checks.py`
— and none of that is a compiler and none of it is claimed to be. **It needs a Mac.** `ios/README.md`
and `build.sh` have the steps; `setup-mac.sh` prepares the machine.

**Nothing has ever run on a phone.** `docs/on-the-phone.md` sets out 22 tests. None has been
run on an iPhone. Everything above about the scanner, AR measure, the camera poses, the
calendar, the share sheet and the paywall is written, checked and unproven on the device it is
for.

**The subscription cannot be bought.** `Subscription.onSale` is `false`, so everything is on
for everybody. Going on sale needs an Apple Developer Program membership, a signing team, and
in-app purchase products approved in App Store Connect — a paid agreement and a console this
repository cannot reach. `core/tools/check-paywall.py --release` refuses a build that goes on
sale with the giveaway still switched on. There is no reviewer back door and there will not be
one.

**There is no server, so there is no API and no accounts** — and there is not going to be a
login, on either half. On the phone Apple says who paid; in a browser a code the phone makes
says so. The app itself runs at a public address as a static site with no backend
(`docs/the-browser-version.md`), gated on exactly the line `core/src/entitlement.ts` draws for
the phone, and a self-contained client file still opens in any browser with nothing fetched.
What is still not built is a **hosted, shared** version: rooms on a server, reachable from two
devices without a file passing between them. That costs a server from the day it is turned on,
which is exactly why it is not built. `docs/v3.md` says what it would add and what it would
cost.

**No AI is wired in.** `docs/AI.md` is research and says so in its opening paragraph. Nothing in
`core/`, `web/` or `ios/` calls a model. When something does, it will write language and never
a measurement, a quantity, a rate or a total.

**The browser audit and the film tooling need a network the first time.** Both resolve a
Chromium build on disk and name `npx playwright install chromium` when they cannot find one.

**The scan folders written before 2026-08-28 can hold another room's corrections.** A scan used
to be filed under the name typed into the box rather than under its own folder, so two rooms of
the same name shared one key — and a hand-drawn room ended up inside a garage scan's folder,
where it outranked the capture. The naming is fixed and `isCorrectionOf` makes such a folder
show its capture and say so, but the stray file is still on disk: nothing deletes somebody's
work on one screen's judgement. Delete those folders by hand once you have looked at them.

## Running it

```bash
cd trueline && npm install && npm test && npm run typecheck
npm run dev              # then drop a room.json on the page
npm run verify           # everything that has to be green before a build
npm run check-guide      # the handbook against the app's own source
npm run what-is-untouched   # the 79 findings above; red on purpose
npm run audit            # builds, serves and drives the app in a browser
```

On a Mac, with a phone plugged in:

```bash
cd ~/trueline && git pull && bash build.sh
```

