import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NM_PER_FOOT, parseLength } from '../length.ts';
import { scanned, verified } from '../measurement.ts';
import { type Heading, type Opening, type Room, type Wall } from '../room.ts';
import { verifyWall } from '../edit.ts';
import { takeoff } from '../takeoff.ts';
import { type PriceBook, quote } from '../price.ts';
import { loadProject, saveProject } from '../persist.ts';
import { changesSince, freeze } from '../baseline.ts';
import { NOBODY, optionFrom, proposalOf } from '../proposal.ts';
import { CLIENT_INTENT, sign } from '../signature.ts';
import { EMPTY_COMPANY } from '../company.ts';
import {
  type Surface,
  type WorkItem,
  type WorkScope,
  KNOWN_WORK,
  WorkError,
  describeScope,
  drop,
  everything,
  nothing,
  pick,
  rateFor,
  surfacesOf,
  validateItem,
  workItems,
  workSheet,
} from '../work.ts';

/**
 * Costing what is actually being done, rather than costing a gut job.
 *
 * > "How are we costing everything down like it all needs to be replaced by
 * >  each line item?"
 *
 * The arithmetic here is hand-computed on purpose. A test that asks the takeoff
 * for a number and then asks the takeoff whether the number is right proves
 * only that the code is consistent with itself, and the whole failure this
 * feature exists to prevent — a quote that adds up perfectly and is for the
 * wrong work — is exactly the kind a self-consistent test cannot see.
 *
 * The room: 20 ft by 10 ft, 8 ft to the ceiling. So a long wall is 160 sq ft of
 * face, a short one is 80, and the four together are 480.
 */

const T0 = '2026-08-27T09:00:00Z';
const BY = 'sam';

function m(text: string) {
  return scanned(parseLength(text), parseLength('50mm'), T0, 'roomplan');
}

function w(id: string, heading: Heading, length: string, openings?: Opening[]): Wall {
  return { id, heading, length: m(length), ...(openings ? { openings } : {}) };
}

function opening(id: string, kind: Opening['kind'], width: string, height: string, at: string): Opening {
  return { id, kind, width: m(width), height: m(height), offsetFromStart: m(at) };
}

const box: Room = {
  id: 'r1',
  name: 'Back bedroom',
  walls: [
    w('south', 'east', `20'`),
    w('east', 'north', `10'`),
    w('north', 'west', `20'`),
    w('west', 'south', `10'`),
  ],
  ceilingHeight: verified(parseLength(`8'`), BY, T0, 'tape'),
};

const ITEMS = KNOWN_WORK;
const wallFace = ITEMS.find((i) => i.item === 'Wall face')!;
const baseboard = ITEMS.find((i) => i.item === 'Baseboard')!;
const floorItem = ITEMS.find((i) => i.item === 'Floor')!;
const ceilingItem = ITEMS.find((i) => i.item === 'Ceiling')!;
const doorsItem = ITEMS.find((i) => i.item === 'Doors')!;

const wallOf = (id: string): Surface => ({ kind: 'wall', wallId: id });
const FLOOR: Surface = { kind: 'floor' };
const CEILING: Surface = { kind: 'ceiling' };

/** A scope with the given items on the given surfaces, and nothing else. */
function scopeOf(pairs: readonly (readonly [Surface, WorkItem])[]): WorkScope {
  return pairs.reduce((scope, [surface, item]) => pick(scope, surface, item, BY, T0), nothing(BY, T0));
}

const sheetFor = (room: Room, scope: WorkScope, items: readonly WorkItem[] = ITEMS) =>
  takeoff(room, T0, { work: { scope, items } });

/* ============================================================ counting */

