import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NM_PER_FOOT, parseLength } from '../length.ts';
import { isVerified, scanned, toleranceOf, verified } from '../measurement.ts';
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
  type SpanFromPhone,
  type Surface,
  type WorkItem,
  type WorkScope,
  CEILING,
  KNOWN_WORK,
  WorkError,
  ceilingArea,
  describeScope,
  drop,
  everything,
  measuresOn,
  nothing,
  pick,
  rateFor,
  readSurface,
  partOn,
  picksOn,
  readPart,
  readSurfaceMeasure,
  surfaceKey,
  surfaceName,
  surfacesOf,
  validateItem,
  withPart,
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

/** A scope with the given items on the given surfaces, and nothing else. */
function scopeOf(pairs: readonly (readonly [Surface, WorkItem])[]): WorkScope {
  return pairs.reduce((scope, [surface, item]) => pick(scope, surface, item, BY, T0), nothing(BY, T0));
}

const sheetFor = (room: Room, scope: WorkScope, items: readonly WorkItem[] = ITEMS) =>
  takeoff(room, T0, { work: { scope, items } });

/**
 * The work sheet itself, before the takeoff copies it into its own line shape.
 *
 * `takeoff` widens a `WorkLine` into a `TakeoffLine`, which is the shape the
 * text and the CSV are written from and which carries no `parts` — a printed
 * sheet says whose figure a quantity is in the `workings` sentence, because
 * that is the half of it a person reads. Anything asserting on the structure
 * asks `workSheet` for it rather than reaching for a field the takeoff's own
 * type does not have.
 */
const workFor = (room: Room, scope: WorkScope, items: readonly WorkItem[] = ITEMS) =>
  workSheet(room, scope, items, 'scanned');

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

/* ============================================== the ceiling as a surface */

/**
 * Pointing the phone up at something and keeping the number.
 *
 * > "ON THE 3D MODEL I TOLD YOU THAT I DIDNT WANT THE CEILING BEING RENDERED
 * >  AND ITS GREAT, BUT WHAT IF I HAVE TO SCAN A CEILING OR POINT IT UP TO
 * >  SOMETHING SIMILAR, HOW WOULD THAT WORK?"
 *
 * The room here is the same 20 by 10 box, 8 ft high, so every figure below is
 * one somebody can do on paper: 200 sq ft of ceiling, and a soffit measured at
 * 356 mm is 356 million nanometres exactly and nothing else.
 */

const span = (over: Partial<SpanFromPhone> = {}): SpanFromPhone => ({
  id: 'span-1',
  surface: 'ceiling',
  what: 'the soffit over the sink',
  millimetres: '356',
  toleranceMillimetres: '15',
  at: T0,
  sensor: 'arkit',
  ...over,
});

test('a span pointed at the ceiling is kept against the ceiling, exactly', () => {
  const measure = readSurfaceMeasure(box, span());

  assert.equal(measure.surface, 'ceiling');
  assert.equal(measure.what, 'the soffit over the sink');
  // 356 mm, in whole nanometres. Not 0.356 of anything, and not a float that
  // prints as 356 and compares as 355.99999999999994.
  assert.equal(measure.length.value, 356_000_000n);
  assert.equal(typeof measure.length.value, 'bigint');
});

test('and it is the sensor’s number, never a tape reading', () => {
  const measure = readSurfaceMeasure(box, span());

  // The whole point of the distinction: a reading off a moving camera that
  // called itself verified would outrank an actual tape everywhere the two are
  // compared, and would be eligible to become the ceiling height — which
  // multiplies every square foot of board in the room.
  assert.equal(isVerified(measure.length), false);
  assert.equal(measure.length.provenance.kind, 'scanned');
  assert.equal(
    measure.length.provenance.kind === 'scanned' ? measure.length.provenance.sensor : '',
    'arkit'
  );
  assert.equal(toleranceOf(measure.length), 15_000_000n);
});

