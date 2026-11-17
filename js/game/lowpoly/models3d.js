// ---------------------------------------------------------------------------
// Low-poly models for every building in town. Each level of a home, shop or
// factory has its own silhouette, so a level reads from far away.
//
// buildModel() returns static geometry (cached per type, level, lot size and
// color variant) plus the animated bits: spinning parts, blinking lights and
// chimneys that smoke. `top` is how tall the model is, for markers above it.
// ---------------------------------------------------------------------------
import { Kit, ring, rect, shade } from "./kit.js";

const WALLS = ["#f3e3c3", "#dbe7f0", "#f6d6d6", "#e0ecd6", "#f1e6a8", "#e4dcf2", "#f8f5ee"];
const ROOFS = ["#c0503f", "#8b5e3c", "#5b6b7a", "#d9773a", "#3f7e66", "#7056a8"];
const ACCENTS = ["#e63946", "#2a9d8f", "#f4a261", "#457b9d", "#9b5de5", "#e9a23b", "#d6336c"];
const GLASS = "#cfe8ff";
const lerp = (a, b, t) => a + (b - a) * t;

class Build {
  constructor(hw, hd, level, variant, id) {
    Object.assign(this, { hw, hd, level, variant, id, s: Math.min(hw, hd) });
    this.k = new Kit();
    this.parts = [];
    this.blinkers = [];
    this.smoke = [];
    this.top = 40;
  }

  pick(arr, salt = 0) {
    return arr[(this.variant >>> salt) % arr.length];
  }

  // A part that turns around a pivot: axis "y" (up) or "z" (across the lot).
  spin(pivot, axis, speed, draw) {
    const k = new Kit();
    draw(k);
    this.parts.push({ kit: k, pivot, axis, speed });
  }

  blink(x, y, h, colors, rate = 1, phase = 0, r = 3) {
    this.blinkers.push({ x, y, h, colors, rate, phase, r });
  }
}

// ---- homes: cottage → townhouses → apartments --------------------------------
function house(b) {
  const { k, hw, hd, level } = b;
  const glass = { rows: 1, color: GLASS, spacing: 20, width: 0.4, height: 0.4, bottom: 0.35 };
  if (level === 1) {
    const x0 = -hw * 0.42, x1 = hw * 0.32, y0 = -hd * 0.62, y1 = hd * 0.02;
    const wall = b.pick(WALLS), roof = b.pick(ROOFS, 3);
    k.flat(rect(-6, hd * 0.05, 6, hd), 0.4, "#d8c9a3");
    k.box(x0, y0, x1, y1, 0, 26, wall, null, { windows: [glass] });
    k.panel(-5, 5, y1, 0, 16, "#7a4b2a");
    k.gable(x0 - 4, y0 - 4, x1 + 4, y1 + 5, 26, 50, roof, wall);
    k.box(x1 - 14, y0 + 6, x1 - 6, y0 + 14, 30, 56, "#9a4a32", "#5b2a1d");
    for (const side of [-1, 1]) k.line(side * 9, hd * 0.86, 7, side * hw * 0.92, hd * 0.86, 7, "#f8fafc", 2.5);
    k.bush(hw * 0.65, -hd * 0.35, 13, 20);
    b.top = 56;
  } else if (level === 2) {
    const n = hw > 64 ? 3 : 2, y0 = -hd * 0.72, y1 = hd * 0.18;
    for (let i = 0; i < n; i++) {
      const x0 = lerp(-hw * 0.9, hw * 0.9, i / n), x1 = lerp(-hw * 0.9, hw * 0.9, (i + 1) / n), xm = (x0 + x1) / 2;
      const wall = WALLS[(b.variant + i * 3) % WALLS.length];
      k.box(x0, y0, x1, y1, 0, 52, wall, null, { windows: [{ ...glass, rows: 2, spacing: 16 }] });
      k.panel(xm - 5, xm + 5, y1, 0, 17, ["#7a4b2a", "#1f4e79", "#2f5d3a"][(b.variant + i) % 3]);
      k.box(xm - 8, y1, xm + 8, y1 + 6, 0, 4, "#d1d5db", "#e5e7eb");
      k.gable(x0 - 1, y0 - 3, x1 + 1, y1 + 4, 52, 74, ROOFS[(b.variant + i * 2) % ROOFS.length], wall);
      k.flat(rect(xm - 5, y1 + 6, xm + 5, hd), 0.4, "#d8c9a3");
    }
    for (const [a, c] of [[-hw * 0.9, -hw * 0.3], [hw * 0.3, hw * 0.9]]) k.box(a, hd * 0.76, c, hd * 0.9, 0, 9, "#3f7f3a", "#56a04b");
    b.top = 74;
  } else {
    const x0 = -hw * 0.88, x1 = hw * 0.88, y0 = -hd * 0.85, y1 = hd * 0.25, H = 118;
    const wall = b.pick(["#e8dccb", "#d6c3a5", "#c9d6df", "#e3c9c0", "#d7dfd0"]);
    k.flat(rect(-hw * 0.95, hd * 0.3, hw * 0.95, hd * 0.95), 0.4, "#cfc8b8");
    k.box(x0, y0, x1, y1, 0, H, wall, "#9ca3af", { windows: [{ rows: 6, color: GLASS, spacing: 18, width: 0.45, height: 0.45, bottom: 0.3 }] });
    // balconies: slabs sticking out of the front
    for (let r = 1; r < 6; r++) k.box(x0 + 6, y1, x1 - 6, y1 + 6, (H / 6) * r - 2, (H / 6) * r, "#f1f5f9", "#f8fafc");
    k.box(x0 - 1, y0 - 1, x1 + 1, y1 + 1, H, H + 4, shade(wall, 0.85), "#9ca3af");
    k.box(-14, y1, 14, y1 + 12, 18, 21, b.pick(ROOFS, 3));
    k.panel(-8, 8, y1, 0, 17, "#334155");
    k.cyl(hw * 0.5, -hd * 0.5, 10, H + 4, H + 22, "#8b5e3c", null, { n: 8 });
    k.cone(hw * 0.5, -hd * 0.5, 11, H + 22, H + 30, "#6b4a2e", { n: 8 });
    k.box(-hw * 0.5, -hd * 0.5, -hw * 0.3, -hd * 0.3, H + 4, H + 12, "#cbd5e1", "#e5e7eb");
    k.bush(-hw * 0.7, hd * 0.65, 11, 18);
    k.bush(hw * 0.7, hd * 0.65, 11, 18);
    b.top = H + 30;
  }
}

