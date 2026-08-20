import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength } from '../length.ts';
import { scanned, verified } from '../measurement.ts';
import { type Heading, type Opening, type Room, type Wall, area, formatSquareFeet } from '../room.ts';
import {
  type Boundary,
  ZoneError,
  builtPerimeter,
  quantities,
  report,
  splitByBoundary,
  virtualPerimeter,
  zoneArea,
} from '../zone.ts';

const T0 = '2026-08-19T14:00:00Z';
const T1 = '2026-08-19T15:30:00Z';

function wall(id: string, heading: Heading, length: string, extra: Partial<Wall> = {}): Wall {
  return { id, heading, length: scanned(parseLength(length), parseLength(`1"`), T0, 'roomplan'), ...extra };
}

function opening(id: string, kind: Opening['kind'], width: string, height: string, offset: string): Opening {
  return {
    id, kind,
    width: verified(parseLength(width), 'sam', T1, 'tape'),
    height: verified(parseLength(height), 'sam', T1, 'tape'),
    offsetFromStart: verified(parseLength(offset), 'sam', T1, 'tape'),
  };
}

/** A 20' x 12' open space — kitchen at one end, living at the other, no wall between. */
function greatRoom(walls?: Wall[]): Room {
  return {
    id: 'r1',
    name: 'great room',
    walls: walls ?? [
      wall('north', 'east', `20'`),
      wall('east', 'north', `12'`),
      wall('south', 'west', `20'`),
      wall('west', 'south', `12'`),
    ],
    ceilingHeight: verified(parseLength(`8'`), 'sam', T1, 'tape'),
  };
}

const DOWN_THE_MIDDLE: Boundary = {
  id: 'kitchen-line',
  name: 'where the tile stops',
  declaredBy: 'sam',
  declaredAt: T1,
  from: { x: parseLength(`10'`), y: 0n },
  to: { x: parseLength(`10'`), y: parseLength(`12'`) },
};

test('an open space splits into two zones that account for every square inch', () => {
  const room = greatRoom();
  const [kitchen, living] = splitByBoundary(room, DOWN_THE_MIDDLE, ['kitchen', 'living']);

  assert.equal(formatSquareFeet(zoneArea(kitchen), 0), '120 sq ft');
  assert.equal(formatSquareFeet(zoneArea(living), 0), '120 sq ft');
  assert.equal(zoneArea(kitchen) + zoneArea(living), area(room).value);
  assert.equal(kitchen.name, 'kitchen');
  assert.equal(living.name, 'living');
});

test('the divider is not a wall — it bounds floor and nothing else', () => {
  const room = greatRoom();
  const [kitchen] = splitByBoundary(room, DOWN_THE_MIDDLE, ['kitchen', 'living']);
  const q = quantities(kitchen, room);

  // The boundary is 12' long and shows up only as virtual run.
  assert.equal(virtualPerimeter(kitchen), parseLength(`12'`));
  assert.equal(q.virtualRun, parseLength(`12'`));

  // Built outline is 10' + 12' + 10' = 32'. The boundary is not in it.
  assert.equal(builtPerimeter(kitchen), parseLength(`32'`));
  assert.equal(q.baseboardRun, parseLength(`32'`));

  // Drywall follows the built edges only: 32' of wall at 8' high.
  assert.equal(q.wallFaceArea, parseLength(`32'`) * parseLength(`8'`));
});

test('splitting by a wall instead would have priced drywall nobody builds', () => {
  const room = greatRoom();
  const [kitchen] = splitByBoundary(room, DOWN_THE_MIDDLE, ['kitchen', 'living']);
  const q = quantities(kitchen, room);

  const ifItWereAWall = (parseLength(`32'`) + parseLength(`12'`)) * parseLength(`8'`);
  assert.ok(q.wallFaceArea < ifItWereAWall);
  assert.equal(ifItWereAWall - q.wallFaceArea, parseLength(`12'`) * parseLength(`8'`));
});

test('floor and ceiling do follow the boundary, because they are continuous', () => {
  const room = greatRoom();
  const [kitchen] = splitByBoundary(room, DOWN_THE_MIDDLE, ['kitchen', 'living']);
  const q = quantities(kitchen, room);
  assert.equal(q.floorArea, zoneArea(kitchen));
  assert.equal(q.ceilingArea, zoneArea(kitchen));
});

