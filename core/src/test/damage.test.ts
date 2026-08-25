import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NM_PER_FOOT, parseLength } from '../length.ts';
import { scanned, verified } from '../measurement.ts';
import type { Heading, Opening, Room, Wall } from '../room.ts';
import {
  type Damage,
  type Patch,
  DamageError,
  FLOOD_CUTS,
  affectedPerMille,
  damageOnPlan,
  damageQuantity,
  damageRunOnPlan,
  damageTotals,
  drying,
  suggestedCut,
  validateDamage,
} from '../damage.ts';

/**
 * Where the damage is, and what it will take to put right.
 *
 * The point of doing this in a measuring app: **the room is already measured.**
 * A water line two feet up a nine foot wall is not a note, it is eighteen square
 * feet of board and nine feet of base, and nothing else in the field can produce
 * that because nothing else knows how long the wall is while somebody is
 * standing in front of it.
 */

const T0 = '2026-08-26T09:00:00Z';
const scan = (text: string) => scanned(parseLength(text), parseLength(`50mm`), T0, 'roomplan');

function w(id: string, heading: Heading, length: string, openings?: Opening[]): Wall {
  return { id, heading, length: scan(length), ...(openings ? { openings } : {}) };
}

const window9: Opening = {
  id: 'w1',
  kind: 'window',
  width: scan(`4'`),
  height: scan(`3'`),
  offsetFromStart: scan(`8'`),
  sillHeight: scan(`2' 6"`),
};

const door: Opening = {
  id: 'd1',
  kind: 'door',
  width: scan(`3'`),
  height: scan(`6' 8"`),
  offsetFromStart: scan(`2'`),
};

/** 20 x 10, 9 ft ceiling. Round numbers so every figure is checkable by hand. */
const room: Room = {
  id: 'r1',
  name: 'basement',
  walls: [
    w('south', 'east', `20'`, [window9]),
    w('east', 'north', `10'`, [door]),
    w('north', 'west', `20'`),
    w('west', 'south', `10'`),
  ],
  ceilingHeight: verified(parseLength(`9'`), 'sam', T0, 'tape'),
};

const base = {
  id: 'd-1',
  kind: 'water' as const,
  note: 'water line along the south wall',
  recordedAt: T0,
  recordedBy: 'gilbert',
  photos: [],
  readings: [],
};

/** A patch two feet up, nine feet wide, starting a foot from the corner. */
const waterline: Damage = {
  ...base,
  shape: {
    kind: 'patch',
    wallId: 'north',
    fromAlong: parseLength(`1'`),
    toAlong: parseLength(`10'`),
    fromHeight: 0n,
    toHeight: parseLength(`2'`),
  },
};

const FT2 = NM_PER_FOOT * NM_PER_FOOT;

/* ------------------------------------------------------------- the shapes */