test('a span on a surface this room has not got is refused, not filed', () => {
  // The failure this prevents: it lands in the file, appears on no screen, and
  // is gone the next time somebody saves.
  assert.throws(
    () => readSurfaceMeasure(box, span({ surface: 'wall:kitchen-2' })),
    (error: unknown) => error instanceof WorkError && /has no such surface/.test(String(error))
  );
});

test('a span that does not say what was measured is refused', () => {
  assert.throws(
    () => readSurfaceMeasure(box, span({ what: '   ' })),
    (error: unknown) => error instanceof WorkError && /what was measured/.test(String(error))
  );
});

test('a span claiming to be exact is refused, because a camera is not a tape', () => {
  assert.throws(
    () => readSurfaceMeasure(box, span({ toleranceMillimetres: '0' })),
    (error: unknown) => error instanceof WorkError && /band/.test(String(error))
  );
});

test('a length that is not whole millimetres never becomes a measurement', () => {
  // A float that reached this far would be a float in a measurement of a
  // building, which is the one thing this app does not do anywhere.
  for (const bad of ['0.356', '356.0', '-356', '', 'three fifty six']) {
    assert.throws(
      () => readSurfaceMeasure(box, span({ millimetres: bad })),
      (error: unknown) => error instanceof WorkError,
      `"${bad}" was accepted as a length`
    );
  }
  assert.throws(
    () => readSurfaceMeasure(box, span({ millimetres: '0' })),
    (error: unknown) => error instanceof WorkError && /nothing long/.test(String(error))
  );
});

test('spans come back on the surface they were taken on, oldest first', () => {
  const soffit = readSurfaceMeasure(box, span({ id: 'b', at: '2026-08-27T11:00:00Z' }));
  const beam = readSurfaceMeasure(box, span({ id: 'a', at: '2026-08-27T09:30:00Z', what: 'the beam' }));
  const onAWall = readSurfaceMeasure(
    box,
    span({ id: 'c', surface: 'wall:south', what: 'the header' })
  );
  const all = [soffit, beam, onAWall];

  assert.deepEqual(measuresOn(all, CEILING).map((m) => m.id), ['a', 'b']);
  assert.deepEqual(measuresOn(all, wallOf('south')).map((m) => m.id), ['c']);
  assert.deepEqual(measuresOn(all, FLOOR).map((m) => m.id), []);
});

test('the ceiling panel’s area is the takeoff’s ceiling line, not a second sum', () => {
  // 20 ft by 10 ft. Two hundred square feet, worked out here on paper.
  assert.equal(ceilingArea(box), '200.0');

  const sheet = sheetFor(box, everything(box, ITEMS, BY, T0));
  const line = sheet.lines.find((l) => l.what === 'Ceiling');
  assert.ok(line, 'the ceiling is on the sheet');
  assert.equal(line.quantity, ceilingArea(box));
  assert.equal(line.unit, 'sq ft');
});

test('measuring the ceiling moves nothing on the sheet', () => {
  // The property Sam asked to be proved: adding a ceiling panel must not change
  // any quantity the app produces for a room nobody has scoped. Spans are not
  // an input to the sheet at all, and this is the test that says so — the whole
  // full-replacement takeoff, line for line, computed by hand.
  //
  // 20 by 10, 8 ft up: floor and ceiling 200 sq ft each, four walls 60 lf of
  // run at 8 ft is 480 sq ft of face, and 60 lf of base.
  const before = sheetFor(box, everything(box, ITEMS, BY, T0));
  readSurfaceMeasure(box, span());
  readSurfaceMeasure(box, span({ id: 'span-2', what: 'the beam', millimetres: '2440' }));
  const after = sheetFor(box, everything(box, ITEMS, BY, T0));

  assert.deepEqual(
    after.lines.map((l) => `${l.what} ${l.quantity} ${l.unit}`),
    ['Floor 200.0 sq ft', 'Ceiling 200.0 sq ft', 'Wall face 480.0 sq ft', 'Baseboard 60.00 lf']
  );
  assert.deepEqual(after.lines.map((l) => l.quantity), before.lines.map((l) => l.quantity));
});

