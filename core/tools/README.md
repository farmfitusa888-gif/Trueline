# tools

## verify-dxf-dimensions.js

Proves the claim the product is sold on: **a DXF that keeps its dimensions.**

```bash
npm i @tarikjabiri/dxf && node verify-dxf-dimensions.js
pip install ezdxf && python3 -c "
import ezdxf
doc = ezdxf.readfile('proof.dxf')
for d in [e for e in doc.modelspace() if e.dxftype()=='DIMENSION']:
    print(d.dxf.layer, d.get_measurement())
print('audit errors:', len(doc.audit().errors))"
```

### What it established, on 2026-08-20

`@tarikjabiri/dxf` v2.8.9, **MIT**, does emit genuine `DIMENSION` entities. Read back by
`ezdxf` — an independent parser, not the one that wrote the file — the output contains three
DIMENSION entities on named layers, and **zero audit errors**.

| Dimension | Wrote | ezdxf read back |
|---|---|---|
| Horizontal, `angle: 0` | 148.5 (12' 4 1/2") | **148.5000** |
| Vertical, `angle: 90` | 96 (8') | **96.0000** |
| `addAlignedDim` on a 120 x 90 diagonal | 150 expected | **120.0000** |

### The trap, and the rule that avoids it

`addAlignedDim` **does not write the `angle` (group code 50)**. Any consumer that measures by
projecting along that angle therefore reads the horizontal component instead of the true
length — 120 where it should be 150. Confirmed by making `ezdxf` write its own aligned
dimension over identical geometry: it sets `angle` to 36.87 degrees and reads back 150.

**So: always use `addLinearDim` with an explicit angle. Never `addAlignedDim`.**
Zero or ninety degrees for a rectilinear room, `atan2(dy, dx)` for anything angled. Both
verified correct above.

This is exactly the defect that produces "the DXF dropped its dimensions" complaints, and it
is why this script exists rather than a sentence in a document.

### Not verified

The file has not been opened in AutoCAD, Revit or SketchUp. `ezdxf` parsing cleanly with no
audit errors is strong evidence and is not the same thing. Open one in real CAD before the
claim is made to a customer.
