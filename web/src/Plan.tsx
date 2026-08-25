import { NM_PER_FOOT } from '../../core/src/length.ts';
import { type Room, area, isDiagonal, runLength } from '../../core/src/room.ts';
import { letterhead } from '../../core/src/company.ts';
import { useUnits } from './units.tsx';
import { readiness, trustLabel } from '../../core/src/issue.ts';
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
// the type doubled. The margin has to hold them: a label like 21' 3 13/16" at
// this size is about 180 units wide, and every dimension now sits *outside* the
// wall it names rather than on top of it, so the margin has to hold a whole one
// on the left and the right. Cut this without shrinking the type and the
// numbers run off the sheet, which is what happened the first time.
const PAD = 190;

/** How far off its wall a dimension sits. Enough to clear the line and its halo. */
const LABEL_OFFSET = 22;

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

/**
 * Where a wall's dimension goes: off the wall, away from the room.
 *
 * The direction is from the middle of the room towards the middle of the wall,
 * which for any wall on the outline points out of the building. A side wall then
 * anchors its text at the near end and grows outward, so the number never
 * crosses the line it names; a top or bottom wall keeps its text centred and
 * moves up or down.
 */
function outward(
  x: number,
  y: number,
  fromX: number,
  fromY: number,
  extra = 0
): { x: number; y: number; dy: number; anchor: 'start' | 'middle' | 'end' } {
  const dx = x - fromX;
  const dy = y - fromY;
  const length = Math.hypot(dx, dy) || 1;
  const nx = dx / length;
  const ny = dy / length;
  const push = LABEL_OFFSET + extra;
  if (Math.abs(nx) > Math.abs(ny)) {
    // A side wall. Anchor at the wall and let the number run outward.
    return { x: x + nx * push, y: y + extra, dy: 10, anchor: nx > 0 ? 'start' : 'end' };
  }
  // A top or bottom wall. Centred, above or below.
  return { x, y: y + ny * push, dy: ny > 0 ? 26 : -8, anchor: 'middle' };
}

/**
 * A dimension, legible over whatever it lands on.
 *
 * The white outline is a separate element drawn first rather than
 * `paint-order: stroke` on one, because the canvas rasteriser behind
 * "save as a picture" ignores that property and renders the halo as blobs
 * between the digits. What is on screen and what gets sent have to be the same
 * drawing, so the drawing uses what both agree about.
 */
function Label({
  x,
  y,
  dy,
  anchor,
  size,
  weight,
  fill,
  halo,
  children,
}: {
  x: number;
  y: number;
  dy: number;
  anchor: 'start' | 'middle' | 'end';
  size: number;
  weight: number;
  fill: string;
  halo: number;
  children: string;
}) {
  const common = { x, y, dy, textAnchor: anchor, fontSize: size, fontWeight: weight };
  return (
    <>
      {/* The outline is the same string twice, so a screen reader would read
          every dimension on the drawing out loud twice over. */}
      <text
        {...common}
        aria-hidden="true"
        fill="none"
        stroke="#ffffff"
        strokeWidth={halo}
        strokeLinejoin="round"
      >
        {children}
      </text>
      <text {...common} fill={fill}>
        {children}
      </text>
    </>
  );
}

/** Nanometres to feet, for the object boxes. Same boundary rule as `render.ts`. */
function feet(nm: bigint): number {
  const whole = nm / NM_PER_FOOT;
  const rest = nm % NM_PER_FOOT;
  return Number(whole) + Number(rest) / Number(NM_PER_FOOT);
}

