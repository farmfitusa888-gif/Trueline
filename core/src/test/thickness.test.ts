import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NM_PER_INCH, formatFeetInches, parseLength } from '../length.ts';
import { scanned, verified } from '../measurement.ts';
import { type Heading, type Opening, type Room, type Wall, RoomError, area, diagonal, validate } from '../room.ts';
import {
  ASSEMBLIES,
  JAMB_CLEARANCE,
  ThicknessError,
  assemblyById,
  assemblyForThickness,
  footprint,
  footprintObstacle,
  framing,
  jambDepth,
  openingReturns,
  thicknessGroups,
  thicknessOf,
  thicknessProvenance,
  withoutThickness,
} from '../thickness.ts';

/**
 * Thickness is the number a scanner cannot know.
 *
 * The third dimension on every RoomPlan surface is zero — in all five walls of
 * Sam's garage and all eight of the kitchen — because a phone inside a room sees
 * one face of a wall and nothing behind it. So every test here is about a number
 * a person put in, and about the app being straight regarding which walls have
 * one and which do not.
 */

const T0 = '2026-08-25T10:00:00Z';
const stated = (text: string) => verified(parseLength(text), 'sam', T0, 'stated');
const taped = (text: string) => verified(parseLength(text), 'sam', T0, 'tape');
const scan = (text: string) => scanned(parseLength(text), parseLength(`50mm`), T0, 'roomplan');

function w(id: string, heading: Heading, length: string, extra: Partial<Wall> = {}): Wall {
  return { id, heading, length: scan(length), ...extra };
}

function opening(id: string, kind: Opening['kind'], width: string, height: string, at: string): Opening {
  return { id, kind, width: scan(width), height: scan(height), offsetFromStart: scan(at) };
}

/** 20 ft by 10 ft. */
function room(walls: Wall[], extra: Partial<Room> = {}): Room {
  return {
    id: 'r1',
    name: 'test room',
    walls,
    ceilingHeight: verified(parseLength(`8'`), 'sam', T0, 'tape'),
    ...extra,
  };
}

const box = () => [
  w('south', 'east', `20'`),
  w('east', 'north', `10'`),
  w('north', 'west', `20'`),
  w('west', 'south', `10'`),
];

/* ------------------------------------------------------- the catalogue */

test('nominal lumber is not its own size, and the catalogue uses the real one', () => {
  // A 2x4 is 3 1/2 inches. Getting this wrong is a two-inch error per wall on
  // every outside dimension in the takeoff.
  const two_by_four = assemblyById('2x4');
  assert.equal(two_by_four.framing, 7n * NM_PER_INCH / 2n);
  assert.equal(formatFeetInches(two_by_four.thickness), `4 1/2"`);

  const two_by_six = assemblyById('2x6');
  assert.equal(two_by_six.framing, 11n * NM_PER_INCH / 2n);
  assert.equal(formatFeetInches(two_by_six.thickness), `6 1/2"`);

  // 8 inch block is 7 5/8, plus half-inch board on the one face you see.
  assert.equal(formatFeetInches(assemblyById('cmu-8').thickness), `8 1/8"`);
  assert.equal(assemblyById('cmu-8').framed, false, 'block is not stud framing');
});

test('every catalogue thickness is its framing plus its board, both sides counted', () => {
  for (const a of ASSEMBLIES) {
    assert.equal(a.thickness, a.framing + BigInt(a.sides) * a.board, a.id);
  }
});

test('an unknown build-up is refused rather than defaulted', () => {
  assert.throws(() => assemblyById('2x8' as never), ThicknessError);
});

/* ------------------------------------------------------------ the jamb */

test('the two jamb sizes on every millwork shelf fall out of the clearance', () => {
  // This is the check that JAMB_CLEARANCE is right rather than invented: a
  // sixteenth over the wall reproduces 4 9/16" and 6 9/16", which are the two
  // sizes actually sold, for the two walls actually built.
  assert.equal(formatFeetInches(jambDepth(assemblyById('2x4').thickness)), `4 9/16"`);
  assert.equal(formatFeetInches(jambDepth(assemblyById('2x6').thickness)), `6 9/16"`);
  assert.equal(JAMB_CLEARANCE, NM_PER_INCH / 16n);
});

test('a wall with no thickness takes no jamb, and says so', () => {
  assert.throws(() => jambDepth(0n), ThicknessError);
});

