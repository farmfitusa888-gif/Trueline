import type { Room, Wall } from '../../core/src/room.ts';
import { runLength } from '../../core/src/room.ts';
import { isVerified } from '../../core/src/measurement.ts';
import { useUnits } from './units.tsx';

/**
 * The wall seen straight on, which is what most of the trades actually work off.
 *
 * A plan tells you where a window is. It does not tell you how far off the floor
 * the sill sits, how much wall there is above the head, or whether the tile
 * course lands on a full tile — and those are the questions a tile setter, a
 * cabinet installer and a framer ask about a wall. The model has known all of it
 * since openings carried a sill height; nothing has ever drawn it.
 *
 * Every number on it is formatted from the exact model, and every one carries
 * how it is known: an opening the scanner guessed at is drawn amber and
 * labelled, the same way a wall is on the plan. The scanner is worse at
 * openings than at anything else — it called a 16 ft span a window on a real
 * garage — so an elevation that showed them as facts would be the most
 * confidently wrong drawing in the app.
 */

const PAD = 78;
const SIDE = 560;

export function Elevation({ room, wall }: { readonly room: Room; readonly wall: Wall }) {
  const { len } = useUnits();

  const length = runLength(wall);
  const height = (wall.height ?? room.ceilingHeight).value;
  if (length <= 0n || height <= 0n) return null;

  // One scale for both axes, so a wall is never drawn out of shape. A room is
  // wider than it is tall, so the width decides it.
  const wide = Number(length);
  const tall = Number(height);
  const scale = SIDE / wide;
  const drawnHeight = tall * scale;

  const viewWidth = SIDE + PAD * 2;
  const viewHeight = drawnHeight + PAD * 2 + 20;
  const x = (value: bigint) => PAD + Number(value) * scale;
  // Screen y grows downward and a wall's height grows up from the floor, so the
  // flip happens once, here.
  const y = (above: bigint) => PAD + drawnHeight - Number(above) * scale;

  const openings = [...(wall.openings ?? [])].sort(
    (a, b) => Number(a.offsetFromStart.value - b.offsetFromStart.value)
  );

  return (
    <div className="mt-4 border-t border-sky-200 pt-3" data-sheet="no">
      <h3 className="text-sm font-semibold text-slate-900">
        {wall.id} straight on — {len(length)} by {len(height)}
      </h3>
      <p className="mt-1 text-sm text-slate-600">
        What a tile setter or a cabinet installer works off: how far off the floor each opening
        sits, and how much wall is left above it.
      </p>

      <svg
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        className="mt-2 w-full h-auto select-none"
        fontFamily="ui-sans-serif, -apple-system, 'Helvetica Neue', Arial, sans-serif"
        role="img"
        aria-label={`${wall.id} seen straight on`}
      >
        <rect x="0" y="0" width={viewWidth} height={viewHeight} fill="#ffffff" />

        {/* The wall face. Amber when nobody has put a tape on its length,
            matching the plan, so the two drawings never say different things
            about the same wall. */}
        <rect
          x={PAD}
          y={PAD}
          width={SIDE}
          height={drawnHeight}
          fill="#f8fafc"
          stroke={isVerified(wall.length) ? '#0f172a' : '#b45309'}
          strokeWidth={4}
        />

        {/* The floor, drawn heavier, because every height on here is measured
            from it and a drawing where the floor is just another line is a
            drawing somebody reads upside down. */}
        <line
          x1={PAD - 18}
          y1={PAD + drawnHeight}
          x2={PAD + SIDE + 18}
          y2={PAD + drawnHeight}
          stroke="#0f172a"
          strokeWidth={6}
        />

        {openings.map((opening) => {
          const left = x(opening.offsetFromStart.value);
          const width = Number(opening.width.value) * scale;
          const sill = opening.sillHeight?.value ?? 0n;
          const top = y(sill + opening.height.value);
          const drawn = Number(opening.height.value) * scale;
          const sure = isVerified(opening.width) && isVerified(opening.height);
          const stroke = sure ? '#0f172a' : '#b45309';
          const guessedSill = opening.kind === 'window' && opening.sillHeight === undefined;

          return (
            <g key={opening.id}>
              <rect
                x={left}
                y={top}
                width={width}
                height={drawn}
                fill={opening.kind === 'window' ? '#e0f2fe' : '#ffffff'}
                stroke={stroke}
                strokeWidth={3}
                strokeDasharray={guessedSill ? '10 6' : undefined}
              />
              <text
                x={left + width / 2}
                y={top + drawn / 2}
                textAnchor="middle"
                fontSize={20}
                fill={stroke}
              >
                {len(opening.width.value)} × {len(opening.height.value)}
              </text>

              {/* How far off the floor it sits — the number a plan cannot show
                  and the one a tile setter came for. */}
              {opening.kind === 'window' && (
                <>
                  <line
                    x1={left + width / 2}
                    y1={top + drawn}
                    x2={left + width / 2}
                    y2={PAD + drawnHeight}
                    stroke={guessedSill ? '#b45309' : '#64748b'}
                    strokeWidth={2}
                    strokeDasharray="6 4"
                  />
                  {/*
                    A roll-up door sits four inches off the slab, so the gap
                    between the opening and the floor is a few pixels and a
                    label inside it lands half on the floor line and half off
                    the bottom of the drawing. When there is no room, the
                    number goes below the floor with a tick up to it — which is
                    what a drawing does anyway.
                  */}
                  <text
                    x={left + width / 2 + 10}
                    y={
                      PAD + drawnHeight - Number(sill) * scale / 2 < PAD + drawnHeight - 22
                        ? (top + drawn + PAD + drawnHeight) / 2 + 6
                        : PAD + drawnHeight + 30
                    }
                    fontSize={19}
                    fill={guessedSill ? '#b45309' : '#64748b'}
                  >
                    {guessedSill ? 'sill not known' : `${len(sill)} off the floor`}
                  </text>
                </>
              )}
            </g>
          );
        })}

        {/* The wall's own two dimensions, outside the face so nothing lands on
            top of an opening. */}
        <text
          x={PAD + SIDE / 2}
          y={PAD - 24}
          textAnchor="middle"
          fontSize={26}
          fontWeight={600}
          fill={isVerified(wall.length) ? '#0f172a' : '#b45309'}
        >
          {len(length)}
        </text>
        <text
          x={PAD - 20}
          y={PAD + drawnHeight / 2}
          textAnchor="middle"
          fontSize={22}
          fontWeight={600}
          fill="#0f172a"
          transform={`rotate(-90 ${PAD - 20} ${PAD + drawnHeight / 2})`}
        >
          {len(height)}
        </text>
      </svg>

      {openings.some((o) => o.kind === 'window' && o.sillHeight === undefined) && (
        <p className="mt-1 text-sm text-amber-800">
          A dashed opening is one whose sill nobody knows. RoomPlan never states one — where a
          sill is shown it was worked back from the window&rsquo;s centre and its height. Tape it
          above and this drawing becomes true.
        </p>
      )}
    </div>
  );
}
