import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLength } from '../length.ts';
import { scanned, verified, verify } from '../measurement.ts';
import type { Heading, Room, Wall } from '../room.ts';
import type { Damage } from '../damage.ts';
import { type Claim, claimReport } from '../claim.ts';
import { EMPTY_COMPANY } from '../company.ts';
import { PAGE, type Pen, drawClaim, wrap } from '../claim-pdf.ts';

/**
 * The claim document's PDF layout, driven by a pen that records.
 *
 * The whole reason the layout knows nothing about pdf-lib: a page of drawing
 * calls can be checked, and a PDF cannot — not here, without a viewer. So every
 * question worth asking is asked of what was drawn and where, and the real pen
 * in `web/src/claimPdf.ts` is the thin half that turns those into bytes.
 */

const T0 = '2026-08-26T09:00:00Z';
const scan = (text: string) => scanned(parseLength(text), parseLength(`50mm`), T0, 'roomplan');
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
  note: 'water line along the north wall, supply line let go behind the washer',
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

/* --------------------------------------------------- a pen that writes down */

interface Drawn {
  readonly text: { value: string; x: number; y: number; size: number; bold: boolean; page: number }[];
  readonly images: { id: string; x: number; y: number; width: number; height: number; page: number }[];
  readonly lines: { from: { x: number; y: number }; to: { x: number; y: number }; page: number }[];
  pages: number;
}

/**
 * Character widths that behave like a proportional font.
 *
 * Not a real metric and it does not have to be: what matters is that wide
 * letters are wider than narrow ones, so a wrap that counted characters would
 * be caught. Helvetica's real widths are pdf-lib's problem.
 */
function recorder(): { pen: Pen; drawn: Drawn } {
  const drawn: Drawn = { text: [], images: [], lines: [], pages: 1 };
  const width = (value: string, size: number, bold?: boolean) => {
    let units = 0;
    for (const c of value) units += 'ilj.,;:\'| '.includes(c) ? 0.3 : 'MW@'.includes(c) ? 0.95 : 0.55;
    return units * size * (bold ? 1.06 : 1);
  };
  const pen: Pen = {
    newPage() { drawn.pages += 1; },
    text(value, at, style) {
      drawn.text.push({ value, x: at.x, y: at.y, size: style.size, bold: style.bold ?? false, page: drawn.pages });
    },
    widthOf: width,
    line(from, to) { drawn.lines.push({ from, to, page: drawn.pages }); },
    image(id, box) { drawn.images.push({ id, ...box, page: drawn.pages }); },
    // A tall photograph, so the fitting has something to do.
    ratioOf() { return 4 / 3; },
  };
  return { pen, drawn };
}

const report = claimReport(room, [waterline], full, '26 Aug 2026');
const photos = new Map([['d-1', ['damage-d-1-1.jpg']]]);
const draw = (over: Partial<Parameters<typeof drawClaim>[1]> = {}) => {
  const { pen, drawn } = recorder();
  const pages = drawClaim(pen, {
    report,
    company: EMPTY_COMPANY,
    photos,
    at: '26 Aug 2026',
    ...over,
  });
  return { drawn, pages };
};

/* ------------------------------------------------------------- the wrapping */

test('lines wrap on real widths, not on a character count', () => {
  // "MMMM" is three times the width of "iiii" in any proportional font, so a
  // wrap that counted characters would put some lines off the page.
  const { pen } = recorder();
  const wide = wrap(pen, 'MMMM MMMM MMMM MMMM', 100, 10);
  const narrow = wrap(pen, 'iiii iiii iiii iiii', 100, 10);
  assert.ok(wide.length > narrow.length, `${wide.length} vs ${narrow.length}`);
  for (const line of [...wide, ...narrow]) {
    assert.ok(pen.widthOf(line, 10) <= 100 || !line.includes(' '), `too wide: ${line}`);
  }
});

