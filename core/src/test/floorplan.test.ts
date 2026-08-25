import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength } from '../length.ts';
import { scanned, verified } from '../measurement.ts';
import type { Heading, Opening, Room, Wall } from '../room.ts';
import type { Floor, Join } from '../floor.ts';
import { couldBeTheSame, extentOf, floorPlan, placedArea } from '../floorplan.ts';

/**
 * What a screen needs to draw a floor, and to let somebody join two rooms by
 * tapping the same door in each.
 *
 * Joining rooms cannot be guessed — there is nothing in two captures that says
 * which door is which — so it is a person saying it, and the only way to say it
 * without a form is to tap one door and then the other. Which means every
 * opening on the floor needs a place a finger can reach.
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

function makeRoom(id: string, name: string, walls: Wall[]): Room {
  return {
    id,
    name,
    walls,
    ceilingHeight: verified(parseLength(`8'`), 'sam', T0, 'tape'),
    wallThickness: said(`4 1/2"`),
  };
}

const kitchen = makeRoom('k', 'kitchen', [
  w('k-south', 'east', `20'`),
  w('k-east', 'north', `12'`),
  w('k-north', 'west', `20'`, [door('k-door', `8'`)]),
  w('k-west', 'south', `12'`),
]);

const hall = makeRoom('h', 'hall', [
  w('h-south', 'east', `20'`, [door('h-door', `9'`)]),
  w('h-east', 'north', `8'`),
  w('h-north', 'west', `20'`),
  w('h-west', 'south', `8'`),
]);

const join: Join = {
  id: 'front',
  declaredBy: 'sam',
  declaredAt: T0,
  from: { roomId: 'k', wallId: 'k-north', openingId: 'k-door' },
  to: { roomId: 'h', wallId: 'h-south', openingId: 'h-door' },
};

const floor: Floor = { id: 'f', name: 'ground', rooms: [kitchen, hall], joins: [join] };
const FT = parseLength(`1'`);

/* ------------------------------------------------------------ what it draws */

test('every placed room, wall and opening comes out with somewhere to be', () => {
  const plan = floorPlan(floor);
  assert.equal(plan.rooms.length, 2);
  assert.equal(plan.walls.length, 8);
  assert.equal(plan.openings.length, 2);
  assert.deepEqual(plan.unplaced, []);
  assert.deepEqual(plan.notes, []);
});

test('the two doors of a join land in the same place, one wall apart', () => {
  // This is the placement, seen from the screen's side: whatever the rooms did
  // to get there, the two doorways somebody said were the same door have to be
  // on top of each other.
  const plan = floorPlan(floor);
  const [a, b] = plan.openings;
  assert.equal(a!.at.x, b!.at.x);
  const gap = b!.at.y - a!.at.y;
  assert.equal(gap < 0n ? -gap : gap, parseLength(`4 1/2"`));
});

test('a door already spoken for is marked, so a screen can stop offering it', () => {
  const plan = floorPlan(floor);
  assert.deepEqual(plan.openings.map((o) => o.joined), [true, true]);
});

test('a room nothing has joined yet is still drawn, or the first join is impossible', () => {
  // Joining is two taps: a door in one room, the same door in the other. A room
  // that is not on the screen has no door to tap — so with unplaced rooms left
  // out, the *first* join on any floor could never be made, because the one
  // placed room had nothing to be joined to. It said "nothing connects the
  // kitchen" beside a drawing with no kitchen in it.
  const alone = floorPlan({ ...floor, joins: [] });
  assert.deepEqual(alone.unplaced, ['h'], 'the hall is genuinely not part of the floor yet');
  assert.equal(alone.rooms.length, 2, 'and it is still drawn');
  assert.deepEqual(alone.rooms.map((r) => r.placed), [true, false]);
  // Both doors are there to tap, and neither is spoken for.
  assert.deepEqual(alone.openings.map((o) => o.joined), [false, false]);
  assert.equal(new Set(alone.openings.map((o) => o.roomId)).size, 2);
});

test('a room waiting to be joined is stood clear of the floor, not on top of it', () => {
  const alone = floorPlan({ ...floor, joins: [] });
  const placed = alone.rooms.find((r) => r.placed)!;
  const waiting = alone.rooms.find((r) => !r.placed)!;
  const rightOf = placed.outline.reduce((most, p) => (p.x > most ? p.x : most), placed.outline[0]!.x);
  const leftOf = waiting.outline.reduce((least, p) => (p.x < least ? p.x : least), waiting.outline[0]!.x);
  assert.ok(leftOf > rightOf, 'the waiting room overlaps the floor');
});

test('a wall somebody taped is marked as such on the floor, like on a plan', () => {
  const taped = {
    ...floor,
    rooms: [
      {
        ...kitchen,
        walls: kitchen.walls.map((wall, i) =>
          i === 0 ? { ...wall, length: verified(parseLength(`20'`), 'sam', T0, 'tape') } : wall
        ),
      },
      hall,
    ],
  };
  const plan = floorPlan(taped);
  assert.equal(plan.walls.filter((wall) => wall.measured).length, 1);
});

test('the floor measures what somebody would measure across the outside of it', () => {
  const plan = floorPlan(floor);
  const extent = extentOf(plan);
  assert.equal(extent.x, 20n * FT);
  // 12 ft of kitchen, a 4 1/2 inch wall, 8 ft of hall.
  assert.equal(extent.y, 20n * FT + parseLength(`4 1/2"`));
  // And the area is the two rooms, not the box round them.
  assert.equal(placedArea(plan), 2n * 20n * FT * 12n * FT + 2n * 20n * FT * 8n * FT);
});

/* --------------------------------------------------- what it refuses to join */

test('two openings in the same room are not a join, and it says so', () => {
  const plan = floorPlan(floor);
  const [a] = plan.openings;
  assert.match(couldBeTheSame(a!, a!)!, /same room/);
});

test('a three foot door and a sixteen foot garage opening are not the same hole', () => {
  // The scanner is bad at opening widths, so the check is generous — but a
  // 16 ft span and a 3 ft door being joined is somebody tapping the wrong thing,
  // and watching a room fly across the screen is a worse way to find out.
  const wide = makeRoom('g', 'garage', [
    w('g-south', 'east', `24'`, [door('g-door', `2'`, `16'`)]),
    w('g-east', 'north', `20'`),
    w('g-north', 'west', `24'`),
    w('g-west', 'south', `20'`),
  ]);
  const plan = floorPlan({ ...floor, rooms: [kitchen, hall, wide], joins: [join] });
  const small = plan.openings.find((o) => o.openingId === 'k-door')!;
  // The garage is waiting to be joined, so it is on the floor and its opening
  // is there to tap — which is exactly when this check has to catch it.
  const garage = plan.openings.find((o) => o.openingId === 'g-door')!;
  assert.ok(garage, 'a room waiting to be joined must still offer its doors');
  assert.match(couldBeTheSame(small, garage)!, /very different widths/);
});

test('two doors of much the same width in different rooms are allowed', () => {
  const plan = floorPlan(floor);
  const [a, b] = plan.openings;
  // 3 ft either side, scanned — the scanner disagrees with itself by inches and
  // the check has to let that through or nothing would ever join.
  assert.equal(couldBeTheSame(a!, b!), null);
  assert.equal(couldBeTheSame({ ...a!, width: parseLength(`3'`) }, { ...b!, roomId: 'h', width: parseLength(`3' 4"`) }), null);
});
