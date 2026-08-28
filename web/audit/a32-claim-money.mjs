import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { check, noise, open, pick, report, section, SP } from './lib.mjs';

/**
 * Two things Sam found on his own phone, on his own scan.
 *
 * ## 1. The claim document had a black square where the drawing should be
 *
 * > "I opened the claim HTML and the plan image is a solid black rectangle.
 * >  Everything around it is right."
 *
 * The plan paints with `fill="rgb(var(--c-raise))"` and `stroke="rgb(var(--c-ink))"`.
 * Those custom properties are declared once, on the app's own `:root`, and
 * `planSvg` clones that element **out** of the document that declares them. CSS
 * then does the worst possible thing with a `var()` that resolves to nothing:
 * it does not ignore the declaration, it invalidates it, so `fill` falls back
 * to its initial value — which is black — and `stroke` falls back to none. The
 * full-bleed background rectangle paints black across the whole viewBox and
 * every line on top of it disappears. Measured on the audit's own claim file
 * before the fix: **99.72% of the drawing was rgb(0, 0, 0)** and the background
 * rect's computed fill was `rgb(0, 0, 0)`.
 *
 * A drawing that is all one colour is detectable, so this samples the pixels of
 * the drawing in the document that actually left the app. That is the check
 * that fails when the drawing goes blank, and it fails on the old behaviour
 * rather than merely passing on the new one.
 *
 * ## 2. The damage was measured and priced nowhere he could find
 *
 * > "IT DOESNT AUTOMATICALLY PRICE OUT THE DAMAGE BUT INSTEAD IF YOU GO TO THE
 * >  PRICING IS SHOW YOU THE ENTIRE ROOM AND THE FLOOR AND CEILING WHICH ARE
 * >  NOT CHECK FOR BEING NEEDED"
 *
 * He was right about both screens. The takeoff prices the room because that is
 * what a takeoff is for; the damage was measured to the square foot. What did
 * not exist was the number in between — the marks he made, at his rates, adding
 * up. It is on the claim now, where it belongs, and the two sheets stay two
 * sheets: a remodel and a restoration go to two different payers.
 *
 * **Every figure asserted below is worked out on this side.** The mark is
 * 10' along wall-1 and 1'6" high, on a wall with no opening anywhere in it, so
 * it is 15.0 square feet and 10.00 feet of base by arithmetic anybody can do on
 * the back of an envelope. Every price is a rate this script typed multiplied
 * by a quantity the app printed. A screen that agrees with itself proves
 * nothing.
 *
 * It runs on `dining.json` — Sam's own scan. Nine walls, three doors, three
 * windows, an eleven-corner outline with a hallway coming off it.
 */

const cash = (text) => Number(String(text).replace(/[^0-9.]/g, ''));

/**
 * The words inside a PDF, out of its content streams.
 *
 * pdf-lib deflates every stream, so the text is not in the file as text, and it
 * writes each run as a hex string rather than as literal characters. So: inflate
 * every stream that will inflate — the fonts are streams too and are not meant
 * to be read — and decode every `<...> Tj` show-text operand out of the ones
 * that do. What comes back is what a person sees on the page.
 */
function readablePdf(bytes) {
  let out = '';
  const file = bytes.toString('latin1');
  for (const m of file.matchAll(/[^d]stream\r?\n/g)) {
    const from = m.index + m[0].length;
    const to = file.indexOf('endstream', from);
    if (to === -1) continue;
    let text;
    try {
      text = inflateSync(bytes.subarray(from, to)).toString('latin1');
    } catch {
      continue; // Not a deflated stream, or not one meant to be read.
    }
    for (const shown of text.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      const hex = shown[1];
      let run = '';
      for (let i = 0; i + 1 < hex.length; i += 2) {
        // WinAnsi, which is what pdf-lib encodes a standard font in. The only
        // bytes above ASCII this document has are the punctuation the app is
        // written with — an em dash and a curly apostrophe.
        const code = parseInt(hex.slice(i, i + 2), 16);
        run += code === 0x97 ? '-' : code === 0x92 ? "'" : String.fromCharCode(code);
      }
      out += run + '\n';
    }
  }
  return out;
}

/** The rates this script types, and prices everything against afterwards. */
const RATES = [
  ['Remove wall board', '2.50'],
  ['Remove floor finish', '1.75'],
  ['Remove ceiling finish', '1.80'],
  ['Remove baseboard', '1.20'],
  ['Clean and treat the opened cavity', '3.40'],
  ['Seal the affected surface', '1.10'],
  ['Hang wall board', '4.20'],
  ['Tape and finish', '2.30'],
  ['Replace floor finish', '8.50'],
  ['Replace ceiling finish', '5.60'],
  ['Replace baseboard', '6.75'],
  ['Prime and paint the wall', '1.45'],
];
const rateOf = Object.fromEntries(RATES);

