import { check, loadScan, noise, open, report, reportEvenIfItDies, section } from './lib.mjs';

// Say what was learned even if this part dies part way through.
reportEvenIfItDies('A15 — an open plan, priced as several');

/**
 * An open plan, priced as the several spaces it has to be.
 *
 * `zone.ts` has been able to do this since it was written and nothing in the
 * app called any of it -- found by `core/tools/check-reachable.py`, which is
 * the check that exists because this keeps happening.
 *
 * The property that matters most here is not that the split works. It is that
 * **a line drawn on the floor carries no drywall, no paint and no base.** The
 * obvious way to split a space is to put a wall through it, and doing that
 * quietly adds a finished surface nobody will ever build to somebody's
 * estimate. So the check that must never bend is that the two sides' floor
 * areas add to the whole room while their wall face does not.
 */

const { browser, page } = await open();
await loadScan(page);
await page.evaluate(() => {
  window.webkit = { messageHandlers: { saved: { postMessage() {} } } };
  window.trueline?.setSubscribed(true);
});
await page.waitForTimeout(400);

await section(page, 'Room');
let text = await page.locator('body').innerText();
check('the room offers a way to split an open plan',
  /Split an open plan/.test(text), text.slice(0, 300));
check('and says out loud that the divide is not a wall',
  /It is not a wall/.test(text) && /nobody will ever build/.test(text));

// An empty form has to say what it wants, like every other form in the app.
await page.getByRole('button', { name: 'Draw a line on the floor' }).click();
await page.waitForTimeout(200);
text = await page.locator('body').innerText();
check('an empty split says what it wants rather than doing nothing',
  /Fill in where it starts.*where it ends/.test(text), text.slice(0, 400));

// The garage is 21 x 20. Cut it across the middle: 10 ft along the south wall
// to 10 ft along the north one.
await page.getByLabel('Starts on').selectOption({ index: 0 });
await page.getByLabel('How far along the first wall').fill(`10'`);
await page.getByLabel('Ends on').selectOption({ index: 2 });
await page.getByLabel('How far along the second wall').fill(`10'`);
await page.getByLabel('Call this side').fill('Kitchen');
await page.getByLabel('And that side').fill('Dining');
await page.getByRole('button', { name: 'Draw a line on the floor' }).click();
await page.waitForTimeout(400);

text = await page.locator('body').innerText();
check('the split lands, and both sides are named',
  /Kitchen/.test(text) && /Dining/.test(text), text.slice(0, 500));
check('and it reconciles to the whole room, said on screen',
  /add up to .* which is the whole room to the square inch/.test(text), text.slice(0, 900));

await section(page, 'Plan');
const drawn = page.getByLabel(/Divided into Kitchen and Dining/);
check('the divide is on the drawing', (await drawn.count()) === 1);
const dash = await page.evaluate(() => {
  const g = document.querySelector('[aria-label^="Divided into"] line');
  return g?.getAttribute('stroke-dasharray') ?? '';
});
check('and drawn dashed, so it cannot be read as a wall', dash !== '', `dasharray "${dash}"`);

await section(page, 'Takeoff');
// The panel's own text rather than the body's. `section` waits for the panel
// to be shown, but `body.innerText` read straight after it came back with the
// header alone -- the panel had not been laid out yet, so its text was not in
// there. Waiting for the thing being asserted on is the fix; a longer sleep
// would only have made the flake rarer.
const takeoffPanel = page.locator('[data-panel="takeoff"]:not([hidden])');
await takeoffPanel.getByRole('heading', { name: /split into/i }).waitFor({ timeout: 5000 });
text = await takeoffPanel.innerText();
// Case-insensitive because `innerText` returns what is RENDERED, and that
// heading is uppercased by CSS. Matching the source's capitalisation failed
// against "AND SPLIT INTO KITCHEN AND DINING" and looked like a missing
// feature for two runs.
check('the takeoff shows the split beside the whole room',
  /and split into kitchen and dining/i.test(text), text.slice(0, 800));

/* --------------------------------------------- the check that must not bend */

const numbers = await page.evaluate(() => {
  // Read off the ROW rather than by counting lines.
  //
  // This used to match "Floor" plus the next line and pull a figure out of it,
  // which worked only while a row was exactly two lines. The takeoff shows the
  // workings under every figure now -- "the floor outline" -- so the number
  // moved to the third line and this quietly became NaN.
  //
  // A row is a `dt` and a `dd`. Asking for those is asking the question the
  // check actually means, and it survives the next time the row grows a line.
  const panel = document.querySelector('[data-panel="takeoff"]');
  const number = (text) => Number((text.match(/([\d,.]+)/) ?? [])[1]?.replace(/,/g, '') ?? NaN);
  const rowNamed = (want) => {
    for (const row of panel.querySelectorAll('dl > div')) {
      const dt = row.querySelector('dt');
      const dd = row.querySelector('dd');
      if (dt && dd && dt.innerText.trim().toLowerCase().startsWith(want)) return number(dd.innerText);
    }
    return NaN;
  };
  return {
    wholeFloor: rowNamed('floor'),
    wholeFace: rowNamed('wall face'),
    zones: [...panel.querySelectorAll('dl')].slice(-2).map((c) => c.innerText),
  };
});
check('two zone cards are drawn', numbers.zones.length === 2, JSON.stringify(numbers.zones));

const zoneFloors = numbers.zones.map((t) =>
  Number((t.match(/Floor\s+([\d,.]+)/) ?? [])[1]?.replace(/,/g, '') ?? NaN)
);
check('the two floors add to the whole room',
  Math.abs(zoneFloors[0] + zoneFloors[1] - numbers.wholeFloor) < 0.15,
  `${zoneFloors[0]} + ${zoneFloors[1]} vs ${numbers.wholeFloor}`);

const zoneFaces = numbers.zones.map((t) =>
  Number((t.match(/Wall face\s+([\d,.]+)/) ?? [])[1]?.replace(/,/g, '') ?? NaN)
);
// Read the same way, off the same row, in the same pass above.
const wholeFace = numbers.wholeFace;
check('and their wall face does NOT gain a surface nobody will build',
  zoneFaces[0] + zoneFaces[1] <= wholeFace + 0.15,
  `${zoneFaces[0]} + ${zoneFaces[1]} = ${zoneFaces[0] + zoneFaces[1]}, whole room is ${wholeFace}`);

text = await takeoffPanel.innerText();
check('and the screen says why', /carries no drywall, no paint and no base/.test(text),
  text.slice(0, 900));

await section(page, 'Room');
await page.getByRole('button', { name: 'Put it back to one space' }).click();
await page.waitForTimeout(300);
text = await page.locator('body').innerText();
check('it can be put back to one space', /Split an open plan/.test(text) && !/Put it back/.test(text));

check('no console or page errors across the whole run', noise().length === 0, noise().join(' | '));

const bad = report('A15 — an open plan, priced as several');
await browser.close();
process.exit(bad === 0 ? 0 : 1);
