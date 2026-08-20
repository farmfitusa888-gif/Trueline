const { DxfWriter, point3d, Colors } = require('@tarikjabiri/dxf');

const w = new DxfWriter();

// Confidence as layers — the thing that survives DXF's floating point boundary.
w.addLayer('TRUELINE-WALLS', Colors.White);
w.addLayer('DIM-VERIFIED', Colors.Green);
w.addLayer('DIM-SCANNED', Colors.Yellow);

// A 12' 4 1/2" wall, in inches, drawn on the walls layer.
const L = 148.5;
w.setCurrentLayerName('TRUELINE-WALLS');
w.addLine(point3d(0, 0), point3d(L, 0));

// A dimension a person put a tape on.
w.setCurrentLayerName('DIM-VERIFIED');
w.addLinearDim(point3d(0, 0), point3d(L, 0), { offset: 24 });

// A dimension the sensor produced.
w.setCurrentLayerName('DIM-SCANNED');
// A vertical run needs its angle stated, or a linear dim measures the horizontal
// component of it and reports zero. Aligned dims measure along the segment itself.
w.addLinearDim(point3d(0, 0), point3d(0, 96), { offset: -24, angle: 90 });
w.setCurrentLayerName('DIM-SCANNED');
w.addAlignedDim(point3d(0, 0), point3d(120, 90), { offset: 12 });

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
