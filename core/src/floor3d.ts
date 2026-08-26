import { type Floor } from './floor.ts';
import { type FloorPlan, floorPlan } from './floorplan.ts';
import { type Camera, facing, feet, viewer } from './project.ts';
import { type Opening, type Point, runLength } from './room.ts';
import { outwardOf } from './section.ts';

/**
 * The whole floor as a dollhouse.
 *
 * ## What this is for
 *
 * A dollhouse is the view that sells the job. A homeowner cannot read a floor
 * plan — they have been told they can, and they nod at one, and then they are
 * surprised on demolition day. Take the roof off and look down into the rooms
 * from an angle and there is nothing to read: it is the house, with the walls
 * you would be standing behind taken away so you can see in.
 *
 * Every scanner in this field has one. Trueline has had the geometry for it
 * since `section.ts` was written — `dollhouse()` takes the ceiling off and
 * drops the walls standing between the eye and the room — and it has only ever
 * been able to do it to **one room at a time**. `Floor.tsx` has placed every
 * room the phone holds since the day joins were built, and drawn them flat.
 * Nothing joined the two. This is the join.
 *
 * ## Why it is not `project()` called once per room
 *
 * `project()` takes a `Room`, which is a chain of headings and lengths starting
 * at (0, 0). Every room on a floor has been turned and moved into the floor's
 * own coordinates by `layout()`, and a `Room` has nowhere to carry that. Asking
 * `project()` for each room would draw them all on top of each other at the
 * origin.
 *
 * So this works from the **placed outlines** `floorPlan` produces, and shares
 * the camera with `project()` rather than writing a second one: `viewer()` is
 * the single transform both use. Two views of one building that disagreed about
 * the angle would be two drawings of two buildings.
 *
 * ## What it refuses to do
 *
 * No ceilings, ever — that is what makes it a dollhouse rather than a picture of
 * a roof. No quantity of any kind comes out of here: it produces screen
 * coordinates and shades, and the takeoff is computed from the room model by
 * code that has never heard of a camera.
 */

/** One face of one room, on screen. */
export interface FloorFacet {
  readonly roomId: string;
  /** So a label, and a tap that opens the room, both have something to say. */
  readonly roomName: string;
  readonly wallId: string;
  readonly kind: 'wall' | 'floor' | 'opening';
  readonly openingKind?: Opening['kind'];
  readonly points: readonly { readonly x: number; readonly y: number }[];
  /** Larger is further away. They come back furthest first. */
  readonly depth: number;
  /** 0 to 1, flat shading off the face's own direction. */
  readonly shade: number;
  /**
   * False for a room nothing has joined to the floor yet.
   *
   * Drawn anyway, off to one side, exactly as the flat view draws it — and
   * marked, so the screen can grey it and say which rooms are still loose
   * rather than letting somebody read a row of unplaced rooms as a wing of the
   * house.
   */
  readonly placed: boolean;
}

export interface FloorProjection {
  /** Furthest first, so drawing them in order is correct. */
  readonly facets: readonly FloorFacet[];
  /** Walls left out because the viewer is on their outside. The dollhouse. */
  readonly hidden: readonly { readonly roomId: string; readonly wallId: string }[];
  /** Rooms standing off to one side because nothing joins them yet. */
  readonly unplaced: readonly string[];
  /** Whatever `layout` had to say about how the rooms went together. */
  readonly notes: FloorPlan['notes'];
  /** Where each room's name goes, in the same screen coordinates. */
  readonly labels: readonly {
    readonly roomId: string;
    readonly name: string;
    readonly at: { readonly x: number; readonly y: number };
    readonly placed: boolean;
  }[];
}

interface Raw {
  roomId: string;
  roomName: string;
  wallId: string;
  kind: FloorFacet['kind'];
  openingKind?: Opening['kind'];
  points: { x: number; y: number }[];
  depth: number;
  shade: number;
  placed: boolean;
}

/**
 * Every room on the floor, drawn from one camera.
 *
 * `size` is the side of the square box to fit the whole floor into. The
 * projection is axonometric, like the room's — parallel, no vanishing point —
 * because somebody will hold a tape up to the screen and a far wall drawn
 * shorter than a near one is a lie told in pixels.
 */
