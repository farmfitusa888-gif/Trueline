import { type ReactNode, useMemo } from 'react';
import { useUnits } from './units.tsx';
import { isVerified, toleranceOf } from '../../core/src/measurement.ts';
import type { Room } from '../../core/src/room.ts';
import {
  type SpanFromPhone,
  type SurfaceMeasure,
  CEILING,
  ceilingArea,
  measuresOn,
  readSurfaceMeasure,
} from '../../core/src/work.ts';
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
 *
 * ## Two different questions about one ceiling
 *
 * *How high is it* is a room number: it multiplies every wall in the room, it
 * is what a takeoff is built on, and it belongs beside the room's other
 * dimensions — which is where `Ceiling` has always been.
 *
 * *What is wrong with it, and what are we doing to it* is a surface question,
 * and it is the one this file never answered:
 *
 * > "ON THE 3D MODEL I TOLD YOU THAT I DIDNT WANT THE CEILING BEING RENDERED
 * >  AND ITS GREAT, BUT WHAT IF I HAVE TO SCAN A CEILING OR POINT IT UP TO
 * >  SOMETHING SIMILAR, HOW WOULD THAT WORK?"
 *
 * Leaving the ceiling out of the 3D view is what makes that view usable, and
 * none of it changes. What was missing is that a water stain, a popcorn
 * ceiling coming off, a soffit and a dropped beam are all things on a surface
 * somebody works on — and the ceiling was the one surface in the room with no
 * panel of its own. `CeilingPanel` is that panel.
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
        <span className="shrink-0 font-semibold font-mono tabular-nums text-slate-900">
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
              className="min-h-11 rounded-md border border-slate-300 px-3 font-medium font-mono tabular-nums
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

/* ------------------------------------------------ the ceiling as a surface */

export interface CeilingPanelProps {
  readonly room: Room;
  /**
   * Shut the panel.
   *
   * The wall panel has a Done button and this one had only the gesture, which
   * is one place the ceiling still behaved unlike a wall. Worse under the 3D
   * view, where there is no floor on screen to tap a second time.
   */
  readonly onClose?: () => void;
  /**
   * What is being done to it, what is wrong with it, what was said about it.
   *
   * Handed in rather than built here, and that is the whole reason this panel
   * is short. The tick list belongs to `WorkOn`, the marks to `Damage`, the
   * photographs to `WallPhotos` and the recordings to `Voice`. A ceiling panel
   * that grew its own copy of any of them would be a second implementation of
   * something a wall already does, and the two would disagree inside a month —
   * which is exactly what Sam asked not to happen: the ceiling gets the same
   * panel a wall gets, not a different one that looks similar.
   */
  readonly children?: ReactNode;
  /**
   * What the phone sent back from the AR Measure screen, for this room.
   *
   * Read here rather than trusted. A reading filed against a surface this room
   * has not got is the failure `readSurfaceMeasure` exists to catch, and it has
   * to be said out loud somewhere: a measurement that is in the file, on no
   * screen, and gone the next time somebody saves is the worst of the three
   * possible outcomes.
   */
  readonly spans?: readonly SpanFromPhone[];
}

/**
 * The ceiling, as a thing somebody works on.
 *
 * It carries what a wall panel carries — how big it is, what is being done to
 * it, what is wrong with it and what was said about it — and one thing a wall
 * does not need: what was measured by pointing the phone at it.
 *
 * ## Why the area is asked for rather than worked out here
 *
 * `ceilingArea` is the takeoff's own ceiling line, asked for one room. The
 * panel and the sheet are then one piece of arithmetic asked twice and cannot
 * drift apart, which is the rule the wall panel's tick boxes already follow. A
 * ceiling that read 419.9 on the panel and 420.0 on the sheet would be two of
 * this app's own screens disagreeing about one room.
 */
export function CeilingPanel({ room, children, spans = [], onClose }: CeilingPanelProps) {
  const { len } = useUnits();
  const area = ceilingArea(room);

  const { measures, refused } = useMemo(() => {
    const kept: SurfaceMeasure[] = [];
    const bad: string[] = [];
    for (const span of spans) {
      try {
        kept.push(readSurfaceMeasure(room, span));
      } catch (error) {
        bad.push(error instanceof Error ? error.message : String(error));
      }
    }
    return { measures: measuresOn(kept, CEILING), refused: bad };
  }, [room, spans]);

  return (
    <section
      className="mt-4 rounded-xl border border-sky-300 bg-white p-4 shadow-sm"
      data-surface="ceiling"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-slate-900">The ceiling</h2>
        <span className="shrink-0 font-semibold font-mono tabular-nums text-slate-900">
          {area} sq ft
        </span>
      </div>

      {/* Where the number came from, said once and plainly. A ceiling has no
          corner to stand in and no run anybody tapes, so "it follows the floor"
          is the only honest account of its area — and it is the same sentence
          the sheet prints under the line. */}
      <p className="mt-1 text-sm text-slate-600">
        It follows the floor, {len(room.ceilingHeight.value)} up. This is the same {area} sq ft the
        sheet charges against the ceiling — not a second sum.
      </p>

      {children}

      <div className="mt-3 border-t border-sky-200 pt-3">
        <h3 className="text-sm font-semibold text-slate-900">
          {measures.length === 0
            ? 'Measured by pointing the phone up'
            : `${measures.length} measured by pointing the phone up`}
        </h3>

        {measures.length === 0 ? (
          <p className="mt-1 text-sm text-slate-600">
            Nothing yet. On the AR Measure screen, touch one end of a soffit, a beam or a stain and
            then the other, and keep the reading — it lands here, on the ceiling, instead of
            disappearing when that screen closes.
          </p>
        ) : (
          <ul className="mt-1 divide-y divide-sky-200">
            {measures.map((measure) => (
              <li key={measure.id} className="py-1.5">
                <span className="block text-sm text-slate-800">{measure.what}</span>
                <span className="block font-mono tabular-nums text-sm text-slate-900">
                  {len(measure.length.value)}
                  {/* The band, always, and never rounded away. A span off a
                      moving camera is not a tape reading, and a screen that
                      stopped saying so is the screen where one of these gets
                      promoted into the ceiling height — which multiplies every
                      square foot of board in the room. */}
                  <span className="ml-2 font-sans text-xs text-slate-500">
                    ± {len(toleranceOf(measure.length))}, pointed at with the phone
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}

        {refused.length > 0 && (
          <ul className="mt-2 space-y-1">
            {refused.map((why) => (
              <li key={why} className="rounded-md bg-amber-50 px-2 py-1 text-sm text-amber-900">
                {why}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/*
          Two sentences the panel could not say until it had a fixed address.

          It opens now by tapping the empty middle of the blueprint, and it
          closes the same way — which is how a wall behaves and is the half of
          "opens the ceiling the way tapping a wall opens that wall" that is
          easy to leave out. A wall panel has a Done button; this one has the
          gesture and nothing else, so the gesture has to be written down. It is
          said in terms of the blueprint on purpose: the panel is on screen
          under the 3D view as well, and there is no floor to tap in that one.

          And the 3D view it points at is now directly above it rather than
          somewhere else in the app, so it is named as such.
      */}
      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        The 3D view above still leaves the ceiling off, which is what makes it possible to see into
        the room at all. <strong>Look up</strong> there puts the ceiling back on its own, with the
        walls dropped away. Tap the middle of the room on the blueprint again to close this.
      </p>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="mt-3 min-h-11 w-full rounded-md border border-slate-300 px-4 text-sm
                     font-medium text-slate-700 active:bg-slate-100"
        >
          Done
        </button>
      )}
    </section>
  );
}
