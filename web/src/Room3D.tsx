import { useMemo, useRef, useState } from 'react';
import { type Camera, DEFAULT_CAMERA, project } from '../../core/src/project.ts';
import type { Room } from '../../core/src/room.ts';

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
}: {
  readonly room: Room;
  readonly selected: string | null;
  readonly onSelect: (wallId: string | null) => void;
}) {
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);
  // A drag is a turn, not a tap. Held in a ref so a re-render mid-drag cannot
  // lose where the finger started.
  const drag = useRef<{ x: number; y: number; from: Camera; moved: boolean } | null>(null);

  const view = useMemo(() => {
    try {
      return { projection: project(room, camera, SIZE), trouble: null as string | null };
    } catch (error) {
      return {
        projection: null,
        trouble: error instanceof Error ? error.message : String(error),
      };
    }
  }, [room, camera]);

  if (!view.projection) {
    return (
      <p role="alert" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
        {view.trouble}
      </p>
    );
  }

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
    drag.current = null;
  };

  return (
    <div className="select-none">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="w-full touch-none"
        role="img"
        aria-label={`${room.name} in three dimensions`}
        onPointerDown={(event) => {
          (event.target as Element).setPointerCapture?.(event.pointerId);
          start(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => move(event.clientX, event.clientY)}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {view.projection.facets.map((facet, i) => {
          const isWall = facet.kind !== 'floor';
          const isSelected = isWall && facet.wallId === selected;
          return (
            <polygon
              key={`${facet.wallId}-${facet.kind}-${i}`}
              points={facet.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
              fill={
                facet.kind === 'floor'
                  ? '#E8EDEF'
                  : facet.kind === 'opening'
                    ? facet.openingKind === 'window'
                      ? '#7FB2DA'
                      : '#F4F6F7'
                    : ink(facet.shade, isSelected)
              }
              stroke={isSelected ? '#B8590A' : '#0F172A'}
              strokeWidth={isSelected ? 6 : 1.5}
              strokeLinejoin="round"
              className={isWall ? 'cursor-pointer' : undefined}
              onClick={(event) => {
                event.stopPropagation();
                // A drag that ended on a wall is not a tap on it.
                if (drag.current?.moved) return;
                if (isWall) onSelect(isSelected ? null : facet.wallId);
              }}
            />
          );
        })}
      </svg>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-500">
        <p>Drag to walk around it. Tap a wall to measure it.</p>
        {view.projection.hidden.length > 0 && (
          <p>
            {view.projection.hidden.length} wall
            {view.projection.hidden.length === 1 ? '' : 's'} taken off so you can see in
          </p>
        )}
      </div>
    </div>
  );
}
