import { useEffect, useMemo, useRef, useState } from 'react';
import { startingCeiling } from '../../core/src/company.ts';
import { NM_PER_INCH, formatFeetInches, parseLength } from '../../core/src/length.ts';
import { verified } from '../../core/src/measurement.ts';
import type { Room } from '../../core/src/room.ts';
import {
  type Corner,
  type Sketch as Shape,
  DEFAULT_GRID,
  addCorner,
  close,
  lengthOf,
  moveCorner,
  progress,
  removeCorner,
  runs,
  sketchToRoom,
  startSketch,
  wouldClose,
} from '../../core/src/sketch.ts';
import { useUnits } from './units.tsx';

/**
 * A room drawn by tapping its corners.
 *
 * ## What this is instead of
 *
 * `Draw.tsx` asks for one wall at a time — a compass direction and a typed
 * length, over and over. It is exact, and it is the only mode where every
 * number is measured from the first keystroke. It is also the thing this was
 * said about, by the first person to use it:
 *
 * > "THIS WAY MAKES IT SO HARD TO DRAW THE ROOM, AND EVEN THEN YOU ARE SO
 * >  RESTRICTED TO A DESIGN, MAYBE HAVE SOME WAY TO MAKE POINTS AND LINES AND
 * >  A WAY TO LABEL THE WALL AFTER CLICKING, AND CHANGE THINGS"
 *
 * Nobody holds a room in their head as a list of compass headings. They hold
 * its shape. So this takes the shape first and leaves the naming and the
 * measuring for afterwards, on whichever wall somebody cares about.
 *
 * Both stay. A typed room is measured from the first keystroke and a tapped one
 * is not, and that difference is the whole reason to keep both.
 *
 * ## What it will not do
 *
 * Claim a tapped room was measured. Every wall this produces is `drawnOn` —
 * derived, with an honest tolerance of one grid square — so the app goes on
 * asking for a tape on one wall running each way, exactly as it does after a
 * scan. See `core/src/sketch.ts`; the rule is tested there and not here.
 */

/** The drawing is this many units across, whatever the screen is. */
const BOARD = 1000;

/** How much room to leave round the shape, as a fraction of the board. */
const MARGIN = 0.12;

