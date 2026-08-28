import { useMemo, useState } from 'react';
import type { Room, Wall } from '../../core/src/room.ts';
import { runLength } from '../../core/src/room.ts';
import { deleteWall, renameRoom } from '../../core/src/edit.ts';
import { confidenceLabel, isAdjusted, isVerified } from '../../core/src/measurement.ts';
import { Wants } from './Measure.tsx';
import { Disclosure } from './Disclosure.tsx';
import { useUnits } from './units.tsx';

/**
 * Changing the room itself: its name, its walls, and where they are.
 *
 * Every scanning app lets you type over a number. What none of them do is say
 * what kind of number it became. That is the whole line this screen is built
 * around, and it is drawn in one place — the difference between **Put a tape on
 * it** and **Move it**:
 *
 *   - A tape reading is a measurement. It is held forever, the room re-solves
 *     around it, and the drawing says measured.
 *   - Moving a wall is not. The room still re-solves around it and the wall
 *     still goes where it was put, but it lands in the model as "moved by hand"
 *     with its own colour on the plan, and it does not satisfy "put a tape on
 *     one wall running each way".
 *
 * If dragging ever produced a measurement, somebody could make an unchecked
 * scan claim it had been measured by nudging four walls, and every promise this
 * app makes about where a number came from would be worth nothing. So the two
 * buttons sit next to each other and say plainly which is which.
 *
 * Numbers are typed rather than dragged with a finger. A wall dragged on a
 * phone lands on whatever pixel a thumb covered, which on a 20 ft wall at this
 * scale is about two inches of building per pixel — so the "drag" is a length,
 * and the plan re-draws around it. It is the same gesture in the only unit that
 * survives it.
 *
 * **Nothing clears when a button is pressed.** Every edit here can be refused by
 * the model — a cut through a door, a name already taken, a wall the room
 * cannot close without — and a form that emptied itself on the way to a refusal
 * would make somebody retype three fields to fix the one that was wrong. Worse,
 * it would leave the refusal on screen with nothing to act on, which reads like
 * the app is stuck. The values stay; the line under the plan says what
 * happened.
 */

/**
 * One thing you can do to this wall, and a way to put it away again.
 *
 * Sam: "WHEN YOU DROPDOWN ANY MENU, HAVE A WAY TO COLLAPSE THEM BACK." Six of
 * these opened together the moment "Change this wall" was tapped — a rename, a
 * move, a height, a cut, a notch and a deletion, three screens of boxes on a
 * phone — and not one of them could be folded. Now each is its own disclosure,
 * and the shut one says what it currently is rather than only what it does.
 *
 * Which of them arrives open is not arbitrary. Naming a wall and cutting one in
 * two are what anybody does to an ordinary wall, so they stay open: a way back
 * is what was asked for, not a screen that has emptied itself. A notch and a
 * deletion belong to an alcove and to a side of the room that is not really
 * there, so they arrive shut; the height arrives shut too until the wall
 * actually has one of its own, because there is nothing to read in it until
 * then. That is 433 px of a 430-wide phone that is no longer scrolled past,
 * measured on Sam's dining scan.
 */
function Row({
  label,
  summary,
  open,
  fold = true,
  children,
}: {
  readonly label: string;
  /** What this is set to now, read without opening anything. */
  readonly summary?: string;
  readonly open?: boolean;
  /**
   * False for the one row that cannot be a disclosure yet, and why.
   *
   * A disclosure's header is a button, and a button's accessible name is the
   * words in it. "Move it — without a tape" CONTAINS "Move it", which is the
   * name of the button inside it that actually moves the wall — and
   * `a6-persist.mjs` and `a8-agree.mjs` both reach that button by asking for a
   * button named "Move it". Given two, Playwright refuses to guess and both
   * parts stop: the one that proves a moved wall stays moved across a reload,
   * and the one that proves growing a signed room becomes a priced change.
   *
   * The heading could be reworded, and it is quoted in the handbook, so that is
   * a change to two files this task does not own. It could be given an
   * `aria-label` that leaves "Move it" out, and that breaks the rule that what
   * a control is called is what is written on it. So this row keeps the plain
   * heading it always had until those two parts ask for `{ exact: true }`, and
   * its measured twin above keeps one too, because one wall folding and the
   * next not is worse than neither.
   */
  readonly fold?: boolean;
  readonly children: React.ReactNode;
}) {
  if (!fold) {
    return (
      <div className="mt-3">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        {children}
      </div>
    );
  }
  return (
    <Disclosure title={label} summary={summary} open={open}>
      {children}
    </Disclosure>
  );
}

