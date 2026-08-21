import {
  type Tag,
  DxfTextError,
  findEndOfSection,
  findSection,
  first,
  firstNumber,
  highestHandle,
  parseTags,
  splitEntities,
  writeTags,
} from './tags.ts';

/**
 * Finishes a DXF that a writer left incomplete.
 *
 * Two things were missing from every file `@tarikjabiri/dxf` produces, and both
 * were found by handing the output to real consumers rather than to a parser:
 *
 *   - **No geometry block on any dimension.** A CAD application regenerates
 *     dimension graphics from the definition points; a viewer generally draws the
 *     stored block. Autodesk Viewer drew the extension lines and no number, which
 *     is what a half-regenerating consumer looks like.
 *   - **No `LAYOUT` objects at all.** A layout is where paper size and plot
 *     settings live, so LibreCAD's printer had no page and emitted a blank sheet.
 *
 * This module takes DXF text and returns DXF text. It does not depend on the
 * writer that produced it and does not care which one did.
 */

export interface CompleteOptions {
  /** Text height for generated dimension text, in drawing units. */
  readonly textHeight?: number;
  /** Arrowhead length, in drawing units. */
  readonly arrowSize?: number;
  /** How far an extension line runs past the dimension line. */
  readonly extensionBeyond?: number;
  /** Decimal places on the generated measurement text. */
  readonly decimals?: number;
  /**
   * Emit `LAYOUT` objects. **Off by default, and off for a reason.**
   *
   * Layouts exist to give a printer a page. The only consumer that needed them
   * was LibreCAD's `dxf2pdf`, which is a verification harness rather than a
   * customer, and it did not draw the file even once they were present.
   * Meanwhile Autodesk's translator rejected the whole drawing as invalid when
   * they were emitted — `AutoCAD-InvalidFile`, "Design is empty" — because group
   * 330 is an owner *handle* and a block-record *name* was written there.
   *
   * A construct that helps nobody and can invalidate the file does not belong in
   * the default path. It stays available, unverified, and clearly labelled.
   */
  readonly emitLayouts?: boolean;
  /** Paper size for the generated layout, in millimetres. Only used with `emitLayouts`. */
  readonly paper?: { readonly width: number; readonly height: number };
}

interface Point2 {
  readonly x: number;
  readonly y: number;
}

const sub = (a: Point2, b: Point2): Point2 => ({ x: a.x - b.x, y: a.y - b.y });
const add2 = (a: Point2, b: Point2): Point2 => ({ x: a.x + b.x, y: a.y + b.y });
const scale2 = (a: Point2, k: number): Point2 => ({ x: a.x * k, y: a.y * k });
const dot = (a: Point2, b: Point2): number => a.x * b.x + a.y * b.y;
const length2 = (a: Point2): number => Math.hypot(a.x, a.y);

function point(entity: readonly Tag[], codeX: number): Point2 | undefined {
  const x = firstNumber(entity, codeX);
  const y = firstNumber(entity, codeX + 10);
  return x === undefined || y === undefined ? undefined : { x, y };
}

let handleCounter = 0;
const nextHandle = (): string => (++handleCounter).toString(16).toUpperCase();

function line(layer: string, a: Point2, b: Point2): Tag[] {
  return [
    { code: 0, value: 'LINE' },
    { code: 5, value: nextHandle() },
    { code: 100, value: 'AcDbEntity' },
    { code: 8, value: layer },
    { code: 100, value: 'AcDbLine' },
    { code: 10, value: String(a.x) }, { code: 20, value: String(a.y) }, { code: 30, value: '0' },
    { code: 11, value: String(b.x) }, { code: 21, value: String(b.y) }, { code: 31, value: '0' },
  ];
}

function text(layer: string, at: Point2, height: number, rotation: number, value: string): Tag[] {
  return [
    { code: 0, value: 'TEXT' },
    { code: 5, value: nextHandle() },
    { code: 100, value: 'AcDbEntity' },
    { code: 8, value: layer },
    { code: 100, value: 'AcDbText' },
    { code: 10, value: String(at.x) }, { code: 20, value: String(at.y) }, { code: 30, value: '0' },
    { code: 40, value: String(height) },
    { code: 1, value: value },
    { code: 50, value: String(rotation) },
    { code: 72, value: '1' },   // horizontally centred
    { code: 73, value: '2' },   // vertically centred
    { code: 11, value: String(at.x) }, { code: 21, value: String(at.y) }, { code: 31, value: '0' },
    { code: 100, value: 'AcDbText' },
  ];
}

/** An open arrowhead, drawn as two short lines. Renders anywhere; needs no fill. */
function arrow(layer: string, tip: Point2, along: Point2, size: number): Tag[] {
  const back = scale2(along, -size);
  const perp = { x: -along.y * size * 0.18, y: along.x * size * 0.18 };
  return [
    ...line(layer, tip, add2(add2(tip, back), perp)),
    ...line(layer, tip, add2(add2(tip, back), scale2(perp, -1))),
  ];
}

