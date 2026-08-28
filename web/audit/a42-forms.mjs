import { HEIGHT, check, loadScan, noise, open, pick, report, section } from './lib.mjs';

/**
 * Two forms nothing had ever filled in: the seller's own details, and the
 * other two people on an insurance job.
 *
 * ## Why these two, together
 *
 * They are the same shape of gap. Twelve boxes across `Settings.tsx` and
 * `Claim.tsx` were finished, wired to the model, printed on documents that
 * leave the building — and no part of this audit had ever typed a character
 * into one of them by name. `Phone`, `Email`, `Licence number`, `Insurance`,
 * `Remove`, `Default ceiling height`, `Ask me`; `Found on`, `Owner's phone`,
 * `Carrier`, `Adjuster's phone`, `Adjuster's email`.
 *
 * Both forms are also the kind whose failure is silent. Nobody notices a
 * missing licence number on a drawing until a homeowner in a state that
 * requires one shows the drawing to somebody; nobody notices a dropped
 * adjuster's phone number until the adjuster does not ring back. A form that
 * loses a field loses it quietly, so the only honest check is the round trip:
 * type it here, and find it on the paper that goes out.
 *
 * ## What every check below is actually asking
 *
 * Not "is the box there". A box is there in every one of the four bugs this
 * month. Each check states something that would be false if the field were
 * decorative:
 *
 *   * it reaches the letterhead on the drawing, **with the word that makes it
 *     mean something** — a bare number is not a licence;
 *   * it reaches the file the homeowner keeps, which is opened on somebody
 *     else's phone with no signal;
 *   * an empty one prints **nothing**, not an empty line — the rule
 *     `letterhead()` exists to keep;
 *   * a preference reaches the room a person draws tomorrow, which is the only
 *     thing that makes it a preference rather than a screen;
 *   * a phone number with nobody's name against it is **not printed as a
 *     party**, because half a contact on a claim is worse than none.
 *
 * Every one of them is driven at `TRUELINE_AUDIT_HEIGHT=800`, which is a real
 * phone. A form of six fields proves nothing about itself at the 1600 default:
 * nothing in this app has ever been below the fold there, so no check about
 * whether a person can see a field has ever been able to fail.
 *
 * Nothing below imports anything from the app. Every string it looks for is
 * written out here, so a check cannot pass by agreeing with the code it is
 * checking.
 */

/* ------------------------------------------------------------- the fixtures */

const BUSINESS = 'Alvarez Remodeling';
const PHONE = '(480) 555-0142';
const EMAIL = 'sam@alvarez.example';
const LICENCE = 'ROC-284417';
const INSURANCE = 'Ironwood Mutual GL-99120';
/** How `letterhead()` promises to write those four. Never re-derived here. */
const CONTACT_LINE = `${PHONE} · ${EMAIL}`;
const CREDENTIALS_LINE = `Licence ${LICENCE} · Insured — ${INSURANCE}`;

/** A contractor whose houses are all the same height, and is tired of typing it. */
const MY_CEILING = `9' 6"`;
/** What the app must never quietly use instead. */
const HARD_CODED = `8'`;
/** 2x6 framing with nothing on it: `ASSEMBLIES` calls the build 2x6. */
const MY_WALL = '2x6';
const MY_WALL_READS = `6 1/2"`;

/** Four pixels of PNG. A logo has to be a real image the browser will decode. */
const LOGO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR42mP8z8BQz0AEYBxV'
    + 'SF+FABJADveWkH6oAAAAAElFTkSuQmCC',
  'base64'
);