// ---- shops: corner shop → supermarket → office tower --------------------------
function shop(b) {
  const { k, hw, hd, level } = b;
  const accent = b.pick(ACCENTS);
  if (level === 1) {
    const x0 = -hw * 0.75, x1 = hw * 0.75, y0 = -hd * 0.7, y1 = hd * 0.12;
    const wall = b.pick(["#f4f1ea", "#e9d8c4", "#d9e4ea", "#f1e3c8"], 4);
    k.box(x0, y0, x1, y1, 0, 34, wall, "#a8a29e", { windows: [{ rows: 1, color: GLASS, spacing: 22, width: 0.4, height: 0.35, bottom: 0.45 }] });
    k.panel(x0 + 8, hw * 0.2, y1, 3, 20, "#bfe3ff", "glow");
    k.panel(hw * 0.3, hw * 0.52, y1, 0, 22, "#5b3a22");
    k.awning(x0 - 2, x1 + 2, y1, 28, 16, [accent, "#f8fafc"]);
    k.box(-hw * 0.5, y1 - 6, hw * 0.5, y1, 34, 48, accent, shade(accent, 0.8));
    k.box(-hw * 0.55, y0 + 8, -hw * 0.3, y0 + 22, 34, 42, "#cbd5e1", "#e5e7eb");
    for (let i = 0; i < 3; i++) {
      const x = x0 + 10 + i * 13;
      k.box(x, hd * 0.45, x + 10, hd * 0.6, 0, 6, "#a47148", ["#ef4444", "#facc15", "#22c55e"][i]);
    }
    b.top = 48;
  } else if (level === 2) {
    const x0 = -hw * 0.92, x1 = hw * 0.92, y0 = -hd * 0.9, y1 = hd * 0.12;
    k.flat(rect(-hw * 0.98, hd * 0.25, hw * 0.98, hd * 0.98), 0.4, "#7d7d7d");
    for (let i = 0; i <= 5; i++) {
      const x = lerp(-hw * 0.85, hw * 0.85, i / 5);
      k.flat(rect(x - 1, hd * 0.45, x + 1, hd * 0.95), 0.7, "#f8fafc");
    }
    k.box(x0, y0, x1, y1, 0, 46, "#f1ede4", "#b0aaa0");
    k.panel(x0 + 8, x1 - 8, y1, 3, 26, "#9fd3f5", "glow");
    k.panel(-9, 9, y1, 0, 24, "#3b5b78");
    k.panel(x0, x1, y1 + 0.3, 31, 40, accent);
    for (const sx of [-1, 1]) k.line(sx * hw * 0.35, -hd * 0.2, 46, sx * hw * 0.35, -hd * 0.2, 62, "#64748b", 2);
    k.box(-hw * 0.48, -hd * 0.24, hw * 0.48, -hd * 0.14, 60, 82, accent, shade(accent, 0.8), {
      windows: [{ rows: 1, color: "#fff7d6", spacing: 14, width: 0.55, height: 0.35, bottom: 0.32 }],
    });
    for (let i = 0; i < 4; i++) {
      const x = lerp(-hw * 0.4, hw * 0.75, i / 4);
      k.flat(rect(x, -hd * 0.8, x + hw * 0.16, -hd * 0.35), 46.6, "#bfe3ff");
    }
    const cars = ["#ef4444", "#3b82f6", "#f8fafc", "#facc15", "#22c55e", "#1f2937"];
    for (let i = 0; i < 2; i++) {
      const x = lerp(-hw * 0.85, hw * 0.85, (((b.variant >>> (i * 3)) % 5) + 0.5) / 5);
      const c = cars[(b.variant >>> (i * 4 + 2)) % cars.length];
      k.box(x - 7, hd * 0.52, x + 7, hd * 0.86, 0, 9, c, shade(c, 0.85));
      k.box(x - 6, hd * 0.6, x + 6, hd * 0.76, 9, 14, "#cfe8ff", shade(c, 0.9));
    }
    b.top = 82;
  } else {
    const H = 196;
    for (let i = 1; i < 4; i++) k.flat(rect(-hw * 0.95, hd * (0.2 + i * 0.18) - 1, hw * 0.95, hd * (0.2 + i * 0.18) + 1), 0.6, "#bfb8a8");
    k.box(-hw * 0.92, -hd * 0.92, hw * 0.92, hd * 0.18, 0, 28, "#cbd5e1", "#94a3b8", {
      windows: [{ rows: 1, color: "#9fd3f5", spacing: 16, width: 0.75, height: 0.6, bottom: 0.15 }],
    });
    k.box(-12, hd * 0.18, 12, hd * 0.32, 20, 23, accent);
    const tw = b.pick([["#5b7f9e", "#cfe6fb"], ["#3f5f7a", "#a8d3f0"], ["#6b7a8f", "#dbeafe"], ["#2f4858", "#9fd3c7"]], 2);
    k.box(-hw * 0.55, -hd * 0.78, hw * 0.55, hd * 0.02, 28, H, tw[0], "#64748b", {
      windows: [{ rows: 10, color: tw[1], spacing: 12, width: 0.7, height: 0.62, bottom: 0.2 }],
    });
    k.box(-hw * 0.38, -hd * 0.6, hw * 0.38, -hd * 0.16, H, H + 14, "#475569", "#334155");
    k.panel(-hw * 0.3, hw * 0.3, hd * 0.02 + 0.5, H - 16, H - 6, accent);
    k.line(0, -hd * 0.38, H + 14, 0, -hd * 0.38, H + 54, "#9ca3af", 2.5);
    b.blink(0, -hd * 0.38, H + 56, ["#ef4444", "#7f1d1d"], 0.6, b.id * 0.17, 4);
    k.bush(-hw * 0.75, hd * 0.6, 10, 16);
    k.bush(hw * 0.75, hd * 0.6, 10, 16);
    b.top = H + 30;
  }
}

