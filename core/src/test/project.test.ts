import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanned, verified } from '../measurement.ts';
import { type Heading, type Opening, type Room, type Wall } from '../room.ts';
import { NM_PER_FOOT, parseLength } from '../length.ts';
import { cutAt, insidePlan } from '../section.ts';
import {
  DEFAULT_CAMERA,
  ProjectionError,
  STANDING_EYE,
  project,
  projectFrom,
  standingInside,
} from '../project.ts';

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

/* ---------------------------------------------------------------- objects */

/**
 * Furniture in the 3D view.
 *
 * The 3D view drew the empty shell and nothing else, so a room somebody had
 * just walked came back looking like a room they had never been in. Objects are
 * drawn as boxes, and the properties that matter are: they are their own kind,
 * so nothing tries to select a wall by tapping a fridge; they carry an id that
 * is not any wall's; and asking for them changes not one face of the building.
 */
const bench = {
  id: 'bench',
  category: 'storage',
  min: { x: parseLength(`2'`), y: parseLength(`1'`) },
  max: { x: parseLength(`6'`), y: parseLength(`3'`) },
};

test('an object is drawn as a box, and never as part of the building', () => {
  const bare = project(room, DEFAULT_CAMERA);
  const furnished = project(room, DEFAULT_CAMERA, 1000, [bench]);

  const boxes = furnished.facets.filter((f) => f.kind === 'object');
  assert.equal(boxes.length, 5, 'four sides and a top');

  // Not a wall id, so a tap on one can never be read as a tap on a wall.
  for (const box of boxes) {
    assert.ok(box.wallId.startsWith('object:'), box.wallId);
    assert.ok(!room.walls.some((wall) => wall.id === box.wallId));
  }

  // Every face of the building is exactly where it was.
  const building = (p: typeof bare) => JSON.stringify(p.facets.filter((f) => f.kind !== 'object'));
  assert.equal(building(furnished), building(bare), 'the building moved');
  assert.equal(furnished.hidden.join(), bare.hidden.join());
});

test('an object the scan saw edge-on is not drawn as a stray line', () => {
  const flat = { ...bench, max: { x: parseLength(`2'`), y: parseLength(`3'`) } };
  const { facets } = project(room, DEFAULT_CAMERA, 1000, [flat]);
  assert.equal(facets.filter((f) => f.kind === 'object').length, 0);
});

/* -------------------------------------------------------- standing inside */

/**
 * The interior view: standing in the room rather than orbiting it.
 *
 * Two things are worth testing and neither is "does it look right". One, every
 * face still carries its wall's id, because that is what makes this the same
 * screen as the plan rather than a picture of one. Two, the near clip actually
 * works -- a wall you are standing against runs from in front of you to behind
 * you, and the part behind has no projection at all. Left unclipped it comes
 * out mirrored across the screen and paints over the room, and it looks like a
 * rendering bug rather than an arithmetic one.
 */

test('standing in the room, every face still knows its wall', () => {
  const { facets } = projectFrom(room, standingInside(room));
  const walls = facets.filter((f) => f.kind === 'wall');
  assert.ok(walls.length > 0);
  for (const facet of walls) {
    assert.ok(room.walls.some((wall) => wall.id === facet.wallId), facet.wallId);
  }
});

test('from the middle of the room, all four walls are in the model', () => {
  // Not all in frame -- the field of view is 72 degrees and the room has four
  // sides. But nothing is dropped for being on the wrong side of anything: from
  // inside, there is no wrong side.
  const { facets, hidden } = projectFrom(room, { ...standingInside(room), turn: 0 });
  const drawn = new Set(facets.filter((f) => f.kind === 'wall').map((f) => f.wallId));
  assert.equal(drawn.size + hidden.length, 4);
});

test('the ceiling is drawn, because from inside it is part of the room', () => {
  // The orbit view leaves it off -- looking down at a lid is never what was
  // wanted. From inside, a room with no ceiling is a film set.
  const { facets } = projectFrom(room, standingInside(room));
  assert.ok(facets.some((f) => f.wallId === 'ceiling'));
  assert.ok(facets.some((f) => f.wallId === 'floor'));
});

