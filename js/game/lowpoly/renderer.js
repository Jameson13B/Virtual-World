// ---------------------------------------------------------------------------
// The low-poly 3D look. A drop-in for CityRenderer (render.js): game.js calls
// draw(), pickMarker(), lotAt(), choiceAt(), anchor() and reads `borders`.
//
// One Stage (WebGL renderer + camera) is shared by every town shown in 3D;
// each LowPolyRenderer owns one town's scene. The camera is derived from the
// game's Viewport (offset, zoom, angle), which stays the source of truth.
// ---------------------------------------------------------------------------
import * as THREE from "../../../vendor/three.module.min.js";
import { Ground, Water, elevation } from "./ground.js";
import { RoadLayer } from "./roads3d.js";
import { Forest } from "./trees3d.js";
import { Traffic } from "./vehicles3d.js";
import { Signals } from "./signals3d.js";
import { buildModel } from "./models3d.js";
import { Overlay, LEVEL_COLORS, ZONE_COLORS } from "./overlay.js";
import { rgb } from "./kit.js";

const FOV = 34;
// Ground colors under each kind of building (also used by the classic look's
// LOT_MODELS, kept separate so either look can be removed on its own).
const FLOORS = {
  house: "#7cbf64", shop: "#d6d0c2", factory: "#9a958a", park: "#5fae4f", fountain: "#e3dccb", carousel: "#e3dccb",
  school: "#cdbf9c", clinic: "#cbd5e1", fire: "#a8a29e", police: "#9ca3af", library: "#e7e0d0", tower: "#d1d5db",
  stadium: "#94a3b8", wheel: "#e3dccb",
};
const PITCH = (54 * Math.PI) / 180;
const LENSES = ["normal", "zones", "levels", "safety"];

// ---- the shared WebGL stage ---------------------------------------------------
export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.05;
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 1, 10000);
    this.raycaster = new THREE.Raycaster();
    this.targetY = 0;
    this.mobile = matchMedia("(pointer: coarse)").matches;
    this.shadows = true;
    this.frameTimes = [];
  }

  resize(w, h) {
    const dpr = Math.min(this.mobile ? 1.5 : 2, window.devicePixelRatio || 1);
    if (w !== this.w || h !== this.h || dpr !== this.dpr) {
      this.gl.setPixelRatio(dpr);
      this.gl.setSize(w, h, false);
      [this.w, this.h, this.dpr] = [w, h, dpr];
    }
  }

  // Distance from the camera to the point it looks at, for a zoom level.
  distanceFor(zoom, h = this.h || 800) {
    return (zoom * h) / (2 * Math.tan((FOV * Math.PI) / 360));
  }

  sync(viewport) {
    const w = viewport.width, h = viewport.height;
    const cam = this.camera;
    cam.aspect = w / h;
    const D = this.distanceFor(viewport.zoom, h);
    const target = viewport.getViewPoint();
    const a = viewport.angle;
    const fx = -Math.sin(a), fy = -Math.cos(a); // the world direction that is "up" on screen
    cam.position.set(target.x - fx * D * Math.cos(PITCH), this.targetY + D * Math.sin(PITCH), target.y - fy * D * Math.cos(PITCH));
    cam.up.set(0, 1, 0);
    cam.lookAt(target.x, this.targetY, target.y);
    cam.near = Math.max(1, D * 0.05);
    cam.far = D * 8;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.D = D;
    this.vw = w;
    this.vh = h;
  }

  ray(screen) {
    const ndc = new THREE.Vector2((screen.x / this.vw) * 2 - 1, -(screen.y / this.vh) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray;
  }

  // Where a screen point's ray meets the level plane y (or the far distance
  // when it points above the horizon).
  groundPoint(screen, y = this.targetY) {
    const r = this.ray(screen);
    const dy = r.direction.y;
    let t = dy < -1e-4 ? (y - r.origin.y) / dy : this.D * 4;
    t = Math.min(t, this.D * 6);
    return new Point(r.origin.x + r.direction.x * t, r.origin.z + r.direction.z * t);
  }

  toScreen(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    return new Point((v.x + 1) * 0.5 * this.vw, (1 - v.y) * 0.5 * this.vh);
  }

  // A projector for Viewport: screen ↔ world through this camera.
  projector(viewport) {
    return {
      toWorld: (screen) => {
        this.sync(viewport);
        return this.groundPoint(screen);
      },
      toScreen: (p) => {
        this.sync(viewport);
        return this.toScreen(p.x, p.h ?? this.targetY, p.y) || new Point(-9999, -9999);
      },
    };
  }

  // Phones that can't keep up lose shadows (checked over ~3 seconds).
  trackFrame(ms) {
    const f = this.frameTimes;
    f.push(ms);
    if (f.length < 180) return;
    const avg = f.reduce((s, x) => s + x, 0) / f.length;
    f.length = 0;
    if (this.shadows && avg > 34) {
      this.shadows = false;
      this.gl.shadowMap.enabled = false;
      this.onQuality?.("Shadows off to keep things smooth");
    }
  }
}

