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
cd ~
git clone https://github.com/farmfitusa888-gif/trueline.git
cd trueline
open ios/Trueline.xcodeproj
```

That is the whole setup. No Homebrew, no XcodeGen, no Node. In Xcode: select the
**Trueline** target → **Signing & Capabilities** → set **Team** to your Apple
Developer account. Plug in the phone, choose it as the destination, press
**Run**.

The bundle identifier is `com.sunnyacres.trueline`, set in the project rather
than typed in every time. It is the app's permanent name to Apple: change it
after a build has gone to App Store Connect and that is a new app record with no
testers on it, so it is set now, before the first upload.

**Node is optional.** The built web app is committed at `Trueline/Web`, so a Mac
with nothing installed but Xcode produces a working app. If `npm` *is* on the
path, the project's first build phase runs `npm install && npm run build` at the
top of the repository and copies `web/dist` over it, so a screen edited five
minutes ago is in the build. If it is not, the build phase says so and uses the
committed bundle — which CI proves is the current one on every push.

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

## Putting it on more than one phone

Three routes, and which one you want depends on whether the other phone is in
the room with you.

**Free Apple ID, cable.** Plug each phone into the Mac and press Run. No cost,
and the limits are real: **3 devices**, 3 apps installed per device, 10 App IDs,
and everything — profiles, devices, App IDs — **expires 7 days from issue**, so
the app stops opening after a week until you plug in and Run again. Fine for you
and one other person standing next to you. Not fine for a tester across town.
(These figures are Apple's, from a Developer Forums answer rather than the
formal help pages.)

**Apple Developer Program, $99/year, TestFlight.** The real answer for Gilbert.
You upload a build once and he installs it from a link on his own phone with no
cable and no Mac: **up to 100 internal testers** (people on your team) and **up
to 10,000 external testers**, each able to test on up to 30 devices. Builds
expire and get replaced by uploading a new one.

**Apple Developer Program, ad hoc.** Same $99, no TestFlight: you collect each
phone's identifier and sign a build for it. **100 devices per product family per
membership year**, and the count only resets when the membership renews —
disabling a device during the year does not give the slot back.

Sources: [TestFlight](https://developer.apple.com/testflight/),
[Devices overview](https://developer.apple.com/help/account/devices/devices-overview/).
Nothing here has been paid for or signed up to yet — that is a decision, not a
build step.

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

## The icon

`Trueline/Assets.xcassets/AppIcon.appiconset/icon-1024.png`, rendered from
`assets/logo/trueline-mark.svg`. It is opaque RGB with no alpha channel, which
is what the App Store requires and what Xcode will otherwise reject at upload
time. To change it, edit the SVG and rasterise — never touch the PNG by hand.

## Why the correction screens are a web view

One measurement engine. Nanometre integers, the provenance rules, the solver,
zones, obstruction, the issue guard — writing all of that a second time in Swift
would mean two models in two languages and every bug fixed twice. So capture is
native, because capture has to be, and everything after it is `web/`, running
locally inside the app with no network access at all.

## The web view is served, not opened

`loadFileURL` is the obvious way to show a local page and it does not work for
this bundle. A page loaded from `file://` has an opaque origin, and an ES module
script — which is what a Vite build is — gets fetched under CORS rules that an
opaque origin cannot satisfy. The module never runs, and what you see is a white
screen with nothing in the log to explain it.

So `WebBundle.swift` serves the bundle under a scheme of its own,
`trueline://app/index.html`. A custom scheme has a real origin: modules load,
relative paths resolve the way they do on a web server, and `localStorage`
belongs to that origin so corrections survive the app being closed. The handler
only ever reads files inside the app, and every response carries a content
security policy that allows nothing off-device.

`web/vite.config.ts` sets `base: './'` for the same reason. An absolute
`/assets/index.js` resolves to the root of the device's filesystem, where there
is nothing.

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
