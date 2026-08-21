import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength } from '../length.ts';
import { scanned, verified } from '../measurement.ts';
import { type Heading, type Opening, type Room, type Wall } from '../room.ts';
import {
  CONVENTIONAL_CUT_HEIGHT,
  SectionError,
  type Viewpoint,
  aboveCeiling,
  cutAt,
  cutStops,
  dollhouse,
  insidePlan,
  outwardNormals,
  sectionFor,
  wallMidpoints,
} from '../section.ts';
import { RENDER_EPSILON, toRenderModel, toRenderSection } from '../render.ts';

const T0 = '2026-08-19T14:00:00Z';
const T1 = '2026-08-19T15:30:00Z';

function w(id: string, heading: Heading, length: string, openings?: Opening[]): Wall {
  return {
    id,
    heading,
    length: scanned(parseLength(length), parseLength(`1"`), T0, 'roomplan'),
    ...(openings ? { openings } : {}),
  };
}

function partHeight(wall: Wall, height: string): Wall {
  return { ...wall, height: verified(parseLength(height), 'sam', T1, 'tape') };
}

/** A 20' x 12' room, walked counter-clockwise, 8' ceiling. */
function room(walls?: Wall[]): Room {
  return {
    id: 'r1',
    name: 'living',
    walls: walls ?? [
      w('south', 'east', `20'`),
      w('east', 'north', `12'`),
      w('north', 'west', `20'`),
      w('west', 'south', `12'`),
    ],
    ceilingHeight: verified(parseLength(`8'`), 'sam', T1, 'tape'),
  };
}

function eye(x: string, y: string, height: string): Viewpoint {
  return { x: parseLength(x), y: parseLength(y), height: parseLength(height) };
}

function door(id: string, offset: string, width = `3'`, height = `6' 8"`): Opening {
  return {
    id,
    kind: 'door',
    width: verified(parseLength(width), 'sam', T1, 'tape'),
    height: verified(parseLength(height), 'sam', T1, 'tape'),
    offsetFromStart: verified(parseLength(offset), 'sam', T1, 'tape'),
  };
}

function window_(id: string, offset: string, sill: string | null, height = `4'`): Opening {
  return {
    id,
    kind: 'window',
    width: verified(parseLength(`3'`), 'sam', T1, 'tape'),
    height: verified(parseLength(height), 'sam', T1, 'tape'),
    offsetFromStart: verified(parseLength(offset), 'sam', T1, 'tape'),
    ...(sill ? { sillHeight: verified(parseLength(sill), 'sam', T1, 'tape') } : {}),
  };
}

/* --------------------------------------------------------------- ceiling */

test('the ceiling is drawn from below and gone from above', () => {
  const r = room();
  assert.equal(aboveCeiling(r, eye(`10'`, `6'`, `5' 6"`)), false);
  assert.equal(aboveCeiling(r, eye(`10'`, `6'`, `20'`)), true);
  // Level with the ceiling counts as above: edge-on is not worth drawing.
  assert.equal(aboveCeiling(r, eye(`10'`, `6'`, `8'`)), true);
});

test('a walkthrough keeps the ceiling, which is the point of measuring it', () => {
  const view = sectionFor(room(), eye(`10'`, `6'`, `5' 6"`));
  assert.equal(view.mode, 'walkthrough');
  assert.equal(view.ceilingVisible, true);
  assert.ok(view.walls.every((x) => x.visible));
  assert.ok(view.walls.every((x) => !x.cut));
});

test('straight overhead drops the ceiling and keeps every wall', () => {
  const view = sectionFor(room(), eye(`10'`, `6'`, `40'`));
  assert.equal(view.mode, 'plan');
  assert.equal(view.ceilingVisible, false);
  assert.ok(view.walls.every((x) => x.visible), 'from directly above nothing is in the way');
});

/* --------------------------------------------------------------- normals */

