/*
 * A real room, in WebGL, that you can grab and turn — with its dimensions
 * drawn over it in SVG so the figures stay crisp.
 *
 * ## Why this is hand-written and not a 3D library
 *
 * The whole scene is one room: six planes, a door, a window and a floor. A
 * general-purpose 3D engine is several hundred kilobytes to draw that, and
 * every one of those kilobytes is loaded on a phone with two bars, by a
 * contractor standing outside a house, to look at a marketing page. This is
 * about six kilobytes and does exactly the one thing.
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
 * every frame and the SVG overlay draws the witness lines, the arrowheads and
 * the figure in the page's own mono face.
 *
 * ## Degrading
 *
 * No WebGL — an old browser, a locked-down one, a machine with the GPU
 * blacklisted — and the whole thing removes itself and leaves the still
 * screenshot underneath. Nothing on the page depends on it.
 */

const NS = 'http://www.w3.org/2000/svg';

/* ------------------------------------------------------------ the room */

/**
 * The kitchen, in feet, from the app's own fixture.
 *
 * 21' × 20', 9' ceiling, one door on the west wall and one window on the north.
 * These are the numbers on the screenshots elsewhere on this page, which is
 * the point: it is one room, drawn twice.
 */
const ROOM = {
  w: 21, d: 20, h: 9,
  door:   { wall: 'west',  at: 5.5, width: 3,   height: 6.67 },
  window: { wall: 'north', at: 8,   width: 4,   height: 4, sill: 3 },
};

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
 * One quad, as two triangles, wound so its front face looks INTO the room.
 *
 * ## Why the winding is computed rather than trusted
 *
 * WebGL culls by winding order, and getting eight quads' vertex orders right by
 * hand — floor, four walls, the pieces around two openings — is a thing you get
 * wrong once and cannot see, because the result is not a glitch. It is an empty
 * frame. The first version of this drew nothing at all and the canvas cleared
 * to exactly the right colour, so it looked like a styling problem.
 *
 * So the normal is worked out from the three points, compared against the
 * middle of the room, and the order reversed when it points outward. With every
 * front face looking inward, back-face culling removes the walls between the
 * camera and the room — which is the dollhouse view, for free, from the same
 * rule that stops the geometry being invisible.
 */
const MIDDLE = [0, ROOM.h / 2, 0];

function quad(out, a, b, c, d, shade) {
  const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
  const u = sub(b, a), w = sub(c, a);
  const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  const centre = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2];
  const away = sub(centre, MIDDLE);
  const outward = n[0] * away[0] + n[1] * away[1] + n[2] * away[2] > 0;
  const order = outward ? [a, d, c, a, c, b] : [a, b, c, a, c, d];
  for (const p of order) out.push(p[0], p[1], p[2], shade);
}

/**
 * The room, built as planes with the openings cut out of them.
 *
 * A wall with a hole in it is four quads — under, over, and one each side —
 * which is the same way the app's own plan draws an opening, and the reason the
 * door reads as a door rather than as a dark rectangle painted on a wall.
 */
