import { check, contrast, HEIGHT, noise, openAsApp, payingBrowser, report, reportEvenIfItDies, URL } from './lib.mjs';

// Say what was learned even if this part dies part way through.
reportEvenIfItDies('A51 — the owner’s screen, locked, and every figure out of a report');

/**
 * A51 — the owner's screen, driven the way Sam would drive it.
 *
 * ## What this part is for
 *
 * `Owner.tsx` is the one screen in this app that nobody but Sam ever opens, and
 * that is exactly the condition four other bugs in this repository were found
 * in: finished, tested, and never once driven by anything. A screen nobody
 * walks is a screen whose gate might not gate, whose refusals might not refuse,
 * and whose figures might be a month out with nothing to say so.
 *
 * ## The two things it exists to prove, before any of the arithmetic
 *
 * **1. The lock is a lock.** Nothing about the books is on the page before the
 * phrase is typed — not a figure, not a heading, not a month. Locking it again
 * takes them all back off.
 *
 * **2. Apple's fact and Sam's note are never the same thing on the screen.**
 * They are in different words, in different elements, in different colours, and
 * this reads the colours the browser actually painted rather than the class
 * names that asked for them.
 *
 * ## And what it never lets through
 *
 * A report whose columns are not the ones the parser was written against. A
 * currency that is not the one being summed. The same month read in twice. A
 * code given away twice. A withdrawal with no reason. Every one of those has a
 * check below, and every one of them was watched failing before it was believed.
 *
 * Nothing here imports anything from the app. Every string it looks for and
 * every column name it writes is typed out again in this file, so a check
 * cannot pass by agreeing with the code it is checking.
 *
 * Both grounds, at 430 by 800, which is a phone.
 */

/* ------------------------------------------------------------- the fixtures */

const PHRASE = 'a basement with no signal';

/** Apple's Subscriber Report header, written out here rather than imported. */
const MONEY_HEADER =
  'Event Date\tApp Name\tApp Apple ID\tSubscription Name\tSubscription Apple ID\t' +
  'Subscription Group ID\tStandard Subscription Duration\tSubscription Offer Name\t' +
  'Promotional Offer ID\tSubscription Offer Type\tSubscription Offer Duration\t' +
  'Marketing Opt-In Duration\tCustomer Price\tCustomer Currency\tDeveloper Proceeds\t' +
  'Proceeds Currency\tPreserved Pricing\tProceeds Reason\tClient\tDevice\tCountry\t' +
  'Subscriber ID\tSubscriber ID Reset\tRefund\tPurchase Date\tUnits';

/** Apple's Subscription Event Report header, likewise. */
const EVENT_HEADER =
  'Event Date\tEvent\tApp Name\tApp Apple ID\tSubscription Name\tSubscription Apple ID\t' +
  'Subscription Group ID\tStandard Subscription Duration\tSubscription Offer Type\t' +
  'Subscription Offer Duration\tMarketing Opt-In\tMarketing Opt-In Duration\tPreserved Pricing\t' +
  'Proceeds Reason\tSubscription Offer Name\tPromotional Offer ID\tConsecutive Paid Periods\t' +
  'Original Start Date\tDevice\tClient\tState\tCountry\tPrevious Subscription Name\t' +
  'Previous Subscription Apple ID\tDays Before Canceling\tCancellation Reason\tDays Canceled\t' +
  'Quantity\tPaid Service Days Recovered';

function row(header, said) {
  return header
    .split('\t')
    .map((column) => {
      if (column in said) return said[column];
      if (column === 'Units' || column === 'Quantity') return '1';
      if (column === 'Customer Price' || column === 'Developer Proceeds') return '0.00';
      if (column === 'Customer Currency' || column === 'Proceeds Currency') return 'USD';
      if (column === 'App Name') return 'Trueline';
      return '';
    })
    .join('\t');
}

const sheet = (header, rows) => [header, ...rows.map((one) => row(header, one))].join('\n');

