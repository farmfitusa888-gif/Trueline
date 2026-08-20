# tools

## verify-dxf-dimensions.cjs

Proves the claim the product is sold on: **a DXF that keeps its dimensions.**

```bash
npm i @tarikjabiri/dxf && node verify-dxf-dimensions.cjs     # writes proof.dxf
```

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
