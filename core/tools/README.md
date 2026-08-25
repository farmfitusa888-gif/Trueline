# tools

## What is now verified, and by what

**2026-08-25.** `core/src/dxf/room.ts` writes a room out as a drawing, and
`garage-export.dxf` beside this file is the real garage scan exported through
it, with one wall taped so the drawing carries one measured dimension and three
scanned ones.

`ezdxf-render.png` is that file drawn by **ezdxf's own renderer**, and it settles
the question this README has been open on since 2026-08-20:

| Claim | Status |
|---|---|
| The file is structurally valid | **VERIFIED** — `ezdxf` audit: 0 errors, 0 fixes |
| Geometry is exact | **VERIFIED** — the walls draw at 255.82 and 234.00 inches, which is 21' 3 13/16" and the taped 19' 6" |
| Confidence as layers | **VERIFIED** — the taped wall's dimension draws green on `DIM-VERIFIED`, the other three yellow on `DIM-SCANNED` |
| **Dimension text renders** | **VERIFIED in ezdxf's renderer.** The numbers are drawn. |
| Dimension text renders **in Autodesk** | **STILL NOT VERIFIED.** Nobody has opened this file there. |

**The hypothesis in the last section of this file was right.** It said the
missing piece was the generated geometry block — *"the last thing both failing
consumers have in common"* — because a viewer draws a dimension from its stored
block while real CAD regenerates it from the definition points. The export now
runs every drawing through `completeDxf`, every dimension gets a block, and
ezdxf's renderer draws the numbers. That is the same renderer that produced no
text before.

**What may still be said to a customer, and what may not.** The geometry, the
layers and the text have been watched rendering, by one renderer. Autodesk
Viewer is the tool a customer opens and this file has not been opened there.
Until it has, the honest line is *"dimensions and confidence layers, in a DXF"*
— and the sentence "verified in AutoCAD" is not available.

## The bug this found, which was real and would have shipped

The first version dimensioned walls with `addLinearDim`. A linear dimension
measures along an angle stored on the entity, and `@tarikjabiri/dxf` writes that
angle as **zero for every one of them**. So on any room, the two walls running
north-south would have been dimensioned **0.00** — on a drawing that otherwise
looked completely fine, opened by an architect who would then have measured the
building again.

`addAlignedDim` measures along the segment between its own definition points, so
it is right whichever way a wall runs, and right for a chamfer, which a linear
dimension would have measured as its horizontal component. It is also what
`completeDxf` already knew how to build geometry for.

Two smaller things from the same session: the library's own `offset` puts every
dimension on a rectangular room in one of two places, so two of the four drew on
top of each other — the export now says where each dimension line goes; and
LibreCAD's `dxf2pdf` prints a blank page for **`proof.dxf` too**, which settles
that as a harness limitation rather than anything about a particular file.

## A parser is not a renderer, and this is the third time

`ezdxf`'s `get_measurement()` reports **0.0** for both north-south dimensions in
a file whose definition points are plainly `(0,0)` to `(0,234)`. It projects
along the `angle` attribute, which an aligned dimension does not carry. The
drawn text in the same file, from the same library, reads 234.00.

That is the third time a helper function in this toolchain has reported
something that was not true of the file. Verify against something that draws.

---

## verify-dxf-dimensions.cjs

Proves the claim the product is sold on: **a DXF that keeps its dimensions.**

```bash
npm i @tarikjabiri/dxf && node verify-dxf-dimensions.cjs     # writes proof.dxf
```

## Dimension geometry: generated. Layouts: withdrawn.

`core/src/dxf/complete.ts` generates a geometry block for every dimension — two extension
lines, the dimension line, two arrowheads, and the measurement as text. The strings `148.50`,
`150.00` and `96.00` are in the file, and `dxf-render.png` shows them drawn.

**Emitting `LAYOUT` objects broke the file and has been turned off.** Autodesk's translator
rejected the whole drawing — `AutoCAD-InvalidFile`, *"Design is empty"* — where the previous
version at least drew its geometry. The cause was mine: group 330 is an owner **handle** and a
block-record **name** was written there.

The fix was not to guess at the handle. Layouts only ever served LibreCAD's printer, which is
a harness rather than a customer, and which did not draw the file even with them present. A
construct that helps nobody and can invalidate the drawing does not belong in the default
path. It is `emitLayouts`, off unless asked for, and unverified.

**Status of the current `sample-plan.dxf`: blocks present, layouts absent, untested in
Autodesk.** Nothing about it should be claimed until it has been opened there.

## LibreCAD still prints a blank page, and that is a harness problem