/* --------------------------------------------------- who has one, who does not */

test('a room-wide thickness applies to every wall, and a wall overrides it', () => {
  const r = room([w('south', 'east', `20'`, { thickness: stated(`6 1/2"`) }), ...box().slice(1)], {
    wallThickness: stated(`4 1/2"`),
  });
  assert.equal(thicknessOf(r.walls[0]!, r)!.value, parseLength(`6 1/2"`));
  assert.equal(thicknessOf(r.walls[1]!, r)!.value, parseLength(`4 1/2"`));
  // `fullyThick` was a one-line predicate over exactly this and was deleted:
  // every caller wants to know WHICH walls are bare, not merely whether any
  // are, so it was a second name for a shorter answer nobody needed.
  assert.deepEqual(withoutThickness(r), []);
});

test('walls with no thickness are named, not assumed to be 2x4', () => {
  // The whole point. A takeoff that quietly priced a block garage as stud
  // framing would reconcile perfectly and be wrong by the cost of the job.
  const r = room([w('south', 'east', `20'`, { thickness: stated(`4 1/2"`) }), ...box().slice(1)]);
  assert.deepEqual(withoutThickness(r), ['east', 'north', 'west']);
});

test('an open span has no thickness and is never asked for one', () => {
  const r = room([...box().slice(0, 3), { ...box()[3]!, open: true as const }], {
    wallThickness: stated(`4 1/2"`),
  });
  assert.equal(thicknessOf(r.walls[3]!, r), undefined, 'nothing is built there');
  assert.deepEqual(withoutThickness(r), [], 'and it is not a wall that is missing one');
});

test('a thickness on an open span is refused', () => {
  const r = room([...box().slice(0, 3), { ...box()[3]!, open: true as const, thickness: stated(`4 1/2"`) }]);
  assert.throws(() => validate(r), RoomError);
});

test('a wall cannot be zero thick', () => {
  assert.throws(
    () => validate(room([w('south', 'east', `20'`, { thickness: verified(0n, 'sam', T0, 'stated') }), ...box().slice(1)])),
    RoomError
  );
});

/* -------------------------------------------------------- the jamb schedule */

test('two thicknesses in one room give two jamb sizes, not an average', () => {
  // The outside walls are 2x6 and the partitions are 2x4, which is most houses.
  // A single room-wide jamb would be right for some openings and silently wrong
  // for the rest, and the wrong pre-hung unit goes back on the truck.
  const r = room(
    [
      w('south', 'east', `20'`, {
        thickness: stated(`6 1/2"`),
        openings: [opening('win', 'window', `4'`, `3'`, `8'`)],
      }),
      w('east', 'north', `10'`, { thickness: stated(`6 1/2"`) }),
      w('north', 'west', `20'`, {
        thickness: stated(`4 1/2"`),
        openings: [opening('door', 'door', `3'`, `6' 8"`, `5'`)],
      }),
      w('west', 'south', `10'`, { thickness: stated(`4 1/2"`) }),
    ]
  );
  const groups = thicknessGroups(r);
  assert.equal(groups.length, 2);
  assert.equal(formatFeetInches(groups[0]!.thickness), `4 1/2"`, 'thinnest first');
  assert.equal(formatFeetInches(groups[0]!.jamb), `4 9/16"`);
  assert.equal(formatFeetInches(groups[1]!.jamb), `6 9/16"`);
  assert.equal(groups[0]!.assembly?.id, '2x4');
  assert.equal(groups[1]!.assembly?.id, '2x6');
  assert.equal(groups[0]!.openings, 1);
  assert.equal(groups[1]!.openings, 1);
});

test('a thickness nobody sells is still a thickness, with no build-up against it', () => {
  const r = room(box(), { wallThickness: taped(`5 3/8"`) });
  const [group] = thicknessGroups(r);
  assert.equal(group!.assembly, undefined, 'it matches nothing in the catalogue');
  assert.equal(formatFeetInches(group!.jamb), `5 7/16"`, 'and it still takes a jamb');
  assert.equal(assemblyForThickness(parseLength(`5 3/8"`)), undefined);
});

/* ----------------------------------------------------- the wrap round a hole */

