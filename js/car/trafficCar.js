const TRAFFIC_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#a855f7", "#ec4899", "#f5f5f4", "#334155", "#0ea5e9"];

// Scripted traffic: picks random destinations, follows the shortest path in
// the right-hand lane, stops at red lights and stop signs, slows for yield
// signs and keeps distance from the car ahead.
class TrafficCar extends Car {
  constructor(world, { avoid = null } = {}) {
    const color = TRAFFIC_COLORS[Math.floor(Math.random() * TRAFFIC_COLORS.length)];
    super(0, 0, 30, 50, "AUTO", 0, 2 + Math.random() * 1.3, color);
    this.world = world;
    this.path = [];
    this.oneWayFlags = [];
    this.pathIndex = 0;
    this.stopWait = 0;
    this.handledStops = new Map(); // marking -> frame it was cleared
    this.blockedFrames = 0;
    this.ignoreCarsFrames = 0;
    this.frame = 0;
    for (let i = 0; i < 6; i++) {
      this.spawn();
      if (!avoid || distance(this, avoid) > 160) break;
    }
  }

  get laneOffset() {
    return this.world.roadWidth / 4;
  }

  spawn() {
    const segs = this.world.graph.segments;
    if (!segs.length) return false;
    const seg = segs[Math.floor(Math.random() * segs.length)];
    let a = seg.p1, b = seg.p2;
    if (!seg.oneWay && Math.random() < 0.5) [a, b] = [b, a];
    const dir = normalize(subtract(b, a));
    const pos = lerp2D(a, b, 0.2 + Math.random() * 0.6);
    const lane = add(pos, scale(perpendicular(dir), seg.oneWay ? 0 : this.laneOffset));
    this.x = lane.x;
    this.y = lane.y;
    this.angle = headingFromDir(dir);
    this.speed = 0;
    this.damaged = false;
    const rest = this.#route(b);
    this.#setPath(rest.length >= 2 ? [a, ...rest] : [a, b]);
    this.polygon = this.createPolygon();
    return true;
  }

  #route(from) {
    const points = this.world.graph.points;
    for (let tries = 0; tries < 6; tries++) {
      const dest = points[Math.floor(Math.random() * points.length)];
      if (dest === from) continue;
      const path = this.world.graph.getShortestPath(from, dest);
      if (path.length >= 2) return path;
    }
    return [];
  }

  #setPath(path) {
    this.path = path;
    this.pathIndex = 0;
    this.oneWayFlags = [];
    for (let i = 0; i < path.length - 1; i++) {
      const seg = this.world.graph.getSegment(path[i], path[i + 1]);
      this.oneWayFlags.push(!!(seg && seg.oneWay));
    }
  }

  update(others) {
    this.frame++;
    if (this.path.length < 2) {
      this.spawn();
      return;
    }
    this.#advance();
    if (this.pathIndex >= this.path.length - 1) {
      const next = this.#route(this.path[this.path.length - 1]);
      if (next.length < 2) {
        this.spawn();
        return;
      }
      this.#setPath(next);
    }

    const target = this.#lookahead(35 + this.speed * 12);
    const desired = Math.atan2(-(target.x - this.x), -(target.y - this.y));
    const diff = wrapAngle(desired - this.angle);
    this.angle += clamp(diff, -0.07, 0.07) * clamp(this.speed / 1.2, 0, 1);

    let targetSpeed = this.maxSpeed * (1 - clamp(Math.abs(diff) * 0.9, 0, 0.65));
    targetSpeed = Math.min(targetSpeed, this.#hazardLimit(others));

    this.braking = targetSpeed < this.speed - 0.05;
    if (this.speed < targetSpeed) this.speed = Math.min(targetSpeed, this.speed + 0.06);
    else this.speed = Math.max(targetSpeed, this.speed - 0.2);

    this.x -= Math.sin(this.angle) * this.speed;
    this.y -= Math.cos(this.angle) * this.speed;
    this.polygon = this.createPolygon();
  }

  #advance() {
    const path = this.path;
    while (this.pathIndex < path.length - 1) {
      const a = path[this.pathIndex], b = path[this.pathIndex + 1];
      let advance = new Segment(a, b).projectPoint(this).offset >= 1;
      if (!advance && this.pathIndex + 2 < path.length) {
        const c = path[this.pathIndex + 2];
        const proj2 = new Segment(b, c).projectPoint(this);
        if (proj2.offset > 0 && distance(this, b) < this.world.roadWidth * 0.9) advance = true;
      }
      if (advance) this.pathIndex++;
      else break;
    }
  }

  // Point `L` units ahead along the path, shifted into the right lane.
  #lookahead(L) {
    const path = this.path;
    let k = this.pathIndex;
    const proj = new Segment(path[k], path[k + 1]).projectPoint(this);
    let cur = proj.offset < 0 ? path[k] : proj.point;
    let remaining = L;
    while (true) {
      const end = path[k + 1];
      const d = distance(cur, end);
      if (d >= remaining || k + 2 >= path.length) {
        const dir = normalize(subtract(path[k + 1], path[k]));
        const pt = d >= remaining ? add(cur, scale(normalize(subtract(end, cur)), remaining)) : end;
        const off = this.oneWayFlags[k] ? 0 : this.laneOffset;
        return add(pt, scale(perpendicular(dir), off));
      }
      remaining -= d;
      cur = end;
      k++;
    }
  }

  // Maximum speed allowed by lights, signs and cars ahead.
  #hazardLimit(others) {
    const fwd = forwardFromHeading(this.angle);
    const look = 50 + this.speed * 20;
    const laneHalf = this.world.roadWidth * 0.3;
    const approach = (gap, f) => clamp((f - gap) * 0.07, 0, this.maxSpeed);
    let limit = Infinity;

    const ahead = (p) => {
      const rel = subtract(p, this);
      const f = dot(rel, fwd);
      return { f, lat: Math.abs(cross(fwd, rel)) };
    };

    for (const m of this.world.markings) {
      if (m.type !== "light" && m.type !== "stop" && m.type !== "yield") continue;
      const { f, lat } = ahead(m.center);
      if (f < 5 || f > look || lat > laneHalf) continue;

      if (m.type === "light") {
        if (m.state === "red" || (m.state === "yellow" && f > 35)) {
          limit = Math.min(limit, approach(18, f));
        }
      } else if (m.type === "stop") {
        const cleared = this.handledStops.get(m);
        if (cleared !== undefined && this.frame - cleared < 240) continue;
        if (this.speed < 0.08 && f < 60) {
          if (++this.stopWait > 45) {
            this.handledStops.set(m, this.frame);
            this.stopWait = 0;
            continue;
          }
        }
        limit = Math.min(limit, approach(22, f));
      } else if (m.type === "yield") {
        limit = Math.min(limit, this.maxSpeed * 0.45);
      }
    }

    let blockedByCar = false;
    if (this.ignoreCarsFrames > 0) {
      this.ignoreCarsFrames--;
    } else {
      for (const o of others) {
        if (o === this) continue;
        const { f, lat } = ahead(o);
        if (f <= 0 || f > 150 || lat > 24) continue;
        const l = approach(this.height + 12, f);
        if (l < limit) {
          limit = l;
          blockedByCar = true;
        }
      }
    }
    // Break rare gridlocks at busy intersections.
    if (blockedByCar && this.speed < 0.05) {
      if (++this.blockedFrames > 300) {
        this.ignoreCarsFrames = 60;
        this.blockedFrames = 0;
      }
    } else {
      this.blockedFrames = 0;
    }
    return limit;
  }
}