test('three walls boarded and one left alone counts exactly three walls', () => {
  // South 20 ft and north 20 ft are 160 sq ft of face each; east 10 ft is 80.
  // The west wall is not being touched, so its 80 sq ft is not on the sheet.
  const sheet = sheetFor(
    box,
    scopeOf([
      [wallOf('south'), wallFace],
      [wallOf('east'), wallFace],
      [wallOf('north'), wallFace],
    ])
  );

  const face = sheet.lines.find((l) => l.what === 'Wall face');
  assert.ok(face, 'the wall face is on the sheet');
  assert.equal(face.quantity, '400.0', '160 + 80 + 160, and not the 480 of all four');
  assert.equal(face.unit, 'sq ft');
  assert.deepEqual([...face.from!], ['south', 'east', 'north'], 'and it says which walls');
  assert.match(face.workings, /south, east, north/);
});

test('a surface nobody picked anything on produces no line, not a zero line', () => {
  const sheet = sheetFor(box, scopeOf([[wallOf('south'), wallFace]]));

  // A zero line is a claim: it says the work is in the job and costs nothing.
  // Absence is the only honest answer for work that is not happening.
  assert.equal(sheet.lines.filter((l) => l.what === 'Floor').length, 0);
  assert.equal(sheet.lines.filter((l) => l.what === 'Ceiling').length, 0);
  assert.equal(sheet.lines.filter((l) => l.what === 'Baseboard').length, 0);
  assert.equal(sheet.lines.filter((l) => l.quantity === '0.0' || l.quantity === '0').length, 0);

  // And it is said out loud, because a wall left alone is a decision and a
  // decision that produces nothing anywhere reads as an oversight.
  assert.deepEqual([...sheet.untouched], ['the floor', 'the ceiling', 'east', 'north', 'west']);
  assert.match(sheet.text, /Nothing is being done to the floor, the ceiling, east, north, west/);
});

test('an item picked where there is none of it is named rather than priced at nothing', () => {
  const sheet = sheetFor(box, scopeOf([[wallOf('south'), doorsItem]]));

  assert.equal(sheet.lines.filter((l) => l.what === 'Doors').length, 0, 'no 0 ea door line');
  assert.equal(sheet.measuresNothing.length, 1);
  assert.match(sheet.measuresNothing[0]!, /^Doors on south — picked, and there is none of it there$/);
  assert.match(sheet.text, /Picked, and there is none of it there: Doors on south/);
});

test('a door comes off the face of the wall it is in, and off nothing else', () => {
  // A 3 ft by 6 ft 8 in door in the south wall: 20 sq ft out of that wall's 160.
  const withDoor: Room = {
    ...box,
    walls: box.walls.map((wall) =>
      wall.id === 'south' ? { ...wall, openings: [opening('d1', 'door', `3'`, `6'8"`, `5'`)] } : wall
    ),
  };

  const south = sheetFor(withDoor, scopeOf([[wallOf('south'), wallFace]]));
  assert.equal(south.lines.find((l) => l.what === 'Wall face')!.quantity, '140.0', '160 less 20');

  const north = sheetFor(withDoor, scopeOf([[wallOf('north'), wallFace]]));
  assert.equal(north.lines.find((l) => l.what === 'Wall face')!.quantity, '160.0', 'the door is not here');

  // And the door itself is counted only where it is, and only when picked.
  const counted = sheetFor(withDoor, scopeOf([[wallOf('south'), doorsItem]]));
  assert.equal(counted.lines.find((l) => l.what === 'Doors')!.quantity, '1');
  const elsewhere = sheetFor(withDoor, scopeOf([[wallOf('north'), doorsItem]]));
  assert.equal(elsewhere.lines.filter((l) => l.what === 'Doors').length, 0);
});

