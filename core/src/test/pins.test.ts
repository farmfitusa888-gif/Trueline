import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type RoomFrame, CaptureError } from '../capture.ts';
import { NM_PER_FOOT, NM_PER_METRE, parseLength } from '../length.ts';
import { scanned, verified } from '../measurement.ts';
import { certainty } from '../damage.ts';
import type { Heading, Room, Wall } from '../room.ts';
import {
  type CapturedPin,
  type PinManifest,
  PIN_MANIFEST_SCHEMA,
  importPins,
  toDamage,
  wallNear,
} from '../pins.ts';

/**
 * Damage marked while the room is still being walked.
 *
 * Every test here is about one thing: a pin lands where the person was
 * pointing, or it does not land at all. There is no third option, because a pin
 * drawn a few feet from where somebody stood is worse than a pin that was
 * refused -- it is wrong and it looks right, and it goes to an adjuster.
 */

const T0 = '2026-08-26T09:00:00Z';
const scan = (text: string) => scanned(parseLength(text), parseLength('50mm'), T0, 'roomplan');

function w(id: string, heading: Heading, length: string): Wall {
  return { id, heading, length: scan(length) };
}

/** 20 x 10, laid out from (0, 0): south along +x, east along +y. */
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

/**
 * ARKit's axes are the room's, the room starts at the plan origin, and the
 * floor is at ARKit's own zero. Every number below is therefore checkable by
 * hand, which is the only reason to have a fixture this plain.
 */
const PLAIN: RoomFrame = { datum: { x: 1, y: 0 }, origin: { x: 0n, y: 0n }, floor: 0n };

function pin(over: Partial<CapturedPin> = {}): CapturedPin {
  return {
    id: 'p1',
    at: [1, 1, 0],
    droppedAt: T0,
    kind: 'water',
    note: 'staining behind the boiler',
    found: 'planeGeometry',
    ...over,
  };
}

/* ------------------------------------------------------------ where it goes */

test('a tap lands where it was pointed, to the nanometre', () => {
  // ARKit (2, 1.5, 0). The plan drop makes (x, z) into (x, -z), so (2, 0).
  const damage = toDamage(pin({ at: [2, 1.5, 0] }), PLAIN, room);
  assert.equal(damage.shape.kind, 'pin');
  if (damage.shape.kind !== 'pin') return;
  assert.deepEqual(damage.shape.at, { x: 2n * NM_PER_METRE, y: 0n });
});

test('the plan drop negates z, so a pin behind you is not drawn in front', () => {
  const damage = toDamage(pin({ at: [0, 1, 3] }), PLAIN, room);
  if (damage.shape.kind !== 'pin') return;
  assert.deepEqual(damage.shape.at, { x: 0n, y: -3n * NM_PER_METRE });
});

test('the datum the importer chose is applied, so pins and walls share axes', () => {
  // The same rotation `capture.test.ts` pins for photographs: a datum of
  // (0, -1) turns (2, -3) into (3, 2).
  const turned: RoomFrame = { datum: { x: 0, y: -1 }, origin: { x: 0n, y: 0n }, floor: 0n };
  const damage = toDamage(pin({ at: [2, 1, 3] }), turned, room);
  if (damage.shape.kind !== 'pin') return;
  assert.deepEqual(damage.shape.at, { x: 3n * NM_PER_METRE, y: 2n * NM_PER_METRE });
});

test('the room origin is subtracted, so a pin is not eight feet from the wall', () => {
  // Gilbert's kitchen was 7.93 ft out in x. Anything that skips this shift puts
  // every pin that far from where the person stood.
  const shifted: RoomFrame = {
    datum: { x: 1, y: 0 },
    origin: { x: 5n * NM_PER_METRE, y: 2n * NM_PER_METRE },
    floor: 0n,
  };
  const damage = toDamage(pin({ at: [7, 1, -3] }), shifted, room);
  if (damage.shape.kind !== 'pin') return;
  assert.deepEqual(damage.shape.at, { x: 2n * NM_PER_METRE, y: 1n * NM_PER_METRE });
});

/* ---------------------------------------------------------------- how high */

test('height is measured from the floor, not from where the scan started', () => {
  // The phone was 1.2 m off the ground when the session began, so ARKit's zero
  // is 1.2 m up. A stain 0.5 m off the floor reads as -0.7 in ARKit's y.
  const started: RoomFrame = {
    datum: { x: 1, y: 0 },
    origin: { x: 0n, y: 0n },
    floor: -(NM_PER_METRE * 12n) / 10n,
  };
  const damage = toDamage(pin({ at: [1, -0.7, 0] }), started, room);
  if (damage.shape.kind !== 'pin') return;
  assert.equal(damage.shape.height, (NM_PER_METRE * 5n) / 10n);
});

test('a pin below the floor is refused, because the frames disagree', () => {
  assert.throws(
    () => toDamage(pin({ at: [1, -0.4, 0] }), PLAIN, room),
    (error: unknown) =>
      error instanceof CaptureError && /not in the same coordinate system/.test(error.message)
  );
});

/* ------------------------------------------------------------- which wall */

test('a pin against a wall is that wall’s', () => {
  // The south wall runs from (0, 0) to (20', 0). Six inches off it.
  const at = { x: 10n * NM_PER_FOOT, y: NM_PER_FOOT / 2n };
  assert.deepEqual(wallNear(at, room), { wallId: 'south' });
});

test('and the nearest wall wins when two are close', () => {
  // A foot from the south wall and three inches from the west one.
  const at = { x: NM_PER_FOOT / 4n, y: NM_PER_FOOT };
  assert.deepEqual(wallNear(at, room), { wallId: 'west' });
});

