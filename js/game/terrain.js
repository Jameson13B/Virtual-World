// ---------------------------------------------------------------------------
// Terrain: the land a town grows on – oceans, rivers, lakes, hills, mountains.
//
// Each map type is a height function of (x, y), shaped by the town's seed, so
// two Beach towns get different coastlines. Like the road layout, it only uses
// + - * /, sqrt and floor (no sin/cos), so roads and lots land in exactly the
// same places on every phone and in shared towns.
//
//   height < 0              water (deeper the lower)
//   0 ≤ height < SHORE      beach or river bank
//   SHORE ≤ height < ROCK   grass and hills: buildable
//   height ≥ ROCK           bare rock, snow above SNOW: not buildable
// ---------------------------------------------------------------------------

const SHORE = 0.05;
const ROCK = 0.62;
const SNOW = 0.84;
const CROSS_MAX = 600; // longest stretch of water or rock a road can bridge or cut through

// `sea`: sandy beaches instead of grassy banks. "classic" is the flat forest
// every town had before map types; old saves keep it, so it isn't offered.
const MAP_TYPES = {
  classic: { icon: "🌲", name: "Forest", about: "Endless flat forest.", hidden: true },
  forest: { icon: "🌲", name: "Woodland", about: "Rolling green hills, deep forest and a few quiet ponds." },
  beach: { icon: "🏖️", name: "Beach", about: "Sandy shores on the open ocean, with islands offshore.", sea: true },
  river: { icon: "🏞️", name: "Grand River", about: "A wide river winds through the valley. Bridge it to grow." },
  mountains: { icon: "⛰️", name: "Mountains", about: "A green valley between snowy peaks and alpine lakes." },
  bay: { icon: "🌊", name: "Great Bay", about: "A sheltered bay opening to the sea, with headlands to build on.", sea: true },
  lakes: { icon: "🛶", name: "Lake Country", about: "Lakes and ponds everywhere, linked by narrow straits." },
  islands: { icon: "🏝️", name: "Islands", about: "Islands split by winding channels – every road out is a bridge.", sea: true },
};
const MAP_IDS = Object.keys(MAP_TYPES).filter((id) => !MAP_TYPES[id].hidden);

// ---- deterministic noise ---------------------------------------------------
function latticeValue(ix, iy, salt) {
  return hashInts(salt, ix, iy) / 4294967296;
}

// Smooth value noise in [0, 1] with features about 1 unit apart.
function valueNoise(x, y, salt) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = latticeValue(ix, iy, salt), b = latticeValue(ix + 1, iy, salt);
  const c = latticeValue(ix, iy + 1, salt), d = latticeValue(ix + 1, iy + 1, salt);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// A few octaves of value noise, still in [0, 1] (mostly 0.25–0.75).
function fbm(x, y, salt, octaves = 4) {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * f + i * 17.31, y * f - i * 9.17, salt + i * 101);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// A random unit vector from the rng, using only sqrt.
function randomDir(rng) {
  for (;;) {
    const x = rng() * 2 - 1, y = rng() * 2 - 1, m2 = x * x + y * y;
    if (m2 > 0.05 && m2 <= 1) {
      const m = Math.sqrt(m2);
      return { x: x / m, y: y / m };
    }
  }
}

// ---- map types ---------------------------------------------------------------
// Each one turns `landness` s (roughly world units from the nearest water,
// negative in the water) and some hills into a height.
function shoreHeight(s, hills, beachWidth, depth = 900) {
  if (s < 0) return s / depth;
  return Math.min((s * SHORE) / beachWidth, SHORE + hills);
}