test('the floor and the ceiling are their own surfaces, picked apart', () => {
  // The realistic remodel: the floor comes out, the ceiling is painted, and
  // the base is reused. Three decisions about one room.
  const sheet = sheetFor(
    box,
    scopeOf([
      [FLOOR, floorItem],
      [CEILING, ceilingItem],
      [wallOf('south'), wallFace],
      [wallOf('east'), wallFace],
      [wallOf('north'), wallFace],
      [wallOf('west'), wallFace],
    ])
  );

  assert.equal(sheet.lines.find((l) => l.what === 'Floor')!.quantity, '200.0');
  assert.equal(sheet.lines.find((l) => l.what === 'Ceiling')!.quantity, '200.0');
  assert.equal(sheet.lines.find((l) => l.what === 'Wall face')!.quantity, '480.0');
  assert.equal(sheet.lines.filter((l) => l.what === 'Baseboard').length, 0, 'the base is reused');
});

test('everything picked on everything is the sheet this app has always printed', () => {
  // The strongest check there is that the scoped path and the old path are one
  // piece of arithmetic and not two: the same room, both ways, same numbers.
  const withDoor: Room = {
    ...box,
    walls: box.walls.map((wall) =>
      wall.id === 'south'
        ? {
            ...wall,
            openings: [
              opening('d1', 'door', `3'`, `6'8"`, `5'`),
              opening('w1', 'window', `4'`, `3'`, `12'`),
            ],
          }
        : wall
    ),
  };
  const plain = takeoff(withDoor, T0);
  const scoped = sheetFor(withDoor, everything(withDoor, ITEMS, BY, T0));

  const numbers = (sheet: typeof plain) =>
    sheet.lines.map((l) => `${l.what}|${l.quantity}|${l.unit}`);
  assert.deepEqual(numbers(scoped), numbers(plain));
});

test('the exact value a line carries is the number it prints', () => {
  // The screen converts from `exact` for a contractor working in metres. If it
  // ever disagreed with the feet on the sheet, one of them would be wrong on a
  // quote and neither would look it.
  const sheet = sheetFor(box, everything(box, ITEMS, BY, T0));
  const sqFt = 2n * NM_PER_FOOT * NM_PER_FOOT;

  for (const line of sheet.lines) {
    if (!line.exact) continue;
    if (line.exact.kind === 'area') {
      assert.equal(
        (Number(line.exact.halfSquares) / Number(sqFt)).toFixed(1),
        line.quantity,
        line.what
      );
    }
    if (line.exact.kind === 'run') {
      assert.equal(
        (Number(line.exact.nanometres) / Number(NM_PER_FOOT)).toFixed(2),
        line.quantity,
        line.what
      );
    }
  }
});

/* ======================================================== old projects */

test('a project saved before scopes existed opens with everything replaced, unchanged', () => {
  // Exactly what a file written last month holds: a room, and nothing that has
  // ever heard of a scope.
  const saved = saveProject({
    savedAt: T0,
    fileName: 'Back bedroom 2026-07-14',
    room: box,
    extras: { report: { sourceVersion: '1' } },
  });
  const reopened = loadProject(saved);

  const before = takeoff(box, T0);
  const after = takeoff(reopened.room, T0);

  assert.equal(after.text, before.text, 'the sheet is the same to the character');
  assert.equal(after.csv, before.csv);
  assert.equal(after.scoped, false, 'and it knows it has not been scoped');
  assert.deepEqual([...after.untouched], []);
  // Everything is on it, as it always was.
  assert.deepEqual(
    after.lines.map((l) => l.what),
    ['Floor', 'Ceiling', 'Wall face', 'Baseboard']
  );
  // Nothing on an unscoped sheet claims to know which walls it came off,
  // because the answer is all of them and printing it would say nothing.
  assert.ok(after.lines.every((l) => l.from === undefined));
});

test('a scope survives being saved and read back', () => {
  const scope = scopeOf([
    [wallOf('south'), wallFace],
    [FLOOR, floorItem],
  ]);
  const saved = saveProject({
    savedAt: T0,
    fileName: 'Back bedroom',
    room: box,
    extras: { report: { sourceVersion: '1' }, scope },
  });
  const back = (loadProject(saved).extras as { scope: WorkScope }).scope;

  assert.deepEqual(sheetFor(box, back).lines.map((l) => l.what), ['Floor', 'Wall face']);
  assert.equal(back.setBy, BY);
});

