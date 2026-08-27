import { NM_PER_FOOT } from '../../core/src/length.ts';
import { type Point, type Room, area, isDiagonal, runLength } from '../../core/src/room.ts';
import { letterhead } from '../../core/src/company.ts';
import { useUnits } from './units.tsx';
import { readiness, trustLabel } from '../../core/src/issue.ts';
import { toRenderModel } from '../../core/src/render.ts';
import type { Footprint, WallObstruction } from '../../core/src/obstruction.ts';
import type { NorthOnPlan } from '../../core/src/capture.ts';
import {
  type Damage,
  damageOnPlan,
  describeDamage,
  damageRunOnPlan,
} from '../../core/src/damage.ts';
import { type Tag, CONDITION, describeTag } from '../../core/src/tag.ts';

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

/**
 * And how much above and below it.
 *
 * Not the same number, which is the whole point. `PAD` has to hold a WHOLE
 * dimension label lying on its side beside a vertical wall -- about 180 units
 * for `21' 3 13/16"` -- because the label is centred on the wall and pushed
 * outward. Above a horizontal wall the same label is only its own height: the
 * dimension line sits 30 units off, the number 22 above that, and the number is
 * 30 tall. A hundred clears it with room for the halo.
 *
 * Squaring the two put 190 units of empty sheet above and below every drawing,
 * which on a phone is about 83 pixels at each end of the one thing on the
 * screen somebody came to look at. A drawing has margins; it does not have
 * that.
 */
const PAD_Y = 110;

/**
 * Which way an SVG arc goes, from one angle to another, for a quarter turn.
 *
 * Returns the sweep flag. Both ends of a door's arc are a right angle apart, so
 * the only question is which side, and picking wrong draws the other three
 * quarters of the circle through the middle of the room.
 */
function swing(fromAngle: number, toAngle: number): 0 | 1 {
  let delta = toAngle - fromAngle;
  while (delta <= -Math.PI) delta += 2 * Math.PI;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  return delta > 0 ? 1 : 0;
}

/** How far off its wall a dimension sits. Enough to clear the line and its halo. */
const LABEL_OFFSET = 22;

/** Where the dimension line runs, off the building. */
const DIM_OFFSET = 30;
/** Half the length of the 45-degree slash that terminates it. */
const DIM_TICK = 5;
/** Dimension lines are thin and grey: they are notation, not building. */
const DIM_INK = 'rgb(var(--c-derived))';

