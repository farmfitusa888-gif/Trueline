import type { Room } from '../../core/src/room.ts';
import type { Damage } from '../../core/src/damage.ts';
import type { Floor, Join } from '../../core/src/floor.ts';
import { loadProject } from '../../core/src/persist.ts';
import { STORAGE_PREFIX } from './state.ts';

/**
 * Every room this device has, and how somebody said they fit together.
 *
 * The rooms are already there — each capture writes its corrected room to
 * storage under its own key, and has since per-capture storage was built. This
 * gathers them. What it adds is the joins, which are the only thing about a
 * floor that is not already known: **which door in one room is which door in
 * another**, said by a person, because nothing in two separate captures can
 * answer it.
 *
 * Joins are kept apart from the rooms on purpose. A room is a measurement of a
 * building and a join is a statement about two of them; correcting a wall must
 * not disturb how the floor is put together, and un-joining two rooms must not
 * touch either one's dimensions.
 */

const JOINS = 'trueline.floor.v1';

export interface SavedRoom {
  readonly fileName: string;
  readonly room: Room;
  readonly savedAt: string;
  /**
   * What is wrong with it, on a job that is a claim.
   *
   * Carried here because a claim covers a job and a job is several rooms, and
   * only one of them is open. Empty on every room nobody has marked, which is
   * every room on every remodel.
   */
  readonly damages: readonly Damage[];
}

/** Every corrected room in this browser's storage, newest first. */
export function savedRooms(): SavedRoom[] {
  const out: SavedRoom[] = [];
  let count = 0;
  try {
    count = window.localStorage.length;
  } catch {
    return out;
  }
  for (let i = 0; i < count; i += 1) {
    let key: string | null = null;
    try {
      key = window.localStorage.key(i);
    } catch {
      continue;
    }
    if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
    try {
      const text = window.localStorage.getItem(key);
      if (!text) continue;
      const saved = loadProject(text);
      const damages = (saved.extras as { damages?: readonly Damage[] }).damages ?? [];
      out.push({
        fileName: saved.fileName,
        room: saved.room,
        savedAt: saved.savedAt,
        damages,
      });
    } catch {
      // A room that will not load is one this build cannot read. It is skipped
      // here rather than taking the floor down — the screen that opens it will
      // say why.
    }
  }
  return out.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}

export function loadJoins(): Join[] {
  try {
    const text = window.localStorage.getItem(JOINS);
    if (!text) return [];
    const raw = JSON.parse(text) as Join[];
    // Shape-checked rather than trusted: a join naming a room that no longer
    // exists is dropped by `floorOf` below, but a join missing an end would
    // throw inside the layout.
    return raw.filter(
      (join) =>
        typeof join?.id === 'string' &&
        typeof join?.from?.roomId === 'string' &&
        typeof join?.from?.wallId === 'string' &&
        typeof join?.from?.openingId === 'string' &&
        typeof join?.to?.roomId === 'string' &&
        typeof join?.to?.wallId === 'string' &&
        typeof join?.to?.openingId === 'string'
    );
  } catch {
    return [];
  }
}

export function saveJoins(joins: readonly Join[]): void {
  try {
    window.localStorage.setItem(JOINS, JSON.stringify(joins));
  } catch {
    // The floor is a view of rooms that are themselves saved. Losing the joins
    // costs the arrangement, not the measurements.
  }
}

/**
 * The floor as `floor.ts` wants it, with anything stale left out.
 *
 * A join whose room has been deleted is dropped rather than throwing. Somebody
 * clearing an old scan should not find the floor screen refusing to open.
 */
export function floorOf(rooms: readonly SavedRoom[], joins: readonly Join[], name = 'This floor'): Floor {
  const have = new Set(rooms.map((r) => r.room.id));
  const stillThere = joins.filter((join) => have.has(join.from.roomId) && have.has(join.to.roomId));
  return {
    id: 'floor',
    name,
    rooms: rooms.map((r) => r.room),
    joins: stillThere,
  };
}

/** A join two taps have described. The id is stable, so re-joining replaces. */
export function joinBetween(
  a: { roomId: string; wallId: string; openingId: string },
  b: { roomId: string; wallId: string; openingId: string },
  by: string,
  at: string
): Join {
  return {
    id: `${a.roomId}:${a.openingId}|${b.roomId}:${b.openingId}`,
    declaredBy: by,
    declaredAt: at,
    from: a,
    to: b,
  };
}
