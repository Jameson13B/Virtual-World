// ---------------------------------------------------------------------------
// Cars and trucks in 3D, following the same car objects the game simulates.
// Town cars share one instanced mesh (tinted per car); the collector, fire
// trucks and police cars get their own models with flashing light bars.
// ---------------------------------------------------------------------------
import * as THREE from "../../../vendor/three.module.min.js";
import { Kit } from "./kit.js";
import { DECK_Y } from "./ground.js";

const MAX_CARS = 160;

// Models face -y (forward), in a frame where 1 unit = 1 world unit.
function carModel() {
  const k = new Kit();
  k.box(-14, -25, 14, 25, 3, 14, "#ffffff"); // body (tinted per car)
  k.box(-12, -10, 12, 12, 14, 24, "#ffffff", "#ffffff");
  k.box(-12.5, -11, 12.5, -6, 15, 23, "#1e293b"); // windshield
  k.box(-12.5, 9, 12.5, 12.5, 15, 23, "#1e293b");
  for (const [x, y] of [[-14, -15], [14, -15], [-14, 15], [14, 15]]) k.box(x - 2, y - 5, x + 2, y + 5, 0, 8, "#111827");
  k.box(-11, -25.5, -6, -24, 8, 11, "#fef9c3"); // headlights
  k.box(6, -25.5, 11, -24, 8, 11, "#fef9c3");
  return k.build().body;
}

function truckModel(kind) {
  const k = new Kit();
  if (kind === "collector") {
    k.box(-20, -36, 20, 36, 4, 18, "#166534");
    k.box(-18, -36, 18, -18, 18, 32, "#15803d");
    k.box(-18.5, -37, 18.5, -32, 22, 30, "#1e293b");
    k.box(-19, -12, 19, 34, 18, 40, "#14532d", "#166534");
    k.box(-19.5, 4, 19.5, 10, 26, 32, "#facc15"); // gold trim
    k.box(-6, -4, 6, 6, 40, 43, "#facc15");
  } else if (kind === "fire") {
    k.box(-20, -40, 20, 40, 4, 22, "#dc2626");
    k.box(-18, -40, 18, -20, 22, 36, "#ef4444");
    k.box(-18.5, -41, 18.5, -36, 25, 34, "#1e293b");
    k.box(-6, -14, 6, 36, 23, 26, "#e5e7eb"); // ladder
    for (let y = -10; y < 34; y += 8) k.box(-7, y, 7, y + 2, 26, 27.5, "#9ca3af");
    k.box(-20.5, -10, 20.5, 38, 10, 14, "#f8fafc");
  } else {
    k.box(-16, -27, 16, 27, 3, 14, "#f8fafc");
    k.box(-16.5, -6, 16.5, 8, 4, 13.5, "#111827"); // black doors
    k.box(-13, -11, 13, 13, 14, 23, "#f8fafc");
    k.box(-13.5, -12, 13.5, -7, 15, 22, "#1e293b");
  }
  for (const y of kind === "police" ? [-16, 16] : [-26, 0, 26]) {
    for (const x of [-20, 20]) k.box(x - 2.5, y - 6, x + 2.5, y + 6, 0, 10, "#111827");
  }
  return k.build().body;
}

const BAR = { collector: null, fire: [-38, 36], police: [2, 23] }; // [y, top] of the light bar

