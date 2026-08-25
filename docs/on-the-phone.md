# Getting the current build onto your phone, and what to test on it

Everything below has been run and passes on this machine: 389 tests, both
typechecks, the web build, and the app driven end to end in a browser against
your own garage scan. **None of it has been run on a phone since the plan was
un-mirrored.** That is what this page is for.

---

## Part 1 — Terminal, four commands

Open **Terminal** (⌘-space, type `terminal`, Return) and paste these one at a
time. `~` means your home folder; you do not type your username.

```bash
cd ~/trueline
git pull
open ios/Trueline.xcodeproj
```

**If the first line says `no such file or directory`**, the repo is somewhere
else. Find it:

```bash
find ~ -maxdepth 5 -type d -name trueline 2>/dev/null
```

That prints the path. Use it in place of `~/trueline` and run the three
commands again.

**If `git pull` says you have local changes**, nothing is lost — run this and
then pull again:

```bash
git stash
git pull
```

That is the whole terminal part. You do not need to run `npm` anything: the web
half of the app is committed to the repo already built, and Xcode rebuilds it
by itself if it finds Node on your machine.

## Part 2 — Xcode

1. Plug the iPhone in with a cable. Unlock it and leave it unlocked.
2. Top of the Xcode window, next to **Trueline**, there is a dropdown showing
   the run destination. Click it and pick **your iPhone by name** — not a
   simulator. A simulator has no LiDAR and no compass; nothing on the test list
   below works there.
3. Press **⌘R**.
4. First time only, on the phone: **Settings → General → VPN & Device
   Management → your Apple ID → Trust**. Then ⌘R again.

If Xcode complains about signing: click the blue **Trueline** at the top of the
left sidebar → **Signing & Capabilities** → tick **Automatically manage
signing** and pick your team. Bundle ID stays `com.sunnyacres.trueline`.

---

## Part 3 — what to test, in this order

Twenty minutes, in a real room with a tape in your pocket. Ordered so the ones
that matter most come first, and so a failure early tells you the most.

### 1. Is the plan the right way round? — **the one that matters**

This is the bug you found and I argued with you about. Every drawing the app
made was a mirror image: a view from underneath the slab. Six sign flips fixed
it and **no dimension changed**, which is exactly why three hundred tests never
caught it and why only a person standing in the room can confirm it.

- Scan a room with a door in one corner and a window somewhere else — your
  garage or Gilbert's kitchen both work.
- Stand in the room facing the wall the app calls **wall-1**, holding the phone
  the way you scanned.
- **Pass:** the door is on the same side of the drawing as it is in the room.
- **Fail:** it is on the other side. Tell me which room and which wall, and
  send the scan.

### 2. Measure — the AR path that did nothing

You tapped Measure and nothing happened. The cause was found and fixed: the
screen was watching one object and the taps were changing a different one
nested inside it, so SwiftUI was never told anything had changed. **That fix
has never been run on a device.**

- First screen → **Measure a room**.
- Walk the room tapping each corner.
- **Pass:** a dot lands at every corner, the running length updates as you go,
  and after four corners the **Close the room** button becomes tappable.
- **Fail:** taps land but nothing on screen changes. That is the same bug back.

### 3. Blueprint / 3D toggle

- Open a scan. There is a **Blueprint / 3D** tab pair above the drawing.
- **Pass:** 3D shows the room from above and outside; dragging spins it;
  **tapping** a wall selects it — the same wall it selects in Blueprint; and
  "Straighten up" puts the view back.
- Watch for: a drag that ends on a wall should *not* select it. Dragging and
  tapping are different actions.

### 4. Wall thickness — new, and the reason the takeoff was incomplete

- Under the plan there is **How thick are the walls?** with buttons: 2x4, 2x6,
  2x4 5/8, 2x6 5/8, 8" block.
