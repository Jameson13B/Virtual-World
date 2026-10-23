// ---------------------------------------------------------------------------
// Ambient town traffic. Unlike the sandbox's free-steering TrafficCar, these
// cars ride along a precomputed right-hand lane line (smooth curves at corners,
// a U-turn loop at dead ends), so they can never leave the road or cut across
// the other lane. They only decide how fast to go.
// ---------------------------------------------------------------------------
"use strict";

const LANE_OFFSET = ROAD_W / 4;
const CORNER_R = 45;
const CAR_GAP = 62; // bumper-to-bumper following distance (center to center)

let townCarIds = 0;

class TownCar extends Car {
  constructor(graph) {
    const color = TRAFFIC_COLORS[Math.floor(Math.random() * TRAFFIC_COLORS.length)];
    super(0, 0, 30, 50, "AUTO", 0, 1.6 + Math.random() * 1.1, color);
    this.graph = graph;
    this.nodes = []; // graph points this car is driving through
    this.line = []; // dense lane polyline: {x, y, s, limit}
    this.s = 0; // distance travelled along `line`
    this.finalStraight = 0; // where the straight into the last node begins
    this.blocked = 0;
    this.id = townCarIds++;
    this.waitingFor = null;
    this.spawn();
  }

  spawn() {
    const segs = this.graph.segments;
    if (!segs.length) return;
    const seg = segs[Math.floor(Math.random() * segs.length)];
    const [a, b] = Math.random() < 0.5 ? [seg.p1, seg.p2] : [seg.p2, seg.p1];
    this.#build([a, ...this.#route(a, b)]);
    const len = distance(a, b);
    this.s = len * (0.15 + Math.random() * 0.5);
    this.speed = 0;
    this.#place();
  }

