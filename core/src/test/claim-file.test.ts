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

test('a contractor who has set no rates sends the document he always sent', () => {
  // The money on this document is the restoration scope, and until there are
  // rates to price it with there is none. A claim that leaves the building
  // announcing that nothing has been priced is not a document anybody sends.
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

/* ------------------------------------------- the drawing has to survive the trip */

/**
 * The plan the app actually serialises, cut down to what matters here.
 *
 * Not invented for the test: `Plan.tsx` paints every fill and stroke as
 * `rgb(var(--c-...))`, and `planSvg` clones that element straight out of the
 * page. This is that element's own spelling.
 */
const REAL_PLAN =
  '<svg viewBox="0 0 980 978" xmlns="http://www.w3.org/2000/svg" width="980" height="978">' +
  '<rect x="0" y="0" width="980" height="978" fill="rgb(var(--c-raise))"/>' +
  '<line x1="10" y1="10" x2="900" y2="10" stroke="rgb(var(--c-ink))" stroke-width="6"/>' +
  '<line x1="10" y1="40" x2="400" y2="40" stroke="rgb(var(--c-refuse))" stroke-width="14"/>' +
  '<text x="20" y="90" fill="rgb(var(--c-derived))">20&#39; 0&quot;</text>' +
  '</svg>';

test('the drawing arrives as a drawing and not as a black rectangle', () => {
  // ## The bug this is the answer to
  //
  // > "The claim document has a black square where the drawing should be."
  //
  // The plan's colours are custom properties declared on the app's own :root.
  // Serialised out of that document and pasted into this one, `var(--c-raise)`
  // resolves to nothing — and CSS does not ignore that, it invalidates the
  // whole declaration, so `fill` falls back to its initial value, which is
  // black. The full-bleed background rectangle paints black over everything and
  // every stroke on top of it disappears. Measured on the real claim file
  // before the fix: 99.7% of the drawing was rgb(0, 0, 0).
  const html = claimFile({
    rooms: [{ room, damages: [waterline], plan: REAL_PLAN, photos: shots }],
    claim: full,
    company: EMPTY_COMPANY,
    at: '26 Aug 2026',
  });

  // Not one `var()` may leave the app inside a drawing. This is the check that
  // fails when the drawing goes blank.
  assert.doesNotMatch(html, /var\(--/, 'a colour left as a variable resolves to black out here');

  // And the resolved values are the paper palette from `design.ts`, which is
  // the same place `web/src/tokens.css` is generated from. `--c-raise` is
  // #FFFFFF and `--c-ink` is #14181B.
  assert.match(html, /fill="rgb\(255 255 255\)"/);
  assert.match(html, /stroke="rgb\(20 24 27\)"/);
  // The damage is still drawn in the refusal red, #A31212.
  assert.match(html, /stroke="rgb\(163 18 18\)"/);
});

test('a var() that is not a colour is left exactly as it was', () => {
  // The selected wall's pulse hands its two widths to the stylesheet as custom
  // properties on the element itself, which travel with it. Only `--c-` names
  // come from a stylesheet this document does not have, and only those go
  // black — so only those are resolved. A function that rewrote every var()
  // would be one that knew about things that are not its business.
  const html = claimFile({
    rooms: [
      {
        room,
        damages: [],
        plan:
          '<svg viewBox="0 0 10 10" style="--picked-halo:14">' +
          '<line stroke-width="var(--picked-halo)" stroke="rgb(var(--c-ink))"/></svg>',
        photos: new Map(),
      },
    ],
    claim: full,
    company: EMPTY_COMPANY,
    at: '26 Aug 2026',
  });
  assert.match(html, /stroke-width="var\(--picked-halo\)"/);
  assert.match(html, /stroke="rgb\(20 24 27\)"/);
});

test('a colour the shared palette does not have is refused, not left to go black', () => {
  // The only way this can happen is a drawing painting with a token nobody
  // generated. Left in, it is the black rectangle again — on the one document
  // that goes to somebody who pays.
  assert.throws(
    () =>
      claimFile({
        rooms: [
          {
            room,
            damages: [],
            plan: '<svg viewBox="0 0 10 10"><rect fill="rgb(var(--c-invented))"/></svg>',
            photos: new Map(),
          },
        ],
        claim: full,
        company: EMPTY_COMPANY,
        at: '26 Aug 2026',
      }),
    /--c-invented/
  );
});

/* ------------------------------------------------------------- and the money */

/** What a contractor who has set his restoration rates looks like. */
const withRates = {
  ...EMPTY_COMPANY,
  prices: {
    rates: [
      { item: 'Remove wall board', unit: 'sq ft' as const, cents: 250n, source: { kind: 'typed' as const, by: 'sam', at: T0 } },
      { item: 'Remove baseboard', unit: 'lf' as const, cents: 120n, source: { kind: 'typed' as const, by: 'sam', at: T0 } },
      { item: 'Hang wall board', unit: 'sq ft' as const, cents: 420n, source: { kind: 'typed' as const, by: 'sam', at: T0 } },
      { item: 'Tape and finish', unit: 'sq ft' as const, cents: 230n, source: { kind: 'typed' as const, by: 'sam', at: T0 } },
      { item: 'Replace baseboard', unit: 'lf' as const, cents: 675n, source: { kind: 'typed' as const, by: 'sam', at: T0 } },
      { item: 'Prime and paint the wall', unit: 'sq ft' as const, cents: 145n, source: { kind: 'typed' as const, by: 'sam', at: T0 } },
    ],
  },
};

test('the damage is priced on the document, and it is the damage and not the room', () => {
  // ## Why this is on a document that carried no money for months
  //
  // > "IT DOESNT AUTOMATICALLY PRICE OUT THE DAMAGE BUT INSTEAD IF YOU GO TO
  // >  THE PRICING IS SHOW YOU THE ENTIRE ROOM AND THE FLOOR AND CEILING WHICH
  // >  ARE NOT CHECK FOR BEING NEEDED"
  //
  // Worked out by hand. The mark is 9' x 2' on the north wall of a 20 x 10 room
  // with a 9 ft ceiling and no openings anywhere in it:
  //
  //   remove board    18.0 sq ft x $2.50 =  $45.00
  //   remove base      9.00 lf   x $1.20 =  $10.80
  //   hang board      18.0 sq ft x $4.20 =  $75.60
  //   tape            18.0 sq ft x $2.30 =  $41.40
  //   replace base     9.00 lf   x $6.75 =  $60.75
  //   paint           the whole north face, 20' x 9' = 180.0 sq ft x $1.45 = $261.00
  //                                                                          -------
  //                                                                          $494.55
  const html = claimFile({
    rooms: [{ room, damages: [waterline], plan: '', photos: shots }],
    claim: full,
    company: withRates,
    at: '26 Aug 2026',
  });

  assert.match(html, /What it takes to put right/);
  assert.match(html, /Remove wall board<span>18\.0 sq ft at \$2\.50 \/ sq ft<\/span><\/th><td>\$45\.00/);
  assert.match(html, /Prime and paint the wall<span>180\.0 sq ft at \$1\.45 \/ sq ft<\/span><\/th><td>\$261\.00/);
  assert.match(html, /The damage, priced<\/th><td>\$494\.55/);
  assert.match(html, /Total<\/th><td>\$494\.55/);
  // And on the job's own totals, which is the figure an adjuster is looking for.
  assert.match(html, /What it takes to put right<\/th><td>\$494\.55/);

  // The room's remodel takeoff is a different sheet for a different payer, and
  // none of it may appear here. Nothing said the floor or the ceiling needed
  // doing, so neither is on the document as work.
  assert.doesNotMatch(html, /Replace floor finish/);
  assert.doesNotMatch(html, /Replace ceiling finish/);
  assert.match(html, /not a remodel of these rooms/);
  assert.doesNotMatch(html, /No prices appear on this document/);
});

test('two rooms are one figure, added as money and never as printed strings', () => {
  const other: Room = { ...room, id: 'r2', name: 'utility' };
  const second: Damage = { ...waterline, id: 'd-2', photos: [] };
  const html = claimFile({
    rooms: [
      { room, damages: [waterline], plan: '', photos: shots },
      { room: other, damages: [second], plan: '', photos: new Map() },
    ],
    claim: full,
    company: withRates,
    at: '26 Aug 2026',
  });
  // The same mark in two identical rooms: $494.55 twice is $989.10.
  assert.match(html, /What it takes to put right<\/th><td>\$989\.10/);
});

test('an item with no rate is named on the document rather than counted as nothing', () => {
  const short = {
    ...EMPTY_COMPANY,
    prices: {
      rates: [
        { item: 'Hang wall board', unit: 'sq ft' as const, cents: 420n, source: { kind: 'typed' as const, by: 'sam', at: T0 } },
      ],
    },
  };
  const html = claimFile({
    rooms: [{ room, damages: [waterline], plan: '', photos: shots }],
    claim: full,
    company: short,
    at: '26 Aug 2026',
  });
  // 18.0 sq ft at $4.20 is $75.60, and that is all of it.
  assert.match(html, /Total<\/th><td>\$75\.60/);
  assert.match(html, /Not in the figure above:/);
  assert.match(html, /Remove wall board/);
  assert.match(html, /which have no rate set/);
});