export class Traffic {
  constructor(ground, terrain, glowMat) {
    this.ground = ground;
    this.terrain = terrain;
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.cars = new THREE.InstancedMesh(carModel(), this.material, MAX_CARS);
    this.cars.castShadow = true;
    this.cars.frustumCulled = false;
    this.cars.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CARS * 3), 3);
    this.group = new THREE.Group();
    this.group.add(this.cars);
    this.special = new Map(); // car object → mesh
    this.models = {};
    this.red = new THREE.MeshBasicMaterial({ color: 0xff3b3b, toneMapped: false });
    this.blue = new THREE.MeshBasicMaterial({ color: 0x3b82ff, toneMapped: false });
    this.off = new THREE.MeshBasicMaterial({ color: 0x334155 });
    this.bar = new THREE.BoxGeometry(14, 4, 6);
    const ringGeo = new THREE.RingGeometry(46, 56, 28);
    ringGeo.rotateX(-Math.PI / 2);
    this.ringGeo = ringGeo;
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.7, depthWrite: false });
    this.m4 = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.c = new THREE.Color();
  }

  // Road height under a car: on a bridge it rides the deck; in a tunnel it's
  // hidden inside the mountain.
  #y(x, y) {
    if (this.terrain.flat) return this.ground.landAt(x, y) + 2.4;
    const h = this.terrain.height(x, y);
    if (h >= ROCK) return null;
    if (h < 0) return DECK_Y + 2.4;
    return this.ground.landAt(x, y) + 2.4;
  }

  #special(car) {
    let m = this.special.get(car);
    if (m) return m;
    const kind = car instanceof Responder ? car.kind : car instanceof CollectorTruck ? "collector" : null;
    const geo = this.models[kind] || (this.models[kind] = truckModel(kind));
    m = new THREE.Group();
    const body = new THREE.Mesh(geo, this.material);
    body.castShadow = true;
    m.add(body);
    if (BAR[kind]) {
      const [y, top] = BAR[kind];
      m.userData.lights = [-1, 1].map((side) => {
        const l = new THREE.Mesh(this.bar, this.off);
        l.position.set(side * 7.5, top + 2, y);
        m.add(l);
        return l;
      });
    }
    if (kind === "collector") {
      const ring = new THREE.Mesh(this.ringGeo, this.ringMat);
      ring.position.y = 1;
      ring.renderOrder = 2;
      m.add(ring);
      m.userData.ring = ring;
    }
    m.userData.car = car;
    this.special.set(car, m);
    this.group.add(m);
    return m;
  }

  update(cars, now) {
    let n = 0;
    const seen = new Set();
    const t = now / 1000;
    const flash = Math.sin(t * Math.PI * 6) > 0;
    const up = new THREE.Vector3(0, 1, 0);
    for (const car of cars) {
      const y = this.#y(car.x, car.y);
      if (car instanceof Responder || car instanceof CollectorTruck) {
        const m = this.#special(car);
        seen.add(car);
        m.visible = y != null;
        if (y == null) continue;
        m.position.set(car.x, y, car.y);
        m.rotation.y = car.angle;
        const lit = car.state !== "back" && car.state !== "done";
        if (m.userData.lights) {
          m.userData.lights[0].material = lit ? (flash ? this.red : this.off) : this.off;
          m.userData.lights[1].material = lit ? (flash ? this.off : this.blue) : this.off;
        }
        if (m.userData.ring) {
          const pulse = (Math.sin(now / 250) + 1) / 2;
          m.userData.ring.scale.setScalar(1 + pulse * 0.25);
          this.ringMat.opacity = 0.45 + pulse * 0.35;
        }
        continue;
      }
      if (n >= MAX_CARS || y == null) continue;
      this.q.setFromAxisAngle(up, car.angle);
      // cars are 30 × 50 in the simulation; the player's car is drawn bigger
      const s = car.width / 30;
      this.m4.compose(new THREE.Vector3(car.x, y, car.y), this.q, new THREE.Vector3(s, s, car.height / 50));
      this.cars.setMatrixAt(n, this.m4);
      this.c.set(car.color || "#3b82f6");
      this.cars.setColorAt(n, this.c);
      n++;
    }
    this.cars.count = n;
    this.cars.instanceMatrix.needsUpdate = true;
    this.cars.instanceColor.needsUpdate = true;
    for (const [car, m] of this.special) {
      if (seen.has(car)) continue;
      this.group.remove(m);
      this.special.delete(car);
    }
  }

  dispose() {
    this.cars.geometry.dispose();
    this.cars.dispose();
    for (const g of Object.values(this.models)) g.dispose();
    for (const m of [this.material, this.red, this.blue, this.off, this.ringMat]) m.dispose();
    this.bar.dispose();
    this.ringGeo.dispose();
  }
}
