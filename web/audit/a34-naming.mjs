import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, noise, openAsApp, report, reportEvenIfItDies, section, sentTo, SP } from './lib.mjs';

// Say what was learned even if this part dies part way through.
reportEvenIfItDies('A34 — what a room is called, in one place');

/**
 * What a room is called — one fact, one home, on every screen that shows it.
 *
 * ## The failure this part exists to prevent
 *
 * Sam renamed a room to UPSTAIRS. The correction screen said UPSTAIRS. The bar
 * at the top of the app and the Rooms list both went on saying
 * "Room 2026-08-26 0927", which is the timestamp the folder was made under.
 *
 * That is not a cosmetic disagreement. The last time a name said one thing in
 * one place and another thing in another, Sam deleted a scan with **53
 * photographs** in it, believing it was a duplicate of the room sitting next to
 * it. Photographs of a wall that is now closed up cannot be taken again. So a
 * name that lives in two places is not a tidiness problem in this app — it is
 * the most expensive bug it has ever had, and this file is the fence around it.
 *
 * ## What is checked here, and what only a phone can answer
 *
 * The first half runs the real app, through `openAsApp`, which installs the
 * same message handlers `CorrectView` registers and parks the same payload
 * `CorrectView.hand(over:)` writes. `sentTo(page, 'saved')` then reads back
 * exactly what the phone would have received. That is the only place on this
 * machine where "the app was handed the new name" is a fact rather than a
 * hope.
 *
 * The second half reads the Swift sources and asserts the invariants that keep
 * the name single. There is no Mac and no iPhone here, so no Swift runs — but
 * "exactly one function writes this field" is a property of the text, and it is
 * the property that broke. `core/tools/check-*.py` already work this way and
 * for the same reason.
 *
 * What is NOT proven here, and cannot be without a device: that the title bar
 * on a real iPhone redraws when the card changes underneath it, and that
 * `writeCorrected` actually lands on the phone's disk. Both are stated in the
 * report as device-only.
 */

const ROOT = join(SP, '..', '..');
const FOLDER = 'Room 2026-08-26 0927';
const NEW_NAME = 'UPSTAIRS';

const kitchen = JSON.parse(readFileSync(join(SP, 'kitchen.json'), 'utf8'));

/* ==========================================================================
   `RoomCard.name(inside:)`, as a contract rather than as Swift.

   The Swift is in `ios/Trueline/RoomCard.swift` and cannot run here. What CAN
   run here is its contract against the same bytes `persist.ts` writes, which
   is the half that actually broke: the shape of a saved project changing under
   a reader that is written in another language and compiled on another
   machine. Every case below is a real state a folder on the phone can be in.
   ========================================================================== */

function nameInside(projectText) {
  let top;
  try {
    top = JSON.parse(projectText);
  } catch {
    return 'Room';
  }
  if (typeof top !== 'object' || top === null) return 'Room';
  const clean = (value) => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  };
  const room = top.room;
  if (room && typeof room === 'object') {
    const named = clean(room.name);
    if (named !== null) return named;
  }
  return clean(top.fileName) ?? 'Room';
}

/* ==========================================================================
   1. The room arrives exactly as the app hands one over, and is handed
      straight back to be kept.
   ========================================================================== */

const { ctx, page } = await openAsApp({
  subscribed: true,
  room: kitchen,
  fileName: FOLDER,
});

const onOpen = await sentTo(page, 'saved');
check('opening a room hands it to the app to keep, before anything is edited',
  onOpen.length > 0 && typeof onOpen.at(-1)?.project === 'string', `${onOpen.length} sent`);

const first = JSON.parse(onOpen.at(-1).project);
check('and out of the importer the room is called what the folder is called',
  first.room?.name === FOLDER, JSON.stringify(first.room?.name));

// This is the fact that makes a second home for the name impossible to keep:
// the app is handed a save the moment a room opens, and `writeCorrected`
// copies the name out of it onto the card. Anything else holding a name of its
// own is overwritten on the next open, silently, by a save nobody asked for.
check('so the name in that save is what the list will be told the room is called',
  nameInside(onOpen.at(-1).project) === FOLDER, nameInside(onOpen.at(-1).project));

/* ==========================================================================
   2. Renaming it. The name has to reach the bytes the app is handed — not
      only the screen it was typed on.
   ========================================================================== */

await section(page, 'Plan');
const rename = page.getByRole('button', { name: /^Rename / });
check('the room says out loud that it can be renamed, naming the room',
  (await rename.count()) === 1, `${await rename.count()} found`);
await rename.first().click();
await page.waitForTimeout(250);

const box = page.getByLabel('What to call this room');

