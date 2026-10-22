// Procedural starter worlds + automatic road markings.
class Samples {
  // The hand-tuned world you see on first launch.
  static sampleCity() {
    const rng = createRNG(2024);
    const { graph, grid } = Samples.#grid(5, 4, 600, 0, rng);
    Samples.#prune(graph, 3, rng);
    Samples.#arc(graph, grid[0][4], grid[3][4]);
    // a winding country road heading west
    let prev = grid[1][0];
    for (const off of [[-450, 80], [-850, -60], [-1250, 140], [-1600, 40]]) {
      const p = new Point(grid[1][0].x + off[0], grid[1][0].y + off[1]);
      graph.addPoint(p);
      graph.tryAddSegment(new Segment(prev, p));
      prev = p;
    }
    const world = new World(graph, { seed: 2024 });
    Samples.decorate(world, rng);
    return world;
  }

  static randomCity(seed = Math.floor(Math.random() * 1e9)) {
    const rng = createRNG(seed);
    const cols = 4 + Math.floor(rng() * 4);
    const rows = 3 + Math.floor(rng() * 3);
    const spacing = 560 + Math.floor(rng() * 200);
    const { graph, grid } = Samples.#grid(cols, rows, spacing, spacing * 0.12, rng);
    Samples.#prune(graph, Math.floor(graph.segments.length * (0.08 + rng() * 0.12)), rng);
    if (rng() < 0.7) Samples.#arc(graph, grid[0][cols - 1], grid[rows - 1][cols - 1]);
    if (rng() < 0.4) Samples.#arc(graph, grid[rows - 1][0], grid[0][0]);
    const world = new World(graph, { seed });
    Samples.decorate(world, rng);
    return world;
  }

  static #grid(cols, rows, spacing, jitter, rng) {
    const grid = [];
    const points = [];
    for (let r = 0; r < rows; r++) {
      grid.push([]);
      for (let c = 0; c < cols; c++) {
        const p = new Point(
          Math.round(c * spacing - ((cols - 1) * spacing) / 2 + (rng() - 0.5) * jitter),
          Math.round(r * spacing - ((rows - 1) * spacing) / 2 + (rng() - 0.5) * jitter)
        );
        grid[r].push(p);
        points.push(p);
      }
    }
    const segments = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (c + 1 < cols) segments.push(new Segment(grid[r][c], grid[r][c + 1]));
        if (r + 1 < rows) segments.push(new Segment(grid[r][c], grid[r + 1][c]));
      }
    }
    return { graph: new Graph(points, segments), grid };
  }

  // Half-circle road bulging outward between two points.
  static #arc(graph, a, b, steps = 14) {
    const mid = average(a, b);
    const r = distance(a, b) / 2;
    const base = angle(subtract(a, mid));
    let prev = a;
    for (let i = 1; i < steps; i++) {
      const t = base + (i / steps) * Math.PI;
      const p = new Point(Math.round(mid.x + Math.cos(t) * r), Math.round(mid.y + Math.sin(t) * r));
      graph.addPoint(p);
      graph.tryAddSegment(new Segment(prev, p));
      prev = p;
    }
    graph.tryAddSegment(new Segment(prev, b));
  }

  // Removes random roads while keeping the network connected.
  static #prune(graph, count, rng) {
    let removed = 0;
    for (let tries = 0; tries < count * 10 && removed < count; tries++) {
      const seg = graph.segments[Math.floor(rng() * graph.segments.length)];
      graph.removeSegment(seg);
      if (Samples.#connected(graph)) removed++;
      else graph.addSegment(seg);
    }
  }

  static #connected(graph) {
    if (!graph.points.length) return true;
    if (graph.points.some((p) => !graph.getSegmentsWithPoint(p).length)) return false;
    const seen = new Set([graph.points[0]]);
    const stack = [graph.points[0]];
    while (stack.length) {
      const p = stack.pop();
      for (const s of graph.getSegmentsWithPoint(p)) {
        const n = s.p1 === p ? s.p2 : s.p1;
        if (!seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    return seen.size === graph.points.length;
  }

  // junctions, some zebra crossings and parking spots, a start and a target.
  static decorate(world, rng = Math.random) {
    const g = world.graph;
    const rw = world.roadWidth;
    const marks = [];
    const neighbors = (p) => g.getSegmentsWithPoint(p).map((s) => (s.p1 === p ? s.p2 : s.p1));
    const lanePoint = (from, to, distFromTo) => {
      const d = normalize(subtract(to, from));
      return { c: add(subtract(to, scale(d, distFromTo)), scale(perpendicular(d), rw / 4)), d };
    };

    for (const p of g.points) {
      const ns = neighbors(p);
      if (ns.length < 3) continue;
      for (const q of ns) {
        if (distance(p, q) < rw * 3) continue;
        if (ns.length >= 4) {
          const [w, h] = MarkingTypes.light.size(rw);
          const { c, d } = lanePoint(q, p, rw * 0.75);
          marks.push(new Light(c, d, w, h));
        } else {
          const useYield = rng() < 0.3;
          const spec = useYield ? MarkingTypes.yield : MarkingTypes.stop;
          const [w, h] = spec.size(rw);
          const { c, d } = lanePoint(q, p, rw * 0.6 + h / 2);
          marks.push(new spec.cls(c, d, w, h));
        }
      }
    }

    const long = g.segments.filter((s) => s.length() > rw * 5);
    const shuffled = [...long].sort(() => rng() - 0.5);
    const crossings = shuffled.slice(0, Math.ceil(long.length * 0.3));
    for (const s of crossings) {
      const [w, h] = MarkingTypes.crossing.size(rw);
      marks.push(new Crossing(average(s.p1, s.p2), s.directionVector(), w, h));
    }
    const parkingSegs = shuffled.slice(crossings.length, crossings.length + 3);
    for (const s of parkingSegs) {
      const [w, h] = MarkingTypes.parking.size(rw);
      const d = s.directionVector();
      const c = add(lerp2D(s.p1, s.p2, 0.3), scale(perpendicular(d), rw / 4));
      marks.push(new Parking(c, d, w, h));
    }

    // Start near the middle, target as far away as possible.
    if (g.segments.length) {
      const center = average(new Point(world.bounds.minX, world.bounds.minY), new Point(world.bounds.maxX, world.bounds.maxY));
      const startSeg = getNearestSegment(center, g.segments.filter((s) => !crossings.includes(s) && !parkingSegs.includes(s))) || g.segments[0];
      const sd = startSeg.directionVector();
      const [sw, sh] = MarkingTypes.start.size(rw);
      const startC = add(lerp2D(startSeg.p1, startSeg.p2, 0.3), scale(perpendicular(sd), rw / 4));
      marks.push(new Start(startC, sd, sw, sh));

      let far = g.points[0];
      for (const p of g.points) if (distance(p, startC) > distance(far, startC)) far = p;
      const tSeg = g.getSegmentsWithPoint(far)[0];
      if (tSeg) {
        const other = tSeg.p1 === far ? tSeg.p2 : tSeg.p1;
        const { c, d } = lanePoint(other, far, Math.min(rw * 1.5, distance(far, other) / 2));
        const [tw, th] = MarkingTypes.target.size(rw);
        marks.push(new Target(c, d, tw, th));
      }
    }

    world.markings = marks;
    return world;
  }
}
