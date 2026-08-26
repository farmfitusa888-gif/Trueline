import { type Nanometres, formatFeetInches } from './length.ts';
import { wallNear } from './pins.ts';
import { type Point, type Room, RoomError } from './room.ts';

/**
 * A hidden condition, pinned where it actually is.
 *
 * ## The photograph nobody can find again
 *
 * Every remodeler's phone holds a picture of an open wall: where the joists
 * run, where the stack comes down, the knob-and-tube behind the closet, the
 * shut-off nobody could find for two hours. Those pictures are worth money --
 * the next trade needs them, the next job in the same house needs them, and a
 * dispute about what was there before needs them most of all.
 *
 * And they are in a camera roll among four thousand others, filed by nothing.
 * By the time anybody wants one, finding it costs more than the thing it would
 * have saved, so nobody looks.
 *
 * A tag is that picture with a place attached. Point at the stack, say what it
 * is, and it is on the drawing at the spot for as long as the drawing exists.
 *
 * ## Not damage, deliberately
 *
 * This looks almost exactly like `damage.ts`'s pin and it is a separate type on
 * purpose. A damage pin belongs to a claim: it is a thing that is wrong, it is
 * evidence, and it goes to an adjuster. A tag is a thing that is simply *there*
 * -- a joist is not a problem -- and it must never appear in a claim's damage
 * list or be totalled with anything.
 *
 * Merging them would save a hundred lines and would eventually put "2x10 joists
 * at 16 in centres" in front of an insurer as a reported loss.
 *
 * ## What it never does
 *
 * The same rule pins obey: **a tag produces no quantity.** It is a place, some
 * words and a photograph. Nothing here is ever added up, priced, or put on a
 * takeoff, because nobody measured it -- somebody pointed at it.
 */

/**
 * What kind of thing was found.
 *
 * These are the categories a contractor already sorts by when he is standing in
 * an open wall deciding who to call, which is the only reason to have
 * categories at all.
 */
export type Condition =
  | 'framing'
  | 'plumbing'
  | 'electrical'
  | 'hvac'
  | 'gas'
  | 'structure'
  | 'hazard'
  | 'access'
  | 'other';

export const CONDITIONS: readonly Condition[] = [
  'framing', 'plumbing', 'electrical', 'hvac', 'gas', 'structure', 'hazard', 'access', 'other',
];

/**
 * What each one is called on screen, and why it is worth pinning.
 *
 * The second half is not decoration. A category list with no reasons beside it
 * gets used as "other" for everything, and a tag filed under "other" is a
 * photograph in a camera roll again.
 */
export const CONDITION: Record<Condition, { readonly plain: string; readonly why: string }> = {
  framing: {
    plain: 'Framing',
    why: 'Which way the joists run and what is bearing. The next person opening this wall needs it.',
  },
  plumbing: {
    plain: 'Plumbing',
    why: 'Supply, waste, the stack, and the shut-off nobody could find last time.',
  },
  electrical: {
    plain: 'Electrical',
    why: 'What is in the wall and where it goes. Knob-and-tube found now is a change order, not a surprise.',
  },
  hvac: { plain: 'Heating and air', why: 'Ducts, returns and the runs that cannot be moved.' },
  gas: { plain: 'Gas', why: 'A line in a wall somebody is about to cut. Pin it before anybody forgets.' },
  structure: {
    plain: 'Structure',
    why: 'A post, a beam, a header — the things that decide whether a wall can come out at all.',
  },
  hazard: {
    plain: 'Hazard',
    why: 'Asbestos, lead, mould behind something. What has to be handled rather than demolished.',
  },
  access: {
    plain: 'Access',
    why: 'A panel, a crawl hatch, a clean-out. Worth finding once and never hunting for again.',
  },
  other: { plain: 'Other', why: 'Anything worth a photograph and a place to keep it.' },
};

export class TagError extends RoomError {}

/**
 * One thing found, where it was found.
 *
 * `wallId` when it is on or near a wall, which is most of the time. A stack in
 * the middle of a mechanical room has none, and that is a real answer rather
 * than a missing one.
 */
export interface Tag {
  readonly id: string;
  /**
   * What was found there — one thing or several.
   *
   * ## Why this is a list
   *
   * > "WHAT IF YOU FIND MORE THEN ONE OPTION, BUT CAN ONLY PICK ONE"
   *
   * Because an open wall is not one thing. A bay with 2x10 joists, a waste
   * stack and a run of Romex in it is normal, and the screen made you pick
   * which of the three to write down. Whichever you picked, the other two were
   * lost — and they cannot be gone back for, because the wall gets closed.
   *
   * Never empty: a tag that says nothing was found is a dot on a drawing, which
   * is the thing `tagAt` exists to refuse. Kept in `CONDITIONS` order and
   * deduplicated, so two tags listing the same three things read the same way
   * on every sheet.
   */
  readonly conditions: readonly Condition[];
  readonly at: Point;
  /** Above the finished floor, when it is known. */
  readonly height?: Nanometres;
  readonly wallId?: string;
  /** What the person said. Never generated, never summarised. */
  readonly note: string;
  /**
   * The photographs of it, by id.
   *
   * The reason the whole feature exists. A tag with no photograph is a note,
   * which is better than nothing; a tag with one is the thing that was actually
   * wanted, and it is why the walls being open matters -- the picture can only
   * be taken once.
   */
  readonly photos: readonly string[];
  readonly recordedAt: string;
  readonly recordedBy: string;
}

