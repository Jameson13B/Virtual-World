// Text and emoji stay upright when the map is rotated: draws `text` at world
// (x, y), shifted `dy` pixels-in-world straight up the screen.
function uprightText(ctx, text, x, y, dy = 0, stroke = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-(ctx.viewAngle || 0));
  if (stroke) ctx.strokeText(text, 0, dy);
  ctx.fillText(text, 0, dy);
  ctx.restore();
}

// Flat-roofed building (shops, offices, civic buildings).
class Shop {
  constructor(poly, height, roof, { icon = null, walls = "#f4f1ea" } = {}) {
    this.base = poly;
    this.height = height;
    this.roof = roof;
    this.icon = icon;
    this.walls = walls;
    const b = poly.bounds;
    this.bounds = { minX: b.minX - height, minY: b.minY - height, maxX: b.maxX + height, maxY: b.maxY + height };
  }

  draw(ctx, viewPoint) {
    const pts = this.base.points;
    const top = pts.map((p) => getFake3dPoint(p, viewPoint, this.height * 0.6));
    const sides = pts.map((p, i) => new Polygon([p, pts[(i + 1) % pts.length], top[(i + 1) % pts.length], top[i]]));
    sides.sort((a, b) => b.distanceToPoint(viewPoint) - a.distanceToPoint(viewPoint));

    this.base.draw(ctx, { fill: "rgba(0,0,0,0.25)", stroke: "rgba(0,0,0,0.15)", lineWidth: 16 });
    for (const side of sides) side.draw(ctx, { fill: this.walls, stroke: "#b9b2a3", lineWidth: 2 });
    const ceiling = new Polygon(top);
    ceiling.draw(ctx, { fill: this.roof, stroke: "rgba(0,0,0,0.25)", lineWidth: 4 });
    if (this.icon) {
      const c = average(average(top[0], top[1]), average(top[2], top[3]));
      ctx.font = "56px serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      uprightText(ctx, this.icon, c.x, c.y);
    }
  }
}

const SHOP_COLORS = ["#4aa3df", "#f4b942", "#5cc28f", "#e57373", "#9b7fd1"];
const HOUSE_HEIGHTS = [0, 70, 130, 200];
const SHOP_HEIGHTS = [0, 60, 120, 230];
const RARITY_GLOW = { uncommon: "34,197,94", rare: "59,130,246", legendary: "245,158,11" };

class CityRenderer {
  constructor(city) {
    this.city = city;
    this.version = -1;
    this.treeCache = new Map();
    this.visuals = new Map();
  }