export function Plan({ room, north, selected, obstructions, footprints, onSelect }: PlanProps) {
  const { len, area: showArea, company } = useUnits();
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
  // Room for a title block under the drawing. It is part of this SVG rather
  // than a second thing rendered beside it, because this element is what gets
  // printed and what gets serialised into the image somebody saves — and two
  // renderings of the same facts is how an export starts disagreeing with the
  // screen.
  // Tall enough for the rows above plus however many letterhead lines this
  // contractor has filled in. Fixed at the tallest and the drawing floats in
  // white on a profile with only a name in it; computed, and it fits.
  const head = letterhead(company);
  const BLOCK = 132 + Math.max(head.length, 1) * 26;
  const viewHeight = SIDE + PAD * 2 + BLOCK;

  // The middle of the room in screen units, so every dimension can be pushed
  // *away* from it. A label centred on its own wall sits on top of the line and,
  // on a side wall, half of it lands inside the room over the floor — which is
  // where the white halo behind it turned into a row of blobs between the
  // digits on the exported picture. A drawing puts its dimensions outside.
  const midX = model.walls.reduce((t, w) => t + px(w.start.x), 0) / model.walls.length;
  const midY = model.walls.reduce((t, w) => t + scaleY(w.start.y), 0) / model.walls.length;

  const state = readiness(room);
  const caveat =
    state.blocking.length > 0
      ? 'SCANNED — no wall here has had a tape on it. These numbers will move.'
      : 'Measured — a tape has been on a wall running each way.';

  return (
    <svg
      viewBox={`0 0 ${viewWidth} ${viewHeight}`}
      // No gestures here — only a tap — so `touch-action: none` bought nothing and
      // cost the page its scrolling: a thumb starting anywhere on the drawing,
      // which is most of the screen, could not scroll down to the corrections.
      className="w-full h-auto select-none"
      // Named here rather than inherited from the page. This element is
      // serialised whole to make the image somebody saves, and outside the page
      // it inherits nothing at all — the export has to carry its own type.
      fontFamily="ui-sans-serif, -apple-system, 'Helvetica Neue', Arial, sans-serif"
      role="img"
      aria-label={`Plan of ${room.name}`}
      onClick={() => onSelect(null)}
    >
      <rect x="0" y="0" width={viewWidth} height={viewHeight} fill="#ffffff" />

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
            fontSize={22}
            fontWeight={600}
            fill="#0f172a"
          >
            N
          </text>
          <text x={0} y={76} textAnchor="middle" fontSize={17} fill="#64748b">
            ±{Math.round(north.accuracy)}°
          </text>
        </g>
      )}

      {/* The floor, so the inside of the room reads as inside. */}
      <polygon
        points={model.walls.map((w) => `${px(w.start.x)},${scaleY(w.start.y)}`).join(' ')}
        fill="#f1f5f9"
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
          fill="#cbd5e1" fillOpacity={0.5} stroke="#94a3b8"
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
            {/*
              A wall somebody has given a thickness is drawn at that thickness,
              to the same scale as everything else on the sheet — so a 2x6 wall
              looks like a 2x6 wall beside a 2x4 partition. A wall nobody has
              said anything about stays a thin line rather than being fattened
              to a guess, which is the difference between a drawing and a
              picture of one.
            */}
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={stroke}
              strokeWidth={w.open ? 3 : w.thicknessAssumed ? 7 : Math.max(7, w.thickness * scale)}
              strokeLinecap={w.thicknessAssumed ? 'round' : 'butt'}
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
            {/*
              Twice, deliberately: a white outline underneath and the number on
              top. `paint-order: stroke` says the same thing in one element and
              a browser honours it on screen — but the canvas rasteriser that
              turns this drawing into the picture somebody sends does not, and
              it came out as a row of white blobs between the digits. Two
              elements is what every rasteriser agrees about.
            */}
            <Label
              {...outward(mx, my, midX, midY)}
              size={30}
              weight={600}
              fill={stroke}
              halo={7}
            >
              {len(runLength(wall))}
            </Label>
            {isDiagonal(wall.heading) && (
              <Label
                {...outward(mx, my, midX, midY, 34)}
                size={22}
                weight={400}
                fill="#64748b"
                halo={6}
              >
                angled
              </Label>
            )}
          </g>
        );
      })}

      {model.walls.map((w) => (
        <circle key={`${w.id}-corner`} cx={px(w.start.x)} cy={scaleY(w.start.y)} r={4} fill="#0f172a" />
      ))}

      {/*
        The title block: everything a drawing has to say about itself before
        anybody prices off it. Which room, how big, whether anybody stood behind
        it — and whose drawing it is.

        Laid out in rows with the letterhead beneath rather than beside, because
        beside it collided with the caveat the first time and printed a
        contractor's name through the middle of the most important sentence on
        the sheet.
      */}
      <g transform={`translate(0 ${SIDE + PAD * 2 - 18})`}>
        <line x1={PAD / 2} y1={0} x2={viewWidth - PAD / 2} y2={0} stroke="#0f172a" strokeWidth={2} />
        <text x={PAD / 2} y={38} fontSize={30} fontWeight={600} fill="#0f172a">
          {room.name}
        </text>
        <text x={viewWidth - PAD / 2} y={38} textAnchor="end" fontSize={30} fill="#0f172a">
          {showArea(area(room).value)}
        </text>
        <text x={PAD / 2} y={72} fontSize={21} fill={state.blocking.length > 0 ? '#b45309' : '#0f172a'}>
          {caveat}
        </text>
        <text x={PAD / 2} y={100} fontSize={19} fill="#64748b">
          {trustLabel(state.trust)} · ceiling {len(room.ceilingHeight.value)}
        </text>

        {/* Whose drawing this is. A homeowner handed a drawing with somebody
            else's brand on it is being handed a tool their contractor is
            borrowing; with his name and his licence on it, it is his drawing,
            and Trueline is the line underneath. */}
        <line
          x1={PAD / 2}
          y1={118}
          x2={viewWidth - PAD / 2}
          y2={118}
          stroke="#e2e8f0"
          strokeWidth={1}
        />
        {head.map((line, i) => (
          <text
            key={line}
            x={PAD / 2}
            y={148 + i * 26}
            fontSize={i === 0 ? 24 : 19}
            fontWeight={i === 0 ? 600 : 400}
            fill={i === 0 ? '#0f172a' : '#64748b'}
          >
            {line}
          </text>
        ))}
        <text
          x={viewWidth - PAD / 2}
          y={148}
          textAnchor="end"
          fontSize={17}
          fill="#94a3b8"
        >
          Trueline
        </text>
      </g>
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
