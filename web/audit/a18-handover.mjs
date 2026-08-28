import { readFileSync } from 'node:fs';
import { check, contrast, noise, openAsApp, report, reportEvenIfItDies, section, SECTIONS, SP } from './lib.mjs';

// Say what was learned even if this part dies part way through.
reportEvenIfItDies('A18 — the hand-over, and nothing blank');

/**
 * The hand-over, and the rule that no screen is ever blank.
 *
 * ## Why this part exists
 *
 * On 2026-08-26 the first person to use this app on a phone sent back a
 * photograph of the Takeoff screen with nothing on it, and three questions:
 *
 * > "WHAT IS TAKEOFF? WHAT DOES IT DO?"
 * > "I HAVENT SEEN ANY OF THE FORMS YET, OR THE BUSINESS PAPERWORK"
 * > "AND HOW ARE JOBS COSTED OUT WHEN THERES NO PRICING ANYWHERE?"
 *
 * All of it was built. Takeoff, Price, Agreement, Work and Insurance were
 * drawing empty panels, because the app's five separate hand-over calls had
 * fallbacks on two of them and none on the other three — so on a page that had
 * not run its modules yet, the subscription answer was dropped for good and
 * `Gate` returned `null` forever.
 *
 * **Seventeen audit parts and 264 checks walked straight past it.** Every one
 * of them, A10 included, answered the entitlement from a live page — a state
 * the phone is never in. So this part does two things nothing else did:
 *
 * 1. Parks the payload before the page loads, which is what actually happens.
 * 2. Asserts a rule rather than a screen: **no panel is ever empty**, in any
 *    state, including the one where the app never says anything at all. That is
 *    the check that catches the next one of these, whatever causes it.
 *
 * The rest of the part covers the other five things that hour found, so none of
 * them can come back quietly either.
 */

const ROOM = JSON.parse(readFileSync(`${SP}/kitchen.json`, 'utf8'));
const parked = (over = {}) => ({ fileName: 'Kitchen', room: ROOM, ...over });

/** Below this, a panel is not a screen. A short one is ~90 characters. */
const NOT_BLANK = 40;

/**
 * Every section, in this state, with something on it.
 *
 * The generalised form of the bug: not "Takeoff shows the takeoff" but "no
 * screen in this app is ever a blank rectangle". A locked screen passes, an
 * empty one does not, and neither does one that has only its own heading.
 */
async function nothingIsBlank(page, state) {
  for (const name of SECTIONS) {
    await section(page, name);
    const panel = page.locator('[data-panel]:not([hidden])').first();
    const text = (await panel.innerText()).trim();
    check(
      `${state}: ${name} says something`,
      text.length >= NOT_BLANK,
      `${text.length} characters: ${JSON.stringify(text.slice(0, 120))}`
    );
  }
}

/* -------------------------------- 1. the payload the app really sends, unpaid */

{
  const { browser, ctx, page } = await openAsApp(parked({ subscribed: false }));

  await nothingIsBlank(page, 'parked, unpaid');

  await section(page, 'Takeoff');
  let t = await page.locator('[data-panel="takeoff"]').innerText();
  check('parked, unpaid: the takeoff says what it is and that it is paid',
    /worked out from the measurements/.test(t) && /part of the subscription/.test(t),
    t.slice(0, 300));

  await section(page, 'Plan');
  t = await page.locator('[data-panel="plan"]').innerText();
  check('parked, unpaid: measuring is still free and the drawing is drawn',
    /420\.0 sq ft/.test(t), t.slice(0, 200));

  check('parked, unpaid: no console or page errors', noise().length === 0, noise().join(' | '));
  await ctx.close();
  await browser.close();
}

/* ---------------------------------- 2. the same payload, from somebody paying */

{
  const { browser, ctx, page } = await openAsApp(parked({ subscribed: true }));

  await nothingIsBlank(page, 'parked, paid');

  for (const [name, wanted] of [['Takeoff', /What this room takes/],
                                ['Price', /What it comes to/],
                                ['Agreement', /Turn this into a proposal/],
                                ['Insurance', /Is this an insurance job\?/],
                                ['Files', /Send the drawing/]]) {
    await section(page, name);
    const text = await page.locator('[data-panel]:not([hidden])').first().innerText();
    check(`parked, paid: ${name} opens`, wanted.test(text), text.slice(0, 200));
    check(`parked, paid: ${name} shows no lock`,
      !/part of the subscription/.test(text), text.slice(0, 200));
  }

  check('parked, paid: no console or page errors', noise().length === 0, noise().join(' | '));
  await ctx.close();
  await browser.close();
}

