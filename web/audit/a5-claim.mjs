import { SP, check, loadScan, open, pick, report, section } from './lib.mjs';
const { browser, ctx, page } = await open();
await loadScan(page);

/* ------------------------------------------------------- insurance is off */

await section(page, 'Insurance');
let t = await page.locator('body').innerText();
check('insurance mode is off by default', t.includes('Is this an insurance job?'));
check('nothing restoration-shaped is on a normal job',
  !t.includes('What the damage takes') && !t.includes('Send it to the adjuster'));

await page.getByRole('button', { name: 'Turn it on' }).click();
await page.waitForTimeout(300);

/* ---------------------------------------------------------- the claim facts */

const claim = page.locator('section', { has: page.getByRole('heading', { name: 'The claim' }) }).first();
t = await claim.innerText();
check('what is missing is named and nothing is blocked', /Still to fill in/.test(t), t.slice(-260));
await claim.getByLabel('Claim number').fill('CLM-88412');
await claim.getByLabel('Date of loss').fill('2026-08-18');
await claim.getByRole('button', { name: 'burst pipe', exact: true }).click();
await claim.getByLabel('Property address').fill('14 Sycamore Rd');
await claim.getByLabel('Owner', { exact: true }).fill('Ruth Alvarez');
await claim.getByLabel('Adjuster', { exact: true }).fill('D. Chen');
await page.waitForTimeout(300);
check('the missing list clears as it is filled', !(await claim.innerText()).includes('Still to fill in'));

/* -------------------------------------------------------------- the damage */

// Marking damage is done on the drawing: you point at the wall it is on.
await section(page, 'Plan');

await pick(page, /^Wall wall-1,/);
await page.getByRole('button', { name: '+ damaged area' }).click();
await page.getByRole('button', { name: 'Water', exact: true }).click();
await page.getByPlaceholder('water line along the bottom of the wall').fill('supply line behind the washer');
await page.getByLabel('From along the wall').fill('0');
await page.getByLabel('To along the wall').fill('9');
await page.getByLabel('How high the damage reaches').fill('18"');
await page.getByRole('button', { name: 'Mark it' }).click();
await page.waitForTimeout(400);
t = await page.locator('body').innerText();
// 9 ft of wall 18 in high is 13.5 sq ft; a 3 ft door in that run takes 4.5 off.
check('the mark deducts the openings in it', t.includes('9.0 sq ft'), t.slice(t.indexOf('mark on this wall'), t.indexOf('mark on this wall') + 200));
check('the damaged run is drawn on the plan', (await page.locator('svg line[stroke="#dc2626"][stroke-width="14"]').count()) === 1);
check('the key names damage only when there is damage',
  (await page.locator('ul.flex-wrap').first().innerText()).includes('Damaged'));

/* ------------------------------------------------------- cut, meter, photo */

await page.getByRole('button', { name: /Open$/ }).first().click();
await page.waitForTimeout(250);
await page.getByRole('button', { name: "2'", exact: true }).first().click();
await page.waitForTimeout(300);
t = await page.locator('body').innerText();
check('a decided cut is quantified and kept apart from what was seen',
  t.includes('12.0 sq ft') && /the damage was seen to 1' 6"/.test(t), t.slice(t.indexOf('Cut to') - 300, t.indexOf('Cut to') + 200));

await page.getByLabel('Moisture reading').fill('28');
await page.getByRole('button', { name: 'Log it' }).click();
await page.waitForTimeout(200);
await page.getByLabel('Moisture reading').fill('14');
await page.getByRole('button', { name: 'Log it' }).click();
await page.waitForTimeout(300);
check('a drying curve appears', (await page.locator('body').innerText()).includes('Drying: 28 down to 14 %MC'));

await page.setInputFiles('input[aria-label="Photograph the damage"]', SP + '/damage-photo.jpg');
await page.waitForTimeout(1400);
check('a photograph attaches', (await page.locator('img[alt^="Damage photograph"]').count()) === 1);
check('and it says plainly it is not backed up in a browser',
  (await page.locator('body').innerText()).includes('On this browser only'));

/* --------------------------------------------------------------- the scope */

await section(page, 'Insurance');

const scope = page.locator('section', { has: page.getByRole('heading', { name: 'What the damage takes' }) }).first();
check('the damage has its own sheet', (await scope.count()) === 1);
t = await scope.innerText();
check('the scope is never the room takeoff', /NOT the room’s takeoff/.test(t));
check('paint is wider than the damage and says why', /corner to corner/.test(t));
check('no equipment, days or debris', !/air mover|dumpster|drying day/i.test(t));

/* ----------------------------------------------------- the claim document */

const send = page.locator('section', { has: page.getByRole('heading', { name: 'Send it to the adjuster' }) }).first();
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  send.getByRole('button', { name: /Make the claim document/ }).click(),
]);
await download.saveAs(SP + '/audit-claim.html');

const doc = await ctx.newPage();
const asks = [];
doc.on('request', (r) => { if (!r.url().startsWith('file://')) asks.push(r.url()); });
await doc.goto('file://' + SP + '/audit-claim.html');
await doc.waitForTimeout(500);
const html = await doc.locator('body').innerText();
check('the claim document opens offline with nothing fetched', asks.length === 0, asks.join(', '));
check('no prices are on it', !html.includes('$'), (html.match(/\$[\d,.]+/g) || []).join(' '));
check('the evidence is on it', /12\.0 sq ft/.test(html) && /Drying: 28 down to 14/.test(html));
check('the photograph is full size on it', (await doc.locator('figure img').count()) === 1);
check('the drawing carries the damage', (await doc.locator('svg line[stroke="#dc2626"]').count()) >= 1);
check('the caveat travels', /THESE ARE A SCANNER/.test(html));

/* ------------------------------------------ turning it off puts it all away */

await claim.getByRole('button', { name: 'Not a claim' }).click();
await page.waitForTimeout(400);
t = await page.locator('body').innerText();
check('turning insurance off hides the restoration screens',
  !t.includes('What the damage takes') && !t.includes('Send it to the adjuster'));
check('and the damage comes off the plan',
  (await page.locator('svg line[stroke="#dc2626"][stroke-width="14"]').count()) === 0);

process.exit(report('A5 — insurance mode, end to end') > 0 ? 1 : 0);
