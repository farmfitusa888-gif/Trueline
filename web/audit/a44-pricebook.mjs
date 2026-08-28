import { check, HEIGHT, noise, openAsApp, pick, report, reportEvenIfItDies, section, sentTo } from './lib.mjs';

// Say what was learned even if this part dies part way through.
reportEvenIfItDies('A44 — the book the money comes out of');

/**
 * The book the money comes out of, driven by every control on it.
 *
 * ## Why this part exists
 *
 * `check-controls.py` had seventeen controls on the money screens that no part
 * of this audit had ever named. Twelve of them are here: the whole of the price
 * list importer — the button that opens the file, the hidden input behind it,
 * and all five column pickers — the cancel on a store's Remove, the supplier
 * code on a shelf tag, and the three controls in the rate book that turn a
 * contractor's own item and his own won jobs into a rate.
 *
 * That is the state every one of this month's found-by-looking bugs was in. The
 * paywall compiled and nothing ever presented it. A refusal drew itself 280
 * pixels above the button that caused it. "Photograph it" sat inside a
 * collapsed row that gave no sign it opened. Every time, the control worked and
 * nothing had ever asked for it by name, so nothing had ever had the chance to
 * find out a person could not reach it.
 *
 * ## What is asked of them, which is not that they exist
 *
 * A checker can see that a button is in the source. Every check below states
 * something that would be false if the control were quietly broken:
 *
 *   1. **The importer is behind the gate, and it is on the far side of it.**
 *      With the app saying nobody has paid, there is no "Choose a price list"
 *      control at all and the screen says what the thing does. With the app
 *      saying somebody has, the control is there — and it is *whole inside a
 *      430 by 800 window* and the point in the middle of it belongs to the
 *      button rather than to something painted over the top.
 *   2. **The visible button really opens the file picker.** The input that
 *      takes the file is `sr-only`; a script that fed the input directly would
 *      pass with the button wired to nothing, which is what "Photograph it"
 *      was. So the file arrives through a `filechooser` the button opened.
 *   3. **The columns are confirmed, never assumed.** The fixture's headings are
 *      ones the guesser cannot read — "Sold by", "List", "Ref" — so the import
 *      refuses itself by name until three pickers are set by hand. Then a
 *      picker is deliberately pointed at the wrong column and the four rows of
 *      the person's own file underneath follow it. A picker that does not move
 *      the preview is a picker somebody confirms in good faith and cannot see.
 *   4. **A price nobody stated is refused, and then worked out exactly.** Tile
 *      is priced by the box and laid by the square foot. With "How much one
 *      covers" left unmapped, those rows are refused with the reason. Mapped,
 *      they come in at a rate this file computes **in integer cents**, by the
 *      same single rounding, written out here rather than imported — so the app
 *      and this script agreeing is evidence rather than a tautology.
 *   5. **Their code for it travels.** Typed on a shelf tag or mapped out of a
 *      file, the supplier's own code is on the price in the catalogue and on no
 *      other price.
 *   6. **"Keep it" keeps it.** A Remove that is cancelled leaves the store and
 *      every one of its prices exactly where they were. This project has
 *      already lost a contractor 53 photographs once.
 *   7. **A quantity he types is never reported as one the room measured.** An
 *      item charged by a number he types — "How many, each time", "Charged by
 *      the" — reaches the sheet saying so, in the line's own workings, and it
 *      is priced at his figure times his rate, to the cent.
 *   8. **"Use it" takes the middle of three won jobs and nothing else.** Three
 *      jobs are actually marked won through the app at three different rates,
 *      and the money on the sheet afterwards moves by exactly the difference
 *      between the rate that was there and the one he took.
 *
 * Nothing below imports anything from the app. Every string it looks for and
 * every figure it asserts is written out here.
 */

/* ------------------------------------------------------------- the fixtures */

const SHOP = 'Ashby Yard';

/**
 * A supplier's file, with the headings a supplier's system actually writes.
 *
 * None of "Sold by", "List" or "Ref" is a word the guesser knows, which is the
 * point: the guess lands the item and the coverage and nothing else, so the
 * three required pickers have to be set by a person before anything imports.
 *
 *   Ref    Name                    Sold by  Covers  List     what happens to it
 *   TL-1   12x24 porcelain tile    box      15.5    54.87    a box covers an area, so it converts
 *   BD-1   metal corner bead       LF       —       0.63     read straight off the file
 *   PL-2   6x36 wood-look plank    carton   24.75   71.40    a carton, likewise
 *   JC-9   joint compound          —        —       18.75    refused: no unit at all
 */
const HEADINGS = ['Ref', 'Name', 'Sold by', 'Covers', 'List'];
const YARD = [
  HEADINGS.join(','),
  'TL-1,"12x24 porcelain tile",box,15.5,54.87',
  'BD-1,"metal corner bead",LF,,0.63',
  'PL-2,"6x36 wood-look plank",carton,24.75,71.40',
  'JC-9,"joint compound, 4.5 gal",,,18.75',
].join('\n');

const COLUMN = Object.fromEntries(HEADINGS.map((h, i) => [h, String(i)]));

/** Two of the four rows are priced per box or carton, and two are not. */
const READ_STRAIGHT = 1;
const CONVERTED = 2;
/** Only the joint compound, which has no unit at all. */
const REFUSED_WITH_COVERAGE = 1;
/** Without the coverage column, the box and the carton go with it. */
const REFUSED_WITHOUT_COVERAGE = REFUSED_WITH_COVERAGE + CONVERTED;

