import { check, loadScan, noise, open, report, section } from './lib.mjs';

/**
 * The second way to get a proposal signed, and the notice the law puts on it.
 *
 * > "SOUNDS GOOD, SO NOW WE'LL HAVE 2 WAYS TO GET THE PROPOSAL SIGNED"
 * > "FIX THAT" — about the FTC three-day cancellation notice.
 *
 * ## What this part is actually testing
 *
 * Two things the app could not do. It could send a proposal and it could take a
 * signature on the phone; it could not **file the signed copy back**, so a
 * proposal signed at a kitchen table on Sunday night lived in a text thread and
 * the job had no record it had ever been agreed. And nothing anywhere put the
 * federal three-day cancellation notice on a document signed in somebody's
 * house, which is where a remodeler signs almost everything.
 *
 * ## Every date here is worked out on this side
 *
 * The business-day arithmetic below is written out again, from the regulation,
 * rather than imported from `core/src/cooling.ts`. That is the whole point: a
 * screen that agrees with its own module proves that two copies of one mistake
 * agree. The failure this feature produces is a legal deadline that is one day
 * short, printed on a form a homeowner keeps, and only arithmetic done outside
 * the app can see it.
 *
 * 16 CFR 429.0 defines a business day as "any calendar day except Sunday or any
 * federal holiday". Saturday counts. That is not what anybody means by a
 * business day and it is what the rule says, so it is what is implemented here
 * — twice, independently, on purpose.
 *
 * ## The order these would break in
 *
 *   1. The app asks where it gets signed, does not answer for him, and says so.
 *   2. Answered "at the client's home", it names a deadline that matches the
 *      one worked out here, and explains the counting rather than only the date.
 *   3. The document that goes out carries the bold statement, both cancellation
 *      forms filled in with the seller, the date and that deadline, and says
 *      plainly what it does not know about any state's own rule.
 *   4. Answered "at your own place of business", the notice comes off and the
 *      app says why rather than going quiet.
 *   5. A signed copy files back against the proposal, records who says they
 *      signed and how it arrived, and refuses to pretend it is as good as
 *      signing on the phone.
 *   6. A signed copy that does not fit is refused, loudly: a date before the
 *      document was sent, and a proposal that has been edited since it went.
 */

/* ===================================================================
   The regulation, implemented here, from its own words. Nothing below
   imports anything the app uses to work these out.
   =================================================================== */

const DAY = 86400000;
const asDay = (text) => Date.parse(`${text}T00:00:00Z`) / DAY;
const asText = (day) => new Date(day * DAY).toISOString().slice(0, 10);
const weekdayOf = (day) => new Date(day * DAY).getUTCDay();

/** The nth given weekday of a month, e.g. the third Monday of January. */
function nth(year, month, wanted, n) {
  const first = Date.UTC(year, month - 1, 1) / DAY;
  return first + ((wanted - weekdayOf(first) + 7) % 7) + (n - 1) * 7;
}

/** The last given weekday of a month, e.g. the last Monday of May. */
function last(year, month, wanted) {
  const after = Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1) / DAY - 1;
  return after - ((weekdayOf(after) - wanted + 7) % 7);
}

/** The eleven federal holidays, plus the weekday a weekend one is observed on. */
function holidays(year) {
  const out = new Set();
  for (const [m, d] of [[1, 1], [6, 19], [7, 4], [11, 11], [12, 25]]) {
    const day = Date.UTC(year, m - 1, d) / DAY;
    out.add(day);
    if (weekdayOf(day) === 6) out.add(day - 1);
    if (weekdayOf(day) === 0) out.add(day + 1);
  }
  out.add(nth(year, 1, 1, 3));
  out.add(nth(year, 2, 1, 3));
  out.add(last(year, 5, 1));
  out.add(nth(year, 9, 1, 1));
  out.add(nth(year, 10, 1, 2));
  out.add(nth(year, 11, 4, 4));
  return new Set([...out].map(asText));
}

/** § 429.0: any calendar day except Sunday or any federal holiday. */
function businessDay(text) {
  const day = asDay(text);
  if (weekdayOf(day) === 0) return false;
  return !holidays(Number(text.slice(0, 4))).has(text);
}