test('the ceiling is a surface of every room, and it is the same one every time', () => {
  assert.equal(surfaceKey(CEILING), 'ceiling');
  assert.deepEqual(readSurface('ceiling'), CEILING);
  assert.ok(surfacesOf(box).some((s) => surfaceKey(s) === surfaceKey(CEILING)));
  assert.equal(surfaceName(CEILING), 'the ceiling');
});

/* ============================================== how much of a surface */

/**
 * Saying how much of a wall is being done, rather than all of it or none.
 *
 * > "I LOVE THE OPTION TO SELECT WHAT IS BEING DONE ON THE WALL, BUT SHOULD
 * >  ALSO BE ABLE TO PUT IN HOW MUCH OF THAT WALL NEEDS REPLACING (GET TO
 * >  CHOOSE THE EACHES)"
 *
 * Every figure below is worked out by hand off the room at the top of this
 * file, and never asked of the thing being tested. The room is 20 ft by 10 ft
 * and 8 ft to the ceiling, so a long wall is 160 sq ft of face and 20 lf of
 * base, and a short one is 80 sq ft and 10 lf.
 *
 * The failure these exist for is a sheet that adds up perfectly and is for the
 * wrong amount of work — the one a test that asks the sheet for its own numbers
 * cannot see.
 */

/** The scope, with a figure typed against one item on one surface. */
function partOf(
  scope: WorkScope,
  surface: Surface,
  item: WorkItem,
  text: string,
  room: Room = box
): WorkScope {
  return pick(scope, surface, withPart(item, readPart(room, surface, item, text, BY, T0)), BY, T0);
}

const RATES: PriceBook = {
  rates: [
    { item: 'Wall face', unit: 'sq ft', cents: 375n, source: { kind: 'typed', by: BY, at: T0 } },
    { item: 'Baseboard', unit: 'lf', cents: 600n, source: { kind: 'typed', by: BY, at: T0 } },
    { item: 'Doors', unit: 'ea', cents: 24000n, source: { kind: 'typed', by: BY, at: T0 } },
  ],
};

test('a part of a wall is priced as the part, and the rest of the sheet does not move', () => {
  // South and north boarded — 160 sq ft each, 320 together — and 20 lf of base
  // put back on the north wall. Then only 30 sq ft of the south wall is being
  // boarded rather than all 160, so the face line is 30 + 160 = 190.
  const all = scopeOf([
    [wallOf('south'), wallFace],
    [wallOf('north'), wallFace],
    [wallOf('north'), baseboard],
  ]);
  const some = partOf(all, wallOf('south'), wallFace, '30');

  const before = sheetFor(box, all);
  const after = sheetFor(box, some);

  assert.equal(before.lines.find((l) => l.what === 'Wall face')!.quantity, '320.0');
  assert.equal(after.lines.find((l) => l.what === 'Wall face')!.quantity, '190.0');

  // 320 sq ft at $3.75 is $1,200.00; 190 at $3.75 is $712.50. 20 lf of base at
  // $6.00 is $120.00 on both, because nobody said anything about the base.
  const money = (sheet: typeof before, what: string) =>
    quote(sheet.lines.map((l) => ({ ...l })), RATES).lines.find((l) => l.item === what)!.total;

  assert.equal(money(before, 'Wall face'), 120000n);
  assert.equal(money(after, 'Wall face'), 71250n);
  assert.equal(money(before, 'Baseboard'), 12000n, '20 lf at $6.00');
  assert.equal(
    money(after, 'Baseboard'),
    12000n,
    'the untouched line is the same to the cent'
  );

  // And the money came down by exactly the 130 sq ft that came off: 130 at
  // $3.75 is $487.50.
  assert.equal(money(before, 'Wall face') - money(after, 'Wall face'), 48750n);
});

