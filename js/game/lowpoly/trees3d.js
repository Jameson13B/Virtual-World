// ---------------------------------------------------------------------------
// The wild forest as instanced low-poly trees: pines and round trees, placed
// by the same wildTreeAt() as the classic look, so both show the same forest.
// ---------------------------------------------------------------------------
import * as THREE from "../../../vendor/three.module.min.js";
import { Kit } from "./kit.js";

const MAX_TREES = 5000;
const BLOCK = 8; // tree cells are refreshed in blocks of BLOCK × BLOCK

function treeGeometry(kind) {
  const k = new Kit();
  // unit tree: 1 world unit = 1 "size" (about 130 world units)
  if (kind === "pine") {
    k.cyl(0, 0, 0.06, 0, 0.3, "#7a5232", null, { n: 5 });
    k.cone(0, 0, 0.42, 0.2, 0.75, "#ffffff", { n: 7 });
    k.cone(0, 0, 0.32, 0.55, 1.05, "#ffffff", { n: 7, rot: 0.4 });
  } else {
    k.cyl(0, 0, 0.06, 0, 0.42, "#7a5232", null, { n: 5 });
    k.blob(0, 0, 0.62, 0.36, "#ffffff");
    k.blob(0.12, 0.06, 0.82, 0.24, "#ffffff");
  }
  return k.build().body;
}

export class Forest {
  constructor(city, ground) {
    this.city = city;
    this.ground = ground;
    this.cache = new Map();
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.meshes = ["pine", "round"].map((kind) => {
      const m = new THREE.InstancedMesh(treeGeometry(kind), this.material, MAX_TREES);
      m.count = 0;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_TREES * 3), 3);
      return m;
    });
    this.group = new THREE.Group();
    for (const m of this.meshes) this.group.add(m);
    this.key = null;
  }

  invalidate() {
    this.cache.clear();
    this.key = null;
  }

  #tree(cx, cy, pending) {
    const key = cx * 100003 + cy;
    if (!this.cache.has(key)) {
      if (this.cache.size > 60000) this.cache.clear();
      this.cache.set(key, wildTreeAt(this.city, cx, cy, pending));
    }
    return this.cache.get(key);
  }

  // Rebuilds the instances when the view moves to a new block of cells.
  update(bounds, pending) {
    const span = TREE_CELL * BLOCK;
    const x0 = Math.floor((bounds.minX - 200) / span) * BLOCK, x1 = Math.ceil((bounds.maxX + 200) / span) * BLOCK;
    const y0 = Math.floor((bounds.minY - 200) / span) * BLOCK, y1 = Math.ceil((bounds.maxY + 200) / span) * BLOCK;
    const key = x0 + "," + x1 + "," + y0 + "," + y1;
    if (key === this.key) return;
    this.key = key;
    const counts = [0, 0];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    for (let cx = x0; cx < x1; cx++) {
      for (let cy = y0; cy < y1; cy++) {
        const t = this.#tree(cx, cy, pending);
        if (!t) continue;
        const h = hashInts(cx, cy, 7);
        const kind = this.city.terrain.flat ? (h % 100 < 35 ? 0 : 1) : this.#pineChance(t.center) > (h % 100) ? 0 : 1;
        if (counts[kind] >= MAX_TREES) continue;
        const size = t.size * 0.8, tall = t.height / 170;
        p.set(t.center.x, this.ground.landAt(t.center.x, t.center.y) - 2, t.center.y);
        q.setFromAxisAngle(up, ((h >>> 5) % 628) / 100);
        s.set(size, size * tall, size);
        m4.compose(p, q, s);
        const mesh = this.meshes[kind];
        mesh.setMatrixAt(counts[kind], m4);
        // greens vary per tree; pines run darker and bluer
        const tint = t.tint;
        if (kind === 0) c.setRGB(0.12 + tint * 0.02, 0.36 + tint * 0.04, 0.2 + tint * 0.02);
        else c.setRGB(0.27 + tint * 0.06, 0.55 + tint * 0.07, 0.2 + tint * 0.03);
        c.convertSRGBToLinear();
        mesh.setColorAt(counts[kind], c);
        counts[kind]++;
      }
    }
    this.meshes.forEach((m, i) => {
      m.count = counts[i];
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.needsUpdate = true;
    });
  }

  // More pines up the hills, more round trees down low.
  #pineChance(p) {
    const h = this.city.terrain.height(p.x, p.y);
    return 30 + clamp((h - 0.15) / 0.4, 0, 1) * 60;
  }

  dispose() {
    for (const m of this.meshes) {
      m.geometry.dispose();
      m.dispose();
    }
    this.material.dispose();
  }
}
