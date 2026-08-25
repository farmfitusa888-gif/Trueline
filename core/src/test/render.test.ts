import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NM_PER_METRE, parseLength } from '../length.ts';
import { scanned, verified } from '../measurement.ts';
import { type Heading, type Room, type Wall } from '../room.ts';
import { splitByBoundary, type Boundary } from '../zone.ts';
import { RENDER_EPSILON, ROOMPLAN_ASSUMED_THICKNESS, toRenderModel } from '../render.ts';

const T0 = '2026-08-19T14:00:00Z';
const T1 = '2026-08-19T15:30:00Z';

function w(id: string, heading: Heading, length: string, tol = `1"`): Wall {
  return { id, heading, length: scanned(parseLength(length), parseLength(tol), T0, 'roomplan') };
}

function room(walls?: Wall[]): Room {
  return {
    id: 'r1', name: 'living',
    walls: walls ?? [
      w('north', 'east', `20'`), w('east', 'north', `12'`),
      w('south', 'west', `20'`), w('west', 'south', `12'`),
    ],
    ceilingHeight: verified(parseLength(`8'`), 'sam', T1, 'tape'),
  };
}

test('walls come out as start and end points a renderer can draw', () => {
  const m = toRenderModel(room(), [], { unit: 'ft' });
  assert.equal(m.walls.length, 4);
  const north = m.walls.find((x) => x.id === 'north')!;
  assert.deepEqual(north.start, { x: 0, y: 0 });
  assert.ok(Math.abs(north.end.x - 20) < RENDER_EPSILON);
  assert.ok(Math.abs(north.end.y) < RENDER_EPSILON);
});

test('the unit is chosen, never assumed', () => {
  const feet = toRenderModel(room(), [], { unit: 'ft' });
  const metres = toRenderModel(room(), [], { unit: 'm' });
  const mm = toRenderModel(room(), [], { unit: 'mm' });

  assert.equal(feet.unit, 'ft');
  assert.ok(Math.abs(feet.walls[0]!.end.x - 20) < RENDER_EPSILON);
  assert.ok(Math.abs(metres.walls[0]!.end.x - 6.096) < RENDER_EPSILON);
  assert.ok(Math.abs(mm.walls[0]!.end.x - 6096) < RENDER_EPSILON);
  // Default is metres, because that is what a 3D renderer expects.
  assert.equal(toRenderModel(room()).unit, 'm');
});

test('confidence travels to the renderer, which is the whole point of the adapter', () => {
  const r = room([
    { id: 'north', heading: 'east', length: verified(parseLength(`20'`), 'sam', T1, 'tape') },
    w('east', 'north', `12'`, `2"`),
    w('south', 'west', `20'`),
    w('west', 'south', `12'`),
  ]);
  const m = toRenderModel(r, [], { unit: 'in' });

  const signed = m.walls.find((x) => x.id === 'north')!;
  assert.equal(signed.confidence, 'verified');
  assert.equal(signed.tolerance, 0);

  const guessed = m.walls.find((x) => x.id === 'east')!;
  assert.equal(guessed.confidence, 'scanned');
  assert.ok(Math.abs(guessed.tolerance - 2) < RENDER_EPSILON);
});

test('wall thickness is marked as assumed rather than presented as measured', () => {
  const m = toRenderModel(room(), [], { unit: 'mm' });
  // RoomPlan reports every wall at roughly 160mm whatever it really is.
  assert.ok(Math.abs(m.walls[0]!.thickness - 160) < RENDER_EPSILON);
  const custom = toRenderModel(room(), [], { unit: 'mm', assumedThickness: parseLength('100mm') });
  assert.ok(Math.abs(custom.walls[0]!.thickness - 100) < RENDER_EPSILON);
  assert.equal(ROOMPLAN_ASSUMED_THICKNESS, parseLength('160mm'));
});

test('a pony wall keeps its own height through the boundary', () => {
  const r = room([
    w('north', 'east', `20'`),
    { ...w('east', 'north', `12'`), height: verified(parseLength(`3' 6"`), 'sam', T1, 'tape') },
    w('south', 'west', `20'`),
    w('west', 'south', `12'`),
  ]);
  const m = toRenderModel(r, [], { unit: 'in' });
  assert.ok(Math.abs(m.walls.find((x) => x.id === 'east')!.height - 42) < RENDER_EPSILON);
  assert.ok(Math.abs(m.walls.find((x) => x.id === 'north')!.height - 96) < RENDER_EPSILON);
});

