// ---------------------------------------------------------------------------
// A tiny low-poly modelling kit. Shapes are written in a lot's own frame, like
// models.js: x runs along the road, y across it (+y faces the road), h is up.
// Every face is a flat-colored polygon; faces land in one of two buckets:
// "body" for walls and roofs, "glow" for windows and lamps, which light up at
// night. build() merges each bucket into one BufferGeometry.
// ---------------------------------------------------------------------------
import * as THREE from "../../../vendor/three.module.min.js";

const colorCache = new Map();
export function rgb(hex) {
  let c = colorCache.get(hex);
  if (!c) {
    c = new THREE.Color(hex);
    colorCache.set(hex, c);
  }
  return c;
}

export function shade(hex, f) {
  const c = rgb(hex);
  return new THREE.Color(Math.min(1, c.r * f), Math.min(1, c.g * f), Math.min(1, c.b * f));
}

export const ring = (x, y, rx, ry = rx, n = 12, rot = 0) => {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    pts.push([x + Math.cos(a) * rx, y + Math.sin(a) * ry]);
  }
  return pts;
};

export const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

export class Kit {
  constructor() {
    this.pos = { body: [], glow: [] };
    this.col = { body: [], glow: [] };
  }

  // One convex polygon of [x, y, h] points. `inside` is a point the face
  // should face away from; the winding is fixed to suit it.
  face(pts, color, inside, bucket = "body") {
    const P = pts.map(([x, y, h]) => [x, h, y]);
    const c = typeof color === "string" ? rgb(color) : color;
    const [ax, ay, az] = P[0], [bx, by, bz] = P[1], [cx, cy, cz] = P[2];
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    let mx = 0, my = 0, mz = 0;
    for (const p of P) [mx, my, mz] = [mx + p[0] / P.length, my + p[1] / P.length, mz + p[2] / P.length];
    const [ix, iy, iz] = [inside[0], inside[2], inside[1]];
    if (nx * (mx - ix) + ny * (my - iy) + nz * (mz - iz) < 0) P.reverse();
    const pos = this.pos[bucket], col = this.col[bucket];
    for (let i = 1; i < P.length - 1; i++) {
      for (const p of [P[0], P[i], P[i + 1]]) {
        pos.push(p[0], p[1], p[2]);
        col.push(c.r, c.g, c.b);
      }
    }
  }

  // A straight-sided solid between two rings with the same count: a prism
  // when they match, a tapered tower when they don't.
  solid(lo, hi, h0, h1, wall, top = wall, { windows = null, bottom = false } = {}) {
    const n = lo.length;
    const cx = lo.reduce((s, p) => s + p[0], 0) / n, cy = lo.reduce((s, p) => s + p[1], 0) / n;
    const inside = [cx, cy, (h0 + h1) / 2];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.face([[...lo[i], h0], [...lo[j], h0], [...hi[j], h1], [...hi[i], h1]], wall, inside);
      for (const w of [].concat(windows || [])) {
        if (w.only === "front" && !this.#facesFront(lo[i], lo[j], cx, cy)) continue;
        this.#windows(lo[i], lo[j], h0, h1, [cx, cy], w);
      }
    }
    if (top) this.face(hi.map((p) => [...p, h1]), top, [cx, cy, h1 - 1]);
    if (bottom) this.face(lo.map((p) => [...p, h0]), wall, [cx, cy, h0 + 1]);
  }

