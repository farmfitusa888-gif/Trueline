import { check, loadScan, noise, open, report, reportEvenIfItDies, section } from './lib.mjs';

// Say what was learned even if this part dies part way through.
reportEvenIfItDies('A17 — the sheet somebody orders material from');

/**
 * The sheet somebody orders material from.
 *
 * ## The bug this part exists because of
 *
 * The takeoff screen listed four figures that were hand-written into the
 * component, plus `sheet.lines.filter((line) => line.group !== undefined)` for
 * the rest. Doors, windows and cased openings carry no group — they are
 * finishes, not framing — so that filter dropped them, and **the screen never
 * said there was a door in the room**. The count was computed. It went into the
 * text somebody shares and into the CSV somebody prices off. The screen the
 * contractor reads left it out, and had done since the screen was written.
 *
 * A wrong number is bad. A missing one, on the sheet material is ordered from,
 * is worse: nothing on the screen looks wrong, so nobody goes looking.
 *
 * ## How this stops it coming back
 *
 * Not by checking for doors. By checking the screen against the app's OWN
 * spreadsheet — the CSV the Spreadsheet button writes, which is the engine's
 * flat list of every line it produced. If those two ever disagree again, this
 * fails and names the line that went missing.
 *
 * That is the property that actually broke: two outputs of one calculation,
 * and one of them quietly shorter than the other.
 */

const { browser, page } = await open();
await loadScan(page, 'kitchen.json');
await page.evaluate(() => {
  window.webkit = { messageHandlers: { saved: { postMessage() {} } } };
  window.trueline?.setSubscribed(true);
});
await page.waitForTimeout(400);
await section(page, 'Takeoff');

/* ------------------------------- the screen against the app's own CSV */

const panel = page.locator('[data-panel="takeoff"]');
const onScreen = await panel.innerText();

const waitFor = page.waitForEvent('download');
await panel.getByRole('button', { name: 'Spreadsheet' }).click();
const csv = await (await waitFor).createReadStream().then(async (stream) => {
  let text = '';
  for await (const chunk of stream) text += chunk;
  return text;
});

// Column one of every data row is the line's name, as the engine wrote it.
const inCsv = csv
  .split('\n')
  .slice(1)
  .map((row) => (row.match(/^"([^"]*)"|^([^,]*)/) ?? [])[1] ?? (row.match(/^([^,]*)/) ?? [])[1])
  .map((name) => (name ?? '').trim())
  .filter((name) => name.length > 0 && name.toLowerCase() !== 'what');

check('the app can write its own spreadsheet', inCsv.length >= 4, `${inCsv.length} lines: ${inCsv}`);

const missing = inCsv.filter((name) => !onScreen.includes(name));
check(
  'every line the takeoff computes is on the screen, not only in the file',
  missing.length === 0,
  `missing from the screen: ${missing.join(', ')}`
);

check('the doors are counted on screen', /Doors/.test(onScreen) && /1\s*ea/.test(onScreen), onScreen.slice(0, 400));
check('and the windows', /Windows/.test(onScreen), onScreen.slice(0, 400));

/* ------------------------------------------- the workings, without asking */

check(
  'every figure shows where it came from without pressing anything',
  /built walls .* less every door and window/i.test(onScreen),
  onScreen.slice(0, 500)
);
check(
  'including what the baseboard does about windows',
  /runs under windows/i.test(onScreen)
);

/* ------------------------------------- the word, only when it is worth one */

check(
  'a sheet that is all one thing does not repeat itself on every row',
  (onScreen.match(/SCANNED/g) ?? []).length === 0,
  onScreen.slice(0, 400)
);
check(
  'it says so once, under the buttons',
  /scanner’s numbers, not measurements|scanner's numbers, not measurements/.test(onScreen)
);

/* ------------------------------------------------- tape both axes, and look */

await section(page, 'Plan');
for (const [wall, reading] of [['wall-2', `20' 9 1/2"`], ['wall-1', `19' 10"`]]) {
  const button = page.getByRole('button', { name: new RegExp(`^Wall ${wall},`) }).first();
  await button.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.getByRole('textbox', { name: `the length of ${wall}` }).fill(reading);
  await page.getByRole('button', { name: `Set the length of ${wall}` }).click();
  await page.waitForTimeout(400);
}

await section(page, 'Takeoff');
const taped = await panel.innerText();

check(
  'once a tape has been on a wall running each way, the finishes say measured',
  (taped.match(/MEASURED/g) ?? []).length === 4,
  `${(taped.match(/MEASURED/g) ?? []).length} measured lines`
);
check(
  'and the opening counts still say scanned, because a scanner is bad at them',
  (taped.match(/SCANNED/g) ?? []).length === 2,
  `${(taped.match(/SCANNED/g) ?? []).length} scanned lines`
);
check(
  'the figures moved when the tape did',
  /412\.4/.test(taped) && !/420\.0/.test(taped),
  taped.slice(0, 300)
);

/* ------------------------------------------ thickness brings its own block */

await section(page, 'Room');
// The same control part A1 uses. A thickness is picked from the sizes a wall
// is actually built in, not typed -- 2x4 and 2x6 are what a framer says.
await page.getByRole('button', { name: '2x6', exact: true }).first().click();
await page.waitForTimeout(500);
await section(page, 'Takeoff');
const framed = await panel.innerText();
check(
  'wall thickness brings the framing in, under a heading of its own',
  /Openings and framing/i.test(framed) && /(Plates|Studs|Jamb)/i.test(framed),
  framed.slice(0, 700)
);
// Matched case-insensitively, because `innerText` returns RENDERED text and
// that heading is uppercased by CSS. This project has now walked into that
// twice; the first time it failed an assertion about a legend that was
// perfectly correct.
const where = (needle) => framed.toLowerCase().indexOf(needle.toLowerCase());
check(
  'and the framing block comes after the sheet rather than through the middle of it',
  where('openings and framing') > where('baseboard') && where('baseboard') > 0,
  `framing at ${where('openings and framing')}, baseboard at ${where('baseboard')}`
);

/* -------------------------------------- the thickness the framing waits for */

// Plates, Studs and Headers are on the rate book, and they never priced,
// because framing needs a wall thickness and a scan cannot see inside a wall.
// The takeoff said so and stopped there — a stated problem with no way to it.
await section(page, 'Takeoff');
const uncounted = await page.locator('[data-panel="takeoff"]').innerText();
if (/framing needs a\s+wall thickness/.test(uncounted)) {
  check('the takeoff says WHY there is no framing, not just that there is none',
    /cannot see inside a wall/.test(uncounted), uncounted.slice(-400));
  const setIt = page.getByRole('button', { name: 'Set it now' });
  check('and offers a way to it rather than naming the walls and stopping',
    (await setIt.count()) === 1);
  await setIt.first().click();
  await page.waitForTimeout(400);
  const landed = await page.locator('[data-panel="room"]').innerText();
  check('which lands where the thickness is actually set',
    (await page.locator('[data-panel="room"]:not([hidden])').count()) === 1 && /thick/i.test(landed),
    landed.slice(0, 300));
} else {
  check('the takeoff says why there is no framing', false,
    'this scan now has thickness on every wall — the fixture changed, not the app');
}

check('no console or page errors across the whole run', noise().length === 0, noise().join(' | '));

const bad = report('A17 — the sheet somebody orders material from');
await browser.close();
process.exit(bad === 0 ? 0 : 1);
