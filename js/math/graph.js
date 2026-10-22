// The road network: points (intersections / bends) connected by segments.
// `version` increments on every change so the world knows when to regenerate.
class Graph {
  constructor(points = [], segments = []) {
    this.points = points;
    this.segments = segments;
    this.version = 0;
  }

  static load(info) {
    const byKey = new Map();
    const key = (p) => p.x + "," + p.y;
    const points = [];
    for (const i of info.points) {
      if (byKey.has(key(i))) continue;
      const p = new Point(i.x, i.y);
      byKey.set(key(i), p);
      points.push(p);
    }
    const segments = info.segments
      .map((i) => new Segment(byKey.get(key(i.p1)), byKey.get(key(i.p2)), !!i.oneWay))
      .filter((s) => s.p1 && s.p2 && s.p1 !== s.p2);
    return new Graph(points, segments);
  }

  toJSON() {
    return {
      points: this.points.map((p) => ({ x: p.x, y: p.y })),
      segments: this.segments.map((s) => ({
        p1: { x: s.p1.x, y: s.p1.y },
        p2: { x: s.p2.x, y: s.p2.y },
        ...(s.oneWay ? { oneWay: true } : {}),
      })),
    };
  }

  changed() {
    this.version++;
  }

  addPoint(point) {
    this.points.push(point);
    this.changed();
  }

  containsPoint(point) {
    return this.points.find((p) => p.equals(point));
  }

  tryAddPoint(point) {
    if (!this.containsPoint(point)) {
      this.addPoint(point);
      return true;
    }
    return false;
  }

  removePoint(point) {
    for (const seg of this.getSegmentsWithPoint(point)) this.removeSegment(seg);
    this.points.splice(this.points.indexOf(point), 1);
    this.changed();
  }

  addSegment(seg) {
    this.segments.push(seg);
    this.changed();
  }

  containsSegment(seg) {
    return this.segments.find((s) => s.equals(seg));
  }

  tryAddSegment(seg) {
    if (!this.containsSegment(seg) && !seg.p1.equals(seg.p2)) {
      this.addSegment(seg);
      return true;
    }
    return false;
  }

  removeSegment(seg) {
    const i = this.segments.indexOf(seg);
    if (i >= 0) this.segments.splice(i, 1);
    this.changed();
  }

  // Inserts `point` into the middle of `seg`, creating a junction.
  splitSegment(seg, point) {
    this.removeSegment(seg);
    this.addPoint(point);
    this.tryAddSegment(new Segment(seg.p1, point, seg.oneWay));
    this.tryAddSegment(new Segment(point, seg.p2, seg.oneWay));
  }

  getSegmentsWithPoint(point) {
    return this.segments.filter((seg) => seg.includes(point));
  }

  getSegmentsLeavingFromPoint(point) {
    return this.segments.filter((seg) =>
      seg.oneWay ? seg.p1.equals(point) : seg.includes(point)
    );
  }

  getSegment(a, b) {
    return this.segments.find(
      (s) => (s.p1 === a && s.p2 === b) || (s.p1 === b && s.p2 === a)
    );
  }

  // Dijkstra with a binary heap; respects one-way segments.
  getShortestPath(start, end) {
    if (!start || !end) return [];
    if (start === end) return [start];
    const adj = new Map(this.points.map((p) => [p, []]));
    for (const seg of this.segments) {
      adj.get(seg.p1)?.push(seg.p2);
      if (!seg.oneWay) adj.get(seg.p2)?.push(seg.p1);
    }
    const dist = new Map([[start, 0]]);
    const prev = new Map();
    const heap = new MinHeap();
    heap.push(0, start);
    while (heap.size) {
      const { key: d, value: cur } = heap.pop();
      if (d > (dist.get(cur) ?? Infinity)) continue;
      if (cur === end) break;
      for (const n of adj.get(cur) || []) {
        const alt = d + distance(cur, n);
        if (alt < (dist.get(n) ?? Infinity)) {
          dist.set(n, alt);
          prev.set(n, cur);
          heap.push(alt, n);
        }
      }
    }
    if (!prev.has(end)) return [];
    const path = [end];
    let c = end;
    while (prev.has(c)) {
      c = prev.get(c);
      path.unshift(c);
    }
    return path;
  }

  dispose() {
    this.points.length = 0;
    this.segments.length = 0;
    this.changed();
  }

  draw(ctx, { scale = 1, showOneWay = false } = {}) {
    ctx.beginPath();
    for (const seg of this.segments) {
      ctx.moveTo(seg.p1.x, seg.p1.y);
      ctx.lineTo(seg.p2.x, seg.p2.y);
    }
    ctx.lineWidth = 2 * scale;
    ctx.strokeStyle = "black";
    ctx.stroke();

    if (showOneWay) {
      ctx.fillStyle = "#f59e0b";
      for (const seg of this.segments) {
        if (!seg.oneWay) continue;
        const mid = average(seg.p1, seg.p2);
        const a = angle(seg.directionVector());
        const s = 12 * scale;
        ctx.beginPath();
        ctx.moveTo(mid.x + Math.cos(a) * s, mid.y + Math.sin(a) * s);
        ctx.lineTo(mid.x + Math.cos(a + 2.5) * s, mid.y + Math.sin(a + 2.5) * s);
        ctx.lineTo(mid.x + Math.cos(a - 2.5) * s, mid.y + Math.sin(a - 2.5) * s);
        ctx.closePath();
        ctx.fill();
      }
    }

    for (const point of this.points) {
      point.draw(ctx, { size: 18 * scale });
    }
  }
}

class MinHeap {
  constructor() {
    this.items = [];
  }
  get size() {
    return this.items.length;
  }
  push(key, value) {
    const a = this.items;
    a.push({ key, value });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].key <= a[i].key) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      while (true) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].key < a[m].key) m = l;
        if (r < a.length && a[r].key < a[m].key) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}