/* ------------------------------------------ 3. the state the bug actually was */

{
  // A room arrives and the app never says whether anything is paid for. This
  // is what every phone did, and what nothing here had ever tried.
  const { browser, ctx, page } = await openAsApp(parked());
  // Past the gate's bounded wait, which is what stops it being blank for good.
  await page.waitForTimeout(4000);

  await nothingIsBlank(page, 'the app never answers');

  await section(page, 'Takeoff');
  const t = await page.locator('[data-panel="takeoff"]').innerText();
  check('the app never answers: the takeoff says what it is rather than nothing',
    /worked out from the measurements/.test(t), t.slice(0, 300));

  check('the app never answers: no console or page errors',
    noise().length === 0, noise().join(' | '));
  await ctx.close();
  await browser.close();
}

/* ----------------------------------------- 4. can you read what you type in */

{
  // > "CANT SEE THE WRITING MUCH WHEN ITS TYPED IN"
  // Every input in the app, not the one that was photographed: they were all
  // written without a background or a text colour, so WebKit painted its light
  // default box behind the dark theme's near-white ink.
  for (const scheme of ['dark', 'light']) {
    const { browser, ctx, page } = await openAsApp(parked({ subscribed: true }), { scheme });
    // Across several screens, because "every field" meant one field when this
    // only opened the Plan tab -- and the bug was every field in the app.
    await section(page, 'Plan');
    await page.getByRole('button', { name: /^Rename/ }).first().click();
    await page.getByLabel('What to call this room').fill('Gilbert kitchen');
    await section(page, 'Room');
    await section(page, 'Price');
    await page.getByRole('button', { name: /^(Set your rates|Your rates)$/ }).click();
    await page.waitForTimeout(300);

    const worst = await page.evaluate(() => {
      const seen = [];
      for (const el of document.querySelectorAll(
        'input:not([type=range]):not([type=file]):not([type=checkbox]), select, textarea'
      )) {
        if (!el.offsetParent && el.type !== 'hidden') continue;
        const s = getComputedStyle(el);
        seen.push([el.getAttribute('aria-label') || el.type || el.tagName, s.color, s.backgroundColor]);
      }
      return seen;
    });
    const bad = worst.filter(([, c, bg]) => contrast(c, bg) < 4.5);
    check(`${scheme}: every field on screen is readable (${worst.length} of them)`,
      // A floor on the count as well as on the contrast: a sweep that finds
      // one field and passes is not a sweep, and that is what this check did
      // the first time it ran.
      worst.length >= 10 && bad.length === 0,
      bad.length
        ? bad.map(([n, c, bg]) => `${n}: ${c} on ${bg}`).join('; ')
        : `only ${worst.length} fields were on screen`);

    await ctx.close();
    await browser.close();
  }
}

/* ------------------------------------------- 5. which wall am I looking at */

