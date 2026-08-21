#!/usr/bin/env python3
"""
Read a RoomPlan export and print what it actually contains.

Trueline's room model was designed against Apple's RoomPlan documentation. This
script exists to check that design against a real scan of a real room, because
documentation says what a format can hold and a scan says what it does hold.
Every finding in DECISIONS.md under "What a real RoomPlan export actually
contains" came out of this script; re-run it on any scan and the numbers are
reproducible.

Usage:

    python3 inspect-roomplan.py path/to/JSON

where the directory holds `room.json` and, optionally, the per-frame
`frame_NNNNN.json` files. Nothing is written and nothing leaves the machine.

Deliberately dependency-free: standard library only, so it runs wherever Python
does. It uses floats throughout, which is correct here — this is a diagnostic
that reports what a float-based sensor recorded, not a step in the measurement
path. Nothing it prints is a Trueline measurement.
"""

from __future__ import annotations

import glob
import itertools
import json
import math
import os
import sys

M_TO_SQ_FT = 10.7639104


# RoomPlan transforms are simd_float4x4 flattened column-major: entry i is
# m[column i // 4][row i % 4]. So columns 0..2 are the local axes in the parent
# frame and column 3 is the origin.
def origin(m):
    return (m[12], m[13], m[14])


def yaw_degrees(m):
    """Heading of the local +X axis, projected onto the horizontal plane."""
    return math.degrees(math.atan2(-m[2], m[0]))


def plan_direction(m):
    return (m[0], m[2])


def plan_origin(m):
    return (m[12], m[14])


def endpoints(item):
    """A wall, door or window as its two ends in the plan, from centre and length."""
    m = item["transform"]
    length = item["dimensions"][0]
    dx, dz = plan_direction(m)
    cx, cz = plan_origin(m)
    return (cx - dx * length / 2, cz - dz * length / 2), (cx + dx * length / 2, cz + dz * length / 2)


def only_key(enum_object):
    """RoomPlan encodes its enums as a single-key object: {"wall": {}}, not "wall"."""
    keys = list(enum_object)
    if len(keys) != 1:
        raise ValueError(f"expected a single-key enum object, got {enum_object!r}")
    return keys[0]


def invert_rigid(m):
    """Inverse of a rotation-plus-translation, without inverting a general matrix."""
    rot = [[m[0], m[4], m[8]], [m[1], m[5], m[9]], [m[2], m[6], m[10]]]
    t = [m[12], m[13], m[14]]
    transposed = [[rot[j][i] for j in range(3)] for i in range(3)]
    inverse_t = [-sum(transposed[i][k] * t[k] for k in range(3)) for i in range(3)]
    return transposed, inverse_t


def shoelace(points):
    total = 0.0
    for i in range(len(points)):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % len(points)]
        total += x1 * y2 - x2 * y1
    return abs(total) / 2


def report_walls(room):
    walls = room["walls"]
    print(f"WALLS ({len(walls)})")
    print("  #  length(m)  height(m)  thickness  yaw(deg)   confidence")
    for i, w in enumerate(walls):
        length, height, thickness = w["dimensions"]
        print(
            f"  {i:<2} {length:9.4f}  {height:9.4f}  {thickness:9.4f}  "
            f"{yaw_degrees(w['transform']):8.3f}   {only_key(w['confidence'])}"
        )

    yaws = [yaw_degrees(w["transform"]) for w in walls]
    datum = yaws[0]
    print(f"\n  Squareness, relative to wall 0 ({datum:.3f} deg):")
    for i, y in enumerate(yaws):
        offset = (y - datum) % 90
        if offset > 45:
            offset -= 90
        note = "square" if abs(offset) < 0.01 else f"OFF-GRID by {offset:+.3f} deg"
        print(f"    wall {i}: {note}")

    heights = sorted({round(w["dimensions"][1], 4) for w in walls})
    print(f"\n  Distinct wall heights: {heights}")
    if len(heights) > 1:
        print("    -> wall heights vary within one room; Wall.height must be per-wall.")

    thicknesses = sorted({w["dimensions"][2] for w in walls})
    print(f"  Distinct wall thicknesses: {thicknesses}")
    if thicknesses == [0.0]:
        print("    -> thickness is not exported at all. Any thickness drawn is assumed.")


def report_closure(room):
    walls = room["walls"]
    ends = [endpoints(w) for w in walls]
    print("\nCLOSURE")
    points = []
    for i, (a, b) in enumerate(ends):
        points.append((i, "A", a))
        points.append((i, "B", b))

    matched = set()
    for (i, ta, pa), (j, tb, pb) in itertools.combinations(points, 2):
        if i == j:
            continue
        gap = math.hypot(pa[0] - pb[0], pa[1] - pb[1])
        if gap < 0.001:
            matched.add((i, ta))
            matched.add((j, tb))
            print(f"  wall {i}{ta} meets wall {j}{tb}: gap {gap * 1000:.3f} mm")

    dangling = [(i, t) for i, t, _ in points if (i, t) not in matched]
    if dangling:
        print(f"  Wall ends meeting nothing: {['wall %d%s' % d for d in dangling]}")
        print("    -> not every exported wall is on the room's closed outline.")