The completed file, with layouts, still prints blank from LibreCAD's `dxf2pdf` on a default
letter sheet. Autodesk renders the same bytes correctly, so this is a limitation of the
verification harness rather than a defect in the drawing, and it stopped being chased on
those grounds. `verify-in-cad.sh` therefore does **not** gate the build.

## Where this actually stands, as of 2026-08-20

### Verified in Autodesk Viewer, by hand

Autodesk Viewer is the customer's tool, and these were confirmed there by manually driving
the Measure tool and the Layers panel. **This is the only verification that counts, and it
cannot be automated from here — it must be done by hand, in the viewer, every time the claim
matters.**

| Claim | Result |
|---|---|
| Geometry is exact | **VERIFIED.** Measure returned **150.000"** on the aligned diagonal and **96.000"** on the vertical — dead on. |
| Confidence as layers | **VERIFIED.** Toggling `DIM-VERIFIED` off removed the green and left the yellow. |
| Dimension text renders | **NOT VERIFIED.** No numbers appear. Three attempts have failed. |

Readings of 148.565" and 23.937" in the same session are unsnapped cursor clicks, not file
error — a wrong coordinate would not land exactly on 150.000 and 96.000 and miss only where
the cursor was placed by eye.

### The claim to make, and the claim not to make

**"DXF that keeps its dimensions" is unproven and must not be said to a customer.** It has
been reported working twice from automated checks and was wrong both times.

What can be said, because it was watched happening: the geometry is exact in Autodesk Viewer,
and the confidence layers work there.

### LibreCAD blank page — cause isolated

Our file contains **zero `LAYOUT` objects**; a repaired copy has two. LibreCAD's `dxf2pdf`
prints *from* a layout, which is where paper size and plot settings live, so with none it has
no page and emits a blank sheet.

Also absent, all of which `ezdxf` writes: `MLINESTYLE`, `MATERIAL`, `MLEADERSTYLE`,
`DICTIONARYVAR`, `ACDBPLACEHOLDER`, `ACDBDICTIONARYWDFLT`.

**`@tarikjabiri/dxf` cannot write layouts.** It exposes `addPaperSpace()`, which creates a
paper-space *block*, and no API for the `LAYOUT` objects themselves. So the library cannot
produce a file LibreCAD will print — which is a printing limitation, not a drawing-validity
one, and is exactly consistent with Autodesk viewing it correctly.

### Still unexplained: the missing dimension text

Ruled out, all now set and none of which changed the result: `$INSUNITS`, `middlePoint`
(group 11), a `DIMTXT` text height of 4, a named `dimstyle`, the `<>` token, and
`$EXTMIN`/`$EXTMAX`/`$LIMMIN`/`$LIMMAX`.

Next hypothesis, untested: the generated **geometry block**. Autodesk Viewer draws dimension
*lines* but no text, which fits a viewer that partially regenerates geometry and reads text
from the stored block. `ezdxf`'s renderer needed that block too. It is the last thing both
failing consumers have in common.

## What real CAD does with it

`librecad-render.png` beside this file is **LibreCAD** — an actual CAD application, not a
parser — rendering `proof.dxf` through its own `dxf2pdf` engine:

- the dimension on `DIM-VERIFIED` draws in green and reads **148.50**, with extension lines,
  dimension line and arrowheads
- the aligned dimension on `DIM-SCANNED` draws in yellow and reads **150.00** — the true
  diagonal of a 120 x 90 triangle
- the layer colours come through, so **confidence as layers works in CAD**

Reproduce:

```bash
apt-get install -y librecad xvfb
Xvfb :99 & DISPLAY=:99 librecad dxf2pdf proof.dxf
```

## Two earlier findings that were wrong, and why

Both came from trusting `ezdxf` helpers as though they were CAD. They are not.

**"The aligned dimension measures 120 instead of 150."** `ezdxf`'s `get_measurement()`
projects along the `angle` attribute, which `@tarikjabiri/dxf` omits, so it read the
horizontal component. Real CAD computes the measurement from the definition points and shows
150.00. The file was always right.

**"The dimensions do not render."** `ezdxf`'s renderer draws a dimension from its stored
geometry block and crashes without `text_midpoint`. Real CAD *regenerates* dimension graphics
from the definition points, which is what AutoCAD does too. LibreCAD drew all three.

The lesson is in the tooling, not the library: **a parser is not a renderer, and a renderer
library is not CAD.** Verify against the thing the customer opens.

## The units defect — found, and fixed at the source

`proof.dxf` originally carried **`$INSUNITS = 0`**, meaning unitless, and LibreCAD printed a
blank sheet until the header was forced. With no declared unit a CAD application guesses, and
for a contractor that is a plan that prints at the wrong size — worse than one that will not
print, because it looks correct.