const TERRAIN_SHAPES = {
  forest: {
    setup: (rng) => ({ salt: (rng() * 1e9) | 0 }),
    height(x, y, p) {
      const hills = 0.04 + 0.5 * fbm(x / 2800, y / 2800, p.salt) * fbm(x / 6000, y / 6000, p.salt + 7, 2);
      const pond = (fbm(x / 800, y / 800, p.salt + 13, 3) - 0.69) * -2600;
      return shoreHeight(pond, hills, 50, 700);
    },
  },

  lakes: {
    setup: (rng) => ({ salt: (rng() * 1e9) | 0 }),
    height(x, y, p) {
      const hills = 0.05 + 0.3 * fbm(x / 3000, y / 3000, p.salt);
      const lake = (fbm(x / 2300, y / 2300, p.salt + 13) - 0.56) * -5000;
      const pond = (fbm(x / 700, y / 700, p.salt + 29, 3) - 0.7) * -2200;
      return shoreHeight(Math.min(lake, pond), hills, 60, 900);
    },
  },

  beach: {
    setup: (rng) => ({ salt: (rng() * 1e9) | 0, d: randomDir(rng), coast: 900 + rng() * 500 }),
    height(x, y, p) {
      const along = -x * p.d.y + y * p.d.x, across = x * p.d.x + y * p.d.y;
      const coast = p.coast + 2400 * (fbm(along / 2600, 0.5, p.salt, 3) - 0.5) + 300 * (fbm(x / 700, y / 700, p.salt + 3, 3) - 0.5);
      let s = coast - across;
      // offshore islands
      if (s < 0) s = Math.max(s, (fbm(x / 1500, y / 1500, p.salt + 11, 3) - 0.71) * 5000);
      const hills = 0.06 + 0.35 * fbm(x / 3000, y / 3000, p.salt + 5) * smooth01((s - 300) / 2500);
      return shoreHeight(s, hills, 220, 1100);
    },
  },

  river: {
    setup(rng) {
      const d = randomDir(rng);
      const side = rng() < 0.5 ? -1 : 1;
      const p = { salt: (rng() * 1e9) | 0, d, offset: side * (700 + rng() * 300), side, trib: rng() < 0.6 };
      p.at0 = fbm(0, 0.5, p.salt, 3);
      // The tributary joins from the far bank, somewhere up or down stream.
      const t0 = (rng() < 0.5 ? -1 : 1) * (1600 + rng() * 1800), bend = (rng() - 0.5) * 1.6;
      p.t0 = t0;
      p.td = { x: d.x + -d.y * side * (1 + bend), y: d.y + d.x * side * (1 + bend) };
      const m = Math.sqrt(p.td.x * p.td.x + p.td.y * p.td.y);
      p.td = { x: p.td.x / m, y: p.td.y / m };
      return p;
    },
    center(along, p) {
      return p.offset + 1500 * (fbm(along / 3400, 0.5, p.salt, 3) - p.at0);
    },
    height(x, y, p) {
      const d = p.d;
      const along = -x * d.y + y * d.x, across = x * d.x + y * d.y;
      const c = this.center(along, p);
      const width = 330 + 300 * fbm(along / 2200, 3.5, p.salt + 2, 2);
      let s = (across - c < 0 ? c - across : across - c) - width / 2;
      if (p.trib && (across - c) * p.side > 0) {
        // a smaller river on the far side, flowing into the big one
        const ox = d.x * this.center(p.t0, p) - d.y * p.t0, oy = d.y * this.center(p.t0, p) + d.x * p.t0;
        const rx = x - ox, ry = y - oy;
        const ta = -rx * p.td.y + ry * p.td.x, tc = rx * p.td.x + ry * p.td.y;
        const tw = 170 + 90 * fbm(ta / 1500, 7.5, p.salt + 4, 2);
        const tcen = 700 * (fbm(ta / 2600, 9.5, p.salt + 6, 3) - fbm(0, 9.5, p.salt + 6, 3));
        s = Math.min(s, (tc - tcen < 0 ? tcen - tc : tc - tcen) - tw / 2);
      }
      // Valley sides rise gently away from the water.
      const hills = 0.05 + (0.15 + 0.35 * fbm(x / 2600, y / 2600, p.salt + 8)) * smooth01(s / 3500);
      return shoreHeight(s, hills, 70, 700);
    },
  },

  mountains: {
    setup: (rng) => ({ salt: (rng() * 1e9) | 0, valley: 650 + rng() * 300 }),
    height(x, y, p) {
      const r = Math.sqrt(x * x + y * y);
      const n = fbm(x / 3600, y / 3600, p.salt, 3);
      const ridge = 1 - (n < 0.5 ? 0.5 - n : n - 0.5) * 2; // 1 along the ridge lines
      const mask = smooth01((r - p.valley) / 2200);
      const range = fbm(x / 7000, y / 7000, p.salt + 3, 2);
      const r3 = ridge * ridge * ridge;
      let h = 0.1 + 0.12 * fbm(x / 1400, y / 1400, p.salt + 5, 3) + mask * (r3 * r3 * (0.5 + 1.1 * range) + 0.35 * (range - 0.35));
      // alpine lakes in the low ground
      if (h < 0.4) {
        const lake = (fbm(x / 1000, y / 1000, p.salt + 9, 3) - 0.68) * -2400;
        h = Math.min(h, shoreHeight(lake, h - SHORE, 50, 800));
      }
      return h;
    },
  },

  bay: {
    setup(rng) {
      const d = randomDir(rng);
      const R = 1500 + rng() * 600;
      const dist = R + 600 + rng() * 250;
      return {
        salt: (rng() * 1e9) | 0, d, R, dist,
        mouth: R * (0.6 + rng() * 0.25),
        island: rng() < 0.7 ? { r: R * (0.2 + rng() * 0.1), at: (rng() - 0.5) * R * 0.8 } : null,
      };
    },
    height(x, y, p) {
      const d = p.d;
      const along = -x * d.y + y * d.x, across = x * d.x + y * d.y;
      const bx = across - p.dist, by = along;
      const wobble = fbm(x / 1600, y / 1600, p.salt, 3) - 0.5;
      const bay = p.R * (1 + 0.35 * wobble) - Math.sqrt(bx * bx + by * by);
      const mouth = Math.min(p.mouth * (1 + 0.6 * wobble) - (by < 0 ? -by : by), bx);
      const sea = across - (p.dist + p.R * 0.75) + 1600 * (fbm(along / 3000, 1.5, p.salt + 3, 3) - 0.5);
      let s = -Math.max(bay, mouth, sea);
      if (p.island) {
        const ix = bx - p.island.at * 0.3, iy = by - p.island.at;
        s = Math.max(s, p.island.r * (1 + 0.5 * wobble) - Math.sqrt(ix * ix + iy * iy));
      }
      const hills = 0.06 + 0.4 * fbm(x / 2600, y / 2600, p.salt + 5) * smooth01((s - 200) / 2200);
      return shoreHeight(s, hills, 200, 1000);
    },
  },

  islands: {
    setup: (rng) => ({ salt: (rng() * 1e9) | 0 }),
    height(x, y, p) {
      // Channels follow the mid contour of two noise fields, so they wind around
      // and meet each other, cutting the land into islands.
      const a = fbm(x / 3200, y / 3200, p.salt, 2), b = fbm(x / 2400, y / 2400, p.salt + 50, 2);
      const ca = (a < 0.5 ? 0.5 - a : a - 0.5) * 9000 - 140;
      const cb = (b < 0.5 ? 0.5 - b : b - 0.5) * 7000 - 110;
      // and a few open lagoons
      const lagoon = (fbm(x / 1800, y / 1800, p.salt + 70, 2) - 0.7) * -5000;
      const s = Math.min(ca, cb, lagoon);
      const hills = 0.05 + 0.3 * fbm(x / 1500, y / 1500, p.salt + 5, 3) * smooth01((s - 150) / 1200);
      return shoreHeight(s, hills, 80, 600);
    },
  },
};