// A color washed toward white, for the ground under a lens.
const paleCache = new Map();
function pale(hex) {
  if (!paleCache.has(hex)) paleCache.set(hex, "#" + new THREE.Color(hex).lerp(new THREE.Color("#ffffff"), 0.6).getHexString());
  return paleCache.get(hex);
}

// ---- lighting through the day ----------------------------------------------------
const SKY = {
  day: new THREE.Color("#a7d8f5"), dusk: new THREE.Color("#f2b48a"), night: new THREE.Color("#16213e"),
};
function lighting(hour) {
  // sun height: 0 at 6:00 and 20:00, 1 at 13:00
  const day = clamp(Math.sin(((hour - 6) / 14) * Math.PI), -1, 1);
  const night = clamp(-day * 3 + 0.15, 0, 1);
  const dusk = clamp(1 - Math.abs(day) * 4, 0, 1) * (hour > 4 && hour < 22 ? 1 : 0);
  const sky = SKY.day.clone().lerp(SKY.dusk, dusk * 0.8).lerp(SKY.night, night);
  const az = ((hour - 6) / 14) * Math.PI; // east to west
  return { day: Math.max(0, day), night, dusk, sky, az };
}

// ---- the 3D town ---------------------------------------------------------------
export class LowPolyRenderer {
  constructor(city, stage, viewport, opts = {}) {
    this.is3d = true;
    this.city = city;
    this.stage = stage;
    this.viewport = viewport;
    this.opts = opts; // { dayNight: () => bool, lens: () => string }
    this.version = -1;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xa7d8f5, 4000, 12000);