/**
 * The drawing for one linear or rotated dimension: two extension lines, the
 * dimension line, two arrowheads and the measurement.
 *
 * Angled dimensions are handled by the same code, because a rotated dimension is
 * defined by an angle and an aligned one is the same thing with the angle of the
 * segment it spans.
 */
function dimensionGeometry(
  entity: readonly Tag[],
  options: Required<Pick<CompleteOptions, 'textHeight' | 'arrowSize' | 'extensionBeyond' | 'decimals'>>
): { block: Tag[]; measurement: number } | null {
  const layer = first(entity, 8) ?? '0';
  const dimLinePoint = point(entity, 10);
  const ext1 = point(entity, 13);
  const ext2 = point(entity, 14);
  if (!dimLinePoint || !ext1 || !ext2) return null;

  const kind = (firstNumber(entity, 70) ?? 0) & 7;
  let angleDeg = firstNumber(entity, 50) ?? 0;
  if (kind === 1) {
    // Aligned: the dimension runs along the segment it spans.
    const d = sub(ext2, ext1);
    angleDeg = (Math.atan2(d.y, d.x) * 180) / Math.PI;
  }
  const a = (angleDeg * Math.PI) / 180;
  const u: Point2 = { x: Math.cos(a), y: Math.sin(a) };

  // Both extension origins project onto the line through dimLinePoint along u.
  const project = (p: Point2): Point2 =>
    add2(dimLinePoint, scale2(u, dot(sub(p, dimLinePoint), u)));
  const p1 = project(ext1);
  const p2 = project(ext2);
  const measurement = length2(sub(p2, p1));
  if (!Number.isFinite(measurement) || measurement === 0) return null;

  const beyond = scale2(
    { x: p2.x - p1.x, y: p2.y - p1.y },
    options.extensionBeyond / measurement
  );

  const block: Tag[] = [
    ...line(layer, ext1, add2(p1, { x: -beyond.y, y: beyond.x })),
    ...line(layer, ext2, add2(p2, { x: -beyond.y, y: beyond.x })),
    ...line(layer, p1, p2),
    ...arrow(layer, p1, { x: -u.x, y: -u.y }, options.arrowSize),
    ...arrow(layer, p2, u, options.arrowSize),
  ];

  const override = first(entity, 1);
  const label =
    override && override !== '' && override !== '<>'
      ? override
      : measurement.toFixed(options.decimals);

  const mid = point(entity, 11) ?? add2(p1, scale2(sub(p2, p1), 0.5));
  // Text sits just above the dimension line and reads the same way up as it.
  const lift = { x: -u.y * options.textHeight * 0.7, y: u.x * options.textHeight * 0.7 };
  let readable = angleDeg % 360;
  if (readable > 90 && readable <= 270) readable -= 180;
  block.push(...text(layer, add2(mid, lift), options.textHeight, readable, label));

  return { block, measurement };
}

function blockRecord(name: string): Tag[] {
  return [
    { code: 0, value: 'BLOCK_RECORD' },
    { code: 5, value: nextHandle() },
    { code: 100, value: 'AcDbSymbolTableRecord' },
    { code: 100, value: 'AcDbBlockTableRecord' },
    { code: 2, value: name },
    { code: 70, value: '0' },
  ];
}

function blockDefinition(name: string, layer: string, body: readonly Tag[]): Tag[] {
  return [
    { code: 0, value: 'BLOCK' },
    { code: 5, value: nextHandle() },
    { code: 100, value: 'AcDbEntity' },
    { code: 8, value: layer },
    { code: 100, value: 'AcDbBlockBegin' },
    { code: 2, value: name },
    { code: 70, value: '1' },   // anonymous
    { code: 10, value: '0' }, { code: 20, value: '0' }, { code: 30, value: '0' },
    { code: 3, value: name },
    { code: 1, value: '' },
    ...body,
    { code: 0, value: 'ENDBLK' },
    { code: 5, value: nextHandle() },
    { code: 100, value: 'AcDbEntity' },
    { code: 8, value: layer },
    { code: 100, value: 'AcDbBlockEnd' },
  ];
}

function layoutObject(name: string, blockRecordName: string, paper: { width: number; height: number }): Tag[] {
  return [
    { code: 0, value: 'LAYOUT' },
    { code: 5, value: nextHandle() },
    { code: 100, value: 'AcDbPlotSettings' },
    { code: 1, value: '' },
    { code: 2, value: 'none_device' },
    { code: 4, value: `ISO_A3_(420.00_x_297.00_MM)` },
    { code: 40, value: '0' }, { code: 41, value: '0' },
    { code: 42, value: '0' }, { code: 43, value: '0' },
    { code: 44, value: String(paper.width) },
    { code: 45, value: String(paper.height) },
    { code: 46, value: '0' }, { code: 47, value: '0' },
    { code: 48, value: '0' }, { code: 49, value: '0' },
    { code: 140, value: '0' }, { code: 141, value: '0' },
    { code: 142, value: '1' }, { code: 143, value: '1' },
    { code: 70, value: '1712' },
    { code: 72, value: '0' },
    { code: 73, value: '1' },
    { code: 74, value: '5' },
    { code: 7, value: '' },
    { code: 75, value: '16' },
    { code: 147, value: '1' },
    { code: 100, value: 'AcDbLayout' },
    { code: 1, value: name },
    { code: 70, value: '1' },
    { code: 71, value: name === 'Model' ? '0' : '1' },
    { code: 10, value: '0' }, { code: 20, value: '0' },
    { code: 11, value: String(paper.width) }, { code: 21, value: String(paper.height) },
    { code: 12, value: '0' }, { code: 22, value: '0' }, { code: 32, value: '0' },
    { code: 14, value: '0' }, { code: 24, value: '0' }, { code: 34, value: '0' },
    { code: 15, value: '0' }, { code: 25, value: '0' }, { code: 35, value: '0' },
    { code: 146, value: '0' },
    { code: 13, value: '0' }, { code: 23, value: '0' }, { code: 33, value: '0' },
    { code: 16, value: '1' }, { code: 26, value: '0' }, { code: 36, value: '0' },
    { code: 17, value: '0' }, { code: 27, value: '1' }, { code: 37, value: '0' },
    { code: 76, value: '0' },
    { code: 330, value: blockRecordName },
  ];
}

