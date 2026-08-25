import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength } from '../length.ts';
import { scanned, verified } from '../measurement.ts';
import { type Heading, type Opening, type Room, type Wall } from '../room.ts';
import { roomQuantities, wholeRoom } from '../zone.ts';
import { makeWall } from '../edit.ts';
import { takeoff, wallSchedule } from '../takeoff.ts';
import { formatSquareFeet } from '../room.ts';
import { verify } from '../measurement.ts';

/**
 * The four numbers a contractor prices off.
 *
 * Floor and ceiling area, baseboard run, and the wall face that takes drywall
 * and paint. All four have been computable since `quantities()` was written and
 * unreachable, because it wanted a `Zone` and nothing could make one out of a
 * plain room.
 *
 * The arithmetic that matters is what comes *off*: a door takes its width out
 * of the baseboard and its whole opening out of the wall face; a window takes
 * nothing off the baseboard, because the baseboard runs underneath it.
 */

const T0 = '2026-08-24T23:19:00Z';
const FT = 304_800_000n;

function w(id: string, heading: Heading, length: string, openings?: Opening[]): Wall {
  return {
    id,
    heading,
    length: scanned(parseLength(length), parseLength(`50mm`), T0, 'roomplan'),
    ...(openings ? { openings } : {}),
  };
}

/** A scanned measurement, for the fixtures that need one inline. */
const m = (text: string) => scanned(parseLength(text), parseLength(`50mm`), T0, 'roomplan');

function opening(id: string, kind: Opening['kind'], width: string, height: string, at: string): Opening {
  const m = (text: string) => scanned(parseLength(text), parseLength(`50mm`), T0, 'roomplan');
  return { id, kind, width: m(width), height: m(height), offsetFromStart: m(at) };
}

/** 20 ft by 10 ft, 8 ft to the ceiling. Round numbers so the sums are checkable by hand. */
function room(walls: Wall[], ceiling = `8'`): Room {
  return {
    id: 'r1',
    name: 'test room',
    walls,
    ceilingHeight: verified(parseLength(ceiling), 'sam', T0, 'tape'),
  };
}

/** What a wall actually stands at — its own height, or the room's ceiling. */
const standsAt = (wall: Wall, r: Room) => (wall.height ?? r.ceilingHeight).value;

const plain = room([
  w('south', 'east', `20'`),
  w('east', 'north', `10'`),
  w('north', 'west', `20'`),
  w('west', 'south', `10'`),
]);

/** Square feet from the half-square-nanometre unit areas are kept in. */
const sqFeet = (halfNm2: bigint) => Number(halfNm2) / Number(2n * FT * FT);
/** Linear feet. */
const feet = (nm: bigint) => Number(nm) / Number(FT);

test('an empty box takes the numbers you would work out on paper', () => {
  const q = roomQuantities(plain);
  assert.equal(Math.round(sqFeet(q.floorArea)), 200, 'floor: 20 x 10');
  assert.equal(Math.round(sqFeet(q.ceilingArea)), 200, 'ceiling follows the floor');
  assert.equal(Math.round(feet(q.baseboardRun)), 60, 'baseboard: the whole 60 ft perimeter');
  // 60 ft of wall, 8 ft high.
  assert.equal(Math.round(Number(q.wallFaceArea) / Number(FT * FT)), 480, 'wall face: 60 x 8');
});

test('a door comes off the baseboard; a window does not', () => {
  const withDoor = room([
    w('south', 'east', `20'`, [opening('d1', 'door', `3'`, `6' 8"`, `5'`)]),
    w('east', 'north', `10'`),
    w('north', 'west', `20'`, [opening('w1', 'window', `4'`, `3'`, `8'`)]),
    w('west', 'south', `10'`),
  ]);
  const q = roomQuantities(withDoor);

  // 60 ft less the 3 ft door. The window is above the baseboard, which runs
  // underneath it — take it off and every trim quantity in the product is short.
  assert.equal(Math.round(feet(q.baseboardRun)), 57);

  // 480 sq ft less the door (3 x 6.667 = 20) and the window (4 x 3 = 12).
  assert.equal(Math.round(Number(q.wallFaceArea) / Number(FT * FT)), 448);
});

