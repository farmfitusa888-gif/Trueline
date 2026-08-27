import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength } from '../length.ts';
import { scanned } from '../measurement.ts';
import type { Heading, Room, Wall } from '../room.ts';
import {
  type Mark,
  CONDITION_KINDS,
  DamageError,
  LOSS_KINDS,
  damageQuantity,
  isLoss,
  losses,
  markWord,
  validateDamage,
} from '../damage.ts';
import { fieldList } from '../fieldlist.ts';
import type { VoiceNote } from '../voice.ts';

/**
 * One mark, and the two places it lands.
 *
 * A restoration contractor and a remodeler do the same thing: point at part of a
 * measured wall and say what is wrong with it. What differs is what happens
 * afterwards — a claim prices it as tear-out, and an ordinary job puts it on the
 * sheet somebody carries and on nothing else. These tests are the line between
 * those two, because getting it wrong in either direction is expensive: a
 * condition note that quietly prices is a line on an insurer's estimate nobody
 * can defend, and a loss that does not is a claim that comes out short.
 */

const T0 = '2026-08-27T09:00:00Z';
const scan = (text: string) => scanned(parseLength(text), parseLength(`50mm`), T0, 'roomplan');

function w(id: string, heading: Heading, length: string): Wall {
  return { id, heading, length: scan(length) };
}

/** 20 x 10, 9 ft ceiling. Round numbers, so every figure is checkable by hand. */
const room: Room = {
  id: 'r1',
  name: 'kitchen',
  walls: [
    w('south', 'east', `20'`),
    w('east', 'north', `10'`),
    w('north', 'west', `20'`),
    w('west', 'south', `10'`),
  ],
  ceilingHeight: scan(`9'`),
};

function mark(over: Partial<Mark> = {}): Mark {
  return {
    id: 'm1',
    kind: 'rot',
    shape: {
      kind: 'patch',
      wallId: 'north',
      fromAlong: parseLength(`4'`),
      toAlong: parseLength(`13'`),
      fromHeight: 0n,
      toHeight: parseLength(`2'`),
    },
    note: 'sill plate is soft under the window',
    recordedAt: T0,
    recordedBy: 'me',
    photos: [],
    readings: [],
    ...over,
  };
}

/* ------------------------------------------------- which list a word is on */

test('every word belongs to exactly one of the two lists', () => {
  for (const kind of LOSS_KINDS) assert.ok(isLoss(kind), kind);
  for (const kind of CONDITION_KINDS) assert.ok(!isLoss(kind), kind);
  // No word on both. A mark cannot be a cause of loss and a condition at once,
  // and the kind is the only thing that decides.
  const both = LOSS_KINDS.filter((k) => (CONDITION_KINDS as readonly string[]).includes(k));
  assert.deepEqual(both, []);
});

test('a loss takes the word "damage" after it and a condition does not', () => {
  assert.equal(markWord('water'), 'water damage');
  // "out of plumb damage" is not something anybody says.
  assert.equal(markWord('out of plumb'), 'out of plumb');
  assert.equal(markWord('rot'), 'rot');
});

/* ------------------------------------------------- what prices and what does not */

test('what prices as tear-out is the losses, and only the losses', () => {
  const marked: Mark[] = [
    mark({ id: 'wet', kind: 'water' }),
    mark({ id: 'soft', kind: 'rot' }),
    mark({ id: 'shut', kind: 'no access' }),
    mark({ id: 'burnt', kind: 'fire' }),
  ];
  // The one line that keeps a condition note off an insurer's estimate. Every
  // insurance screen is handed this and never the whole list.
  assert.deepEqual(losses(marked).map((m) => m.id), ['wet', 'burnt']);
  // And nothing falls between the two halves: every mark is one or the other.
  assert.equal(marked.filter((m) => !isLoss(m.kind)).length, 2);
  assert.equal(losses(marked).length + marked.filter((m) => !isLoss(m.kind)).length, marked.length);
});

