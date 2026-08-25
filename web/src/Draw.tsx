import { useState } from 'react';
import { useUnits } from './units.tsx';
import type { Room } from '../../core/src/room.ts';
import {
  type Draft,
  addWall,
  reviseWall,
  finish,
  remaining,
  removeWall,
  startDraft,
  suggestClosingWall,
} from '../../core/src/draft.ts';
import type { Heading } from '../../core/src/room.ts';
import { Measure } from './Measure.tsx';

/**
 * A room typed in wall by wall, with no scan behind it.
 *
 * `draft.ts` has been able to do this since the first week and there has never
 * been a way to reach it. It is the mode that needs no LiDAR, no camera and no
 * hardware at all: somebody with a tape, or somebody working from an old
 * drawing for a building they cannot get into today. It is also the only mode
 * where every dimension is measured from the first keystroke — there is no
 * scanner to disagree with.
 *
 * Two things make it worth using rather than a drawing tool. Walls are **typed,
 * not dragged** — hitting 12 ft 4 3/8 in by dragging on a phone with gloves on
 * is miserable. And **the last wall is worked out, not asked for**: in a
 * rectilinear room the final run on each axis is determined by the others, so
 * the app says what it must be instead of sending somebody to measure a wall
 * the geometry already knows.
 */

const HEADINGS: readonly Heading[] = ['north', 'east', 'south', 'west'];
const AXIS: Record<Heading, 'x' | 'y'> = { east: 'x', west: 'x', north: 'y', south: 'y' };