// ---- factories: workshop → plant → big plant ------------------------------------
function factory(b) {
  const { k, hw, hd, level } = b;
  const h = 22 + level * 8;
  k.box(-hw * 0.88, -hd * 0.85, hw * 0.42, hd * 0.4, 0, h, "#b8b0a2", "#8a8478", {
    windows: [
      { rows: 1, color: "#6b7280", spacing: 30, width: 0.6, height: 0.7, bottom: 0, only: "front", glow: false },
      { rows: 1, color: "#bfdbfe", spacing: 16, width: 0.6, height: 0.3, bottom: 0.6 },
    ],
  });
  const teeth = 2 + level;
  for (let i = 0; i < teeth; i++) {
    const x0 = lerp(-hw * 0.88, hw * 0.42, i / teeth), x1 = lerp(-hw * 0.88, hw * 0.42, (i + 1) / teeth);
    k.gable(x0, -hd * 0.85, x1, hd * 0.4, h, h + 12, "#6b7280", "#93c5fd");
  }
  const stacks = level >= 3 ? [[hw * 0.66, -hd * 0.55], [hw * 0.66, -hd * 0.1]] : [[hw * 0.66, -hd * 0.4]];
  const stackH = 50 + level * 22;
  for (const [x, y] of stacks) {
    k.cyl(x, y, 7, 0, stackH, "#9a3412", "#3f3f46", { n: 8 });
    k.cyl(x, y, 7.6, stackH - 12, stackH - 6, "#f5f5f4", "#f5f5f4", { n: 8 });
    b.smoke.push({ x, y, h: stackH + 4 });
  }
  if (level >= 2) k.cyl(hw * 0.64, hd * 0.55, 13, 0, 26 + level * 4, "#d1d5db", "#e5e7eb", { n: 10 });
  if (level >= 3) k.dome(hw * 0.64, hd * 0.55, 13, 38, "#cbd5e1", { n: 10, steps: 2 });
  // pallets of crates out front
  for (let i = 0; i < level; i++) k.box(-hw * 0.8 + i * 18, hd * 0.55, -hw * 0.8 + i * 18 + 14, hd * 0.75, 0, 10, "#b7791f", "#d69e2e");
  b.top = Math.max(h + 12, stackH);
}