function build() {
  const v = [];
  const { w, d, h } = ROOM;
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2;

  // Floor.
  quad(v, [x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1], 0.20);

  // North wall (z0), with the window cut out of it.
  {
    const { at, width, height, sill } = ROOM.window;
    const a = x0 + at, b = a + width;
    quad(v, [x0, 0, z0], [a, 0, z0], [a, h, z0], [x0, h, z0], 0.48);            // left
    quad(v, [b, 0, z0], [x1, 0, z0], [x1, h, z0], [b, h, z0], 0.48);            // right
    quad(v, [a, 0, z0], [b, 0, z0], [b, sill, z0], [a, sill, z0], 0.48);        // under
    quad(v, [a, sill + height, z0], [b, sill + height, z0], [b, h, z0], [a, h, z0], 0.48); // over
    // The reveal, so the opening has depth rather than being a hole in a sheet.
    quad(v, [a, sill, z0], [b, sill, z0], [b, sill, z0 + 0.4], [a, sill, z0 + 0.4], 0.42);
  }

  // West wall (x0), with the door cut out of it.
  {
    const { at, width, height } = ROOM.door;
    const a = z0 + at, b = a + width;
    quad(v, [x0, 0, z0], [x0, h, z0], [x0, h, a], [x0, 0, a], 0.42);
    quad(v, [x0, 0, b], [x0, h, b], [x0, h, z1], [x0, 0, z1], 0.42);
    quad(v, [x0, height, a], [x0, h, a], [x0, h, b], [x0, height, b], 0.42);
  }

  // East and south walls, whole.
  quad(v, [x1, 0, z0], [x1, 0, z1], [x1, h, z1], [x1, h, z0], 0.34);
  quad(v, [x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1], 0.48);

  return new Float32Array(v);
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
 * Blueprint ink laid OVER the paper, not multiplied into black.
 *
 * `tint * sh` made every surface a fraction of the ink colour, so the floor at
 * 0.34 came out almost black and the room read as a hole rather than as a
 * drawing. Mixing from the page's own ground toward the ink keeps the lighter
 * faces on paper and the darker ones in ink — which is how a shaded drawing
 * actually looks, and it follows the page into dark mode for free.
 */
const FRAG = `
precision mediump float;
varying float sh;
uniform vec3 tint;
uniform vec3 ground;
void main() { gl_FragColor = vec4(mix(ground, tint, sh), 1.0); }`;

/* ------------------------------------------------------------------ setup */

function compile(gl, kind, src) {
  const s = gl.createShader(kind);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
}

/**
 * What to dimension, and where the label sits.
 *
 * Each entry is two points in the room's own coordinates and the text to print
 * between them — the same figures the app puts on a plan.
 */
const DIMS = [
  { from: [-ROOM.w / 2, 0.02, -ROOM.d / 2 - 0.6], to: [ROOM.w / 2, 0.02, -ROOM.d / 2 - 0.6], text: "21'" },
  { from: [ROOM.w / 2 + 0.6, 0.02, -ROOM.d / 2], to: [ROOM.w / 2 + 0.6, 0.02, ROOM.d / 2], text: "20'" },
  { from: [ROOM.w / 2, 0, ROOM.d / 2], to: [ROOM.w / 2, ROOM.h, ROOM.d / 2], text: "9'" },
];

export function room3d(stage) {
  const canvas = stage.querySelector('canvas');
  const svg = stage.querySelector('svg');
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false });
  if (!gl) { stage.dataset.webgl = 'no'; return false; }

  const program = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) { stage.dataset.webgl = 'no'; return false; }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { stage.dataset.webgl = 'no'; return false; }
  gl.useProgram(program);

  const data = build();
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, 'a');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 16, 0);
  const uMvp = gl.getUniformLocation(program, 'mvp');
  const uTint = gl.getUniformLocation(program, 'tint');
  const uGround = gl.getUniformLocation(program, 'ground');

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);

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
    return { blue: read('--blue', '#1F4E79'), ground: read('--paper-sunk', '#EFE9DC') };
  };
  let colours = paint();
  const scheme = window.matchMedia('(prefers-color-scheme: dark)');
  scheme.addEventListener?.('change', () => { colours = paint(); });

  /* ---- the camera, and dragging it ---- */

  let turn = -0.72, tilt = 0.40, spin = true;
  let holding = null;

  const at = (event) => ({ x: event.clientX, y: event.clientY });
  stage.addEventListener('pointerdown', (event) => {
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
  const letGo = (event) => {
    if (holding && stage.hasPointerCapture?.(holding.id)) stage.releasePointerCapture(holding.id);
    holding = null;
  };
  stage.addEventListener('pointerup', letGo);
  stage.addEventListener('pointercancel', letGo);

  /* ---- the overlay ---- */

  const line = (x1, y1, x2, y2, cls) => {
    const el = document.createElementNS(NS, 'line');
    el.setAttribute('x1', x1); el.setAttribute('y1', y1);
    el.setAttribute('x2', x2); el.setAttribute('y2', y2);
    el.setAttribute('class', cls);
    return el;
  };

  // The drawing goes in its own group. The first version cleared the whole
  // <svg> every frame — including the <style> block inside it — so from the
  // second frame onwards the dimension lines had no stroke and the figures fell
  // back to plain black with no halo. The lines were there the whole time,
  // drawn in nothing.
  const layer = document.createElementNS(NS, 'g');
  svg.append(layer);

  function overlay(project, w, h) {
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
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
      const text = document.createElementNS(NS, 'text');
      text.setAttribute('x', mx); text.setAttribute('y', my);
      text.setAttribute('class', 'fig');
      text.textContent = dim.text;
      layer.append(text);
    }
  }

  /* ---- the loop ---- */

  let raf = 0;
  function frame() {
    const rect = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width)), h = Math.max(1, Math.round(rect.height));
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
    gl.uniform3fv(uTint, colours.blue);
    gl.uniform3fv(uGround, colours.ground);
    gl.drawArrays(gl.TRIANGLES, 0, data.length / 4);

    const project = (p) => {
      const x = mvp[0] * p[0] + mvp[4] * p[1] + mvp[8] * p[2] + mvp[12];
      const y = mvp[1] * p[0] + mvp[5] * p[1] + mvp[9] * p[2] + mvp[13];
      const cw = mvp[3] * p[0] + mvp[7] * p[1] + mvp[11] * p[2] + mvp[15];
      if (cw <= 0.01) return null;
      return { x: (x / cw * 0.5 + 0.5) * w, y: (1 - (y / cw * 0.5 + 0.5)) * h };
    };
    overlay(project, w, h);

    raf = requestAnimationFrame(frame);
  }

  // Only while it is on screen. A canvas animating behind three screens of
  // scrolled page is a phone getting warm for nothing.
  const watcher = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting && !raf) raf = requestAnimationFrame(frame);
      else if (!entry.isIntersecting && raf) { cancelAnimationFrame(raf); raf = 0; }
    }
  }, { threshold: 0.01 });
  watcher.observe(stage);

  stage.dataset.webgl = 'yes';
  return true;
}

/* ---------------------------------------------------------------- on load */

const stage = document.querySelector('[data-room3d]');
if (stage && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  try { room3d(stage); } catch { stage.dataset.webgl = 'no'; }
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
