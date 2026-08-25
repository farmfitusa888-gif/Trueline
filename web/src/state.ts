import { formatFeetInches, fromJSON, parseLength } from '../../core/src/length.ts';
import { scanned, verified } from '../../core/src/measurement.ts';
import { type TracedCorner, roomFromCorners } from '../../core/src/trace.ts';
import type { Room } from '../../core/src/room.ts';
import type { ImportReport } from '../../core/src/import-roomplan.ts';
import { importRoomPlan } from '../../core/src/import-roomplan.ts';
import type { Footprint } from '../../core/src/obstruction.ts';
import {
  makeCased,
  makeOpen,
  makeWall,
  setRoomThickness,
  setWallThickness,
  verifyCeiling,
  addOpening,
  removeOpening,
  verifyOpening,
  verifyWall,
  adjustWall,
  deleteWall,
  notchCorner,
  renameRoom,
  renameWall,
  splitWall,
  unverifyWall,
} from '../../core/src/edit.ts';
import { type SavedProject, loadProject, saveProject } from '../../core/src/persist.ts';
import {
  type NorthOnPlan,
  type PhotoImport,
  type PhotoManifest,
  type RoomFrame,
  importPhotos,
  northOnPlan,
} from '../../core/src/capture.ts';
import type { Photo } from '../../core/src/photo.ts';
import type { Damage, Reading } from '../../core/src/damage.ts';
import { type PinImport, type PinManifest, importPins } from '../../core/src/pins.ts';
import { validateDamage } from '../../core/src/damage.ts';
import { type Claim, NO_CLAIM } from '../../core/src/claim.ts';
import { type Override, validateOverride } from '../../core/src/override.ts';
import { type Baseline } from '../../core/src/baseline.ts';
import { type Invoice } from '../../core/src/invoice.ts';
import { type Proposal } from '../../core/src/proposal.ts';
import { type Visit } from '../../core/src/schedule.ts';
import { handBack } from './bridge.ts';

/**
 * The frame a room has when it did not come out of a scan.
 *
 * A room drawn by hand or walked with AR has no scanner coordinate system to be
 * moved out of, so the datum is the identity, the origin is where the wall
 * chain starts, and the floor is at zero because there is nothing above or
 * below it to be measured from. Named rather than written out three times: the
 * three copies had already drifted once when `floor` was added.
 */
const NO_SCAN_FRAME: RoomFrame = {
  datum: { x: 1, y: 0 },
  origin: { x: 0n, y: 0n },
  floor: 0n,
};


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
 *
 * One thing does outlive the tab: the corrected room is written to
 * `localStorage` after every change, exactly, through `persist.ts`. Ten minutes
 * of correcting a scan on a tablet in a half-built kitchen must not be lost
 * because the phone rang. It is still not a backup — one browser, one device,
 * and clearing site data clears it — and the screen says so rather than implying
 * otherwise.
 */

/**
 * One saved room per capture, not one for the whole app.
 *
 * There was a single key. The native shell hands a capture over every time its
 * screen opens, so opening the kitchen wrote the kitchen over whatever was
 * saved, and opening the bathroom afterwards wrote the bathroom over the
 * kitchen's corrections. Somebody could lose ten minutes of typed tape readings
 * by navigating back and forward, and nothing said so.
 */
export const STORAGE_PREFIX = 'trueline.room.v1:';

export function keyFor(fileName: string): string {
  return STORAGE_PREFIX + fileName;
}

