// ---------------------------------------------------------------------------
// Intersection controls in 3D: stop signs and traffic lights on the corner
// where cars wait, with a white stop line across the lane. Posts, signs and
// lines are one merged mesh, rebuilt when a control changes; the lamps are
// one instanced mesh recolored every frame as the lights change.
// ---------------------------------------------------------------------------
import * as THREE from "../../../vendor/three.module.min.js";
import { Kit } from "./kit.js";

const CURB = ROAD_W / 2 - 4; // posts stand on the sidewalk
const LAMP = { red: "#ef4444", amber: "#f59e0b", green: "#22c55e" };
const LAMP_OFF = "#3f3f46";
const PAINT_LIFT = 5.2; // just above the road's own paint

export class Signals {
  constructor(ground, material) {
    this.ground = ground;
    this.material = material;
    this.group = new THREE.Group();
    this.key = "";
    this.mesh = null;
    this.lamps = null;
    this.lampList = []; // { j, arm, color }
    this.lampMat = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.lampGeo = new THREE.IcosahedronGeometry(1, 1);
    this.c = new THREE.Color();
  }

  update(junctions) {
    const controlled = junctions.filter((j) => j.control);
    const key = controlled.map((j) => j.key + j.control + j.arms.length).join("|");
    if (key !== this.key) this.#rebuild(controlled, key);
    if (!this.lamps) return;
    this.lampList.forEach((l, i) => {
      this.c.set(l.j.signal(l.arm) === l.color ? LAMP[l.color] : LAMP_OFF);
      this.lamps.setColorAt(i, this.c);
    });
    this.lamps.instanceColor.needsUpdate = true;
  }

  #rebuild(junctions, key) {
    this.key = key;
    this.#clear();
    const k = new Kit();
    const m4 = new THREE.Matrix4();
    const lamps = [];
    for (const j of junctions) {
      for (const arm of j.arms) {
        const d = normalize(subtract(arm, j.node)); // out along the road
        const curb = perpendicular(scale(d, -1)); // to the right of cars coming in
        const back = j.back.get(arm);
        const stops = j.control === "stop4" || j.control === "light" || (j.control === "stop2" && !j.isMain(arm));
        if (!stops) continue;
        const line = add(j.node, scale(d, back - 30)); // the stop line sits at the car's nose
        const base = add(line, scale(curb, CURB));
        const h = this.ground.landAt(base.x, base.y);
        // the stop line across the incoming lane
        const lh = this.ground.landAt(line.x, line.y) + PAINT_LIFT;
        const a = add(line, scale(curb, 2)), b = add(line, scale(curb, CURB - 8)), t = scale(d, 4);
        k.flat([[a.x - t.x, a.y - t.y], [b.x - t.x, b.y - t.y], [b.x + t.x, b.y + t.y], [a.x + t.x, a.y + t.y]], lh, "#f8fafc");
        if (j.control === "light") {
          k.line(base.x, base.y, h, base.x, base.y, h + 62, "#475569", 3);
          const head = add(base, scale(d, 2));
          k.box(head.x - 6, head.y - 6, head.x + 6, head.y + 6, h + 38, h + 66, "#1f2937");
          // three lamps on the side facing the cars
          const face = add(head, scale(d, 7));
          [["red", 60], ["amber", 52], ["green", 44]].forEach(([color, z]) => {
            m4.compose(new THREE.Vector3(face.x, h + z, face.y), new THREE.Quaternion(), new THREE.Vector3(3.2, 3.2, 3.2));
            lamps.push({ j, arm, color, m: m4.clone() });
          });
        } else {
          k.line(base.x, base.y, h, base.x, base.y, h + 34, "#9ca3af", 2.5);
          // a red octagon facing the cars, gray on the back
          const right = perpendicular(d), c = add(base, scale(d, 1.5));
          const oct = (off) => Array.from({ length: 8 }, (_, i) => {
            const ang = ((i + 0.5) / 8) * Math.PI * 2;
            return [c.x + right.x * Math.cos(ang) * 10 + d.x * off, c.y + right.y * Math.cos(ang) * 10 + d.y * off, h + 40 + Math.sin(ang) * 10];
          });
          const front = [c.x - d.x * 3, c.y - d.y * 3, h + 40];
          k.face(oct(0.8), "#f8fafc", front); // white rim
          k.face(oct(1.1).map(([x, y, z]) => [x + (c.x - x) * 0.15, y + (c.y - y) * 0.15, z + (h + 40 - z) * 0.15]), "#dc2626", front);
          k.face(oct(-0.8), "#9ca3af", [c.x + d.x * 3, c.y + d.y * 3, h + 40]);
        }
      }
    }
    const geo = k.geometry();
    if (geo) {
      this.mesh = new THREE.Mesh(geo, this.material);
      this.mesh.castShadow = true;
      this.mesh.matrixAutoUpdate = false;
      this.group.add(this.mesh);
    }
    if (lamps.length) {
      this.lamps = new THREE.InstancedMesh(this.lampGeo, this.lampMat, lamps.length);
      this.lamps.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(lamps.length * 3), 3);
      lamps.forEach((l, i) => this.lamps.setMatrixAt(i, l.m));
      this.lamps.frustumCulled = false;
      this.group.add(this.lamps);
    }
    this.lampList = lamps;
  }

  #clear() {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    if (this.lamps) {
      this.group.remove(this.lamps);
      this.lamps.dispose();
      this.lamps = null;
    }
  }

  dispose() {
    this.#clear();
    this.lampMat.dispose();
    this.lampGeo.dispose();
  }
}
