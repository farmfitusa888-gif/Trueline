import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength } from '../length.ts';
import { scanned, verified, verify } from '../measurement.ts';
import type { Heading, Opening, Room, Wall } from '../room.ts';
import { roomToDxf } from '../dxf/room.ts';
import { findSection, parseTags, splitEntities, firstNumber, first } from '../dxf/tags.ts';

/**
 * The room as a drawing a CAD application opens.
 *
 * magicplan's own help page says their DXF export to SketchUp and AutoCAD does
 * not include dimensions, so an architect or a cabinet shop asks for a DXF and
 * gets a shape with no numbers on it. This one carries them, and it carries the
 * thing nothing else about provenance survives the trip into CAD: **which
 * numbers anybody stood behind, as layers you can switch off.**
 *
 * What these tests can and cannot prove is worth stating. They read the file
 * back and check what is in it — the geometry, the layers, the units, the
 * extents. **They cannot prove a CAD application draws it**, and `tools/README`
 * records two occasions where an automated check said the dimensions rendered
 * and they did not. Nothing here is evidence for that claim.
 */

const T0 = '2026-08-25T18:00:00Z';
const scan = (text: string) => scanned(parseLength(text), parseLength(`50mm`), T0, 'roomplan');

function w(id: string, heading: Heading, length: string, openings?: Opening[]): Wall {
  return { id, heading, length: scan(length), ...(openings ? { openings } : {}) };
}

const door: Opening = {
  id: 'd1',
  kind: 'door',
  width: scan(`3'`),
  height: scan(`6' 8"`),
  offsetFromStart: scan(`5'`),
};

/** 20 x 12, one wall taped, a door in the south wall. */
const room: Room = {
  id: 'r1',
  name: 'kitchen',
  walls: [
    { ...w('south', 'east', `20'`, [door]), length: verify(scan(`20'`), parseLength(`20'`), 'sam', T0, 'tape') },
    w('east', 'north', `12'`),
    w('north', 'west', `20'`),
    w('west', 'south', `12'`),
  ],
  ceilingHeight: verified(parseLength(`8'`), 'sam', T0, 'tape'),
};

function entitiesOf(dxf: string) {
  const tags = parseTags(dxf);
  const start = findSection(tags, 'ENTITIES');
  assert.notEqual(start, -1, 'the drawing has no ENTITIES section');
  let end = start;
  while (end < tags.length && !(tags[end]!.code === 0 && tags[end]!.value === 'ENDSEC')) end += 1;
  return splitEntities(tags, start + 2, end);
}

const layersOf = (entities: Tag[][]) =>
  entities.map((e) => first(e, 8)).filter((x): x is string => x !== undefined);

type Tag = { code: number; value: string };

/* ------------------------------------------------------------ the header */

test('the units are declared, always, and never left at unitless', () => {
  // A DXF with $INSUNITS unset is unitless, and a CAD application guesses the
  // scale — a plan that prints at the wrong size, which is worse than one that
  // will not print, because it looks correct. It is one header value and it is
  // not optional.
  for (const [units, expected] of [
    ['in', '1'],
    ['mm', '4'],
  ] as const) {
    const { dxf } = roomToDxf(room, { units });
    const tags = parseTags(dxf);
    const at = tags.findIndex((t) => t.code === 9 && t.value === '$INSUNITS');
    assert.notEqual(at, -1, `$INSUNITS missing for ${units}`);
    assert.equal(tags[at + 1]!.value, expected);
  }
});

test('the drawing says where it is, so a printer has something to fit', () => {
  // Without extents LibreCAD prints on a default letter sheet at 1:1 and a
  // building-sized drawing falls entirely off the page. Every render came back
  // blank until this was set.
  const { dxf } = roomToDxf(room);
  const tags = parseTags(dxf);
  for (const name of ['$EXTMIN', '$EXTMAX', '$LIMMIN', '$LIMMAX']) {
    assert.notEqual(tags.findIndex((t) => t.code === 9 && t.value === name), -1, `${name} missing`);
  }
  const maxAt = tags.findIndex((t) => t.code === 9 && t.value === '$EXTMAX');
  // 20 ft is 240 inches, and the extents have to hold the drawing plus its
  // dimensions and title.
  assert.ok(Number(tags[maxAt + 1]!.value) > 240, 'the extents do not contain the room');
});

/* ---------------------------------------------------------- the geometry */

test('every wall is drawn, and the door leaves a gap in the one it is in', () => {
  const { dxf } = roomToDxf(room);
  const entities = entitiesOf(dxf);
  const lines = entities.filter((e) => e[0]?.value === 'LINE');
  const layers = layersOf(lines);

  // Three plain walls, the south wall broken into two pieces either side of its
  // door, and the door itself on its own layer.
  assert.equal(layers.filter((l) => l === 'TRUELINE-WALLS').length, 5);
  assert.equal(layers.filter((l) => l === 'TRUELINE-OPENINGS').length, 1);
});

test('a side with nothing built across it is not drawn as a wall', () => {
  // A garage door opening on the walls layer is a garage door opening somebody
  // in CAD will price as drywall.
  const garage: Room = {
    ...room,
    walls: room.walls.map((x) => (x.id === 'west' ? { ...x, open: true as const } : x)),
  };
  const layers = layersOf(entitiesOf(roomToDxf(garage).dxf).filter((e) => e[0]?.value === 'LINE'));
  assert.equal(layers.filter((l) => l === 'TRUELINE-OPEN-SPAN').length, 1);
  assert.equal(layers.filter((l) => l === 'TRUELINE-WALLS').length, 4);
});