const CLAIM_NUMBER = 'CLM-70318';
const LOSS_ON = '2026-08-11';
const FOUND_ON = '2026-08-14';
const PROPERTY = '14 Sycamore Rd';
const OWNER = 'Ruth Alvarez';
const OWNER_PHONE = '(480) 555-0199';
const CARRIER = 'Ironwood Mutual';
const ADJUSTER = 'D. Chen';
const ADJUSTER_PHONE = '(602) 555-0130';
const ADJUSTER_EMAIL = 'd.chen@ironwood.example';
/** How `describeParty` promises to write a party. Never re-derived here. */
const ADJUSTER_LINE = `${ADJUSTER} — ${ADJUSTER_PHONE} · ${ADJUSTER_EMAIL}`;
const OWNER_LINE = `${OWNER} — ${OWNER_PHONE}`;

const { browser, ctx, page } = await open();

/**
 * Whether a control is whole inside the window once it has been scrolled to.
 *
 * A field halfway down a long form is below the fold and that is fine — a
 * person scrolls. What is not fine is a field that cannot be brought fully
 * onto a phone screen at all, or one that is covered when it gets there. So
 * this scrolls the way a thumb does and then asks about both edges.
 */
async function reachable(control) {
  if ((await control.count()) === 0) return { ok: false, said: 'there is no such box' };
  await control.first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);
  const box = await control.first().boundingBox();
  if (box === null) return { ok: false, said: 'it is not drawn at all' };
  return {
    // Rounded to whole pixels, because the layout is not: a field scrolled to
    // the bottom of the window lands at 752.34 and is 48 tall.
    ok: Math.round(box.y) >= 0 && Math.round(box.y + box.height) <= HEIGHT,
    said: `top ${Math.round(box.y)}, bottom ${Math.round(box.y + box.height)}, `
      + `in a window ${HEIGHT} tall`,
  };
}

/**
 * Presses a control, or fails a check saying why the walk stops here.
 *
 * A part that dies on a missing control reports one stack trace and hides every
 * check after it — including the ones that would have said what actually broke.
 * Found by watching this file fail: a control taken out of `web/src` should go
 * red on the check that says it is there, not kill the run on a click that
 * timed out thirty seconds later.
 */
async function press(control, whatFor, waitFor = 400) {
  if ((await control.count()) === 0) {
    check(`there is a control to ${whatFor}, which the rest of this part needs`,
      false, 'it is not on the screen, so what follows cannot be walked');
    return false;
  }
  await control.first().click();
  await page.waitForTimeout(waitFor);
  return true;
}

/** The profile, opened. It closes itself on Save, so this is said often. */
async function openProfile() {
  await page.getByRole('button', { name: 'Your business' }).click();
  await page.waitForTimeout(400);
}

/* ==========================================================================
   1. The seller's own details, typed once.
   ========================================================================== */

await openProfile();

// `Phone` and `Email` have nothing but their caption above them, so the words
// a person would say are the words that find the box. `Licence number` and
// `Insurance` each carry an explanatory line INSIDE the same `<label>`, so
// asking for them exactly finds nothing — see the note at the foot of this
// file. Either way there has to be exactly one of each, or two fields are
// answering to one name and this app has had that bug twice.
for (const name of ['Phone', 'Email', 'Licence number', 'Insurance']) {
  const box = page.getByLabel(name);
  check(`the profile has exactly one box a person would call "${name}"`,
    (await box.count()) === 1, `${await box.count()} found`);
  const at = await reachable(box);
  check(`and "${name}" can be brought whole onto a phone screen`, at.ok, at.said);
}

await page.getByLabel('Business name').fill(BUSINESS);
await page.getByLabel('Phone').fill(PHONE);
await page.getByLabel('Email').fill(EMAIL);
await page.getByLabel('Licence number').fill(LICENCE);
await page.getByLabel('Insurance').fill(INSURANCE);
await page.waitForTimeout(300);

// The profile shows what it is about to put on every document, before anything
// is saved. A preview that disagreed with the paper would be worse than none.
const profile = page.locator('section').first();
let shown = await profile.innerText();
check('the profile shows the letterhead it is about to make, as it is typed',
  shown.includes(CONTACT_LINE), shown.slice(-500));
