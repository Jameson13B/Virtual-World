// ---------------------------------------------------------------------------
// Everything drawn flat on top of the 3D town: coin bubbles, emergencies,
// construction progress, upgrade arrows, level badges, road numbers and the
// floating "+12 💰" text. Drawn on the 2D canvas that sits over the WebGL one
// (it also takes the taps), at points projected through the 3D camera.
// ---------------------------------------------------------------------------

export const LEVEL_COLORS = ["#94a3b8", "#38bdf8", "#a78bfa", "#f59e0b"];
export const ZONE_COLORS = { res: "#22c55e", com: "#3b82f6", ind: "#f59e0b", special: "#d946ef", svc: "#ef4444" };

// Emoji are slow to draw, so each size is painted once and reused.
const glyphs = new Map();
function glyph(text, px) {
  px = Math.round(px);
  const key = text + px;
  let c = glyphs.get(key);
  if (!c) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c = document.createElement("canvas");
    c.width = c.height = Math.ceil(px * 1.35 * dpr);
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    g.font = px + "px system-ui, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, (px * 1.35) / 2, (px * 1.35) / 2 + px * 0.06);
    c.size = px * 1.35;
    if (glyphs.size > 300) glyphs.clear();
    glyphs.set(key, c);
  }
  return c;
}

function drawGlyph(ctx, text, x, y, px) {
  const g = glyph(text, px);
  ctx.drawImage(g, x - g.size / 2, y - g.size / 2, g.size, g.size);
}

function pill(ctx, x, y, w, h, fill, stroke = null) {
  const r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x - w / 2 + r, y - h / 2);
  ctx.arcTo(x + w / 2, y - h / 2, x + w / 2, y + h / 2, r);
  ctx.arcTo(x + w / 2, y + h / 2, x - w / 2, y + h / 2, r);
  ctx.arcTo(x - w / 2, y + h / 2, x - w / 2, y - h / 2, r);
  ctx.arcTo(x - w / 2, y - h / 2, x + w / 2, y - h / 2, r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

// A round marker with a soft shadow and an optional progress ring.
function bubble(ctx, x, y, r, icon, { fill = "rgba(255,255,255,0.96)", ring = null, ringColor = "#f59e0b", border = "rgba(15,23,42,0.18)" } = {}) {
  ctx.save();
  ctx.shadowColor = "rgba(15,23,42,0.35)";
  ctx.shadowBlur = r * 0.5;
  ctx.shadowOffsetY = r * 0.15;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = Math.max(2, r * 0.16);
  ctx.strokeStyle = border;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  if (ring != null) {
    ctx.strokeStyle = ringColor;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(ring, 0, 1));
    ctx.stroke();
  }
  // a little pointer under the bubble
  ctx.beginPath();
  ctx.moveTo(x - r * 0.3, y + r * 0.9);
  ctx.lineTo(x, y + r * 1.35);
  ctx.lineTo(x + r * 0.3, y + r * 0.9);
  ctx.fillStyle = fill;
  ctx.fill();
  drawGlyph(ctx, icon, x, y + 1, r * 1.05);
}

// A small green circle with a white up arrow.
function upArrow(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = "#22c55e";
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#fff";
  ctx.stroke();
  const s = r * 0.55;
  ctx.beginPath();
  ctx.moveTo(x, y - s * 1.1);
  ctx.lineTo(x + s, y);
  ctx.lineTo(x + s * 0.38, y);
  ctx.lineTo(x + s * 0.38, y + s);
  ctx.lineTo(x - s * 0.38, y + s);
  ctx.lineTo(x - s * 0.38, y);
  ctx.lineTo(x - s, y);
  ctx.closePath();
  ctx.fillStyle = "#fff";
  ctx.fill();
}

export class Overlay {
  constructor() {
    this.targets = [];
  }

  // `project(x, h, y)` → screen point or null. `markers` comes from the
  // renderer: one entry per lot with where its roof is.
  draw(ctx, { width, height, project, city, markers, z, now, lens, choices, roadPick, floaters, showChoices, placing, visiting, junctions = [] }) {
    this.targets = [];
    const t = now / 1000;
    const k = clamp(1.25 - z * 0.12, 0.65, 1.1); // markers shrink a little when zoomed out
    const R = 19 * k;
    const onScreen = (p, m = 40) => p && p.x > -m && p.y > -m && p.x < width + m && p.y < height + m;

    // level badges / pips first, so action markers sit on top
    if (!placing && (lens === "levels" || z < 2.6)) {
      for (const m of markers) {
        const lot = m.lot;
        if (!["res", "com", "ind", "svc"].includes(lot.kind) || lot.building > 0) continue;
        const p = project(m.x, m.top + 10, m.y);
        if (!onScreen(p)) continue;
        const lvl = Math.max(1, lot.effectiveLevel);
        if (lens === "levels") {
          const w = 30 * k, h = 18 * k;
          ctx.lineWidth = 2;
          pill(ctx, p.x, p.y, w, h, LEVEL_COLORS[lvl], "rgba(255,255,255,0.9)");
          ctx.fillStyle = "#0f172a";
          ctx.font = "800 " + Math.round(12 * k) + "px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("L" + lvl, p.x, p.y + 0.5);
          if (!visiting && m.blocked) drawGlyph(ctx, "🔒", p.x + w / 2 + 7 * k, p.y, 13 * k);
          else if (m.upgrade) upArrow(ctx, p.x + w / 2 + 6 * k, p.y, 8 * k);
        } else {
          // three little pips: filled up to the level
          const w = 26 * k, h = 9 * k;
          pill(ctx, p.x, p.y, w, h, "rgba(15,23,42,0.6)");
          for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.arc(p.x + (i - 1) * 7.5 * k, p.y, 2.6 * k, 0, Math.PI * 2);
            ctx.fillStyle = i < lvl ? LEVEL_COLORS[lvl] : "rgba(255,255,255,0.25)";
            ctx.fill();
          }
          // an upgrade you can afford right now: a green arrow on the badge
          if (m.upgrade) upArrow(ctx, p.x + w / 2 + 5 * k, p.y, 7.5 * k);
        }
      }
    }