// Points within the founding road's reach, which must all be buildable.
const START_AREA = [];
for (let x = -480; x <= 480; x += 80) {
  for (let y = -480; y <= 480; y += 80) if (x * x + y * y <= 480 * 480) START_AREA.push({ x, y });
}

class Terrain {
  constructor(type, seed) {
    this.type = MAP_TYPES[type] ? type : "classic";
    this.info = MAP_TYPES[this.type];
    this.seed = seed;
    this.shape = TERRAIN_SHAPES[this.type] || null;
    this.flat = !this.shape;
    if (this.flat) return;
    // Re-roll the features until the middle of the map is dry, flat-ish land.
    for (let attempt = 0; attempt < 40; attempt++) {
      this.params = this.shape.setup(createRNG(hashInts(seed, 4242, attempt)));
      if (START_AREA.every((p) => this.#raw(p.x, p.y) >= SHORE && this.#raw(p.x, p.y) < ROCK * 0.8)) break;
    }
  }

  #raw(x, y) {
    return this.shape.height(x, y, this.params);
  }

  height(x, y) {
    if (this.flat) return 0.12;
    const h = this.#raw(x, y);
    // Fallback guard: the start area is always land, even if no attempt fit.
    const r2 = x * x + y * y;
    if (r2 > 700 * 700) return h;
    const safe = clamp(h, SHORE, ROCK * 0.8);
    return safe + (h - safe) * smooth01((Math.sqrt(r2) - 520) / 180);
  }

  buildable(x, y) {
    if (this.flat) return true;
    const h = this.height(x, y);
    return h >= 0 && h < ROCK;
  }

  isWater(x, y) {
    return !this.flat && this.height(x, y) < 0;
  }

  // Whether a road from a to b stays on land, apart from at most CROSS_MAX of
  // water (a bridge) or rock (a mountain pass) in total.
  roadFits(a, b) {
    if (this.flat) return true;
    if (!this.buildable(a.x, a.y) || !this.buildable(b.x, b.y)) return false;
    const len = distance(a, b);
    const n = Math.max(2, Math.ceil(len / 25));
    let blocked = 0;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (!this.buildable(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) blocked += len / n;
    }
    return blocked <= CROSS_MAX;
  }

  // Whether a building lot (a 4-point polygon) sits on buildable land.
  lotFits(poly) {
    if (this.flat) return true;
    const pts = poly.points;
    const c = average(average(pts[0], pts[1]), average(pts[2], pts[3]));
    if (!this.buildable(c.x, c.y)) return false;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      if (!this.buildable(p.x, p.y) || !this.buildable((p.x + q.x) / 2, (p.y + q.y) / 2)) return false;
    }
    return true;
  }