{
  // > "WHEN IN 3D MODE, AND YOU ARE INSIDE THE MODEL, THERE SHOULD BE LABELING
  // >  ON THE WALLS WITH THE WALL # OR WHICH WALL IT IS"
  const { browser, ctx, page } = await openAsApp(parked({ subscribed: true }));
  await section(page, 'Plan');
  await page.getByRole('tab', { name: '3D' }).click();
  await page.waitForTimeout(400);

  const orbit = await page.evaluate(() =>
    [...document.querySelectorAll('svg text')].map((t) => t.textContent));
  // `Wall 2` then its length, as two lines of one label -- `innerText` runs
  // them together, so the test reads the beginning rather than the whole.
  check('walking around it, the walls are named',
    orbit.length > 0 && orbit.every((t) => /^Wall \d+/.test(t)),
    JSON.stringify(orbit));

  await page.getByRole('button', { name: 'Stand inside' }).click();
  await page.waitForTimeout(400);
  const inside = await page.evaluate(() =>
    [...document.querySelectorAll('svg text')].map((t) => t.textContent));
  check('standing in it, the walls are named',
    inside.length > 0 && inside.every((t) => /^Wall \d+/.test(t)),
    JSON.stringify(inside));
  check('one label per wall, not one per piece of wall',
    new Set(inside).size === inside.length, JSON.stringify(inside));

  // A label sits in the middle of the biggest part of a wall, which is exactly
  // where a thumb lands. If it ate the tap, the easiest place to hit would be
  // the one place that does nothing — so this taps the label itself and the
  // wall underneath has to answer.
  check('the labels never take a tap themselves',
    await page.evaluate(() =>
      [...document.querySelectorAll('svg text')]
        .every((t) => getComputedStyle(t).pointerEvents === 'none')),
    'a label is taking pointer events');

  // Every label has to be somewhere a person can see it. Standing inside is a
  // perspective view: a wall you are nearly parallel to runs thousands of
  // pixels off both sides of the picture, and its true centre is nowhere near
  // it. Two of these three landed at x = 3920 and x = -3536 the first time
  // this check ran — drawn, outside the box, never seen.
  const placed = await page.evaluate(() => {
    const svg = document.querySelector('svg[aria-label*="Standing in"]');
    const box = svg.getBoundingClientRect();
    return [...svg.querySelectorAll('text')].map((t) => {
      const r = t.getBoundingClientRect();
      return {
        text: t.textContent,
        inside:
          r.left >= box.left - 1 && r.right <= box.right + 1 &&
          r.top >= box.top - 1 && r.bottom <= box.bottom + 1,
      };
    });
  });
  check('every label is inside the picture, not clipped off the side',
    placed.length > 0 && placed.every((p) => p.inside),
    JSON.stringify(placed));

  // And tapping a wall has to work at all.
  //
  // It did not, in either view, for as long as this screen has existed: the
  // svg captured the pointer on `pointerdown`, and while a pointer is captured
  // the `click` that follows goes to the capturing element rather than to the
  // polygon under the finger. So "Tap a wall to measure it" was a sentence
  // about something that did nothing. Capture goes on after three pixels of
  // movement now, which is the only point at which it is needed.
  //
  // Tapped through a label, deliberately: a label sits in the middle of the
  // biggest part of a wall, which is exactly where a thumb lands, and it is
  // where the middle of the orbit view is the floor rather than a wall.
  const tapLabel = async (svg) => {
    const at = await page.evaluate((sel) => {
      const t = document.querySelector(`${sel} text`);
      const r = t.getBoundingClientRect();
      return { name: t.textContent, x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, svg);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(400);
    const shown = await page.locator('[data-panel="plan"]').innerText();
    return { name: at.name, selected: /Change this wall|Put a tape on it|How long is/.test(shown) };
  };

  const inside2 = await tapLabel('svg[aria-label*="Standing in"]');
  check('standing inside, tapping a wall selects it',
    inside2.selected, `tapped ${inside2.name} and nothing was selected`);
  const again = await tapLabel('svg[aria-label*="Standing in"]');
  check('and tapping the same wall again lets it go',
    !again.selected, `tapped ${again.name} twice and it stayed selected`);

  await page.getByRole('button', { name: 'Back outside' }).click();
  await page.waitForTimeout(400);
  const orbit2 = await tapLabel('svg[aria-label*="three dimensions"]');
  check('walking around it, tapping a wall selects it too',
    orbit2.selected, `tapped ${orbit2.name} and nothing was selected`);

  // A drag turns the view and must not select whatever it ended on.
  const svg = page.locator('svg[aria-label*="three dimensions"]');
  const box = await svg.boundingBox();
  const before = await svg.locator('polygon').first().getAttribute('points');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i += 1) {
    await page.mouse.move(box.x + box.width / 2 + i * 8, box.y + box.height / 2);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
  check('and a drag still turns it, rather than being read as a tap',
    (await svg.locator('polygon').first().getAttribute('points')) !== before,
    'the view did not move');

  // What the 3D view has to say without switching to the blueprint.
  await page.getByRole('button', { name: 'Stand inside' }).click();
  await page.waitForTimeout(400);

  const roomView = page.locator('svg[aria-label*="Standing in"]');
  const box2 = await roomView.boundingBox();
  const readOut = () => page.evaluate(() => {
    const s = document.querySelector('svg[aria-label*="Standing in"]');
    const r = s.getBoundingClientRect();
    return [...s.querySelectorAll('text')].map((t) => {
      const b = t.getBoundingClientRect();
      return {
        text: t.textContent,
        fits:
          b.left >= r.left - 1 && b.right <= r.right + 1 &&
          b.top >= r.top - 1 && b.bottom <= r.bottom + 1,
      };
    });
  });

  // All the way round, because a label is only ever cut off at one angle. The
  // first version of this feature had two of three labels thousands of pixels
  // off the side, and the fix for that left the text itself running past the
  // edge -- a middle on screen and both ends gone.
  const clipped = [];
  const kinds = new Set();
  for (let turn = 0; turn < 10; turn += 1) {
    for (const seen of await readOut()) {
      if (!seen.fits) clipped.push(seen.text);
      if (/^Wall \d+/.test(seen.text)) kinds.add('wall');
      if (/^(Door|Window|Opening)/.test(seen.text)) kinds.add('opening');
      if (/\d+['\u2032]/.test(seen.text)) kinds.add('length');
    }
    await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) {
      await page.mouse.move(box2.x + box2.width / 2 - i * 15, box2.y + box2.height / 2);
    }
    await page.mouse.up();
    await page.waitForTimeout(180);
  }

  check('every label stays inside the picture, at every angle',
    clipped.length === 0, `cut off: ${JSON.stringify(clipped.slice(0, 6))}`);
  check('the walls carry their length as well as their name',
    kinds.has('wall') && kinds.has('length'), JSON.stringify([...kinds]));
  check('and the doors and windows carry their size',
    kinds.has('opening'), JSON.stringify([...kinds]));

  const caption = await page.locator('[data-panel="plan"]').innerText();
  check('the ceiling height is on the 3D view, since every wall area uses it',
    /Ceiling \d/.test(caption), caption.slice(0, 300));
  check('and the furniture toggle says why it is absent rather than being absent',
    /no furniture to show or hide|Hide what was in the room|Show what was in the room/.test(caption),
    caption.slice(0, 400));

  check('3D: no console or page errors', noise().length === 0, noise().join(' | '));
  await ctx.close();
  await browser.close();
}

/* ------------------------------------ 6. more than one thing in one opening */

{
  // > "WHAT IF YOU FIND MORE THEN ONE OPTION, BUT CAN ONLY PICK ONE"
  const { browser, ctx, page } = await openAsApp(parked({ subscribed: true }));
  await section(page, 'Room');

  const behind = page.locator('section', { hasText: 'What is behind the wall' }).last();
  for (const what of ['Plumbing', 'Electrical']) {
    await behind.getByRole('button', { name: what, exact: true }).click();
  }
  const on = await behind.locator('button[aria-pressed="true"]').allInnerTexts();
  check('three things can be ticked at once',
    on.length === 3 && ['Framing', 'Plumbing', 'Electrical'].every((k) => on.includes(k)),
    JSON.stringify(on));

  // The last one cannot be turned off: a tag with nothing on it is refused by
  // the model, and finding that out by pressing Pin it is worse than a button
  // that stays on.
  for (const what of ['Plumbing', 'Electrical', 'Framing']) {
    await behind.getByRole('button', { name: what, exact: true }).click();
  }
  const left = await behind.locator('button[aria-pressed="true"]').allInnerTexts();
  check('the last one cannot be un-ticked', left.length === 1, JSON.stringify(left));

  await behind.getByRole('button', { name: 'Plumbing', exact: true }).click();
  await behind.getByLabel('How far along it').fill("6'");
  await behind.getByLabel('What you found').fill('2x10s and the stack');
  await behind.getByRole('button', { name: 'Pin it' }).click();
  await page.waitForTimeout(400);

  const t = await page.locator('[data-panel="room"]').innerText();
  check('the pinned note lists everything found in the one opening',
    /Framing \+ Plumbing/.test(t) || /Plumbing \+ .*Framing/.test(t),
    t.slice(0, 600));
  check('and it is counted under each of them',
    /Framing · 1/.test(t) && /Plumbing · 1/.test(t), t.slice(0, 400));

  check('behind the wall: no console or page errors', noise().length === 0, noise().join(' | '));
  await ctx.close();
  await browser.close();
}

/* ---------------------------------------- 7. where the rates are, with no room */

{
  // > "AND WHERES THE AREA THE CONTRACTOR CAN SET THEIR OWN RATES FOR EACH TYPE
  // >  OF JOB?"
  // They save to the business profile and are the same book on every job, so
  // they have to be reachable before any room exists.
  const { browser, ctx, page } = await openAsApp(null);
  await page.evaluate(() => { window.location.hash = 'business'; });
  await page.waitForTimeout(700);

  const t = await page.locator('body').innerText();
  check('the Business tab holds what you charge, with no room open',
    /What you charge/.test(t), t.slice(0, 500));
  check('and every line the takeoff produces has a box for a rate',
    (await page.getByLabel(/ rate$/).count()) >= 11,
    `${await page.getByLabel(/ rate$/).count()} rate boxes`);
  check('and it says the rates come from nowhere but this contractor',
    /no averages, no\s+guesses|Nothing here comes from anywhere else/.test(t), t.slice(0, 800));

  check('Business: no console or page errors', noise().length === 0, noise().join(' | '));
  await ctx.close();
  await browser.close();
}

process.exit(report('A18 — the hand-over, and nothing blank') > 0 ? 1 : 0);
