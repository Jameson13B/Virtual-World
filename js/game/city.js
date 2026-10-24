// ---------------------------------------------------------------------------
// City state + economy.
//
//   🧱 materials  -> roads get built automatically when you can afford one
//   new roads     -> new empty lots
//   empty lots    -> develop on their own into homes 🏠 or shops 🏪 (by demand)
//   homes         -> room for people 👥     shops -> jobs + 💰 to collect
//   specials      -> parks, schools, towers… raise ✨ appeal (faster growth)
// ---------------------------------------------------------------------------

const TIERS = [
  { pop: 0, name: "Hamlet", icon: "🏕️" },
  { pop: 10, name: "Village", icon: "🏡", reward: 30 },
  { pop: 40, name: "Town", icon: "🏘️", reward: 60 },
  { pop: 120, name: "City", icon: "🏙️", reward: 120 },
  { pop: 400, name: "Metropolis", icon: "🌆", reward: 250 },
  { pop: 1000, name: "Megalopolis", icon: "🌃", reward: 500 },
  { pop: 2500, name: "Metroplex", icon: "🌉", reward: 2000 },
  { pop: 5000, name: "Capital", icon: "🏛️", reward: 5000 },
  { pop: 10000, name: "Global City", icon: "🌍", reward: 12000 },
];

const SPECIALS = {
  park: { icon: "🌳", name: "Park", rarity: "uncommon", appeal: 0.15, style: "park" },
  fountain: { icon: "⛲", name: "Fountain", rarity: "uncommon", appeal: 0.12, style: "plaza" },
  carousel: { icon: "🎠", name: "Carousel", rarity: "uncommon", appeal: 0.12, style: "plaza" },
  school: { icon: "🏫", name: "School", rarity: "rare", appeal: 0.3, style: "civic", color: "#e0a63a", height: 110 },
  clinic: { icon: "🏥", name: "Clinic", rarity: "rare", appeal: 0.3, style: "civic", color: "#dfe7ec", height: 120 },
  fire: { icon: "🚒", name: "Fire Station", rarity: "rare", appeal: 0.25, style: "civic", color: "#c0392b", height: 90 },
  library: { icon: "📚", name: "Library", rarity: "rare", appeal: 0.25, style: "civic", color: "#8e6c4a", height: 100 },
  tower: { icon: "🗼", name: "Sky Tower", rarity: "legendary", appeal: 0.6, style: "civic", color: "#9fc5e8", height: 420 },
  stadium: { icon: "🏟️", name: "Stadium", rarity: "legendary", appeal: 0.8, style: "civic", color: "#95a5a6", height: 80 },
  wheel: { icon: "🎡", name: "Ferris Wheel", rarity: "legendary", appeal: 0.6, style: "plaza" },
};
const SPECIAL_IDS = Object.keys(SPECIALS);

const NAME_PARTS = {
  start: ["Oak", "Maple", "River", "Stone", "Clear", "Ash", "Pine", "Willow", "Bright", "Fox", "Elder", "Silver", "Cedar", "Amber", "Hollow", "North", "Rose", "Iron", "Moss", "Gold", "Lark", "Wren", "Cobble", "Sun", "Frost"],
  end: ["field", "brook", "haven", "ford", "dale", "wood", "ridge", "port", "ton", "ville", "bury", "stead", "mere", "hill", "crest", "vale", "wick", "gate", "moor", "fall"],
};

function cityNameFromSeed(seed) {
  const rng = createRNG(hashInts(seed, 99));
  return NAME_PARTS.start[Math.floor(rng() * NAME_PARTS.start.length)] +
    NAME_PARTS.end[Math.floor(rng() * NAME_PARTS.end.length)];
}

function todayKey(d = new Date()) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

const MARKET_HOURS = 6;
function marketPeriod(d = new Date()) {
  return todayKey(d) + "/" + Math.floor(d.getHours() / MARKET_HOURS);
}

class City {
  constructor({ seed, name, graph = null }) {
    this.seed = seed;
    this.name = name || cityNameFromSeed(seed);
    this.layout = new CityLayout(seed, graph);
    this.version = 0; // bumps whenever geometry changes (for the renderer)

    this.materials = 0;
    this.coins = 0;
    this.pop = 0;
    this.roadJob = null;
    this.inventory = [];
    this.scanned = {};
    this.daily = { last: null, streak: 0 };
    this.market = { day: null, bought: 0 }; // materials bought this restock (`day` is the restock key)
    this.tierReached = 0;
    this.stats = { scans: 0, kinds: {}, collected: 0 };
    this.createdAt = Date.now();
    this.lastSeen = Date.now();
  }

