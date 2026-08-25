import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength } from '../length.ts';
import { scanned, verified, verify } from '../measurement.ts';
import type { Heading, Room, Wall } from '../room.ts';
import type { Damage } from '../damage.ts';
import { type Claim, NO_CLAIM } from '../claim.ts';
import { EMPTY_COMPANY } from '../company.ts';
import { claimFile } from '../claim-file.ts';

/**
 * The one document that leaves the building.
 *
 * Everything tested here is a thing that would be discovered by an adjuster
 * rather than by the contractor: an unescaped apostrophe in somebody's name, a
 * price nobody meant to send, a photograph that quietly is not there. Each of
 * those is only found once, in front of the person it matters to.
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
  category: 2,
  note: 'water line along the north wall',
  recordedAt: T0,
  recordedBy: 'gilbert',
  photos: ['damage-d-1-1.jpg'],
  readings: [
    { at: '2026-08-26T09:00:00Z', value: 28, scale: '%MC', by: 'g' },
    { at: '2026-08-28T09:00:00Z', value: 14, scale: '%MC', by: 'g' },
  ],
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
  claimNumber: 'CLM-88412',
  dateOfLoss: '2026-08-18',
  cause: 'burst pipe',
  address: '14 Sycamore Rd',
  owner: { name: 'Ruth Alvarez' },
  adjuster: { name: 'D. Chen' },
};

const shots = new Map([['damage-d-1-1.jpg', 'data:image/jpeg;base64,AAAA']]);

const one = (over: Partial<Parameters<typeof claimFile>[0]> = {}) =>
  claimFile({
    rooms: [{ room, damages: [waterline], plan: '<svg viewBox="0 0 10 10"></svg>', photos: shots }],
    claim: full,
    company: EMPTY_COMPANY,
    at: '26 Aug 2026',
    ...over,
  });

/* ------------------------------------------------------- what it must not do */

test('no money appears on the document, ever', () => {
  // The scope and its cost are a separate sheet sent after the scope is agreed.
  // An adjuster who reads a number first negotiates against it.
  const html = one();
  assert.doesNotMatch(html, /\$/);
  assert.match(html, /No prices appear on this document/);
});

test('nothing is fetched: no script, no external source, no web font', () => {
  const html = one();
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /@import|fonts\.googleapis/);
  // The only src in it is a data URL — the photograph, embedded.
  for (const [, src] of html.matchAll(/src="([^"]*)"/g)) {
    assert.match(src!, /^data:/, `${src} is not embedded in the file`);
  }
});

test('anything a person typed is escaped', () => {
  // A homeowner called O'Brien & Sons, an adjuster who pasted a tag. Found once,
  // in front of the insurer, if it is not escaped here.
  const html = claimFile({
    rooms: [{ room: { ...room, name: 'the <b>basement</b>' }, damages: [], plan: '', photos: new Map() }],
    claim: { ...full, owner: { name: `O'Brien & Sons <script>alert(1)</script>` } },
    company: EMPTY_COMPANY,
    at: '26 Aug 2026',
  });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /O&#039;Brien &amp; Sons|O'Brien &amp; Sons/);
  assert.match(html, /the &lt;b&gt;basement&lt;\/b&gt;/);
});

/* ---------------------------------------------------------- what it must do */

test('the evidence is on it: the mark, its quantity, its workings, its readings', () => {
  const html = one();
  assert.match(html, /water damage to north/);
  assert.match(html, /18\.0 sq ft of wall face/);
  assert.match(html, /9&#039; along north|9' along north/);
  assert.match(html, /28 %MC/);
  assert.match(html, /14 %MC/);
  assert.match(html, /Drying: 28 down to 14/);
});

test('a photograph that is not on this device is named rather than left out', () => {
  // Silently missing evidence is the worst outcome: nobody notices it is gone.
  const html = claimFile({
    rooms: [{ room, damages: [waterline], plan: '', photos: new Map() }],
    claim: full,
    company: EMPTY_COMPANY,
    at: '26 Aug 2026',
  });
  assert.match(html, /A photograph named damage-d-1-1\.jpg belongs here/);
});

test('the caveat travels, in the same words the contractor sees', () => {
  assert.match(one(), /THESE ARE A SCANNER/);
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
  const html = claimFile({
    rooms: [{ room: measured, damages: [waterline], plan: '', photos: shots }],
    claim: full,
    company: EMPTY_COMPANY,
    at: '26 Aug 2026',
  });
  assert.doesNotMatch(html, /THESE ARE A SCANNER/);
  assert.match(html, /has had a tape measure on it/);
});

test('what the claim is still missing is said on the document', () => {
  const html = claimFile({
    rooms: [{ room, damages: [waterline], plan: '', photos: shots }],
    claim: { ...NO_CLAIM, on: true, claimNumber: 'CLM-1' },
    company: EMPTY_COMPANY,
    at: '26 Aug 2026',
  });
  assert.match(html, /Still to be filled in/);
  assert.match(html, /the date of loss/);
});

/* ------------------------------------------------------------- a whole job */

test('several rooms total across the job, not per room', () => {
  // A loss is argued as one number. A per-room total leaves whoever reads it
  // adding up by hand, and somebody adding up by hand gets a different answer.
  const other: Room = { ...room, id: 'r2', name: 'utility' };
  // The same shape of damage, on the other room's north wall.
  const second: Damage = { ...waterline, id: 'd-2', photos: [] };
  const html = claimFile({
    rooms: [
      { room, damages: [waterline], plan: '', photos: shots },
      { room: other, damages: [second], plan: '', photos: new Map() },
    ],
    claim: full,
    company: EMPTY_COMPANY,
    at: '26 Aug 2026',
  });
  assert.match(html, /Across these 2 rooms/);
  // 18 sq ft in each room is 36 across the job.
  assert.match(html, /Wall face affected<\/th><td>36\.0 sq ft/);
  assert.match(html, />basement</);
  assert.match(html, />utility</);
});

test('a room with nothing marked on it says so rather than looking complete', () => {
  const html = claimFile({
    rooms: [{ room, damages: [], plan: '', photos: new Map() }],
    claim: full,
    company: EMPTY_COMPANY,
    at: '26 Aug 2026',
  });
  assert.match(html, /Nothing marked in this room/);
  assert.match(html, /No damage is marked on this document/);
});

test('the contractor’s own name is on it, and Trueline is the line underneath', () => {
  const html = claimFile({
    rooms: [{ room, damages: [waterline], plan: '', photos: shots }],
    claim: full,
    company: { ...EMPTY_COMPANY, name: 'Gilbert Remodeling', licence: 'RC-4412' },
    at: '26 Aug 2026',
  });
  assert.match(html, /Gilbert Remodeling/);
  assert.match(html, /Licence RC-4412/);
  assert.match(html, /Gilbert Remodeling · made with Trueline/);
});

test('the drawing that was handed in is the drawing on the document', () => {
  const html = one({
    rooms: [
      {
        room,
        damages: [waterline],
        plan: '<svg viewBox="0 0 10 10"><line stroke="#dc2626"/></svg>',
        photos: shots,
      },
    ],
  });
  assert.match(html, /<svg viewBox="0 0 10 10"><line stroke="#dc2626"\/><\/svg>/);
});