    for (const m of markers) {
      const lot = m.lot;
      // construction: a ring that fills as the builders work
      if (lot.building > 0 && m.buildTotal) {
        const p = project(m.x, m.top + 26, m.y);
        if (onScreen(p)) bubble(ctx, p.x, p.y, R * 0.85, "🏗️", { ring: 1 - lot.building / m.buildTotal, ringColor: "#f59e0b" });
        continue;
      }
      if (visiting || placing) continue;
      if (lot.incident) {
        const inc = lot.incident;
        const p = project(m.x, m.top + 46, m.y);
        if (!onScreen(p)) continue;
        const left = inc.working > 0 ? 1 : 1 - inc.t / inc.limit;
        const bob = Math.sin(t * 5 + lot.id) * 3;
        const r = R * 1.15 * (1 + 0.08 * Math.sin(t * 8));
        bubble(ctx, p.x, p.y + bob, r, inc.working > 0 ? SERVICES[inc.type].icon : SERVICES[inc.type].incident, {
          fill: inc.working > 0 ? "rgba(220,252,231,0.97)" : "rgba(255,255,255,0.97)",
          ring: left,
          ringColor: inc.working > 0 ? "#22c55e" : left < 0.3 ? "#ef4444" : "#f97316",
        });
        this.targets.push({ x: p.x, y: p.y + bob, r: r * 1.5, incident: true, lot });
        continue;
      }
      if (m.ready) {
        const p = project(m.x, m.top + 28, m.y);
        if (!onScreen(p)) continue;
        const bob = Math.sin(t * 3.2 + lot.id) * 3.5;
        if (z > 3.2) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
          ctx.fillStyle = lot.kind === "ind" ? "#d97706" : "#facc15";
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = "#fff";
          ctx.stroke();
          this.targets.push({ x: p.x, y: p.y, r: 22, bubble: true, lot });
        } else {
          bubble(ctx, p.x, p.y + bob, R, lot.kind === "ind" ? "📦" : "💰", { border: lot.kind === "ind" ? "#b45309" : "#f59e0b" });
          this.targets.push({ x: p.x, y: p.y + bob, r: R * 1.6, bubble: true, lot });
        }
        continue;
      }
    }

    // intersections: all of them in the traffic lens, colored by how busy
    // they are; elsewhere only the jammed ones, so the player can fix them
    if (!placing) {
      for (const m of junctions) {
        const j = m.j;
        if (lens !== "traffic" && (visiting || !j.jammed)) continue;
        const p = project(m.x, m.h + 34, m.y);
        if (!onScreen(p)) continue;
        const load = j.load, color = load > 0.66 ? "#ef4444" : load > 0.33 ? "#f59e0b" : "#22c55e";
        const jam = j.jammed && !visiting;
        const bob = jam ? Math.sin(t * 4 + m.x) * 3 : 0;
        const r = R * (jam ? 1 + 0.08 * Math.sin(t * 7) : 0.85);
        bubble(ctx, p.x, p.y + bob, r, j.control ? CONTROLS[j.control].icon : jam ? "🚗" : "➕", { ring: Math.max(0.04, load), ringColor: color, border: color });
        this.targets.push({ x: p.x, y: p.y + bob, r: r * 1.5, junction: j });
      }
    }

    // numbered road choices
    if (showChoices) {
      choices.forEach((c, i) => {
        const p = project(c.mid.x, c.y + 8, c.mid.y);
        if (!onScreen(p)) return;
        const on = roadPick === i, dim = roadPick >= 0 && !on;
        const r = 20 * Math.max(0.85, k);
        ctx.globalAlpha = dim ? 0.45 : 1;
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.4)";
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = on ? "#facc15" : "#0f172a";
        ctx.fill();
        ctx.restore();
        ctx.lineWidth = 3;
        ctx.strokeStyle = on ? "#0f172a" : "#facc15";
        ctx.stroke();
        ctx.fillStyle = on ? "#0f172a" : "#facc15";
        ctx.font = "800 " + Math.round(r * 1.1) + "px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(i + 1), p.x, p.y + 1);
        ctx.globalAlpha = 1;
        this.targets.push({ x: p.x, y: p.y, r: r * 1.4, choice: i });
      });
    }

    // floating text
    for (const f of floaters) {
      const p = project(f.x, (f.h || 40) + 20, f.y);
      if (!p) continue;
      const a = 1 - f.age / f.life;
      const rise = f.age * 70;
      const pop = Math.min(1, f.age * 8);
      ctx.globalAlpha = Math.max(0, Math.min(1, a * 1.6));
      ctx.font = "800 " + Math.round(20 * (0.7 + 0.3 * pop)) + "px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 5;
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(15,23,42,0.75)";
      ctx.strokeText(f.text, p.x, p.y - rise);
      ctx.fillStyle = f.color || "#fde047";
      ctx.fillText(f.text, p.x, p.y - rise);
      ctx.globalAlpha = 1;
    }
  }

  // The marker under a screen point, if any (newest drawn wins).
  hit(screen) {
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const t = this.targets[i];
      if ((t.x - screen.x) ** 2 + (t.y - screen.y) ** 2 < t.r * t.r) return t;
    }
    return null;
  }
}
