import { type Nanometres, formatFeetInches } from './length.ts';
import { toleranceOf } from './measurement.ts';
import { type Room, RoomError, isDiagonal, runLength } from './room.ts';
import { readiness } from './issue.ts';
import { type Footprint, DEFAULT_REACH, obstructions, punchList } from './obstruction.ts';
import { type Mark, damageQuantity, markWord } from './damage.ts';
import { type VoiceNote, notesOnMark, notesOnWall, whatWasSaid } from './voice.ts';

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
  /**
   * What is marked on the walls, so the sheet carries it back into the room.
   *
   * ## Why this is on the measuring list and not on a list of its own
   *
   * A condition note is only worth taking if somebody reads it standing in front
   * of the wall it is about. On a claim the marks go on the claim document,
   * which an adjuster reads at a desk; on an ordinary remodel there is no such
   * document, and until now a remodeler could record that a sill plate was soft
   * and then have nowhere to read it except by tapping the wall again.
   *
   * This is the sheet that already goes into a pocket. Putting the marks on it
   * costs nothing and is the difference between a note and a note somebody acts
   * on.
   *
   * **Nothing here is a quantity.** Each mark prints where it is and what was
   * said about it, and never an area — a condition somebody noticed is not work
   * anybody has bought, and a square-foot figure on a sheet like this would be
   * read as one. On a claim the areas are on `claimReport`, which is the
   * document that is allowed to have them.
   */
  readonly marks?: readonly Mark[];
  /** What was said out loud about each wall and each mark. */
  readonly voice?: readonly VoiceNote[];
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

/** One thing marked in the room, as it reads on paper. */
export interface FieldListMark {
  readonly markId: string;
  /**
   * The wall it is on, or `the ceiling` — the surface a person reads it
   * standing at. A ceiling mark has no wall and is given no fake one.
   */
  readonly wallId: string;
  /** "rot", "water damage" — the word, not a code. */
  readonly what: string;
  /** Where it is along the wall and how high, in words. Never an area. */
  readonly where: string;
  /** What somebody typed about it. */
  readonly note: string;
  /** And what they said out loud, one line each. */
  readonly said: readonly string[];
}

export interface FieldList {
  readonly title: string;
  readonly lines: readonly FieldListLine[];
  /**
   * What is marked on the walls, in the order the plan numbers them.
   *
   * Separate from `lines` because they answer two different questions — `lines`
   * is what to go and measure, this is what somebody already found — and a sheet
   * that ran them together would put a wall nobody has measured next to a note
   * about rot as though they were the same kind of task.
   */
  readonly marks: readonly FieldListMark[];
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

  const voice = options.voice ?? [];
  const marks = markedOn(room, options.marks ?? [], voice);
  const onTheWalls =
    marks.length === 0
      ? []
      : [
          '',
          RULE,
          `MARKED IN THIS ROOM — ${marks.length}`,
          'What somebody found standing here. None of it is in the takeoff:',
          'noticing something is not the same as being paid to fix it.',
          RULE,
          '',
          ...marks.flatMap((mark) => [
            `${mark.wallId} — ${mark.what}`,
            `   Where:  ${mark.where}`,
            `   Note:   ${mark.note}`,
            ...mark.said.map((line, i) => `   ${i === 0 ? 'Said: ' : '      '}  ${line}`),
            '',
          ]),
        ];

  // What somebody said about a wall itself, rather than about a mark on it.
  // Its own block: a recording about the whole wall is not an observation with
  // a location, and filing it under a mark it was never attached to would put
  // words in somebody's mouth about the wrong part of the room.
  const spoken = room.walls
    .map((wall) => ({ wallId: wall.id, said: notesOnWall(voice, wall.id).map(whatWasSaid) }))
    .filter((wall) => wall.said.length > 0);
  const outLoud =
    spoken.length === 0
      ? []
      : [
          '',
          RULE,
          'SAID ABOUT THESE WALLS',
          'Recorded on site. Anything marked as written by the phone',
          'has not been read by a person yet.',
          RULE,
          '',
          ...spoken.flatMap((wall) => [
            `${wall.wallId}`,
            ...wall.said.map((line) => `   ${line}`),
            '',
          ]),
        ];

  return {
    title,
    lines,
    marks,
    text: [...header, ...body, ...footer, ...onTheWalls, ...outLoud].join('\n'),
  };
}

/**
 * Every mark, in the order the plan numbers the walls.
 *
 * Wall order rather than the order they were recorded in, because somebody
 * reading this is walking the room: they want everything about the north wall
 * while they are standing at it, not in the order they happened to notice
 * things across two visits.
 *
 * A mark on a wall this room does not have is left out rather than printed. That
 * cannot happen through the app — the reducer refuses it — and a sheet is the
 * wrong place to discover it if it ever does.
 */
function markedOn(
  room: Room,
  marks: readonly Mark[],
  voice: readonly VoiceNote[]
): FieldListMark[] {
  const order = new Map(room.walls.map((wall, at) => [wall.id, at]));
  const onAWall = marks.filter(
    (mark) => mark.shape.wallId !== undefined && order.has(mark.shape.wallId)
  );
  // And then the ceiling's, which have no place in the wall order because they
  // have no place at all -- a ceiling has no corner to hook a tape in, so a
  // mark on it says how much of the ceiling and never where on it. See the
  // note at the top of `damage.ts`.
  //
  // They were missing entirely, and this is the one sheet where that costs
  // something: on a claim a ceiling mark is on the claim document and on the
  // scope, but on an ordinary remodel the field sheet is the ONLY place a
  // condition note goes, so a note about the ceiling went nowhere at all.
  //
  // Last rather than interleaved, because somebody walking a room reads the
  // walls standing at each one, and then looks up.
  const onTheCeiling = marks.filter(
    (mark) =>
      (mark.shape.kind === 'surface' && mark.shape.surface === 'ceiling') ||
      (mark.shape.kind === 'pin' && mark.shape.on === 'ceiling')
  );

  const ceilingSaysSo = (mark: Mark) =>
    (mark.shape.kind === 'surface' && mark.shape.surface === 'ceiling') ||
    (mark.shape.kind === 'pin' && mark.shape.on === 'ceiling');

  return [
    ...onAWall
      .slice()
      .sort((a, b) => {
        const at = (mark: Mark) => order.get(mark.shape.wallId!)!;
        return at(a) === at(b) ? a.id.localeCompare(b.id) : at(a) - at(b);
      }),
    ...onTheCeiling.slice().sort((a, b) => a.id.localeCompare(b.id)),
  ]
    .map((mark) => ({
      markId: mark.id,
      wallId: ceilingSaysSo(mark) ? 'the ceiling' : mark.shape.wallId!,
      what: markWord(mark.kind),
      // The workings, which say where along the wall and how high — and never
      // an area. `damageQuantity` is asked rather than the geometry re-derived
      // here, because two derivations of one thing is two chances to disagree.
      where: damageQuantity(room, mark).workings,
      note: mark.note,
      said: notesOnMark(voice, mark.id).map(whatWasSaid),
    }));
}