export function Sketch({
  onDone,
  onCancel,
}: {
  readonly onDone: (room: Room, name: string) => void;
  readonly onCancel: () => void;
}) {
  const { len, company } = useUnits();

  /** The ceiling this contractor's houses actually have. Same source as `Draw`. */
  const startsAt = useMemo(() => {
    const fromProfile = startingCeiling(company, 'me', new Date().toISOString());
    return fromProfile ? formatFeetInches(fromProfile.value) : `8'`;
  }, [company]);

  const [name, setName] = useState('');
  const [ceiling, setCeiling] = useState('');
  const [shape, setShape] = useState<Shape | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  /** Which corner a finger is dragging, if any. */
  const [dragging, setDragging] = useState<number | null>(null);
  /**
   * How many nanometres one board unit is.
   *
   * Zooming in makes each tap worth less ground, which is the whole point: a
   * six-inch grid is right for placing a wall and wrong for placing a doorway,
   * and the answer is to get closer rather than to make the grid finer
   * everywhere.
   */
  const [zoom, setZoom] = useState(1);

  const board = useRef<SVGSVGElement | null>(null);

  function begin() {
    setTrouble(null);
    let height;
    try {
      height = parseLength(ceiling.trim() === '' ? startsAt : ceiling.trim());
    } catch (error) {
      setTrouble(error instanceof Error ? error.message : String(error));
      return;
    }
    setShape(
      startSketch({
        id: `sketch-${Date.now()}`,
        name: name.trim() === '' ? 'Room' : name.trim(),
        drawnBy: 'me',
        drawnAt: new Date().toISOString(),
        ceilingHeight: verified(height, 'me', new Date().toISOString(), 'stated'),
        grid: DEFAULT_GRID,
      })
    );
  }

  /* --------------------------------------------------------------- the view */

  /**
   * What the board is showing, in nanometres.
   *
   * ## Why this is state and not worked out from the corners
   *
   * It used to refit to the shape on every corner — which sounds helpful and
   * makes the drawing unusable. The ground under your finger moved between one
   * tap and the next, so the second corner of a rectangle landed somewhere else
   * than where you put it, and the shape came out as something you did not
   * draw. Caught by drawing a rectangle with a script: four taps at the corners
   * of a box produced walls of 5'4⅞", 6'6" and 8'.
   *
   * So the view is fixed when drawing starts and only ever **grows** — never
   * shrinks, never re-centres. A corner near the edge pushes the frame out and
   * everything already drawn stays exactly where it was on screen.
   */
  const [view, setView] = useState({
    minX: -(30n * 12n * NM_PER_INCH) / 2n,
    minY: -(30n * 12n * NM_PER_INCH) / 2n,
    span: 30n * 12n * NM_PER_INCH,
  });

  useEffect(() => {
    if (!shape || shape.corners.length === 0) return;
    const xs = shape.corners.map((c) => c.x);
    const ys = shape.corners.map((c) => c.y);
    const low = { x: xs.reduce((a, b) => (a < b ? a : b)), y: ys.reduce((a, b) => (a < b ? a : b)) };
    const high = { x: xs.reduce((a, b) => (a > b ? a : b)), y: ys.reduce((a, b) => (a > b ? a : b)) };
    const pad = (view.span * BigInt(Math.round(MARGIN * 100))) / 100n;

    const needs =
      low.x < view.minX + pad ||
      low.y < view.minY + pad ||
      high.x > view.minX + view.span - pad ||
      high.y > view.minY + view.span - pad;
    if (!needs) return;

    // Grow around what is already there, keeping the middle of the shape in
    // the middle of the board. Half as big again each time, so this happens a
    // handful of times on the biggest room rather than on every corner.
    const wide = high.x - low.x;
    const tall = high.y - low.y;
    const biggest = wide > tall ? wide : tall;
    const wanted = (biggest * 3n) / 2n + pad * 2n;
    const span = wanted > view.span ? wanted : (view.span * 3n) / 2n;
    setView({
      minX: (low.x + high.x) / 2n - span / 2n,
      minY: (low.y + high.y) / 2n - span / 2n,
      span,
    });
  }, [shape, view]);

  /** Nanometres, given a point on the board. */
  const toGround = (px: number, py: number): Corner => {
    const span = Number(view.span) / zoom;
    return {
      x: view.minX + BigInt(Math.round((px / BOARD) * span + (Number(view.span) - span) / 2)),
      // Screen y grows downward and north grows up.
      y: view.minY + BigInt(Math.round(((BOARD - py) / BOARD) * span + (Number(view.span) - span) / 2)),
    };
  };

  /** A point on the board, given nanometres. */
  const toBoard = (at: Corner): { x: number; y: number } => {
    const span = Number(view.span) / zoom;
    const left = Number(view.minX) + (Number(view.span) - span) / 2;
    const bottom = Number(view.minY) + (Number(view.span) - span) / 2;
    return {
      x: ((Number(at.x) - left) / span) * BOARD,
      y: BOARD - ((Number(at.y) - bottom) / span) * BOARD,
    };
  };

  const where = (event: { clientX: number; clientY: number }): Corner | null => {
    const svg = board.current;
    if (!svg) return null;
    const box = svg.getBoundingClientRect();
    return toGround(
      ((event.clientX - box.left) / box.width) * BOARD,
      ((event.clientY - box.top) / box.height) * BOARD
    );
  };

  /* -------------------------------------------------------------- the taps */

  function tap(event: React.PointerEvent<SVGSVGElement>) {
    if (!shape || dragging !== null) return;
    const at = where(event);
    if (!at) return;
    try {
      setTrouble(null);
      setShape(wouldClose(shape, at) ? close(shape) : addCorner(shape, at));
    } catch (error) {
      setTrouble(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    if (dragging === null) return;
    const move = (event: PointerEvent) => {
      const at = where(event);
      if (at && shape) setShape(moveCorner(shape, dragging, at));
    };
    const up = () => setDragging(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [dragging, shape, zoom, view]);

  /* ------------------------------------------------------------ what to show */

  const state = shape ? progress(shape) : null;
  const lines = shape ? runs(shape) : [];

  /** The grid, as lines rather than a pattern, so it lands on real feet. */
  const grid = useMemo(() => {
    if (!shape) return [];
    const span = Number(view.span) / zoom;
    const step = Number(shape.grid);
    // Never more than about sixty lines each way; below that a phone draws a
    // grey rectangle rather than a grid, and it costs a frame to do it.
    const every = Math.max(1, Math.ceil(span / step / 60));
    const out: { x1: number; y1: number; x2: number; y2: number; strong: boolean }[] = [];
    const left = Number(view.minX) + (Number(view.span) - span) / 2;
    const bottom = Number(view.minY) + (Number(view.span) - span) / 2;
    const first = Math.ceil(left / step / every) * step * every;
    for (let g = first; g < left + span; g += step * every) {
      const x = ((g - left) / span) * BOARD;
      // A foot line is darker than a six-inch one, so the eye has something to
      // count by.
      const strong = Math.abs(g % Number(12n * NM_PER_INCH)) < 1;
      out.push({ x1: x, y1: 0, x2: x, y2: BOARD, strong });
    }
    const firstY = Math.ceil(bottom / step / every) * step * every;
    for (let g = firstY; g < bottom + span; g += step * every) {
      const y = BOARD - ((g - bottom) / span) * BOARD;
      const strong = Math.abs(g % Number(12n * NM_PER_INCH)) < 1;
      out.push({ x1: 0, y1: y, x2: BOARD, y2: y, strong });
    }
    return out;
  }, [shape, view, zoom]);

  /* ---------------------------------------------------------------- setting up */

  if (!shape) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">Draw the room</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          Tap its corners the way you would walk round it. They join up as you go, and
          tapping the first one again closes it. Then tap any wall to name it or put a tape
          reading on it. <strong>No LiDAR, no camera, any shape.</strong>
        </p>

        <label className="mt-4 block">
          <span className="text-sm font-medium text-slate-700">What to call it</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Kitchen"
            className="mt-1 min-h-12 w-full rounded-md border border-slate-300 px-3 py-2
                       focus:border-sky-500 focus:outline-none"
          />
        </label>

        <label className="mt-3 block">
          <span className="text-sm font-medium text-slate-700">Ceiling height</span>
          <input
            value={ceiling}
            onChange={(event) => setCeiling(event.target.value)}
            placeholder={startsAt}
            inputMode="text"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="mt-1 min-h-12 w-full rounded-md border border-slate-300 px-3 py-2
                       font-mono tabular-nums focus:border-sky-500 focus:outline-none"
          />
          <span className="mt-1 block text-xs text-slate-500">
            Leave it and it uses {startsAt}, from Your business.
          </span>
        </label>

        {trouble && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {trouble}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={begin}
            className="min-h-12 flex-1 rounded-md bg-slate-900 px-6 font-semibold text-white
                       active:bg-slate-700"
          >
            Start drawing
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="min-h-12 rounded-md border border-slate-300 px-4 font-medium text-slate-700
                       active:bg-slate-100"
          >
            Cancel
          </button>
        </div>
      </section>
    );
  }

  /* ------------------------------------------------------------- the drawing */

  const first = shape.corners[0];

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">{shape.name}</h2>
        <span className="font-mono text-xs tabular-nums text-slate-500">
          {state!.corners} corner{state!.corners === 1 ? '' : 's'}
        </span>
      </div>

      <p className="mt-1 text-sm text-slate-600">{state!.saying}</p>

      <svg
        ref={board}
        viewBox={`0 0 ${BOARD} ${BOARD}`}
        className="mt-3 w-full touch-none rounded-md border border-slate-200 bg-slate-50"
        role="application"
        aria-label={`Drawing ${shape.name}. Tap to place a corner.`}
        onPointerDown={tap}
      >
        {grid.map((line, i) => (
          <line
            key={i}
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke="rgb(var(--c-rule))"
            strokeWidth={line.strong ? 1.6 : 0.8}
          />
        ))}

        {/* The walls so far, with what each one measures on it. */}
        {lines.map((run, i) => {
          const a = toBoard(run.from);
          const b = toBoard(run.to);
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          return (
            <g key={i}>
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="rgb(var(--c-ink))"
                strokeWidth={6}
                strokeLinecap="round"
              />
              <text
                x={mid.x}
                y={mid.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={30}
                fontWeight={600}
                fill="rgb(var(--c-ink))"
                stroke="rgb(var(--c-ground))"
                strokeWidth={7}
                paintOrder="stroke"
                strokeLinejoin="round"
                className="pointer-events-none select-none"
              >
                {len(lengthOf(run.from, run.to))}
              </text>
            </g>
          );
        })}

        {/* The corners, draggable. The first is marked, because tapping it is
            what closes the room. */}
        {shape.corners.map((corner, i) => {
          const at = toBoard(corner);
          const isFirst = i === 0 && !shape.closed && shape.corners.length >= 3;
          return (
            <circle
              key={i}
              cx={at.x}
              cy={at.y}
              r={isFirst ? 22 : 16}
              fill={isFirst ? 'rgb(var(--c-accent))' : 'rgb(var(--c-raise))'}
              stroke="rgb(var(--c-ink))"
              strokeWidth={4}
              className="cursor-pointer"
              onPointerDown={(event) => {
                event.stopPropagation();
                if (isFirst) {
                  setShape(close(shape));
                  return;
                }
                setDragging(i);
              }}
            >
              <title>{isFirst ? 'Tap to close the room' : `Corner ${i + 1} — drag to move`}</title>
            </circle>
          );
        })}
      </svg>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(8, z * 1.6))}
          className="min-h-11 rounded-md border border-slate-300 px-3 font-medium text-slate-700
                     active:bg-slate-100"
        >
          Closer
        </button>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(1, z / 1.6))}
          className="min-h-11 rounded-md border border-slate-300 px-3 font-medium text-slate-700
                     active:bg-slate-100"
        >
          Further out
        </button>
        <span className="font-mono text-xs tabular-nums text-slate-500">
          one square is {len(shape.grid)}
        </span>
      </div>

      {shape.corners.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              try {
                setTrouble(null);
                setShape(removeCorner(shape, shape.corners.length - 1));
              } catch (error) {
                setTrouble(error instanceof Error ? error.message : String(error));
              }
            }}
            className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium
                       text-slate-700 active:bg-slate-100"
          >
            Take the last corner back
          </button>
          {state!.canClose && (
            <button
              type="button"
              onClick={() => setShape(close(shape))}
              className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium
                         text-slate-700 active:bg-slate-100"
            >
              Close the room
            </button>
          )}
        </div>
      )}

      {trouble && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {trouble}
        </p>
      )}

      {shape.closed && (
        <div className="mt-4 rounded-md bg-slate-100 p-3">
          <p className="text-sm font-semibold text-slate-900">
            {state!.walls.length} walls, drawn — not measured.
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            Every length here came off the grid, good to about {len(shape.grid)}. The app will
            go on asking for a tape on one wall running each way before it calls this room
            measured, exactly as it does after a scan. Open it and tap a wall to put real
            readings on it.
          </p>
          <button
            type="button"
            onClick={() => {
              try {
                onDone(sketchToRoom(shape), shape.name);
              } catch (error) {
                setTrouble(error instanceof Error ? error.message : String(error));
              }
            }}
            className="mt-3 min-h-12 w-full rounded-md bg-slate-900 px-6 font-semibold text-white
                       active:bg-slate-700"
          >
            Open it
          </button>
        </div>
      )}

      {first && !shape.closed && (
        <p className="mt-3 text-xs text-slate-500">
          The amber corner is where you started. Tap it to close the room.
        </p>
      )}
    </section>
  );
}
