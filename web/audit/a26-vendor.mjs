import { check, loadScan, noise, open, report, reportEvenIfItDies, section, SP } from './lib.mjs';

// Say what was learned even if this part dies part way through.
reportEvenIfItDies('A26 — the stores you buy at');

/**
 * The stores a contractor buys at, driven through the real app.
 *
 * > "AND WHAT ABOUT THE VENDOR PRICES? … CANT WE USE LIVE ONLINE PRICES …
 * >  BUILD IT OUT THE WAY I WANT"
 * >
 * > "1 AND ALSO 2 BUT IF YOU COULD DO IT FOR FREE SOMEHOW, FIGURE IT OUT"
 *
 * ## What is actually being proved
 *
 * There is no retailer price feed to check against — Home Depot, Lowe's and
 * Floor & Decor publish no public price API, and every retailer domain is
 * refused by this build environment's network policy besides. So what this
 * checks is the only thing that could ever have been checkable: that **every
 * number on this screen came from a named shop on a stated day**, and that the
 * app would rather say nothing than show one that did not.
 *
 * Six properties, in the order they would break:
 *
 *   1. A store is a book. Two shops are two books and cannot become one by a
 *      typo, and removing a shop takes its prices with it.
 *   2. A photographed shelf tag is evidence and never a source: the number is
 *      typed, and a price with no number written down is refused.
 *   3. A supplier's list lands in that shop's book AND in the rate book, and
 *      says how many of each.
 *   4. The dropdown, the search bar and the chips narrow it honestly — a chip
 *      that says two produces two, and a shop that has never quoted a thing is
 *      silent rather than showing somebody else's number.
 *   5. A price carries its age. One nobody has looked at since the spring says
 *      so, and what a shop's price has done is arithmetic on two figures the
 *      contractor wrote down himself.
 *   6. A store's price becomes a rate dated **when it was seen**, and it prices
 *      a real takeoff.
 *
 * **Every figure asserted below is worked out on this side.** The counts come
 * from reading `miller.csv` by hand — five rows that can be read, four that
 * cannot, and the reason for each is in a comment — and the percentages come
 * from integer arithmetic written out here rather than read back off the screen
 * that produced it.
 */

/* ------------------------------------------------------------ our own sums */

/**
 * What `miller.csv` holds, read by hand rather than by the code under test.
 *
 *   SKU     unit    price       what happens to it
 *   DW12    SF      0.42        imported
 *   BASE3   LF      1.18        imported
 *   DOOR30  EA      68.00       imported
 *   INS15   sheet   42.00       refused — a sheet covers an area the file does
 *                               not state, and 4x8 is true of 4x8 sheets only
 *   MUD5    (none)  18.75       refused — no unit
 *   TAPE    LF      not priced  refused — that is not a price
 *   DW12    SF      0.45        refused — the same thing twice; the first wins
 *   PAINT   EA      $41.99      imported
 *   CORNER  LF      $0.63       imported
 */
const IMPORTED = 5;
const REFUSED = 4;
/** Of the five: DW12. */
const SQ_FT = 1;
/** Of the five: BASE3 and CORNER. */
const LF = 2;
/** Of the five: DOOR30 and PAINT. Plus the shelf tag written down below. */
const EA_FROM_LIST = 2;

/** A day, N days back from today, the way the date box writes it. */
function daysAgo(n) {
  const at = new Date();
  at.setUTCDate(at.getUTCDate() - n);
  return at.toISOString().slice(0, 10);
}
const TODAY = daysAgo(0);

/**
 * The percentage the screen should print, worked out here in integers.
 *
 * Rounded half away from zero once, then to a tenth of a percent — the same two
 * roundings the app does, written out independently so that a change to either
 * of them shows up as a disagreement rather than as two screens agreeing.
 */