test('a condition still has real geometry — it is on a measured wall', () => {
  // The point of marking it here at all. 9 ft along, 2 ft high, which is 18
  // square feet of wall face whether or not anybody is paying to remove it.
  const q = damageQuantity(room, mark());
  assert.equal(q.faceArea, parseLength(`9'`) * parseLength(`2'`));
  assert.match(q.what, /^rot to north$/);
  assert.match(q.workings, /9' along north/);
});

test('what it refuses is the same for both, and says the right word', () => {
  assert.throws(
    () => validateDamage(room, mark({ note: '   ' })),
    (error: unknown) => error instanceof DamageError && /The rot has no note on it/.test(error.message)
  );
  // A water category on anything that is not water, which now includes every
  // condition word. Categories describe how dirty water was.
  assert.throws(() => validateDamage(room, mark({ kind: 'rot', category: 2 })), DamageError);
  assert.doesNotThrow(() => validateDamage(room, mark({ kind: 'water', category: 2 })));
});

/* ------------------------------------------------------------ the field sheet */

test('a condition note reaches the sheet somebody carries', () => {
  const list = fieldList(room, [], { marks: [mark()] });
  assert.equal(list.marks.length, 1);
  assert.equal(list.marks[0]!.wallId, 'north');
  assert.equal(list.marks[0]!.what, 'rot');
  assert.match(list.text, /MARKED ON THESE WALLS — 1/);
  assert.match(list.text, /north — rot/);
  assert.match(list.text, /sill plate is soft under the window/);
});

test('and it carries no area, because noticing something is not buying its removal', () => {
  const list = fieldList(room, [], { marks: [mark()] });
  // The geometry is real and is printed as a place — 9 feet along, this high.
  assert.match(list.marks[0]!.where, /9' along north/);
  // What is not printed is square feet. A quantity on this sheet reads as work
  // somebody has agreed to, and nobody has.
  assert.doesNotMatch(list.text, /sq ft/);
  assert.match(list.text, /None of it is in the takeoff/);
});

test('marks print in the order the plan numbers the walls, not the order they were found', () => {
  // Somebody reading this is walking the room and wants everything about a
  // wall while standing at it.
  const list = fieldList(room, [], {
    marks: [
      mark({ id: 'later', kind: 'cracked', shape: { kind: 'surface', surface: 'wall', wallId: 'west' } }),
      mark({ id: 'earlier', kind: 'rot' }),
      mark({ id: 'first', kind: 'note', shape: { kind: 'pin', at: { x: 0n, y: 0n }, wallId: 'south' } }),
    ],
  });
  assert.deepEqual(list.marks.map((m) => m.wallId), ['south', 'north', 'west']);
});

test('a mark on nothing at all — a whole ceiling — is not filed under a wall', () => {
  const list = fieldList(room, [], {
    marks: [mark({ id: 'ceiling', kind: 'water', shape: { kind: 'surface', surface: 'ceiling' } })],
  });
  // It belongs on the claim document, which knows what to do with a ceiling.
  // A sheet organised by wall has nowhere honest to put it.
  assert.equal(list.marks.length, 0);
  assert.doesNotMatch(list.text, /MARKED ON THESE WALLS/);
});

/* ------------------------------------------------------ and what was said */

function said(over: Partial<VoiceNote> = {}): VoiceNote {
  return {
    id: 'v1',
    wallId: 'north',
    fileName: 'voice-1.m4a',
    recordedAt: T0,
    recordedBy: 'me',
    milliseconds: 14_200,
    ...over,
  };
}

test('what was said about a mark prints under it', () => {
  const list = fieldList(room, [], {
    marks: [mark()],
    voice: [said({ markId: 'm1', transcript: { text: 'budget the whole run', by: 'person', at: T0 } })],
  });
  assert.deepEqual(list.marks[0]!.said, ['"budget the whole run"']);
  assert.match(list.text, /Said: +"budget the whole run"/);
});

test('what was said about the wall itself gets its own block', () => {
  const list = fieldList(room, [], {
    voice: [said({ transcript: { text: 'this one is out of plumb at the top', by: 'phone', at: T0 } })],
  });
  assert.match(list.text, /SAID ABOUT THESE WALLS/);
  assert.match(list.text, /out of plumb at the top/);
  // Marked as the phone's words until somebody has read them.
  assert.match(list.text, /written by the phone/);
});

test('a recording with no transcript still tells the sheet there is one to hear', () => {
  const list = fieldList(room, [], {
    voice: [said({ noTranscript: 'this phone cannot write one' })],
  });
  assert.match(list.text, /0:14/);
  assert.match(list.text, /this phone cannot write one/);
});

test('nothing marked and nothing said leaves the sheet exactly as it was', () => {
  const bare = fieldList(room, [], { at: 'today' });
  const same = fieldList(room, [], { at: 'today', marks: [], voice: [] });
  assert.equal(bare.text, same.text);
  assert.doesNotMatch(bare.text, /MARKED ON THESE WALLS|SAID ABOUT THESE WALLS/);
});
