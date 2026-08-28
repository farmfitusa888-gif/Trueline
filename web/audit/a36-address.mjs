import { SP, check, loadScan, noise, open, report, section } from './lib.mjs';

/**
 * The address of the seller's place of business, from the profile to the paper.
 *
 * ## What was wrong
 *
 * `Company` had a name, a phone number, an email address, a licence number and
 * an insurance line, and **no address**. So the Agreement screen asked for one
 * per job, in a box called "Where a cancellation gets sent". That is a field a
 * contractor retypes on every proposal, and a field somebody retypes is a field
 * somebody eventually leaves blank.
 *
 * The document it would be blank on is the federal cancellation form. 16 CFR
 * 429.1(c) makes it the seller's own job to complete both copies "by entering
 * the name of the seller, the address of the seller's place of business, the
 * date of the transaction, and the date ... by which the buyer may give notice
 * of cancellation". A buyer who cannot tell where to send a cancellation has
 * been handed a defective notice — on the one form whose whole purpose is
 * telling him where to send it.
 *
 * ## What this walks
 *
 *   1. There is a box for it on the business profile, and the profile says so
 *      while it is empty rather than letting somebody find out on a legal form.
 *   2. Typed once, it survives a reload — it is on the profile, not on a job.
 *   3. It reaches the letterhead on the drawing and the client file.
 *   4. The Agreement screen does not ask for it again.
 *   5. It reaches the proposal document and **both** cancellation forms, inside
 *      the sentence § 429.1(b) puts it in.
 *   6. An address with markup in it comes out as text, not as markup, on a
 *      document that leaves the building and gets opened on somebody else's
 *      phone.
 *   7. Delete it, and the document **says the notice could not be completed**
 *      rather than printing a form with a hole where the address goes. Absent
 *      has to read as absent — never as a blank presented as an address.
 *
 * Nothing below imports anything from the app. Every string it looks for is
 * written out here, so a check cannot pass by agreeing with the code it is
 * checking.
 */

/* ------------------------------------------------------------- the fixtures */

const LINE1 = '2200 Oak Street';
const LINE2 = 'Suite 4';
const LINE3 = 'Mesa AZ 85201';
/**
 * As somebody actually types it into a phone: a blank line where they hit
 * return twice, trailing spaces, and a return on the end. What gets stored has
 * to be the address and not the typing.
 */
const TYPED = `${LINE1}\n\n${LINE2}   \n${LINE3}\n`;
/** The same address, written down the way it should have been written down. */
const TIDY = `${LINE1}\n${LINE2}\n${LINE3}`;
/** The same address as a letterhead and a legal form have to say it: one run. */
const ONE_LINE = `${LINE1}, ${LINE2}, ${LINE3}`;

const BUSINESS = 'Alvarez Remodeling';
const SIGNED_ON = '2026-08-28';        // a Friday
const DEADLINE_SAID = 'Tuesday, September 1, 2026';

/** An address with the two characters that turn text into markup in it. */
const NASTY = `${LINE1} <b>Yard 3</b> & Sons\n${LINE3}`;
const NASTY_AS_TEXT = `${LINE1} &lt;b&gt;Yard 3&lt;/b&gt; &amp; Sons, ${LINE3}`;

const { browser, ctx, page } = await open();

/* ==========================================================================
   1. There is somewhere to put it, and the profile says when there is not.
   ========================================================================== */

await page.getByRole('button', { name: 'Your business' }).click();
await page.waitForTimeout(400);
const profile = page.locator('section').first();

const box = page.getByRole('textbox', { name: /Business address/i }).first();
const boxes = await box.count();
check('the business profile has a box for the address',
  boxes === 1, `${boxes} boxes named "Business address"`);
// Guarded, so that a profile with no address box on it reports a failed check
// rather than a stack trace forty lines further down. A named control that has
// gone missing is the exact bug this part is for; it has to say so plainly.
check('it is a box you can write an address in, not a one-line field',
  boxes === 1 && (await box.evaluate((el) => el.tagName)) === 'TEXTAREA',
  boxes === 1 ? await box.evaluate((el) => el.tagName) : 'there is no box to look at');
if (boxes !== 1) {
  check('there is nothing more to walk without somewhere to type an address', false,
    'the rest of this part needs the box on the business profile');
  report('A36 — the address of the place of business');
  await ctx.close();
  await browser.close();
  process.exit(1);
}

let t = await profile.innerText();
check('while it is empty the profile says so, rather than letting a legal form say it',
  /No address yet/.test(t), t.slice(0, 1200));
check('and it says what an empty one costs, in plain words',
  /cannot carry its cancellation forms/.test(t), t.slice(0, 1400));

/* ==========================================================================
   2. Typed once, on the profile — and it stays there.
   ========================================================================== */