  // A brand new city: one road, one house, one shop, middle of nowhere.
  static create(seed = (Math.random() * 4294967296) >>> 0) {
    const city = new City({ seed });
    const lots = city.layout.lots;
    const home = lots[0];
    const shop = lots.find((l) => l.center.x * home.center.x + l.center.y * home.center.y < 0 && l !== home) || lots[1];
    if (home) Object.assign(home, { kind: "res", level: 1 });
    if (shop) Object.assign(shop, { kind: "com", level: 1, coins: 5 });
    city.pop = 3;
    city.coins = 10;
    city.materials = 10;
    return city;
  }

  // ---- derived values ----------------------------------------------------
  get lots() {
    return this.layout.lots;
  }

  get capacity() {
    let c = 0;
    for (const l of this.lots) if (l.kind === "res") c += l.effectiveLevel * 6;
    return c;
  }

  get jobs() {
    let j = 0;
    for (const l of this.lots) if (l.kind === "com") j += l.effectiveLevel * 5;
    return j;
  }

  get appeal() {
    let a = 1;
    for (const l of this.lots) {
      if (l.kind === "special" && l.building <= 0) a += SPECIALS[l.special]?.appeal || 0;
    }
    return a;
  }

  get tier() {
    let t = 0;
    TIERS.forEach((tier, i) => {
      if (this.pop >= tier.pop) t = i;
    });
    return t;
  }

  get roadCount() {
    return this.layout.graph.segments.length;
  }

  roadCost() {
    return Math.round(20 + 12 * Math.pow(this.roadCount - 1, 1.4));
  }

  // How much scans and the daily gift are multiplied by. Tied to the road cost
  // so a typical scan stays worth about a third of a road at any town size.
  rewardScale() {
    return Math.max(1 + Math.max(0, this.roadCount - 1) * 0.08, this.roadCost() / 80);
  }

  roadDuration() {
    return Math.min(60, 12 + this.roadCount * 1.5);
  }

  upgradeInfo(lot) {
    if ((lot.kind !== "res" && lot.kind !== "com") || lot.level >= 3) return null;
    const cost = lot.level === 1 ? 150 : 600;
    const needPop = lot.level === 1 ? 40 : 120;
    return { cost, needPop, ok: this.coins >= cost && this.pop >= needPop && lot.building <= 0 };
  }

