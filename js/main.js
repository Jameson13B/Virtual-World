// ---------------------------------------------------------------------------
// App wiring: modes, UI, persistence, undo/redo, simulation and render loop.
// ---------------------------------------------------------------------------
"use strict";

const $ = (sel) => document.querySelector(sel);

const STORE = {
  autosave: "vw.autosave",
  worlds: "vw.worlds",
  brain: "vw.brain",
  prefs: "vw.prefs",
  bestTime: "vw.bestTime",
};

function readJSON(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn("Could not save", key, e);
    return false;
  }
}

const prefs = {
  night: false,
  showSensors: true,
  minimap: true,
  showRoute: true,
  snap: 0,
  trafficCount: 12,
  invincible: false,
  population: 100,
  mutation: 0.15,
  autoEvolve: true,
  autosave: true,
  panelOpen: false,
  ...readJSON(STORE.prefs, {}),
};
const savePrefs = () => writeJSON(STORE.prefs, prefs);

const canvas = $("#worldCanvas");
const ctx = canvas.getContext("2d");
const viewport = new Viewport(canvas);
const miniMap = new MiniMap($("#miniMap"));
const brainCanvas = $("#brainCanvas");
const brainCtx = brainCanvas.getContext("2d");

let world = null;
let editors = {};
let mode = null;
const history = { undo: [], redo: [], current: null };
const sim = {
  player: null,
  traffic: [],
  aiCars: [],
  training: null,
  generation: 0,
  follow: true,
  startTime: 0,
  finishedAt: null,
  route: null,
  parked: false,
  crashed: false,
};

const TOOLS = [
  { mode: "graph", icon: "🛣️", label: "Roads" },
  ...Object.entries(MarkingTypes).map(([type, t]) => ({ mode: type, icon: t.icon, label: t.label })),
];

const HINTS = {
  graph: "Click: add/connect point · Click a road: add junction · Drag: move · Right-click: delete · O: one-way · Space+drag: pan · Wheel: zoom",
  marking: "Hover a lane and click to place · Shift: flip direction · Right-click a marking to remove it",
  play: "WASD / Arrows: drive · Shift: boost · R: respawn · C: re-center camera · Esc: back to editing",
  train: "Cars evolve automatically – the best brain is saved each generation. Then try it in Drive mode → “Add AI driver”.",
};

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
let toastTimer = null;
function toast(msg, ms = 2200) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

// ---------------------------------------------------------------------------
// World / editors / history
// ---------------------------------------------------------------------------
function createEditors() {
  const eds = {};
  eds.graph = new GraphEditor(viewport, world.graph);
  eds.graph.snap = prefs.snap;
  eds.graph.onChange = commit;
  for (const [type, spec] of Object.entries(MarkingTypes)) {
    const targets = spec.targets === "roads" ? () => world.graph.segments : () => world.laneGuides;
    const ed = new MarkingEditor(
      viewport, world, targets,
      (center, dir) => {
        const [w, h] = spec.size(world.roadWidth);
        return new spec.cls(center, dir, w, h);
      },
      { type, unique: !!spec.unique, orient: spec.targets !== "roads" }
    );
    ed.onChange = commit;
    eds[type] = ed;
  }
  return eds;
}

function setWorld(w, { fit = true } = {}) {
  const resume = mode && mode !== "play" && mode !== "train" ? mode : "graph";
  exitMode();
  world = w;
  editors = createEditors();
  if (fit) fitView();
  syncWorldUI();
  enterMode(resume);
}

function serialize() {
  return JSON.stringify(world.toJSON());
}

// Called after every edit: records an undo step and autosaves.
function commit() {
  const snap = serialize();
  if (snap === history.current) return;
  if (history.current !== null) {
    history.undo.push(history.current);
    if (history.undo.length > 100) history.undo.shift();
  }
  history.current = snap;
  history.redo = [];
  scheduleAutosave();
  updateUndoButtons();
  updateStats();
}

function restoreSnapshot(snap) {
  setWorld(World.load(JSON.parse(snap)), { fit: false });
  scheduleAutosave();
  updateUndoButtons();
}

function undo() {
  if (!history.undo.length) return toast("Nothing to undo");
  history.redo.push(history.current);
  history.current = history.undo.pop();
  restoreSnapshot(history.current);
  toast("↶ Undo");
}

