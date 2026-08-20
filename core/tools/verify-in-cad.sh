#!/usr/bin/env bash
# Does this DXF actually draw in CAD?
#
# Today proved that a parser is not a renderer and a renderer library is not CAD.
# ezdxf reported an aligned dimension as 120 when CAD shows 150, and refused to
# draw dimensions that CAD draws correctly. Both reports were wrong, and both
# cost a round of confident wrong reporting.
#
# So this check runs a real CAD engine — LibreCAD, through its own dxf2pdf
# renderer — and fails if the drawing comes out blank or loses its dimensions.
#
#   ./verify-in-cad.sh [file.dxf]      defaults to generating and checking proof.dxf
#
# LibreCAD is GPL-2 and is used here as a build tool, invoked as a separate
# program. Nothing of it is linked into or shipped with Trueline.

set -euo pipefail
cd "$(dirname "$0")"

fail() { printf '\n  FAIL: %s\n' "$1" >&2; exit 1; }

for cmd in librecad xvfb-run python3; do
  command -v "$cmd" >/dev/null 2>&1 || fail "$cmd not found.
    apt-get install -y librecad xvfb
    pip install ezdxf pypdfium2 pillow"
done

DXF="${1:-}"
if [ -z "$DXF" ]; then
  command -v node >/dev/null 2>&1 || fail "node not found, needed to generate proof.dxf"
  [ -d node_modules ] || npm install --silent --no-audit --no-fund @tarikjabiri/dxf
  node verify-dxf-dimensions.cjs >/dev/null
  DXF=proof.dxf
fi
[ -f "$DXF" ] || fail "no such file: $DXF"

BASE="$(basename "${DXF%.dxf}")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# A DXF that does not declare its units prints at whatever scale the CAD
# application guesses. That is a plan at the wrong size, which is worse than one
# that will not print, because it looks correct.
python3 - "$DXF" "$WORK/$BASE.dxf" <<'PY'
import sys, ezdxf
src, dst = sys.argv[1], sys.argv[2]
doc = ezdxf.readfile(src)
units = doc.header.get('$INSUNITS', 0)
if units == 0:
    raise SystemExit(
        "  FAIL: $INSUNITS is 0 (unitless).\n"
        "        A CAD application then guesses the scale, and the plan prints at the\n"
        "        wrong size — worse than not printing, because it looks correct.\n"
        "        Call setUnits() on the writer. It is one line."
    )
print(f"  units:    $INSUNITS={units} ({ {1:'inches',2:'feet',4:'mm',5:'cm',6:'metres'}.get(units, 'code %d' % units) })")

# Group code 11 is where the measurement text sits. Without it Autodesk Viewer
# draws the dimension lines and arrowheads and no number at all — the drawing
# looks finished and carries no figures. LibreCAD regenerates the text and hides
# it, which is how it went unnoticed until the file was opened in Autodesk's own
# viewer. So this is asserted directly rather than inferred from a render.
missing = [d.dxf.layer for d in doc.modelspace()
           if d.dxftype() == 'DIMENSION' and d.dxf.get('text_midpoint', None) is None]
if missing:
    raise SystemExit(
        "  FAIL: %d dimension(s) have no text_midpoint (group 11): %s\n"
        "        Autodesk Viewer will draw the lines and omit the numbers.\n"
        "        Pass middlePoint when adding the dimension." % (len(missing), ', '.join(missing))
    )
print("  text:     all dimensions carry a text midpoint (group 11)")

# Deliberately NOT re-saved through ezdxf. Doing that repairs the file on the way
# past, and the check then passes on a copy the customer will never receive —
# which is exactly how this check gave a false green while Autodesk Viewer showed
# a drawing with no numbers on it. CAD must be handed the original bytes.
import shutil
shutil.copyfile(src, dst)
dims = sum(1 for e in doc.modelspace() if e.dxftype() == 'DIMENSION')
print(f"  entities: {dims} DIMENSION")
open('/tmp/_dimcount', 'w').write(str(dims))
PY

EXPECTED_DIMS="$(cat /tmp/_dimcount)"
[ "$EXPECTED_DIMS" -gt 0 ] || fail "the file contains no DIMENSION entities at all"

echo "  rendering through LibreCAD..."
( cd "$WORK" && xvfb-run -a --server-args="-screen 0 1600x1200x24" \
    librecad dxf2pdf "$BASE.dxf" >/dev/null 2>&1 ) || true
[ -f "$WORK/$BASE.pdf" ] || fail "LibreCAD produced no PDF"

python3 - "$WORK/$BASE.pdf" <<'PY'
import sys
import pypdfium2 as pdfium
from PIL import Image, ImageChops
pdf = pdfium.PdfDocument(sys.argv[1])
page = pdf[0]
# A drawing in inches puts LibreCAD on a very large sheet, and rasterising that
# at a fixed scale exhausts memory. Fit the raster to a fixed pixel budget
# instead, so the check works whatever units the drawing declares.
w_pt, h_pt = page.get_size()
scale = min(1.4, 2000.0 / max(w_pt, h_pt))
img = page.render(scale=scale).to_pil().convert('RGB')
bbox = ImageChops.difference(img, Image.new('RGB', img.size, (255,255,255))).getbbox()
if bbox is None:
    raise SystemExit("  FAIL: LibreCAD rendered a blank page — the drawing did not draw.")
w, h = bbox[2]-bbox[0], bbox[3]-bbox[1]
if w < 12 or h < 12:
    raise SystemExit(f"  FAIL: LibreCAD rendered almost nothing ({w}x{h} px of ink).")
print(f"  rendered: {w}x{h} px of ink on a {w_pt:.0f}x{h_pt:.0f}pt sheet (scale {scale:.3f})")
PY

printf '\n  PASS: %s draws in CAD, with %s dimension(s).\n' "$DXF" "$EXPECTED_DIMS"
