import { type Nanometres, NM_PER_INCH, add, formatFeetInches } from './length.ts';
import { isAdjusted, isVerified, toleranceOf } from './measurement.ts';
import { type Room, runLength } from './room.ts';
import { type Quantities, roomQuantities } from './zone.ts';
import { readiness, trustLabel } from './issue.ts';
import {
  type Exact,
  type LinePart,
  type WorkItem,
  type WorkScope,
  workSheet,
} from './work.ts';
import {
  decimals,
  linearFeet,
  squareFeet as fromSquares,
  squareFeetOfHalves as fromHalfSquares,
} from './quantity.ts';
import {
  type Spacing,
  footprint,
  footprintObstacle,
  framing,
  openingReturns,
  thicknessGroups,
  withoutThickness,
} from './thickness.ts';

/**
 * The takeoff, in something you can send.
 *
 * The numbers are on screen already. This is the other half of the job: getting
 * them off the phone and into whatever the person is going to price with, which
 * for most of the trade is a spreadsheet, an email, or a text message to
 * somebody who is not on site.
 *
 * Two shapes, because two very different people receive it. Plain text goes in a
 * message and is read by a human being, so it says what each number is for and
 * whether anybody has stood behind it. CSV goes into a spreadsheet or an
 * estimating package and is read by software, so every row carries its own unit
 * and its own provenance in separate columns — a bare number in a cell is how a
 * square foot becomes a linear foot three steps later.
 *
 * **Provenance travels with the quantity or the quantity does not travel.** A
 * takeoff off an unchecked scan is a guess, and the moment it leaves this
 * device as a number in a spreadsheet, nothing else will ever say so. Both
 * shapes carry it on every line.
 */

export interface TakeoffLine {
  /** What it is, in the words a contractor uses. */
  readonly what: string;
  /** The number, exact, in the unit named beside it. */
  readonly quantity: string;
  /** `sq ft`, `lf`, `ea`, `in` — never left to be inferred from context. */
  readonly unit: 'sq ft' | 'lf' | 'ea' | 'in';
  /**
   * Which block of the sheet this belongs under.
   *
   * Only the text and the screen use it; the CSV keeps every line in one flat
   * table, because a spreadsheet groups by filtering a column and would rather
   * not be handed a heading row in the middle of its data.
   */
  readonly group?: string;
  /** Which trades price off this line. */
  readonly prices: string;
  /** What comes off it, so nobody has to reverse-engineer the arithmetic. */
  readonly workings: string;
  /** `measured` once a tape has been on the walls it depends on. */
  readonly provenance: 'measured' | 'scanned';
  /**
   * The surfaces this quantity was added up from — walls by name, and the floor
   * and ceiling by theirs.
   *
   * Set on every line of a scoped sheet and left off an unscoped one, where the
   * answer is always "all of them" and printing it on every row would say
   * nothing. It is what lets a contractor check a number by walking the room:
   * "460.5 sq ft of wall face" cannot be checked, and "460.5 sq ft of wall
   * face, from south, east and west" can.
   */
  readonly from?: readonly string[];
  /**
   * The same quantity, exact, in the unit the model keeps it in.
   *
   * Set on a scoped line and left off an unscoped one, where the screen already
   * has the whole room's figures to convert from. It is what lets a metric
   * contractor read a scoped sheet in metres without this file's foot-and-inch
   * strings being parsed back into numbers — which is how a rounding gets done
   * twice. See `Exact` in `work.ts`.
   */
  readonly exact?: Exact;

  /**
   * Surfaces on this line whose share is a figure the contractor typed, with
   * what the room measures there beside it.
   *
   * Empty on every unscoped sheet and on every scoped line the geometry
   * produced on its own. It is carried so a document can show the two figures
   * apart — his thirty square feet, and the eighty-four the room measures —
   * rather than only as the sentence inside `workings`. A line that has one is
   * never `measured`, whatever tape is on the walls behind it.
   */
  readonly parts?: readonly LinePart[];
}