/** § 429.1(a): midnight of the third business day AFTER the transaction. */
function deadlineFor(text) {
  let day = asDay(text);
  let left = 3;
  while (left > 0) {
    day += 1;
    if (businessDay(asText(day))) left -= 1;
  }
  return asText(day);
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

/** A date spelled the way a document has to spell it. */
function spell(text) {
  const at = new Date(asDay(text) * DAY);
  return `${DAY_NAMES[at.getUTCDay()]}, ${MONTHS[at.getUTCMonth()]} ${at.getUTCDate()}, ` +
    `${at.getUTCFullYear()}`;
}

/* -- proof that this side's arithmetic is not simply "three days later" -- */

// Friday 28 August 2026: Saturday is the first business day, Sunday is not one,
// Monday the second, Tuesday the third. Written out here so a reader can check
// the harness itself before trusting what it says about the app.
if (deadlineFor('2026-08-28') !== '2026-09-01') {
  throw new Error('the audit’s own business-day arithmetic is wrong; fix it before trusting it');
}
if (deadlineFor('2026-07-02') !== '2026-07-08') {
  throw new Error('the audit’s own holiday handling is wrong; fix it before trusting it');
}
if (businessDay('2026-08-29') !== true || businessDay('2026-08-30') !== false) {
  throw new Error('the audit has Saturday and Sunday the wrong way round');
}

/* ==================================================================== */

const { browser, ctx, page } = await open();
await loadScan(page);

/* -------------------------------------- a business, priced, and a proposal */

await section(page, 'Price');
await page.getByRole('button', { name: /Set your rates|Your rates/ }).first().click();
await page.waitForTimeout(300);
const rates = page
  .locator('section', { has: page.getByRole('heading', { name: 'What you charge' }) })
  .first();
for (const box of await rates.getByRole('textbox').all()) {
  await box.fill('5.00');
  await box.blur();
  await page.waitForTimeout(100);
}

// A letterhead, because 429.1(c) makes the seller's own name and address the
// seller's job to put on the cancellation form, and a form with a hole in it
// is the defect this is meant to stop.
await page.getByRole('button', { name: 'Your business' }).click();
await page.waitForTimeout(400);
await page.getByRole('textbox', { name: /Business name/i }).first().fill('Alvarez Remodeling');
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForTimeout(500);

await section(page, 'Agreement');
await page.getByRole('button', { name: 'Write the proposal' }).click();
await page.waitForTimeout(400);
await page.getByLabel('Who it is for').fill('M. Alvarez');
await page.getByLabel('Address of the work').fill('14 Sycamore');
await page.getByRole('button', { name: 'Save these details' }).click();
await page.waitForTimeout(300);

const panel = page.locator('[data-panel="agree"]');
let t = await panel.innerText();

/* ==========================================================================
   1. The question, unanswered, and the app refusing to answer it.
   ========================================================================== */

check('the app asks where the proposal gets signed',
  /Where does this get signed\?/.test(t), t.slice(0, 600));
check('and says it will not guess',
  /Trueline will not guess it/.test(t), t.slice(0, 900));
check('and the reminder sits beside the send button, where the thumb already is',
  /Answer “where does this get signed\?” below before you send it\./.test(t), t.slice(0, 900));
check('until it is answered it says so rather than going quiet',
  /Not answered, and Trueline will not guess it/.test(t)
  && /goes out with no cancellation notice on it/.test(t), t.slice(0, 1200));
check('nothing about signing is blocked while it is unanswered',
  (await page.getByRole('button', { name: 'Take this one' }).count()) > 0);

// All three answers are offered, and the middle one is the case a contractor
// signing in a coffee shop is actually in.
for (const label of ['Their home', 'Somewhere else', 'Your premises']) {
  check(`"${label}" is one of the answers`,
    (await panel.getByRole('button', { name: label }).count()) === 1, label);
}

/* ==========================================================================
   2. Signed at the client's home. The deadline, worked out on this side.
   ========================================================================== */

await panel.getByRole('button', { name: 'Their home', exact: true }).click();
await page.waitForTimeout(300);

// A transaction date this side chooses, so the deadline is not "three days
// from whenever the machine running this thinks today is".
const SIGNED_ON = '2026-08-28';         // a Friday
const DEADLINE = deadlineFor(SIGNED_ON); // Tuesday 1 September 2026
await page.getByLabel('The day it gets signed').fill(SIGNED_ON);
await page.getByLabel('Where a cancellation gets sent')
  .fill('2200 Oak Street, Mesa AZ 85201');
await page.waitForTimeout(400);
t = await panel.innerText();

check('the notice is owed, and the app cites the rule rather than asserting it',
  /16 CFR 429/.test(t) && /third business day/.test(t), t.slice(0, 1500));
check('the deadline on screen is the one worked out here from the regulation',
  t.includes(spell(DEADLINE)), `expected ${spell(DEADLINE)} — ${t.slice(0, 2000)}`);
check('it explains the counting, because the counting is the surprising part',
  /Saturdays count, Sundays and federal holidays do not/.test(t), t.slice(0, 1800));
check('it says both copies get handed over, which is what the rule asks for',
  /both copies/.test(t) && /one to send back, one to keep/.test(t), t.slice(0, 1800));
check('it says plainly that it does not know this state’s own rule',
  /does not know which state this job is in/.test(t) && /longer than three days/.test(t),
  t.slice(0, 2500));
check('and it never calls itself legal advice',
  /not legal advice/.test(t), t.slice(0, 2500));

// The one figure that would be wrong if somebody "fixed" the counter to skip
// weekends the way everybody else means them.
const WRONG_IF_WEEKENDS_SKIPPED = '2026-09-02';
check('the deadline is not the one you get by skipping Saturdays',
  !t.includes(spell(WRONG_IF_WEEKENDS_SKIPPED)),
  `Saturday was treated as a non-business day — ${spell(WRONG_IF_WEEKENDS_SKIPPED)}`);

/* ==========================================================================
   3. The document that goes out.
   ========================================================================== */

async function sendAndRead() {
  const waitFor = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Send th(is|e signed) proposal$/ }).click();
  const sent = await waitFor;
  const html = await sent.createReadStream().then(async (stream) => {
    let text = '';
    for await (const chunk of stream) text += chunk;
    return text;
  });
  await page.waitForTimeout(400);
  return { html, name: sent.suggestedFilename() };
}

