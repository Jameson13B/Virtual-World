// ---------------------------------------------------------------------------
// Roads in 3D: sidewalks and asphalt draped over the land, dashed center
// lines, street lamps, bridges on pillars over water, tunnel portals into the
// mountains, the road being built, and the ghost roads on offer.
// ---------------------------------------------------------------------------
import * as THREE from "../../../vendor/three.module.min.js";
import { Kit, rgb } from "./kit.js";
import { DECK_Y } from "./ground.js";

const WALK_W = ROAD_W;
const ASPHALT_W = ROAD_W - 22;
const WALK_LIFT = 1.6, ASPHALT_LIFT = 4, PAINT_LIFT = 4.7;
const STEP = 30; // road samples every this many units
const RAMP = 70; // bridges climb to deck height over this distance

// Each layer sits a little higher and wins the depth test a little harder:
// sidewalks, then asphalt, then paint.
function roadMaterial(bias) {
  return new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, polygonOffset: true, polygonOffsetFactor: -bias, polygonOffsetUnits: -bias * 2 });
}

// A triangle-list builder for flat pieces lying on the ground.
class Sheet {
  constructor() {
    this.pos = [];
    this.col = [];
  }

  tri(a, b, c, color) {
    // keep every triangle facing up
    const ux = b[0] - a[0], uz = b[2] - a[2], vx = c[0] - a[0], vz = c[2] - a[2];
    if (uz * vx - ux * vz < 0) [b, c] = [c, b];
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.col.push(color.r, color.g, color.b);
    }
  }

  quad(a, b, c, d, color) {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

export class RoadLayer {
  constructor(city, ground) {
    this.city = city;
    this.ground = ground;
    this.group = new THREE.Group();
    this.pendingGroup = new THREE.Group();
    this.choiceGroup = new THREE.Group();
    this.walkMat = roadMaterial(1);
    this.material = roadMaterial(3);
    this.paintMat = roadMaterial(5);
    this.ghostMats = [];
    this.meshes = [];
    this.lampLights = null;
  }

  // ---- heights along a road ------------------------------------------------
  // Each road samples its own profile: on land it hugs the ground, over water
  // it rises onto a bridge deck, and through rock it runs straight (hidden
  // inside the mountain).
  profile(a, b) {
    const terrain = this.city.terrain;
    const len = distance(a, b);
    const water = terrain.waterSpans(a, b), rock = terrain.rockSpans(a, b);
    const ts = new Set();
    const n = Math.max(1, Math.ceil(len / STEP));
    for (let i = 0; i <= n; i++) ts.add(i / n);
    for (const [t0, t1] of [...water, ...rock]) {
      ts.add(t0);
      ts.add(t1);
      for (const r of [RAMP / len, (RAMP * 0.5) / len]) {
        if (t0 + r < t1) ts.add(t0 + r);
        if (t1 - r > t0) ts.add(t1 - r);
      }
    }
    const list = [...ts].filter((t) => t >= 0 && t <= 1).sort((x, y) => x - y);
    const at = (t) => new Point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    const landY = (t) => {
      const p = at(t);
      return this.ground.landAt(p.x, p.y);
    };
    return list.map((t) => {
      const w = water.find(([t0, t1]) => t >= t0 && t <= t1);
      if (w) {
        const [t0, t1] = w;
        const y0 = landY(t0), y1 = landY(t1);
        const d0 = (t - t0) * len, d1 = (t1 - t) * len;
        const ramp = (d, y) => y + (DECK_Y - y) * smooth01(d / RAMP);
        return { t, p: at(t), y: Math.min(ramp(d0, y0), ramp(d1, y1), DECK_Y) + ASPHALT_LIFT, kind: "bridge" };
      }
      const r = rock.find(([t0, t1]) => t >= t0 && t <= t1);
      if (r) {
        const [t0, t1] = r;
        const y = lerp(landY(t0), landY(t1), (t - t0) / Math.max(1e-6, t1 - t0));
        return { t, p: at(t), y: y + ASPHALT_LIFT, kind: "tunnel" };
      }
      return { t, p: at(t), y: null, kind: "land" };
    });
  }

  // Lays a strip of `width` along a profile. On land each vertex hugs the
  // ground; elsewhere the strip stays level across.
  #strip(sheet, prof, width, lift, color, from = 0, to = 1) {
    const s = prof.filter((q) => q.t >= from && q.t <= to);
    if (s.length < 2) return;
    const dir = normalize(subtract(s[s.length - 1].p, s[0].p));
    const n = scale(perpendicular(dir), width / 2);
    const vert = (q, side) => {
      const p = add(q.p, scale(n, side));
      const y = q.y == null ? this.ground.landAt(p.x, p.y) + lift : q.y + lift - ASPHALT_LIFT;
      return [p.x, y, p.y];
    };
    const across = [-1, -0.5, 0, 0.5, 1];
    for (let i = 0; i < s.length - 1; i++) {
      const A = across.map((k) => vert(s[i], k)), B = across.map((k) => vert(s[i + 1], k));
      for (let j = 0; j < across.length - 1; j++) sheet.quad(A[j], A[j + 1], B[j + 1], B[j], color);
    }
  }

  #disc(sheet, c, r, lift, color) {
    const n = 14;
    const cy = this.ground.landAt(c.x, c.y) + lift;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const p0 = [c.x + Math.cos(a0) * r, 0, c.y + Math.sin(a0) * r], p1 = [c.x + Math.cos(a1) * r, 0, c.y + Math.sin(a1) * r];
      p0[1] = this.ground.landAt(p0[0], p0[2]) + lift;
      p1[1] = this.ground.landAt(p1[0], p1[2]) + lift;
      sheet.tri([c.x, cy, c.y], p0, p1, color);
    }
  }

  // ---- build everything ------------------------------------------------------
  rebuild() {
    for (const m of this.meshes) {
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.meshes = [];
    const g = this.city.layout.graph;
    const walkSheet = new Sheet();
    const sheet = new Sheet();
    const paint = new Sheet();
    const kit = new Kit();
    const walk = rgb("#d4cfc6"), asphalt = rgb("#4b5260"), white = rgb("#f8fafc");
    this.profiles = new Map();
    for (const seg of g.segments) {
      const prof = this.profile(seg.p1, seg.p2);
      this.profiles.set(seg, prof);
      this.#strip(walkSheet, prof, WALK_W, WALK_LIFT, walk);
      this.#strip(sheet, prof, ASPHALT_W, ASPHALT_LIFT, asphalt);
      this.#dashes(paint, seg, prof, white);
      this.#structures(kit, seg, prof);
    }
    for (const p of g.points) {
      this.#disc(walkSheet, p, WALK_W / 2, WALK_LIFT - 0.05, walk);
      this.#disc(sheet, p, ASPHALT_W / 2, ASPHALT_LIFT - 0.05, asphalt);
    }
    const walks = new THREE.Mesh(walkSheet.geometry(), this.walkMat);
    const road = new THREE.Mesh(sheet.geometry(), this.material);
    walks.receiveShadow = road.receiveShadow = true;
    const lines = new THREE.Mesh(paint.geometry(), this.paintMat);
    this.meshes.push(walks, road, lines);
    const built = kit.build();
    if (built.body) {
      const m = new THREE.Mesh(built.body, this.structMat || (this.structMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
      m.castShadow = m.receiveShadow = true;
      this.meshes.push(m);
    }
    if (built.glow) this.meshes.push((this.lampLights = new THREE.Mesh(built.glow, this.glowMat)));
    for (const m of this.meshes) {
      m.matrixAutoUpdate = false;
      this.group.add(m);
    }
  }

  #dashes(sheet, seg, prof, color) {
    const len = seg.length();
    const dir = seg.directionVector(), n = scale(perpendicular(dir), 2);
    const yAt = (t) => {
      const q = prof.find((x) => x.t >= t) || prof[prof.length - 1];
      if (q.kind === "tunnel") return null;
      const p = lerp2D(seg.p1, seg.p2, t);
      return q.kind === "bridge" ? q.y + 0.7 : this.ground.landAt(p.x, p.y) + PAINT_LIFT;
    };
    for (let d = ROAD_W / 2; d + 24 < len - ROAD_W / 2; d += 44) {
      const t0 = d / len, t1 = (d + 24) / len;
      const y0 = yAt(t0), y1 = yAt(t1);
      if (y0 == null || y1 == null) continue;
      const a = lerp2D(seg.p1, seg.p2, t0), b = lerp2D(seg.p1, seg.p2, t1);
      sheet.quad([a.x + n.x, y0, a.y + n.y], [b.x + n.x, y1, b.y + n.y], [b.x - n.x, y1, b.y - n.y], [a.x - n.x, y0, a.y - n.y], color);
    }
  }

  // Bridges (deck sides, railings, pillars), tunnel portals and street lamps,
  // drawn with the model kit in world coordinates.
  #structures(k, seg, prof) {
    const dir = seg.directionVector(), nrm = perpendicular(dir);
    const len = seg.length();
    // bridges
    const bridge = prof.filter((q) => q.kind === "bridge");
    for (let i = 0; i < prof.length - 1; i++) {
      const A = prof[i], B = prof[i + 1];
      if (A.kind !== "bridge" || B.kind !== "bridge") continue;
      for (const side of [-1, 1]) {
        const off = scale(nrm, side * (WALK_W / 2 + 3));
        const a = add(A.p, off), b = add(B.p, off);
        k.line(a.x, a.y, A.y + 6, b.x, b.y, B.y + 6, "#e7e5e4", 3); // railing
        k.face([[a.x, a.y, A.y - 1], [b.x, b.y, B.y - 1], [b.x, b.y, B.y - 9], [a.x, a.y, A.y - 9]], "#8a7f74", [A.p.x, A.p.y, A.y - 5]);
      }
      // underside
      const l = scale(nrm, WALK_W / 2 + 3);
      k.face([[A.p.x + l.x, A.p.y + l.y, A.y - 9], [B.p.x + l.x, B.p.y + l.y, B.y - 9], [B.p.x - l.x, B.p.y - l.y, B.y - 9], [A.p.x - l.x, A.p.y - l.y, A.y - 9]], "#6b625a", [A.p.x, A.p.y, A.y]);
    }
    if (bridge.length) {
      for (let d = 0; d < len; d += 150) {
        const q = prof.find((x) => x.t >= d / len);
        if (!q || q.kind !== "bridge" || q.y < DECK_Y - 1) continue;
        const r = this.#orientedRect(q.p, dir, 12, WALK_W * 0.42);
        k.solid(r, r, -70, q.y - 9, "#a8a29e", null);
      }
    }
    // tunnel portals: a stone arch where the road enters the rock
    for (let i = 0; i < prof.length - 1; i++) {
      const A = prof[i], B = prof[i + 1];
      if ((A.kind === "tunnel") === (B.kind === "tunnel")) continue;
      const end = A.kind === "tunnel" ? A : B, outward = A.kind === "tunnel" ? scale(dir, -1) : dir;
      const out = A.kind === "tunnel" ? scale(dir, 1) : scale(dir, -1);
      const base = add(end.p, scale(out, 6));
      for (const side of [-1, 1]) {
        const c = add(base, scale(nrm, side * (WALK_W / 2 + 6)));
        const r = this.#orientedRect(c, dir, 14, 10);
        k.solid(r, r, end.y - 6, end.y + 60, "#a8a29e", "#d6d3d1");
      }
      const lintel = this.#orientedRect(base, dir, 14, WALK_W / 2 + 16);
      k.solid(lintel, lintel, end.y + 50, end.y + 70, "#a8a29e", "#d6d3d1");
      const dark = add(end.p, scale(outward, 2));
      const w = scale(nrm, WALK_W / 2 + 1);
      k.face([[dark.x + w.x, dark.y + w.y, end.y - 2], [dark.x - w.x, dark.y - w.y, end.y - 2], [dark.x - w.x, dark.y - w.y, end.y + 50], [dark.x + w.x, dark.y + w.y, end.y + 50]], "#1c1917", [dark.x + out.x * 10, dark.y + out.y * 10, end.y]);
    }
    // street lamps, alternating sides, only on land
    for (let d = 90, i = 0; d < len - 60; d += 300, i++) {
      const t = d / len, q = prof.find((x) => x.t >= t);
      if (!q || q.kind !== "land") continue;
      const side = i % 2 ? 1 : -1;
      const p = add(lerp2D(seg.p1, seg.p2, t), scale(nrm, side * (WALK_W / 2 - 5)));
      const y = this.ground.landAt(p.x, p.y);
      const arm = add(p, scale(nrm, -side * 14));
      k.line(p.x, p.y, y, p.x, p.y, y + 38, "#475569", 2.4);
      k.line(p.x, p.y, y + 38, arm.x, arm.y, y + 38, "#475569", 2);
      const r = this.#orientedRect(arm, dir, 4, 3);
      k.solid(r, r, y + 33, y + 37, "#fde68a", null);
      k.flat(r, y + 33, "#fff3c4", "glow");
    }
  }

  #orientedRect(c, dir, halfAlong, halfAcross) {
    const a = scale(dir, halfAlong), n = scale(perpendicular(dir), halfAcross);
    return [add(add(c, a), n), add(subtract(c, a), n), subtract(subtract(c, a), n), subtract(add(c, a), n)].map((p) => [p.x, p.y]);
  }

  // ---- the road being built ----------------------------------------------------
  updatePending(job, now) {
    if (!job) {
      if (this.pendingKey) this.#clearPending();
      return null;
    }
    const a = new Point(job.a.x, job.a.y), b = new Point(job.b.x, job.b.y);
    const key = a.x + "," + a.y + "," + b.x + "," + b.y;
    if (this.pendingKey !== key) {
      this.#clearPending();
      this.pendingKey = key;
      this.pendingProf = this.profile(a, b);
      const dirt = new Sheet();
      this.#strip(dirt, this.pendingProf, WALK_W + 8, WALK_LIFT - 0.2, rgb("#a07850"));
      this.pendingDirt = new THREE.Mesh(dirt.geometry(), this.walkMat);
      this.pendingGroup.add(this.pendingDirt);
      const k = new Kit();
      // barrier + cones at the head of the works
      k.box(-24, -3, 24, 3, 8, 16, "#f97316", "#f8fafc");
      k.line(-20, 0, 0, -20, 0, 12, "#f8fafc", 2);
      k.line(20, 0, 0, 20, 0, 12, "#f8fafc", 2);
      for (const x of [-34, 34]) k.cone(x, 8, 5, 0, 16, ["#f97316", "#f8fafc"], { n: 6 });
      const head = k.build();
      this.pendingHead = new THREE.Mesh(head.body, this.structMat || (this.structMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
      this.pendingHead.castShadow = true;
      this.pendingGroup.add(this.pendingHead);
      this.pendingProgress = -1;
    }
    const p = clamp(job.t / job.duration, 0, 1);
    if (Math.abs(p - this.pendingProgress) > 0.01) {
      this.pendingProgress = p;
      if (this.pendingDone) {
        this.pendingGroup.remove(this.pendingDone);
        this.pendingDone.geometry.dispose();
        this.pendingDone = null;
      }
      if (p > 0.02) {
        const s = new Sheet();
        const prof = this.pendingProf.filter((q) => q.t <= p);
        const last = this.pendingProf.find((q) => q.t >= p);
        if (last && last.t > p) prof.push({ ...last, t: p, p: lerp2D(a, b, p), y: last.y });
        this.#strip(s, prof, ASPHALT_W, ASPHALT_LIFT, rgb("#5b6170"));
        this.pendingDone = new THREE.Mesh(s.geometry(), this.material);
        this.pendingGroup.add(this.pendingDone);
      }
    }
    const head = lerp2D(a, b, p), dir = normalize(subtract(b, a));
    this.pendingHead.position.set(head.x, this.ground.landAt(head.x, head.y) + 1, head.y);
    this.pendingHead.rotation.y = Math.atan2(dir.x, dir.y) + Math.PI / 2;
    return head;
  }

  #clearPending() {
    for (const m of [...this.pendingGroup.children]) {
      this.pendingGroup.remove(m);
      if (m !== this.pendingHead) m.geometry.dispose();
    }
    if (this.pendingHead) this.pendingHead.geometry.dispose();
    this.pendingHead = this.pendingDone = this.pendingDirt = null;
    this.pendingKey = null;
  }

  // ---- roads on offer: glowing ghost roads with their new lots ---------------
  updateChoices(choices, pick, now, show) {
    const key = choices.map((c) => c.a.x + "," + c.a.y + "," + c.b.x + "," + c.b.y).join("|");
    if (key !== this.choiceKey) {
      this.choiceKey = key;
      for (const m of [...this.choiceGroup.children]) {
        this.choiceGroup.remove(m);
        m.geometry.dispose();
      }
      this.choiceMeshes = choices.map((c, i) => {
        const a = new Point(c.a.x, c.a.y), b = new Point(c.b.x, c.b.y);
        const s = new Sheet();
        const prof = this.profile(a, b);
        this.#strip(s, prof, WALK_W, PAINT_LIFT + 3, rgb("#ffffff"));
        for (const poly of this.city.layout.previewLots(a, b)) {
          const pts = poly.points;
          for (let j = 0; j < pts.length; j++) {
            const p = pts[j], q = pts[(j + 1) % pts.length];
            const n = scale(perpendicular(normalize(subtract(q, p))), 3);
            const y = (r) => this.ground.landAt(r.x, r.y) + 5;
            s.quad([p.x + n.x, y(p), p.y + n.y], [q.x + n.x, y(q), q.y + n.y], [q.x - n.x, y(q), q.y - n.y], [p.x - n.x, y(p), p.y - n.y], rgb("#ffffff"));
          }
          // a faint fill inside each new lot
          const y = (r) => this.ground.landAt(r.x, r.y) + 4;
          s.quad([pts[0].x, y(pts[0]), pts[0].y], [pts[1].x, y(pts[1]), pts[1].y], [pts[2].x, y(pts[2]), pts[2].y], [pts[3].x, y(pts[3]), pts[3].y], rgb("#e2e8f0"));
        }
        if (!this.ghostMats[i]) this.ghostMats[i] = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
        const m = new THREE.Mesh(s.geometry(), this.ghostMats[i]);
        m.renderOrder = 3;
        this.choiceGroup.add(m);
        return m;
      });
    }
    this.choiceGroup.visible = show && choices.length > 0;
    const pulse = 0.5 + 0.5 * Math.sin(now / 300);
    (this.choiceMeshes || []).forEach((m, i) => {
      const on = pick === i, dim = pick >= 0 && !on;
      const mat = this.ghostMats[i];
      mat.color.set(on ? 0xfacc15 : 0xffffff);
      mat.opacity = dim ? 0.2 : on ? 0.75 : 0.35 + pulse * 0.3;
    });
  }

  dispose() {
    for (const m of this.meshes) m.geometry.dispose();
    this.#clearPending();
    for (const m of this.choiceGroup.children) m.geometry.dispose();
    for (const m of [this.walkMat, this.material, this.paintMat]) m.dispose();
    for (const m of this.ghostMats) m.dispose();
  }
}
