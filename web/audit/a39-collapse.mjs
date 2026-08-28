import { openChromium } from '../../core/tools/browser.mjs';
import { check, payingBrowser, refuseAStaleBundle, report, reportEvenIfItDies, section, SP, URL } from './lib.mjs';


/**
 * Every menu that drops down folds back up, on a phone.
 *
 * > "WHEN YOU DROPDOWN ANY MENU, HAVE A WAY TO COLLAPSE THEM BACK"
 * >                                                          — Sam
 *
 * Tapping a control in this app opens a block of fields — rename a wall, cut it
 * in two, notch a corner, write down what a store charges, invent an item for
 * the rate book, the claim's own paperwork. Several of them opened and then
 * stayed open for the rest of the visit, and the panel grew by a screen and a
 * half in front of the next thing somebody needed.
 *
 * `web/src/Disclosure.tsx` is the one answer to that, and this is what proves
 * it is really an answer. Four things, on each block:
 *
 *   1. it opens, and the header that opened it is still on the screen;
 *   2. it shuts again from the same control, and what was inside is gone;
 *   3. the shut row says what is inside it, so nobody has to open eight of them
 *      to find one;
 *   4. it comes back holding exactly what it held — a half-typed name is not
 *      thrown away by somebody folding a block to look under it.
 *
 * The fourth is only a real question in one place, and this part goes there on
 * purpose. Every other block this folds keeps its typed text one level up, in
 * the screen around it, so it would survive however the fold were written.
 * `ShelfTag` does not: eight `useState`s of its own, inside "The stores you buy
 * at". Writing the fold as `{open && children}` instead of `hidden` loses that
 * one and nothing else — proved by doing it, which turned five checks red.
 *
 * ## Why the window is 430 by 800 and not the 1600 the rest of the suite uses
 *
 * Because 1600 is not a phone. At that height nothing is ever below the fold,
 * so "the header is still on the screen after it opened" is a question that
 * cannot fail — and four bugs in two days were exactly that shape. An iPhone 15
 * Pro Max is 932 points tall and the browser takes a bite, so a real one is
 * nearer 800. `TRUELINE_AUDIT_HEIGHT` still overrides it, as it does for the
 * rest of the suite; what is different here is only which way the default goes,
 * because this part has nothing to say at 1600.
 *
 * ## And why Sam's own scan
 *
 * `dining.json` is a real room he walked: nine walls, three doors, three
 * windows, an eleven-corner outline that is not a rectangle. Every wall panel
 * this part opens is one he actually opened.
 */

// 430 by 800: a large phone with the browser's own chrome taken off it.
const HEIGHT = Number(process.env.TRUELINE_AUDIT_HEIGHT ?? 800);

// Say what was learned even if this part dies part way through. It goes here
// rather than beside the imports because the title names HEIGHT, and a `const`
// is not there yet at the top of the file: putting the call above it made this
// part throw a ReferenceError before a single check ran, which is a part that
// reports NOTHING -- the exact failure this helper exists to prevent, caused
// by the helper.
reportEvenIfItDies(`A39 — every menu folds back, at 430 by ${HEIGHT}`);

await refuseAStaleBundle();
const browser = await openChromium();
const ctx = await browser.newContext({ viewport: { width: 430, height: HEIGHT }, acceptDownloads: true });
// A paying contractor's browser, the way `open()` makes one. See `payingBrowser`.
await payingBrowser(ctx);
const page = await ctx.newPage();
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));

/** The header of one disclosure, by the words written on it. */
const header = (where, title) => where.getByRole('button', { name: title }).first();

/**
 * Whether something is actually on the screen.
 *
 * `count()` is not the same question. A role locator only ever matches what is
 * in the accessibility tree, but `getByLabel` is a DOM query and finds a box
 * inside a folded block perfectly well — so the first version of this part
 * asked whether the claim number still existed, which it does, rather than
 * whether anybody could see it, which was the point.
 */
const shown = async (loc) => (await loc.count()) > 0 && (await loc.first().isVisible());

/** What a header says it controls, found by that id and nothing else. */
async function panelOf(where, head) {
  const id = await head.getAttribute('aria-controls');
  return { id, panel: id ? where.locator(`[id="${id}"]`) : null };
}

/**
 * The whole of Sam's sentence, asked of one block.
 *
 * `inside` is a locator for something that only exists while it is open — the
 * proof that shutting it really took the block away rather than only turning a
 * word round. `says` is the words the shut row has to carry.
 */
