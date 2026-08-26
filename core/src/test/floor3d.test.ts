import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength } from '../length.ts';
import { scanned, verified } from '../measurement.ts';
import type { Heading, Opening, Room, Wall } from '../room.ts';
import type { Floor, Join } from '../floor.ts';
import { floorPlan } from '../floorplan.ts';
import { projectFloor } from '../floor3d.ts';
import { project } from '../project.ts';

/**
 * The whole floor as a dollhouse.
 *
 * Two things are being protected here. The first is that this is the SAME
 * building as the flat plan and the same building as the room's own 3D view —
 * a floor whose rooms sat at a different angle, or which kept a wall the room
 * screen drops, would be a second drawing of a second house. The second is that
 * nothing about drawing a picture may touch a measurement: no quantity, no
 * area, no length comes out of here.
 */

const T0 = '2026-08-25T21:00:00Z';
const scan = (text: string) => scanned(parseLength(text), parseLength(`50mm`), T0, 'roomplan');
const said = (text: string) => verified(parseLength(text), 'sam', T0, 'stated');

function w(id: string, heading: Heading, length: string, openings?: Opening[]): Wall {
  return { id, heading, length: scan(length), ...(openings ? { openings } : {}) };
}

function door(id: string, at: string, width = `3'`): Opening {
  return { id, kind: 'door', width: scan(width), height: scan(`6' 8"`), offsetFromStart: scan(at) };
}

function window_(id: string, at: string): Opening {
  return {
    id,
    kind: 'window',
    width: scan(`4'`),
    height: scan(`4'`),
    sillHeight: scan(`3'`),
    offsetFromStart: scan(at),
  };
}

function makeRoom(id: string, name: string, walls: Wall[], ceiling = `8'`): Room {
  return {
    id,
    name,
    walls,
    ceilingHeight: verified(parseLength(ceiling), 'sam', T0, 'tape'),
    wallThickness: said(`4 1/2"`),
  };
}

const kitchen = makeRoom('k', 'kitchen', [
  w('k-south', 'east', `20'`, [window_('k-win', `5'`)]),
  w('k-east', 'north', `12'`),
  w('k-north', 'west', `20'`, [door('k-door', `8'`)]),
  w('k-west', 'south', `12'`),
]);

const hall = makeRoom('h', 'hall', [
  w('h-south', 'east', `20'`, [door('h-door', `9'`)]),
  w('h-east', 'north', `8'`),
  w('h-north', 'west', `20'`),
  w('h-west', 'south', `8'`),
], `10'`);

const join: Join = {
  id: 'front',
  declaredBy: 'sam',
  declaredAt: T0,
  from: { roomId: 'k', wallId: 'k-north', openingId: 'k-door' },
  to: { roomId: 'h', wallId: 'h-south', openingId: 'h-door' },
};

const floor: Floor = { id: 'f', name: 'ground', rooms: [kitchen, hall], joins: [join] };
const LOOKING = { turn: 30, tilt: 45 };

/* --------------------------------------------------------- both rooms are in */

test('every room on the floor is drawn, not just the one that is open', () => {
  const view = projectFloor(floor, LOOKING);
  const drawn = new Set(view.facets.map((f) => f.roomId));
  assert.deepEqual([...drawn].sort(), ['h', 'k']);
});

test('each room keeps its own name on its own faces, so a tap knows what it hit', () => {
  const view = projectFloor(floor, LOOKING);
  for (const facet of view.facets) {
    assert.equal(facet.roomName, facet.roomId === 'k' ? 'kitchen' : 'hall');
  }
});

test('every room gets a floor, so it reads as a room and not a set of panels', () => {
  const view = projectFloor(floor, LOOKING);
  const floors = view.facets.filter((f) => f.kind === 'floor');
  assert.deepEqual(floors.map((f) => f.roomId).sort(), ['h', 'k']);
});

/* ------------------------------------------------------- it is a dollhouse */

test('the walls between the viewer and the rooms come off — that is the whole trick', () => {
  const view = projectFloor(floor, LOOKING);
  assert.ok(view.hidden.length > 0, 'a dollhouse with every wall up is a picture of a box');
  const kept = new Set(view.facets.filter((f) => f.kind === 'wall').map((f) => f.wallId));
  for (const gone of view.hidden) assert.equal(kept.has(gone.wallId), false);
});

