import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength } from '../length.ts';
import { scanned, toleranceOf, verified } from '../measurement.ts';
import { type Opening, type Room, area, closes, diagonal, isDiagonal, runLength, runOf } from '../room.ts';
import { verifyWall } from '../edit.ts';
import { readiness } from '../issue.ts';
import { PersistError, SAVE_FORMAT, decode, encode, loadProject, saveProject } from '../persist.ts';
import { fieldList } from '../fieldlist.ts';

const T0 = '2026-08-19T14:00:00Z';
const T1 = '2026-08-21T09:00:00Z';

function door(): Opening {
  return {
    id: 'door-1',
    kind: 'door',
    width: scanned(parseLength(`2' 8"`), parseLength(`2"`), T0, 'roomplan'),
    height: scanned(parseLength(`6' 10"`), parseLength(`2"`), T0, 'roomplan'),
    offsetFromStart: scanned(parseLength(`4'`), parseLength(`2"`), T0, 'roomplan'),
    sillHeight: scanned(0n, parseLength(`2"`), T0, 'roomplan'),
  };
}

/** Everything the model can hold: scanned, verified, an angle, an opening, a gap. */
function room(): Room {
  return {
    id: 'roomplan:floor-1',
    name: 'kitchen',
    walls: [
      {
        id: 'wall-1',
        heading: 'east',
        length: verified(parseLength(`12' 3 1/2"`), 'sam', T1, 'laser'),
        openings: [door()],
      },
      { id: 'wall-2', heading: 'north', length: scanned(parseLength(`6'`), parseLength(`50mm`), T0, 'roomplan') },
      {
        id: 'wall-3',
        heading: diagonal(parseLength(`5'`), { x: -3n, y: 4n }),
        length: scanned(parseLength(`5'`), parseLength(`50mm`), T0, 'roomplan'),
      },
      {
        id: 'opening-1',
        heading: 'west',
        length: scanned(parseLength(`9' 3 1/2"`), parseLength(`50mm`), T0, 'roomplan'),
        open: true,
      },
      { id: 'wall-4', heading: 'south', length: scanned(parseLength(`10'`), parseLength(`50mm`), T0, 'roomplan') },
    ],
    ceilingHeight: scanned(parseLength(`7' 11 1/2"`), parseLength(`50mm`), T0, 'roomplan'),
  };
}

/* ------------------------------------------------------------------ codec */

test('a bigint survives the trip, which JSON on its own cannot do', () => {
  assert.throws(() => JSON.stringify({ length: 1n }), TypeError, 'this is the problem being solved');

  const there = encode({ length: 3_657_600_000n, nested: [{ deep: -1n }, 0n] });
  const back = decode(there) as { length: bigint; nested: [{ deep: bigint }, bigint] };
  assert.equal(back.length, 3_657_600_000n);
  assert.equal(typeof back.length, 'bigint');
  assert.equal(back.nested[0].deep, -1n);
  assert.equal(back.nested[1], 0n);
});

test('a length is written as a decimal string a person can read', () => {
  assert.match(encode({ length: 3_657_600_000n }), /\{"length":\{"\$nm":"3657600000"\}\}/);
});

test('a number that is not a whole number of nanometres is refused, not rounded', () => {
  assert.throws(() => decode('{"length":{"$nm":"12.5"}}'), PersistError);
  assert.throws(() => decode('{"length":{"$nm":"twelve"}}'), PersistError);
  assert.throws(() => decode('{"length":{"$nm":123}}'), PersistError);
});

test('an area keeps every digit, which a double could not', () => {
  // A length in nanometres still fits a double — 100 metres is 1e11, and a
  // double is exact to 9e15. An *area* does not: this room is about 4.4e19
  // half-square-nanometres, four orders of magnitude past where a double stops
  // counting in ones. That is the number this codec exists for.
  const room20x12 = area({
    id: 'r',
    name: 'r',
    walls: [
      { id: 'a', heading: 'east', length: scanned(parseLength(`20'`), 0n, T0, 'roomplan') },
      { id: 'b', heading: 'north', length: scanned(parseLength(`12'`), 0n, T0, 'roomplan') },
      { id: 'c', heading: 'west', length: scanned(parseLength(`20'`), 0n, T0, 'roomplan') },
      { id: 'd', heading: 'south', length: scanned(parseLength(`12'`), 0n, T0, 'roomplan') },
    ],
    ceilingHeight: scanned(parseLength(`8'`), 0n, T0, 'roomplan'),
  }).value;

  assert.ok(room20x12 > BigInt(Number.MAX_SAFE_INTEGER), 'past what a double counts in ones');
  assert.equal((decode(encode({ x: room20x12 })) as { x: bigint }).x, room20x12);
  assert.equal((decode(encode({ x: room20x12 + 1n })) as { x: bigint }).x, room20x12 + 1n);
  // The two bigints differ by one. As doubles they are the same number.
  assert.notEqual(room20x12, room20x12 + 1n);
  assert.equal(Number(room20x12), Number(room20x12 + 1n), 'a double cannot tell them apart');
});