/** What a shelf tag written down in the aisle says. */
const TAG = { item: 'sanded grout, 25 lb', cents: 1849n, code: 'GR-25', unit: 'ea' };

/** The contractor's own item, charged by a number he types rather than measures. */
// Charged by the linear foot, which is deliberately NOT the unit the box
// starts on: a control that is only ever left where it was found has not been
// driven, and "Charged by the" starts on `ea`.
const OWN = { item: 'Site protection, run of the job', each: '2', unit: 'lf', cents: 42500n };

/** The three won jobs, in the order they are marked. The middle one is the answer. */
const WON = [300n, 400n, 500n];
const LEARNED = 400n;
/** What the book says before he takes the learned one, so the move can be measured. */
const BEFORE_LEARNING = 999n;

/* ------------------------------------------------- what this side works out */

/** Money as this app prints it: `$1,234.56`. Written out, not imported. */
function dollars(cents) {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const grouped = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${grouped}.${(abs % 100n).toString().padStart(2, '0')}`;
}

/** A printed money figure back as whole cents, exactly. No floats anywhere. */
function cents(text) {
  const m = /(-?)\$?([\d,]+)\.(\d\d)/.exec(String(text));
  if (!m) return null;
  const value = BigInt(m[2].replace(/,/g, '')) * 100n + BigInt(m[3]);
  return m[1] === '-' ? -value : value;
}

/** A printed quantity as hundredths, exactly — the shape a rate multiplies. */
function hundredths(text) {
  const m = /^([\d,]+)(?:\.(\d{1,2}))?$/.exec(String(text).trim());
  if (!m) return null;
  return BigInt(m[1].replace(/,/g, '')) * 100n + BigInt((m[2] ?? '').padEnd(2, '0'));
}

/** Rate x quantity, rounded to the cent once, half away from zero. */
function lineTotal(rateCents, quantityHundredths) {
  const raw = rateCents * quantityHundredths;
  return raw < 0n ? (raw - 50n) / 100n : (raw + 50n) / 100n;
}

/**
 * A price per box, as a price per square foot — the whole sum, on this side.
 *
 * A box price is not a square-foot price and the app does not pretend it is: it
 * divides by the coverage printed on the box, exactly, in integers, rounding
 * once at the end. Written out here rather than imported so that this script
 * and `pricelist.ts` agreeing on $3.54 is two independent sums agreeing rather
 * than one sum compared with itself.
 */
function perSquareFoot(priceCents, coverageHundredths) {
  return (priceCents * 100n + coverageHundredths / 2n) / coverageHundredths;
}

const TILE = { price: 5487n, covers: 1550n };
const PLANK = { price: 7140n, covers: 2475n };
TILE.rate = perSquareFoot(TILE.price, TILE.covers);
PLANK.rate = perSquareFoot(PLANK.price, PLANK.covers);

/** Today, the way the date box writes it. */
const TODAY = new Date().toISOString().slice(0, 10);

/**
 * Where a control is, and whether a person could actually put a thumb on it.
 *
 * Three separate questions, and only the first has ever been asked in this
 * repository. `isVisible()` is true of a button four thousand pixels below the
 * fold. A box inside the window is still unusable if a bar is painted over it —
 * which is the shape of every one of this month's four bugs — so the point in
 * the middle of the control is hit-tested, and the answer has to be the control
 * itself or something inside it.
 *
 * The business screen is longer than a phone, so the control is scrolled to
 * first. That is what a person does. What is being proved is that once it has
 * been scrolled to it is WHOLE and it is on top — not that a long settings
 * page fits on a phone, which no settings page does.
 */
async function reachable(control) {
  await control.scrollIntoViewIfNeeded().catch(() => {});
  const box = await control.boundingBox();
  if (box === null) return { ok: false, said: 'it is not drawn at all' };
  const whole = box.y >= 0 && box.y + box.height <= HEIGHT;
  const mine = await control.evaluate((el) => {
    const at = el.getBoundingClientRect();
    const hit = document.elementFromPoint(at.x + at.width / 2, at.y + at.height / 2);
    // `el.contains(hit)` and nothing wider. A control whose middle belongs to
    // its own `<span>` is fine; one whose middle belongs to the section AROUND
    // it is a control the point is passing straight through, which is what a
    // dead button and a covered one both look like from here.
    return hit !== null && (el === hit || el.contains(hit));
  });
  return {
    box,
    ok: whole && mine,
    said:
      `top ${Math.round(box.y)}, bottom ${Math.round(box.y + box.height)} of ${HEIGHT}, ` +
      `${Math.round(box.height)} px tall, ` +
      (mine ? 'and the middle of it belongs to it' : 'but something else is painted over its middle'),
  };
}

/**
 * Every console error any of the six browsers this part opens has heard.
 *
 * `noise()` is reset by each `open`, so asking it once at the end asks about
 * the last browser only — and this part does its importing in one and its
 * pricing in another. A stray error on the screen that imports a price list
 * would never have been heard. So each one is emptied into here before it is
 * closed, and the check at the end is about all of them.
 */
const heard = [];
async function shutDown(one) {
  heard.push(...noise());
  await one.close().catch(() => {});
}

/**
 * Give up, out loud, with the checks that already ran still printed.
 *
 * A part that throws says nothing about the forty checks behind the throw, and
 * every mutation this part was tested against — a button wired to nothing, a
 * picker that does not move — is exactly the shape that makes the NEXT line
 * throw. So the structural gates stop here instead, and the report is the
 * report rather than a stack trace. a26 and a41 guard the same way.
 */
async function stop(why, closing) {
  check('there is nothing more of the book to drive without it', false, why);
  for (const one of closing) await shutDown(one);
  check('the book: no console or page errors', heard.length === 0, heard.join(' | '));
  report('A44 — the book the money comes out of');
  process.exit(1);
}

/** The rate book screen, as it is handed back to the app. Newest wins. */
async function profileFrom(page) {
  const said = await sentTo(page, 'company');
  return said.at(-1)?.company ?? '';
}

/* ==========================================================================
   1. The gate. Nobody has paid, so the importer is not there — and what
      stands in its place describes the thing rather than announcing a toll.
   ========================================================================== */

{
  const shut = await openAsApp({ subscribed: false }, {});
  await shut.page.goto(shut.page.url().replace(/#.*$/, '') + '#business', { waitUntil: 'networkidle' });
  await shut.page.waitForTimeout(700);

  // `.and(locator('button'))` because the box that takes the file carries the
  // same accessible name — deliberately, so a screen reader announces one
  // control rather than two — and it answers to `button` as well. What is
  // being asked about here is the thing a thumb lands on.
  const control = shut.page
    .getByRole('button', { name: 'Choose a price list' })
    .and(shut.page.locator('button'));
  check('with the app saying nobody has paid, there is no way into the price list at all',
    (await control.count()) === 0, `${await control.count()} controls`);

  const said = await shut.page.locator('body').innerText();
  check('and the screen says what the thing does, rather than that it is locked',
    /price against what you actually pay/.test(said) && !/upgrade|unlock/i.test(said),
    said.slice(0, 400));
  await shutDown(shut.ctx);
}

/* ==========================================================================
   2. Paid for. The control is there, it is whole on a phone, and nothing is
      painted over it.
   ========================================================================== */

const { ctx, page } = await openAsApp({ subscribed: true }, {});
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
await page.goto(page.url().replace(/#.*$/, '') + '#business', { waitUntil: 'networkidle' });
await page.waitForTimeout(700);

const chooser = page
  .getByRole('button', { name: 'Choose a price list' })
  .and(page.locator('button'));
check('once it is paid for, there is exactly one way into the price list',
  (await chooser.count()) === 1, `${await chooser.count()} controls`);

if ((await chooser.count()) !== 1) {
  // `PaywallView` compiled, was in the target, passed nine checkers, and
  // nothing in the app ever presented it. This is that failure, on this
  // screen, and it has to stop the part rather than throw out of it.
  await stop('a paid screen a subscriber cannot reach is the paywall bug itself', [ctx]);
}
const at = await reachable(chooser);
check('and a person can actually put a thumb on it, whole, at a phone height', at.ok, at.said);
check('and it is big enough to be a target',
  at.box !== undefined && at.box.height >= 44,
  at.box ? `${Math.round(at.box.height)} px tall` : 'it is not drawn at all');

/* ==========================================================================
   3. The button opens the picker. The input that takes the file is `sr-only`
      and a script feeding it directly would pass over a dead button.
   ========================================================================== */

const hidden = page.locator('input[aria-label="Choose a price list"]');
// `sr-only` keeps it in the accessibility tree and takes it off the screen by
// clipping it to a pixel — so `isVisible()` is true of it and says nothing.
// What matters is that there is nothing here for a thumb to land on, which is
// the whole reason the button beside it has to work.
const hiddenBox = await hidden.boundingBox();
check('the box that takes the file is not something anybody could tap',
  (await hidden.count()) === 1
    && hiddenBox !== null && hiddenBox.width <= 1 && hiddenBox.height <= 1,
  `${await hidden.count()} found, ${hiddenBox ? `${hiddenBox.width} x ${hiddenBox.height}` : 'not drawn'}`);

async function giveTheFile() {
  // The wait is armed before the press, because the picker opens during it —
  // and it is given a catch of its own in the same breath. A press that opens
  // nothing would otherwise leave this promise rejecting on its own, and an
  // unhandled rejection takes the whole part down and prints no report at all,
  // which is the one thing an audit must never do about a broken control.
  const waiting = page.waitForEvent('filechooser', { timeout: 8000 });
  waiting.catch(() => {});
  await chooser.click({ timeout: 8000 });
  const picker = await waiting;
  await picker.setFiles({ name: 'ashby-august.csv', mimeType: 'text/csv', buffer: Buffer.from(YARD, 'utf8') });
  await page.waitForTimeout(600);
}

let opened = true;
try {
  await giveTheFile();
} catch (never) {
  opened = false;
  check('pressing the button a person can see opens the file picker behind it', false,
    String(never).slice(0, 200));
}
if (opened) {
  check('pressing the button a person can see opens the file picker behind it', true);
} else {
  await stop('nothing can be imported through a button that opens nothing', [ctx]);
}

const importer = page
  .locator('section', { has: page.getByRole('heading', { name: 'Your supplier’s prices' }) })
  .first();
let told = await importer.innerText();
check('the file is read, and the screen says how many rows are in it',
  /4 rows in this file/.test(told), told.slice(0, 600));

/* ==========================================================================
   4. The columns are confirmed, never assumed.
   ========================================================================== */

// Scoped to the importer, and anchored rather than exact. "The price" is a
// substring of "Photograph the price tag" one section down, and "Their code
// for it" is the name of a box on the shelf-tag form as well as of a picker
// here — two controls that are genuinely two controls, and a script that
// cannot tell them apart is a script that proves nothing about either. Exact
// is not available: a `<select>` wrapped in its own `<label>` takes the
// selected option into its accessible name, so the whole name of this one is
// "The price— pick a column —" and it changes as soon as anybody picks.
//
// And a picker is a `select`, which is what separates the column called
// "Their code for it" from the box of the same name on the shelf-tag form —
// the stores live INSIDE this section, deliberately, because "where do the
// numbers come from" is one question with two answers.
const picker = {
  item: importer.getByLabel(/^What the thing is/).and(page.locator('select')),
  unit: importer.getByLabel(/^What it is priced per/).and(page.locator('select')),
  price: importer.getByLabel(/^The price/).and(page.locator('select')),
  code: importer.getByLabel(/^Their code for it/).and(page.locator('select')),
  covers: importer.getByLabel(/^How much one covers/).and(page.locator('select')),
};

const pickers = await Promise.all(Object.values(picker).map((one) => one.count()));
check('there are five column pickers on the screen, one for each thing the file holds',
  pickers.every((n) => n === 1), pickers.join(', '));
if (!pickers.every((n) => n === 1)) {
  await stop('the columns cannot be confirmed when the pickers are not there', [ctx]);
}

check('the guess reads the two headings it can and says nothing about the rest',
  (await picker.item.inputValue()) === COLUMN.Name
    && (await picker.covers.inputValue()) === COLUMN.Covers
    && (await picker.unit.inputValue()) === ''
    && (await picker.price.inputValue()) === ''
    && (await picker.code.inputValue()) === '',
  `item ${await picker.item.inputValue()}, covers ${await picker.covers.inputValue()}, ` +
    `unit ${await picker.unit.inputValue()}, price ${await picker.price.inputValue()}, ` +
    `code ${await picker.code.inputValue()}`);

const bring = importer.getByRole('button', { name: /Bring these into my book|Pick the three columns above/ });
check('and with a column missing it refuses itself by name, rather than importing a guess',
  (await bring.innerText()).trim() === 'Pick the three columns above'
    && (await bring.isDisabled()) === true,
  `${(await bring.innerText()).trim()}, disabled ${await bring.isDisabled()}`);

/** The four rows of the person's own file, as the screen prints them back. */
const previewRow = () => importer.locator('table tr').first().innerText();

await picker.price.selectOption(COLUMN.Ref);
await page.waitForTimeout(200);
check('a picker pointed at the wrong column shows the wrong column in his own first row',
  /TL-1/.test(await previewRow()), await previewRow());

await picker.price.selectOption(COLUMN.List);
await page.waitForTimeout(200);
check('and pointed at the right one it shows the price that is in the file',
  /54\.87/.test(await previewRow()) && !/TL-1/.test(await previewRow()), await previewRow());

await picker.unit.selectOption(COLUMN['Sold by']);
await picker.code.selectOption(COLUMN.Ref);
await page.waitForTimeout(200);
check('the row says what it is, what it is sold by and what it costs, together',
  /12x24 porcelain tile/.test(await previewRow())
    && /box/.test(await previewRow())
    && /covers 15\.5/.test(await previewRow()),
  await previewRow());
check('and with the three of them picked the import offers itself',
  (await bring.innerText()).trim() === 'Bring these into my book'
    && (await bring.isDisabled()) === false,
  `${(await bring.innerText()).trim()}, disabled ${await bring.isDisabled()}`);

/* ==========================================================================
   5. A price nobody stated is refused rather than guessed at.
   ========================================================================== */

await picker.covers.selectOption('');
await page.waitForTimeout(200);
await importer.getByLabel('Whose list this is').fill(SHOP);
if (await bring.isDisabled()) {
  await stop('the import refuses to run with every column it asks for picked', [ctx]);
}
await bring.click();
await page.waitForTimeout(700);

told = await importer.innerText();
check(`with nothing said about coverage, only the ${READ_STRAIGHT} row that needs none comes in`,
  new RegExp(`${READ_STRAIGHT} price in your book`).test(told), told.slice(0, 700));
check(`and the other ${REFUSED_WITHOUT_COVERAGE} are each named with a reason`,
  new RegExp(`${REFUSED_WITHOUT_COVERAGE} rows not imported`).test(told), told.slice(0, 1200));
check('the tile is refused for the one thing nobody said: how much a box covers',
  /does not say how much one box covers/.test(told), told.slice(0, 1400));
check('and it says out loud that the number is not assumed',
  /a box of tile is whatever the box says/.test(told), told.slice(0, 1600));
check('nothing was converted, because nothing could be',
  !/worked out\s*\n?\s*rather than read/.test(told), told.slice(0, 900));

/* ==========================================================================
   6. Mapped, and every derived rate is the sum this script did, to the cent.
   ========================================================================== */

try {
  await giveTheFile();
} catch (never) {
  await stop(`the file could not be given a second time: ${String(never).slice(0, 120)}`, [ctx]);
}
await picker.unit.selectOption(COLUMN['Sold by']);
await picker.price.selectOption(COLUMN.List);
await picker.code.selectOption(COLUMN.Ref);
await picker.covers.selectOption(COLUMN.Covers);
await page.waitForTimeout(200);
await importer.getByLabel('Whose list this is').fill(SHOP);
if (await bring.isDisabled()) {
  await stop('the import refuses to run with every column it asks for picked', [ctx]);
}
await bring.click();
await page.waitForTimeout(700);

told = await importer.innerText();
check(`with the coverage mapped, ${READ_STRAIGHT + CONVERTED} prices come in`,
  new RegExp(`${READ_STRAIGHT + CONVERTED} prices in your book`).test(told), told.slice(0, 700));
check(`and only the ${REFUSED_WITH_COVERAGE} row with no unit at all is left out`,
  new RegExp(`${REFUSED_WITH_COVERAGE} row not imported`).test(told) && /no unit/.test(told),
  told.slice(0, 1200));
check(`${CONVERTED} of them say they were worked out rather than read`,
  new RegExp(`${CONVERTED} prices worked out\\s*\\n?\\s*rather than read`).test(told),
  told.slice(0, 900));

// The two sums, each written out on this side. $54.87 over 15.5 square feet is
// $3.54 and the app has to say $3.54 — not $3.53 from a float, and not $54.87
// against an area.
check('the tile is priced per square foot at the box price over what the box covers',
  told.includes(`${dollars(TILE.price)} per box ÷ 15.5 sq ft per box = ${dollars(TILE.rate)} / sq ft`),
  `expected ${dollars(TILE.rate)} / sq ft — ${told.slice(0, 1200)}`);
check('and the plank likewise, off its carton',
  told.includes(`${dollars(PLANK.price)} per carton ÷ 24.75 sq ft per carton = ${dollars(PLANK.rate)} / sq ft`),
  `expected ${dollars(PLANK.rate)} / sq ft — ${told.slice(0, 1200)}`);
check('and the sums are shown, so a person can check them rather than trust them',
  /The sum is kept on every one so you can check it/.test(told), told.slice(0, 1600));
check('and the screen says whose prices these have become, by name',
  told.includes(`${SHOP}’s own prices`), told.slice(0, 900));

/* ==========================================================================
   7. Their code for it — off the file, and off a tag in the aisle.
   ========================================================================== */

const stores = page
  .locator('section', { has: page.getByRole('heading', { name: 'The stores you buy at' }) })
  .last();
const catalogue = page
  .locator('section', { has: page.getByRole('heading', { name: 'What the stores charge' }) })
  .first();

await catalogue.getByLabel('Store', { exact: true }).selectOption({ label: SHOP });
await catalogue.getByLabel('Search what the stores charge').fill('porcelain');
await page.waitForTimeout(400);
let rows = await catalogue.innerText();
check('the imported tile is in the shop’s book at the rate that was worked out',
  new RegExp(`1 price at ${SHOP}`).test(rows) && rows.includes(dollars(TILE.rate)),
  rows.slice(0, 800));
check('and it carries the supplier’s own code, off the column that was mapped',
  /their code TL-1/.test(rows), rows.slice(0, 800));
// The sum is on the record. `pricelist.ts` says so in as many words -- "the sum
// is kept on every one so you can check it" -- and it has to be true of the
// stored sighting rather than only of the screen that did the importing, which
// is gone the moment anybody navigates away.
const kept = await page.evaluate(() => {
  try {
    const book = JSON.parse(window.localStorage.getItem('trueline.vendors.v1') ?? '{}');
    const one = (book.sightings ?? []).find((s) => s.item === '12x24 porcelain tile');
    return one ? { note: one.note ?? '', code: one.code ?? '' } : null;
  } catch {
    return null;
  }
});
check('and the shop’s own record keeps the sum that turned a box price into a rate',
  kept !== null
    && kept.code === 'TL-1'
    && kept.note ===
      `${dollars(TILE.price)} per box ÷ 15.5 sq ft per box = ${dollars(TILE.rate)} / sq ft`,
  JSON.stringify(kept));
// And it is worth knowing where that sum can be read back. It is on the record
// and it is on the importer's own screen for as long as somebody stays on it.
// The catalogue row does not carry it — see the integration note.
check('the catalogue says which shop and which file, on every row it shows',
  /Seen today · from their price list, ashby-august\.csv/.test(rows), rows.slice(0, 800));

/* --------------------------------------- the tag read rather than typed */

/*
 * Sam: *"WHY ARE THERE NO LIVE VENDOR PRICES? HOME DEPOT? FLOOR AND DECOR?
 * JUST PULL THEM LIVE FROM THE SITE AND HAVE THEM LIVE WITH THE SKUS."*
 *
 * Checked rather than assumed on 2026-08-28: Home Depot publishes no official
 * public API. What is on sale is third-party scraping, which costs per request,
 * breaks when the site changes, and returns the RETAIL price — not what a
 * contractor with a Pro account pays. So the phone reads the store's own code
 * off the tag exactly, and the price beside it is the one he can see.
 *
 * `openAsApp` installs a fake `barcode` handler, so this proves the page ASKS.
 * What the app does with the ask is Swift and only a device can answer it.
 */
const scan = stores.getByRole('button', { name: 'Scan the barcode on the tag' });
check('there is a way to read the code off the tag rather than type it',
  (await scan.count()) === 1,
  'the only way to get a store code in is to type it off a shelf in an aisle');

await scan.click();
await page.waitForTimeout(300);
const asked = await sentTo(page, 'barcode');
check('pressing it asks the app to read one, and asks for nothing else',
  asked.length === 1 && typeof asked[0].id === 'string' && asked[0].id.startsWith('barcode-'),
  JSON.stringify(asked));
check('and the page does not get to say which camera, or what to look for',
  Object.keys(asked[0] ?? {}).sort().join(',') === 'id,version',
  Object.keys(asked[0] ?? {}).join(', '));

// The answer, the way the app sends it back.
const SCANNED = '0074983401017';
await page.evaluate(([id, code]) => {
  window.trueline.scanned(id, code);
}, [asked[0].id, SCANNED]);
await page.waitForTimeout(300);
check('what the phone read lands in the box, character for character',
  (await stores.getByLabel('Their code for it').inputValue()) === SCANNED,
  await stores.getByLabel('Their code for it').inputValue());

// And a scan somebody backed out of leaves the box alone rather than emptying
// it — the box was there to type in before this button existed.
await stores.getByLabel('Their code for it').fill('typed-by-hand');
await scan.click();
await page.waitForTimeout(300);
const again = await sentTo(page, 'barcode');
await page.evaluate((id) => {
  window.trueline.scanned(id, null);
}, again[again.length - 1].id);
await page.waitForTimeout(300);
check('a scan nobody finished leaves what was typed exactly where it was',
  (await stores.getByLabel('Their code for it').inputValue()) === 'typed-by-hand',
  await stores.getByLabel('Their code for it').inputValue());

// The tag, in the aisle, with a code typed on it. The shop already exists,
// because importing the list made it.
await stores.getByLabel('Which store').selectOption({ label: SHOP });
await stores.getByLabel('What it is').fill(TAG.item);
await stores.getByLabel('What it costs').fill((Number(TAG.cents) / 100).toFixed(2));
await stores.getByLabel('Priced per').selectOption(TAG.unit);
await stores.getByLabel('Their code for it').fill(TAG.code);
await stores.getByLabel('Seen on').fill(TODAY);
await stores.getByRole('button', { name: 'Write it down' }).click();
await page.waitForTimeout(500);

told = await stores.innerText();
check('a price written down in the aisle goes in against the shop and the day',
  told.includes(`${dollars(TAG.cents)} / ${TAG.unit} for ${TAG.item} at ${SHOP}`) && told.includes(TODAY),
  told.slice(-700));

await catalogue.getByLabel('Search what the stores charge').fill('grout');
await page.waitForTimeout(400);
rows = await catalogue.innerText();
check('and the code typed with it is on it in the catalogue',
  new RegExp(`their code ${TAG.code}`).test(rows) && rows.includes(dollars(TAG.cents)),
  rows.slice(0, 700));

await catalogue.getByLabel('Search what the stores charge').fill('');
await catalogue.getByLabel('Store', { exact: true }).selectOption('');
await page.waitForTimeout(400);
rows = await catalogue.innerText();
check('a code belongs to the one price it was typed on, and to no other',
  (rows.match(new RegExp(`their code ${TAG.code}`, 'g')) ?? []).length === 1
    && (rows.match(/their code TL-1/g) ?? []).length === 1,
  rows.slice(0, 1200));

/* ==========================================================================
   8. "Keep it" keeps it — the store and every price in it.
   ========================================================================== */

const HELD = READ_STRAIGHT + CONVERTED + 1;
check('the shop is holding everything that has been written down at it',
  new RegExp(`${SHOP}\\s*\\n?\\s*${HELD} prices`).test(await stores.innerText()),
  (await stores.innerText()).slice(0, 600));

await stores.getByRole('button', { name: `Remove ${SHOP}` }).click();
await page.waitForTimeout(300);
told = await stores.innerText();
check('asking to remove a shop says what it would take with it, before anything goes',
  new RegExp(`This takes the ${HELD} prices from ${SHOP} with it`).test(told), told.slice(0, 900));

const keep = stores.getByRole('button', { name: 'Keep it', exact: true });
const keepAt = await reachable(keep);
check('and the way out of it is beside the way through it, whole on the screen',
  keepAt.ok, keepAt.said);
await keep.click();
await page.waitForTimeout(400);

told = await stores.innerText();
check('keeping it leaves the shop exactly where it was, with every price still in it',
  new RegExp(`${SHOP}\\s*\\n?\\s*${HELD} prices`).test(told) && !/Removed /.test(told),
  told.slice(0, 900));
check('and the warning is gone, rather than sitting there over a shop nobody removed',
  !/This takes the/.test(told), told.slice(0, 900));
rows = await catalogue.innerText();
check('and the catalogue still holds all of them, to the cent',
  new RegExp(`${HELD} prices across your stores`).test(rows)
    && rows.includes(dollars(TILE.rate))
    && rows.includes(dollars(PLANK.rate))
    && rows.includes(dollars(TAG.cents)),
  rows.slice(0, 700));

/* ==========================================================================
   9. His own item, charged by a number he types.
   ========================================================================== */

const own = page
  .locator('div', { has: page.getByRole('heading', { name: 'Your own items' }) })
  .last();

// Measured items have no unit to choose: the unit is how it is measured, and
// offering a choice is how a square foot becomes a linear foot three steps
// later. So the two controls exist only for a typed quantity.
await own.getByLabel('Where its quantity comes from').selectOption('wall face');
await page.waitForTimeout(250);
check('an item the room measures is not offered a quantity to type, or a unit to charge in',
  (await own.getByLabel('How many, each time').count()) === 0
    && (await own.getByLabel('Charged by the').count()) === 0
    && /Charged by the sq ft, because that is how it is measured/.test(await own.innerText()),
  (await own.innerText()).slice(0, 500));

await own.getByLabel('Where its quantity comes from').selectOption('typed');
await page.waitForTimeout(250);
const eachTime = own.getByLabel('How many, each time');
const chargedBy = own.getByLabel('Charged by the');
check('and one he types is offered both, because neither can be worked out',
  (await eachTime.count()) === 1 && (await chargedBy.count()) === 1,
  `${await eachTime.count()} boxes, ${await chargedBy.count()} pickers`);
if ((await eachTime.count()) !== 1 || (await chargedBy.count()) !== 1) {
  await stop('an item charged by a number he types, with nowhere to type it, is not an item', [ctx]);
}

const eachAt = await reachable(eachTime);
check('the box for the number is whole on the screen, with nothing over it', eachAt.ok, eachAt.said);

await own.getByLabel('What you call it').fill(OWN.item);
await eachTime.fill(OWN.each);
await chargedBy.selectOption(OWN.unit);
await own.getByLabel('What it covers').fill('container, permit, haul');

// The box he types the money into is named for the unit he just chose. It is
// the same bug the business toggle had — a control announcing one thing while
// the screen said another — and here it is money: a rate typed into a box that
// says `per ea` and stored as `per lf` is a quote out by whatever the run is.
const priceBox = own.getByLabel(`What you charge, per ${OWN.unit}`);
check('the box for what he charges is named in the unit he chose to charge in',
  (await priceBox.count()) === 1,
  `${await priceBox.count()} boxes named "What you charge, per ${OWN.unit}"`);
if ((await priceBox.count()) !== 1) {
  await stop('a rate typed into a box named for another unit is a quote nobody can defend', [ctx]);
}
await priceBox.fill((Number(OWN.cents) / 100).toFixed(2));
await own.getByRole('button', { name: 'Add it to your rates' }).click();
await page.waitForTimeout(500);

told = await own.innerText();
check('the item goes into the book with his figure, his unit and his rate on it',
  told.includes(`${dollars(OWN.cents)} / ${OWN.unit}`)
    && /a number you type/.test(told)
    && new RegExp(`${OWN.each} each time`).test(told),
  told.slice(0, 900));

const withOwnItem = await profileFrom(page);
check('and the book goes back to the app with it on',
  withOwnItem.includes(OWN.item), withOwnItem.slice(0, 200));
await shutDown(ctx);

/* ==========================================================================
   10. Three jobs won at three rates, and the middle one on a tap.
   ========================================================================== */

/**
 * A room, priced at one wall-face rate, and marked won.
 *
 * Each pass is its own browser because that is the only honest way to make
 * three jobs: the job is keyed on the file name the app hands over, and the app
 * hands one room over per launch. The profile travels between them exactly as
 * it does on the phone — out through the `company` handler and back in on the
 * next payload — so what is being tested is the app's own record rather than
 * something this script assembled.
 */
async function winAJob(profile, room, fileName, faceRate) {
  const run = await openAsApp({ company: profile, subscribed: true, room, fileName });
  await section(run.page, 'Price');
  await run.page.getByRole('button', { name: /^(Your rates|Set your rates)$/ }).click();
  await run.page.waitForTimeout(400);
  for (const [label, value] of [
    ['Floor rate', '9.50'], ['Ceiling rate', '4.25'], ['Baseboard rate', '6.00'],
    ['Wall face rate', (Number(faceRate) / 100).toFixed(2)],
  ]) {
    const box = run.page.getByLabel(label);
    await box.fill(value);
    await box.blur();
    await run.page.waitForTimeout(80);
  }
  await run.page.getByRole('button', { name: 'Done', exact: true }).click();
  await run.page.waitForTimeout(400);
  await run.page.locator('[data-panel="price"]').getByRole('button', { name: 'Won', exact: true }).click();
  await run.page.waitForTimeout(400);
  const said = await run.page.locator('[data-panel="price"]').innerText();
  const carried = await profileFrom(run.page);
  await shutDown(run.ctx);
  return { profile: carried, said };
}

const { readFileSync } = await import('node:fs');
const { SP } = await import('./lib.mjs');
const dining = JSON.parse(readFileSync(`${SP}/dining.json`, 'utf8'));

let carried = withOwnItem;
for (const [n, rate] of WON.entries()) {
  const round = await winAJob(carried, dining, `Job ${n + 1}`, rate);
  carried = round.profile;
  check(`job ${n + 1} is marked won at ${dollars(rate)} a square foot`,
    new RegExp(`Marked won at`).test(round.said), round.said.slice(0, 300));
}

const last = await openAsApp({ company: carried, subscribed: true, room: dining, fileName: 'The one being priced' });

await section(last.page, 'Price');
await last.page.getByRole('button', { name: /^(Your rates|Set your rates)$/ }).click();
await last.page.waitForTimeout(400);
const faceBox = last.page.getByLabel('Wall face rate');
await faceBox.fill((Number(BEFORE_LEARNING) / 100).toFixed(2));
await faceBox.blur();
await last.page.waitForTimeout(300);

told = await last.page.locator('[data-panel="price"]').innerText();
check('what the won jobs say is offered beside the book rather than written into it',
  /What your won jobs say/.test(told) && (await faceBox.inputValue()) === '9.99',
  told.slice(0, 900));
check(`and what they say is the middle of the three, ${dollars(LEARNED)}, not the average and not the last`,
  new RegExp(`Wall face — ${dollars(LEARNED).replace(/\$/, '\\$')} / sq ft`).test(told)
    && !new RegExp(`Wall face — ${dollars(WON[2]).replace(/\$/, '\\$')}`).test(told),
  told.slice(0, 1200));
check('and it says which of his jobs it came from, all three of them',
  /from Job 1, Job 2, Job 3/.test(told), told.slice(0, 1200));

const suggestion = last.page.locator('li', { hasText: 'Wall face —' }).first();
const useIt = suggestion.getByRole('button', { name: 'Use it', exact: true });
check('there is a way to take what the won jobs say, on the line that says it',
  (await useIt.count()) === 1, `${await useIt.count()} controls`);
if ((await useIt.count()) !== 1) {
  await stop('a suggestion nobody can take is a suggestion nobody has', [last.ctx]);
}
const useAt = await reachable(useIt);
check('the way to take it is beside what it says, whole on the screen', useAt.ok, useAt.said);

await useIt.click();
await last.page.waitForTimeout(400);
check(`taking it puts ${dollars(LEARNED)} in the book, and nothing else`,
  (await faceBox.inputValue()) === (Number(LEARNED) / 100).toFixed(2)
    && (await last.page.getByLabel('Floor rate').inputValue()) === '9.50',
  `wall face ${await faceBox.inputValue()}, floor ${await last.page.getByLabel('Floor rate').inputValue()}`);

await last.page.getByRole('button', { name: 'Done', exact: true }).click();
await last.page.waitForTimeout(500);

/**
 * One line off the quote: what it is charged at, how much of it, and the money.
 */
function pricedAt(panel, item) {
  const line = new RegExp(`(?:^|\\n)${item}\\n([\\d,]+\\.?\\d*) (?:sq ft|lf|ea) at \\$([\\d,.]+)\\n(\\$[\\d,]+\\.\\d\\d)`).exec(panel);
  return line
    ? { quantity: line[1].replace(/,/g, ''), rate: cents(`$${line[2]}`), total: cents(line[3]) }
    : null;
}

let quote = await last.page.locator('[data-panel="price"]').innerText();
const face = pricedAt(quote, 'Wall face');
check('and the sheet prices the wall face at the rate he took, times what the room measures',
  face !== null && face.rate === LEARNED && face.total === lineTotal(LEARNED, hundredths(face.quantity)),
  JSON.stringify(face, (_k, v) => (typeof v === 'bigint' ? String(v) : v)));
check('which is exactly what it would have been at the rate he had, less the difference',
  face !== null
    && lineTotal(BEFORE_LEARNING, hundredths(face.quantity)) - face.total
      === lineTotal(BEFORE_LEARNING - LEARNED, hundredths(face.quantity)),
  face
    ? `${lineTotal(BEFORE_LEARNING, hundredths(face.quantity)) - face.total} vs ` +
      `${lineTotal(BEFORE_LEARNING - LEARNED, hundredths(face.quantity))}`
    : 'no wall face line');

/* ==========================================================================
   11. And his own typed item, on a wall, on the sheet, never as a measurement.
   ========================================================================== */

await section(last.page, 'Plan');
await pick(last.page, /^Wall wall-5,/);
await last.page.getByRole('button', { name: 'Say what is being done' }).first().click();
await last.page.waitForTimeout(500);

const tick = last.page.locator(`input[aria-label="${OWN.item} on wall-5"]`);
check('the item he invented is offered on a wall, because he said where its quantity comes from',
  (await tick.count()) === 1, `${await tick.count()} boxes`);
if ((await tick.count()) !== 1) {
  await stop('an item that cannot be ticked on a wall never reaches a sheet', [last.ctx]);
}
await tick.check();
await last.page.waitForTimeout(500);

await section(last.page, 'Takeoff');
const sheet = await last.page.locator('[data-panel="takeoff"]').innerText();
check('it reaches the sheet at the number he typed, in the unit he chose',
  new RegExp(`${OWN.item}\\n[^\\n]*\\n${OWN.each} ${OWN.unit}`).test(sheet), sheet.slice(0, 2000));
check('and the sheet says out loud that the number was typed, not measured',
  new RegExp(`${OWN.item}\\n[^\\n]*a number typed by hand — it does not move when the room does`)
    .test(sheet), sheet.slice(0, 2000));

await section(last.page, 'Price');
quote = await last.page.locator('[data-panel="price"]').innerText();
const haulage = pricedAt(quote, OWN.item);
check('and it is priced at his figure times his rate, to the cent',
  haulage !== null
    && haulage.rate === OWN.cents
    && haulage.total === lineTotal(OWN.cents, hundredths(OWN.each)),
  JSON.stringify(haulage, (_k, v) => (typeof v === 'bigint' ? String(v) : v)));

await shutDown(last.ctx);
check('the book: no console or page errors', heard.length === 0, heard.join(' | '));

process.exit(report('A44 — the book the money comes out of') === 0 ? 0 : 1);