test('a wall behind you is clipped away rather than drawn mirrored', () => {
  // Standing at the south wall looking north: the south wall is behind the eye.
  // Unclipped, its vertices divide by a negative depth and it lands on screen
  // upside down and enormous.
  const at = { x: 10n * NM_PER_FOOT, y: NM_PER_FOOT / 2n };
  const { facets, hidden } = projectFrom(room, {
    at,
    height: STANDING_EYE,
    turn: 0, // along +y, away from the south wall
    tilt: 0,
  });
  assert.ok(hidden.includes('south'), `hidden was ${hidden.join(', ')}`);
  assert.equal(facets.filter((f) => f.wallId === 'south' && f.kind === 'wall').length, 0);
});

test('nothing that is drawn lands at infinity', () => {
  // The near clip's real job. Every surviving vertex has to be a finite number
  // a browser can put on a screen; one NaN in a polygon loses the whole face.
  for (const turn of [0, 45, 90, 180, 270]) {
    const { facets } = projectFrom(room, {
      at: { x: NM_PER_FOOT / 4n, y: NM_PER_FOOT / 4n }, // in a corner, against two walls
      height: STANDING_EYE,
      turn,
      tilt: 0,
    });
    for (const facet of facets) {
      for (const point of facet.points) {
        assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y),
          `turn ${turn}: ${facet.wallId} produced ${point.x}, ${point.y}`);
      }
    }
  }
});

test('looking up puts more ceiling in frame than looking level', () => {
  const eye = standingInside(room);
  const area = (tilt: number) => {
    const ceiling = projectFrom(room, { ...eye, tilt }).facets.find((f) => f.wallId === 'ceiling');
    if (!ceiling) return 0;
    // Shoelace, on screen coordinates. Absolute, because winding is not the
    // question here.
    let twice = 0;
    for (let i = 0; i < ceiling.points.length; i += 1) {
      const a = ceiling.points[i]!;
      const b = ceiling.points[(i + 1) % ceiling.points.length]!;
      twice += a.x * b.y - b.x * a.y;
    }
    return Math.abs(twice) / 2;
  };
  assert.ok(area(60) > area(0), 'looking up should show more ceiling');
});

test('a viewpoint that is not a number is refused rather than drawn as NaN', () => {
  assert.throws(
    () => projectFrom(room, { ...standingInside(room), turn: Number.NaN }),
    ProjectionError
  );
});

test('the default place to stand is inside the room and faces its longest wall', () => {
  const eye = standingInside(room);
  assert.ok(insidePlan(room, eye.at), 'the viewer should start inside the room');
  // The longest walls are south and north, both 20 ft. Standing in the middle
  // and facing one of them means looking along -y or +y: turn 0 or 180.
  assert.ok(
    Math.abs(eye.turn) < 1 || Math.abs(eye.turn - 180) < 1,
    `faced ${eye.turn} degrees`
  );
});

/* --------------------------------------------------------- the cut plane */

/**
 * A horizontal section, drawn.
 *
 * `section.ts` has worked out cut planes since early on and nothing drew one.
 * These check the drawing half only -- which walls are drawn, and how tall --
 * because everything about *where* the plane falls is decided and tested in
 * `section.test.ts`, and deciding it twice is two chances to disagree.
 */

/**
 * A wall the default camera actually draws.
 *
 * Half the walls are dropped from an orbit view for being between the viewer
 * and the room, and the first version of the opening tests below put their
 * window on one of them. The test then failed for a reason that had nothing to
 * do with cut planes, which is exactly the kind of failure that gets a real
 * finding waved away.
 */
function drawnWall(): string {
  const shown = project(room, DEFAULT_CAMERA).facets
    .filter((f) => f.kind === 'wall')
    .map((f) => f.wallId);
  const first = room.walls.findIndex((w) => shown.includes(w.id));
  assert.ok(first >= 0, 'the default camera should draw at least one wall');
  return room.walls[first]!.id;
}

test('a cut plane shortens the walls it passes through', () => {
  const whole = project(room, DEFAULT_CAMERA);
  const sliced = project(room, DEFAULT_CAMERA, 1000, [], cutAt(room, { height: 4n * NM_PER_FOOT }));

  const tallest = (p: typeof whole) => {
    const walls = p.facets.filter((f) => f.kind === 'wall');
    return Math.max(...walls.map((f) => {
      const ys = f.points.map((q) => q.y);
      return Math.max(...ys) - Math.min(...ys);
    }));
  };
  assert.ok(tallest(sliced) < tallest(whole), 'a cut room should draw shorter walls');
});

