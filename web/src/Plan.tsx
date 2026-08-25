import { NM_PER_FOOT, formatFeetInches } from '../../core/src/length.ts';
import { type Room, isDiagonal, runLength } from '../../core/src/room.ts';
import { toRenderModel } from '../../core/src/render.ts';
import type { Footprint, WallObstruction } from '../../core/src/obstruction.ts';
import type { NorthOnPlan } from '../../core/src/capture.ts';

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

// The drawing is scaled to about half size on a phone, so every user unit here
// paints at roughly half a CSS pixel. The dimensions are the whole product and
// they were landing at about 7 px — unreadable at arm's length in daylight, so
// the type doubled. The margin has to hold them: a label like 19' 3 3/4" at
// this size is about 170 units wide, and half of it hangs off the wall it
// names. Cut the padding without growing it and the numbers run off the sheet,
// which is what happened the first time.
const PAD = 96;

export interface PlanProps {
  readonly room: Room;
  /** Which way north points, when the phone's compass was worth believing. */
  readonly north?: NorthOnPlan | null;
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

export function Plan({ room, north, selected, obstructions, footprints, onSelect }: PlanProps) {
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
      // No gestures here — only a tap — so `touch-action: none` bought nothing and
      // cost the page its scrolling: a thumb starting anywhere on the drawing,
      // which is most of the screen, could not scroll down to the corrections.
      className="w-full h-auto select-none"
      role="img"
      aria-label={`Plan of ${room.name}`}
      onClick={() => onSelect(null)}
    >
      <rect x="0" y="0" width={viewWidth} height={viewHeight} className="fill-white" />

      {/*
        North, when the phone knew it — and its doubt beside it, always.
        Indoors a magnetometer sits in a steel-framed building full of
        appliances, so the arrow is drawn with the accuracy Core Location
        reported rather than as a fact. Nothing measured depends on it.
      */}
      {north && (
        <g
          transform={`translate(${viewWidth - PAD - 8} ${PAD + 12})`}
          aria-label={`North, give or take ${Math.round(north.accuracy)} degrees`}
        >
          <line
            x1={0}
            y1={0}
            x2={north.x * 34}
            y2={-north.y * 34}
            stroke="#0f172a"
            strokeWidth={5}
            strokeLinecap="round"
          />
          <circle cx={north.x * 34} cy={-north.y * 34} r={7} fill="#0f172a" />
          <text
            x={0}
            y={54}
            textAnchor="middle"
            className="text-[22px] font-semibold"
            fill="#0f172a"
          >
            N
          </text>
          <text x={0} y={76} textAnchor="middle" className="text-[17px]" fill="#64748b">
            ±{Math.round(north.accuracy)}°
          </text>
        </g>
      )}

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
              dy={-14}
              textAnchor="middle"
              className="text-[30px] font-semibold"
              fill={stroke}
              style={{ paintOrder: 'stroke', stroke: 'white', strokeWidth: 10 }}
            >
              {formatFeetInches(runLength(wall))}
            </text>
            {isDiagonal(wall.heading) && (
              <text x={mx} y={my} dy={28} textAnchor="middle" className="text-[22px]" fill="#64748b"
                style={{ paintOrder: 'stroke', stroke: 'white', strokeWidth: 8 }}>
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
