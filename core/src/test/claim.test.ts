import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength } from '../length.ts';
import { scanned, verified, verify } from '../measurement.ts';
import type { Heading, Room, Wall } from '../room.ts';
import type { Damage } from '../damage.ts';
import { type Claim, NO_CLAIM, claimReport, missingFromClaim, overlappingDamage } from '../claim.ts';
import { showArea, showLength } from '../company.ts';

/**
 * The claim: whose loss it is, what happened, and who is paying.
 *
 * Kept apart from the room and from the damage on purpose. A room is a
 * measurement of a building, a damage is an observation about part of it, and a
 * claim is an administrative fact about who is arguing over it — and the whole
 * value of the file a year later is that those three never contaminated each
 * other.
 */

const T0 = '2026-08-26T09:00:00Z';
const scan = (text: string) => scanned(parseLength(text), parseLength(`50mm`), T0, 'roomplan');

function w(id: string, heading: Heading, length: string): Wall {
  return { id, heading, length: scan(length) };
}

const room: Room = {
  id: 'r1',
  name: 'basement',
  walls: [
    w('south', 'east', `20'`),
    w('east', 'north', `10'`),
    w('north', 'west', `20'`),
    w('west', 'south', `10'`),
  ],
  ceilingHeight: verified(parseLength(`9'`), 'sam', T0, 'tape'),
};

const waterline: Damage = {
  id: 'd-1',
  kind: 'water',
  note: 'water line along the north wall',
  recordedAt: T0,
  recordedBy: 'gilbert',
  photos: ['photo-12', 'photo-13'],
  readings: [
    { at: '2026-08-26T09:00:00Z', value: 28, scale: '%MC', by: 'gilbert' },
    { at: '2026-08-28T09:00:00Z', value: 14, scale: '%MC', by: 'gilbert' },
  ],
  category: 2,
  shape: {
    kind: 'patch',
    wallId: 'north',
    fromAlong: parseLength(`1'`),
    toAlong: parseLength(`10'`),
    fromHeight: 0n,
    toHeight: parseLength(`2'`),
  },
};

const full: Claim = {
  on: true,
  claimNumber: 'OH-2026-44817',
  dateOfLoss: '2026-08-24',
  foundOn: '2026-08-25',
  cause: 'burst pipe',
  carrier: { name: 'Westfield' },
  adjuster: { name: 'D. Reyes', phone: '(216) 555-0199' },
  owner: { name: 'M. Hollis' },
  address: '414 Larchmere, Cleveland OH',
};

/* -------------------------------------------------------------- the switch */

test('with insurance mode off, nothing about a claim exists or is asked for', () => {
  assert.deepEqual(missingFromClaim(NO_CLAIM), []);
  assert.equal(NO_CLAIM.on, false);
});

test('what is missing is named, not enforced', () => {
  // A contractor standing in a flooded basement must be able to mark damage
  // immediately and do the paperwork from the truck. Refusing to record
  // anything until a claim number is typed loses the observation, which is the
  // part that cannot be recovered later.
  const bare: Claim = { on: true };
  const missing = missingFromClaim(bare);
  assert.ok(missing.includes('the claim number'));
  assert.ok(missing.includes('the date of loss'));
  assert.ok(missing.includes('the adjuster'));
  assert.deepEqual(missingFromClaim(full), []);

  // And it is still possible to produce the report without them.
  const report = claimReport(room, [waterline], bare, '26 Aug 2026');
  assert.equal(report.damages.length, 1);
  assert.ok(report.missing.length > 0, 'the document says what it is short of');
});

/* ------------------------------------------------------------ the document */

test('the claim reads in the order an adjuster reads it, with nothing empty printed', () => {
  const report = claimReport(room, [waterline], full, '26 Aug 2026');
  assert.deepEqual(
    report.about.map((line) => line.label),
    ['Claim number', 'Date of loss', 'Found on', 'Cause of loss', 'Property', 'Owner', 'Carrier', 'Adjuster']
  );
  assert.equal(report.about.find((l) => l.label === 'Adjuster')!.value, 'D. Reyes — (216) 555-0199');

  // A carrier with no phone prints its name and no dangling dash.
  assert.equal(report.about.find((l) => l.label === 'Carrier')!.value, 'Westfield');
});