function moved(wasCents, nowCents) {
  const raw = (nowCents - wasCents) * 10000;
  const bp = Math.trunc((raw >= 0 ? raw + wasCents / 2 : raw - wasCents / 2) / wasCents);
  const tenths = Math.round(Math.abs(bp) / 10);
  return `${bp < 0 ? 'down' : 'up'} ${Math.trunc(tenths / 10)}.${tenths % 10}%`;
}

const { browser, ctx, page } = await open();

/* ==========================================================================
   1. A store is a book, and two shops cannot become one by a typo.
   ========================================================================== */

await page.goto(page.url().replace(/#.*$/, '') + '#/business', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

const stores = page
  .locator('section', { has: page.getByRole('heading', { name: 'The stores you buy at' }) })
  .last();
check('the stores you buy at are on the business screen', (await stores.count()) === 1);

async function addStore(name) {
  await stores.getByLabel('Add a store').fill(name);
  await stores.getByRole('button', { name: 'Add it', exact: true }).click();
  await page.waitForTimeout(250);
}
await addStore('Miller Lumber');
await addStore('Floor & Decor');
let t = await stores.innerText();
check('two shops are two books', /Miller Lumber/.test(t) && /Floor & Decor/.test(t), t.slice(0, 400));

await addStore('miller lumber');
t = await stores.innerText();
check('the same shop typed differently is refused rather than started twice',
  /already have a store called "Miller Lumber"/.test(t), t.slice(0, 600));
// Counted off the rows rather than off the words: the shop's name is in the
// list, in the shelf-tag dropdown and in the refusal, and a text count would
// go green on all three.
check('and it was not added a second time',
  (await stores.getByRole('button', { name: /^Remove / }).count()) === 2,
  t.slice(0, 600));

/* ==========================================================================
   2. The shelf tag. The photograph is evidence; the number is typed.
   ========================================================================== */

// Nothing written down before a shop is picked. A price from nowhere is the one
// thing this whole feature exists to make impossible.
await stores.getByLabel('What it is').fill('2x4 stud, 8 ft');
await stores.getByLabel('What it costs').fill('3.98');
await stores.getByRole('button', { name: 'Write it down' }).click();
await page.waitForTimeout(250);
t = await stores.innerText();
check('a price with no shop to have come from is refused',
  /no store in your list to file that under/.test(t), t.slice(-700));

await stores.getByLabel('Which store').selectOption({ label: 'Miller Lumber' });
await stores.getByLabel('Priced per').selectOption('ea');
await stores.getByLabel('Seen on').fill(TODAY);

// The photograph, then the number. Not the other way round, and never the
// photograph on its own.
await stores.locator('input[type=file][accept="image/*"]').setInputFiles(`${SP}/damage-photo.jpg`);
await page.waitForTimeout(700);
t = await stores.innerText();
check('a photographed tag says the number still has to be typed',
  /Now type the number that is on it/.test(t), t.slice(-700));

await stores.getByLabel('What it costs').fill('');
await stores.getByRole('button', { name: 'Write it down' }).click();
await page.waitForTimeout(250);
t = await stores.innerText();
check('a photograph with no number on it is not a price, and is refused',
  /is not an amount of money/.test(t), t.slice(-700));

await stores.getByLabel('What it costs').fill('3.98');
await stores.getByRole('button', { name: 'Write it down' }).click();
await page.waitForTimeout(400);
t = await stores.innerText();
check('with the number typed, the price is written down against the shop and the day',
  /\$3\.98 \/ ea for 2x4 stud, 8 ft at Miller Lumber/.test(t) && t.includes(TODAY),
  t.slice(-700));
check('and the shop’s book has one price in it',
  /Miller Lumber\s*\n?\s*1 price\b/.test(t), t.slice(0, 500));

// Tomorrow has not happened. A price seen then would sit at the top of the
// list of what things cost for ever, and would never go stale.
await stores.getByLabel('What it is').fill('a thing from the future');
await stores.getByLabel('What it costs').fill('1.00');
await stores.getByLabel('Seen on').fill(daysAgo(-1));
await stores.getByRole('button', { name: 'Write it down' }).click();
await page.waitForTimeout(250);
t = await stores.innerText();
check('a price seen tomorrow is refused', /has not happened yet/.test(t), t.slice(-600));
check('and nothing from the future is in the book',
  /Miller Lumber\s*\n?\s*1 price\b/.test(t), t.slice(0, 500));

/* ==========================================================================
   3. A supplier's list, into that shop's book and into the rate book.
   ========================================================================== */

await page.locator('input[type=file][accept=".csv,text/csv"]').setInputFiles(`${SP}/miller.csv`);
await page.waitForTimeout(500);
await page.getByLabel('Whose list this is').fill('Miller Lumber');
await page.getByRole('button', { name: 'Bring these into my book' }).click();
await page.waitForTimeout(600);

const importer = page
  .locator('section', { has: page.getByRole('heading', { name: /supplier/i }) })
  .first();
t = await importer.innerText();
check(`the ${IMPORTED} rows that can be read become rates`,
  new RegExp(`${IMPORTED} prices in your book`).test(t), t.slice(0, 500));
check(`and the ${REFUSED} that cannot are each named with a reason`,
  new RegExp(`${REFUSED} rows not imported`).test(t), t.slice(0, 900));
check('the same rows are written down as that shop’s own prices, dated today',
  new RegExp(`${IMPORTED} of them are written down as`).test(t) && /Miller Lumber’s own prices/.test(t),
  t.slice(0, 800));
check('and the screen says plainly that a shop’s price is not what he charges',
  /what they\s*\n?\s*charge you/.test(t) && /mark-up goes on/.test(t), t.slice(0, 900));

t = await stores.innerText();
check('the shop’s book now holds the tag and the list together',
  new RegExp(`Miller Lumber\\s*\\n?\\s*${IMPORTED + 1} prices`).test(t), t.slice(0, 500));

/* ==========================================================================
   4. The dropdown, the search bar and the chips.
   ========================================================================== */

const shops = page
  .locator('section', { has: page.getByRole('heading', { name: 'What the stores charge' }) })
  .first();
check('the catalogue is on the screen', (await shops.count()) === 1);

t = await shops.innerText();
check('every price the shops have quoted is there',
  new RegExp(`${IMPORTED + 1} prices across your stores`).test(t), t.slice(0, 400));

// The one thing it must never do. Floor & Decor has quoted nothing, and the
// app must say so rather than showing Miller's numbers under its name.
await shops.getByLabel('Store', { exact: true }).selectOption({ label: 'Floor & Decor' });
await page.waitForTimeout(300);
t = await shops.innerText();
check('a shop that has never quoted anything shows nothing',
  /0 prices at Floor & Decor/.test(t), t.slice(0, 500));
check('and says out loud that it will not put another shop’s number there',
  /will not show you\s*\n?\s*another shop’s number/.test(t), t.slice(0, 700));
check('no price from the other shop leaked into it',
  !/3-1\/4 in base/.test(t) && !/\$0\.63/.test(t), t.slice(0, 700));

await shops.getByLabel('Store', { exact: true }).selectOption({ label: 'Miller Lumber' });
await page.waitForTimeout(300);

// Every word has to appear. "drywall" is in exactly one of the six.
await shops.getByLabel('Search what the stores charge').fill('drywall');
await page.waitForTimeout(300);
t = await shops.innerText();
check('the search bar narrows to the one thing that matches',
  /1 price at Miller Lumber matching “drywall”/.test(t), t.slice(0, 500));
check('and it is the drywall', /1\/2 in drywall, 4x8/.test(t), t.slice(0, 600));

await shops.getByLabel('Search what the stores charge').fill('drywall porcelain');
await page.waitForTimeout(300);
t = await shops.innerText();
check('two words that are not both in anything find nothing, rather than either',
  /0 prices at Miller Lumber/.test(t), t.slice(0, 400));
await shops.getByLabel('Search what the stores charge').fill('');
await page.waitForTimeout(300);

// The chips, counted off the data. Worked out on this side from the CSV above.
async function chip(name) {
  return shops.getByRole('button', { name }).count();
}
check(`there is a square-foot chip reading ${SQ_FT}`, (await chip(`Per sq ft ${SQ_FT}`)) === 1);
check(`a linear-foot chip reading ${LF}`, (await chip(`Per lf ${LF}`)) === 1);
check(`an each chip reading ${EA_FROM_LIST + 1}`, (await chip(`Per ea ${EA_FROM_LIST + 1}`)) === 1);
check(`a price-list chip reading ${IMPORTED}`, (await chip(`Price list ${IMPORTED}`)) === 1);
check('and a shelf-tag chip reading 1', (await chip('Shelf tag 1')) === 1);
check('nothing in this book is stale yet, so there is no age chip at all',
  (await shops.getByRole('button', { name: /Older than/ }).count()) === 0);

await shops.getByRole('button', { name: `Per lf ${LF}` }).click();
await page.waitForTimeout(300);
t = await shops.innerText();
check('tapping a chip that says two produces exactly two',
  new RegExp(`${LF} prices at Miller Lumber`).test(t), t.slice(0, 400));
check('and the other groups re-count against it rather than lying',
  (await chip(`Price list ${LF}`)) === 1 && (await shops.getByRole('button', { name: /Shelf tag/ }).count()) === 0,
  t.slice(0, 800));
check('while its own group still counts across everything, so there is somewhere to go',
  (await chip(`Per ea ${EA_FROM_LIST + 1}`)) === 1);
await shops.getByRole('button', { name: `Per lf ${LF}` }).click();
await page.waitForTimeout(300);

/* ==========================================================================
   5. Age, and what a shop's price has done.
   ========================================================================== */

// A second sighting of the stud, at what it cost four months ago. Both figures
// are his own: this is not an index and not a forecast.
const WAS = 360;
const NOW = 398;
const BACK = 120;
await stores.getByLabel('Which store').selectOption({ label: 'Miller Lumber' });
await stores.getByLabel('What it is').fill('2x4 stud, 8 ft');
await stores.getByLabel('What it costs').fill('3.60');
await stores.getByLabel('Priced per').selectOption('ea');
await stores.getByLabel('Seen on').fill(daysAgo(BACK));
await stores.getByRole('button', { name: 'Write it down' }).click();
await page.waitForTimeout(400);

await shops.getByLabel('Search what the stores charge').fill('stud');
await page.waitForTimeout(300);
t = await shops.innerText();
check('the newest price is the price, and the older one does not replace it',
  /\$3\.98/.test(t) && /Seen today/.test(t), t.slice(0, 700));
check('what the shop’s price has done is arithmetic on two figures he wrote down',
  new RegExp(`${moved(WAS, NOW)} since you last looked`).test(t)
  && t.includes(daysAgo(BACK)) && new RegExp(`${BACK} days before this one`).test(t),
  `expected ${moved(WAS, NOW)} — ${t.slice(0, 800)}`);
check('and it says both figures are his, not anybody’s index',
  /Both figures are yours/.test(t), t.slice(0, 800));

// Something nobody has looked at since the spring.
const OLD = 200;
await stores.getByLabel('Which store').selectOption({ label: 'Floor & Decor' });
await stores.getByLabel('What it is').fill('12x24 porcelain');
await stores.getByLabel('What it costs').fill('3.55');
await stores.getByLabel('Priced per').selectOption('sq ft');
await stores.getByLabel('Aisle or trade').fill('Tile');
await stores.getByLabel('Seen on').fill(daysAgo(OLD));
await stores.getByRole('button', { name: 'Write it down' }).click();
await page.waitForTimeout(400);

await shops.getByLabel('Search what the stores charge').fill('');
await shops.getByLabel('Store', { exact: true }).selectOption({ label: 'Floor & Decor' });
await page.waitForTimeout(400);
t = await shops.innerText();
check('a price nobody has checked since the spring says how old it is',
  new RegExp(`Seen about ${Math.round(OLD / 30)} months ago`).test(t), t.slice(0, 700));
check('and says so as a warning rather than sitting there looking current',
  /nobody has checked this in over 90 days/.test(t), t.slice(0, 700));
check('and there is now an age chip, with one thing behind it',
  (await chip('Older than 90 days 1')) === 1);
check('the aisle it was in became a chip, because the data had one',
  (await chip('Tile 1')) === 1);

/* ==========================================================================
   6. Into the rate book, dated when it was seen, pricing a real room.
   ========================================================================== */

await shops.getByLabel('Store', { exact: true }).selectOption({ label: 'Miller Lumber' });
await shops.getByLabel('Search what the stores charge').fill('corner bead');
await page.waitForTimeout(400);
t = await shops.innerText();
check('one linear-foot price to put against a rate', /1 price at Miller Lumber/.test(t) && /\$0\.63/.test(t),
  t.slice(0, 600));

await shops
  .getByLabel('Put metal corner bead against one of my rates')
  .selectOption('Baseboard');
await page.waitForTimeout(400);
t = await shops.innerText();
check('the app says whose price it just put in the book, and from when',
  /Baseboard is now \$0\.63 \/ lf in your rates/.test(t) && /Miller Lumber's price/.test(t),
  t.slice(-800));
check('and says in the same breath that it is a cost and not a charge',
  /what they charge\s*\n?\s*you, not what you charge/.test(t), t.slice(-800));

const rates = page
  .locator('section', { has: page.getByRole('heading', { name: 'What you charge' }) })
  .first();
check('the rate is in the book, to the cent',
  (await rates.getByLabel('Baseboard rate').inputValue()) === '0.63');
t = await rates.innerText();
check('and the rate says how old it is and which shop it came from',
  /Set today · Miller Lumber — from their price list, miller\.csv/.test(t), t.slice(0, 900));

// It is a copy. Taking a price into the rate book must not move the shop's own.
t = await shops.innerText();
check('the shop’s own price did not move when it was copied', /\$0\.63/.test(t), t.slice(0, 600));

/* ---------------------------------- and it prices a real room, end to end */

// Out of the business tab and into a room. The rate went to the company
// profile, which is the whole reason it is not part of a job — it has to be
// there when a room is opened that has never seen it.
await page.goto(page.url().replace(/#.*$/, ''), { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await loadScan(page);
await section(page, 'Price');
await page.waitForTimeout(500);
t = await page.locator('[data-panel="price"]').innerText();
const baseboard = /Baseboard\s*\n?\s*([\d,.]+) lf/.exec(t);
check('the takeoff has a baseboard run to price', baseboard !== null, t.slice(0, 800));
if (baseboard) {
  // 0.63 a foot, worked out here, rounded half away from zero once — the same
  // arithmetic `quote()` does, written out independently.
  const feet = Math.round(Number(baseboard[1].replace(/,/g, '')) * 100);
  const cents = Math.trunc((63 * feet + 50) / 100);
  const dollars = `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  check('and it is priced at the shop’s number, to the cent',
    t.includes(dollars), `${baseboard[1]} lf at $0.63 should be ${dollars} — ${t.slice(0, 900)}`);
}

/* ==========================================================================
   7. All of it survives being put down and picked up again.
   ========================================================================== */

await page.goto(page.url().replace(/#.*$/, '') + '#/business', { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
t = await page
  .locator('section', { has: page.getByRole('heading', { name: 'The stores you buy at' }) })
  .last()
  .innerText();
// Six things, seven prices: the stud was seen twice, and both sightings are
// kept because two figures he wrote down himself are the only honest answer to
// "has this gone up".
check('the shops come back after a reload',
  new RegExp(`Miller Lumber\\s*\\n?\\s*${IMPORTED + 2} prices`).test(t) && /Floor & Decor\s*\n?\s*1 price\b/.test(t),
  t.slice(0, 600));

const back = page
  .locator('section', { has: page.getByRole('heading', { name: 'What the stores charge' }) })
  .first();
t = await back.innerText();
check('and so does every price in them, with its money still money',
  new RegExp(`${IMPORTED + 2} prices across your stores`).test(t) && !/NaN/.test(t),
  t.slice(0, 500));

/* ---------------------------------------- removing a shop takes its prices */

await page.getByRole('button', { name: 'Remove Floor & Decor' }).click();
await page.waitForTimeout(200);
await page.getByRole('button', { name: 'Yes, remove it' }).click();
await page.waitForTimeout(400);
t = await page
  .locator('section', { has: page.getByRole('heading', { name: 'The stores you buy at' }) })
  .last()
  .innerText();
check('removing a shop says what it took with it',
  /Removed Floor & Decor and the 1 price that came from it/.test(t), t.slice(0, 600));
t = await back.innerText();
check('and its prices are gone rather than orphaned onto another shop',
  new RegExp(`${IMPORTED + 1} prices across your stores`).test(t) && !/porcelain/.test(t),
  t.slice(0, 600));

/* ==========================================================================
   8. The chips come off the file when the file has an aisle column — and off
      nothing at all when it does not.
   ========================================================================== */

// Written here rather than kept as a fixture, so this part needs nothing from
// anybody's machine and the expected counts are visible beside the rows.
const AISLES = [
  'SKU,Description,U/M,Category,Price',
  'T-1,"12x24 porcelain",SF,Tile,3.55',
  'G-1,"unsanded grout",EA,Setting materials,18.99',
  'T-2,"6x36 wood-look plank",SF,Tile,4.10',
].join('\n');

await page.locator('input[type=file][accept=".csv,text/csv"]').setInputFiles({
  name: 'aisles.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from(AISLES, 'utf8'),
});
await page.waitForTimeout(500);
check('the aisle column is guessed, and shown for confirmation like the rest',
  (await page.getByLabel('The aisle or trade').inputValue())
    === String(AISLES.split('\n')[0].split(',').indexOf('Category')));

await page.getByLabel('Whose list this is').fill('Tile Yard');
await page.getByRole('button', { name: 'Bring these into my book' }).click();
await page.waitForTimeout(600);

await back.getByLabel('Store', { exact: true }).selectOption({ label: 'Tile Yard' });
await page.waitForTimeout(400);
t = await back.innerText();
check('the new shop holds the three rows of that file', /3 prices at Tile Yard/.test(t), t.slice(0, 500));
check('the aisles on the file became chips, counted off the file',
  (await back.getByRole('button', { name: 'Tile 2' }).count()) === 1
  && (await back.getByRole('button', { name: 'Setting materials 1' }).count()) === 1);
check('and the units did too',
  (await back.getByRole('button', { name: 'Per sq ft 2' }).count()) === 1
  && (await back.getByRole('button', { name: 'Per ea 1' }).count()) === 1);

// Guarded, so that a missing chip is a reported failure rather than a run that
// dies before it prints anything. An audit that crashes says nothing about the
// forty checks behind the crash.
const tile = back.getByRole('button', { name: 'Tile 2' });
if ((await tile.count()) === 1) {
  await tile.click();
  await page.waitForTimeout(300);
}
t = await back.innerText();
check('and tapping an aisle gives exactly what it said it would',
  /2 prices at Tile Yard/.test(t) && !/unsanded grout/.test(t), t.slice(0, 600));

check('no console or page errors across the whole run', noise().length === 0, noise().join(' | '));

const bad = report('A26 — the stores you buy at');
await ctx.close();
await browser.close();
process.exit(bad > 0 ? 1 : 0);
