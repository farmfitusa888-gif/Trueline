/*
 * The room you can drive, the plan it turns into, and the rule down the edge.
 *
 * This is the whole of the site's JavaScript. It was `room3d.js` and it is one
 * file still, because the room, the blueprint and the scroll rule share one set
 * of geometry and one set of switches, and splitting them would mean the same
 * kitchen written down twice.
 *
 * ## Why the 3D is hand-written and not a 3D library
 *
 * The whole scene is one room: six planes, a door, a window, a floor and
 * fourteen boxes of furniture. A general-purpose 3D engine is several hundred
 * kilobytes to draw that, and every one of those kilobytes is loaded on a phone
 * with two bars, by a contractor standing outside a house, to look at a
 * marketing page.
 *
 * It also means the geometry is the product's own. The room below is the same
 * 21' × 20' kitchen the app's own tests and screenshots use, at the same 9'
 * ceiling — not a model somebody drew to look like a room.
 *
 * ## Why the dimensions are SVG rather than 3D text
 *
 * Because they are a drawing, not an object. Dimension lines on a real sheet
 * are flat, crisp, and the same weight wherever they are on the page. Rendered
 * as textured quads in the scene they would blur, foreshorten and read as a
 * video game. So the scene projects each dimension's two ends to screen space
 * every frame and the SVG overlay draws the witness lines, the ticks and the
 * figure in the page's own mono face.
 *
 * ## Degrading
 *
 * No WebGL — an old browser, a locked-down one, a machine with the GPU
 * blacklisted — and the stage switches to Blueprint, which is pure SVG and
 * needs no GPU at all, and the 3D button is removed rather than left on the
 * page doing nothing. Every other switch goes on working. No JavaScript at all
 * and the <noscript> plan the generator puts inside the stage is what shows.
 *
 * `prefers-reduced-motion` stops the room turning on its own. It does not stop
 * you turning it, because that is not motion anybody has to sit through.
 */

const NS = 'http://www.w3.org/2000/svg';

/* ------------------------------------------------------------ the room */

/**
 * The kitchen, in feet, from the app's own fixture.
 *
 * 21' × 20', 9' ceiling, one door on the west wall and one window on the north.
 * These are the numbers on the screenshots elsewhere on this page, which is the
 * point: it is one room, drawn twice — once in perspective and once in plan.
 */
const ROOM = {
  w: 21, d: 20, h: 9,
  door:   { wall: 'west',  at: 5.5, width: 3,   height: 6.67 },
  window: { wall: 'north', at: 8,   width: 4,   height: 4, sill: 3 },
};

const X0 = -ROOM.w / 2, X1 = ROOM.w / 2;   // west, east
const Z0 = -ROOM.d / 2, Z1 = ROOM.d / 2;   // north, south
const DOOR_A = Z0 + ROOM.door.at, DOOR_B = DOOR_A + ROOM.door.width;
const WIN_A = X0 + ROOM.window.at, WIN_B = WIN_A + ROOM.window.width;

/**
 * What is standing in it.
 *
 * A kitchen the way one is actually laid out: cabinet runs pushed against the
 * walls, the sink run under the window, tall storage and the refrigerator down
 * the east wall, an island in the middle and a table in the corner the door
 * does not swing into. Every box is [x0, x1, y0, y1, z0, z1] in feet.
 *
 * `plan: false` keeps a box out of the 2D drawing — the table legs are under
 * the top and a plan does not show them.
 */
const FURNITURE = [
  { name: 'Base run, north',  box: [X0, X1, 0, 3.0, Z0, Z0 + 2], key: true },
  { name: 'Tall storage',     box: [8.5, X1, 0, 7.5, -8, -3.5], key: true },
  { name: 'Refrigerator',     box: [8.0, X1, 0, 6.0, -3.5, -0.5], key: true },
  { name: 'Base run, south',  box: [-3.5, X1, 0, 3.0, Z1 - 2, Z1], key: true },
  { name: 'Island',           box: [-3, 4, 0, 3.0, -3, 0.5], key: true },

  { name: 'Table',            box: [-8.5, -4.5, 2.15, 2.4, 2, 6], key: true },
  { name: 'Table leg',        box: [-8.3, -8.0, 0, 2.15, 2.2, 2.5], plan: false },
  { name: 'Table leg',        box: [-5.0, -4.7, 0, 2.15, 2.2, 2.5], plan: false },
  { name: 'Table leg',        box: [-8.3, -8.0, 0, 2.15, 5.5, 5.8], plan: false },
  { name: 'Table leg',        box: [-5.0, -4.7, 0, 2.15, 5.5, 5.8], plan: false },
  { name: 'Chair',            box: [-7.1, -5.9, 0, 1.5, 0.6, 1.8] },
  { name: 'Chair',            box: [-7.1, -5.9, 0, 1.5, 6.2, 7.4] },
  { name: 'Chair',            box: [-9.9, -8.7, 0, 1.5, 3.4, 4.6] },
  { name: 'Chair',            box: [-4.3, -3.1, 0, 1.5, 3.4, 4.6] },
];

