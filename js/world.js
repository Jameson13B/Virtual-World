class World {
  static defaultSettings = {
    roadWidth: 100,
    roadRoundness: 10,
    buildingWidth: 150,
    buildingMinLength: 150,
    spacing: 50,
    treeSize: 160,
    maxTrees: 1200,
    buildingsEnabled: true,
    treesEnabled: true,
    seed: 1,
  };

  constructor(graph, settings = {}) {
    this.graph = graph;
    this.settings = { ...World.defaultSettings, ...settings };

    this.envelopes = [];
    this.roadBorders = [];
    this.laneGuides = [];
    this.buildings = [];
    this.trees = [];
    this.intersections = [];
    this.markings = [];

    this.frameCount = 0;
    this.generatedVersion = -1;
    this.generatedQuick = false;
    this.bounds = { minX: -500, minY: -500, maxX: 500, maxY: 500 };

    this.generate();
  }

  get roadWidth() {
    return this.settings.roadWidth;
  }

  static load(info) {
    const world = new World(Graph.load(info.graph), info.settings || {});
    world.markings = (info.markings || []).map((m) => Marking.load(m)).filter(Boolean);
    return world;
  }

  toJSON() {
    return {
      format: "virtual-world",
      version: 1,
      settings: this.settings,
      graph: this.graph.toJSON(),
      markings: this.markings.map((m) => m.toJSON()),
    };
  }

  // quick = roads only (used while dragging points so editing stays smooth)
  generate({ quick = false } = {}) {
    const s = this.settings;
    this.envelopes = this.graph.segments.map((seg) => new Envelope(seg, s.roadWidth, s.roadRoundness));
    this.roadBorders = Polygon.union(this.envelopes.map((e) => e.poly));
    this.intersections = this.graph.points.filter((p) => this.graph.getSegmentsWithPoint(p).length > 2);

    if (!quick) {
      const rng = createRNG(s.seed);
      this.laneGuides = this.#generateLaneGuides();
      this.buildings = s.buildingsEnabled ? this.#generateBuildings(rng) : [];
      this.trees = s.treesEnabled ? this.#generateTrees(rng) : [];
    }
    this.#computeBounds();
    this.generatedVersion = this.graph.version;
    this.generatedQuick = quick;
  }

  #generateLaneGuides() {
    const tmpEnvelopes = this.graph.segments.map(
      (seg) => new Envelope(seg, this.settings.roadWidth / 2, this.settings.roadRoundness)
    );
    return Polygon.union(tmpEnvelopes.map((e) => e.poly));
  }

  #generateBuildings(rng) {
    const s = this.settings;
    const tmpEnvelopes = this.graph.segments.map(
      (seg) => new Envelope(seg, s.roadWidth + s.buildingWidth + s.spacing * 2, s.roadRoundness)
    );
    const guides = Polygon.union(tmpEnvelopes.map((e) => e.poly)).filter(
      (seg) => seg.length() >= s.buildingMinLength
    );

    const supports = [];
    for (let seg of guides) {
      const len = seg.length() + s.spacing;
      const buildingCount = Math.floor(len / (s.buildingMinLength + s.spacing));
      const buildingLength = len / buildingCount - s.spacing;
      const dir = seg.directionVector();

      let q1 = seg.p1;
      let q2 = add(q1, scale(dir, buildingLength));
      supports.push(new Segment(q1, q2));
      for (let i = 2; i <= buildingCount; i++) {
        q1 = add(q2, scale(dir, s.spacing));
        q2 = add(q1, scale(dir, buildingLength));
        supports.push(new Segment(q1, q2));
      }
    }

    const bases = supports.map((seg) => new Envelope(seg, s.buildingWidth).poly);

    const eps = 0.001;
    for (let i = 0; i < bases.length - 1; i++) {
      for (let j = i + 1; j < bases.length; j++) {
        if (!boundsOverlap(bases[i].bounds, bases[j].bounds, s.spacing)) continue;
        if (bases[i].intersectsPoly(bases[j]) || bases[i].distanceToPoly(bases[j]) < s.spacing - eps) {
          bases.splice(j, 1);
          j--;
        }
      }
    }

    return bases.map((b) => {
      const height = lerp(150, 260, rng());
      const roof = ROOF_COLORS[Math.floor(rng() * ROOF_COLORS.length)];
      return new Building(b, height, roof);
    });
  }

  #generateTrees(rng) {
    const s = this.settings;
    const points = [];
    for (const seg of this.roadBorders) points.push(seg.p1, seg.p2);
    for (const b of this.buildings) points.push(...b.base.points);
    if (!points.length || s.maxTrees <= 0) return [];

    const { minX: left, maxX: right, minY: top, maxY: bottom } = boundsOf(points);
    const illegalPolys = [...this.buildings.map((b) => b.base), ...this.envelopes.map((e) => e.poly)];
    const size = s.treeSize;

    const trees = [];
    let tryCount = 0;
    while (tryCount < 100 && trees.length < s.maxTrees) {
      const p = new Point(lerp(left, right, rng()), lerp(top, bottom, rng()));

      // not on a road or building
      let keep = true;
      for (const poly of illegalPolys) {
        if (poly.boundsDistance(p) > size / 2) continue;
        if (poly.containsPoint(p) || poly.distanceToPoint(p) < size / 2) {
          keep = false;
          break;
        }
      }

      // not overlapping other trees
      if (keep) {
        for (const tree of trees) {
          if (distance(tree.center, p) < size) {
            keep = false;
            break;
          }
        }
      }

      // close to something (no trees in the middle of nowhere)
      if (keep) {
        let closeToSomething = false;
        for (const poly of illegalPolys) {
          if (poly.boundsDistance(p) < size * 2 && poly.distanceToPoint(p) < size * 2) {
            closeToSomething = true;
            break;
          }
        }
        keep = closeToSomething;
      }

      if (keep) {
        trees.push(new Tree(p, size * lerp(0.85, 1.1, rng()), { tint: rng() * 2 - 1 }));
        tryCount = 0;
      }
      tryCount++;
    }
    return trees;
  }

  #computeBounds() {
    if (!this.graph.points.length) {
      this.bounds = { minX: -500, minY: -500, maxX: 500, maxY: 500 };
      return;
    }
    const b = boundsOf(this.graph.points);
    const pad = this.settings.roadWidth / 2 + this.settings.buildingWidth + this.settings.spacing;
    this.bounds = { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
  }

  update() {
    this.#updateLights();
    this.frameCount++;
  }

  // Lights are grouped by their nearest intersection. Lights facing the same
  // axis (e.g. north + south) share a phase; phases take turns being green.
  #updateLights() {
    const lights = this.markings.filter((m) => m.type === "light");
    if (!lights.length) return;
    const centers = this.intersections.length ? this.intersections : this.graph.points;
    if (!centers.length) return;

    const groups = new Map();
    for (const light of lights) {
      const c = getNearestPoint(light.center, centers);
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c).push(light);
    }

    const greenDuration = 3, yellowDuration = 1;
    const tick = Math.floor(this.frameCount / 60);
    for (const group of groups.values()) {
      const phases = [];
      for (const light of group) {
        const phase = phases.find((p) => Math.abs(dot(p.dir, light.directionVector)) > 0.7);
        if (phase) phase.lights.push(light);
        else phases.push({ dir: light.directionVector, lights: [light] });
      }
      const cycle = phases.length * (greenDuration + yellowDuration);
      const cTick = tick % cycle;
      const active = Math.floor(cTick / (greenDuration + yellowDuration));
      const state = cTick % (greenDuration + yellowDuration) < greenDuration ? "green" : "yellow";
      phases.forEach((p, i) => p.lights.forEach((l) => (l.state = i === active ? state : "red")));
    }
  }

  draw(ctx, viewPoint, { view = null, route = null, drawCars = null, showItems = true } = {}) {
    const visible = (b) => !view || boundsOverlap(b, view);

    // road surface (batched into one path)
    ctx.beginPath();
    for (const env of this.envelopes) {
      if (!visible(env.poly.bounds)) continue;
      const pts = env.poly.points;
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
    }
    ctx.fillStyle = "#BBB";
    ctx.strokeStyle = "#BBB";
    ctx.lineWidth = 15;
    ctx.lineJoin = "round";
    ctx.fill();
    ctx.stroke();

    // centre lines (skip one-way roads)
    ctx.beginPath();
    for (const seg of this.graph.segments) {
      if (seg.oneWay) continue;
      ctx.moveTo(seg.p1.x, seg.p1.y);
      ctx.lineTo(seg.p2.x, seg.p2.y);
    }
    ctx.setLineDash([10, 10]);
    ctx.lineWidth = 4;
    ctx.strokeStyle = "white";
    ctx.lineCap = "butt";
    ctx.stroke();
    ctx.setLineDash([]);

    for (const m of this.markings) {
      if (visible(m.poly.bounds)) m.draw(ctx);
    }

    // road borders
    ctx.beginPath();
    for (const seg of this.roadBorders) {
      ctx.moveTo(seg.p1.x, seg.p1.y);
      ctx.lineTo(seg.p2.x, seg.p2.y);
    }
    ctx.lineWidth = 4;
    ctx.strokeStyle = "white";
    ctx.lineCap = "round";
    ctx.stroke();

    if (route && route.length > 1) {
      ctx.beginPath();
      ctx.moveTo(route[0].x, route[0].y);
      for (let i = 1; i < route.length; i++) ctx.lineTo(route[i].x, route[i].y);
      ctx.strokeStyle = "rgba(37,99,235,0.45)";
      ctx.lineWidth = 16;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke();
    }

    if (drawCars) drawCars(ctx);

    // buildings & trees, painted far-to-near for the fake 3D effect
    if (showItems && !this.generatedQuick) {
      const items = [];
      for (const item of this.buildings) if (visible(item.bounds)) items.push(item);
      for (const item of this.trees) if (visible(item.bounds)) items.push(item);
      const keyed = items.map((item) => ({ item, d: item.base.distanceToPoint(viewPoint) }));
      keyed.sort((a, b) => b.d - a.d);
      for (const { item } of keyed) item.draw(ctx, viewPoint);
    }
  }
}