  // Next stretch of road from `to`, arriving from `from`. Avoids turning
  // around unless the road is a dead end.
  #route(from, to) {
    const pts = this.graph.points;
    const dead = this.graph.segments.filter((s) => s.includes(to)).length <= 1;
    let best = null;
    for (let tries = 0; tries < 8; tries++) {
      const dest = pts[Math.floor(Math.random() * pts.length)];
      if (dest === to) continue;
      const path = this.graph.getShortestPath(to, dest);
      if (path.length < 2) continue;
      if (dead || path[1] !== from) return path;
      best = best || path;
    }
    return best || [to, from];
  }

  // Builds the lane line through this.nodes and resets s to its start.
  #build(nodes) {
    this.nodes = nodes;
    const line = [];
    let s = 0;
    const push = (p, limit) => {
      if (line.length) s += distance(line[line.length - 1], p);
      line.push({ x: p.x, y: p.y, s, limit });
    };
    const dirs = [];
    for (let i = 0; i < nodes.length - 1; i++) dirs.push(normalize(subtract(nodes[i + 1], nodes[i])));
    const lanePt = (p, dir, along) => add(add(p, scale(dir, along)), scale(perpendicular(dir), LANE_OFFSET));

    push(lanePt(nodes[0], dirs[0], 0), Infinity);
    for (let i = 1; i < nodes.length - 1; i++) {
      const p = nodes[i], din = dirs[i - 1], dout = dirs[i];
      const turn = dot(din, dout);
      if (turn < -0.95) {
        // U-turn around the node, inside the road's round end cap.
        const n = perpendicular(din);
        push(lanePt(p, din, 0), 1.1);
        for (let k = 1; k <= 10; k++) {
          const t = (Math.PI * k) / 10;
          push(add(p, add(scale(n, LANE_OFFSET * Math.cos(t)), scale(din, LANE_OFFSET * Math.sin(t)))), 1.1);
        }
        continue;
      }
      const r = Math.min(CORNER_R, distance(nodes[i - 1], p) / 2.2, distance(p, nodes[i + 1]) / 2.2);
      const a = lanePt(p, din, -r);
      const b = lanePt(p, dout, r);
      // Where the two lane lines meet: the curve's control point.
      const nIn = perpendicular(din), nOut = perpendicular(dout);
      const c = add(p, scale(add(nIn, nOut), LANE_OFFSET / (1 + dot(nIn, nOut))));
      const limit = turn > 0.9 ? Infinity : 1.2 + 1.2 * Math.max(0, turn + 0.2);
      push(a, Infinity);
      for (let k = 1; k <= 8; k++) {
        const t = k / 8, u = 1 - t;
        push(new Point(u * u * a.x + 2 * u * t * c.x + t * t * b.x, u * u * a.y + 2 * u * t * c.y + t * t * b.y), limit);
      }
    }
    const last = nodes.length - 1;
    this.finalStraight = s;
    push(lanePt(nodes[last], dirs[last - 1], 0), Infinity);
    this.line = line;
    this.s = 0;
  }

  // Once the car is on the last straight, plan the next stretch so the lane
  // line always continues past the node it's heading to.
  #extend() {
    const n = this.nodes.length;
    const prev = this.nodes[n - 2], end = this.nodes[n - 1];
    this.#build([prev, ...this.#route(prev, end)]);
    // The car sits on the straight prev→end, which is now the line's first piece.
    const dir = normalize(subtract(end, prev));
    const start = add(prev, scale(perpendicular(dir), LANE_OFFSET));
    this.s = Math.max(0, dot(subtract(this, start), dir));
  }

  #sample(s) {
    const line = this.line;
    let i = 1;
    while (i < line.length - 1 && line[i].s < s) i++;
    const a = line[i - 1], b = line[i];
    const t = b.s > a.s ? clamp((s - a.s) / (b.s - a.s), 0, 1) : 1;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dx: b.x - a.x, dy: b.y - a.y };
  }

  // Slowest corner limit within `range` ahead, eased by how far away it is.
  #cornerLimit(range) {
    let limit = Infinity;
    for (const p of this.line) {
      if (p.s < this.s || p.s > this.s + range) continue;
      if (p.limit < Infinity) limit = Math.min(limit, p.limit + (p.s - this.s) * 0.03);
    }
    return limit;
  }

  #place() {
    const p = this.#sample(this.s);
    this.x = p.x;
    this.y = p.y;
    if (p.dx || p.dy) this.angle = Math.atan2(-p.dx, -p.dy);
    this.polygon = this.createPolygon();
  }

  // Where our paths cross, if the other car gets there first (else Infinity).
  #yieldDistance(o) {
    for (const a of this.ahead) {
      for (const b of o.ahead) {
        if (Math.abs(a.p.x - b.p.x) > 30 || Math.abs(a.p.y - b.p.y) > 30 || distance(a.p, b.p) > 30) continue;
        const mine = a.d / Math.max(this.speed, 0.4);
        const theirs = b.d / Math.max(o.speed, 0.4);
        const theyFirst = theirs < mine || (theirs === mine && o.id < this.id);
        return theyFirst ? a.d : Infinity;
      }
    }
    return Infinity;
  }

  update(others) {
    if (this.line.length < 2) return this.spawn();
    if (this.s >= this.finalStraight) this.#extend();

    let target = Math.min(this.maxSpeed, this.#cornerLimit(70));
    // Look along our own lane line (so corners and U-turns count) for cars in
    // the way, and for cars whose upcoming path crosses ours.
    let waitingFor = null;
    const ahead = [];
    for (let d = 10; d <= 130; d += 10) ahead.push({ d, p: this.#sample(this.s + d) });
    this.ahead = ahead;
    {
      for (const o of others) {
        if (o === this || Math.abs(o.x - this.x) > 260 || Math.abs(o.y - this.y) > 260) continue;
        // Two cars waiting on each other: the older one goes first.
        if (o.waitingFor === this && this.id < o.id) continue;
        let d = Infinity;
        // A car is 50 long, so check its nose and tail as well as its middle.
        const ofwd = forwardFromHeading(o.angle);
        const body = [o, add(o, scale(ofwd, 20)), add(o, scale(ofwd, -20))];
        const hit = ahead.find((a) => body.some((b) => distance(a.p, b) < 24));
        if (hit) d = hit.d;
        else if (o.ahead) d = this.#yieldDistance(o);
        const l = clamp((d - 55) * 0.06, 0, this.maxSpeed);
        if (l < target) {
          target = l;
          waitingFor = o;
        }
      }
    }
    this.waitingFor = waitingFor;
    // Rare gridlock (three cars all waiting on each other): this car quietly
    // moves to a free spot elsewhere instead of driving through the others.
    if (waitingFor && this.speed < 0.05) {
      if (++this.blocked > 150) {
        this.blocked = 0;
        this.gridlocks = (this.gridlocks || 0) + 1;
        for (let i = 0; i < 6; i++) {
          this.spawn();
          if (!others.some((o) => o !== this && distance(o, this) < 80)) break;
        }
        return;
      }
    } else this.blocked = 0;

    this.speed = this.speed < target ? Math.min(target, this.speed + 0.05) : Math.max(target, this.speed - 0.18);
    this.s += this.speed;
    this.#place();
  }
}