export interface Takeoff {
  readonly room: string;
  readonly lines: readonly TakeoffLine[];
  /** Ready to text, print, or read down a phone. */
  readonly text: string;
  /** Ready to open in a spreadsheet. */
  readonly csv: string;
  /**
   * Built walls with no thickness against them.
   *
   * Empty means every wall has one. Anything else is the list of walls whose
   * framing, jambs and opening returns are simply not in this sheet — named,
   * because a takeoff that quietly left them out would still add up.
   */
  readonly withoutThickness: readonly string[];
  /**
   * True when this sheet counts only the work somebody said was being done.
   *
   * False is the old behaviour and the honest default: every surface priced as
   * if it were being replaced. A room saved before scopes existed has no scope,
   * opens exactly as it always did, and this is how a screen knows to say so
   * rather than letting a full-replacement sheet pass for a considered one.
   */
  readonly scoped: boolean;
  /**
   * Surfaces with no work picked on them, named. Empty on an unscoped sheet.
   *
   * A wall left alone produces no line anywhere, which is right — a zero line
   * reads as work priced at nothing — and it is exactly why it has to be said
   * here. Otherwise a decision and an oversight look identical.
   */
  readonly untouched: readonly string[];
  /**
   * Work picked on a surface that has none of it, named. Empty when unscoped.
   *
   * Doors ticked on a wall with no door in it: either a door the scan missed,
   * or a tick in the wrong place. Both are worth a look and neither is a line.
   */
  readonly measuresNothing: readonly string[];
  /**
   * Work picked on a surface this room no longer has, named. Empty when
   * unscoped.
   *
   * A wall deleted, renamed or turned into an open span takes everything
   * somebody decided about it with it. The quote moves, and without this
   * nothing would say why.
   */
  readonly stranded: readonly string[];
}

/*
 * The four quantity formatters that used to live here are in `quantity.ts` now,
 * imported above under the names this file has always called them. They moved
 * the moment a second module started producing priceable lines: two roundings
 * of the same measurement in two files is how the garage's floor came to read
 * 411.7 in one place and 411.8 in another.
 */