/* --------------------------------------------------------------- projects */

test('a corrected room comes back exactly as it went in', () => {
  const before = room();
  const after = loadProject(
    saveProject({ savedAt: T1, fileName: 'room.json', room: before, extras: {} })
  ).room;

  assert.deepEqual(after, before);
  assert.equal(closes(after), closes(before));
  assert.equal(area(after).value, area(before).value);
});

test('an angled wall comes back at the same angle, not near it', () => {
  const before = room();
  const after = loadProject(saveProject({ savedAt: T1, fileName: 'f', room: before, extras: {} })).room;

  const wall = after.walls.find((w) => w.id === 'wall-3')!;
  assert.ok(isDiagonal(wall.heading));
  assert.deepEqual(runOf(wall), runOf(before.walls[2]!), 'the run is the truth and it is exact');
  assert.equal(runLength(wall), parseLength(`5'`));
});

test('provenance survives: who measured what, when, and what it replaced', () => {
  const before = verifyWall(room(), 'wall-2', parseLength(`6' 1"`), 'sam', T1, 'tape').room;
  const after = loadProject(saveProject({ savedAt: T1, fileName: 'f', room: before, extras: {} })).room;

  const wall = after.walls.find((w) => w.id === 'wall-2')!;
  assert.equal(wall.length.provenance.kind, 'verified');
  assert.equal(toleranceOf(wall.length), 0n);
  assert.equal(
    wall.length.provenance.kind === 'verified' ? wall.length.provenance.supersedes?.value : -1n,
    parseLength(`6'`),
    'what the scanner said is still underneath it'
  );
  // And the guard reaches the same conclusion about the reloaded room.
  assert.deepEqual(readiness(after).blocking, readiness(before).blocking);
});

test('an open span and its opening-free-ness come back too', () => {
  const after = loadProject(saveProject({ savedAt: T1, fileName: 'f', room: room(), extras: {} })).room;
  const open = after.walls.find((w) => w.id === 'opening-1')!;
  assert.equal(open.open, true);
  assert.equal(open.openings, undefined);

  const withDoor = after.walls.find((w) => w.id === 'wall-1')!;
  assert.equal(withDoor.openings?.length, 1);
  assert.equal(withDoor.openings![0]!.sillHeight?.value, 0n);
});

test('whatever was kept alongside the room comes back with it', () => {
  const saved = saveProject({
    savedAt: T1,
    fileName: 'room.json',
    room: room(),
    extras: { report: { dropped: [{ length: parseLength(`4' 3"`) }] }, footprints: [{ id: 'sink' }] },
  });
  const back = loadProject(saved);
  assert.equal(back.fileName, 'room.json');
  assert.equal(back.savedAt, T1);
  assert.deepEqual(back.extras, {
    report: { dropped: [{ length: parseLength(`4' 3"`) }] },
    footprints: [{ id: 'sink' }],
  });
});

/* -------------------------------------------------------------- refusals */

test('a file from a different version is refused rather than guessed at', () => {
  const saved = JSON.parse(saveProject({ savedAt: T1, fileName: 'f', room: room(), extras: {} }));
  saved.formatVersion = SAVE_FORMAT + 1;
  assert.throws(
    () => loadProject(JSON.stringify(saved)),
    (e: unknown) => e instanceof PersistError && /saved by a different version/.test((e as Error).message)
  );
});

test('a room that no longer validates never reaches a screen that would draw it', () => {
  const saved = JSON.parse(saveProject({ savedAt: T1, fileName: 'f', room: room(), extras: {} }));
  saved.room.walls = saved.room.walls.slice(0, 2);
  assert.throws(() => loadProject(JSON.stringify(saved)));
});

test('rubbish is refused with something a person can act on', () => {
  assert.throws(
    () => loadProject('not json at all'),
    (e: unknown) => e instanceof PersistError && /could not be read/.test((e as Error).message)
  );
  assert.throws(() => loadProject('null'), PersistError);
  assert.throws(
    () => loadProject(JSON.stringify({ formatVersion: SAVE_FORMAT })),
    (e: unknown) => e instanceof PersistError && /no room in it/.test((e as Error).message)
  );
});

test('saving a room that does not close is refused at the door', () => {
  const broken: Room = {
    ...room(),
    walls: room().walls.map((w) => (w.id === 'wall-2' ? { ...w, heading: 'east' as const } : w)),
  };
  assert.throws(() => saveProject({ savedAt: T1, fileName: 'f', room: broken, extras: {} }));
});

/* ------------------------------------------------ and the list survives too */

test('the field list built from a reloaded room is the same list', () => {
  const before = room();
  const after = loadProject(saveProject({ savedAt: T1, fileName: 'f', room: before, extras: {} })).room;
  assert.equal(fieldList(after).text, fieldList(before).text);
});
