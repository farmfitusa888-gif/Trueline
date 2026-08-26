import { useMemo, useRef, useState } from 'react';
import { projectFloor } from '../../core/src/floor3d.ts';
import type { Floor } from '../../core/src/floor.ts';
import { type Camera, DEFAULT_CAMERA } from '../../core/src/project.ts';

/**
 * The whole floor, with the roof off.
 *
 * ## Why this is the view that sells the job
 *
 * A homeowner cannot read a floor plan. They have been handed one, they have
 * nodded at it, and then they are surprised on demolition day — because a plan
 * is a convention you have to be taught and nobody taught them. Take the roof
 * off, look down into the rooms from an angle, and there is nothing to read: it
 * is the house.
 *
 * Every scanner in this field ships one. Trueline has had the geometry since
 * `section.ts` was written and could only ever do it to **one room at a time**,
 * while `Floor.tsx` placed every room the phone holds and drew them flat.
 * Nothing joined the two. `floor3d.ts` is that join, and this is the screen for
 * it.
 *
 * ## It is the same drag as the room's 3D view, deliberately
 *
 * Same gesture, same camera, same limits, same starting angle. Two views of one
 * building that turned at different rates, or started from different corners,
 * would feel like two apps — and a contractor holding a phone in one hand has
 * one thumb to learn with.
 *
 * ## Tapping a room opens it
 *
 * The one thing this view can do that the flat one cannot do as well: the rooms
 * are solid, so there is something obvious to hit. A tap that follows a drag is
 * not a tap — the same rule the room's view already keeps, for the same reason.
 */
const SIZE = 1000;

/** The same slate the plan uses, lit by the face's own angle. */
function ink(shade: number, loose: boolean): string {
  if (loose) return `hsl(38 62% ${Math.round(52 + shade * 30)}%)`;
  return `hsl(214 20% ${Math.round(28 + shade * 52)}%)`;
}

export function FloorHouse({
  floor,
  onOpenRoom,
}: {
  readonly floor: Floor;
  /** Tapping a room opens it, by the room id the floor knows it by. */
  readonly onOpenRoom: (roomId: string) => void;
}) {
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);
  // A drag is a turn, not a tap. Held in a ref so a re-render mid-drag cannot
  // lose where the finger started.
  const drag = useRef<{ x: number; y: number; from: Camera; moved: boolean } | null>(null);
  // `click` fires after `pointerup`, by which time the drag is cleared, so
  // asking `drag.current?.moved` in the click handler always read undefined and
  // every drag that ended over a room opened it. The answer has to outlive the
  // gesture — the room's own 3D view learned this the same way.
  const wasDrag = useRef(false);

  const view = useMemo(() => {
    try {
      return { it: projectFloor(floor, camera, SIZE), trouble: null as string | null };
    } catch (error) {
      return { it: null, trouble: error instanceof Error ? error.message : String(error) };
    }
  }, [floor, camera]);

  if (!view.it) {
    return (
      <p role="alert" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
        {view.trouble} Switch to Blueprint above — the flat plan does not need a camera.
      </p>
    );
  }

  const { facets, labels, unplaced } = view.it;

  const start = (x: number, y: number) => {
    drag.current = { x, y, from: camera, moved: false };
  };
  const move = (x: number, y: number) => {
    const at = drag.current;
    if (!at) return;
    const dx = x - at.x;
    const dy = y - at.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) at.moved = true;
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
        fontFamily="ui-sans-serif, -apple-system, 'Helvetica Neue', Arial, sans-serif"
        role="img"
        aria-label="The whole floor with the roof off"
        onPointerDown={(event) => {
          // Captured on the svg rather than on the polygon under the finger:
          // the polygons are re-keyed as the depth order changes while turning,
          // so React unmounts the captured element mid-drag and the rotation
          // sticks halfway through the gesture.
          event.currentTarget.setPointerCapture?.(event.pointerId);
          start(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => move(event.clientX, event.clientY)}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <rect x="0" y="0" width={SIZE} height={SIZE} fill="#ffffff" />

        {facets.map((facet, i) => (
          <polygon
            key={`${facet.roomId}-${facet.wallId}-${facet.kind}-${facet.openingKind ?? ''}-${i}`}
            points={facet.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
            fill={
              facet.kind === 'floor'
                ? facet.placed ? '#E8EDEF' : '#FEF6E7'
                : facet.kind === 'opening'
                  ? facet.openingKind === 'window'
                    ? '#7FB2DA'
                    : '#F4F6F7'
                  : ink(facet.shade, !facet.placed)
            }
            stroke={facet.placed ? '#0F172A' : '#B45309'}
            strokeWidth={1.5}
            strokeLinejoin="round"
            className="cursor-pointer"
            onClick={(event) => {
              event.stopPropagation();
              // A drag that ended on a room is not a tap on it.
              if (wasDrag.current) return;
              onOpenRoom(facet.roomId);
            }}
          />
        ))}

        {/* Names last, so nothing is drawn over them. On the floor of each
            room rather than at the middle of its faces, which would drift up
            the walls and land a kitchen's name on the room in front of it. */}
        {labels.map((label) => (
          <g key={label.roomId}>
            <text
              x={label.at.x}
              y={label.at.y}
              textAnchor="middle"
              fontSize={30}
              fontWeight={700}
              fill="#ffffff"
              stroke="#0F172A"
              strokeWidth={7}
              paintOrder="stroke"
            >
              {label.name}
            </text>
            {!label.placed && (
              <text
                x={label.at.x}
                y={label.at.y + 30}
                textAnchor="middle"
                fontSize={22}
                fontWeight={600}
                fill="#ffffff"
                stroke="#B45309"
                strokeWidth={6}
                paintOrder="stroke"
              >
                not joined yet
              </text>
            )}
          </g>
        ))}
      </svg>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-500">
        <p>Drag to walk around it. Tap a room to open it.</p>
        <p className="tabular-nums">
          {Math.round(((camera.turn % 360) + 360) % 360)}° round, {Math.round(camera.tilt)}° up
        </p>
      </div>
      {unplaced.length > 0 && (
        <p className="mt-1 px-1 text-xs text-amber-700">
          {unplaced.length} room{unplaced.length === 1 ? ' is' : 's are'} standing off to one side
          in amber, because nothing joins {unplaced.length === 1 ? 'it' : 'them'} to the rest of
          the floor yet. Say which door is which door on the blueprint and{' '}
          {unplaced.length === 1 ? 'it' : 'they'} will find {unplaced.length === 1 ? 'its' : 'their'}{' '}
          place.
        </p>
      )}
      <p className="mt-1 px-1 text-xs text-slate-500">
        The walls between you and each room are taken away so you can see in — that is what makes
        it a dollhouse. Nothing here is a measurement: it is the same rooms the blueprint draws,
        from a different chair.
      </p>
    </div>
  );
}
