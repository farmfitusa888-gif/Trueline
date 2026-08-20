const { DxfWriter, point3d, Colors, Units } = require('@tarikjabiri/dxf');

const w = new DxfWriter();

// Declare the unit. A DXF without $INSUNITS is unitless, and a CAD application
// then guesses the scale — which is a plan that prints at the wrong size, and
// that is worse than one that will not print, because it looks correct.
// Everything below is in inches.
w.setUnits(Units.Inches);

// Declare where the drawing is.
//
// Without $EXTMIN/$EXTMAX and $LIMMIN/$LIMMAX, LibreCAD prints on a default
// letter sheet at 1:1 and a 148-inch drawing falls entirely off the page —
// which is why every render came back blank until the file was accidentally
// repaired by a round trip through another library. The geometry below spans
// roughly -30..160 by -30..100 inches; a real export computes this from the
// model rather than hard-coding it.
w.setVariable('$EXTMIN', { 10: -30, 20: -30, 30: 0 });
w.setVariable('$EXTMAX', { 10: 165, 20: 105, 30: 0 });
w.setVariable('$LIMMIN', { 10: -30, 20: -30 });
w.setVariable('$LIMMAX', { 10: 165, 20: 105 });

// A dimension style that actually has a text height.
//
// With DIMTXT unset the text is drawn at zero size, which is why Autodesk Viewer
// showed the extension lines and arrowheads and no number. The drawing is about
// 150 inches across, so four-inch text reads when the whole plan fits a page.
const style = w.tables.addDimStyle('TRUELINE');
style.DIMTXT = 4;      // text height
style.DIMASZ = 3;      // arrowhead size
style.DIMEXE = 1.5;    // extension line beyond the dimension line
style.DIMEXO = 1;      // gap between the object and the extension line
style.DIMGAP = 1;      // gap around the text
style.DIMDEC = 2;      // decimal places

// Confidence as layers — the thing that survives DXF's floating point boundary.
w.addLayer('TRUELINE-WALLS', Colors.White);
w.addLayer('DIM-VERIFIED', Colors.Green);
w.addLayer('DIM-SCANNED', Colors.Yellow);

// A 12' 4 1/2" wall, in inches, drawn on the walls layer.
const L = 148.5;
w.setCurrentLayerName('TRUELINE-WALLS');
w.addLine(point3d(0, 0), point3d(L, 0));

// A dimension a person put a tape on.
//
// middlePoint is group code 11, where the measurement text sits. Without it,
// Autodesk Viewer draws the dimension lines and no number at all — the arrows
// appear, the figure does not. LibreCAD happens to regenerate the text and hides
// the problem, which is exactly how it went unnoticed.
w.setCurrentLayerName('DIM-VERIFIED');
w.addLinearDim(point3d(0, 0), point3d(L, 0), {
  offset: 24,
  middlePoint: point3d(L / 2, 24),
  styleName: 'TRUELINE',
  text: '<>',
});

// A dimension the sensor produced.
w.setCurrentLayerName('DIM-SCANNED');
// A vertical run needs its angle stated, or a linear dim measures the horizontal
// component of it and reports zero. Aligned dims measure along the segment itself.
w.addLinearDim(point3d(0, 0), point3d(0, 96), {
  offset: -24,
  angle: 90,
  middlePoint: point3d(-24, 48),
  styleName: 'TRUELINE',
  text: '<>',
});
w.setCurrentLayerName('DIM-SCANNED');
// Midpoint of the segment, pushed out along its perpendicular by the offset.
w.addAlignedDim(point3d(0, 0), point3d(120, 90), {
  offset: 12,
  middlePoint: point3d(60 - 7.2, 45 + 9.6),
  styleName: 'TRUELINE',
  text: '<>',
});

const out = w.stringify();
require('fs').writeFileSync('proof.dxf', out);

const lines = out.split('\n').map(s => s.trim());
const count = (name) => lines.filter(l => l === name).length;
console.log('DXF bytes           :', out.length);
console.log('DIMENSION entities  :', count('DIMENSION'));
console.log('LINE entities       :', count('LINE'));
console.log('DIMSTYLE records    :', count('DIMSTYLE'));
console.log('LAYER records       :', count('LAYER'));
console.log('layers present      :', ['TRUELINE-WALLS','DIM-VERIFIED','DIM-SCANNED'].filter(n => out.includes(n)).join(', '));
const i = lines.indexOf('DIMENSION');
console.log('\nfirst DIMENSION entity, first 20 group code lines:');
console.log(lines.slice(i, i + 20).join(' | '));