async function folds(where, title, { inside, says }) {
  const head = header(where, title);
  const there = await head.count();
  check(`${title}: there is a header to press`, there === 1, `${there} found`);
  if (there !== 1) return;

  await head.scrollIntoViewIfNeeded();
  const { id, panel } = await panelOf(page, head);
  check(`${title}: it says what it opens, by name`,
    !!id && (await panel.count()) === 1, `aria-controls=${id}`);

  // 48px, one size up from the 44 the rest of this app settled on. This is the
  // control somebody hits over and over while looking for something else.
  const box = await head.boundingBox();
  check(`${title}: the header is a phone-sized target`,
    box !== null && box.height >= 48, `${box ? box.height.toFixed(0) : 'no'}px tall`);

  if ((await head.getAttribute('aria-expanded')) === 'false') {
    await head.click();
    await page.waitForTimeout(250);
  }
  check(`${title}: open, it says so out loud`,
    (await head.getAttribute('aria-expanded')) === 'true');
  check(`${title}: and what is inside it is reachable`, await shown(inside));

  // The header must not have been carried off the screen by its own block
  // opening underneath it. At 1600 this can never fail; at 800 it can.
  const after = await head.boundingBox();
  check(`${title}: opening it leaves the header on the screen`,
    after !== null && after.y >= 0 && after.y + after.height <= HEIGHT,
    `header at y=${after ? after.y.toFixed(0) : 'gone'} of ${HEIGHT}`);

  await head.click();
  await page.waitForTimeout(250);
  check(`${title}: the same control shuts it again`,
    (await head.getAttribute('aria-expanded')) === 'false');
  check(`${title}: and what was inside is off the screen`, !(await shown(inside)));

  const shut = (await head.innerText()).replace(/\s+/g, ' ');
  check(`${title}: the shut row says what is inside it`,
    shut.includes(says), `it says "${shut}"`);
  check(`${title}: and offers the way back, in that word`, /Open/.test(shut), shut);

  await head.click();
  await page.waitForTimeout(250);
  check(`${title}: it opens again`, await shown(inside));
}

await page.goto(URL, { waitUntil: 'networkidle' });
await page.setInputFiles('input[type=file][accept="application/json,.json"]', `${SP}/dining.json`);
await page.waitForTimeout(700);

// Nothing is told that it is inside the phone app and nothing is subscribed.
// Every block this part opens is one a contractor reaches on the free path, and
// standing a paywall in front of half of them would have proved the paywall
// rather than the folding.

/* ==========================================================================
   1. The wall panel — six things you can do to a wall, all at once
   ========================================================================== */

await section(page, 'Plan');
await page.waitForTimeout(400);
// wall-7, not wall-5, and the reason is a fix rather than a preference.
// `Take it out` used to be drawn on any room with more than three walls, and
// the model refuses the delete on most of them — so the row was offered where
// it could never succeed. Edit.tsx now asks `deleteWall` itself before drawing
// it, twice: as the room stands, and with the wall's openings set aside, since
// a door is something a person can take out on the panel above.
//
// dining.json's wall-5 is one it correctly no longer offers: emptied of its
// door it still cannot come out, because closing the room round it would shrink
// wall-7 to minus nine and a half inches. wall-7 is one it does offer, so it is
// the wall that exercises every row this part is about.
const wall = page.getByRole('button', { name: /^Wall wall-5/ }).first();
await wall.focus();
await page.keyboard.press('Enter');
await page.waitForTimeout(300);

await page.getByRole('button', { name: 'Change this wall' }).click();
await page.waitForTimeout(300);

await folds(page, 'Call it something', {
  inside: page.getByRole('textbox', { name: 'What to call this wall' }),
  says: 'It is called wall-5 today',
});

await folds(page, 'Cut it in two', {
  inside: page.getByRole('button', { name: 'Cut it', exact: true }),
  says: 'Makes a second wall',
});

/* --------------------------- what is typed in one survives folding it away */

// A block somebody shuts to see what is under it has not been abandoned. The
// children stay mounted for exactly this: a name half typed, a store picked, a
// photograph already taken and waiting on a number.
const nameBox = page.getByRole('textbox', { name: 'What to call this wall' });
await nameBox.fill('behind the dresser');
const callIt = header(page, 'Call it something');
await callIt.click();
await page.waitForTimeout(200);
await callIt.click();
await page.waitForTimeout(200);
check('what was typed into a block is still there when it is opened again',
  (await nameBox.inputValue()) === 'behind the dresser',
  `it now reads "${await nameBox.inputValue()}"`);