test('the measured figure is kept beside the typed one, on the line and in the workings', () => {
  const scope = partOf(scopeOf([[wallOf('south'), wallFace]]), wallOf('south'), wallFace, '30');
  const line = workFor(box, scope).lines.find((l) => l.what === 'Wall face')!;

  assert.equal(line.quantity, '30.0');
  assert.equal(line.parts.length, 1);
  assert.equal(line.parts[0]!.surface, 'south');
  assert.equal(line.parts[0]!.typed, '30.0');
  assert.equal(line.parts[0]!.measured, '160.0', 'what the room measures is never replaced');
  assert.equal(line.parts[0]!.by, BY);
  assert.match(line.workings, /Your own figure, not a measurement: south 30\.0 of 160\.0 sq ft/);
});

test('a line carrying a figure somebody typed is never measured, whatever tape is on it', () => {
  // One wall each way taped, which is what makes a room read as measured.
  let measured = verifyWall(box, 'south', parseLength(`20'`), BY, T0, 'tape').room;
  measured = verifyWall(measured, 'east', parseLength(`10'`), BY, T0, 'tape').room;

  const whole = scopeOf([[wallOf('south'), wallFace]]);
  assert.equal(
    sheetFor(measured, whole).lines.find((l) => l.what === 'Wall face')!.provenance,
    'measured'
  );

  const part = partOf(whole, wallOf('south'), wallFace, '30', measured);
  const line = sheetFor(measured, part).lines.find((l) => l.what === 'Wall face')!;
  assert.equal(line.provenance, 'scanned', 'a figure he typed cannot pass for one a tape gave');
  assert.equal(
    quote(sheetFor(measured, part).lines.map((l) => ({ ...l })), RATES).measured,
    false,
    'and the quote it is on cannot call itself measured either'
  );
});

test('the eaches can be chosen: one door of the two in a wall', () => {
  const twoDoors: Room = {
    ...box,
    walls: box.walls.map((wall) =>
      wall.id === 'south'
        ? {
            ...wall,
            openings: [
              opening('d1', 'door', `3'`, `6'8"`, `2'`),
              opening('d2', 'door', `3'`, `6'8"`, `12'`),
            ],
          }
        : wall
    ),
  };

  const both = scopeOf([[wallOf('south'), doorsItem]]);
  assert.equal(sheetFor(twoDoors, both).lines.find((l) => l.what === 'Doors')!.quantity, '2');

  const one = partOf(both, wallOf('south'), doorsItem, '1', twoDoors);
  const line = workFor(twoDoors, one).lines.find((l) => l.what === 'Doors')!;
  assert.equal(line.quantity, '1', 'one of them, and it prints as a count and not as 1.00');
  assert.equal(line.parts[0]!.measured, '2');

  // $240.00 a door: two is $480.00 and one is $240.00.
  const money = (scope: WorkScope) =>
    quote(sheetFor(twoDoors, scope).lines.map((l) => ({ ...l })), RATES).lines
      .find((l) => l.item === 'Doors')!.total;
  assert.equal(money(both), 48000n);
  assert.equal(money(one), 24000n);
});

test('a part bigger than the thing it is part of is refused, with both figures in the sentence', () => {
  // The south wall carries 20 lf of base. Twelve is a part of it; twenty-five
  // is not a part of anything.
  assert.ok(readPart(box, wallOf('south'), baseboard, '12', BY, T0));
  assert.throws(
    () => readPart(box, wallOf('south'), baseboard, '25', BY, T0),
    (error: unknown) =>
      error instanceof WorkError &&
      /south has 20\.00 lf of baseboard on it, and you have said 25 lf/.test(String(error)) &&
      /cannot be bigger than the thing it is part of/.test(String(error))
  );
});