export function projectFloor(floor: Floor, camera: Camera, size = 1000): FloorProjection {
  const plan = floorPlan(floor);
  const view = viewer(camera);
  const rooms = new Map(floor.rooms.map((room) => [room.id, room]));

  const raw: Raw[] = [];
  const hidden: { roomId: string; wallId: string }[] = [];

  for (const drawn of plan.rooms) {
    const room = rooms.get(drawn.roomId);
    if (!room) continue;

    // The floor of the room, always. It is what makes a dollhouse read as
    // rooms with floors rather than a set of standing panels.
    const floorFace = drawn.outline.map((p) => view(p, 0));
    raw.push({
      roomId: drawn.roomId,
      roomName: drawn.name,
      wallId: 'floor',
      kind: 'floor',
      points: floorFace.map((v) => ({ x: v.x, y: v.y })),
      depth: Math.max(...floorFace.map((v) => v.depth)) + 1e6,
      shade: drawn.placed ? 0.92 : 0.97,
      placed: drawn.placed,
    });

    const normals = outwardOf(drawn.outline, drawn.name);

    room.walls.forEach((wall, i) => {
      const a = drawn.outline[i]!;
      const b = drawn.outline[(i + 1) % drawn.outline.length]!;
      const normal = normals[i]!;
      const towardsViewer = facing(normal, camera.turn);
      if (towardsViewer < 0) {
        // Its outside faces us, so it stands between the viewer and the room
        // they are trying to look into. This is the whole trick.
        hidden.push({ roomId: drawn.roomId, wallId: wall.id });
        return;
      }

      const top = feet((wall.height ?? room.ceilingHeight).value);
      const quad = [view(a, 0), view(b, 0), view(b, top), view(a, top)];
      const shade = 0.55 + 0.35 * Math.abs(towardsViewer);
      raw.push({
        roomId: drawn.roomId,
        roomName: drawn.name,
        wallId: wall.id,
        kind: 'wall',
        points: quad.map((v) => ({ x: v.x, y: v.y })),
        depth: quad.reduce((sum, v) => sum + v.depth, 0) / 4,
        // An open span is a gap in the wall, not a wall. Drawn pale rather
        // than left out, so the outline of the room still closes.
        shade: wall.open ? 0.97 : shade,
        placed: drawn.placed,
      });

      // Doors and windows, out of the room model rather than out of the flat
      // plan: `DrawnOpening` carries a width and a place along the wall and
      // has no sill and no head, because a flat drawing does not need them.
      const length = Number(runLength(wall));
      if (length === 0) return;
      for (const opening of wall.openings ?? []) {
        const from = Number(opening.offsetFromStart.value) / length;
        const to = from + Number(opening.width.value) / length;
        const sill = feet(opening.sillHeight?.value ?? 0n);
        const head = sill + feet(opening.height.value);
        const along = (t: number): Point => ({
          x: a.x + ((b.x - a.x) * BigInt(Math.round(t * 1e6))) / 1_000_000n,
          y: a.y + ((b.y - a.y) * BigInt(Math.round(t * 1e6))) / 1_000_000n,
        });
        const [left, right] = [along(from), along(to)];
        const hole = [view(left, sill), view(right, sill), view(right, head), view(left, head)];
        raw.push({
          roomId: drawn.roomId,
          roomName: drawn.name,
          wallId: wall.id,
          kind: 'opening',
          openingKind: opening.kind,
          points: hole.map((v) => ({ x: v.x, y: v.y })),
          depth: hole.reduce((sum, v) => sum + v.depth, 0) / 4 - 0.01,
          shade: opening.kind === 'window' ? 0.99 : 0.8,
          placed: drawn.placed,
        });
      }
    });
  }

  if (raw.length === 0) {
    return { facets: [], hidden, unplaced: plan.unplaced, notes: plan.notes, labels: [] };
  }

  // Fit the whole floor into the box asked for, keeping its shape.
  const xs = raw.flatMap((f) => f.points.map((p) => p.x));
  const ys = raw.flatMap((f) => f.points.map((p) => p.y));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 1e-9);
  const scale = (size * 0.92) / span;
  const offsetX = (size - (maxX - minX) * scale) / 2;
  const offsetY = (size - (maxY - minY) * scale) / 2;
  const onScreen = (p: { x: number; y: number }) => ({
    x: offsetX + (p.x - minX) * scale,
    y: offsetY + (p.y - minY) * scale,
  });

  // Solids by depth, and every wall's openings immediately after it.
  //
  // An opening lies in the plane of the wall it is a hole in, so no depth
  // comparison can separate the two honestly -- they are exactly the same
  // distance away. Sorting on depth alone painted a wall over its own window on
  // Sam's garage, which is why the room's own view stopped doing it, and this
  // has to make the same choice or the two views disagree about a window.
  const solids = raw.filter((f) => f.kind !== 'opening').sort((a, b) => b.depth - a.depth);
  const ordered: Raw[] = [];
  for (const solid of solids) {
    ordered.push(solid);
    if (solid.kind === 'wall') {
      ordered.push(
        ...raw.filter(
          (f) => f.kind === 'opening' && f.roomId === solid.roomId && f.wallId === solid.wallId
        )
      );
    }
  }

  const facets: FloorFacet[] = ordered.map((f) => ({
    roomId: f.roomId,
    roomName: f.roomName,
    wallId: f.wallId,
    kind: f.kind,
    ...(f.openingKind ? { openingKind: f.openingKind } : {}),
    points: f.points.map(onScreen),
    depth: f.depth,
    shade: f.shade,
    placed: f.placed,
  }));

  // A name goes where the middle of the room's floor lands, at floor level --
  // not at the middle of its facets, which would drift up the walls and put a
  // kitchen's label on the ceiling of the room in front of it.
  const labels = plan.rooms
    .filter((drawn) => rooms.has(drawn.roomId))
    .map((drawn) => ({
      roomId: drawn.roomId,
      name: drawn.name,
      at: onScreen(view(drawn.at, 0)),
      placed: drawn.placed,
    }));

  return { facets, hidden, unplaced: plan.unplaced, notes: plan.notes, labels };
}
