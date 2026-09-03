/**
 * The calculators, on the page.
 *
 * Everything here is reading a form and writing a result. **There is no
 * arithmetic in this file**, and there must never be: every number it prints
 * came out of `/calc-engine.js`, which is `site/src/calc/engine.mjs` bundled,
 * which is `core/src/*.ts` — the app's own engine. If a figure on one of these
 * pages disagreed with the app, that would be a bug in the app.
 *
 * The import below is left as an absolute URL and marked external at bundle
 * time, so the engine is one file the browser caches once across five
 * calculator pages rather than five copies of the same bundle. It is also what
 * lets `site/tools/calc-truth.mjs` import exactly the bytes a visitor is served
 * and check them against the source.
 *
 * ## Without JavaScript
 *
 * The form does nothing, and the page says so. Every calculator page carries a
 * worked example computed by this same engine at build time, and the formula
 * each one uses, both in plain HTML — so the page is worth reading with the
 * scripting turned off, on a phone with two bars, in a truck.
 */
import * as E from '/calc-engine.js';

const $ = (form, name) => form.querySelector(`[name="${name}"]`);
const value = (form, name) => {
  const field = $(form, name);
  return field ? field.value.trim() : '';
};
const checked = (form, name) => {
  const field = $(form, name);
  return field ? field.checked : false;
};

/* ------------------------------------------------------------- the shape */

/**
 * The room, out of whichever way the person chose to describe it.
 *
 * A rectangle is the four-wall walk it is — the engine has one code path for a
 * room, and a rectangle is not a special case of it, it is an instance of it.
 */
function readWalk(form) {
  const mode = form.querySelector('[name="shape"]:checked')?.value ?? 'rect';
  if (mode === 'rect') {
    return E.rectangleWalk(
      E.readLength(value(form, 'width'), 'Room width'),
      E.readLength(value(form, 'depth'), 'Room depth')
    );
  }
  const walk = [];
  for (const row of form.querySelectorAll('[data-walk-row]')) {
    const run = row.querySelector('[name="run"]').value.trim();
    if (run === '') continue;
    const heading = row.querySelector('[name="heading"]').value;
    walk.push({
      id: `Wall ${walk.length + 1}`,
      heading,
      length: E.readLength(run, `Wall ${walk.length + 1}`),
    });
  }
  if (walk.length < 4) {
    throw new E.RoomError(
      `A closed room needs at least four walls; you have given ${walk.length}. Walk the room ` +
        'and write down every straight run, in order, all the way back to where you started.'
    );
  }
  return walk;
}

/**
 * The three kinds of opening, and the name of the box that counts each.
 *
 * Written out rather than derived by adding an "s", which is what it used to
 * do — and the plural of "cased opening" on the form is `cased`, so the box was
 * never found, and a five foot cased opening was silently not deducted from the
 * baseboard run. The page showed a confident, wrong number and nothing said so.
 * `tools/calc-browser.mjs` is what caught it, by typing into the real form.
 */
const OPENINGS = [
  { kind: 'door', count: 'doors', label: 'Door' },
  { kind: 'window', count: 'windows', label: 'Window' },
  { kind: 'cased', count: 'cased', label: 'Cased opening' },
];

function readOpenings(form) {
  const out = [];
  for (const { kind, count: countName, label } of OPENINGS) {
    const countField = $(form, countName);
    if (!countField) continue;
    const raw = countField.value.trim();
    if (raw === '' || raw === '0') continue;
    const count = E.parseCount(raw, countName);
    if (count === 0n) continue;
    out.push({
      kind,
      count,
      width: E.readLength(value(form, `${kind}Width`), `${label} width`),
      height: E.readLength(value(form, `${kind}Height`), `${label} height`),
    });
  }
  return out;
}