test('and which walls come off is the same answer the room’s own view gives', () => {
  // The kitchen sits at the floor's origin unturned, so the two views are
  // looking at it from the same side. If these ever disagree, one of the two
  // screens is drawing a different building.
  const alone = project(kitchen, LOOKING);
  const together = projectFloor(floor, LOOKING);
  const hiddenHere = together.hidden.filter((h) => h.roomId === 'k').map((h) => h.wallId);
  assert.deepEqual(hiddenHere.sort(), [...alone.hidden].sort());
});

test('there is never a ceiling, whichever way it is turned', () => {
  for (const turn of [0, 45, 90, 180, 270]) {
    const view = projectFloor(floor, { turn, tilt: 60 });
    const kinds = new Set(view.facets.map((f) => f.kind));
    assert.deepEqual([...kinds].sort(), ['floor', 'opening', 'wall']);
  }
});

/* -------------------------------------------------------------- what it draws */

test('a room’s own ceiling height is used, not one height for the floor', () => {
  // The hall is 10 feet and the kitchen 8. A dollhouse that levelled them off
  // would be drawing a building nobody scanned.
  //
  // Measured off one wall's own quad rather than off the room's bounding box:
  // a quad is [(a, 0), (b, 0), (b, top), (a, top)], so the drop from its third
  // corner to its first IS the wall's drawn height, with nothing of where the
  // room sits mixed into it. The first attempt at this compared bounding boxes
  // at a near-overhead tilt, where a wall is barely taller than it is deep, and
  // it failed on code that was right.
  const view = projectFloor(floor, LOOKING);
  const height = (roomId: string) => {
    const wall = view.facets.find((f) => f.kind === 'wall' && f.roomId === roomId);
    assert.ok(wall, `no wall drawn for ${roomId}`);
    return wall!.points[0]!.y - wall!.points[3]!.y;
  };
  assert.ok(height('h') > height('k'), 'the ten foot room should stand taller than the eight');
});

test('doors and windows are drawn, each on the wall it is a hole in', () => {
  const view = projectFloor(floor, LOOKING);
  const openings = view.facets.filter((f) => f.kind === 'opening');
  assert.ok(openings.length > 0);
  for (const hole of openings) {
    const wall = view.facets.find(
      (f) => f.kind === 'wall' && f.roomId === hole.roomId && f.wallId === hole.wallId
    );
    assert.ok(wall, `${hole.wallId} has an opening drawn on a wall that is not there`);
  }
});

test('an opening is drawn immediately after its own wall and never before it', () => {
  // Sorting on depth alone painted a wall over its own window on Sam's garage.
  // The room's own view stopped doing it; this has to make the same choice or
  // the two views disagree about a window.
  const view = projectFloor(floor, LOOKING);
  view.facets.forEach((facet, i) => {
    if (facet.kind !== 'opening') return;
    const before = view.facets[i - 1];
    assert.ok(before, 'an opening came first, with no wall in front of it');
    assert.equal(before!.roomId, facet.roomId);
    assert.equal(before!.wallId, facet.wallId);
  });
});

test('a window sits three feet up its own wall and a door stands on the floor', () => {
  // Turned to 180 so the kitchen's south wall faces the viewer rather than
  // being one of the walls the dollhouse takes away -- at turn 0 it is behind
  // you, and the first version of this test failed with "no window was drawn"
  // on a window that was correctly hidden.
  //
  // That wall runs east, so every point on it is the same distance into the
  // view, and screen y along it is height and nothing else. No tolerance to
  // pick, no tilt to be careful about.
  const view = projectFloor(floor, { turn: 180, tilt: 35 });
  const wall = view.facets.find((f) => f.kind === 'wall' && f.wallId === 'k-south');
  assert.ok(wall, 'the wall the window is in was not drawn');
  const bottom = wall!.points[0]!.y;
  const drawnHeight = bottom - wall!.points[3]!.y;

  const sittingOn = (kind: string) => {
    const f = view.facets.find((one) => one.openingKind === kind && one.wallId === 'k-south');
    assert.ok(f, `no ${kind} was drawn on that wall`);
    // Screen y grows downward, so the bottom of a thing is its largest y.
    return (bottom - Math.max(...f!.points.map((p) => p.y))) / drawnHeight;
  };
  // A 3 ft sill in an 8 ft wall.
  assert.ok(Math.abs(sittingOn('window') - 3 / 8) < 0.01, 'the window is not at its sill height');

  // The kitchen's door is in its NORTH wall, which is one of the walls this
  // very view takes away -- so it is looked for from the other side. A door
  // that only ever appeared when the window did would be a test that never
  // looked at a door.
  const behind = projectFloor(floor, { turn: 0, tilt: 35 });
  const door = behind.facets.find((f) => f.openingKind === 'door' && f.roomId === 'k');
  assert.ok(door, 'no door was drawn in the kitchen');
  const doorWall = behind.facets.find(
    (f) => f.kind === 'wall' && f.roomId === 'k' && f.wallId === door!.wallId
  );
  assert.ok(doorWall, 'a door was drawn on a wall that is not there');
  const gap = Math.abs(
    Math.max(...door!.points.map((p) => p.y)) - Math.max(...doorWall!.points.map((p) => p.y))
  );
  assert.ok(gap < 0.01, 'a door is drawn floating off its own floor');
});