test('zones come through with their edges labelled built or virtual', () => {
  const r = room();
  const boundary: Boundary = {
    id: 'cut', declaredBy: 'sam', declaredAt: T1,
    from: { x: parseLength(`10'`), y: 0n },
    to: { x: parseLength(`10'`), y: parseLength(`12'`) },
  };
  const zones = splitByBoundary(r, boundary, ['kitchen', 'living']);
  const m = toRenderModel(r, zones, { unit: 'ft' });

  assert.equal(m.zones.length, 2);
  const kitchen = m.zones.find((z) => z.name === 'kitchen')!;
  assert.equal(kitchen.outline.length, kitchen.edgeKinds.length);
  assert.equal(kitchen.edgeKinds.filter((k) => k === 'virtual').length, 1);
  assert.ok(kitchen.edgeKinds.filter((k) => k === 'built').length >= 2);
});

test('a building-sized coordinate survives the conversion intact', () => {
  // 100 m is 1e11 nanometres — far past where a naive Number() conversion frays.
  const big: Room = {
    id: 'big', name: 'warehouse',
    walls: [
      w('a', 'east', '100m'), w('b', 'north', '60m'),
      w('c', 'west', '100m'), w('d', 'south', '60m'),
    ],
    ceilingHeight: verified(parseLength('6m'), 'sam', T1, 'tape'),
  };
  const m = toRenderModel(big, [], { unit: 'm' });
  assert.ok(Math.abs(m.walls[0]!.end.x - 100) < 1e-9, `got ${m.walls[0]!.end.x}`);
  assert.equal(parseLength('100m'), 100n * NM_PER_METRE);
});

test('an awkward fraction converts without drifting', () => {
  const r = room([
    w('north', 'east', `12' 4 1/2"`), w('east', 'north', `9' 11 7/8"`),
    w('south', 'west', `12' 4 1/2"`), w('west', 'south', `9' 11 7/8"`),
  ]);
  const m = toRenderModel(r, [], { unit: 'in' });
  assert.ok(Math.abs(m.walls.find((x) => x.id === 'north')!.end.x - 148.5) < RENDER_EPSILON);
  const east = m.walls.find((x) => x.id === 'east')!;
  assert.ok(Math.abs(east.end.y - 119.875) < RENDER_EPSILON);
});

test('the rendered ring closes, exactly as the solved room does', () => {
  const m = toRenderModel(room(), [], { unit: 'm' });
  let x = 0, y = 0;
  for (const wall of m.walls) {
    x += wall.end.x - wall.start.x;
    y += wall.end.y - wall.start.y;
  }
  assert.ok(Math.abs(x) < RENDER_EPSILON, `east-west drift ${x}`);
  assert.ok(Math.abs(y) < RENDER_EPSILON, `north-south drift ${y}`);
});

test('a wall somebody gave a thickness is drawn at that thickness, and says so', () => {
  // Every wall in every drawing was 160 mm, because RoomPlan reports a thickness
  // for each one and it is zero. That is complaint number nine on the gap list:
  // "wall thickness that is real, not RoomPlan's uniform 16 cm".
  const stated = verified(parseLength(`6 1/2"`), 'sam', T1, 'stated');
  const model = toRenderModel({ ...room(), wallThickness: stated }, [], { unit: 'm' });
  for (const wall of model.walls) {
    assert.equal(wall.thicknessAssumed, false, wall.id);
    assert.ok(Math.abs(wall.thickness - 0.1651) < 1e-6, `${wall.id}: ${wall.thickness}`);
  }

  // And with nobody having said anything, the fallback is used and admits it.
  const guessed = toRenderModel(room(), [], { unit: 'm' });
  for (const wall of guessed.walls) {
    assert.equal(wall.thicknessAssumed, true, wall.id);
    assert.ok(Math.abs(wall.thickness - 0.16) < 1e-9);
  }
});

test('one wall can differ from the rest of the room', () => {
  const base = room();
  const mixed: Room = {
    ...base,
    wallThickness: verified(parseLength(`4 1/2"`), 'sam', T1, 'stated'),
    walls: base.walls.map((wall, i) =>
      i === 0 ? { ...wall, thickness: verified(parseLength(`6 1/2"`), 'sam', T1, 'tape') } : wall
    ),
  };
  const model = toRenderModel(mixed, [], { unit: 'in' });
  assert.ok(Math.abs(model.walls[0]!.thickness - 6.5) < 1e-9);
  assert.ok(Math.abs(model.walls[1]!.thickness - 4.5) < 1e-9);
});

