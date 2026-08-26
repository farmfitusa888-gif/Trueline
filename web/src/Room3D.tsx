import { useMemo, useRef, useState } from 'react';
import { type Footprint } from '../../core/src/obstruction.ts';
import { CONVENTIONAL_CUT_HEIGHT, cutAt, cutStops } from '../../core/src/section.ts';
import {
  type Camera,
  type Standing,
  DEFAULT_CAMERA,
  project,
  projectFrom,
  standingInside,
} from '../../core/src/project.ts';
import type { Room } from '../../core/src/room.ts';
import { useUnits } from './units.tsx';

/**
 * The room, from somewhere other than straight above.
 *
 * The point of this screen is not that it looks like a room. It is that it is
 * still the plan: every face carries the id of the wall it came from, so
 * tapping a wall here selects the same wall the tape box re-solves. A scanner
 * writes a `room.usdz` and Apple will happily show it, and you cannot do
 * anything with it — a mesh does not know which triangle is the wall you just
 * measured.
 *
 * Drag to walk around it. That is the whole interaction, because a contractor
 * holding a phone in one hand has one thumb.
 *
 * ## Two places to look from
 *
 * **Around it** orbits: the room turned and tipped back, walls between the
 * viewer and the room taken off so you can see in. Right for showing somebody
 * the shape of a room.
 *
 * **Stand inside** puts the viewer in it, in perspective, with the ceiling on.
 * Right for the question a plan cannot answer -- what does it actually look
 * like from the door -- and for a client, who sees a diagram in a plan and
 * their own kitchen in this.
 *
 * Both draw from the same model and both produce the same `Facet`s, so tapping
 * a wall works identically in either and selects the wall the tape box
 * re-solves. That is the whole reason this is drawn from the room rather than
 * from the scanner's mesh.
 *
 * ## And a plane through it
 *
 * **Cut it** slices the room at a height and takes everything above off. It is
 * the oldest drawing convention there is and the one a remodeler reads without
 * being taught: cut at four foot, look down, and the base cabinets, the pony
 * wall and the opening that is not a door are all suddenly legible.
 *
 * Where the plane falls, which walls it passes through and which openings it
 * crosses are all `section.ts`'s answers. This asks and draws; it decides
 * nothing, which is why a pony wall comes out whole rather than sawn off at a
 * plane that passes over it.
 */

const SIZE = 1000;

function ink(shade: number, selected: boolean): string {
  if (selected) return `hsl(24 78% ${Math.round(38 + shade * 18)}%)`;
  // The same slate the plan uses, lit by the face's own angle.
  return `hsl(214 20% ${Math.round(28 + shade * 52)}%)`;
}