const out = await sendAndRead();

check('the proposal goes out as its own file', /proposal/.test(out.name), out.name);
check('it carries the sentence 16 CFR 429.1(a) requires, word for word',
  out.html.includes(
    'You, the buyer, may cancel this transaction at any time prior to midnight of the ' +
    'third business day after the date of this transaction.'
  ),
  'the § 429.1(a) statement is not on the document');
check('that sentence is set at ten point or more, as the rule requires',
  /\.ten\s*\{[^}]*font-size:\s*1[1-9]pt/.test(out.html)
  && /class="ten"/.test(out.html),
  'the statement is not set in points');
check('the cancellation form is on it, captioned the way the rule captions it',
  /NOTICE OF CANCELLATION/.test(out.html), 'no cancellation form');
check('there are TWO of them, because the rule says in duplicate',
  (out.html.match(/NOTICE OF CANCELLATION/g) || []).length === 2,
  `${(out.html.match(/NOTICE OF CANCELLATION/g) || []).length} copies`);
check('one to send back and one to keep, said on the forms themselves',
  /Copy 1 of 2 — send this one back if you cancel/.test(out.html)
  && /Copy 2 of 2 — keep this one/.test(out.html), 'the copies are not told apart');
check('both are completed with the seller’s name and address, as 429.1(c) requires',
  (out.html.match(/Alvarez Remodeling/g) || []).length >= 2
  && (out.html.match(/2200 Oak Street, Mesa AZ 85201/g) || []).length >= 2,
  'the seller is not on both copies');
check('both are completed with the date of the transaction',
  (out.html.match(new RegExp(`Date of transaction: ${spell(SIGNED_ON)}`, 'g')) || []).length === 2,
  `expected the transaction date ${spell(SIGNED_ON)} on both copies`);