// ---- specials -----------------------------------------------------------------
function park(b, id) {
  const { k, hw, hd } = b;
  k.flat(ring(hw * 0.4, -hd * 0.45, hw * 0.32, hd * 0.26, 10), 0.8, "#4aa3df", "glow");
  k.flat([[-hw * 0.95, hd * 0.82], [-hw * 0.2, hd * 0.2], [-hw * 0.1, hd * 0.3], [-hw * 0.85, hd * 0.95]], 0.6, "#e6d3a3");
  k.flat([[-hw * 0.2, hd * 0.2], [hw * 0.95, hd * 0.45], [hw * 0.95, hd * 0.6], [-hw * 0.1, hd * 0.3]], 0.6, "#e6d3a3");
  k.box(-hw * 0.35 - 10, hd * 0.05, -hw * 0.35 + 10, hd * 0.05 + 6, 0, 6, "#8b5e3c", "#a47148");
  for (const [x, y] of [[-hw * 0.7, hd * 0.55], [hw * 0.55, hd * 0.2]]) {
    k.line(x, y, 0, x, y, 30, "#334155", 2);
    k.blob(x, y, 32, 4, "#fde68a");
  }
  // trees in the same spots as the classic look
  for (let i = 0; i < 4; i++) {
    const h = hashInts(id, i, 77);
    const u = 0.2 + ((h % 100) / 100) * 0.6, v = 0.25 + (((h >>> 8) % 100) / 100) * 0.5;
    const x = lerp(-hw, hw, u), y = lerp(-hd, hd, v);
    k.tree(x * 0.85, y * 0.85, 60 + (h % 18), i % 2 ? "pine" : "round", i % 2 ? "#3f8a3a" : "#5aa845");
  }
  b.top = 60;
}

function fountain(b) {
  const { k, s } = b;
  k.flat(ring(0, 0, s * 0.95, s * 0.95, 16), 0.4, "#d6cfbf");
  k.cyl(0, 0, s * 0.72, 0, 10, "#bfb6a3", "#4fa3e0", { n: 14 });
  k.cyl(0, 0, s * 0.12, 10, 34, "#cfc6b4", "#cfc6b4", { n: 8 });
  k.cyl(0, 0, s * 0.32, 34, 38, "#cfc6b4", "#6bb8ea", { n: 12 });
  b.spin([0, 0, 38], "y", 1.2, (p) => {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      p.line(0, 0, 4, Math.cos(a) * s * 0.4, Math.sin(a) * s * 0.4, -22, "#dbeafe", 3);
    }
    p.frustum(0, 0, 4, 1.5, 0, 34, "#e0f2fe", "#f0f9ff", { n: 6 });
  });
  b.top = 72;
}