test('a wall that stops below the plane is drawn whole, not cut', () => {
  // A 7 ft pony wall in an 8 ft room, cut at 7'6". The plane passes over it,
  // so it is not a cut wall and nothing of it is taken off. `section.ts`
  // decides that; this checks the drawing believes it.
  const withPony: Room = {
    ...room,
    walls: room.walls.map((wall, i) =>
      i === 1 ? { ...wall, height: verified(parseLength(`7'`), 'sam', T0, 'tape') } : wall
    ),
  };
  const view = cutAt(withPony, { height: parseLength(`7' 6"`) });
  const pony = view.walls.find((w) => w.wallId === 'east');
  assert.equal(pony?.cut, false);
  assert.equal(pony?.drawnTo, parseLength(`7'`));
});

test('an opening the plane crosses is drawn up to it and no further', () => {
  // A window 2'6" to 5'6" in a room cut at 4 ft. Drawn to 4 ft: a window whose
  // head appears above a plane that went through it makes the section look
  // like a mistake rather than a drawing.
  const window: Opening = {
    id: 'w1',
    kind: 'window',
    width: scanned(parseLength(`4'`), parseLength('50mm'), T0, 'roomplan'),
    height: scanned(parseLength(`3'`), parseLength('50mm'), T0, 'roomplan'),
    offsetFromStart: scanned(parseLength(`8'`), parseLength('50mm'), T0, 'roomplan'),
    sillHeight: scanned(parseLength(`2' 6"`), parseLength('50mm'), T0, 'roomplan'),
  };
  const on = drawnWall();
  const glazed: Room = {
    ...room,
    walls: room.walls.map((wall) => (wall.id === on ? { ...wall, openings: [window] } : wall)),
  };
  const cut = 4n * NM_PER_FOOT;
  const sliced = project(glazed, DEFAULT_CAMERA, 1000, [], cutAt(glazed, { height: cut }));
  const whole = project(glazed, DEFAULT_CAMERA);

  const heightOf = (p: typeof whole) => {
    const hole = p.facets.find((f) => f.kind === 'opening');
    if (!hole) return 0;
    const ys = hole.points.map((q) => q.y);
    return Math.max(...ys) - Math.min(...ys);
  };
  assert.ok(heightOf(sliced) > 0, 'the window should still be drawn');
  assert.ok(heightOf(sliced) < heightOf(whole), 'and drawn shorter than the whole one');
});

test('an opening entirely above the plane is not drawn at all', () => {
  // A window sitting at 6 ft in a room cut at 4. Drawing any of it would be
  // drawing something the plane is underneath.
  const high: Opening = {
    id: 'w2',
    kind: 'window',
    width: scanned(parseLength(`3'`), parseLength('50mm'), T0, 'roomplan'),
    height: scanned(parseLength(`2'`), parseLength('50mm'), T0, 'roomplan'),
    offsetFromStart: scanned(parseLength(`5'`), parseLength('50mm'), T0, 'roomplan'),
    sillHeight: scanned(parseLength(`6'`), parseLength('50mm'), T0, 'roomplan'),
  };
  const on = drawnWall();
  const glazed: Room = {
    ...room,
    walls: room.walls.map((wall) => (wall.id === on ? { ...wall, openings: [high] } : wall)),
  };
  // Drawn without a plane, so the test proves the plane removed it rather than
  // that the camera never showed it.
  assert.equal(project(glazed, DEFAULT_CAMERA).facets.filter((f) => f.kind === 'opening').length, 1);
  const sliced = project(glazed, DEFAULT_CAMERA, 1000, [], cutAt(glazed, { height: 4n * NM_PER_FOOT }));
  assert.equal(sliced.facets.filter((f) => f.kind === 'opening').length, 0);
});

test('with no plane at all nothing about the drawing changes', () => {
  // The guard against a section quietly becoming compulsory. Passing nothing
  // has to draw exactly what it drew before this existed.
  const before = project(room, DEFAULT_CAMERA);
  const after = project(room, DEFAULT_CAMERA, 1000, [], undefined);
  assert.deepEqual(after.facets, before.facets);
  assert.deepEqual(after.hidden, before.hidden);
});
