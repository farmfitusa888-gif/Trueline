# ios — the app

Trueline on a phone. It scans, it measures, it photographs, and it corrects —
all of it in one app, with nothing to export and nothing to upload.

> **None of this Swift has been compiled.** This repository is developed on
> Linux, where there is no Xcode and no Swift toolchain, so it has been checked
> by reading and not by building. Expect compile errors on the first run and
> send the whole list back at once — that is one turn instead of forty. Every
> part that *could* be checked was: both file formats it writes are read by
> `core`, which is tested against two real scans.

## Building it

```bash
open ios/Trueline.xcodeproj
```

That is the whole setup. No Homebrew, no XcodeGen, no command line. In Xcode:
select the **Trueline** target → **Signing & Capabilities** → set **Team** to
your Apple Developer account. Plug in the phone, choose it as the destination,
press **Run**.

The project's first build phase runs `npm install && npm run build` at the top
of the repository and copies `web/dist` into the app, so the screens in the app
are always the ones in this commit. If it cannot find `npm` it says so and uses
whatever was copied last time rather than failing the build.

**Device only.** ARKit does not run in the simulator.

### First time on that phone only

Two things Xcode will not do for you, both one-time:

1. **Developer Mode.** iOS 16 and later refuse to run a build from Xcode until
   it is on. Plug the phone in and press Run once; the phone puts
   **Settings → Privacy & Security → Developer Mode** there. Turn it on and let
   it restart.
2. **Trust the certificate.** A free Apple ID signs the app but the phone does
   not trust it yet: **Settings → General → VPN & Device Management** → your
   Apple ID → **Trust**. Without this the icon installs and the app closes the
   moment it opens.

A free Apple ID also expires the build after seven days. Press Run again and it
comes back; nothing on the phone is lost, because captures live in Documents.

## The two ways to capture a room

| | Scan | Measure |
|---|---|---|
| Needs | LiDAR — iPhone 12 Pro or later, iPad Pro 2020 or later | any ARKit phone |
| How | Walk the room; the phone finds the walls | Tap each corner, walk to the next |
| Photos | Every two seconds, plus a shutter, each with its exact pose | — |
| Where the band comes from | Apple's published ±50 mm | **your own closing tap** |

The app hides Scan on a phone that cannot do it rather than letting somebody
find out halfway through a room.

### The closing tap

Measuring without LiDAR ends by walking back to the corner you started at and
tapping it again. That tap is not part of the room — it is the measurement of
how well the pointing went, and it is where the band on every wall comes from.
Nobody publishes how accurately a person can place a point in AR by eye, so
rather than invent a figure, the app asks you to produce one. Tap within a foot
of where you started and every wall carries that foot; tap within an inch and
every wall carries an inch.

## What happens after either one

The same thing. The plan, every dimension marked scanned or measured, what the
scanner could not see, and a box to type a real measurement into — the same
screens, the same solver, the same refusal to be issued until a tape has been on
one wall running each way. **How a room was captured changes nothing about how
it is corrected.**

The app also checks the capture itself and says what it found: a room that
closes too perfectly to mean anything, a wall that belongs to the room next
door, a door height the scan probably got wrong, a wall no photograph shows.
Those checks used to be a Python script somebody had to run in a terminal. They
are in the app now, because the app put the file there.

## Why the correction screens are a web view

One measurement engine. Nanometre integers, the provenance rules, the solver,
zones, obstruction, the issue guard — writing all of that a second time in Swift
would mean two models in two languages and every bug fixed twice. So capture is
native, because capture has to be, and everything after it is `web/`, running
locally inside the app with no network access at all.

## What a capture looks like on disk

```
Documents/Scans/Kitchen 2026-08-21 1412/
  room.json      Apple's CapturedRoom, exactly as RoomPlan encodes it   (scan)
  photos.json    one line per photograph: the pose, the lens, the trigger (scan)
  photos/        photo_00001.jpg …                                       (scan)
  room.usdz      Apple's 3D model, for Quick Look                        (scan)
  trace.json     the corners you tapped                               (measure)
```

Documents, so they appear in the Files app: a capture can be copied off, backed
up, or sent to a client without Trueline running any server at all.
