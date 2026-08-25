import { useState } from 'react';
import type { Room, Wall } from '../../core/src/room.ts';
import { runLength } from '../../core/src/room.ts';
import { confidenceLabel, isAdjusted, isVerified } from '../../core/src/measurement.ts';
import { Wants } from './Measure.tsx';
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

function Row({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="mt-3">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
    </div>
  );
}

export function EditWall({
  room,
  wall,
  onRename,
  onDrag,
  onUnverify,
  onSplit,
  onDelete,
  onNotch,
}: {
  readonly room: Room;
  readonly wall: Wall;
  readonly onRename: (name: string) => void;
  readonly onDrag: (text: string) => void;
  readonly onUnverify: () => void;
  readonly onSplit: (at: string, newId: string, height: string) => void;
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
  const [cutName, setCutName] = useState('');
  const [cutHigh, setCutHigh] = useState('');
  const [notchOut, setNotchOut] = useState('');
  const [notchAlong, setNotchAlong] = useState('');
  const [notchName, setNotchName] = useState('');

  const measured = isVerified(wall.length);
  const moved = isAdjusted(wall.length);

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

      <Row label="Call it something">
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
        <Row label="It has had a tape on it">
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
        <Row label="Move it — without a tape">
          <div className="mt-1 flex gap-2">
            <input
              value={moveTo}
              onChange={(event) => setMoveTo(event.target.value)}
              placeholder={len(runLength(wall))}
              inputMode="decimal"
              aria-label="Move this wall to"
              className="min-h-12 w-full rounded-md border border-slate-300 px-3 py-2 tabular-nums
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

      {!wall.open && (
        <Row label="Cut it in two">
          <div className="mt-1 grid grid-cols-3 gap-2">
            <input
              value={cutAt}
              onChange={(event) => setCutAt(event.target.value)}
              placeholder="at"
              inputMode="decimal"
              aria-label="Cut this wall at"
              className="min-h-12 rounded-md border border-slate-300 px-2 py-2 tabular-nums
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
              className="min-h-12 rounded-md border border-slate-300 px-2 py-2 tabular-nums
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

      <Row label="Notch the corner after it">
        <div className="mt-1 grid grid-cols-3 gap-2">
          <input
            value={notchOut}
            onChange={(event) => setNotchOut(event.target.value)}
            placeholder="how deep"
            inputMode="decimal"
            aria-label="How deep the step goes"
            className="min-h-12 rounded-md border border-slate-300 px-2 py-2 tabular-nums
                       focus:border-sky-500 focus:outline-none"
          />
          <input
            value={notchAlong}
            onChange={(event) => setNotchAlong(event.target.value)}
            placeholder="how wide"
            inputMode="decimal"
            aria-label="How wide the step is"
            className="min-h-12 rounded-md border border-slate-300 px-2 py-2 tabular-nums
                       focus:border-sky-500 focus:outline-none"
          />
          <input
            value={notchName}
            onChange={(event) => setNotchName(event.target.value)}
            placeholder="call it"
            aria-label="What to call the step"
            className="min-h-12 rounded-md border border-slate-300 px-2 py-2
                       focus:border-sky-500 focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => {
            const stem = notchName.trim();
            if (notchOut.trim() === '' || notchAlong.trim() === '' || stem === '') return;
            onNotch(notchOut, notchAlong, `${stem} back`, `${stem} side`);
          }}
          className="mt-2 min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm
                     font-medium text-slate-700 active:bg-slate-100"
        >
          Notch it
        </button>
        <p className="mt-1 text-xs text-slate-500">
          For an alcove or a chase the scanner flattened into a straight wall. It puts{' '}
          <strong>two</strong> walls in, because a room with square corners always has an even
          number of sides — one on its own could not close. The two walls beside the corner give
          up the length, so the room does not change size, and neither of them will give it up if
          somebody has put a tape on it.
        </p>
      </Row>

      {room.walls.length > 3 && (
        <Row label="Take it out">
          <button
            type="button"
            onClick={onDelete}
            className="mt-1 min-h-11 rounded-md border border-red-300 bg-red-50 px-3 text-sm
                       font-medium text-red-800 active:bg-red-100"
          >
            There is no wall here at all
          </button>
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

/** What the room is called, at the top of every sheet this makes. */
export function RenameRoom({
  room,
  onRename,
}: {
  readonly room: Room;
  readonly onRename: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Rename ${room.name}`}
        className="min-h-11 text-left text-sm text-slate-500 underline underline-offset-4"
        data-sheet="no"
      >
        Rename
      </button>
    );
  }

  return (
    <div className="flex w-full gap-2" data-sheet="no">
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={room.name}
        aria-label="What to call this room"
        autoFocus
        className="min-h-12 w-full rounded-md border border-slate-300 px-3 py-2
                   focus:border-sky-500 focus:outline-none"
      />
      <button
        type="button"
        onClick={() => {
          if (name.trim() !== '') onRename(name);
          setName('');
          setOpen(false);
        }}
        className="min-h-12 shrink-0 rounded-md bg-slate-900 px-4 font-semibold text-white
                   active:bg-slate-700"
      >
        Set
      </button>
    </div>
  );
}
