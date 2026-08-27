import { formatFeetInches, fromJSON, parseLength } from '../../core/src/length.ts';
import { scanned, verified } from '../../core/src/measurement.ts';
import { type TracedCorner, roomFromCorners } from '../../core/src/trace.ts';
import type { Point, Room } from '../../core/src/room.ts';
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
  setWallHeight,
  splitWall,
  unverifyWall,
} from '../../core/src/edit.ts';
import { type SavedProject, loadProject, saveProject } from '../../core/src/persist.ts';
import {
  type NorthOnPlan,
  type PhotoImport,
  type PhotoManifest,
  type RoomFrame,
  heightsAboveFloor,
  importPhotos,
  northOnPlan,
} from '../../core/src/capture.ts';
import type { Photo } from '../../core/src/photo.ts';
import type { Damage, Reading } from '../../core/src/damage.ts';
import { type VoiceNote, spokenLength, validateVoiceNote } from '../../core/src/voice.ts';
import { type PinImport, type PinManifest, importPins } from '../../core/src/pins.ts';
import { type Tag, CONDITION, readConditions, tagAt } from '../../core/src/tag.ts';
import { type Boundary, splitByBoundary } from '../../core/src/zone.ts';
import { validateDamage } from '../../core/src/damage.ts';
import { type Claim, NO_CLAIM } from '../../core/src/claim.ts';
import { type Override, validateOverride } from '../../core/src/override.ts';
import {
  type Surface,
  type WorkItem,
  type WorkScope,
  drop as dropWork,
  everything,
  nothing,
  pick as pickWork,
  surfaceName,
} from '../../core/src/work.ts';
import { type Baseline } from '../../core/src/baseline.ts';
import { type AgreedChange, type ChangeDocument } from '../../core/src/change.ts';
import { type Payment } from '../../core/src/payment.ts';
import { type Invoice } from '../../core/src/invoice.ts';
import { type Proposal } from '../../core/src/proposal.ts';
import { type SaleVenue } from '../../core/src/cooling.ts';
import { type ReturnedDocument } from '../../core/src/countersign.ts';
import { type Visit } from '../../core/src/schedule.ts';
import { type Keeping } from '../../core/src/entitlement.ts';
import { mayKeepRoomHere } from './entitlementStore.ts';
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
   * How high above the floor each photograph was taken.
   *
   * Not used by any geometry. It is the alarm that catches the worst thing
   * that can go wrong silently: the photographs and the walls ending up in
   * different coordinate systems, which draws everything somewhere plausible
   * and wrong. On both of Sam's real scans every frame lands between 0.8 m and
   * 2.0 m, which is a person holding a phone; a scan where they do not is a
   * scan nothing should be drawn from.
   *
   * `capture.ts` has been able to work this out since it was written and
   * nothing ever asked it to, so the alarm and its test both existed and the
   * alarm could never fire. Found by `core/tools/check-reachable.py`.
   */
  readonly cameraHeights: readonly bigint[];
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
   * What somebody said out loud about a wall, and what the phone made of it.
   *
   * Beside the room like the marks, and for the same reason: a recording is an
   * observation about a building, not a property of one. Correcting a wall must
   * not disturb what somebody said about it, and saying something must not touch
   * a dimension.
   *
   * One list rather than one per wall, and rather than recordings hung inside
   * the marks. A note about a wall and a note about a mark on that wall are the
   * same thing said about a smaller subject, and two lists would have meant two
   * things to save, two to hand across the bridge, and two places for the rule
   * "a recording is never rewritten" to be got wrong.
   */
  readonly voice: readonly VoiceNote[];
  /**
   * Hidden conditions somebody found and pinned: joists, the stack, the
   * knob-and-tube behind the closet.
   *
   * Beside the damages rather than among them, because a joist is not a loss.
   * See `core/src/tag.ts` -- merging the two would eventually put "2x10 joists
   * at 16 in centres" in front of an insurer as a reported claim item.
   */
  readonly tags: readonly Tag[];
  /**
   * The line dividing an open plan, and what the two sides are called.
   *
   * One boundary, not a list, and that is a deliberate limit rather than a
   * missing feature: `splitByBoundary` cuts a room in two, and cutting a
   * three-part great room needs it applied to a zone rather than to a room.
   * Shipping the two-part case honestly beats shipping a list that quietly
   * only works for the first entry.
   */
  readonly divide: { readonly boundary: Boundary; readonly names: readonly [string, string] } | null;
  /**
   * Quantities somebody typed over, and why.
   *
   * Kept beside the room rather than in it, exactly as damage is: the room is a
   * measurement of a building and an override is a decision about what to
   * order. Correcting a wall must not disturb a waste factor, and changing a
   * waste factor must not touch a measurement.
   */
  readonly overrides: readonly Override[];
  /**
   * What is actually being done to each surface, once somebody has said.
   *
   * `null` is not "empty" and it is not a missing field: it is a room nobody
   * has scoped, which is priced exactly the way this app has always priced one
   * — every surface as if it were being replaced. Every project saved before
   * this existed comes back this way and reads identically to the day it was
   * saved, which is the whole reason the state is nullable rather than starting
   * at an empty scope. An empty scope means "somebody decided nothing is
   * happening here", and that is a completely different sheet.
   *
   * Beside the room rather than inside it, like the damage and the overrides:
   * the room is a measurement of a building and a scope is a decision about
   * what to do to it. Correcting a wall must not disturb what is being done to
   * it, and changing what is being done must not touch a dimension.
   */
  readonly scope: WorkScope | null;
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
  /**
   * How the proposal was sent out, and when: the fingerprint of the document
   * at the moment it left the phone.
   *
   * Without it a signed copy that comes back cannot be bound to the version
   * that was signed, which is the whole of the evidence. `null` until the
   * proposal has actually been sent. See `core/src/countersign.ts`.
   */
  readonly proposalSent: { readonly at: string; readonly hash: string } | null;
  /**
   * Where the client's agreement gets made, or `null` for not asked.
   *
   * Never defaulted, anywhere, including here. It decides whether the FTC's
   * Cooling-Off Rule puts a three-day cancellation notice on the proposal, and
   * the convenient answer is the one that gets a contractor sued. See
   * `core/src/cooling.ts`.
   */
  readonly saleVenue: SaleVenue | null;
  /**
   * Signed copies of the proposal that came back — a photograph, a PDF, a scan.
   *
   * Appended, never edited, like `agreedChanges`. Deliberately NOT a
   * `Signature` and deliberately not enough on its own to freeze a baseline.
   */
  readonly returnedCopies: readonly ReturnedDocument[];
  /**
   * Change orders the client has signed, in the order they were agreed.
   *
   * The only things besides the baseline that an invoice may bill. A change
   * nobody signed is not in here and never reaches a bill; see
   * `core/src/change.ts`. Appended, never edited, for the same reason a
   * baseline is never edited.
   */
  readonly agreedChanges: readonly AgreedChange[];
  /**
   * A change order written down and waiting to be signed.
   *
   * Kept rather than rebuilt, because rebuilding it is the bug: the room keeps
   * moving while a client is deciding, and re-raising after it has moved
   * produces a different document from the one that was sent out. The client
   * would then be signing something nobody showed them.
   */
  readonly raisedChange: ChangeDocument | null;
  /** When the work happens. Beside the room, like everything else about a job. */
  readonly visits: readonly Visit[];
  /** What has been asked for, in the order it was asked. */
  readonly invoices: readonly Invoice[];
  /**
   * What has come in against those invoices.
   *
   * Written down, never taken: this app processes no payments and holds no card
   * details. See `core/src/payment.ts`.
   */
  readonly payments: readonly Payment[];
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
  | {
      type: 'tag';
      id: string;
      conditions: Tag['conditions'];
      at: Point;
      height?: bigint;
      note: string;
      at_: string;
      by: string;
    }
  | { type: 'untag'; tagId: string }
  | {
      type: 'wallHeight';
      wallId: string;
      /** Empty puts the wall back to the room's ceiling height. */
      text: string;
      by: string;
      when: string;
    }
  | { type: 'divide'; boundary: Boundary; names: readonly [string, string] }
  | { type: 'undivide' }
  | { type: 'unmark'; damageId: string }
  /**
   * A recording, and everything that happens to it afterwards.
   *
   * One action rather than three — kept, transcribed, corrected — because all
   * three hand over the whole note and the reducer's job is the same every
   * time: check it against the room, and put it where the one with that id was.
   * The recording itself is a file the app wrote and this never touches it.
   */
  | { type: 'voice'; note: VoiceNote }
  | { type: 'unvoice'; noteId: string }
  /** A cut height decided, or taken off again. Seen and decided stay apart. */
  | { type: 'cutTo'; damageId: string; text: string | null }
  | { type: 'reading'; damageId: string; reading: Reading }
  | { type: 'damagePhotos'; damageId: string; photos: readonly string[] }
  /**
   * What is being done to one surface, turned on or off.
   *
   * `scopeAll` and `scopeNone` are how a room stops being priced as a full
   * replacement: one starts from everything and lets somebody take work off,
   * the other starts from nothing and lets them put work on. Both are real
   * ways a contractor thinks — a gut job and a patch — and neither of them
   * moves a number until he actually ticks something.
   */
  | {
      type: 'pickWork' | 'dropWork';
      surface: Surface;
      item: WorkItem;
      /**
       * Everything this contractor can pick, so a room nobody has scoped yet
       * can start from all of it rather than from an empty sheet.
       */
      items: readonly WorkItem[];
      by: string;
      at: string;
    }
  | { type: 'scopeAll'; items: readonly WorkItem[]; by: string; at: string }
  | { type: 'scopeNone'; by: string; at: string }
  | { type: 'unscope' }
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
  | { type: 'agreedChanges'; agreedChanges: readonly AgreedChange[] }
  | { type: 'proposalSent'; sent: { at: string; hash: string } }
  | { type: 'saleVenue'; venue: SaleVenue | null }
  | { type: 'returnedCopies'; returnedCopies: readonly ReturnedDocument[] }
  | { type: 'raisedChange'; raisedChange: ChangeDocument | null }
  | { type: 'visits'; visits: readonly Visit[] }
  | { type: 'invoices'; invoices: readonly Invoice[] }
  | { type: 'payments'; payments: readonly Payment[] }
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
    voice?: readonly VoiceNote[];
    tags?: readonly Tag[];
    divide?: Loaded['divide'];
    overrides?: readonly Override[];
    scope?: WorkScope;
    claim?: Claim;
    proposal?: Proposal;
    baseline?: Baseline;
    agreedChanges?: readonly AgreedChange[];
    proposalSent?: { at: string; hash: string };
    saleVenue?: SaleVenue;
    returnedCopies?: readonly ReturnedDocument[];
    raisedChange?: ChangeDocument;
    visits?: readonly Visit[];
    invoices?: readonly Invoice[];
    payments?: readonly Payment[];
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
      cameraHeights: [],
      refusedPins: [],
      north: (extras.north as NorthOnPlan | undefined) ?? null,
      frame: extras.frame ?? NO_SCAN_FRAME,
      damages: extras.damages ?? [],
      // Absent in every room saved before recordings existed, which is every
      // room on anybody's phone today. An empty list is exactly right for one:
      // nothing was said, rather than something that could not be read.
      voice: extras.voice ?? [],
      // Read rather than taken as-is: a tag saved before 2026-08-26 carries a
      // single `condition`, and every one of those is on somebody's phone. See
      // `readConditions` — without this they would come back with no
      // conditions at all and the room would refuse to open.
      tags: (extras.tags ?? []).map((tag) => ({
        ...tag,
        conditions: readConditions(tag),
      })),
      divide: extras.divide ?? null,
      overrides: extras.overrides ?? [],
      // A file written before scopes existed has none, and comes back as a room
      // priced the way it always was. Nothing is invented to fill the gap.
      scope: extras.scope ?? null,
      claim: extras.claim ?? NO_CLAIM,
      proposal: extras.proposal ?? null,
      baseline: extras.baseline ?? null,
      // Absent in every job saved before signed change orders existed. An empty
      // list is right for one: nobody signed anything, rather than something
      // that could not be read.
      agreedChanges: extras.agreedChanges ?? [],
      proposalSent: extras.proposalSent ?? null,
      // Absent, not "at the seller's place of business". A job saved before the
      // question existed has not been asked it, and guessing the answer is the
      // one that skips a notice the law requires.
      saleVenue: extras.saleVenue ?? null,
      returnedCopies: extras.returnedCopies ?? [],
      raisedChange: extras.raisedChange ?? null,
      visits: extras.visits ?? [],
      invoices: extras.invoices ?? [],
      payments: extras.payments ?? [],
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
        let cameraHeights: readonly bigint[] = [];
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
          // The frame alarm's evidence. `frame.floor` is what makes it
          // possible: before it existed there was no floor to measure from.
          try {
            cameraHeights = heightsAboveFloor(manifest, frame.floor);
          } catch {
            // A manifest too broken to measure heights in is already reported
            // above; losing the sanity check as well is not worth a second
            // message about the same file.
          }
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
            cameraHeights,
            north,
            frame,
            damages,
            voice: [],
            tags: [],
            divide: null,
            refusedPins,
            overrides: [],
            scope: null,
            claim: NO_CLAIM,
            proposal: null,
            baseline: null,
            agreedChanges: [],
            raisedChange: null,
            proposalSent: null,
            saleVenue: null,
            returnedCopies: [],
            visits: [],
            invoices: [],
            payments: [],
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
            cameraHeights: [],
            refusedPins: [],
            north: null,
            frame: NO_SCAN_FRAME,
            damages: [],
            voice: [],
            tags: [],
            divide: null,
            overrides: [],
            scope: null,
            claim: NO_CLAIM,
            proposal: null,
            baseline: null,
            agreedChanges: [],
            raisedChange: null,
            proposalSent: null,
            saleVenue: null,
            returnedCopies: [],
            visits: [],
            invoices: [],
            payments: [],
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
          cameraHeights: [],
          refusedPins: [],
          north: null,
          frame: NO_SCAN_FRAME,
          damages: [],
          voice: [],
          tags: [],
          divide: null,
          overrides: [],
          scope: null,
          claim: NO_CLAIM,
          proposal: null,
          baseline: null,
          agreedChanges: [],
          raisedChange: null,
          proposalSent: null,
          saleVenue: null,
          returnedCopies: [],
          visits: [],
          invoices: [],
          payments: [],
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

    /* ------------------------------------------------- what is being done */

    case 'pickWork':
    case 'dropWork': {
      const loaded = state.loaded;
      if (!loaded) return state;
      // Picking on a room nobody has scoped starts the scope at everything, so
      // the first tick takes work OFF rather than throwing the rest away. A
      // control whose first use empties the sheet is a control nobody presses
      // twice.
      const from = loaded.scope ?? everything(loaded.room, action.items, action.by, action.at);
      const scope =
        action.type === 'pickWork'
          ? pickWork(from, action.surface, action.item, action.by, action.at)
          : dropWork(from, action.surface, action.item, action.by, action.at);
      return {
        ...state,
        error: null,
        loaded: {
          ...loaded,
          scope,
          lastEdit:
            `${action.item.item} ${action.type === 'pickWork' ? 'is' : 'is not'} being done to ` +
            `${surfaceName(action.surface)}.`,
        },
      };
    }

    case 'scopeAll': {
      const loaded = state.loaded;
      if (!loaded) return state;
      return {
        ...state,
        error: null,
        loaded: {
          ...loaded,
          scope: everything(loaded.room, action.items, action.by, action.at),
          lastEdit:
            'Everything in this room is on the sheet. Take off whatever is not being done.',
        },
      };
    }

    case 'scopeNone': {
      const loaded = state.loaded;
      if (!loaded) return state;
      return {
        ...state,
        error: null,
        loaded: {
          ...loaded,
          scope: nothing(action.by, action.at),
          lastEdit: 'Nothing is on the sheet yet. Open a wall and say what is being done to it.',
        },
      };
    }

    case 'unscope': {
      const loaded = state.loaded;
      if (!loaded) return state;
      return {
        ...state,
        error: null,
        loaded: {
          ...loaded,
          scope: null,
          lastEdit: 'Back to pricing every surface as replaced.',
        },
      };
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
        // And so does every recording. A note pointing at a wall that no longer
        // exists is somebody's own voice, silently off every screen -- the same
        // failure as a mark, one file bigger.
        const voice = loaded.voice.map((note) =>
          note.wallId === action.wallId ? { ...note, wallId: to } : note
        );
        const next = edited(state, loaded, room, `That wall is called "${to}" now.`);
        return next.loaded
          ? {
              ...next,
              selected: state.selected === action.wallId ? to : state.selected,
              loaded: { ...next.loaded, damages, voice },
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

    /**
     * How high one wall stands, when it is not the room's ceiling.
     *
     * A pony wall, a breakfast bar, a half wall with a counter on it. The only
     * way to give a wall its own height was to SPLIT one -- the second piece
     * got a height and an existing wall could never be given one, so a room
     * scanned with a pony wall already in it had no way to say so. `edit.ts`
     * has had `setWallHeight` the whole time; nothing called it.
     */
    case 'wallHeight': {
      const loaded = state.loaded;
      if (!loaded) return state;
      try {
        const blank = action.text.trim() === '';
        const room = setWallHeight(
          loaded.room,
          action.wallId,
          blank ? undefined : parseLength(action.text, { defaultUnit: 'ft' }),
          action.by,
          action.when,
          'tape'
        );
        return edited(
          state,
          loaded,
          room,
          blank
            ? `${action.wallId} goes to the ceiling again.`
            : `${action.wallId} stands ${action.text.trim()}.`
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
        // Every recording about that wall goes too, for the same reason and
        // said out loud in the same sentence: a note about a wall that is not
        // in the room any more can never be found again, and losing somebody's
        // own voice silently is worse than losing a quantity.
        const heardStill = loaded.voice.filter((note) => note.wallId !== action.wallId);
        const unheard = loaded.voice.length - heardStill.length;
        const next = edited(
          state,
          loaded,
          room,
          `${action.wallId} is gone. ` +
            (moved.length === 0
              ? 'Nothing else had to move.'
              : `${moved.map((a) => a.wallId).join(' and ')} moved to close the room back up.`) +
            (lost > 0 ? ` ${lost} mark${lost === 1 ? '' : 's'} on it went with it.` : '') +
            (unheard > 0
              ? ` ${unheard} recording${unheard === 1 ? '' : 's'} about it went too.`
              : '')
        );
        return next.loaded
          ? {
              ...next,
              selected: state.selected === action.wallId ? null : state.selected,
              loaded: { ...next.loaded, damages: kept, voice: heardStill },
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

    // A hidden condition somebody found: joists, the stack, a shut-off. It is
    // not damage and it never becomes a quantity -- see `core/src/tag.ts`.
    case 'tag': {
      const loaded = state.loaded;
      if (!loaded) return state;
      try {
        const tag = tagAt(loaded.room, {
          id: action.id,
          conditions: action.conditions,
          at: action.at,
          ...(action.height !== undefined ? { height: action.height } : {}),
          note: action.note,
          recordedAt: action.at_,
          recordedBy: action.by,
        });
        return {
          ...state,
          error: null,
          loaded: {
            ...loaded,
            tags: [...loaded.tags.filter((t) => t.id !== tag.id), tag],
            lastEdit: `Pinned ${tag.conditions.map((c) => CONDITION[c].plain.toLowerCase()).join(' + ')}.`,
          },
        };
      } catch (error) {
        return { ...state, error: message(error) };
      }
    }

    case 'untag': {
      const loaded = state.loaded;
      if (!loaded) return state;
      return {
        ...state,
        error: null,
        loaded: {
          ...loaded,
          tags: loaded.tags.filter((t) => t.id !== action.tagId),
          lastEdit: 'Took a pin off.',
        },
      };
    }

    // An open plan split into the several spaces it has to be priced as.
    case 'divide': {
      const loaded = state.loaded;
      if (!loaded) return state;
      try {
        // Cut it here rather than only in the screen, so a divider that will
        // not reconcile never reaches the saved room at all.
        splitByBoundary(loaded.room, action.boundary, action.names);
        return {
          ...state,
          error: null,
          loaded: {
            ...loaded,
            divide: { boundary: action.boundary, names: action.names },
            lastEdit: `Split into ${action.names[0]} and ${action.names[1]}.`,
          },
        };
      } catch (error) {
        return { ...state, error: message(error) };
      }
    }

    case 'undivide': {
      const loaded = state.loaded;
      if (!loaded) return state;
      return {
        ...state,
        error: null,
        loaded: { ...loaded, divide: null, lastEdit: 'Back to one space.' },
      };
    }

    case 'unmark': {
      const loaded = state.loaded;
      if (!loaded) return state;
      // The recordings made ON this mark go with it. They are about a thing
      // that is no longer in the room, and a note left behind would sit under a
      // mark id nothing can resolve -- invisible on every screen, and still in
      // the saved file. The wall's own recordings are untouched: they were
      // never about this mark.
      const said = loaded.voice.filter((note) => note.markId === action.damageId).length;
      return {
        ...state,
        error: null,
        loaded: {
          ...loaded,
          damages: loaded.damages.filter((d) => d.id !== action.damageId),
          voice: loaded.voice.filter((note) => note.markId !== action.damageId),
          lastEdit:
            'Took a mark off.' +
            (said > 0 ? ` ${said} recording${said === 1 ? '' : 's'} on it went with it.` : ''),
        },
      };
    }

    /**
     * A recording, and every later thing that happens to its words.
     *
     * The note arrives whole every time -- kept, then transcribed, then
     * corrected by hand -- and replaces the one with its id. That is what makes
     * the three moments one action instead of three: nothing here has to know
     * which of them it is looking at.
     *
     * The audio file is the app's, written once into the scan's folder. Nothing
     * in this reducer can touch it, which is exactly the property that makes
     * editing a transcript safe.
     */
    case 'voice': {
      const loaded = state.loaded;
      if (!loaded) return state;
      try {
        validateVoiceNote(loaded.room, action.note);
        const already = loaded.voice.some((note) => note.id === action.note.id);
        return {
          ...state,
          error: null,
          loaded: {
            ...loaded,
            voice: already
              ? loaded.voice.map((note) => (note.id === action.note.id ? action.note : note))
              : [...loaded.voice, action.note],
            lastEdit: already
              ? action.note.transcript?.by === 'person'
                ? 'That is what you said now, in your words.'
                : 'Wrote down what was said.'
              : `Recorded ${spokenLength(action.note.milliseconds)} about ${action.note.wallId}.`,
          },
        };
      } catch (error) {
        return { ...state, error: message(error) };
      }
    }

    case 'unvoice': {
      const loaded = state.loaded;
      if (!loaded) return state;
      return {
        ...state,
        error: null,
        loaded: {
          ...loaded,
          voice: loaded.voice.filter((note) => note.id !== action.noteId),
          // The file itself stays in the scan's folder. Deleting somebody's own
          // voice off a disk because they tidied a list is not this screen's
          // decision to make.
          lastEdit: 'Took a recording off the wall.',
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
              : before - after === 1
                ? `Took a photograph off. ${after} left on this mark.`
                : `Took ${before - after} photographs off. ${after} left on this mark.`,
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

    // Appended, never edited. A signed change order that could be quietly
    // rewritten is worth nothing, and `verifyChange` would catch it anyway.
    case 'agreedChanges':
      return state.loaded
        ? { ...state, loaded: { ...state.loaded, agreedChanges: action.agreedChanges } }
        : state;

    case 'proposalSent':
      return state.loaded
        ? { ...state, loaded: { ...state.loaded, proposalSent: action.sent } }
        : state;

    case 'saleVenue':
      return state.loaded
        ? { ...state, loaded: { ...state.loaded, saleVenue: action.venue } }
        : state;

    // Appended, never edited: a signed copy that could be quietly swapped is
    // worth nothing, and `checkReturned` would catch it anyway.
    case 'returnedCopies':
      return state.loaded
        ? { ...state, loaded: { ...state.loaded, returnedCopies: action.returnedCopies } }
        : state;

    // Written down, then either signed or torn up. Never edited in place: a
    // change order somebody is holding must not change under them.
    case 'raisedChange':
      return state.loaded
        ? { ...state, loaded: { ...state.loaded, raisedChange: action.raisedChange } }
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

    // Appended, like the invoices they settle. A payment that has been recorded
    // and then quietly changed is the record nobody can rely on.
    case 'payments':
      return state.loaded
        ? { ...state, loaded: { ...state.loaded, payments: action.payments } }
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
/**
 * The rooms already written down in this browser, by name.
 *
 * A browser that refuses to list its own storage cannot be counted, and a count
 * nobody can take must never become a refusal — so a failure here leaves the
 * gate open. Being wrong in that direction costs a room somebody did not pay
 * for; being wrong in the other costs somebody an afternoon's work.
 */
function keptRoomNames(): string[] {
  const names: string[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) names.push(key.slice(STORAGE_PREFIX.length));
    }
  } catch {
    // Counted as none, which refuses nothing.
  }
  return names;
}

/**
 * Whether this room may be written down, and why not.
 *
 * Exported so the screen can say so in its own words before `persist` quietly
 * declines to write. See `RoomLimit` in `Locked.tsx`.
 */
export function mayKeep(loaded: Loaded): Keeping {
  return mayKeepRoomHere(keptRoomNames(), loaded.fileName);
}

export function persist(loaded: Loaded, at: string): string | null {
  try {
    // One room is kept without a subscription, decided here because this is the
    // only path to storage. It stops a NEW room being written and nothing else:
    // re-saving a room already on this device always goes through, and nothing
    // already written is ever removed or hidden by this.
    const may = mayKeep(loaded);
    if (!may.keep) return may.because;

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
        voice: loaded.voice,
        tags: loaded.tags,
        divide: loaded.divide,
        claim: loaded.claim,
        proposal: loaded.proposal,
        baseline: loaded.baseline,
        agreedChanges: loaded.agreedChanges,
        proposalSent: loaded.proposalSent,
        saleVenue: loaded.saleVenue,
        returnedCopies: loaded.returnedCopies,
        raisedChange: loaded.raisedChange,
        visits: loaded.visits,
        invoices: loaded.invoices,
        payments: loaded.payments,
        overrides: loaded.overrides,
        scope: loaded.scope,
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