function carousel(b) {
  const { k, s } = b;
  k.cyl(0, 0, s * 0.8, 0, 7, "#b5838d", "#f5e6c8", { n: 14 });
  k.cyl(0, 0, s * 0.1, 7, 50, "#d4af37", "#d4af37", { n: 8 });
  b.spin([0, 0, 0], "y", 0.6, (p) => {
    const colors = ["#f8fafc", "#fca5a5", "#93c5fd", "#fde68a"];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, x = Math.cos(a) * s * 0.58, y = Math.sin(a) * s * 0.58;
      p.line(x, y, 7, x, y, 50, "#d4af37", 1.6);
      const dx = -Math.sin(a) * 6, dy = Math.cos(a) * 6;
      p.box(x - 3, y - 3, x + 3, y + 3, 14 + (i % 2) * 6, 20 + (i % 2) * 6, colors[i % 4]);
      p.blob(x + dx, y + dy, 22 + (i % 2) * 6, 3.5, colors[i % 4]);
    }
    p.cone(0, 0, s * 0.9, 50, 80, ["#e63946", "#f1faee"], { n: 12 });
  });
  k.blob(0, 0, 83, 4, "#d4af37");
  b.top = 86;
}

function school(b) {
  const { k, hw, hd } = b;
  k.flat(rect(-hw * 0.95, hd * 0.3, hw * 0.95, hd * 0.95), 0.4, "#c9a66b");
  k.box(-hw * 0.9, -hd * 0.9, hw * 0.45, hd * 0.2, 0, 52, "#c8693c", null, { windows: [{ rows: 2, color: "#dbeafe" }] });
  k.gable(-hw * 0.94, -hd * 0.94, hw * 0.49, hd * 0.24, 52, 76, "#7c2d12", "#efe6d2");
  k.box(hw * 0.5, -hd * 0.6, hw * 0.88, -hd * 0.1, 0, 92, "#b85c32", "#efe6d2", { windows: [{ rows: 3, color: "#dbeafe", spacing: 14 }] });
  k.box(hw * 0.52, -hd * 0.58, hw * 0.86, -hd * 0.12, 92, 104, "#efe6d2", "#efe6d2");
  k.pyramid(hw * 0.48, -hd * 0.62, hw * 0.9, -hd * 0.08, 104, 136, "#3f7f6e");
  k.blob(hw * 0.69, -hd * 0.35, 98, 4, "#d4af37");
  k.flag(-hw * 0.8, hd * 0.8, 112, "#ef4444");
  b.top = 136;
}

function clinic(b) {
  const { k, hw, hd } = b;
  k.flat(rect(-hw * 0.95, hd * 0.38, hw * 0.95, hd * 0.95), 0.4, "#9ca3af");
  k.box(-hw * 0.88, -hd * 0.9, hw * 0.88, hd * 0.32, 0, 62, "#eef2f6", "#d7dee6", { windows: [{ rows: 3, color: "#7dd3fc" }] });
  k.box(-hw * 0.5, -hd * 0.72, hw * 0.15, hd * 0.05, 62, 94, "#e2e8f0", "#cbd5e1", { windows: [{ rows: 2, color: "#7dd3fc" }] });
  const cx = -hw * 0.17, cy = -hd * 0.33;
  k.flat(rect(cx - 11, cy - 3.5, cx + 11, cy + 3.5), 94.6, "#dc2626");
  k.flat(rect(cx - 3.5, cy - 11, cx + 3.5, cy + 11), 94.7, "#dc2626");
  const hx = hw * 0.55, hy = -hd * 0.35;
  k.flat(ring(hx, hy, 15, 15, 12), 62.6, "#334155");
  k.flat(rect(hx - 6, hy - 1.5, hx + 6, hy + 1.5), 62.8, "#f8fafc");
  k.flat(rect(hx - 6, hy - 7, hx - 3, hy + 7), 62.8, "#f8fafc");
  k.flat(rect(hx + 3, hy - 7, hx + 6, hy + 7), 62.8, "#f8fafc");
  b.blink(-hw * 0.5, -hd * 0.72, 97, ["#ef4444", "#7f1d1d"], 0.8);
  const ax = hw * 0.4;
  k.box(ax, hd * 0.45, ax + 16, hd * 0.9, 0, 15, "#f8fafc", "#ffffff");
  k.box(ax - 0.5, hd * 0.6, ax + 16.5, hd * 0.66, 7, 9, "#ef4444");
  b.blink(ax + 4, hd * 0.86, 16, ["#ef4444", "#3b82f6"], 2, 0, 2.5);
  b.top = 97;
}