test('outward normals point out whichever way the room was walked', () => {
  const counter = room();
  // The same box walked the other way round, so the winding cannot be assumed.
  const clockwise = room([
    w('a', 'north', `12'`),
    w('b', 'east', `20'`),
    w('c', 'south', `12'`),
    w('d', 'west', `20'`),
  ]);

  for (const r of [counter, clockwise]) {
    const normals = outwardNormals(r);
    const mids = wallMidpoints(r);
    // Every outward normal must point away from the room's own centre.
    const cx = mids.reduce((s, p) => s + p.x, 0n) / BigInt(mids.length);
    const cy = mids.reduce((s, p) => s + p.y, 0n) / BigInt(mids.length);
    normals.forEach((n, i) => {
      const dot = n.x * (mids[i]!.x - cx) + n.y * (mids[i]!.y - cy);
      assert.ok(dot > 0n, `${r.walls[i]!.id} normal points inward`);
    });
  }
});

/* ------------------------------------------------------------- dollhouse */

test('the dollhouse takes off the lid and the walls in the way, and only those', () => {
  const r = room();
  // Standing off the south-west corner, well above the ceiling.
  const view = dollhouse(r, eye(`-30'`, `-30'`, `30'`));

  assert.equal(view.ceilingVisible, false);
  const hidden = view.walls.filter((x) => !x.visible).map((x) => x.wallId).sort();
  assert.deepEqual(hidden, ['south', 'west']);
  const kept = view.walls.filter((x) => x.visible).map((x) => x.wallId).sort();
  assert.deepEqual(kept, ['east', 'north'], 'the far walls stay up or it stops reading as a room');
  assert.equal(view.walls.find((x) => x.wallId === 'south')!.hiddenBecause, 'the viewer is outside it');
});

test('an oblique overhead orbit picks the dollhouse on its own', () => {
  const view = sectionFor(room(), eye(`-30'`, `6'`, `30'`));
  assert.equal(view.mode, 'dollhouse');
  assert.equal(view.ceilingVisible, false);
  assert.deepEqual(view.walls.filter((x) => !x.visible).map((x) => x.wallId), ['west']);
});

test('a camera flush against a wall does not delete it', () => {
  const r = room();
  // Exactly on the south wall's plane, above the ceiling and outside in plan.
  const view = dollhouse(r, { x: parseLength(`10'`), y: 0n, height: parseLength(`30'`) });
  assert.equal(view.walls.find((x) => x.wallId === 'south')!.visible, true);
});

/* ------------------------------------------------------------ cut plane */

test('the conventional section is taken at four feet', () => {
  assert.equal(CONVENTIONAL_CUT_HEIGHT, parseLength(`4'`));
  const view = cutAt(room(), { height: CONVENTIONAL_CUT_HEIGHT });
  assert.equal(view.mode, 'cut');
  assert.equal(view.ceilingVisible, false);
  assert.ok(view.walls.every((x) => x.cut));
  assert.ok(view.walls.every((x) => x.drawnTo === parseLength(`4'`)));
});

test('a wall that stops below the plane is drawn whole, not cut', () => {
  // The 7'0" partition is not invented: Sam's kitchen scan has one wall at
  // 2.13 m while every other wall in the same room is 2.4257 m.
  const r = room([
    partHeight(w('south', 'east', `20'`), `7'`),
    w('east', 'north', `12'`),
    w('north', 'west', `20'`),
    w('west', 'south', `12'`),
  ]);
  const view = cutAt(r, { height: parseLength(`7' 6"`) });

  const low = view.walls.find((x) => x.wallId === 'south')!;
  assert.equal(low.cut, false);
  assert.equal(low.drawnTo, parseLength(`7'`), 'drawn to its own top, not to the plane');

  const tall = view.walls.find((x) => x.wallId === 'east')!;
  assert.equal(tall.cut, true);
  assert.equal(tall.drawnTo, parseLength(`7' 6"`));
});