export interface PlanProps {
  readonly room: Room;
  /** Which way north points, when the phone's compass was worth believing. */
  readonly north?: NorthOnPlan | null;
  readonly selected: string | null;
  readonly obstructions: readonly WallObstruction[];
  /** What the scan found standing in the room. Drawn so "could not see it" has a picture. */
  readonly footprints: readonly Footprint[];
  /**
   * Whether to draw it.
   *
   * Off, the drawing is the building on its own -- which is what goes to a
   * client, an adjuster or a supplier. **No number moves either way.** A
   * scan reports the walls and the objects separately, and nothing in the
   * geometry, the takeoff or the readiness has ever read a footprint: they
   * are used for what is in the way of a tape, and for the field sheet. So
   * this hides clutter, and it is not a correction -- the measurements were
   * already the room's own.
   */
  readonly furniture?: boolean;
  /**
   * What is wrong with this building, drawn on it.
   *
   * Empty on every job that is not a claim. A remodeler correcting a kitchen
   * scan should never see a red stretch of wall, and a restoration contractor
   * should not have to open a second screen to find out which wall it was.
   */
  readonly damages?: readonly Damage[];
  /**
   * Hidden conditions found and pinned. Drawn in a different colour and a
   * different shape from damage, because they mean a different thing: a red
   * ring is a loss, a blue square is a fact about the building.
   */
  readonly tags?: readonly Tag[];
  /** The line dividing an open plan, and what each side is called. */
  readonly divide?: {
    readonly boundary: { readonly from: Point; readonly to: Point };
    readonly names: readonly [string, string];
  } | null;
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
 * A number or a word, legible over whatever it lands on.
 *
 * Exported because the elevation draws labels over damage for the same reason
 * the plan draws them over walls, and two halo implementations would be two
 * things that render differently in the same picture.
 *
 * The white outline is a separate element drawn first rather than
 * `paint-order: stroke` on one, because the canvas rasteriser behind
 * "save as a picture" ignores that property and renders the halo as blobs
 * between the digits. What is on screen and what gets sent have to be the same
 * drawing, so the drawing uses what both agree about.
 */
export function Label({
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
        stroke="rgb(var(--c-raise))"
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

export function Plan({
  room,
  north,
  selected,
  obstructions,
  footprints,
  furniture = true,
  damages = [],
  tags = [],
  divide = null,
  onSelect,
}: PlanProps) {
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
  const scaleY = (y: number) => PAD_Y + insetY + (maxY - y) * scale;

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
  const viewHeight = SIDE + PAD_Y * 2 + BLOCK;

  // The middle of the room in screen units, so every dimension can be pushed
  // *away* from it. A label centred on its own wall sits on top of the line and,
  // on a side wall, half of it lands inside the room over the floor — which is
  // where the white halo behind it turned into a row of blobs between the
  // digits on the exported picture. A drawing puts its dimensions outside.
  const midX = model.walls.reduce((t, w) => t + px(w.start.x), 0) / model.walls.length;
  const midY = model.walls.reduce((t, w) => t + scaleY(w.start.y), 0) / model.walls.length;

  const state = readiness(room);
  /**
   * What this drawing is, said in one word on the sheet itself.
   *
   * It said SCANNED for anything unmeasured, which was true when a scan was
   * the only way an unmeasured room could exist. A room tapped out on a grid is
   * unmeasured too and nothing scanned it — and a sheet that says a hand
   * drawing came off a sensor is the app telling the exact lie it exists to
   * prevent. Read off the walls rather than assumed: whichever provenance
   * actually dominates is the word.
   */
  const drawnByHand = room.walls.every((wall) => wall.length.provenance.kind === 'derived');
  const caveat =
    state.blocking.length > 0
      ? drawnByHand
        ? 'DRAWN — every length came off the grid, not a tape. These numbers will move.'
        : 'SCANNED — no wall here has had a tape on it. These numbers will move.'
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
      <rect x="0" y="0" width={viewWidth} height={viewHeight} fill="rgb(var(--c-raise))" />

      {/*
        North, when the phone knew it — and its doubt beside it, always.
        Indoors a magnetometer sits in a steel-framed building full of
        appliances, so the arrow is drawn with the accuracy Core Location
        reported rather than as a fact. Nothing measured depends on it.
      */}
      {north && (
        <g
          transform={`translate(${viewWidth - PAD - 8} ${PAD_Y + 12})`}
          aria-label={`North, give or take ${Math.round(north.accuracy)} degrees`}
        >
          <line
            x1={0}
            y1={0}
            x2={north.x * 34}
            y2={-north.y * 34}
            stroke="rgb(var(--c-ink))"
            strokeWidth={5}
            strokeLinecap="round"
          />
          <circle cx={north.x * 34} cy={-north.y * 34} r={7} fill="rgb(var(--c-ink))" />
          <text
            x={0}
            y={54}
            textAnchor="middle"
            fontSize={22}
            fontWeight={600}
            fill="rgb(var(--c-ink))"
          >
            N
          </text>
          <text x={0} y={76} textAnchor="middle" fontSize={17} fill="rgb(var(--c-derived))">
            ±{Math.round(north.accuracy)}°
          </text>
        </g>
      )}

      {/* The floor, so the inside of the room reads as inside. */}
      <polygon
        points={model.walls.map((w) => `${px(w.start.x)},${scaleY(w.start.y)}`).join(' ')}
        fill="rgb(var(--c-sunk))"
      />

      {/* Whatever was standing in the room when it was scanned. Faint, because it
          is not part of the building — but it is why some of these walls are
          worth a tape. */}
      {(furniture ? footprints : []).map((f) => (
        <rect
          key={f.id}
          x={px(feet(f.min.x))}
          y={scaleY(feet(f.max.y))}
          width={Math.abs(px(feet(f.max.x)) - px(feet(f.min.x)))}
          height={Math.abs(scaleY(feet(f.min.y)) - scaleY(feet(f.max.y)))}
          fill="rgb(var(--c-rule))" fillOpacity={0.5} stroke="rgb(var(--c-faint))"
          strokeWidth={1}
          strokeDasharray="3 3"
        >
          <title>{f.category}</title>
        </rect>
      ))}

      {/*
        Dimension lines.

        The numbers used to float beside the building with nothing joining them
        to it — which is fine on a phone, where there are four of them, and
        falls apart on any sheet a person is handed: nothing says which run a
        number belongs to, and nothing says where the run starts and stops. A
        drawing answers both with two extension lines, a line between them, and
        a tick at each end. This is the difference between a picture of a room
        and a drawing of one.

        Under the walls, so a tick can never be mistaken for something built.
      */}
      {model.walls.map((w) => {
        const ax = px(w.start.x);
        const ay = scaleY(w.start.y);
        const bx = px(w.end.x);
        const by = scaleY(w.end.y);
        const run = Math.hypot(bx - ax, by - ay);
        if (run < 8) return null;

        // The wall's normal, turned to face away from the middle of the room.
        let nx = -(by - ay) / run;
        let ny = (bx - ax) / run;
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        if ((mx - midX) * nx + (my - midY) * ny < 0) { nx = -nx; ny = -ny; }

        const off = DIM_OFFSET;
        const dax = ax + nx * off;
        const day = ay + ny * off;
        const dbx = bx + nx * off;
        const dby = by + ny * off;
        // A 45-degree slash, which is how a building drawing terminates a
        // dimension. Arrowheads are a mechanical-drawing convention.
        const ux = (bx - ax) / run;
        const uy = (by - ay) / run;
        const tick = (tx: number, ty: number) => (
          <line
            x1={tx - (ux + nx) * DIM_TICK} y1={ty - (uy + ny) * DIM_TICK}
            x2={tx + (ux + nx) * DIM_TICK} y2={ty + (uy + ny) * DIM_TICK}
            stroke={DIM_INK} strokeWidth={2}
          />
        );

        return (
          <g key={`${w.id}-dim`} aria-hidden="true">
            <line x1={ax + nx * 6} y1={ay + ny * 6}
                  x2={ax + nx * (off + 9)} y2={ay + ny * (off + 9)}
                  stroke={DIM_INK} strokeWidth={1} strokeOpacity={0.55} />
            <line x1={bx + nx * 6} y1={by + ny * 6}
                  x2={bx + nx * (off + 9)} y2={by + ny * (off + 9)}
                  stroke={DIM_INK} strokeWidth={1} strokeOpacity={0.55} />
            <line x1={dax} y1={day} x2={dbx} y2={dby}
                  stroke={DIM_INK} strokeWidth={1.4} strokeOpacity={0.75} />
            {tick(dax, day)}
            {tick(dbx, dby)}
          </g>
        );
      })}

      {model.walls.map((w) => {
        const wall = room.walls.find((x) => x.id === w.id)!;
        const isSelected = selected === w.id;
        const x1 = px(w.start.x);
        const y1 = scaleY(w.start.y);
        const x2 = px(w.end.x);
        const y2 = scaleY(w.end.y);
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        // Four colours for four ways a number got here. A wall somebody
        // dragged gets its own — violet, unlike anything else on the sheet —
        // because the one thing that must never happen is a moved wall reading
        // like a measured one.
        const stroke = w.open
          ? 'rgb(var(--c-faint))'
          : w.confidence === 'verified'
            ? 'rgb(var(--c-ink))'
            : w.confidence === 'adjusted'
              ? 'rgb(var(--c-adjusted))'
              : w.confidence === 'derived'
                ? 'rgb(var(--c-derived))'
                : 'rgb(var(--c-scanned))';
        const share = blocked.get(w.id)?.blockedPerMille ?? 0n;

        return (
          <g
            key={w.id}
            // A wall on the plan is a control, so it is one: named, reachable by
            // keyboard, and it says whether it is picked. Marking damage and
            // typing a tape reading both start by choosing a wall, and a plan
            // that can only be operated by touching a line on an SVG shuts
            // those out for anybody working on a laptop or a screen reader.
            role="button"
            tabIndex={0}
            aria-label={`${w.open ? 'Open span' : 'Wall'} ${w.id}, ${len(runLength(wall))}`}
            aria-pressed={isSelected}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(isSelected ? null : w.id);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              event.stopPropagation();
              onSelect(isSelected ? null : w.id);
            }}
            className="cursor-pointer focus:outline-none focus-visible:outline focus-visible:outline-2
                       focus-visible:outline-offset-2 focus-visible:outline-sky-500"
          >
            {/* A fat invisible line so a finger can hit a wall on a phone. */}
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={34} />
            {isSelected && (
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgb(var(--c-focus))" strokeWidth={16} strokeOpacity={0.28} />
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
            {/*
              The doors and the windows.

              The plan drew none of them: four lines and a dimension on each,
              with no way to tell a wall you can walk through from a solid one.
              A floor plan without openings is not a floor plan, and it is the
              first thing a homeowner looks for on a sheet handed to them.

              Drawn the way a drawing draws them. A door is a gap in the wall,
              a leaf across it and the quarter-circle it sweeps. A window is a
              gap with a thin line down the middle of it. A cased opening is a
              gap and nothing else, because that is what it is.
            */}
            {!w.open &&
              w.openings.map((o) => {
                const ax = px(o.from.x);
                const ay = scaleY(o.from.y);
                const bx = px(o.to.x);
                const by = scaleY(o.to.y);
                const wide = Math.hypot(bx - ax, by - ay);
                if (wide < 2) return null;
                // Into the room, in screen units. `outward` points out of it,
                // and screen y runs the other way from plan y.
                // Into the room. `outward` leads away from it, and screen y
                // runs the opposite way to plan y, so only x flips twice.
                const inx = -o.outward.x;
                const iny = o.outward.y;
                const band = Math.max(7, w.thicknessAssumed ? 7 : w.thickness * scale);

                return (
                  <g key={o.id}>
                    {/* The gap: the wall stops here. */}
                    <line
                      x1={ax} y1={ay} x2={bx} y2={by}
                      stroke="rgb(var(--c-raise))" strokeWidth={band + 1} strokeLinecap="butt"
                    />
                    {/* The two jambs, so the gap has ends rather than fading out. */}
                    <line
                      x1={ax + inx * band / 2} y1={ay + iny * band / 2}
                      x2={ax - inx * band / 2} y2={ay - iny * band / 2}
                      stroke={stroke} strokeWidth={2}
                    />
                    <line
                      x1={bx + inx * band / 2} y1={by + iny * band / 2}
                      x2={bx - inx * band / 2} y2={by - iny * band / 2}
                      stroke={stroke} strokeWidth={2}
                    />

                    {o.kind === 'door' && (
                      <>
                        {/* The leaf, standing open against the jamb. */}
                        <line
                          x1={ax} y1={ay}
                          x2={ax + inx * wide} y2={ay + iny * wide}
                          stroke={stroke} strokeWidth={3}
                        />
                        {/*
                          What it sweeps: a quarter circle about the hinge, from
                          the open leaf round to the far jamb. Which way round
                          is read off the two angles rather than assumed — the
                          arc is a quarter turn either way, and the wrong flag
                          draws the other three quarters, straight through the
                          room.
                        */}
                        <path
                          d={`M ${ax + inx * wide} ${ay + iny * wide} A ${wide} ${wide} 0 0 ${
                            swing(Math.atan2(iny, inx), Math.atan2(by - ay, bx - ax))
                          } ${bx} ${by}`}
                          fill="none" stroke={stroke} strokeWidth={1.5}
                          strokeDasharray="5 5" strokeOpacity={0.75}
                        />
                      </>
                    )}

                    {o.kind === 'window' && (
                      <line
                        x1={ax} y1={ay} x2={bx} y2={by}
                        stroke={stroke} strokeWidth={2.5}
                      />
                    )}
                  </g>
                );
              })}

            {/* Something was standing here, so the scanner could not see it. */}
            {share > 0n && !w.open && (
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="rgb(var(--c-refuse))"
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
                fill="rgb(var(--c-derived))"
                halo={6}
              >
                angled
              </Label>
            )}
          </g>
        );
      })}

      {model.walls.map((w) => (
        <circle key={`${w.id}-corner`} cx={px(w.start.x)} cy={scaleY(w.start.y)} r={4} fill="rgb(var(--c-ink))" />
      ))}

      {/*
        Where the loss is, on the building.

        Drawn on top of the walls and under the title block, so a damaged
        stretch reads as something happening TO a wall rather than as a
        different kind of wall. The extent is what is drawn, not a marker in
        the middle of the wall: what gets ordered and scheduled is how much
        board comes out, and the room already knows how much that is.

        A pin gets a ring instead, because a pin has no length and drawing it
        as a stretch would invent one. Floors and ceilings get nothing here —
        they are the room, and hatching the whole thing red would hide the
        walls this drawing exists to show.
      */}
      {damages.map((damage) => {
        const run = damageRunOnPlan(room, damage);
        // The kind and the category in `damage.ts`'s own words, then what the
        // person wrote. This label was built by hand here, so the plan and the
        // claim document described the same damage two different ways -- and
        // `describeDamage` existed the whole time, calling nothing.
        const label = `${describeDamage(room, damage)} — ${damage.note}`;

        if (run) {
          return (
            <g key={damage.id} aria-label={label}>
              <title>{label}</title>
              <line
                x1={px(feet(run.from.x))}
                y1={scaleY(feet(run.from.y))}
                x2={px(feet(run.to.x))}
                y2={scaleY(feet(run.to.y))}
                stroke="rgb(var(--c-refuse))"
                strokeWidth={14}
                strokeOpacity={0.55}
                strokeLinecap="butt"
              />
            </g>
          );
        }

        const at = damageOnPlan(room, damage);
        if (!at) return null;
        return (
          <g key={damage.id} aria-label={label}>
            <title>{label}</title>
            <circle
              cx={px(feet(at.x))}
              cy={scaleY(feet(at.y))}
              r={9}
              fill="rgb(var(--c-raise))"
              stroke="rgb(var(--c-refuse))"
              strokeWidth={4}
            />
          </g>
        );
      })}

      {/*
        The divide in an open plan. Dashed, and in the same violet the plan
        uses for "moved by hand", because it is the same kind of thing: a
        person's decision rather than something a sensor found. A solid line
        would read as a wall, and a wall is exactly what it is not.
      */}
      {divide && (
        <g aria-label={`Divided into ${divide.names[0]} and ${divide.names[1]}`}>
          <title>
            {divide.names[0]} / {divide.names[1]} — a line on the floor, not a wall
          </title>
          <line
            x1={px(feet(divide.boundary.from.x))}
            y1={scaleY(feet(divide.boundary.from.y))}
            x2={px(feet(divide.boundary.to.x))}
            y2={scaleY(feet(divide.boundary.to.y))}
            stroke="rgb(var(--c-adjusted))"
            strokeWidth={3}
            strokeDasharray="14 9"
            strokeLinecap="round"
          />
          <text
            x={(px(feet(divide.boundary.from.x)) + px(feet(divide.boundary.to.x))) / 2}
            y={(scaleY(feet(divide.boundary.from.y)) + scaleY(feet(divide.boundary.to.y))) / 2 - 8}
            textAnchor="middle"
            fontSize={13}
            fontWeight={600}
            fill="rgb(var(--c-adjusted))"
          >
            {divide.names[0]} / {divide.names[1]}
          </text>
        </g>
      )}

      {/*
        Hidden conditions. Square rather than round, and slate rather than red,
        so a plan carrying both never lets a joist be read as a loss.
      */}
      {tags.map((tag) => (
        <g key={tag.id} aria-label={describeTag(tag)}>
          <title>{describeTag(tag)}</title>
          <rect
            x={px(feet(tag.at.x)) - 8}
            y={scaleY(feet(tag.at.y)) - 8}
            width={16}
            height={16}
            rx={2}
            fill="rgb(var(--c-raise))"
            stroke="rgb(var(--c-focus))"
            strokeWidth={3.5}
          />
          <text
            x={px(feet(tag.at.x))}
            y={scaleY(feet(tag.at.y)) + 4}
            textAnchor="middle"
            fontSize={11}
            fontWeight={700}
            fill="rgb(var(--c-focus))"
          >
            {/* The first letter of the first thing on it. A pin is a few
                millimetres across; "F+P+E" on one is a smudge. What all of them
                are is in the tag's own line underneath the plan. */}
            {CONDITION[tag.conditions[0]!].plain.slice(0, 1)}
          </text>
        </g>
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
      <g transform={`translate(0 ${SIDE + PAD_Y * 2 - 18})`}>
        <line x1={PAD / 2} y1={0} x2={viewWidth - PAD / 2} y2={0} stroke="rgb(var(--c-ink))" strokeWidth={2} />
        <text x={PAD / 2} y={38} fontSize={30} fontWeight={600} fill="rgb(var(--c-ink))">
          {room.name}
        </text>
        <text x={viewWidth - PAD / 2} y={38} textAnchor="end" fontSize={30} fill="rgb(var(--c-ink))">
          {showArea(area(room).value)}
        </text>
        <text x={PAD / 2} y={72} fontSize={21} fill={state.blocking.length > 0 ? 'rgb(var(--c-scanned))' : 'rgb(var(--c-ink))'}>
          {caveat}
        </text>
        <text x={PAD / 2} y={100} fontSize={19} fill="rgb(var(--c-derived))">
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
          stroke="rgb(var(--c-rule))"
          strokeWidth={1}
        />
        {head.map((line, i) => (
          <text
            key={line}
            x={PAD / 2}
            y={148 + i * 26}
            fontSize={i === 0 ? 24 : 19}
            fontWeight={i === 0 ? 600 : 400}
            fill={i === 0 ? 'rgb(var(--c-ink))' : 'rgb(var(--c-derived))'}
          >
            {line}
          </text>
        ))}
        <text
          x={viewWidth - PAD / 2}
          y={148}
          textAnchor="end"
          fontSize={17}
          fill="rgb(var(--c-faint))"
        >
          Trueline
        </text>
      </g>
    </svg>
  );
}

/**
 * Exported only so the legend and the plan cannot drift apart.
 *
 * A key entry for something the drawing does not contain is worse than no key
 * at all — somebody looks for the red on the plan and cannot find it, and then
 * doubts the rest of the key. So damage is listed only when damage is drawn.
 */
export function legendFor(
  anyDamage: boolean,
  anyAdjusted = false,
  furniture = true,
  /**
   * Whether this job is a claim, which decides one word in the key.
   *
   * The same stretch of wall is drawn either way — a mark is a mark — but
   * calling it *Damaged* on a remodel would put a loss on a drawing where
   * nobody has claimed one. On an ordinary job it is what it is: something
   * somebody marked. A key that says more than the drawing knows is a key that
   * lies, which is the rule the entry below it already keeps.
   */
  onClaim = true
): readonly { label: string; className: string }[] {
  return [
    { label: 'Measured', className: 'bg-slate-900' },
    { label: 'Scanned', className: 'bg-amber-700' },
    ...(anyAdjusted ? [{ label: 'Moved by hand', className: 'bg-violet-600' }] : []),
    { label: 'No wall here', className: 'bg-slate-400' },
    { label: 'Something in the way', className: 'bg-red-600' },
    // A key entry for something that is not on the drawing is a key that lies.
    ...(furniture ? [{ label: 'What was in the room', className: 'bg-slate-300' }] : []),
    ...(anyDamage
      ? [{ label: onClaim ? 'Damaged' : 'Marked', className: 'bg-red-600/60' }]
      : []),
  ];
}