/** Rate x quantity, rounded to the cent half away from zero, in this script. */
function lineTotal(rate, quantity) {
  return Math.round(Number(rate) * 100 * Math.round(quantity * 100)) / 100 / 100;
}

const { browser, ctx, page } = await open();
await page.setInputFiles('input[type=file][accept="application/json,.json"]', `${SP}/dining.json`);
await page.waitForTimeout(800);

/* ==========================================================================
   1. It is a claim, and it has a mark on it that measures something.
   ========================================================================== */

await section(page, 'Insurance');
await page.getByRole('button', { name: 'Turn it on' }).click();
await page.waitForTimeout(300);

const claim = page
  .locator('section', { has: page.getByRole('heading', { name: 'The claim' }) })
  .first();
await claim.getByLabel('Claim number').fill('CLM-90277');
await claim.getByLabel('Date of loss').fill('2026-08-20');
await claim.getByRole('button', { name: 'roof leak', exact: true }).click();
await claim.getByLabel('Property address').fill('9 Marlow Street');
await claim.getByLabel('Owner', { exact: true }).fill('J. Whitaker');
await claim.getByLabel('Adjuster', { exact: true }).fill('P. Okafor');
await page.waitForTimeout(200);

await section(page, 'Plan');
await page.waitForTimeout(400);
const walls = await page.getByRole('button', { name: /^Wall / }).count();
check('Sam’s own scan opens, with all nine of its walls', walls >= 9, `${walls} walls`);

// wall-1 is 13' 5" long with no door and no window anywhere in it, which is why
// this mark is on it: 10 feet of it, 1'6" high, is 15.0 square feet and nothing
// is deducted. That is arithmetic done here, not a figure read off the app.
await pick(page, /^Wall wall-1,/);
await page.waitForTimeout(300);
await page.getByRole('button', { name: '+ damaged area', exact: true }).first().click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Mould', exact: true }).first().click();
await page.getByLabel('What is it?').fill('mould behind the skirting where the roof leak ran down');
// Named by what each box asks rather than by where it sits in the row: the
// wall panel is a grid of three identical inputs, and a script that filled
// them by position would keep passing while the app asked three other
// questions.
await page.getByLabel(/^How far from the corner it starts/).fill('0');
await page.getByLabel(/^How wide it is/).fill('10');
await page.getByLabel(/^How high up the wall it goes/).fill(`1' 6"`);
await page.getByRole('button', { name: 'Mark it' }).click();
await page.waitForTimeout(600);

const marks = await page.locator('[data-marks="wall-1"]').innerText();
check('the mark measures what ten feet of wall a foot and a half high measures',
  /15\.0 sq ft/.test(marks), marks.slice(0, 400));

/* ==========================================================================
   2. Before any rate is typed, the claim says so instead of printing a zero.

      A confident $0.00 beside real damage is the one number on this document
      that could cost somebody the argument.
   ========================================================================== */

await section(page, 'Insurance');
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'The report' }).click();
await page.waitForTimeout(400);
let panel = await page.locator('[data-panel="claim"]').innerText();

check('with no rates set, the claim says none of the damage is priced',
  /None of this damage is priced yet/.test(panel), panel.slice(0, 900));
check('and it names what it could not price rather than counting it as nothing',
  /Remove wall board/.test(panel) && /Prime and paint the wall/.test(panel), panel.slice(0, 900));
check('and there is no money on it at all',
  /\$/.test(panel) === false, (panel.match(/\$[\d,.]+/g) || []).join(' '));

/* ==========================================================================
   3. The rates go in, on the restoration sheet, and the claim fills in.
   ========================================================================== */

await page.getByRole('button', { name: 'Your rates' }).click();
await page.waitForTimeout(400);
for (const [item, typed] of RATES) {
  const box = page.getByLabel(`${item} rate`);
  await box.fill(typed);
  await box.blur();
  await page.waitForTimeout(80);
}
await page.getByRole('button', { name: 'Done' }).click();
await page.waitForTimeout(500);

panel = await page.locator('[data-panel="claim"]').innerText();
check('the claim now prices the damage', /What it takes to put right/.test(panel),
  panel.slice(0, 700));

/* ---- every line, checked by multiplying it out on this side ---- */