export function EditWall({
  room,
  wall,
  onRename,
  onDrag,
  onUnverify,
  onSplit,
  onHeight,
  onDelete,
  onNotch,
}: {
  readonly room: Room;
  readonly wall: Wall;
  readonly onRename: (name: string) => void;
  readonly onDrag: (text: string) => void;
  readonly onUnverify: () => void;
  readonly onSplit: (at: string, newId: string, height: string) => void;
  /** How high this wall stands. Empty puts it back to the room's ceiling. */
  readonly onHeight: (text: string) => void;
  readonly onDelete: () => void;
  readonly onNotch: (out: string, along: string, outId: string, alongId: string) => void;
}) {
  const { len } = useUnits();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [wants, setWants] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState('');
  const [moveWants, setMoveWants] = useState<string | null>(null);
  const [cutAt, setCutAt] = useState('');
  const [cutWants, setCutWants] = useState<string | null>(null);
  const [standsAt, setStandsAt] = useState('');
  const [heightWants, setHeightWants] = useState<string | null>(null);
  const [cutName, setCutName] = useState('');
  const [cutHigh, setCutHigh] = useState('');
  const [notchOut, setNotchOut] = useState('');
  const [notchAlong, setNotchAlong] = useState('');
  const [notchName, setNotchName] = useState('');
  const [notchWants, setNotchWants] = useState<string | null>(null);

  const measured = isVerified(wall.length);
  const moved = isAdjusted(wall.length);

  /**
   * Whether this wall can come out, and if not yet, what is in the way.
   *
   * The row used to be drawn whenever `room.walls.length > 3`. That is true of
   * every ordinary scanned rectangle, and on one the delete is always refused:
   * four sides less one is three, and a rectilinear walk cannot close on three.
   * So every four-walled room offered a control that could never once succeed,
   * which is the dead button Sam reported already, built in.
   *
   * A wall count is not the question, and neither is the count after a merge.
   * Measured on `garage.json` notched out to six walls, `deleteWall` refuses
   * four of the six — one for the door in it, three because removing them
   * leaves two walls on one axis that nothing tells apart, which `validate`
   * calls one wall written twice. A guard counting walls after `mergeCollinear`
   * still says five, still draws the row, and somebody still meets a button
   * that cannot work.
   *
   * So the model is asked, twice, and the two answers are different questions:
   *
   *   1. **As the room stands.** No refusal, and the button is drawn.
   *   2. **With whatever is in this wall set aside.** A door or a window is
   *      something a person can take out on the panel above, so a wall that
   *      could come out once it is empty keeps its row — and says what has to
   *      go first, in the model's own words, where the thumb already is rather
   *      than after a press. A wall that could not come out even empty has
   *      nothing to offer and draws nothing.
   *
   * `deleteWall` is the one function that decides, and it is pure, so asking it
   * means this row cannot drift out of step with the reducer that calls it
   * again a moment later — the same move `RenameRoom` below makes with
   * `renameRoom`, and the same one `wouldClose` exists in `sketch.ts` for.
   *
   * Only while the panel is open, because a shut panel draws none of this and
   * each answer costs a solve.
   */
  const takeOut = useMemo(() => {
    if (!open) return null;
    const refusal = (walls: readonly Wall[]) => {
      try {
        deleteWall({ ...room, walls }, wall.id);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    };
    const now = refusal(room.walls);
    if (now === null) return { ready: true, first: null };
    if ((wall.openings?.length ?? 0) === 0) return null;
    const { openings: _inIt, ...emptied } = wall;
    if (refusal(room.walls.map((one) => (one.id === wall.id ? emptied : one))) !== null) return null;
    return { ready: false, first: now };
  }, [open, room, wall]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 min-h-11 border-t border-sky-200 pt-3 text-sm text-slate-500
                   underline underline-offset-4"
        data-sheet="no"
      >
        Change this wall
      </button>
    );
  }

  return (
    <div className="mt-4 border-t border-sky-200 pt-3" data-sheet="no">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900">Change this wall</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-11 shrink-0 text-sm text-slate-500 underline underline-offset-4"
        >
          Done
        </button>
      </div>

      <p className="mt-1 text-xs text-slate-500">
        It is {len(runLength(wall))} and it is {confidenceLabel(wall.length)}
        {moved && ' — moved by hand, which is not the same as measured'}.
      </p>

      <Row label="Call it something" summary={`It is called ${wall.id} today`}>
        <div className="mt-1 flex gap-2">
          <input
            value={name}
            onChange={(event) => { setName(event.target.value); setWants(null); }}
            placeholder={wall.id}
            aria-label="What to call this wall"
            className="min-h-12 w-full rounded-md border border-slate-300 px-3 py-2
                       focus:border-sky-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => {
              if (name.trim() === '') {
                setWants('Type what to call this wall first — "the wall behind the washer".');
                return;
              }
              setWants(null);
              onRename(name);
            }}
            // Named, because there is more than one "Set" on this screen and a
            // screen reader reads them all the same otherwise.
            aria-label="Set what to call this wall"
            className="min-h-12 shrink-0 rounded-md border border-slate-300 px-4 font-medium
                       text-slate-700 active:bg-slate-100"
          >
            Set
          </button>
        </div>
        <Wants say={wants} />
        <p className="mt-1 text-xs text-slate-500">
          "the wall behind the washer" beats "wall-1" on every sheet this makes. Anything marked
          on it moves with it.
        </p>
      </Row>

      {measured ? (
        <Row label="It has had a tape on it" fold={false}>
          <p className="mt-1 text-xs text-slate-500">
            So it will not be dragged. Dragging it would quietly replace a measurement with a
            guess, and the plan would still say somebody measured this room.
          </p>
          <button
            type="button"
            onClick={onUnverify}
            className="mt-2 min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium
                       text-slate-700 active:bg-slate-100"
          >
            Take the tape reading off
          </button>
        </Row>
      ) : (
        <Row label="Move it — without a tape" fold={false}>
          <div className="mt-1 flex gap-2">
            <input
              value={moveTo}
              onChange={(event) => setMoveTo(event.target.value)}
              placeholder={len(runLength(wall))}
              inputMode="decimal"
              aria-label="Move this wall to"
              className="min-h-12 w-full rounded-md border border-slate-300 px-3 py-2 font-mono tabular-nums
                         focus:border-sky-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => {
                if (moveTo.trim() === '') {
                  setMoveWants('Type where this wall really is first — 12\' 4".');
                  return;
                }
                setMoveWants(null);
                onDrag(moveTo);
              }}
              className="min-h-12 shrink-0 rounded-md border border-violet-400 bg-violet-50 px-4
                         font-medium text-violet-800 active:bg-violet-100"
            >
              Move it
            </button>
          </div>
          <Wants say={moveWants} />
          <p className="mt-1 text-xs text-slate-500">
            For a scan that put a wall in the wrong place. The room re-solves around it exactly
            as it does for a tape — but it goes on the drawing in violet as{' '}
            <strong>moved by hand</strong>, and it does not count as measuring the room. Put a
            tape on it above when you can.
          </p>
        </Row>
      )}

      {/* A pony wall, a breakfast bar, a half wall with a counter on it.
        Until now the only way to give a wall its own height was to cut one
        in two -- so a room scanned with a pony wall already in it could not
        say so, and every quantity treated it as full height. */}
      <Row
        label="It does not go to the ceiling"
        open={wall.height !== undefined}
        summary={
          wall.height === undefined
            ? `Full height — the room's ceiling at ${len(room.ceilingHeight.value)}`
            : `It stands ${len(wall.height.value)}`
        }
      >
        <div className="flex flex-wrap gap-2">
          <input
            value={standsAt}
            onChange={(event) => { setStandsAt(event.target.value); setHeightWants(null); }}
            inputMode="text"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={len((wall.height ?? room.ceilingHeight).value)}
            aria-label="How high this wall stands"
            className="min-h-12 w-full rounded-md border border-slate-300 px-3 py-2 font-mono tabular-nums
                       focus:border-sky-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => {
              if (standsAt.trim() === '') {
                setHeightWants('Type how high it stands — 3\' 6" for a bar, 7\' for a partition.');
                return;
              }
              setHeightWants(null);
              onHeight(standsAt);
            }}
            aria-label="Set how high this wall stands"
            className="min-h-12 shrink-0 rounded-md border border-slate-300 px-4 font-medium
                       text-slate-700 active:bg-slate-100"
          >
            Set
          </button>
          {wall.height !== undefined && (
            <button
              type="button"
              onClick={() => { setStandsAt(''); setHeightWants(null); onHeight(''); }}
              className="min-h-12 shrink-0 rounded-md border border-slate-300 px-4 font-medium
                         text-slate-700 active:bg-slate-100"
            >
              It does go to the ceiling
            </button>
          )}
        </div>
        <Wants say={heightWants} />
        <p className="mt-1 text-xs text-slate-500">
          It stops taking board, paint and base above this, and the takeoff moves with it.{' '}
          {wall.height === undefined
            ? `It goes to the room's ceiling at ${len(room.ceilingHeight.value)} today.`
            : `It stands ${len(wall.height.value)} today.`}
        </p>
      </Row>

      {!wall.open && (
      <Row label="Cut it in two" summary="Makes a second wall, with a height of its own">
          <div className="mt-1 grid grid-cols-3 gap-2">
            <input
              value={cutAt}
              onChange={(event) => setCutAt(event.target.value)}
              placeholder="at"
              inputMode="decimal"
              aria-label="Cut this wall at"
              className="min-h-12 rounded-md border border-slate-300 px-2 py-2 font-mono tabular-nums
                         focus:border-sky-500 focus:outline-none"
            />
            <input
              value={cutName}
              onChange={(event) => setCutName(event.target.value)}
              placeholder="call it"
              aria-label="What to call the second piece"
              className="min-h-12 rounded-md border border-slate-300 px-2 py-2
                         focus:border-sky-500 focus:outline-none"
            />
            <input
              value={cutHigh}
              onChange={(event) => setCutHigh(event.target.value)}
              placeholder="how high"
              inputMode="decimal"
              aria-label="How high the second piece stands"
              className="min-h-12 rounded-md border border-slate-300 px-2 py-2 font-mono tabular-nums
                         focus:border-sky-500 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              // Three boxes, so it says which one is empty rather than making
              // somebody work it out. Naming all the missing ones at once beats
              // three rounds of pressing and being refused.
              const missing = [
                cutAt.trim() === '' && 'how far along to cut it',
                cutName.trim() === '' && 'what to call the second piece',
                cutHigh.trim() === '' && 'how high the second piece stands',
              ].filter(Boolean);
              if (missing.length) {
                setCutWants(`Fill in ${missing.join(', and ')} first.`);
                return;
              }
              setCutWants(null);
              onSplit(cutAt, cutName, cutHigh);
            }}
            className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm
                       font-medium text-slate-700 active:bg-slate-100"
          >
            Cut it
          </button>
          <Wants say={cutWants} />
          <p className="mt-1 text-xs text-slate-500">
            For a pony wall meeting a full-height one, or a run that changes build-up half way.
            The second piece needs its own height, because two walls in line that are alike in
            every way are one wall written twice. To mark part of a wall as damaged, you do not
            need this — a damaged area already runs from here to there along it.
          </p>
        </Row>
      )}

      <Row
        label="Notch the corner after it"
        open={false}
        summary="For an alcove or a chase the scanner flattened. Puts two walls in."
      >
        <div className="mt-1 grid grid-cols-3 gap-2">
          <input
            value={notchOut}
            onChange={(event) => { setNotchOut(event.target.value); setNotchWants(null); }}
            placeholder="how deep"
            inputMode="decimal"
            aria-label="How deep the step goes"
            className="min-h-12 rounded-md border border-slate-300 px-2 py-2 font-mono tabular-nums
                       focus:border-sky-500 focus:outline-none"
          />
          <input
            value={notchAlong}
            onChange={(event) => { setNotchAlong(event.target.value); setNotchWants(null); }}
            placeholder="how wide"
            inputMode="decimal"
            aria-label="How wide the step is"
            className="min-h-12 rounded-md border border-slate-300 px-2 py-2 font-mono tabular-nums
                       focus:border-sky-500 focus:outline-none"
          />
          <input
            value={notchName}
            onChange={(event) => { setNotchName(event.target.value); setNotchWants(null); }}
            placeholder="call it"
            aria-label="What to call the step"
            className="min-h-12 rounded-md border border-slate-300 px-2 py-2
                       focus:border-sky-500 focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => {
            // Three boxes, and every empty one named at once -- the same shape
            // `Cut it` above already uses, and for the same reason: three
            // rounds of pressing and being refused is three chances to give up.
            //
            // It used to be a bare `return`. Pressing Notch it with the boxes
            // empty changed not one byte of the screen, which on a phone is
            // indistinguishable from a dead button; every other button on this
            // panel says what it wants, and this is the class of bug
            // `a12-everything.mjs` found in seven forms.
            const stem = notchName.trim();
            const missing = [
              notchOut.trim() === '' && 'how deep the step goes',
              notchAlong.trim() === '' && 'how wide the step is',
              stem === '' && 'what to call it',
            ].filter(Boolean);
            if (missing.length) {
              setNotchWants(`Fill in ${missing.join(', and ')} first.`);
              return;
            }
            setNotchWants(null);
            onNotch(notchOut, notchAlong, `${stem} back`, `${stem} side`);
          }}
          className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm
                     font-medium text-slate-700 active:bg-slate-100"
        >
          Notch it
        </button>
        <Wants say={notchWants} />
        <p className="mt-1 text-xs text-slate-500">
          For an alcove or a chase the scanner flattened into a straight wall. It puts{' '}
          <strong>two</strong> walls in, because a room with square corners always has an even
          number of sides — one on its own could not close. The two walls beside the corner give
          up the length, so the room does not change size, and neither of them will give it up if
          somebody has put a tape on it.
        </p>
      </Row>

      {takeOut && (
        <Row
          label="Take it out"
          open={false}
          summary="For a side of the room that is not really there"
        >
          {takeOut.ready ? (
            <button
              type="button"
              onClick={onDelete}
              className="mt-1 min-h-11 rounded-md border border-red-300 bg-red-50 px-3 text-sm
                         font-medium text-red-800 active:bg-red-100"
            >
              There is no wall here at all
            </button>
          ) : (
            // The model's own sentence, not a copy of it, and here rather than
            // under the button it would otherwise refuse. There is nothing to
            // press until what is in the wall comes out, so there is no button.
            <Wants say={takeOut.first} />
          )}
          <p className="mt-1 text-xs text-slate-500">
            Not the same as an open span — this removes the side from the room, and the walls on
            that axis grow or shrink to close it back up. The line under the plan says which
            moved and by how far. Undo is one tap if it is not what you meant.
          </p>
        </Row>
      )}
    </div>
  );
}

