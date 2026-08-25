import { check, loadScan, noise, open, report, section } from './lib.mjs';

/**
 * The paywall, from both sides of it.
 *
 * The whole audit up to here runs in a plain browser, where there is nothing to
 * buy and nobody to charge, so nothing is gated and every other file tests the
 * app as a subscriber sees it. This one pretends to be the app: it installs the
 * message handler `insideApp()` looks for, then hands the entitlement across
 * exactly as CorrectView does.
 *
 * Two things have to be true and they pull in opposite directions. Measuring
 * has to work with no subscription at all — that is the promise, and it is the
 * answer to an App Store reviewer asking what the free app is for. And the
 * things that turn a drawing into money have to be shut.
 */
async function appLike(paid) {
  const { browser, ctx, page } = await open();
  // The room first, through the file picker, because inside the app there is
  // no file picker -- the app hands the room over instead. Then the handler
  // that makes `insideApp()` true, and the entitlement, exactly as CorrectView
  // does it. `insideApp()` reads the handler every time it is asked, so this
  // takes effect on the next render rather than needing a reload.
  await loadScan(page);
  await page.evaluate((p) => {
    window.webkit = { messageHandlers: { saved: { postMessage() {} } } };
    window.trueline?.setSubscribed(p);
  }, paid);
  await page.waitForTimeout(500);
  return { browser, ctx, page };
}

/* ------------------------------------------------------- nobody has paid */

{
  const { browser, ctx, page } = await appLike(false);

  await section(page, 'Plan');
  let t = await page.locator('body').innerText();
  check('measuring is free: the drawing is there with no subscription',
    /420\.0 sq ft/.test(t) && /21' × 20'/.test(t), t.slice(0, 300));
  check('and so is correcting it: every wall is still a control',
    (await page.getByRole('button', { name: /^Wall / }).count()) === 4,
    `${await page.getByRole('button', { name: /^Wall / }).count()} walls`);

  await section(page, 'Takeoff');
  t = await page.locator('body').innerText();
  check('the takeoff is shut', /part of the subscription/.test(t), t.slice(0, 400));
  check('and the lock says what the thing does, not that it is locked',
    /worked out from the measurements/.test(t) && !/upgrade|unlock/i.test(t), t.slice(0, 500));
  check('and it says what stays free, so declining is an informed decision',
    /Measuring, the drawing and the 3D view are not/.test(t), t.slice(0, 500));

  for (const [name, wanted] of [['Price', /rates against those quantities/],
                                ['Agreement', /a homeowner says yes to/],
                                ['Insurance', /Mark the damage on the wall/],
                                ['Files', /client file, CAD/]]) {
    await section(page, name);
    t = await page.locator('body').innerText();
    check(`${name} is shut, and says what it is for`, wanted.test(t), t.slice(0, 300));
  }

  check('no console or page errors while locked', noise().length === 0, noise().join(' | '));
  await ctx.close();
  await browser.close();
}

/* ---------------------------------------------------------- somebody has */

{
  const { browser, ctx, page } = await appLike(true);

  for (const [name, wanted] of [['Takeoff', /What this room takes/],
                                ['Price', /What it comes to/],
                                ['Agreement', /Turn this into a proposal/],
                                ['Insurance', /Is this an insurance job\?/],
                                ['Files', /Send the drawing/]]) {
    await section(page, name);
    const t = await page.locator('body').innerText();
    check(`${name} opens once it is paid for`, wanted.test(t), t.slice(0, 300));
    check(`${name} shows no lock at all`, !/part of the subscription/.test(t), t.slice(0, 300));
  }

  check('no console or page errors while unlocked', noise().length === 0, noise().join(' | '));
  await ctx.close();
  await browser.close();
}

process.exit(report('A10 — the gate, from both sides') > 0 ? 1 : 0);