await page.getByRole('textbox', { name: /Business name/i }).first().fill(BUSINESS);
await box.fill(TYPED);
await box.blur();
await page.waitForTimeout(250);

t = await profile.innerText();
check('the letterhead preview shows the address the moment it is typed',
  t.includes(ONE_LINE), t.slice(0, 1500));
check('and the warning goes away once there is one',
  !/No address yet/.test(t), t.slice(0, 1200));

await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForTimeout(500);

// What gets written down is the address, not the typing. A blank line stored
// in the middle of an address is a blank line printed in the middle of one.
await page.getByRole('button', { name: 'Your business' }).click();
await page.waitForTimeout(400);
check('saving keeps the address and not the empty lines and stray spaces around it',
  (await page.getByRole('textbox', { name: /Business address/i }).first().inputValue()) === TIDY,
  JSON.stringify(await page.getByRole('textbox', { name: /Business address/i })
    .first().inputValue()));
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForTimeout(400);

// The whole point of moving it off the job: it is typed once and it is still
// there tomorrow. A reload is the closest this can get to tomorrow.
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.getByRole('button', { name: 'Your business' }).click();
await page.waitForTimeout(400);
const again = page.getByRole('textbox', { name: /Business address/i }).first();
check('the address is still there after a reload, because it belongs to the business',
  (await again.inputValue()).includes(LINE1) && (await again.inputValue()).includes(LINE3),
  JSON.stringify(await again.inputValue()));
check('and it comes back as the lines it belongs on, tidied, not as the typing',
  (await again.inputValue()) === TIDY, JSON.stringify(await again.inputValue()));
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForTimeout(400);

/* ==========================================================================
   3. It reaches the drawing and the client file.
   ========================================================================== */

await loadScan(page);
t = await page.locator('body').innerText();
check('the address is on the letterhead on the drawing',
  t.includes(ONE_LINE), t.slice(0, 600));

await section(page, 'Files');
const send = page
  .locator('section', { has: page.getByRole('heading', { name: 'Send the drawing' }) })
  .first();
const [clientDownload] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  send.getByRole('button', { name: /Send to the client/ }).click(),
]);
await clientDownload.saveAs(SP + '/audit-a36-client.html');

const clientDoc = await ctx.newPage();
const fetched = [];
clientDoc.on('request', (r) => { if (!r.url().startsWith('file://')) fetched.push(r.url()); });
await clientDoc.goto('file://' + SP + '/audit-a36-client.html');
await clientDoc.waitForTimeout(400);
const clientText = await clientDoc.locator('body').innerText();
check('the address is on the client file the homeowner keeps',
  clientText.includes(ONE_LINE), clientText.slice(0, 500));
check('and that file still fetches nothing, so it works with no signal',
  fetched.length === 0, fetched.join(', '));
await clientDoc.close();

/* ==========================================================================
   4. A priced proposal, signed at the client's home.
   ========================================================================== */

await section(page, 'Price');
await page.getByRole('button', { name: /Set your rates|Your rates/ }).first().click();
await page.waitForTimeout(300);
const rates = page
  .locator('section', { has: page.getByRole('heading', { name: 'What you charge' }) })
  .first();
for (const rate of await rates.getByRole('textbox').all()) {
  await rate.fill('5.00');
  await rate.blur();
  await page.waitForTimeout(100);
}

await section(page, 'Agreement');
await page.getByRole('button', { name: 'Write the proposal' }).click();
await page.waitForTimeout(400);
await page.getByLabel('Who it is for').fill('M. Alvarez');
await page.getByLabel('Address of the work').fill('14 Sycamore');
await page.getByRole('button', { name: 'Save these details' }).click();
await page.waitForTimeout(300);

const panel = page.locator('[data-panel="agree"]');
await panel.getByRole('button', { name: 'Their home', exact: true }).click();
await page.waitForTimeout(300);
await page.getByLabel('The day it gets signed').fill(SIGNED_ON);
await page.waitForTimeout(400);

t = await panel.innerText();
check('the Agreement screen does not ask for the address again',
  (await page.getByLabel('Where a cancellation gets sent').count()) === 0,
  'the per-job address box is still on the Agreement screen');
check('it uses the one off the profile and says so on screen',
  t.includes(ONE_LINE), t.slice(0, 2500));
check('and it still names the deadline it works out',
  t.includes(DEADLINE_SAID), `expected ${DEADLINE_SAID} — ${t.slice(0, 2500)}`);

/* ==========================================================================
   5. The document, and both cancellation forms.
   ========================================================================== */

async function sendAndRead() {
  const waitFor = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Send th(is|e signed) proposal$/ }).click();
  const got = await waitFor;
  const html = await got.createReadStream().then(async (stream) => {
    let text = '';
    for await (const chunk of stream) text += chunk;
    return text;
  });
  await page.waitForTimeout(400);
  return html;
}