export function Draw({
  onDone,
  onCancel,
}: {
  readonly onDone: (room: Room, name: string) => void;
  readonly onCancel: () => void;
}) {
  const { len } = useUnits();
  const [name, setName] = useState('');
  const [ceiling, setCeiling] = useState(`8'`);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);
  const [fixTo, setFixTo] = useState('');
  const [fixTrouble, setFixTrouble] = useState<string | null>(null);
  const [heading, setHeading] = useState<Heading>('east');
  const [trouble, setTrouble] = useState<string | null>(null);

  function begin() {
    try {
      setDraft(
        startDraft({
          id: `drawn:${Date.now()}`,
          name: name.trim() || 'Room',
          enteredBy: 'me',
          at: new Date().toISOString(),
          ceilingHeight: ceiling.trim() || `8'`,
        })
      );
      setTrouble(null);
    } catch (error) {
      setTrouble(error instanceof Error ? error.message : String(error));
    }
  }

  function add(which: Heading, text: string) {
    if (!draft) return;
    try {
      const next = addWall(draft, `wall-${draft.walls.length + 1}`, which, text, new Date().toISOString());
      setDraft(next);
      setTrouble(null);
      // Point at a heading that can actually come next, so the buttons are not
      // sitting on a choice the model will refuse.
      const turn = AXIS[which] === 'x' ? 'north' : 'east';
      setHeading(turn);
    } catch (error) {
      setTrouble(error instanceof Error ? error.message : String(error));
    }
  }

  function done() {
    if (!draft) return;
    try {
      onDone(finish(draft), draft.name);
    } catch (error) {
      setTrouble(error instanceof Error ? error.message : String(error));
    }
  }

  if (!draft) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">Draw it by hand</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          No scan, no LiDAR, no camera. A tape and this phone — or an old drawing for a building
          you cannot get into. Every number here is measured from the first keystroke, because you
          are the one typing it.
        </p>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">What is this room?</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Kitchen"
              className="mt-1 min-h-12 w-full rounded-md border border-slate-300 px-3 py-2
                         focus:border-sky-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">How high is the ceiling?</span>
            <input
              value={ceiling}
              onChange={(event) => setCeiling(event.target.value)}
              inputMode="text"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="mt-1 min-h-12 w-full rounded-md border border-slate-300 px-3 py-2 tabular-nums
                         focus:border-sky-500 focus:outline-none"
            />
          </label>
        </div>
        {trouble && <p className="mt-3 text-sm text-red-700">{trouble}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={begin}
            className="min-h-12 rounded-md bg-slate-900 px-6 font-semibold text-white active:bg-slate-700"
          >
            Start
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="min-h-12 rounded-md border border-slate-300 px-4 font-medium text-slate-700 active:bg-slate-100"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  const left = remaining(draft);
  const closing = suggestClosingWall(draft);
  const previous = draft.walls[draft.walls.length - 1];
  // A wall has to turn a corner out of the one before it. Offering the two that
  // cannot is offering a refusal.
  const allowed = HEADINGS.filter((h) => !previous || AXIS[h] !== AXIS[previous.heading]);
  const pick = allowed.includes(heading) ? heading : allowed[0]!;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">{draft.name}</h2>
        <span className="text-sm text-slate-600">
          ceiling {len(draft.ceilingHeight.value)}
        </span>
      </div>

      {draft.walls.length > 0 && (
        <ol className="mt-3 divide-y divide-slate-100 border-y border-slate-100">
          {draft.walls.map((wall) => (
            <li key={wall.id} className="py-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-slate-700">
                  {wall.id} — {wall.heading}
                </span>
                <span className="flex items-baseline gap-3">
                  <span className="tabular-nums font-semibold text-slate-900">
                    {len(wall.length.value)}
                  </span>
                  {/* Fixing a wall already entered.
                      Without this a typo on the second of eight walls meant
                      starting the room again: removing a wall in the middle
                      breaks the chain, and adding one puts it back on the end.
                      `reviseWall` has handled it since draft.ts was written and
                      nothing called it -- and it keeps the old value on the
                      record rather than overwriting it, which is the same rule
                      a tape reading follows. */}
                  <button
                    type="button"
                    onClick={() => {
                      setFixing(fixing === wall.id ? null : wall.id);
                      setFixTo('');
                      setFixTrouble(null);
                    }}
                    aria-label={`Fix the length of ${wall.id}`}
                    aria-expanded={fixing === wall.id}
                    className="min-h-11 text-sm text-slate-500 underline underline-offset-4"
                  >
                    {fixing === wall.id ? 'Leave it' : 'Fix'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft(removeWall(draft, wall.id))}
                    aria-label={`Remove ${wall.id}`}
                    className="min-h-11 text-sm text-slate-500 underline underline-offset-4"
                  >
                    Remove
                  </button>
                </span>
              </div>

              {fixing === wall.id && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    value={fixTo}
                    onChange={(event) => { setFixTo(event.target.value); setFixTrouble(null); }}
                    inputMode="text"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder={len(wall.length.value)}
                    aria-label={`What ${wall.id} really is`}
                    className="min-h-12 flex-1 rounded-md border border-slate-300 px-3 py-2
                               tabular-nums focus:border-sky-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (fixTo.trim() === '') {
                        setFixTrouble(`Type what ${wall.id} really is — 12' 4".`);
                        return;
                      }
                      try {
                        setDraft(
                          reviseWall(draft, wall.id, fixTo.trim(), new Date().toISOString())
                        );
                        setFixing(null);
                        setFixTo('');
                        setFixTrouble(null);
                      } catch (error) {
                        setFixTrouble(error instanceof Error ? error.message : String(error));
                      }
                    }}
                    aria-label={`Set what ${wall.id} really is`}
                    className="min-h-12 shrink-0 rounded-md bg-slate-900 px-4 font-semibold
                               text-white active:bg-slate-700"
                  >
                    Set
                  </button>
                  {fixTrouble && (
                    <p role="alert" className="basis-full text-sm text-red-700">{fixTrouble}</p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      <p className="mt-3 text-sm text-slate-600">
        {left.closes && draft.walls.length >= 4
          ? 'It closes. Finish when you are ready.'
          : draft.walls.length === 0
            ? 'Start at any corner and walk the room one wall at a time, all the way round.'
            : `Still to come back: ${describe(left.x, 'east', 'west', len)}${
                left.x !== 0n && left.y !== 0n ? ' and ' : ''
              }${describe(left.y, 'north', 'south', len)}.`}
      </p>

      {closing && (
        <div className="mt-3 rounded-lg bg-slate-100 p-3">
          <p className="text-sm text-slate-700">
            The last wall has to run <strong>{closing.heading}</strong> for{' '}
            <strong className="tabular-nums">{len(closing.length)}</strong>. The other
            walls decide it, so there is nothing to measure.
          </p>
          <button
            type="button"
            // The exact value, not the one on the button. `suggestClosingWall`
            // works the last wall out to the nanometre; rounding it to a
            // sixteenth to put it in the field and parsing that back loses up
            // to a thirty-second, and then the room does not close and
            // `finish()` refuses it — over a wall nobody typed. A room ending
            // 13' 5 7/32" is enough to do it.
            onClick={() => add(closing.heading, `${closing.length}nm`)}
            className="mt-2 min-h-12 rounded-md bg-slate-900 px-5 font-semibold text-white active:bg-slate-700"
          >
            Add it
          </button>
        </div>
      )}

      <div className="mt-4">
        <span className="text-sm font-medium text-slate-700">Which way does the next wall run?</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {allowed.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setHeading(h)}
              className={`min-h-12 flex-1 rounded-md px-4 font-semibold capitalize ${
                pick === h
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-300 text-slate-700 active:bg-slate-100'
              }`}
            >
              {h}
            </button>
          ))}
        </div>
        <div className="mt-2">
          <Measure
            name="how long this wall is"
            label={`how long, e.g. 12' 4 1/2"`}
            onSubmit={(text) => add(pick, text)}
          />
        </div>
      </div>

      {trouble && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {trouble}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={done}
          disabled={draft.walls.length < 4}
          className="min-h-12 rounded-md bg-slate-900 px-6 font-semibold text-white active:bg-slate-700
                     disabled:opacity-50"
        >
          Finish the room
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-12 rounded-md border border-slate-300 px-4 font-medium text-slate-700 active:bg-slate-100"
        >
          Throw it away
        </button>
      </div>
    </div>
  );
}

/** "12' 4"" east", or nothing at all when there is nothing left that way. */
function describe(
  value: bigint,
  positive: string,
  negative: string,
  len: (v: bigint) => string
): string {
  if (value === 0n) return '';
  const abs = value < 0n ? -value : value;
  return `${len(abs)} ${value > 0n ? positive : negative}`;
}