test('every damage carries its own quantity, its workings and its photographs', () => {
  const report = claimReport(room, [waterline], full, '26 Aug 2026');
  const [only] = report.damages;
  assert.match(only!.headline, /water damage to north/);
  assert.match(only!.headline, /Category 2/, 'the adjuster wants the category');
  assert.match(only!.summary, /18\.0 sq ft of wall face/);
  assert.match(only!.summary, /9' of baseboard/);
  assert.match(only!.workings, /9' along north/);
  assert.deepEqual(only!.photos, ['photo-12', 'photo-13']);
});

test('the drying curve is on the document, because it is the evidence', () => {
  const report = claimReport(room, [waterline], full, '26 Aug 2026');
  assert.match(report.damages[0]!.dryingNote, /Drying: 28 down to 14 %MC/);
  assert.equal(report.damages[0]!.readings.length, 2);
  assert.equal(report.damages[0]!.readings[0]!.label, '2026-08-26');
});

test('readings on two different scales are listed, never drawn as a curve', () => {
  const mixed: Damage = {
    ...waterline,
    readings: [
      { at: '2026-08-26T09:00:00Z', value: 28, scale: '%MC', by: 'g' },
      { at: '2026-08-28T09:00:00Z', value: 180, scale: 'points', by: 'g' },
    ],
  };
  const report = claimReport(room, [mixed], full, '26 Aug 2026');
  assert.match(report.damages[0]!.dryingNote, /different scales/);
  assert.doesNotMatch(report.damages[0]!.dryingNote, /Drying/);
});

test('how much of the room is affected, as the share an adjuster asks for', () => {
  const report = claimReport(room, [waterline], full, '26 Aug 2026');
  const line = report.totals.find((l) => l.label === 'Wall face affected')!;
  // 60 ft of wall at 9 ft is 540 sq ft; 18 of it is 3.3%.
  assert.match(line.value, /18\.0 sq ft of 540\.0 sq ft/);
  assert.match(line.value, /3\.3%/);
});

test('pins are counted on the document and never given an area', () => {
  const pin: Damage = {
    ...waterline,
    id: 'p1',
    shape: { kind: 'pin', at: { x: 0n, y: 0n }, wallId: 'south' },
    readings: [],
  };
  const report = claimReport(room, [waterline, pin], full, '26 Aug 2026');
  const line = report.totals.find((l) => l.label === 'Marked points')!;
  assert.match(line.value, /1 —/);
  assert.match(line.value, /a marker rather than a measurement/);
});

test('a decided cut height is declared on the document, not buried in a number', () => {
  const cut: Damage = { ...waterline, cutTo: parseLength(`4'`) };
  const report = claimReport(room, [cut], full, '26 Aug 2026');
  assert.ok(report.totals.some((l) => l.label === 'Cut heights'));
  assert.match(report.damages[0]!.workings, /cut from 0" to 4'/);
});

/* -------------------------------------------------------------- the caveat */

test('a claim resting on an unchecked scan says so, in the loudest words on the page', () => {
  // This is the one document that leaves the building. It is the last chance to
  // be honest about where the numbers came from.
  const report = claimReport(room, [waterline], full, '26 Aug 2026');
  assert.match(report.caveat, /THESE ARE A SCANNER/);
  assert.match(report.caveat, /will move when one does/);
});

test('once the room is taped the claim stops apologising', () => {
  const measured: Room = {
    ...room,
    walls: room.walls.map((wall) => ({
      ...wall,
      length: verify(wall.length, wall.length.value, 'sam', T0, 'tape'),
    })),
  };
  const report = claimReport(measured, [waterline], full, '26 Aug 2026');
  assert.match(report.caveat, /has had a tape on it/);
  assert.doesNotMatch(report.caveat, /SCANNER/);
});

/* ---------------------------------------------------------- double counting */

test('two marks over the same stretch are named, so nobody adds them twice by accident', () => {
  // They are deliberately not merged — two marks are two observations, and
  // merging throws one away — but a total that quietly double-counts is exactly
  // what loses an argument with an adjuster.
  const again: Damage = { ...waterline, id: 'd-2', note: 'checked again the next day' };
  assert.deepEqual(overlappingDamage([waterline, again]), [{ a: 'd-1', b: 'd-2' }]);
});

test('marks on the same wall that do not touch are not flagged', () => {
  const elsewhere: Damage = {
    ...waterline,
    id: 'd-3',
    shape: {
      kind: 'patch',
      wallId: 'north',
      fromAlong: parseLength(`14'`),
      toAlong: parseLength(`18'`),
      fromHeight: 0n,
      toHeight: parseLength(`2'`),
    },
  };
  assert.deepEqual(overlappingDamage([waterline, elsewhere]), []);
});

test('marks at different heights on the same stretch do not overlap', () => {
  const above: Damage = {
    ...waterline,
    id: 'd-4',
    shape: {
      kind: 'patch',
      wallId: 'north',
      fromAlong: parseLength(`1'`),
      toAlong: parseLength(`10'`),
      fromHeight: parseLength(`6'`),
      toHeight: parseLength(`8'`),
    },
  };
  assert.deepEqual(overlappingDamage([waterline, above]), []);
});

test('the document reads in whatever the contractor reads in', () => {
  const report = claimReport(room, [waterline], full, '26 Aug 2026', {
    len: (v) => showLength(v, 'metric'),
    area: (a) => showArea(a, 'metric'),
  });
  // The same integers. Only the sentence changes: nothing here is ever read
  // back into the model, so a units preference can never become a rounding.
  assert.match(report.damages[0]!.summary, /1\.7 m² of wall face/);
  assert.match(report.damages[0]!.summary, /2743 mm of baseboard/);
  assert.match(
    report.totals.find((l) => l.label === 'Wall face affected')!.value,
    /1\.7 m² of 50\.2 m² — 3\.3%/
  );
  assert.equal(report.room.find((l) => l.label === 'Ceiling height')!.value, '2743 mm');
});

/* ------------------------------------------------------------ and the money */

const BOOK = {
  rates: [
    { item: 'Remove wall board', unit: 'sq ft' as const, cents: 250n, source: { kind: 'typed' as const, by: 'sam', at: T0 } },
    { item: 'Remove baseboard', unit: 'lf' as const, cents: 120n, source: { kind: 'typed' as const, by: 'sam', at: T0 } },
    { item: 'Hang wall board', unit: 'sq ft' as const, cents: 420n, source: { kind: 'typed' as const, by: 'sam', at: T0 } },
    { item: 'Tape and finish', unit: 'sq ft' as const, cents: 230n, source: { kind: 'typed' as const, by: 'sam', at: T0 } },
    { item: 'Replace baseboard', unit: 'lf' as const, cents: 675n, source: { kind: 'typed' as const, by: 'sam', at: T0 } },
    { item: 'Prime and paint the wall', unit: 'sq ft' as const, cents: 145n, source: { kind: 'typed' as const, by: 'sam', at: T0 } },
    // Priced deliberately, and priced high, so the test below has teeth. A book
    // with no floor rate in it would put a floor line in `unpriced` rather than
    // in the money, and "no floor appears" would pass for the wrong reason.
    { item: 'Remove floor finish', unit: 'sq ft' as const, cents: 175n, source: { kind: 'typed' as const, by: 'sam', at: T0 } },
    { item: 'Replace floor finish', unit: 'sq ft' as const, cents: 850n, source: { kind: 'typed' as const, by: 'sam', at: T0 } },
    { item: 'Remove ceiling finish', unit: 'sq ft' as const, cents: 180n, source: { kind: 'typed' as const, by: 'sam', at: T0 } },
    { item: 'Replace ceiling finish', unit: 'sq ft' as const, cents: 560n, source: { kind: 'typed' as const, by: 'sam', at: T0 } },
  ],
};

test('the marked damage is priced on the report, mark by mark', () => {
  // > "IT DOESNT AUTOMATICALLY PRICE OUT THE DAMAGE BUT INSTEAD IF YOU GO TO
  // >  THE PRICING IS SHOW YOU THE ENTIRE ROOM AND THE FLOOR AND CEILING WHICH
  // >  ARE NOT CHECK FOR BEING NEEDED"
  //
  // 9' x 2' on the north wall of an unopened 20 x 10 room with a 9 ft ceiling:
  //   remove board 18.0 x $2.50 = $45.00, remove base 9.00 x $1.20 = $10.80,
  //   hang board 18.0 x $4.20 = $75.60, tape 18.0 x $2.30 = $41.40,
  //   replace base 9.00 x $6.75 = $60.75, paint 180.0 x $1.45 = $261.00.
  //   $494.55.
  const report = claimReport(room, [waterline], full, '26 Aug 2026', undefined, BOOK);
  assert.ok(report.money);
  assert.equal(report.money!.priced, true);
  assert.deepEqual(
    report.money!.totals,
    [
      { label: 'The damage, priced', value: '$494.55' },
      { label: 'Total', value: '$494.55' },
    ]
  );
  // Beside the mark, because "what is the loss worth" and "what is THIS wall
  // worth" are different questions and only the second one gets argued about.
  assert.equal(report.damages[0]!.cost, '$494.55');

  // Every line carries the quantity and the rate it was multiplied by, so the
  // arithmetic can be checked without asking anybody for a breakdown.
  const board = report.money!.lines.find((l) => l.item === 'Remove wall board')!;
  assert.equal(board.quantity, '18.0 sq ft');
  assert.equal(board.rate, '$2.50 / sq ft');
  assert.equal(board.amount, '$45.00');
  assert.equal(board.stage, 'tear out');
  assert.equal(board.damageId, 'd-1');
});

test('nothing on the money comes off a surface nobody marked', () => {
  // This is the whole complaint. The remodel takeoff prices the room, floor and
  // ceiling included; the claim prices the marks. One damaged wall must not
  // produce a floor.
  const report = claimReport(room, [waterline], full, '26 Aug 2026', undefined, BOOK);
  const items = report.money!.lines.map((l) => l.item);
  assert.ok(!items.some((i) => /floor|ceiling/i.test(i)), items.join(', '));
  // And the only wall it paints is the one that was marked: 180 sq ft, which is
  // the north wall, and not the room's 540 sq ft of wall face.
  assert.equal(
    report.money!.lines.find((l) => l.item === 'Prime and paint the wall')!.quantity,
    '180.0 sq ft'
  );
});

test('with no rate book the report is exactly what it always was', () => {
  // Every caller that has no book — a test, a tool, a renderer that only wants
  // the measurements — gets the report it got before any of this existed.
  const report = claimReport(room, [waterline], full, '26 Aug 2026');
  assert.equal(report.money!.priced, false);
  assert.equal(report.damages[0]!.cost, '');
  assert.ok(report.money!.unpriced.includes('Remove wall board'));
});

test('a claim with nothing but a pin on it has no money at all', () => {
  // A pin is a marker rather than a measurement, so it makes no work — and a
  // mark with no work must not carry a confident $0.00.
  const pin: Damage = {
    ...waterline,
    id: 'd-pin',
    photos: [],
    readings: [],
    shape: { kind: 'pin', wallId: 'north', at: { x: parseLength(`3'`), y: 0n }, height: parseLength(`4'`) },
  };
  const report = claimReport(room, [pin], full, '26 Aug 2026', undefined, BOOK);
  assert.equal(report.money, null);
  assert.equal(report.damages[0]!.cost, '');
});