export interface Loaded {
  readonly room: Room;
  readonly report: ImportReport;
  readonly footprints: readonly Footprint[];
  /**
   * Photographs taken during the scan, each one knowing which walls it shows.
   * Empty for a scan opened from a file; full when the scanner in this app
   * handed the room over.
   */
  readonly photos: readonly Photo[];
  /** Photographs the import would not place, so the screen can say which and why. */
  readonly rejectedPhotos: PhotoImport['rejected'];
  /**
   * Pins marked during the walk that could not be placed, and why.
   *
   * Kept beside the room rather than shown once and forgotten. A refusal here
   * is a thing somebody stood in front of and pointed at which is not on the
   * claim, and the screen that lists what the import decided has to be able to
   * say so every time it is opened, not only on the first render.
   */
  readonly refusedPins: PinImport['refused'];
  /** Which way north points, when the phone's compass was worth believing. */
  readonly north: NorthOnPlan | null;
  /** The coordinate frame the room came in on, so more photos can be placed later. */
  readonly frame: RoomFrame;
  /**
   * What is wrong with this room, and whose claim it is.
   *
   * Kept beside the room rather than inside it, and that is the point: a room
   * is a measurement of a building and a damage is an observation about part of
   * it. Correcting a wall must not disturb what somebody marked, and marking
   * damage must not touch a dimension.
   */
  readonly damages: readonly Damage[];
  /**
   * Quantities somebody typed over, and why.
   *
   * Kept beside the room rather than in it, exactly as damage is: the room is a
   * measurement of a building and an override is a decision about what to
   * order. Correcting a wall must not disturb a waste factor, and changing a
   * waste factor must not touch a measurement.
   */
  readonly overrides: readonly Override[];
  readonly claim: Claim;
  /**
   * The document a client says yes to, once one has been written.
   *
   * Beside the room, like the claim and the overrides, and for the same
   * reason: a proposal is an offer about a building, not a property of one.
   * Re-measuring a wall must not silently rewrite an offer somebody is holding.
   */
  readonly proposal: Proposal | null;
  /**
   * What was signed, frozen.
   *
   * Never edited by anything. Every later difference between the room and this
   * is a change order, which is the entire point of keeping it.
   */
  readonly baseline: Baseline | null;
  /** When the work happens. Beside the room, like everything else about a job. */
  readonly visits: readonly Visit[];
  /** What has been asked for, in the order it was asked. */
  readonly invoices: readonly Invoice[];
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
  | { type: 'open'; json: unknown; fileName: string; at: string; photos?: unknown; pins?: unknown }
  /**
   * Bring a saved room back.
   *
   * `force` is for somebody choosing a different room from the floor screen —
   * an explicit "open that one" rather than the automatic restore at start-up,
   * which must never replace a capture the app has just handed over.
   */
  | { type: 'restore'; fileName?: string; force?: boolean }
  | { type: 'openTrace'; trace: unknown; fileName: string; at: string }
  /** A room typed in wall by wall, with no scan behind it at all. */
  | { type: 'openDrawn'; room: Room; fileName: string }
  /**
   * A corrected room the app kept, handed straight over.
   *
   * The app writes every save into the scan's own folder, so on a second
   * device — or after this web view's storage has been cleared — the
   * corrections come back from there rather than from a browser cache that may
   * no longer exist.
   */
  | { type: 'openSaved'; project: string }
  | { type: 'select'; wallId: string | null }
  | { type: 'make'; wallId: string; as: 'wall' | 'open' | 'cased' }
  | { type: 'verify'; wallId: string; text: string; by: string; at: string }
  /**
   * How thick the walls are. `wallId: null` means the whole room; a wall id
   * means that wall only. `text: null` takes a wall's override off again.
   *
   * `how` is not decoration. A thickness somebody taped through a doorway and a
   * thickness somebody assumed off the framing are different claims, and the
   * takeoff prints which one it is running on.
   */
  | {
      type: 'thickness';
      wallId: string | null;
      text: string | null;
      how: 'stated' | 'tape' | 'plans';
      by: string;
      at: string;
    }
  /**
   * A door or a window somebody measured. One field at a time, because that is
   * how somebody with a tape works: the width, then the height, then the sill.
   */
  | {
      type: 'opening';
      wallId: string;
      openingId: string;
      field: 'width' | 'height' | 'sillHeight' | 'offsetFromStart';
      text: string;
      by: string;
      at: string;
    }
  /** Somebody measured the ceiling, or said what it is. */
  | { type: 'ceiling'; text: string; how: 'stated' | 'tape'; by: string; at: string }
  /**
   * A door or window put in by hand, or taken out.
   *
   * A room drawn by hand has no openings at all, and a scanned room is
   * routinely missing one — a door standing open against a wall is regularly
   * not in the capture.
   */
  | {
      type: 'addOpening';
      wallId: string;
      kind: 'door' | 'window' | 'cased';
      width: string;
      height: string;
      offsetFromStart: string;
      sillHeight?: string;
      by: string;
      at: string;
    }
  | { type: 'removeOpening'; wallId: string; openingId: string }
  /**
   * Marking what is wrong with the room.
   *
   * A damage is an observation about part of a building, kept beside the room
   * rather than inside it. Marking one moves no wall and changes no dimension,
   * and correcting a wall leaves every mark exactly where it was.
   */
  | { type: 'mark'; damage: Damage }
  | { type: 'unmark'; damageId: string }
  /** A cut height decided, or taken off again. Seen and decided stay apart. */
  | { type: 'cutTo'; damageId: string; text: string | null }
  | { type: 'reading'; damageId: string; reading: Reading }
  | { type: 'damagePhotos'; damageId: string; photos: readonly string[] }
  | { type: 'override'; override: Override }
  | { type: 'clearOverride'; item: string; unit: Override['unit'] }
  | { type: 'renameRoom'; name: string }
  | { type: 'renameWall'; wallId: string; name: string }
  | { type: 'drag'; wallId: string; text: string; by: string; at: string }
  | { type: 'unverify'; wallId: string }
  | { type: 'split'; wallId: string; at: string; newId: string; height: string; by: string; when: string }
  | { type: 'deleteWall'; wallId: string }
  | {
      type: 'notch';
      wallId: string;
      out: string;
      along: string;
      outId: string;
      alongId: string;
      by: string;
      at: string;
    }
  | { type: 'claim'; claim: Claim }
  | { type: 'proposal'; proposal: Proposal | null }
  | { type: 'baseline'; baseline: Baseline }
  | { type: 'visits'; visits: readonly Visit[] }
  | { type: 'invoices'; invoices: readonly Invoice[] }
  | { type: 'undo' }
  | { type: 'dismissError' }
  | { type: 'close' };

/** What each field is called in the line under the plan. */
const SAID: Record<'width' | 'height' | 'sillHeight' | 'offsetFromStart', string> = {
  width: 'width',
  height: 'height',
  sillHeight: 'sill height',
  offsetFromStart: 'distance from the corner',
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A saved-at stamp as a person reads it, or nothing rather than a raw one. */
function when(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? 'earlier' : at.toLocaleString();
}

/**
 * A saved project turned back into what the screen holds.
 *
 * Shared by the two ways one arrives — read out of this browser's storage, or
 * handed over by the app that kept it — because a room that came back from the
 * app must be exactly the room that came back from storage. Two readers of one
 * format is two readers that will eventually disagree.
 */
function restored(saved: SavedProject, note: string): State {
  const extras = saved.extras as {
    report?: ImportReport;
    footprints?: readonly Footprint[];
    photos?: readonly Photo[];
    frame?: RoomFrame;
    north?: NorthOnPlan;
    damages?: readonly Damage[];
    overrides?: readonly Override[];
    claim?: Claim;
    proposal?: Proposal;
    baseline?: Baseline;
    visits?: readonly Visit[];
    invoices?: readonly Invoice[];
  };
  if (!extras.report) throw new Error('That saved room has no import report with it.');
  return {
    selected: null,
    error: null,
    loaded: {
      room: saved.room,
      report: extras.report,
      footprints: extras.footprints ?? [],
      photos: extras.photos ?? [],
      rejectedPhotos: [],
      refusedPins: [],
      north: (extras.north as NorthOnPlan | undefined) ?? null,
      frame: extras.frame ?? NO_SCAN_FRAME,
      damages: extras.damages ?? [],
      overrides: extras.overrides ?? [],
      claim: extras.claim ?? NO_CLAIM,
      proposal: extras.proposal ?? null,
      baseline: extras.baseline ?? null,
      visits: extras.visits ?? [],
      invoices: extras.invoices ?? [],
      undo: [],
      lastEdit: note,
      fileName: saved.fileName,
    },
  };
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
      // A capture the native app re-hands us may already have been corrected.
      // Those corrections outrank a pristine re-import of the same scan.
      const kept = reduce(state, { type: 'restore', fileName: action.fileName });
      if (kept.loaded) return kept;

      try {
        const { room, report, footprints, frame } = importRoomPlan(action.json as never, {
          at: action.at,
          // What the capture was called beats RoomPlan's guess at what kind of
          // room it is, which is often nothing at all.
          name: action.fileName,
        });

        // Photographs are optional: a scan dropped in from a file has none, and
        // one handed over by the scanner in this app has hundreds. Either way a
        // photo that will not place is named rather than dropped.
        // A handful of refused photographs is normal — the first frames of a
        // scan are taken while the phone is still pointed at the floor. That is
        // a line in the findings list, not a red panel across the top of the
        // screen: an alarm that fires on every scan teaches people to close
        // alarms. Only a manifest that will not read at all is an error.
        let photos: readonly Photo[] = [];
        let rejectedPhotos: PhotoImport['rejected'] = [];
        let north: NorthOnPlan | null = null;
        let photoTrouble: string | null = null;
        if (action.photos) {
          const manifest = action.photos as PhotoManifest;
          try {
            const imported = importPhotos(manifest, frame);
            photos = imported.photos;
            rejectedPhotos = imported.rejected;
          } catch (error) {
            photoTrouble = message(error);
          }
          // The compass is separate from the photographs on purpose: a manifest
          // that will not place a single picture can still know which way the
          // room faces, and losing the arrow with them would be a shame.
          if (manifest.north) north = northOnPlan(manifest.north, frame.datum);
        }

        // What somebody pointed at while walking the room. Read the same way
        // photographs are and refused the same way: a pin that cannot be
        // placed is named rather than dropped, because a refusal here is
        // somebody's evidence not reaching the claim.
        let damages: Damage[] = [];
        let refusedPins: PinImport['refused'] = [];
        if (action.pins) {
          try {
            const marked = importPins(action.pins as PinManifest, frame, room);
            damages = [...marked.pins];
            refusedPins = marked.refused;
          } catch (error) {
            // The room is still perfectly good without them, and losing a
            // whole scan because a pin file is from another version would be
            // the wrong trade. Said out loud rather than swallowed.
            photoTrouble = photoTrouble
              ? `${photoTrouble} ${message(error)}`
              : message(error);
          }
        }

        return {
          selected: null,
          error: photoTrouble,
          loaded: {
            room,
            report,
            footprints,
            photos,
            rejectedPhotos,
            north,
            frame,
            damages,
            refusedPins,
            overrides: [],
            claim: NO_CLAIM,
            proposal: null,
            baseline: null,
            visits: [],
            invoices: [],
            undo: [],
            lastEdit: null,
            fileName: action.fileName,
          },
        };
      } catch (error) {
        // Whatever was on screen stays on screen, so say which room the person
        // is actually looking at. Silently leaving yesterday's kitchen up under
        // a red banner means measuring the wrong room.
        return {
          ...state,
          error: state.loaded
            ? `"${action.fileName}" could not be opened: ${message(error)}\n\n` +
              `You are still looking at "${state.loaded.fileName}". Nothing from the new ` +
              `capture was used.`
            : message(error),
        };
      }
    }

    // A room somebody walked with AR, or traced off a drawing. Different hands,
    // different sensors, same room from here on: the same plan, the same solver,
    // the same refusal to be issued until a tape has been on it.
    case 'openTrace': {
      try {
        const payload = action.trace as {
          corners?: readonly TracedCorner[];
          closingRetap?: boolean;
          source?: 'ar' | 'plan';
          tolerance?: string;
        };
        if (!payload?.corners) throw new Error('That trace has no corners in it.');

        const { room, report } = roomFromCorners(payload.corners, {
          name: action.fileName,
          at: action.at,
          source: payload.source ?? 'ar',
          ceilingHeight: scanned(parseLength(`8'`), parseLength(`6"`), action.at, 'assumed'),
          ...(payload.closingRetap ? { closingRetap: true } : {}),
          ...(payload.tolerance ? { tolerance: fromJSON(payload.tolerance) } : {}),
        });

        return {
          selected: null,
          error: null,
          loaded: {
            room,
            // A walked room has no importer report, so it carries an empty one
            // rather than a fabricated one: nothing was dropped, nothing was
            // straightened off a polygon, because there was no polygon.
            report: {
              sourceVersion: undefined,
              walls: room.walls.map((w) => w.id),
              openSpans: [],
              dropped: [],
              snapped: [],
              diagonals: report.diagonals,
              closureBeforeSolving: report.closureBeforeSolving,
              openings: [],
              recoveredSills: [],
              sourceIds: [],
              notes: report.notes,
            },
            footprints: [],
            photos: [],
            rejectedPhotos: [],
            refusedPins: [],
            north: null,
            frame: NO_SCAN_FRAME,
            damages: [],
            overrides: [],
            claim: NO_CLAIM,
            proposal: null,
            baseline: null,
            visits: [],
            invoices: [],
            undo: [],
            lastEdit: null,
            fileName: action.fileName,
          },
        };
      } catch (error) {
        return { ...state, error: message(error) };
      }
    }

    // A room somebody typed. Every wall in it is already measured — there was
    // never a sensor to disagree with — so it arrives with an empty import
    // report rather than a fabricated one: nothing was dropped, nothing was
    // straightened off a polygon, because there was no polygon.
    case 'openDrawn': {
      return {
        selected: null,
        error: null,
        loaded: {
          room: action.room,
          report: {
            sourceVersion: undefined,
            walls: action.room.walls.map((w) => w.id),
            openSpans: [],
            dropped: [],
            snapped: [],
            diagonals: [],
            closureBeforeSolving: { x: 0n, y: 0n },
            openings: [],
            recoveredSills: [],
            sourceIds: [],
            notes: [
              'Typed by hand rather than scanned. Every length here was measured by a person, ' +
                'and the last wall was worked out from the others rather than measured.',
            ],
          },
          footprints: [],
          photos: [],
          rejectedPhotos: [],
          refusedPins: [],
          north: null,
          frame: NO_SCAN_FRAME,
          damages: [],
          overrides: [],
          claim: NO_CLAIM,
          proposal: null,
          baseline: null,
          visits: [],
          invoices: [],
          undo: [],
          lastEdit: null,
          fileName: action.fileName,
        },
      };
    }

    case 'openSaved': {
      try {
        return restored(loadProject(action.project), 'Picked up from this device.');
      } catch (error) {
        return { ...state, error: message(error) };
      }
    }

    case 'restore': {
      // A room already on screen always outranks storage — unless somebody has
      // just asked for a different one by name. Without this, the restore
      // dispatched at mount could land after a capture handed over by the app
      // and quietly replace it with yesterday's room.
      if (state.loaded && !action.force) return state;

      // Storage can be unavailable outright — a private window, a browser with
      // site data switched off — so reading it is as fallible as parsing it.
      let text: string | null = null;
      try {
        text = window.localStorage.getItem(
          action.fileName === undefined ? STORAGE_PREFIX : keyFor(action.fileName)
        );
      } catch {
        return state;
      }
      if (text === null) return state;
      try {
        const saved = loadProject(text);
        return restored(saved, `Picked up where you left off — saved ${when(saved.savedAt)}.`);
      } catch (error) {
        // A saved room that will not load is cleared rather than left to fail on
        // every visit, and the reason is shown once.
        try {
          if (action.fileName !== undefined) window.localStorage.removeItem(keyFor(action.fileName));
        } catch {
          // Nothing more to do; the message below is still worth showing.
        }
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

    /* -------------------------------------------------------- typed over */

    case 'override': {
      const loaded = state.loaded;
      if (!loaded) return state;
      try {
        validateOverride(action.override);
        const rest = loaded.overrides.filter(
          (o) => !(o.item === action.override.item && o.unit === action.override.unit)
        );
        return {
          ...state,
          error: null,
          loaded: {
            ...loaded,
            overrides: [...rest, action.override],
            lastEdit:
              `${action.override.item}: pricing ${action.override.quantity} ${action.override.unit}. ` +
              `What the room measures is still on the sheet beside it.`,
          },
        };
      } catch (error) {
        return { ...state, error: message(error) };
      }
    }

    case 'clearOverride': {
      const loaded = state.loaded;
      if (!loaded) return state;
      return {
        ...state,
        error: null,
        loaded: {
          ...loaded,
          overrides: loaded.overrides.filter(
            (o) => !(o.item === action.item && o.unit === action.unit)
          ),
          lastEdit: `${action.item} is back to what the room measures.`,
        },
      };
    }

    /* ------------------------------------------------------------- names */

    case 'renameRoom': {
      const loaded = state.loaded;
      if (!loaded) return state;
      try {
        const room = renameRoom(loaded.room, action.name);
        return edited(state, loaded, room, `This room is called "${room.name}" now.`);
      } catch (error) {
        return { ...state, error: message(error) };
      }
    }

    case 'renameWall': {
      const loaded = state.loaded;
      if (!loaded) return state;
      try {
        const room = renameWall(loaded.room, action.wallId, action.name);
        const to = action.name.trim();
        // Everything pointing at the old id has to move with it. Damage marks
        // name a wall, and a mark left pointing at a wall that no longer exists
        // is a mark that vanishes off the plan and off the claim — silently,
        // which is the worst way for evidence to go.
        const damages = loaded.damages.map((damage) => {
          const shape = damage.shape;
          if (shape.kind === 'pin' && shape.wallId === action.wallId) {
            return { ...damage, shape: { ...shape, wallId: to } };
          }
          if (shape.kind === 'patch' && shape.wallId === action.wallId) {
            return { ...damage, shape: { ...shape, wallId: to } };
          }
          if (shape.kind === 'surface' && shape.wallId === action.wallId) {
            return { ...damage, shape: { ...shape, wallId: to } };
          }
          return damage;
        });
        const next = edited(state, loaded, room, `That wall is called "${to}" now.`);
        return next.loaded
          ? {
              ...next,
              selected: state.selected === action.wallId ? to : state.selected,
              loaded: { ...next.loaded, damages },
            }
          : next;
      } catch (error) {
        return { ...state, error: message(error) };
      }
    }

    /* --------------------------------------------- moved rather than measured */

    case 'drag': {
      const loaded = state.loaded;
      if (!loaded) return state;
      try {
        const length = parseLength(action.text, { defaultUnit: 'ft' });
        const { room, adjustments } = adjustWall(
          loaded.room,
          action.wallId,
          length,
          action.by,
          action.at
        );
        const moved = adjustments.filter((a) => a.by !== 0n);
        return edited(
          state,
          loaded,
          room,
          `${action.wallId} moved by hand — not measured, and the plan says so. ` +
            (moved.length === 0
              ? 'Nothing else had to move.'
              : `${moved.length} other wall${moved.length === 1 ? '' : 's'} moved to close the room.`)
        );
      } catch (error) {
        return { ...state, error: message(error) };
      }
    }

    case 'unverify': {
      const loaded = state.loaded;
      if (!loaded) return state;
      try {
        const room = unverifyWall(loaded.room, action.wallId);
        return edited(
          state,
          loaded,
          room,
          `Took the tape reading off ${action.wallId}. It is back to what it was before.`
        );
      } catch (error) {
        return { ...state, error: message(error) };
      }
    }

    /* ------------------------------------------------- adding and taking away */

    case 'split': {
      const loaded = state.loaded;
      if (!loaded) return state;
      try {
        const room = splitWall(
          loaded.room,
          action.wallId,
          parseLength(action.at, { defaultUnit: 'ft' }),
          action.newId,
          {
            height: verified(
              parseLength(action.height, { defaultUnit: 'ft' }),
              action.by,
              action.when,
              'tape'
            ),
          }
        );
        return edited(
          state,
          loaded,
          room,
          `${action.wallId} is two walls now — the second one is "${action.newId.trim()}".`
        );
      } catch (error) {
        return { ...state, error: message(error) };
      }
    }

    case 'deleteWall': {
      const loaded = state.loaded;
      if (!loaded) return state;
      try {
        const { room, adjustments } = deleteWall(loaded.room, action.wallId);
        const moved = adjustments.filter((a) => a.by !== 0n);
        // Damage marked on a wall that is gone goes with it. Leaving a mark
        // pointing at nothing would put a quantity on a claim that no wall in
        // the room can account for.
        const kept = loaded.damages.filter((damage) => {
          const shape = damage.shape;
          const on =
            shape.kind === 'pin' || shape.kind === 'patch' || shape.kind === 'surface'
              ? shape.wallId
              : undefined;
          return on !== action.wallId;
        });
        const lost = loaded.damages.length - kept.length;
        const next = edited(
          state,
          loaded,
          room,
          `${action.wallId} is gone. ` +
            (moved.length === 0
              ? 'Nothing else had to move.'
              : `${moved.map((a) => a.wallId).join(' and ')} moved to close the room back up.`) +
            (lost > 0 ? ` ${lost} mark${lost === 1 ? '' : 's'} on it went with it.` : '')
        );
        return next.loaded
          ? {
              ...next,
              selected: state.selected === action.wallId ? null : state.selected,
              loaded: { ...next.loaded, damages: kept },
            }
          : next;
      } catch (error) {
        return { ...state, error: message(error) };
      }
    }

    case 'notch': {
      const loaded = state.loaded;
      if (!loaded) return state;
      try {
        const { room, adjustments } = notchCorner(
          loaded.room,
          action.wallId,
          {
            out: parseLength(action.out, { defaultUnit: 'ft' }),
            along: parseLength(action.along, { defaultUnit: 'ft' }),
            outId: action.outId,
            alongId: action.alongId,
          },
          action.by,
          action.at,
          'tape'
        );
        const moved = adjustments.filter((a) => a.by !== 0n);
        return edited(
          state,
          loaded,
          room,
          `The corner after ${action.wallId} is a step now. ` +
            // A well-formed notch is paid for by the two walls it came out of,
            // so nothing else should move. If anything did, say so — it means
            // the room was not closing the way this assumed.
            (moved.length === 0
              ? 'The room is the same size — the step came out of the two walls beside it.'
              : `${moved.map((a) => a.wallId).join(' and ')} also moved.`)
        );
      } catch (error) {
        return { ...state, error: message(error) };
      }
    }

    case 'thickness': {
      const loaded = state.loaded;
      if (!loaded) return state;
      try {
        // Inches, not feet. Nobody says a wall is "four and a half feet thick",
        // and a bare 4.5 here meaning feet would be a four-and-a-half-foot wall
        // that nothing downstream would question.
        const measure =
          action.text === null
            ? undefined
            : verified(
                parseLength(action.text, { defaultUnit: 'in' }),
                action.by,
                action.at,
                action.how
              );

        if (action.wallId === null) {
          if (measure === undefined) return state;
          return edited(
            state,
            loaded,
            setRoomThickness(loaded.room, measure),
            `Walls are ${formatFeetInches(measure.value)} thick.`
          );
        }
        return edited(
          state,
          loaded,
          setWallThickness(loaded.room, action.wallId, measure),
          measure === undefined
            ? `${action.wallId} is back to the room's thickness.`
            : `${action.wallId} is ${formatFeetInches(measure.value)} thick.`
        );
      } catch (error) {
        return { ...state, error: message(error) };
      }
    }

    // A door or a window somebody put a tape on. No wall moves: an opening is a
    // hole in a wall, not a side of the building, and the closure sum has never
    // known it was there.
    case 'opening': {
      const loaded = state.loaded;
      if (!loaded) return state;
      try {
        const length = parseLength(action.text, { defaultUnit: 'ft' });
        const next = verifyOpening(
          loaded.room,
          action.wallId,
          action.openingId,
          { [action.field]: length },
          action.by,
          action.at,
          'tape'
        );
        return edited(
          state,
          loaded,
          next,
          `${action.openingId} in ${action.wallId}: ${SAID[action.field]} is ` +
            `${formatFeetInches(length)}.`
        );
      } catch (error) {
        return { ...state, error: message(error) };
      }
    }

    case 'ceiling': {
      const loaded = state.loaded;
      if (!loaded) return state;
      try {
        const height = parseLength(action.text, { defaultUnit: 'ft' });
        return edited(
          state,
          loaded,
          verifyCeiling(loaded.room, height, action.by, action.at, action.how),
          `Ceiling is ${formatFeetInches(height)}. Every square foot of board follows it.`
        );
      } catch (error) {
        return { ...state, error: message(error) };
      }
    }

    case 'addOpening': {
      const loaded = state.loaded;
      if (!loaded) return state;
      try {
        const feet = (text: string) => parseLength(text, { defaultUnit: 'ft' });
        const wall = loaded.room.walls.find((w) => w.id === action.wallId);
        const count = (wall?.openings ?? []).length + 1;
        const next = addOpening(
          loaded.room,
          action.wallId,
          {
            id: `${action.wallId}-${action.kind}-${count}`,
            kind: action.kind,
            width: feet(action.width),
            height: feet(action.height),
            offsetFromStart: feet(action.offsetFromStart),
            ...(action.sillHeight ? { sillHeight: feet(action.sillHeight) } : {}),
          },
          action.by,
          action.at
        );
        return edited(state, loaded, next, `Put a ${action.kind} in ${action.wallId}.`);
      } catch (error) {
        return { ...state, error: message(error) };
      }
    }

    case 'removeOpening': {
      const loaded = state.loaded;
      if (!loaded) return state;
      try {
        return edited(
          state,
          loaded,
          removeOpening(loaded.room, action.wallId, action.openingId),
          `Took ${action.openingId} out of ${action.wallId}.`
        );
      } catch (error) {
        return { ...state, error: message(error) };
      }
    }

    case 'mark': {
      const loaded = state.loaded;
      if (!loaded) return state;
      try {
        // Checked against the room before it is kept. A mark that runs off the
        // end of its wall is not a small error: every quantity clips it
        // silently, and the claim comes out short on a wall the damage is not
        // even on.
        validateDamage(loaded.room, action.damage);
        return {
          ...state,
          error: null,
          loaded: {
            ...loaded,
            damages: [...loaded.damages.filter((d) => d.id !== action.damage.id), action.damage],
            lastEdit: `Marked ${action.damage.kind} damage.`,
          },
        };
      } catch (error) {
        return { ...state, error: message(error) };
      }
    }

    case 'unmark': {
      const loaded = state.loaded;
      if (!loaded) return state;
      return {
        ...state,
        error: null,
        loaded: {
          ...loaded,
          damages: loaded.damages.filter((d) => d.id !== action.damageId),
          lastEdit: 'Took a mark off.',
        },
      };
    }

    case 'cutTo': {
      const loaded = state.loaded;
      if (!loaded) return state;
      try {
        const damage = loaded.damages.find((d) => d.id === action.damageId);
        if (!damage) return state;
        const { cutTo: _was, ...bare } = damage;
        const next: Damage =
          action.text === null
            ? bare
            : { ...damage, cutTo: parseLength(action.text, { defaultUnit: 'ft' }) };
        validateDamage(loaded.room, next);
        return {
          ...state,
          error: null,
          loaded: {
            ...loaded,
            damages: loaded.damages.map((d) => (d.id === next.id ? next : d)),
            lastEdit:
              action.text === null
                ? 'Back to the damage as it was seen.'
                : `Cutting to ${formatFeetInches(next.cutTo!)}.`,
          },
        };
      } catch (error) {
        return { ...state, error: message(error) };
      }
    }

    case 'reading': {
      const loaded = state.loaded;
      if (!loaded) return state;
      return {
        ...state,
        error: null,
        loaded: {
          ...loaded,
          damages: loaded.damages.map((d) =>
            d.id === action.damageId ? { ...d, readings: [...d.readings, action.reading] } : d
          ),
          lastEdit: `Logged ${action.reading.value} ${action.reading.scale}.`,
        },
      };
    }

    case 'damagePhotos': {
      const loaded = state.loaded;
      if (!loaded) return state;
      const before = loaded.damages.find((d) => d.id === action.damageId)?.photos.length ?? 0;
      const after = action.photos.length;
      return {
        ...state,
        error: null,
        loaded: {
          ...loaded,
          damages: loaded.damages.map((d) =>
            d.id === action.damageId ? { ...d, photos: [...action.photos] } : d
          ),
          lastEdit:
            after > before
              ? `Photographed the damage — ${after} on this mark now.`
              : `Took a photograph off. ${after} left on this mark.`,
        },
      };
    }

    case 'claim':
      return state.loaded
        ? { ...state, loaded: { ...state.loaded, claim: action.claim } }
        : state;

    case 'proposal':
      return state.loaded
        ? { ...state, loaded: { ...state.loaded, proposal: action.proposal } }
        : state;

    // A baseline is written once and never edited, so there is no action that
    // changes one. Re-signing produces a new baseline; the old one is replaced
    // wholesale rather than amended, and what it agreed to stays inside it.
    case 'baseline':
      return state.loaded
        ? { ...state, loaded: { ...state.loaded, baseline: action.baseline } }
        : state;

    case 'visits':
      return state.loaded
        ? { ...state, loaded: { ...state.loaded, visits: action.visits } }
        : state;

    // Invoices are appended, never edited: an invoice that has been sent and
    // then quietly changed is the thing an invoice exists to prevent.
    case 'invoices':
      return state.loaded
        ? { ...state, loaded: { ...state.loaded, invoices: action.invoices } }
        : state;

    case 'undo': {
      const loaded = state.loaded;
      if (!loaded || loaded.undo.length === 0) return state;
      const previous = loaded.undo[loaded.undo.length - 1]!;
      return {
        ...state,
        error: null,
        // The wall that was selected may not exist in the room being restored.
        selected: previous.walls.some((w) => w.id === state.selected) ? state.selected : null,
        loaded: { ...loaded, room: previous, undo: loaded.undo.slice(0, -1), lastEdit: 'Undone.' },
      };
    }

    case 'dismissError':
      return { ...state, error: null };

    // Put this room down and pick up another. **It does not delete it.**
    //
    // It used to. Closing a room removed it from storage, which made sense for
    // exactly as long as there was only ever one room: "close" meant "I am done
    // with this scan". It stopped making sense the moment corrections were
    // worth keeping, and it became actively wrong when rooms started being the
    // material a floor is made of — tapping "Open another" threw away every
    // tape reading somebody had typed, silently, with no way back.
    //
    // Deleting a scan is a deliberate act and it belongs where it already is:
    // swiping it off the list in the app that owns the folder.
    case 'close':
      return EMPTY;
  }
}

/**
 * Writes the room to storage, or says why it could not.
 *
 * Returns a message rather than throwing, because a full disk must not take the
 * screen down — but it must not be silent either. Somebody who thinks their work
 * is saved and finds it gone has been lied to.
 */
export function persist(loaded: Loaded, at: string): string | null {
  try {
    const project = saveProject({
      savedAt: at,
      fileName: loaded.fileName,
      room: loaded.room,
      extras: {
        report: loaded.report,
        footprints: loaded.footprints,
        photos: loaded.photos,
        frame: loaded.frame,
        north: loaded.north,
        damages: loaded.damages,
        claim: loaded.claim,
        proposal: loaded.proposal,
        baseline: loaded.baseline,
        visits: loaded.visits,
        invoices: loaded.invoices,
        overrides: loaded.overrides,
      },
    });
    // The app first, and in its own right. It writes the room into the scan's
    // own folder and into the owner's iCloud, and it is the copy that survives
    // this web view being cleared. Doing it after `localStorage` would mean a
    // full browser store — the one failure this whole function exists to report
    // — also silently skipped the durable copy.
    handBack(loaded.fileName, project);

    window.localStorage.setItem(keyFor(loaded.fileName), project);
    return null;
  } catch (error) {
    return (
      `This room could not be saved in the browser, so it will be gone if you close the tab: ` +
      `${message(error)}`
    );
  }
}
