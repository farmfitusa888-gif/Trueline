import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength } from '../length.ts';
import { scanned, verified, verify } from '../measurement.ts';
import type { Heading, Opening, Room, Wall } from '../room.ts';
import type { Damage } from '../damage.ts';
import { SCOPE_ITEMS, damageScope } from '../scope.ts';
import { quote } from '../price.ts';

/**
 * What it takes to put the damage right — and what it deliberately does not say.
 *
 * The room is 20 x 10 with a 9 ft ceiling and every number in here is a round
 * one, so every quantity below can be checked on the back of an envelope. That
 * is the point: a scope somebody cannot check by hand is a scope somebody
 * argues with rather than prices off.
 */

const T0 = '2026-08-26T09:00:00Z';
const scan = (text: string) => scanned(parseLength(text), parseLength(`50mm`), T0, 'roomplan');

function w(id: string, heading: Heading, length: string, openings?: Opening[]): Wall {
  return { id, heading, length: scan(length), ...(openings ? { openings } : {}) };
}

const door: Opening = {
  id: 'd1',
  kind: 'door',
  width: scan(`3'`),
  height: scan(`6' 8"`),
  offsetFromStart: scan(`14'`),
};

const room: Room = {
  id: 'r1',
  name: 'basement',
  walls: [
    w('south', 'east', `20'`),
    w('east', 'north', `10'`),
    w('north', 'west', `20'`, [door]),
    w('west', 'south', `10'`),
  ],
  ceilingHeight: verified(parseLength(`9'`), 'sam', T0, 'tape'),
};

const base = {
  kind: 'water' as const,
  category: 2 as const,
  note: 'supply line let go behind the washer',
  recordedAt: T0,
  recordedBy: 'gilbert',
  photos: [],
  readings: [],
};

/** Nine feet of the north wall, two feet up. The door starts at 14', so it misses. */
const waterline: Damage = {
  ...base,
  id: 'd-1',
  shape: {
    kind: 'patch',
    wallId: 'north',
    fromAlong: parseLength(`1'`),
    toAlong: parseLength(`10'`),
    fromHeight: 0n,
    toHeight: parseLength(`2'`),
  },
};

function line(scope: ReturnType<typeof damageScope>, what: string) {
  return scope.lines.find((l) => l.what.startsWith(what));
}

/* ---------------------------------------------------------- what comes out */

test('what comes out is what the wall says, not a guess', () => {
  // Nine feet by two feet is eighteen square feet, and it reaches the floor, so
  // nine feet of base comes with it.
  const scope = damageScope(room, [waterline], '26 Aug 2026');
  assert.equal(line(scope, 'Remove wall board')!.quantity, '18.0');
  assert.equal(line(scope, 'Remove wall board')!.unit, 'sq ft');
  assert.equal(line(scope, 'Remove baseboard')!.quantity, '9.00');
  assert.equal(line(scope, 'Remove baseboard')!.unit, 'lf');
});

test('what goes back is what came out', () => {
  const scope = damageScope(room, [waterline], '26 Aug 2026');
  assert.equal(line(scope, 'Hang wall board')!.quantity, '18.0');
  assert.equal(line(scope, 'Tape and finish')!.quantity, '18.0');
  assert.equal(line(scope, 'Replace baseboard')!.quantity, '9.00');
});

/* ------------------------------------------------- the one wider than the mark */

test('paint runs corner to corner, and the sheet says why', () => {
  // The whole north wall is 20 x 9 = 180, less a 3 x 6'8" door = 20, so 160.
  // Not 18. Nobody feathers a coat into the middle of a wall, and a scope that
  // priced 18 sq ft of paint here is the one that comes back corrected.
  const scope = damageScope(room, [waterline], '26 Aug 2026');
  const paint = line(scope, 'Prime and paint')!;
  assert.equal(paint.quantity, '160.0');
  assert.match(paint.widerThanTheDamage!, /corner to corner/);
  assert.match(paint.workings, /whole face of north/);
});

test('every wider-than-the-mark line says so; nothing is silently bigger', () => {
  const scope = damageScope(room, [waterline], '26 Aug 2026');
  for (const l of scope.lines) {
    const isWider = l.what.startsWith('Prime and paint') || l.what.startsWith('Seal');
    assert.equal(
      l.widerThanTheDamage !== undefined,
      isWider,
      `${l.what} must ${isWider ? '' : 'not '}carry a reason for being wider`
    );
  }
});

/* --------------------------------------------------- what it refuses to say */

