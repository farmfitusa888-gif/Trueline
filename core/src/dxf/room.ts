import { DxfWriter, Colors, Units, point3d } from '@tarikjabiri/dxf';
import {
  type Nanometres,
  NM_PER_INCH,
  NM_PER_MM,
  formatFeetInches,
  formatMetric,
} from '../length.ts';
import { isVerified } from '../measurement.ts';
import {
  type Point,
  type Room,
  type Wall,
  corners,
  formatSquareFeet,
  runLength,
  validate,
} from '../room.ts';
import { area } from '../room.ts';
import { readiness, trustLabel } from '../issue.ts';
import { type CompletionReport, completeDxf } from './complete.ts';

/**
 * The room as a drawing a CAD application opens.
 *
 * The sales line this exists for is a real one: magicplan's own help page says
 * their DXF export to SketchUp and AutoCAD **does not include dimensions**. An
 * architect, a cabinet shop or a truss supplier asks for a DXF and gets a shape
 * with no numbers on it, and then measures it again.
 *
 * Two things here that no competitor's export has:
 *
 *   - **Dimensions, with their definition points, so CAD regenerates them.**
 *   - **Confidence as layers.** A wall somebody put a tape on is dimensioned on
 *     `DIM-VERIFIED`; one the scanner guessed at is on `DIM-SCANNED`. Toggle a
 *     layer in the viewer and you can see, in one movement, exactly which
 *     numbers in the drawing anybody stood behind. That survives the trip into
 *     CAD, where nothing else about provenance does.
 *
 * **What is claimed, and what is not.** `core/tools/README.md` records what has
 * actually been watched happening in the tool a customer opens: the geometry is
 * exact in Autodesk Viewer, and the confidence layers work there. **Dimension
 * text rendering has never been verified** — it has been reported working twice
 * by automated checks and was wrong both times. So this module ships the
 * dimensions and the layers, and nothing here says "a DXF that keeps its
 * dimensions" until somebody has opened one in AutoCAD and looked.
 *
 * This is the float boundary, like `render.ts`: exact integers go in, drawing
 * units come out, and nothing produced here ever travels back into the model.
 */

export type DxfUnits = 'in' | 'mm';

export interface DxfOptions {
  /** What one drawing unit is. Declared in the header; never left unset. */
  readonly units?: DxfUnits;
  /** Whose drawing it is, for the title text. */
  readonly company?: string;
  /** When it was exported, as a person reads it. */
  readonly at?: string;
}

/** Square metres from the doubled unit areas are kept in, for the title text. */
function squareMetres(halfSquareNanometres: bigint): string {
  const per = 2n * 1_000_000_000n * 1_000_000_000n;
  const tenths = (halfSquareNanometres * 10n + per / 2n) / per;
  return `${Number(tenths) / 10}`;
}

/** Height of the annotation text, in drawing units. */
const TEXT_HEIGHT = { in: 4, mm: 100 };
/** How far a dimension line sits off the wall it measures. */
const DIM_OFFSET = { in: 18, mm: 450 };

/**
 * Nanometres to drawing units.
 *
 * Divided as a rational rather than by turning the bigint into a number first,
 * so a building-sized coordinate cannot lose its last digits on the way through.
 * The same care `render.ts` takes, for the same reason.
 */
function toUnit(value: Nanometres, units: DxfUnits): number {
  const per = units === 'mm' ? NM_PER_MM : NM_PER_INCH;
  const whole = value / per;
  const rest = value % per;
  return Number(whole) + Number(rest) / Number(per);
}

/** The outward normal of each wall, so dimensions land outside the room. */
function outward(points: readonly Point[]): { x: number; y: number }[] {
  let twice = 0n;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    twice += a.x * b.y - b.x * a.y;
  }
  const hand = twice > 0n ? 1 : -1;
  return points.map((from, i) => {
    const to = points[(i + 1) % points.length]!;
    const dx = Number(to.x - from.x);
    const dy = Number(to.y - from.y);
    const length = Math.hypot(dx, dy) || 1;
    return { x: (hand * dy) / length, y: (-hand * dx) / length };
  });
}