/**
 * Two months of money, every figure checkable by hand.
 *
 * July   7.99 x 1  +  78.00 x 2   charged  $163.99   proceeds  $114.79
 *        7.99 handed back                  refunded  $7.99
 * August 78.00 x 1                charged   $78.00   proceeds   $54.60
 *
 * Both months:  $241.99 charged, $169.39 out, $72.60 to Apple and tax.
 */
const MONEY = sheet(MONEY_HEADER, [
  { 'Event Date': '2026-07-02', 'Customer Price': '7.99', 'Developer Proceeds': '5.59', Units: '1' },
  { 'Event Date': '2026-07-19', 'Customer Price': '78.00', 'Developer Proceeds': '54.60', Units: '2', Refund: 'No' },
  { 'Event Date': '2026-07-25', 'Customer Price': '7.99', 'Developer Proceeds': '5.59', Units: '1', Refund: 'Yes' },
  { 'Event Date': '2026-08-03', 'Customer Price': '78.00', 'Developer Proceeds': '54.60', Units: '1', Refund: 'No' },
]);

/** The same two months of events: 4 started, 9 renewed, 3 cancelled. */
const EVENTS = sheet(EVENT_HEADER, [
  { 'Event Date': '2026-07-04', Event: 'Start Introductory Price', Quantity: '3' },
  { 'Event Date': '2026-07-11', Event: 'Renew', Quantity: '5' },
  { 'Event Date': '2026-07-22', Event: 'Cancel', Quantity: '1' },
  { 'Event Date': '2026-07-28', Event: 'Upgrade', Quantity: '2' },
  { 'Event Date': '2026-08-05', Event: 'Reactivate', Quantity: '1' },
  { 'Event Date': '2026-08-09', Event: 'Renew', Quantity: '4' },
  { 'Event Date': '2026-08-27', Event: 'Cancel', Quantity: '2' },
]);

/** The same two months in euros, which must never be added to the dollars. */
const MONEY_IN_EUROS = sheet(MONEY_HEADER, [
  {
    'Event Date': '2026-07-02',
    'Customer Price': '7.99',
    'Developer Proceeds': '5.59',
    'Customer Currency': 'EUR',
    'Proceeds Currency': 'EUR',
  },
  {
    'Event Date': '2026-08-02',
    'Customer Price': '7.99',
    'Developer Proceeds': '5.59',
    'Customer Currency': 'EUR',
    'Proceeds Currency': 'EUR',
  },
]);

/** Something that is plainly not one of Apple's reports. */
const NOT_A_REPORT = ['Event Date\tEvent\tMoney', '2026-07-04\tRenew\t7.99'].join('\n');

const file = (name, text) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text, 'utf8') });

/* -------------------------------------------------- reading the real colours */

/** The colour actually behind a node: the first ancestor that paints. */
const GROUND = `(node) => {
  for (let at = node; at; at = at.parentElement) {
    const paint = getComputedStyle(at).backgroundColor;
    const parts = String(paint).match(/[\\d.]+/g) || [];
    const alpha = parts.length > 3 ? Number(parts[3]) : 1;
    if (alpha > 0.99) return paint;
  }
  return getComputedStyle(document.documentElement).backgroundColor;
}`;

async function words(page) {
  return page.evaluate(
    ([groundSource]) => {
      const groundOf = eval(groundSource);
      const out = [];
      for (const node of document.querySelectorAll('body *')) {
        const own = [...node.childNodes]
          .filter((child) => child.nodeType === 3)
          .map((child) => child.textContent.trim())
          .join(' ')
          .trim();
        if (own.length < 2) continue;
        const box = node.getBoundingClientRect();
        if (box.width < 1 || box.height < 1) continue;
        const style = getComputedStyle(node);
        if (style.visibility === 'hidden' || style.opacity === '0') continue;
        if (node.closest('[hidden]') || node.closest('[aria-hidden="true"]')) continue;
        out.push({
          says: own.slice(0, 60),
          ink: style.color,
          ground: groundOf(node),
          size: parseFloat(style.fontSize),
          weight: Number(style.fontWeight) || 400,
        });
      }
      return out;
    },
    [GROUND]
  );
}