/** A CSV field, quoted only when it has to be, escaped when it does. */
function field(text: string): string {
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function countOpenings(room: Room, kind: 'door' | 'window' | 'cased'): number {
  return room.walls.reduce(
    (total, wall) => total + (wall.openings ?? []).filter((o) => o.kind === kind).length,
    0
  );
}

/** Inches as a decimal, for the column a spreadsheet will do arithmetic on. */
function inches(value: Nanometres): string {
  return decimals(value, NM_PER_INCH, 4).replace(/0+$/, '').replace(/\.$/, '');
}

export interface TakeoffOptions {
  /** Where studs land. 16 in on centre unless the job says otherwise. */
  readonly spacing?: Spacing;
  /**
   * Whose takeoff this is.
   *
   * A sheet a contractor sends to a supplier or a sub should say whose it is,
   * or the reply comes back to nobody. Left out when nothing has been set,
   * rather than printed as an empty line.
   */
  readonly company?: string;
  /**
   * What is actually being done, and the items it was picked from.
   *
   * **Left out by everything written before this existed, and that is the whole
   * design.** With no work given, the sheet is what it has always been: every
   * surface priced as replaced, every line unchanged to the character. That is
   * what makes a project saved last month open exactly the same way today. See
   * `scoped` on the result, which is how a screen tells the two apart.
   *
   * Both halves are needed together. The scope holds decisions by item name;
   * the items say where each of those names takes its quantity from, and they
   * come from the contractor's own rate book — so this module never has to know
   * what "Skim coat" is or which wall it belongs on.
   */
  readonly work?: {
    readonly scope: WorkScope;
    readonly items: readonly WorkItem[];
  };
}

/**
 * The lines wall thickness adds, and nothing when nobody has given one.
 *
 * These are the numbers you cannot order against without knowing how thick the
 * wall is, which is every one of them: the jamb a door is cut for, the drywall
 * wrapped round a window's reveal, the plates and studs behind it, and what the
 * building measures on the ground rather than on the inside face.
 *
 * A wall with no thickness contributes to none of them, and `withoutThickness`
 * on the sheet names it. Defaulting to four and a half inches would let a block
 * garage be priced as stud framing, and the sheet would reconcile perfectly.
 */
function thicknessLines(
  room: Room,
  spacing: Spacing,
  roomProvenance: 'measured' | 'scanned'
): TakeoffLine[] {
  const groups = thicknessGroups(room);
  if (groups.length === 0) return [];
  const lines: TakeoffLine[] = [];
  const group = 'Openings and framing';

  for (const g of groups) {
    if (g.openings === 0) continue;
    // One jamb size per wall thickness. A room-wide average would be right for
    // some of the openings and send the wrong pre-hung unit for the rest.
    const which = g.assembly ? g.assembly.short : formatFeetInches(g.thickness);
    lines.push({
      what: groups.filter((x) => x.openings > 0).length > 1 ? `Jamb — ${which}` : 'Jamb',
      quantity: inches(g.jamb),
      unit: 'in',
      prices: 'pre-hung doors, jamb stock, extension jambs',
      workings:
        `${formatFeetInches(g.jamb)} — ${formatFeetInches(g.thickness)} of wall (${g.how}) plus ` +
        `a sixteenth, for ${g.openings} opening${g.openings === 1 ? '' : 's'} in ` +
        `${g.wallIds.join(', ')}`,
      // The wall runs have nothing to do with this one: a jamb is the thickness
      // and a sixteenth, and the thickness came from a person or it is not here.
      provenance: g.verified && g.how === 'tape' ? 'measured' : 'scanned',
      group,
    });
  }

  const returns = openingReturns(room);
  if (returns.length > 0) {
    lines.push({
      what: 'Opening wrap',
      quantity: fromSquares(returns.reduce((total, r) => total + r.area, 0n)),
      unit: 'sq ft',
      prices: 'drywall return, plaster, reveal trim',
      workings: 'the reveal round each opening, through the wall it sits in',
      provenance: 'scanned',
      group,
    });
    lines.push({
      what: 'Reveal run',
      quantity: linearFeet(add(...returns.map((r) => r.run))),
      unit: 'lf',
      prices: 'corner bead, extension jamb stock',
      workings: 'two jambs and a head on every opening; a sill as well on a window',
      provenance: 'scanned',
      group,
    });
  }

  const f = framing(room, spacing);
  if (f.wallIds.length > 0) {
    lines.push({
      what: 'Plates',
      quantity: linearFeet(f.plateRun),
      unit: 'lf',
      prices: 'plate stock',
      workings: `three times ${formatFeetInches(f.framedRun)} of framed wall — one bottom, two top`,
      provenance: roomProvenance,
      group,
    });
    lines.push({
      what: 'Studs',
      quantity: String(f.studs),
      unit: 'ea',
      prices: 'stud stock',
      workings:
        `field studs at ${f.spacing} in on centre, one at each end of each wall. Corners, ` +
        `channels, kings, jacks and cripples are not counted — how many depends on how it is framed`,
      provenance: roomProvenance,
      group,
    });
    if (f.headers > 0) {
      lines.push({
        what: 'Headers',
        quantity: String(f.headers),
        unit: 'ea',
        prices: 'header stock',
        workings: 'one over each opening in a framed wall; sized on site',
        provenance: 'scanned',
        group,
      });
    }
  }

  if (footprintObstacle(room) === undefined) {
    const print = footprint(room);
    lines.push({
      what: 'Outside footprint',
      quantity: fromHalfSquares(print.outside),
      unit: 'sq ft',
      prices: 'slab, roof, siding, permit sketch',
      workings: `inside area plus ${formatFeetInches(print.thickness)} of wall all the way round`,
      provenance: roomProvenance,
      group,
    });
  }

  return lines;
}

export function takeoff(room: Room, at: string, options: TakeoffOptions = {}): Takeoff {
  const q: Quantities = roomQuantities(room);
  const state = readiness(room);
  // One word for the whole takeoff: every line is derived from the same walls,
  // so no line can be firmer than the room they came from.
  const provenance = state.blocking.length === 0 ? 'measured' : 'scanned';

  /**
   * The finishes: what is being done, or everything, and never a mixture.
   *
   * With no scope this is the block that has been on every takeoff since the
   * beginning — the whole floor, the whole ceiling, every wall face, all the
   * base, every opening counted. That is the right answer for a room nobody has
   * said anything about yet, and it is the only honest one: the alternative is
   * an empty sheet for a job somebody has not scoped, which reads as a room
   * that takes nothing.
   *
   * With a scope, each line is added up out of the surfaces it was picked on,
   * and a surface nobody picked anything on contributes to nothing at all.
   */
  const scoped = options.work
    ? workSheet(room, options.work.scope, options.work.items, provenance)
    : null;

  const lines: TakeoffLine[] = scoped
    ? scoped.lines.map((line) => ({ ...line }))
    : [
        {
          what: 'Floor',
          quantity: fromHalfSquares(q.floorArea),
          unit: 'sq ft',
          prices: 'flooring, tile, underlay',
          workings: 'the floor outline',
          provenance,
        },
        {
          what: 'Ceiling',
          quantity: fromHalfSquares(q.ceilingArea),
          unit: 'sq ft',
          prices: 'ceiling drywall, paint',
          workings: 'follows the floor',
          provenance,
        },
        {
          what: 'Wall face',
          quantity: fromSquares(q.wallFaceArea),
          unit: 'sq ft',
          prices: 'drywall, paint, primer',
          workings: 'built walls x their height, less every door and window',
          provenance,
        },
        {
          what: 'Baseboard',
          quantity: linearFeet(q.baseboardRun),
          unit: 'lf',
          prices: 'base, shoe, trim',
          workings: 'built walls less doors and cased openings; runs under windows',
          provenance,
        },
      ];

  if (!scoped) {
    for (const kind of ['door', 'window', 'cased'] as const) {
      const n = countOpenings(room, kind);
      if (n === 0) continue;
      lines.push({
        what: kind === 'cased' ? 'Cased openings' : `${kind[0]!.toUpperCase()}${kind.slice(1)}s`,
        quantity: String(n),
        unit: 'ea',
        prices: kind === 'window' ? 'glazing, trim' : 'slabs, jambs, casing, hardware',
        workings: 'counted off the walls',
        // Opening sizes have been out by more than a foot on real scans, so they
        // are never anything but the scanner's until somebody says otherwise.
        provenance: 'scanned',
      });
    }
  }

  // On a scoped sheet as well as an unscoped one, because it is not work: it is
  // the app saying a side of this room has nothing built across it, which is
  // the one thing a contractor must not find out from a delivery.
  if (q.openRun > 0n) {
    const open = room.walls.filter((wall) => wall.open).map((wall) => wall.id);
    lines.push({
      what: 'Open span',
      quantity: linearFeet(q.openRun),
      unit: 'lf',
      prices: 'nothing — no drywall, no paint, no trim',
      workings: 'sides of the room with nothing built across them',
      provenance,
      ...(scoped ? { from: open } : {}),
    });
  }

  lines.push(...thicknessLines(room, options.spacing ?? 16, provenance));

  const bare = withoutThickness(room);

  // A scoped room where nothing has been picked yet has no lines at all, and
  // `Math.max()` of nothing is -Infinity. Guarded rather than left to throw:
  // "I have not decided what I am doing yet" is a perfectly ordinary state for
  // a sheet to be in and it must produce a sheet that says so.
  const width = Math.max(1, ...lines.map((l) => l.what.length));
  const rule = '-'.repeat(width + 14);
  const row = (l: TakeoffLine) =>
    `${l.what.padEnd(width)}  ${l.quantity.padStart(8)} ${l.unit.padEnd(5)}`.trimEnd();

  // Grouped in the text and flat in the CSV, on purpose. A person reads down a
  // sheet and wants the framing kept apart from the finishes; a spreadsheet
  // groups by filtering a column and a heading row in the middle of the data is
  // a row it has to be told to skip.
  const groups: string[] = [];
  for (const line of lines) {
    const name = line.group ?? '';
    if (!groups.includes(name)) groups.push(name);
  }
  const body = groups
    .map((name) => {
      const rows = lines.filter((l) => (l.group ?? '') === name).map(row).join('\n');
      return name === '' ? rows : `\n${name}\n${'·'.repeat(name.length)}\n${rows}`;
    })
    .join('\n');

  const caveat =
    provenance === 'measured'
      ? 'Every wall behind these numbers has had a tape on it.'
      : 'THESE ARE THE SCANNER’S NUMBERS. No wall behind them has had a tape on it, ' +
        'and they will move when one does.';

  // Named rather than defaulted. A takeoff missing the framing for three walls
  // adds up perfectly and is short by three walls.
  const thicknessNote =
    bare.length === 0
      ? ''
      : `\nNo thickness given for ${bare.join(', ')} — no jamb, wrap, plate or stud above ` +
        `counts ${bare.length === 1 ? 'it' : 'them'}.\n`;

  /**
   * What this sheet counted, said on the sheet.
   *
   * Only on a scoped one. An unscoped takeoff is character for character what
   * it has always been — a project saved before any of this existed has to open
   * and read exactly as it did — and the screen is where that room is told it
   * is being priced as a full replacement. See `scoped` on the result.
   *
   * When there IS a scope, three things have to be said out loud, and every one
   * of them is a thing that would otherwise be a silent absence:
   *
   *   - which surfaces were left alone, because that is a decision;
   *   - what was picked and measures nothing, because that is a mistake;
   *   - that framing follows wall thickness rather than the scope, because the
   *     two look like they should be the same thing and are not.
   */
  const scopeNote = !scoped
    ? ''
    : '\n' +
      (scoped.lines.length === 0
        ? 'Nothing has been picked in this room yet, so nothing is on this sheet. ' +
          'Open a wall and say what is being done to it.\n'
        : 'This sheet counts only what is being done. Anything not picked is not on it at ' +
          'all — left out rather than priced at nothing.\n') +
      (scoped.untouched.length === 0
        ? ''
        : `Nothing is being done to ${scoped.untouched.join(', ')}.\n`) +
      (scoped.measuresNothing.length === 0
        ? ''
        : `Picked, and there is none of it there: ${scoped.measuresNothing.join('; ')}.\n`) +
      (scoped.stranded.length === 0
        ? ''
        : `Picked on part of the room that is no longer there, so it is not counted: ` +
          `${scoped.stranded.join('; ')}.\n`) +
      (lines.some((l) => l.group !== undefined)
        ? 'Openings and framing below follow the walls you have given a thickness, not what is ' +
          'picked on a surface — a jamb belongs to the wall it goes through.\n'
        : '');

  const text =
    `${room.name} — takeoff\n` +
    `${rule}\n` +
    `${body}\n` +
    `${rule}\n` +
    scopeNote +
    `${trustLabel(state.trust)}.\n` +
    `${caveat}\n` +
    thicknessNote +
    (options.company && options.company.trim() !== ''
      ? `${options.company.trim()} — taken off ${at} with ScanToBid.`
      : `Taken off ${at} by ScanToBid.`);

  const header = 'item,quantity,unit,prices,workings,provenance,room,taken_off';
  const csv = [
    header,
    ...lines.map((l) =>
      [l.what, l.quantity, l.unit, l.prices, l.workings, l.provenance, room.name, at]
        .map(field)
        .join(',')
    ),
  ].join('\n');

  return {
    room: room.name,
    lines,
    text,
    csv,
    withoutThickness: bare,
    scoped: scoped !== null,
    untouched: scoped?.untouched ?? [],
    measuresNothing: scoped?.measuresNothing ?? [],
    stranded: scoped?.stranded ?? [],
  };
}

/**
 * The wall schedule: every wall, its length, and whether anybody stood behind it.
 *
 * The takeoff is what gets priced; this is what gets checked. A sub who is
 * handed "460.5 sq ft of wall face" cannot tell which wall was measured and
 * which was guessed, and that is the one thing this product knows and nobody
 * else does.
 */
export function wallSchedule(room: Room): string {
  const rows = room.walls.map((wall) => {
    const length = runLength(wall);
    const band = toleranceOf(wall.length);
    return [
      wall.id,
      formatFeetInches(length),
      // Never "scanned" for a wall somebody dragged: it is not the sensor's
      // number any more, and printing the sensor's band beside it on a sheet a
      // sub prices off would be putting a guarantee on a guess.
      isVerified(wall.length)
        ? 'measured'
        : isAdjusted(wall.length)
          ? 'moved by hand'
          : `scanned ±${formatFeetInches(band)}`,
      wall.open ? 'no wall built here' : '',
      (wall.openings ?? []).map((o) => `${o.kind} ${formatFeetInches(o.width.value)}`).join(' + '),
    ];
  });
  const widths = [0, 1, 2, 3, 4].map((i) => Math.max(...rows.map((r) => r[i]!.length)));
  return rows
    .map((r) =>
      r
        .map((cell, i) => cell.padEnd(widths[i]!))
        .join('  ')
        .trimEnd()
    )
    .join('\n');
}