  #rebuild() {
    const g = this.city.layout.graph;
    this.envelopes = g.segments.map((s) => new Envelope(s, ROAD_W, 10));
    this.borders = Polygon.union(this.envelopes.map((e) => e.poly));
    this.treeCache.clear();
    this.version = this.city.version;
    const job = this.city.roadJob;
    this.pending = job ? new Segment(new Point(job.a.x, job.a.y), new Point(job.b.x, job.b.y)) : null;
    this.pendingEnvelope = this.pending ? new Envelope(this.pending, ROAD_W, 10) : null;
  }

  // ---- wilderness: an endless procedural forest, cleared where the city is ----
  #wildTree(cx, cy) {
    const key = cx + "," + cy;
    if (this.treeCache.has(key)) return this.treeCache.get(key);
    const seed = this.city.seed;
    const CELL = 190;
    const patch = hashInts(seed, 5, Math.floor(cx / 5), Math.floor(cy / 5)) % 100;
    const h = hashInts(seed, 3, cx, cy);
    let tree = null;
    if (h % 100 < 12 + patch * 0.55) {
      const jx = ((h >>> 8) % 1000) / 1000, jy = ((h >>> 18) % 1000) / 1000;
      const p = new Point(cx * CELL + jx * CELL * 0.8, cy * CELL + jy * CELL * 0.8);
      let ok = true;
      const roads = [...this.city.layout.graph.segments];
      if (this.pending) roads.push(this.pending);
      for (const s of roads) {
        if (s.distanceToPoint(p) < ROAD_W / 2 + 75) {
          ok = false;
          break;
        }
      }
      if (ok) {
        for (const lot of this.city.lots) {
          if (lot.poly.boundsDistance(p) < 55) {
            ok = false;
            break;
          }
        }
      }
      if (ok) tree = new Tree(p, 110 + (h % 45), { height: 140 + (h % 60), tint: ((h >>> 4) % 200) / 100 - 1 });
    }
    this.treeCache.set(key, tree);
    return tree;
  }

  #visualFor(lot) {
    const lvl = lot.effectiveLevel;
    const key = lot.kind + lvl + lot.special;
    const cached = this.visuals.get(lot.id);
    if (cached && cached.key === key) return cached.items;
    const pick = (arr) => arr[hashInts(this.city.seed, lot.id) % arr.length];
    const road = this.city.layout.graph.segments[lot.segIndex];
    let items = [];
    if (lvl >= 1) {
      if (lot.kind === "res") {
        items = [new Building(lot.poly, HOUSE_HEIGHTS[lvl], pick(ROOF_COLORS))];
      } else if (lot.kind === "com") {
        const roof = lvl === 3 ? "#7fb3d5" : pick(SHOP_COLORS);
        items = [new Shop(lot.poly, SHOP_HEIGHTS[lvl], roof, { walls: lvl === 3 ? "#dfe9f2" : "#f4f1ea" })];
      } else if (lot.kind === "ind") {
        items = [new LotModel(lot, road, "factory", lvl)];
      } else if (lot.kind === "special") {
        items = [new LotModel(lot, road, lot.special)];
        if (lot.special === "park") {
          const pts = lot.poly.points;
          for (let i = 0; i < 4; i++) {
            const h = hashInts(lot.id, i, 77);
            const u = 0.2 + ((h % 100) / 100) * 0.6, v = 0.25 + (((h >>> 8) % 100) / 100) * 0.5;
            const p = lerp2D(lerp2D(pts[0], pts[3], u), lerp2D(pts[1], pts[2], u), v);
            items.push(new Tree(p, 55 + (h % 20), { height: 90, tint: 0.5 }));
          }
        }
      }
    }
    this.visuals.set(lot.id, { key, items });
    return items;
  }

  // ---- drawing ---------------------------------------------------------------
  draw(ctx, viewport, { placing = false, selected = null, cars = [], player = null, floaters = [], now = 0 } = {}) {
    const city = this.city;
    if (city.version !== this.version) this.#rebuild();
    const view = viewport.getVisibleBounds();
    const vp = viewport.getViewPoint();
    const z = viewport.zoom;
    const visible = (b) => boundsOverlap(b, view);

    // lot grounds
    for (const lot of city.lots) {
      if (!visible(lot.poly.bounds)) continue;
      this.#drawLotGround(ctx, lot, placing, now, z, vp);
    }

    // road under construction
    if (this.pending && city.roadJob) {
      this.pendingEnvelope.draw(ctx, { fill: "rgba(150,110,60,0.55)", stroke: "rgba(120,85,40,0.7)", lineWidth: 6 });
      const p = clamp(city.roadJob.t / city.roadJob.duration, 0, 1);
      const head = lerp2D(this.pending.p1, this.pending.p2, p);
      new Segment(this.pending.p1, head).draw(ctx, { width: ROAD_W, color: "#AAA", cap: "round" });
      ctx.font = 40 * Math.max(1, z * 0.7) + "px serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      uprightText(ctx, "🚧", head.x, head.y);
    }

    // roads
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

    ctx.beginPath();
    for (const s of city.layout.graph.segments) {
      ctx.moveTo(s.p1.x, s.p1.y);
      ctx.lineTo(s.p2.x, s.p2.y);
    }
    ctx.setLineDash([10, 10]);
    ctx.lineWidth = 4;
    ctx.strokeStyle = "white";
    ctx.lineCap = "butt";
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    for (const s of this.borders) {
      ctx.moveTo(s.p1.x, s.p1.y);
      ctx.lineTo(s.p2.x, s.p2.y);
    }
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.stroke();

    for (const car of cars) if (visible({ minX: car.x - 40, minY: car.y - 40, maxX: car.x + 40, maxY: car.y + 40 })) car.draw(ctx);
    if (player) player.draw(ctx);

    // buildings and trees, far to near
    const items = [];
    for (const lot of city.lots) {
      if (!visible(lot.poly.bounds)) continue;
      for (const it of this.#visualFor(lot)) items.push(it);
    }
    const CELL = 190;
    const simpleTrees = z > 2.4;
    const x0 = Math.floor((view.minX - 200) / CELL), x1 = Math.ceil((view.maxX + 50) / CELL);
    const y0 = Math.floor((view.minY - 200) / CELL), y1 = Math.ceil((view.maxY + 50) / CELL);
    const wild = [];
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const t = this.#wildTree(cx, cy);
        if (t) wild.push(t);
      }
    }
    if (simpleTrees) {
      // Zoomed far out: cheap blobs keep phones smooth.
      ctx.fillStyle = "#2f6b2a";
      ctx.beginPath();
      for (const t of wild) {
        ctx.moveTo(t.center.x + t.size * 0.5, t.center.y);
        ctx.arc(t.center.x, t.center.y, t.size * 0.5, 0, Math.PI * 2);
      }
      ctx.fill();
    } else {
      items.push(...wild);
    }
    const keyed = items.map((item) => ({ item, d: distance(item.base.points[0], vp) }));
    keyed.sort((a, b) => b.d - a.d);
    for (const { item } of keyed) item.draw(ctx, vp, now);

    // coin bubbles and highlights on top
    for (const lot of city.lots) {
      if (!visible(lot.poly.bounds)) continue;
      if (city.bagReady(lot)) this.#drawBubble(ctx, lot, vp, z, now);
      if (placing && lot.kind && lot.kind !== "special") {
        // a special can replace this building too
        ctx.setLineDash([16, 12]);
        lot.poly.draw(ctx, { fill: "rgba(0,0,0,0)", stroke: "rgba(250,204,21,0.8)", lineWidth: 5 * Math.max(1, z * 0.6) });
        ctx.setLineDash([]);
      }
    }
    if (selected) {
      selected.poly.draw(ctx, { fill: "rgba(0,0,0,0)", stroke: "#facc15", lineWidth: 6 * Math.max(1, z * 0.6) });
    }
    for (const f of floaters) {
      const a = 1 - f.age / f.life;
      ctx.globalAlpha = Math.max(0, a);
      ctx.font = "bold " + 26 * Math.max(1, z * 0.8) + "px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 5 * Math.max(1, z * 0.8);
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.fillStyle = f.color || "#fde047";
      uprightText(ctx, f.text, f.x, f.y, -f.age * 60 * Math.max(1, z * 0.8), true);
      ctx.globalAlpha = 1;
    }
  }

  bubbleAnchor(lot, vp) {
    const h = lot.kind === "ind" ? 34 + lot.level * 8 : SHOP_HEIGHTS[Math.max(1, lot.effectiveLevel)] * 0.6;
    return getFake3dPoint(lot.center, vp, h + 30);
  }

  #drawBubble(ctx, lot, vp, z, now) {
    const p = this.bubbleAnchor(lot, vp);
    if (z > 2.2) {
      // Zoomed out: a small gold dot instead of a big bubble.
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7 * z, 0, Math.PI * 2);
      ctx.fillStyle = "#facc15";
      ctx.fill();
      return;
    }
    const bob = Math.sin(now / 300 + lot.id) * 4 * z;
    const r = 22 * Math.max(1, z * 0.75);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(-(ctx.viewAngle || 0)); // bob straight up the screen
    ctx.beginPath();
    ctx.arc(0, bob, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fill();
    ctx.lineWidth = 3 * Math.max(1, z * 0.6);
    ctx.strokeStyle = lot.kind === "ind" ? "#a16207" : "#f59e0b";
    ctx.stroke();
    ctx.font = r * 1.1 + "px serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(lot.kind === "ind" ? "📦" : "💰", 0, bob + 1);
    ctx.restore();
  }

  #drawLotGround(ctx, lot, placing, now, z, vp) {
    const empty = !lot.kind;
    if (lot.building > 0) {
      lot.poly.draw(ctx, { fill: "#b08b5a", stroke: "#8a6a40", lineWidth: 3 });
      ctx.font = 50 * Math.max(1, z * 0.5) + "px serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      uprightText(ctx, "🏗️", lot.center.x, lot.center.y);
      return;
    }
    if (empty) {
      if (placing) {
        const pulse = 0.25 + 0.2 * Math.sin(now / 200);
        lot.poly.draw(ctx, { fill: "rgba(250,204,21," + pulse + ")", stroke: "#facc15", lineWidth: 5 });
      } else {
        ctx.setLineDash([12, 10]);
        lot.poly.draw(ctx, { fill: "rgba(255,255,255,0.07)", stroke: "rgba(255,255,255,0.35)", lineWidth: 3 });
        ctx.setLineDash([]);
      }
      return;
    }
    if (lot.kind === "special" || lot.kind === "ind") {
      const model = this.#visualFor(lot).find((it) => it instanceof LotModel);
      if (!model) return;
      lot.poly.draw(ctx, { fill: model.spec.floor, stroke: "rgba(0,0,0,0.12)", lineWidth: 4 });
      const glow = lot.kind === "special" && RARITY_GLOW[SPECIALS[lot.special].rarity];
      if (glow) {
        // a soft rarity-colored halo around the lot
        const a = 0.35 + 0.2 * Math.sin(now / 500 + lot.id);
        lot.poly.draw(ctx, { fill: "rgba(0,0,0,0)", stroke: "rgba(" + glow + "," + a.toFixed(2) + ")", lineWidth: 12 * Math.max(1, z * 0.5) });
      }
      model.drawGround(ctx, vp, now);
    } else if (lot.kind === "res") {
      lot.poly.draw(ctx, { fill: "#6fae5a", stroke: "rgba(0,0,0,0)", lineWidth: 0 }); // garden
    } else if (lot.kind === "com") {
      lot.poly.draw(ctx, { fill: "#9a9a9a", stroke: "rgba(0,0,0,0)", lineWidth: 0 }); // parking lot
    }
  }
}