check('and the phone and the email are one line with a divider, not two lines',
  shown.includes(CONTACT_LINE) && !shown.includes(`${PHONE}\n${EMAIL}`), shown.slice(-500));
check('the licence is written as a licence, not as a number on its own',
  shown.includes(`Licence ${LICENCE}`), shown.slice(-500));
check('and the insurance says the business is insured, which is the point of showing it',
  shown.includes(`Insured — ${INSURANCE}`), shown.slice(-500));

/* -------------------------------------- the logo, and the control that undoes it */

check('there is nothing to remove before there is a logo, so nothing offers to',
  (await page.getByRole('button', { name: 'Remove', exact: true }).count()) === 0,
  'a Remove button is offered with no logo to remove');

await page.setInputFiles('input[type=file][accept="image/png,image/jpeg,image/svg+xml"]',
  { name: 'logo.png', mimeType: 'image/png', buffer: LOGO });
await page.waitForTimeout(600);

const remove = page.getByRole('button', { name: 'Remove', exact: true });
check('adding a logo puts it on the letterhead the profile is showing',
  (await profile.locator('img[src^="data:image/png"]').count()) >= 1,
  `${await profile.locator('img').count()} pictures on the profile`);
check('and only then is there a control offering to take it off again',
  (await remove.count()) === 1, `${await remove.count()} Remove buttons`);
const removeAt = await reachable(remove);
check('and that control can be brought whole onto a phone screen',
  removeAt.ok, removeAt.said);

await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForTimeout(600);

/* ==========================================================================
   2. What was typed reaches the drawing and the file that leaves the building.
   ========================================================================== */

await loadScan(page);
let onScreen = await page.locator('body').innerText();
check('the phone and the email are on the letterhead on the drawing',
  onScreen.includes(CONTACT_LINE), onScreen.slice(0, 900));
check('and the licence and the insurance are on it too, each with its word',
  onScreen.includes(CREDENTIALS_LINE), onScreen.slice(0, 900));

/** The client file, as bytes, without saving it anywhere. */
async function clientFile() {
  await section(page, 'Files');
  const send = page
    .locator('section', { has: page.getByRole('heading', { name: 'Send the drawing' }) })
    .first();
  const waitFor = page.waitForEvent('download', { timeout: 30000 });
  await send.getByRole('button', { name: /Send to the client/ }).click();
  const got = await waitFor;
  let html = '';
  for await (const chunk of await got.createReadStream()) html += chunk;
  await page.waitForTimeout(300);
  return html;
}

let file = await clientFile();
check('the phone number reaches the file the homeowner keeps',
  file.includes(PHONE), 'the phone is not on the client file');
check('and so does the email address',
  file.includes(EMAIL), 'the email is not on the client file');
check('and the licence number, on the document a homeowner may show somebody else',
  file.includes(LICENCE), 'the licence is not on the client file');
check('and the insurance line',
  file.includes(INSURANCE), 'the insurance is not on the client file');