/** Where along a wall an opening starts and ends, as a fraction of its run. */
function span(wall: Wall, opening: { offsetFromStart: { value: Nanometres }; width: { value: Nanometres } }) {
  const length = runLength(wall);
  const start = opening.offsetFromStart.value;
  const end = start + opening.width.value;
  return {
    from: Number(start) / Number(length),
    to: Number(end) / Number(length),
  };
}

export function roomToDxf(
  room: Room,
  options: DxfOptions = {}
): { dxf: string; report: CompletionReport } {
  validate(room);
  const units = options.units ?? 'in';
  const text = TEXT_HEIGHT[units];
  const offset = DIM_OFFSET[units];
  const state = readiness(room);

  const points = corners(room);
  const plan = points.map((p) => ({ x: toUnit(p.x, units), y: toUnit(p.y, units) }));
  const normals = outward(points);

  const writer = new DxfWriter();

  // Declare the unit. A DXF with `$INSUNITS` unset is unitless, and a CAD
  // application then guesses the scale — a plan that prints at the wrong size,
  // which is worse than one that will not print, because it looks correct.
  writer.setUnits(units === 'mm' ? Units.Millimeters : Units.Inches);

  // And where the drawing is. Without these, LibreCAD prints on a default
  // letter sheet at 1:1 and a building-sized drawing falls entirely off the
  // page. Computed from the model with room for the dimensions and the title.
  const xs = plan.map((p) => p.x);
  const ys = plan.map((p) => p.y);
  const margin = offset * 3;
  const bounds = {
    minX: Math.min(...xs) - margin,
    maxX: Math.max(...xs) + margin,
    minY: Math.min(...ys) - margin * 2,
    maxY: Math.max(...ys) + margin,
  };
  writer.setVariable('$EXTMIN', { 10: bounds.minX, 20: bounds.minY, 30: 0 });
  writer.setVariable('$EXTMAX', { 10: bounds.maxX, 20: bounds.maxY, 30: 0 });
  writer.setVariable('$LIMMIN', { 10: bounds.minX, 20: bounds.minY });
  writer.setVariable('$LIMMAX', { 10: bounds.maxX, 20: bounds.maxY });

  // A dimension style with a text height. With `DIMTXT` unset the text is drawn
  // at zero size, which is a dimension with extension lines, arrowheads and no
  // number.
  const style = writer.tables.addDimStyle('TRUELINE');
  style.DIMTXT = text;
  style.DIMASZ = text * 0.75;
  style.DIMEXE = text * 0.4;
  style.DIMEXO = text * 0.25;
  style.DIMGAP = text * 0.25;
  style.DIMDEC = 2;

  writer.addLayer('TRUELINE-WALLS', Colors.White);
  writer.addLayer('TRUELINE-OPENINGS', Colors.Cyan);
  writer.addLayer('TRUELINE-OPEN-SPAN', Colors.Magenta);
  writer.addLayer('TRUELINE-TEXT', Colors.White);
  // The two that carry the product. Toggle one in a viewer and you see, in a
  // single movement, which numbers on the drawing anybody stood behind.
  writer.addLayer('DIM-VERIFIED', Colors.Green);
  writer.addLayer('DIM-SCANNED', Colors.Yellow);

  /* ------------------------------------------------------------ the walls */

  for (const [i, wall] of room.walls.entries()) {
    const from = plan[i]!;
    const to = plan[(i + 1) % plan.length]!;
    const openings = [...(wall.openings ?? [])].sort(
      (a, b) => Number(a.offsetFromStart.value - b.offsetFromStart.value)
    );

    // A side of the room with nothing built across it is drawn on its own
    // layer, because it is not a wall and must not be counted as one by
    // whoever opens this.
    writer.setCurrentLayerName(wall.open ? 'TRUELINE-OPEN-SPAN' : 'TRUELINE-WALLS');

    const at = (t: number) => point3d(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);

    // The wall, broken where its openings are — which is what a plan does, and
    // what makes a door readable as a door rather than as a line on top of a
    // line.
    let cursor = 0;
    for (const opening of openings) {
      const { from: a, to: b } = span(wall, opening);
      if (a > cursor) writer.addLine(at(cursor), at(a));
      writer.setCurrentLayerName('TRUELINE-OPENINGS');
      writer.addLine(at(a), at(b));
      writer.setCurrentLayerName(wall.open ? 'TRUELINE-OPEN-SPAN' : 'TRUELINE-WALLS');
      cursor = b;
    }
    if (cursor < 1) writer.addLine(at(cursor), at(1));
  }

  /* ------------------------------------------------------- the dimensions */

  for (const [i, wall] of room.walls.entries()) {
    const from = plan[i]!;
    const to = plan[(i + 1) % plan.length]!;
    const n = normals[i]!;
    const measured = isVerified(wall.length);
    writer.setCurrentLayerName(measured ? 'DIM-VERIFIED' : 'DIM-SCANNED');
    // **Aligned, not linear, and this matters.** A linear dimension measures
    // along an angle stored on the entity, and this library writes that angle
    // as zero for every one of them — so a wall running north-south comes out
    // measured along the horizontal, which is zero. Four walls, two of them
    // dimensioned 0.00 in CAD, on a drawing that looks fine. An aligned
    // dimension measures along the segment between its own definition points,
    // so it is right for a wall whichever way it runs — and right for a
    // chamfer, which a linear dimension would have measured as its horizontal
    // component.
    writer.addAlignedDim(point3d(from.x, from.y), point3d(to.x, to.y), {
      // Where the dimension line runs, said explicitly rather than left to the
      // library's `offset`, which puts every dimension on a room in one of two
      // places and draws two of the four on top of each other. Off the wall,
      // outward, so a dimension is never inside the room it measures.
      definitionPoint: point3d(from.x + n.x * offset, from.y + n.y * offset),
      // Group code 11, where the measurement text sits. Without it Autodesk
      // Viewer draws the lines and no number at all.
      middlePoint: point3d(
        (from.x + to.x) / 2 + n.x * offset,
        (from.y + to.y) / 2 + n.y * offset
      ),
      styleName: 'TRUELINE',
      text: '<>',
    });
  }

  /* ------------------------------------------------------------ the title */

  writer.setCurrentLayerName('TRUELINE-TEXT');
  const lines = [
    room.name,
    units === 'mm'
      ? `${squareMetres(area(room).value)} m2`
      : formatSquareFeet(area(room).value),
    state.blocking.length > 0
      ? "SCANNED - no wall here has had a tape on it. These numbers will move."
      : 'Measured - a tape has been on a wall running each way.',
    trustLabel(state.trust),
    `Ceiling ${units === 'mm' ? formatMetric(room.ceilingHeight.value, 'mm') : formatFeetInches(room.ceilingHeight.value)}`,
    'Green dimensions were measured. Yellow ones are the scanner’s.',
    options.company && options.company.trim() !== ''
      ? `${options.company.trim()} — with Trueline${options.at ? `, ${options.at}` : ''}`
      : `Trueline${options.at ? `, ${options.at}` : ''}`,
  ].filter((line) => line !== '');

  for (const [i, line] of lines.entries()) {
    writer.addText(
      point3d(bounds.minX + margin / 2, bounds.minY + margin - i * text * 1.8),
      i === 0 ? text * 1.5 : text,
      line
    );
  }

  // The dimension geometry blocks. A CAD application regenerates them from the
  // definition points; a viewer generally draws the stored block, and without
  // one it draws the extension lines and no number. See `complete.ts`.
  return completeDxf(writer.stringify(), {
    textHeight: text,
    arrowSize: text * 0.75,
    extensionBeyond: text * 0.4,
    decimals: 2,
  });
}