const out = await sendAndRead();

check('the proposal carries the address on its letterhead',
  out.includes(ONE_LINE), 'the address is not on the proposal');
check('there are two cancellation forms on it, because the rule says in duplicate',
  (out.match(/NOTICE OF CANCELLATION/g) || []).length === 2,
  `${(out.match(/NOTICE OF CANCELLATION/g) || []).length} forms`);
check('both forms are completed with the address off the profile, as 429.1(c) requires',
  (out.match(new RegExp(ONE_LINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length >= 3,
  'the profile address is not on both copies as well as the letterhead');
check('the address sits inside the sentence the rule puts it in, on both copies',
  (out.match(
    new RegExp(`at ${ONE_LINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, NOT LATER THAN MIDNIGHT`, 'g')
  ) || []).length === 2,
  'the form does not say where to send the cancellation');
check('nothing on the form has a hole where the address goes',
  !/at ,/.test(out) && !/at \./.test(out) && !/to [^,]*, at , /.test(out),
  'a blank was printed where the address should be');
check('the address is written as one run, never broken across a line by accident',
  !new RegExp(`${LINE1}\\s*\\n\\s*${LINE2}`).test(out.replace(/<br>/g, ' ')),
  'the address ran onto two lines inside a sentence');
check('the document still fetches nothing and runs nothing',
  !/<script/i.test(out) && !/https?:\/\//.test(out.replace(/xmlns[^ >]*/g, '')),
  'the document reaches out');

/* ==========================================================================
   6. An address with markup in it is text, not markup.
   ========================================================================== */

await page.getByRole('button', { name: 'Your business' }).click();
await page.waitForTimeout(400);
await page.getByRole('textbox', { name: /Business address/i }).first().fill(NASTY);
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForTimeout(500);
await section(page, 'Agreement');
await page.waitForTimeout(300);

const escaped = await sendAndRead();
check('an angle bracket somebody typed comes out as text, on a file that leaves the building',
  escaped.includes(NASTY_AS_TEXT), 'the address was not escaped the way it was typed');
check('and never as a tag',
  !escaped.includes('<b>Yard 3</b>'), 'typed markup became real markup');
check('the ampersand survives as an ampersand rather than half an entity',
  escaped.includes('&amp; Sons'), 'the & was not escaped');
check('the escaped address is on both cancellation forms too',
  (escaped.match(/&lt;b&gt;Yard 3&lt;\/b&gt;/g) || []).length >= 3,
  'the escaping stopped at the letterhead');

/* ==========================================================================
   7. Delete it. The document has to SAY so, not print a form with a hole.
   ========================================================================== */

await page.getByRole('button', { name: 'Your business' }).click();
await page.waitForTimeout(400);
await page.getByRole('textbox', { name: /Business address/i }).first().fill('');
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForTimeout(500);
await section(page, 'Agreement');
await page.waitForTimeout(400);

t = await panel.innerText();
check('with the address gone the screen says what is missing and where to fix it',
  /address of your place of business/.test(t) && /business profile/.test(t), t.slice(0, 2500));

const holed = await sendAndRead();
check('no cancellation form is printed at all when it cannot be completed',
  !/NOTICE OF CANCELLATION/.test(holed), 'a form was printed with a hole in it');
check('the document says the notice could not be completed, where the forms would have been',
  /THIS NOTICE COULD NOT BE COMPLETED/.test(holed), 'the document went quiet about it');
check('it names the rule and whose job it was',
  /16 CFR 429\.1\(c\)/.test(holed) && /address of the seller’s place of business/.test(holed),
  'the document does not say what was owed');
check('it tells the seller where to fix it',
  /business profile/.test(holed), 'the document does not say where the address goes');
check('and it tells the buyer the right does not depend on the paperwork',
  /the right to cancel does not depend on this paperwork existing/.test(holed),
  'the buyer is left thinking the missing form means no right');
check('the stand-in is never captioned like the real form, so nobody posts it',
  !/I HEREBY CANCEL/.test(holed), 'the stand-in can be mistaken for the form');
check('and nowhere does an empty address get printed as an address',
  !new RegExp(`to ${BUSINESS}, at ,`).test(holed) && !/, at , NOT LATER/.test(holed),
  'a blank was presented as an address');
check('the letterhead simply has no address line rather than an empty one',
  !/<p><\/p>/.test(holed) && !/<p>\s*<\/p>/.test(holed),
  'an empty letterhead line was printed');

check('no console or page errors across the whole run', noise().length === 0, noise().join(' | '));

const bad = report('A36 — the address of the place of business');
await ctx.close();
await browser.close();
process.exit(bad > 0 ? 1 : 0);