/** WCAG AA: 3:1 for large text, 4.5:1 for the rest. */
function needs(one) {
  const large = one.size >= 24 || (one.size >= 18.66 && one.weight >= 700);
  return large ? 3 : 4.5;
}

async function unreadable(page) {
  const bad = [];
  for (const one of await words(page)) {
    const ratio = contrast(one.ink, one.ground);
    if (ratio < needs(one)) bad.push({ ...one, ratio: Number(ratio.toFixed(2)) });
  }
  return bad;
}

const text = (page) => page.evaluate(() => document.body.innerText);

/* ================================================================== the walk */

async function walk(scheme, deep) {
  const only = (name) => (deep ? name : `${name} (${scheme})`);
  const { browser, ctx, page } = await openAsApp(null, { scheme });
  try {
    await walkOn({ scheme, deep, only, browser, ctx, page });
    check(only('the walk got all the way through the screen'), true);
  } catch (error) {
    // A control that is not there any more throws inside Playwright rather than
    // failing a check, and a part that dies prints nothing at all -- so every
    // check it had already made would be lost with it. This turns that into one
    // more red line and lets the report out.
    check(only('the walk got all the way through the screen'), false, String(error).slice(0, 300));
  } finally {
    await browser.close();
  }
}

async function walkOn({ scheme, deep, only, browser, ctx, page }) {

  // Every request this page makes, so "nothing leaves the device" is a check
  // rather than a paragraph. The bundle's own assets are the only ones allowed.
  const away = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(URL)) away.push(request.url());
  });

  await page.evaluate(() => {
    window.location.hash = 'owner';
  });
  await page.waitForTimeout(400);

  /* ---------------------------------------------------------------- the lock */

  const shut = await text(page);
  if (deep) {
    check('the owner screen is reachable at its own fragment', /The books/.test(shut), shut.slice(0, 200));
    check(
      'nothing about the books is on the page before the phrase is typed',
      !/Free months|What Apple has reported|Who is on TestFlight|Contractors in touch/.test(shut),
      shut.slice(0, 400)
    );
    check('and no figure is on it either', !/\$/.test(shut), shut.slice(0, 400));

    await page.getByLabel('The phrase').fill('short');
    await page.getByRole('button', { name: 'Lock it to a phrase' }).click();
    await page.waitForTimeout(200);
    const refused = await text(page);
    check(
      'a phrase too short to be one is refused, and says how short it was',
      /5 characters/.test(refused) && /at least 8/.test(refused),
      refused.slice(0, 400)
    );
    check('and the books are still shut', !/Free months/.test(await text(page)), 'the books opened anyway');
  }

  await page.getByLabel('The phrase').fill(PHRASE);
  await page.getByRole('button', { name: 'Lock it to a phrase' }).click();
  await page.waitForTimeout(400);

  const open = await text(page);
  if (deep) {
    check(
      'setting the phrase opens the books, and all four things Sam asked for are on it',
      /What Apple has reported/.test(open) &&
        /Free months/.test(open) &&
        /Who is on TestFlight/.test(open) &&
        /What is going wrong/.test(open) &&
        /Contractors in touch/.test(open),
      open.slice(0, 600)
    );
    check(
      'an empty screen says it is empty rather than printing a row of noughts',
      /No report from Apple has been read in yet/.test(open) &&
        /No free months have been given away/.test(open) &&
        !/\$0\.00/.test(open) &&
        /There are no figures yet, rather than figures of nought/.test(open),
      (open.match(/.{0,80}\$0\.00.{0,40}/) ?? []).join(' | ') || open.slice(0, 600)
    );
    const phraseInStore = await page.evaluate(() => window.localStorage.getItem('trueline.owner.lock'));
    check(
      'the phrase itself is nowhere in this browser, only a digest and a salt',
      !String(phraseInStore).includes('basement') && /"digest"/.test(String(phraseInStore)),
      String(phraseInStore).slice(0, 200)
    );
  }

  /* ------------------------------------------------------- Apple's reports */

  await page
    .getByLabel('The Subscriber Report')
    .setInputFiles(file('not-a-report.txt', NOT_A_REPORT));
  await page
    .getByLabel('The Subscription Event Report')
    .setInputFiles(file('S_M_events_July.txt', EVENTS));
  await page.getByLabel('The currency being summed').fill('USD');
  await page.getByRole('button', { name: 'Read them in' }).click();
  await page.waitForTimeout(300);
  if (deep) {
    const said = await text(page);
    check(
      'a file that is not the report the parser was written against is refused, not read',
      /is not the Subscriber Report/.test(said),
      said.slice(0, 800)
    );
    check(
      'and the refusal prints the header it actually found, so it can be corrected',
      /The header it actually has: Event Date \| Event \| Money/.test(said),
      said.slice(0, 800)
    );
    check('nothing was written down by the refusal', !/\$241\.99/.test(said), said.slice(0, 400));
  }

  await page.getByLabel('The Subscriber Report').setInputFiles(file('S_M_money_July.txt', MONEY_IN_EUROS));
  await page.getByRole('button', { name: 'Read them in' }).click();
  await page.waitForTimeout(300);
  if (deep) {
    const said = await text(page);
    check(
      'a report in a currency that is not the one being summed is refused',
      /is in EUR under Customer Currency/.test(said) && /sum one currency at a time/.test(said),
      said.slice(0, 800)
    );
  }

  await page.getByLabel('The Subscriber Report').setInputFiles(file('S_M_money_July.txt', MONEY));
  await page.getByRole('button', { name: 'Read them in' }).click();
  await page.waitForTimeout(400);

  const money = await text(page);
  if (deep) {
    check(
      'two months read in are summed to the cent, and a person can check every one by hand',
      /\$241\.99/.test(money) && /\$169\.39/.test(money) && /\$72\.60/.test(money) && /\$7\.99/.test(money),
      money.slice(0, 1200)
    );
    // The file name has to be on the MONTH's own line, not merely somewhere on
    // the page: the line that says what was just read in names it too, and a
    // check that accepted either would go on passing with the provenance gone
    // off every row.
    check(
      'the months themselves are on the screen, each saying which file it came from',
      /July 2026/.test(money) &&
        /August 2026/.test(money) &&
        /refunded \u00b7 from S_M_money_July\.txt and S_M_events_July\.txt/.test(money),
      money.slice(0, 1200)
    );
    check(
      'the counts are there beside the money',
      /4 started/.test(money) && /9 renewed/.test(money) && /3 cancelled/.test(money),
      money.slice(0, 1200)
    );
    // Looking for a FIGURE, not for the word. The screen says "no year is
    // worked out from them here" and "nothing here is a year, an average or a
    // forecast" in as many words, and a check that banned the word would be
    // banning the sentence that promises it.
    check(
      'no figure on the screen was ever turned into a year, a rate or an average',
      !/\$[\d,]+\.\d{2}\s*(a|per|\/)\s*(year|month|week)/i.test(money) &&
        !/annualis|annualiz|projected|run rate|on average/i.test(money),
      (money.match(/.{0,60}(year|average|forecast).{0,60}/gi) ?? []).join(' | ')
    );

    await page.getByRole('button', { name: 'Read them in' }).click();
    await page.waitForTimeout(300);
    const twice = await text(page);
    check(
      'the same month read in twice is refused, and names the file it came from first',
      /July 2026 has already been read in, from S_M_money_July\.txt/.test(twice),
      twice.slice(0, 900)
    );
    check(
      'and the totals did not move',
      /\$241\.99/.test(twice) && !/\$483\.98/.test(twice),
      twice.slice(0, 900)
    );
  }

  /* --------------------------------------------------------- free months */

  await page.getByLabel('Who it went to').fill('Gilbert Ruiz');
  await page.getByLabel('The offer code').fill('GILBERT3');
  await page.getByLabel('How many months', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Give a named one' }).click();
  await page.waitForTimeout(300);

  const given = await text(page);
  if (deep) {
    check(
      'a named free run says the name is your note and not something Apple reported',
      /you say you gave it to Gilbert Ruiz/.test(given),
      given.slice(0, 1500)
    );
    check(
      'a code Apple has not reported redeemed says the report lags, in so many words',
      /Apple has not reported it redeemed, which is not the same as knowing it was unused/.test(given),
      given.slice(0, 1500)
    );
  }

  await page.getByLabel('Who it went to').fill('Somebody else');
  await page.getByLabel('The offer code').fill('GILBERT3');
  await page.getByRole('button', { name: 'Give a named one' }).click();
  await page.waitForTimeout(250);
  if (deep) {
    const twice = await text(page);
    check(
      'the same code given away twice is refused',
      /GILBERT3 is already in the books/.test(twice),
      twice.slice(0, 900)
    );
  }

  await page.getByLabel('What the batch is called').fill('trade night');
  await page.getByLabel('The codes, one to a line').fill('TN-1\nTN-2\nTN-3');
  await page.getByLabel('How many months in the batch').fill('1');
  await page.getByRole('button', { name: 'Give a batch' }).click();
  await page.waitForTimeout(300);

  const batched = await text(page);
  if (deep) {
    check(
      'a batch goes in as one code per line, each belonging to the batch and to nobody',
      /TN-1/.test(batched) && /TN-3/.test(batched) &&
        /part of the trade night batch, so it went to nobody in particular/.test(batched),
      batched.slice(0, 2000)
    );
  }

  // Apple's own page says one of them was redeemed. Read off App Store Connect
  // and typed, because neither report Apple produces carries the offer code.
  await page.getByLabel('When Apple reported GILBERT3 redeemed').fill('2026-07-02');
  await page.getByRole('button', { name: 'Apple reported GILBERT3 redeemed' }).click();
  await page.waitForTimeout(300);

  const redeemed = await text(page);
  if (deep) {
    check(
      'a redemption reads as Apple’s, on the day Apple gave, with the day it runs out worked out',
      /Apple reported it redeemed on 2 July 2026, so it runs out 2 October 2026/.test(redeemed),
      redeemed.slice(0, 2000)
    );
    check(
      'and no sentence anywhere says Apple reported who redeemed it',
      !/Apple[^.]*(reported|says)[^.]*Gilbert Ruiz/.test(redeemed),
      (redeemed.match(/Apple[^.]*Gilbert[^.]*\./) ?? []).join(' | ')
    );

    const chips = await page.evaluate(() => {
      const fact = [...document.querySelectorAll('span')].find((one) =>
        one.textContent.trim().startsWith('Apple: redeemed')
      );
      const note = [...document.querySelectorAll('span')].find((one) =>
        one.textContent.trim().startsWith('Your note:')
      );
      const paint = (one) =>
        one
          ? { says: one.textContent.trim(), ink: getComputedStyle(one).color, ground: getComputedStyle(one).backgroundColor }
          : null;
      return { fact: paint(fact), note: paint(note) };
    });
    check(
      'Apple’s fact and your note are two separate things on the screen, each saying whose it is',
      chips.fact !== null && chips.note !== null &&
        /^Apple: redeemed/.test(chips.fact.says) && /^Your note:/.test(chips.note.says),
      JSON.stringify(chips)
    );
    check(
      'and they are painted differently, in the colour the browser actually used',
      chips.fact !== null && chips.note !== null &&
        chips.fact.ground !== chips.note.ground && chips.fact.ink !== chips.note.ink,
      JSON.stringify(chips)
    );
    check(
      'a code Apple has reported redeemed can no longer be withdrawn',
      (await page.getByRole('button', { name: 'Withdraw GILBERT3' }).count()) === 0,
      'the withdraw control was still on a redeemed code'
    );
  }

  await page.getByRole('button', { name: 'Withdraw TN-3' }).click();
  await page.waitForTimeout(250);
  if (deep) {
    const noReason = await text(page);
    check(
      'a withdrawal with no reason on it is refused, and says why the reason is kept',
      /Say why the code is being withdrawn/.test(noReason),
      noReason.slice(0, 900)
    );
  }

  await page.getByLabel('Why TN-3 is being withdrawn').fill('printed on the wrong flyer');
  await page.getByRole('button', { name: 'Withdraw TN-3' }).click();
  await page.waitForTimeout(300);
  const withdrawn = await text(page);
  if (deep) {
    check(
      'a withdrawal keeps its reason on the screen for ever, and the grant is not erased',
      /withdrawn .*: printed on the wrong flyer/.test(withdrawn) && /TN-3/.test(withdrawn),
      withdrawn.slice(0, 2000)
    );
    check(
      'and it says Apple had not reported it redeemed, rather than calling it unused',
      /Apple had not reported it redeemed/.test(withdrawn),
      withdrawn.slice(0, 2000)
    );
  }

  /* ---------------------------------------------------------- TestFlight */

  for (const [who, stage] of [
    ['Gilbert Ruiz', 'Opened it'],
    ['Dana Boyle', 'Installed it'],
    ['Marco Pike', 'Invited'],
    ['Ruth Alvarez', 'Asked for it'],
  ]) {
    await page.getByLabel('Who they are').fill(who);
    await page.getByLabel('Where they got to').selectOption({ label: stage });
    await page.getByRole('button', { name: 'Put them on the list' }).click();
    await page.waitForTimeout(120);
  }
  const funnel = await text(page);
  if (deep) {
    check(
      'the funnel counts everybody who got at least that far, and says the gap as a number',
      /4 asked for TestFlight, 1 have opened it/.test(funnel) && /1 did not/.test(funnel),
      funnel.slice(0, 2500)
    );
    check(
      'and it is a number rather than a percentage, before there are enough people for one',
      !/%/.test(funnel),
      (funnel.match(/.{0,40}%.{0,40}/) ?? []).join(' | ')
    );
  }

  /* -------------------------------------------------------- what is broken */

  for (let i = 0; i < 3; i += 1) {
    await page.getByLabel('What it said').fill('Cannot read properties of undefined');
    await page.getByLabel('Where it came from').fill('index-4f2a.js:812:19');
    await page.getByRole('button', { name: 'Write it down' }).click();
    await page.waitForTimeout(120);
  }
  await page.getByLabel('What it said').fill('The plan would not draw');
  await page.getByLabel('Where it came from').fill('plan-9c1.js:44:2');
  await page.getByRole('button', { name: 'Write it down' }).click();
  await page.waitForTimeout(200);

  const broken = await text(page);
  if (deep) {
    const folded = (broken.match(/Cannot read properties of undefined/g) ?? []).length;
    check(
      'three reports of one fault are one line on the screen, not three',
      folded === 1,
      `it is on the screen ${folded} times`
    );
    check(
      'the commonest is at the top, with how many times it was reported beside it',
      broken.indexOf('Cannot read properties of undefined') < broken.indexOf('The plan would not draw'),
      broken.slice(broken.indexOf('What is going wrong'), broken.indexOf('What is going wrong') + 500)
    );
  }

  /* ------------------------------------------------------------- in touch */

  await page.getByLabel('Who got in touch').fill('Gilbert Ruiz');
  await page.getByLabel('What it was about').fill('the plan would not print');
  await page.getByRole('button', { name: 'Keep the note' }).click();
  await page.waitForTimeout(250);
  await page.getByLabel('What was done about Gilbert Ruiz').fill('rang him, it was the paper size');
  await page.getByRole('button', { name: 'Settle Gilbert Ruiz' }).click();
  await page.waitForTimeout(250);

  const touched = await text(page);
  if (deep) {
    check(
      'a contractor’s note is kept, and settling it says what was actually done',
      /Gilbert Ruiz/.test(touched) && /rang him, it was the paper size/.test(touched),
      touched.slice(0, 2500)
    );
  }

  /* ------------------------------------------------------ the whole picture */

  if (deep) {
    check(
      'the paragraph at the top counts everything below it, out of one sentence-writer',
      /4 free runs given away/.test(touched) &&
        /4 asked for TestFlight/.test(touched) &&
        /4 reports of something going wrong, 2 separate faults/.test(touched) &&
        /1 contractor in touch, 0 not dealt with/.test(touched),
      touched.slice(0, 1200)
    );
  }

  /* ------------------------------------------------------------ readable */

  const bad = await unreadable(page);
  check(
    only('every word on the owner screen is readable against the ground actually painted'),
    bad.length === 0,
    bad.slice(0, 6).map((one) => `"${one.says}" ${one.ratio}:1 ${one.ink} on ${one.ground}`).join(' | ')
  );
  const read = (await words(page)).length;
  check(only('there are words on it to read at all'), read > 60, String(read));

  const wide = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    window: window.innerWidth,
  }));
  check(
    only('nothing on it runs off the side of a phone'),
    wide.page <= wide.window + 1,
    `${wide.page}px of page in a ${wide.window}px window`
  );

  /* ------------------------------------------------- locking it again */

  await page.getByRole('button', { name: 'Lock the books' }).click();
  await page.waitForTimeout(300);
  const locked = await text(page);
  check(
    only('locking it takes every figure back off the screen'),
    !/\$241\.99/.test(locked) && !/Gilbert Ruiz/.test(locked) && /The phrase/.test(locked),
    locked.slice(0, 600)
  );

  const lockedBad = await unreadable(page);
  check(
    only('the locked screen is readable too'),
    lockedBad.length === 0,
    lockedBad.slice(0, 4).map((one) => `"${one.says}" ${one.ratio}:1`).join(' | ')
  );

  if (deep) {
    await page.getByLabel('The phrase').fill('some other phrase entirely');
    await page.getByRole('button', { name: 'Open the books' }).click();
    await page.waitForTimeout(300);
    const wrong = await text(page);
    check(
      'the wrong phrase opens nothing and says nothing about what is behind it',
      /That is not the phrase/.test(wrong) && !/\$241\.99/.test(wrong),
      wrong.slice(0, 600)
    );

    await page.getByLabel('The phrase').fill(PHRASE);
    await page.getByRole('button', { name: 'Open the books' }).click();
    await page.waitForTimeout(400);
    const back = await text(page);
    check(
      'the right phrase brings the books back exactly as they were',
      /\$241\.99/.test(back) && /Gilbert Ruiz/.test(back),
      back.slice(0, 600)
    );

    /* ------------------------------------------------- the door in the app */

    await page.evaluate(() => {
      window.location.hash = 'business';
    });
    await page.waitForTimeout(600);
    const business = await page.evaluate(() => document.body.innerText);
    check(
      'the app draws a way in from its own chrome on the device the phrase is set on',
      /The books/.test(business),
      business.slice(0, 600)
    );

    const clean = await ctx.browser().newContext({
      viewport: { width: 430, height: HEIGHT },
      colorScheme: 'light',
    });
    // A paying contractor's browser, the way `open()` makes one. See `payingBrowser`.
    await payingBrowser(clean);
    const stranger = await clean.newPage();
    await stranger.goto(`${URL}#business`, { waitUntil: 'load', timeout: 60000 });
    await stranger.waitForTimeout(800);
    const theirs = await stranger.evaluate(() => document.body.innerText);
    check(
      'and draws nothing at all pointing at it on a phone that has never had the phrase set',
      !/The books/.test(theirs),
      (theirs.match(/.{0,60}The books.{0,60}/) ?? []).join(' | ')
    );

    await stranger.goto(`${URL}#owner`, { waitUntil: 'load', timeout: 60000 });
    await stranger.waitForTimeout(600);
    const strangersBooks = await stranger.evaluate(() => document.body.innerText);
    check(
      'a stranger who types the fragment anyway gets a screen with nothing in it',
      /Nothing has been locked on this device yet/.test(strangersBooks) &&
        !/\$241\.99/.test(strangersBooks) &&
        !/Gilbert Ruiz/.test(strangersBooks),
      strangersBooks.slice(0, 600)
    );
    await clean.close();
  }

  check(
    only('nothing on this screen sends anything anywhere'),
    away.length === 0,
    away.join(' | ')
  );
  check(only('no console or page errors across the whole walk'), noise().length === 0, noise().join(' | '));
}

await walk('light', true);
await walk('dark', false);

process.exit(report('A51 — the owner’s screen, locked, and every figure out of a report') > 0 ? 1 : 0);