/**
 * The priced lines the claim is showing: item, quantity, unit, rate, money.
 *
 * Read off the rendered text rather than out of the app's own state, because
 * what is being checked is what a person is looking at.
 */
const lines = [...panel.matchAll(
  /^(.+)\n([\d,]+\.\d+) (sq ft|lf) at \$([\d.]+) \/ (?:sq ft|lf)\n\$([\d,]+\.\d\d)$/gm
)].map((m) => ({
  item: m[1].trim(),
  quantity: Number(m[2].replace(/,/g, '')),
  unit: m[3],
  rate: Number(m[4]),
  amount: cash(m[5]),
}));

check('every priced line carries its quantity and the rate it was multiplied by',
  lines.length >= 7, `${lines.length} lines read: ${panel.slice(0, 1200)}`);

const wrong = lines.filter((l) => {
  const rate = rateOf[l.item];
  return rate === undefined
    || Number(rate) !== l.rate
    || Math.abs(lineTotal(rate, l.quantity) - l.amount) > 0.005;
});
check('and every one of them is the rate I typed times the quantity the room measured',
  wrong.length === 0,
  wrong.map((l) => `${l.item}: ${l.quantity} x ${l.rate} should be ${lineTotal(rateOf[l.item] ?? 0, l.quantity)}, showed ${l.amount}`).join(' | '));

// The two quantities this script decided, rather than read.
const board = lines.find((l) => l.item === 'Remove wall board');
const base = lines.find((l) => l.item === 'Remove baseboard');
check('the wall board comes out at ten feet by a foot and a half',
  board && board.quantity === 15 && Math.abs(board.amount - 37.5) < 0.005,
  JSON.stringify(board));
check('and the baseboard at the ten feet the damage runs along the floor',
  base && base.quantity === 10 && Math.abs(base.amount - 12) < 0.005,
  JSON.stringify(base));

// Mould, and only mould, buys the cavity treatment. A water mark would not.
check('mould buys the cavity treatment, off the same face that came out',
  lines.some((l) => l.item === 'Clean and treat the opened cavity' && l.quantity === 15),
  lines.map((l) => l.item).join(', '));

/* ---- paint is wider than the damage, and it is wider by the wall ---- */

const paint = lines.find((l) => l.item === 'Prime and paint the wall');
check('paint runs corner to corner rather than being feathered into the wall',
  paint && paint.quantity > 100, JSON.stringify(paint));

// Cross-checked against the two lengths the app puts on the screen: wall-1's
// own run, off the drawing, and the ceiling height off the room. Multiplied out
// here. Both are shown to the nearest quarter inch, so a quarter of a square
// foot of slack is left rather than pretending to precision the display does
// not have.
await section(page, 'Plan');
await page.waitForTimeout(400);