**This was mine, not the library's.** `@tarikjabiri/dxf` exposes `setUnits()` and
`setVariable()`; the generator simply never called them. It does now, and
`verify-in-cad.sh` **fails** rather than warns if `$INSUNITS` is ever 0 again.

## Superseded: the defect that was real

`proof.dxf` carries **`$INSUNITS = 0`**, meaning unitless. `@tarikjabiri/dxf` does not write
it. LibreCAD printed the file as a blank sheet until the header was forced to millimetres —
because with no declared unit, a CAD application guesses.

For a contractor that is a plan that prints at the wrong scale, which is worse than one that
does not print at all, because it looks fine.

**Trueline must set `$INSUNITS` explicitly on every export.** It is one header value and it
is not optional.

## sample-plan.dxf

A committed copy of the generated output, so it can be downloaded and opened in a CAD
application without running anything. It declares inches (`$INSUNITS=1`) and contains three
dimensions on the confidence layers.

## Running the check

```bash
./verify-in-cad.sh              # generates proof.dxf and checks it
./verify-in-cad.sh some.dxf     # checks a file you already have
```

It fails if the drawing renders blank, renders almost nothing, or contains no
dimensions at all, and it warns when `$INSUNITS` is unset. Cheap enough to run on
every build, and today proved it is the only check that tells the truth.

LibreCAD is GPL-2 and is invoked here as a separate program, never linked or
shipped. See `NOTICES` at the repository root.

## Still not verified

Not opened in AutoCAD, Revit or SketchUp. LibreCAD rendering it correctly through its own
engine is strong evidence and is not the same thing.

## check-reachable.py — what is left

```bash
npm run what-is-left
```

Lists every function the measurement layer exports that nothing outside a test
calls. It exists because `section.ts` held a dollhouse, a cut plane and a
walkthrough for weeks and **nothing in the app called any of it** — finished,
tested, and invisible. Sam had already found the same shape by hand once:
*"I couldn't even use the insurance mode, no way to get there."*

A feature nothing reaches is not built. This says so with a list instead of
somebody's memory.

**Functions only, and that is the design.** The first version looked at every
export and produced two hundred findings, which is the same as producing none:
types, interfaces and `Error` subclasses are almost all of them and almost none
is a problem — a type is used as a type, and an error is thrown where it is
declared and caught elsewhere by `instanceof`, neither of which a name search
models.

Two lists come out, and the second is the one that matters:

- **Exported and never referenced** — dead, or a feature with no way in.
- **Proven and unreachable** — reached only by its own tests. That is the exact
  shape of the bug this exists for. Every one of `section.ts`'s exports was
  tested and none of them was reachable, and a passing test suite said nothing
  about it.

It found the frame alarm, which is the best example of what it is for.
`heightsAboveFloor` measures how high above the floor each photograph was
taken; `checkCapture` raises a **stop** when those heights are not a person
holding a phone, because that means the photographs and the walls are in
different coordinate systems and everything drawn from them is somewhere
plausible and wrong. Both halves existed. Both were tested. Nothing ever called
the first one, so the alarm could not fire. It is wired now, and
`capture.test.ts` runs the whole round trip against Sam's real garage scan —
quiet at a believable height, loud two metres out.

It is a gate now, and it reaches zero. `npm run verify` runs it, and an entry
leaves the list in exactly one of three ways:

  **Wired** — because a person would notice. `setWallHeight` was the clearest:
  a wall could not be given its own height, so the only way to make a pony wall
  was to cut a full-height one in two, and a room scanned with a breakfast bar
  already in it had every quantity priced as if it went to the ceiling.

  **Deleted** — because it was a second way to say something. `floorExtent`
  computed the floor's size a second time when `extentOf` is what the app
  draws with, and two derivations of one datum is two chances to disagree.
  Where a deleted function had a test worth keeping, the assertion moved onto
  the path that runs rather than being thrown away with it.

  **Excused in `reachable-on-purpose.json`, with a written reason.** Some
  functions are deliberately not called: `boundaryContributesNoUncertainty` is
  an invariant whose only right caller is the test that would catch it
  breaking; `sectionFor` is an automatic view policy the app deliberately
  replaced with explicit controls; `readQuickbooks` is the reader that stops an
  export format quietly ceasing to round-trip.

  The reason is checked for length and a thin one is refused as loudly as an
  unreferenced function. "We might need it" is how a list like this stops
  being read, and the whole value of the file is that somebody had to write a
  sentence they were willing to sign.
