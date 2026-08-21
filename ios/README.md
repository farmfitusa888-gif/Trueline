# ios — the scanner

The native half of Trueline: capture a room, photograph it while you walk, and
hand the result straight to the correction screens without leaving the app.

> **None of this Swift has been compiled.** It was written on Linux, where there
> is no Xcode and no Swift toolchain, so it has been checked by reading and not
> by building. Expect compile errors on the first run and send them back — that
> is the fastest way through. Every part that *could* be verified was: the photo
> manifest it writes and the room JSON it writes are both read by `core`, which
> is tested against two real RoomPlan exports.

## Building it

```bash
brew install xcodegen        # once
cd ios && xcodegen           # writes Trueline.xcodeproj
open Trueline.xcodeproj
```

Then in Xcode: select the **Trueline** target → **Signing & Capabilities** →
set **Team** to your Apple Developer account. Plug in the phone, pick it as the
run destination, and press Run.

The project's pre-build step runs `npm install && npm run build` at the top of
the repository and copies `web/dist` into `Trueline/Web`, so the correction
screens in the app are always the ones in this commit. If `npm` is not on
Xcode's `PATH` it says so and uses whatever was copied last time rather than
failing the build.

**Device only.** RoomPlan needs a LiDAR sensor, so this will not run in the
simulator. iPhone 12 Pro or later, iPad Pro 2020 or later.

## What it does

| Screen | What happens |
|---|---|
| Projects | The scans on this phone. They live in Documents, so they are visible in the Files app and can be copied off without any server existing. |
| Scan | RoomPlan's own capture view, **wall lengths live on screen as they settle**, a photo every two seconds while you walk, a shutter for anything you want on the record, and a box to name the room before you forget which one it was. |
| Review | The web app, in a web view, fed the scan directly. The plan, every dimension marked scanned or measured, what the scanner could not see, and a box to type a real measurement into. Share sends the whole folder. |

## Why the correction screens are a web view

There is one measurement engine and it is the one with tests against it.
Nanometre integers, the provenance rules, the solver, zones, obstruction, the
issue guard — writing all of that a second time in Swift would mean maintaining
two models in two languages and fixing every bug twice. Small products die of
that. So capture is native, because capture has to be, and everything after it
is `web/`, running locally inside the app with no network access at all.

## What a scan looks like on disk

```
Documents/Scans/Kitchen 2026-08-21 1412/
  room.json      Apple's CapturedRoom, exactly as RoomPlan encodes it
  photos.json    one line per photograph: the pose, the lens, the trigger
  photos/        photo_00001.jpg …
  room.usdz      Apple's 3D model, for Quick Look
```

`room.json` is deliberately RoomPlan's own format rather than one of ours. The
importer in `core` was written against two real RoomPlan exports and is tested
against them, so writing anything else here would throw that verification away
and start it again.

## The one thing worth checking first

When the first scan comes off the phone, run it through the same tool the
reference scans went through:

```bash
python3 core/tools/inspect-roomplan.py "path/to/Kitchen 2026-08-21 1412"
```

It prints what the file actually contains — squareness, closure, thicknesses,
opening sills, and whether the camera poses land inside the room. If our own
capture disagrees with the two exports the model was built against, that is
where it will show.
