import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NM_PER_FOOT, parseLength } from '../length.ts';
import { scanned, verified } from '../measurement.ts';
import type { Heading, Room, Wall } from '../room.ts';
import {
  CONDITION,
  CONDITIONS,
  TagError,
  describeTag,
  tagAt,
  tagCounts,
  tagsInTheOpen,
  tagsOnWall,
} from '../tag.ts';

/**
 * Hidden conditions, pinned where they actually are.
 *
 * The thing being protected in here is the boundary: a tag is a place, some
 * words and a photograph, and it never becomes a number. Several of these tests
 * exist only to fail if somebody adds one.
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

function base(over: Record<string, unknown> = {}) {
  return {
    id: 't1',
    condition: 'framing' as const,
    at: { x: 10n * NM_PER_FOOT, y: NM_PER_FOOT / 2n },
    note: '2x10 joists east to west, 16 in centres',
    recordedAt: T0,
    recordedBy: 'gilbert',
    ...over,
  };
}

/* ---------------------------------------------------------------- placing */

test('a tag finds its own wall, by the same rule a damage pin does', () => {
  // Six inches off the south wall. Two answers to "which wall is this on" is
  // one too many, so both go through `wallNear`.
  assert.equal(tagAt(room, base()).wallId, 'south');
});

test('a tag in the middle of the room belongs to no wall, and that is an answer', () => {
  const middle = tagAt(room, base({ at: { x: 10n * NM_PER_FOOT, y: 5n * NM_PER_FOOT } }));
  assert.equal(middle.wallId, undefined);
});

test('height is kept when it is known and left off when it is not', () => {
  assert.equal(tagAt(room, base({ height: 7n * NM_PER_FOOT })).height, 7n * NM_PER_FOOT);
  assert.equal('height' in tagAt(room, base()), false);
});

test('a tag below the floor is refused rather than drawn', () => {
  assert.throws(
    () => tagAt(room, base({ height: -NM_PER_FOOT })),
    (error: unknown) => error instanceof TagError && /below the floor/.test(error.message)
  );
});

/* ------------------------------------------------------------- what it is */

test('the words are the words the person used, trimmed and nothing else', () => {
  const tag = tagAt(room, base({ note: '  cast iron stack, do not cut  ' }));
  assert.equal(tag.note, 'cast iron stack, do not cut');
});

test('a tag with nothing written on it is refused', () => {
  assert.throws(
    () => tagAt(room, base({ note: '   ' })),
    (error: unknown) => error instanceof TagError && /dot on a drawing/.test(error.message)
  );
});

test('a tag starts with no photographs rather than a fake one', () => {
  assert.deepEqual(tagAt(room, base()).photos, []);
  assert.deepEqual(tagAt(room, base({ photos: ['ph-2'] })).photos, ['ph-2']);
});

/* ------------------------------------------------------------- reading it */

test('a tag says where it is, not only what it is', () => {
  // Nine tags all reading "Electrical" is the same bug the dimension list had:
  // a list where every row is identical and none of them can be told apart.
  const tag = tagAt(room, base({ condition: 'electrical', height: 7n * NM_PER_FOOT,
    note: 'knob and tube, live' }));
  assert.equal(describeTag(tag), "Electrical on south, 7' up — knob and tube, live");
});

test('one with no wall says so plainly rather than leaving a gap', () => {
  const tag = tagAt(room, base({ at: { x: 10n * NM_PER_FOOT, y: 5n * NM_PER_FOOT },
    condition: 'plumbing', note: 'floor drain' }));
  assert.equal(describeTag(tag), 'Plumbing in the open — floor drain');
});

test('every condition has a name and a reason to use it', () => {
  // A category with no reason beside it gets used as "other" for everything.
  for (const condition of CONDITIONS) {
    assert.ok(CONDITION[condition].plain.length > 0, condition);
    assert.ok(CONDITION[condition].why.length > 20, condition);
  }
});

/* ---------------------------------------------------------------- sorting */

test('what is on a wall comes back in the order it was found', () => {
  const tags = [
    tagAt(room, base({ id: 'b', recordedAt: '2026-08-26T11:00:00Z' })),
    tagAt(room, base({ id: 'a', recordedAt: '2026-08-26T09:00:00Z' })),
    tagAt(room, base({ id: 'c', at: { x: 10n * NM_PER_FOOT, y: 5n * NM_PER_FOOT } })),
  ];
  assert.deepEqual(tagsOnWall(tags, 'south').map((t) => t.id), ['a', 'b']);
  assert.deepEqual(tagsInTheOpen(tags).map((t) => t.id), ['c']);
});

test('the only summary is a count, and it is a count of things not of feet', () => {
  const tags = [
    tagAt(room, base({ id: 'a', condition: 'plumbing' })),
    tagAt(room, base({ id: 'b', condition: 'framing' })),
    tagAt(room, base({ id: 'c', condition: 'plumbing' })),
  ];
  // In CONDITIONS order rather than in first-seen order, so the same room
  // always reads the same way.
  assert.deepEqual(tagCounts(tags), [
    { condition: 'framing', count: 1 },
    { condition: 'plumbing', count: 2 },
  ]);
});

test('nothing in this module returns a quantity, and that is the point', async () => {
  // A guard rather than a test of behaviour. A tag is somebody pointing at
  // something; the moment one of these produces an area or a price, a gesture
  // has been turned into a measurement.
  const module = await import('../tag.ts');
  const banned = Object.keys(module).filter((name) =>
    /quantit|area|total|price|cost|sum/i.test(name)
  );
  assert.deepEqual(banned, []);
});