- Tap **2x4**.
- **Pass:** nothing already on the drawing moves — no length, no area, no
  baseboard. That is correct and deliberate: the scan outline is the *inside*
  face, which is what flooring and paint are priced off. What appears is a new
  block on the takeoff: **Jamb 4.5625 in** (that is 4 9/16", the size on the
  millwork shelf), Opening wrap, Reveal run, Plates, Studs, Headers, and
  Outside footprint.
- Tap **2x6** and the jamb becomes 6.5625 in — 6 9/16". Those two numbers are
  the two sizes actually sold, and the app derives them rather than storing
  them, which is the check that the rule behind them is right.
- Select one wall on the plan first and the card retargets to that wall, so the
  outside walls can be 2x6 while the partitions are 2x4.

### 5. Ceiling height

The scan takes this from the tallest wall it saw. It is the number that
multiplies every square foot of drywall and paint in the room, and it is the
one nobody ever looks at and disagrees with, because a ceiling has no corner to
stand in.

- Under the plan: **How high is the ceiling?** It shows the scanned figure and
  its band, and what two inches of error is worth in *that* room.
- Tap 8', 9' or 10' if you know it, or type a tape reading.
- **Pass:** the takeoff's **Wall face** moves and **Floor** and **Baseboard**
  do not — neither of those has ever cared how high the room is.
- **This was broken until today and is worth watching.** Every wall arrived
  carrying its own height copied from the scan, so every wall was overriding
  the ceiling and measuring it changed nothing at all. Now only a wall that
  genuinely stops short — a pony wall, a bar, a soffit — carries its own, and
  the import notes say which. Your garage has none; Gilbert's kitchen has one.

### 6. Door and window sizes

The measurement a scan is worst at. RoomPlan called a 16 ft 11 in span a window
in your garage, and a kitchen door came back 2 ft 7 in wide — nobody carries a
sheet of plywood through that.

- Tap a wall that has something in it. Under the length box there is now **In
  this wall**, listing every door and window with its size and its band.
- Tap **Measure** on one. Four fields open: width, height, sill off the floor
  (windows only), and how far it is from the corner.
- Type a real width.
- **Pass:** that number goes exact, the takeoff's baseboard and paint move to
  match, and **no wall moves** — an opening is a hole in a wall, not a side of
  the building.
- Now try to break it: type a distance from the corner that would push the
  opening past the end of the wall. **Pass:** it is refused, and the refusal
  says by how much and what the wall measures, so you know which of the two to
  go and measure.

### 7. The takeoff, off the phone

- **Send it** should open the iPhone share sheet — text it to yourself.
- **Pass:** what arrives says *"THESE ARE THE SCANNER'S NUMBERS"* until a wall
  has had a tape on it. That caveat travelling with the numbers is the product.
- **Spreadsheet** saves a CSV. Every row carries its own unit and its own
  provenance in their own columns.

### 8. Typing a tape reading

- Tap a wall. Put a real tape on it. Type what the tape says.
- **Pass:** that wall is now marked measured and never moves again; the other
  walls shift to keep the room closed; the line underneath says how many moved
  and whether any moved further than the scanner's own tolerance.
- **This is the whole product.** No other scanning app re-solves the room.

### 9. Compass

- Scan with the phone away from a truck, a panel or a fridge.
- **Pass:** the N arrow on the plan points the same way your phone's Compass
  app does, and the drawing says **±N°** — how much the phone itself doubted it.

### 10. Two scans, two sets of corrections

- Scan the kitchen, correct a wall. Go back. Scan the garage. Go back. Open the
  kitchen again.
- **Pass:** the kitchen correction is still there. There used to be one saved
  room for the whole app, so opening a second scan overwrote the first one's
  work with nothing said.

### Not built yet, so do not test for them

Thumbnails on the scan list, multiple rooms stitched into a floor, printing,
saving the drawing as an image, ESX export, and accounts or sharing between
phones. They are next, in that order.

---

## If something fails

Tell me **which numbered test**, what you saw, and which room. If it is a scan,
send the folder — the app writes every scan into its own folder in **Files → On
My iPhone → Trueline**, which you can AirDrop to yourself.
