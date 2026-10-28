// ---------------------------------------------------------------------------
// City layout: the road network and the building lots along it.
//
// Roads grow one at a time. The k-th road depends only on the city's seed and
// the roads before it, so every player's city is unique, and a shared city can
// be rebuilt exactly on another phone. Only +,-,*,/ and sqrt are used for
// geometry here because those give identical results on every device
// (unlike sin/cos/hypot).
// ---------------------------------------------------------------------------

const ROAD_W = 100;
const LOT_DEPTH = 120;
const LOT_GAP = 20;
const NODE_MARGIN = 72; // lots keep this far from junctions so roads can branch
const ROAD_GAP = 400; // min distance between unrelated roads (fits two rows of lots)

function hashInts(...nums) {
  let h = 0x811c9dc5;
  for (const n of nums) {
    h = Math.imul(h ^ (n | 0), 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
  }
  return h >>> 0;
}

// 53-bit string hash (cyrb53)
function hashString(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function rectAround(a, b, halfWidth) {
  const n = scale(perpendicular(normalize(subtract(b, a))), halfWidth);
  return new Polygon([add(a, n), add(b, n), subtract(b, n), subtract(a, n)]);
}

function segmentDistance(s1, s2) {
  if (getIntersection(s1.p1, s1.p2, s2.p1, s2.p2)) return 0;
  return Math.min(
    s1.distanceToPoint(s2.p1), s1.distanceToPoint(s2.p2),
    s2.distanceToPoint(s1.p1), s2.distanceToPoint(s1.p2)
  );
}

class Lot {
  constructor(id, poly, segIndex) {
    this.id = id;
    this.poly = poly;
    this.segIndex = segIndex;
    this.center = average(average(poly.points[0], poly.points[1]), average(poly.points[2], poly.points[3]));
    // game state
    this.kind = null; // null | "res" | "com" | "ind" | "special"
    this.level = 0;
    this.building = 0; // seconds of construction left
    this.coins = 0;
    this.special = null;
  }

  get effectiveLevel() {
    return this.building > 0 ? this.level - 1 : this.level;
  }
}

class CityLayout {
  constructor(seed, graphInfo = null) {
    this.seed = seed;
    this.lots = [];
    this.roadRects = [];
    if (graphInfo) {
      // Rebuild lots in road order, exactly as they were created during play.
      const saved = Graph.load(graphInfo);
      this.graph = new Graph(saved.points, []);
      for (const seg of saved.segments) this.#attach(seg);
    } else {
      this.graph = new Graph();
      this.#found();
    }
  }

  #found() {
    const rng = createRNG(hashInts(this.seed, 1));
    let dir = normalize(new Point(rng() * 2 - 1, (rng() * 2 - 1) * 0.5));
    if (magnitude(dir) === 0) dir = new Point(1, 0);
    const half = 230 + Math.floor(rng() * 60);
    const a = new Point(Math.round(-dir.x * half), Math.round(-dir.y * half));
    const b = new Point(Math.round(dir.x * half), Math.round(dir.y * half));
    this.graph.addPoint(a);
    this.graph.addPoint(b);
    this.#attach(new Segment(a, b));
  }

  #attach(seg) {
    this.graph.addSegment(seg);
    this.roadRects.push(rectAround(seg.p1, seg.p2, ROAD_W / 2 + LOT_GAP / 2));
    this.#lotsFor(seg, this.graph.segments.length - 1);
  }

  degree(p) {
    return this.graph.getSegmentsWithPoint(p).length;
  }

  incidentDirs(p) {
    return this.graph.getSegmentsWithPoint(p).map((s) => normalize(subtract(s.p1 === p ? s.p2 : s.p1, p)));
  }

  // Proposes the next road. Deterministic for a given seed + existing roads.
  nextRoad() {
    const k = this.graph.segments.length;
    const rng = createRNG(hashInts(this.seed, 7919, k));
    const pool = [];
    for (const p of this.graph.points) {
      const w = [0, 6, 2, 1, 0][Math.min(4, this.degree(p))];
      for (let i = 0; i < w; i++) pool.push(p);
    }
    if (!pool.length) return null;

    for (let attempt = 0; attempt < 160; attempt++) {
      const a = pool[Math.floor(rng() * pool.length)];
      const dirs = this.incidentDirs(a);
      let base, jitter;
      if (dirs.length === 1) {
        const back = scale(dirs[0], -1);
        const r = rng();
        base = r < 0.55 ? back : r < 0.775 ? perpendicular(back) : scale(perpendicular(back), -1);
        jitter = 0.36;
      } else {
        const d = dirs[Math.floor(rng() * dirs.length)];
        base = rng() < 0.5 ? perpendicular(d) : scale(perpendicular(d), -1);
        jitter = 0.08;
      }
      const dir = normalize(add(base, scale(perpendicular(base), (rng() - 0.5) * jitter)));
      const len = 380 + rng() * 260;
      const target = new Point(Math.round(a.x + dir.x * len), Math.round(a.y + dir.y * len));

      // Occasionally join up with a nearby junction to form blocks and loops.
      let end = target, snapped = false;
      const near = getNearestPoint(target, this.graph.points.filter((p) => p !== a), 230);
      if (near) {
        end = near;
        snapped = true;
      }
      if (this.isValidRoad(a, end, snapped)) return { a, b: end };
    }
    return null;
  }

  isValidRoad(a, e, snapped) {
    if (distance(a, e) < 300) return false;
    const dir = normalize(subtract(e, a));
    if (this.incidentDirs(a).some((d) => dot(d, dir) > 0.5)) return false;
    if (snapped) {
      if (this.graph.getSegment(a, e) || this.degree(e) >= 4) return false;
      const back = scale(dir, -1);
      if (this.incidentDirs(e).some((d) => dot(d, back) > 0.5)) return false;
    }
    const seg = new Segment(a, e);
    for (const s of this.graph.segments) {
      const touchesA = s.includes(a);
      const touchesE = snapped && s.includes(e);
      if (touchesA || touchesE) continue;
      if (segmentDistance(seg, s) < ROAD_GAP) return false;
    }
    const clearance = rectAround(a, e, ROAD_W / 2 + LOT_GAP / 2);
    for (const lot of this.lots) {
      if (!boundsOverlap(lot.poly.bounds, clearance.bounds)) continue;
      if (lot.poly.intersectsPoly(clearance) || clearance.containsPoint(lot.center)) return false;
    }
    return true;
  }

  addRoad(a, b) {
    const pa = this.graph.containsPoint(a) || this.#newPoint(a);
    const pb = this.graph.containsPoint(b) || this.#newPoint(b);
    const before = this.lots.length;
    this.#attach(new Segment(pa, pb));
    return this.lots.slice(before);
  }

  #newPoint(p) {
    const point = new Point(p.x, p.y);
    this.graph.addPoint(point);
    return point;
  }

  #lotsFor(seg, index) {
    const rng = createRNG(hashInts(this.seed, 31, index));
    const a = seg.p1;
    const len = distance(seg.p1, seg.p2);
    const d = normalize(subtract(seg.p2, seg.p1));
    const n = perpendicular(d);
    const offset = ROAD_W / 2 + LOT_GAP + LOT_DEPTH / 2;
    const hd = LOT_DEPTH / 2;

    for (const side of [1, -1]) {
      let t = NODE_MARGIN;
      while (true) {
        let L = 105 + rng() * 60;
        if (t + L > len - NODE_MARGIN) {
          L = len - NODE_MARGIN - t;
          if (L < 90) break;
        }
        const q1 = add(add(a, scale(d, t)), scale(n, side * offset));
        const q2 = add(q1, scale(d, L));
        const poly = new Polygon([
          add(q1, scale(n, -hd)), add(q1, scale(n, hd)),
          add(q2, scale(n, hd)), add(q2, scale(n, -hd)),
        ]);
        if (this.#lotFits(poly)) this.lots.push(new Lot(this.lots.length, poly, index));
        t += L + LOT_GAP;
      }
    }
  }

  #lotFits(poly) {
    const center = average(poly.points[0], poly.points[2]);
    for (const rect of this.roadRects) {
      if (!boundsOverlap(rect.bounds, poly.bounds)) continue;
      if (rect.intersectsPoly(poly) || rect.containsPoint(center)) return false;
    }
    for (const p of this.graph.points) {
      if (poly.boundsDistance(p) < ROAD_W / 2 + LOT_GAP && poly.distanceToPoint(p) < ROAD_W / 2 + LOT_GAP / 2) return false;
    }
    for (const lot of this.lots) {
      if (!boundsOverlap(lot.poly.bounds, poly.bounds, LOT_GAP)) continue;
      if (lot.poly.intersectsPoly(poly) || lot.poly.containsPoint(center) || poly.containsPoint(lot.center)) return false;
      if (lot.poly.distanceToPoly(poly) < LOT_GAP * 0.5) return false;
    }
    return true;
  }

  bounds() {
    const b = boundsOf(this.graph.points.length ? this.graph.points : [new Point(0, 0)]);
    const pad = ROAD_W / 2 + LOT_GAP + LOT_DEPTH;
    return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
  }
}