test('a wall exactly level with the plane is under it, not through it', () => {
  const r = room([
    partHeight(w('south', 'east', `20'`), `4'`),
    w('east', 'north', `12'`),
    w('north', 'west', `20'`),
    w('west', 'south', `12'`),
  ]);
  const view = cutAt(r, { height: parseLength(`4'`) });
  const level = view.walls.find((x) => x.wallId === 'south')!;
  assert.equal(level.cut, false);
  assert.equal(level.drawnTo, parseLength(`4'`));
});

test('a cut off the ends of the room is refused, with the reason', () => {
  const r = room();
  assert.throws(() => cutAt(r, { height: 0n }), SectionError);
  assert.throws(() => cutAt(r, { height: parseLength(`-1'`) }), SectionError);
  assert.throws(
    () => cutAt(r, { height: parseLength(`9'`) }),
    (e: unknown) => e instanceof SectionError && /cannot float over the room/.test((e as Error).message)
  );
});

test('a cut at the ceiling cuts nothing and keeps the ceiling', () => {
  const view = cutAt(room());
  assert.equal(view.cutHeight, parseLength(`8'`));
  assert.equal(view.ceilingVisible, true);
  assert.ok(view.walls.every((x) => !x.cut));
});

/* -------------------------------------------------------------- openings */

test('the plane cuts the openings it passes through and no others', () => {
  const r = room([
    w('south', 'east', `20'`, [door('front', `8'`), window_('bay', `2'`, `3'`)]),
    w('east', 'north', `12'`),
    w('north', 'west', `20'`),
    w('west', 'south', `12'`),
  ]);

  // 4'0": through the door (0'-6'8") and through the window (3'-7').
  const mid = cutAt(r, { height: parseLength(`4'`) }).walls.find((x) => x.wallId === 'south')!;
  assert.deepEqual([...mid.openingsCut].sort(), ['bay', 'front']);

  // 2'0": through the door, under the 3'0" sill.
  const low = cutAt(r, { height: parseLength(`2'`) }).walls.find((x) => x.wallId === 'south')!;
  assert.deepEqual(low.openingsCut, ['front']);

  // 7'6": over the door head and over the window head. Nothing is cut.
  const high = cutAt(r, { height: parseLength(`7' 6"`) }).walls.find((x) => x.wallId === 'south')!;
  assert.deepEqual(high.openingsCut, []);
});

test('a plane level with a door head is over it', () => {
  const r = room([
    w('south', 'east', `20'`, [door('front', `8'`)]),
    w('east', 'north', `12'`),
    w('north', 'west', `20'`),
    w('west', 'south', `12'`),
  ]);
  const view = cutAt(r, { height: parseLength(`6' 8"`) }).walls.find((x) => x.wallId === 'south')!;
  assert.deepEqual(view.openingsCut, []);
});

test('a window with no sill height is named, never guessed at', () => {
  const r = room([
    w('south', 'east', `20'`, [window_('unknown', `2'`, null), door('front', `8'`)]),
    w('east', 'north', `12'`),
    w('north', 'west', `20'`),
    w('west', 'south', `12'`),
  ]);
  const view = cutAt(r, { height: parseLength(`4'`) });
  const south = view.walls.find((x) => x.wallId === 'south')!;

  assert.deepEqual(south.openingsOfUnknownSill, ['unknown']);
  assert.deepEqual(south.openingsCut, ['front'], 'the unknown window is not silently cut');
  assert.deepEqual(view.needsSillHeight, ['unknown'], 'gathered for one prompt, not one per wall');
});

test('a door needs no sill height, because a door starts at the floor', () => {
  const r = room([
    w('south', 'east', `20'`, [door('front', `8'`), { ...door('cased', `14'`), kind: 'cased' as const }]),
    w('east', 'north', `12'`),
    w('north', 'west', `20'`),
    w('west', 'south', `12'`),
  ]);
  const view = cutAt(r, { height: parseLength(`4'`) });
  assert.deepEqual(view.needsSillHeight, []);
  assert.deepEqual([...view.walls.find((x) => x.wallId === 'south')!.openingsCut].sort(), ['cased', 'front']);
});

/* ----------------------------------------------------------------- stops */