/* ------------------------------- the two that start shut, and say why not */

// A notch and a deletion belong to an alcove and to a wall that is not really
// there. Starting them shut is where the panel actually gets shorter, and the
// shut row has to be worth reading or it is just a word saying "Open".
const notch = header(page, 'Notch the corner after it');
check('the rare ones start shut', (await notch.getAttribute('aria-expanded')) === 'false');
check('and say what they are for without being opened',
  /alcove or a chase/.test(await notch.innerText()), await notch.innerText());
check('with nothing of theirs on the screen',
  (await page.getByRole('button', { name: 'Notch it' }).count()) === 0);
await notch.click();
await page.waitForTimeout(250);
check('opening one reaches the control it was hiding',
  (await page.getByRole('button', { name: 'Notch it' }).count()) === 1);

/* --------------------------------- and the delete row, on a wall that has one */

// It takes a second wall, and that is a fact about the room rather than about
// this part. `Take it out` used to be drawn on any room with more than three
// walls, and the model refuses the delete on most of them, so the row was
// offered where it could never succeed. `Edit.tsx` now asks `deleteWall` itself
// before drawing it.
//
// Measured on `dining.json` with `deleteWall` over every wall: the walls that
// can come out are wall-3, opening-1, opening-2, wall-4 and wall-7, and the
// walls that have an opening in them are wall-5, wall-6, wall-8 and wall-9.
// **The two sets do not overlap** — a wall with a doorway in it is a wall the
// room cannot close without. So the opening rows above need wall-5 and this
// row needs wall-7, and no single wall could have carried both.
await page.getByRole('button', { name: /^Wall wall-5/ }).first().click();
await page.waitForTimeout(200);
await page.getByRole('button', { name: /^Wall wall-7/ }).first().click();
await page.waitForTimeout(400);
// Every row lives behind this, on every wall.
await page.getByRole('button', { name: 'Change this wall' }).click();
await page.waitForTimeout(400);

const takeOut = header(page, 'Take it out');
check('the delete row is drawn on a wall the room can actually lose',
  (await takeOut.count()) === 1, `${await takeOut.count()} found on wall-7`);
check('a wall that is not there starts shut too',
  (await takeOut.getAttribute('aria-expanded')) === 'false');
check('and says so on the shut row',
  /not really there/.test(await takeOut.innerText()), await takeOut.innerText());

// Back to wall-5, which is the wall the rest of this part is about.
await page.getByRole('button', { name: /^Wall wall-7/ }).first().click();
await page.waitForTimeout(200);
await page.getByRole('button', { name: /^Wall wall-5/ }).first().click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Change this wall' }).click();
await page.waitForTimeout(400);

/* ------------------------------------- the opening rows already did this */

// This row was a correct disclosure before any of the above: the same row
// shuts it. What it had never done was SAY it opens anything, which is the
// exact state the damage mark's row was in when Sam reported that he could not
// attach a photograph to a mark.
//
// It is held here by what it controls rather than by its words, because its
// words are the one thing that moves: the row reads "…Measure" while it is
// shut and "…Done" while it is open, so a locator written round either of them
// finds nothing half the time. `a2-edits.mjs` presses it by the word Measure,
// which is why that word was left exactly as it was.
const opening = page.locator('button[aria-controls^="opening-"]').first();
if ((await opening.count()) === 1) {
  const was = await opening.getAttribute('aria-expanded');
  check('an opening row says out loud that it opens', was === 'false', `aria-expanded=${was}`);
  const controls = await opening.getAttribute('aria-controls');
  check('and there is nothing of its panel on the page while it is shut',
    (await page.locator(`[id="${controls}"]`).count()) === 0, controls);
  await opening.click();
  await page.waitForTimeout(300);
  check('and says so once it has', (await opening.getAttribute('aria-expanded')) === 'true');
  check('and names what it opened',
    (await page.locator(`[id="${controls}"]`).count()) === 1, controls);
  await opening.click();
  await page.waitForTimeout(250);
  check('and the same row shuts it again',
    (await opening.getAttribute('aria-expanded')) === 'false');
} else {
  check('the wall this part opens has an opening in it to correct', false,
    `${await opening.count()} opening rows — the fixture changed, not the app`);
}

