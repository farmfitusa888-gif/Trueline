import type { Facet } from './project.ts';

/**
 * Where a wall's name goes when you are standing in the room.
 *
 * ## What this answers
 *
 * > "WHEN IN 3D MODE, AND YOU ARE INSIDE THE MODEL, THERE SHOULD BE LABELING
 * > ON THE WALLS WITH THE WALL # OR WHICH WALL IT IS"
 *
 * And he is right, and it is worse than a missing convenience. The whole claim
 * this view makes over a scanner's mesh is that every face still knows which
 * wall it is — that is written at the top of `Room3D` — and then it drew four
 * identical grey slabs and made you tap each one to find out. Standing inside a
 * room and not being able to say "that is the wall behind the washer" is the
 * one thing the view exists to make possible.
 *
 * ## Why the name and not the number
 *
 * Renaming a wall in this app **replaces its id**: `renameWall` returns a room
 * where the wall is called "behind the washer" and everything pinned to it
 * moved with it. So the id already is the name whenever somebody has given one,
 * and `wall-1` is what it says when nobody has. Both are handled here rather
 * than in the drawing: `Wall 1` reads as a label and `wall-1` reads as a
 * variable, and the difference is what a client sees over somebody's shoulder.
 *
 * ## Nothing here is a measurement
 *
 * This produces text and a place to put it. It reads no lengths, does no
 * arithmetic on any dimension, and cannot move a number — the length in the
 * label is handed in, already formatted by whoever owns the units.
 */

/** A label to draw, and where. All in the projection's own screen box. */
export interface WallLabel {
  /** The wall it belongs to, so a tap on the label selects the same wall. */
  readonly wallId: string;
  /** What to print: the name somebody gave it, or `Wall 3`. */
  readonly text: string;
  readonly x: number;
  readonly y: number;
  /** How big this face is on screen, so a caller can drop the slivers. */
  readonly area: number;
}

/**
 * `wall-3` becomes `Wall 3`. Anything else is somebody's own words, untouched.
 *
 * Only that exact shape — `wall`, a separator, digits, nothing else. A wall
 * somebody called "wall by the stairs" keeps every character of it, because
 * guessing at somebody's words is how a label ends up saying something they did
 * not write.
 */
export function nameOf(wallId: string): string {
  const numbered = /^wall[-_ ]?(\d+)$/i.exec(wallId.trim());
  return numbered ? `Wall ${numbered[1]}` : wallId;
}

/** Twice the polygon's area, by the shoelace formula. Sign carries winding. */
function twiceArea(points: readonly { readonly x: number; readonly y: number }[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/**
 * The centre of a face, for the label to sit on.
 *
 * The polygon's own centroid rather than the average of its corners: a wall
 * seen at a sharp angle is a long thin trapezium, and the corner average slides
 * toward whichever end has more corners on it. On a rectangle the two agree.
 *
 * A face with no area — edge on to the viewer — has no centroid, and the corner
 * average is the honest answer there rather than a division by zero.
 */
export function centreOf(
  points: readonly { readonly x: number; readonly y: number }[]
): { readonly x: number; readonly y: number; readonly area: number } {
  const doubled = twiceArea(points);
  const area = Math.abs(doubled) / 2;
  if (points.length === 0) return { x: 0, y: 0, area: 0 };
  if (doubled === 0) {
    const x = points.reduce((s, p) => s + p.x, 0) / points.length;
    const y = points.reduce((s, p) => s + p.y, 0) / points.length;
    return { x, y, area: 0 };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const cross = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  return { x: cx / (3 * doubled), y: cy / (3 * doubled), area };
}

/**
 * One label per wall that is actually on screen.
 *
 * **One per wall, not one per face.** A wall with a door in it comes back as
 * several `wall` facets — the strips around the opening — and labelling each
 * would put "Wall 3" three times on one wall. The biggest face of each wall
 * wins, which is the one with room to print on.
 *
 * `smallest` drops the slivers: a wall seen almost edge on is a few pixels
 * wide, and a label on it lands on top of its neighbour's. It is a fraction of
 * the whole drawing's area, so it means the same thing at any size.
 */
export function wallLabels(
  facets: readonly Facet[],
  size: number,
  smallest = 0.004
): readonly WallLabel[] {
  const floor = size * size * smallest;
  const best = new Map<string, WallLabel>();

  for (const facet of facets) {
    if (facet.kind !== 'wall') continue;
    const { x, y, area } = centreOf(facet.points);
    if (area < floor) continue;
    const already = best.get(facet.wallId);
    if (already && already.area >= area) continue;
    best.set(facet.wallId, { wallId: facet.wallId, text: nameOf(facet.wallId), x, y, area });
  }

  // Biggest first, so a caller drawing a bounded number of them keeps the ones
  // somebody is actually looking at.
  return [...best.values()].sort((a, b) => b.area - a.area);
}