/** The four walls, for the label overlay: which way each faces, and how long. */
const WALLS = [
  { name: 'North', feet: ROOM.w, at: [0, ROOM.h * 0.72, Z0], out: [0, 0, -1] },
  { name: 'South', feet: ROOM.w, at: [0, ROOM.h * 0.72, Z1], out: [0, 0, 1] },
  { name: 'East',  feet: ROOM.d, at: [X1, ROOM.h * 0.72, 0], out: [1, 0, 0] },
  { name: 'West',  feet: ROOM.d, at: [X0, ROOM.h * 0.72, 0], out: [-1, 0, 0] },
];

/* ------------------------------------------------------- small matrix math */

/**
 * a × b, both COLUMN-major, which is what OpenGL wants and what everything
 * below builds.
 *
 * The first version of this multiplied them as if they were row-major. Every
 * matrix in this file is written column-major — element (row r, column c) lives
 * at `c * 4 + r` — so the product came out transposed and every vertex
 * projected somewhere meaningless. The result was not a distorted room. It was
 * an empty frame that cleared to exactly the right colour, so it read as a CSS
 * problem for an hour.
 */
const mul = (a, b) => {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      o[c * 4 + r] = a[r] * b[c * 4]
                   + a[4 + r] * b[c * 4 + 1]
                   + a[8 + r] * b[c * 4 + 2]
                   + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
};

const perspective = (fov, aspect, near, far) => {
  const f = 1 / Math.tan(fov / 2);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, (2 * far * near) / (near - far), 0,
  ]);
};

const lookAt = (eye, at, up) => {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (v) => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = norm(sub(eye, at));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
};

/* ------------------------------------------------------------- geometry */

/**
 * One quad, as two triangles, wound so its front face looks at `from` — or
 * away from it, which is what a solid object needs.
 *
 * ## Why the winding is computed rather than trusted
 *
 * WebGL culls by winding order, and getting eight wall quads and eighty-four
 * furniture quads right by hand is a thing you get wrong once and cannot see,
 * because the result is not a glitch. It is an empty frame. The first version
 * of this drew nothing at all and the canvas cleared to exactly the right
 * colour, so it looked like a styling problem.
 *
 * So the normal is worked out from the three points, compared against a
 * reference point, and the order reversed when it is the wrong way round.
 *
 * For the room the reference is the middle of the room and the faces look
 * INWARD: back-face culling then removes the walls between the camera and the
 * room, which is the dollhouse view, for free, from the same rule that stops
 * the geometry being invisible.
 *
 * For a piece of furniture the reference is that box's own centre and the faces
 * look OUTWARD, because a cabinet is a solid you stand outside of. Same
 * function, one argument different — copying it and flipping the comparison by
 * hand is how the two drift apart.
 */
const MIDDLE = [0, ROOM.h / 2, 0];

function quad(out, a, b, c, d, shade, from = MIDDLE, faceOut = false) {
  const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
  const u = sub(b, a), w = sub(c, a);
  const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  const centre = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2];
  const away = sub(centre, from);
  const pointsAway = n[0] * away[0] + n[1] * away[1] + n[2] * away[2] > 0;
  const flip = faceOut ? !pointsAway : pointsAway;
  const order = flip ? [a, d, c, a, c, b] : [a, b, c, a, c, d];
  for (const p of order) out.push(p[0], p[1], p[2], shade);
}

/** A solid box, six quads, every face looking out of it. */
function box(out, [x0, x1, y0, y1, z0, z1], base) {
  const at = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  const put = (a, b, c, d, shade) => quad(out, a, b, c, d, shade, at, true);
  // Each face a different value so an edge between two of them is visible even
  // before the chalk lines go on top.
  put([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], base + 0.24); // top
  put([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], base - 0.12); // bottom
  put([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], base - 0.05); // west
  put([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], base + 0.07); // east
  put([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], base - 0.09); // north
  put([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], base + 0.13); // south
}

