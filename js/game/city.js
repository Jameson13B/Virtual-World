// ---------------------------------------------------------------------------
// City state + economy.
//
//   🧱 materials  -> when you can afford a road, you pick where it goes
//   new roads     -> new empty lots
//   empty lots    -> develop on their own into homes 🏠, shops 🏪 or factories 🏭
//   homes         -> room for people 👥     shops -> jobs + 💰 to collect
//                                            factories -> jobs + 🧱 to collect
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
  park: { icon: "🌳", name: "Park", rarity: "uncommon", appeal: 0.15, about: "Shady trees, a duck pond and benches for a quiet afternoon." },
  fountain: { icon: "⛲", name: "Fountain", rarity: "uncommon", appeal: 0.12, about: "A stone fountain that never stops splashing. Wishes not guaranteed." },
  carousel: { icon: "🎠", name: "Carousel", rarity: "uncommon", appeal: 0.12, about: "Painted horses going round and round under a striped roof." },
  school: { icon: "🏫", name: "School", rarity: "rare", appeal: 0.3, about: "Brick classrooms, a bell tower and a schoolyard full of noise." },
  clinic: { icon: "🏥", name: "Clinic", rarity: "rare", appeal: 0.3, about: "Doctors on call day and night, with a helipad on the roof." },
  fire: { icon: "🚒", name: "Fire Station", rarity: "rare", appeal: 0.25, station: "fire", about: "The fire truck is washed, parked out front and ready to roll." },
  library: { icon: "📚", name: "Library", rarity: "rare", appeal: 0.25, about: "Marble columns and a million quiet pages behind them." },
  tower: { icon: "🗼", name: "Sky Tower", rarity: "legendary", appeal: 0.6, about: "The tallest thing for miles, with a revolving restaurant at the top." },
  stadium: { icon: "🏟️", name: "Stadium", rarity: "legendary", appeal: 0.8, about: "Floodlights, a perfect pitch and a crowd that never stops doing the wave." },
  wheel: { icon: "🎡", name: "Ferris Wheel", rarity: "legendary", appeal: 0.6, about: "A glittering wheel with the best view of town from the top car." },
};
const SPECIAL_IDS = Object.keys(SPECIALS);

// Fire and police stations (lot kind "svc", with `special` holding which one).
// Each covers every building within SERVICE_RADIUS; upgrades add vehicles and
// a faster response, never a bigger circle.
const SERVICES = {
  fire: { icon: "🚒", name: "Fire station", vehicle: "fire truck", incident: "🔥", about: "Puts out fires before buildings burn down." },
  police: { icon: "🚓", name: "Police station", vehicle: "police car", incident: "🦹", about: "Stops robberies before shops lose their 💰." },
};
const SERVICE_IDS = Object.keys(SERVICES);
const SERVICE_RADIUS = 1500;
const SAFETY_TIER = 2; // Town: stations unlock and emergencies start
const UPKEEP_SHARE = 0.2; // full level-1 coverage of both kinds costs 20% of income
const INCIDENT_TIME = { fire: 60, police: 120 }; // seconds until a fire burns / robbers escape
const SAFETY_GRACE = 600; // seconds of play before the first emergency
// The town only runs while the player is around, and for this long after their last tap.
const ACTIVE_GRACE = 3600 * 1000;

// Factories start appearing at Town, as about 1 in 4 of the job buildings.
const INDUSTRY_TIER = 2;
const THREE_ROADS_TIER = 3; // City: pick from 3 roads instead of 2
const INDUSTRY_SHARE = 0.25;

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

const randomSeed = () => (Math.random() * 4294967296) >>> 0;

class City {
  constructor({ seed, name, graph = null, map = "classic" }) {
    this.seed = seed;
    this.name = name || cityNameFromSeed(seed);
    this.terrain = new Terrain(map, seed);
    this.map = this.terrain.type;
    this.layout = new CityLayout(seed, graph, this.terrain);
    this.version = 0; // bumps whenever geometry changes (for the renderer)

    this.materials = 0;
    this.coins = 0;
    this.pop = 0;
    this.roadJob = null;
    this.roadChoice = null; // roads waiting for the player to pick one
    this.inventory = [];
    this.scanned = {};
    this.daily = { last: null, streak: 0 };
    this.market = { day: null, bought: 0 }; // materials bought this restock (`day` is the restock key)
    this.tierReached = 0;
    this.stats = { scans: 0, kinds: {}, collected: 0 };
    this.createdAt = Date.now();
    this.lastSeen = Date.now();
    this.lastActive = Date.now(); // last time the player touched the game
    this.safetyGrace = SAFETY_GRACE;
    this.incidents = []; // live emergencies (never saved: they only happen while playing)
    this.unpaid = false; // couldn't pay station upkeep, so the stations stopped responding
  }