// The button that sets the name is still findable as exactly "Set", and that is
// a check rather than an accident: `a6-persist.mjs` presses it by that name to
// prove a rename is kept across a reload, and it is not this part's file to
// edit. Giving this button the accessible name it deserves -- "Set what to call
// this room", the way the wall's Set says which Set it is -- would break the one
// other check in the project that watches a room name survive. Whoever owns
// `a6-persist.mjs` should make that trade; see the note at the foot of this file.
const named = page.getByRole('button', { name: 'Set what to call this room' });
const plain = page.getByRole('button', { name: 'Set', exact: true });
check('the button that sets the name is still reachable by the name A6 presses it by',
  (await named.count()) === 1 || (await plain.count()) === 1,
  `${await named.count()} named, ${await plain.count()} plain`);

const room = page.locator('div').filter({ has: box }).last();
async function pressSet() {
  if (await named.count()) await named.first().click();
  else await room.getByRole('button', { name: /^Set$/ }).first().click();
  await page.waitForTimeout(450);
}

/**
 * Puts the rename box back when the control has shut itself.
 *
 * Only ever needed on the broken behaviour this part was written against: a
 * refusal closed the box. It is here so the rest of the checks report failures
 * instead of the whole part dying on a missing field, which would hide every
 * check after the first one that breaks.
 */
async function openRename() {
  if (await box.count()) return;
  await rename.first().click();
  await page.waitForTimeout(250);
}

// Sam pressed Set on a box that LOOKED like it held the room's name, because
// the current name was sitting in it as grey placeholder text. An empty box
// showing the name it is about to change is a box that lies about what the
// button next to it will do.
check('the box opens holding the name it is about to change, so Set means what it shows',
  (await box.inputValue()) === FOLDER, `box holds "${await box.inputValue()}"`);

/* ------------------------------------------- a refusal you can actually see */

await box.fill('   ');
await pressSet();

check('a blank name is refused rather than accepted in silence',
  (await page.getByLabel('What to call this room').count()) === 1,
  'the rename box closed as if it had worked');
check('and it says why, where the button was pressed',
  (await page.getByRole('status').filter({ hasText: /name/i }).count()) >= 1,
  (await page.locator('body').innerText()).slice(0, 400));

// A name the room itself refuses. `renameRoom` in core/src/edit.ts turns down
// anything over 120 characters, and until now that refusal happened after this
// control had already closed itself — so the sheet shut, nothing changed, and
// the reason was somewhere else on the screen.
await openRename();
await box.fill('x'.repeat(121));
await pressSet();
check('a name the room refuses leaves the box open, with the name still in it',
  (await box.count()) === 1 && (await box.inputValue()).length === 121,
  (await box.count()) === 0 ? 'the box closed itself on a refusal'
    : `the box holds ${(await box.inputValue()).length} characters`);
check('and the reason is beside the button, not in a panel somewhere else',
  (await page.getByRole('status').filter({ hasText: /121|name/i }).count()) >= 1,
  (await page.locator('body').innerText()).slice(0, 400));

/* --------------------------------------------------------- and now the name */

await openRename();
await box.fill(NEW_NAME);
await pressSet();
await page.waitForTimeout(500);

const body = await page.locator('body').innerText();
check('the room screen says the new name', body.includes(NEW_NAME), body.slice(0, 300));

const after = await sentTo(page, 'saved');
check('and the app is handed a save carrying it',
  after.length > onOpen.length, `${onOpen.length} before, ${after.length} after`);

const renamed = JSON.parse(after.at(-1).project);
check('the new name is in the room data the app was handed, not only on screen',
  renamed.room?.name === NEW_NAME, JSON.stringify(renamed.room?.name));

// The folder is an address, not a label. Its name is the key in iCloud and the
// path under every photograph in the scan, and moving it is how a backup ends
// up pointing at nothing. A rename must never touch it.
check('and the folder it lives in is untouched — an address, not a label',
  renamed.fileName === FOLDER, JSON.stringify(renamed.fileName));
check('the message the app receives still names the same folder',
  after.at(-1).fileName === FOLDER, JSON.stringify(after.at(-1).fileName));

check('and `RoomCard.name(inside:)` reads the new name out of those exact bytes',
  nameInside(after.at(-1).project) === NEW_NAME, nameInside(after.at(-1).project));

/* ==========================================================================
   3. The same contract, on every other state a folder can be in.
   ========================================================================== */

check('a room with no name of its own falls back to the folder name',
  nameInside(JSON.stringify({ fileName: FOLDER, room: {} })) === FOLDER);
check('a room named with nothing but a space has no name at all',
  nameInside(JSON.stringify({ fileName: FOLDER, room: { name: '   ' } })) === FOLDER);
check('a name with spaces round it is the name without them',
  nameInside(JSON.stringify({ fileName: FOLDER, room: { name: '  UPSTAIRS  ' } })) === NEW_NAME);
check('nothing readable at all is "Room", which is never written onto a card',
  nameInside('not json') === 'Room' && nameInside(JSON.stringify({})) === 'Room');

await ctx.close();

/* ==========================================================================
   4. The invariants that keep the name single, in the Swift that shows it.

      No Swift runs on this machine — there is no Mac and no iPhone here — so
      these are assertions about the source. They are the ones that broke, and
      they are the ones a compiler could not have caught either: two functions
      each writing the same field is valid Swift.
   ========================================================================== */