/**
 * Makes a tag, and refuses one that would be a dot on a drawing.
 *
 * The wall is worked out rather than asked for, by the same function pins use,
 * so a tag and a damage pin at the same spot agree about which wall they are
 * on. Two answers to that question is one too many.
 */
export function tagAt(
  room: Room,
  input: {
    readonly id: string;
    readonly conditions: readonly Condition[];
    readonly at: Point;
    readonly height?: Nanometres;
    readonly note: string;
    readonly photos?: readonly string[];
    readonly recordedAt: string;
    readonly recordedBy: string;
  }
): Tag {
  // In the list's own order and each one once, however they were ticked. The
  // order a person taps three buttons in is not information, and letting it
  // through would make two identical findings read differently on a sheet.
  const conditions = CONDITIONS.filter((c) => input.conditions.includes(c));
  if (conditions.length === 0) {
    throw new TagError(
      'A tag has to say what was found. Tick at least one — framing, plumbing, ' +
        'electrical, or whatever it actually was.'
    );
  }

  const note = input.note.trim();
  if (note === '') {
    throw new TagError(
      'A tag with nothing written on it is a dot on a drawing. Say what was found — ' +
        '"2x10 joists running east to west, 16 in centres".'
    );
  }
  if (input.height !== undefined && input.height < 0n) {
    throw new TagError(
      `That tag is ${formatFeetInches(-input.height)} below the floor, which is not somewhere ` +
        'anybody stood and pointed.'
    );
  }
  const near = wallNear(input.at, room);
  return {
    id: input.id,
    conditions,
    at: input.at,
    ...(input.height !== undefined ? { height: input.height } : {}),
    ...(near ?? {}),
    note,
    photos: input.photos ?? [],
    recordedAt: input.recordedAt,
    recordedBy: input.recordedBy,
  };
}

/** Everything found on one wall, oldest first — the order it was found in. */
export function tagsOnWall(tags: readonly Tag[], wallId: string): Tag[] {
  return tags
    .filter((tag) => tag.wallId === wallId)
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
}

/** Everything that belongs to no wall: the middle of the room. */
export function tagsInTheOpen(tags: readonly Tag[]): Tag[] {
  return tags.filter((tag) => tag.wallId === undefined);
}

/**
 * One tag in a sentence, for a list, a sheet, or a screen reader.
 *
 * Says where it is as well as what it is, because a list of nine tags all
 * reading "Electrical" is a list nobody can use — the same mistake the
 * dimension list made before the click-through found it.
 */
export function describeTag(tag: Tag): string {
  const where = tag.wallId ? ` on ${tag.wallId}` : ' in the open';
  const high = tag.height !== undefined ? `, ${formatFeetInches(tag.height)} up` : '';
  // "Framing + Plumbing + Electrical", because that is one opening in the wall
  // with three things in it, and listing them as three findings would read as
  // three places on the sheet.
  const what = tag.conditions.map((c) => CONDITION[c].plain).join(' + ');
  return `${what}${where}${high} — ${tag.note}`;
}

/**
 * What a room's tags add up to, which is deliberately not a number.
 *
 * There is no `tagQuantity`, no `tagTotals`, and no square feet anywhere in
 * this file. This is the only summary there is: how many things were found, and
 * of what kind. If a function is ever added here that returns an area or a
 * price, a gesture has been turned into a measurement and the product has
 * broken its one promise.
 */
export function tagCounts(tags: readonly Tag[]): { condition: Condition; count: number }[] {
  const counts = new Map<Condition, number>();
  // A tag listing three things counts once under each, so "how many walls have
  // plumbing in them" is answerable. It is still a count of findings and not of
  // anything measurable -- see the note above this function.
  for (const tag of tags) {
    for (const c of tag.conditions) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return CONDITIONS.filter((c) => counts.has(c)).map((condition) => ({
    condition,
    count: counts.get(condition)!,
  }));
}


/**
 * A tag out of a saved file, whichever version wrote it.
 *
 * Tags carried a single `condition` until 2026-08-26. Rooms saved before that
 * are on people's phones and in their iCloud, and a reader that only understood
 * the new shape would turn every one of them into a tag with no conditions at
 * all -- which `tagAt` correctly refuses, so the whole room would fail to open.
 * Somebody's morning of pinning what was behind a wall, gone because a field
 * was renamed.
 *
 * So both are read. The old one becomes a list of one, which is exactly what it
 * meant.
 */
export function readConditions(raw: unknown): readonly Condition[] {
  const source = raw as { conditions?: unknown; condition?: unknown };
  const listed = Array.isArray(source.conditions)
    ? source.conditions
    : source.condition !== undefined
      ? [source.condition]
      : [];
  return CONDITIONS.filter((c) => listed.includes(c));
}
