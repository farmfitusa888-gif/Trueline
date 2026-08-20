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