test('a garage door is a gap, not something to paint', () => {
  // A side of the room with nothing built across it takes no drywall, no paint
  // and no baseboard, and it must not be quietly priced as though it did.
  const open = room([
    w('south', 'east', `20'`),
    w('east', 'north', `10'`),
    w('north', 'west', `20'`),
    { ...w('west', 'south', `10'`), open: true },
  ]);
  const q = roomQuantities(open);

  assert.equal(Math.round(sqFeet(q.floorArea)), 200, 'the floor is still the whole floor');
  assert.equal(Math.round(feet(q.baseboardRun)), 50, 'the open side takes no baseboard');
  assert.equal(Math.round(Number(q.wallFaceArea) / Number(FT * FT)), 400, 'and no paint');
  assert.equal(Math.round(feet(q.openRun)), 10, 'it is reported as a gap, priced separately');
});

test('the whole room becomes a zone with one edge per wall', () => {
  const zone = wholeRoom(plain);
  assert.equal(zone.edges.length, plain.walls.length);
  assert.deepEqual(
    zone.edges.map((e) => e.kind),
    ['built', 'built', 'built', 'built']
  );
  // Every edge spans its whole wall: a room is not a split of anything.
  for (const [i, edge] of zone.edges.entries()) {
    if (edge.kind === 'virtual') continue;
    assert.equal(edge.spanStart, 0n);
    assert.equal(edge.spanEnd, plain.walls[i]!.length.value);
  }
});

/* ------------------------------------------- merging, and the height it keeps */

test('merging two wall stubs keeps the taller, not whichever came first', () => {
  // Sam's garage arrives as two short stubs either side of a garage door, and
  // the importer's own note tells the user to turn that opening into a wall if
  // it really is one. The merge spread the first segment's properties over the
  // result, so 5.94 m of wall inherited a 1950 mm stub's height, the 2130 mm
  // piece was thrown away, and 16.8 sq ft of drywall and paint left the takeoff.
  // The room still closed exactly and nothing was reported.
  // A 10 ft ceiling, so "full height" and "the tallest stub" are different
  // answers and the test can tell which one came back.
  const stubs = room(
    [
      w('south', 'east', `20'`),
      w('east', 'north', `10'`),
      { ...w('north-a', 'west', `6'`), height: m(`6' 6"`) },
      { ...w('door', 'west', `8'`), open: true as const },
      { ...w('north-b', 'west', `6'`), height: m(`8'`) },
      w('west', 'south', `10'`),
    ],
    `10'`
  );
  const merged = makeWall(stubs, 'door');
  const wall = merged.walls.find((x) => x.heading === 'west');
  assert.ok(wall, 'the stubs and the closed opening should have become one wall');
  assert.equal(wall.length.value, parseLength(`20'`), 'and it should span the whole side');

  // The wall built across the opening stands to the ceiling, so the merged wall
  // does too. What matters is that it is never the shortest piece: that is the
  // answer that silently removes drywall from the takeoff.
  assert.equal(standsAt(wall, merged), parseLength(`10'`));
  assert.notEqual(standsAt(wall, merged), parseLength(`6' 6"`), 'it took the shortest stub');
});

test('merging a stub into a full-height wall gives a full-height wall', () => {
  // No height at all means the room's ceiling, which is the tallest thing
  // there is. The key has to come off the merged wall rather than be left
  // behind by the spread, or a full-height wall inherits a pony wall's height.
  const stubs = room([
    w('south', 'east', `20'`),
    w('east', 'north', `10'`),
    { ...w('north-a', 'west', `6'`), height: m(`4'`) },
    { ...w('door', 'west', `8'`), open: true as const },
    w('north-b', 'west', `6'`),
    w('west', 'south', `10'`),
  ]);
  const merged = makeWall(stubs, 'door');
  const wall = merged.walls.find((x) => x.heading === 'west');
  assert.ok(wall);
  assert.equal(wall.height, undefined, 'the merged wall should stand to the ceiling');
});