/* -------------------------------------------------------------- loose rooms */

test('a room nothing joins yet is still drawn, and is marked as loose', () => {
  const spare = makeRoom('s', 'spare', [
    w('s-south', 'east', `10'`),
    w('s-east', 'north', `10'`),
    w('s-north', 'west', `10'`),
    w('s-west', 'south', `10'`),
  ]);
  const wider: Floor = { ...floor, rooms: [...floor.rooms, spare] };
  const view = projectFloor(wider, LOOKING);
  assert.deepEqual(view.unplaced, ['s']);
  const its = view.facets.filter((f) => f.roomId === 's');
  assert.ok(its.length > 0, 'a room that is not drawn has no door to tap, so it can never join');
  assert.equal(its.every((f) => f.placed === false), true);
  assert.equal(view.facets.filter((f) => f.roomId === 'k').every((f) => f.placed), true);
});

test('every room has a label, and it sits on the floor rather than up a wall', () => {
  const view = projectFloor(floor, LOOKING);
  assert.deepEqual(view.labels.map((l) => l.name).sort(), ['hall', 'kitchen']);
  for (const label of view.labels) {
    const its = view.facets.filter((f) => f.roomId === label.roomId);
    const ys = its.flatMap((f) => f.points.map((p) => p.y));
    assert.ok(label.at.y >= Math.min(...ys) && label.at.y <= Math.max(...ys));
  }
});

/* -------------------------------------------------------- nothing else moves */

test('a floor with no rooms is refused here exactly as it is on the flat plan', () => {
  // Not softened into an empty drawing. `layout` refuses a floor with nothing
  // on it, and a second view of the same floor that quietly returned a blank
  // picture instead would be hiding a refusal the flat view makes out loud --
  // and the screen would then have two behaviours to handle for one state.
  const empty = { id: 'f', name: 'ground', rooms: [], joins: [] };
  assert.throws(() => floorPlan(empty), /no rooms in it/);
  assert.throws(() => projectFloor(empty, LOOKING), /no rooms in it/);
});

test('the drawing is fitted to the box asked for and stays inside it', () => {
  const view = projectFloor(floor, LOOKING, 500);
  const xs = view.facets.flatMap((f) => f.points.map((p) => p.x));
  const ys = view.facets.flatMap((f) => f.points.map((p) => p.y));
  assert.ok(Math.min(...xs) >= -0.5 && Math.max(...xs) <= 500.5);
  assert.ok(Math.min(...ys) >= -0.5 && Math.max(...ys) <= 500.5);
});

test('turning the camera moves no number that anybody is paid on', () => {
  // The guard this file exists for. A projection is presentation; the plan and
  // the quantities are the measurement. They may not move.
  const before = floorPlan(floor);
  for (const turn of [0, 37, 90, 213]) projectFloor(floor, { turn, tilt: 55 });
  const after = floorPlan(floor);
  assert.deepEqual(after.rooms.map((r) => r.area), before.rooms.map((r) => r.area));
  assert.deepEqual(after.bounds, before.bounds);
});

test('nothing this module exports returns a quantity', async () => {
  const module = await import('../floor3d.ts');
  const banned = Object.keys(module).filter((name) =>
    /quantit|area|total|price|cost|length/i.test(name)
  );
  assert.deepEqual(banned, []);
});