  #facesFront(a, b, cx, cy) {
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const len = Math.hypot(mx - cx, my - cy) || 1;
    return (my - cy) / len > 0.7;
  }

  // A grid of windows (or doors) on one wall, set just off its surface.
  #windows([ax, ay], [bx, by], h0, h1, [cx, cy], { rows = 2, color = "#dbeafe", spacing = 22, width = 0.5, height = 0.45, bottom = 0.3, glow = true }) {
    const len = Math.hypot(bx - ax, by - ay);
    const cols = Math.max(1, Math.floor(len / spacing));
    const rowH = (h1 - h0) / rows;
    // push the panes out of the wall a little
    let ox = by - ay, oy = ax - bx;
    const ol = Math.hypot(ox, oy) || 1;
    [ox, oy] = [(ox / ol) * 0.7, (oy / ol) * 0.7];
    if (ox * ((ax + bx) / 2 - cx) + oy * ((ay + by) / 2 - cy) < 0) [ox, oy] = [-ox, -oy];
    const inside = [cx, cy, (h0 + h1) / 2];
    for (let r = 0; r < rows; r++) {
      const hb = h0 + rowH * (r + bottom), ht = hb + rowH * height;
      for (let k = 0; k < cols; k++) {
        const s0 = (k + 0.5 - width / 2) / cols, s1 = (k + 0.5 + width / 2) / cols;
        const x0 = ax + (bx - ax) * s0 + ox, y0 = ay + (by - ay) * s0 + oy;
        const x1 = ax + (bx - ax) * s1 + ox, y1 = ay + (by - ay) * s1 + oy;
        this.face([[x0, y0, hb], [x1, y1, hb], [x1, y1, ht], [x0, y0, ht]], color, inside, glow ? "glow" : "body");
      }
    }
  }

  box(x0, y0, x1, y1, h0, h1, wall, top = wall, opts) {
    const r = rect(x0, y0, x1, y1);
    this.solid(r, r, h0, h1, wall, top, opts);
  }

  cyl(x, y, r, h0, h1, wall, top = wall, { n = 10, ...opts } = {}) {
    const g = ring(x, y, r, r, n);
    this.solid(g, g, h0, h1, wall, top, opts);
  }

  frustum(x, y, r0, r1, h0, h1, wall, top = wall, { n = 10, ...opts } = {}) {
    this.solid(ring(x, y, r0, r0, n), ring(x, y, r1, r1, n), h0, h1, wall, top, opts);
  }

  // Pointed roof over a ring; `colors` alternate around it (stripes).
  cone(x, y, r, h0, h1, colors, { n = 10, rot = 0, base = null } = {}) {
    const g = base || ring(x, y, r, r, n, rot);
    colors = [].concat(colors);
    const inside = [x, y, h0];
    g.forEach((p, i) => {
      const q = g[(i + 1) % g.length];
      this.face([[...p, h0], [...q, h0], [x, y, h1]], colors[i % colors.length], inside);
    });
  }

  pyramid(x0, y0, x1, y1, h0, h1, color) {
    this.cone((x0 + x1) / 2, (y0 + y1) / 2, 0, h0, h1, color, { base: rect(x0, y0, x1, y1) });
  }

  // Pitched roof whose ridge runs along y; the gable ends face ±y.
  gable(x0, y0, x1, y1, h0, h1, roof, end) {
    const xm = (x0 + x1) / 2, inside = [xm, (y0 + y1) / 2, h0];
    this.face([[x0, y0, h0], [x0, y1, h0], [xm, y1, h1], [xm, y0, h1]], roof, inside);
    this.face([[x1, y0, h0], [x1, y1, h0], [xm, y1, h1], [xm, y0, h1]], roof, inside);
    this.face([[x0, y0, h0], [x1, y0, h0], [xm, y0, h1]], end, inside);
    this.face([[x0, y1, h0], [x1, y1, h0], [xm, y1, h1]], end, inside);
  }

  // A pitched roof with its ridge along x instead (gable ends face ±x).
  gableX(x0, y0, x1, y1, h0, h1, roof, end) {
    const ym = (y0 + y1) / 2, inside = [(x0 + x1) / 2, ym, h0];
    this.face([[x0, y0, h0], [x1, y0, h0], [x1, ym, h1], [x0, ym, h1]], roof, inside);
    this.face([[x0, y1, h0], [x1, y1, h0], [x1, ym, h1], [x0, ym, h1]], roof, inside);
    this.face([[x0, y0, h0], [x0, y1, h0], [x0, ym, h1]], end, inside);
    this.face([[x1, y0, h0], [x1, y1, h0], [x1, ym, h1]], end, inside);
  }

  // A half-sphere roof made of stacked rings.
  dome(x, y, r, h0, color, { n = 12, steps = 3 } = {}) {
    for (let k = 0; k < steps; k++) {
      const a0 = (k / steps) * (Math.PI / 2), a1 = ((k + 1) / steps) * (Math.PI / 2);
      this.frustum(x, y, r * Math.cos(a0), Math.max(0.01, r * Math.cos(a1)), h0 + r * Math.sin(a0), h0 + r * Math.sin(a1), color, null, { n });
    }
  }

  // A chunky faceted blob (bushes, tree crowns, smoke).
  blob(x, y, h, r, color, { squash = 1, seed = 0 } = {}) {
    const geo = new THREE.IcosahedronGeometry(r, 0);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i += 3) {
      const tri = [0, 1, 2].map((k) => [x + p.getX(i + k) * (1 + ((seed + i) % 5) * 0.03), y + p.getZ(i + k), h + p.getY(i + k) * squash]);
      this.face(tri, color, [x, y, h]);
    }
    geo.dispose();
  }

  // A thin beam between two points (poles, masts, rails).
  line(x0, y0, h0, x1, y1, h1, color, width = 2) {
    const w = width / 2;
    if (Math.abs(x0 - x1) < 1e-6 && Math.abs(y0 - y1) < 1e-6) {
      this.box(x0 - w, y0 - w, x0 + w, y0 + w, Math.min(h0, h1), Math.max(h0, h1), color);
      return;
    }
    // horizontal-ish: a flat-topped bar along the segment
    let nx = y1 - y0, ny = x0 - x1;
    const nl = Math.hypot(nx, ny) || 1;
    [nx, ny] = [(nx / nl) * w, (ny / nl) * w];
    const a = [[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]];
    const inside = [(x0 + x1) / 2, (y0 + y1) / 2, (h0 + h1) / 2];
    const hs = [h0, h1, h1, h0];
    this.face(a.map((p, i) => [...p, hs[i] + w]), color, inside);
    this.face(a.map((p, i) => [...p, hs[i] - w]), color, inside);
    this.face([[...a[0], h0 - w], [...a[1], h1 - w], [...a[1], h1 + w], [...a[0], h0 + w]], color, inside);
    this.face([[...a[3], h0 - w], [...a[2], h1 - w], [...a[2], h1 + w], [...a[3], h0 + w]], color, inside);
  }

  // A flat shape lying at height h.
  flat(pts, h, color, bucket = "body") {
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    this.face(pts.map((p) => [...p, h]), color, [cx, cy, h - 1], bucket);
  }

  // A rectangle on the front wall (+y) at y: a door or shop window.
  panel(x0, x1, y, h0, h1, color, bucket = "body") {
    this.face([[x0, y + 0.8, h0], [x1, y + 0.8, h0], [x1, y + 0.8, h1], [x0, y + 0.8, h1]], color, [(x0 + x1) / 2, y - 5, (h0 + h1) / 2], bucket);
  }

  // A striped awning sloping out from a front wall at y.
  awning(x0, x1, y, h, depth, colors) {
    const n = Math.max(2, Math.round((x1 - x0) / 9));
    for (let k = 0; k < n; k++) {
      const a = x0 + ((x1 - x0) * k) / n, b = x0 + ((x1 - x0) * (k + 1)) / n;
      this.face([[a, y, h], [b, y, h], [b, y + depth, h - 9], [a, y + depth, h - 9]], colors[k % colors.length], [(a + b) / 2, y, h - 30]);
    }
  }

  bush(x, y, r, h = r) {
    this.blob(x, y, h * 0.6, r, "#3f7f3a", { squash: 0.8 });
    this.blob(x - r * 0.25, y - r * 0.2, h, r * 0.65, "#56a04b", { squash: 0.8 });
  }

  // A low-poly tree: trunk plus a cone (pine) or a blob crown.
  tree(x, y, size, kind = "round", color = "#4f9a3e") {
    this.cyl(x, y, size * 0.07, 0, size * 0.45, "#7a5232", null, { n: 5 });
    if (kind === "pine") {
      this.cone(x, y, size * 0.36, size * 0.3, size * 1.1, color, { n: 6 });
    } else {
      this.blob(x, y, size * 0.7, size * 0.36, color);
    }
  }

  flag(x, y, h, color) {
    this.line(x, y, 0, x, y, h, "#d1d5db", 2);
    this.face([[x, y, h], [x + 22, y + 2, h - 6], [x, y, h - 13]], color, [x + 5, y - 5, h - 6]);
  }

  // Merges a bucket into an indexed-free BufferGeometry with flat normals.
  geometry(bucket = "body") {
    const pos = this.pos[bucket];
    if (!pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col[bucket], 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  build() {
    return { body: this.geometry("body"), glow: this.geometry("glow") };
  }
}