test('a window wraps on four sides; a door wraps on three', () => {
  // The floor runs through a door, so there is no sill to wrap. Counting one
  // adds a door-width of drywall to every doorway in the house.
  const r = room(
    [
      w('south', 'east', `20'`, { openings: [opening('win', 'window', `4'`, `3'`, `8'`)] }),
      w('east', 'north', `10'`, { openings: [opening('door', 'door', `3'`, `7'`, `2'`)] }),
      ...box().slice(2),
    ],
    { wallThickness: stated(`4 1/2"`) }
  );
  const returns = openingReturns(r);
  const win = returns.find((x) => x.openingId === 'win')!;
  const door = returns.find((x) => x.openingId === 'door')!;

  // Window: two jambs of 3 ft, a head and a sill of 4 ft = 14 ft.
  assert.equal(win.run, parseLength(`14'`));
  // Door: two jambs of 7 ft and a head of 3 ft = 17 ft. No sill.
  assert.equal(door.run, parseLength(`17'`));

  // Area is that run through the wall's own thickness.
  assert.equal(win.area, parseLength(`14'`) * parseLength(`4 1/2"`));
  assert.equal(door.thickness, parseLength(`4 1/2"`));
});

test('the same window in a thicker wall wraps more', () => {
  const thin = room([w('south', 'east', `20'`, { openings: [opening('win', 'window', `4'`, `3'`, `8'`)] }), ...box().slice(1)], { wallThickness: stated(`4 1/2"`) });
  const thick = { ...thin, wallThickness: stated(`8 1/8"`) };
  const a = openingReturns(thin)[0]!;
  const b = openingReturns(thick)[0]!;
  assert.equal(a.run, b.run, 'the hole is the same size');
  assert.ok(b.area > a.area, 'but there is more of it to wrap');
});

test('an opening in a wall with no thickness produces no return at all', () => {
  // Not a zero. Nothing. A zero would add up with the real ones and read as a
  // wall that needs no wrapping.
  const r = room([w('south', 'east', `20'`, { openings: [opening('win', 'window', `4'`, `3'`, `8'`)] }), ...box().slice(1)]);
  assert.deepEqual(openingReturns(r), []);
});

/* ------------------------------------------------------------------ framing */

test('plates run three times the wall — one bottom, two top', () => {
  const r = room(box(), { wallThickness: stated(`4 1/2"`) });
  const f = framing(r);
  assert.equal(f.framedRun, parseLength(`60'`));
  assert.equal(f.plateRun, parseLength(`180'`));
});

test('studs land on the spacing, one at each end, and the spacing is stated', () => {
  // A 20 ft wall at 16 in on centre: 240/16 = 15 bays, so 16 studs.
  const r = room(box(), { wallThickness: stated(`4 1/2"`) });
  assert.equal(framing(r, 16).studs, 16 + 8 + 16 + 8);
  // At 24 in: 240/24 = 10 bays, 11 studs on the long walls; 120/24 = 5, 6 short.
  assert.equal(framing(r, 24).studs, 11 + 6 + 11 + 6);
  assert.equal(framing(r, 24).spacing, 24);
});

test('a block wall and an open span are left out of the framing, with reasons', () => {
  // Silently skipping them would make the count read like the whole building.
  const r = room(
    [
      w('south', 'east', `20'`, { thickness: stated(`8 1/8"`) }),
      w('east', 'north', `10'`, { thickness: stated(`4 1/2"`) }),
      w('north', 'west', `20'`),
      { ...w('west', 'south', `10'`), open: true as const },
    ]
  );
  const f = framing(r);
  assert.deepEqual(f.wallIds, ['east']);
  assert.deepEqual(
    f.skipped.map((s) => s.wallId),
    ['south', 'north', 'west']
  );
  assert.match(f.skipped.find((s) => s.wallId === 'south')!.why, /block/);
  assert.match(f.skipped.find((s) => s.wallId === 'north')!.why, /no thickness/);
  assert.match(f.skipped.find((s) => s.wallId === 'west')!.why, /nothing is built/);
});

test('every opening in a framed wall is counted as needing a header', () => {
  const r = room(
    [
      w('south', 'east', `20'`, { openings: [opening('d', 'door', `3'`, `7'`, `2'`), opening('w', 'window', `4'`, `3'`, `9'`)] }),
      ...box().slice(1),
    ],
    { wallThickness: stated(`4 1/2"`) }
  );
  assert.equal(framing(r).headers, 2);
});