const store = readFileSync(join(ROOT, 'ios/Trueline/ProjectStore.swift'), 'utf8');
const review = readFileSync(join(ROOT, 'ios/Trueline/ReviewScreen.swift'), 'utf8');
const projects = readFileSync(join(ROOT, 'ios/Trueline/ProjectsScreen.swift'), 'utf8');
const card = readFileSync(join(ROOT, 'ios/Trueline/RoomCard.swift'), 'utf8');

// One home. `card.name` is a copy of `room.name` and nothing else, so exactly
// one function may write it. It was two: `writeCorrected` copied the room's
// name onto the card on every save, and `rename` wrote a name of its own from
// the Rooms list. Because a save arrives the moment a room opens (checked
// above), the second writer's name was wiped the next time the room was
// opened, silently, and the list went back to the timestamp.
const writes = store.match(/card\.name\s*=/g) ?? [];
check('exactly one function in the app writes a room\'s name onto its card',
  writes.length === 1, `${writes.length} places assign card.name`);

check('and it writes what the correction screens saved, through one reader',
  /RoomCard\.name\(inside:/.test(store), 'writeCorrected no longer reads the saved room');

// The room's own screen has to be titled with the room's name. It was titled
// `scan.title`, which is `entry.name`, which is the folder's own name — so the
// bar at the top said "Room 2026-…" for a room called UPSTAIRS, and truncated
// a timestamp into something that identifies nothing.
check('the room screen is titled with the room\'s name, not the folder\'s',
  !/\.navigationTitle\(scan\.title\)/.test(review),
  'ReviewScreen still titles itself with the folder name');
check('and it reads that name from the one place the app keeps it',
  /store\.name\(of:\s*scan\.folder\)/.test(review),
  'ReviewScreen does not read the room name from the store');

// And the folder's name must stay exactly what it is, everywhere it is used as
// an address: `Backup.push(scan:)` names the iCloud record with it, and the
// photographs already sit under it.
check('the scan\'s folder name is still what goes to iCloud as its address',
  /scan:\s*scan\.title/.test(review), 'the backup no longer names the record by the folder');
check('and the correction screens are still handed the folder name as the room\'s key',
  /title:\s*scan\.title/.test(review), 'CorrectView is no longer given the folder name');

// House style, and the reason it is house style: a comment that does not name
// the failure it prevents is a comment somebody deletes in a year. This one
// costs 53 photographs when it is got wrong, and both files that decide what a
// room is called have to say so.
check('the card still says why the folder name never moves, and what it cost',
  /deliberately does NOT change/.test(card) && /53 photograph/.test(card),
  'RoomCard no longer states the rule, or no longer names the failure');
check('and the room screen says why its title is the room\'s name',
  /53 photograph/.test(review), 'ReviewScreen does not name the failure it prevents');

/* ==========================================================================
   5. "How do you put a room into a job?"

      The Rooms screen says "Not in a job yet" over a room and, until now, the
      only way to answer it was a long press on the row, a menu, and an item
      called "Rename or file it". Sam asked how to do it, which is the whole
      evidence needed that it could not be found. A control nobody can find is
      a control that does not exist.
   ========================================================================== */

check('the words "Not in a job yet" are still what the screen says',
  projects.includes('Not in a job yet'), 'the wording changed without the control');

const unfiled = projects.slice(projects.indexOf('Not in a job yet'));
check('and there is a button beside those words, not only inside a long press',
  /Not in a job yet[\s\S]{0,700}?Button\s*\{/.test(unfiled),
  'nothing tappable within 700 characters of the four words');

check('the way in names the job, in the words a contractor uses',
  /Put (it|them|these) in a job/.test(projects),
  'no control says what putting a room in a job is called');

check('and filing a room is still one function, so the two ways in cannot differ',
  (projects.match(/store\.file\(/g) ?? []).length >= 1
  && /func file\(/.test(store), 'the store no longer owns filing');

check('naming a room is not offered by the list at all, because the room owns its name',
  !/func rename\(/.test(store),
  'ProjectStore still has a second writer for the name');

check('naming: no console or page errors', noise().length === 0, noise().join(' | '));

const bad = report('A34 — what a room is called, in one place');
process.exit(bad > 0 ? 1 : 0);

/* ==========================================================================
   What this part could not check, and who has to.

   * **The accessible name of the room's Set button.** It is "Set". The wall's
     is "Set what to call this wall". Fixing the room's means editing
     `a6-persist.mjs`, which presses it by `{ name: 'Set', exact: true }` — one
     line, in a file this part does not own.
   * **That the title bar on a real iPhone redraws when the card changes.**
     `ReviewScreen` reads `store.name(of: scan.folder)` and `store.scans` is
     `@Published`, so it should; nothing here can watch it happen. There is no
     Mac and no iPhone on this machine and no Swift is compiled or run by any
     check above.
   * **That `writeCorrected` reaches the phone's disk at all.** Everything here
     proves the app is HANDED the right bytes. What the app does with them is
     Swift, and only a device can answer it.
   ========================================================================== */
