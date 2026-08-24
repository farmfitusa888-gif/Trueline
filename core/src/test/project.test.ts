import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength } from '../length.ts';
import { scanned, verified } from '../measurement.ts';
import { type Heading, type Room, type Wall } from '../room.ts';
import { DEFAULT_CAMERA, ProjectionError, project } from '../project.ts';

/**
 * The 3D view is the plan seen from somewhere else, and it has to stay the
 * plan: every face it draws carries the id of the wall it belongs to, so
 * tapping a wall in 3D is tapping the same wall the tape box will re-solve.
 * That is the property these tests protect.
 */

const T0 = '2026-08-20T17:12:09Z';

function w(id: string, heading: Heading, length: string): Wall {
  return { id, heading, length: scanned(parseLength(length), parseLength(`50mm`), T0, 'roomplan') };
}

/** 20 ft by 12 ft, walked anticlockwise from the origin. */
const room: Room = {
  id: 'r1',
  name: 'garage',
  walls: [
    w('south', 'east', `20'`),
    w('east', 'north', `12'`),
    w('north', 'west', `20'`),
    w('west', 'south', `12'`),
  ],
  ceilingHeight: verified(parseLength(`8'`), 'sam', T0, 'tape'),
};

test('every face knows which wall it belongs to', () => {
  const { facets } = project(room, DEFAULT_CAMERA);
  const walls = facets.filter((f) => f.kind === 'wall');
  assert.ok(walls.length > 0, 'a room should draw some walls');
  for (const facet of walls) {
    assert.ok(
      room.walls.some((wall) => wall.id === facet.wallId),
      `a face came back tagged "${facet.wallId}", which is not a wall in this room`
    );
  }
});

test('the near walls come off, so the view looks into the room', () => {
  const { facets, hidden } = project(room, DEFAULT_CAMERA);
  assert.ok(hidden.length > 0, 'a closed box with every wall drawn shows nothing but its outside');
  const drawn = new Set(facets.filter((f) => f.kind === 'wall').map((f) => f.wallId));
  for (const id of hidden) {
    assert.equal(drawn.has(id), false, `${id} was called hidden and drawn anyway`);
  }
});

test('turning right round swaps which walls are hidden', () => {
  const front = project(room, { turn: 0, tilt: 40 });
  const back = project(room, { turn: 180, tilt: 40 });
  assert.notDeepEqual([...front.hidden].sort(), [...back.hidden].sort());
  // And what was hidden from one side is drawn from the other.
  const drawnFromBack = new Set(back.facets.filter((f) => f.kind === 'wall').map((f) => f.wallId));
  for (const id of front.hidden) assert.ok(drawnFromBack.has(id), `${id} is hidden from both sides`);
});

test('the floor is drawn first, so the walls stand on it', () => {
  const { facets } = project(room, DEFAULT_CAMERA);
  assert.equal(facets[0]!.kind, 'floor');
});

test('nothing is drawn outside the box it was given', () => {
  for (const turn of [0, 45, 90, 135, 180, 225, 270, 315]) {
    const { facets } = project(room, { turn, tilt: 35 }, 600);
    for (const facet of facets) {
      for (const p of facet.points) {
        assert.ok(p.x >= -1 && p.x <= 601, `x ${p.x} at turn ${turn} is off the canvas`);
        assert.ok(p.y >= -1 && p.y <= 601, `y ${p.y} at turn ${turn} is off the canvas`);
      }
    }
  }
});

test('a door in a wall is drawn on that wall, and says so', () => {
  const withDoor: Room = {
    ...room,
    walls: room.walls.map((wall) =>
      wall.id === 'north'
        ? {
            ...wall,
            openings: [
              {
                id: 'd1',
                kind: 'door' as const,
                width: scanned(parseLength(`3'`), parseLength(`50mm`), T0, 'roomplan'),
                height: scanned(parseLength(`6' 8"`), parseLength(`50mm`), T0, 'roomplan'),
                offsetFromStart: scanned(parseLength(`4'`), parseLength(`50mm`), T0, 'roomplan'),
              },
            ],
          }
        : wall
    ),
  };
  // Turn 0 looks along the plan's +y, so the north wall is the far one and is
  // drawn; the south wall is between the viewer and the room and is not.
  const { facets, hidden } = project(withDoor, { turn: 0, tilt: 35 });
  assert.equal(hidden.includes('north'), false, 'the far wall should be drawn');
  const door = facets.find((f) => f.kind === 'opening');
  assert.ok(door, 'the door should be drawn');
  assert.equal(door.wallId, 'north', 'tapping a door has to select the wall it is in');
  assert.equal(door.openingKind, 'door');
});

test('looking straight down still leaves the room some height', () => {
  // Clamped short of 90 degrees on purpose: at exactly overhead the walls
  // collapse to lines and the view becomes a worse copy of the plan.
  const { facets } = project(room, { turn: 0, tilt: 90 });
  const wall = facets.find((f) => f.kind === 'wall');
  assert.ok(wall);
  const ys = wall.points.map((p) => p.y);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 1, 'the walls flattened to nothing');
});

test('a camera pointed nowhere is refused rather than drawn', () => {
  assert.throws(() => project(room, { turn: Number.NaN, tilt: 30 }), ProjectionError);
});

test('an opening is drawn after the wall it is a hole in', () => {
  const withDoor: Room = {
    ...room,
    walls: room.walls.map((wall) =>
      wall.id === 'north'
        ? {
            ...wall,
            openings: [
              {
                id: 'd1',
                kind: 'door' as const,
                width: scanned(parseLength(`3'`), parseLength(`50mm`), T0, 'roomplan'),
                height: scanned(parseLength(`6' 8"`), parseLength(`50mm`), T0, 'roomplan'),
                offsetFromStart: scanned(parseLength(`4'`), parseLength(`50mm`), T0, 'roomplan'),
                // Up off the floor and off to one end: this is the shape that
                // broke it. A raised opening covering part of a wall seen
                // obliquely averages a different depth from the wall itself, so
                // a plain depth sort drew Sam's garage window first and then
                // painted the wall over the top of it.
                sillHeight: scanned(parseLength(`3'`), parseLength(`50mm`), T0, 'roomplan'),
              },
            ],
          }
        : wall
    ),
  };
  const { facets } = project(withDoor, { turn: 35, tilt: 38 });
  const wallAt = facets.findIndex((f) => f.kind === 'wall' && f.wallId === 'north');
  const doorAt = facets.findIndex((f) => f.kind === 'opening');
  assert.ok(wallAt >= 0 && doorAt >= 0);
  assert.ok(doorAt > wallAt, 'the door is painted under its own wall');
  assert.equal(doorAt, wallAt + 1, 'the door should follow its wall immediately');
});
