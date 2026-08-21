import { NM_PER_FOOT, formatFeetInches } from '../../core/src/length.ts';
import { type Room, isDiagonal, runLength } from '../../core/src/room.ts';
import { toRenderModel } from '../../core/src/render.ts';
import type { Footprint, WallObstruction } from '../../core/src/obstruction.ts';

/**
 * The plan, drawn from the render model and nothing else.
 *
 * Every number on this drawing is formatted from the exact model. Nothing is
 * measured off a rendered coordinate, which is the rule `render.ts` exists to
 * enforce: floats are for putting pixels on a screen and never travel back.
 *
 * What it shows that no other scanning app shows: **which dimensions somebody
 * stood behind.** A verified wall is drawn in ink and labelled with a plain
 * number. A scanned wall is amber and labelled with its band. An open span is
 * dashed, because there is nothing there. That distinction is the product.
 */

const PAD = 56;

export interface PlanProps {
  readonly room: Room;
  readonly selected: string | null;
  readonly obstructions: readonly WallObstruction[];
  /** What the scan found standing in the room. Drawn so "could not see it" has a picture. */
  readonly footprints: readonly Footprint[];
  readonly onSelect: (wallId: string | null) => void;
}

/** Nanometres to feet, for the object boxes. Same boundary rule as `render.ts`. */
function feet(nm: bigint): number {
  const whole = nm / NM_PER_FOOT;
  const rest = nm % NM_PER_FOOT;
  return Number(whole) + Number(rest) / Number(NM_PER_FOOT);
}

export function Plan({ room, selected, obstructions, footprints, onSelect }: PlanProps) {
  const model = toRenderModel(room, [], { unit: 'ft' });
  const blocked = new Map(obstructions.map((o) => [o.wallId, o]));

  const xs = model.walls.flatMap((w) => [w.start.x, w.end.x]);
  const ys = model.walls.flatMap((w) => [w.start.y, w.end.y]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);

  // One scale for both axes, so a room is never drawn out of shape, and centred
  // in the box. Screen y grows downward while plan y grows north, so the flip
  // happens once here rather than at every point.
  const SIDE = 600;
  const scale = SIDE / Math.max(width, height);
  const insetX = (SIDE - width * scale) / 2;
  const insetY = (SIDE - height * scale) / 2;
  const px = (x: number) => PAD + insetX + (x - minX) * scale;
  const scaleY = (y: number) => PAD + insetY + (maxY - y) * scale;

  const viewWidth = SIDE + PAD * 2;
  const viewHeight = SIDE + PAD * 2;

  return (
    <svg
      viewBox={`0 0 ${viewWidth} ${viewHeight}`}
      className="w-full h-auto touch-none select-none"
      role="img"
      aria-label={`Plan of ${room.name}`}
      onClick={() => onSelect(null)}
    >
      <rect x="0" y="0" width={viewWidth} height={viewHeight} className="fill-white" />

      {/* The floor, so the inside of the room reads as inside. */}
      <polygon
        points={model.walls.map((w) => `${px(w.start.x)},${scaleY(w.start.y)}`).join(' ')}
        className="fill-slate-100"
      />

      {/* Whatever was standing in the room when it was scanned. Faint, because it
          is not part of the building — but it is why some of these walls are
          worth a tape. */}
      {footprints.map((f) => (
        <rect
          key={f.id}
          x={px(feet(f.min.x))}
          y={scaleY(feet(f.max.y))}
          width={Math.abs(px(feet(f.max.x)) - px(feet(f.min.x)))}
          height={Math.abs(scaleY(feet(f.min.y)) - scaleY(feet(f.max.y)))}
          className="fill-slate-300/50 stroke-slate-400"
          strokeWidth={1}
          strokeDasharray="3 3"
        >
          <title>{f.category}</title>
        </rect>
      ))}

      {model.walls.map((w) => {
        const wall = room.walls.find((x) => x.id === w.id)!;
        const isSelected = selected === w.id;
        const x1 = px(w.start.x);
        const y1 = scaleY(w.start.y);
        const x2 = px(w.end.x);
        const y2 = scaleY(w.end.y);
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const stroke = w.open
          ? '#94a3b8'
          : w.confidence === 'verified'
            ? '#0f172a'
            : w.confidence === 'derived'
              ? '#64748b'
              : '#b45309';
        const share = blocked.get(w.id)?.blockedPerMille ?? 0n;

        return (
          <g
            key={w.id}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(isSelected ? null : w.id);
            }}
            className="cursor-pointer"
          >
            {/* A fat invisible line so a finger can hit a wall on a phone. */}
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={34} />
            {isSelected && (
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#0ea5e9" strokeWidth={16} strokeOpacity={0.28} />
            )}
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={stroke}
              strokeWidth={w.open ? 3 : 7}
              strokeLinecap="round"
              strokeDasharray={w.open ? '2 10' : undefined}
            />
            {/* Something was standing here, so the scanner could not see it. */}
            {share > 0n && !w.open && (
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="#dc2626"
                strokeWidth={2}
                strokeDasharray="6 5"
                strokeOpacity={0.9}
              />
            )}
            <text
              x={mx}
              y={my}
              dy={-11}
              textAnchor="middle"
              className="text-[15px] font-medium"
              fill={stroke}
              style={{ paintOrder: 'stroke', stroke: 'white', strokeWidth: 5 }}
            >
              {formatFeetInches(runLength(wall))}
            </text>
            {isDiagonal(wall.heading) && (
              <text x={mx} y={my} dy={16} textAnchor="middle" className="text-[11px]" fill="#64748b"
                style={{ paintOrder: 'stroke', stroke: 'white', strokeWidth: 4 }}>
                angled
              </text>
            )}
          </g>
        );
      })}

      {model.walls.map((w) => (
        <circle key={`${w.id}-corner`} cx={px(w.start.x)} cy={scaleY(w.start.y)} r={4} className="fill-slate-900" />
      ))}
    </svg>
  );
}

/** Exported only so the legend and the plan cannot drift apart. */
export const LEGEND: readonly { label: string; className: string }[] = [
  { label: 'Measured', className: 'bg-slate-900' },
  { label: 'Scanned', className: 'bg-amber-700' },
  { label: 'No wall here', className: 'bg-slate-400' },
  { label: 'Something in the way', className: 'bg-red-600' },
  { label: 'What was in the room', className: 'bg-slate-300' },
];