/* ---------------------------------------------------------------- footprint */

test('a 20 by 10 room in 4 1/2 inch walls measures 20 9 by 10 9 outside', () => {
  // Offsetting a rectilinear loop outward by t adds exactly t*perimeter + 4t^2.
  // Checked against the long way round: (20' + 9") x (10' + 9").
  const r = room(box(), { wallThickness: stated(`4 1/2"`) });
  const f = footprint(r);
  const outside = 2n * parseLength(`20' 9"`) * parseLength(`10' 9"`);
  assert.equal(f.outside, outside);
  assert.equal(f.inside, area(r).value);
  assert.equal(f.walls, f.outside - f.inside);
});

test('the identity holds on a room with a jog in it, where the corner count does not', () => {
  // An L has six corners, five convex and one reflex, and the offset still grows
  // by exactly 4t^2 at the corners — that is why the constant is four rather
  // than the number of corners.
  const t = parseLength(`4 1/2"`);
  const el = room(
    [
      w('a', 'east', `20'`),
      w('b', 'north', `10'`),
      w('c', 'west', `8'`),
      w('d', 'north', `6'`),
      w('e', 'west', `12'`),
      w('f', 'south', `16'`),
    ],
    { wallThickness: stated(`4 1/2"`) }
  );
  const f = footprint(el);
  // The long way: offset each of the six sides and shoelace the result.
  const outer: [bigint, bigint][] = [
    [-t, -t],
    [parseLength(`20'`) + t, -t],
    [parseLength(`20'`) + t, parseLength(`10'`) + t],
    // The jog. Walking anticlockwise the inside is below and to the left here,
    // so the outside of this corner is up and to the right of it: the one
    // corner in the room where the offset goes the other way.
    [parseLength(`12'`) + t, parseLength(`10'`) + t],
    [parseLength(`12'`) + t, parseLength(`16'`) + t],
    [-t, parseLength(`16'`) + t],
  ];
  let twice = 0n;
  for (let i = 0; i < outer.length; i += 1) {
    const [ax, ay] = outer[i]!;
    const [bx, by] = outer[(i + 1) % outer.length]!;
    twice += ax * by - bx * ay;
  }
  assert.equal(f.outside, twice < 0n ? -twice : twice);
});

test('outside dimensions are refused, with a reason, rather than approximated', () => {
  const mixed = room(
    [
      w('south', 'east', `20'`, { thickness: stated(`6 1/2"`) }),
      w('east', 'north', `10'`, { thickness: stated(`4 1/2"`) }),
      w('north', 'west', `20'`, { thickness: stated(`4 1/2"`) }),
      w('west', 'south', `10'`, { thickness: stated(`4 1/2"`) }),
    ]
  );
  assert.match(footprintObstacle(mixed)!, /different thicknesses/);
  assert.throws(() => footprint(mixed), ThicknessError);

  const bare = room(box());
  assert.match(footprintObstacle(bare)!, /Not every wall/);

  const garage = room([...box().slice(0, 3), { ...box()[3]!, open: true as const }], {
    wallThickness: stated(`4 1/2"`),
  });
  assert.match(footprintObstacle(garage)!, /nothing built across it/);
});

test('an angled wall is refused rather than rounded through a tangent', () => {
  // Sam's kitchen has a 203 mm chamfer. The corner wedge there is a kite, not a
  // square, and working it needs trigonometry on somebody's building.
  const chamfered = room(
    [
      w('a', 'east', `20'`),
      w('b', 'north', `10'`),
      w('c', 'west', `16'`),
      {
        id: 'chamfer',
        heading: diagonal(parseLength(`5'`), { x: -3n, y: -4n }),
        length: scan(`5'`),
      },
      w('e', 'south', `6'`),
    ],
    { wallThickness: stated(`4 1/2"`) }
  );
  assert.match(footprintObstacle(chamfered)!, /angled wall/);
});

/* --------------------------------------------------------------- provenance */

test('a thickness somebody taped reads differently from one somebody assumed', () => {
  const r = room(box(), { wallThickness: stated(`4 1/2"`) });
  assert.equal(thicknessProvenance(r), 'stated');
  assert.equal(thicknessProvenance({ ...r, wallThickness: taped(`4 1/2"`) }), 'measured');
  assert.equal(thicknessProvenance(room(box())), 'missing');
});
