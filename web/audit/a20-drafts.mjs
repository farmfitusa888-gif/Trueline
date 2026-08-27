import { readFileSync } from 'node:fs';
import { check, noise, openAsApp, report, section, sentTo, SP } from './lib.mjs';

/**
 * The four things the phone can write, and the one rule they all obey.
 *
 * > "AI is language, never facts and never money." — CLAUDE.md
 *
 * Two properties are checked here and nothing else matters as much:
 *
 * 1. **Nothing is offered when the phone cannot do it.** Not greyed, not
 *    explained — absent, along with every word about it. A browser and an older
 *    iPhone see exactly the screens they always saw.
 * 2. **What goes across is a fact sheet, never an instruction.** The
 *    instruction lives in `Draftsman.Job` on the Swift side, one per job. These
 *    screens run in a web view and a web view runs whatever HTML it is given;
 *    a channel that carried its own instruction would be a channel that
 *    carried any instruction.
 *
 * The model itself is not exercised — there is no Apple Intelligence in a
 * Linux container. What is exercised is every line of the path up to it: what
 * appears, what does not, what is sent, and what happens to the answer.
 */

const kitchen = JSON.parse(readFileSync(`${SP}/kitchen.json`, 'utf8'));

const room = (extra) => ({ subscribed: true, room: kitchen, fileName: 'Kitchen', ...extra });

/* ========================================================================
   1. A phone that cannot run the model is offered nothing at all.
   ======================================================================== */

{
  // `draftable` absent is what an older iPhone hands over — the app says
  // nothing about a model it cannot run.
  const quiet = await openAsApp(room({}), {});
  await section(quiet.page, 'Agreement');
  const agree = await quiet.page.locator('[data-panel="agree"]').innerText();
  check('no draft button where the phone cannot draft',
    !/Draft this line/.test(agree), agree.slice(0, 400));
  check('and not a word about drafting either',
    !/draft/i.test(agree.replace(/proposal/gi, '')), agree.slice(0, 400));

  await section(quiet.page, 'Insurance');
  const turnOn = quiet.page.getByRole('button', { name: 'Turn it on' });
  if (await turnOn.count()) { await turnOn.click(); await quiet.page.waitForTimeout(300); }
  const claim = await quiet.page.locator('[data-panel="claim"]').innerText();
  check('the loss description box is there whether or not a model is',
    /What happened/.test(claim), claim.slice(0, 500));
  check('and nothing offers to write it', !/Draft what happened/.test(claim));

  check('a quiet phone: no console or page errors', noise().length === 0, noise().join(' | '));
  await quiet.ctx.close();
}

/* ========================================================================
   2. A phone that can. The button appears, and what it sends is facts.
   ======================================================================== */

const { ctx, page } = await openAsApp(room({ draftable: true }), {});

await section(page, 'Agreement');
const offer = page.getByRole('button', { name: 'Draft this line' });
check('a phone that can draft is offered it', (await offer.count()) === 1);

await page.getByLabel(/What to call this option/i).fill('Full kitchen refit');
await offer.click();
await page.waitForTimeout(400);

const asked = await sentTo(page, 'draft');
check('asking sends one request', asked.length === 1, `${asked.length} sent`);

const ask = asked[0] ?? {};
check('it names which of the four jobs, and nothing else about what to do',
  ask.job === 'scope', JSON.stringify(ask.job));
check('and carries an id, so an answer can find its question',
  typeof ask.id === 'string' && ask.id !== '');

const notes = String(ask.notes ?? '');
check('the notes are the room and the work in it',
  /Room: Kitchen\./.test(notes) && /Option: Full kitchen refit\./.test(notes),
  notes.slice(0, 300));
// Off the TAKEOFF rather than the priced lines, so a contractor who has not
// typed a rate yet still hands the model actual work. Drafting off the prices
// meant an empty rate book sent a heading and nothing under it -- a paragraph
// written from nothing, which is the one thing this must never produce.
check('with a quantity against each, off the geometry and not off a rate',
  /- .+: [\d,.]+ (sq ft|lf|ea|in)/.test(notes), notes.slice(0, 500));
check('and it works before a single rate has been typed',
  notes.split('\n').filter((l) => l.startsWith('- ')).length >= 4, notes.slice(0, 500));
check('and no instruction of any kind in them',
  !/\b(write|you are|paragraph|never|sentence|instruction)\b/i.test(notes),
  notes.slice(0, 400));

// The answer comes back the way the app sends it.
await page.evaluate((id) => window.trueline.drafted(id, 'Lift the floor, board and paint.'), ask.id);
await page.waitForTimeout(400);
const filled = await page.getByLabel(/One line on what it covers/i).inputValue();
check('the answer lands in the box somebody was already typing in',
  filled === 'Lift the floor, board and paint.', filled);

let agreeText = await page.locator('[data-panel="agree"]').innerText();
check('and it is marked as a draft until somebody reads it',
  /Read it and change anything/.test(agreeText), agreeText.slice(0, 600));

await page.getByLabel(/One line on what it covers/i).fill('Lift the floor, board and paint it.');
await page.waitForTimeout(300);
agreeText = await page.locator('[data-panel="agree"]').innerText();
check('typing in it makes it theirs, and the draft mark goes',
  !/Read it and change anything/.test(agreeText), agreeText.slice(0, 600));

/* ========================================================================
   3. A model that will not answer is not an error.
   ======================================================================== */

await offer.click();
await page.waitForTimeout(300);
const second = (await sentTo(page, 'draft')).at(-1);
await page.evaluate((id) => window.trueline.drafted(id, null), second.id);
await page.waitForTimeout(400);
agreeText = await page.locator('[data-panel="agree"]').innerText();
check('nothing coming back is said plainly and nothing is lost',
  /Nothing came back that time/.test(agreeText), agreeText.slice(0, 600));
check('and the line already in the box is untouched',
  (await page.getByLabel(/One line on what it covers/i).inputValue())
    === 'Lift the floor, board and paint it.');

/* ========================================================================
   4. The claim, which is the one an adjuster reads first.
   ======================================================================== */

await section(page, 'Insurance');
const on = page.getByRole('button', { name: 'Turn it on' });
if (await on.count()) { await on.click(); await page.waitForTimeout(300); }

const lossButton = page.getByRole('button', { name: 'Draft what happened' });
check('the claim offers to draft the loss description', (await lossButton.count()) === 1);
await lossButton.click();
await page.waitForTimeout(400);
const lossAsk = (await sentTo(page, 'draft')).at(-1);
check('as its own job, not the proposal’s', lossAsk.job === 'loss', String(lossAsk.job));
check('and the notes are the claim’s own facts',
  /Room: /.test(String(lossAsk.notes)), String(lossAsk.notes).slice(0, 300));

await page.evaluate(
  (id) => window.trueline.drafted(id, 'The supply line let go overnight.'),
  lossAsk.id
);
await page.waitForTimeout(400);
const wrote = await page.getByLabel('What happened').inputValue();
check('and the answer lands in the loss box', wrote === 'The supply line let go overnight.', wrote);

check('drafting: no console or page errors', noise().length === 0, noise().join(' | '));
await ctx.close();

process.exit(report('A20 — what the phone will write, and what it will not') === 0 ? 0 : 1);