test('a word longer than the line is put on its own line rather than dropped', () => {
  const { pen } = recorder();
  const out = wrap(pen, 'short WWWWWWWWWWWWWWWWWWWWWWWWWW short', 60, 10);
  assert.ok(out.join(' ').includes('WWWWWWWWWWWWWWWWWWWWWWWWWW'), out.join(' | '));
});

/* ------------------------------------------------------- what is on the page */

test('everything the report says reaches the page', () => {
  const { drawn } = draw();
  const all = drawn.text.map((t) => t.value).join(' ');
  assert.match(all, /CLM-88412/);
  assert.match(all, /Ruth Alvarez/);
  assert.match(all, /burst pipe/);
  assert.match(all, /water damage to north/);
  assert.match(all, /18\.0 sq ft of wall face/);
  assert.match(all, /Drying: 28 down to 14/);
  assert.match(all, /28 %MC/);
  assert.match(all, /THESE ARE A SCANNER/);
});

test('a report with no rates behind it carries no price, and says so', () => {
  // The same rule the HTML has, checked the same way. `report` above is built
  // without a rate book, which is a contractor who has not set his restoration
  // prices yet, and a document announcing that is not one anybody sends.
  const { drawn } = draw();
  const all = drawn.text.map((t) => t.value).join(' ');
  assert.doesNotMatch(all, /\$/);
  assert.match(all, /No prices appear on this document/);
});

test('nothing is drawn outside the page', () => {
  // The failure that only shows up in a viewer: text at a negative y, or past
  // the right edge, is simply not there and nothing says so.
  const { drawn } = draw();
  for (const t of drawn.text) {
    assert.ok(t.y >= 0 && t.y <= PAGE.height, `"${t.value}" at y=${t.y}`);
    assert.ok(t.x >= 0 && t.x < PAGE.width, `"${t.value}" at x=${t.x}`);
  }
  for (const i of drawn.images) {
    assert.ok(i.y >= 0, `${i.id} at y=${i.y}`);
    assert.ok(i.x + i.width <= PAGE.width, `${i.id} runs off the right`);
  }
});

test('the photograph is drawn full width, and fits on its page', () => {
  const { drawn } = draw();
  assert.equal(drawn.images.length, 1);
  const shot = drawn.images[0]!;
  assert.equal(shot.width, PAGE.width - 108, 'the full text width');
  assert.ok(shot.height <= PAGE.height - 108, 'a tall photograph is capped to the page');
  assert.ok(shot.y >= 0);
});

/* ----------------------------------------------------------- paging */

test('a claim too long for one page runs onto the next', () => {
  const many = Array.from({ length: 14 }, (_, i) => ({ ...waterline, id: `d-${i}`, photos: [] }));
  const long = claimReport(room, many, full, '26 Aug 2026');
  const { pen, drawn } = recorder();
  const pages = drawClaim(pen, {
    report: long,
    company: EMPTY_COMPANY,
    photos: new Map(),
    at: '26 Aug 2026',
  });
  assert.ok(pages > 1, `fourteen damages fitted on ${pages} page`);
  assert.equal(drawn.pages, pages, 'the count and the pen agree');
  // And nothing on any page is off it.
  for (const t of drawn.text) assert.ok(t.y >= 0 && t.y <= PAGE.height, `${t.value} at ${t.y}`);
});

test('a photograph that will not fit starts a new page rather than hanging off', () => {
  const three = new Map([['d-1', ['a.jpg', 'b.jpg', 'c.jpg']]]);
  const { pen, drawn } = recorder();
  drawClaim(pen, { report, company: EMPTY_COMPANY, photos: three, at: '26 Aug 2026' });
  assert.equal(drawn.images.length, 3);
  for (const i of drawn.images) assert.ok(i.y >= 0, `${i.id} at y=${i.y}`);
  assert.ok(drawn.pages >= 2, 'three tall photographs do not fit on one page');
});

/* ---------------------------------------------------------- the letterhead */