test('no equipment, no days, no debris — none of those come off a wall', () => {
  const scope = damageScope(room, [waterline], '26 Aug 2026');
  for (const l of scope.lines) {
    assert.doesNotMatch(l.what, /air mover|dehumidif|dumpster|day|hour|haul/i);
    assert.equal(l.unit === 'ea', false, `${l.what} is a count, and nothing here is counted`);
  }
  assert.match(scope.note, /nothing on it is equipment, days or debris/);
});

test('a pin produces no work, and is named rather than dropped', () => {
  const pin: Damage = {
    ...base,
    id: 'd-pin',
    kind: 'impact',
    category: undefined,
    note: 'hole punched through the board',
    shape: { kind: 'pin', at: { x: 0n, y: 0n }, wallId: 'north' },
  };
  const scope = damageScope(room, [pin], '26 Aug 2026');
  assert.equal(scope.lines.length, 0);
  assert.deepEqual(scope.noWork, ['impact — hole punched through the board']);
  assert.match(scope.text, /A pin is a marker, not a measurement/);
});

/* -------------------------------------------------- kept apart from a takeoff */

test('the sheet says out loud that it is not the room’s takeoff', () => {
  const scope = damageScope(room, [waterline], '26 Aug 2026');
  assert.match(scope.note, /NOT the room’s takeoff/);
  assert.match(scope.text, /damage scope/);
});

test('every line names the mark it came off', () => {
  const second: Damage = {
    ...base,
    id: 'd-2',
    note: 'staining under the window',
    shape: {
      kind: 'patch',
      wallId: 'south',
      fromAlong: parseLength(`2'`),
      toAlong: parseLength(`6'`),
      fromHeight: parseLength(`5'`),
      toHeight: parseLength(`7'`),
    },
  };
  const scope = damageScope(room, [waterline, second], '26 Aug 2026');
  assert.equal(new Set(scope.lines.map((l) => l.damageId)).size, 2);
  for (const l of scope.lines) assert.match(l.damageId, /^d-[12]$/);
  // The second one does not reach the floor, so no base comes off it.
  const baseLines = scope.lines.filter((l) => l.damageId === 'd-2' && l.unit === 'lf');
  assert.deepEqual(baseLines, []);
});

/* ------------------------------------------------------------- provenance */

test('a scope off an unchecked scan is marked scanned on every line', () => {
  const scope = damageScope(room, [waterline], '26 Aug 2026');
  assert.equal(new Set(scope.lines.map((l) => l.provenance)).size, 1);
  assert.equal(scope.lines[0]!.provenance, 'scanned');
});

test('once a tape has been on one wall each way, the scope says measured', () => {
  const measured: Room = {
    ...room,
    walls: room.walls.map((wall) =>
      wall.id === 'north' || wall.id === 'east'
        ? { ...wall, length: verify(wall.length, parseLength(wall.id === 'north' ? `20'` : `10'`), 'sam', T0, 'tape') }
        : wall
    ),
  };
  const scope = damageScope(measured, [waterline], '26 Aug 2026');
  assert.equal(scope.lines[0]!.provenance, 'measured');
});

/* -------------------------------------------------------------- the files */

test('the CSV carries the unit and the mark in their own columns', () => {
  const scope = damageScope(room, [waterline], '26 Aug 2026');
  const [header, first] = scope.csv.split('\n');
  assert.equal(header, 'mark,stage,item,quantity,unit,workings,provenance,wider than the damage');
  assert.match(first!, /^"d-1","tear out","Remove wall board",18\.0,"sq ft"/);
});

test('smoke seals the whole surface, because smoke does not stop at a line', () => {
  const smoke: Damage = {
    ...base,
    id: 'd-smoke',
    kind: 'smoke',
    category: undefined,
    note: 'staining across the north wall',
    shape: {
      kind: 'patch',
      wallId: 'north',
      fromAlong: parseLength(`1'`),
      toAlong: parseLength(`10'`),
      fromHeight: parseLength(`6'`),
      toHeight: parseLength(`9'`),
    },
  };
  const scope = damageScope(room, [smoke], '26 Aug 2026');
  const seal = line(scope, 'Seal')!;
  assert.equal(seal.quantity, '160.0');
  assert.equal(seal.stage, 'protect');
  assert.match(seal.widerThanTheDamage!, /does not stop at the edge/);
});

/* ------------------------------------------------------------ and priced */