/** The twelve edges of a box, as line pairs, for the chalk outline. */
function boxEdges(out, [x0, x1, y0, y1, z0, z1]) {
  const p = [
    [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
    [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
  ];
  const pairs = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  for (const [i, j] of pairs) {
    out.push(p[i][0], p[i][1], p[i][2], 1, p[j][0], p[j][1], p[j][2], 1);
  }
}

/**
 * The shell: floor and walls, with the openings cut out of them.
 *
 * A wall with a hole in it is four quads — under, over, and one each side —
 * which is the same way the app's own plan draws an opening, and the reason the
 * door reads as a door rather than as a dark rectangle painted on a wall.
 */
function buildShell() {
  const v = [];
  const { h } = ROOM;

  quad(v, [X0, 0, Z0], [X1, 0, Z0], [X1, 0, Z1], [X0, 0, Z1], 0.20);          // floor

  // North wall, with the window cut out of it.
  {
    const { height, sill } = ROOM.window;
    quad(v, [X0, 0, Z0], [WIN_A, 0, Z0], [WIN_A, h, Z0], [X0, h, Z0], 0.48);
    quad(v, [WIN_B, 0, Z0], [X1, 0, Z0], [X1, h, Z0], [WIN_B, h, Z0], 0.48);
    quad(v, [WIN_A, 0, Z0], [WIN_B, 0, Z0], [WIN_B, sill, Z0], [WIN_A, sill, Z0], 0.48);
    quad(v, [WIN_A, sill + height, Z0], [WIN_B, sill + height, Z0], [WIN_B, h, Z0], [WIN_A, h, Z0], 0.48);
    // The reveal, so the opening has depth rather than being a hole in a sheet.
    quad(v, [WIN_A, sill, Z0], [WIN_B, sill, Z0], [WIN_B, sill, Z0 + 0.4], [WIN_A, sill, Z0 + 0.4], 0.42);
  }

  // West wall, with the door cut out of it.
  {
    const { height } = ROOM.door;
    quad(v, [X0, 0, Z0], [X0, h, Z0], [X0, h, DOOR_A], [X0, 0, DOOR_A], 0.42);
    quad(v, [X0, 0, DOOR_B], [X0, h, DOOR_B], [X0, h, Z1], [X0, 0, Z1], 0.42);
    quad(v, [X0, height, DOOR_A], [X0, h, DOOR_A], [X0, h, DOOR_B], [X0, height, DOOR_B], 0.42);
  }

  quad(v, [X1, 0, Z0], [X1, 0, Z1], [X1, h, Z1], [X1, h, Z0], 0.34);          // east
  quad(v, [X0, 0, Z1], [X1, 0, Z1], [X1, h, Z1], [X0, h, Z1], 0.48);          // south

  return new Float32Array(v);
}

function buildFurniture() {
  const faces = [], lines = [];
  for (const piece of FURNITURE) {
    box(faces, piece.box, 0.55);
    boxEdges(lines, piece.box);
  }
  return { faces: new Float32Array(faces), lines: new Float32Array(lines) };
}

/* --------------------------------------------------------------- shaders */

const VERT = `
attribute vec4 a;        // xyz + shade
uniform mat4 mvp;
varying float sh;
void main() {
  sh = a.w;
  gl_Position = mvp * vec4(a.xyz, 1.0);
}`;

/*
 * Ink laid OVER the ground, not multiplied into black.
 *
 * `tint * sh` made every surface a fraction of the tint colour, so the floor at
 * 0.20 came out almost black and the room read as a hole rather than as a
 * drawing. Mixing from the stage's own ground toward the tint keeps the lighter
 * faces on the panel and the darker ones in shadow — which is how a shaded
 * drawing actually looks, and it follows the page into light mode for free.
 */
const FRAG = `
precision mediump float;
varying float sh;
uniform vec3 tint;
uniform vec3 ground;
void main() { gl_FragColor = vec4(mix(ground, tint, sh), 1.0); }`;

function compile(gl, kind, src) {
  const s = gl.createShader(kind);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
}

/**
 * What to dimension in the 3D view, and where the figure sits.
 *
 * Each entry is two points in the room's own coordinates and the text to print
 * between them — the same figures the app puts on a plan.
 */
const DIMS = [
  { from: [X0, 0.02, Z0 - 0.6], to: [X1, 0.02, Z0 - 0.6], text: "21'" },
  { from: [X1 + 0.6, 0.02, Z0], to: [X1 + 0.6, 0.02, Z1], text: "20'" },
  { from: [X1, 0, Z1], to: [X1, ROOM.h, Z1], text: "9'" },
];

/* ---------------------------------------------------------- the blueprint */

/**
 * The plan, as a real 2D drawing rather than a camera pointed downward.
 *
 * A top-down 3D view is a photograph of a room from above. A plan is a
 * different document: walls in poché with the openings broken out of them, a
 * door with its swing, a window in its gap, furniture in outline, dimension
 * lines with witness lines and arrowheads. It is drawn in feet — the SVG
 * viewBox is the room plus its margins — so every number here is the same
 * number the room upstairs is built from.
 *
 * It needs no WebGL, which is why it is also the answer when there is none.
 */
const T = 0.5;                       // wall thickness, feet
const OX0 = X0 - T, OX1 = X1 + T;    // outside face of the walls
const OZ0 = Z0 - T, OZ1 = Z1 + T;
const PLAN_BOX = { x: -15.5, y: -15, w: 31, h: 30 };

const svgEl = (name, attrs) => {
  const el = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

const rect = (x0, z0, x1, z1, cls) =>
  svgEl('rect', { x: x0, y: z0, width: x1 - x0, height: z1 - z0, class: cls });

const seg = (x1, y1, x2, y2, cls) => svgEl('line', { x1, y1, x2, y2, class: cls });

const label = (x, y, text, cls, size, rotate) => {
  const el = svgEl('text', { x, y, class: cls });
  // In the plan the size is in feet, so it scales with the drawing. On the rule
  // it comes from the stylesheet, and setting the attribute to `null` here
  // would write the string "null" into it and lose the text entirely.
  if (size != null) el.setAttribute('font-size', size);
  if (rotate) el.setAttribute('transform', `rotate(${rotate} ${x} ${y})`);
  el.textContent = text;
  return el;
};

/** An arrowhead at (x, y) pointing along (dx, dy), both unit. */
function arrow(x, y, dx, dy) {
  const L = 0.55, W = 0.16;
  const px = -dy, py = dx;
  return svgEl('polygon', {
    class: 'p-arrow',
    points: [
      `${x},${y}`,
      `${x - dx * L + px * W},${y - dy * L + py * W}`,
      `${x - dx * L - px * W},${y - dy * L - py * W}`,
    ].join(' '),
  });
}

/** One dimension: witness lines out of the thing, a broken line, two arrows. */
function dimension(g, { x1, y1, x2, y2, from, text, vertical }) {
  const gap = 1.5;
  if (vertical) {
    g.append(seg(from, y1, x1 + 0.4, y1, 'p-wit'), seg(from, y2, x1 + 0.4, y2, 'p-wit'));
    const mid = (y1 + y2) / 2;
    g.append(seg(x1, y1, x1, mid - gap, 'p-dim'), seg(x1, mid + gap, x1, y2, 'p-dim'));
    g.append(arrow(x1, y1, 0, -1), arrow(x1, y2, 0, 1));
    g.append(label(x1, mid, text, 'p-fig', 1.05, -90));
  } else {
    g.append(seg(x1, from, x1, y1 + 0.4, 'p-wit'), seg(x2, from, x2, y1 + 0.4, 'p-wit'));
    const mid = (x1 + x2) / 2;
    g.append(seg(x1, y1, mid - gap, y1, 'p-dim'), seg(mid + gap, y1, x2, y1, 'p-dim'));
    g.append(arrow(x1, y1, -1, 0), arrow(x2, y1, 1, 0));
    g.append(label(mid, y1, text, 'p-fig', 1.05));
  }
}

function drawPlan(svg) {
  svg.setAttribute('viewBox', `${PLAN_BOX.x} ${PLAN_BOX.y} ${PLAN_BOX.w} ${PLAN_BOX.h}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const g = svgEl('g', {});

  /* --- the walls, in poché, broken at the openings --- */
  const walls = svgEl('g', { class: 'p-walls' });
  walls.append(
    rect(OX0, OZ0, WIN_A, Z0, 'p-poche'),      // north, west of the window
    rect(WIN_B, OZ0, OX1, Z0, 'p-poche'),      // north, east of it
    rect(OX0, Z1, OX1, OZ1, 'p-poche'),        // south
    rect(OX0, Z0, X0, DOOR_A, 'p-poche'),      // west, north of the door
    rect(OX0, DOOR_B, X0, Z1, 'p-poche'),      // west, south of it
    rect(X1, Z0, OX1, Z1, 'p-poche'),          // east
  );
  g.append(walls);

  /* --- the door: a leaf and the arc it sweeps --- */
  const openings = svgEl('g', { class: 'p-openings' });
  openings.append(
    seg(X0, DOOR_A, X0 + ROOM.door.width, DOOR_A, 'p-open'),
    svgEl('path', {
      class: 'p-swing',
      d: `M ${X0 + ROOM.door.width} ${DOOR_A} A ${ROOM.door.width} ${ROOM.door.width} 0 0 1 ${X0} ${DOOR_B}`,
    }),
    seg(OX0, DOOR_A, X0, DOOR_A, 'p-open'),
    seg(OX0, DOOR_B, X0, DOOR_B, 'p-open'),
  );
  // The window: the frame drawn across its gap, and a jamb line each side.
  openings.append(
    seg(WIN_A, OZ0, WIN_A, Z0, 'p-open'),
    seg(WIN_B, OZ0, WIN_B, Z0, 'p-open'),
    seg(WIN_A, OZ0, WIN_B, OZ0, 'p-open'),
    seg(WIN_A, Z0, WIN_B, Z0, 'p-open'),
    seg(WIN_A, Z0 - T / 2, WIN_B, Z0 - T / 2, 'p-open'),
  );
  g.append(openings);

  /* --- what is standing in it --- */
  const furn = svgEl('g', { class: 'p-furn' });
  for (const piece of FURNITURE) {
    if (piece.plan === false) continue;
    const [x0, x1, , , z0, z1] = piece.box;
    furn.append(rect(x0, z0, x1, z1, piece.key ? 'key' : ''));
  }
  g.append(furn);

  /* --- the dimensions --- */
  const dims = svgEl('g', { class: 'p-dims' });
  dimension(dims, { x1: X0, x2: X1, y1: OZ1 + 2.2, from: OZ1, text: "21'" });
  dimension(dims, { x1: OX1 + 2.2, y1: Z0, y2: Z1, from: OX1, text: "20'", vertical: true });
  dimension(dims, { x1: WIN_A, x2: WIN_B, y1: OZ0 - 2.2, from: OZ0, text: "4'" });
  dimension(dims, { x1: OX0 - 2.2, y1: DOOR_A, y2: DOOR_B, from: OX0, text: "3'", vertical: true });
  g.append(dims);

  /* --- the wall names --- */
  const labels = svgEl('g', { class: 'p-labels' });
  labels.append(
    label(0, Z0 + 1.1, `NORTH · ${ROOM.w}'`, 'p-lab', 0.95),
    label(0, Z1 - 1.1, `SOUTH · ${ROOM.w}'`, 'p-lab', 0.95),
    label(X1 - 1.1, 0, `EAST · ${ROOM.d}'`, 'p-lab', 0.95, -90),
    label(X0 + 1.1, 0, `WEST · ${ROOM.d}'`, 'p-lab', 0.95, 90),
  );
  g.append(labels);

  /* --- north, because a plan without it is a picture --- */
  const north = svgEl('g', { class: 'p-northmark' });
  north.append(
    svgEl('polygon', { class: 'p-north', points: '13.2,-13.6 14.0,-11.6 13.2,-12.2 12.4,-11.6' }),
    label(13.2, -10.6, 'N', 'p-lab', 1),
  );
  g.append(north);

  svg.append(g);
}

/* ------------------------------------------------------------------ the 3D */

function room3d(stage, canvas, svg, state) {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false });
  if (!gl) return null;

  const program = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  const shell = buildShell();
  const { faces, lines } = buildFurniture();
  const upload = (data) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return b;
  };
  const buffers = { shell: upload(shell), faces: upload(faces), lines: upload(lines) };

  const loc = gl.getAttribLocation(program, 'a');
  gl.enableVertexAttribArray(loc);
  const uMvp = gl.getUniformLocation(program, 'mvp');
  const uTint = gl.getUniformLocation(program, 'tint');
  const uGround = gl.getUniformLocation(program, 'ground');

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  // The chalk edges sit exactly on the faces they outline, so without this the
  // two z-fight and the outline comes and goes as the room turns.
  gl.enable(gl.POLYGON_OFFSET_FILL);
  gl.polygonOffset(1, 1);

  /** Reads the page's own colours so the room follows light and dark. */
  const paint = () => {
    const css = getComputedStyle(document.documentElement);
    const read = (name, fallback) => {
      const raw = css.getPropertyValue(name).trim() || fallback;
      const m = /^#?([0-9a-f]{6})$/i.exec(raw);
      if (!m) return [0.5, 0.5, 0.5];
      const n = parseInt(m[1], 16);
      return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
    };
    return {
      steel: read('--steel', '#8FA0AC'),
      ink: read('--ink', '#E9ECEE'),
      ground: read('--sunk', '#1A1F23'),
    };
  };
  let colours = paint();
  const scheme = window.matchMedia('(prefers-color-scheme: dark)');
  scheme.addEventListener?.('change', () => { colours = paint(); });

  /* ---- the camera, and dragging it ---- */

  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let turn = -0.72, tilt = 0.40, spin = !still;
  let holding = null;

  const at = (event) => ({ x: event.clientX, y: event.clientY });
  stage.addEventListener('pointerdown', (event) => {
    if (state.view !== '3d' || event.target.closest('.panel')) return;
    holding = { ...at(event), turn, tilt, id: event.pointerId };
    spin = false;
    stage.setPointerCapture?.(event.pointerId);
  });
  stage.addEventListener('pointermove', (event) => {
    if (!holding) return;
    const p = at(event);
    turn = holding.turn - (p.x - holding.x) * 0.008;
    tilt = Math.max(0.06, Math.min(1.15, holding.tilt + (p.y - holding.y) * 0.005));
  });
  const letGo = () => {
    if (holding && stage.hasPointerCapture?.(holding.id)) stage.releasePointerCapture(holding.id);
    holding = null;
  };
  stage.addEventListener('pointerup', letGo);
  stage.addEventListener('pointercancel', letGo);

  /* ---- the overlay ---- */

  const line = (x1, y1, x2, y2, cls) => svgEl('line', { x1, y1, x2, y2, class: cls });

  // The drawing goes in its own group. The first version cleared the whole
  // <svg> every frame — including the <style> block that used to live inside it
  // — so from the second frame onwards the dimension lines had no stroke and
  // the figures fell back to plain black with no halo. The lines were there the
  // whole time, drawn in nothing. Those rules now live in style.css where
  // nothing can clear them, and this still only ever empties its own group.
  const layer = svgEl('g', {});
  svg.append(layer);

  function overlay(project, eye, w, h) {
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

    if (state.dims) {
      for (const dim of DIMS) {
        const a = project(dim.from);
        const b = project(dim.to);
        if (!a || !b) continue;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 42) continue;
        // A gap in the middle for the figure, the way a dimension line is drawn.
        const gap = Math.min(len * 0.3, 26);
        const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
        layer.append(
          line(a.x, a.y, mx - ux * gap, my - uy * gap, 'dim'),
          line(mx + ux * gap, my + uy * gap, b.x, b.y, 'dim'),
          line(a.x - uy * 5, a.y + ux * 5, a.x + uy * 5, a.y - ux * 5, 'tick'),
          line(b.x - uy * 5, b.y + ux * 5, b.x + uy * 5, b.y - ux * 5, 'tick'),
        );
        const text = svgEl('text', { x: mx, y: my, class: 'fig' });
        text.textContent = dim.text;
        layer.append(text);
      }
    }

    if (state.labels) {
      for (const wall of WALLS) {
        // Only the walls you can actually see. Back-face culling has already
        // taken the near ones away, and a label floating where a wall used to
        // be is worse than no label.
        const away = wall.out[0] * (eye[0] - wall.at[0])
                   + wall.out[1] * (eye[1] - wall.at[1])
                   + wall.out[2] * (eye[2] - wall.at[2]);
        if (away > 0) continue;
        const p = project(wall.at);
        if (!p || p.x < 30 || p.x > w - 30 || p.y < 12 || p.y > h - 12) continue;
        const text = svgEl('text', { x: p.x, y: p.y, class: 'wall' });
        text.textContent = `${wall.name.toUpperCase()} · ${wall.feet}'`;
        layer.append(text);
      }
    }
  }

  /* ---- the loop ---- */

  let raf = 0;
  function frame() {
    const rect2 = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect2.width)), h = Math.max(1, Math.round(rect2.height));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr; canvas.height = h * dpr;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(...colours.ground, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if (spin) turn += 0.0016;

    // Far enough back that the floor stays inside the frame at the widest
    // aspect the stage takes, and close enough that a 4 ft window is still a
    // window rather than a dot.
    const radius = 41;
    const eye = [
      Math.sin(turn) * Math.cos(tilt) * radius,
      Math.sin(tilt) * radius + 2,
      Math.cos(turn) * Math.cos(tilt) * radius,
    ];
    const mvp = mul(perspective(0.62, w / h, 0.5, 200), lookAt(eye, [0, ROOM.h / 2, 0], [0, 1, 0]));

    gl.uniformMatrix4fv(uMvp, false, mvp);
    gl.uniform3fv(uGround, colours.ground);

    const draw = (buffer, tint, mode, count) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 16, 0);
      gl.uniform3fv(uTint, tint);
      gl.drawArrays(mode, 0, count);
    };
    draw(buffers.shell, colours.steel, gl.TRIANGLES, shell.length / 4);
    if (state.furn) {
      draw(buffers.faces, colours.steel, gl.TRIANGLES, faces.length / 4);
      draw(buffers.lines, colours.ink, gl.LINES, lines.length / 4);
    }

    const project = (p) => {
      const x = mvp[0] * p[0] + mvp[4] * p[1] + mvp[8] * p[2] + mvp[12];
      const y = mvp[1] * p[0] + mvp[5] * p[1] + mvp[9] * p[2] + mvp[13];
      const cw = mvp[3] * p[0] + mvp[7] * p[1] + mvp[11] * p[2] + mvp[15];
      if (cw <= 0.01) return null;
      return { x: (x / cw * 0.5 + 0.5) * w, y: (1 - (y / cw * 0.5 + 0.5)) * h };
    };
    overlay(project, eye, w, h);

    raf = requestAnimationFrame(frame);
  }

  const running = () => raf !== 0;
  const start = () => { if (!raf && state.view === '3d') raf = requestAnimationFrame(frame); };
  const stop = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } };

  // Only while it is on screen. A canvas animating behind three screens of
  // scrolled page is a phone getting warm for nothing.
  const watcher = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) start(); else stop();
    }
  }, { threshold: 0.01 });
  watcher.observe(stage);

  return { start, stop, running };
}