test('the contractor’s own name heads it, and ScanToBid is the line underneath', () => {
  const { drawn } = draw({
    company: { ...EMPTY_COMPANY, name: 'Gilbert Remodeling', licence: 'RC-4412' },
  });
  const all = drawn.text.map((t) => t.value);
  assert.equal(all[0], 'Gilbert Remodeling', 'first thing on the page');
  assert.ok(all.some((t) => /Licence RC-4412/.test(t)));
  assert.equal(all[all.length - 1], 'Gilbert Remodeling · made with ScanToBid');
});

test('with no profile it still signs itself honestly', () => {
  const { drawn } = draw();
  const all = drawn.text.map((t) => t.value);
  assert.equal(all[0], 'ScanToBid');
  assert.equal(all[all.length - 1], 'Made with ScanToBid');
});

test('a room with nothing marked says so rather than looking finished', () => {
  const bare = claimReport(room, [], full, '26 Aug 2026');
  const { pen, drawn } = recorder();
  drawClaim(pen, { report: bare, company: EMPTY_COMPANY, photos: new Map(), at: '26 Aug 2026' });
  assert.match(drawn.text.map((t) => t.value).join(' '), /Nothing marked in this room/);
});

test('what the claim is still missing is on the document', () => {
  const thin = claimReport(room, [waterline], { on: true, claimNumber: 'CLM-1' }, '26 Aug 2026');
  const { pen, drawn } = recorder();
  drawClaim(pen, { report: thin, company: EMPTY_COMPANY, photos: new Map(), at: '26 Aug 2026' });
  assert.match(drawn.text.map((t) => t.value).join(' '), /This document is missing/);
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
  const { pen, drawn } = recorder();
  drawClaim(pen, {
    report: claimReport(measured, [waterline], full, '26 Aug 2026'),
    company: EMPTY_COMPANY,
    photos: new Map(),
    at: '26 Aug 2026',
  });
  const all = drawn.text.map((t) => t.value).join(' ');
  assert.doesNotMatch(all, /THESE ARE A SCANNER/);
  assert.match(all, /has had a tape measure on it|tape on it/);
});

test('a photograph fills the space left when there is enough of it', () => {
  // "Full size or a new page" left half of page one empty, which reads as a bug
  // rather than as a decision. A short claim leaves room, so the photograph
  // takes it — narrower than full width, because the proportion is kept.
  // A claim with only a number on it, and no meter readings, leaves most of
  // page one. The photograph takes what is left — 338pt of the 792, narrower
  // than full width because the proportion is kept rather than the width.
  const short = claimReport(
    room,
    [{ ...waterline, readings: [], note: 'water line' }],
    { on: true, claimNumber: 'CLM-88412' },
    '26 Aug 2026'
  );
  const { pen, drawn } = recorder();
  drawClaim(pen, { report: short, company: EMPTY_COMPANY, photos, at: '26 Aug 2026' });
  const shot = drawn.images[0]!;
  assert.equal(shot.page, 1, 'there was room, so it stayed');
  assert.ok(shot.height >= 216, `squeezed to ${shot.height}, below the three-inch floor`);
  assert.ok(shot.width < 504, 'narrower than full width, because it kept its shape');
});

test('a photograph below the three-inch floor takes a fresh page at full size', () => {
  // The other half of the same rule. Below three inches a water line stops
  // being evidence and starts being a smudge.
  const { drawn } = draw();
  const shot = drawn.images[0]!;
  assert.equal(shot.page, 2, 'the readings left too little of page one');
  assert.equal(shot.width, 504, 'so it gets the whole width');
  assert.ok(shot.y >= 54 - 1, `bottom at ${shot.y}`);
});

test('a photograph is never squeezed out of proportion', () => {
  // A photograph stretched to fit is a photograph of a different room.
  const { drawn } = draw();
  for (const shot of drawn.images) {
    // The recorder's pen reports 4:3, so height/width must stay 4/3 unless the
    // width was the binding constraint.
    const ratio = shot.height / shot.width;
    assert.ok(Math.abs(ratio - 4 / 3) < 0.001, `drawn at ${ratio.toFixed(3)}, not 4:3`);
  }
});

