// ---------------------------------------------------------------------------
// Hand-built fake-3D models for special buildings and factories, some of them
// animated (fountain jets, a turning Ferris wheel, factory smoke…).
//
// A model is drawn in its lot's own frame: x runs along the road, y across it
// with +y facing the road, both in world units from the lot center. Heights go
// through getFake3dPoint like every other building in town. Shapes are queued
// and drawn far to near; a piece stacked higher counts as a little nearer, so
// it lands on top of whatever it sits on.
// ---------------------------------------------------------------------------
"use strict";

const LIGHT_DIR = normalize(new Point(-0.55, -0.85));
const OUTLINE = "rgba(0,0,0,0.18)";

const shadeCache = new Map();
function shadeColor(hex, f) {
  f = Math.round(f * 20) / 20;
  const key = hex + f;
  let out = shadeCache.get(key);
  if (!out) {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
    out = "rgb(" + ch(n >> 16) + "," + ch((n >> 8) & 255) + "," + ch(n & 255) + ")";
    shadeCache.set(key, out);
  }
  return out;
}

function ringPoints(x, y, rx, ry = rx, n = 14, rot = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    pts.push([x + Math.cos(a) * rx, y + Math.sin(a) * ry]);
  }
  return pts;
}

function rectPoints(x0, y0, x1, y1) {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

class LotModel {
  constructor(lot, road, type, level = lot.level) {
    this.type = type; // a key of LOT_MODELS
    this.level = level;
    this.id = lot.id;
    this.base = lot.poly;
    const p = lot.poly.points;
    this.c = lot.center;
    this.hw = distance(p[0], p[3]) / 2;
    this.hd = distance(p[0], p[1]) / 2;
    this.s = Math.min(this.hw, this.hd);
    this.u = normalize(subtract(p[3], p[0]));
    let v = normalize(subtract(p[1], p[0]));
    if (road && road.distanceToPoint(add(this.c, scale(v, this.hd))) > road.distanceToPoint(add(this.c, scale(v, -this.hd)))) {
      v = scale(v, -1);
    }
    this.v = v;
    const b = lot.poly.bounds;
    this.bounds = { minX: b.minX - 400, minY: b.minY - 400, maxX: b.maxX + 400, maxY: b.maxY + 400 };
  }

  get spec() {
    return LOT_MODELS[this.type];
  }

  drawGround(ctx, viewPoint, now = 0) {
    if (!this.spec.ground) return;
    this.ctx = ctx;
    this.vp = viewPoint;
    this.spec.ground(this, now / 1000);
  }

  draw(ctx, viewPoint, now = 0) {
    this.ctx = ctx;
    this.vp = viewPoint;
    this.queue = [];
    this.spec.build(this, now / 1000);
    this.queue.sort((a, b) => b.d - b.h * 0.5 - (a.d - a.h * 0.5));
    for (const q of this.queue) q.fn();
    this.queue = null;
  }

  // ---- geometry ----------------------------------------------------------
  at(x, y) {
    return new Point(this.c.x + this.u.x * x + this.v.x * y, this.c.y + this.u.y * x + this.v.y * y);
  }

  p3(x, y, h) {
    const g = this.at(x, y);
    return h ? getFake3dPoint(g, this.vp, h) : g;
  }

  #queue(x, y, h, fn) {
    this.queue.push({ h, d: distance(this.at(x, y), this.vp), fn });
  }

  #fill(pts, color, stroke = null, lineWidth = 1.5) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.lineJoin = "round";
      ctx.stroke();
    }
  }

  #outward(a, b, center) {
    const n = normalize(perpendicular(subtract(b, a)));
    return dot(n, subtract(average(a, b), center)) < 0 ? scale(n, -1) : n;
  }

  #shade(hex, out) {
    return hex[0] === "#" ? shadeColor(hex, 0.82 + 0.18 * dot(out, LIGHT_DIR)) : hex;
  }

  // ---- shapes (queued) ---------------------------------------------------
  // A straight-sided solid between two rings of local [x, y] points with the
  // same count: a prism when they match, a tapered tower when they don't.
  solid(lo, hi, h0, h1, wall, top, { stroke = OUTLINE, windows = null } = {}) {
    const cx = lo.reduce((s, p) => s + p[0], 0) / lo.length;
    const cy = lo.reduce((s, p) => s + p[1], 0) / lo.length;
    this.#queue(cx, cy, h0, () => this.#solid(lo, hi, h0, h1, wall, top, stroke, windows));
  }

  #solid(lo, hi, h0, h1, wall, top, stroke, windows) {
    const n = lo.length;
    const ground = lo.map(([x, y]) => this.at(x, y));
    const bottom = h0 ? lo.map(([x, y]) => this.p3(x, y, h0)) : ground;
    const roof = hi.map(([x, y]) => this.p3(x, y, h1));
    const center = new Point(ground.reduce((s, p) => s + p.x, 0) / n, ground.reduce((s, p) => s + p.y, 0) / n);
    const faces = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const mid = average(ground[i], ground[j]);
      const out = this.#outward(ground[i], ground[j], center);
      if (dot(out, subtract(this.vp, mid)) <= 0) continue; // faces away from the camera
      faces.push({ i, j, out, d: distance(mid, this.vp), pts: [bottom[i], bottom[j], roof[j], roof[i]] });
    }
    faces.sort((a, b) => b.d - a.d);
    for (const f of faces) {
      this.#fill(f.pts, this.#shade(wall, f.out), stroke);
      for (const w of [].concat(windows || [])) {
        if (w.only === "front" && dot(f.out, this.v) < 0.7) continue;
        this.#windows(lo[f.i], lo[f.j], h0, h1, w);
      }
    }
    if (top) this.#fill(roof, top, stroke);
  }

  // A grid of windows (or doors) on one wall, from local point a to b.
  #windows([ax, ay], [bx, by], h0, h1, { rows = 2, color = "#dbeafe", spacing = 22, width = 0.5, height = 0.45, bottom = 0.3 }) {
    const len = Math.hypot(bx - ax, by - ay);
    const cols = Math.max(1, Math.floor(len / spacing));
    const rowH = (h1 - h0) / rows;
    for (let r = 0; r < rows; r++) {
      const hb = h0 + rowH * (r + bottom), ht = hb + rowH * height;
      for (let k = 0; k < cols; k++) {
        const s0 = (k + 0.5 - width / 2) / cols, s1 = (k + 0.5 + width / 2) / cols;
        const x0 = lerp(ax, bx, s0), y0 = lerp(ay, by, s0), x1 = lerp(ax, bx, s1), y1 = lerp(ay, by, s1);
        this.#fill([this.p3(x0, y0, hb), this.p3(x1, y1, hb), this.p3(x1, y1, ht), this.p3(x0, y0, ht)], color);
      }
    }
  }

  box(x0, y0, x1, y1, h0, h1, wall, top, opts) {
    const r = rectPoints(x0, y0, x1, y1);
    this.solid(r, r, h0, h1, wall, top, opts);
  }

  cyl(x, y, r, h0, h1, wall, top, { n = 14, ...opts } = {}) {
    const ring = ringPoints(x, y, r, r, n);
    this.solid(ring, ring, h0, h1, wall, top, opts);
  }

  frustum(x, y, r0, r1, h0, h1, wall, top, { n = 14, ...opts } = {}) {
    this.solid(ringPoints(x, y, r0, r0, n), ringPoints(x, y, r1, r1, n), h0, h1, wall, top, opts);
  }

  // A half-sphere roof made of stacked rings.
  dome(x, y, r, h0, color, { n = 16, steps = 4 } = {}) {
    for (let k = 0; k < steps; k++) {
      const a0 = (k / steps) * (Math.PI / 2), a1 = ((k + 1) / steps) * (Math.PI / 2);
      this.frustum(x, y, r * Math.cos(a0), r * Math.cos(a1), h0 + r * Math.sin(a0), h0 + r * Math.sin(a1), color, color, { n });
    }
  }

  // Pointed roof over a ring; `colors` alternate around it (stripes).
  cone(x, y, r, h0, h1, colors, { n = 12, rot = 0, ring = null } = {}) {
    ring = ring || ringPoints(x, y, r, r, n, rot);
    this.#queue(x, y, h0, () => {
      const ground = ring.map(([px, py]) => this.at(px, py));
      const base = ring.map(([px, py]) => this.p3(px, py, h0));
      const apex = this.p3(x, y, h1);
      const center = this.at(x, y);
      const faces = ring.map((_, i) => {
        const j = (i + 1) % ring.length;
        const mid = average(ground[i], ground[j]);
        const color = colors[i % colors.length];
        return { d: distance(mid, this.vp), pts: [base[i], base[j], apex], color: this.#shade(color, this.#outward(ground[i], ground[j], center)) };
      });
      faces.sort((a, b) => b.d - a.d);
      for (const f of faces) this.#fill(f.pts, f.color, OUTLINE);
    });
  }

  pyramid(x0, y0, x1, y1, h0, h1, color) {
    this.cone((x0 + x1) / 2, (y0 + y1) / 2, 0, h0, h1, [color], { ring: rectPoints(x0, y0, x1, y1) });
  }

  // Pitched roof whose ridge runs along y; the gable ends face ±y.
  gable(x0, y0, x1, y1, h0, h1, roof, end) {
    const xm = (x0 + x1) / 2;
    this.#queue(xm, (y0 + y1) / 2, h0, () => {
      const faces = [
        { g: [x0, (y0 + y1) / 2], c: roof, out: scale(this.u, -1), pts: [[x0, y0, h0], [x0, y1, h0], [xm, y1, h1], [xm, y0, h1]] },
        { g: [x1, (y0 + y1) / 2], c: roof, out: this.u, pts: [[x1, y0, h0], [x1, y1, h0], [xm, y1, h1], [xm, y0, h1]] },
        { g: [xm, y0], c: end, out: scale(this.v, -1), pts: [[x0, y0, h0], [x1, y0, h0], [xm, y0, h1]] },
        { g: [xm, y1], c: end, out: this.v, pts: [[x0, y1, h0], [x1, y1, h0], [xm, y1, h1]] },
      ];
      for (const f of faces) f.d = distance(this.at(...f.g), this.vp);
      faces.sort((a, b) => b.d - a.d);
      for (const f of faces) this.#fill(f.pts.map(([px, py, h]) => this.p3(px, py, h)), this.#shade(f.c, f.out), OUTLINE);
    });
  }

  line(x0, y0, h0, x1, y1, h1, color, width = 2) {
    this.#queue((x0 + x1) / 2, (y0 + y1) / 2, Math.min(h0, h1), () => this.strokeLine(this.p3(x0, y0, h0), this.p3(x1, y1, h1), color, width));
  }

  dot(x, y, h, r, color) {
    this.#queue(x, y, h, () => this.fillDot(this.p3(x, y, h), r, color));
  }

  custom(x, y, h, fn) {
    this.#queue(x, y, h, fn);
  }

  // ---- immediate drawing (for ground details and custom pieces) -----------
  strokeLine(a, b, color, width = 2) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  fillDot(p, r, color) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  // A flat shape at height h (h = 0: on the ground).
  flat(pts, h, color, stroke = null, lineWidth = 2) {
    this.#fill(pts.map(([x, y]) => this.p3(x, y, h)), color, stroke, lineWidth);
  }

  // A face through local [x, y, h] points.
  face(pts, color, stroke = null, lineWidth = 2) {
    this.#fill(pts.map(([x, y, h]) => this.p3(x, y, h)), color, stroke, lineWidth);
  }

  // A small flag on a pole top at (x, y, h), waving along +x.
  flag(x, y, h, t, color) {
    const top = [], bottom = [];
    for (let k = 0; k <= 5; k++) {
      const wave = Math.sin(t * 5 + k * 0.9) * 2.5 * (k / 5);
      top.push(this.p3(x + k * 5, y + wave, h));
      bottom.push(this.p3(x + k * 5, y + wave, h - 13));
    }
    this.#fill([...top, ...bottom.reverse()], color, "rgba(0,0,0,0.25)", 1);
  }
}