test('the slider stops where the room has something to show', () => {
  const r = room([
    partHeight(w('south', 'east', `20'`, [window_('bay', `2'`, `3'`)]), `7'`),
    w('east', 'north', `12'`, [door('side', `4'`)]),
    w('north', 'west', `20'`),
    w('west', 'south', `12'`),
  ]);

  // The window head is 3'0" + 4'0" = 7'0", the same as the top of the partition.
  // It is one stop, not two.
  assert.deepEqual(cutStops(r), [
    parseLength(`7'`),     // top of the partition, and the window head
    parseLength(`6' 8"`),  // the door head
    parseLength(`4'`),     // the conventional section
    parseLength(`3'`),     // the window sill
  ]);
});

test('nothing at or above the ceiling is offered as a stop', () => {
  const r: Room = { ...room(), ceilingHeight: verified(parseLength(`4'`), 'sam', T1, 'tape') };
  assert.deepEqual(cutStops(r), [], 'a 4\' ceiling leaves the 4\' convention nowhere to go');
});

/* ---------------------------------------------------------- inside plan */

test('inside the footprint is decided exactly, corners and all', () => {
  const r = room();
  assert.equal(insidePlan(r, eye(`10'`, `6'`, `0"`)), true);
  assert.equal(insidePlan(r, eye(`30'`, `6'`, `0"`)), false);
  assert.equal(insidePlan(r, eye(`10'`, `-1"`, `0"`)), false);
  // A ray due east from this point leaves through the north-east corner. It must
  // be counted once, not twice and not never.
  assert.equal(insidePlan(r, eye(`-5'`, `12'`, `0"`)), false);
  assert.equal(insidePlan(r, eye(`-5'`, `0'`, `0"`)), false);
});

test('an L-shaped room is not treated as its bounding box', () => {
  const l = room([
    w('a', 'east', `20'`),
    w('b', 'north', `6'`),
    w('c', 'west', `12'`),
    w('d', 'north', `6'`),
    w('e', 'west', `8'`),
    w('f', 'south', `12'`),
  ]);
  assert.equal(insidePlan(l, eye(`4'`, `3'`, `0"`)), true, 'the long leg');
  assert.equal(insidePlan(l, eye(`4'`, `9'`, `0"`)), true, 'the upright');
  assert.equal(insidePlan(l, eye(`16'`, `9'`, `0"`)), false, 'the notch is outside the room');
});

/* --------------------------------------------------- an explicit request wins */

test('a dragged slider is never overridden by the auto rule', () => {
  const view = sectionFor(room(), eye(`10'`, `6'`, `5' 6"`), { height: parseLength(`4'`) });
  assert.equal(view.mode, 'cut');
  assert.equal(view.cutHeight, parseLength(`4'`));
  assert.equal(view.ceilingVisible, false, 'asked for a section, got a section');
});

/* ------------------------------------------------------ across the boundary */

test('a section reaches the renderer as floats without becoming a measurement', () => {
  const r = room([
    partHeight(w('south', 'east', `20'`, [door('front', `8'`)]), `7'`),
    w('east', 'north', `12'`),
    w('north', 'west', `20'`),
    w('west', 'south', `12'`),
  ]);
  const rendered = toRenderSection(cutAt(r, { height: parseLength(`4'`) }), 'ft');

  assert.equal(rendered.unit, 'ft');
  assert.equal(rendered.ceilingVisible, false);
  assert.ok(Math.abs(rendered.cutHeight - 4) < RENDER_EPSILON);

  const south = rendered.walls.find((x) => x.id === 'south')!;
  assert.ok(Math.abs(south.drawnTo - 4) < RENDER_EPSILON);
  assert.equal(south.cut, true);
  assert.deepEqual(south.openingsCut, ['front']);

  // The wall is still 7'0" in the model. Clipping it for a drawing changed nothing.
  assert.equal(toRenderModel(r, [], { unit: 'ft' }).walls.find((x) => x.id === 'south')!.height, 7);
});