test('a pony wall is built, at its own height, and costs accordingly', () => {
  const full = greatRoom();
  const pony = greatRoom([
    wall('north', 'east', `20'`),
    wall('east', 'north', `12'`, { height: verified(parseLength(`3' 6"`), 'sam', T1, 'tape') }),
    wall('south', 'west', `20'`),
    wall('west', 'south', `12'`),
  ]);

  const [aFull] = splitByBoundary(full, DOWN_THE_MIDDLE, ['kitchen', 'living']);
  const [aPony] = splitByBoundary(pony, DOWN_THE_MIDDLE, ['kitchen', 'living']);

  // Same floor, same baseboard — a pony wall still has a bottom.
  assert.equal(quantities(aPony, pony).floorArea, quantities(aFull, full).floorArea);
  assert.equal(quantities(aPony, pony).baseboardRun, quantities(aFull, full).baseboardRun);

  // But far less wall to finish: 12' at 3'6" instead of 8'.
  const difference = parseLength(`12'`) * (parseLength(`8'`) - parseLength(`3' 6"`));
  assert.equal(
    quantities(aFull, full).wallFaceArea - quantities(aPony, pony).wallFaceArea,
    difference
  );
});

test('a door interrupts the baseboard; a window does not', () => {
  const room = greatRoom([
    wall('north', 'east', `20'`, {
      openings: [
        opening('d1', 'door', `3'`, `6' 8"`, `2'`),
        opening('w1', 'window', `4'`, `4'`, `14'`),
      ],
    }),
    wall('east', 'north', `12'`),
    wall('south', 'west', `20'`),
    wall('west', 'south', `12'`),
  ]);
  const [kitchen, living] = splitByBoundary(room, DOWN_THE_MIDDLE, ['kitchen', 'living']);

  // The door sits at 2'-5' along the north wall, so it lands in the zone covering 0-10'.
  const withDoor = quantities(living, room);
  assert.equal(withDoor.baseboardRun, parseLength(`32'`) - parseLength(`3'`));

  // The window sits at 14'-18', in the other zone, and leaves its baseboard alone.
  const withWindow = quantities(kitchen, room);
  assert.equal(withWindow.baseboardRun, parseLength(`32'`));
  // It still comes out of the paintable face.
  assert.equal(
    withWindow.wallFaceArea,
    parseLength(`32'`) * parseLength(`8'`) - parseLength(`4'`) * parseLength(`4'`)
  );
});

test('a door straddling the boundary is credited to each side by how much is on it', () => {
  const room = greatRoom([
    // 8' to 11' along the north wall, so 2' falls one side of the 10' line and 1' the other.
    wall('north', 'east', `20'`, { openings: [opening('d1', 'door', `3'`, `6' 8"`, `8'`)] }),
    wall('east', 'north', `12'`),
    wall('south', 'west', `20'`),
    wall('west', 'south', `12'`),
  ]);
  const [kitchen, living] = splitByBoundary(room, DOWN_THE_MIDDLE, ['kitchen', 'living']);

  const k = quantities(kitchen, room);
  const l = quantities(living, room);
  assert.equal(parseLength(`32'`) - k.baseboardRun, parseLength(`1'`));
  assert.equal(parseLength(`32'`) - l.baseboardRun, parseLength(`2'`));
  // And between them they account for the whole door, not more and not less.
  assert.equal(
    (parseLength(`32'`) - k.baseboardRun) + (parseLength(`32'`) - l.baseboardRun),
    parseLength(`3'`)
  );
});

test('the report shows the zones and the whole, and they always reconcile', () => {
  const room = greatRoom();
  const zones = splitByBoundary(room, DOWN_THE_MIDDLE, ['kitchen', 'living']);
  const r = report(room, zones);

  assert.equal(r.zones.length, 2);
  assert.equal(r.total.floorArea, area(room).value);
  assert.equal(formatSquareFeet(r.total.floorArea, 0), '240 sq ft');
  assert.equal(
    r.zones[0]!.quantities.floorArea + r.zones[1]!.quantities.floorArea,
    r.total.floorArea
  );
  // The whole space has 64' of real wall, and the divider adds none of it.
  assert.equal(r.total.baseboardRun, parseLength(`64'`));
  assert.equal(r.total.virtualRun, parseLength(`24'`)); // counted once from each side
});