/* -------------------------------------------------------------- openings */

/**
 * Doors and windows on the single-room plan.
 *
 * The plan drew none: four lines with a dimension on each, and no way to tell a
 * wall you can walk through from a solid one. The offsets and widths were in
 * the room the whole time — nothing carried them out to something that draws.
 *
 * The renderer is handed two points rather than an offset and a width, so it
 * draws a line instead of repeating this trigonometry and getting a different
 * answer from the one the takeoff used.
 */
function withDoor(): Room {
  const base = room();
  const north = base.walls[0]!;
  return {
    ...base,
    walls: [
      {
        ...north,
        openings: [
          {
            id: 'front-door',
            kind: 'door',
            width: scanned(parseLength(`3'`), parseLength(`1"`), T0, 'roomplan'),
            height: scanned(parseLength(`6' 8"`), parseLength(`1"`), T0, 'roomplan'),
            offsetFromStart: scanned(parseLength(`5'`), parseLength(`1"`), T0, 'roomplan'),
          },
        ],
      },
      ...base.walls.slice(1),
    ],
  };
}

test('an opening comes out as two points on the wall it is in', () => {
  const m = toRenderModel(withDoor(), [], { unit: 'ft' });
  const north = m.walls.find((x) => x.id === 'north')!;
  assert.equal(north.openings.length, 1);

  const door = north.openings[0]!;
  assert.equal(door.kind, 'door');
  assert.ok(Math.abs(door.width - 3) < RENDER_EPSILON, `${door.width}`);

  // Both ends sit on the wall, five and eight feet along a twenty-foot run.
  const along = (p: { x: number; y: number }) =>
    Math.hypot(p.x - north.start.x, p.y - north.start.y);
  assert.ok(Math.abs(along(door.from) - 5) < 1e-6, `${along(door.from)}`);
  assert.ok(Math.abs(along(door.to) - 8) < 1e-6, `${along(door.to)}`);

  // And the direction it faces is a unit vector, or a door swing drawn from it
  // is the wrong size.
  assert.ok(Math.abs(Math.hypot(door.outward.x, door.outward.y) - 1) < 1e-9);
});

test('a wall with nothing in it reports no openings, not undefined', () => {
  const m = toRenderModel(room(), [], { unit: 'ft' });
  for (const wall of m.walls) assert.deepEqual(wall.openings, []);
});

test('an opening wider than the wall it was scanned in is clamped, never dropped', () => {
  const base = withDoor();
  const north = base.walls[0]!;
  const silly: Room = {
    ...base,
    walls: [
      {
        ...north,
        openings: [
          {
            ...north.openings![0]!,
            offsetFromStart: scanned(parseLength(`19'`), parseLength(`1"`), T0, 'roomplan'),
          },
        ],
      },
      ...base.walls.slice(1),
    ],
  };
  const m = toRenderModel(silly, [], { unit: 'ft' });
  const door = m.walls.find((x) => x.id === 'north')!.openings[0]!;
  const along = (p: { x: number; y: number }) => Math.hypot(p.x, p.y);
  // Pushed back so it ends at the wall's end, rather than vanishing: a door in
  // the wrong place is a visible, correctable wrong; a door that disappears is
  // not.
  assert.ok(along(door.to) <= 20 + 1e-6, `${along(door.to)}`);
  assert.ok(Math.abs(along(door.to) - along(door.from) - 3) < 1e-6);
});

test('a door swings into the room, not out through the wall', () => {
  const m = toRenderModel(withDoor(), [], { unit: 'ft' });
  const north = m.walls.find((x) => x.id === 'north')!;
  const door = north.openings[0]!;

  const centre = {
    x: m.walls.reduce((sum, x) => sum + x.start.x, 0) / m.walls.length,
    y: m.walls.reduce((sum, x) => sum + x.start.y, 0) / m.walls.length,
  };
  const mid = { x: (door.from.x + door.to.x) / 2, y: (door.from.y + door.to.y) / 2 };

  // Stepping one foot along `outward` from the middle of the doorway has to end
  // up further from the middle of the room, or the door opens into the garden.
  const before = Math.hypot(mid.x - centre.x, mid.y - centre.y);
  const after = Math.hypot(
    mid.x + door.outward.x - centre.x,
    mid.y + door.outward.y - centre.y
  );
  assert.ok(after > before, `outward led inward: ${before} -> ${after}`);
});
