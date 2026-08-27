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
import { ceilingArea } from '../../core/src/work.ts';
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
 *
 * ## And the one surface none of them shows
 *
 * > "ON THE 3D MODEL I TOLD YOU THAT I DIDNT WANT THE CEILING BEING RENDERED
 * >  AND ITS GREAT, BUT WHAT IF I HAVE TO SCAN A CEILING OR POINT IT UP TO
 * >  SOMETHING SIMILAR, HOW WOULD THAT WORK?"
 *
 * Both halves of that are right. Leaving the ceiling off is what makes the
 * orbit view usable — a room with its lid on is a grey box — so **Look up** is
 * a mode somebody turns on and never the default. It is the exact mirror of
 * the view they already like: the orbit drops the ceiling so you can see in,
 * and this drops the walls so you can see the ceiling.
 *
 * It is not a new projection. It is `projectFrom` with the viewer lying on the
 * floor in the middle of the room looking straight up — which is what a person
 * actually does — and every facet that is not the ceiling left undrawn. On the
 * floor rather than at eye height on purpose: from 5'4" the ceiling is two and
 * a half feet away and you see a patch of it, and from the floor you see the
 * room.
 */

const SIZE = 1000;

/**
 * Under the room, looking up at the ceiling, far enough back to see all of it.
 *
 * The first version of this put the viewer on the floor in the middle of the
 * room, which is what a person does and which draws a blank grey rectangle. A
 * ceiling 9 ft up over a 20 by 21 ft garage has its corners 58 degrees off
 * vertical and the view is 72 degrees wide, so what fills the screen is the
 * middle of the ceiling with no edge of it anywhere — a picture of nothing that
 * looks exactly like a bug.
 *
 * So the eye goes back until the whole ceiling is inside the view. `back` is
 * two fifths of the room's own perimeter, which puts a room's corners around 24
 * degrees off centre: the ceiling fills most of the frame with margin round it,
 * on any shape of room, without this file measuring anything. The perimeter is
 * the one dimension of a room that is already in hand — no corners, no
 * bounding box, no second walk of the outline.
 *
 * That puts the eye below the floor, and that is fine and worth being plain
 * about on screen. A `Standing` is a viewpoint and never a measurement — no
 * provenance, no tolerance, nothing that can reach a dimension — so where it
 * sits is a question about framing, exactly like the zoom.
 *
 * 85 degrees rather than 90 because that is as far as `projectFrom` will look;
 * it clamps there so the picture cannot turn over, and asking for more would be
 * asking for a number the projection does not honour.
 */