/* ------------------------------------------------------------ the switches */

function wireStage(stage) {
  const canvas = stage.querySelector('canvas');
  const svg = stage.querySelector('svg.over');
  const plan = stage.querySelector('svg.plan');
  const panel = document.querySelector('[data-room-panel]');
  if (!canvas || !svg || !plan || !panel) return;

  const state = { view: '3d', furn: true, dims: true, labels: false };
  drawPlan(plan);

  const engine = room3d(stage, canvas, svg, state);

  const show = () => {
    stage.dataset.view = state.view;
    stage.dataset.furn = state.furn ? 'on' : 'off';
    stage.dataset.dims = state.dims ? 'on' : 'off';
    stage.dataset.labels = state.labels ? 'on' : 'off';
    const is3d = state.view === '3d';
    canvas.hidden = !is3d;
    svg.hidden = !is3d;
    plan.hidden = is3d;
    if (engine) { if (is3d) engine.start(); else engine.stop(); }
  };

  if (!engine) {
    // No WebGL. Blueprint is the view, and the button that cannot work is
    // taken off the page rather than left there to be pressed.
    state.view = 'plan';
    stage.dataset.webgl = 'no';
    const group = panel.querySelector('.grp--view');
    const label3d = panel.querySelector('[data-view-label]');
    group?.remove();
    if (label3d) label3d.textContent = 'Blueprint';
    const said = document.createElement('span');
    said.className = 'note-t';
    said.textContent = 'This browser has no WebGL, so the plan is the view.';
    panel.prepend(said);
  } else {
    stage.dataset.webgl = 'yes';
    for (const button of panel.querySelectorAll('[data-view-btn]')) {
      button.addEventListener('click', () => {
        state.view = button.dataset.viewBtn;
        for (const other of panel.querySelectorAll('[data-view-btn]')) {
          other.setAttribute('aria-pressed', String(other === button));
        }
        show();
      });
    }
  }

  for (const button of panel.querySelectorAll('[data-toggle]')) {
    const key = button.dataset.toggle;
    button.setAttribute('aria-pressed', String(state[key]));
    button.addEventListener('click', () => {
      state[key] = !state[key];
      button.setAttribute('aria-pressed', String(state[key]));
      show();
    });
  }

  show();
  panel.hidden = false;
}

