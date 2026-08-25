import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength } from '../length.ts';
import { scanned, verified } from '../measurement.ts';
import {
  type Heading,
  type Room,
  type Wall,
  area,
  closes,
  isDiagonal,
  perimeter,
  runLength,
  validate,
} from '../room.ts';
import { project } from '../project.ts';
import { planFromWorld } from '../capture.ts';
import { roomQuantities } from '../zone.ts';

/**
 * A room and its mirror image are not the same room.
 *
 * Every drawing this product made was reflected — a view from underneath the
 * floor rather than above it — and a suite of three hundred tests sat green over
 * it for the life of the project. Not because the tests were weak, but because
 * **every one of them was invariant under reflection**. A mirrored room has the
 * same wall lengths, the same perimeter, the same area, and closes exactly. None
 * of those quantities has an opinion about handedness, so none of them could
 * ever have caught it. It took a man standing in his own garage saying the door
 * is on the other side.
 *
 * These tests do two things. They **assert the blindness** — writing down which
 * checks cannot see a mirror, so nobody trusts them for it again — and they pin
 * the small number of things that *can*, so the next edit to the projection
 * fails here rather than on a job site.
 */

const T0 = '2026-08-20T17:12:09Z';

function w(id: string, heading: Heading, length: string): Wall {
  return { id, heading, length: scanned(parseLength(length), parseLength(`50mm`), T0, 'roomplan') };
}

/** 20 ft by 12 ft. */
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

/**
 * The same room, flipped about the east-west axis.
 *
 * Every run's y component changes sign, which swaps north for south and leaves
 * east and west alone. The chain still closes, every wall is still the length it
 * was, and the building is now its own mirror image — exactly the difference
 * between a plan seen from above and one seen from below the slab.
 */
function mirror(source: Room): Room {
  return {
    ...source,
    id: `${source.id}-mirrored`,
    walls: source.walls.map((wall) => {
      if (isDiagonal(wall.heading)) {
        return {
          ...wall,
          heading: { ...wall.heading, run: { x: wall.heading.run.x, y: -wall.heading.run.y } },
        };
      }
      const flipped: Heading =
        wall.heading === 'north' ? 'south' : wall.heading === 'south' ? 'north' : wall.heading;
      return { ...wall, heading: flipped };
    }),
  };
}

const flipped = mirror(room);

/* --------------------------------------------- what cannot see a mirror */

test('a mirrored room is still a valid, closed room', () => {
  // If it were not, the bug would have announced itself on the first scan.
  validate(flipped);
  assert.equal(closes(flipped), true);
});

test('every wall is the same length in the mirror — length is blind to it', () => {
  for (const [i, wall] of room.walls.entries()) {
    assert.equal(runLength(flipped.walls[i]!), runLength(wall), wall.id);
  }
});

test('area and perimeter are blind to a mirror', () => {
  // These are the numbers the whole product is judged on, and neither of them
  // can tell a room from its reflection. Written down so it is never assumed
  // otherwise: a correct area is not evidence of a correct drawing.
  assert.equal(area(flipped).value, area(room).value);
  assert.equal(perimeter(flipped).value, perimeter(room).value);
});

test('the takeoff is blind to a mirror', () => {
  // Floor, ceiling, wall face and baseboard all come out identical. A takeoff
  // that reconciles perfectly says nothing about which way round the room is.
  assert.deepEqual(roomQuantities(flipped), roomQuantities(room));
});

/* ------------------------------------------------ what can, and must */

test('the world-to-plan drop reverses handedness, and that is the point', () => {
  // ARKit is right-handed with +y up, so a plan looking DOWN at the floor has
  // to reverse the orientation of the (x, z) pair it keeps. If this ever stops
  // being true, every drawing is a view from under the slab again.
  const [ax, ay] = planFromWorld(1, 0, { x: 1, y: 0 }); // world +x
  const [bx, by] = planFromWorld(0, 1, { x: 1, y: 0 }); // world +z
  const cross = ax * by - ay * bx;
  assert.ok(cross < 0, `the drop stopped reversing handedness: cross was ${cross}`);
});

test('a photographer holds their right hand clockwise from where they look', () => {
  // The physical fact, stated as a test. Look down at somebody walking toward
  // the bottom of a map: their right hand points to its left.
  const [fx, fy] = planFromWorld(0, -1, { x: 1, y: 0 }); // looking along world -z
  const [rx, ry] = planFromWorld(1, 0, { x: 1, y: 0 }); // right hand along world +x
  assert.ok(fx * ry - fy * rx < 0, 'the plan is drawn from underneath the floor');
});

test('the 3D view can tell a room from its mirror', () => {
  // Which walls are between the viewer and the room is a question about
  // handedness, so this is one of the few things in the product that changes.
  // If it ever stops changing, the projection has lost track of which side of
  // the floor the viewer is on.
  const here = project(room, { turn: 30, tilt: 38 });
  const there = project(flipped, { turn: 30, tilt: 38 });
  assert.notDeepEqual([...there.hidden].sort(), [...here.hidden].sort());
});

test('the walls run the other way round in the mirror', () => {
  // The one cheap check on a room itself: a reflection swaps north for south
  // and leaves east and west alone. Anything claiming to compare two captures
  // of the same room has to look at this and not at the lengths.
  const headings = (r: Room) => r.walls.map((x) => String(x.heading));
  assert.deepEqual(headings(flipped), ['east', 'south', 'west', 'north']);
  assert.notDeepEqual(headings(flipped), headings(room));
});
