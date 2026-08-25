import { useUnits } from './units.tsx';
import { isVerified, toleranceOf } from '../../core/src/measurement.ts';
import type { Room } from '../../core/src/room.ts';
import { Measure } from './Measure.tsx';

/**
 * How high the room is — the number that multiplies every square foot of board.
 *
 * The import takes it from the tallest wall in the scan, on the reasoning that a
 * shorter one is a pony wall or a soffit rather than the room getting lower.
 * That is the right guess and Sam's kitchen proves it — one wall at 2.13 m among
 * seven at 2.4257 m — and it is still a guess carrying the sensor's band. Two
 * inches over 80 ft of wall is 13 sq ft of drywall and two coats on it, and
 * unlike a wall length nobody ever looks at it and disagrees, because a ceiling
 * has no corner to stand in.
 *
 * A stud is 92 5/8 in and finishes an 8 ft wall; that is what the shortcut under
 * the field is. It is offered as a guess to check, not as an answer: it goes in
 * as `stated`, and the sheet says so.
 */

const COMMON = [`8'`, `9'`, `10'`];

export function Ceiling({
  room,
  onSet,
}: {
  readonly room: Room;
  readonly onSet: (text: string, how: 'stated' | 'tape') => void;
}) {
  const { len } = useUnits();
  const height = room.ceilingHeight;
  const measured = isVerified(height);
  const pony = room.walls.filter((w) => w.height !== undefined);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-slate-900">How high is the ceiling?</h2>
        <span className="shrink-0 font-semibold tabular-nums text-slate-900">
          {len(height.value)}
        </span>
      </div>

      <p className="mt-1 text-sm text-slate-600">
        {measured ? (
          <>Measured. Every square foot of drywall and paint is built on this.</>
        ) : (
          <>
            The scan took this from the tallest wall it saw, ± {len(toleranceOf(height))}.
            Two inches out over this room is about {estimate(room)} of board and two coats on it.
          </>
        )}
      </p>

      <div className="mt-3 print:hidden">
        <Measure
          name="the ceiling height"
          label={`e.g. ${len(height.value)}`}
          onSubmit={(text) => onSet(text, 'tape')}
        />
      </div>

      {!measured && (
        <div className="mt-2 flex flex-wrap items-baseline gap-2 print:hidden">
          <span className="text-sm text-slate-500">or, if you know it:</span>
          {COMMON.map((text) => (
            <button
              key={text}
              type="button"
              onClick={() => onSet(text, 'stated')}
              className="min-h-11 rounded-md border border-slate-300 px-3 font-medium tabular-nums
                         text-slate-700 active:bg-slate-100"
            >
              {text}
            </button>
          ))}
        </div>
      )}

      {pony.length > 0 && (
        <p className="mt-3 text-sm text-slate-600">
          {pony.map((w) => `${w.id} stops at ${len(w.height!.value)}`).join(', ')} — a
          pony wall or a bar. It still takes board, paint and base; it just does not go up.
        </p>
      )}
    </section>
  );
}

/**
 * What two inches on the ceiling is worth in this actual room.
 *
 * Built from the room's own built wall run rather than a stock figure, because a
 * number a person can check against their own walls is the only kind worth
 * printing.
 */
function estimate(room: Room): string {
  const IN2 = 2n * 25_400_000n;
  const run = room.walls
    .filter((w) => !w.open)
    .reduce((total, w) => total + w.length.value, 0n);
  const FT = 304_800_000n;
  const sqft = (run * IN2) / (FT * FT);
  return `${sqft} sq ft`;
}