test('a photograph with nothing left of the page takes a fresh one', () => {
  // Below three inches a water line stops being evidence and starts being a
  // smudge, so it moves rather than being crushed.
  const many = Array.from({ length: 4 }, (_, i) => `p${i}.jpg`);
  const { pen, drawn } = recorder();
  drawClaim(pen, {
    report,
    company: EMPTY_COMPANY,
    photos: new Map([['d-1', many]]),
    at: '26 Aug 2026',
  });
  assert.equal(drawn.images.length, 4);
  for (const shot of drawn.images) {
    assert.ok(shot.height >= 216, `${shot.id} at ${shot.height}`);
    assert.ok(shot.y >= 54 - 1, `${shot.id} bottom at ${shot.y}`);
    assert.ok(shot.y + shot.height <= PAGE.height - 54 + 1, `${shot.id} top off the page`);
  }
});

/* ------------------------------------------------------------- and the money */

/** The same report, priced at rates a contractor typed. */
const BOOK = {
  rates: [
    { item: 'Remove wall board', unit: 'sq ft' as const, cents: 250n, source: { kind: 'typed' as const, by: 'sam', at: T0 } },
    { item: 'Remove baseboard', unit: 'lf' as const, cents: 120n, source: { kind: 'typed' as const, by: 'sam', at: T0 } },
    { item: 'Hang wall board', unit: 'sq ft' as const, cents: 420n, source: { kind: 'typed' as const, by: 'sam', at: T0 } },
    { item: 'Tape and finish', unit: 'sq ft' as const, cents: 230n, source: { kind: 'typed' as const, by: 'sam', at: T0 } },
    { item: 'Replace baseboard', unit: 'lf' as const, cents: 675n, source: { kind: 'typed' as const, by: 'sam', at: T0 } },
    { item: 'Prime and paint the wall', unit: 'sq ft' as const, cents: 145n, source: { kind: 'typed' as const, by: 'sam', at: T0 } },
  ],
};

const pricedReport = claimReport(room, [waterline], full, '26 Aug 2026', undefined, BOOK);

test('the damage is priced on the PDF, with the workings beside every figure', () => {
  // The same arithmetic as the HTML, on the same room, done by hand:
  //
  //   remove board    18.0 sq ft x $2.50 =  $45.00
  //   remove base      9.00 lf   x $1.20 =  $10.80
  //   hang board      18.0 sq ft x $4.20 =  $75.60
  //   tape            18.0 sq ft x $2.30 =  $41.40
  //   replace base     9.00 lf   x $6.75 =  $60.75
  //   paint           180.0 sq ft x $1.45 = $261.00
  //                                         -------
  //                                         $494.55
  const { drawn } = draw({ report: pricedReport });
  const all = drawn.text.map((t) => t.value).join(' | ');

  assert.match(all, /What it takes to put right/);
  assert.match(all, /Remove wall board — 18\.0 sq ft at \$2\.50 \/ sq ft/);
  assert.match(all, /Prime and paint the wall — 180\.0 sq ft at \$1\.45 \/ sq ft/);
  assert.match(all, /\$261\.00/);
  assert.match(all, /The damage, priced/);
  assert.match(all, /\$494\.55/);
  // Beside the mark it came off, not only at the bottom of the page.
  assert.match(all, /Putting this right: \$494\.55/);
  // And the room's remodel takeoff is nowhere near it.
  assert.doesNotMatch(all, /Replace floor finish/);
  assert.doesNotMatch(all, /No prices appear on this document/);
  assert.match(all, /not a remodel of this room/);
});

test('a priced claim still draws nothing outside the page', () => {
  // The money is several more rows on a page that was already full, and text
  // pushed past the bottom is text that is simply not in the file.
  const { drawn } = draw({ report: pricedReport });
  for (const t of drawn.text) {
    assert.ok(t.y >= 0 && t.y <= PAGE.height, `"${t.value}" at y=${t.y}`);
    assert.ok(t.x >= 0 && t.x < PAGE.width, `"${t.value}" at x=${t.x}`);
  }
});