/**
 * What the room is called — the one name, changed in the one place.
 *
 * ## The name is the room's, and this is where it changes
 *
 * A room has exactly one name and it lives in the room: `room.name`, saved into
 * `corrected.json` by `persist.ts`, handed to the app on the `saved` channel,
 * and copied from there onto the scan's card so the Rooms list and the bar at
 * the top of the app show it too. The **folder** the scan sits in keeps its
 * timestamped name forever — that is its address, the key it is saved under in
 * iCloud, and the path under every photograph in it, and moving a folder is how
 * a backup ends up pointing at nothing. A name is a label; a folder is an
 * address. Only the label changes, and it changes here.
 *
 * That matters more than it sounds. A name that lives in two places is a name
 * that will disagree, and the last time this app let one disagree — the room
 * screen saying one thing and the Rooms list another — Sam deleted a scan with
 * **53 photographs** in it, believing it was a duplicate of the room beside it.
 * A wall that has been closed up cannot be photographed again.
 *
 * ## Why this control does not clear itself and does not close on a refusal
 *
 * It used to do both. `Set` on an empty box ran `if (name.trim() !== '')`,
 * silently did nothing, cleared the box and shut the panel — and the box showed
 * the room's current name as grey placeholder text, so it LOOKED full. Press
 * Set on what reads as "UPSTAIRS" and the control closes as though it worked,
 * having changed nothing. That is a rename that does not stick, reported from
 * the only side that matters: the person who typed it.
 *
 * So now the box opens holding the name it is about to change, the room itself
 * is asked whether the new name is allowed BEFORE anything closes, and a refusal
 * appears beside the button that was pressed with the typed name still in the
 * box. Nothing clears when a button is pressed — the same rule the rest of this
 * file keeps, for the same reason.
 *
 * The rule is asked for rather than copied: `renameRoom` is the one function
 * that decides what a room may be called, and calling it here means this screen
 * cannot drift out of step with the reducer that calls it again a moment later.
 */