function readRoom(form) {
  const walk = readWalk(form);
  const openings = readOpenings(form);
  const placed = openings.length > 0 ? E.placeOpenings(walk, openings) : walk;
  const thickness = value(form, 'thickness');
  return E.buildRoom(placed, E.readLength(value(form, 'height'), 'Ceiling height'), {
    ...(thickness === '' ? {} : { wallThickness: E.readLength(thickness, 'Wall thickness') }),
  });
}

function readWaste(form) {
  const raw = value(form, 'waste');
  return raw === '' ? 0n : E.parsePercent(raw);
}

/* ------------------------------------------------------------ the answers */

const CALCULATORS = {
  markup(form) {
    const cost = E.parseMoney(value(form, 'cost'));
    const markup = E.parsePercent(value(form, 'markup'));
    const r = E.markupToMargin(cost, markup);
    const target = value(form, 'targetMargin');

    const rows = [
      ['What the job costs you', E.money(r.costCents)],
      ['Markup on the cost', `${E.percent(r.markupBasisPoints)}%`],
      ['What you charge', E.money(r.priceCents)],
      ['Gross profit', E.money(r.marginCents)],
      ['Margin — the share of the price you keep', `${E.percent(r.marginBasisPoints)}%`],
    ];
    const working = [
      `price = ${E.money(r.costCents)} + ${E.percent(r.markupBasisPoints)}% of ` +
        `${E.money(r.costCents)} = ${E.money(r.priceCents)}`,
      `markup = ${r.workings.markup}`,
      `margin = ${r.workings.margin}`,
    ];
    if (target !== '') {
      const wanted = E.parsePercent(target);
      const needed = E.marginToMarkup(wanted);
      rows.push([
        `Markup that leaves ${E.percent(wanted)}% margin`,
        `${E.percent(needed)}%`,
      ]);
      working.push(
        `markup = margin ÷ (1 − margin) = ${E.percent(wanted)} ÷ ` +
          `${E.percent(10_000n - wanted)} = ${E.percent(needed)}%`
      );
    }
    return { rows, working };
  },

  drywall(form) {
    const room = readRoom(form);
    const figures = E.roomFigures(room);
    const ceiling = checked(form, 'ceiling');
    const waste = readWaste(form);
    const r = E.drywall(room, { sheet: value(form, 'sheet'), ceiling, wasteBasisPoints: waste });

    const rows = [
      ['Perimeter', `${figures.perimeterFeet} lf (${figures.perimeterSaid})`],
      ['Wall face, less every opening', `${r.wallFace} sq ft`],
      ['Ceiling', ceiling ? `${r.ceilingArea} sq ft` : 'not being boarded'],
      ['Board to cover', `${r.boardArea} sq ft`],
      [`One ${r.sheet.label} sheet covers`, `${r.sheetArea} sq ft`],
      ['Sheets, before any waste', `${r.sheets}`],
    ];
    const working = [
      `wall face = ${figures.perimeterFeet} lf × ${E.formatFeetInches(
        room.ceilingHeight.value
      )}, less every door, window and cased opening = ${r.wallFace} sq ft`,
      `sheets = ${r.boardArea} ÷ ${r.sheetArea}, rounded up = ${r.sheets}`,
    ];
    if (waste > 0n) {
      rows.push([`Sheets, with your ${E.percent(waste)}% waste`, `${r.sheetsWithWaste}`]);
      working.push(
        `with waste = ${r.boardArea} × ${E.percent(10_000n + waste)}% = ` +
          `${r.boardAreaWithWaste} sq ft, ÷ ${r.sheetArea}, rounded up = ${r.sheetsWithWaste}`
      );
    }
    if (r.openingWrap !== null) {
      rows.push([
        'Board wrapping into the jambs',
        `${r.openingWrap} sq ft — about ${r.openingWrapSheets} more sheet` +
          (r.openingWrapSheets === 1n ? '' : 's'),
      ]);
    }
    return {
      rows,
      working,
      note:
        waste > 0n
          ? null
          : 'No waste allowance is in these figures. ScanToBid has not seen this room, and how ' +
            'much a room wastes is a fact about the room — put your own figure in the box.',
    };
  },

  paint(form) {
    const room = readRoom(form);
    const ceiling = checked(form, 'ceiling');
    const coats = E.parseCount(value(form, 'coats'), 'coats');
    // The coverage box starts empty and stays empty until somebody reads a
    // tin, so the page opens on this rather than on a parse error. It is the
    // one field on any of these calculators that nothing can be inferred for,
    // and saying so is the answer rather than a failure to give one.
    if (value(form, 'coverage') === '') {
      const q = E.roomFigures(room);
      return {
        rows: [
          ['Wall face, less every opening', `${q.wallFace} sq ft`],
          ['Ceiling', ceiling ? `${q.ceilingArea} sq ft` : 'not being painted'],
          ['Coats', `${coats}`],
        ],
        working: [],
        note:
          'The room is measured. What is missing is the coverage rate — the square feet a '
          + 'gallon covers, printed on the tin. ScanToBid does not know what you are painting '
          + 'with, it is different for a primer, and it is different again over bare board, so '
          + 'it will not pick one for you. Put it in the box and the gallons appear.',
      };
    }
    const coverage = E.parseCount(value(form, 'coverage'), 'square feet per gallon');
    const r = E.paint(room, { coats, coverageSqFt: coverage, ceiling });

    return {
      rows: [
        ['Wall face, less every opening', `${r.wallFace} sq ft`],
        ['Ceiling', ceiling ? `${r.ceilingArea} sq ft` : 'not being painted'],
        ['Area, one coat', `${r.areaPerCoat} sq ft`],
        ['Coats', `${r.coats}`],
        ['Area, every coat', `${r.areaAllCoats} sq ft`],
        ['Paint needed', `${r.gallons} gal`],
        ['Gallons to buy', `${r.gallonsToBuy}`],
      ],
      working: [
        `area = ${r.areaPerCoat} sq ft × ${r.coats} coat${r.coats === 1n ? '' : 's'} = ` +
          `${r.areaAllCoats} sq ft`,
        `paint = ${r.areaAllCoats} ÷ ${r.coverageSqFt} sq ft per gallon = ${r.gallons} gal`,
        `to buy = ${r.gallons}, rounded up = ${r.gallonsToBuy}`,
      ],
      note:
        `${r.coverageSqFt} sq ft per gallon is the figure you typed. It is a property of the ` +
        'tin, not of the room — read it off the can, and read it again for the primer.',
    };
  },

  trim(form) {
    const room = readRoom(form);
    const waste = readWaste(form);
    const stock = value(form, 'stock');
    const r = E.trim(room, {
      wasteBasisPoints: waste,
      ...(stock === '' ? {} : { stockLengthNm: E.readLength(stock, 'Stock length') }),
    });

    const rows = [
      ['Perimeter', `${r.perimeter} lf (${r.perimeterSaid})`],
      ['Taken off for doors and cased openings', `${r.deducted} lf (${r.deductedSaid})`],
      ['Baseboard run', `${r.baseboard} lf (${r.baseboardSaid})`],
    ];
    const working = [
      `baseboard = ${r.perimeter} lf of perimeter − ${r.deducted} lf of door and cased ` +
        `opening = ${r.baseboard} lf`,
      'windows are not deducted — base runs under a window',
    ];
    if (waste > 0n) {
      rows.push([`With your ${E.percent(waste)}% waste`, `${r.baseboardWithWaste} lf`]);
    }
    if (r.pieces !== null) {
      rows.push([
        `Sticks at ${E.formatFeetInches(r.stockLengthNm)}`,
        `${r.pieces}`,
      ]);
      working.push(
        `sticks = ${r.baseboardWithWaste} lf ÷ ${E.formatFeetInches(
          r.stockLengthNm
        )}, rounded up = ${r.pieces}`
      );
    }
    return {
      rows,
      working,
      note:
        r.pieces === null
          ? null
          : 'A stick count is straight division. Where the joins land and what every mitre ' +
            'eats are decisions made on the wall, and no room’s geometry knows them.',
    };
  },

  room(form) {
    const room = readRoom(form);
    const f = E.roomFigures(room);
    const rows = [
      ['Floor area', `${f.floorArea} sq ft`],
      ['Ceiling area', `${f.ceilingArea} sq ft`],
      ['Perimeter', `${f.perimeterFeet} lf (${f.perimeterSaid})`],
      ['Wall face, less every opening', `${f.wallFace} sq ft`],
      ['Baseboard run', `${f.baseboard} lf`],
    ];
    const working = [
      'floor area = the shoelace formula over the corners the walk lands on — not width × depth',
      `wall face = ${f.perimeterFeet} lf × ${E.formatFeetInches(room.ceilingHeight.value)}, ` +
        'less every opening',
    ];
    if (!f.closes) {
      return {
        rows: [],
        working: [],
        error:
          'This room does not close. Walking the runs you gave, in order, finishes ' +
          `${E.formatFeetInches(
            f.closureGap.x < 0n ? -f.closureGap.x : f.closureGap.x
          )} east-west and ${E.formatFeetInches(
            f.closureGap.y < 0n ? -f.closureGap.y : f.closureGap.y
          )} north-south away from where it started. An area worked out from a walk that ` +
          'does not close is an area of a shape that is not the room. Check the runs — one of ' +
          'them is out, and it is usually the one nobody measured.',
      };
    }
    return { rows, working };
  },
};

