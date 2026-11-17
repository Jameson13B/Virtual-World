// ---------------------------------------------------------------------------
// The land as faceted low-poly terrain. Heights come from terrain.js on a
// lattice every GRID units; each cell is two flat-colored triangles. The town
// sits on gentle land (roads drape over it), while rock rises steeply into
// mountains that roads tunnel through. Water is one flat sheet at y = 0.
//
// heightAt() interpolates exactly like the mesh does, so anything placed on
// the ground (roads, lots, buildings, cars) sits right on its surface.
// ---------------------------------------------------------------------------
import * as THREE from "../../../vendor/three.module.min.js";

export const GRID = 80;
const CHUNK = 32; // cells per chunk side
const CHUNK_W = GRID * CHUNK;
const MAX_CHUNKS = 64;
export const LAND_LIFT = 4; // land height at the waterline
export const DECK_Y = 16; // bridge decks

// Terrain height (about -1…1) → world units up.
export function elevation(h) {
  if (h < 0) return -6 + h * 380;
  if (h < ROCK) return LAND_LIFT + h * 80;
  const r = h - ROCK;
  return LAND_LIFT + ROCK * 80 + r * 1500 + r * r * 1400;
}

export class Ground {
  constructor(terrain, seed) {
    this.terrain = terrain;
    this.seed = seed;
    this.sea = !!terrain.info?.sea;
    this.lattice = new Map(); // "i,j" → [h, y]
    this.chunks = new Map();
    this.group = new THREE.Group();
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  }

  #node(i, j) {
    const key = i * 100003 + j;
    let n = this.lattice.get(key);
    if (!n) {
      const x = i * GRID, y = j * GRID;
      if (this.terrain.flat) {
        // classic maps: flat meadow with a faint low-poly ripple
        const r = hashInts(this.seed, 91, i, j);
        n = [0.12, ((r % 1000) / 1000) * 5];
      } else {
        const h = this.terrain.height(x, y);
        n = [h, elevation(h)];
      }
      if (this.lattice.size > 400000) this.lattice.clear();
      this.lattice.set(key, n);
    }
    return n;
  }

  // Height of the ground mesh at world (x, y).
  heightAt(x, y) {
    const gx = x / GRID, gy = y / GRID;
    const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j;
    const a = this.#node(i, j)[1], b = this.#node(i + 1, j)[1], c = this.#node(i, j + 1)[1], d = this.#node(i + 1, j + 1)[1];
    return fx >= fy ? a + (b - a) * fx + (d - b) * fy : a + (c - a) * fy + (d - c) * fx;
  }

  // Like heightAt, but never below the waterline: for things that stand on
  // land (roads, lots, trees) where the mesh dips toward the water nearby.
  landAt(x, y) {
    return Math.max(this.heightAt(x, y), LAND_LIFT);
  }

  #color(h, i, j) {
    const c = terrainColor(h, this.sea);
    // a touch of per-facet variation sells the low-poly look
    const n = ((hashInts(this.seed, 17, i, j) % 100) / 100 - 0.5) * 0.08 + 1;
    const out = new THREE.Color(Math.min(255, c[0] * n) / 255, Math.min(255, c[1] * n) / 255, Math.min(255, c[2] * n) / 255);
    return out.convertSRGBToLinear();
  }

  #buildChunk(cx, cy) {
    const pos = new Float32Array(CHUNK * CHUNK * 18), col = new Float32Array(CHUNK * CHUNK * 18);
    let o = 0;
    const put = (i, j, n, c) => {
      pos[o] = i * GRID;
      pos[o + 1] = n[1];
      pos[o + 2] = j * GRID;
      col[o] = c.r;
      col[o + 1] = c.g;
      col[o + 2] = c.b;
      o += 3;
    };
    for (let j = cy * CHUNK; j < (cy + 1) * CHUNK; j++) {
      for (let i = cx * CHUNK; i < (cx + 1) * CHUNK; i++) {
        const a = this.#node(i, j), b = this.#node(i + 1, j), c = this.#node(i, j + 1), d = this.#node(i + 1, j + 1);
        // two triangles: (a, d, b) and (a, c, d), counter-clockwise from above
        const c1 = this.#color((a[0] + b[0] + d[0]) / 3, i * 2, j);
        put(i, j, a, c1);
        put(i + 1, j + 1, d, c1);
        put(i + 1, j, b, c1);
        const c2 = this.#color((a[0] + c[0] + d[0]) / 3, i * 2 + 1, j);
        put(i, j, a, c2);
        put(i, j + 1, c, c2);
        put(i + 1, j + 1, d, c2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.material);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }

  // Shows the chunks under the view footprint (world-space bounds), building
  // at most `budget` new ones this frame.
  update(bounds, budget = 2) {
    const x0 = Math.floor(bounds.minX / CHUNK_W), x1 = Math.floor(bounds.maxX / CHUNK_W);
    const y0 = Math.floor(bounds.minY / CHUNK_W), y1 = Math.floor(bounds.maxY / CHUNK_W);
    const want = new Set();
    // nearest chunks first, so the middle of the screen fills in first
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const list = [];
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) list.push([cx, cy, (cx - mx) ** 2 + (cy - my) ** 2]);
    list.sort((a, b) => a[2] - b[2]);
    let pending = false;
    for (const [cx, cy] of list.slice(0, MAX_CHUNKS)) {
      const key = cx + "," + cy;
      want.add(key);
      let mesh = this.chunks.get(key);
      if (!mesh) {
        if (budget <= 0) {
          pending = true;
          continue;
        }
        budget--;
        mesh = this.#buildChunk(cx, cy);
        this.chunks.set(key, mesh);
      }
      if (!mesh.parent) this.group.add(mesh);
    }
    for (const [key, mesh] of this.chunks) {
      if (want.has(key)) continue;
      if (mesh.parent) this.group.remove(mesh);
      if (this.chunks.size > MAX_CHUNKS * 1.5) {
        mesh.geometry.dispose();
        this.chunks.delete(key);
      }
    }
    return pending;
  }

  dispose() {
    for (const mesh of this.chunks.values()) mesh.geometry.dispose();
    this.chunks.clear();
    this.material.dispose();
  }
}

// A sheet of faceted water that follows the camera, gently swelling (the
// swell runs in the vertex shader; flat shading facets it for free).
export class Water {
  constructor() {
    const g = new THREE.PlaneGeometry(1, 1, 64, 64);
    g.rotateX(-Math.PI / 2);
    this.geometry = g;
    this.time = { value: 0 };
    this.material = new THREE.MeshLambertMaterial({ color: 0x3a9ad9, flatShading: true, transparent: true, opacity: 0.86 });
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.time;
      shader.vertexShader = "uniform float uTime;\n" + shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n" +
        "vec4 wp = modelMatrix * vec4(transformed, 1.0);\n" +
        "transformed.y += sin(wp.x * 0.004 + uTime * 0.9) * 1.2 + cos(wp.z * 0.005 + uTime * 0.7) * 1.2 + sin((wp.x + wp.z) * 0.011 + uTime * 1.7) * 0.8;"
      );
    };
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
  }

  update(center, size, t) {
    // snap to the facet grid so the water doesn't swim as you pan
    const step = size / 64;
    this.mesh.position.set(Math.round(center.x / step) * step, 0, Math.round(center.y / step) * step);
    this.mesh.scale.set(size, 1, size);
    this.time.value = t;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
