# The first six tests

`docs/on-the-phone.md` has twenty-two. These are the six that decide whether the
other sixteen are worth running. If any of these six fails, stop and send me
what the screen said — everything else in this product is downstream of them.

**Where:** any room with four walls. Your own place is fine. It does not have to
be Gilbert's kitchen, and waiting for Gilbert's kitchen is how none of this gets
tested. A bedroom, a garage, an office — anything with a door in one corner, a
window somewhere else, and enough floor to walk round.

**Bring:** the phone, a tape measure, and something to write on.

**Time:** one afternoon. About forty minutes of it is actually testing.

---

## 1 · Is the drawing the right way round?

**Why it gates everything:** every drawing this app made used to be a mirror
image — a view from underneath the slab. Six sign flips fixed it and **no
dimension changed**, which is exactly why three hundred tests never caught it,
and why only a person standing in the room can confirm it. A mirrored plan is
worse than no plan: every number on it is right and the drawing is a lie.

- **Scan** tab. Walk the room slowly, all four walls, the door and the window.
- Open the scan. Look at the plan.
- Stand in the room facing the wall the app calls **wall-1**, holding the phone
  the way you held it scanning.

**Pass:** the door is on the same side of the drawing as it is in the room.

**Fail:** it is on the other side. Tell me which room, which wall, and send me
the scan (swipe the room in the list → share).

---

## 2 · Does Measure work at all?

**Why it gates everything:** this is the path for every room LiDAR cannot do —
too big, too dark, too much glass. It did nothing twice, was fixed twice, and
has never once run on a phone.

- **Measure** tab.
- Wait for tracking to settle. It says *"Lay the phone flat on the floor and tap
  Set floor."*
- Put the phone **face up on the floor, flat**, and tap **Set floor**. If it
  says *"Floor found"* on its own instead, that is also a pass.
- **Pass so far:** the message changes to *"Point at the foot of a corner and
  tap"* and the reticle goes solid.
- Walk round and tap the **foot** of each corner — where the wall meets the
  floor, not at eye level. Lengths appear along the bottom as you go.
- After four corners **Done** becomes tappable.

**Pass:** four corners, four lengths, Done works.

**Fail:** **tell me the exact words on the screen.** They are different for
every reason it can fail — starting up, moving too fast, not enough detail,
relocalizing — and that sentence is the whole diagnosis.

> Two pages on this test, every sentence quoted from the code that prints it:
> `docs/tests-2-and-20-card.pdf`.

---

## 3 · Does a tape reading actually re-solve the room?

**Why it gates everything: this is the product.** No other scanning app does
this. If it does not work, ScanToBid is a worse magicplan.

- Open a scan. Tap a wall.
- Put a real tape on that wall. Type what the tape says.

**Pass:** that wall is now marked **measured**, goes black, and never moves
again. The other walls shift to keep the room closed. The line underneath says
how many moved and whether any moved further than the scanner's own tolerance.

**Write down** what the scanner said that wall was, and what your tape said.
Both numbers, for all four walls if you have the patience. **That is the only
accuracy data this product has ever had**, and section 3 of `docs/BUSINESS.md`
says in writing that we do not have it.

---

## 4 · Does the refusal hold?

**Why it gates everything:** the honest-provenance argument is the entire pitch
to an adjuster. If dragging a wall ever made a room claim it was measured, every
promise this app makes about where a number came from is worth nothing.

- Tap a wall → **Change this wall** → **Move it**. Type a length.
- **Pass so far:** the wall goes exactly where you put it, the rest of the room
  gives way, and the wall turns **violet** and says *"moved by hand"*.
- Now do it to all four walls.

**Pass:** the app **still** says the room has not been measured, and still asks
you to put a tape on one wall running each way.

**Fail:** if it ever says measured — stop, screenshot it, send it to me. That is
the one bug in this app I would call fatal.

Then put a tape on one of them. **Pass:** it goes black, says measured, and the
app refuses to let you drag it again — it tells you to take the tape reading off
first if the wall really is different.

---

## 5 · Is the takeoff right?

**Why it gates everything:** this is the first paid feature, and a quantity that
is wrong is worse than no quantity — somebody bids off it.

- Open a scan → **Takeoff**.
- Check the floor area **by hand**: tape the two directions, multiply, compare.
- Check the baseboard run: it should be the perimeter **minus the door
  openings**.

**Pass:** your arithmetic and the app's agree, and every line says whether it
came from a scan, a tape, or a hand.

**Fail:** tell me which line and both numbers.

---

## 6 · Is there something you would send a client?

**Why it gates everything:** this is what gets shown to the five restoration
contractors in `docs/BUSINESS.md` §10. If it does not survive being texted to
somebody, there is nothing to sell.

- **Send the drawing** → **Send to the client**.
- One HTML file lands in the share sheet. **Text it to yourself.** Open it.

**Pass:** your name at the top, the drawing, what is in the room, what it comes
to, the photographs, and — in amber — where every number came from.

- Now **turn off wifi and mobile data and open it again.**

**Pass:** identical. Nothing in it is fetched from anywhere. That is the whole
point of the file and it is the thing a client will notice.

---

## When something fails

Two things make a failure fixable in one round instead of four:

1. **The exact words on the screen.** Not "it didn't work" — the sentence. Every
   refusal in this app is written to be a diagnosis.
2. **Business tab → bottom → When something goes wrong.** If the app crashed or
   a screen went blank, there is a report in there. Tap **Send them** and it goes
   to support@scantobid.app with the report attached. Nothing is sent unless
   you tap it.

Then keep going down the list. A failure in test 5 does not stop you running
test 6, and I would rather have all six answers than the first one twice.

---

## Then what

The other sixteen are in `docs/on-the-phone.md`, in order, most-important first.
Tests 1 and 20 there are tests 1 and 4 here, so you have already done them.
