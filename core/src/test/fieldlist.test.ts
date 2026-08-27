import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NM_PER_METRE, parseLength } from '../length.ts';
import { scanned, verified } from '../measurement.ts';
import { type Heading, type Room, type Wall, diagonal } from '../room.ts';
import type { Footprint } from '../obstruction.ts';
import { FieldListError, fieldList } from '../fieldlist.ts';

const T0 = '2026-08-19T14:00:00Z';
const T1 = '2026-08-21T09:00:00Z';

function w(id: string, heading: Heading, length: string): Wall {
  return { id, heading, length: scanned(parseLength(length), parseLength(`50mm`), T0, 'roomplan') };
}

function room(walls?: Wall[]): Room {
  return {
    id: 'r1',
    name: 'kitchen',
    walls: walls ?? [
      w('wall-1', 'east', `20'`),
      w('wall-2', 'north', `12'`),
      w('wall-3', 'west', `20'`),
      w('wall-4', 'south', `12'`),
    ],
    ceilingHeight: scanned(parseLength(`8'`), parseLength(`50mm`), T0, 'roomplan'),
  };
}

/** A counter run the length of the north wall, hard against it. */
const counter: Footprint[] = [
  {
    id: 'cabinets',
    category: 'storage',
    min: { x: parseLength(`2'`), y: parseLength(`11' 4"`) },
    max: { x: parseLength(`18'`), y: parseLength(`12'`) },
  },
];

test('four lines, because ten is a chore nobody finishes', () => {
  const list = fieldList(room());
  assert.equal(list.lines.length, 4);
  assert.equal(fieldList(room(), [], { limit: 2 }).lines.length, 2);
  assert.throws(() => fieldList(room(), [], { limit: 0 }), FieldListError);
});

test('it carries what the scanner said, so the disagreement shows up on the spot', () => {
  const list = fieldList(room());
  assert.ok(list.text.includes(`Scan says:  20'`), list.text);
  // Apple's 50 mm, in the units the person holding the tape is working in.
  assert.ok(list.text.includes('could be out by 1 15/16"'), list.text);
  assert.ok(list.text.includes('Measured:   ______________________'), 'somewhere to write');
});

test('it says why each wall is on the list', () => {
  const list = fieldList(room(), counter);
  const blocked = list.lines.find((l) => l.wallId === 'wall-3')!;
  // Named, not counted. This line used to say "behind something" whatever it
  // was, and on a real scan the sentence beside it printed RoomPlan's UUID.
  assert.match(blocked.why, /% of it was behind a storage unit/);

  const clear = list.lines.find((l) => l.wallId === 'wall-1')!;
  assert.equal(clear.why, 'nothing was in the way, but nobody has measured it');
});

test('an open span and an angled wall say so, because both are worth a second look', () => {
  const odd = room([
    w('wall-1', 'east', `12'`),
    w('wall-2', 'north', `6'`),
    {
      id: 'wall-3',
      heading: diagonal(parseLength(`5'`), { x: -3n, y: 4n }),
      length: scanned(parseLength(`5'`), parseLength(`50mm`), T0, 'roomplan'),
    },
    { ...w('opening-1', 'west', `9'`), open: true },
    w('wall-4', 'south', `10'`),
  ]);

  const list = fieldList(odd, [], { limit: 5 });
  assert.match(list.lines.find((l) => l.wallId === 'opening-1')!.why, /found no wall across this one/);
  assert.match(list.lines.find((l) => l.wallId === 'wall-3')!.why, /runs at an angle/);
});

test('the header says whether the room can go out yet', () => {
  assert.match(fieldList(room()).text, /cannot go out as a drawing until at least one wall/);

  const checked = room([
    { ...w('wall-1', 'east', `20'`), length: verified(parseLength(`20'`), 'sam', T1, 'laser') },
    { ...w('wall-2', 'north', `12'`), length: verified(parseLength(`12'`), 'sam', T1, 'laser') },
    w('wall-3', 'west', `20'`),
    w('wall-4', 'south', `12'`),
  ]);
  assert.match(fieldList(checked).text, /can already go out as a drawing. These would tighten it/);
});

test('a fully measured room produces an empty list rather than busywork', () => {
  const done = room(
    room().walls.map((wall) => ({ ...wall, length: verified(wall.length.value, 'sam', T1, 'laser') }))
  );
  assert.deepEqual(fieldList(done).lines, []);
  assert.match(fieldList(done).text, /can already go out as a drawing/);
});

test('the order is the punch list order: the measurement that buys the most, first', () => {
  const list = fieldList(room(), counter);
  // The two 20' walls put more area in doubt than the 12' ones, and of those the
  // blocked one outranks the clear one.
  assert.equal(list.lines[0]!.wallId, 'wall-3', 'the 20 foot wall behind the counter');
  assert.equal(list.lines[1]!.wallId, 'wall-1', 'the other 20 foot wall');
});

test('it is plain text a phone can send without mangling it', () => {
  const text = fieldList(room(), counter).text;
  assert.ok(!/[<>|]/.test(text), 'nothing a messaging app will treat as markup');
  assert.ok(text.split('\n').every((line) => line.length <= 72), 'fits a narrow screen and a printer');
  assert.ok(text.startsWith('kitchen — walls to measure'));
});

test('the date goes on it when there is one, so two visits are never confused', () => {
  assert.ok(!fieldList(room()).text.includes('Printed'));
  assert.ok(fieldList(room(), [], { at: '21 Aug 2026' }).text.includes('Printed 21 Aug 2026'));
});

test('it is built from the model, so a metric room reads in metric-sized numbers', () => {
  const metric = room([
    w('wall-1', 'east', `6000mm`),
    w('wall-2', 'north', `4000mm`),
    w('wall-3', 'west', `6000mm`),
    w('wall-4', 'south', `4000mm`),
  ]);
  const list = fieldList(metric);
  assert.equal(list.lines[0]!.scanned, 6n * NM_PER_METRE);
});
