import { useState } from 'react';
import { parseLength } from '../../core/src/length.ts';
import { corners, runLength } from '../../core/src/room.ts';
import type { Point, Room } from '../../core/src/room.ts';
import {
  type Condition,
  type Tag,
  CONDITION,
  CONDITIONS,
  describeTag,
  tagCounts,
} from '../../core/src/tag.ts';
import { Wants } from './Measure.tsx';
import { useUnits } from './units.tsx';

/**
 * What is behind the wall, kept where it was found.
 *
 * ## The photograph nobody can find again
 *
 * Every remodeler's phone holds a picture of an open wall — where the joists
 * run, where the stack comes down, the knob-and-tube behind the closet, the
 * shut-off nobody could find for two hours. Those pictures are worth money to
 * the next trade, to the next job in the same house, and most of all to a
 * dispute about what was there before.
 *
 * And they are in a camera roll among four thousand others, filed by nothing,
 * so by the time anybody wants one, finding it costs more than the thing it
 * would have saved. Nobody looks.
 *
 * This is that picture with a place attached. Nothing in the field offers it.
 *
 * ## Why it is a wall and a height rather than a tap on the drawing
 *
 * Because that is how somebody says it out loud. "Six foot up the wall behind
 * the washer" is a sentence a contractor produces without thinking; "at plan
 * coordinates 14 foot 3 by 2 foot 9" is not one anybody has ever said. So the
 * screen asks the question in the form the answer already exists in, and works
 * the point out from it.
 *
 * The point still lands exactly: it is the wall's own line, walked the stated
 * distance from its first corner, in the same integer arithmetic everything
 * else uses. Nothing here is rounded to a drawing.
 */
