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
const QUEUE_GAP = 95; // how far apart (center to center) cars actually sit in a queue

// ---------------------------------------------------------------------------
// Intersections: every road point where 3 or more roads meet. Cars stop at the
// stop line and ask to cross; the intersection's control decides who goes:
//   none   – nobody's sure who goes first, so everyone slows right down, and
//            when cars wait on two roads at once they hesitate before each one
//   stop2  – the main road (the straightest pair) keeps moving; side roads stop
//   stop4  – everyone stops, then they take turns in arrival order
//   light  – the main road and the side roads take turns on green
// A car only enters when there's room on the road it's turning into, so a
// jam is a queue the player can see and fix, never a knot of cars.
// ---------------------------------------------------------------------------
const STOP_BACK = 75; // shortest distance from the middle of an intersection to its stop lines
const JUNCTION_LOOK = 170; // cars start asking this far before the stop line
const SQUEEZE = 600; // frames waiting before a car squeezes into a full lane
const REROUTE = 900; // frames waiting before a car gives up and turns another way
const HESITATE = 40; // frames an uncontrolled intersection sits empty before the next car tries
const STOP_FRAMES = { stop2: 20, stop4: 14 };
// Lights: a green with nobody left coming turns after `min`; one still
// carrying cars holds until the red side clearly has more waiting (each `wait`
// frames a red car has waited counts as one more car), after at least `hold`,
// and never keeps a red car waiting past `starve`.
const GREEN = { min: 90, hold: 240, starve: 1500, wait: 300, amber: 50, look: 320 };

const junctionKey = (p) => Math.round(p.x) + "," + Math.round(p.y);

class Junction {
  constructor(node, arms) {
    this.node = node;
    this.key = junctionKey(node);
    this.arms = arms; // the graph points at the other end of each road
    this.control = null;
    this.inside = new Map(); // car → its move { from, to }
    this.asks = new Map(); // cars asking to cross this frame → { from, to, gap }
    this.alive = true;
    this.calm = 0; // frames nobody has been driving through the box
    this.queue = 0; // cars waiting, smoothed over ~20 s
    this.worst = 0; // longest current wait, in frames
    this.phase = 0; // light: which group is green
    this.phaseT = 0;
    this.amber = 0;
    const dir = (q) => normalize(subtract(q, node));
    // Stop lines sit further back on roads that meet at a sharp angle, so a
    // waiting car is clear of cars turning past it.
    this.back = new Map(arms.map((a) => {
      let sin = 1, cos = 0;
      for (const b of arms) {
        if (b === a) continue;
        const c = dot(dir(a), dir(b));
        if (c > 0 && Math.sqrt(1 - c * c) < sin) [sin, cos] = [Math.sqrt(1 - c * c), c];
      }
      const want = 20 + (52 + 25 * cos) / Math.max(sin, 0.2);
      return [a, clamp(want, STOP_BACK, Math.max(STOP_BACK, distance(a, node) * 0.45))];
    }));
    // The main road: the two arms closest to a straight line.
    let best = Infinity;
    for (let i = 0; i < arms.length; i++) {
      for (let j = i + 1; j < arms.length; j++) {
        const d = dot(dir(arms[i]), dir(arms[j]));
        if (d < best) [best, this.main] = [d, [arms[i], arms[j]]];
      }
    }
  }

  get jammed() {
    return this.queue > 2.5 || this.worst > 600;
  }

  // 0 (free) … 1 (jammed), for the traffic lens.
  get load() {
    return clamp(Math.max(this.queue / 3, this.worst / 700), 0, 1);
  }

  isMain(arm) {
    return this.main.includes(arm);
  }

  // What a light shows on an arm right now: "green", "amber" or "red".
  signal(arm) {
    const g = this.isMain(arm) ? 0 : 1;
    if (g !== this.phase) return "red";
    return this.amber > 0 ? "amber" : "green";
  }

  ask(car, move, gap) {
    this.asks.set(car, { ...move, gap });
    const w = car.jWait && car.jWait.j === this ? car.jWait : (car.jWait = { j: this, t: 0, stopped: 0 });
    w.t++;
    if (car.speed < 0.1 && gap < 14) w.stopped++;
  }

  enter(car, move) {
    this.inside.set(car, move);
    car.grants.add(this);
    car.jWait = null;
    this.calm = 0;
  }

  leave(car) {
    this.inside.delete(car);
    car.grants.delete(this);
  }