/* ==========================================================================
   2. The claim — fourteen boxes that used to arrive all at once
   ========================================================================== */

await section(page, 'Insurance');
await page.getByRole('button', { name: 'Turn it on' }).click();
await page.waitForTimeout(400);
const claim = page.locator('section', { has: page.getByRole('heading', { name: 'The claim' }) }).first();

await claim.getByLabel('Claim number').fill('CLM-90277');
await claim.getByRole('button', { name: 'burst pipe', exact: true }).click();
await page.waitForTimeout(200);

await folds(claim, 'What happened, and when', {
  inside: claim.getByLabel('Claim number'),
  says: 'burst pipe',
});
check('and the claim number typed into it survived being folded away',
  (await claim.getByLabel('Claim number').inputValue()) === 'CLM-90277');

await folds(claim, 'Who it is between', {
  inside: claim.getByLabel('Adjuster', { exact: true }),
  says: 'The owner, the carrier and the adjuster',
});

/* ==========================================================================
   3. The list somebody carries — the one that was already right
   ========================================================================== */

await section(page, 'Files');
await page.waitForTimeout(400);

const carried = page
  .locator('section', { has: page.getByRole('heading', { name: 'Take this list with you' }) })
  .first();
// Held by what it controls, not by its word: the word is Show while it is shut
// and Hide once it is open, and `a22-voice.mjs` presses it by the word Show —
// which is why it is still Show and not Open.
const show = carried.locator('button[aria-controls="the-field-list"]');
check('the list somebody carries has a way in that says what it opens',
  (await carried.count()) === 1 && (await show.count()) === 1,
  `${await carried.count()} section(s), ${await show.count()} toggle(s)`);
if ((await carried.count()) === 1 && (await show.count()) === 1) {
  check('the field sheet says out loud that it opens',
    (await show.getAttribute('aria-expanded')) === 'false');
  check('and names the list it opens',
    (await page.locator('[id="the-field-list"]').count()) === 1);
  // It was a 20px target — the bare text of a link, on a phone.
  const box = await show.boundingBox();
  check('and is a phone-sized target, which it was not',
    box !== null && box.height >= 44, `${box ? box.height.toFixed(0) : 'no'}px tall`);
  check('and the word on it is the way in', (await show.innerText()).includes('Show'));

  await show.click();
  await page.waitForTimeout(300);
  check('opening it says so', (await show.getAttribute('aria-expanded')) === 'true');
  check('and the way back is the same control, in the other word',
    (await show.innerText()).includes('Hide'));
  await show.click();
  await page.waitForTimeout(250);
  check('which folds it again', (await show.getAttribute('aria-expanded')) === 'false');
}

/* ==========================================================================
   4. The business screen — the rate book and the shops
   ========================================================================== */