function fireStation(b) {
  const { k, hw, hd, level } = b;
  k.box(-hw * 0.9, -hd * 0.9, hw * 0.38, hd * 0.22, 0, 48, "#b91c1c", "#7f1d1d", {
    windows: [
      { rows: 1, color: "#e5e7eb", spacing: 34, width: 0.75, height: 0.72, bottom: 0, only: "front", glow: false },
      { rows: 1, color: "#fde68a", spacing: 18, width: 0.5, height: 0.35, bottom: 0.5 },
    ],
  });
  k.box(-hw * 0.92, -hd * 0.92, hw * 0.4, hd * 0.24, 48, 52, "#f3f4f6", "#991b1b");
  const tower = level >= 3 ? 140 : 108;
  k.box(hw * 0.46, -hd * 0.85, hw * 0.86, -hd * 0.3, 0, tower, "#991b1b", "#450a0a", { windows: [{ rows: tower > 108 ? 5 : 4, color: "#fde68a", spacing: 14 }] });
  k.pyramid(hw * 0.44, -hd * 0.87, hw * 0.88, -hd * 0.28, tower, tower + 16, "#1f2937");
  b.blink(-hw * 0.65, hd * 0.23, 54, ["#ef4444", "#fef2f2"], 1.5);
  b.blink(-hw * 0.1, hd * 0.23, 54, ["#fef2f2", "#ef4444"], 1.5);
  for (let i = 0; i < Math.max(1, level); i++) {
    const tx = -hw * 0.8 + i * 30;
    k.box(tx, hd * 0.3, tx + 20, hd * 0.9, 0, 17, "#dc2626", "#ef4444");
    k.line(tx + 10, hd * 0.34, 18.5, tx + 10, hd * 0.8, 18.5, "#e5e7eb", 3);
    b.blink(tx + 10, hd * 0.86, 19, ["#ef4444", "#3b82f6"], 2.2, i * 0.2, 2.5);
  }
  b.top = tower + 16;
}

function policeStation(b) {
  const { k, hw, hd, level } = b;
  const h = 44 + level * 10;
  k.flat(rect(-hw * 0.95, hd * 0.3, hw * 0.95, hd * 0.95), 0.4, "#6b7280");
  for (let i = 0; i < 4; i++) k.flat(rect(-hw * 0.85 + i * 34 - 1, hd * 0.35, -hw * 0.85 + i * 34 + 1, hd * 0.9), 0.7, "#f8fafc");
  k.box(-hw * 0.9, -hd * 0.9, hw * 0.55, hd * 0.2, 0, h, "#e5e7eb", "#cbd5e1", {
    windows: [{ rows: 1 + level, color: "#93c5fd", spacing: 16, width: 0.55, height: 0.45, bottom: 0.4 }],
  });
  k.box(-hw * 0.92, -hd * 0.92, hw * 0.57, hd * 0.22, h, h + 5, "#1e3a8a", "#1e40af");
  k.box(-hw * 0.4, hd * 0.2, -hw * 0.05, hd * 0.34, h * 0.45, h * 0.5, "#1e3a8a");
  k.panel(-hw * 0.32, -hw * 0.13, hd * 0.2, 0, h * 0.42, "#1e40af");
  b.blink(-hw * 0.22, hd * 0.3, h * 0.62, ["#3b82f6", "#bfdbfe"], 1, 0, 4);
  k.line(hw * 0.3, -hd * 0.6, h + 5, hw * 0.3, -hd * 0.6, h + 55, "#475569", 2.5);
  b.blink(hw * 0.3, -hd * 0.6, h + 57, ["#ef4444", "#7f1d1d"], 0.7);
  k.flag(hw * 0.75, hd * 0.1, 70, "#2563eb");
  for (let i = 0; i < Math.max(1, level); i++) {
    const cx = -hw * 0.82 + i * 34;
    k.box(cx, hd * 0.42, cx + 15, hd * 0.85, 0, 10, "#f8fafc");
    k.box(cx + 1, hd * 0.55, cx + 14, hd * 0.72, 10, 15, "#111827");
    b.blink(cx + 7.5, hd * 0.63, 16, ["#ef4444", "#3b82f6"], 2.5, i * 0.3, 2.2);
  }
  b.top = h + 57;
}