/* -------------------------------------------------------------- rendering */

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function render(out, result) {
  out.replaceChildren();

  if (result.error) {
    const box = element('div', 'note');
    box.append(element('p', null, result.error));
    out.append(box);
    return;
  }

  const list = element('dl', 'spec');
  for (const [label, figure] of result.rows) {
    const row = element('div');
    row.append(element('dt', null, label));
    row.append(element('dd', null, figure));
    list.append(row);
  }
  out.append(list);

  if (result.working?.length) {
    const box = element('div', 'formula');
    for (const line of result.working) box.append(element('div', 'eq', line));
    out.append(box);
  }
  if (result.note) {
    const box = element('div', 'note');
    box.append(element('p', null, result.note));
    out.append(box);
  }
}

/* ------------------------------------------------------------------ wiring */

function attach(form) {
  const kind = form.dataset.calc;
  const run = CALCULATORS[kind];
  const out = form.querySelector('[data-out]');
  if (!run || !out) return;

  const recompute = () => {
    try {
      render(out, run(form));
    } catch (error) {
      // Every message the engine raises is written to be read by the person who
      // typed the thing it is about, so it is shown as it is rather than
      // replaced with "invalid input".
      render(out, { error: error.message });
    }
  };

  form.addEventListener('input', recompute);
  form.addEventListener('change', recompute);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    recompute();
  });

  // The shape switch: whichever way of describing the room is not in use is
  // taken out of the page rather than left visible and ignored.
  const shapes = form.querySelectorAll('[name="shape"]');
  if (shapes.length > 0) {
    const showShape = () => {
      const mode = form.querySelector('[name="shape"]:checked')?.value ?? 'rect';
      for (const panel of form.querySelectorAll('[data-shape]')) {
        panel.hidden = panel.dataset.shape !== mode;
      }
    };
    for (const radio of shapes) radio.addEventListener('change', showShape);
    showShape();
    for (const chooser of form.querySelectorAll('[data-shape-switch]')) chooser.hidden = false;
  }

  // Only now: a submit button on a calculator that has not attached yet is a
  // button that reloads the page.
  for (const button of form.querySelectorAll('[data-calc-go]')) button.hidden = false;
  form.dataset.live = 'yes';
  recompute();
}

for (const form of document.querySelectorAll('[data-calc]')) attach(form);