export function Room3D({
  room,
  selected,
  onSelect,
  footprints = [],
  furniture = true,
}: {
  readonly room: Room;
  readonly selected: string | null;
  readonly onSelect: (wallId: string | null) => void;
  /** What the scan found standing in the room. */
  readonly footprints?: readonly Footprint[];
  /** Whether to draw it. The same switch as the blueprint's. */
  readonly furniture?: boolean;
}) {
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);
  const [inside, setInside] = useState<Standing | null>(null);
  /** Where the plane sits, or nothing for the whole room. */
  const [plane, setPlane] = useState<bigint | null>(null);
  const { len } = useUnits();
  // A drag is a turn, not a tap. Held in a ref so a re-render mid-drag cannot
  // lose where the finger started.
  const drag = useRef<{
    x: number;
    y: number;
    from: Camera;
    /** Where the viewer was standing when the drag began, if inside. */
    standing: Standing | null;
    moved: boolean;
  } | null>(null);
  // `click` fires after `pointerup`, by which time the drag is already cleared,
  // so asking `drag.current?.moved` inside the click handler always read
  // undefined and every drag that ended over a wall selected it. The answer has
  // to outlive the gesture.
  const wasDrag = useRef(false);

  const view = useMemo(() => {
    try {
      // A plane belongs to the orbit view. From inside a room, a cut at four
      // foot puts the viewer's own head above the plane and shows them the
      // tops of their own walls disappearing, which is not a drawing of
      // anything.
      const section = plane !== null && !inside ? cutAt(room, { height: plane }) : undefined;
      return {
        projection: inside
          ? projectFrom(room, inside, SIZE, furniture ? footprints : [])
          : project(room, camera, SIZE, furniture ? footprints : [], section),
        section,
        trouble: null as string | null,
      };
    } catch (error) {
      return {
        projection: null,
        section: undefined,
        trouble: error instanceof Error ? error.message : String(error),
      };
    }
  }, [room, camera, inside, footprints, furniture, plane]);

  /**
   * The heights worth stopping at, tallest first.
   *
   * Not a free slider. Every one of these is somewhere in the room -- the top
   * of a pony wall, a window sill, a door head, and the conventional four foot
   * -- so every stop shows something rather than most of them showing the same
   * picture a fraction shorter.
   */
  const stops = useMemo(() => {
    try {
      const found = cutStops(room);
      return found.length > 0 ? found : [CONVENTIONAL_CUT_HEIGHT];
    } catch {
      return [];
    }
  }, [room]);

  if (!view.projection) {
    return (
      <p role="alert" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
        {view.trouble} Switch to Blueprint above — the plan does not need a camera.
      </p>
    );
  }

  const start = (x: number, y: number) => {
    drag.current = { x, y, from: camera, standing: inside, moved: false };
  };

  const move = (x: number, y: number) => {
    const at = drag.current;
    if (!at) return;
    const dx = x - at.x;
    const dy = y - at.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) at.moved = true;
    if (at.standing) {
      // From inside, a drag turns your head. Dragging left has to look left,
      // which is the opposite sign from orbiting: out there you are pushing the
      // room around, in here you are turning yourself.
      setInside({
        ...at.standing,
        turn: at.standing.turn - dx * 0.3,
        tilt: Math.max(-85, Math.min(85, at.standing.tilt + dy * 0.25)),
      });
      return;
    }
    setCamera({
      turn: at.from.turn + dx * 0.4,
      tilt: Math.max(6, Math.min(86, at.from.tilt + dy * 0.3)),
    });
  };

  const end = () => {
    wasDrag.current = drag.current?.moved ?? false;
    drag.current = null;
  };

  return (
    <div className="select-none">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="w-full touch-none"
        role="img"
        aria-label={
          inside
            ? `Standing in ${room.name}, looking around`
            : `${room.name} in three dimensions`
        }
        onPointerDown={(event) => {
          // Captured on the svg, not on the polygon under the finger: the
          // polygons are re-keyed as the depth order changes while turning, so
          // React unmounts the captured element mid-drag and the rotation
          // sticks halfway through the gesture.
          event.currentTarget.setPointerCapture?.(event.pointerId);
          start(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => move(event.clientX, event.clientY)}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {view.projection.facets.map((facet, i) => {
          const isWall = facet.kind !== 'floor' && facet.kind !== 'object';
          const isSelected = isWall && facet.wallId === selected;
          return (
            <polygon
              key={`${facet.wallId}-${facet.kind}-${facet.openingKind ?? ''}-${i}`}
              points={facet.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
              fill={
                facet.kind === 'floor'
                  // The ceiling arrives as a floor-kind facet called `ceiling`.
                  // Drawn paler than the floor so a room seen from inside does
                  // not read as two identical slabs.
                  ? facet.wallId === 'ceiling'
                    ? 'rgb(var(--c-sunk))'
                    : 'rgb(var(--c-sunk))'
                  : facet.kind === 'object'
                    // Warm and pale against the room's cool slate, so a box
                    // reads as something standing in the room rather than as
                    // part of the building.
                    ? `hsl(28 24% ${Math.round(52 + facet.shade * 34)}%)`
                    : facet.kind === 'opening'
                      ? facet.openingKind === 'window'
                        ? 'rgb(var(--c-glass))'
                        : 'rgb(var(--c-sunk))'
                      : ink(facet.shade, isSelected)
              }
              stroke={
                isSelected ? 'rgb(var(--c-accent))' : facet.kind === 'object' ? 'rgb(var(--c-scannedEdge))' : 'rgb(var(--c-ink))'
              }
              strokeWidth={isSelected ? 6 : facet.kind === 'object' ? 1 : 1.5}
              strokeLinejoin="round"
              className={isWall ? 'cursor-pointer' : undefined}
              onClick={(event) => {
                event.stopPropagation();
                // A drag that ended on a wall is not a tap on it.
                if (wasDrag.current) return;
                if (isWall) onSelect(isSelected ? null : facet.wallId);
              }}
            />
          );
        })}
      </svg>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-500">
        <p>
          {inside
            ? 'Drag to look around. Tap a wall to measure it.'
            : 'Drag to walk around it. Tap a wall to measure it.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setInside(inside ? null : standingInside(room))}
            aria-pressed={inside !== null}
            className={`min-h-11 rounded-md px-3 font-medium ${
              inside
                ? 'bg-slate-900 text-white active:bg-slate-700'
                : 'border border-slate-300 text-slate-700 active:bg-slate-100'
            }`}
          >
            {inside ? 'Back outside' : 'Stand inside'}
          </button>
          <button
            type="button"
            onClick={() => (inside ? setInside(standingInside(room)) : setCamera(DEFAULT_CAMERA))}
            className="min-h-11 rounded-md border border-slate-300 px-3 font-medium text-slate-700 active:bg-slate-100"
          >
            Straighten up
          </button>
        </div>
        {view.projection.hidden.length > 0 && (
          <p>
            {view.projection.hidden.length} wall
            {view.projection.hidden.length === 1 ? '' : 's'}{' '}
            {inside ? 'behind you' : 'taken off so you can see in'}
          </p>
        )}
      </div>

      {/* The horizontal section. Only outside: from inside the room a plane at
          four foot cuts through the viewer's own head. */}
      {!inside && stops.length > 0 && (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPlane(plane === null ? (stops.find((h) => h === CONVENTIONAL_CUT_HEIGHT) ?? stops[0]!) : null)}
              aria-pressed={plane !== null}
              className={`min-h-11 rounded-md px-3 text-sm font-medium ${
                plane !== null
                  ? 'bg-slate-900 text-white active:bg-slate-700'
                  : 'border border-slate-300 text-slate-700 active:bg-slate-100'
              }`}
            >
              {plane !== null ? 'Whole room' : 'Cut it'}
            </button>
            {plane !== null && (
              <span className="text-sm text-slate-700">
                Cut at <strong className="font-mono tabular-nums">{len(plane)}</strong>, looking down
              </span>
            )}
          </div>

          {plane !== null && (
            <>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {stops.map((height) => (
                  <button
                    key={String(height)}
                    type="button"
                    onClick={() => setPlane(height)}
                    aria-pressed={height === plane}
                    aria-label={`Cut at ${len(height)}`}
                    className={`min-h-11 rounded-md px-2.5 text-sm font-mono tabular-nums ${
                      height === plane
                        ? 'bg-sky-700 font-semibold text-white'
                        : 'border border-slate-300 text-slate-700 active:bg-slate-100'
                    }`}
                  >
                    {len(height)}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                Every height here is somewhere in this room — the top of a wall that
                stops short, a window sill, a door head — and{' '}
                <span className="font-mono tabular-nums">{len(CONVENTIONAL_CUT_HEIGHT)}</span>, which is
                where a drawing is cut by convention: above the counters, below the door heads.
                {view.section && view.section.needsSillHeight.length > 0 && (
                  <>
                    {' '}
                    <span className="text-amber-800">
                      {view.section.needsSillHeight.length} window
                      {view.section.needsSillHeight.length === 1 ? ' has' : 's have'} no recorded
                      sill, so the plane cannot say whether it crosses{' '}
                      {view.section.needsSillHeight.length === 1 ? 'it' : 'them'}. Set the sill
                      under the wall to find out.
                    </span>
                  </>
                )}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                A cut moves no number. It is a way of looking at the room, not a change to it.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