  center() {
    const b = this.layout.bounds();
    return new Point((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
  }

  // ---- simulation ---------------------------------------------------------
  tick(dt, rand = Math.random) {
    const events = [];

    // Roads build themselves whenever there are enough materials.
    if (this.roadJob) {
      this.roadJob.t += dt;
      if (this.roadJob.t >= this.roadJob.duration) {
        const lots = this.layout.addRoad(this.roadJob.a, this.roadJob.b);
        this.roadJob = null;
        this.version++;
        events.push({ type: "road", lots: lots.length });
      }
    } else if (this.materials >= this.roadCost()) {
      const next = this.layout.nextRoad();
      if (next) {
        this.materials -= this.roadCost();
        this.roadJob = {
          a: { x: next.a.x, y: next.a.y },
          b: { x: next.b.x, y: next.b.y },
          t: 0,
          duration: this.roadDuration(),
        };
        this.version++;
        events.push({ type: "roadStart" });
      }
    }

    const appeal = this.appeal;
    const empties = [];
    for (const lot of this.lots) {
      if (lot.building > 0) {
        lot.building -= dt;
        if (lot.building <= 0) {
          lot.building = 0;
          events.push({ type: "built", lot });
        }
        continue;
      }
      if (lot.kind === "com") {
        lot.coins = Math.min(lot.coins + lot.level * 0.06 * appeal * dt, City.coinCap(lot));
      } else if (!lot.kind) {
        empties.push(lot);
      }
    }

    // Empty lots develop on their own (about one per 40 s per lot, faster with appeal).
    let expected = dt * 0.025 * appeal * empties.length;
    while (expected > 0 && empties.length) {
      if (rand() < Math.min(1, expected)) {
        const i = Math.floor(rand() * empties.length);
        if (this.#develop(empties[i], rand)) empties.splice(i, 1);
      }
      expected -= 1;
    }

    // People move in while there's housing; taxes trickle in.
    const cap = this.capacity;
    if (this.pop < cap) this.pop = Math.min(cap, this.pop + dt * 0.04 * appeal * (1 + cap * 0.002));
    else this.pop = Math.max(cap, this.pop - dt * 0.5);
    this.coins += dt * this.pop * 0.003;

    const tier = this.tier;
    if (tier > this.tierReached) {
      for (let t = this.tierReached + 1; t <= tier; t++) {
        this.materials += TIERS[t].reward || 0;
        events.push({ type: "tier", tier: t });
      }
      this.tierReached = tier;
    }
    return events;
  }

  // Homes vs shops is decided by demand: homes need jobs nearby, shops need customers.
  #develop(lot, rand) {
    let cap = 0, jobs = 0;
    for (const l of this.lots) {
      if (l.kind === "res") cap += Math.max(1, l.level) * 6;
      if (l.kind === "com") jobs += Math.max(1, l.level) * 5;
    }
    // Each job supports 2.2 residents and each resident wants 0.6 jobs. Because
    // 2.2 × 0.6 > 1, homes and shops keep leapfrogging instead of stalling.
    const resDemand = jobs * 2.2 + 10 - cap;
    const comDemand = this.pop * 0.6 + 3 - jobs;
    if (resDemand <= 0 && comDemand <= 0) return false;
    lot.kind = resDemand >= comDemand ? "res" : "com";
    lot.level = 1;
    lot.building = 10 + rand() * 10;
    return true;
  }

  // Fast-forwards time (offline progress). Returns a summary of what changed.
  simulate(seconds) {
    const before = { pop: this.pop, coins: this.coins, roads: this.roadCount, built: this.lots.filter((l) => l.kind).length };
    const step = seconds > 3600 ? 2 : 1;
    for (let s = 0; s < seconds; s += step) this.tick(step);
    return {
      pop: Math.floor(this.pop) - Math.floor(before.pop),
      coins: Math.floor(this.coins - before.coins),
      roads: this.roadCount - before.roads,
      built: this.lots.filter((l) => l.kind).length - before.built,
    };
  }

  // ---- player actions -----------------------------------------------------
  // A shop holds up to 30 coins per level; its 💰 bag appears (and can be
  // collected) once it's at least a quarter full.
  static coinCap(lot) {
    return 30 * lot.level;
  }

  static bagReady(lot) {
    return lot.kind === "com" && lot.building <= 0 && lot.coins >= Math.max(1, City.coinCap(lot) * 0.25);
  }

  collect(lot) {
    if (!City.bagReady(lot)) return 0;
    const amount = Math.floor(lot.coins);
    lot.coins -= amount;
    this.coins += amount;
    this.stats.collected += amount;
    return amount;
  }

  upgrade(lot) {
    const info = this.upgradeInfo(lot);
    if (!info || !info.ok) return false;
    this.coins -= info.cost;
    lot.level++;
    lot.building = 8 + lot.level * 4;
    return true;
  }

  placeSpecial(lot, id) {
    const i = this.inventory.indexOf(id);
    if (i < 0 || !lot || lot.kind) return false;
    this.inventory.splice(i, 1);
    Object.assign(lot, { kind: "special", special: id, level: 1, building: 6, coins: 0 });
    return true;
  }

  // The market restocks every 6 hours (midnight, 6am, noon, 6pm) with half a
  // road's worth of materials, so coins speed a town up – more for players who
  // check in often – without letting taxes snowball it on their own.
  marketStock(now = new Date()) {
    const total = Math.max(10, Math.round((this.roadCost() * 0.5) / 10) * 10);
    const bought = this.market.day === marketPeriod(now) ? this.market.bought : 0;
    const next = new Date(now);
    next.setHours(Math.floor(now.getHours() / MARKET_HOURS) * MARKET_HOURS + MARKET_HOURS, 0, 0, 0);
    return { total, left: Math.max(0, total - bought), restockIn: next - now };
  }

  buyMaterials(amount, price) {
    if (this.coins < price || amount > this.marketStock().left) return false;
    const period = marketPeriod();
    if (this.market.day !== period) this.market = { day: period, bought: 0 };
    this.market.bought += amount;
    this.coins -= price;
    this.materials += amount;
    return true;
  }

  dailyStatus() {
    const today = todayKey();
    if (this.daily.last === today) return { available: false, streak: this.daily.streak };
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const streak = this.daily.last === todayKey(y) ? this.daily.streak + 1 : 1;
    return { available: true, streak, materials: Math.round((15 + 5 * Math.min(streak - 1, 7)) * this.rewardScale()), coins: 20 };
  }

  claimDaily() {
    const s = this.dailyStatus();
    if (!s.available) return null;
    this.daily = { last: todayKey(), streak: s.streak };
    this.materials += s.materials;
    this.coins += s.coins;
    return s;
  }

  applyReward(r) {
    this.materials += r.materials;
    this.coins += r.coins;
    if (r.pop) this.pop = Math.min(Math.max(this.pop, this.capacity), this.pop + r.pop);
    if (r.item) this.inventory.push(r.item);
    this.scanned[r.key] = { at: Date.now(), kind: r.kind, icon: r.icon };
    this.stats.scans++;
    this.stats.kinds[r.kind] = (this.stats.kinds[r.kind] || 0) + 1;
  }

  // ---- persistence --------------------------------------------------------
  toSave() {
    return {
      v: 1,
      seed: this.seed,
      name: this.name,
      graph: this.layout.graph.toJSON(),
      lots: this.lots.map((l) => [l.kind || 0, l.level, +l.building.toFixed(1), +l.coins.toFixed(2), l.special || 0]),
      materials: this.materials,
      coins: this.coins,
      pop: this.pop,
      roadJob: this.roadJob,
      inventory: this.inventory,
      scanned: this.scanned,
      daily: this.daily,
      market: this.market,
      tierReached: this.tierReached,
      stats: this.stats,
      createdAt: this.createdAt,
      lastSeen: Date.now(),
    };
  }

  static fromSave(data) {
    const city = new City({ seed: data.seed, name: data.name, graph: data.graph });
    (data.lots || []).forEach((s, i) => {
      const lot = city.lots[i];
      if (!lot) return;
      lot.kind = s[0] || null;
      lot.level = s[1];
      lot.building = s[2];
      lot.coins = s[3];
      lot.special = s[4] || null;
    });
    for (const k of ["materials", "coins", "pop", "roadJob", "inventory", "scanned", "daily", "market", "tierReached", "stats", "createdAt", "lastSeen"]) {
      if (data[k] !== undefined) city[k] = data[k];
    }
    return city;
  }

  // Compact code for sharing/visiting. Includes the road graph itself so it
  // rebuilds identically regardless of app version.
  toShareCode() {
    const g = this.layout.graph;
    const index = new Map(g.points.map((p, i) => [p, i]));
    const lotChars = this.lots.map((l) => {
      if (!l.kind || l.effectiveLevel < 1) return ".";
      if (l.kind === "res") return "abc"[l.effectiveLevel - 1];
      if (l.kind === "com") return "ABC"[l.effectiveLevel - 1];
      return String(Math.max(0, SPECIAL_IDS.indexOf(l.special)));
    }).join("");
    const data = {
      v: 1,
      n: this.name,
      s: this.seed,
      p: g.points.flatMap((p) => [p.x, p.y]),
      e: g.segments.flatMap((s) => [index.get(s.p1), index.get(s.p2)]),
      l: lotChars,
      u: Math.floor(this.pop),
      c: this.createdAt,
    };
    const json = JSON.stringify(data);
    return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  static fromShareCode(code) {
    const b64 = code.trim().replace(/-/g, "+").replace(/_/g, "/");
    const data = JSON.parse(decodeURIComponent(escape(atob(b64))));
    const pts = [];
    for (let i = 0; i < data.p.length; i += 2) pts.push({ x: data.p[i], y: data.p[i + 1] });
    const segs = [];
    for (let i = 0; i < data.e.length; i += 2) segs.push({ p1: pts[data.e[i]], p2: pts[data.e[i + 1]] });
    const city = new City({ seed: data.s, name: data.n, graph: { points: pts, segments: segs } });
    [...data.l].forEach((ch, i) => {
      const lot = city.lots[i];
      if (!lot || ch === ".") return;
      if ("abc".includes(ch)) Object.assign(lot, { kind: "res", level: "abc".indexOf(ch) + 1 });
      else if ("ABC".includes(ch)) Object.assign(lot, { kind: "com", level: "ABC".indexOf(ch) + 1 });
      else Object.assign(lot, { kind: "special", level: 1, special: SPECIAL_IDS[+ch] || "park" });
    });
    city.pop = data.u || 0;
    city.createdAt = data.c || Date.now();
    return city;
  }
}