/**
 * How long the two north-south walls are drawn, in the unit the file declares.
 *
 * Picked out by orientation rather than by length. The long piece of the south
 * wall left over past its door — 20 ft less a 3 ft door starting at 5 ft — is
 * also 12 ft, so counting everything 12 ft long counts three walls and finds a
 * bug that is not there.
 */
function verticalWalls(dxf: string): number[] {
  return entitiesOf(dxf)
    .filter((e) => e[0]?.value === 'LINE' && first(e, 8) === 'TRUELINE-WALLS')
    .filter((e) => Math.abs(firstNumber(e, 11)! - firstNumber(e, 10)!) < 1e-9)
    .map((e) => Math.abs(firstNumber(e, 21)! - firstNumber(e, 20)!));
}

test('the drawing is the right size, in the unit it declares', () => {
  // The two 12 ft walls are 144 inches. So is the long piece of the south wall
  // left over past its door — 20 ft less a 3 ft door starting at 5 ft — which
  // is why this counts the vertical ones rather than everything 144 long.
  assert.deepEqual(verticalWalls(roomToDxf(room, { units: 'in' }).dxf), [144, 144]);

  // And in millimetres the same two walls are 3657.6, exactly.
  const metric = verticalWalls(roomToDxf(room, { units: 'mm' }).dxf);
  assert.equal(metric.length, 2);
  for (const length of metric) assert.ok(Math.abs(length - 3657.6) < 1e-6, `${length}`);
});

test('no two dimensions are drawn on top of each other', () => {
  // The library's own `offset` puts every dimension on a rectangular room in
  // one of two places, so two of the four land on the same line. Saying where
  // the dimension line goes, explicitly and outward, is what stops a drawing
  // with two numbers written over each other.
  const dims = entitiesOf(roomToDxf(room).dxf).filter((e) => e[0]?.value === 'DIMENSION');
  const where = dims.map((e) => `${firstNumber(e, 11)},${firstNumber(e, 21)}`);
  assert.equal(new Set(where).size, dims.length, `two dimensions share a spot: ${where.join(' | ')}`);
});

/* ------------------------------------------- the thing nothing else carries */

test('a measured wall and a scanned one are dimensioned on different layers', () => {
  // This is the product surviving the trip into CAD. Toggle DIM-SCANNED off in
  // a viewer and what is left is every number somebody put a tape on.
  const { dxf } = roomToDxf(room);
  const dims = entitiesOf(dxf).filter((e) => e[0]?.value === 'DIMENSION');
  const layers = layersOf(dims);
  assert.equal(layers.filter((l) => l === 'DIM-VERIFIED').length, 1, 'the taped wall');
  assert.equal(layers.filter((l) => l === 'DIM-SCANNED').length, 3, 'the three that were not');
});

test('every wall gets a dimension, and every dimension has somewhere to put its text', () => {
  // Group code 11 is where the measurement sits. Without it Autodesk Viewer
  // draws the extension lines and the arrowheads and no number at all.
  const { dxf } = roomToDxf(room);
  const dims = entitiesOf(dxf).filter((e) => e[0]?.value === 'DIMENSION');
  assert.equal(dims.length, room.walls.length);
  for (const dim of dims) {
    assert.notEqual(firstNumber(dim, 11), undefined, 'a dimension with nowhere to put its text');
  }
});

test('the caveat and the contractor are in the drawing, not only on the screen', () => {
  const { dxf } = roomToDxf(room, { company: 'Gilbert Remodeling', at: '25 Aug 2026' });
  assert.match(dxf, /SCANNED - no wall here has had a tape on it/);
  assert.match(dxf, /Gilbert Remodeling/);
  assert.match(dxf, /Green dimensions were measured/);
});

test('once every wall is taped the drawing stops apologising', () => {
  const measured: Room = {
    ...room,
    walls: room.walls.map((wall) => ({
      ...wall,
      length: verify(wall.length, wall.length.value, 'sam', T0, 'tape'),
    })),
  };
  const { dxf } = roomToDxf(measured);
  assert.doesNotMatch(dxf, /SCANNED - no wall/);
  assert.match(dxf, /Measured - a tape has been on a wall running each way/);
  const layers = layersOf(entitiesOf(dxf).filter((e) => e[0]?.value === 'DIMENSION'));
  assert.equal(layers.filter((l) => l === 'DIM-SCANNED').length, 0);
});

test('every dimension comes out with a geometry block, so a viewer has something to draw', () => {
  // The last thing both failing consumers had in common. A CAD application
  // regenerates dimension graphics from the definition points; a viewer
  // generally draws the stored block. This does not prove the text renders —
  // nothing here can, and two automated checks have claimed it and been wrong.
  const { report } = roomToDxf(room);
  assert.equal(report.dimensionsGivenGeometry, room.walls.length);
  assert.equal(report.measurements.length, room.walls.length);
  // 20 ft and 12 ft, in inches.
  assert.ok(report.measurements.some((m) => Math.abs(m - 240) < 0.01));
  assert.ok(report.measurements.some((m) => Math.abs(m - 144) < 0.01));
});