function redo() {
  if (!history.redo.length) return toast("Nothing to redo");
  history.undo.push(history.current);
  history.current = history.redo.pop();
  restoreSnapshot(history.current);
  toast("↷ Redo");
}

function updateUndoButtons() {
  $("#undoBtn").disabled = !history.undo.length;
  $("#redoBtn").disabled = !history.redo.length;
}

// Replace the world but keep it undoable.
function replaceWorld(w, message) {
  setWorld(w, { fit: true });
  commit();
  if (message) toast(message);
}

let autosaveTimer = null;
function scheduleAutosave() {
  if (!prefs.autosave) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => autosaveNow(false), 500);
}

function autosaveNow(announce) {
  const data = { ...world.toJSON(), view: { zoom: viewport.zoom, offset: viewport.offset } };
  const ok = writeJSON(STORE.autosave, data);
  if (!ok) toast("⚠️ World too big for browser storage – use Export file");
  else if (announce) toast("💾 Saved");
}

function fitView() {
  viewport.fitBounds(world.bounds);
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------
function setMode(m) {
  if (m === mode) return;
  exitMode();
  enterMode(m);
}

function enterMode(m) {
  mode = m;
  if (m === "play" && !startPlay()) return enterMode("graph");
  if (m === "train" && !startTraining()) return enterMode("graph");
  if (editors[m]) editors[m].enable();

  document.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
  $("#hint").textContent = HINTS[m] || HINTS.marking;
  brainCanvas.hidden = m !== "train";
  document.body.dataset.mode = m;
}

function exitMode() {
  for (const e of Object.values(editors)) e.disable();
  if (mode === "play" || mode === "train") stopSim();
  mode = null;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------
function getStartPose() {
  const start = world.markings.find((m) => m.type === "start");
  if (start) {
    return { x: start.center.x, y: start.center.y, angle: headingFromDir(start.directionVector) };
  }
  const seg = world.graph.segments[0];
  if (!seg) return null;
  const dir = seg.directionVector();
  const p = add(average(seg.p1, seg.p2), scale(perpendicular(dir), world.roadWidth / 4));
  return { x: p.x, y: p.y, angle: headingFromDir(dir) };
}

function readBrain() {
  return readJSON(STORE.brain, null);
}

function startPlay() {
  const pose = getStartPose();
  if (!pose) {
    toast("Draw some roads first! 🛣️");
    return false;
  }
  sim.player = new Car(pose.x, pose.y, 30, 50, "KEYS", pose.angle, 4, "#2563eb");
  sim.traffic = [];
  setTrafficCount(prefs.trafficCount);
  sim.aiCars = [];
  sim.follow = true;
  sim.startTime = performance.now();
  sim.finishedAt = null;
  sim.parked = false;
  sim.crashed = false;
  sim.route = null;
  viewport.zoom = clamp(viewport.zoom, 0.8, 1.6);
  viewport.lookAt(sim.player);
  if (!world.markings.some((m) => m.type === "start")) toast("Tip: place a 🚗 Start marking to choose where you spawn");
  return true;
}

function setTrafficCount(n) {
  while (sim.traffic.length > n) sim.traffic.pop();
  while (sim.traffic.length < n) sim.traffic.push(new TrafficCar(world, { avoid: sim.player }));
}

function respawnPlayer() {
  if (!sim.player) return;
  const pose = getStartPose();
  sim.player.dispose();
  sim.player = new Car(pose.x, pose.y, 30, 50, "KEYS", pose.angle, 4, "#2563eb");
  sim.startTime = performance.now();
  sim.finishedAt = null;
  sim.crashed = false;
  sim.follow = true;
}

function addAiDriver() {
  if (mode !== "play") setMode("play");
  if (mode !== "play") return;
  const pose = getStartPose();
  const car = new Car(pose.x, pose.y, 30, 50, "AI", pose.angle, 3, "#f59e0b");
  const saved = readBrain();
  if (saved) car.brain = NeuralNetwork.clone(saved.brain);
  else toast("No saved brain yet – this AI is random. Train one in 🧠 Train AI mode!", 3500);
  sim.aiCars.push(car);
}

function startTraining() {
  const pose = getStartPose();
  if (!pose) {
    toast("Draw some roads first! 🛣️");
    return false;
  }
  const saved = readBrain();
  const cars = [];
  for (let i = 0; i < prefs.population; i++) {
    const car = new Car(pose.x, pose.y, 30, 50, "AI", pose.angle, 3, "hsl(" + ((i * 37) % 360) + ",80%,60%)");
    if (saved) {
      car.brain = NeuralNetwork.clone(saved.brain);
      if (i > 0) NeuralNetwork.mutate(car.brain, prefs.mutation);
    }
    cars.push(car);
  }
  sim.generation++;
  sim.training = { cars, best: cars[0], bestFitness: 0, lastImprovement: 0, frames: 0 };
  sim.follow = true;
  viewport.zoom = clamp(viewport.zoom, 0.8, 1.6);
  viewport.lookAt(pose);
  return true;
}

function nextGeneration() {
  if (mode !== "train") return setMode("train");
  saveBestBrain(false);
  startTraining();
}

function saveBestBrain(force = true) {
  const t = sim.training;
  if (!t) return toast("Start 🧠 Train AI mode first");
  const saved = readBrain();
  const fitness = t.best.fitness;
  if (!force && saved && saved.fitness >= fitness) return;
  writeJSON(STORE.brain, { brain: t.best.brain, fitness, generation: sim.generation, savedAt: Date.now() });
  if (force) toast("🧠 Brain saved (fitness " + Math.round(fitness) + ")");
  updateBrainStatus();
}

function discardBrain() {
  localStorage.removeItem(STORE.brain);
  sim.generation = 0;
  toast("🗑️ Brain discarded – next generation starts from scratch");
  updateBrainStatus();
}

function stopSim() {
  if (sim.player) sim.player.dispose();
  sim.player = null;
  sim.traffic = [];
  sim.aiCars = [];
  sim.training = null;
  sim.route = null;
}

function followCamera(target) {
  if (!sim.follow || !target) return;
  const goal = scale(target, -1);
  viewport.offset = lerp2D(viewport.offset, goal, 0.12);
}

let routeFrame = 0;
function updateRoute() {
  const target = world.markings.find((m) => m.type === "target");
  const p = sim.player;
  if (!target || !prefs.showRoute || sim.finishedAt) {
    sim.route = null;
    return;
  }
  const seg = getNearestSegment(p, world.graph.segments);
  if (!seg) return;
  const fwd = forwardFromHeading(p.angle);
  const ahead = dot(subtract(seg.p2, p), fwd) > dot(subtract(seg.p1, p), fwd) ? seg.p2 : seg.p1;
  const end = getNearestPoint(target.center, world.graph.points);
  const path = world.graph.getShortestPath(ahead, end);
  sim.route = path.length ? [new Point(p.x, p.y), ...path, target.center] : null;
}

function updateSim() {
  if (mode === "play") {
    const p = sim.player;
    const everyone = [p, ...sim.traffic, ...sim.aiCars];
    for (const t of sim.traffic) t.update(everyone);
    // AI drivers spawn on the start marking too, so they ghost through you (and you through them).
    for (const ai of sim.aiCars) ai.update(world.roadBorders, sim.traffic);
    p.update(world.roadBorders, sim.traffic, { collide: !prefs.invincible });

    if (p.damaged && !sim.crashed) {
      sim.crashed = true;
      toast("💥 Crashed! Press R to respawn", 3000);
    }

    const target = world.markings.find((m) => m.type === "target");
    if (target && !sim.finishedAt && distance(p, target.center) < world.roadWidth * 0.35) {
      sim.finishedAt = performance.now();
      const secs = (sim.finishedAt - sim.startTime) / 1000;
      const best = readJSON(STORE.bestTime, null);
      const record = best === null || secs < best;
      if (record) writeJSON(STORE.bestTime, secs);
      toast("🎯 Target reached in " + secs.toFixed(1) + "s" + (record ? " – new record! 🏆" : " (best " + best.toFixed(1) + "s)"), 4000);
    }

    const inParking = Math.abs(p.speed) < 0.01 &&
      world.markings.some((m) => m.type === "parking" && m.poly.containsPoint(p));
    if (inParking && !sim.parked) toast("🅿️ Nicely parked!");
    sim.parked = inParking;

    if (++routeFrame % 30 === 0) updateRoute();
    followCamera(p);
  }

  if (mode === "train") {
    const t = sim.training;
    t.frames++;
    for (const car of t.cars) car.update(world.roadBorders, []);
    let best = t.cars[0];
    for (const car of t.cars) if (car.fitness > best.fitness) best = car;
    t.best = best;
    if (best.fitness > t.bestFitness + 1) {
      t.bestFitness = best.fitness;
      t.lastImprovement = t.frames;
    }
    const alive = t.cars.some((c) => !c.damaged && Math.abs(c.speed) > 0);
    if (prefs.autoEvolve && t.frames > 60 && (!alive || t.frames - t.lastImprovement > 420)) {
      nextGeneration();
    }
    followCamera(sim.training.best);
  }
}

function drawCars(ctx) {
  if (mode === "play") {
    for (const t of sim.traffic) t.draw(ctx);
    for (const ai of sim.aiCars) ai.draw(ctx, { sensor: prefs.showSensors });
    sim.player.draw(ctx, { sensor: prefs.showSensors });
  } else if (mode === "train") {
    const t = sim.training;
    ctx.globalAlpha = 0.25;
    for (const car of t.cars) if (car !== t.best) car.draw(ctx);
    ctx.globalAlpha = 1;
    t.best.draw(ctx, { sensor: true });
  }
}

function activeCars() {
  if (mode === "play") return [sim.player, ...sim.traffic, ...sim.aiCars];
  if (mode === "train") return sim.training.cars.filter((c) => !c.damaged);
  return [];
}

function drawNight(ctx, view) {
  ctx.save();
  ctx.fillStyle = "rgba(5,10,35,0.62)";
  ctx.fillRect(view.minX, view.minY, view.maxX - view.minX, view.maxY - view.minY);
  ctx.globalCompositeOperation = "lighter";

  for (const m of world.markings) {
    if (m.type !== "light" || !boundsOverlap(m.poly.bounds, view)) continue;
    const bulb = m.activeBulb();
    if (!bulb) continue;
    const color = { green: "0,255,80", yellow: "255,220,0", red: "255,40,40" }[m.state];
    const g = ctx.createRadialGradient(bulb.x, bulb.y, 0, bulb.x, bulb.y, 40);
    g.addColorStop(0, "rgba(" + color + ",0.6)");
    g.addColorStop(1, "rgba(" + color + ",0)");
    ctx.fillStyle = g;
    ctx.fillRect(bulb.x - 40, bulb.y - 40, 80, 80);
  }

  for (const car of activeCars()) {
    if (car.damaged) continue;
    const fwd = forwardFromHeading(car.angle);
    const front = add(car, scale(fwd, car.height / 2));
    const a = angle(fwd);
    const reach = 190;
    const g = ctx.createRadialGradient(front.x, front.y, 5, front.x, front.y, reach);
    g.addColorStop(0, "rgba(255,240,180,0.55)");
    g.addColorStop(1, "rgba(255,240,180,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(front.x, front.y);
    ctx.arc(front.x, front.y, reach, a - 0.42, a + 0.42);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
let hudFrame = 0;
function updateHUD() {
  if (++hudFrame % 6 !== 0) return;
  const hud = $("#hud");
  if (mode === "play") {
    const p = sim.player;
    const kmh = Math.round(Math.abs(p.speed) * 15);
    const elapsed = ((sim.finishedAt || performance.now()) - sim.startTime) / 1000;
    const target = world.markings.find((m) => m.type === "target");
    const best = readJSON(STORE.bestTime, null);
    let html = '<div class="big">' + kmh + " km/h</div>";
    html += "⏱ " + elapsed.toFixed(1) + "s" + (best !== null ? " · 🏆 " + best.toFixed(1) + "s" : "");
    if (target && !sim.finishedAt) html += " · 🎯 " + Math.round(distance(p, target.center) / 10) + " m";
    html += "<br>🚙 " + sim.traffic.length + " traffic" + (sim.aiCars.length ? " · 🤖 " + sim.aiCars.length + " AI" : "");
    if (p.damaged) html += '<br><span class="warn">💥 Crashed – press R</span>';
    if (sim.finishedAt) html += '<br><span class="good">🎯 Arrived! Press R to race again</span>';
    hud.innerHTML = html;
  } else if (mode === "train") {
    const t = sim.training;
    const alive = t.cars.filter((c) => !c.damaged).length;
    const saved = readBrain();
    hud.innerHTML =
      '<div class="big">Generation ' + sim.generation + "</div>" +
      "Alive: " + alive + " / " + t.cars.length +
      " · Best fitness: " + Math.round(t.best.fitness) +
      "<br>Saved brain: " + (saved ? Math.round(saved.fitness) : "none");
  } else {
    hud.innerHTML = "";
  }
}

function updateStats() {
  if (!world) return;
  $("#stats").innerHTML =
    world.graph.points.length + " points · " + world.graph.segments.length + " roads · " +
    world.markings.length + " markings<br>" +
    world.buildings.length + " buildings · " + world.trees.length + " trees";
}

function updateBrainStatus() {
  const saved = readBrain();
  $("#brainStatus").textContent = saved
    ? "Saved brain: fitness " + Math.round(saved.fitness) + " (generation " + (saved.generation || "?") + ")"
    : "No saved brain yet.";
}

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------
let lastStatsVersion = -1;
function loop() {
  const graphEd = editors.graph;
  if (world.generatedVersion !== world.graph.version) {
    world.generate({ quick: graphEd.dragging });
  } else if (world.generatedQuick && !graphEd.dragging) {
    world.generate();
  }
  if (lastStatsVersion !== world.generatedVersion + (world.generatedQuick ? 0.5 : 0)) {
    lastStatsVersion = world.generatedVersion + (world.generatedQuick ? 0.5 : 0);
    updateStats();
  }

  world.update();
  updateSim();

  viewport.reset(prefs.night ? "#1f4d33" : "#2a5");
  const view = viewport.getVisibleBounds();
  const viewPoint = viewport.getViewPoint();
  world.draw(ctx, viewPoint, { view, route: sim.route, drawCars });
  if (prefs.night) drawNight(ctx, view);

  const editor = editors[mode];
  if (editor) {
    ctx.globalAlpha = mode === "graph" ? 0.75 : 1;
    editor.display();
    ctx.globalAlpha = 1;
  }

  updateHUD();
  if (prefs.minimap) {
    const cars = mode === "play" ? [...sim.traffic, ...sim.aiCars] : mode === "train" ? [sim.training.best] : [];
    miniMap.draw(world, viewport, cars, mode === "play" ? sim.player : null);
  }
  if (mode === "train") {
    brainCtx.clearRect(0, 0, brainCanvas.width, brainCanvas.height);
    brainCtx.lineDashOffset = -performance.now() / 50;
    Visualizer.drawNetwork(brainCtx, sim.training.best.brain, brainCanvas.width, brainCanvas.height);
  }
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// UI construction
// ---------------------------------------------------------------------------
function buildToolbar() {
  const group = $("#editTools");
  TOOLS.forEach((tool, i) => {
    const b = document.createElement("button");
    b.dataset.mode = tool.mode;
    b.title = tool.label + " (" + (i + 1) + ")";
    b.innerHTML = tool.icon + " <span>" + tool.label + "</span>";
    group.appendChild(b);
  });
  document.querySelectorAll("[data-mode]").forEach((b) =>
    b.addEventListener("click", () => setMode(b.dataset.mode))
  );
}

function makeSlider(container, { label, min, max, step, get, set, format = (v) => v, live = false }) {
  const wrap = document.createElement("div");
  wrap.className = "slider";
  wrap.innerHTML = '<div class="label"><span>' + label + "</span><b></b></div>";
  const input = document.createElement("input");
  input.type = "range";
  Object.assign(input, { min, max, step });
  wrap.appendChild(input);
  container.appendChild(wrap);
  const out = wrap.querySelector("b");
  const sync = () => {
    input.value = get();
    out.textContent = format(+input.value);
  };
  input.addEventListener("input", () => {
    out.textContent = format(+input.value);
    if (live) set(+input.value);
  });
  input.addEventListener("change", () => set(+input.value));
  sync();
  return sync;
}

const generationSyncers = [];
function regenerate() {
  world.generate();
  commit();
}

function buildPanel() {
  const GEN = [
    { key: "roadWidth", label: "Road width", min: 40, max: 240, step: 5 },
    { key: "roadRoundness", label: "Road roundness", min: 1, max: 20, step: 1 },
    { key: "buildingWidth", label: "Building depth", min: 50, max: 300, step: 5 },
    { key: "buildingMinLength", label: "Building min length", min: 50, max: 400, step: 5 },
    { key: "spacing", label: "Spacing", min: 10, max: 200, step: 5 },
    { key: "treeSize", label: "Tree size", min: 40, max: 300, step: 5 },
    { key: "maxTrees", label: "Max trees", min: 0, max: 3000, step: 50 },
  ];
  for (const g of GEN) {
    generationSyncers.push(
      makeSlider($("#genSliders"), {
        ...g,
        get: () => world.settings[g.key],
        set: (v) => {
          world.settings[g.key] = v;
          regenerate();
        },
      })
    );
  }

  makeSlider($("#driveSliders"), {
    label: "Traffic cars", min: 0, max: 60, step: 1, live: true,
    get: () => prefs.trafficCount,
    set: (v) => {
      prefs.trafficCount = v;
      savePrefs();
      if (mode === "play") setTrafficCount(v);
    },
  });
  makeSlider($("#trainSliders"), {
    label: "Population", min: 10, max: 500, step: 10,
    get: () => prefs.population,
    set: (v) => {
      prefs.population = v;
      savePrefs();
    },
  });
  makeSlider($("#trainSliders"), {
    label: "Mutation amount", min: 0, max: 1, step: 0.01, format: (v) => v.toFixed(2),
    get: () => prefs.mutation,
    set: (v) => {
      prefs.mutation = v;
      savePrefs();
    },
  });

  const bindPref = (id, key, after = () => {}) => {
    const el = $(id);
    el.checked = prefs[key];
    el.addEventListener("change", () => {
      prefs[key] = el.checked;
      savePrefs();
      after();
    });
  };
  bindPref("#nightChk", "night");
  bindPref("#sensorsChk", "showSensors");
  bindPref("#minimapChk", "minimap", syncMinimap);
  bindPref("#routeChk", "showRoute", () => mode === "play" && updateRoute());
  bindPref("#invincibleChk", "invincible");
  bindPref("#autoEvolveChk", "autoEvolve");
  bindPref("#autosaveChk", "autosave", () => prefs.autosave && autosaveNow(true));

  $("#snapSelect").value = String(prefs.snap);
  $("#snapSelect").addEventListener("change", (e) => {
    prefs.snap = +e.target.value;
    savePrefs();
    if (editors.graph) editors.graph.snap = prefs.snap;
  });

  $("#buildingsChk").addEventListener("change", (e) => {
    world.settings.buildingsEnabled = e.target.checked;
    regenerate();
  });
  $("#treesChk").addEventListener("change", (e) => {
    world.settings.treesEnabled = e.target.checked;
    regenerate();
  });
  $("#seedInput").addEventListener("change", (e) => {
    world.settings.seed = Math.floor(+e.target.value) || 1;
    regenerate();
  });
  $("#reseedBtn").addEventListener("click", () => {
    world.settings.seed = Math.floor(Math.random() * 1e6);
    $("#seedInput").value = world.settings.seed;
    regenerate();
  });

  // World buttons
  $("#newBtn").addEventListener("click", () => replaceWorld(new World(new Graph()), "🗒️ Fresh empty world – click to start drawing roads"));
  $("#sampleBtn").addEventListener("click", () => replaceWorld(Samples.sampleCity(), "🏙️ Sample city loaded"));
  $("#randomBtn").addEventListener("click", () => {
    toast("Generating…");
    setTimeout(() => replaceWorld(Samples.randomCity(), "🎲 Random city generated"), 20);
  });
  $("#decorateBtn").addEventListener("click", () => {
    Samples.decorate(world);
    commit();
    toast("🚦 Markings placed automatically");
  });
  $("#clearMarkingsBtn").addEventListener("click", () => {
    world.markings = [];
    setWorld(world, { fit: false });
    commit();
    toast("🧽 Markings cleared");
  });
  $("#fitBtn").addEventListener("click", () => {
    sim.follow = false;
    fitView();
  });
  $("#exportBtn").addEventListener("click", exportWorld);
  $("#importBtn").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", importWorldFile);
  $("#screenshotBtn").addEventListener("click", () => {
    const a = document.createElement("a");
    a.download = "virtual-world.png";
    a.href = canvas.toDataURL("image/png");
    a.click();
  });

  // Slots
  $("#saveSlotBtn").addEventListener("click", () => {
    const name = $("#slotName").value.trim() || "World " + new Date().toLocaleString();
    const worlds = readJSON(STORE.worlds, {});
    worlds[name] = { savedAt: Date.now(), data: world.toJSON() };
    if (writeJSON(STORE.worlds, worlds)) toast("💾 Saved “" + name + "”");
    else toast("⚠️ Not enough browser storage – use Export file");
    $("#slotName").value = "";
    renderSlots();
  });
  renderSlots();

  // Brain
  $("#saveBrainBtn").addEventListener("click", () => saveBestBrain(true));
  $("#discardBrainBtn").addEventListener("click", discardBrain);
  $("#nextGenBtn").addEventListener("click", nextGeneration);
  $("#addAiBtn").addEventListener("click", addAiDriver);
  updateBrainStatus();

  // Header
  $("#undoBtn").addEventListener("click", undo);
  $("#redoBtn").addEventListener("click", redo);
  $("#helpBtn").addEventListener("click", () => $("#helpDialog").showModal());
  $("#panelToggle").addEventListener("click", togglePanel);
  document.body.classList.toggle("panel-open", prefs.panelOpen);
  syncMinimap();
}

function togglePanel() {
  prefs.panelOpen = !prefs.panelOpen;
  document.body.classList.toggle("panel-open", prefs.panelOpen);
  savePrefs();
}

function syncMinimap() {
  $("#miniMap").style.display = prefs.minimap ? "" : "none";
  $("#minimapChk").checked = prefs.minimap;
}

function syncWorldUI() {
  generationSyncers.forEach((s) => s());
  $("#buildingsChk").checked = world.settings.buildingsEnabled;
  $("#treesChk").checked = world.settings.treesEnabled;
  $("#seedInput").value = world.settings.seed;
  updateStats();
}

function renderSlots() {
  const list = $("#slotList");
  list.innerHTML = "";
  const worlds = readJSON(STORE.worlds, {});
  for (const [name, entry] of Object.entries(worlds).sort((a, b) => b[1].savedAt - a[1].savedAt)) {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = name;
    label.title = name;
    const date = document.createElement("small");
    date.textContent = new Date(entry.savedAt).toLocaleDateString();
    const load = document.createElement("button");
    load.textContent = "Load";
    load.addEventListener("click", () => replaceWorld(World.load(entry.data), "📂 Loaded “" + name + "”"));
    const del = document.createElement("button");
    del.textContent = "✕";
    del.title = "Delete";
    del.addEventListener("click", () => {
      if (!confirm("Delete saved world “" + name + "”?")) return;
      const all = readJSON(STORE.worlds, {});
      delete all[name];
      writeJSON(STORE.worlds, all);
      renderSlots();
    });
    li.append(label, date, load, del);
    list.appendChild(li);
  }
}

function exportWorld() {
  const blob = new Blob([JSON.stringify(world.toJSON())], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "my-world.world.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function importWorldFile(evt) {
  const file = evt.target.files[0];
  evt.target.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (data.elements) {
        importOsmData(data);
      } else {
        replaceWorld(World.load(data), "📂 Imported " + file.name);
      }
    } catch (e) {
      console.error(e);
      toast("⚠️ Couldn't read that file: " + e.message, 4000);
    }
  };
  reader.readAsText(file);
}

// ---------------------------------------------------------------------------
// OSM dialog
// ---------------------------------------------------------------------------
function importOsmData(data) {
  const { points, segments } = Osm.parseRoads(data);
  const w = new World(new Graph(points, segments), { maxTrees: 600 });
  replaceWorld(w, "🗺️ Imported " + segments.length + " road segments");
  viewport.zoom = clamp(viewport.zoom, 1, viewport.maxZoom);
}

function setupOsmDialog() {
  const dialog = $("#osmDialog");
  const status = $("#osmStatus");
  const refreshQuery = () => {
    const bbox = Osm.bboxAround(+$("#osmLat").value, +$("#osmLon").value, +$("#osmRadius").value);
    $("#osmQuery").textContent = Osm.buildQuery(...bbox);
  };
  ["#osmLat", "#osmLon", "#osmRadius"].forEach((id) => $(id).addEventListener("input", refreshQuery));
  dialog.querySelectorAll("[data-ll]").forEach((b) =>
    b.addEventListener("click", () => {
      const [lat, lon] = b.dataset.ll.split(",");
      $("#osmLat").value = lat;
      $("#osmLon").value = lon;
      refreshQuery();
    })
  );
  $("#osmBtn").addEventListener("click", () => {
    refreshQuery();
    status.textContent = "";
    dialog.showModal();
  });

  const run = async (getData) => {
    try {
      status.textContent = "⏳ Working… (big areas can take a while)";
      const data = await getData();
      status.textContent = "⏳ Building world…";
      await new Promise((r) => setTimeout(r, 30));
      importOsmData(data);
      dialog.close();
    } catch (e) {
      console.error(e);
      status.textContent = "⚠️ " + e.message;
    }
  };
  $("#osmFetchBtn").addEventListener("click", () =>
    run(() => Osm.fetchArea(+$("#osmLat").value, +$("#osmLon").value, clamp(+$("#osmRadius").value, 50, 2000)))
  );
  $("#osmParseBtn").addEventListener("click", () => run(async () => JSON.parse($("#osmText").value)));
}

// ---------------------------------------------------------------------------
// Global input
// ---------------------------------------------------------------------------
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
viewport.onUserPan = () => (sim.follow = false);
miniMap.onJump = (p) => {
  sim.follow = false;
  viewport.lookAt(p);
};
window.addEventListener("resize", () => viewport.resize());

window.addEventListener("keydown", (e) => {
  if (isTyping(e) || document.querySelector("dialog[open]")) return;
  const k = e.key.toLowerCase();
  const mod = e.metaKey || e.ctrlKey;
  if (mod && k === "z") {
    e.preventDefault();
    return e.shiftKey ? redo() : undo();
  }
  if (mod && k === "y") {
    e.preventDefault();
    return redo();
  }
  if (mod && k === "s") {
    e.preventDefault();
    return autosaveNow(true);
  }
  if (mod || e.altKey) return;

  const driving = mode === "play" || mode === "train";
  if (/^[1-9]$/.test(e.key) && TOOLS[+e.key - 1]) return setMode(TOOLS[+e.key - 1].mode);
  switch (k) {
    case "p":
      return setMode(mode === "play" ? "graph" : "play");
    case "t":
      return setMode(mode === "train" ? "graph" : "train");
    case "f":
      sim.follow = false;
      return fitView();
    case "n":
      prefs.night = !prefs.night;
      $("#nightChk").checked = prefs.night;
      return savePrefs();
    case "m":
      prefs.minimap = !prefs.minimap;
      savePrefs();
      return syncMinimap();
    case "h":
    case "?":
      return $("#helpDialog").showModal();
    case "escape":
      if (driving) setMode("graph");
      return;
    case "r":
      if (mode === "play") respawnPlayer();
      return;
    case "c":
      if (driving) sim.follow = true;
      return;
  }
});

window.addEventListener("beforeunload", () => {
  if (prefs.autosave && world) autosaveNow(false);
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(function boot() {
  buildToolbar();
  const saved = prefs.autosave ? readJSON(STORE.autosave, null) : null;
  let initial = null;
  if (saved) {
    try {
      initial = World.load(saved);
    } catch (e) {
      console.error("Autosave was unreadable, loading sample instead", e);
    }
  }
  const firstVisit = !initial && !localStorage.getItem(STORE.prefs);
  world = initial || Samples.sampleCity();
  buildPanel();
  setupOsmDialog();
  setWorld(world, { fit: true });
  if (saved && saved.view) {
    viewport.zoom = saved.view.zoom;
    viewport.offset = new Point(saved.view.offset.x, saved.view.offset.y);
  }
  history.current = serialize();
  updateUndoButtons();
  savePrefs();
  if (location.hash === "#train") setMode("train");
  else if (firstVisit) $("#helpDialog").showModal();
  requestAnimationFrame(loop);
})();