  // A brand new city: one road, one house, one shop, middle of nowhere. `map`
  // is one of MAP_IDS; towns from before map types are "classic".
  static create(seed = randomSeed(), map = "classic") {
    const city = new City({ seed, map });
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
    for (const l of this.lots) if (l.kind === "com" || l.kind === "ind") j += l.effectiveLevel * 5;
    return j;
  }

  get appeal() {
    let a = 1;
    for (const l of this.lots) {
      if (l.kind === "special" && l.building <= 0) a += SPECIALS[l.special]?.appeal || 0;
    }
    return Math.max(0.5, a + this.safetyAppeal());
  }

  // ---- fire & police -------------------------------------------------------
  // From Town, good coverage adds up to +25% appeal. From City, poor coverage
  // also costs up to 15%.
  safetyAppeal() {
    const t = this.tierReached;
    if (t < SAFETY_TIER) return 0;
    const s = this.safety().score;
    return t > SAFETY_TIER ? 0.4 * s - 0.15 : 0.25 * s;
  }

  stations(kind = null) {
    return this.lots.filter((l) => l.kind === "svc" && (!kind || l.special === kind));
  }

  // Stations that are built, paid for and so actually respond.
  #working(kind) {
    return this.unpaid ? [] : this.stations(kind).filter((l) => l.building <= 0);
  }

  static covers(station, lot) {
    const dx = station.center.x - lot.center.x, dy = station.center.y - lot.center.y;
    return dx * dx + dy * dy <= SERVICE_RADIUS * SERVICE_RADIUS;
  }

  // Share of homes, shops and factories each service covers, cached for a
  // couple of seconds (appeal asks for it every frame).
  safety() {
    const now = Date.now();
    if (this._safety && now - this._safety.at < 2000) return this._safety;
    const lots = this.lots.filter((l) => l.kind === "res" || l.kind === "com" || l.kind === "ind");
    const share = (kind) => {
      const st = this.#working(kind);
      if (!lots.length) return st.length ? 1 : 0;
      return lots.filter((l) => st.some((s) => City.covers(s, l))).length / lots.length;
    };
    const fire = share("fire"), police = share("police");
    this._safety = { at: now, fire, police, score: (fire + police) / 2 };
    return this._safety;
  }

  #invalidateSafety() {
    this._safety = null;
    this._needed = null;
  }

  // About how many stations of one kind it takes to cover the whole town
  // (a greedy cover over building lots), refreshed every 30 s.
  stationsNeeded() {
    const now = Date.now();
    if (this._needed && now - this._needed.at < 30000) return this._needed.n;
    const lots = this.lots.filter((l) => l.kind && l.kind !== "special" && l.kind !== "svc");
    const near = lots.map((a) => lots.filter((b) => City.covers(a, b)));
    const left = new Set(lots);
    let n = 0;
    while (left.size) {
      let best = null, bestK = 0;
      near.forEach((list) => {
        let k = 0;
        for (const l of list) if (left.has(l)) k++;
        if (k > bestK) [best, bestK] = [list, k];
      });
      for (const l of best) left.delete(l);
      n++;
    }
    this._needed = { at: now, n: Math.max(1, n) };
    return this._needed.n;
  }

  // Coins per second from taxes plus what every shop earns.
  incomeRate() {
    let shops = 0;
    for (const l of this.lots) if (l.kind === "com" && l.building <= 0) shops += l.level;
    return this.pop * 0.003 + shops * 0.03 * this.appealBase();
  }

  appealBase() {
    let a = 1;
    for (const l of this.lots) if (l.kind === "special" && l.building <= 0) a += SPECIALS[l.special]?.appeal || 0;
    return a;
  }

  // 💰 per second for one station, whatever its level: covering the whole town
  // with level-1 stations of both kinds costs UPKEEP_SHARE of income.
  stationUpkeep() {
    return (this.incomeRate() * UPKEEP_SHARE) / 2 / this.stationsNeeded();
  }

  upkeepRate() {
    return this.stations().length * this.stationUpkeep();
  }

  // Half an hour of income, a quarter more for each station of that kind you
  // already have.
  stationCost(kind) {
    const base = Math.max(200, this.incomeRate() * 1800);
    return Math.round((base * (1 + 0.25 * this.stations(kind).length)) / 10) * 10;
  }

  stationUpgradeInfo(lot) {
    if (lot.kind !== "svc" || lot.level >= 3) return null;
    const hours = lot.level === 1 ? 1.5 : 4;
    const cost = Math.round(Math.max(lot.level === 1 ? 600 : 1600, this.incomeRate() * 3600 * hours) / 10) * 10;
    return { cost, ok: this.coins >= cost && lot.building <= 0 };
  }

  // How a station of this level responds: vehicles out at once, seconds to
  // dispatch and on scene, and how fast its vehicles drive.
  static response(level) {
    return { vehicles: level, dispatch: [0, 6, 3, 1][level], work: [0, 4, 3, 2][level], speed: [0, 3, 3.6, 4.2][level] };
  }

  // Builds a station on an empty lot or in place of a home, shop or factory.
  buildStation(lot, kind, { free = false, level = 1 } = {}) {
    if (!lot || lot.kind === "special" || lot.kind === "svc") return false;
    const cost = free ? 0 : this.stationCost(kind);
    if (this.coins < cost) return false;
    if (lot.kind === "com" || lot.kind === "ind") this.#payOut(lot);
    this.#clearIncident(lot);
    this.coins -= cost;
    Object.assign(lot, { kind: "svc", special: kind, level, building: 12, coins: 0 });
    this.#invalidateSafety();
    return true;
  }

  upgradeStation(lot) {
    const info = this.stationUpgradeInfo(lot);
    if (!info || !info.ok) return false;
    this.coins -= info.cost;
    lot.level++;
    lot.building = 8;
    this.#invalidateSafety();
    return true;
  }

  // Closes a station for good (no refund). The lot develops again by demand.
  closeStation(lot) {
    if (!lot || lot.kind !== "svc") return false;
    Object.assign(lot, { kind: null, special: null, level: 0, building: 0, coins: 0 });
    this.#invalidateSafety();
    return true;
  }

  // The nearest working station of a kind that covers `lot`, or null.
  stationFor(lot, kind) {
    let best = null, bestD = Infinity;
    for (const s of this.#working(kind)) {
      const d = distance(s.center, lot.center);
      if (d <= SERVICE_RADIUS && d < bestD) [best, bestD] = [s, d];
    }
    return best;
  }

  // Emergencies, only while the player is in the game. About one every 3
  // minutes for a 40-building town, every minute for 450 buildings.
  tickSafety(dt, rand = Math.random) {
    const events = [];
    if (this.tierReached < SAFETY_TIER) return events;
    if (this.safetyGrace > 0) {
      this.safetyGrace -= dt;
      return events;
    }
    const lots = this.lots.filter((l) => (l.kind === "res" || l.kind === "com" || l.kind === "ind") && l.building <= 0 && !l.incident);
    if (lots.length && rand() < dt * 0.0008 * Math.sqrt(lots.length)) {
      const shops = lots.filter((l) => l.kind !== "res");
      const type = shops.length && rand() < 0.5 ? "police" : "fire";
      const pool = type === "police" ? shops : lots;
      const lot = pool[Math.floor(rand() * pool.length)];
      const inc = { lot, type, t: 0, limit: INCIDENT_TIME[type], working: 0, responder: null };
      lot.incident = inc;
      this.incidents.push(inc);
      events.push({ type: "incident", inc });
    }
    for (const inc of [...this.incidents]) {
      if (inc.lot.incident !== inc) {
        this.incidents.splice(this.incidents.indexOf(inc), 1);
        continue;
      }
      if (inc.working > 0) {
        if ((inc.working -= dt) <= 0) events.push(this.resolve(inc, "station"));
        continue;
      }
      if ((inc.t += dt) >= inc.limit) events.push(this.#expire(inc));
    }
    return events;
  }

  // The fire burns: the building drops a level, and a level-1 building is
  // gone. Or the robbers get away with everything the shop was holding.
  #expire(inc) {
    const lot = inc.lot;
    this.#clearIncident(lot);
    if (inc.type === "fire") {
      const name = lot.kind;
      if (lot.level <= 1) Object.assign(lot, { kind: null, level: 0, building: 0, coins: 0 });
      else {
        lot.level--;
        lot.coins = Math.min(lot.coins, this.storeCap(lot));
      }
      this.#invalidateSafety();
      return { type: "burned", inc, lost: !lot.kind, was: name };
    }
    const stolen = Math.floor(lot.coins);
    lot.coins = 0;
    return { type: "robbed", inc, stolen };
  }

  resolve(inc, by) {
    this.#clearIncident(inc.lot);
    this.stats.saved = (this.stats.saved || 0) + 1;
    return { type: "resolved", inc, by };
  }

  #clearIncident(lot) {
    const inc = lot.incident;
    if (!inc) return;
    lot.incident = null;
    const i = this.incidents.indexOf(inc);
    if (i >= 0) this.incidents.splice(i, 1);
  }

  // Paying a private crew to handle an emergency right now: 5 minutes of income.
  crewCost() {
    return Math.round(Math.max(30, this.incomeRate() * 300) / 5) * 5;
  }

  callCrew(inc) {
    const cost = this.crewCost();
    if (this.coins < cost || inc.lot.incident !== inc) return null;
    this.coins -= cost;
    return this.resolve(inc, "crew");
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

  // 🧱 per second for each factory level. All level-1 factories together make
  // about a third of a road per hour (fewer than 3 make less), and upgrading
  // them all raises that to a full road per hour.
  factoryRate() {
    let n = 0;
    for (const l of this.lots) if (l.kind === "ind") n++;
    return this.roadCost() / 3 / 3600 / Math.max(3, n);
  }

  upgradeInfo(lot) {
    if (!["res", "com", "ind"].includes(lot.kind) || lot.level >= 3) return null;
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
    this.goodsRate = this.factoryRate();

    // Once a road is affordable the town offers a few and waits for the player
    // to pick one (even while the app is closed). Materials keep piling up.
    if (this.roadJob) {
      this.roadJob.t += dt;
      if (this.roadJob.t >= this.roadJob.duration) {
        const lots = this.layout.addRoad(this.roadJob.a, this.roadJob.b);
        this.roadJob = null;
        this.version++;
        events.push({ type: "road", lots: lots.length });
      }
    } else if (!this.roadChoice && this.materials >= this.roadCost()) {
      const options = this.layout.roadOptions(this.tierReached >= THREE_ROADS_TIER ? 3 : 2);
      if (options.length) {
        this.roadChoice = options.map((o) => ({ a: { x: o.a.x, y: o.a.y }, b: { x: o.b.x, y: o.b.y }, lots: o.lots.length, connects: o.connects }));
        this.version++;
        events.push({ type: "roadChoice" });
      }
    }

    const appeal = this.appeal;
    const empties = [];
    for (const lot of this.lots) {
      if (lot.building > 0) {
        lot.building -= dt;
        if (lot.building <= 0) {
          lot.building = 0;
          if (lot.kind === "svc") this.#invalidateSafety();
          events.push({ type: "built", lot });
        }
        continue;
      }
      if (lot.incident && lot.incident.type === "police") {
        // robbers in the shop: nothing earned until they're gone
      } else if (lot.kind === "com") {
        lot.coins = Math.min(lot.coins + lot.level * 0.03 * appeal * dt, this.storeCap(lot));
      } else if (lot.kind === "ind") {
        lot.coins = Math.min(lot.coins + lot.level * this.goodsRate * dt, this.storeCap(lot)); // 🧱, stored in `coins`
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

    // Station upkeep. Without the coins for it, stations stop responding until
    // there's a minute of upkeep in the bank again.
    const rate = this.upkeepRate(), upkeep = rate * dt;
    if (upkeep > 0) {
      const unpaid = this.unpaid ? this.coins < rate * 60 : this.coins < upkeep;
      if (!unpaid) this.coins -= upkeep;
      if (unpaid !== this.unpaid) {
        this.unpaid = unpaid;
        this.#invalidateSafety();
        events.push({ type: unpaid ? "unpaid" : "paid" });
      }
    } else this.unpaid = false;

    const tier = this.tier;
    if (tier > this.tierReached) {
      for (let t = this.tierReached + 1; t <= tier; t++) {
        this.materials += TIERS[t].reward || 0;
        events.push({ type: "tier", tier: t });
        if (t === SAFETY_TIER) events.push({ type: "safetyUnlocked" });
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
      if (l.kind === "com" || l.kind === "ind") jobs += Math.max(1, l.level) * 5;
    }
    // Each job supports 2.2 residents and each resident wants 0.6 jobs. Because
    // 2.2 × 0.6 > 1, homes and shops keep leapfrogging instead of stalling.
    const resDemand = jobs * 2.2 + 10 - cap;
    const comDemand = this.pop * 0.6 + 3 - jobs;
    if (resDemand <= 0 && comDemand <= 0) return false;
    lot.kind = resDemand >= comDemand ? "res" : this.#wantsFactory() ? "ind" : "com";
    lot.level = 1;
    lot.building = 10 + rand() * 10;
    return true;
  }

  #wantsFactory() {
    if (this.tierReached < INDUSTRY_TIER) return false;
    let shops = 0, factories = 0;
    for (const l of this.lots) {
      if (l.kind === "com") shops++;
      else if (l.kind === "ind") factories++;
    }
    return factories < (shops + factories + 1) * INDUSTRY_SHARE;
  }

  // Fast-forwards time (offline progress). Returns a summary of what changed.
  simulate(seconds) {
    const before = { pop: this.pop, coins: this.coins, roads: this.roadCount, built: this.lots.filter((l) => l.kind).length };
    const upkeep = this.upkeepRate() * seconds;
    const step = seconds > 3600 ? 2 : 1;
    for (let s = 0; s < seconds; s += step) this.tick(step);
    return {
      pop: Math.floor(this.pop) - Math.floor(before.pop),
      coins: Math.floor(this.coins - before.coins),
      roads: this.roadCount - before.roads,
      built: this.lots.filter((l) => l.kind).length - before.built,
      upkeep: Math.floor(upkeep),
    };
  }

  // ---- player actions -----------------------------------------------------
  // Builds the i-th offered road. Every option costs the same.
  chooseRoad(i) {
    const o = this.roadChoice?.[i];
    if (!o || this.roadJob || this.materials < this.roadCost()) return false;
    this.materials -= this.roadCost();
    this.roadJob = { a: o.a, b: o.b, t: 0, duration: this.roadDuration() };
    this.roadChoice = null;
    this.version++;
    return true;
  }

  // A shop holds up to 30 coins per level and fills in ~1000 s / appeal. A
  // factory holds 30 minutes of its 🧱. The 💰 bag / 📦 crate appears (and can
  // be collected) once it's at least a quarter full.
  storeCap(lot) {
    if (lot.kind === "ind") return lot.level * (this.goodsRate ?? this.factoryRate()) * 1800;
    return 30 * lot.level;
  }

  bagReady(lot) {
    return (lot.kind === "com" || lot.kind === "ind") && lot.building <= 0 && !lot.incident && lot.coins >= Math.max(1, this.storeCap(lot) * 0.25);
  }

  // Collects a shop's 💰 or a factory's 🧱, minus `cut` (the collector's fee).
  // Returns how much the town kept.
  collect(lot, cut = 0) {
    if (!this.bagReady(lot)) return 0;
    return this.#payOut(lot, cut);
  }

  #payOut(lot, cut = 0) {
    const amount = Math.floor(lot.coins);
    const kept = Math.round(amount * (1 - cut));
    lot.coins -= amount;
    if (lot.kind === "ind") {
      this.materials += kept;
    } else {
      this.coins += kept;
      this.stats.collected += kept;
    }
    return kept;
  }

  upgrade(lot) {
    const info = this.upgradeInfo(lot);
    if (!info || !info.ok) return false;
    this.coins -= info.cost;
    lot.level++;
    lot.building = 8 + lot.level * 4;
    return true;
  }

  // Specials go on an empty lot or replace a home, shop or factory. Whatever a
  // shop or factory was holding is collected first.
  placeSpecial(lot, id) {
    const i = this.inventory.indexOf(id);
    if (i < 0 || !lot || lot.kind === "special" || lot.kind === "svc") return false;
    if (SPECIALS[id].station) {
      if (!this.buildStation(lot, SPECIALS[id].station, { free: true, level: 2 })) return false;
      this.inventory.splice(i, 1);
      return true;
    }
    if (lot.kind === "com" || lot.kind === "ind") this.#payOut(lot);
    this.#clearIncident(lot);
    this.inventory.splice(i, 1);
    Object.assign(lot, { kind: "special", special: id, level: 1, building: 6, coins: 0 });
    return true;
  }

  // Puts a placed special back in the bag. The lot is empty again and develops
  // by demand like any other.
  removeSpecial(lot) {
    if (!lot || lot.kind !== "special") return false;
    this.inventory.push(lot.special);
    Object.assign(lot, { kind: null, special: null, level: 0, building: 0, coins: 0 });
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
      map: this.map,
      name: this.name,
      graph: this.layout.graph.toJSON(),
      lots: this.lots.map((l) => [l.kind || 0, l.level, +l.building.toFixed(1), +l.coins.toFixed(2), l.special || 0]),
      materials: this.materials,
      coins: this.coins,
      pop: this.pop,
      roadJob: this.roadJob,
      roadChoice: this.roadChoice,
      inventory: this.inventory,
      scanned: this.scanned,
      daily: this.daily,
      market: this.market,
      tierReached: this.tierReached,
      stats: this.stats,
      createdAt: this.createdAt,
      lastSeen: Date.now(),
      lastActive: this.lastActive,
      safetyGrace: this.safetyGrace,
    };
  }

  static fromSave(data) {
    const city = new City({ seed: data.seed, name: data.name, graph: data.graph, map: data.map });
    (data.lots || []).forEach((s, i) => {
      const lot = city.lots[i];
      if (!lot) return;
      lot.kind = s[0] || null;
      lot.level = s[1];
      lot.building = s[2];
      lot.coins = s[3];
      lot.special = s[4] || null;
    });
    for (const k of ["materials", "coins", "pop", "roadJob", "roadChoice", "inventory", "scanned", "daily", "market", "tierReached", "stats", "createdAt", "lastSeen", "lastActive", "safetyGrace"]) {
      if (data[k] !== undefined) city[k] = data[k];
    }
    if (data.lastActive === undefined) city.lastActive = city.lastSeen;
    // Fire Station drops placed before stations existed become level-2 stations.
    for (const lot of city.lots) {
      if (lot.kind === "special" && SPECIALS[lot.special]?.station) Object.assign(lot, { kind: "svc", special: SPECIALS[lot.special].station, level: 2 });
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
      if (l.kind === "ind") return "xyz"[l.effectiveLevel - 1];
      if (l.kind === "svc") return (l.special === "fire" ? "FGH" : "PQR")[l.effectiveLevel - 1];
      return String(Math.max(0, SPECIAL_IDS.indexOf(l.special)));
    }).join("");
    const data = {
      v: 1,
      n: this.name,
      s: this.seed,
      m: this.map,
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
    const city = new City({ seed: data.s, name: data.n, graph: { points: pts, segments: segs }, map: data.m });
    [...data.l].forEach((ch, i) => {
      const lot = city.lots[i];
      if (!lot || ch === ".") return;
      if ("abc".includes(ch)) Object.assign(lot, { kind: "res", level: "abc".indexOf(ch) + 1 });
      else if ("ABC".includes(ch)) Object.assign(lot, { kind: "com", level: "ABC".indexOf(ch) + 1 });
      else if ("xyz".includes(ch)) Object.assign(lot, { kind: "ind", level: "xyz".indexOf(ch) + 1 });
      else if ("FGH".includes(ch)) Object.assign(lot, { kind: "svc", special: "fire", level: "FGH".indexOf(ch) + 1 });
      else if ("PQR".includes(ch)) Object.assign(lot, { kind: "svc", special: "police", level: "PQR".indexOf(ch) + 1 });
      else Object.assign(lot, { kind: "special", level: 1, special: SPECIAL_IDS[+ch] || "park" });
    });
    city.pop = data.u || 0;
    city.createdAt = data.c || Date.now();
    return city;
  }
}