// The rate book and the shops belong to the business rather than to a job, so
// this is a different screen with no room on it at all.
await page.goto(page.url().replace(/#.*$/, '') + '#business', { waitUntil: 'networkidle' });
await page.waitForTimeout(700);

await folds(page, 'Your own items', {
  inside: page.getByRole('button', { name: 'Add it to your rates' }),
  says: 'Nothing of your own yet',
});

await page.getByLabel('What you call it').fill('Skim coat');
const own = header(page, 'Your own items');
await own.click();
await page.waitForTimeout(200);
await own.click();
await page.waitForTimeout(200);
check('a half-invented item is still half invented after the block folds',
  (await page.getByLabel('What you call it').inputValue()) === 'Skim coat');

const stores = page
  .locator('section', { has: page.getByRole('heading', { name: 'The stores you buy at' }) })
  .last();

await folds(page, 'The stores you buy at', {
  inside: stores.getByLabel('Add a store'),
  says: 'No shops yet',
});

await stores.getByLabel('Add a store').fill('Miller Lumber');
await stores.getByRole('button', { name: 'Add it', exact: true }).click();
await page.waitForTimeout(400);

await folds(page, 'Write down a price', {
  inside: page.getByRole('button', { name: 'Write it down' }),
  says: 'A store, what it is, what it costs',
});

await stores.getByLabel('Which store').selectOption({ label: 'Miller Lumber' });
await stores.getByLabel('What it is').fill('2x4 stud, 8 ft');

/* ------------------- a half-written price, through a fold and out the other side */

// The one block in the app whose fields keep their state INSIDE it. Everything
// else this part folds is holding its typed text a level up, in the screen
// around it, so folding could not lose it however the block were written. This
// one could: `ShelfTag` has eight `useState`s of its own and they live inside
// "The stores you buy at". Somebody standing in an aisle with the store picked,
// the item typed and the tag already photographed, who folds the block to look
// at what he has written down before, has not asked to start again.
const storesHead = header(page, 'The stores you buy at');
await storesHead.click();
await page.waitForTimeout(250);
await storesHead.click();
await page.waitForTimeout(250);
check('a half-written price survives its block being folded and opened',
  (await stores.getByLabel('What it is').inputValue()) === '2x4 stud, 8 ft'
  && (await stores.getByLabel('Which store').inputValue()) !== '',
  `"${await stores.getByLabel('What it is').inputValue()}" at ` +
    `"${await stores.getByLabel('Which store').inputValue()}"`);

// The photograph, then the number — the order `Vendor.tsx` insists on. It is
// here because the full-size view of that photograph is the last thing in this
// app that opened with no way out of it.
await stores.locator('input[type=file][accept="image/*"]').setInputFiles(`${SP}/damage-photo.jpg`);
await page.waitForTimeout(800);
await stores.getByLabel('What it costs').fill('3.98');
await stores.getByRole('button', { name: 'Write it down' }).click();
await page.waitForTimeout(400);

await folds(page, 'What the stores charge', {
  inside: page.getByRole('button', { name: 'Use it as my rate' }),
  says: '1 price across your shops',
});

/* ------------------------------------------ the tag, and the way out of it */

// A full-screen photograph over the whole phone, closed by tapping it, with
// nothing on the screen saying so. `WallPhotos.tsx` has had a real button on
// its full-size view all along; this one had none.
const tag = page.getByRole('button', { name: /^Price tag photograph/ }).first();
check('the tag that was photographed is on its price, to open', (await tag.count()) === 1);
if ((await tag.count()) === 1) {
  await tag.click();
  await page.waitForTimeout(400);
  check('and it opens over the whole phone',
    (await page.getByRole('dialog', { name: /Price tag photograph/ }).count()) === 1);
  const shut = page.getByRole('button', { name: 'Close the price tag photograph' });
  check('the full-size price tag offers a way out that is a button, not a guess',
    (await shut.count()) === 1);
  if ((await shut.count()) === 1) {
    await shut.click();
    await page.waitForTimeout(300);
    check('and pressing it puts the picture away',
      (await page.getByRole('dialog', { name: /Price tag photograph/ }).count()) === 0);
  }
}

/* ==========================================================================
   5. Nothing anywhere claims to open something that is not there
   ========================================================================== */

// One rule over every disclosure on the screen at once, whichever file drew
// it: if a control NAMES what it opens, that thing has to exist and has to
// agree with it. A header that says "open" over a panel the browser is not
// showing is the same lie as a button with nothing behind it.
//
// Naming one is not compulsory and this does not ask for it. `aria-controls`
// is optional in ARIA, and the business toggle in `App.tsx` is right to leave
// it off: what it opens is the whole screen rather than an element.
await page.waitForTimeout(300);
const wrong = await page.evaluate(() =>
  [...document.querySelectorAll('button[aria-expanded][aria-controls]')]
    .filter((b) => b.offsetParent !== null)
    .map((b) => {
      const said = b.innerText.replace(/\s+/g, ' ').slice(0, 40);
      const id = b.getAttribute('aria-controls');
      const panel = document.getElementById(id);
      const open = b.getAttribute('aria-expanded') === 'true';
      const showing = panel !== null && panel.offsetParent !== null;
      if (!panel) return `${said}: names #${id}, which is not on the page`;
      if (open !== showing) return `${said}: says ${open} and its panel is ${showing}`;
      return null;
    })
    .filter((one) => one !== null)
);
check('every disclosure on screen names a panel that exists and agrees with it',
  wrong.length === 0, wrong.join(' | '));

check('no console or page errors across the whole run', problems.length === 0, problems.join(' | '));

const bad = report(`A39 — every menu folds back, at 430 by ${HEIGHT}`);
await ctx.close();
await browser.close();
process.exit(bad > 0 ? 1 : 0);
