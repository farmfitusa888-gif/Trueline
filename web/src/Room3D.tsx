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
import { type Room, runLength } from '../../core/src/room.ts';
import { fitInside, openingLabels, wallLabels } from '../../core/src/wallLabel.ts';
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
 * Drag to walk around it, tap a wall to select it. That is the whole
 * interaction, because a contractor holding a phone in one hand has one thumb —
 * and the two have to be told apart by movement alone, which is what `move`
 * does and what was wrong with it for as long as this screen existed.
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
  /**
   * How much of the drawing is on screen, as an SVG `viewBox`.
   *
   * ## Why zooming lives here and not in the projection
   *
   * > "PIC 4: MAKE IT EASIER TO NAVIGATE INSIDE THE 3D MODEL ON THE PHONE AND
   * >  DESKTOP"
   *
   * Until now the only thing a finger could do to this picture was turn it.
   * There was no zoom at all — on a phone, on a desktop, inside or outside —
   * so a wall label two rooms away was unreadable and there was nothing to do
   * about it.
   *
   * The fix does **not** touch `project()`. That function turns a measured room
   * into screen coordinates and it is tested against those coordinates; putting
   * a zoom factor inside it would make every one of those tests a test of the
   * zoom as well. A `viewBox` is the SVG-native way to say "show me this part
   * of the same drawing", it costs nothing to animate, and — the point — it
   * cannot move a number, because it is applied after every number has been
   * worked out.
   */
  const [box, setBox] = useState({ x: 0, y: 0, size: SIZE });
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
    /** The finger, and the element to hand it to once this becomes a drag. */
    pointer: number;
    svg: SVGSVGElement;
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

  // Below the early return, and that is deliberate rather than lazy: there is
  // nothing to label when there is no projection, and computing labels for a
  // view that will not be drawn is work done to be thrown away. It is a walk
  // over a few dozen facets, not a hook, so its place in the body is free.
  const labels = wallLabels(view.projection.facets, SIZE);
  // Every wall's length, by its id, so a label can carry the measurement as
  // well as the name. Formatted by `len`, which is the app's units and not this
  // file's business -- nothing here reads a nanometre.
  const lengthOf = new Map(room.walls.map((w) => [w.id, len(runLength(w))]));
  // And every opening's size, for the hole it is drawn as. Looked up by the id
  // the projection carries rather than matched by geometry: a size printed on
  // the wrong window is worse than no size at all.
  const sizeOf = new Map(
    room.walls.flatMap((w) =>
      (w.openings ?? []).map((o) => [o.id, `${len(o.width.value)} × ${len(o.height.value)}`])
    )
  );
  const openings = openingLabels(view.projection.facets, SIZE);

  /**
   * Where a label of this many characters actually fits.
   *
   * `wallLabels` puts the point in the middle of the visible part of a face,
   * which is right — and not enough. Text is centred on its point and runs half
   * its width either way, so a wall at the edge of the picture had its name's
   * middle on screen and both ends cut off. "Wall 1" came out as "Wall 1" with
   * the 1 missing and a door's size as "3' × 6'".
   *
   * The width is estimated rather than measured: measuring means rendering the
   * text, reading it back and re-rendering, once per label, every frame of a
   * drag. 0.58 em per character is close enough for a bold sans face, and being
   * a few pixels generous only ever pulls a label further inside.
   */
  const place = (
    at: { x: number; y: number },
    face: { left: number; right: number; top: number; bottom: number },
    text: string,
    fontSize: number,
    lines: number
  ) =>
    fitInside(
      at,
      face,
      { width: (text.length * fontSize * 0.58) / 2, height: (fontSize * 1.2 * lines) / 2 },
      SIZE
    );

  /**
   * Zooms about a point, keeping whatever is under it under it.
   *
   * `at` is in the svg's own units. Clamped both ways: 1x is the whole drawing
   * and there is never a reason to see less than that, and 8x is the point
   * where a wall label fills the screen.
   */
  const zoomAbout = (factor: number, at: { x: number; y: number }) => {
    setBox((was) => {
      const size = Math.max(SIZE / 8, Math.min(SIZE, was.size / factor));
      if (size === was.size) return was;
      // The fraction of the box the point sits at has to survive the change.
      const fx = (at.x - was.x) / was.size;
      const fy = (at.y - was.y) / was.size;
      const x = at.x - fx * size;
      const y = at.y - fy * size;
      const limit = SIZE - size;
      return {
        size,
        x: Math.max(Math.min(x, limit), 0),
        y: Math.max(Math.min(y, limit), 0),
      };
    });
  };

  /** Where a client point lands in the svg's own units, at the current zoom. */
  const inSvg = (svg: SVGSVGElement, x: number, y: number) => {
    const rect = svg.getBoundingClientRect();
    return {
      x: box.x + ((x - rect.left) / rect.width) * box.size,
      y: box.y + ((y - rect.top) / rect.height) * box.size,
    };
  };

  /**
   * Every finger currently down, so two of them can be told from one.
   *
   * One finger turns the room, which is what it has always done. Two pinch and
   * pan, which is what every other picture on a phone does and what this one
   * could not.
   */
  const fingers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ gap: number; at: { x: number; y: number } } | null>(null);

  const spanOf = () => {
    const [a, b] = [...fingers.current.values()];
    if (!a || !b) return null;
    return {
      gap: Math.hypot(a.x - b.x, a.y - b.y),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  };

  const start = (x: number, y: number, pointer: number, svg: SVGSVGElement) => {
    fingers.current.set(pointer, { x, y });
    if (fingers.current.size >= 2) {
      // A second finger ends the turn that the first one started, so a pinch
      // does not also spin the room.
      drag.current = null;
      const span = spanOf();
      if (span) pinch.current = { gap: span.gap, at: inSvg(svg, span.mid.x, span.mid.y) };
      return;
    }
    drag.current = { x, y, from: camera, standing: inside, moved: false, pointer, svg };
  };

  const move = (x: number, y: number, pointer?: number) => {
    if (pointer !== undefined && fingers.current.has(pointer)) {
      fingers.current.set(pointer, { x, y });
    }
    if (pinch.current && fingers.current.size >= 2) {
      const span = spanOf();
      if (span && span.gap > 0 && pinch.current.gap > 0) {
        zoomAbout(span.gap / pinch.current.gap, pinch.current.at);
        pinch.current = { gap: span.gap, at: pinch.current.at };
      }
      return;
    }
    const at = drag.current;
    if (!at) return;
    const dx = x - at.x;
    const dy = y - at.y;
    if (!at.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
      at.moved = true;
      // Only now, and this is the whole fix. Capturing on `pointerdown` meant
      // the svg owned every gesture from the first touch -- and while a pointer
      // is captured the `click` that follows is dispatched to the capturing
      // element, not to the polygon under the finger. So `onClick` on a wall
      // never fired, in either view, and the screen said "Tap a wall to
      // measure it" while tapping a wall did nothing at all.
      //
      // Capture is still needed once this really is a drag: the polygons are
      // re-keyed as the depth order changes while turning, so React unmounts
      // the element under the finger mid-gesture and the rotation sticks. Both
      // things are true, and the difference between them is three pixels of
      // movement.
      at.svg.setPointerCapture?.(at.pointer);
    }
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

  const end = (pointer?: number) => {
    if (pointer !== undefined) fingers.current.delete(pointer);
    if (fingers.current.size < 2) pinch.current = null;
    const at = drag.current;
    wasDrag.current = at?.moved ?? false;
    // Handed back, so the next tap is hit-tested against the polygons again
    // rather than going to whatever held the last drag.
    //
    // Asked first, and that is not belt and braces. This runs on `pointerup`
    // AND on `pointercancel`, and the browser has already released the capture
    // by the time it dispatches a cancel -- releasing it again throws
    // `InvalidPointerId`. Which, now that `main.tsx` catches what these screens
    // throw, would file a crash report every time somebody's gesture was
    // interrupted by a phone call.
    if (at?.moved && at.svg.hasPointerCapture?.(at.pointer)) {
      at.svg.releasePointerCapture(at.pointer);
    }
    drag.current = null;
  };

  return (
    <div className="select-none">
      <svg
        viewBox={`${box.x} ${box.y} ${box.size} ${box.size}`}
        className="w-full touch-none"
        role="img"
        aria-label={
          inside
            ? `Standing in ${room.name}, looking around`
            : `${room.name} in three dimensions`
        }
        onPointerDown={(event) => {
          // Nothing is captured here. See `move`: capture goes on once the
          // gesture has actually moved, because capturing at the first touch
          // sends the following `click` to the svg instead of to the wall under
          // the finger — which is why tapping a wall did nothing for as long as
          // this screen has existed.
          start(event.clientX, event.clientY, event.pointerId, event.currentTarget);
        }}
        onPointerMove={(event) => move(event.clientX, event.clientY, event.pointerId)}
        onPointerUp={(event) => end(event.pointerId)}
        onPointerCancel={(event) => end(event.pointerId)}
        // A mouse wheel and a trackpad pinch both arrive here, which is the
        // whole of "and desktop". `passive` cannot be set through React, so the
        // page-scroll it would otherwise cause is stopped the ordinary way and
        // the container below has `overscroll-contain` so the page does not
        // rubber-band behind it.
        onWheel={(event) => {
          event.preventDefault();
          const at = inSvg(event.currentTarget, event.clientX, event.clientY);
          zoomAbout(event.deltaY < 0 ? 1.12 : 1 / 1.12, at);
        }}
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

        {/*
            Which wall you are looking at, said on the wall.

            > "WHEN IN 3D MODE, AND YOU ARE INSIDE THE MODEL, THERE SHOULD BE
            >  LABELING ON THE WALLS WITH THE WALL # OR WHICH WALL IT IS"

            Right, and worse than a missing convenience: the claim this view
            makes over a scanner's mesh, written at the top of this file, is
            that every face still knows which wall it is. It then drew four
            identical grey slabs and made you tap each one to find out.

            After the polygons, so a label is never painted over by a nearer
            wall. Where each one goes is `wallLabel.ts` -- one per wall on its
            biggest piece, slivers dropped -- and it reads no dimension and can
            move no number.
        */}
        {labels.map((label) => {
          const length = lengthOf.get(label.wallId) ?? '';
          const size = inside ? 44 : 36;
          const at = place(
            label,
            label,
            label.text.length > length.length ? label.text : length,
            size,
            length ? 2 : 1
          );
          return (
          <text
            key={label.wallId}
            x={at.x}
            y={at.y}
            textAnchor="middle"
            dominantBaseline="middle"
            // In the projection's own 1000-unit box, which renders about 345
            // CSS pixels wide on a phone -- so 44 here is roughly 15px on
            // screen. Sized by measuring the render rather than by picking a
            // number: 30 looked right in the file and came out at ten pixels,
            // which is a label a person on a ladder cannot read.
            fontSize={size}
            fontWeight={600}
            fill="rgb(var(--c-ink))"
            // A halo of the page's own ground, drawn under the letters rather
            // than over them. A wall's fill shades with its angle to the light,
            // so there is no one colour that a label is legible on -- and a
            // drop shadow would be a second thing to keep in step with the
            // theme.
            stroke="rgb(var(--c-ground))"
            strokeWidth={inside ? 10 : 8}
            paintOrder="stroke"
            strokeLinejoin="round"
            className="pointer-events-none select-none"
            // The polygon underneath is what answers a tap. This is a caption
            // on it, and a caption that ate the tap would make the biggest part
            // of every wall unselectable.
            aria-hidden="true"
          >
            <tspan x={at.x} dy="0">{label.text}</tspan>
            {/* The measurement under the name, so the room can be read without
                switching to the blueprint. Same face, one line down. */}
            {length && (
              <tspan x={at.x} dy={inside ? 46 : 38} fontSize={size - 8} fontWeight={500}>
                {length}
              </tspan>
            )}
          </text>
          );
        })}

        {/* Doors and windows, with what they measure printed on them. They are
            already drawn as real holes; this is the size an estimator needs to
            read off one without opening another screen. */}
        {openings.map((hole) => {
          const what =
            hole.kind === 'window' ? 'Window' : hole.kind === 'cased' ? 'Opening' : 'Door';
          const measured = sizeOf.get(hole.openingId) ?? '';
          const size = inside ? 34 : 28;
          const at = place(
            hole,
            hole,
            what.length > measured.length ? what : measured,
            size,
            measured ? 2 : 1
          );
          return (
          <text
            key={hole.openingId}
            x={at.x}
            y={at.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={size}
            fontWeight={600}
            fill="rgb(var(--c-ink))"
            stroke="rgb(var(--c-ground))"
            strokeWidth={inside ? 8 : 7}
            paintOrder="stroke"
            strokeLinejoin="round"
            className="pointer-events-none select-none"
            aria-hidden="true"
          >
            <tspan x={at.x} dy="0">{what}</tspan>
            {measured && (
              <tspan x={at.x} dy={inside ? 36 : 30} fontSize={size - 4} fontWeight={500}>
                {measured}
              </tspan>
            )}
          </text>
          );
        })}
      </svg>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-500">
        <p>
          {inside
            ? 'Drag to look around. Pinch or scroll to zoom. Tap a wall to measure it.'
            : 'Drag to walk around it. Pinch or scroll to zoom. Tap a wall to measure it.'}
          {' '}
          {/* The one dimension that is nowhere else on this view, and that
              every wall's area is multiplied by. Read off the room rather than
              worked out here. */}
          <span className="font-mono tabular-nums">
            Ceiling {len(room.ceilingHeight.value)}.
          </span>
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
          {/* Buttons as well as the gesture, because a gesture nobody is told
              about is a feature nobody has. These zoom about the middle, which
              is where somebody looking at a label has already put it. */}
          <button
            type="button"
            onClick={() => zoomAbout(1.4, { x: box.x + box.size / 2, y: box.y + box.size / 2 })}
            disabled={box.size <= SIZE / 8}
            className="min-h-11 rounded-md border border-slate-300 px-3 font-medium text-slate-700
                       active:bg-slate-100 disabled:opacity-40"
          >
            Closer
          </button>
          <button
            type="button"
            onClick={() => zoomAbout(1 / 1.4, { x: box.x + box.size / 2, y: box.y + box.size / 2 })}
            disabled={box.size >= SIZE}
            className="min-h-11 rounded-md border border-slate-300 px-3 font-medium text-slate-700
                       active:bg-slate-100 disabled:opacity-40"
          >
            Further out
          </button>
          <button
            type="button"
            onClick={() => {
              // The zoom goes back with the angle. Straightening the view and
              // leaving it magnified eight times is not straightening it.
              setBox({ x: 0, y: 0, size: SIZE });
              if (inside) setInside(standingInside(room));
              else setCamera(DEFAULT_CAMERA);
            }}
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