check('both carry the deadline this side worked out, to the day',
  (out.html.match(
    new RegExp(`NOT LATER THAN MIDNIGHT OF ${spell(DEADLINE)}`, 'g')
  ) || []).length === 2,
  `expected NOT LATER THAN MIDNIGHT OF ${spell(DEADLINE)} twice`);
check('the form keeps the paragraphs the rule spells out',
  /without any Penalty or Obligation, within THREE BUSINESS DAYS/.test(out.html)
  && /within TEN BUSINESS DAYS following receipt by the seller/.test(out.html)
  && /any security interest arising out of the transaction will be cancelled/.test(out.html)
  && /does not pick them up within 20 days/.test(out.html)
  && /I HEREBY CANCEL THIS TRANSACTION/.test(out.html),
  'the form has been paraphrased');
check('the document says what it does not know about state law',
  /Many states have their own/.test(out.html) && /not legal advice/.test(out.html),
  'the document is silent about state law');
check('it names no state, because no state’s rule was checked',
  !/\b(California|Arizona|New York|Texas|Florida|Illinois|Ohio)\b/.test(out.html),
  'a state was named');
check('there is somewhere to sign it by hand, for the client who prints it',
  /Printed name/.test(out.html) && /print this, sign below, and\s+send it back/.test(out.html),
  'no by-hand signature block');
check('it fetches nothing and runs nothing, so it works with no signal',
  !/<script/i.test(out.html) && !/https?:\/\//.test(out.html.replace(/xmlns[^ >]*/g, '')),
  'the document reaches out');
check('sending records the fingerprint of what went out',
  /The fingerprint of what went out is/.test(await panel.innerText()),
  (await panel.innerText()).slice(0, 1500));

/* ==========================================================================
   4. Signed at his own place of business. The notice comes off, and the app
      says why instead of going quiet.
   ========================================================================== */

await panel.getByRole('button', { name: 'Your premises', exact: true }).click();
await page.waitForTimeout(400);
t = await panel.innerText();
check('at his own premises the app says no federal notice is owed, and why',
  /not a door-to-door sale/.test(t), t.slice(0, 1500));
check('and still refuses to close the question on the state’s own rule',
  /does not know your state/.test(t), t.slice(0, 1500));

const plain = await sendAndRead();
check('and the document that goes out then carries no cancellation form',
  !/NOTICE OF CANCELLATION/.test(plain.html), 'the notice was printed anyway');
check('nor does it tell the client they have no right to cancel',
  !/no right to cancel/i.test(plain.html), 'the document argues against the client');
check('but it still has somewhere to sign by hand',
  /Printed name/.test(plain.html), 'the by-hand block went with the notice');

// Back to the answer the rest of this part is about.
await panel.getByRole('button', { name: 'Their home', exact: true }).click();
await page.waitForTimeout(300);
await page.getByLabel('The day it gets signed').fill(SIGNED_ON);
await page.waitForTimeout(300);

/* ==========================================================================
   5. A signed copy, filed back.
   ========================================================================== */

t = await panel.innerText();
check('once it has been sent, the app offers to file the signed copy back',
  /A signed copy came back/.test(t), t.slice(0, 2000));
check('and says up front that it is weaker than signing on the phone',
  /weaker evidence than a signature taken here on the phone/.test(t), t.slice(0, 2500));

// A one-pixel PNG stands in for the photograph the client texts back. It is a
// real image with a real data URL, which is all the app ever sees of one.
const PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
async function attach(name = 'signed-page.png', type = 'image/png', body = PHOTO) {
  await page.setInputFiles('input[type=file][accept="image/*,application/pdf"]', {
    name, mimeType: type, buffer: body,
  });
  await page.waitForTimeout(400);
}

// First, the refusals — a record with a hole in it is not filed.
await attach();
await panel.getByRole('button', { name: 'File the signed copy' }).click();
await page.waitForTimeout(400);
t = await panel.innerText();
check('a signed copy with nobody’s name on it is refused, and says why',
  /attributes to nobody/.test(t), t.slice(-1200));

await page.getByLabel('Who signed it').fill('M. Alvarez');
await panel.getByRole('button', { name: 'File the signed copy' }).click();
await page.waitForTimeout(400);
t = await panel.innerText();
check('and one with no date on it is refused too',
  /not a date this can record/.test(t), t.slice(-1200));

