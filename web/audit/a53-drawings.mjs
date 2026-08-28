import { readFileSync } from 'node:fs';
import { check, openAsApp, report, reportEvenIfItDies, section, sentTo, SP } from './lib.mjs';

// Say what was learned even if this part dies part way through.
reportEvenIfItDies('A53 — every drawing that leaves, sampled as pixels');

/**
 * A53 — the drawing is a drawing wherever it goes, and not a black square.
 *
 * ## The bug, and why the fix needed a check of its own
 *
 * > "PIC 2: NO IMAGE IN THE HTML FILE"
 *
 * The plan paints with `fill="rgb(var(--c-raise))"` and those custom properties
 * are declared once, on the app's own `:root`. Serialise the drawing out of
 * that document and nothing declares them any more — and CSS does not treat an
 * unresolvable `var()` as absent. It makes the whole declaration invalid at
 * computed-value time, so `fill` falls back to its initial value, which is
 * solid black, and `stroke` to none. The background rectangle paints black
 * across the viewBox and every line on top of it disappears.
 *
 * It was fixed for the claim document, and a check went on the claim document.
 * The identical bug was still live on three other paths, because they serialise
 * the same drawing the same way: `planPng` (the picture a contractor texts a
 * client), `planThumbnail` (every picture in the phone's scan list) and the
 * client file. Measured then: an SVG painted this way, loaded through a data
 * URL into an `<img>` **from a page that does declare the tokens**, comes back
 * 10,000 pixels out of 10,000 black — an SVG loaded as an image is its own
 * isolated document and cannot see the host page's `:root`.
 *
 * So this part samples the actual pixels of the picture that actually leaves,
 * on every path, rather than reading the markup and reasoning about it. Reading
 * the markup is how the bug survived a fix: `planSvg` looked perfectly correct
 * the whole time.
 */

const room = JSON.parse(readFileSync(SP + '/dining.json', 'utf8'));

/**
 * What a picture is actually made of, decoded in the browser.
 *
 * Every distinct colour and the commonest one's share. A drawing has many
 * colours; a black square has one. That is the whole test, and it cannot be
 * satisfied by markup that merely looks right.
 */
const SAMPLE = `async (url) => {
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('the picture would not load at all'));
    image.src = url;
  });
  const side = 100;
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const pen = canvas.getContext('2d');
  // On white, because that is what a document, a message and a list all put a
  // picture on. A transparent drawing would otherwise sample as black here and
  // be blamed for the wrong fault.
  pen.fillStyle = '#FFFFFF';
  pen.fillRect(0, 0, side, side);
  pen.drawImage(image, 0, 0, side, side);
  const { data } = pen.getImageData(0, 0, side, side);
  const seen = new Map();
  for (let at = 0; at < data.length; at += 4) {
    const key = data[at] + ',' + data[at + 1] + ',' + data[at + 2];
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  let commonest = '';
  let most = 0;
  for (const [key, count] of seen) if (count > most) { most = count; commonest = key; }
  return {
    colours: seen.size,
    commonest,
    share: most / (side * side),
    black: (seen.get('0,0,0') ?? 0) / (side * side),
  };
}`;

// Subscribed, because sending the drawing out is a paid feature and this part
// is about what leaves the app rather than about who may make it leave.
const { browser, page } = await openAsApp({ room, fileName: 'dining.json', subscribed: true });

/* ------------------------------------------- the thumbnail the app is handed */

// It is made on a timer after the plan draws, and handed to the phone.
await page.waitForTimeout(1500);
const thumbnails = await sentTo(page, 'thumbnail');
check('the app is handed a picture of the plan for its list', thumbnails.length > 0,
  String(thumbnails.length));

if (thumbnails.length > 0) {
  const url = thumbnails[thumbnails.length - 1].dataUrl ?? thumbnails[thumbnails.length - 1].url
    ?? Object.values(thumbnails[thumbnails.length - 1]).find((v) => String(v).startsWith('data:'));
  check('and it is a data URL holding a picture', String(url).startsWith('data:image/'),
    String(url).slice(0, 40));

  const shot = await page.evaluate(
    async ([source, dataUrl]) => (eval(source))(dataUrl),
    [SAMPLE, String(url)]
  );
  // A room's plan has walls, dimensions, a title block and a ground. One colour
  // is not a drawing, it is a rectangle.
  check('the thumbnail in the scan list is a drawing, not a black square',
    shot.colours > 3 && shot.black < 0.5,
    JSON.stringify(shot));
  check('and its commonest colour is the paper, not the ink',
    shot.commonest !== '0,0,0', JSON.stringify(shot));
}

/* --------------------------------------- the picture a contractor texts out */

await section(page, 'Files');
await page.waitForTimeout(500);

// "Just the drawing" is the picture — the plan on its own, as a PNG, which is
// what a contractor texts a client when they ask what the room looks like.
const picture = page.getByRole('button', { name: 'Just the drawing' }).first();
check('the plan can be sent as a picture', (await picture.count()) > 0,
  String(await picture.count()));

if ((await picture.count()) > 0) {
  const coming = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
  await picture.click();
  const file = await coming;
  check('and a picture file comes out of it', file !== null, String(file));

  if (file) {
    const where = await file.path();
    const bytes = readFileSync(where);
    check('the picture is a PNG', bytes.slice(1, 4).toString('latin1') === 'PNG',
      bytes.slice(0, 8).toString('hex'));

    const asUrl = `data:image/png;base64,${bytes.toString('base64')}`;
    const shot = await page.evaluate(
      async ([source, dataUrl]) => (eval(source))(dataUrl),
      [SAMPLE, asUrl]
    );
    check('the picture a client is sent is a drawing, not a black square',
      shot.colours > 3 && shot.black < 0.5, JSON.stringify(shot));
    check('and its commonest colour is the paper, not the ink',
      shot.commonest !== '0,0,0', JSON.stringify(shot));
  }
}

/* ---------------------------------------------- and the client's own file */

const client = page.getByRole('button', { name: 'Send to the client' }).first();
if ((await client.count()) > 0) {
  const coming = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
  await client.click();
  const file = await coming;
  if (file) {
    const html = readFileSync(await file.path(), 'utf8');
    check('the client file carries a drawing', /<svg/.test(html), html.slice(0, 200));
    // The token cannot leave the app, so finding one in a file that has left it
    // is the bug itself, whatever the picture happens to look like today.
    check('and nothing in it paints with a colour that only resolves inside the app',
      !/var\(--c-/.test(html),
      (html.match(/var\(--c-[a-z-]+\)/g) ?? []).slice(0, 4).join(' '));
  }
}

await browser.close();
process.exit(report('A53 — every drawing that leaves, sampled as pixels') > 0 ? 1 : 0);