  // Stretches of a road that run over water, as [t0, t1] fractions (for bridges).
  waterSpans(a, b) {
    if (this.flat) return [];
    const n = Math.max(2, Math.ceil(distance(a, b) / 20));
    const spans = [];
    let start = -1;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const wet = this.isWater(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      if (wet && start < 0) start = t;
      if (!wet && start >= 0) {
        spans.push([Math.max(0, start - 0.5 / n), t - 0.5 / n]);
        start = -1;
      }
    }
    if (start >= 0) spans.push([start, 1]);
    return spans;
  }

  // Whether a wild tree can grow here.
  treeFits(x, y) {
    if (this.flat) return true;
    const h = this.height(x, y);
    return h > SHORE * 1.4 && h < ROCK + 0.06;
  }
}

// ---- painting ----------------------------------------------------------------
const TERRAIN_COLORS = {
  shallow: [96, 190, 214], deep: [28, 92, 150], foam: [196, 232, 238],
  wetSand: [204, 184, 128], sand: [236, 220, 166],
  bank: [92, 128, 70], grass: [63, 143, 58], hill: [56, 120, 50], alpine: [112, 126, 82],
  rock: [122, 114, 102], rockHigh: [156, 150, 140], snow: [242, 246, 250],
};

function mixColor(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function terrainColor(h, sea) {
  const C = TERRAIN_COLORS;
  if (h < 0) {
    const d = -h;
    if (d < 0.012) return mixColor(C.foam, C.shallow, d / 0.012);
    return mixColor(C.shallow, C.deep, smooth01(d / 0.4));
  }
  if (h < SHORE) return sea ? mixColor(C.wetSand, C.sand, h / SHORE) : mixColor(C.bank, C.grass, h / SHORE);
  if (h < 0.12) return sea ? mixColor(C.sand, C.grass, smooth01((h - SHORE) / 0.025)) : C.grass;
  if (h < 0.45) return mixColor(C.grass, C.hill, (h - 0.12) / 0.33);
  if (h < ROCK) return mixColor(C.hill, C.alpine, (h - 0.45) / (ROCK - 0.45));
  if (h < SNOW - 0.04) return mixColor(C.rock, C.rockHigh, (h - ROCK) / (SNOW - 0.04 - ROCK));
  return mixColor(C.rockHigh, C.snow, smooth01((h - SNOW + 0.04) / 0.06));
}

// Paints a w×h picture of the terrain into an ImageData, pixel (i, j) showing
// world point (x0 + (i + 0.5) * upp, y0 + (j + 0.5) * upp). Heights are
// sampled on a grid every `step` pixels and interpolated in between, and the
// land is lit from the top left so hills and peaks stand out.
function paintTerrain(terrain, image, x0, y0, upp, step = 2) {
  const { width: w, height: h, data } = image;
  const gw = Math.ceil(w / step) + 3, gh = Math.ceil(h / step) + 3;
  const g = new Float32Array(gw * gh);
  const gs = upp * step;
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) g[j * gw + i] = terrain.height(x0 + (i - 1) * gs, y0 + (j - 1) * gs);
  }
  const at = (gx, gy) => {
    const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
    const k = iy * gw + ix;
    const a = g[k], b = g[k + 1], c = g[k + gw], d = g[k + gw + 1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const sea = !!terrain.info.sea;
  const relief = 1500 / (2 * gs); // height units → world units, per grid step
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const gx = 1 + (i + 0.5) / step, gy = 1 + (j + 0.5) / step;
      const v = at(gx, gy);
      let col = terrainColor(v, sea);
      if (v < 0.02 && v > -0.02) {
        // Soften the waterline: blend by how much of the pixel is under water.
        const dpp = ((at(gx + 0.5, gy) - at(gx - 0.5, gy)) ** 2 + (at(gx, gy + 0.5) - at(gx, gy - 0.5)) ** 2) ** 0.5 / step;
        const wet = clamp(0.5 - v / (dpp || 1e-9), 0, 1);
        if (wet > 0 && wet < 1) col = mixColor(terrainColor(Math.max(v, 0), sea), terrainColor(Math.min(v, -1e-6), sea), wet);
      }
      if (v >= SHORE) {
        const sx = (at(gx + 0.5, gy) - at(gx - 0.5, gy)) * relief, sy = (at(gx, gy + 0.5) - at(gx, gy - 0.5)) * relief;
        const light = clamp(1 - (sx + sy) * 0.55 * smooth01((v - SHORE) / 0.12), 0.62, 1.32);
        col = [col[0] * light, col[1] * light, col[2] * light];
      }
      const o = (j * w + i) * 4;
      data[o] = col[0];
      data[o + 1] = col[1];
      data[o + 2] = col[2];
      data[o + 3] = 255;
    }
  }
  return image;
}