test('a water line is square feet of board and feet of base, not a note', () => {
  // The whole reason this belongs in a measuring app. Nine feet wide, two feet
  // up: eighteen square feet, and nine feet of base because it reaches the floor.
  const q = damageQuantity(room, waterline);
  assert.equal(q.faceArea / FT2, 18n);
  assert.equal(q.baseboardRun, parseLength(`9'`));
  assert.match(q.workings, /9' along north/);
});

test('damage that stops above the floor takes no baseboard', () => {
  // A roof leak two feet down from the ceiling is not a base job, and charging
  // for one is the kind of line an adjuster refuses and then distrusts the rest.
  const roof: Damage = {
    ...base,
    id: 'd-2',
    note: 'staining below the ceiling',
    shape: {
      kind: 'patch',
      wallId: 'north',
      fromAlong: 0n,
      toAlong: parseLength(`10'`),
      fromHeight: parseLength(`7'`),
      toHeight: parseLength(`9'`),
    },
  };
  const q = damageQuantity(room, roof);
  assert.equal(q.faceArea / FT2, 20n);
  assert.equal(q.baseboardRun, 0n);
});

test('a pin has no area, and says so rather than reading as zero', () => {
  const pin: Damage = {
    ...base,
    id: 'd-3',
    kind: 'impact',
    note: 'hole punched through the board',
    shape: { kind: 'pin', at: { x: 0n, y: 0n }, wallId: 'north', height: parseLength(`3'`) },
  };
  const q = damageQuantity(room, pin);
  assert.equal(q.faceArea, 0n);
  assert.match(q.workings, /a pin is a marker and not a measurement/);
});

test('a whole wall takes its whole face, less every opening', () => {
  const gone: Damage = {
    ...base,
    id: 'd-4',
    kind: 'fire',
    note: 'wall burnt through',
    shape: { kind: 'surface', surface: 'wall', wallId: 'east' },
  };
  const q = damageQuantity(room, gone);
  // 10 x 9 is 90, less a 3 x 6'8" door which is 20.
  assert.equal(q.faceArea / FT2, 70n);
  // And the base runs the wall less the door.
  assert.equal(q.baseboardRun, parseLength(`7'`));
});

test('a ceiling that came down is the ceiling, and takes no base', () => {
  const ceiling: Damage = {
    ...base,
    id: 'd-5',
    note: 'ceiling collapsed',
    shape: { kind: 'surface', surface: 'ceiling' },
  };
  const q = damageQuantity(room, ceiling);
  assert.equal(q.flatArea, 2n * parseLength(`20'`) * parseLength(`10'`));
  assert.equal(q.baseboardRun, 0n);
  assert.equal(q.faceArea, 0n);
});

/* ---------------------------------------------------- the openings in the way */

test('a window inside the damaged area is not board and does not get charged for', () => {
  // The south wall's window sits 2'6" to 5'6" up, 8' to 12' along. Damage from
  // the floor to 4 feet across the whole wall overlaps it from 2'6" to 4'.
  const wide: Damage = {
    ...base,
    id: 'd-6',
    shape: {
      kind: 'patch',
      wallId: 'south',
      fromAlong: 0n,
      toAlong: parseLength(`20'`),
      fromHeight: 0n,
      toHeight: parseLength(`4'`),
    },
  };
  const q = damageQuantity(room, wide);
  // 20 x 4 = 80, less the 4 ft wide window's 1'6" that falls inside = 6 sq ft.
  assert.equal(q.faceArea / FT2, 74n);
  // A window leaves the base alone: the base runs underneath it.
  assert.equal(q.baseboardRun, parseLength(`20'`));
  assert.match(q.workings, /less the openings in it/);
});

test('a door in the damaged run takes its width off the base', () => {
  const acrossTheDoor: Damage = {
    ...base,
    id: 'd-7',
    shape: {
      kind: 'patch',
      wallId: 'east',
      fromAlong: 0n,
      toAlong: parseLength(`10'`),
      fromHeight: 0n,
      toHeight: parseLength(`2'`),
    },
  };
  const q = damageQuantity(room, acrossTheDoor);
  assert.equal(q.baseboardRun, parseLength(`7'`));
  // And the door's bottom two feet are not board either.
  assert.equal(q.faceArea / FT2, 20n - 6n);
});

/* -------------------------------------------------------------- the cut */

test('the cut is what was decided; the damage stays what was seen', () => {
  // Trade practice is to cut at a convenient height above the water line rather
  // than follow a ragged edge. That is the contractor's decision, and the
  // difference between seen and decided is the distinction this app is for.
  const cut: Damage = { ...waterline, cutTo: parseLength(`4'`) };
  const q = damageQuantity(room, cut);
  assert.equal(q.faceArea / FT2, 36n, 'a 4 ft cut across 9 ft is 36 sq ft');
  assert.equal(q.cut, true);
  assert.match(q.workings, /cut from 0" to 4'/);
  assert.match(q.workings, /the damage was seen to 2'/);

  // And with no cut set, what is charged is exactly what was seen.
  assert.equal(damageQuantity(room, waterline).cut, false);
});

test('a cut below the damage is refused — it would leave the damage in the wall', () => {
  assert.throws(
    () => damageQuantity(room, { ...waterline, cutTo: parseLength(`1'`) }),
    (error: unknown) => {
      assert.ok(error instanceof DamageError);
      assert.match(error.message, /leaves the damage in the wall/);
      return true;
    }
  );
});

test('the next standard cut is suggested and never applied', () => {
  assert.equal(suggestedCut(parseLength(`1' 6"`)), 2n * NM_PER_FOOT);
  assert.equal(suggestedCut(parseLength(`2' 6"`)), 4n * NM_PER_FOOT);
  assert.equal(suggestedCut(parseLength(`5'`)), undefined, 'nothing standard is above it');
  assert.deepEqual([...FLOOD_CUTS], [2n * NM_PER_FOOT, 4n * NM_PER_FOOT]);
  // Suggested, not applied: the damage itself is untouched.
  assert.equal(waterline.cutTo, undefined);
});

/* --------------------------------------------------------- what it refuses */

/** The water line, with one of its numbers moved. */
function moved(change: Partial<Patch>): Damage {
  return { ...waterline, shape: { ...(waterline.shape as Patch), ...change } };
}

test('damage that runs off the end of its wall is refused, with the arithmetic', () => {
  assert.throws(
    () => validateDamage(room, moved({ toAlong: parseLength(`30'`) })),
    (error: unknown) => {
      assert.ok(error instanceof DamageError);
      assert.match(error.message, /which is 20' long/);
      return true;
    }
  );
});

test('damage reaching above the wall is refused', () => {
  assert.throws(() => validateDamage(room, moved({ toHeight: parseLength(`12'`) })), DamageError);
});

test('a mark nobody described is refused', () => {
  // A mark on a plan with no note is a mark nobody can act on three days later.
  assert.throws(() => validateDamage(room, { ...waterline, note: '   ' }), DamageError);
});

test('a water category on a fire is refused', () => {
  assert.throws(
    () => validateDamage(room, { ...waterline, kind: 'fire', category: 2 }),
    (error: unknown) => {
      assert.ok(error instanceof DamageError);
      assert.match(error.message, /mean nothing about a fire/);
      return true;
    }
  );
});

test('nothing is damaged on a side of the room with no wall across it', () => {
  const garage: Room = {
    ...room,
    walls: room.walls.map((x) => (x.id === 'north' ? { ...x, open: true as const } : x)),
  };
  assert.throws(() => validateDamage(garage, waterline), DamageError);
});

/* ------------------------------------------------------------- the totals */

test('the whole room adds up, and the pins are counted rather than hidden', () => {
  const pin: Damage = {
    ...base,
    id: 'p1',
    kind: 'mould',
    note: 'growth behind the panel',
    shape: { kind: 'pin', at: { x: 0n, y: 0n } },
  };
  const totals = damageTotals(room, [waterline, pin]);
  assert.equal(totals.faceArea / FT2, 18n);
  assert.equal(totals.pins, 1);
  assert.equal(totals.each.length, 2);
  assert.equal(totals.anyCut, false);
});

test('overlapping areas are not merged, and that is on purpose', () => {
  // Two marked areas over the same stretch are two people's observations, not
  // one area counted twice. Silently merging them throws one away.
  const again: Damage = { ...waterline, id: 'd-again', note: 'checked again next day' };
  const totals = damageTotals(room, [waterline, again]);
  assert.equal(totals.faceArea / FT2, 36n);
  assert.equal(totals.each.length, 2, 'each one is reported separately so the sum is checkable');
});

test('how much of the room is affected, which is the figure an adjuster reaches for', () => {
  // The wall face is 20+10+20+10 = 60 ft at 9 ft = 540, less the window (12)
  // and the door (20) = 508 sq ft. 18 of that is 35 per mille.
  const share = affectedPerMille(room, [waterline]);
  assert.equal(share, (18n * 1000n) / 508n);
});

/* ------------------------------------------------------------- the drying */

test('two readings from two meters are never compared', () => {
  // Meters read on different scales and this app has never seen one. A curve
  // drawn across a scale change is a fabricated trend on a document somebody is
  // paid against.
  const mixed: Damage = {
    ...waterline,
    readings: [
      { at: '2026-08-26T09:00:00Z', value: 28, scale: '%MC', by: 'gilbert' },
      { at: '2026-08-27T09:00:00Z', value: 180, scale: 'points', by: 'gilbert' },
    ],
  };
  const d = drying(mixed);
  assert.equal(d.comparable, false);
  assert.equal(d.trend, 'not enough readings', 'a trend across two scales is not a trend');
});

test('a drying curve is the evidence, and it reads in the order it happened', () => {
  const dried: Damage = {
    ...waterline,
    readings: [
      { at: '2026-08-28T09:00:00Z', value: 14, scale: '%MC', by: 'gilbert' },
      { at: '2026-08-26T09:00:00Z', value: 28, scale: '%MC', by: 'gilbert' },
      { at: '2026-08-27T09:00:00Z', value: 20, scale: '%MC', by: 'gilbert' },
    ],
  };
  const d = drying(dried);
  assert.equal(d.comparable, true);
  assert.equal(d.trend, 'drying');
  assert.equal(d.first!.value, 28, 'sorted by when it was taken, not when it was typed');
  assert.equal(d.latest!.value, 14);
});

test('a room getting wetter says so', () => {
  const worse: Damage = {
    ...waterline,
    readings: [
      { at: '2026-08-26T09:00:00Z', value: 18, scale: '%MC', by: 'gilbert' },
      { at: '2026-08-27T09:00:00Z', value: 26, scale: '%MC', by: 'gilbert' },
    ],
  };
  assert.equal(drying(worse).trend, 'wetter');
  assert.equal(drying(waterline).trend, 'not enough readings');
});

test('each damage names itself by what it is and which wall it is on', () => {
  const totals = damageTotals(room, [waterline]);
  assert.equal(totals.each[0]!.what, 'water damage to north');
  assert.equal(totals.each[0]!.damageId, 'd-1', 'a quantity has to be traceable to its mark');
});

/* ---------------------------------------------------------- on the drawing */

test('a patch draws on the plan as the stretch of wall it covers, not a dot', () => {
  // What gets ordered and scheduled is how much wall comes out. A marker in the
  // middle of the wall would say something is wrong somewhere along it, which is
  // exactly the thing the room already knows better than.
  const run = damageRunOnPlan(room, waterline)!;
  // North runs from (20', 10') westward, so a foot in is x = 19'.
  assert.equal(run.from.x, parseLength(`19'`));
  assert.equal(run.from.y, parseLength(`10'`));
  assert.equal(run.to.x, parseLength(`10'`));
  assert.equal(run.to.y, parseLength(`10'`));
});

test('the stretch is the same whichever way round it was typed', () => {
  const backwards: Damage = {
    ...waterline,
    id: 'd-backwards',
    shape: { ...(waterline.shape as Patch), fromAlong: parseLength(`10'`), toAlong: parseLength(`1'`) },
  };
  assert.deepEqual(damageRunOnPlan(room, backwards), damageRunOnPlan(room, waterline));
});

test('a whole wall draws corner to corner', () => {
  const gone: Damage = {
    ...base,
    id: 'd-gone',
    shape: { kind: 'surface', surface: 'wall', wallId: 'north' },
  };
  const run = damageRunOnPlan(room, gone)!;
  assert.equal(run.from.x, parseLength(`20'`));
  assert.equal(run.to.x, 0n);
  assert.equal(run.from.y, parseLength(`10'`));
  assert.equal(run.to.y, parseLength(`10'`));
});

test('a pin and a floor get no stretch, because they have no length', () => {
  const pin: Damage = {
    ...base,
    id: 'd-pin',
    shape: { kind: 'pin', at: { x: parseLength(`4'`), y: parseLength(`5'`) } },
  };
  const floor: Damage = {
    ...base,
    id: 'd-floor',
    shape: { kind: 'surface', surface: 'floor' },
  };
  assert.equal(damageRunOnPlan(room, pin), undefined);
  assert.equal(damageRunOnPlan(room, floor), undefined);
  // The pin still has a point, because a point is what it is.
  assert.deepEqual(damageOnPlan(room, pin), { x: parseLength(`4'`), y: parseLength(`5'`) });
});