// A date before the document was sent. Nobody signed a sheet that did not exist.
await page.getByLabel('The day they say they signed it').fill('2020-01-01');
await panel.getByRole('button', { name: 'File the signed copy' }).click();
await page.waitForTimeout(400);
t = await panel.innerText();
check('a copy dated before the document was sent is refused, loudly',
  /before the document was sent/.test(t) && /did not exist/.test(t), t.slice(-1400));

// A record that says the wrong thing about what it is holding.
await page.getByLabel('The day they say they signed it').fill(new Date().toISOString().slice(0, 10));
await panel.getByRole('button', { name: 'A PDF' }).click();
await page.waitForTimeout(200);
await panel.getByRole('button', { name: 'File the signed copy' }).click();
await page.waitForTimeout(400);
t = await panel.innerText();
check('calling a photograph a PDF is refused, because the record has to describe what it holds',
  /That is not a PDF/.test(t), t.slice(-1200));

// Now a complete one.
await panel.getByRole('button', { name: 'A photograph' }).click();
await page.waitForTimeout(200);
await page.getByLabel('Anything worth putting on the record')
  .fill('Texted it back Tuesday night.');
await panel.getByRole('button', { name: 'File the signed copy' }).click();
await page.waitForTimeout(600);
t = await panel.innerText();

check('a complete signed copy is filed against the job and the proposal',
  /Signed copy on file — M\. Alvarez/.test(t), t.slice(-2500));
check('the record says who SAYS they signed, not who did',
  /M\. Alvarez says they signed it on/.test(t), t.slice(-2500));
check('it records how it arrived',
  /a photograph of the signed page/.test(t), t.slice(-2500));
check('it fingerprints both the document that was sent and the picture itself',
  /fingerprints to/.test(t) && /the picture can be shown not to have been swapped/.test(t),
  t.slice(-2500));
check('and it says, on the record, exactly what it does not show',
  /What it does not show:/.test(t)
  && /is the person who made the mark/.test(t)
  && /has not verified anybody’s identity/.test(t)
  && /their word for it/.test(t),
  t.slice(-2500));
check('the contractor’s own note is kept',
  /Texted it back Tuesday night\./.test(t), t.slice(-2000));
check('the picture itself is kept and shown',
  (await panel.locator('img[alt^="The signed copy that came back"]').count()) === 1);
check('it is never called an agreement, because it is not one',
  !/Agreed — /.test(t), t.slice(-2500));

// And it travels on the document.
const withCopy = await sendAndRead();
check('the filed copy travels on the proposal that goes out',
  /Signed copy on file/.test(withCopy.html)
  && /M\. Alvarez says they signed it on/.test(withCopy.html),
  'the returned copy is not on the document');
check('and what it does not show travels with it',
  /What it does not show:/.test(withCopy.html), 'the honesty was left on the phone');

/* ==========================================================================
   6. The loud refusal: the proposal moved after it went out.
   ========================================================================== */

await page.getByLabel('Address of the work').fill('14 Sycamore Lane');
await page.getByRole('button', { name: 'Save these details' }).click();
await page.waitForTimeout(700);
t = await panel.innerText();

check('editing the proposal after a copy was filed is caught and said out loud',
  /is not the proposal M\. Alvarez signed and sent back/.test(t), t.slice(0, 3000));
check('and it names the change order as the place the change belongs',
  /belongs in a change order/.test(t), t.slice(0, 3000));

// A new copy cannot be filed against the moved document either.
await attach();
await page.getByLabel('Who signed it').fill('M. Alvarez');
await page.getByLabel('The day they say they signed it')
  .fill(new Date().toISOString().slice(0, 10));
await panel.getByRole('button', { name: 'File the signed copy' }).click();
await page.waitForTimeout(500);
t = await panel.innerText();
check('and filing another one against the changed document is refused',
  /not the document that was sent out/.test(t) && /version they never saw/.test(t),
  t.slice(-1600));

check('no console or page errors across the whole run', noise().length === 0, noise().join(' | '));

const bad = report('A27 — the signed copy that came back, and the three-day notice');
await ctx.close();
await browser.close();
process.exit(bad > 0 ? 1 : 0);