// Ground colors under each special's model (drawn before roads and buildings).
const PLAZA = "#e3dccb";
const blink = (t, rate = 1, phase = 0) => Math.sin((t + phase) * Math.PI * 2 * rate) > 0;

const LOT_MODELS = {
  // ---- uncommon ----------------------------------------------------------
  park: {
    floor: "#5fae4f",
    ground(m) {
      const ctx = m.ctx;
      const a = m.at(-m.hw * 0.95, m.hd * 0.9), c = m.at(0, -m.hd * 0.4), b = m.at(m.hw * 0.95, m.hd * 0.5);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(c.x, c.y, b.x, b.y);
      ctx.strokeStyle = "#e6d3a3";
      ctx.lineWidth = 14;
      ctx.lineCap = "round";
      ctx.stroke();
      m.flat(ringPoints(m.hw * 0.4, -m.hd * 0.45, m.hw * 0.32, m.hd * 0.26, 18), 0, "#4aa3df", "#3b82c4", 3);
    },
    build(m, t) {
      // The trees come from the renderer; this adds a bench and two lamps.
      m.box(-m.hw * 0.35 - 10, m.hd * 0.05, -m.hw * 0.35 + 10, m.hd * 0.05 + 6, 0, 6, "#8b5e3c", "#a47148");
      for (const [x, y] of [[-m.hw * 0.7, m.hd * 0.55], [m.hw * 0.55, m.hd * 0.2]]) {
        m.line(x, y, 0, x, y, 30, "#334155", 2);
        m.dot(x, y, 31, 4 + Math.sin(t * 2 + x) * 0.6, "#fde68a");
      }
      m.custom(m.hw * 0.4, -m.hd * 0.45, 0, () => {
        // ripples on the pond
        const r = (t * 0.5) % 1;
        m.flat(ringPoints(m.hw * 0.4, -m.hd * 0.45, m.hw * 0.3 * r, m.hd * 0.24 * r, 16), 0.5, "rgba(0,0,0,0)", "rgba(255,255,255," + (0.5 * (1 - r)).toFixed(2) + ")", 2);
      });
    },
  },

  fountain: {
    floor: PLAZA,
    ground(m) {
      m.flat(ringPoints(0, 0, m.s * 0.95, m.s * 0.95, 24), 0, "#d6cfbf", "#c8bfa8", 3);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        m.strokeLine(m.at(Math.cos(a) * m.s * 0.75, Math.sin(a) * m.s * 0.75), m.at(Math.cos(a) * m.s * 0.95, Math.sin(a) * m.s * 0.95), "#c8bfa8", 2);
      }
    },
    build(m, t) {
      const s = m.s;
      m.cyl(0, 0, s * 0.72, 0, 10, "#bfb6a3", "#4fa3e0", { n: 20 });
      m.cyl(0, 0, s * 0.12, 10, 34, "#cfc6b4", "#cfc6b4", { n: 10 });
      m.cyl(0, 0, s * 0.32, 34, 38, "#cfc6b4", "#6bb8ea", { n: 16 });
      m.custom(0, 0, 38, () => {
        for (let i = 0; i < 20; i++) {
          const ph = (t * 0.7 + i / 20) % 1, a = i * 2.39996;
          const r = s * 0.62 * ph, h = lerp(40, 10, ph) + 90 * ph * (1 - ph);
          m.fillDot(m.p3(Math.cos(a) * r, Math.sin(a) * r, h), 3, "rgba(225,242,255,0.9)");
        }
        for (let k = 0; k < 6; k++) {
          const ph = (t * 1.2 + k / 6) % 1;
          m.fillDot(m.p3(0, 0, 38 + 42 * ph), 4.5 * (1 - ph * 0.5), "rgba(235,248,255,0.85)");
        }
      });
    },
  },

  carousel: {
    floor: PLAZA,
    build(m, t) {
      const s = m.s, rot = t * 0.6;
      m.cyl(0, 0, s * 0.8, 0, 7, "#b5838d", "#f5e6c8", { n: 18 });
      m.cyl(0, 0, s * 0.1, 7, 50, "#d4af37", "#d4af37", { n: 8 });
      m.custom(0, 0, 7, () => {
        const horses = [];
        for (let k = 0; k < 8; k++) {
          const a = rot + (k / 8) * Math.PI * 2;
          const x = Math.cos(a) * s * 0.58, y = Math.sin(a) * s * 0.58;
          horses.push({ k, a, x, y, d: distance(m.at(x, y), m.vp) });
        }
        horses.sort((p, q) => q.d - p.d);
        const colors = ["#f8fafc", "#fca5a5", "#93c5fd", "#fde68a"];
        for (const { k, a, x, y } of horses) {
          const h = 16 + Math.sin(t * 3 + k * 1.3) * 5;
          m.strokeLine(m.p3(x, y, 7), m.p3(x, y, 50), "#d4af37", 2);
          const dx = -Math.sin(a) * 5, dy = Math.cos(a) * 5;
          m.strokeLine(m.p3(x - dx, y - dy, h), m.p3(x + dx, y + dy, h), colors[k % 4], 7);
          m.fillDot(m.p3(x + dx * 1.5, y + dy * 1.5, h + 4), 3, colors[k % 4]);
        }
      });
      m.cone(0, 0, s * 0.9, 50, 80, ["#e63946", "#f1faee"], { n: 16, rot });
      m.dot(0, 0, 82, 4, "#d4af37");
    },
  },

  // ---- rare --------------------------------------------------------------
  school: {
    floor: "#cdbf9c",
    ground(m) {
      const { hw, hd } = m;
      m.flat(rectPoints(-hw * 0.95, hd * 0.3, hw * 0.95, hd * 0.95), 0, "#c9a66b");
      m.flat(ringPoints(hw * 0.35, hd * 0.62, 12, 12, 14), 0, "rgba(0,0,0,0)", "#f8fafc", 2);
    },
    build(m, t) {
      const { hw, hd } = m;
      m.box(-hw * 0.9, -hd * 0.9, hw * 0.45, hd * 0.2, 0, 52, "#c8693c", null, { windows: [{ rows: 2, color: "#dbeafe" }] });
      m.gable(-hw * 0.94, -hd * 0.94, hw * 0.49, hd * 0.24, 52, 76, "#7c2d12", "#efe6d2");
      m.box(hw * 0.5, -hd * 0.6, hw * 0.88, -hd * 0.1, 0, 92, "#b85c32", "#efe6d2", { windows: [{ rows: 3, color: "#dbeafe", spacing: 14 }] });
      m.box(hw * 0.52, -hd * 0.58, hw * 0.86, -hd * 0.12, 92, 104, "#efe6d2", "#efe6d2", { windows: [{ rows: 1, color: "#3f2a1d", width: 0.6, height: 0.7, bottom: 0.15, spacing: 12 }] });
      m.pyramid(hw * 0.48, -hd * 0.62, hw * 0.9, -hd * 0.08, 104, 136, "#3f7f6e");
      m.dot(hw * 0.69 + Math.sin(t * 2.5) * 2, -hd * 0.35, 98, 4, "#d4af37");
      const fx = -hw * 0.8, fy = hd * 0.8;
      m.line(fx, fy, 0, fx, fy, 112, "#d1d5db", 2);
      m.custom(fx, fy, 100, () => m.flag(fx, fy, 112, t, "#ef4444"));
    },
  },

  clinic: {
    floor: "#cbd5e1",
    ground(m) {
      const { hw, hd } = m;
      m.flat(rectPoints(-hw * 0.95, hd * 0.38, hw * 0.95, hd * 0.95), 0, "#9ca3af");
      for (let k = -2; k <= 2; k++) m.strokeLine(m.at(k * 22 - 8, hd * 0.45), m.at(k * 22 - 8, hd * 0.9), "#f8fafc", 2);
    },
    build(m, t) {
      const { hw, hd } = m;
      m.box(-hw * 0.88, -hd * 0.9, hw * 0.88, hd * 0.32, 0, 62, "#eef2f6", "#d7dee6", { windows: [{ rows: 3, color: "#7dd3fc" }] });
      m.box(-hw * 0.5, -hd * 0.72, hw * 0.15, hd * 0.05, 62, 94, "#e2e8f0", "#cbd5e1", { windows: [{ rows: 2, color: "#7dd3fc" }] });
      const cx = -hw * 0.17, cy = -hd * 0.33;
      m.custom(cx, cy, 94, () => {
        m.flat(rectPoints(cx - 11, cy - 3.5, cx + 11, cy + 3.5), 94.5, "#dc2626");
        m.flat(rectPoints(cx - 3.5, cy - 11, cx + 3.5, cy + 11), 94.5, "#dc2626");
      });
      const hx = hw * 0.55, hy = -hd * 0.35;
      m.custom(hx, hy, 62, () => {
        m.flat(ringPoints(hx, hy, 15, 15, 18), 62.5, "#334155", "#f8fafc", 2);
        m.strokeLine(m.p3(hx - 5, hy - 6, 63), m.p3(hx - 5, hy + 6, 63), "#f8fafc", 2.5);
        m.strokeLine(m.p3(hx + 5, hy - 6, 63), m.p3(hx + 5, hy + 6, 63), "#f8fafc", 2.5);
        m.strokeLine(m.p3(hx - 5, hy, 63), m.p3(hx + 5, hy, 63), "#f8fafc", 2.5);
      });
      m.dot(-hw * 0.5, -hd * 0.72, 97, 3.5, blink(t, 0.8) ? "#ef4444" : "#7f1d1d");
      // ambulance
      const ax = hw * 0.4;
      m.box(ax, hd * 0.45, ax + 16, hd * 0.9, 0, 15, "#f8fafc", "#ffffff", { windows: [{ rows: 1, color: "#ef4444", spacing: 40, width: 0.9, height: 0.25, bottom: 0.4 }] });
      m.dot(ax + 4, hd * 0.86, 16, 2.5, blink(t, 2) ? "#ef4444" : "#3b82f6");
      m.dot(ax + 12, hd * 0.86, 16, 2.5, blink(t, 2) ? "#3b82f6" : "#ef4444");
    },
  },

  fire: {
    floor: "#a8a29e",
    build(m, t) {
      const { hw, hd } = m;
      m.box(-hw * 0.9, -hd * 0.9, hw * 0.38, hd * 0.22, 0, 48, "#b91c1c", "#7f1d1d", {
        windows: [
          { rows: 1, color: "#e5e7eb", spacing: 34, width: 0.75, height: 0.72, bottom: 0, only: "front" },
          { rows: 1, color: "#fde68a", spacing: 18, width: 0.5, height: 0.35, bottom: 0.5 },
        ],
      });
      m.box(-hw * 0.92, -hd * 0.92, hw * 0.4, hd * 0.24, 48, 52, "#f3f4f6", "#991b1b");
      m.box(hw * 0.46, -hd * 0.85, hw * 0.86, -hd * 0.3, 0, 108, "#991b1b", "#450a0a", { windows: [{ rows: 4, color: "#fde68a", spacing: 14 }] });
      m.pyramid(hw * 0.44, -hd * 0.87, hw * 0.88, -hd * 0.28, 108, 124, "#1f2937");
      m.dot(-hw * 0.65, 0, 54, 4, blink(t, 1.5) ? "#ef4444" : "#fef2f2");
      m.dot(-hw * 0.1, 0, 54, 4, blink(t, 1.5) ? "#fef2f2" : "#ef4444");
      // fire truck on the apron
      const tx = -hw * 0.55;
      m.box(tx, hd * 0.3, tx + 20, hd * 0.9, 0, 17, "#dc2626", "#ef4444");
      m.line(tx + 10, hd * 0.34, 18, tx + 10, hd * 0.86, 18, "#e5e7eb", 3);
      m.dot(tx + 5, hd * 0.86, 19, 2.5, blink(t, 2.2) ? "#ef4444" : "#3b82f6");
      m.dot(tx + 15, hd * 0.86, 19, 2.5, blink(t, 2.2) ? "#3b82f6" : "#ef4444");
    },
  },

  library: {
    floor: "#e7e0d0",
    build(m) {
      const { hw, hd } = m;
      m.box(-hw * 0.92, -hd * 0.92, hw * 0.92, hd * 0.5, 0, 7, "#d6cfbf", "#e7e0d0");
      m.box(-hw * 0.86, -hd * 0.86, hw * 0.86, hd * 0.1, 7, 46, "#efe6d2", "#ddd3bd", { windows: [{ rows: 1, color: "#6b4a2e", height: 0.6, bottom: 0.2, spacing: 18 }] });
      const cols = Math.max(4, Math.floor((hw * 1.6) / 16));
      for (let k = 0; k < cols; k++) {
        m.cyl(lerp(-hw * 0.8, hw * 0.8, k / (cols - 1)), hd * 0.36, 3.5, 7, 44, "#f8f5ee", "#f8f5ee", { n: 8 });
      }
      m.box(-hw * 0.84, hd * 0.31, hw * 0.84, hd * 0.41, 44, 49, "#efe6d2", "#efe6d2");
      const r = Math.min(hw, hd) * 0.42;
      m.cyl(0, -hd * 0.38, r, 46, 58, "#efe6d2", null, { n: 16, windows: [{ rows: 1, color: "#6b4a2e", spacing: 9, width: 0.5, height: 0.6, bottom: 0.2 }] });
      m.dome(0, -hd * 0.38, r, 58, "#5e9c8a");
      m.dot(0, -hd * 0.38, 58 + r + 3, 3.5, "#d4af37");
    },
  },

  // ---- legendary ---------------------------------------------------------
  tower: {
    floor: "#d1d5db",
    ground(m, t) {
      m.flat(ringPoints(0, 0, m.s * 0.95, m.s * 0.95, 24), 0, "#e5e7eb", "rgba(245,158,11," + (0.45 + 0.25 * Math.sin(t * 2)).toFixed(2) + ")", 4);
    },
    build(m, t) {
      const s = m.s;
      m.cyl(0, 0, s * 0.72, 0, 18, "#94a3b8", "#cbd5e1", { n: 16, windows: [{ rows: 1, color: "#bfdbfe", spacing: 10, width: 0.6, height: 0.6, bottom: 0.2 }] });
      m.frustum(0, 0, s * 0.3, s * 0.16, 18, 165, "#e5e7eb", "#e5e7eb", { n: 12 });
      m.frustum(0, 0, s * 0.16, s * 0.52, 165, 178, "#cbd5e1", "#cbd5e1", { n: 16 });
      m.cyl(0, 0, s * 0.52, 178, 194, "#3b82f6", "#e5e7eb", { n: 16, windows: [{ rows: 1, color: "#fef3c7", spacing: 9, width: 0.55, height: 0.6, bottom: 0.2 }] });
      m.frustum(0, 0, s * 0.52, s * 0.2, 194, 204, "#e5e7eb", "#e5e7eb", { n: 16 });
      m.cyl(0, 0, s * 0.1, 204, 240, "#e5e7eb", "#e5e7eb", { n: 8 });
      m.line(0, 0, 240, 0, 0, 300, "#9ca3af", 3);
      m.custom(0, 0, 186, () => {
        // the revolving restaurant's lights
        for (let k = 0; k < 10; k++) {
          const a = t * 0.5 + (k / 10) * Math.PI * 2;
          m.fillDot(m.p3(Math.cos(a) * s * 0.55, Math.sin(a) * s * 0.55, 186), 2.5, "#fde047");
        }
      });
      const on = blink(t, 0.7);
      if (on) m.dot(0, 0, 301, 11, "rgba(239,68,68,0.3)");
      m.dot(0, 0, 302, 5, on ? "#ef4444" : "#7f1d1d");
    },
  },

  stadium: {
    floor: "#94a3b8",
    ground(m) {
      const { hw, hd } = m;
      const field = ringPoints(0, 0, hw * 0.58, hd * 0.5, 24);
      m.flat(field, 0, "#4caf50");
      const ctx = m.ctx;
      ctx.save();
      ctx.beginPath();
      for (const [i, p] of field.map(([x, y]) => m.at(x, y)).entries()) i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      ctx.closePath();
      ctx.clip();
      for (let k = -4; k < 4; k += 2) m.flat(rectPoints(k * hw * 0.15, -hd, (k + 1) * hw * 0.15, hd), 0, "#43a047");
      ctx.restore();
      m.flat(field, 0, "rgba(0,0,0,0)", "#f8fafc", 2);
      m.strokeLine(m.at(0, -hd * 0.5), m.at(0, hd * 0.5), "#f8fafc", 2);
      m.flat(ringPoints(0, 0, 9, 9, 12), 0, "rgba(0,0,0,0)", "#f8fafc", 2);
    },
    build(m, t) {
      const { hw, hd } = m;
      const n = 22;
      const outer = ringPoints(0, 0, hw * 0.95, hd * 0.93, n);
      const inner = ringPoints(0, 0, hw * 0.6, hd * 0.53, n);
      m.solid(outer, outer, 0, 26, "#94a3b8", null);
      m.custom(0, 0, 0, () => {
        const wave = (t * 1.6) % (Math.PI * 2);
        const faces = [];
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const a = (i + 0.5) / n * Math.PI * 2;
          const diff = Math.abs(((a - wave + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          faces.push({
            d: distance(m.at((outer[i][0] + inner[j][0]) / 2, (outer[i][1] + inner[j][1]) / 2), m.vp),
            pts: [[...inner[i], 5], [...inner[j], 5], [...outer[j], 26], [...outer[i], 26]],
            color: diff < 0.45 ? "#fbbf24" : i % 2 ? "#2563eb" : "#1e40af",
          });
        }
        faces.sort((a, b) => b.d - a.d);
        for (const f of faces) m.face(f.pts, f.color, OUTLINE, 1);
      });
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const x = sx * hw * 0.88, y = sy * hd * 0.86;
        m.line(x, y, 0, x, y, 72, "#64748b", 3);
        m.dot(x, y, 74, 12, "rgba(254,249,195," + (0.25 + 0.1 * Math.sin(t * 7 + sx + sy * 2)).toFixed(2) + ")");
        m.dot(x, y, 74, 5.5, "#fef9c3");
      }
    },
  },

  wheel: {
    floor: PLAZA,
    build(m, t) {
      const R = Math.min(m.hw * 0.85, 70), hub = R + 12, rot = t * 0.25;
      // The wheel always turns to face the camera and leans back a little, so
      // it reads as a circle instead of a flat line from any angle.
      const toCam = subtract(m.at(0, 0), m.vp);
      const far = magnitude(toCam) > 1;
      const fx = far ? dot(normalize(toCam), m.u) : 0, fy = far ? dot(normalize(toCam), m.v) : 1;
      const [wx, wy] = [-fy, fx];
      const LEAN = 0.6;
      const wheelPoint = (r, a, drop = 0) => {
        const c = Math.cos(a) * r, s = Math.sin(a) * r;
        return m.p3(wx * c + fx * s * LEAN, wy * c + fy * s * LEAN, hub + s - drop);
      };
      const rim = (r, a) => wheelPoint(r, a);
      m.box(-R * 0.35, -12, R * 0.35, 12, 0, 8, "#64748b", "#94a3b8");
      for (const sy of [-1, 1]) {
        for (const sx of [-1, 1]) {
          m.line(wx * sx * R * 0.6 + fx * sy * 16, wy * sx * R * 0.6 + fy * sy * 16, 0, fx * sy * 4, fy * sy * 4, hub, "#64748b", 3);
        }
      }
      m.custom(0, 0, 0, () => {
        const ctx = m.ctx;
        [R, R * 0.88].forEach((r, i) => {
          ctx.beginPath();
          for (let k = 0; k <= 36; k++) {
            const p = rim(r, (k / 36) * Math.PI * 2);
            k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
          }
          if (i === 0) {
            ctx.fillStyle = "rgba(255,255,255,0.18)";
            ctx.fill();
          }
          ctx.strokeStyle = "#f8fafc";
          ctx.lineWidth = i === 0 ? 5 : 2.5;
          ctx.stroke();
        });
        const center = m.p3(0, 0, hub);
        for (let k = 0; k < 12; k++) m.strokeLine(center, rim(R, rot + (k / 12) * Math.PI * 2), "#e2e8f0", 2);
        for (let k = 0; k < 24; k++) {
          const hue = Math.round((k * 15 + t * 60) % 360);
          m.fillDot(rim(R, rot + (k / 24) * Math.PI * 2), 2.6, "hsl(" + hue + ",90%,65%)");
        }
        const cars = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7"];
        for (let k = 0; k < 10; k++) {
          const a = rot + (k / 10) * Math.PI * 2;
          const top = rim(R, a);
          const car = wheelPoint(R, a, 8);
          m.strokeLine(top, car, "#94a3b8", 1.5);
          m.fillDot(car, 7.5, cars[k % cars.length]);
        }
        m.fillDot(center, 5, "#475569");
      });
    },
  },

  // ---- factories (level 1–3) ---------------------------------------------
  factory: {
    floor: "#8f8a80",
    build(m, t) {
      const { hw, hd, level } = m;
      const h = 22 + level * 8;
      m.box(-hw * 0.88, -hd * 0.85, hw * 0.42, hd * 0.4, 0, h, "#b8b0a2", "#8a8478", {
        windows: [
          { rows: 1, color: "#6b7280", spacing: 30, width: 0.6, height: 0.7, bottom: 0, only: "front" },
          { rows: 1, color: "#bfdbfe", spacing: 16, width: 0.6, height: 0.3, bottom: 0.6 },
        ],
      });
      const teeth = 2 + level;
      for (let k = 0; k < teeth; k++) {
        const x0 = lerp(-hw * 0.88, hw * 0.42, k / teeth), x1 = lerp(-hw * 0.88, hw * 0.42, (k + 1) / teeth);
        m.gable(x0, -hd * 0.85, x1, hd * 0.4, h, h + 12, "#6b7280", "#93c5fd");
      }
      const stacks = level >= 3 ? [[hw * 0.66, -hd * 0.55], [hw * 0.66, -hd * 0.1]] : [[hw * 0.66, -hd * 0.4]];
      const stackH = 50 + level * 22;
      stacks.forEach(([x, y], i) => {
        m.cyl(x, y, 7, 0, stackH, "#9a3412", "#3f3f46", { n: 10, windows: [{ rows: 3, color: "#f5f5f4", spacing: 100, width: 1, height: 0.08, bottom: 0.9 }] });
        m.custom(x, y, stackH, () => {
          for (let k = 0; k < 5; k++) {
            const ph = (t * 0.3 + k / 5 + i * 0.37 + m.id * 0.13) % 1;
            m.fillDot(m.p3(x + ph * 26, y - ph * 8, stackH + 6 + ph * 55), 5 + ph * 12, "rgba(210,210,210," + (0.55 * (1 - ph)).toFixed(2) + ")");
          }
        });
      });
      if (level >= 2) m.cyl(hw * 0.64, hd * 0.55, 13, 0, 26 + level * 4, "#d1d5db", "#e5e7eb", { n: 14 });
    },
  },
};