export function RenameRoom({
  room,
  onRename,
}: {
  readonly room: Room;
  readonly onRename: (name: string) => void;
}) {
  const [name, setName] = useState(room.name);
  const [wants, setWants] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        // Filled from the room every time it is opened rather than once when
        // this component was first built: the room on screen can be renamed,
        // undone, or replaced by another one underneath a control that is shut.
        onClick={() => { setName(room.name); setWants(null); setOpen(true); }}
        aria-label={`Rename ${room.name}`}
        className="min-h-11 text-left text-sm text-slate-500 underline underline-offset-4"
        data-sheet="no"
      >
        Rename
      </button>
    );
  }

  return (
    <div className="flex w-full flex-wrap gap-2" data-sheet="no">
      <input
        value={name}
        onChange={(event) => { setName(event.target.value); setWants(null); }}
        aria-label="What to call this room"
        autoFocus
        className="min-h-12 min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2
                   focus:border-sky-500 focus:outline-none"
      />
      <button
        type="button"
        onClick={() => {
          // Asked, not guessed at. `renameRoom` refuses a blank name and one
          // too long for the title block on the drawing, and it says why in
          // words a person can act on. Refused here means nothing closes and
          // nothing is cleared, so the name that was typed is still there to
          // fix rather than to retype.
          try {
            renameRoom(room, name);
          } catch (error) {
            setWants(error instanceof Error ? error.message : String(error));
            return;
          }
          setWants(null);
          onRename(name);
          setOpen(false);
        }}
        // Deliberately left with "Set" as its accessible name, where the
        // wall's says "Set what to call this wall". It reads worse and it is
        // the right call today: `a6-persist.mjs` finds this button by that
        // exact name, that part is not this one's to edit, and a rename that
        // breaks the check proving a rename is kept would be a poor trade for
        // four words. It is the only plain "Set" on the panel, so nothing is
        // currently ambiguous — see the note at the end of `a34-naming.mjs`.
        className="min-h-12 shrink-0 rounded-md bg-slate-900 px-4 font-semibold text-white
                   active:bg-slate-700"
      >
        Set
      </button>
      <Wants say={wants} />
      <button
        type="button"
        // A way out. Without one, a refusal that will not close leaves somebody
        // holding a box they cannot put down — which is its own kind of stuck
        // screen, and the opposite of what refusing loudly is for.
        onClick={() => { setName(room.name); setWants(null); setOpen(false); }}
        className="min-h-11 basis-full text-left text-sm text-slate-500 underline underline-offset-4"
      >
        Leave it called {room.name}
      </button>
    </div>
  );
}