    this.hemi = new THREE.HemisphereLight(0xdff1ff, 0x5d7a3a, 1.3);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
    this.sun.castShadow = true;
    const size = stage.mobile ? 1024 : 2048;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 1.5;
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.glowMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0xffc46b, emissiveIntensity: 0 });
    this.slabMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    this.lensMats = new Map();
    this.blinkMats = new Map();

    this.ground = new Ground(city.terrain, city.seed);
    this.scene.add(this.ground.group);
    if (!city.terrain.flat) {
      this.water = new Water();
      this.scene.add(this.water.mesh);
    }
    this.roads = new RoadLayer(city, this.ground);
    this.roads.glowMat = this.glowMat;
    this.roads.structMat = this.bodyMat;
    this.scene.add(this.roads.group, this.roads.pendingGroup, this.roads.choiceGroup);
    this.forest = new Forest(city, this.ground);
    this.scene.add(this.forest.group);
    this.traffic = new Traffic(this.ground, city.terrain, this.glowMat);
    this.scene.add(this.traffic.group);
    this.signals = new Signals(this.ground, this.bodyMat);
    this.scene.add(this.signals.group);

    this.lotGroup = new THREE.Group();
    this.scene.add(this.lotGroup);
    this.buildings = new Map(); // lot id → { key, group, top, ... }
    this.markers = [];
    this.overlay = new Overlay();
    this.effects = new THREE.Group();
    this.scene.add(this.effects);
    this.puffs = [];
    this.#makeEffects();
    this.coverage = new THREE.Group();
    this.scene.add(this.coverage);
    this.selection = null;
    this.vp = city.center();
  }

  // ---- shared interface ----------------------------------------------------------
  get borders() {
    if (this.bordersVersion !== this.city.version) {
      const env = this.city.layout.graph.segments.map((s) => new Envelope(s, ROAD_W, 10));
      this._borders = Polygon.union(env.map((e) => e.poly));
      this.bordersVersion = this.city.version;
    }
    return this._borders;
  }

  pickMarker(world, screen) {
    const t = this.overlay.hit(screen);
    if (!t || t.choice != null) return null;
    if (t.junction) return { junction: t.junction };
    return t.incident ? { incident: true, lot: t.lot } : { bubble: true, lot: t.lot };
  }

  choiceAt(world, z, screen) {
    if (screen) {
      const t = this.overlay.hit(screen);
      if (t && t.choice != null) return t.choice;
      world = this.#groundUnder(screen);
    }
    let best = -1, bestD = ROAD_W * 0.8 + 20 * Math.max(1, z * 0.7);
    (this.city.roadChoice || []).forEach((o, i) => {
      const d = new Segment(new Point(o.a.x, o.a.y), new Point(o.b.x, o.b.y)).distanceToPoint(world);
      if (d < bestD) [best, bestD] = [i, d];
    });
    return best;
  }

  // The lot whose building (or ground) is under a screen point.
  lotAt(world, screen) {
    if (screen) {
      this.stage.sync(this.viewport);
      const ray = this.stage.ray(screen);
      this.stage.raycaster.ray.copy(ray);
      const hits = this.stage.raycaster.intersectObjects(this.lotGroup.children, true);
      for (const h of hits) {
        let o = h.object;
        while (o && !o.userData.lot) o = o.parent;
        if (o) return o.userData.lot;
      }
      world = this.#groundUnder(screen);
    }
    return this.city.lots.find((l) => l.poly.containsPoint(world)) || null;
  }

  // Follows a ray down to the actual ground, not just the camera's plane.
  #groundUnder(screen) {
    let y = this.stage.targetY, p = null;
    for (let i = 0; i < 4; i++) {
      p = this.stage.groundPoint(screen, y);
      y = this.ground.landAt(p.x, p.y);
    }
    return p;
  }

  anchor(lot) {
    const b = this.buildings.get(lot.id);
    return { x: lot.center.x, y: lot.center.y, h: (b ? b.base + b.top : 40) + 28 };
  }

  dispose() {
    this.ground.dispose();
    if (this.water) this.water.dispose();
    this.roads.dispose();
    this.forest.dispose();
    this.traffic.dispose();
    this.signals.dispose();
    this.#disposeSlabs();
    for (const b of this.buildings.values()) this.lotGroup.remove(b.group);
    this.buildings.clear();
    for (const m of [this.bodyMat, this.glowMat, this.slabMat, ...this.lensMats.values(), ...this.blinkMats.values()]) m.dispose();
    this.scene.clear();
  }

  // ---- per-frame drawing ------------------------------------------------------------
  draw(ctx, viewport, { placing = false, roadPick = -1, selected = null, cars = [], player = null, floaters = [], now = 0, coverage = null, junctions = [] } = {}) {
    const t0 = performance.now();
    const city = this.city, stage = this.stage;
    this.viewport = viewport;
    stage.resize(viewport.width, viewport.height);
    const target = viewport.getViewPoint();
    this.vp = target;
    // ease the camera's height toward the ground it looks at
    const gy = Math.max(0, this.ground.landAt(target.x, target.y));
    stage.targetY += (gy - stage.targetY) * 0.08;
    stage.sync(viewport);
    const D = stage.D;

    if (city.version !== this.version) this.#rebuild();
    const bounds = this.#footprint();
    this.ground.update(bounds);
    this.forest.update(bounds, this.pending);
    if (this.water) this.water.update(target, D * 7, now / 1000);

    const lens = this.opts.lens?.() || "normal";
    this.#light(now, target, D);
    this.#updateLots(now, placing, selected, coverage, lens, viewport.zoom > 4.5);
    this.#updateCoverage(coverage);
    this.roads.updatePending(city.roadJob, now);
    this.roads.updateChoices(city.roadChoice || [], roadPick, now, !placing);
    this.traffic.update(player ? [...cars, player] : cars, now);
    this.signals.update(junctions);
    this.#updateEffects(now);

    // far out, shadows are too blurry to be worth their cost
    this.sun.castShadow = stage.shadows && viewport.zoom < 5;
    stage.gl.render(this.scene, stage.camera);

    // the 2D overlay on top
    ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
    ctx.clearRect(0, 0, viewport.width, viewport.height);
    const choices = (city.roadChoice || []).map((o) => {
      const mid = new Point((o.a.x + o.b.x) / 2, (o.a.y + o.b.y) / 2);
      return { mid, y: this.ground.landAt(mid.x, mid.y) };
    });
    this.overlay.draw(ctx, {
      width: viewport.width, height: viewport.height, city, markers: this.markers, z: viewport.zoom, now, lens,
      project: (x, h, y) => stage.toScreen(x, h, y), choices, roadPick, floaters,
      showChoices: choices.length > 0 && !placing, placing, visiting: !!this.opts.readOnly,
      junctions: junctions.map((j) => ({ j, x: j.node.x, y: j.node.y, h: this.ground.landAt(j.node.x, j.node.y) })),
    });
    stage.trackFrame(performance.now() - t0 + 8);
  }

  // World-space bounds of what the camera can see (plus a margin).
  #footprint() {
    const s = this.stage, w = s.vw, h = s.vh;
    const pts = [[0, 0], [w, 0], [0, h], [w, h], [w / 2, 0]].map(([x, y]) => s.groundPoint(new Point(x, y)));
    const b = boundsOf(pts);
    const m = 300;
    return { minX: b.minX - m, minY: b.minY - m, maxX: b.maxX + m, maxY: b.maxY + m };
  }

  #rebuild() {
    this.version = this.city.version;
    const job = this.city.roadJob;
    this.pending = job ? new Segment(new Point(job.a.x, job.a.y), new Point(job.b.x, job.b.y)) : null;
    this.roads.rebuild();
    this.forest.invalidate();
    this.#buildSlabs();
  }

  // ---- light, sky and fog -----------------------------------------------------------
  #light(now, target, D) {
    const date = new Date();
    const hour = this.hour ?? (this.opts.dayNight?.() === false ? 14.5 : date.getHours() + date.getMinutes() / 60);
    const L = lighting(hour);
    const sunUp = Math.max(0.12, L.day);
    this.scene.background = L.sky;
    this.scene.fog.color.copy(L.sky);
    this.scene.fog.near = D * 1.9;
    this.scene.fog.far = D * 5.5;
    this.hemi.intensity = 0.55 + 0.85 * L.day + 0.5 * L.night;
    this.hemi.color.set(L.night > 0.5 ? 0x9fb5ff : 0xdff1ff);
    this.hemi.groundColor.set(L.night > 0.5 ? 0x1e2a3a : 0x5d7a3a);
    this.sun.intensity = L.night > 0.5 ? 0.45 : 0.6 + 1.8 * L.day;
    this.sun.color.set(L.night > 0.5 ? 0x9fb7ff : L.dusk > 0.3 ? 0xffc48a : 0xfff1d6);
    // the sun travels east → west; at night the moon takes over from the south
    const az = L.night > 0.5 ? Math.PI * 0.6 : L.az;
    const dir = new THREE.Vector3(Math.cos(az) * 0.9, sunUp + 0.35, -0.45 - Math.sin(az) * 0.3).normalize();
    const ty = this.stage.targetY;
    this.sun.position.set(target.x + dir.x * D * 2, ty + dir.y * D * 2, target.y + dir.z * D * 2);
    this.sun.target.position.set(target.x, ty, target.y);
    const sc = this.sun.shadow.camera, half = D * 0.9;
    [sc.left, sc.right, sc.top, sc.bottom, sc.near, sc.far] = [-half, half, half, -half, 1, D * 5];
    sc.updateProjectionMatrix();
    this.glowMat.emissiveIntensity = L.night * 0.95 + L.dusk * 0.25;
    this.night = L.night;
  }

  // ---- lot ground slabs ------------------------------------------------------------
  // One merged mesh for every lot's ground (and its border), with colors
  // rewritten in place when a lot changes.
  #buildSlabs() {
    this.#disposeSlabs();
    const lots = this.city.lots;
    const N = 3; // a 3×3 grid per lot, so slabs follow the slope
    const per = N * N * 6 + 4 * 6;
    const pos = new Float32Array(lots.length * per * 3);
    const col = new Float32Array(lots.length * per * 3);
    let o = 0;
    const put = (p, lift) => {
      pos[o++] = p.x;
      pos[o++] = this.ground.landAt(p.x, p.y) + lift;
      pos[o++] = p.y;
    };
    this.slabIndex = new Map();
    lots.forEach((lot, li) => {
      this.slabIndex.set(lot.id, li);
      const [p0, p1, p2, p3] = lot.poly.points;
      const at = (u, v) => lerp2D(lerp2D(p0, p3, u), lerp2D(p1, p2, u), v);
      const tri = (a, b, c, lift) => {
        // keep each triangle facing up
        const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        for (const p of cross < 0 ? [a, b, c] : [a, c, b]) put(p, lift);
      };
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          const a = at(i / N, j / N), b = at((i + 1) / N, j / N), c = at((i + 1) / N, (j + 1) / N), d = at(i / N, (j + 1) / N);
          tri(a, b, c, 1.2);
          tri(a, c, d, 1.2);
        }
      }
      // a raised curb along the edges, slightly darker
      const pts = lot.poly.points, cen = lot.center;
      for (let e = 0; e < 4; e++) {
        const a = pts[e], b = pts[(e + 1) % 4];
        const ai = lerp2D(a, cen, 0.06), bi = lerp2D(b, cen, 0.06);
        tri(a, b, bi, 1.9);
        tri(a, bi, ai, 1.9);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    this.slabs = new THREE.Mesh(g, this.slabMat);
    this.slabs.receiveShadow = true;
    this.slabs.matrixAutoUpdate = false;
    this.slabPer = per;
    this.slabColors = new Map();
    this.scene.add(this.slabs);
  }

  #disposeSlabs() {
    if (!this.slabs) return;
    this.scene.remove(this.slabs);
    this.slabs.geometry.dispose();
    this.slabs = null;
  }

  #paintSlab(lot, fill, edge) {
    const key = fill + edge;
    if (this.slabColors.get(lot.id) === key) return;
    this.slabColors.set(lot.id, key);
    const li = this.slabIndex.get(lot.id);
    if (li == null) return;
    const col = this.slabs.geometry.attributes.color;
    const a = rgb(fill), b = rgb(edge);
    const start = li * this.slabPer, inner = 3 * 3 * 6;
    for (let v = 0; v < this.slabPer; v++) {
      const c = v < inner ? a : b;
      col.setXYZ(start + v, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  }

  // ---- buildings ---------------------------------------------------------------------
  #modelType(lot) {
    if (lot.kind === "res") return "house";
    if (lot.kind === "com") return "shop";
    if (lot.kind === "ind") return "factory";
    if (lot.kind === "svc" || lot.kind === "special") return lot.special;
    return null;
  }

  #frame(lot) {
    const p = lot.poly.points;
    const hw = distance(p[0], p[3]) / 2, hd = distance(p[0], p[1]) / 2;
    const u = normalize(subtract(p[3], p[0]));
    let v = normalize(subtract(p[1], p[0]));
    const road = this.city.layout.graph.segments[lot.segIndex];
    const c = lot.center;
    if (road && road.distanceToPoint(add(c, scale(v, hd))) > road.distanceToPoint(add(c, scale(v, -hd)))) v = scale(v, -1);
    // Three wants a right-handed frame: X = up × Z, which is ±u.
    const Z = new THREE.Vector3(v.x, 0, v.y), Y = new THREE.Vector3(0, 1, 0);
    const X = new THREE.Vector3().crossVectors(Y, Z);
    const base = Math.min(...p.map((q) => this.ground.landAt(q.x, q.y)), this.ground.landAt(c.x, c.y)) + 1;
    return { hw, hd, basis: new THREE.Matrix4().makeBasis(X, Y, Z), base };
  }

  #addModel(group, m) {
    if (!m) return;
    if (m.body) {
      const mesh = new THREE.Mesh(m.body, this.bodyMat);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData.body = true;
      group.add(mesh);
    }
    if (m.glow) {
      const mesh = new THREE.Mesh(m.glow, this.glowMat);
      mesh.userData.glow = true;
      group.add(mesh);
    }
    for (const part of m.parts) {
      const pivot = new THREE.Group();
      const [x, y, h] = part.pivot;
      pivot.position.set(x, h, y);
      pivot.userData.spin = part;
      for (const geo of [part.body, part.glow]) {
        if (!geo) continue;
        const mesh = new THREE.Mesh(geo, geo === part.glow ? this.glowMat : this.bodyMat);
        mesh.position.set(-x, -h, -y);
        mesh.castShadow = true;
        mesh.userData.body = geo === part.body;
        pivot.add(mesh);
      }
      group.add(pivot);
    }
    for (const b of m.blinkers) {
      const mesh = new THREE.Mesh(this.blinkGeo || (this.blinkGeo = new THREE.IcosahedronGeometry(1, 0)), this.#blinkMat(b.colors[0]));
      mesh.position.set(b.x, b.h, b.y);
      mesh.scale.setScalar(b.r);
      mesh.userData.blink = b;
      group.add(mesh);
    }
  }

  #blinkMat(color) {
    let m = this.blinkMats.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color, toneMapped: false });
      this.blinkMats.set(color, m);
    }
    return m;
  }

  #lensMat(color) {
    let m = this.lensMats.get(color);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color, flatShading: true });
      this.lensMats.set(color, m);
    }
    return m;
  }

  #syncBuilding(lot, now, lens) {
    const type = this.#modelType(lot);
    const lvl = Math.max(1, lot.effectiveLevel);
    const showModel = type && lot.effectiveLevel >= 1;
    const building = lot.building > 0;
    const key = (showModel ? type + lvl : "") + (building ? "+b" + lot.level : "");
    let b = this.buildings.get(lot.id);
    if (b && b.key === key) return b;
    const isNew = !b;
    if (b) this.lotGroup.remove(b.group);
    if (!key) {
      this.buildings.delete(lot.id);
      return null;
    }
    const f = this.#frame(lot);
    const variant = hashInts(lot.id, 4441);
    const group = new THREE.Group();
    const models = [];
    if (showModel && !(building && lot.level <= 1)) models.push(buildModel(type, type === "house" || type === "shop" || type === "factory" || lot.kind === "svc" ? lvl : 1, f.hw, f.hd, variant, lot.id));
    if (building) models.push(buildModel("construction", Math.max(1, lot.level), f.hw, f.hd, variant, lot.id));
    for (const m of models) this.#addModel(group, m);
    group.position.set(lot.center.x, f.base, lot.center.y);
    group.quaternion.setFromRotationMatrix(f.basis);
    group.userData.lot = lot;
    this.lotGroup.add(group);
    const top = Math.max(30, ...models.filter(Boolean).map((m) => m.top));
    const smoke = models.filter(Boolean).flatMap((m) => m.smoke.map((s) => new THREE.Vector3(s.x, s.h, s.y)));
    const prevTotal = b?.buildTotal || 0;
    b = { key, group, top, base: f.base, smoke, lens: null, buildTotal: building ? Math.max(prevTotal, lot.building) : 0 };
    // a new or upgraded building pops up with a bounce (not on first load)
    if (!isNew || this.loaded) {
      group.userData.pop = now;
      this.#dust(lot.center, f.base, now);
    }
    this.buildings.set(lot.id, b);
    return b;
  }

  // `far`: zoomed out, so windows and blinking lights are skipped.
  #updateLots(now, placing, selected, coverage, lens, far) {
    const city = this.city;
    const t = now / 1000;
    const pulse = 0.5 + 0.5 * Math.sin(now / 200);
    const stations = coverage ? city.stations(coverage) : null;
    const tier = city.tierReached;
    this.markers = [];
    const seen = new Set();
    for (const lot of city.lots) {
      seen.add(lot.id);
      const b = this.#syncBuilding(lot, now, lens);
      // ground color
      let fill, edge;
      const type = this.#modelType(lot);
      if (lot.building > 0) [fill, edge] = ["#b08b5a", "#8a6a40"];
      else if (!lot.kind) [fill, edge] = ["#a8d98a", "#e9f5df"];
      else [fill, edge] = [FLOORS[type] || "#cfc8b8", "#e7e2d6"];
      // lenses: a pale wash of the color on the ground, full color on the building
      if (lens === "zones" && lot.kind) [fill, edge] = [pale(ZONE_COLORS[lot.kind]), ZONE_COLORS[lot.kind]];
      if (lens === "levels" && ["res", "com", "ind", "svc"].includes(lot.kind)) {
        const c = LEVEL_COLORS[Math.max(1, lot.effectiveLevel)];
        [fill, edge] = [pale(c), c];
      }
      if (stations && ["res", "com", "ind"].includes(lot.kind) && !stations.some((st) => City.covers(st, lot))) fill = edge = "#f87171";
      if (placing && (!lot.kind || (placing !== "empty" && lot.kind !== "special" && lot.kind !== "svc"))) {
        edge = pulse > 0.5 ? "#facc15" : "#fde68a";
        if (!lot.kind) fill = pulse > 0.5 ? "#fde047" : "#fef08a";
      }
      if (selected === lot) edge = "#facc15";
      if (lot.incident && lot.incident.type === "police") edge = Math.sin(t * Math.PI * 4) > 0 ? "#ef4444" : "#3b82f6";
      this.#paintSlab(lot, fill, edge);
      if (!b) continue;
      // building tint for the lenses
      const tint = lens === "zones" ? ZONE_COLORS[lot.kind] : lens === "levels" && ["res", "com", "ind", "svc"].includes(lot.kind) ? LEVEL_COLORS[Math.max(1, lot.effectiveLevel)] : null;
      if (b.lens !== tint || b.far !== far) {
        b.lens = tint;
        b.far = far;
        b.group.traverse((o) => {
          if (o.userData.body) o.material = tint ? this.#lensMat(tint) : this.bodyMat;
          if (o.userData.glow) o.visible = !tint && !far;
          if (o.userData.blink) o.visible = !far;
        });
      }
      // animation: spinning parts, blinkers, the pop-up bounce
      b.group.traverse((o) => {
        const s = o.userData.spin;
        if (s) {
          if (s.axis === "y") o.rotation.y = t * s.speed;
          else o.rotation.z = t * s.speed;
        }
        const bl = o.userData.blink;
        if (bl) o.material = this.#blinkMat(Math.sin((t + bl.phase) * Math.PI * 2 * bl.rate) > 0 ? bl.colors[0] : bl.colors[1]);
      });
      const pop = b.group.userData.pop;
      if (pop != null) {
        const p = (now - pop) / 550;
        if (p >= 1) {
          b.group.scale.set(1, 1, 1);
          b.group.userData.pop = null;
        } else {
          const back = 1 + 2.4 * Math.pow(p - 1, 3) + 1.4 * Math.pow(p - 1, 2); // ease-out-back
          b.group.scale.set(1 + (1 - back) * 0.25, Math.max(0.05, back), 1 + (1 - back) * 0.25);
        }
      }
      if (lot.building > 0) b.buildTotal = Math.max(b.buildTotal || 0, lot.building);
      let up = null;
      if (!this.opts.readOnly && lot.building <= 0) up = lot.kind === "svc" ? city.stationUpgradeInfo(lot) : city.upgradeInfo(lot);
      this.markers.push({
        lot, x: lot.center.x, y: lot.center.y, top: b.base + b.top,
        ready: !this.opts.readOnly && city.bagReady(lot),
        upgrade: !!(up && up.ok),
        blocked: !!(up && !up.ok && up.needPop && city.pop < up.needPop),
        buildTotal: b.buildTotal,
      });
    }
    // markers for lots under construction with nothing on them yet are covered
    // above; drop buildings whose lots are gone (a different town state)
    for (const [id, b] of this.buildings) {
      if (seen.has(id)) continue;
      this.lotGroup.remove(b.group);
      this.buildings.delete(id);
    }
    this.loaded = true;
    // fires: flames and smoke on burning lots
    this.burning = city.incidents ? city.incidents.filter((inc) => inc.type === "fire") : [];
  }

  // ---- fire & police coverage -----------------------------------------------------
  #updateCoverage(kind) {
    const stations = kind ? this.city.stations(kind) : [];
    const key = kind ? kind + stations.map((s) => s.id + ":" + City.reach(s)).join(",") : "";
    if (key === this.coverageKey) return;
    this.coverageKey = key;
    for (const m of [...this.coverage.children]) {
      this.coverage.remove(m);
      m.geometry.dispose();
    }
    if (!kind) return;
    const color = kind === "fire" ? 0xef4444 : 0x3b82f6;
    this.coverMat = this.coverMat || new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.14, depthWrite: false });
    this.coverEdge = this.coverEdge || new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.75, depthWrite: false });
    this.coverMat.color.set(color);
    this.coverEdge.color.set(color);
    for (const st of stations) {
      const y = elevation(ROCK) + 4, r = City.reach(st);
      const disc = new THREE.CircleGeometry(r, 48).rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(disc, this.coverMat);
      m.position.set(st.center.x, y, st.center.y);
      m.renderOrder = 4;
      const edge = new THREE.Mesh(new THREE.RingGeometry(r - 14, r, 64).rotateX(-Math.PI / 2), this.coverEdge);
      edge.position.copy(m.position);
      edge.renderOrder = 4;
      this.coverage.add(m, edge);
    }
  }

  // ---- particles: smoke, flames, dust ----------------------------------------------
  #makeEffects() {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    this.smokeMat = new THREE.MeshLambertMaterial({ color: 0xe5e7eb, transparent: true, opacity: 0.6, flatShading: true, depthWrite: false });
    this.flameMat = new THREE.MeshBasicMaterial({ color: 0xfb923c, transparent: true, opacity: 0.92, depthWrite: false, toneMapped: false });
    this.ashMat = new THREE.MeshLambertMaterial({ color: 0x3f3f46, transparent: true, opacity: 0.7, flatShading: true, depthWrite: false });
    this.dustMat = new THREE.MeshLambertMaterial({ color: 0xd6c4a0, transparent: true, opacity: 0.7, flatShading: true, depthWrite: false });
    this.smoke = new THREE.InstancedMesh(geo, this.smokeMat, 400);
    this.flames = new THREE.InstancedMesh(geo, this.flameMat, 200);
    this.ash = new THREE.InstancedMesh(geo, this.ashMat, 200);
    for (const m of [this.smoke, this.flames, this.ash]) {
      m.frustumCulled = false;
      m.count = 0;
      this.effects.add(m);
    }
    this.dustGeo = geo;
  }

  #dust(c, base, now) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const m = new THREE.Mesh(this.dustGeo, this.dustMat);
      m.position.set(c.x + Math.cos(a) * 30, base + 6, c.y + Math.sin(a) * 30);
      m.userData = { born: now, dir: new THREE.Vector3(Math.cos(a), 0.4, Math.sin(a)) };
      this.effects.add(m);
      this.puffs.push(m);
    }
  }

  #updateEffects(now) {
    const t = now / 1000;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    // chimney smoke
    let n = 0;
    for (const b of this.buildings.values()) {
      if (!b.smoke.length || !b.group.visible) continue;
      b.group.updateMatrixWorld();
      b.smoke.forEach((e, i) => {
        for (let k = 0; k < 4 && n < 400; k++) {
          const ph = (t * 0.3 + k / 4 + i * 0.37 + b.group.id * 0.13) % 1;
          p.copy(e).applyMatrix4(b.group.matrixWorld);
          p.x += ph * 26;
          p.y += ph * 60;
          p.z -= ph * 8;
          s.setScalar((5 + ph * 13) * Math.sin(Math.PI * Math.min(1, ph * 1.2 + 0.1)));
          this.smoke.setMatrixAt(n++, m4.compose(p, q, s));
        }
      });
    }
    this.smoke.count = n;
    this.smoke.instanceMatrix.needsUpdate = true;
    // fires
    let nf = 0, na = 0;
    for (const inc of this.burning || []) {
      const b = this.buildings.get(inc.lot.id);
      const c = inc.lot.center, base = b ? b.base : 0, top = b ? b.top : 40;
      for (let k = 0; k < 14; k++) {
        const ph = (t * 0.8 + k / 14 + inc.lot.id * 0.17) % 1;
        const jx = Math.sin(k * 2.1 + inc.lot.id) * 26, jy = Math.cos(k * 1.7) * 20;
        p.set(c.x + jx * (1 - ph * 0.5), base + top * 0.3 + ph * (top * 0.8 + 50), c.y + jy * (1 - ph * 0.5));
        if (ph < 0.5 && nf < 200) {
          s.set(1, 1.6, 1).multiplyScalar(26 - ph * 34);
          this.flames.setMatrixAt(nf++, m4.compose(p, q, s));
        } else if (na < 200) {
          p.y += 20;
          s.setScalar(10 + ph * 22);
          this.ash.setMatrixAt(na++, m4.compose(p, q, s));
        }
      }
    }
    this.flames.count = nf;
    this.ash.count = na;
    this.flames.instanceMatrix.needsUpdate = true;
    this.ash.instanceMatrix.needsUpdate = true;
    this.flameMat.color.setHSL(0.06 + 0.035 * Math.sin(t * 20), 1, 0.55);
    // dust puffs from new buildings
    this.puffs = this.puffs.filter((m) => {
      const age = (now - m.userData.born) / 800;
      if (age >= 1) {
        this.effects.remove(m);
        return false;
      }
      m.position.addScaledVector(m.userData.dir, 1.2);
      m.scale.setScalar(6 + age * 16);
      return true;
    });
    this.dustMat.opacity = this.puffs.length ? 0.6 : 0;
  }
}

export { LENSES };