/* ------------------------------------------------- the rule down the edge */

/**
 * A graduated steel rule pinned to the left margin, with a cursor on it that
 * says how far down the page you are and which section you are in.
 *
 * The graduations are a scale, not decoration: the strip is the whole document
 * and a mark is a section, placed where that section arrives. It is drawn here
 * rather than in the HTML because none of it can be known until the page has
 * laid out, and it stays `hidden` until it has been.
 */
function wireScale(host) {
  const svg = host.querySelector('svg');
  if (!svg) return;

  const RULE = 66, MINOR = 58, MAJOR = 48, TEXT = 44;
  const marks = [...document.querySelectorAll('[data-mark]')].map((el) => ({
    el, name: el.dataset.mark,
  }));

  let ticks = null;
  let markEls = [];
  let cursor = null;

  function layout() {
    const h = host.clientHeight;
    if (!h) return;
    svg.setAttribute('viewBox', `0 0 80 ${h}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    ticks = svgEl('g', {});
    ticks.append(seg(RULE, 0, RULE, h, 'grad-major'));
    const step = 9;
    for (let y = 0, n = 0; y <= h; y += step, n += 1) {
      const major = n % 5 === 0;
      ticks.append(seg(major ? MAJOR : MINOR, y, RULE, y, major ? 'grad-major' : 'grad'));
    }
    svg.append(ticks);

    const span = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    markEls = marks.map((m) => {
      const top = m.el.getBoundingClientRect().top + window.scrollY;
      const at = Math.max(0, Math.min(1, top / span)) * h;
      const g = svgEl('g', {});
      const l = seg(MAJOR, at, RULE, at, 'mark-l');
      const t = label(TEXT, at, m.name, 'mark-t');
      t.setAttribute('text-anchor', 'end');
      t.setAttribute('dominant-baseline', 'middle');
      g.append(l, t);
      svg.append(g);
      return { at, l, t };
    });

    cursor = svgEl('g', {});
    cursor.append(
      svgEl('polygon', { class: 'cursor', points: `${RULE},0 ${RULE + 7},-4 ${RULE + 7},4` }),
      seg(RULE, 0, 80, 0, 'cursor-l'),
    );
    svg.append(cursor);
    place();
  }

  function place() {
    if (!cursor) return;
    const h = host.clientHeight;
    const span = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const at = Math.max(0, Math.min(1, window.scrollY / span)) * h;
    cursor.setAttribute('transform', `translate(0 ${at})`);
    let active = -1;
    markEls.forEach((m, i) => { if (m.at <= at + 2) active = i; });
    markEls.forEach((m, i) => {
      m.l.classList.toggle('on', i === active);
      m.t.classList.toggle('on', i === active);
    });
  }

  let pending = 0;
  const soon = (fn) => () => {
    if (pending) return;
    pending = requestAnimationFrame(() => { pending = 0; fn(); });
  };
  // Unhidden first, because the stylesheet is what decides whether there is
  // margin wide enough to hold it — and `layout` needs a laid-out height to
  // measure. Below that width the element is display:none and `layout` finds a
  // height of zero and does nothing, until a resize gives it one.
  host.hidden = false;
  window.addEventListener('scroll', soon(place), { passive: true });
  window.addEventListener('resize', soon(layout));
  layout();
}

/* ---------------------------------------------------------------- on load */

const stage = document.querySelector('[data-room3d]');
if (stage) {
  try { wireStage(stage); } catch { stage.dataset.webgl = 'no'; }
}

const scale = document.querySelector('[data-scale]');
if (scale) {
  try { wireScale(scale); } catch { scale.hidden = true; }
}

/** Everything else that moves: arriving once, on the way past. */
const rising = document.querySelectorAll('.rise');
if (rising.length) {
  const seen = new IntersectionObserver((entries, self) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('in');
      self.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -8% 0px' });
  for (const el of rising) seen.observe(el);
}
