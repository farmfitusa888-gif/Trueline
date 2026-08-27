import { type Nanometres, formatFeetInches } from './length.ts';
import { toleranceOf } from './measurement.ts';
import { type Room, RoomError, isDiagonal, runLength } from './room.ts';
import { readiness } from './issue.ts';
import { type Footprint, DEFAULT_REACH, obstructions, punchList } from './obstruction.ts';

/**
 * The list to carry, on paper or in a pocket.
 *
 * The punch list already knows which walls are worth a tape and why. It has been
 * living on a screen, which is the wrong place for it: nobody holds a tablet in
 * one hand, a tape in the other, and scrolls with a third. What somebody
 * actually needs walking into a room is four lines and somewhere to write.
 *
 * So this is that list as text — printable, sendable, readable out loud. It is
 * deliberately plain: no table that reflows badly, no characters a messaging app
 * will mangle, nothing that needs a viewer. Paste it into a text, print it, or
 * copy it onto the back of an envelope.
 *
 * Each line carries what the scanner said, so a real measurement can be compared
 * against it on the spot rather than back at a desk. That is the point of taking
 * it: the number to write down is the one that disagrees.
 */

export class FieldListError extends RoomError {}

export interface FieldListOptions {
  /** How many walls to ask for. Four is a two-minute job; ten is a chore nobody finishes. */
  readonly limit?: number;
  readonly reach?: Nanometres;
  /** Stamped on the sheet, so two lists from two visits are never confused. */
  readonly at?: string;
}

export interface FieldListLine {
  readonly wallId: string;
  /** What the scanner said this wall is. */
  readonly scanned: Nanometres;
  /** Its band, so the person can see how much room there is to disagree. */
  readonly tolerance: Nanometres;
  /** Why it is on the list, in a sentence. */
  readonly why: string;
}

export interface FieldList {
  readonly title: string;
  readonly lines: readonly FieldListLine[];
  /** The whole thing, ready to print, text, or read down a phone. */
  readonly text: string;
}

const RULE = '-'.repeat(44);

/**
 * Builds the list.
 *
 * The order is the punch list's order, which is by how much floor area each
 * wall's uncertainty puts in doubt, multiplied up by how much of it something
 * was standing in front of. Whatever is at the top is the one measurement that
 * buys the most.
 */
export function fieldList(
  room: Room,
  footprints: readonly Footprint[] = [],
  options: FieldListOptions = {}
): FieldList {
  const limit = options.limit ?? 4;
  if (limit < 1) throw new FieldListError(`A list of ${limit} walls is not a list.`);
  const reach = options.reach ?? DEFAULT_REACH;

  const blocked = new Map(obstructions(room, footprints, reach).map((o) => [o.wallId, o]));
  const state = readiness(room);
  const ranked = punchList(room, footprints, reach, limit);

  const lines: FieldListLine[] = ranked.map((item) => {
    const wall = room.walls.find((w) => w.id === item.wallId)!;
    const o = blocked.get(item.wallId);
    const reasons: string[] = [];
    if (o && o.blockedPerMille > 0n) {
      reasons.push(
        `${Number(o.blockedPerMille) / 10}% of it was behind ` +
          (o.by.length === 0 ? 'something'
            : o.by.length === 1 ? o.by[0]!
            : o.by.length === 2 ? `${o.by[0]} and ${o.by[1]}`
            : `${o.by.slice(0, -1).join(', ')} and ${o.by[o.by.length - 1]}`)
      );
    }
    if (wall.open) reasons.push('the scan found no wall across this one');
    if (isDiagonal(wall.heading)) reasons.push('it runs at an angle');
    if (reasons.length === 0) reasons.push('nothing was in the way, but nobody has measured it');

    return {
      wallId: wall.id,
      scanned: runLength(wall),
      tolerance: toleranceOf(wall.length),
      why: reasons.join('; '),
    };
  });

  const title = `${room.name} — walls to measure`;
  const header = [
    title,
    options.at ? `Printed ${options.at}` : null,
    RULE,
    state.blocking.length === 0
      ? 'This room can already go out as a drawing. These would tighten it.'
      : 'This room cannot go out as a drawing until at least one wall on each' +
        '\naxis has been measured. Start at the top.',
    RULE,
    '',
  ].filter((x) => x !== null);

  const body = lines.flatMap((line, i) => [
    `${i + 1}. ${line.wallId}`,
    `   Scan says:  ${formatFeetInches(line.scanned)}` +
      (line.tolerance > 0n ? `  (could be out by ${formatFeetInches(line.tolerance)})` : ''),
    `   Because:    ${line.why}`,
    '   Measured:   ______________________',
    '',
  ]);

  const footer = [
    RULE,
    'Type these back into Trueline and the room re-solves around them.',
    'A wall you measure never moves again.',
  ];

  return { title, lines, text: [...header, ...body, ...footer].join('\n') };
}
