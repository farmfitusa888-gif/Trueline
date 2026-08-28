import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength } from '../length.ts';
import { scanned } from '../measurement.ts';
import type { Heading, Room, Wall } from '../room.ts';
import {
  notesOnMark,
  notesOnWall,
  onSurface,
  spokenLength,
  surfaceOf,
  validateVoiceNote,
  VoiceError,
  type VoiceNote,
  whatWasSaid,
} from '../voice.ts';

/**
 * What somebody said, and what the phone made of it.
 *
 * Two things have to stay true at once and every test here is one of them: the
 * recording is the record and cannot be rewritten, and the transcript is what
 * makes it usable and therefore has to be correctable. A contractor's
 * vocabulary — jamb, soffit, kerf, R-13 — is exactly where a recogniser slips,
 * so a transcript nobody can fix is a transcript that puts the wrong word on a
 * document.
 */

const T0 = '2026-08-27T09:00:00Z';
const scan = (text: string) => scanned(parseLength(text), parseLength(`50mm`), T0, 'roomplan');

function w(id: string, heading: Heading, length: string): Wall {
  return { id, heading, length: scan(length) };
}

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

function note(over: Partial<VoiceNote> = {}): VoiceNote {
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

/* --------------------------------------------------------------- refusing */

test('a recording about a wall or surface this room does not have is refused', () => {
  assert.throws(() => validateVoiceNote(room, note({ wallId: 'the pantry' })), VoiceError);
  // Because there is nothing else to find it by. It would not be on the wall
  // panel, not on the sheet, and the only sign of it would be a file.
  assert.doesNotThrow(() => validateVoiceNote(room, note()));
  // The ceiling is a surface of every room and it is where the water stain is.
  // A note about it is filed under the same key its scope and its marks are.
  assert.doesNotThrow(() => validateVoiceNote(room, note({ wallId: 'ceiling' })));
  assert.doesNotThrow(() => validateVoiceNote(room, note({ wallId: 'floor' })));
});

test('a recording with no file name is refused, because nothing could play it', () => {
  assert.throws(() => validateVoiceNote(room, note({ fileName: '   ' })), VoiceError);
});

test('a length of time has to be a whole number of milliseconds, and not negative', () => {
  assert.throws(() => validateVoiceNote(room, note({ milliseconds: -1 })), VoiceError);
  assert.throws(() => validateVoiceNote(room, note({ milliseconds: 1.5 })), VoiceError);
  assert.doesNotThrow(() => validateVoiceNote(room, note({ milliseconds: 0 })));
});

test('an empty transcript is refused rather than kept as an empty quotation', () => {
  assert.throws(
    () => validateVoiceNote(room, note({ transcript: { text: '  ', by: 'phone', at: T0 } })),
    VoiceError
  );
  // With none at all, the recording stands on its own and that is fine.
  assert.doesNotThrow(() => validateVoiceNote(room, note()));
});

/* ---------------------------------------------------------------- finding */

test('a note on a mark is not a note on the wall, and the two do not mix', () => {
  const notes: VoiceNote[] = [
    note({ id: 'v1' }),
    note({ id: 'v2', markId: 'north-rot-1' }),
    note({ id: 'v3', wallId: 'south' }),
  ];

  // The wall's own notes: this wall, and nothing that belongs to a mark on it.
  assert.deepEqual(notesOnWall(notes, 'north').map((n) => n.id), ['v1']);
  assert.deepEqual(notesOnMark(notes, 'north-rot-1').map((n) => n.id), ['v2']);
  assert.deepEqual(notesOnWall(notes, 'south').map((n) => n.id), ['v3']);
  // Which is what lets deleting a mark take its recordings and leave the
  // wall's alone.
  assert.equal(notesOnMark(notes, 'nothing-marked').length, 0);
});

test('oldest first, because it is somebody thinking out loud across a visit', () => {
  const notes: VoiceNote[] = [
    note({ id: 'later', recordedAt: '2026-08-27T11:00:00Z' }),
    note({ id: 'first', recordedAt: '2026-08-27T09:00:00Z' }),
    note({ id: 'middle', recordedAt: '2026-08-27T10:00:00Z' }),
  ];
  assert.deepEqual(notesOnWall(notes, 'north').map((n) => n.id), ['first', 'middle', 'later']);
});

/* --------------------------------------------------------------- printing */

test('how long it runs reads as a clock, and never rounds up', () => {
  assert.equal(spokenLength(0), '0:00');
  assert.equal(spokenLength(14_200), '0:14');
  // 14.9 seconds is 0:14, not 0:15. A button that says 15 and stops at 14
  // reads as a fault, and rounding up is the direction that can claim a
  // recording is longer than it is.
  assert.equal(spokenLength(14_900), '0:14');
  assert.equal(spokenLength(67_000), '1:07');
  assert.equal(spokenLength(600_000), '10:00');
});

test('a transcript nobody has read says so; one somebody has read does not', () => {
  const machine = whatWasSaid(note({ transcript: { text: 'the jamb is split', by: 'phone', at: T0 } }));
  assert.match(machine, /the jamb is split/);
  assert.match(machine, /written by the phone/);

  const person = whatWasSaid(note({ transcript: { text: 'the jamb is split', by: 'person', at: T0 } }));
  assert.equal(person, '"the jamb is split"');
  // The whole reason it is editable: the recogniser hears "gym" for "jamb",
  // and what goes out under somebody's name has to be their sentence.
  assert.doesNotMatch(person, /phone/);
});

test('a recording with no transcript is said out loud rather than left blank', () => {
  const said = whatWasSaid(note({ noTranscript: 'this phone cannot write one' }));
  // A blank where a note should be is indistinguishable from no note.
  assert.match(said, /0:14/);
  assert.match(said, /no transcript/);
  assert.match(said, /this phone cannot write one/);
  assert.match(said, /listen to it/);
});

test('and with no reason given it still says there is something to listen to', () => {
  const said = whatWasSaid(note());
  assert.match(said, /no transcript/);
  assert.match(said, /0:14/);
});

/* ------------------------------------- wallId became surface, and both read */

/**
 * The rename that had to be a migration.
 *
 * `wallId` stopped being true the day a ceiling could be talked at, and the
 * check in `validateVoiceNote` has always accepted a surface as readily as a
 * wall — so the name described one of the two things the field held. Every job
 * file already on a phone carries the old key and none of them can be reached
 * to be rewritten, so both read and only the new one is written.
 */

test('a recording saved before the rename still says which surface it is about', () => {
  const old = { ...note(), wallId: 'north' } as VoiceNote;
  delete (old as { surface?: string }).surface;
  assert.equal(surfaceOf(old), 'north');
  assert.doesNotThrow(() => validateVoiceNote(room, old));
});

test('and one saved after it says so under the new key', () => {
  assert.equal(surfaceOf({ surface: 'ceiling' }), 'ceiling');
  assert.doesNotThrow(() => validateVoiceNote(room, note({ surface: 'ceiling', wallId: undefined })));
});

test('the new key wins when a file somehow carries both, and the old one is dropped on a move', () => {
  assert.equal(surfaceOf({ surface: 'ceiling', wallId: 'north' }), 'ceiling');
  const moved = onSurface({ ...note(), wallId: 'north' } as VoiceNote, 'south');
  assert.equal(moved.surface, 'south');
  assert.equal('wallId' in moved, false);
  assert.equal(surfaceOf(moved), 'south');
});

test('a recording that says neither is refused rather than filed against nothing', () => {
  for (const nowhere of [{}, { surface: '' }, { wallId: '' }, { surface: undefined }]) {
    assert.throws(() => surfaceOf(nowhere), VoiceError);
  }
});

test('notes on a wall are found whichever key they were written under', () => {
  const heard = [
    { ...note({ id: 'old' }), wallId: 'north', surface: undefined },
    note({ id: 'new', surface: 'north', wallId: undefined }),
    note({ id: 'elsewhere', surface: 'south', wallId: undefined }),
  ] as VoiceNote[];
  // The set, not the order: `notesOnWall` sorts by when it was said and these
  // two were said at the same moment, so an order here would be asserting
  // something this test is not about.
  const onNorth = notesOnWall(heard, 'north').map((one) => one.id);
  assert.deepEqual([...onNorth].sort(), ['new', 'old']);
  assert.equal(onNorth.length, 2);
});