/* ------------------------------------------------------------ sending it */

test('the text says what the numbers are and whose they are', () => {
  const t = takeoff(plain, '2026-08-24 18:19');
  assert.match(t.text, /Floor\s+200\.0 sq ft/);
  assert.match(t.text, /Baseboard\s+60\.00 lf/);
  // The caveat is the point of the whole product. A takeoff off an unchecked
  // scan that leaves this device without it is a guess wearing a number's
  // clothes, and nothing downstream will ever say so.
  assert.match(t.text, /THESE ARE THE SCANNER/);
  assert.match(t.text, /Scanned — not checked/);
});

test('every csv row carries its own unit and its own provenance', () => {
  const t = takeoff(plain, '2026-08-24 18:19');
  const rows = t.csv.split('\n');
  assert.equal(rows[0], 'item,quantity,unit,prices,workings,provenance,room,taken_off');
  for (const row of rows.slice(1)) {
    // A bare number in a cell is how a square foot becomes a linear foot three
    // steps later, and how a guess becomes a fact.
    assert.match(row, /,(sq ft|lf|ea),/, `no unit on: ${row}`);
    assert.match(row, /,(scanned|measured),/, `no provenance on: ${row}`);
  }
});

/** A small CSV reader, so the test checks the file rather than counting commas. */
function parseCsv(row: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < row.length; i += 1) {
    const c = row[i]!;
    if (quoted) {
      if (c === '"' && row[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(field);
      field = '';
    } else field += c;
  }
  out.push(field);
  return out;
}

test('a comma in a room name does not become a new column', () => {
  // Several fields carry commas of their own — "flooring, tile, underlay" — so
  // counting them proves nothing. Read the file the way a spreadsheet will.
  const t = takeoff({ ...plain, name: 'Kitchen, rear' }, '2026-08-24 18:19');
  const rows = t.csv.split('\n');
  const columns = parseCsv(rows[0]!).length;
  for (const row of rows.slice(1)) {
    const cells = parseCsv(row);
    assert.equal(cells.length, columns, `wrong number of columns in: ${row}`);
    assert.equal(cells[6], 'Kitchen, rear', 'the room name lost its comma or gained a column');
  }
});

test('a quote in a room name survives the trip', () => {
  const t = takeoff({ ...plain, name: 'The "big" room' }, '2026-08-24 18:19');
  for (const row of t.csv.split('\n').slice(1)) {
    assert.equal(parseCsv(row)[6], 'The "big" room');
  }
});

test('the exported floor area is the number on the screen', () => {
  // Truncating where the screen rounds had the garage reading 411.7 here and
  // 411.8 there, from one exact value. Two of the app's own surfaces disagreeing
  // about a number is worse than either of them being a tenth out.
  const t = takeoff(plain, '2026-08-24 18:19');
  const floor = t.lines.find((l) => l.what === 'Floor')!;
  assert.equal(`${floor.quantity} sq ft`, formatSquareFeet(roomQuantities(plain).floorArea));
});

test('once every wall is measured, the takeoff stops apologising', () => {
  const measured: Room = {
    ...plain,
    walls: plain.walls.map((wall) => ({
      ...wall,
      length: verify(wall.length, parseLength(`20'`), 'sam', T0, 'tape'),
    })),
  };
  const t = takeoff(measured, '2026-08-24 18:19');
  assert.match(t.text, /Every wall behind these numbers has had a tape on it/);
  assert.doesNotMatch(t.text, /SCANNER/);
  assert.ok(t.lines.filter((l) => l.unit !== 'ea').every((l) => l.provenance === 'measured'));
});

test('the wall schedule says which walls were measured and which were guessed', () => {
  const schedule = wallSchedule(plain);
  assert.equal(schedule.split('\n').length, plain.walls.length);
  for (const line of schedule.split('\n')) assert.match(line, /scanned ±/);
});
