import { parseLength } from '../../core/src/length.ts';
import type { Room } from '../../core/src/room.ts';
import type { ImportReport } from '../../core/src/import-roomplan.ts';
import { importRoomPlan } from '../../core/src/import-roomplan.ts';
import type { Footprint } from '../../core/src/obstruction.ts';
import { makeCased, makeOpen, makeWall, verifyWall } from '../../core/src/edit.ts';

/**
 * All the state this screen has, and every way it can change.
 *
 * There is no store, no query cache and no server. A scan is a file somebody
 * drops on the page; the room lives in memory; every edit produces a whole new
 * room and pushes the old one onto a stack. Undo is popping the stack, which
 * means undo cannot be wrong — it is literally the room from before.
 *
 * The reducer is where the app touches `core`, and it is the only place. No
 * component computes a length, a heading or an area: they render what the model
 * says. That is the same rule the ledger has in Plumbline, for the same reason —
 * a number that gets recomputed in a component is a number that will disagree
 * with the one on the export.
 */

export interface Loaded {
  readonly room: Room;
  readonly report: ImportReport;
  readonly footprints: readonly Footprint[];
  /** Rooms as they were before each edit, most recent last. */
  readonly undo: readonly Room[];
  /** What the last edit did, for the line under the plan. */
  readonly lastEdit: string | null;
  readonly fileName: string;
}

export interface State {
  readonly loaded: Loaded | null;
  /** A refusal from the model, shown as it was written. Never rephrased here. */
  readonly error: string | null;
  readonly selected: string | null;
}

export const EMPTY: State = { loaded: null, error: null, selected: null };

export type Action =
  | { type: 'open'; json: unknown; fileName: string; at: string }
  | { type: 'select'; wallId: string | null }
  | { type: 'make'; wallId: string; as: 'wall' | 'open' | 'cased' }
  | { type: 'verify'; wallId: string; text: string; by: string; at: string }
  | { type: 'undo' }
  | { type: 'dismissError' }
  | { type: 'close' };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Applies an edit, keeping the room it started from so undo is exact. */
function edited(state: State, loaded: Loaded, next: Room, what: string): State {
  return {
    ...state,
    error: null,
    loaded: { ...loaded, room: next, undo: [...loaded.undo, loaded.room], lastEdit: what },
  };
}

export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'open': {
      try {
        const { room, report, footprints } = importRoomPlan(action.json as never, { at: action.at });
        return {
          selected: null,
          error: null,
          loaded: { room, report, footprints, undo: [], lastEdit: null, fileName: action.fileName },
        };
      } catch (error) {
        return { ...state, error: message(error) };
      }
    }

    case 'select':
      return { ...state, selected: action.wallId };

    case 'make': {
      const loaded = state.loaded;
      if (!loaded) return state;
      try {
        const next =
          action.as === 'wall'
            ? makeWall(loaded.room, action.wallId)
            : action.as === 'open'
              ? makeOpen(loaded.room, action.wallId)
              : makeCased(loaded.room, action.wallId);
        const still = next.walls.some((w) => w.id === action.wallId);
        return {
          ...edited(
            state,
            loaded,
            next,
            action.as === 'wall'
              ? `Made ${action.wallId} a wall.`
              : action.as === 'open'
                ? `Made ${action.wallId} an open span.`
                : `Made ${action.wallId} a cased opening.`
          ),
          // A merge can swallow the edge that was selected, so the selection has
          // to be dropped rather than left pointing at something that is gone.
          selected: still ? state.selected : null,
        };
      } catch (error) {
        return { ...state, error: message(error) };
      }
    }

    case 'verify': {
      const loaded = state.loaded;
      if (!loaded) return state;
      try {
        // Bare numbers mean feet, because that is what somebody standing in a
        // room says out loud. `parseLength` is the same parser the tests use.
        const length = parseLength(action.text, { defaultUnit: 'ft' });
        const { room, adjustments } = verifyWall(
          loaded.room,
          action.wallId,
          length,
          action.by,
          action.at,
          'laser'
        );
        const moved = adjustments.filter((a) => a.by !== 0n);
        const beyond = moved.filter((a) => a.beyondTolerance);
        const note =
          moved.length === 0
            ? `${action.wallId} measured. Nothing else had to move.`
            : `${action.wallId} measured. ${moved.length} other wall${moved.length === 1 ? '' : 's'} moved` +
              (beyond.length > 0
                ? `, and ${beyond.length} moved further than the scanner's own tolerance — worth a tape.`
                : '.');
        return edited(state, loaded, room, note);
      } catch (error) {
        return { ...state, error: message(error) };
      }
    }

    case 'undo': {
      const loaded = state.loaded;
      if (!loaded || loaded.undo.length === 0) return state;
      const previous = loaded.undo[loaded.undo.length - 1]!;
      return {
        ...state,
        error: null,
        loaded: { ...loaded, room: previous, undo: loaded.undo.slice(0, -1), lastEdit: 'Undone.' },
      };
    }

    case 'dismissError':
      return { ...state, error: null };

    case 'close':
      return EMPTY;
  }
}
