# Getting the current build onto your phone, and what to test on it

Everything below has been run and passes on this machine: 462 tests, both
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

**Before anything else, once:** the scan you showed me that said *"The scan has
no walls"* was written by an old build that saved a capture with nothing in it.
That folder cannot be repaired — there is no room in the file. The list no
longer offers it: it now says *"No walls in this one — the capture did not
finish"* and will not open. **Swipe left on it and delete it.**

Twenty-five minutes, in a real room with a tape in your pocket. Ordered so the ones
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

### 2. Measure — the AR path that did nothing, second attempt

You reported this twice. The first fix was real and was not the whole thing: a
nested object SwiftUI never watched. The second cause is that `ARSCNView` takes
the AR session's delegate for itself, so the floor detection could be silently
disconnected depending on the order the screen came up in — and when it is, the
instruction never moves past *"move the phone slowly across the floor"* and
every tap is refused, over a live camera picture.

The floor is now read straight off the current frame instead, which nothing can
take. Three other things changed with it: anything the reticle lands on counts
as a floor; when nothing is under the ray, it meets the floor's known height
instead (the far corner of a room is often past where any plane has grown to);
and the tracker's own complaint is now the message you see.

- First screen → **Measure a room**.
- **Pass:** within a few seconds of moving the phone, the message changes from
  *"Starting up"* or *"Move the phone slowly from side to side"* to
  *"Point at the foot of a corner and tap"*, and the reticle goes solid.
- Tap each corner walking round. Wall lengths appear along the bottom as you go.
- After four corners **Done** becomes tappable.
- **If it still fails: tell me the exact words on the screen.** They are now
  different for every reason it can fail — starting up, moving too fast, not
  enough detail, relocalizing — and that sentence is the diagnosis.

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

### 7. The drawing, on paper and in a message

- Under the takeoff: **Send the drawing**, with **Save as a picture** and
  **Print it**.
- **Save as a picture** should open the iPhone share sheet with a PNG. Text it
  to yourself.
- **Pass:** the picture has a title block under the drawing — room name, area,
  ceiling, and in amber, *"SCANNED — no wall here has had a tape on it. These
  numbers will move."* Once you have taped a wall each way, that line changes
  by itself.
- Every dimension now sits **outside** the wall it names rather than on top of
  it, which is how a drawing is supposed to read. Check nothing runs off the
  edge on your room.
- **Print it** should give you the drawing and the takeoff on paper, and
  nothing else off the screen — no buttons, no tabs, no header.

### 8. The takeoff, off the phone

- **Send it** should open the iPhone share sheet — text it to yourself.
- **Pass:** what arrives says *"THESE ARE THE SCANNER'S NUMBERS"* until a wall
  has had a tape on it. That caveat travelling with the numbers is the product.
- **Spreadsheet** saves a CSV. Every row carries its own unit and its own
  provenance in their own columns.

### 9. Typing a tape reading

- Tap a wall. Put a real tape on it. Type what the tape says.
- **Pass:** that wall is now marked measured and never moves again; the other
  walls shift to keep the room closed; the line underneath says how many moved
  and whether any moved further than the scanner's own tolerance.
- **This is the whole product.** No other scanning app re-solves the room.

### 10. Compass

- Scan with the phone away from a truck, a panel or a fridge.
- **Pass:** the N arrow on the plan points the same way your phone's Compass
  app does, and the drawing says **±N°** — how much the phone itself doubted it.

### 11. Two scans, two sets of corrections

- Scan the kitchen, correct a wall. Go back. Scan the garage. Go back. Open the
  kitchen again.
- **Pass:** the kitchen correction is still there. There used to be one saved
  room for the whole app, so opening a second scan overwrote the first one's
  work with nothing said.

### 12. Draw a room with no scan at all

The mode that needs no LiDAR, no camera and no hardware — a tape and the
phone, or an old drawing for a building you cannot get into.

- On the opening screen: **Draw it by hand**.
- Name the room, set the ceiling, then walk it: pick which way the next wall
  runs and type its length. Only the headings that turn a corner are offered.
- After three walls of a four-wall room, it says: *"The last wall has to run
  south for 11' 6". The other walls decide it, so there is nothing to
  measure."* Tap **Add it**.
- **Pass:** **Finish the room** gives you a normal plan that reads
  **"Measured — every dimension checked"** rather than the scanner's caveat,
  because every number in it was typed by a person.
- Try breaking it: type lengths that cannot close and finish anyway.
  **Pass:** it refuses, says by how much and in which direction, and says that
  since every length was typed by a person the app cannot choose which one is
  wrong.

### 13. Your business, and the units

- Top right: **Your business**. Name, phone, email, licence, insurance, and a
  logo from your photos. **Pass:** it appears on the plan's title block, on the
  takeoff and on anything you send a client.
- Same screen: **Feet and inches / Metric**. **Pass:** every number on every
  screen changes together, and switching back gives you exactly what you had.
- **What a new room starts at** — the ceiling-height override is a toggle and it
  is off. Turn it on only if your houses really are all the same: a scanner
  measuring a ceiling off a wall it could see beats a habit.

### 14. What it comes to

- Under the takeoff: **What it comes to** → **Set your rates**. Type what you
  charge per square foot, per foot, per door.
- **Pass:** the room prices itself, every line showing the rate times the
  quantity so you can check it by hand, and it says out loud when the money is
  resting on a scan nobody has taped.
- **What happened to it** — quoted, won, lost. Three won jobs that agree on a
  rate and the app will start telling you what you actually charge.

### 15. The client file — the one to show Gilbert

- **Send the drawing** → **Send to the client**.
- **Pass:** one HTML file lands in your share sheet. Text it to yourself and
  open it. It has your name at the top, the drawing, what is in the room, what
  it comes to, photographs of the actual room, and — in amber — where the
  numbers came from.
- **Turn off wifi and mobile data, then open it again.** It must look identical.
  Nothing in it is fetched from anywhere.

### 16. The floor

- Top right: **The floor**. Every room on the phone.
- A room nothing is joined to stands off to one side, dashed, labelled *not
  joined yet*.
- Tap a doorway in one room, then the same doorway in the other. **Pass:** the
  rooms snap together, back to back, the thickness of the wall between them
  apart.
- If you join three rooms in a ring, it will tell you how far the loop misses
  closing by. That number is every scan's error added up, and no other app will
  show it to you.

### 17. CAD, for whoever asks

- **Send the drawing** → **CAD drawing**. A DXF, in your chosen units.
- **Pass:** it opens in the free Autodesk viewer. The walls you taped are
  dimensioned in green on their own layer; the scanner's are yellow. Switch the
  yellow layer off and what is left is everything somebody stood behind.
- **This is the one I would most like a result on.** It has been drawn correctly
  by one renderer here and never opened in Autodesk by anybody.

### Not built yet, so do not test for them

Multiple floors with stairs, exteriors, a hosted client link, and accounts that
join two phones to one job. `docs/v3.md` has the order and the reasoning.

---

## If something fails

Tell me **which numbered test**, what you saw, and which room. If it is a scan,
send the folder — the app writes every scan into its own folder in **Files → On
My iPhone → Trueline**, which you can AirDrop to yourself.