check('and the logo travels inside it, rather than as a link to somewhere',
  /<img src="data:image\/png/.test(file), 'the logo is a link or is missing');
check('so the file still reaches out to nothing at all',
  !/src="https?:/.test(file) && !/<script/i.test(file), 'the client file fetches something');

/* ==========================================================================
   3. Nothing is committed until Save — including taking the logo off.
   ========================================================================== */

await openProfile();
await press(page.getByRole('button', { name: 'Remove', exact: true }), 'remove the logo', 300);
check('Remove takes the logo off the letterhead the profile is showing',
  (await profile.locator('img[src^="data:image/png"]').count()) === 0,
  'the picture is still on the preview');
check('and takes its own offer away with it, because there is nothing left to remove',
  (await page.getByRole('button', { name: 'Remove', exact: true }).count()) === 0,
  'Remove is still offered with no logo left');

// Leaving the screen without saving must leave the business alone. The file
// says so — "nothing is committed until Save, so the screen can be left
// without a half-typed licence number becoming the one on the drawings" — and
// a Remove that took effect before Save would be the most expensive kind to
// get wrong, because there is no undo on a logo somebody deleted.
await page.getByRole('button', { name: 'Done', exact: true }).click();
await page.waitForTimeout(400);
await openProfile();
check('leaving without saving puts the logo back, because nothing is committed until Save',
  (await profile.locator('img[src^="data:image/png"]').count()) >= 1,
  'the logo was deleted by a screen that was walked away from');

await press(page.getByRole('button', { name: 'Remove', exact: true }), 'remove the logo', 300);
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForTimeout(600);

file = await clientFile();
check('Remove and Save together take the logo out of the file that leaves the building',
  !/<img src="data:image\/png/.test(file), 'the logo is still on the client file');
check('and the letterhead is simply shorter, rather than carrying an empty picture',
  file.includes(BUSINESS) && !/<img src=""/.test(file), 'an empty image was printed');

/* ---------------------------- an empty field prints nothing, not an empty line */

await openProfile();
await page.getByLabel('Licence number').fill('');
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForTimeout(600);

// Back to the drawing to read it. The letterhead lives on the Plan panel and
// every other panel is `hidden`, so reading the page from the Files section
// would find no licence line for the entirely wrong reason and pass.
await section(page, 'Plan');
await page.waitForTimeout(300);
onScreen = await page.locator('body').innerText();
check('the letterhead is on the screen being read, so what follows is about the letterhead',
  onScreen.includes(BUSINESS), onScreen.slice(0, 400));
check('a licence number nobody has typed is left off the drawing entirely',
  !/Licence/.test(onScreen), (onScreen.match(/.{0,60}Licence.{0,40}/) ?? []).join(' '));
check('and the insurance beside it is still there, alone, without the divider',
  onScreen.includes(`Insured — ${INSURANCE}`) && !onScreen.includes(` · Insured`),
  (onScreen.match(/Insured[^\n]*/) ?? []).join(' ') || 'the word "Insured" is nowhere on the screen');

await openProfile();
await page.getByLabel('Licence number').fill(LICENCE);
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForTimeout(600);

/* ==========================================================================
   4. What a new room starts at — a preference is only a preference if it
      reaches a room somebody makes tomorrow.
   ========================================================================== */

await openProfile();

check('the box for a ceiling height is not there until somebody asks for one',
  (await page.getByLabel('Default ceiling height').count()) === 0,
  'the height box is on the screen with the preference switched off');

await page.getByRole('checkbox').first().check();
await page.waitForTimeout(300);

const ceiling = page.getByLabel('Default ceiling height');
check('ticking it puts a box there, exactly one',
  (await ceiling.count()) === 1, `${await ceiling.count()} found`);
const ceilingAt = await reachable(ceiling);
check('and that box can be brought whole onto a phone screen',
  ceilingAt.ok, ceilingAt.said);

await ceiling.fill('nine feet six');
await page.waitForTimeout(400);
shown = await profile.innerText();
check('a height that is not a length is answered beside the box rather than accepted',
  !/Reads as/.test(shown) && /nine feet six|not a length|could not/i.test(shown),
  (shown.match(/Reads as[^\n]*|[^\n]*not a length[^\n]*/) ?? []).join(' | '));

await ceiling.fill(MY_CEILING);
await page.waitForTimeout(400);
shown = await profile.innerText();
check('and a height that is one is read back in the units this business reads',
  shown.includes(`Reads as ${MY_CEILING}`), (shown.match(/Reads as[^\n]*/) ?? []).join(' '));

await page.getByRole('button', { name: MY_WALL, exact: true }).click();
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForTimeout(600);

// The whole meaning of the preference: a room somebody draws by hand starts at
// the height this contractor's houses actually are. Until something read it,
// ticking the box and typing a number did literally nothing and every
// hand-drawn room started at a hard-coded eight foot.
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await page.getByRole('button', { name: /Draw it by hand|Draw the room/i }).click();
await page.waitForTimeout(400);
await page.getByText(/Or type it in wall by wall/).click();
await page.waitForTimeout(300);

const startsAt = await page
  .getByRole('textbox', { name: 'How high is the ceiling?' })
  .getAttribute('placeholder');
check('a room drawn by hand starts at the height on the profile, not at a hard-coded eight foot',
  startsAt === MY_CEILING, `it offers ${JSON.stringify(startsAt)}, not ${JSON.stringify(MY_CEILING)}`);
check('and that is genuinely the profile\'s number rather than a coincidence',
  startsAt !== HARD_CODED, 'the room still starts at the hard-coded height');

await page.getByRole('textbox', { name: 'What is this room?' }).fill('the shop');
await page.getByRole('button', { name: 'Start', exact: true }).click();
await page.waitForTimeout(500);
check('and the room it starts really is that tall, not only the box that offered it',
  (await page.locator('body').innerText()).includes(`ceiling ${MY_CEILING}`),
  (await page.locator('body').innerText()).match(/ceiling[^\n]*/)?.[0] ?? 'no ceiling shown');

/* ------------------------------------------------- and the walls, unless asked */

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await loadScan(page);
await section(page, 'Room');
await page.waitForTimeout(400);

const usual = page.getByRole('button', { name: /^Your usual — / });
check('a room offers this business\'s usual wall build in one tap, because it was chosen once',
  (await usual.count()) === 1, `${await usual.count()} offers`);
check('and it offers the build that was chosen, read as a thickness',
  (await usual.count()) === 1 && (await usual.innerText()).includes(MY_WALL_READS),
  (await usual.count()) === 0 ? 'nothing is offered' : await usual.innerText());

// "Ask me" is a word with a meaning: it means the app stops deciding. A button
// that said it and changed nothing would be the worst kind of preference —
// somebody sets it, believes it, and gets the old answer anyway.
await openProfile();
const askMe = page.getByRole('button', { name: 'Ask me', exact: true });
check('the profile offers to be asked, rather than only offering builds',
  (await askMe.count()) === 1, `${await askMe.count()} found`);
const askAt = await reachable(askMe);
check('and that control can be brought whole onto a phone screen', askAt.ok, askAt.said);
await press(askMe, 'be asked rather than told what the walls are');
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForTimeout(600);

await section(page, 'Room');
await page.waitForTimeout(400);
check('and after "Ask me" the room asks, rather than offering a build nobody chose',
  (await page.getByRole('button', { name: /^Your usual — / }).count()) === 0,
  `${await page.getByRole('button', { name: /^Your usual — / }).count()} offers left`);
check('while the builds are all still there to pick from by hand',
  (await page.getByRole('button', { name: MY_WALL, exact: true }).count()) >= 1,
  'the wall builds went away with the default');

/* ==========================================================================
   5. The other two people on an insurance job.
   ========================================================================== */

await section(page, 'Insurance');
await page.getByRole('button', { name: 'Turn it on' }).click();
await page.waitForTimeout(500);

const claim = page
  .locator('section', { has: page.getByRole('heading', { name: 'The claim' }) })
  .first();

// Every one of the five, by the words above it, before anything is typed.
for (const name of ['Found on', "Owner's phone", 'Carrier', "Adjuster's phone", "Adjuster's email"]) {
  const box = claim.getByLabel(name, { exact: true });
  check(`the claim has exactly one box called "${name}"`,
    (await box.count()) === 1, `${await box.count()} found`);
  const at = await reachable(box);
  check(`and "${name}" can be brought whole onto a phone screen`, at.ok, at.said);
}

// Two dates, and they are two questions. Adjusters ask for both, and a claim
// that carried one of them would be answering the wrong one half the time: the
// day a pipe let go and the day somebody opened the cupboard are not the same
// day, and the gap between them is what an adjuster is reading for.
check('the day it happened and the day it was found are two boxes, not one',
  (await claim.getByLabel('Date of loss').count()) === 1
  && (await claim.getByLabel('Found on', { exact: true }).count()) === 1,
  'one of the two dates is missing');
check('and both of them ask for a date rather than for typing one out',
  (await claim.getByLabel('Date of loss').getAttribute('type')) === 'date'
  && (await claim.getByLabel('Found on', { exact: true }).getAttribute('type')) === 'date',
  `${await claim.getByLabel('Date of loss').getAttribute('type')} and `
    + `${await claim.getByLabel('Found on', { exact: true }).getAttribute('type')}`);

await claim.getByLabel('Claim number').fill(CLAIM_NUMBER);
await claim.getByLabel('Date of loss').fill(LOSS_ON);
await claim.getByLabel('Found on', { exact: true }).fill(FOUND_ON);
await claim.getByRole('button', { name: 'burst pipe', exact: true }).click();
await claim.getByLabel('Property address').fill(PROPERTY);
await claim.getByLabel('Owner', { exact: true }).fill(OWNER);
await claim.getByLabel("Owner's phone").fill(OWNER_PHONE);
await claim.getByLabel('Carrier').fill(CARRIER);
await claim.getByLabel('Adjuster', { exact: true }).fill(ADJUSTER);
await claim.getByLabel("Adjuster's phone").fill(ADJUSTER_PHONE);
await claim.getByLabel("Adjuster's email").fill(ADJUSTER_EMAIL);
await page.waitForTimeout(500);

let saidOnScreen = await claim.innerText();
check('nothing is left on the "still to fill in" list once the claim is filled in',
  !/Still to fill in/.test(saidOnScreen), saidOnScreen.slice(-400));
check('the owner reads on screen as one person with a number, not as two facts',
  saidOnScreen.includes(OWNER_LINE), saidOnScreen.slice(-600));
check('and the adjuster as one person with a number and an address',
  saidOnScreen.includes(ADJUSTER_LINE), saidOnScreen.slice(-600));

/* ------------------------------------------------- and onto the document */

await section(page, 'Plan');
await pick(page, /^Wall wall-1,/);
await page.getByRole('button', { name: '+ damaged area' }).click();
await page.waitForTimeout(250);
await page.getByRole('button', { name: 'Water', exact: true }).click();
await page.getByPlaceholder('water line along the bottom of the wall')
  .fill('supply line under the sink let go overnight');
await page.getByLabel('How far from the corner it starts').fill('0');
await page.getByLabel('How wide it is').fill('9');
await page.getByLabel('How high up the wall it goes').fill('18"');
await page.getByRole('button', { name: 'Mark it' }).click();
await page.waitForTimeout(600);

/** The claim document, as bytes. */
async function claimDocument() {
  await section(page, 'Insurance');
  await page.waitForTimeout(300);
  const send = page
    .locator('section', { has: page.getByRole('heading', { name: 'Send it to the adjuster' }) })
    .first();
  const waitFor = page.waitForEvent('download', { timeout: 30000 });
  await send.getByRole('button', { name: /Make the claim document/ }).click();
  const got = await waitFor;
  let html = '';
  for await (const chunk of await got.createReadStream()) html += chunk;
  await page.waitForTimeout(300);
  return html;
}

const paper = await claimDocument();
const flat = paper.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

check('the day it was found is on the document, under its own name',
  /Found on\s+2026-08-14/.test(flat), (flat.match(/Found on.{0,40}/) ?? []).join(' '));
check('and it is not the same as the day it happened, which is also on it',
  /Date of loss\s+2026-08-11/.test(flat) && FOUND_ON !== LOSS_ON,
  (flat.match(/Date of loss.{0,40}/) ?? []).join(' '));
check('the owner reaches the adjuster with a number to ring, in one line',
  flat.includes(OWNER_LINE), (flat.match(/Owner.{0,80}/) ?? []).join(' '));
check('the carrier reaches the document, because it is who the claim is against',
  /Carrier\s+Ironwood Mutual/.test(flat), (flat.match(/Carrier.{0,60}/) ?? []).join(' '));
check('and the adjuster reaches it with both a number and an address',
  flat.includes(ADJUSTER_LINE), (flat.match(/Adjuster.{0,110}/) ?? []).join(' '));
check('the document still opens with nothing fetched and nothing run',
  !/<script/i.test(paper) && !/src="https?:/.test(paper), 'the claim document reaches out');

/* ----------------------- a phone number with nobody against it is not a party */

// `describeParty` refuses to print a contact with no name, and this is what
// that rule is worth: a claim document that said "— (480) 555-0199" under
// Owner would be handing an adjuster a number to ring and nobody to ask for.
// Half a contact is worse than none, because it looks complete.
await section(page, 'Insurance');
await claim.getByLabel('Owner', { exact: true }).fill('');
await page.waitForTimeout(400);

const orphaned = await claimDocument();
const orphanedFlat = orphaned.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
check('a phone number with nobody\'s name against it is not printed as a party',
  !orphanedFlat.includes(OWNER_PHONE),
  (orphanedFlat.match(/.{0,50}\(480\) 555-0199.{0,30}/) ?? []).join(' '));
check('and there is no Owner line at all, rather than one with a dash and a number',
  !/Owner\s+—/.test(orphanedFlat), (orphanedFlat.match(/Owner.{0,60}/) ?? []).join(' '));
check('while the adjuster, who still has a name, is untouched by it',
  orphanedFlat.includes(ADJUSTER_LINE), (orphanedFlat.match(/Adjuster.{0,110}/) ?? []).join(' '));
check('and the screen says out loud what is now missing, without stopping anything',
  /Still to fill in[^.]*whose property it is/.test(await claim.innerText()),
  (await claim.innerText()).slice(-400));

check('no console or page errors across the whole run', noise().length === 0, noise().join(' | '));

const bad = report('A42 — the business, the carrier, and the adjuster');
await ctx.close();
await browser.close();
process.exit(bad > 0 ? 1 : 0);

/* ==========================================================================
   What this part found, and what it deliberately does not check.

   * **Three boxes on the profile are announced as a paragraph.** `Field` and
     `Lines` in `Settings.tsx` put the explanatory `hint` INSIDE the same
     `<label>` as the caption, so the box's accessible name is the caption plus
     the whole sentence: a screen reader says "Licence number Some states
     require this on anything given to a homeowner." as the NAME of the field.
     `Business address` and `Insurance` are the same, and so is the ceiling
     checkbox, whose name is a caption plus eighty words. It is why every
     `getByLabel` above is a substring match rather than `{ exact: true }` —
     asking for exactly "Licence number" finds nothing. `Claim.tsx` has the
     same `Field`, and `Date of loss` the same shape. Reported rather than
     fixed; the old/new is in the integration note.
   * **The claim screen's summary drops the carrier.** The block under the
     boxes is commented "the way the claim document prints them" and prints
     Owner and Adjuster only, while `claimReport` prints all three. A
     contractor who types a carrier and looks below to check his work sees
     nothing, and the only place the carrier appears on screen is behind the
     "The report" toggle. Driven above: the document carries it, the summary
     does not. Reported rather than fixed.
   * **That any of this survives the phone.** The client file and the claim
     document are read here as bytes; what iCloud, Mail and Messages do with
     them is device-only, and `docs/on-the-phone.md` is where that lives.
   * **The logo size limit.** `takeLogo` refuses anything over 400 kB with a
     sentence naming the size. Driving it means a 400 kB fixture in this
     folder, and the folder already carries a photograph; it belongs with the
     rest of the profile's refusals in a part of its own.
   ========================================================================== */