  // Once a frame, before the cars move: lets waiting cars in. `cars` is
  // everything on the road, for checking there's room past the intersection.
  tick(cars) {
    for (const [car] of this.inside) {
      if (car.done || car.parked || !car.grants.has(this) || distance(car, this.node) > STOP_BACK * 3) this.leave(car);
    }
    // (A car stopped in the box, queuing onto its road, doesn't count.)
    if ([...this.inside.keys()].some((c) => c.speed > 0.3)) this.calm = 0;
    else this.calm++;
    const asks = [...this.asks].filter(([car]) => !car.done && !car.parked);
    this.asks.clear();
    let waiting = 0, worst = 0;
    for (const [car, a] of asks) {
      if (a.gap < 60 && car.speed < 0.3) waiting++;
      if (car.jWait) worst = Math.max(worst, car.jWait.t);
    }
    this.queue += (waiting - this.queue) * 0.003;
    this.worst = worst;
    if (this.control === "light") this.#cycle(asks, cars);
    // Sirens first, then whoever has waited longest. A car whose turn it is
    // but has to wait for the box keeps its place: nobody behind it on its
    // road, and nobody whose path crosses its path, goes ahead of it.
    asks.sort(([a], [b]) => (b.rushing ? 1 : 0) - (a.rushing ? 1 : 0) || (b.jWait?.t || 0) - (a.jWait?.t || 0));
    const held = [];
    for (const [car, a] of asks) {
      if (!this.#turn(car, a, asks)) continue;
      // Sirens go as soon as they reach the line: other cars pull over.
      const room = this.#room(a.to, cars, (car.jWait?.t || 0) > SQUEEZE);
      if (car.rushing || (room && this.#clear(a, held))) this.enter(car, a);
      // A car waiting for room on the road ahead doesn't hold anyone up: the
      // cars that would make that room may need to get through first.
      else if (room) held.push(a);
    }
  }

  // Lights follow the traffic: green stays with the side that has the cars.
  // It turns as soon as the green side runs dry and someone waits on red, or
  // when red's queue (and how long it has waited) outweighs green's. A queue
  // pulling away from the line still counts as cars on green, so the light
  // doesn't turn on the cars still catching up. Amber clears the box.
  #cycle(asks, cars) {
    if (this.amber > 0) {
      if (--this.amber === 0) [this.phase, this.phaseT] = [1 - this.phase, 0];
      return;
    }
    this.phaseT++;
    const other = 1 - this.phase;
    let redWait = -1;
    for (const [car, a] of asks) {
      if (a.gap < 150 && (this.isMain(a.from) ? 0 : 1) === other) redWait = Math.max(redWait, car.jWait?.t || 0);
    }
    if (redWait < 0 || this.phaseT <= GREEN.min) return;
    const green = this.#coming(this.phase, cars);
    const red = this.#coming(other, cars) + redWait / GREEN.wait;
    if (!green || redWait > GREEN.starve || (this.phaseT > GREEN.hold && red > green * 1.5 + 1)) this.amber = GREEN.amber;
  }

  // How many cars are driving (or queued) toward the box on group g's roads.
  #coming(g, cars) {
    let n = 0;
    for (const from of this.arms) {
      if ((this.isMain(from) ? 0 : 1) !== g) continue;
      const dir = normalize(subtract(from, this.node)), side = perpendicular(dir), back = this.back.get(from) || STOP_BACK;
      const far = Math.min(distance(from, this.node), back + GREEN.look);
      for (const o of cars) {
        if (o.parked || Math.abs(o.x - this.node.x) > far + 40 || Math.abs(o.y - this.node.y) > far + 40) continue;
        const v = subtract(o, this.node), along = dot(v, dir);
        if (along > back - 10 && along < far && Math.abs(dot(v, side) + LANE_OFFSET) < 18) n++;
      }
    }
    return n;
  }

  // Whether two moves' paths through the box cross (or end on the same
  // road). Cars from the same road just follow each other. `wary`: without a
  // sign or light, nobody shares the box.
  #crosses(a, b, wary = !this.control) {
    if (a.from === b.from) return false;
    // A U-turn swings around the middle of the box, across everyone's path.
    if (a.to === b.to || a.from === a.to || b.from === b.to) return true;
    if (wary) return true;
    const end = (arm, out) => {
      const d = normalize(subtract(arm, this.node));
      return add(add(this.node, scale(d, ROAD_W / 2)), scale(perpendicular(out ? d : scale(d, -1)), LANE_OFFSET));
    };
    return !!getIntersection(end(a.from, false), end(a.to, true), end(b.from, false), end(b.to, true));
  }