export interface CompletionReport {
  readonly dimensionsGivenGeometry: number;
  readonly layoutsAdded: number;
  readonly measurements: readonly number[];
}

export function completeDxf(
  dxf: string,
  options: CompleteOptions = {}
): { dxf: string; report: CompletionReport } {
  const settings = {
    textHeight: options.textHeight ?? 4,
    arrowSize: options.arrowSize ?? 3,
    extensionBeyond: options.extensionBeyond ?? 1.5,
    decimals: options.decimals ?? 2,
  };
  const paper = options.paper ?? { width: 420, height: 297 };

  const tags = parseTags(dxf);
  handleCounter = Math.max(highestHandle(tags), 0x1000);

  const entitiesStart = findSection(tags, 'ENTITIES');
  if (entitiesStart === -1) throw new DxfTextError('This DXF has no ENTITIES section.');
  const entitiesEnd = findEndOfSection(tags, entitiesStart);

  const entities = splitEntities(tags, entitiesStart + 2, entitiesEnd);
  const newBlocks: Tag[] = [];
  const newRecords: Tag[] = [];
  const measurements: number[] = [];
  let n = 0;

  const rebuilt: Tag[] = [];
  for (const entity of entities) {
    if (entity[0]?.value !== 'DIMENSION' || first(entity, 2) !== undefined) {
      rebuilt.push(...entity);
      continue;
    }
    const geometry = dimensionGeometry(entity, settings);
    if (!geometry) {
      rebuilt.push(...entity);
      continue;
    }
    n += 1;
    measurements.push(geometry.measurement);
    const name = `*D${n}`;
    const layer = first(entity, 8) ?? '0';
    newRecords.push(...blockRecord(name));
    newBlocks.push(...blockDefinition(name, layer, geometry.block));

    // The DIMENSION now names the block that draws it. Group 2 goes directly
    // after the subclass marker so the file stays in the order readers expect.
    const withBlock: Tag[] = [];
    let inserted = false;
    for (const tag of entity) {
      withBlock.push(tag);
      if (!inserted && tag.code === 100 && tag.value === 'AcDbDimension') {
        withBlock.push({ code: 2, value: name });
        inserted = true;
      }
    }
    if (!inserted) withBlock.splice(1, 0, { code: 2, value: name });
    rebuilt.push(...withBlock);
  }

  const out: Tag[] = [...tags.slice(0, entitiesStart + 2), ...rebuilt, ...tags.slice(entitiesEnd)];

  // Blocks and their table records.
  const blocksStart = findSection(out, 'BLOCKS');
  if (blocksStart !== -1 && newBlocks.length > 0) {
    const blocksEnd = findEndOfSection(out, blocksStart);
    out.splice(blocksEnd, 0, ...newBlocks);
  }
  const tablesStart = findSection(out, 'TABLES');
  if (tablesStart !== -1 && newRecords.length > 0) {
    for (let i = tablesStart; i < out.length; i += 1) {
      if (out[i]!.code === 2 && out[i]!.value === 'BLOCK_RECORD') {
        for (let j = i; j < out.length; j += 1) {
          if (out[j]!.code === 0 && out[j]!.value === 'ENDTAB') {
            out.splice(j, 0, ...newRecords);
            break;
          }
        }
        break;
      }
    }
  }

  // Layouts, so a printer has a page to print onto. See emitLayouts above for
  // why this is off unless asked for.
  let layoutsAdded = 0;
  const objectsStart = options.emitLayouts === true ? findSection(out, 'OBJECTS') : -1;
  if (objectsStart !== -1) {
    const objectsEnd = findEndOfSection(out, objectsStart);
    const layouts = [
      ...layoutObject('Model', '*Model_Space', paper),
      ...layoutObject('Layout1', '*Paper_Space', paper),
    ];
    out.splice(objectsEnd, 0, ...layouts);
    layoutsAdded = 2;
  }

  return {
    dxf: writeTags(out),
    report: { dimensionsGivenGeometry: n, layoutsAdded, measurements },
  };
}