/* ====================================================== invented items */

test('an item the contractor invents is offered on every job afterwards', () => {
  const skim: WorkItem = {
    item: 'Skim coat',
    unit: 'sq ft',
    measure: 'wall face',
    prices: 'plaster, labour',
    own: true,
  };
  const book: PriceBook = { rates: [rateFor(skim, 210n, BY, T0)] };

  const offered = workItems(book);
  const found = offered.find((i) => i.item === 'Skim coat');
  assert.ok(found, 'it comes back out of the rate book');
  assert.equal(found.measure, 'wall face');
  assert.equal(found.own, true);
  assert.equal(offered.length, KNOWN_WORK.length + 1, 'beside the app’s own items');
});

test('starting from everything leaves the quote exactly where it was', () => {
  // The promise the control makes on screen: nothing moves until you take
  // something off. An invented item swept onto thirteen surfaces by a button
  // labelled "say what is being done" is the first thing it does being the
  // thing nobody asked for.
  const skim: WorkItem = {
    item: 'Skim coat',
    unit: 'sq ft',
    measure: 'wall face',
    prices: 'plaster, labour',
    own: true,
  };
  const items = [...KNOWN_WORK, skim];
  const scope = everything(box, items, BY, T0);

  assert.equal(
    sheetFor(box, scope, items).lines.filter((l) => l.what === 'Skim coat').length,
    0,
    'his own item starts unticked'
  );
  assert.deepEqual(
    sheetFor(box, scope, items).lines.map((l) => `${l.what}|${l.quantity}`),
    takeoff(box, T0).lines.map((l) => `${l.what}|${l.quantity}`)
  );
});

test('an invented item measured off a wall moves when that wall is re-measured', () => {
  const skim: WorkItem = {
    item: 'Skim coat',
    unit: 'sq ft',
    measure: 'wall face',
    prices: 'plaster, labour',
    own: true,
  };
  const items = [...KNOWN_WORK, skim];
  const scope = scopeOf([[wallOf('south'), skim]]);

  const off = sheetFor(box, scope, items).lines.find((l) => l.what === 'Skim coat')!;
  assert.equal(off.quantity, '160.0', '20 ft of wall, 8 ft high');
  assert.equal(off.provenance, 'scanned', 'nobody has put a tape on anything yet');

  // One wall each way taped, which is what makes the room's shape trustworthy.
  let measured = verifyWall(box, 'south', parseLength(`20'`), BY, T0, 'tape').room;
  measured = verifyWall(measured, 'east', parseLength(`10'`), BY, T0, 'tape').room;
  const before = sheetFor(measured, scope, items).lines.find((l) => l.what === 'Skim coat')!;
  assert.equal(before.quantity, '160.0');
  assert.equal(before.provenance, 'measured');

  // Now the tape says the south wall is 22 ft, not 20. The room re-solves round
  // it, and the quantity of skim coat on that wall moves with it — which is the
  // entire reason an invented item names where its quantity comes from.
  const grown = verifyWall(measured, 'south', parseLength(`22'`), BY, T0, 'tape').room;
  const after = sheetFor(grown, scope, items).lines.find((l) => l.what === 'Skim coat')!;
  assert.equal(after.quantity, '176.0', '22 ft of wall, 8 ft high');
  assert.equal(after.provenance, 'measured');
});

test('an invented item can be a number somebody types, and says so', () => {
  const protect: WorkItem = {
    item: 'Protect and mask',
    unit: 'ea',
    measure: 'typed',
    prices: 'sheeting, tape',
    own: true,
    amount: '1',
  };
  const items = [...KNOWN_WORK, protect];
  const sheet = sheetFor(
    box,
    scopeOf([
      [wallOf('south'), protect],
      [wallOf('east'), protect],
    ]),
    items
  );

  const line = sheet.lines.find((l) => l.what === 'Protect and mask')!;
  assert.equal(line.quantity, '2', 'one on each of the two walls it was put on');
  assert.match(line.workings, /typed by hand — it does not move when the room does/);
  assert.deepEqual([...line.from!], ['south', 'east']);
});