  // Nothing in the way: no crossing path in the box or waiting its turn.
  #clear(a, held) {
    let same = 0;
    // A car stopped in the box is queuing onto the road it's turning into, so
    // anyone not crossing that path can still get by it.
    for (const [car, b] of this.inside) {
      if (this.#crosses(a, b, !this.control && car.speed > 0.3)) return false;
      if (b.to === a.to) same++;
    }
    for (const h of held) if (h.from === a.from || this.#crosses(a, h)) return false;
    return same < 2;
  }

  // Room on the road `to` past the intersection: no stopped car near its
  // start, and its lane isn't already as full as it can get. (Cars still
  // rolling into a full lane stop in a moment, and one let in behind them
  // would be left blocking the box.) After a long wait a driver squeezes into
  // a full lane anyway if there's a gap at its start.
  #room(to, cars, squeeze = false) {
    const dir = normalize(subtract(to, this.node)), side = perpendicular(dir), back = this.back.get(to) || STOP_BACK;
    const road = distance(to, this.node);
    const near = Math.min(road, back + CAR_GAP + 10);
    // The lane holds cars from just past our stop line to the far end's stop line.
    const far = road - (this.all?.get(to)?.back.get(this.node) || 0);
    const fits = Math.max(1, Math.floor((far - back + 25) / QUEUE_GAP));
    const minX = Math.min(this.node.x, to.x) - 40, maxX = Math.max(this.node.x, to.x) + 40;
    const minY = Math.min(this.node.y, to.y) - 40, maxY = Math.max(this.node.y, to.y) + 40;
    let inLane = 0;
    for (const o of cars) {
      if (o.parked || o.x < minX || o.x > maxX || o.y < minY || o.y > maxY) continue;
      // (A car in the box turning onto another road isn't in this lane.)
      if (this.inside.has(o) && this.inside.get(o).to !== to) continue;
      const v = subtract(o, this.node), along = dot(v, dir), across = dot(v, side);
      if (along < back - 25 || along > far + 10 || Math.abs(across - LANE_OFFSET) > 18) continue;
      if (o.speed <= 1.2 && along < near) return false;
      if (++inLane >= fits && !squeeze) return false;
    }
    return true;
  }

  // Whether the control lets this car go now (if the way is clear).
  #turn(car, a, asks) {
    // Everyone else waits for a fire truck or police car on its way.
    if (car.rushing) return a.gap < 60;
    if (asks.some(([o, b]) => o.rushing && b.from !== a.from && b.gap < 200)) return false;
    const w = car.jWait || { t: 0, stopped: 0 };
    switch (this.control) {
      case "stop2":
        if (this.isMain(a.from)) return a.gap < 45;
        // (A main-road car stopped at the line is stuck, not coming.)
        return a.gap < 14 && w.stopped >= STOP_FRAMES.stop2 && !asks.some(([o, b]) => o !== car && this.isMain(b.from) && b.gap < 90 && o.speed > 0.3 && this.#crosses(a, b));
      case "stop4":
        return a.gap < 14 && w.stopped >= STOP_FRAMES.stop4;
      case "light":
        return this.amber === 0 && (this.isMain(a.from) ? 0 : 1) === this.phase && a.gap < 80;
      default:
        // Uncontrolled: creep up, look both ways, and when two roads both
        // have cars, wait a beat to see who goes.
        if (a.gap > 25 || car.speed > 0.9) return false;
        return this.calm > HESITATE || !asks.some(([o, b]) => o !== car && b.from !== a.from && b.gap < 60);
    }
  }
}

