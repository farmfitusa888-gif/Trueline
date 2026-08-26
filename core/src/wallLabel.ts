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
  /**
   * The visible part of the face, as a box.
   *
   * So a caller can keep the whole label inside it. The centre being in the
   * picture is not enough: text is centred on its point and runs half its width
   * either way, so a label on a wall at the edge of the screen has its middle
   * inside and its ends cut off — which is what happened to "Wall 1" and to a
   * door's size the first time this ran.
   *
   * Only the view knows how wide a label is, because only the view knows the
   * font and the words. So this hands over where it may go and lets it decide.
   */
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** Where a door or window's size goes, and which opening it belongs to. */
export interface OpeningLabel {
  /** The opening's own id, so the caller can look its size up on the wall. */
  readonly openingId: string;
  /** The wall it is in. */
  readonly wallId: string;
  readonly kind: 'door' | 'window' | 'cased';
  readonly x: number;
  readonly y: number;
  readonly area: number;
  /** The visible part of the hole, as a box. See `WallLabel`. */
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** The box a set of points sits in. */
function boundsOf(points: readonly { readonly x: number; readonly y: number }[]): {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
} {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
}

/**
 * A size on every door and window that is big enough to carry one.
 *
 * Same rule as the walls and for the same reason: the hole is clipped to the
 * picture first, so a doorway you are standing in the middle of gets its label
 * where you can see it rather than four feet off the side of the screen.
 *
 * `smallest` is larger here than for a wall. A wall label sits on a face the
 * size of a wall; a door label is two numbers and a cross on something the size
 * of a door, and below a certain size that is a smudge rather than a
 * measurement. Which is worse than nothing on a drawing somebody prices from.
 */
export function openingLabels(
  facets: readonly Facet[],
  size: number,
  smallest = 0.012
): readonly OpeningLabel[] {
  const floor = size * size * smallest;
  const best = new Map<string, OpeningLabel>();

  for (const facet of facets) {
    if (facet.kind !== 'opening') continue;
    if (!facet.openingId || !facet.openingKind) continue;
    const shown = insideTheBox(facet.points, size);
    if (shown.length < 3) continue;
    const { x, y, area } = centreOf(shown);
    if (area < floor) continue;
    const already = best.get(facet.openingId);
    if (already && already.area >= area) continue;
    best.set(facet.openingId, {
      openingId: facet.openingId,
      wallId: facet.wallId,
      kind: facet.openingKind,
      x,
      y,
      area,
      ...boundsOf(shown),
    });
  }

  return [...best.values()].sort((a, b) => b.area - a.area);
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

/**
 * The part of a face that is actually inside the picture.
 *
 * ## Why this is here and a centroid alone was not enough
 *
 * Standing inside a room is a **perspective** projection, and a wall you are
 * nearly parallel to projects to an enormous trapezium running far off both
 * sides of the drawing. The SVG clips it, so it looks perfectly ordinary — but
 * its centroid is computed from the raw projected corners and lands nowhere
 * near the picture.
 *
 * Measured on this project's own kitchen, standing inside a 386-pixel view:
 * Wall 3's centre came out at x = 3920 and Wall 1's at x = -3536. Both labels
 * were drawn, both were outside the box, and neither was ever seen. One label
 * appeared where there should have been three, and it looked like a feature
 * that worked.
 *
 * So the polygon is cut to the drawing first — Sutherland and Hodgman's
 * algorithm, four half-planes, the oldest one there is — and the label goes on
 * the middle of what is left. A wall half out of shot gets its label in the
 * half you can see, which is also the only half worth labelling.
 *
 * A face entirely outside comes back empty, and gets no label at all.
 */
export function insideTheBox(
  points: readonly { readonly x: number; readonly y: number }[],
  size: number
): { readonly x: number; readonly y: number }[] {
  // Each edge as "keep the side where this is true", in order: left, right,
  // top, bottom. `at` is where a segment crosses it.
  const edges: {
    keep: (p: { x: number; y: number }) => boolean;
    at: (a: { x: number; y: number }, b: { x: number; y: number }) => { x: number; y: number };
  }[] = [
    {
      keep: (p) => p.x >= 0,
      at: (a, b) => ({ x: 0, y: a.y + ((b.y - a.y) * (0 - a.x)) / (b.x - a.x) }),
    },
    {
      keep: (p) => p.x <= size,
      at: (a, b) => ({ x: size, y: a.y + ((b.y - a.y) * (size - a.x)) / (b.x - a.x) }),
    },
    {
      keep: (p) => p.y >= 0,
      at: (a, b) => ({ x: a.x + ((b.x - a.x) * (0 - a.y)) / (b.y - a.y), y: 0 }),
    },
    {
      keep: (p) => p.y <= size,
      at: (a, b) => ({ x: a.x + ((b.x - a.x) * (size - a.y)) / (b.y - a.y), y: size }),
    },
  ];

  let kept = points.map((p) => ({ x: p.x, y: p.y }));
  for (const edge of edges) {
    if (kept.length === 0) return [];
    const next: { x: number; y: number }[] = [];
    for (let i = 0; i < kept.length; i += 1) {
      const a = kept[i]!;
      const b = kept[(i + 1) % kept.length]!;
      const aIn = edge.keep(a);
      const bIn = edge.keep(b);
      if (aIn) next.push(a);
      // A crossing produces the point on the edge. Guarded against the
      // degenerate segment -- two identical corners cross nothing, and the
      // interpolation above would divide by zero.
      if (aIn !== bIn && (a.x !== b.x || a.y !== b.y)) next.push(edge.at(a, b));
    }
    kept = next;
  }
  return kept;
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
    // The visible part, not the whole face. See `insideTheBox`: standing in a
    // room, a wall runs thousands of pixels off both sides of the picture and
    // its true centre is nowhere near it.
    const shown = insideTheBox(facet.points, size);
    if (shown.length < 3) continue;
    const { x, y, area } = centreOf(shown);
    if (area < floor) continue;
    const already = best.get(facet.wallId);
    if (already && already.area >= area) continue;
    best.set(facet.wallId, {
      wallId: facet.wallId,
      text: nameOf(facet.wallId),
      x,
      y,
      area,
      ...boundsOf(shown),
    });
  }

  // Biggest first, so a caller drawing a bounded number of them keeps the ones
  // somebody is actually looking at.
  return [...best.values()].sort((a, b) => b.area - a.area);
}


/**
 * Where a label of this width may actually sit.
 *
 * Kept inside the picture first, because a label off the edge of the screen is
 * not a label. Then inside its own face where there is room, because a label
 * that has wandered onto the wall next door is worse than one that is slightly
 * off-centre — it names the wrong thing.
 *
 * When the face is narrower than the label the two cannot both be satisfied.
 * The picture wins: staying on screen is what makes it readable at all, and a
 * caller that minds can drop the label by comparing the width it asked for
 * against `right - left`.
 */
export function fitInside(
  at: { readonly x: number; readonly y: number },
  face: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number },
  half: { readonly width: number; readonly height: number },
  size: number
): { readonly x: number; readonly y: number } {
  const clamp = (value: number, low: number, high: number) =>
    low > high ? (low + high) / 2 : Math.min(Math.max(value, low), high);

  // Its own face, where the face is big enough to hold it.
  const onFace = {
    x: clamp(at.x, face.left + half.width, face.right - half.width),
    y: clamp(at.y, face.top + half.height, face.bottom - half.height),
  };
  // And the picture, always.
  return {
    x: clamp(onFace.x, half.width, size - half.width),
    y: clamp(onFace.y, half.height, size - half.height),
  };
}