test('a part is refused rather than clamped, so nothing quietly becomes the whole', () => {
  // The failure this is against: a silent clamp. Somebody types 25 on a 20 ft
  // run, the app prices 20, and he believes he priced 25 until the invoice.
  let refused = false;
  try {
    readPart(box, wallOf('south'), baseboard, '25', BY, T0);
  } catch {
    refused = true;
  }
  assert.equal(refused, true);

  // Nothing was recorded, so the sheet is still the whole run.
  const scope = scopeOf([[wallOf('south'), baseboard]]);
  assert.equal(sheetFor(box, scope).lines.find((l) => l.what === 'Baseboard')!.quantity, '20.00');
});

test('a part that is not a number, or is none of it, is refused in words', () => {
  assert.throws(
    () => readPart(box, wallOf('south'), wallFace, 'half', BY, T0),
    (error: unknown) => error instanceof WorkError && /is not an amount of wall face/.test(String(error))
  );
  assert.throws(
    () => readPart(box, wallOf('south'), wallFace, '30.555', BY, T0),
    (error: unknown) => error instanceof WorkError && /decimal to two places/.test(String(error))
  );
  assert.throws(
    () => readPart(box, wallOf('south'), wallFace, '0', BY, T0),
    (error: unknown) =>
      error instanceof WorkError && /Take the tick off instead/.test(String(error))
  );
  assert.throws(
    () => readPart(box, wallOf('south'), doorsItem, '1', BY, T0),
    (error: unknown) =>
      error instanceof WorkError &&
      /south has no doors on it, so there is no part of it to do/.test(String(error))
  );
});

test('a figure that is exactly what the surface measures is not a part at all', () => {
  // The same rule `applyOverrides` keeps: a number that says exactly what the
  // room says is not somebody changing anything, and marking it as his figure
  // would put a note on a sheet about a number nobody moved.
  assert.equal(readPart(box, wallOf('south'), wallFace, '160', BY, T0), null);

  const scope = partOf(scopeOf([[wallOf('south'), wallFace]]), wallOf('south'), wallFace, '160');
  assert.equal(partOn(scope, wallOf('south'), wallFace), undefined);
  const line = workFor(box, scope).lines.find((l) => l.what === 'Wall face')!;
  assert.equal(line.quantity, '160.0');
  assert.equal(line.parts.length, 0);
  assert.equal(line.provenance, 'scanned', 'unchanged: nobody has taped this room');
  assert.doesNotMatch(line.workings, /Your own figure/);
});

test('picking twice adds once, and picking again with a different figure changes it', () => {
  const once = scopeOf([[wallOf('south'), wallFace]]);
  assert.equal(pick(once, wallOf('south'), wallFace, BY, T0), once, 'the same scope, untouched');

  const thirty = partOf(once, wallOf('south'), wallFace, '30');
  assert.equal(picksOnCount(thirty), 1, 'still one pick, not two');
  assert.equal(partOn(thirty, wallOf('south'), wallFace)!.hundredths, 3000n);

  const again = partOf(thirty, wallOf('south'), wallFace, '30');
  assert.equal(again, thirty, 'saying the same figure twice is not a change');

  const forty = partOf(thirty, wallOf('south'), wallFace, '40.5');
  assert.equal(picksOnCount(forty), 1);
  assert.equal(partOn(forty, wallOf('south'), wallFace)!.hundredths, 4050n);
  assert.equal(sheetFor(box, forty).lines.find((l) => l.what === 'Wall face')!.quantity, '40.5');

  // And taking the figure off puts it back to the whole of it.
  const whole = pick(forty, wallOf('south'), withPart(wallFace, null), BY, T0);
  assert.equal(partOn(whole, wallOf('south'), wallFace), undefined);
  assert.equal(sheetFor(box, whole).lines.find((l) => l.what === 'Wall face')!.quantity, '160.0');
});

function picksOnCount(scope: WorkScope): number {
  return picksOn(scope, wallOf('south')).length;
}