function lyingDown(room: Room): Standing {
  const perimeter = room.walls.reduce((total, wall) => total + runLength(wall), 0n);
  const back = (perimeter * 2n) / 5n;
  return { ...standingInside(room), height: room.ceilingHeight.value - back, tilt: 85 };
}

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
  /**
   * Whether the walls are dropped away and only the ceiling is drawn.
   *
   * Kept beside `inside` rather than folded into it because the two are
   * genuinely different questions: `inside` is where the viewer is, and this is
   * what is drawn from there. Looking up is standing inside — every drag, every
   * pinch and every projection is the interior one — with everything except the
   * ceiling left off.
   */
  const [lookUp, setLookUp] = useState(false);
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
          // Nothing standing in the room is drawn while looking up. A fridge is
          // a waist-high box on the floor; between the viewer and the ceiling
          // it is a box across the middle of the one thing being looked at.
          ? projectFrom(room, inside, SIZE, lookUp || !furniture ? [] : footprints)
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
  }, [room, camera, inside, footprints, furniture, plane, lookUp]);

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
  //
  // Nothing while looking up: the wall facets are still in the projection —
  // only the drawing leaves them out — so labelling them would float four wall
  // names and four lengths over a ceiling with no walls under them.
  const labels = lookUp ? [] : wallLabels(view.projection.facets, SIZE);
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
  const openings = lookUp ? [] : openingLabels(view.projection.facets, SIZE);

  /**
   * What is actually drawn.
   *
   * The ceiling arrives from `projectFrom` as a floor-kind facet called
   * `ceiling` — one face, the room's own outline at ceiling height. Looking up
   * keeps that and nothing else, which is what "the walls dropped away" means:
   * they are still measured, still in the projection, and simply not painted.
   */
  const drawn = lookUp
    ? view.projection.facets.filter((f) => f.kind === 'floor' && f.wallId === 'ceiling')
    : view.projection.facets;

  /** Where each wall's name goes round the edge of the ceiling. */
  const ceilingEdges = (() => {
    const face = lookUp ? drawn[0] : undefined;
    if (!face || face.points.length !== room.walls.length) return [];
    const middle = {
      x: face.points.reduce((sum, p) => sum + p.x, 0) / face.points.length,
      y: face.points.reduce((sum, p) => sum + p.y, 0) / face.points.length,
    };
    return room.walls.map((wall, i) => {
      const a = face.points[i]!;
      const b = face.points[(i + 1) % face.points.length]!;
      const at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      // A fifth of the way in from the edge. On the line itself the halo eats
      // the outline of the ceiling; any further in and the name stops reading
      // as belonging to that side.
      return {
        wallId: wall.id,
        length: lengthOf.get(wall.id) ?? '',
        x: at.x + (middle.x - at.x) * 0.2,
        y: at.y + (middle.y - at.y) * 0.2,
      };
    });
  })();

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
        // Looking up stays looking up. Without the floor on this clamp a drag
        // downwards walks the view off the ceiling and onto four walls that are
        // not being drawn, which is a blank screen with no way to tell why.
        tilt: Math.max(lookUp ? 25 : -85, Math.min(85, at.standing.tilt + dy * 0.25)),
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
          lookUp
            ? `The ceiling of ${room.name}, seen from below with the walls dropped away`
            : inside
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
        {drawn.map((facet, i) => {
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
                  // not read as two identical slabs — except while it is the
                  // only thing on the screen, where the pale fill on the page's
                  // own ground is a shape with no substance to it. Lit like a
                  // wall, it reads as a surface somebody is standing under.
                  ? facet.wallId === 'ceiling'
                    ? lookUp
                      ? ink(0.86, false)
                      : 'rgb(var(--c-sunk))'
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

        {/*
            Which wall is which end of the ceiling.

            A ceiling on its own is a quadrilateral with nothing to orient it —
            "the stain is over there" is unsayable about a blank shape. The
            walls are what a person orients by, so their names go round the
            edge, and each one goes on the edge that is actually that wall.

            The correspondence is `projectFrom`'s own: the ceiling face is the
            room's corners in room order, so the edge from corner i to corner
            i+1 is `room.walls[i]` — the same indexing it walks the walls with.
            It only holds while every corner is in front of the eye, which is
            why the count is checked rather than assumed. A clipped face would
            silently shift every name by one, and a wall name on the wrong wall
            is worse than no names at all.
        */}
        {lookUp &&
          ceilingEdges.map((edge) => (
            <text
              key={edge.wallId}
              x={edge.x}
              y={edge.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={34}
              fontWeight={600}
              fill="rgb(var(--c-ink))"
              stroke="rgb(var(--c-ground))"
              strokeWidth={8}
              paintOrder="stroke"
              strokeLinejoin="round"
              className="pointer-events-none select-none"
              aria-hidden="true"
            >
              <tspan x={edge.x} dy="0">{edge.wallId}</tspan>
              <tspan x={edge.x} dy={30} fontSize={28} fontWeight={500}>
                {edge.length}
              </tspan>
            </text>
          ))}

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
          {lookUp
            ? 'The ceiling on its own, from underneath and far enough back to get all of it in. ' +
              'Drag to look around it, pinch or scroll to zoom. The walls are dropped away, not ' +
              'changed — every one of them is still measured and still on the sheet.'
            : inside
              ? 'Drag to look around. Pinch or scroll to zoom. Tap a wall to measure it.'
              : 'Drag to walk around it. Pinch or scroll to zoom. Tap a wall to measure it.'}
          {' '}
          {/* The one dimension that is nowhere else on this view, and that
              every wall's area is multiplied by. Read off the room rather than
              worked out here — and beside it, while the ceiling is the subject,
              how much of it there is: the takeoff's own ceiling line, asked for
              this room, so the picture and the sheet cannot disagree. */}
          <span className="font-mono tabular-nums">
            Ceiling {len(room.ceilingHeight.value)}
            {lookUp ? `, ${ceilingArea(room)} sq ft.` : '.'}
          </span>
          {lookUp && (
            <>
              {' '}Everything else about the ceiling — what is being done to it, what is wrong
              with it, what was measured on it — is on the ceiling panel.
            </>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              // Leaving look-up mode as well, because "back outside" from a
              // ceiling with no walls under it has to put the room back, not
              // put the viewer outside a drawing that is still only a lid.
              setLookUp(false);
              setInside(inside && !lookUp ? null : standingInside(room));
            }}
            aria-pressed={inside !== null && !lookUp}
            className={`min-h-11 rounded-md px-3 font-medium ${
              inside && !lookUp
                ? 'bg-slate-900 text-white active:bg-slate-700'
                : 'border border-slate-300 text-slate-700 active:bg-slate-100'
            }`}
          >
            {inside && !lookUp ? 'Back outside' : 'Stand inside'}
          </button>
          {/*
              The mirror of the view Sam already likes, and never the default.

              The orbit takes the ceiling off so you can see into the room; this
              takes the walls off so you can see the ceiling. It is a mode with
              a name on it rather than something that happens when the camera
              passes under the floor, because the whole reason the default is
              good is that nobody has to think about it.
          */}
          <button
            type="button"
            onClick={() => {
              if (lookUp) {
                setLookUp(false);
                setInside(null);
                setBox({ x: 0, y: 0, size: SIZE });
                return;
              }
              setLookUp(true);
              setInside(lyingDown(room));
              setBox({ x: 0, y: 0, size: SIZE });
            }}
            aria-pressed={lookUp}
            className={`min-h-11 rounded-md px-3 font-medium ${
              lookUp
                ? 'bg-slate-900 text-white active:bg-slate-700'
                : 'border border-slate-300 text-slate-700 active:bg-slate-100'
            }`}
          >
            {lookUp ? 'Put the walls back' : 'Look up'}
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
              // Straightening up while looking up means looking straight up
              // again, not standing back up: the mode is what the button is
              // inside of, and a control that quietly left it would be a
              // control that turned a feature off by accident.
              if (lookUp) setInside(lyingDown(room));
              else if (inside) setInside(standingInside(room));
              else setCamera(DEFAULT_CAMERA);
            }}
            className="min-h-11 rounded-md border border-slate-300 px-3 font-medium text-slate-700 active:bg-slate-100"
          >
            Straighten up
          </button>
        </div>
        {/* Not while looking up: every wall is off, and "4 walls behind you"
            beside a picture with no walls in it reads as a fault rather than as
            the point. What is said instead is in the sentence above. */}
        {!lookUp && view.projection.hidden.length > 0 && (
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