/** `13' 5 1/4"` as feet, fractions included. */
function feetInchesToFeet(text) {
  const m = /(\d+)['’]\s*(?:(\d+)\s*)?(?:(\d+)\/(\d+)\s*)?["”]?/.exec(text ?? '');
  if (!m) return 0;
  const inches = Number(m[2] ?? 0) + (m[3] ? Number(m[3]) / Number(m[4]) : 0);
  return Number(m[1]) + inches / 12;
}

const runFeet = feetInchesToFeet(
  await page.getByRole('button', { name: /^Wall wall-1,/ }).first().getAttribute('aria-label')
);
await section(page, 'Room');
await page.waitForTimeout(400);
const ceilingFeet = feetInchesToFeet(
  /How high is the ceiling\?\s*\n\s*(.+)/.exec(
    await page.locator('[data-panel="room"]').innerText()
  )?.[1]
);
check('and the wall it paints is the wall it is on, by the room’s own two lengths',
  runFeet > 0 && ceilingFeet > 0 && Math.abs(runFeet * ceilingFeet - paint.quantity) < 0.25,
  `wall-1 reads ${runFeet.toFixed(3)} ft by ${ceilingFeet.toFixed(3)} ft, ` +
  `so ${(runFeet * ceilingFeet).toFixed(2)} sq ft against ${paint?.quantity}`);

/* ---- the total is the lines added up, and nothing else ---- */

await section(page, 'Insurance');
await page.waitForTimeout(400);
panel = await page.locator('[data-panel="claim"]').innerText();

const mine = lines.reduce((sum, l) => sum + l.amount, 0);
const shown = cash(/The damage, priced\n\$([\d,]+\.\d\d)/.exec(panel)?.[1] ?? '0');
check('the claim’s figure is the lines added up, to the cent',
  Math.abs(shown - mine) < 0.005, `mine ${mine.toFixed(2)}, shown ${shown.toFixed(2)}`);

const perMark = cash(/Putting this right:\s*\$([\d,]+\.\d\d)/.exec(panel)?.[1] ?? '0');
check('and the same figure is beside the mark it came off',
  Math.abs(perMark - mine) < 0.005, `mark ${perMark.toFixed(2)}, sheet ${mine.toFixed(2)}`);

/* ==========================================================================
   4. It is the damage that is priced, and never the room.

      This is the complaint. One damaged wall must not produce a floor, a
      ceiling, or the other eight walls.
   ========================================================================== */

check('nothing on the claim comes off a floor nobody marked',
  !/Replace floor finish|Remove floor finish/.test(panel), panel.slice(0, 2000));
check('nor off a ceiling nobody marked',
  !/Replace ceiling finish|Remove ceiling finish/.test(panel), panel.slice(0, 2000));
check('and it says on the screen that this is not a remodel of the room',
  /NOT a remodel of the room/i.test(panel), panel.slice(-1200));

// The remodel takeoff is untouched and still prices the whole room, floor and
// ceiling included. Two sheets, two payers, and neither has been collapsed into
// the other — which is the half of this that must NOT change.
await section(page, 'Price');
await page.waitForTimeout(400);
await page.getByRole('button', { name: /^(Set your rates|Your rates)$/ }).first().click();
await page.waitForTimeout(400);
for (const [item, typed] of [['Floor', '9.50'], ['Ceiling', '4.25'], ['Wall face', '3.75'], ['Baseboard', '6.00']]) {
  const box = page.getByLabel(`${item} rate`);
  await box.fill(typed);
  await box.blur();
  await page.waitForTimeout(80);
}
await page.getByRole('button', { name: 'Done' }).click();
await page.waitForTimeout(500);

const price = await page.locator('[data-panel="price"]').innerText();
const roomTotal = cash(/Total\n\$([\d,]+\.\d\d)/.exec(price)?.[1] ?? '0');
check('the room’s own takeoff still prices the whole room, floor and ceiling included',
  roomTotal > mine && /Floor/.test(price) && /Ceiling/.test(price),
  `room ${roomTotal.toFixed(2)} vs damage ${mine.toFixed(2)}`);

// And the claim does not budge. Remodel rates are a different book of prices
// for a different payer, and a claim that moved when a kitchen rate moved would
// be the two sheets quietly becoming one.
await section(page, 'Insurance');
await page.waitForTimeout(400);
panel = await page.locator('[data-panel="claim"]').innerText();
const afterKitchenRates = cash(/The damage, priced\n\$([\d,]+\.\d\d)/.exec(panel)?.[1] ?? '0');
check('and setting remodel rates moves the claim by nothing at all',
  Math.abs(afterKitchenRates - mine) < 0.005,
  `was ${mine.toFixed(2)}, now ${afterKitchenRates.toFixed(2)}`);
check('the claim still has no floor and no ceiling on it',
  !/Replace floor finish|Replace ceiling finish/.test(panel), panel.slice(0, 2000));

/* ==========================================================================
   5. The document that leaves the building carries both.
   ========================================================================== */

await section(page, 'Insurance');
await page.waitForTimeout(300);
const send = page
  .locator('section', { has: page.getByRole('heading', { name: 'Send it to the adjuster' }) })
  .first();
check('the send screen says what the file will be worth before it is built',
  /what it takes to put the marked damage right/i.test(await send.innerText()),
  (await send.innerText()).slice(0, 600));

const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  send.getByRole('button', { name: /Make the claim document/ }).click(),
]);
const saved = `${SP}/audit-claim-money.html`;
await download.saveAs(saved);

const doc = await ctx.newPage();
const asks = [];
doc.on('request', (r) => { if (!r.url().startsWith('file://')) asks.push(r.url()); });
await doc.goto('file://' + saved);
await doc.waitForTimeout(600);

const html = await doc.locator('body').innerText();
check('the claim document opens offline with nothing fetched', asks.length === 0, asks.join(', '));
// The line, not only the heading: the job's own totals carry the same words,
// so a document that had lost the priced breakdown would still match a heading.
check('the money is on the document, line by line with its workings',
  /Remove wall board\s*\n?\s*15\.0 sq ft at \$2\.50 \/ sq ft\s*\n?\s*\$37\.50/.test(html),
  html.slice(html.indexOf('What it takes'), html.indexOf('What it takes') + 500));