def report_floor(room):
    if not room.get("floors"):
        return
    floor = room["floors"][0]
    corners = [(p[0], p[1]) for p in floor["polygonCorners"]]
    if not corners:
        return
    area = shoelace(corners)
    print(f"\nFLOOR ({len(corners)} corners)")
    print(f"  area = {area:.4f} m^2 = {area * M_TO_SQ_FT:.2f} sq ft")
    total = 0.0
    for i in range(len(corners)):
        x1, y1 = corners[i]
        x2, y2 = corners[(i + 1) % len(corners)]
        length = math.hypot(x2 - x1, y2 - y1)
        total += length
        print(f"    edge {i}: {length:7.4f} m at {math.degrees(math.atan2(y2 - y1, x2 - x1)):8.3f} deg")
    wall_total = sum(w["dimensions"][0] for w in room["walls"])
    print(f"  floor perimeter {total:.4f} m vs sum of wall lengths {wall_total:.4f} m")
    if abs(total - wall_total) > 0.01:
        print("    -> the outline and the walls are not the same set of edges.")


def report_openings(room):
    walls = {w["identifier"]: (i, w) for i, w in enumerate(room["walls"])}
    print("\nOPENINGS")
    floor_level = None
    if room["walls"]:
        w0 = room["walls"][0]
        floor_level = origin(w0["transform"])[1] - w0["dimensions"][1] / 2

    for kind in ("doors", "windows", "openings"):
        for o in room.get(kind, []):
            parent = o.get("parentIdentifier")
            if parent not in walls:
                print(f"  {kind[:-1]}: parent wall {parent} is not in this room")
                continue
            index, wall = walls[parent]
            dx, dz = plan_direction(wall["transform"])
            a, _ = endpoints(wall)
            ox, oz = plan_origin(o["transform"])
            along = (ox - a[0]) * dx + (oz - a[1]) * dz
            perpendicular = -(ox - a[0]) * dz + (oz - a[1]) * dx
            width, height, _ = o["dimensions"]
            sill = origin(o["transform"])[1] - height / 2
            line = (
                f"  {kind[:-1]:7} on wall {index}: centre {along:.4f} m from end A, "
                f"width {width:.4f}, height {height:.4f}, "
                f"off-plane {perpendicular * 1000:+.2f} mm"
            )
            if floor_level is not None:
                line += f", sill {(sill - floor_level) * 1000:.0f} mm above floor"
            print(line)
    if not room.get("openings"):
        print("  (no cased openings detected)")


def report_objects(room):
    print("\nOBJECTS")
    for i, o in enumerate(room.get("objects", [])):
        length, height, depth = o["dimensions"]
        print(
            f"  {i}: {only_key(o['category']):10} {length:.3f} x {depth:.3f} x {height:.3f} m, "
            f"confidence {only_key(o['confidence'])}"
        )
    categories = sorted({only_key(o["category"]) for o in room.get("objects", [])})
    print(f"  Category vocabulary in this scan: {categories}")


def report_frames(directory, room):
    files = sorted(glob.glob(os.path.join(directory, "frame_*.json")))
    if not files:
        return
    print(f"\nFRAMES ({len(files)})")
    rot, translation = invert_rigid(room["referenceOriginTransform"])
    quality = {}
    motion = []
    positions = []
    fovs = []
    for path in files:
        with open(path, encoding="utf-8") as handle:
            frame = json.load(handle)
        quality[frame["trackingQuality"]] = quality.get(frame["trackingQuality"], 0) + 1
        motion.append(frame["motionQuality"])
        m = frame["cameraPoseARFrame"]
        world = [m[12], m[13], m[14]]
        positions.append(
            [sum(rot[i][k] * world[k] for k in range(3)) + translation[i] for i in range(3)]
        )
        fx, cx = frame["intrinsics"][0], frame["intrinsics"][2]
        fovs.append(2 * math.degrees(math.atan(cx / fx)))

    print(f"  tracking quality: {quality}")
    print(f"  motion quality: min {min(motion):.3f}, mean {sum(motion) / len(motion):.3f}")
    print(f"  horizontal field of view: {min(fovs):.2f} to {max(fovs):.2f} deg")
    # The room frame's y origin is not the floor, so heights are reported against
    # the floor plane, which is where a person would measure them from.
    floor_level = None
    if room["walls"]:
        w0 = room["walls"][0]
        floor_level = origin(w0["transform"])[1] - w0["dimensions"][1] / 2
    for axis, index in (("x", 0), ("y", 1), ("z", 2)):
        values = [p[index] for p in positions]
        print(f"  camera {axis} in room frame: {min(values):+.3f} to {max(values):+.3f} m")
    if floor_level is not None:
        heights = [p[1] - floor_level for p in positions]
        print(f"  camera height above floor: {min(heights):.3f} to {max(heights):.3f} m")
    print("    -> camera poses land inside the room model once referenceOriginTransform")
    print("       is inverted, which is the composition photo.ts depends on.")


def main(argv):
    if len(argv) != 2:
        print(__doc__.strip())
        return 2
    directory = argv[1]
    with open(os.path.join(directory, "room.json"), encoding="utf-8") as handle:
        room = json.load(handle)

    print(f"RoomPlan export version {room['version']}, story {room['story']}")
    sections = room.get("sections", [])
    print(f"Sections: {[s.get('label') for s in sections]}")
    report_walls(room)
    report_closure(room)
    report_floor(room)
    report_openings(room)
    report_objects(room)
    report_frames(directory, room)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