test('an untouched line is priced as the whole, exactly as it was before parts existed', () => {
  // Nothing about a room nobody has typed a figure into may change. The proof
  // is character for character, both sheets, both shapes.
  const scope = everything(box, ITEMS, BY, T0);
  const sheet = sheetFor(box, scope);
  assert.equal(sheet.text, takeoff(box, T0, { work: { scope, items: ITEMS } }).text);
  assert.ok(
    workFor(box, scope).lines.every((l) => l.parts.length === 0),
    'no line claims a typed figure'
  );
  assert.equal(sheet.lines.find((l) => l.what === 'Wall face')!.quantity, '480.0');
  assert.equal(sheet.lines.find((l) => l.what === 'Baseboard')!.quantity, '60.00');
});

test('a figure typed against one wall leaves every other wall on that line measured to the inch', () => {
  // Two walls on one line: 160 sq ft measured on the north, 30 typed on the
  // south. The sum has to be the exact 160 plus the exact 30 — not the printed
  // 160.0 rounded and added, which is how a tenth goes missing.
  const scope = partOf(
    scopeOf([
      [wallOf('south'), wallFace],
      [wallOf('north'), wallFace],
    ]),
    wallOf('south'),
    wallFace,
    '30.25'
  );
  const line = workFor(box, scope).lines.find((l) => l.what === 'Wall face')!;
  assert.equal(line.quantity, '190.3', '160 + 30.25, rounded once at the end');
  assert.equal(line.exact.kind, 'area');
  if (line.exact.kind === 'area') {
    const sqFt = NM_PER_FOOT * NM_PER_FOOT;
    assert.equal(line.exact.halfSquares, 2n * (160n * sqFt) + 2n * ((3025n * sqFt) / 100n));
  }
});

test('a figure that no longer fits the room is named, not thrown and not clamped', () => {
  // A part is refused at the panel, so the only way one can outgrow its wall is
  // the room changing under a decision somebody already made.
  const scope = partOf(
    scopeOf([
      [wallOf('south'), wallFace],
      [wallOf('north'), wallFace],
    ]),
    wallOf('south'),
    wallFace,
    '100'
  );

  // The south wall is re-measured at 8 ft: 64 sq ft of face, and the 100 he
  // typed is no longer a part of it.
  const shrunk = verifyWall(box, 'south', parseLength(`8'`), BY, T0, 'tape').room;
  const sheet = workFor(shrunk, scope);

  const line = sheet.lines.find((l) => l.what === 'Wall face')!;
  assert.deepEqual([...line.from], ['north'], 'the wall it stopped applying to drops off');
  assert.equal(line.parts.length, 0);
  // Through `stranded` and not `measuresNothing`: there IS wall face on south,
  // just not the hundred square feet of it he picked. The sheet says which
  // figure stopped applying rather than letting the quote move in silence.
  assert.equal(sheet.measuresNothing.length, 0);
  assert.equal(sheet.stranded.length, 1);
  assert.match(
    sheet.stranded[0]!,
    /^Wall face on south — you said 100 sq ft and it measures 64\.0 sq ft now$/
  );
  assert.match(
    takeoff(shrunk, T0, { work: { scope, items: ITEMS } }).text,
    /Picked on part of the room that is no longer there[^]*?you said 100 sq ft/
  );
});

test('a typed figure survives being saved and read back, exactly', () => {
  const scope = partOf(scopeOf([[wallOf('south'), wallFace]]), wallOf('south'), wallFace, '30.25');
  const saved = saveProject({
    savedAt: T0,
    fileName: 'Back bedroom',
    room: box,
    extras: { report: { sourceVersion: '1' }, scope },
  });

  // On the way out it is an exact integer of hundredths, tagged, never a float.
  assert.match(saved, /"hundredths":\{"\$nm":"3025"\}/);

  const back = (loadProject(saved).extras as { scope: WorkScope }).scope;
  assert.equal(partOn(back, wallOf('south'), wallFace)!.hundredths, 3025n);
  assert.equal(partOn(back, wallOf('south'), wallFace)!.by, BY);
  assert.equal(sheetFor(box, back).lines.find((l) => l.what === 'Wall face')!.quantity, '30.3');
});