const onPaper = cash(/The damage, priced\s*\n?\s*\$([\d,]+\.\d\d)/.exec(html)?.[1] ?? '0');
check('and it is the same figure the screen showed, to the cent',
  Math.abs(onPaper - mine) < 0.005, `screen ${mine.toFixed(2)}, document ${onPaper.toFixed(2)}`);
check('the adjuster gets the figure in the job’s own totals as well',
  new RegExp(`What it takes to put right\\s*\\n?\\s*\\$${mine.toFixed(2)}`).test(html),
  html.slice(html.indexOf('Across'), html.indexOf('Across') + 400));
check('and the document says what that money is, and what it is not',
  /restoration scope only/.test(html) && /not a remodel of these rooms/.test(html),
  html.slice(-900));
check('the room’s remodel takeoff is nowhere on it',
  !/Replace floor finish|Replace ceiling finish/.test(html), html.slice(0, 2000));

/* ---- the PDF a carrier's system actually takes ---- */

// The PDF is laid out by arithmetic rather than printed from the HTML, so it is
// a second renderer reading the same report — and a second renderer is a second
// chance to be handed no rate book at all and quietly print a document with no
// money on it. The text is in the content stream uncompressed, so the figure
// can be read straight out of the bytes.
const [pdfDown] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  send.getByRole('button', { name: /As a PDF instead/ }).click(),
]);
const pdfPath = `${SP}/audit-claim-money.pdf`;
await pdfDown.saveAs(pdfPath);
const words = readablePdf(await readFile(pdfPath));
check('the PDF carries the same figure the HTML and the screen carry',
  words.includes(`$${mine.toFixed(2)}`), `looking for $${mine.toFixed(2)} in ${words.length} chars`);
check('and it carries the workings beside it, rather than a bare number',
  /Remove wall board .{1,3} 15\.0 sq ft at \$2\.50 \/ sq ft/.test(words),
  words.slice(words.indexOf('What it takes'), words.indexOf('What it takes') + 300));

/* ==========================================================================
   6. The drawing. Not a black square.
   ========================================================================== */

check('not one colour left the app as a variable it cannot resolve out here',
  (await doc.content()).includes('var(--c-') === false,
  ((await doc.content()).match(/var\(--c-[a-z-]+\)/g) || []).slice(0, 8).join(' '));

const plan = doc.locator('.plan svg').first();
check('the drawing is on the document at all', (await plan.count()) === 1);

await plan.scrollIntoViewIfNeeded();
const shot = await plan.screenshot();

/**
 * The pixels of the drawing, counted.
 *
 * This is the check that fails when the drawing goes blank. Before the fix the
 * same sample came back three distinct colours with 99.72% of them pure black;
 * a drawing is dozens of colours with no single one owning the whole frame.
 */
const pixels = await doc.evaluate(async (b64) => {
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = 'data:image/png;base64,' + b64;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const context = canvas.getContext('2d');
  context.drawImage(img, 0, 0);
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const seen = new Map();
  let black = 0;
  for (let i = 0; i < data.length; i += 4) {
    const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
    if (data[i] < 24 && data[i + 1] < 24 && data[i + 2] < 24) black += 1;
  }
  const total = data.length / 4;
  const top = [...seen.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    distinct: seen.size,
    biggest: top[0],
    biggestShare: top[1] / total,
    blackShare: black / total,
  };
}, shot.toString('base64'));

check('the drawing is a drawing and not one flat colour',
  pixels.distinct > 20, `${pixels.distinct} distinct colours in it`);
check('and it is not the black square Sam opened',
  pixels.blackShare < 0.5, `${(pixels.blackShare * 100).toFixed(2)}% of it is black`);
check('it is drawn on paper, with ink on it rather than ink under everything',
  pixels.biggest === '255,255,255' && pixels.biggestShare > 0.4 && pixels.biggestShare < 0.995,
  `the commonest colour is ${pixels.biggest} at ${(pixels.biggestShare * 100).toFixed(2)}%`);

// The damage is still drawn on it, in the refusal colour — resolved now, which
// is the whole point: `rgb(var(--c-refuse))` out here is black.
check('and the damaged run is still marked on it, in a colour that resolves',
  (await doc.locator('svg line[stroke="rgb(163 18 18)"]').count()) >= 1,
  (await doc.content()).slice(0, 200));

check('no console or page errors across the whole run', noise().length === 0, noise().join(' | '));

const bad = report('A32 — the damage priced on the claim, and a drawing that is not black');
await ctx.close();
await browser.close();
process.exit(bad > 0 ? 1 : 0);