test('a scope prices through the same book a takeoff does', () => {
  // One function, so a rate cannot mean one thing on a remodel sheet and
  // something else on a restoration one.
  const scope = damageScope(room, [waterline], '26 Aug 2026');
  const priced = quote(scope.lines, {
    rates: [
      { item: 'Hang wall board', unit: 'sq ft', cents: 210n, source: { kind: 'typed', by: 'sam', at: T0 } },
      { item: 'Replace baseboard', unit: 'lf', cents: 450n, source: { kind: 'typed', by: 'sam', at: T0 } },
    ],
  });
  // 18.0 sq ft at $2.10 is $37.80; 9 lf at $4.50 is $40.50.
  assert.equal(priced.lines.find((l) => l.item === 'Hang wall board')!.total, 3780n);
  assert.equal(priced.lines.find((l) => l.item === 'Replace baseboard')!.total, 4050n);
  assert.equal(priced.subtotal, 7830n);
  // Everything else is named rather than quietly left out at nothing.
  assert.ok(priced.unpriced.includes('Remove wall board'));
  assert.equal(priced.measured, false, 'the room has had no tape on it');
});

/* -------------------------------------------- the catalogue cannot drift */

/**
 * One damage of a given kind. The category comes off anything but water,
 * because the model refuses a fire with a water category on it — and it is
 * right to: a category describes how dirty water was and means nothing about
 * a fire.
 */
function oneOf(kind: Damage['kind'], id: string, shape: Damage['shape']): Damage {
  const { category: _water, ...rest } = base;
  return kind === 'water' ? { ...base, id, kind, shape } : { ...rest, id, kind, shape };
}

test('every line this module can produce is in the catalogue a rate is typed against', () => {
  // The rate editor is generated from SCOPE_ITEMS. An item that can come out of
  // damageScope() and is not in that list is an item nobody can ever put a rate
  // against — the quote comes out silently short by whatever it was for.
  const kinds = ['water', 'fire', 'smoke', 'mould', 'impact', 'wind', 'other'] as const;
  const shapes: Damage['shape'][] = [
    { kind: 'patch', wallId: 'north', fromAlong: parseLength(`1'`), toAlong: parseLength(`10'`), fromHeight: 0n, toHeight: parseLength(`2'`) },
    { kind: 'surface', surface: 'wall', wallId: 'north' },
    { kind: 'surface', surface: 'floor' },
    { kind: 'surface', surface: 'ceiling' },
  ];
  const known = new Set(SCOPE_ITEMS.map((i) => `${i.item}|${i.unit}`));
  let seen = 0;
  for (const kind of kinds) {
    for (const [n, shape] of shapes.entries()) {
      const scope = damageScope(room, [oneOf(kind, `d-${kind}-${n}`, shape)], '26 Aug 2026');
      for (const l of scope.lines) {
        seen += 1;
        assert.ok(known.has(`${l.what}|${l.unit}`), `"${l.what}" (${l.unit}) is not in SCOPE_ITEMS`);
        assert.equal(
          SCOPE_ITEMS.find((i) => i.item === l.what)!.stage,
          l.stage,
          `"${l.what}" is in a different stage than the catalogue says`
        );
      }
    }
  }
  assert.ok(seen > 40, `only ${seen} lines were exercised, which is not the whole surface`);
});

test('the catalogue holds nothing the module cannot produce', () => {
  // The other direction. A rate editor listing an item no sheet will ever carry
  // is a row somebody fills in and then wonders why it never shows up.
  const kinds = ['water', 'fire', 'smoke', 'mould', 'impact', 'wind', 'other'] as const;
  const shapes: Damage['shape'][] = [
    { kind: 'patch', wallId: 'north', fromAlong: parseLength(`1'`), toAlong: parseLength(`10'`), fromHeight: 0n, toHeight: parseLength(`2'`) },
    { kind: 'surface', surface: 'wall', wallId: 'north' },
    { kind: 'surface', surface: 'floor' },
    { kind: 'surface', surface: 'ceiling' },
  ];
  const produced = new Set<string>();
  for (const kind of kinds) {
    for (const [n, shape] of shapes.entries()) {
      for (const l of damageScope(room, [oneOf(kind, `d-${kind}-${n}`, shape)], '26 Aug 2026').lines) {
        produced.add(`${l.what}|${l.unit}`);
      }
    }
  }
  for (const i of SCOPE_ITEMS) {
    assert.ok(produced.has(`${i.item}|${i.unit}`), `SCOPE_ITEMS lists "${i.item}" and nothing produces it`);
  }
});