test('an item is refused when the unit and the measure disagree', () => {
  assert.throws(
    () =>
      validateItem({
        item: 'Skim coat',
        unit: 'lf',
        measure: 'wall face',
        prices: '',
      }),
    (error: unknown) => error instanceof WorkError && /becomes a linear foot/.test((error as Error).message)
  );
});

test('an item with no name, and a typed item with no number, are both refused', () => {
  assert.throws(
    () => validateItem({ item: '  ', unit: 'ea', measure: 'typed', prices: '', amount: '1' }),
    WorkError
  );
  assert.throws(
    () => validateItem({ item: 'Skip hire', unit: 'ea', measure: 'typed', prices: '' }),
    WorkError
  );
  assert.throws(
    () => validateItem({ item: 'Skip hire', unit: 'ea', measure: 'typed', prices: '', amount: '0' }),
    (error: unknown) => error instanceof WorkError && /zero of something/.test((error as Error).message)
  );
});

/* ========================================================= provenance */

test('a line off a scanned wall is scanned even in a room that has been measured', () => {
  // One wall each way taped is what makes a room's shape trustworthy. It is not
  // a promise about the wall nobody touched, and a line that came off that wall
  // must not inherit one.
  let measured = verifyWall(box, 'south', parseLength(`20'`), BY, T0, 'tape').room;
  measured = verifyWall(measured, 'east', parseLength(`10'`), BY, T0, 'tape').room;

  assert.equal(takeoff(measured, T0).lines[0]!.provenance, 'measured', 'the room reads as measured');

  const taped = sheetFor(measured, scopeOf([[wallOf('south'), wallFace]]));
  assert.equal(taped.lines.find((l) => l.what === 'Wall face')!.provenance, 'measured');

  const untaped = sheetFor(measured, scopeOf([[wallOf('north'), wallFace]]));
  assert.equal(
    untaped.lines.find((l) => l.what === 'Wall face')!.provenance,
    'scanned',
    'the north wall is still the scanner’s number'
  );
});

/* ============================================================ the scope */

test('picking twice picks once, and dropping the last item forgets the surface', () => {
  const once = pick(nothing(BY, T0), wallOf('south'), wallFace, BY, T0);
  const twice = pick(once, wallOf('south'), wallFace, BY, T0);
  assert.deepEqual(twice.picked['wall:south'], [{ item: 'Wall face', unit: 'sq ft' }]);

  const gone = drop(twice, wallOf('south'), wallFace, BY, T0);
  assert.equal(gone.picked['wall:south'], undefined, 'not an empty list left behind');
});

test('a wall with nothing built across it is not a surface work can be picked on', () => {
  const garage: Room = {
    ...box,
    walls: box.walls.map((wall) => (wall.id === 'south' ? { ...wall, open: true as const } : wall)),
  };
  const surfaces = surfacesOf(garage).map((s) => (s.kind === 'wall' ? s.wallId : s.kind));
  assert.deepEqual(surfaces, ['floor', 'ceiling', 'east', 'north', 'west']);

  // And the open span is still reported, because a side of the room with
  // nothing across it is the one thing nobody should find out from a delivery.
  const sheet = sheetFor(garage, everything(garage, ITEMS, BY, T0));
  assert.ok(sheet.lines.some((l) => l.what === 'Open span'));
});

test('work picked on a wall that is no longer there is named, not silently dropped', () => {
  // The failure this exists to prevent: the wall gets renamed on the plan, the
  // quote quietly loses eighty square feet, and nothing anywhere says why.
  const scope = scopeOf([
    [wallOf('south'), wallFace],
    [wallOf('gone'), wallFace],
  ]);
  const sheet = sheetFor(box, scope);

  assert.equal(sheet.lines.find((l) => l.what === 'Wall face')!.quantity, '160.0', 'south only');
  assert.deepEqual([...sheet.stranded], ['Wall face on gone']);
  assert.match(sheet.text, /Picked on part of the room that is no longer there/);
});