// The intersections on a graph, rebuilt when roads change (keeping the ones
// that are still there, since cars hold on to them). `controls` maps
// junctionKey → control type.
function syncJunctions(graph, controls = {}) {
  if (!graph.junctions || graph.junctionsVersion !== graph.version) {
    const old = graph.junctions || new Map(), next = new Map();
    for (const p of graph.points) {
      const arms = [];
      for (const s of graph.segments) {
        if (s.p1 === p) arms.push(s.p2);
        else if (s.p2 === p) arms.push(s.p1);
      }
      if (arms.length < 3) continue;
      const j = old.get(p);
      next.set(p, j && j.arms.length === arms.length ? j : new Junction(p, arms));
    }
    for (const [p, j] of old) if (next.get(p) !== j) j.alive = false;
    for (const j of next.values()) j.all = next;
    graph.junctions = next;
    graph.junctionsVersion = graph.version;
  }
  for (const j of graph.junctions.values()) {
    const c = controls[j.key] || null;
    if (c !== j.control) [j.control, j.phase, j.phaseT, j.amber] = [c, 0, 0, 0];
  }
  return graph.junctions;
}

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
    this.crossings = []; // intersections along `line`: { j, from, to, sIn, sOut }
    this.grants = new Set(); // intersections this car has been let into
    this.jWait = null; // { j, t, stopped } while waiting at one
    this.stopAt = Infinity; // how far ahead this car will stop for an intersection
    this.delayed = 0; // frames spent stuck in traffic
    this.spawn();
  }

  // Puts the car on `seg` (else a random road), at the point `at` if given,
  // facing the end nearest `toward` if given.
  spawn(seg = null, at = null, toward = null) {
    const segs = this.graph.segments;
    if (!segs.length) return;
    seg = seg || segs[Math.floor(Math.random() * segs.length)];
    const flip = toward ? distance(seg.p1, toward) < distance(seg.p2, toward) : Math.random() < 0.5;
    const [a, b] = flip ? [seg.p2, seg.p1] : [seg.p1, seg.p2];
    this.#build([a, ...this.#route(a, b)]);
    const len = distance(a, b);
    this.s = at ? clamp(dot(subtract(at, a), normalize(subtract(b, a))), 0, len) : len * (0.15 + Math.random() * 0.5);
    this.speed = 0;
    this.#place();
  }

  // Next stretch of road from `to`, arriving from `from`. Avoids turning
  // around unless the road is a dead end.
  #route(from, to) {
    const goal = this.destination(from, to);
    if (goal) {
      const path = this.graph.getShortestPath(to, goal);
      // Only turn around at a dead end or an intersection: a U-turn halfway
      // along a road cuts across the other lane, and a queue there can leave
      // it stuck for good. Carry on to the next one instead.
      const ways = path[1] === from ? this.graph.segments.filter((s) => s.includes(to)) : [];
      if (ways.length === 2) {
        const on = ways.find((s) => !s.includes(from));
        if (on) return [to, on.p1 === to ? on.p2 : on.p1];
      }
      if (path.length >= 2) return path;
    }
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

  // Subclasses can steer: return a graph point to drive to next (else random).
  destination(from, to) {
    return null;
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
    const junctions = this.graph.junctions;
    const crossings = [];

    push(lanePt(nodes[0], dirs[0], 0), Infinity);
    for (let i = 1; i < nodes.length - 1; i++) {
      const p = nodes[i], din = dirs[i - 1], dout = dirs[i];
      const turn = dot(din, dout);
      const j = junctions?.get(p);
      if (turn < -0.95) {
        // U-turn around the node, inside the road's round end cap.
        const n = perpendicular(din);
        push(lanePt(p, din, 0), 1.1);
        const sIn = s - (j ? j.back.get(nodes[i - 1]) : 0);
        for (let k = 1; k <= 10; k++) {
          const t = (Math.PI * k) / 10;
          push(add(p, add(scale(n, LANE_OFFSET * Math.cos(t)), scale(din, LANE_OFFSET * Math.sin(t)))), 1.1);
        }
        if (j) crossings.push({ j, from: nodes[i - 1], to: nodes[i + 1], sIn, sOut: s + j.back.get(nodes[i + 1]) });
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
      const sIn = j ? s - (j.back.get(nodes[i - 1]) - r) : 0;
      for (let k = 1; k <= 8; k++) {
        const t = k / 8, u = 1 - t;
        push(new Point(u * u * a.x + 2 * u * t * c.x + t * t * b.x, u * u * a.y + 2 * u * t * c.y + t * t * b.y), limit);
      }
      if (j) crossings.push({ j, from: nodes[i - 1], to: nodes[i + 1], sIn, sOut: s + (j.back.get(nodes[i + 1]) - r) });
    }
    const last = nodes.length - 1;
    this.finalStraight = s;
    push(lanePt(nodes[last], dirs[last - 1], 0), Infinity);
    this.line = line;
    this.crossings = crossings;
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

  // The speed limit from the next intersection: free once let in, else a
  // gentle stop at the stop line while asking to cross.
  #intersection() {
    // Out once past it (not counting coming back through it later on).
    for (const g of this.grants) {
      if (!this.crossings.some((c) => c.j === g && c.sOut > this.s && c.sIn - JUNCTION_LOOK < this.s) && distance(this, g.node) > STOP_BACK - 10) g.leave(this);
    }
    this.stopAt = Infinity;
    const next = this.crossings.find((c) => c.sOut > this.s && !this.grants.has(c.j));
    if (!next || !next.j.alive) return Infinity;
    const gap = next.sIn - this.s;
    if (gap < -5) {
      // Already past the line (the road was just built under us): carry on.
      next.j.enter(this, next);
      return Infinity;
    }
    if (gap > JUNCTION_LOOK) return Infinity;
    const w = this.jWait;
    if (w && w.j === next.j && gap < 20 && !this.rushing && w.t > (w.rerouted || 0) + REROUTE) {
      w.rerouted = w.t;
      this.#reroute(next);
      return 0;
    }
    next.j.ask(this, next, gap);
    this.stopAt = gap;
    // Without a sign, everyone slows down to look.
    const slow = next.j.control ? Infinity : 1.4 + gap * 0.02;
    return Math.min(slow, clamp((gap - 3) * 0.07, 0, this.maxSpeed));
  }

  // Fed up with waiting at an intersection: turn another way instead (back
  // the way it came only if there's no other).
  #reroute(c) {
    const ways = c.j.arms.filter((a) => a !== c.to && a !== c.from);
    const alt = ways.length ? ways[Math.floor(Math.random() * ways.length)] : c.from;
    if (alt === c.to) return;
    this.#build([c.from, c.j.node, ...this.#route(c.j.node, alt)]);
    const dir = normalize(subtract(c.j.node, c.from));
    this.s = Math.max(0, dot(subtract(this, add(c.from, scale(perpendicular(dir), LANE_OFFSET))), dir));
  }

  // True when the cars this one waits for end up waiting for it, following
  // cars held at an intersection to the cars in its way there.
  #waitCircle() {
    const seen = new Set(), todo = [this];
    while (todo.length && seen.size < 80) {
      const o = todo.pop();
      const next = o.waitingFor ? [o.waitingFor] : o.jWait ? [...o.jWait.j.inside.keys()] : [];
      for (const n of next) {
        if (n === this) return true;
        if (!seen.has(n)) seen.add(n), todo.push(n);
      }
    }
    return false;
  }

  // Where our paths cross, if the other car gets there first (else Infinity).
  #yieldDistance(o) {
    const A = this.aheadBox, B = o.aheadBox;
    if (!B || A.minX > B.maxX + 30 || B.minX > A.maxX + 30 || A.minY > B.maxY + 30 || B.minY > A.maxY + 30) return Infinity;
    for (const a of this.ahead) {
      for (const b of o.ahead) {
        if (b.d > o.stopAt) break; // it's stopping at an intersection before here
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
    target = Math.min(target, this.#intersection());
    // Look along our own lane line (so corners and U-turns count) for cars in
    // the way, and for cars whose upcoming path crosses ours.
    let waitingFor = null;
    const ahead = [];
    for (let d = 10; d <= 130; d += 10) ahead.push({ d, p: this.#sample(this.s + d) });
    this.ahead = ahead;
    const box = (this.aheadBox = boundsOf(ahead.map((a) => a.p)));
    {
      for (const o of others) {
        if (o === this || Math.abs(o.x - this.x) > 260 || Math.abs(o.y - this.y) > 260) continue;
        // Nowhere near our path, nor its path near ours.
        const near = o.x > box.minX - 50 && o.x < box.maxX + 50 && o.y > box.minY - 50 && o.y < box.maxY + 50;
        const B = o.aheadBox;
        if (!near && (!B || box.minX > B.maxX + 30 || B.minX > box.maxX + 30 || box.minY > B.maxY + 30 || B.minY > box.maxY + 30)) continue;
        // Cars waiting at the stop line of an intersection we're crossing stay put.
        if (o.jWait && o.stopAt < 25 && this.grants.has(o.jWait.j)) continue;
        // Two cars waiting on each other: the older one goes first.
        if (o.waitingFor === this && this.id < o.id) continue;
        let d = Infinity;
        // A car is 50 long, so check its nose and tail as well as its middle.
        const ofwd = forwardFromHeading(o.angle);
        const body = [o, add(o, scale(ofwd, 20)), add(o, scale(ofwd, -20))];
        const hit = near && ahead.find((a) => body.some((b) => distance(a.p, b) < 24));
        if (hit) d = hit.d;
        else if (o.ahead && !(this.nudge > 0)) d = this.#yieldDistance(o);
        const l = clamp((d - 55) * 0.1, 0, this.maxSpeed);
        if (l < target) {
          target = l;
          waitingFor = o;
        }
      }
    }
    this.waitingFor = waitingFor;
    // Cars waiting on each other in a circle (rare away from intersections):
    // after a while one of them stops giving way and edges through.
    if (this.nudge > 0) this.nudge--;
    if (waitingFor && this.speed < 0.05) {
      if (++this.blocked > 300 && this.#waitCircle()) [this.blocked, this.nudge] = [0, 90];
    } else this.blocked = 0;

    this.speed = this.speed < target ? Math.min(target, this.speed + 0.07) : Math.max(target, this.speed - 0.18);
    this.s += this.speed;
    this.#place();
  }
}

// ---------------------------------------------------------------------------
// Residents' cars. Each one belongs to someone with a home and a job, and
// makes one trip that fits the time of day on the phone's clock: to work in
// the morning, errands at lunch, home in the evening, out to a park at night.
// It pulls out of the first building, pulls over at each stop and disappears
// into the last one. Stopping at a shop is a visit, and visitors spend 💰.
// ---------------------------------------------------------------------------
const clockHour = (date = new Date()) => date.getHours() + date.getMinutes() / 60;

// The trips people make at each time of day, as [stops, weight]. An errand is
// a shop; fun is a park or another special (or a shop if the town has none).
// Half the trips at any hour stop at a shop (not just start at one), so shop
// visits stay steady around the clock.
const TRIPS = [
  { until: 6, label: "🌙 Late night", trips: [[["work", "home"], 1], [["fun", "home"], 1], [["work", "errand", "home"], 2]] },
  { until: 10, label: "🌅 Morning commute", trips: [[["home", "work"], 1], [["home", "errand", "work"], 1]] },
  { until: 16, label: "☀️ Daytime errands", trips: [[["work", "errand", "work"], 1], [["home", "errand", "home"], 1], [["home", "fun", "home"], 1], [["home", "work"], 1]] },
  { until: 20, label: "🌆 Evening commute", trips: [[["work", "home"], 1], [["work", "errand", "home"], 1]] },
  { until: 24, label: "🌃 Night out", trips: [[["home", "fun"], 1], [["home", "errand", "home"], 1]] },
];
const DRIVER_NAMES = ["Ava", "Ben", "Chloe", "Dev", "Ella", "Finn", "Gia", "Hugo", "Iris", "Jay", "Kai", "Lena", "Milo", "Nora", "Omar", "Pia", "Quinn", "Rosa", "Sam", "Theo", "Uma", "Vic", "Wren", "Yara", "Zane"];

// Picks someone (a home and a job) and the trip they're making at `hour`, or
// null if the town has nowhere to go yet.
function planTrip(lots, hour, rand = Math.random) {
  const homes = [], jobs = [], shops = [], fun = [];
  for (const l of lots) {
    if (l.building > 0 || l.incident) continue;
    if (l.kind === "res") homes.push(l);
    else if (l.kind === "com") jobs.push(l), shops.push(l);
    else if (l.kind === "ind") jobs.push(l);
    else if (l.kind === "special") fun.push(l);
  }
  const pick = (arr) => (arr.length ? arr[Math.floor(rand() * arr.length)] : null);
  const home = pick(homes), work = pick(jobs);
  if (!home || !work) return null;
  const errand = pick(shops.filter((l) => l !== work));
  const places = { home, work, errand, fun: pick(fun) || errand };

  const period = TRIPS.find((p) => hour < p.until);
  let r = rand() * period.trips.reduce((sum, [, w]) => sum + w, 0);
  const [plan] = period.trips.find(([, w]) => (r -= w) < 0) || period.trips[0];
  const stops = [], why = [];
  for (const kind of plan) {
    const lot = places[kind];
    if (!lot || lot === stops[stops.length - 1]) continue;
    stops.push(lot);
    why.push(kind);
  }
  if (stops.length < 2) return null;
  return { home, work, stops, why, label: period.label, name: pick(DRIVER_NAMES) };
}

// The middle of a lot's frontage: where its visitors pull over.
function curbPoint(seg, p) {
  const d = subtract(seg.p2, seg.p1);
  const t = clamp(dot(subtract(p, seg.p1), d) / dot(d, d), 0.15, 0.85);
  return add(seg.p1, scale(d, t));
}

const PULL_OVER = ROAD_W / 2 - LANE_OFFSET - 8; // from the lane to the curb
const PARK_REACH = LANE_OFFSET + 15;
const TRIP_LIMIT = 60 * 240; // frames; still driving after ~4 minutes, they call it a day

class Commuter extends TownCar {
  // trip: from planTrip(). onStop(car, lot, why) runs at each stop after the first.
  constructor(graph, trip, onStop) {
    super(graph);
    Object.assign(this, trip);
    this.onStop = onStop;
    this.leg = 0; // the stop it's at, or last left
    this.state = "starting"; // → driving ⇄ parked → leaving → done
    this.wait = 45;
    this.age = 0;
    this.grow = 0; // pops out of the building, and shrinks back into the last one
    this.pull = 1; // 1 = pulled over at the curb, 0 = in its lane
    this.full = { w: this.width, h: this.height };
    const from = this.stops[0], seg = graph.segments[from.segIndex];
    this.spawn(seg, curbPoint(seg, from.center), this.stops[1].center);
    this.#pose();
  }

  get target() {
    return this.stops[this.leg + 1];
  }

  // Not in traffic: other cars drive past it.
  get parked() {
    return this.state !== "driving";
  }

  get done() {
    return this.state === "done";
  }

  spawn(seg = null, at = null, toward = null) {
    // No road to follow: pull over until there is one.
    if (this.stops && !seg) return void ([this.state, this.wait, this.yielding] = ["parked", 120, true]);
    super.spawn(seg, at, toward);
    this.lane = { x: this.x, y: this.y };
  }

  // Pulls over to the curb for a fire truck or police car (even in a jam or
  // halfway across an intersection), then carries on.
  pullOver(frames = 90) {
    if (this.state !== "driving") return;
    [this.state, this.wait, this.yielding] = ["parked", frames, true];
  }

  // Drive to the next stop's road, then along it.
  destination(from, to) {
    if (!this.stops) return null; // (not set yet while spawning)
    const seg = this.graph.segments[this.target.segIndex];
    if (to === seg.p1) return seg.p2;
    if (to === seg.p2) return seg.p1;
    return distance(to, seg.p1) <= distance(to, seg.p2) ? seg.p1 : seg.p2;
  }

  update(others) {
    this.age++;
    if (this.state === "driving") {
      super.update(others);
      if (this.state !== "driving") return; // no road: pulling over
      this.lane = { x: this.x, y: this.y };
      this.pull = Math.max(0, this.pull - 0.04);
      const seg = this.graph.segments[this.target.segIndex];
      if (this.age > TRIP_LIMIT) this.state = "leaving";
      else if (seg && distance(this, curbPoint(seg, this.target.center)) < PARK_REACH) this.#arrive();
    } else {
      this.pull = Math.min(1, this.pull + 0.05);
      if (this.state === "leaving") {
        if (this.pull >= 1 && (this.grow -= 0.04) <= 0) this.state = "done";
      } else {
        this.grow = Math.min(1, this.grow + 0.05);
        // Pull out once there's a gap in the traffic.
        if (--this.wait <= 0 && !others.some((o) => o !== this && distance(o, this.lane) < 70)) [this.state, this.yielding] = ["driving", false];
      }
    }
    this.#pose();
  }

  #arrive() {
    this.leg++;
    this.speed = 0;
    this.onStop?.(this, this.stops[this.leg], this.why[this.leg]);
    if (this.leg === this.stops.length - 1) this.state = "leaving";
    else [this.state, this.wait] = ["parked", 90 + Math.random() * 120];
  }

  // Shifts the car from its lane toward the curb and sizes it as it pops in or out.
  #pose() {
    const side = perpendicular(forwardFromHeading(this.angle));
    const k = PULL_OVER * this.pull * this.pull * (3 - 2 * this.pull);
    this.x = this.lane.x + side.x * k;
    this.y = this.lane.y + side.y * k;
    const g = Math.max(0.05, this.grow);
    this.width = this.full.w * g;
    this.height = this.full.h * g;
    this.polygon = this.createPolygon();
  }
}

// ---------------------------------------------------------------------------
// The hired collector: an armored truck that drives past every shop once,
// emptying its 💰 bubble and keeping a cut. Trucks hired together share one
// set of shops still to visit (`pool`), so two trucks split the town.
// ---------------------------------------------------------------------------
const COLLECTOR_CUT = 0.15;
// Far enough to reach the far end of a lot from the lane in front of it.
const COLLECT_REACH = 190;

class CollectorTruck extends TownCar {
  constructor(graph, pool, onCollect, start = null) {
    super(graph);
    this.width = 40;
    this.height = 72;
    this.color = "#166534";
    this.maxSpeed = 3;
    this.onCollect = onCollect; // (lot) => called when the truck passes a shop
    this.pool = pool;
    // Start on the road closest to `start` (e.g. one side of town).
    if (start) {
      let best = null, bestD = Infinity;
      for (const seg of graph.segments) {
        const d = distance(average(seg.p1, seg.p2), start);
        if (d < bestD) [best, bestD] = [seg, d];
      }
      this.spawn(best);
    }
  }

  get done() {
    return !this.pool.size;
  }

  // Head for the nearest shop's road, then drive along it.
  destination(from, to) {
    if (!this.pool || !this.pool.size) return null; // (not yet set while spawning)
    let best = null, bestD = Infinity;
    for (const lot of this.pool) {
      const seg = this.graph.segments[lot.segIndex];
      const d = Math.min(distance(to, seg.p1), distance(to, seg.p2));
      if (d < bestD) [best, bestD] = [seg, d];
    }
    const { p1, p2 } = best;
    if (to === p1) return p2;
    if (to === p2) return p1;
    return distance(to, p1) <= distance(to, p2) ? p1 : p2;
  }

  // Moves twice per frame: it's in a hurry, corners included.
  update(others) {
    super.update(others);
    this.#collect();
    super.update(others);
    this.#collect();
  }

  #collect() {
    // Any shop it drives close by counts, even one around the corner.
    for (const lot of this.pool) {
      if (distance(this, lot.center) > COLLECT_REACH) continue;
      this.pool.delete(lot);
      this.onCollect(lot);
    }
  }

  // A dark green armored truck with gold trim, on a pulsing gold halo that
  // grows as you zoom out so it's easy to spot on a big map.
  draw(ctx) {
    const z = Math.max(1, (ctx.viewZoom || 1) * 0.8);
    const pulse = (Math.sin(performance.now() / 250) + 1) / 2;
    ctx.beginPath();
    ctx.arc(this.x, this.y, (55 + 15 * pulse) * z, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(250, 204, 21, " + (0.18 + 0.12 * pulse) + ")";
    ctx.fill();
    ctx.lineWidth = 4 * z;
    ctx.strokeStyle = "rgba(250, 204, 21, 0.9)";
    ctx.stroke();

    super.draw(ctx);
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(-this.angle);
    ctx.fillStyle = "#facc15";
    ctx.fillRect(-this.width / 2, -4, this.width, 8); // gold stripe
    ctx.restore();

    // Zoomed out, a big 🚚 badge marks it from across town.
    if ((ctx.viewZoom || 1) > 2) {
      const r = 24 * z;
      ctx.beginPath();
      ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.lineWidth = 3 * z;
      ctx.strokeStyle = "#facc15";
      ctx.stroke();
      ctx.font = r * 1.2 + "px serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      uprightText(ctx, "🚚", this.x, this.y, 2 * z);
    }
  }
}

// ---------------------------------------------------------------------------
// Fire trucks and police cars: drive from their station to an emergency, work
// on scene, then drive back and park. `state` goes out → working → back → done.
// ---------------------------------------------------------------------------
const RESPONDER_REACH = 170; // close enough to the lot to start work

class Responder extends TownCar {
  constructor(graph, kind, station, inc, speed) {
    super(graph);
    this.kind = kind;
    this.station = station;
    this.inc = inc;
    this.state = "out";
    if (kind === "fire") [this.width, this.height, this.color] = [40, 80, "#dc2626"];
    else [this.width, this.height, this.color] = [32, 54, "#f8fafc"];
    this.maxSpeed = speed;
    this.spawn(graph.segments[station.segIndex]);
  }

  get goal() {
    return this.state === "back" ? this.station : this.inc.lot;
  }

  // Lights and sirens: right of way at intersections.
  get rushing() {
    return this.state === "out";
  }

  // Drive to the goal lot's road, then along it.
  destination(from, to) {
    if (!this.state) return null; // (not set yet while spawning)
    const seg = this.graph.segments[this.goal.segIndex];
    if (to === seg.p1) return seg.p2;
    if (to === seg.p2) return seg.p1;
    return distance(to, seg.p1) <= distance(to, seg.p2) ? seg.p1 : seg.p2;
  }

  // Twice per frame, like the collector: lights and sirens.
  update(others) {
    if (this.state === "working" || this.state === "done") return;
    for (let k = 0; k < 2; k++) {
      super.update(others);
      if (distance(this, this.goal.center) > RESPONDER_REACH) continue;
      this.state = this.state === "out" ? "arrived" : "done";
      return;
    }
  }

  draw(ctx) {
    super.draw(ctx);
    const t = performance.now() / 1000;
    const on = Math.sin(t * Math.PI * 6) > 0;
    const lit = this.state !== "back" && this.state !== "done";
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(-this.angle);
    const w = this.width, h = this.height;
    if (this.kind === "fire") {
      ctx.fillStyle = "#e5e7eb";
      ctx.fillRect(-4, -h * 0.25, 8, h * 0.65); // ladder
      ctx.fillStyle = "#9ca3af";
      for (let y = -h * 0.2; y < h * 0.38; y += 9) ctx.fillRect(-6, y, 12, 2);
    } else {
      ctx.fillStyle = "#111827";
      ctx.fillRect(-w / 2, -h * 0.12, w, h * 0.3); // black doors
    }
    // light bar across the cab
    const y = -h / 2 + h * (this.kind === "fire" ? 0.08 : 0.45);
    ctx.fillStyle = lit && on ? "#ef4444" : "#7f1d1d";
    ctx.fillRect(-w / 2 + 3, y, w / 2 - 3, 6);
    ctx.fillStyle = lit && !on ? "#3b82f6" : "#1e3a8a";
    ctx.fillRect(0, y, w / 2 - 3, 6);
    ctx.restore();
    if (lit) {
      const z = Math.max(1, (ctx.viewZoom || 1) * 0.8);
      ctx.beginPath();
      ctx.arc(this.x, this.y, 50 * z, 0, Math.PI * 2);
      ctx.fillStyle = on ? "rgba(239,68,68,0.18)" : "rgba(59,130,246,0.18)";
      ctx.fill();
      if ((ctx.viewZoom || 1) > 2) {
        ctx.font = 34 * z + "px serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        uprightText(ctx, SERVICES[this.kind].icon, this.x, this.y);
      }
    }
  }
}