export function Tags({
  room,
  tags,
  onAdd,
  onRemove,
}: {
  readonly room: Room;
  readonly tags: readonly Tag[];
  readonly onAdd: (input: {
    condition: Condition;
    at: Point;
    height?: bigint;
    note: string;
  }) => void;
  readonly onRemove: (tagId: string) => void;
}) {
  const { len } = useUnits();
  const [condition, setCondition] = useState<Condition>('framing');
  const [wallId, setWallId] = useState<string>(room.walls[0]?.id ?? '');
  const [along, setAlong] = useState('');
  const [high, setHigh] = useState('');
  const [note, setNote] = useState('');
  const [wants, setWants] = useState<string | null>(null);

  const counts = tagCounts(tags);

  /**
   * A point on a wall, a stated distance from its first corner.
   *
   * Scaled by the run rather than by a unit vector, so there is one division at
   * the end instead of a rounding at the start — the same thing the importer
   * does when it places an opening, for the same reason.
   */
  function pointOn(id: string, distance: bigint): Point | null {
    const index = room.walls.findIndex((w) => w.id === id);
    if (index === -1) return null;
    const outline = corners(room);
    const from = outline[index];
    const to = outline[(index + 1) % outline.length];
    if (!from || !to) return null;
    const span = runLength(room.walls[index]!);
    if (span === 0n) return null;
    const capped = distance < 0n ? 0n : distance > span ? span : distance;
    return {
      x: from.x + ((to.x - from.x) * capped) / span,
      y: from.y + ((to.y - from.y) * capped) / span,
    };
  }

  function add() {
    const missing = [
      wallId === '' && 'which wall',
      along.trim() === '' && 'how far along it',
      note.trim() === '' && 'what you found',
    ].filter(Boolean);
    if (missing.length) {
      setWants(`Fill in ${missing.join(', and ')} first.`);
      return;
    }
    let distance: bigint;
    let height: bigint | undefined;
    try {
      distance = parseLength(along.trim());
      height = high.trim() === '' ? undefined : parseLength(high.trim());
    } catch (error) {
      setWants(error instanceof Error ? error.message : String(error));
      return;
    }
    const at = pointOn(wallId, distance);
    if (!at) {
      setWants(`"${wallId}" is not a wall of this room any more.`);
      return;
    }
    setWants(null);
    onAdd({ condition, at, ...(height !== undefined ? { height } : {}), note: note.trim() });
    setAlong('');
    setHigh('');
    setNote('');
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-semibold text-slate-900">What is behind the wall</h2>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        Where the joists run, where the stack comes down, what you found when it was open. Pinned
        at the spot, so it is still there the next time anybody opens this wall.{' '}
        <strong>It never becomes a quantity</strong> — it is a place, some words and a photograph,
        and nothing here is priced or added up.
      </p>

      {counts.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {counts.map(({ condition: c, count }) => (
            <li
              key={c}
              className="rounded-md bg-sky-50 px-2 py-1 text-xs font-medium text-sky-900"
            >
              {CONDITION[c].plain} · {count}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 space-y-3">
        <div>
          <span className="text-sm font-medium text-slate-700">What did you find?</span>
          <div className="mt-1 grid gap-2 sm:grid-cols-3">
            {CONDITIONS.map((c) => {
              const picked = condition === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCondition(c)}
                  aria-pressed={picked}
                  className={`min-h-11 rounded-md px-3 text-left text-sm ${
                    picked
                      ? 'bg-slate-900 text-white'
                      : 'border border-slate-300 text-slate-700 active:bg-slate-100'
                  }`}
                >
                  {CONDITION[c].plain}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-slate-500">{CONDITION[condition].why}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <label className="flex-1">
            <span className="block text-sm font-medium text-slate-700">Which wall</span>
            <select
              value={wallId}
              onChange={(event) => { setWallId(event.target.value); setWants(null); }}
              className="mt-1 min-h-12 w-full rounded-md border border-slate-300 px-2 py-2"
            >
              {room.walls.map((wall) => (
                <option key={wall.id} value={wall.id}>
                  {wall.id} — {len(runLength(wall))}
                </option>
              ))}
            </select>
          </label>
          <label className="flex-1">
            <span className="block text-sm font-medium text-slate-700">How far along it</span>
            <input
              value={along}
              onChange={(event) => { setAlong(event.target.value); setWants(null); }}
              inputMode="text"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder={`e.g. 6'`}
              className="mt-1 min-h-12 w-full rounded-md border border-slate-300 px-3 py-2 tabular-nums
                         focus:border-sky-500 focus:outline-none"
            />
          </label>
          <label className="flex-1">
            <span className="block text-sm font-medium text-slate-700">How high (if it matters)</span>
            <input
              value={high}
              onChange={(event) => { setHigh(event.target.value); setWants(null); }}
              inputMode="text"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder={`e.g. 7' 6"`}
              className="mt-1 min-h-12 w-full rounded-md border border-slate-300 px-3 py-2 tabular-nums
                         focus:border-sky-500 focus:outline-none"
            />
          </label>
        </div>

        <label className="block">
          <span className="block text-sm font-medium text-slate-700">What you found</span>
          <textarea
            value={note}
            onChange={(event) => { setNote(event.target.value); setWants(null); }}
            rows={2}
            placeholder="2x10 joists east to west, 16 in centres"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2
                       focus:border-sky-500 focus:outline-none"
          />
        </label>

        <button
          type="button"
          onClick={add}
          className="min-h-12 w-full rounded-md bg-slate-900 px-5 font-semibold text-white
                     active:bg-slate-700"
        >
          Pin it
        </button>
        <Wants say={wants} />
      </div>

      {tags.length > 0 && (
        <ul className="mt-5 divide-y divide-slate-100 border-t border-slate-200 pt-2">
          {tags.map((tag) => (
            <li key={tag.id} className="flex items-start justify-between gap-3 py-3">
              <span className="text-sm text-slate-800">{describeTag(tag)}</span>
              <button
                type="button"
                onClick={() => onRemove(tag.id)}
                aria-label={`Take off ${describeTag(tag)}`}
                className="min-h-11 shrink-0 rounded-md border border-slate-300 px-3 text-sm
                           font-medium text-slate-700 active:bg-slate-100"
              >
                Take it off
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
