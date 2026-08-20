# tools

## verify-dxf-dimensions.cjs

Proves the claim the product is sold on: **a DXF that keeps its dimensions.**

```bash
npm i @tarikjabiri/dxf && node verify-dxf-dimensions.cjs     # writes proof.dxf
```

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

## The defect that is real: units

`proof.dxf` carries **`$INSUNITS = 0`**, meaning unitless. `@tarikjabiri/dxf` does not write
it. LibreCAD printed the file as a blank sheet until the header was forced to millimetres —
because with no declared unit, a CAD application guesses.

For a contractor that is a plan that prints at the wrong scale, which is worse than one that
does not print at all, because it looks fine.

**Trueline must set `$INSUNITS` explicitly on every export.** It is one header value and it
is not optional.

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
