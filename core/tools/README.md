# tools

## verify-dxf-dimensions.cjs

Proves the claim the product is sold on: **a DXF that keeps its dimensions.**

```bash
npm i @tarikjabiri/dxf && node verify-dxf-dimensions.cjs     # writes proof.dxf
```

## Where this actually stands, as of 2026-08-20

**The check was lying, and it has been fixed to stop.** It copied the file through `ezdxf`
before rendering, and `ezdxf` repairs a file on save. So every green light was a repaired
copy that no customer would ever receive. It now hands LibreCAD the original bytes, and on
those it **fails**.

What is established, by observation rather than inference:

| Consumer | Our raw file | Notes |
|---|---|---|
| Autodesk Viewer | **draws the geometry**, correct layer colours, **no dimension text** | Autodesk regenerates the lines. Screenshots from Sam. |
| LibreCAD | **draws nothing at all** — blank page | Even a file containing only four plain `LINE` entities comes back blank. |
| LibreCAD, after an `ezdxf` round trip | draws everything including text | Which is what produced the earlier false confidence. |
| `ezdxf` renderer | draws only the plain lines | It needs a stored geometry block, which is still absent. |

**So the file is not fundamentally invalid** — Autodesk reads it and draws it. LibreCAD is
stricter about something `ezdxf` supplies on save, and the exact cause has not been isolated.
Ruled out so far: it is not dimension-specific (plain lines are blank too), and it is not
`$INSUNITS`, `$EXTMIN`/`$EXTMAX` or `$LIMMIN`/`$LIMMAX`, all of which are now set explicitly
and none of which changed the result. The remaining suspect is the `OBJECTS` section —
`ezdxf` writes far more there, including layout and plot settings, which is what LibreCAD's
PDF printer reads.

### Fixed at the source along the way

All of these were mine rather than the library's. It exposes every one of them and the
generator called none:

- `setUnits()` — the file was unitless, so a CAD application guessed the scale
- `middlePoint` — group 11, without which Autodesk draws the lines and omits the number
- `styleName` + a `DIMTXT` of 4 — with no text height, text is drawn at zero size
- `text: '<>'` — the DXF token meaning "draw the measured value here"
- `$EXTMIN` / `$EXTMAX` / `$LIMMIN` / `$LIMMAX` — where the drawing is

### The next test that decides it

Autodesk Viewer, on the current `sample-plan.dxf`, which now carries the text height and the
style. If the numbers appear there, the product claim holds and the LibreCAD failure is a
printing-setup problem to fix separately. If they do not, the geometry block is next.

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