test('a pin in the middle of the room belongs to no wall at all', () => {
  // A boiler in the middle of a basement. Putting this on the nearest wall
  // would be a claim saying the damage is somewhere it is not.
  const at = { x: 10n * NM_PER_FOOT, y: 5n * NM_PER_FOOT };
  assert.equal(wallNear(at, room), undefined);
});

test('exactly a foot out still reaches; a hair further does not', () => {
  const on = { x: 10n * NM_PER_FOOT, y: NM_PER_FOOT };
  const off = { x: 10n * NM_PER_FOOT, y: NM_PER_FOOT + 1n };
  assert.deepEqual(wallNear(on, room), { wallId: 'south' });
  assert.equal(wallNear(off, room), undefined);
});

test('past the end of a wall is measured from its corner, not from its line', () => {
  // Three feet beyond the south wall's east end and level with it. The line the
  // wall lies on passes through this point; the wall itself does not, and the
  // east wall's corner is three feet away.
  const at = { x: 23n * NM_PER_FOOT, y: 0n };
  assert.equal(wallNear(at, room), undefined);
});

/* ------------------------------------------------------------- what it is */

test('a pin carries the words the person said and never invents any', () => {
  const damage = toDamage(pin({ note: '  black spotting inside the closet  ' }), PLAIN, room);
  assert.equal(damage.note, 'black spotting inside the closet');
  assert.equal(damage.kind, 'water');
  assert.equal(damage.recordedAt, T0);
});

test('a pin with nothing said about it is refused rather than drawn', () => {
  assert.throws(
    () => toDamage(pin({ note: '   ' }), PLAIN, room),
    (error: unknown) => error instanceof CaptureError && /dot on a drawing/.test(error.message)
  );
});

test('a pin out past the mapped part of a wall is kept, and says so', () => {
  // The plane is real; how far along it the point is, is an extrapolation. That
  // is worth recording and is not worth refusing -- a wall the phone has not
  // finished mapping is most of a wall for most of a walk.
  const damage = toDamage(pin({ found: 'planeInfinite' }), PLAIN, room);
  assert.equal(damage.shape.kind, 'pin');
});

test('a pin the phone only had depth for lands, and says so', () => {
  // It used to be refused. That was the whole of "MARK STILL DOES NOT WORK
  // DURING THE SCAN": RoomPlan maps walls and floors and not ceilings, so a
  // water stain on a ceiling -- the thing an adjuster is shown most often --
  // could never be marked at all, and there was nothing the person could do
  // about it.
  //
  // The uncertainty did not go away, it moved somewhere useful: onto the damage
  // and from there onto the claim document.
  const damage = toDamage(pin({ found: 'estimated' }), PLAIN, room);
  assert.equal(damage.shape.kind, 'pin');
  assert.equal(damage.found, 'estimated');
  assert.match(certainty('estimated'), /no mapped surface/);
});

test('and every kind of hit is put in words a stranger can read', () => {
  // The raw words are ARKit's. `planeGeometry` on a claim document tells an
  // adjuster nothing, and this is the one place that is fixed.
  for (const found of ['planeGeometry', 'planeInfinite', 'estimated'] as const) {
    const said = certainty(found);
    assert.ok(said.length > 10, `${found} said "${said}"`);
    assert.ok(!said.includes('plane') || !said.includes('Geometry'), said);
  }
});

test('the photograph taken at the moment of the tap comes with it', () => {
  const damage = toDamage(pin({ photoId: 'ph-42' }), PLAIN, room);
  assert.deepEqual(damage.photos, ['ph-42']);
});

test('a pin produces no quantity, which is the whole point of it', () => {
  const damage = toDamage(pin(), PLAIN, room);
  // Nothing on a pin says how much of anything. If this ever grows a width or
  // an area, a gesture has become a measurement and the product has broken its
  // one promise.
  assert.deepEqual(Object.keys(damage.shape).sort(), ['at', 'height', 'kind', 'wallId']);
});

/* --------------------------------------------------------- a whole walk */

function manifest(pins: CapturedPin[]): PinManifest {
  return { schema: PIN_MANIFEST_SCHEMA, pins };
}

test('one bad pin does not lose the rest, and is not dropped quietly', () => {
  // `b` says nothing, and a pin with no words is a dot on a drawing rather than
  // evidence. That refusal stays. It used to be a pin the phone had only depth
  // for, which is no longer refused -- see the test above.
  const result = importPins(
    manifest([
      pin({ id: 'a' }),
      pin({ id: 'b', note: '   ' }),
      pin({ id: 'c', at: [3, 1, -1] }),
    ]),
    PLAIN,
    room
  );
  assert.equal(result.pins.length, 2);
  assert.deepEqual(result.pins.map((p) => p.id), ['a', 'c']);
  assert.equal(result.refused.length, 1);
  assert.equal(result.refused[0]?.id, 'b');
});

test('a manifest from a different version is refused rather than guessed at', () => {
  assert.throws(
    () => importPins({ schema: 'trueline.pins.v2', pins: [] }, PLAIN, room),
    (error: unknown) => error instanceof CaptureError && /being refused/.test(error.message)
  );
});

test('a refusal comes back with its reason, for the finding that reports it', () => {
  // `describePins` used to phrase this for a screen and was deleted: the
  // health check already raises a `stop` quoting every refusal, and two ways
  // of saying one thing is two things to keep in step. What has to survive is
  // that the reason travels with the refusal at all.
  const result = importPins(manifest([pin({ id: 'a' }), pin({ id: 'b', note: '' })]), PLAIN, room);
  assert.equal(result.pins.length, 1);
  assert.equal(result.refused.length, 1);
  assert.match(result.refused[0]!.reason, /dot on a drawing/);
});