test('a scope says what it is doing in words a contractor would use', () => {
  const said = describeScope(box, scopeOf([[wallOf('south'), wallFace]]));
  assert.match(said, /Counting only what is being done: south\./);
  assert.match(said, /Nothing is being done to the floor, the ceiling, east, north, west/);
  assert.match(said, /left out rather than priced at nothing/);

  assert.match(describeScope(box, nothing(BY, T0)), /Nothing is picked yet/);
});

/* ============================================== the signed baseline */

test('changing the scope after signing produces a change order that names what changed', async () => {
  const book: PriceBook = {
    rates: [
      { item: 'Wall face', unit: 'sq ft', cents: 375n, source: { kind: 'typed', by: BY, at: T0 } },
      { item: 'Floor', unit: 'sq ft', cents: 950n, source: { kind: 'typed', by: BY, at: T0 } },
    ],
  };

  // Signed: the floor comes out, and three of the four walls get boarded.
  const agreedScope = scopeOf([
    [FLOOR, floorItem],
    [wallOf('south'), wallFace],
    [wallOf('east'), wallFace],
    [wallOf('north'), wallFace],
  ]);
  const agreedQuote = quote(sheetFor(box, agreedScope).lines, book);
  // 400 sq ft of face at $3.75 is $1,500.00; 200 sq ft of floor at $9.50 is
  // $1,900.00. Worked out here rather than read off the object being tested.
  assert.equal(agreedQuote.total, 150_000n + 190_000n);

  const proposal = {
    ...proposalOf(
      'p1',
      'Back bedroom',
      { ...EMPTY_COMPANY, name: 'Gilbert Remodeling' },
      { ...NOBODY, name: 'M. Alvarez', address: '14 Sycamore' },
      [optionFrom('a', 'As scoped', 'Floor out, three walls boarded.', agreedQuote)],
      T0,
      '2026-09-30'
    ),
    chosen: 'a',
  };
  const signature = await sign(proposal, {
    id: 's1',
    who: 'M. Alvarez',
    role: 'client',
    intent: CLIENT_INTENT,
    consented: true,
    mark: 'data:image/png;base64,iVBORw0KGgo=',
    at: T0,
    device: 'iPhone',
  });
  const baseline = await freeze(proposal, [signature], T0);

  // On site: the client asks for the fourth wall as well, and the floor is
  // being kept after all. Two changes, in opposite directions.
  let now = pick(agreedScope, wallOf('west'), wallFace, 'client on site', '2026-09-02T10:00:00Z');
  now = drop(now, FLOOR, floorItem, 'client on site', '2026-09-02T10:00:00Z');

  const order = changesSince(baseline, quote(sheetFor(box, now).lines, book));

  const face = order.changes.find((c) => c.item === 'Wall face')!;
  assert.equal(face.kind, 'more');
  assert.equal(face.wasQuantity, '400.0');
  assert.equal(face.nowQuantity, '480.0');
  assert.equal(face.difference, 30_000n, '80 sq ft at $3.75');
  assert.match(face.says, /Wall face was 400\.0 sq ft, now 480\.0/);

  const floor = order.changes.find((c) => c.item === 'Floor')!;
  assert.equal(floor.kind, 'removed', 'the floor comes off the job entirely, not down to zero');
  assert.equal(floor.difference, -190_000n);
  assert.match(floor.says, /Floor comes off/);

  assert.equal(order.difference, 30_000n - 190_000n);
  assert.equal(order.unchanged, false);
  // What was signed is untouched by any of it.
  assert.equal(baseline.agreed.total, 340_000n);
});