test('a report that does not account for the whole floor is refused', () => {
  const room = greatRoom();
  const [kitchen] = splitByBoundary(room, DOWN_THE_MIDDLE, ['kitchen', 'living']);
  assert.throws(() => report(room, [kitchen]), (err: unknown) => {
    assert.ok(err instanceof ZoneError);
    assert.match((err as Error).message, /belongs to exactly one zone/);
    return true;
  });
  assert.throws(() => report(room, []), ZoneError);
});

test('a boundary has to start and finish on something real', () => {
  const room = greatRoom();
  assert.throws(
    () => splitByBoundary(room, { ...DOWN_THE_MIDDLE, from: { x: parseLength(`5'`), y: parseLength(`5'`) } },
      ['a', 'b']),
    /not on the room's outline/
  );
});

test('a boundary cannot run along one wall instead of crossing the space', () => {
  const room = greatRoom();
  const alongOneWall: Boundary = {
    ...DOWN_THE_MIDDLE,
    from: { x: parseLength(`4'`), y: 0n },
    to: { x: parseLength(`12'`), y: 0n },
  };
  assert.throws(() => splitByBoundary(room, alongOneWall, ['a', 'b']), /has to cross the space/);
});

test('a boundary needs two different ends', () => {
  const room = greatRoom();
  const degenerate: Boundary = { ...DOWN_THE_MIDDLE, to: DOWN_THE_MIDDLE.from };
  assert.throws(() => splitByBoundary(room, degenerate, ['a', 'b']), ZoneError);
});

test('splitting anywhere across the space still accounts for every square inch', () => {
  const room = greatRoom();
  for (let ft = 1; ft <= 19; ft += 1) {
    const b: Boundary = {
      ...DOWN_THE_MIDDLE,
      id: `cut-${ft}`,
      from: { x: parseLength(`${ft}'`), y: 0n },
      to: { x: parseLength(`${ft}'`), y: parseLength(`12'`) },
    };
    const zones = splitByBoundary(room, b, ['a', 'b']);
    assert.equal(
      zoneArea(zones[0]) + zoneArea(zones[1]),
      area(room).value,
      `lost floor splitting at ${ft} ft`
    );
    assert.equal(report(room, zones).total.floorArea, area(room).value);
  }
});

test('an L-shaped open plan splits too', () => {
  const room: Room = {
    id: 'r2',
    name: 'kitchen-dining-living',
    walls: [
      wall('a', 'east', `16'`),
      wall('b', 'north', `7'`),
      wall('c', 'west', `6'`),
      wall('d', 'north', `5'`),
      wall('e', 'west', `10'`),
      wall('f', 'south', `12'`),
    ],
    ceilingHeight: verified(parseLength(`9'`), 'sam', T1, 'tape'),
  };
  // The L runs 16' x 7' along the bottom with a 10' x 5' return on top, so a cut at
  // 8' has to reach the far outline at y = 12', not the inside corner at y = 7'.
  const b: Boundary = {
    id: 'cut', declaredBy: 'sam', declaredAt: T1,
    from: { x: parseLength(`8'`), y: 0n },
    to: { x: parseLength(`8'`), y: parseLength(`12'`) },
  };
  const zones = splitByBoundary(room, b, ['dining', 'living']);
  assert.equal(zoneArea(zones[0]) + zoneArea(zones[1]), area(room).value);
  assert.equal(report(room, zones).total.floorArea, area(room).value);
  // 8' x 7' plus 2' x 5' one side; 8' x 7' plus 8' x 5' the other.
  assert.equal(formatSquareFeet(zoneArea(zones[0]), 0), '66 sq ft');
  assert.equal(formatSquareFeet(zoneArea(zones[1]), 0), '96 sq ft');
});

test('a cut that misses the outline is refused rather than guessed at', () => {
  const room: Room = {
    id: 'r3', name: 'L',
    walls: [
      wall('a', 'east', `16'`), wall('b', 'north', `7'`), wall('c', 'west', `6'`),
      wall('d', 'north', `5'`), wall('e', 'west', `10'`), wall('f', 'south', `12'`),
    ],
    ceilingHeight: verified(parseLength(`9'`), 'sam', T1, 'tape'),
  };
  // y = 7' only exists between x = 10' and x = 16'; at 8' there is nothing to land on.
  assert.throws(() => splitByBoundary(room, {
    id: 'bad', declaredBy: 'sam', declaredAt: T1,
    from: { x: parseLength(`8'`), y: 0n },
    to: { x: parseLength(`8'`), y: parseLength(`7'`) },
  }, ['a','b']), /not on the room's outline/);
});