function library(b) {
  const { k, hw, hd } = b;
  k.box(-hw * 0.92, -hd * 0.92, hw * 0.92, hd * 0.5, 0, 7, "#d6cfbf", "#e7e0d0");
  k.box(-hw * 0.86, -hd * 0.86, hw * 0.86, hd * 0.1, 7, 46, "#efe6d2", "#ddd3bd", { windows: [{ rows: 1, color: "#fcd34d", height: 0.6, bottom: 0.2, spacing: 18 }] });
  const cols = Math.max(4, Math.floor((hw * 1.6) / 16));
  for (let i = 0; i < cols; i++) k.cyl(lerp(-hw * 0.8, hw * 0.8, i / (cols - 1)), hd * 0.36, 3.5, 7, 44, "#f8f5ee", "#f8f5ee", { n: 6 });
  k.box(-hw * 0.84, hd * 0.06, hw * 0.84, hd * 0.42, 44, 49, "#efe6d2");
  k.gableX(-hw * 0.84, hd * 0.06, hw * 0.84, hd * 0.42, 49, 60, "#ddd3bd", "#efe6d2");
  const r = Math.min(hw, hd) * 0.42;
  k.cyl(0, -hd * 0.38, r, 46, 58, "#efe6d2", null, { n: 12 });
  k.dome(0, -hd * 0.38, r, 58, "#5e9c8a");
  k.blob(0, -hd * 0.38, 58 + r + 3, 3.5, "#d4af37");
  b.top = 62 + r;
}

function tower(b) {
  const { k, s } = b;
  k.flat(ring(0, 0, s * 0.95, s * 0.95, 16), 0.4, "#e5e7eb");
  k.cyl(0, 0, s * 0.72, 0, 18, "#94a3b8", "#cbd5e1", { n: 12, windows: [{ rows: 1, color: "#bfdbfe", spacing: 10, width: 0.6, height: 0.6, bottom: 0.2 }] });
  k.frustum(0, 0, s * 0.3, s * 0.16, 18, 165, "#e5e7eb", null, { n: 8 });
  k.frustum(0, 0, s * 0.16, s * 0.52, 165, 178, "#cbd5e1", null, { n: 12 });
  b.spin([0, 0, 0], "y", 0.5, (p) => {
    p.cyl(0, 0, s * 0.52, 178, 194, "#3b82f6", "#e5e7eb", { n: 12, windows: [{ rows: 1, color: "#fef3c7", spacing: 9, width: 0.55, height: 0.6, bottom: 0.2 }] });
  });
  k.frustum(0, 0, s * 0.52, s * 0.2, 194, 204, "#e5e7eb", null, { n: 12 });
  k.cyl(0, 0, s * 0.1, 204, 240, "#e5e7eb", "#e5e7eb", { n: 6 });
  k.line(0, 0, 240, 0, 0, 300, "#9ca3af", 3);
  b.blink(0, 0, 302, ["#ef4444", "#7f1d1d"], 0.7, 0, 6);
  b.top = 305;
}

function stadium(b) {
  const { k, hw, hd } = b;
  const n = 18;
  const outer = ring(0, 0, hw * 0.95, hd * 0.93, n), inner = ring(0, 0, hw * 0.6, hd * 0.53, n);
  k.flat(ring(0, 0, hw * 0.6, hd * 0.53, n), 0.5, "#4caf50");
  for (let i = -2; i < 2; i++) k.flat(rect(i * hw * 0.25, -hd * 0.45, i * hw * 0.25 + hw * 0.12, hd * 0.45), 0.7, "#43a047");
  k.flat(rect(-1, -hd * 0.45, 1, hd * 0.45), 0.9, "#f8fafc");
  k.solid(outer, outer, 0, 26, "#94a3b8", null);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    k.face([[...inner[i], 5], [...inner[j], 5], [...outer[j], 26], [...outer[i], 26]], i % 2 ? "#2563eb" : "#1e40af", [0, 0, 60]);
  }
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const x = sx * hw * 0.88, y = sy * hd * 0.86;
    k.line(x, y, 0, x, y, 72, "#64748b", 3);
    k.box(x - 7, y - 3, x + 7, y + 3, 70, 80, "#fef9c3", "#fef9c3");
  }
  b.top = 84;
}