test('a scope that has not changed since signing raises no change order', async () => {
  const book: PriceBook = {
    rates: [{ item: 'Wall face', unit: 'sq ft', cents: 375n, source: { kind: 'typed', by: BY, at: T0 } }],
  };
  const scope = scopeOf([
    [wallOf('south'), wallFace],
    [wallOf('east'), wallFace],
  ]);
  const priced = quote(sheetFor(box, scope).lines, book);

  const proposal = {
    ...proposalOf(
      'p1',
      'Back bedroom',
      { ...EMPTY_COMPANY, name: 'Gilbert Remodeling' },
      { ...NOBODY, name: 'M. Alvarez', address: '14 Sycamore' },
      [optionFrom('a', 'As scoped', 'Two walls.', priced)],
      T0,
      '2026-09-30'
    ),
    chosen: 'a',
  };
  const signature = await sign(proposal, {
    id: 's1',
    who: 'M. Alvarez',
    role: 'client',
    intent: CLIENT_INTENT,
    consented: true,
    mark: 'data:image/png;base64,iVBORw0KGgo=',
    at: T0,
    device: 'iPhone',
  });
  const baseline = await freeze(proposal, [signature], T0);

  const again = quote(sheetFor(box, scope).lines, book);
  assert.equal(changesSince(baseline, again).unchanged, true);
});

/* ================================================== priced end to end */

test('only what is picked reaches the money', () => {
  const book: PriceBook = {
    rates: [
      { item: 'Wall face', unit: 'sq ft', cents: 375n, source: { kind: 'typed', by: BY, at: T0 } },
      { item: 'Floor', unit: 'sq ft', cents: 950n, source: { kind: 'typed', by: BY, at: T0 } },
      { item: 'Baseboard', unit: 'lf', cents: 600n, source: { kind: 'typed', by: BY, at: T0 } },
    ],
  };

  const everythingPriced = quote(sheetFor(box, everything(box, ITEMS, BY, T0)).lines, book);
  // 480 x 3.75 = 1800, 200 x 9.50 = 1900, 60 x 6.00 = 360.
  assert.equal(everythingPriced.total, 180_000n + 190_000n + 36_000n);

  // Paint two walls, keep the floor and the base. Nothing else is on the quote
  // at all — not at zero, not as a line saying "not included".
  const someOfIt = quote(
    sheetFor(
      box,
      scopeOf([
        [wallOf('south'), wallFace],
        [wallOf('north'), wallFace],
      ])
    ).lines,
    book
  );
  assert.equal(someOfIt.lines.length, 1);
  assert.equal(someOfIt.total, 320n * 375n);
  assert.deepEqual([...someOfIt.unpriced], []);
});

test('an item with no rate against it is still named rather than silently dropped', () => {
  const scope = scopeOf([
    [wallOf('south'), wallFace],
    [wallOf('south'), baseboard],
  ]);
  const priced = quote(sheetFor(box, scope).lines, {
    rates: [{ item: 'Wall face', unit: 'sq ft', cents: 375n, source: { kind: 'typed', by: BY, at: T0 } }],
  });
  assert.deepEqual([...priced.unpriced], ['Baseboard']);
});

/* ================================================ arithmetic, by hand */

test('the wall face of every wall adds up to the wall face of the room', () => {
  const sheet = sheetFor(box, everything(box, ITEMS, BY, T0));
  const whole = Number(sheet.lines.find((l) => l.what === 'Wall face')!.quantity);

  const each = box.walls.map((wall) =>
    Number(
      sheetFor(box, scopeOf([[wallOf(wall.id), wallFace]])).lines.find((l) => l.what === 'Wall face')!
        .quantity
    )
  );
  assert.deepEqual(each, [160, 80, 160, 80]);
  assert.equal(each.reduce((a, b) => a + b, 0), whole);
  assert.equal(whole, (60 * Number(8n * NM_PER_FOOT)) / Number(NM_PER_FOOT));
});
