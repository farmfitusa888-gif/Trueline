import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength } from '../length.ts';
import { scanned, verified, verify } from '../measurement.ts';
import type { Heading, Room, Wall } from '../room.ts';
import type { Damage } from '../damage.ts';
import { claimReport } from '../claim.ts';
import { EMPTY_COMPANY } from '../company.ts';
import { NOT_AN_ESX, jobManifest, safeName } from '../job-file.ts';

/**
 * What the archive says about itself.
 *
 * The manifest is the part worth testing, because it is the part that stops
 * somebody pricing off a spreadsheet they pulled out of a zip without ever
 * seeing the drawing that says the numbers are a scanner's.
 */

const T0 = '2026-08-26T09:00:00Z';
const scan = (t: string) => scanned(parseLength(t), parseLength(`50mm`), T0, 'roomplan');
const w = (id: string, heading: Heading, length: string): Wall => ({ id, heading, length: scan(length) });

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
  category: 2,
  note: 'water line along the north wall',
  recordedAt: T0,
  recordedBy: 'gilbert',
  photos: [],
  readings: [],
  shape: {
    kind: 'patch',
    wallId: 'north',
    fromAlong: parseLength(`1'`),
    toAlong: parseLength(`10'`),
    fromHeight: 0n,
    toHeight: parseLength(`2'`),
  },
};

const contents = [
  { path: 'CLM-1 claim.html', what: 'the claim' },
  { path: 'basement takeoff.csv', what: 'what the room takes' },
];

const make = (over: Partial<Parameters<typeof jobManifest>[0]> = {}) =>
  jobManifest({
    report: claimReport(room, [waterline], { on: true, claimNumber: 'CLM-1' }, '26 Aug 2026'),
    company: EMPTY_COMPANY,
    claimNumber: 'CLM-1',
    at: '26 Aug 2026',
    contents,
    ...over,
  });

test('the caveat is in the archive, not only in the files inside it', () => {
  // Somebody opens the CSV in a spreadsheet, prices off it, and never sees the
  // drawing. The caveat has to be at a level above any one file.
  assert.match(make().caveat, /THESE ARE A SCANNER/);
});

test('the caveat changes when the room has actually been measured', () => {
  const measured: Room = {
    ...room,
    walls: room.walls.map((wall) =>
      wall.id === 'north' || wall.id === 'east'
        ? {
            ...wall,
            length: verify(wall.length, parseLength(wall.id === 'north' ? `20'` : `10'`), 'sam', T0, 'tape'),
          }
        : wall
    ),
  };
  const m = make({
    report: claimReport(measured, [waterline], { on: true, claimNumber: 'CLM-1' }, '26 Aug 2026'),
  });
  assert.doesNotMatch(m.caveat, /THESE ARE A SCANNER/);
});

test('it says out loud that it is not an ESX', () => {
  // A file that quietly is not an ESX is a file somebody sends to an adjuster
  // expecting Xactimate to open it.
  const m = make();
  assert.equal(m.notAnEsx, NOT_AN_ESX);
  assert.match(m.notAnEsx, /Xactimate will not open it/);
  assert.match(m.notAnEsx, /partnership with Verisk/);
});

test('everything put in is listed, with what it is for', () => {
  const m = make();
  assert.equal(m.contents.length, 2);
  for (const entry of m.contents) {
    assert.ok(entry.path.trim() !== '');
    assert.ok(entry.what.trim().length > 5, `${entry.path} is listed with barely a description`);
  }
});

test('what the claim is still missing travels with the archive', () => {
  assert.ok(make().missing.length > 0);
  assert.ok(make().missing.includes('the date of loss'));
});

test('a blank profile leaves the preparer off rather than saying nobody', () => {
  assert.equal(make().preparedBy, undefined);
  assert.equal(make({ company: { ...EMPTY_COMPANY, name: 'Gilbert Remodeling' } }).preparedBy,
    'Gilbert Remodeling');
});

/* -------------------------------------------------------------- file names */

test('a claim number with a slash in it does not become a folder', () => {
  // They have slashes. An archive that turns one into a directory puts a
  // photograph somewhere nothing looks for it.
  assert.equal(safeName('CLM/2026/88412', 'job'), 'CLM 2026 88412');
  assert.equal(safeName('..\\..\\etc', 'job'), '.. .. etc');
  assert.doesNotMatch(safeName('a/b', 'job'), /\//);
});

test('a name that cleans away to nothing falls back rather than being empty', () => {
  assert.equal(safeName('///', 'job'), 'job');
  assert.equal(safeName('   ', 'room'), 'room');
});

test('a very long name is cut rather than breaking an unzip', () => {
  assert.ok(safeName('x'.repeat(400), 'job').length <= 80);
});