function wheel(b) {
  const { k, hw } = b;
  const R = Math.min(hw * 0.85, 70), hub = R + 12;
  k.flat(rect(-hw * 0.9, -40, hw * 0.9, 40), 0.4, "#e3dccb");
  k.box(-R * 0.35, -12, R * 0.35, 12, 0, 8, "#64748b", "#94a3b8");
  for (const sy of [-1, 1]) for (const sx of [-1, 1]) k.line(sx * R * 0.6, sy * 14, 0, 0, sy * 6, hub, "#64748b", 3);
  b.spin([0, 0, hub], "z", 0.25, (p) => {
    const cars = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7"];
    const pt = (r, a) => [Math.cos(a) * r, Math.sin(a) * r];
    for (let i = 0; i < 20; i++) {
      const [x0, h0] = pt(R, (i / 20) * Math.PI * 2), [x1, h1] = pt(R, ((i + 1) / 20) * Math.PI * 2);
      p.line(x0, -3, h0, x1, -3, h1, "#f8fafc", 3);
      p.line(x0, 3, h0, x1, 3, h1, "#f8fafc", 3);
    }
    for (let i = 0; i < 10; i++) {
      const [x, h] = pt(R, (i / 10) * Math.PI * 2);
      p.line(0, 0, 0, x, 0, h, "#e2e8f0", 1.6);
      p.box(x - 5, -5, x + 5, 5, h - 12, h - 2, cars[i % cars.length], "#f8fafc");
    }
    p.cyl(0, 0, 5, -6, 6, "#475569");
  });
  b.top = hub + R + 4;
}

// Scaffolding and a little crane, around whatever is being built.
function construction(b) {
  const { k, hw, hd } = b;
  const H = 30 + b.level * 22;
  const x0 = -hw * 0.75, x1 = hw * 0.6, y0 = -hd * 0.7, y1 = hd * 0.2;
  for (const x of [x0, (x0 + x1) / 2, x1]) for (const y of [y0, y1]) k.line(x, y, 0, x, y, H, "#f59e0b", 2.2);
  for (let h = 14; h <= H; h += 16) {
    k.line(x0, y1, h, x1, y1, h, "#f59e0b", 1.8);
    k.line(x0, y0, h, x1, y0, h, "#f59e0b", 1.8);
    k.box(x0, y1, x1, y1 + 5, h - 1, h, "#a16207");
  }
  // crane
  const cx = hw * 0.78, cy = -hd * 0.65, CH = H + 40;
  k.box(cx - 3, cy - 3, cx + 3, cy + 3, 0, CH, "#facc15", "#eab308");
  k.line(cx, cy, CH, -hw * 0.6, cy, CH, "#facc15", 3);
  k.line(cx, cy, CH, cx + 18, cy, CH, "#facc15", 3);
  k.box(cx + 14, cy - 5, cx + 24, cy + 5, CH - 8, CH, "#475569");
  k.line(-hw * 0.3, cy, CH, -hw * 0.3, cy, CH - 30, "#1f2937", 1);
  k.box(-hw * 0.3 - 5, cy - 5, -hw * 0.3 + 5, cy + 5, CH - 38, CH - 30, "#b45309");
  b.blink(-hw * 0.6, cy, CH + 3, ["#f97316", "#7c2d12"], 1, 0, 2.5);
  // dirt piles and a cone
  k.blob(-hw * 0.6, hd * 0.6, 4, 12, "#a07850", { squash: 0.5 });
  k.cone(hw * 0.5, hd * 0.7, 5, 0, 14, ["#f97316", "#f8fafc"], { n: 6 });
  b.top = CH;
}

const BUILDERS = {
  house, shop, factory, park, fountain, carousel, school, clinic,
  fire: fireStation, police: policeStation, library, tower, stadium, wheel, construction,
};

// Models are cached per type, level, rounded lot size and color variant.
// Parks are one of a kind (their trees follow the lot id).
const cache = new Map();
export function buildModel(type, level, hw, hd, variant, id) {
  const fn = BUILDERS[type];
  if (!fn) return null;
  const rw = Math.round(hw / 4) * 4, rd = Math.round(hd / 4) * 4;
  const v = type === "park" ? id : variant % 997;
  const key = type + ":" + level + ":" + rw + ":" + rd + ":" + v;
  let m = cache.get(key);
  if (!m) {
    const b = new Build(rw, rd, level, variant, id);
    fn(b, id);
    m = {
      ...b.k.build(),
      parts: b.parts.map((p) => ({ ...p.kit.build(), pivot: p.pivot, axis: p.axis, speed: p.speed })),
      blinkers: b.blinkers,
      smoke: b.smoke,
      top: b.top,
    };
    if (cache.size > 400) {
      // forget the oldest model; meshes still using it keep their own reference
      cache.delete(cache.keys().next().value);
    }
    cache.set(key, m);
  }
  return m;
}
