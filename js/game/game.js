// ---------------------------------------------------------------------------
// Game wiring: loop, UI, scanning, social sharing, and hidden extras.
// ---------------------------------------------------------------------------
"use strict";

const $ = (sel) => document.querySelector(sel);
const SAVE_KEY = "vw.city";
const PREFS_KEY = "vw.gamePrefs";
const VERSION = "0.11.0";

const canvas = $("#cityCanvas");
const ctx = canvas.getContext("2d");
const viewport = new Viewport(canvas, 1.3);
viewport.minZoom = 0.35;
viewport.maxZoom = 8;

const prefs = { extras: false, welcomed: false, seenVersion: null, ...readJSON(PREFS_KEY, {}) };
const savePrefs = () => writeJSON(PREFS_KEY, prefs);

let city = null;
let renderer = null;
let visit = null; // { city, renderer } while looking at someone else's town
const online = new Online(window.VW_CONFIG);
const ui = { placing: null, placeStation: null, roadPick: null, focus: null, selected: null, floaters: [], cars: [], drive: null, follow: null, collector: null, responders: [] };

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
  } catch {
    return false;
  }
}

// Pushes the town to the cloud (leaderboard card + backup). Fire and forget.
let lastSync = 0;
function syncOnline(force = false) {
  if (!online.ready || !city || (!force && Date.now() - lastSync < 60000)) return;
  lastSync = Date.now();
  online.publish(city).catch((e) => console.warn(e));
}

function saveGame() {
  if (!city) return;
  city.lastSeen = Date.now();
  if (!writeJSON(SAVE_KEY, city.toSave())) toast("⚠️ Couldn't save – storage full?");
}

// 9999, 12.3K, 123K, 1.2M, 45.6M, 2.0B. Rolls over to the next unit instead
// of showing "1000K".
const FMT_UNITS = [[1e3, "K"], [1e6, "M"], [1e9, "B"]];
const fmt = (n) => {
  if (n < 10000) return String(Math.floor(n));
  for (const [size, suffix] of FMT_UNITS) {
    const v = n / size;
    const s = v.toFixed(v >= 99.95 ? 0 : 1);
    if (+s < 1000 || suffix === "B") return s + suffix;
  }
};
const duration = (ms) => {
  const m = Math.max(1, Math.ceil(ms / 60000));
  return m >= 60 ? Math.floor(m / 60) + "h " + (m % 60) + "m" : m + "m";
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------------------------------------------------------------------------
// Feedback: toast, modal, floating numbers, haptics
// ---------------------------------------------------------------------------
let toastTimer = null;
function toast(msg, ms = 2400) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

const modalQueue = [];
function showModal({ icon, title, body = "", button = "Nice!", onClose = null, extra = null }) {
  modalQueue.push({ icon, title, body, button, onClose, extra });
  if (modalQueue.length === 1) renderModal();
}
function renderModal() {
  const m = modalQueue[0];
  if (!m) return ($("#modalBackdrop").hidden = true);
  $("#modalIcon").textContent = m.icon;
  $("#modalTitle").textContent = m.title;
  $("#modalBody").innerHTML = m.body + (m.extra ? "<button id='modalExtra' class='ghost big'>" + esc(m.extra.label) + "</button>" : "");
  $("#modalOk").textContent = m.button;
  $("#modalBackdrop").hidden = false;
}
// The optional second button closes the modal without its onClose and runs its own action.
$("#modalBody").addEventListener("click", (e) => {
  if (e.target.id !== "modalExtra") return;
  const m = modalQueue.shift();
  renderModal();
  m.extra.onClick();
});
$("#modalOk").addEventListener("click", () => {
  const m = modalQueue.shift();
  if (m && m.onClose) m.onClose();
  renderModal();
});

function floater(p, text, color) {
  ui.floaters.push({ x: p.x, y: p.y, text, color, age: 0, life: 1.3 });
}

function buzz(ms = 30) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

function bump(id) {
  const el = $(id).parentElement;
  el.classList.add("bump");
  setTimeout(() => el.classList.remove("bump"), 160);
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------
let sheetOnClose = null;
function openSheet(title, html, mount = () => {}, onClose = null) {
  $("#sheetTitle").textContent = title;
  $("#sheetBody").innerHTML = html;
  $("#sheet").hidden = false;
  $("#sheetBackdrop").hidden = false;
  sheetOnClose = onClose;
  mount($("#sheetBody"));
}
function closeSheet() {
  $("#sheet").hidden = true;
  $("#sheetBackdrop").hidden = true;
  ui.selected = null;
  if (sheetOnClose) sheetOnClose();
  sheetOnClose = null;
}
$("#sheetClose").addEventListener("click", closeSheet);
$("#sheetBackdrop").addEventListener("click", closeSheet);

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------
let lastShown = {};
function updateTopbar() {
  const c = visit ? visit.city : city;
  const vals = {
    mat: visit ? "–" : fmt(c.materials),
    coin: visit ? "–" : fmt(c.coins),
    pop: fmt(c.pop) + (visit ? "" : "/" + fmt(c.capacity)),
    appeal: c.appeal.toFixed(2),
  };
  for (const [k, v] of Object.entries(vals)) {
    if (lastShown[k] !== v) {
      if (lastShown[k] !== undefined && !visit && (k === "mat" || k === "coin") && parseFloat(v) > parseFloat(lastShown[k])) bump("#" + k + "Val");
      $("#" + k + "Val").textContent = v;
      lastShown[k] = v;
    }
  }
  $("#cityName").textContent = c.name;
  const tier = TIERS[c.tier];
  $("#tierBadge").textContent = tier.icon + " " + tier.name;

  const bar = $("#roadBar");
  if (visit) {
    bar.hidden = true;
  } else {
    bar.hidden = false;
    const job = city.roadJob;
    if (job) {
      const p = clamp(job.t / job.duration, 0, 1);
      bar.classList.add("building");
      bar.querySelector(".fill").style.width = p * 100 + "%";
      bar.querySelector(".label").textContent = "🚧 Building a new road… " + Math.round(p * 100) + "%";
    } else if (city.roadChoice) {
      bar.classList.remove("building");
      bar.classList.add("choose");
      bar.querySelector(".fill").style.width = "100%";
      bar.querySelector(".label").textContent = "🛣️ Choose your next road! Tap here";
    } else {
      const cost = city.roadCost();
      bar.classList.remove("building", "choose");
      bar.querySelector(".fill").style.width = clamp(city.materials / cost, 0, 1) * 100 + "%";
      bar.querySelector(".label").textContent = "🛣️ Next road: " + Math.floor(city.materials) + " / " + cost + " 🧱";
    }
  }
  if (ui.roadPick != null) {
    if (visit || !city.roadChoice) stopRoadPick();
    else updateRoadBuild();
  }
  $("#compassBtn").hidden = !viewport.angle;
  const chip = $("#collectorChip");
  chip.hidden = !ui.collector || !!visit;
  if (ui.collector) chip.querySelector("b").textContent = ui.collector.total - ui.collector.pool.size + "/" + ui.collector.total;
  const safe = $("#safetyChip");
  safe.hidden = c.tierReached < SAFETY_TIER;
  if (!safe.hidden) {
    const sc = visit ? null : city.safety();
    safe.querySelector("b").textContent = visit ? "–" : Math.round(sc.score * 100) + "%";
    safe.classList.toggle("alert", !visit && (city.unpaid || city.incidents.length > 0));
  }
  $("#dailyBtn .dot").hidden = !city.dailyStatus().available;
  $("#itemsBtn .dot").hidden = !city.inventory.length;
}

$("#tierBadge").addEventListener("click", openMilestones);
$("#roadBar").addEventListener("click", () => {
  if (!visit && city.roadChoice && !ui.placing) startRoadPick();
});
// Tap the 🚚 chip to fly to the collector and follow it (until you pan away).
// With two trucks, each tap switches to the other one.
$("#collectorChip").addEventListener("click", () => {
  if (!ui.collector) return;
  const trucks = ui.collector.trucks;
  ui.follow = trucks[(trucks.indexOf(ui.follow) + 1) % trucks.length];
});

// Twist with two fingers to rotate the map; the compass turns it back to north.
$("#compassBtn").addEventListener("click", () => {
  viewport.angle = Math.atan2(Math.sin(viewport.angle), Math.cos(viewport.angle));
  ui.unrotate = true;
});
$("#appealChip").addEventListener("click", openAppeal);
$("#safetyChip").addEventListener("click", () => visit || openSafety());

// Every tier, with progress toward the next one.
function openMilestones() {
  const c = visit ? visit.city : city;
  const t = c.tier, next = TIERS[t + 1];
  let html = "";
  if (next) {
    const from = TIERS[t].pop, p = clamp((c.pop - from) / (next.pop - from), 0, 1);
    html +=
      "<div class='card'><h3>Next: " + next.icon + " " + next.name + "</h3>" +
      "<div class='road-bar'><div class='fill' style='width:" + p * 100 + "%'></div>" +
      "<span class='label'>👥 " + Math.floor(c.pop) + " / " + next.pop + " people</span></div>" +
      "<p class='muted'>" + (next.pop - Math.floor(c.pop)) + " more people to go." +
      (visit ? "" : " Reward: +" + next.reward + " 🧱") + "</p>" +
      (!visit && c.pop >= c.capacity ? "<p class='muted'>🏠 Every home is full – new roads bring new homes, and scanning brings materials for roads.</p>" : "") +
      "</div>";
  } else {
    html += "<div class='card'><h3>🏆 Top tier reached!</h3><p class='muted'>" + esc(c.name) + " is a " + TIERS[t].name + ". Keep growing to climb the leaderboard.</p></div>";
  }
  html += "<div class='list'>" + TIERS.map((tier, i) =>
    "<div class='item-row" + (i === t ? " current" : "") + "'><span class='emoji'>" + tier.icon + "</span><div class='grow'><b>" + tier.name + "</b>" +
    "<small>" + (tier.pop ? tier.pop + " people" : "Where every town starts") + (tier.reward ? " · +" + tier.reward + " 🧱" : "") + "</small></div>" +
    "<span>" + (i <= t ? "✅" : "") + "</span></div>").join("") + "</div>";
  openSheet("🏆 Milestones", html);
}

// What appeal does, where this town's comes from, and how to raise it.
function openAppeal() {
  const c = visit ? visit.city : city;
  const placed = {};
  for (const l of c.lots) if (l.kind === "special" && l.building <= 0) placed[l.special] = (placed[l.special] || 0) + 1;
  const ids = Object.keys(placed);
  const unplaced = visit ? 0 : city.inventory.length;
  const pct = (a) => "+" + Math.round(a * 100) + "%";
  let html =
    "<div class='stat-grid'><div class='stat'><b>✨ " + c.appeal.toFixed(2) + "</b><span>" + (visit ? "Their" : "Your") + " appeal</span></div>" +
    "<div class='stat'><b>" + pct(c.appeal - 1) + "</b><span>Faster growth</span></div></div>" +
    "<p>Appeal speeds up everything: empty lots develop faster, people move in faster, and shops earn more coins.</p>" +
    "<div class='card'><h3>Where it comes from</h3><div class='list'>" +
    "<div class='row'><span class='grow'>🏕️ Every town</span><b>1.00</b></div>" +
    (c.tierReached >= SAFETY_TIER ? "<div class='row'><span class='grow'>🛡️ Fire &amp; police coverage</span><b>" + (c.safetyAppeal() >= 0 ? "+" : "") + Math.round(c.safetyAppeal() * 100) + "%</b></div>" : "") +
    ids.map((id) => {
      const sp = SPECIALS[id];
      return "<div class='row'><span class='grow'>" + sp.icon + " " + sp.name + (placed[id] > 1 ? " ×" + placed[id] : "") + "</span><b>" + pct(sp.appeal * placed[id]) + "</b></div>";
    }).join("") +
    "</div>" + (ids.length ? "" : "<p class='muted'>No special buildings yet.</p>") + "</div>";
  if (!visit) {
    html +=
      "<div class='card'><h3>How to raise it</h3><p class='muted'>Scanning codes sometimes drops special buildings. Place them on any lot – rarer ones add more:</p>" +
      "<div class='list'>" + Object.keys(RARITY_INFO).map((r) => {
        const all = Object.values(SPECIALS).filter((sp) => sp.rarity === r);
        const lo = Math.min(...all.map((sp) => sp.appeal)), hi = Math.max(...all.map((sp) => sp.appeal));
        return "<div class='row'><span class='grow'><span class='rarity' style='color:" + RARITY_INFO[r].color + "'>" + RARITY_INFO[r].label + "</span> " +
          all.map((sp) => sp.icon).join(" ") + "</span><b>" + pct(lo) + (hi > lo ? "–" + Math.round(hi * 100) + "%" : "") + "</b></div>";
      }).join("") + "</div></div>" +
      (unplaced ? "<button id='appealItems' class='primary big'>🎒 Place your " + unplaced + " item" + (unplaced > 1 ? "s" : "") + "</button>" : "");
  }
  openSheet("✨ Appeal", html, (body) => {
    const b = body.querySelector("#appealItems");
    if (b) b.addEventListener("click", () => $("#itemsBtn").click());
  });
}

// ---------------------------------------------------------------------------
// Events from the simulation
// ---------------------------------------------------------------------------
function handleEvents(events) {
  for (const e of events) {
    if (e.type === "road") {
      toast("🛣️ New road finished! " + e.lots + " new lots to build on");
      buzz(40);
      saveGame();
    } else if (e.type === "roadChoice") {
      toast("🛣️ Enough 🧱 for a new road – choose where it goes!");
      buzz(30);
      saveGame();
    } else if (e.type === "tier") {
      const t = TIERS[e.tier];
      showModal({
        icon: t.icon,
        title: city.name + " is now a " + t.name + "!",
        body: "Your population reached " + t.pop + ".<div class='gains'><span class='gain'>+" + (t.reward || 0) + " 🧱</span></div>",
        button: "Hooray!",
      });
      saveGame();
    } else if (e.type === "safetyUnlocked") {
      showSafetyIntro();
    } else if (e.type === "incident") {
      const inc = e.inc, svc = SERVICES[inc.type];
      const what = inc.type === "fire" ? "🔥 Fire at a " + buildingName(inc.lot).slice(3) : "🦹 Robbery at a " + buildingName(inc.lot).slice(3);
      toast(city.stationFor(inc.lot, inc.type) ? what + " – " + svc.vehicle + " on the way!" : what + "! No " + svc.name.toLowerCase() + " covers it – tap it to call a crew", 3500);
      buzz([40, 60, 40]);
    } else if (e.type === "burned") {
      floater(e.inc.lot.center, e.lost ? "🔥 Burned down" : "🔥 Lost a level", "#fca5a5");
      toast(e.lost ? "🔥 A building burned down. Fire stations stop this!" : "🔥 A building burned and lost a level", 3500);
      saveGame();
    } else if (e.type === "robbed") {
      floater(e.inc.lot.center, "🦹 −" + e.stolen + " 💰", "#fca5a5");
    } else if (e.type === "resolved") {
      floater(e.inc.lot.center, e.inc.type === "fire" ? "✅ Fire's out!" : "✅ Robbers caught!", "#bbf7d0");
    } else if (e.type === "unpaid") {
      toast("⚠️ Out of 💰 for station upkeep – fire & police stopped responding", 4000);
    } else if (e.type === "paid") {
      toast("✅ Upkeep paid – fire & police are back on duty");
    } else if (e.type === "built" && !visit) {
      const b = e.lot;
      const label = KIND_ICONS[b.kind] || SERVICES[b.special]?.icon || SPECIALS[b.special]?.icon || "✨";
      floater(b.center, label + " built!", "#bbf7d0");
    }
  }
}

// ---------------------------------------------------------------------------
// Tapping the map
// ---------------------------------------------------------------------------
function onTap(world) {
  const active = visit || { city, renderer };
  const vp = viewport.getViewPoint();
  const z = viewport.zoom;

  if (!visit && !ui.placing && !ui.placeStation) {
    for (const inc of city.incidents) {
      if (distance(renderer.incidentAnchor(inc.lot, vp), world) < 36 * Math.max(1, z * 0.75)) return openLotSheet(inc.lot, false);
    }
    for (const lot of city.lots) {
      if (!city.bagReady(lot)) continue;
      if (distance(renderer.bubbleAnchor(lot, vp), world) < 34 * Math.max(1, z * 0.75)) return collect(lot);
    }
  }

  if (!visit && !ui.placing && city.roadChoice) {
    const i = renderer.choiceAt(world, z);
    if (i >= 0) return startRoadPick(i);
  }

  const lot = active.city.lots.find((l) => l.poly.containsPoint(world));
  if (ui.placeStation) {
    if (!lot) return toast("Tap an empty lot, or a building to replace");
    if (lot.kind === "special" || lot.kind === "svc") return toast("Pick a lot without a special building or station");
    return confirmStation(lot);
  }
  if (ui.placing) {
    if (!lot) return toast("Tap an empty lot, or a building to replace");
    if (lot.kind === "special" || lot.kind === "svc") return toast("That lot already has a special building");
    return lot.kind ? confirmReplace(lot) : placeSpecial(lot);
  }
  if (!lot) {
    ui.selected = null;
    return;
  }
  if (!visit && city.bagReady(lot)) return collect(lot);
  openLotSheet(lot, !!visit);
}

function collect(lot) {
  const got = city.collect(lot);
  if (got) {
    floater(renderer.bubbleAnchor(lot, viewport.getViewPoint()), "+" + got + (lot.kind === "ind" ? " 🧱" : " 💰"));
    buzz(15);
  }
}

function placeSpecial(lot) {
  const id = ui.placing;
  const stored = lot.kind === "com" || lot.kind === "ind" ? Math.floor(lot.coins) : 0;
  const unit = lot.kind === "ind" ? " 🧱" : " 💰";
  if (!city.placeSpecial(lot, id)) return;
  floater(lot.center, SPECIALS[id].icon + (SPECIALS[id].station ? " level-2 station!" : " placed!"), "#fde68a");
  if (stored > 0) toast("Collected +" + stored + unit + " first");
  buzz(40);
  stopPlacing();
  saveGame();
}

// Placing a special on a home, shop or factory tears it down, so ask first.
function confirmReplace(lot) {
  const s = SPECIALS[ui.placing];
  const lvl = Math.max(1, lot.effectiveLevel);
  const what = lot.kind === "res" ? "home for " + lvl * 6 + " residents" : lvl * 5 + " jobs";
  const stored = lot.kind === "res" ? 0 : Math.floor(lot.coins);
  ui.selected = lot;
  const html =
    "<p>Tear down this <b>" + buildingName(lot) + "</b> (level " + lvl + ", " + what + ") to make room for your <b>" + s.icon + " " + s.name + "</b>?</p>" +
    (lot.level > 1 ? "<p class='muted'>Its upgrades aren't refunded.</p>" : "") +
    (stored > 0 ? "<p class='muted'>The " + stored + (lot.kind === "ind" ? " 🧱" : " 💰") + " inside is collected first.</p>" : "") +
    "<button id='replaceBtn' class='gold big'>Replace with " + s.icon + " " + s.name + "</button>" +
    "<button id='keepBtn' class='big' style='margin-top:8px'>Keep it</button>";
  openSheet("Replace this building?", html, (body) => {
    body.querySelector("#replaceBtn").addEventListener("click", () => {
      closeSheet();
      placeSpecial(lot);
    });
    body.querySelector("#keepBtn").addEventListener("click", closeSheet);
  });
}

const KIND_ICONS = { res: "🏠", com: "🏪", ind: "🏭" };
const BUILDING_NAMES = {
  res: ["", "Cottage", "Townhouse", "Apartments"],
  com: ["", "Corner shop", "Market", "Office tower"],
  ind: ["", "Workshop", "Factory", "Industrial plant"],
};
function buildingName(lot, lvl = Math.max(1, lot.effectiveLevel)) {
  return KIND_ICONS[lot.kind] + " " + BUILDING_NAMES[lot.kind][lvl];
}

function openLotSheet(lot, readOnly) {
  ui.selected = lot;
  const c = readOnly ? visit.city : city;
  let title, html;
  if (lot.kind === "svc") return openStationSheet(lot, readOnly);
  if (lot.building > 0 && !readOnly) {
    title = "🏗️ Under construction";
    html = "<p>Builders are hard at work. Ready in about " + Math.ceil(lot.building) + " seconds.</p>";
  } else if (!lot.kind) {
    title = "🟩 Empty lot";
    html = "<p>This land will develop by itself into homes or shops as your town needs them.</p>" +
      (readOnly ? "" : "<p class='muted'>Got a special building? Place it here from 🎒 Items.</p>");
  } else if (lot.kind === "special") {
    const s = SPECIALS[lot.special], r = RARITY_INFO[s.rarity];
    const count = c.lots.filter((l) => l.special === lot.special).length;
    title = s.icon + " " + s.name;
    html =
      "<div class='special-hero' style='--rarity:" + r.color + "'><div class='special-icon'>" + s.icon + "</div>" +
      "<div><span class='rarity-pill'>" + r.label + "</span><p>" + s.about + "</p></div></div>" +
      "<div class='stat-grid'><div class='stat'><b>+" + Math.round(s.appeal * 100) + "% ✨</b><span>Faster growth</span></div>" +
      "<div class='stat'><b>" + count + "</b><span>In " + (readOnly ? "their" : "your") + " town</span></div></div>" +
      (readOnly ? "" : "<button id='returnBtn' class='big'>🎒 Return to bag</button>" +
        "<p class='muted' style='text-align:center'>The lot becomes empty and builds again by demand.</p>");
  } else {
    const lvl = lot.effectiveLevel;
    const kind = lot.kind;
    const unit = kind === "ind" ? "🧱" : "💰";
    title = buildingName(lot, lvl) + " · level " + lvl;
    html = kind === "res"
      ? "<p>Home for up to <b>" + lvl * 6 + " residents</b>.</p>"
      : kind === "ind"
        ? "<p>Provides <b>" + lvl * 5 + " jobs</b> and makes <b>" + Math.round(lvl * c.factoryRate() * 3600) + " 🧱/hour</b>.</p>"
        : "<p>Provides <b>" + lvl * 5 + " jobs</b> and earns <b>" + (lvl * 0.03 * c.appeal * 60).toFixed(1) + " 💰/min</b>.</p>";
    if (!readOnly) {
      if (kind !== "res") html += city.bagReady(lot)
        ? "<p>Waiting to collect: <b>" + Math.floor(lot.coins) + " " + unit + "</b></p>"
        : "<p class='muted'>Saving up: " + Math.floor(lot.coins) + " " + unit + " – the " + (kind === "ind" ? "📦 crate" : "💰 bag") + " appears at " + Math.ceil(city.storeCap(lot) * 0.25) + ".</p>";
      const up = city.upgradeInfo(lot);
      if (up) {
        const why = city.pop < up.needPop ? "Needs " + up.needPop + " population" : city.coins < up.cost ? "Not enough coins" : "";
        html += "<button id='upgradeBtn' class='gold big' " + (up.ok ? "" : "disabled") + ">⬆️ Upgrade to " + BUILDING_NAMES[kind][lvl + 1] + " · " + up.cost + " 💰</button>" +
          (why ? "<p class='muted' style='text-align:center'>" + why + "</p>" : "");
      } else if (lvl >= 3) {
        html += "<p class='muted'>Fully upgraded! 🌟</p>";
      }
    }
  }
  if (!readOnly && lot.incident) html = incidentCard(lot.incident) + html;
  openSheet(title, html, (body) => {
    const crew = body.querySelector("#crewBtn");
    if (crew) crew.addEventListener("click", () => {
      const e = city.callCrew(lot.incident);
      if (!e) return toast(lot.incident ? "Not enough coins" : "It's already been handled");
      handleEvents([e]);
      buzz(40);
      saveGame();
      closeSheet();
    });
    const back = body.querySelector("#returnBtn");
    if (back) {
      back.addEventListener("click", () => {
        const icon = SPECIALS[lot.special].icon;
        if (city.removeSpecial(lot)) {
          floater(lot.center, icon + " back in the bag", "#fde68a");
          buzz(30);
          saveGame();
          closeSheet();
        }
      });
    }
    const btn = body.querySelector("#upgradeBtn");
    if (btn) {
      btn.addEventListener("click", () => {
        if (city.upgrade(lot)) {
          floater(lot.center, "⬆️ Upgrading!", "#fde68a");
          buzz(40);
          saveGame();
          closeSheet();
        }
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------
const scanner = new Scanner($("#scanVideo"), (text, format) => {
  closeScanner();
  handleScan(text, format);
});

async function openScanner() {
  if (visit) return toast("Head back home to scan for your own town");
  $("#scanOverlay").hidden = false;
  if (!Scanner.canUseLiveCamera()) {
    $("#scanStatus").textContent = "Live camera needs a secure (https) link – take a photo of the code instead 👇";
    return;
  }
  $("#scanStatus").textContent = "Point your camera at any QR code";
  try {
    await scanner.start();
  } catch (e) {
    console.warn(e);
    $("#scanStatus").textContent = "Couldn't open the camera (" + (e.name || "error") + "). Take a photo instead 👇";
  }
}

function closeScanner() {
  scanner.stop();
  $("#scanOverlay").hidden = true;
}

$("#scanBtn").addEventListener("click", openScanner);
$("#scanCancel").addEventListener("click", closeScanner);
$("#photoInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  $("#scanStatus").textContent = "Reading photo…";
  try {
    const found = await scanner.decodeFile(file);
    if (!found) {
      $("#scanStatus").textContent = "No code found in that photo – try getting closer 🔍";
      return;
    }
    closeScanner();
    handleScan(found.text, found.format);
  } catch (err) {
    console.warn(err);
    $("#scanStatus").textContent = "Couldn't read that photo.";
  }
});

function handleScan(text, format = "qr_code") {
  if (!text || !text.trim()) return;
  buzz([30, 40, 30]);
  const r = Rewards.evaluate(text, format, city);
  if (city.scanned[r.key]) {
    showModal({
      icon: "🔁",
      title: "Already scanned!",
      body: "Your town already got its reward from this " + esc(r.label.toLowerCase()) + ".<br>Go find new codes out in the world! 🔍",
      button: "OK",
    });
    return;
  }
  city.applyReward(r);
  saveGame();
  let gains = "";
  if (r.materials) gains += "<span class='gain'>+" + r.materials + " 🧱</span>";
  if (r.coins) gains += "<span class='gain'>+" + r.coins + " 💰</span>";
  if (r.pop) gains += "<span class='gain'>+" + r.pop + " 👥</span>";
  let drop = "";
  if (r.item) {
    const s = SPECIALS[r.item];
    const info = RARITY_INFO[r.rarity];
    drop = "<div class='item-drop' style='border-color:" + info.color + "'><div class='emoji'>" + s.icon + "</div>" +
      "<div class='rarity' style='color:" + info.color + "'>" + info.label + " drop!</div><b>" + s.name + "</b>" +
      "<div class='muted'>Place it from 🎒 Items</div></div>";
  }
  showModal({
    icon: r.icon,
    title: r.label + "!",
    body: esc(r.flavor) + "<div class='gains'>" + gains + "</div>" + drop,
    button: r.item ? "Awesome!" : "Nice!",
  });
  online.recordScan(r.key, r.kind).then((n) => {
    if (n === 1) setTimeout(() => toast("🌍 You're the first explorer ever to find this code!", 3500), 900);
    else if (n > 1) setTimeout(() => toast("🌍 " + n + " explorers have found this code", 3000), 900);
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------
$("#dailyBtn").addEventListener("click", () => {
  if (visit) return;
  const s = city.dailyStatus();
  if (!s.available) {
    return openSheet("🎁 Daily gift", "<p>You already claimed today's gift. Come back tomorrow to keep your <b>" + city.daily.streak + "-day streak</b> 🔥</p><p class='muted'>Streaks give bigger gifts, up to 7 days.</p>");
  }
  const got = city.claimDaily();
  saveGame();
  showModal({
    icon: "🎁",
    title: "Daily gift · day " + got.streak + (got.streak > 1 ? " 🔥" : ""),
    body: "Thanks for checking in on " + esc(city.name) + "!<div class='gains'><span class='gain'>+" + got.materials + " 🧱</span><span class='gain'>+" + got.coins + " 💰</span></div>",
  });
});

$("#marketBtn").addEventListener("click", () => {
  if (visit) return;
  // Bundles of a tenth, three tenths and all of the current stock; bigger bundles are cheaper.
  const stock = city.marketStock();
  const unit = Math.max(10, Math.round(stock.total / 100) * 10);
  const offers = [
    { amount: unit, each: 6 },
    { amount: unit * 3, each: 5.5 },
    { amount: stock.left, each: 5 },
  ].filter((o, i, all) => o.amount > 0 && all.findIndex((x) => x.amount === o.amount) === i)
   .map((o) => ({ amount: o.amount, price: Math.round(o.amount * o.each) }));
  const html =
    "<p>Trade coins for building materials. Scanning codes out in the world is much cheaper! 😉</p>" +
    "<div class='card'><div class='road-bar'><div class='fill' style='width:" + (stock.left / stock.total) * 100 + "%'></div>" +
    "<span class='label'>In stock: " + stock.left + " / " + stock.total + " 🧱</span></div>" +
    "<p class='muted'>" + (stock.left ? "" : "Sold out – ") + "Restocks in " + duration(stock.restockIn) + ".</p></div>" +
    "<div class='list'>" + offers.map((o, i) =>
      "<div class='item-row'><span class='emoji'>🧱</span><div class='grow'><b>" + o.amount + " materials</b><small>" + o.price + " 💰</small></div>" +
      "<button data-offer='" + i + "' class='gold'" + (o.amount > stock.left ? " disabled" : "") + ">Buy</button></div>").join("") + "</div>" +
    collectorCard() +
    "<div class='card'><h3>📈 Your economy</h3><div class='stat-grid'>" +
    "<div class='stat'><b>" + fmt(city.capacity) + "</b><span>🏠 housing</span></div>" +
    "<div class='stat'><b>" + fmt(city.jobs) + "</b><span>💼 jobs</span></div>" +
    "<div class='stat'><b>" + city.roadCount + "</b><span>🛣️ roads</span></div>" +
    "<div class='stat'><b>" + city.lots.filter((l) => !l.kind).length + "</b><span>🟩 empty lots</span></div>" +
    "</div><p class='muted'>Shops earn 💰 – tap the bubbles above them to collect. Taxes from residents trickle in automatically.</p></div>";
  openSheet("🏪 Market", html, (body) => {
    const hire = body.querySelector("#hireBtn");
    if (hire) hire.addEventListener("click", () => {
      hireCollector();
      $("#marketBtn").click();
    });
    body.querySelectorAll("[data-offer]").forEach((b) =>
      b.addEventListener("click", () => {
        const o = offers[+b.dataset.offer];
        if (city.buyMaterials(o.amount, o.price)) {
          toast("+" + o.amount + " 🧱");
          saveGame();
          $("#marketBtn").click();
        } else {
          toast("Not enough coins");
        }
      })
    );
  });
});

$("#itemsBtn").addEventListener("click", () => {
  if (visit) return;
  const counts = {};
  for (const id of city.inventory) counts[id] = (counts[id] || 0) + 1;
  const ids = Object.keys(counts);
  const spots = city.lots.filter((l) => l.kind !== "special").length;
  const html = ids.length
    ? "<div class='list'>" + ids.map((id) => {
        const s = SPECIALS[id], r = RARITY_INFO[s.rarity];
        return "<div class='item-row'><span class='emoji'>" + s.icon + "</span><div class='grow'><b>" + s.name + (counts[id] > 1 ? " ×" + counts[id] : "") + "</b>" +
          "<small><span class='rarity' style='color:" + r.color + "'>" + r.label + "</span> · " + (s.station ? "a free level-2 " + SERVICES[s.station].name.toLowerCase() : "+" + Math.round(s.appeal * 100) + "% ✨") + "</small></div>" +
          "<button data-place='" + id + "' class='primary' " + (spots ? "" : "disabled") + ">Place</button></div>";
      }).join("") + "</div>" + (spots ? "" : "<p class='muted'>Every lot already has a special building – wait for a new road.</p>")
    : "<p>No special buildings yet.</p><p class='muted'>Scanning codes sometimes drops parks, schools, towers and more. Rarer codes, rarer drops! 🍀</p>";
  openSheet("🎒 Items", html, (body) => {
    body.querySelectorAll("[data-place]").forEach((b) => b.addEventListener("click", () => startPlacing(b.dataset.place)));
  });
});

// ---------------------------------------------------------------------------
// Choosing the next road
// ---------------------------------------------------------------------------
// The banner lists every offered road; tap one (or its ghost on the map) to
// look at it, then Build. `ui.roadPick` is the picked index, -1 for none yet.
function startRoadPick(i = -1) {
  if (!city.roadChoice) return;
  stopPlacing();
  closeSheet();
  ui.roadPick = i;
  ui.selected = null;
  renderRoadBanner();
  // Frame the roads in the part of the screen the banner and bottom bar don't cover.
  const opts = city.roadChoice;
  const shown = i >= 0 ? [opts[i]] : opts;
  const b = boundsOf(shown.flatMap((o) => [new Point(o.a.x, o.a.y), new Point(o.b.x, o.b.y)]));
  const pad = LOT_DEPTH + ROAD_W;
  const top = $("#roadBanner").getBoundingClientRect().bottom, bottom = $("#bottombar").getBoundingClientRect().top;
  const w = b.maxX - b.minX + pad * 2, h = b.maxY - b.minY + pad * 2;
  const zoom = clamp(Math.max((w * 1.15) / viewport.width, (h * 1.15) / Math.max(120, bottom - top), 1.3), viewport.minZoom, viewport.maxZoom);
  const shift = scale(viewport.toWorldVector(new Point(0, (top + bottom) / 2 - viewport.height / 2)), zoom / viewport.zoom);
  ui.focus = { at: scale(subtract(new Point((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2), shift), -1), zoom };
}

function renderRoadBanner() {
  const opts = city.roadChoice || [];
  $("#roadOptions").innerHTML = opts.map((o, i) =>
    "<button data-road='" + i + "' class='road-opt" + (ui.roadPick === i ? " on" : "") + "'><b>" + (i + 1) + "</b>" +
    "<span>" + o.lots + " lots" + (o.connects ? " · 🔁" : "") + "</span></button>").join("");
  $("#roadOptions").querySelectorAll("[data-road]").forEach((btn) =>
    btn.addEventListener("click", () => startRoadPick(+btn.dataset.road)));
  $("#roadHint").textContent = opts.some((o) => o.connects) ? "🔁 = joins up with another road" : "Each road costs the same";
  $("#roadBanner").hidden = false;
  updateRoadBuild();
}

function updateRoadBuild() {
  const cost = city.roadCost(), afford = city.materials >= cost;
  const build = $("#roadBuild");
  build.disabled = ui.roadPick < 0 || !afford;
  build.textContent = !afford ? "Need " + cost + " 🧱" : ui.roadPick < 0 ? "Pick a road" : "Build road " + (ui.roadPick + 1) + " · " + cost + " 🧱";
}

function stopRoadPick() {
  ui.roadPick = null;
  $("#roadBanner").hidden = true;
}
$("#roadCancel").addEventListener("click", stopRoadPick);
$("#roadBuild").addEventListener("click", () => {
  const i = ui.roadPick;
  if (!city.chooseRoad(i)) return;
  stopRoadPick();
  toast("🚧 Construction crews started road " + (i + 1));
  buzz(40);
  saveGame();
});

function startPlacing(id) {
  closeSheet();
  stopRoadPick();
  ui.placing = id;
  $("#placeText").textContent = "Tap where your " + SPECIALS[id].icon + " " + SPECIALS[id].name + " goes";
  $("#placeBanner").hidden = false;
}
function stopPlacing() {
  ui.placing = null;
  ui.placeStation = null;
  $("#placeBanner").hidden = true;
}
$("#placeCancel").addEventListener("click", stopPlacing);

// ---------------------------------------------------------------------------
// Social: share your town as a link, visit other towns
// ---------------------------------------------------------------------------
function shareLink() {
  const base = location.href.split("#")[0];
  return base + "#visit=" + city.toShareCode();
}

$("#socialBtn").addEventListener("click", () => openSocial());

function townStatsCard() {
  const age = Math.max(1, Math.round((Date.now() - city.createdAt) / 86400000));
  return "<div class='card'><h3>" + TIERS[city.tier].icon + " " + esc(city.name) +
    "</h3><div class='stat-grid'>" +
    "<div class='stat'><b>" + fmt(city.pop) + "</b><span>👥 people</span></div>" +
    "<div class='stat'><b>" + city.stats.scans + "</b><span>📷 codes scanned</span></div>" +
    "<div class='stat'><b>" + city.roadCount + "</b><span>🛣️ roads</span></div>" +
    "<div class='stat'><b>" + age + "</b><span>📅 days old</span></div></div>" +
    "<p class='muted' id='rankLine'>Seed #" + city.seed + " – no other town in the world has these roads.</p></div>";
}

function townRows(towns, { rankFrom = 1, removable = false } = {}) {
  if (!towns.length) return "<p class='muted' style='text-align:center'>Nobody here yet.</p>";
  return "<div class='list'>" + towns.map((t, i) => {
    const me = online.user && t.id === online.user.id;
    return "<div class='item-row town-row" + (me ? " me" : "") + "'>" +
      "<div class='rank'>" + (rankFrom ? "#" + (rankFrom + i) : TIERS[t.tier] ? TIERS[t.tier].icon : "🏘️") + "</div>" +
      "<div class='grow'><b>" + esc(t.city_name || "Unnamed") + "</b><small>" + fmt(t.pop) + " 👥 · " + t.roads + " 🛣️</small></div>" +
      (me ? "<span class='muted'>you</span>" : "<button class='small' data-visit='" + esc(t.handle) + "'>👀</button>") +
      (removable ? "<button class='small ghost' data-unfollow='" + esc(t.id) + "' aria-label='Remove friend'>✕</button>" : "") +
      "</div>";
  }).join("") + "</div>";
}

function openSocial(tab = "top") {
  if (visit) return;
  let html = townStatsCard() + "<div class='btn-col'><button id='shareBtn' class='primary big'>📤 Share my town</button></div>";
  if (!online.enabled) {
    html += visitByLinkCard() + "<p class='muted' style='text-align:center'>🏆 Leaderboards &amp; friends turn on once the game is online.</p>";
  } else if (!online.ready) {
    html += "<p class='muted' style='text-align:center'>📡 Can't reach the server right now – leaderboards will be back when you're online.</p>" + visitByLinkCard();
  } else {
    if (!online.handle) {
      html += city.pop < LEADERBOARD_MIN_POP
        ? "<p class='muted' style='text-align:center'>🏆 Your town joins the leaderboard at " + LEADERBOARD_MIN_POP + " people (Village).</p>"
        : "<p class='muted' style='text-align:center'>🏆 Joining the leaderboard as <b>" + esc(city.name) + "</b>…</p>";
      syncOnline(true);
    }
    html += "<div class='tabs'><button data-tab='top' class='" + (tab === "top" ? "on" : "") + "'>🏆 Top towns</button>" +
      "<button data-tab='friends' class='" + (tab === "friends" ? "on" : "") + "'>👫 Friends</button></div>" +
      "<div id='tabBody'><p class='muted' style='text-align:center'>Loading…</p></div>" + visitByLinkCard();
  }
  if (online.ready) html += accountCard();

  openSheet("🌐 Social", html, (body) => {
    body.querySelector("#shareBtn").addEventListener("click", shareTown);
    const go = body.querySelector("#visitGo");
    if (go) go.addEventListener("click", () => {
      const v = body.querySelector("#visitInput").value.trim();
      if (!v) return;
      if (v.includes("town=")) return visitHandle(v.split("town=")[1]).then((ok) => ok && closeSheet());
      if (v.includes("visit=") || v.length > 40) {
        if (startVisit(v.includes("visit=") ? v.split("visit=")[1] : v)) closeSheet();
        return;
      }
      visitHandle(v).then((ok) => ok && closeSheet());
    });
    body.addEventListener("click", (e) => {
      const b = e.target.closest("[data-visit],[data-unfollow],[data-tab]");
      if (!b) return;
      if (b.dataset.tab) return openSocial(b.dataset.tab);
      if (b.dataset.visit) return visitHandle(b.dataset.visit).then((ok) => ok && closeSheet());
      online.unfollow(b.dataset.unfollow).then(() => openSocial("friends"));
    });
    if (online.ready) fillTab(body, tab);
    mountAccount(body);
  });
}

function visitByLinkCard() {
  return "<div class='card'><h3>👀 Visit a town</h3><p class='muted'>Type a town's name or paste a town link.</p>" +
    "<div class='row'><input type='text' id='visitInput' class='grow' autocapitalize='off' autocomplete='off' spellcheck='false' placeholder='Town name or link' />" +
    "<button id='visitGo'>Go</button></div></div>";
}

async function fillTab(body, tab) {
  const el = body.querySelector("#tabBody");
  try {
    if (tab === "top") {
      const [towns, rank] = await Promise.all([online.leaderboard(), online.myRank(city.pop)]);
      if (rank) body.querySelector("#rankLine").textContent = "🏆 #" + rank + " in the world · seed #" + city.seed;
      el.innerHTML = townRows(towns);
    } else {
      const towns = await online.friends();
      el.innerHTML =
        "<div class='row'><input type='text' id='followInput' class='grow' autocapitalize='off' autocomplete='off' spellcheck='false' placeholder='Add a friend&#39;s town by name' />" +
        "<button id='followGo' class='primary'>Add</button></div>" + townRows(towns, { rankFrom: 0, removable: true });
      el.querySelector("#followGo").addEventListener("click", async () => {
        const err = await online.follow(el.querySelector("#followInput").value);
        if (err) toast(err);
        else {
          toast("👫 Friend added!");
          openSocial("friends");
        }
      });
    }
  } catch (e) {
    console.warn(e);
    el.innerHTML = "<p class='muted' style='text-align:center'>📡 Couldn't load that right now.</p>";
  }
}

function accountCard() {
  if (online.email) {
    return "<div class='card'><h3>☁️ Cloud save on</h3><p class='muted'>Signed in as " + esc(online.email) + ". Your town is backed up and you can open it on any phone.</p>" +
      "<div class='btn-col'><button id='signOutBtn' class='ghost'>Sign out</button></div></div>";
  }
  if (online.pendingEmail) {
    return "<div class='card'><h3>📬 Check your email</h3><p class='muted'>Use the code or link we sent to " + esc(online.pendingEmail) + " to finish protecting your town.</p>" +
      "<div class='btn-col'><button id='linkEmailBtn' class='ghost'>Enter the code / use a different email</button><button id='signInBtn' class='ghost'>I already have a town</button></div></div>";
  }
  return "<div class='card'><h3>☁️ Protect your town</h3><p class='muted'>Add your email so you never lose your town if you lose or change your phone.</p>" +
    "<div class='btn-col'><button id='linkEmailBtn'>✉️ Add my email</button><button id='signInBtn' class='ghost'>I already have a town</button></div></div>";
}

function mountAccount(body) {
  const on = (id, fn) => {
    const b = body.querySelector(id);
    if (b) b.addEventListener("click", fn);
  };
  on("#linkEmailBtn", () => openEmailFlow("link"));
  on("#signInBtn", () => openEmailFlow("signin"));
  on("#signOutBtn", async () => {
    if (!confirm("Sign out? Your town stays on this phone, but it won't back up until you sign in again.")) return;
    await online.signOut();
    closeSheet();
    toast("Signed out");
  });
}

// Email step by step: address → code. "link" protects this town with an email;
// "signin" brings a town from another phone, browser or the Home Screen app.
function openEmailFlow(mode, email = "") {
  if (!online.ready) return toast("📡 You need to be online for this");
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const intro = mode === "link"
    ? "We'll email you a code. Then you can get this town back on any phone, browser or the Home Screen app."
    : "Use the email you added to your town in the other place" + (standalone ? " (for example in Safari)" : "") + ". We'll email you a code.";
  const title = mode === "link" ? "✉️ Protect your town" : "🔑 I already have a town";
  if (!email) {
    openSheet(title,
      "<p>" + intro + "</p><input type='email' id='efEmail' inputmode='email' autocomplete='email' autocapitalize='off' spellcheck='false' placeholder='you@example.com' />" +
      "<div class='btn-col'><button id='efSend' class='primary big'>Send code</button></div>" +
      (mode === "signin" ? "<p class='muted'>Never added an email? In the other place, open ⚙️ Settings → 💾 Back up my town, then here use ⚙️ Settings → 📂 Restore from backup.</p>" : ""),
      (body) => {
        const send = body.querySelector("#efSend");
        send.addEventListener("click", async () => {
          const value = body.querySelector("#efEmail").value.trim();
          if (!/^\S+@\S+\.\S+$/.test(value)) return toast("That email doesn't look right");
          send.disabled = true;
          if (mode === "link") syncOnline(true);
          const err = mode === "link" ? await online.linkEmail(value) : await online.sendLoginCode(value);
          send.disabled = false;
          if (err) return toast("⚠️ " + (/signups not allowed|not found/i.test(err) ? "No town uses that email yet" : err));
          openEmailFlow(mode, value);
        });
      });
    return;
  }
  openSheet(title,
    "<p>We sent a code to <b>" + esc(email) + "</b>. Type it here:</p>" +
    "<input type='text' id='efCode' inputmode='numeric' autocomplete='one-time-code' maxlength='10' placeholder='123456' />" +
    "<div class='btn-col'><button id='efVerify' class='primary big'>" + (mode === "link" ? "Protect my town" : "Sign in") + "</button>" +
    "<button id='efBack' class='ghost'>Use a different email</button></div>" +
    "<p class='muted'>No code in the email? Tap its link instead – on this same device and browser.</p>",
    (body) => {
      body.querySelector("#efBack").addEventListener("click", () => openEmailFlow(mode));
      const verify = body.querySelector("#efVerify");
      verify.addEventListener("click", async () => {
        const code = body.querySelector("#efCode").value.replace(/\s/g, "");
        if (!code) return;
        verify.disabled = true;
        const err = mode === "link" ? await online.verifyLinkCode(email, code) : await online.verifyLoginCode(email, code);
        verify.disabled = false;
        if (err) return toast("⚠️ " + err);
        closeSheet();
        if (mode === "link") toast("☁️ Your town is protected");
        else await offerCloudTown(true);
      });
    });
}

async function shareTown() {
  const url = online.handle ? location.href.split("#")[0] + "#town=" + online.handle : shareLink();
  const text = "Come visit my town " + city.name + " – population " + Math.floor(city.pop) + "! 🏙️";
  syncOnline(true);
  try {
    if (navigator.share) await navigator.share({ title: city.name, text, url });
    else {
      await navigator.clipboard.writeText(url);
      toast("🔗 Link copied!");
    }
  } catch (e) {
    if (e.name !== "AbortError") prompt("Copy your town link:", url);
  }
}

async function visitHandle(handle) {
  if (!online.ready) {
    toast("📡 You need to be online to visit a town by name");
    return false;
  }
  const town = await online.townByHandle(decodeURIComponent(handle));
  if (!town) {
    toast("🤷 Couldn't find a town called " + decodeURIComponent(handle));
    return false;
  }
  return startVisit(town.share_code);
}

// After signing in, load the account's cloud town if it differs from this phone's.
async function offerCloudTown(ask) {
  const remote = await online.cloudSave().catch(() => null);
  if (!remote || !remote.data) {
    syncOnline(true);
    return;
  }
  const r = remote.data;
  const sameTown = r.createdAt === city.createdAt && r.seed === city.seed;
  if (sameTown && (r.lastSeen || 0) <= (city.lastSeen || 0)) return;
  if (!sameTown && ask && !confirm("Load " + (r.name || "your town") + " (" + remote.pop + " people) from the cloud? The town on this phone (" + city.name + ") will be replaced.")) {
    syncOnline(true);
    return;
  }
  if (!sameTown && !ask) {
    // A different town arrived without the player asking (e.g. a magic link): keep both safe and ask.
    if (!confirm("Your account has the town " + (r.name || "") + " (" + remote.pop + " people). Load it instead of " + city.name + "?")) return;
  }
  try {
    city = City.fromSave(r);
    renderer = new CityRenderer(city);
    ui.cars = [];
    saveGame();
    catchUp();
    viewport.lookAt(city.center());
    toast("☁️ Loaded " + city.name);
  } catch (e) {
    console.warn(e);
    toast("⚠️ Couldn't load the cloud town");
  }
}

function startVisit(code) {
  try {
    const other = City.fromShareCode(decodeURIComponent(code));
    visit = { city: other, renderer: new CityRenderer(other) };
    ui.cars = [];
    closeSheet();
    stopPlacing();
    $("#visitName").textContent = other.name;
    $("#visitBanner").hidden = false;
    lastShown = {};
    viewport.fitBounds(other.layout.bounds(), 1.1);
    toast("Welcome to " + other.name + "! 👋");
    return true;
  } catch (e) {
    console.warn(e);
    toast("⚠️ That town link doesn't look right");
    return false;
  }
}

function endVisit() {
  visit = null;
  ui.cars = [];
  $("#visitBanner").hidden = true;
  lastShown = {};
  if (/^#(visit|town)=/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search);
  viewport.lookAt(city.center());
}
$("#visitBack").addEventListener("click", endVisit);

// ---------------------------------------------------------------------------
// Settings + hidden extras (tap the version number 5 times)
// ---------------------------------------------------------------------------
$("#cityName").addEventListener("click", () => {
  if (visit) return;
  const name = prompt("Rename your town:", city.name);
  if (name && name.trim()) {
    city.name = name.trim().slice(0, 24);
    saveGame();
    syncOnline(true); // the username follows the town name
  }
});

let versionTaps = 0;
$("#settingsBtn").addEventListener("click", openSettings);
function openSettings() {
  const extras = prefs.extras
    ? "<div class='card extras'><h3>🧪 Extras</h3><div class='btn-col'>" +
      "<button id='xDrive'>🚗 Drive around your town</button>" +
      "<button id='xScan'>⌨️ Type a code (simulate a scan)</button>" +
      "<button id='xFast'>⏩ Fast-forward 10 minutes</button>" +
      "<button id='xSandbox'>🔧 Open the sandbox editor</button>" +
      "<button id='xTrain'>🧠 Train self-driving cars</button>" +
      "</div></div>"
    : "";
  const html =
    "<div class='btn-col'>" +
    "<button id='sRename'>✏️ Rename town</button>" +
    "<button id='sExport'>💾 Back up my town</button>" +
    "<button id='sImport'>📂 Restore from backup</button>" +
    "<button id='sHelp'>❔ How to play</button>" +
    "<button id='sNews'>📰 What's new</button>" +
    "<button id='sReset' style='color:#fca5a5'>🗑️ Start a brand new town</button>" +
    "</div>" + extras +
    "<div class='version' id='versionLabel'>Virtual World v" + VERSION + "</div>";
  openSheet("⚙️ Settings", html, (body) => {
    body.querySelector("#sRename").addEventListener("click", () => $("#cityName").click());
    body.querySelector("#sHelp").addEventListener("click", () => {
      closeSheet();
      showWelcome(false);
    });
    body.querySelector("#sNews").addEventListener("click", () => {
      closeSheet();
      showWhatsNew(null, true);
    });
    body.querySelector("#sExport").addEventListener("click", async () => {
      const data = JSON.stringify(city.toSave());
      try {
        await navigator.clipboard.writeText(data);
        toast("📋 Backup copied – paste it somewhere safe");
      } catch {
        prompt("Copy this backup:", data);
      }
    });
    body.querySelector("#sImport").addEventListener("click", () => {
      const data = prompt("Paste your backup:");
      if (!data) return;
      try {
        city = City.fromSave(JSON.parse(data));
        renderer = new CityRenderer(city);
        ui.cars = [];
        saveGame();
        syncOnline(true);
        closeSheet();
        viewport.lookAt(city.center());
        toast("✅ Town restored");
      } catch {
        toast("⚠️ That backup didn't work");
      }
    });
    body.querySelector("#sReset").addEventListener("click", () => {
      if (!confirm("Start over with a brand new town? Your current town will be gone forever.")) return;
      if (!confirm("Really? This can't be undone.")) return;
      city = City.create();
      renderer = new CityRenderer(city);
      ui.cars = [];
      saveGame();
      syncOnline(true);
      closeSheet();
      viewport.zoom = 1.3;
      viewport.lookAt(city.center());
      showWelcome(true);
    });
    body.querySelector("#versionLabel").addEventListener("click", () => {
      if (prefs.extras) return;
      versionTaps++;
      if (versionTaps >= 5) {
        prefs.extras = true;
        savePrefs();
        toast("🧪 Extras unlocked!");
        openSettings();
      } else if (versionTaps >= 2) {
        toast(5 - versionTaps + " more…", 700);
      }
    });
    if (prefs.extras) {
      body.querySelector("#xDrive").addEventListener("click", () => {
        closeSheet();
        startDriving();
      });
      body.querySelector("#xScan").addEventListener("click", () => {
        const t = prompt("Type or paste any code text (a URL, WIFI:…, a barcode number…):");
        if (t) {
          closeSheet();
          handleScan(t, /^\d{8,13}$/.test(t.trim()) ? "ean_13" : "qr_code");
        }
      });
      body.querySelector("#xFast").addEventListener("click", () => {
        const s = city.simulate(600);
        saveGame();
        toast("⏩ +" + s.pop + " 👥, +" + s.coins + " 💰, +" + s.roads + " 🛣️");
      });
      body.querySelector("#xSandbox").addEventListener("click", () => (location.href = "sandbox.html"));
      body.querySelector("#xTrain").addEventListener("click", () => (location.href = "sandbox.html#train"));
    }
  });
}

function showWelcome(fresh) {
  showModal({
    icon: "🏕️",
    title: fresh ? "Welcome to " + city.name + "!" : "How to play",
    body:
      "<p>Your town is tiny: one road in the middle of nowhere. Help it grow!</p>" +
      "<p style='text-align:left'>📷 <b>Scan QR codes</b> anywhere you see them – menus, posters, parking meters, packaging. Every new code feeds your town.<br>" +
      "🛣️ <b>Materials build roads</b> – you pick where each one goes.<br>" +
      "🏠 <b>New roads bring homes and shops</b>, which bring people.<br>" +
      "💰 <b>Tap coin bubbles</b> on shops to collect.<br>" +
      "🎁 Claim your <b>daily gift</b> to keep a streak.</p>" +
      "<p class='muted'>No two towns are alike – yours was grown from seed #" + city.seed + ".</p>",
    button: fresh ? "Let's grow!" : "Got it",
    extra: fresh && online.enabled ? { label: "I already have a town", onClick: () => openEmailFlow("signin") } : null,
  });
}

// Releases newer than `since` (just the latest for players from before this
// existed), at most three. With `all`, the whole list for ⚙️ Settings.
function showWhatsNew(since, all = false) {
  let entries = all ? CHANGELOG : CHANGELOG.filter((e) => compareVersions(e.version, VERSION) <= 0);
  if (!all) entries = since ? entries.filter((e) => compareVersions(e.version, since) > 0).slice(0, 3) : entries.slice(0, 1);
  if (!entries.length) return;
  showModal({
    icon: "📰",
    title: "What's new",
    body: entries.map((e) =>
      "<p class='muted' style='margin-bottom:4px'>v" + esc(e.version) + "</p>" +
      "<ul class='notes'>" + e.notes.map((n) => "<li>" + esc(n) + "</li>").join("") + "</ul>").join(""),
    button: all ? "Close" : "Cool!",
  });
}

// ---------------------------------------------------------------------------
// Hidden extra: drive around your own town
// ---------------------------------------------------------------------------
function startDriving() {
  const seg = city.layout.graph.segments[0];
  const dir = seg.directionVector();
  const p = add(average(seg.p1, seg.p2), scale(perpendicular(dir), ROAD_W / 4));
  const car = new Car(p.x, p.y, 30, 50, "KEYS", headingFromDir(dir), 4, "#2563eb");
  ui.drive = car;
  viewport.zoom = 1.1;
  $("#dpad").hidden = false;
  document.body.classList.add("driving");
  toast("🚗 Drive with the arrows (or WASD)");
}

function stopDriving() {
  if (!ui.drive) return;
  ui.drive.dispose();
  ui.drive = null;
  $("#dpad").hidden = true;
  document.body.classList.remove("driving");
}
$("#driveExit").addEventListener("click", stopDriving);
document.querySelectorAll("#dpad [data-ctl]").forEach((b) => {
  const set = (v) => (e) => {
    e.preventDefault();
    if (ui.drive) ui.drive.controls[b.dataset.ctl] = v;
  };
  b.addEventListener("pointerdown", set(true));
  b.addEventListener("pointerup", set(false));
  b.addEventListener("pointerleave", set(false));
  b.addEventListener("pointercancel", set(false));
});

// ---------------------------------------------------------------------------
// Ambient traffic: more people, more cars
// ---------------------------------------------------------------------------
// The collector: drives past every shop and factory once while the app is open
// and collects their 💰 and 🧱 for you, keeping a 15% cut. Unlocks at Town; at Megalopolis
// two trucks go out, starting on opposite sides of town.
const COLLECTOR_TIER = 2;
const TWO_TRUCK_TIER = 5;
function collectorCard() {
  const c = ui.collector;
  const two = city.tier >= TWO_TRUCK_TIER;
  let body;
  if (city.tier < COLLECTOR_TIER) {
    body = "<p class='muted'>Unlocks when your town reaches " + TIERS[COLLECTOR_TIER].icon + " " + TIERS[COLLECTOR_TIER].name + " (" + TIERS[COLLECTOR_TIER].pop + " people).</p>";
  } else if (c) {
    body = "<p>On the road: " + (c.total - c.pool.size) + " of " + c.total + " stops visited, +" + c.kept + " 💰" + (c.keptGoods ? " +" + c.keptGoods + " 🧱" : "") + " so far.</p>";
  } else {
    body = "<p class='muted'>" + (two ? "Two trucks start on opposite sides of town and drive" : "Drives") +
      " past every shop and factory once, collecting their 💰 and 🧱 for you and keeping " + Math.round(COLLECTOR_CUT * 100) + "% as a fee. Works while the app is open.</p>" +
      (two ? "" : "<p class='muted'>" + TIERS[TWO_TRUCK_TIER].icon + " At " + TIERS[TWO_TRUCK_TIER].name + ", two trucks go out at once.</p>") +
      "<button id='hireBtn' class='gold'>" + (two ? "Hire 2 collectors" : "Hire the collector") + "</button>";
  }
  return "<div class='card'><h3>🚚 Collector</h3>" + body + "</div>";
}

// The two ends of town along its longer side.
function townEnds() {
  const b = city.layout.bounds();
  const mid = new Point((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
  return b.maxX - b.minX >= b.maxY - b.minY
    ? [new Point(b.minX, mid.y), new Point(b.maxX, mid.y)]
    : [new Point(mid.x, b.minY), new Point(mid.x, b.maxY)];
}

function hireCollector() {
  const shops = city.lots.filter((l) => l.kind === "com" || l.kind === "ind");
  if (ui.collector || !shops.length || city.tier < COLLECTOR_TIER) return;
  const c = { city, kept: 0, fee: 0, keptGoods: 0, feeGoods: 0, lastStop: performance.now(), pool: new Set(shops), total: shops.length };
  const onCollect = (lot) => {
    c.lastStop = performance.now();
    if (!city.bagReady(lot)) return;
    const goods = lot.kind === "ind";
    const amount = Math.floor(lot.coins);
    const keep = city.collect(lot, COLLECTOR_CUT);
    if (goods) {
      c.keptGoods += keep;
      c.feeGoods += amount - keep;
    } else {
      c.kept += keep;
      c.fee += amount - keep;
    }
    floater(renderer.bubbleAnchor(lot, viewport.getViewPoint()), "+" + keep + (goods ? " 🧱" : " 💰"));
  };
  const starts = city.tier >= TWO_TRUCK_TIER ? townEnds() : [null];
  c.trucks = starts.map((start) => new CollectorTruck(city.layout.graph, c.pool, onCollect, start));
  ui.collector = c;
  toast(c.trucks.length > 1 ? "🚚🚚 Two collectors are on the way" : "🚚 The collector is on the way");
}

function updateCollector() {
  const c = ui.collector;
  if (!c) return;
  if (c.city !== city) return (ui.collector = null); // a different town was loaded
  if (visit) return; // parked while you're away visiting
  const everyone = [...ui.cars, ...c.trucks];
  for (const t of c.trucks) t.update(everyone);
  // Done, or stuck for 90 s without reaching a shop: send the bill.
  if (!c.pool.size || performance.now() - c.lastStop > 90000) {
    ui.collector = null;
    saveGame();
    showModal({
      icon: "🚚",
      title: "Collection done",
      body: "<div class='gains'><span class='gain'>+" + c.kept + " 💰</span>" + (c.keptGoods ? "<span class='gain'>+" + c.keptGoods + " 🧱</span>" : "") + "</div><p class='muted'>" +
        (c.trucks.length > 1 ? "The collectors kept " : "The collector kept ") + c.fee + " 💰" + (c.feeGoods ? " and " + c.feeGoods + " 🧱" : "") + " as their fee.</p>",
      button: "Thanks!",
    });
  }
}

// ---------------------------------------------------------------------------
// Fire & police
// ---------------------------------------------------------------------------
const perHour = (rate) => fmt(Math.round(rate * 3600));
const mmss = (sec) => Math.floor(sec / 60) + ":" + String(Math.floor(sec % 60)).padStart(2, "0");

function showSafetyIntro() {
  if (prefs.safetyIntro) return;
  prefs.safetyIntro = true;
  savePrefs();
  showModal({
    icon: "🚒",
    title: "Fire & police unlocked!",
    body: "<p>Your town is big enough for emergencies: 🔥 fires and 🦹 robberies, only while you're playing.</p>" +
      "<p style='text-align:left'>🚒 <b>Fire stations</b> stop buildings burning down.<br>🚓 <b>Police stations</b> stop robbers taking a shop's 💰.<br>" +
      "🛡️ Good coverage raises ✨ appeal. Stations cost upkeep while they run.</p>" +
      "<p class='muted'>Tap 🛡️ at the top to build your first station.</p>",
    button: "Let's build one",
    onClose: openSafety,
  });
}

function incidentCard(inc) {
  const svc = SERVICES[inc.type];
  const fire = inc.type === "fire";
  const status = inc.working > 0
    ? svc.icon + " The " + svc.vehicle + " is on scene – almost done."
    : inc.responder
      ? svc.icon + " A " + svc.vehicle + " is on the way."
      : city.stationFor(inc.lot, inc.type)
        ? svc.icon + " Dispatching a " + svc.vehicle + "…"
        : "No " + svc.name.toLowerCase() + " covers this building" + (city.unpaid ? " that can respond (upkeep unpaid)" : "") + ".";
  return "<div class='card incident'><h3>" + (fire ? "🔥 On fire!" : "🦹 Being robbed!") + "</h3>" +
    "<p>" + (fire ? (inc.lot.level <= 1 ? "It burns down" : "It loses a level") : "The robbers get away with its 💰") + " in <b>" + mmss(Math.max(0, inc.limit - inc.t)) + "</b>.</p>" +
    "<p class='muted'>" + status + "</p>" +
    (inc.working > 0 ? "" : "<button id='crewBtn' class='gold big'>" + (fire ? "🧯 Call a private fire crew" : "🕵️ Hire private security") + " · " + fmt(city.crewCost()) + " 💰</button>") +
    "</div>";
}

function openSafety() {
  if (city.tierReached < SAFETY_TIER) {
    return openSheet("🛡️ Safety", "<p>Fire &amp; police unlock at " + TIERS[SAFETY_TIER].icon + " " + TIERS[SAFETY_TIER].name + " (" + TIERS[SAFETY_TIER].pop + " people).</p>");
  }
  const sf = city.safety(), need = city.stationsNeeded();
  const income = city.incomeRate(), upkeep = city.upkeepRate();
  const pct = (v) => Math.round(v * 100) + "%";
  const kinds = SERVICE_IDS.map((k) => {
    const svc = SERVICES[k], n = city.stations(k).length;
    return "<div class='item-row'><span class='emoji'>" + svc.icon + "</span><div class='grow'><b>" + svc.name + "s · " + n + "</b>" +
      "<small>Covers " + pct(sf[k]) + " of buildings · about " + need + " cover the whole town</small></div>" +
      "<button data-build='" + k + "' class='gold'" + (city.coins < city.stationCost(k) ? " disabled" : "") + ">Build · " + fmt(city.stationCost(k)) + " 💰</button></div>";
  }).join("");
  const live = city.incidents.map((inc) =>
    "<div class='item-row'><span class='emoji'>" + SERVICES[inc.type].incident + "</span><div class='grow'><b>" + buildingName(inc.lot) + "</b>" +
    "<small>" + (inc.working > 0 || inc.responder ? SERVICES[inc.type].icon + " help is on the way" : mmss(Math.max(0, inc.limit - inc.t)) + " left · not covered") + "</small></div>" +
    "<button class='small' data-goto='" + inc.lot.id + "'>👀</button></div>").join("");
  const html =
    "<div class='stat-grid'><div class='stat'><b>🛡️ " + pct(sf.score) + "</b><span>Safety</span></div>" +
    "<div class='stat'><b>" + (city.safetyAppeal() >= 0 ? "+" : "") + pct(city.safetyAppeal()) + " ✨</b><span>Appeal from safety</span></div></div>" +
    (city.unpaid ? "<div class='card incident'><h3>⚠️ Upkeep unpaid</h3><p>Your stations stopped responding. They're back once you have " + fmt(upkeep * 60) + " 💰.</p></div>" : "") +
    (live ? "<div class='card'><h3>🚨 Happening now</h3><div class='list'>" + live + "</div></div>" : "") +
    "<div class='list'>" + kinds + "</div>" +
    "<div class='card'><h3>💸 Upkeep</h3><div class='row'><span class='grow'>All stations</span><b>" + perHour(upkeep) + " 💰/hour</b></div>" +
    "<div class='row'><span class='grow'>Your income</span><b>" + perHour(income) + " 💰/hour</b></div>" +
    "<p class='muted'>Covering the whole town with both kinds costs about " + Math.round(UPKEEP_SHARE * 100) + "% of your income (" + perHour(city.stationUpkeep()) + " 💰/hour per station). Upgrades add vehicles and speed, not range.</p></div>" +
    "<p class='muted'>Emergencies only happen while you're playing.</p>";
  ui.showCoverage = "fire";
  openSheet("🛡️ Fire & police", html, (body) => {
    body.querySelectorAll("[data-build]").forEach((b) => b.addEventListener("click", () => startStationPlacing(b.dataset.build)));
    body.querySelectorAll("[data-goto]").forEach((b) => b.addEventListener("click", () => {
      const lot = city.lots.find((l) => l.id === +b.dataset.goto);
      closeSheet();
      if (lot) ui.focus = { at: scale(lot.center, -1), zoom: Math.min(viewport.zoom, 1.4) };
    }));
  }, () => (ui.showCoverage = null));
}

function startStationPlacing(kind) {
  closeSheet();
  stopRoadPick();
  ui.placing = null;
  ui.placeStation = kind;
  $("#placeText").textContent = "Tap a lot for your " + SERVICES[kind].icon + " station";
  $("#placeBanner").hidden = false;
  // Show the whole town, with red where nothing covers it yet.
  const b = city.layout.bounds();
  const zoom = clamp(Math.max((b.maxX - b.minX) / viewport.width, (b.maxY - b.minY) / viewport.height) * 1.2, viewport.minZoom, viewport.maxZoom);
  ui.focus = { at: scale(city.center(), -1), zoom };
}

function confirmStation(lot) {
  const kind = ui.placeStation, svc = SERVICES[kind], cost = city.stationCost(kind);
  const reach = city.lots.filter((l) => (l.kind === "res" || l.kind === "com" || l.kind === "ind") && l !== lot && City.covers(lot, l));
  const fresh = reach.filter((l) => !city.stations(kind).some((st) => City.covers(st, l))).length;
  ui.selected = lot;
  const html =
    (lot.kind ? "<p>This tears down the <b>" + buildingName(lot) + "</b> (level " + Math.max(1, lot.effectiveLevel) + ") here." + (lot.level > 1 ? " Its upgrades aren't refunded." : "") + "</p>" : "") +
    "<div class='stat-grid'><div class='stat'><b>" + reach.length + "</b><span>Buildings in reach</span></div>" +
    "<div class='stat'><b>" + fresh + "</b><span>Not covered yet</span></div></div>" +
    "<p class='muted'>Upkeep: about " + perHour(city.stationUpkeep()) + " 💰/hour.</p>" +
    "<button id='stationBtn' class='gold big'" + (city.coins < cost ? " disabled" : "") + ">Build " + svc.icon + " " + svc.name + " · " + fmt(cost) + " 💰</button>" +
    (city.coins < cost ? "<p class='muted' style='text-align:center'>Not enough coins</p>" : "") +
    "<button id='stationNo' class='big' style='margin-top:8px'>Pick another spot</button>";
  // Closing this sheet keeps placing mode on, so another lot can be tried.
  openSheet(svc.icon + " Build here?", html, (body) => {
    body.querySelector("#stationBtn").addEventListener("click", () => {
      if (!city.buildStation(lot, kind)) return toast("Not enough coins");
      floater(lot.center, svc.icon + " Station coming!", "#fde68a");
      buzz(40);
      stopPlacing();
      saveGame();
      closeSheet();
    });
    body.querySelector("#stationNo").addEventListener("click", closeSheet);
  });
}

function openStationSheet(lot, readOnly) {
  const c = readOnly ? visit.city : city;
  const svc = SERVICES[lot.special], lvl = Math.max(1, lot.effectiveLevel), r = City.response(lvl);
  const reach = c.lots.filter((l) => (l.kind === "res" || l.kind === "com" || l.kind === "ind") && City.covers(lot, l)).length;
  let html = "<p>" + svc.about + "</p>" +
    "<div class='stat-grid'><div class='stat'><b>" + reach + "</b><span>Buildings covered</span></div>" +
    "<div class='stat'><b>" + r.vehicles + "</b><span>" + svc.vehicle + (r.vehicles > 1 ? "s" : "") + "</span></div>" +
    "<div class='stat'><b>" + r.dispatch + "s</b><span>To roll out</span></div>" +
    "<div class='stat'><b>" + (readOnly ? "–" : perHour(city.stationUpkeep())) + "</b><span>💰/hour upkeep</span></div></div>";
  if (!readOnly) {
    if (lot.building > 0) html += "<p class='muted'>🏗️ Opening in " + Math.ceil(lot.building) + " seconds.</p>";
    if (city.unpaid) html += "<p class='muted'>⚠️ Upkeep unpaid – not responding.</p>";
    const up = city.stationUpgradeInfo(lot);
    if (up) {
      const next = City.response(lot.level + 1);
      html += "<button id='upgradeBtn' class='gold big'" + (up.ok ? "" : " disabled") + ">⬆️ Level " + (lot.level + 1) + ": " + next.vehicles + " " + svc.vehicle + "s, faster · " + fmt(up.cost) + " 💰</button>" +
        (city.coins < up.cost ? "<p class='muted' style='text-align:center'>Not enough coins</p>" : "");
    } else html += "<p class='muted'>Fully upgraded! 🌟</p>";
    html += "<button id='closeStation' class='ghost big' style='margin-top:8px;color:#fca5a5'>Close this station</button>";
  }
  openSheet(svc.icon + " " + svc.name + " · level " + lvl, html, (body) => {
    const up = body.querySelector("#upgradeBtn");
    if (up) up.addEventListener("click", () => {
      if (!city.upgradeStation(lot)) return;
      floater(lot.center, "⬆️ Upgrading!", "#fde68a");
      buzz(40);
      saveGame();
      closeSheet();
    });
    const shut = body.querySelector("#closeStation");
    if (shut) shut.addEventListener("click", () => {
      if (!confirm("Close this " + svc.name.toLowerCase() + "? You won't get your coins back.")) return;
      city.closeStation(lot);
      saveGame();
      closeSheet();
    });
  });
}

// Sends vehicles from covering stations to emergencies, and drives them back.
function updateResponders(dt) {
  if (ui.responders.length && ui.responders[0].city !== city) ui.responders = [];
  for (const inc of city.incidents) {
    if (inc.responder || inc.working > 0) continue;
    const station = city.stationFor(inc.lot, inc.type);
    if (!station) {
      inc.wait = 0;
      continue;
    }
    const r = City.response(station.level);
    if (ui.responders.filter((v) => v.station === station).length >= r.vehicles) continue;
    if ((inc.wait = (inc.wait || 0) + dt) < r.dispatch) continue;
    const v = new Responder(city.layout.graph, inc.type, station, inc, r.speed);
    v.city = city;
    inc.responder = v;
    ui.responders.push(v);
  }
  const everyone = [...ui.cars, ...ui.responders, ...(ui.collector ? ui.collector.trucks : [])];
  for (const v of ui.responders) {
    if (v.station.kind !== "svc") v.state = "done"; // its station closed
    else if ((v.state === "out" || v.state === "working") && v.inc.lot.incident !== v.inc) v.state = "back"; // over without us
    if (v.state === "arrived") {
      v.state = "working";
      v.inc.working = City.response(v.station.level).work;
    }
    v.update(everyone);
  }
  ui.responders = ui.responders.filter((v) => v.state !== "done");
}

// One car per 6 people, but no more than the roads can comfortably hold
// (one per 250 units of road), and at most 60 so phones stay smooth.
function roadLength(c) {
  const segs = c.layout.graph.segments;
  if (c._roadLen && c._roadLen.n === segs.length) return c._roadLen.len;
  const len = segs.reduce((sum, s) => sum + s.length(), 0);
  c._roadLen = { n: segs.length, len };
  return len;
}
function updateTraffic(active) {
  const c = active.city;
  const want = Math.min(60, Math.floor(c.pop / 6), Math.floor(roadLength(c) / 250));
  while (ui.cars.length > want) ui.cars.pop();
  if (ui.cars.length < want) {
    // Add one car per frame, and only where it won't land on top of another.
    const car = new TownCar(active.city.layout.graph);
    for (let i = 0; i < 5 && ui.cars.some((o) => distance(o, car) < 80); i++) car.spawn();
    if (!ui.cars.some((o) => distance(o, car) < 80)) ui.cars.push(car);
  }
  const everyone = [...ui.cars];
  if (ui.drive) everyone.push(ui.drive);
  if (ui.collector && !visit) everyone.push(...ui.collector.trucks);
  if (!visit) everyone.push(...ui.responders);
  for (const car of ui.cars) car.update(everyone);
  updateCollector();
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const touch = new TouchCamera(viewport, { onTap, onPan: () => (ui.unrotate = ui.follow = ui.focus = null) });
// iOS Home Screen apps can lay the page out shorter than the screen (by the
// status bar's height), leaving a strip at the bottom that nothing can draw
// into. Measure it so the CSS can paint it to match the bottom bar. Safari tabs
// and Android are left alone.
function fitHomeScreenApp() {
  if (navigator.standalone !== true) return;
  const portrait = innerHeight >= innerWidth;
  const full = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
  const gap = clamp(full - innerHeight, 0, 80);
  document.documentElement.style.setProperty("--gap", gap + "px");
  document.documentElement.classList.toggle("ios-gap", gap > 0);
}
fitHomeScreenApp();
window.addEventListener("resize", () => {
  fitHomeScreenApp();
  viewport.resize();
});

let last = performance.now();
let saveTimer = 0;
let barTimer = 0;
function loop(now) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  viewport.fit();
  if (ui.follow) {
    if (!ui.collector || !ui.collector.trucks.includes(ui.follow) || visit) ui.follow = null;
    else {
      viewport.offset = lerp2D(viewport.offset, scale(ui.follow, -1), 0.1);
      viewport.zoom += (Math.min(viewport.zoom, 1.6) - viewport.zoom) * 0.08;
    }
  }
  if (ui.focus) {
    viewport.offset = lerp2D(viewport.offset, ui.focus.at, 0.12);
    viewport.zoom += (ui.focus.zoom - viewport.zoom) * 0.12;
    if (distance(viewport.offset, ui.focus.at) < 2 && Math.abs(viewport.zoom - ui.focus.zoom) < 0.01) ui.focus = null;
  }
  if (ui.unrotate) {
    viewport.angle *= 0.8;
    if (Math.abs(viewport.angle) < 0.005) [viewport.angle, ui.unrotate] = [0, false];
  }

  // The town runs while you're here and for an hour after your last tap.
  if (Date.now() - city.lastActive < ACTIVE_GRACE) {
    handleEvents(city.tick(dt));
    if (!visit) {
      handleEvents(city.tickSafety(dt));
      updateResponders(dt);
    }
  } else if (!ui.resting) {
    ui.resting = true;
    saveGame();
  }
  const active = visit || { city, renderer };
  updateTraffic(active);

  if (ui.drive) {
    ui.drive.update(renderer.borders, ui.cars);
    if (ui.drive.damaged) {
      ui.drive.crashTime = (ui.drive.crashTime || 0) + dt;
      if (ui.drive.crashTime > 1.5) {
        stopDriving();
        startDriving();
      }
    }
    viewport.offset = lerp2D(viewport.offset, scale(ui.drive, -1), 0.12);
  }

  for (const f of ui.floaters) f.age += dt;
  ui.floaters = ui.floaters.filter((f) => f.age < f.life);

  viewport.reset("#3f8f3a");
  active.renderer.draw(ctx, viewport, {
    placing: !!(ui.placing || ui.placeStation),
    roadPick: ui.roadPick ?? -1,
    selected: ui.selected,
    cars: visit ? ui.cars : [...ui.cars, ...ui.responders, ...(ui.collector ? ui.collector.trucks : [])],
    coverage: visit ? null : ui.placeStation || (ui.selected && ui.selected.kind === "svc" ? ui.selected.special : null) || ui.showCoverage,
    player: ui.drive,
    floaters: ui.floaters,
    now,
  });

  if ((barTimer += dt) > 0.2) {
    barTimer = 0;
    updateTopbar();
  }
  if ((saveTimer += dt) > 10) {
    saveTimer = 0;
    saveGame();
    if (now - lastSync > 120000) syncOnline();
  }
  requestAnimationFrame(loop);
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    saveGame();
    syncOnline();
  } else catchUp();
});
window.addEventListener("pagehide", saveGame);

// Any touch or key counts as being here. After an hour without one the town
// rests, even with the app left open.
function markActive() {
  if (!city) return;
  if (ui.resting) {
    ui.resting = false;
    toast("💤 Your town rested while you were away – it's busy again!");
  }
  city.lastActive = Date.now();
}
for (const ev of ["pointerdown", "keydown", "wheel"]) addEventListener(ev, markActive, { capture: true, passive: true });

// Progress made while the app was closed: only up to an hour after your last tap.
function catchUp() {
  const now = Date.now();
  const away = (now - city.lastSeen) / 1000;
  const worked = Math.max(0, (Math.min(now, city.lastActive + ACTIVE_GRACE) - city.lastSeen) / 1000);
  city.lastActive = now;
  ui.resting = false;
  if (away < 60) return;
  const s = city.simulate(worked);
  city.lastSeen = now;
  saveGame();
  const waiting = city.roadChoice ? "<p class='muted'>🛣️ A new road is ready – choose where it goes!</p>" : "";
  if (s.pop > 0 || s.roads > 0 || s.built > 0 || waiting) {
    const hours = away / 3600;
    showModal({
      icon: "🌙",
      title: "While you were away…",
      body: "It's been " + (hours >= 1 ? Math.floor(hours) + "h " : "") + Math.floor((away % 3600) / 60) + "m." +
        (worked < away - 60 ? "<p class='muted'>Your town kept working for " + duration(worked * 1000) + " after your last tap, then rested.</p>" : "") +
        "<div class='gains'>" + (s.pop ? "<span class='gain'>+" + s.pop + " 👥</span>" : "") +
        (s.built ? "<span class='gain'>+" + s.built + " 🏠</span>" : "") +
        (s.roads ? "<span class='gain'>+" + s.roads + " 🛣️</span>" : "") +
        (s.coins ? "<span class='gain'>+" + fmt(s.coins) + " 💰</span>" : "") + "</div>" +
        (s.upkeep ? "<p class='muted'>Station upkeep: " + fmt(s.upkeep) + " 💰 (included)</p>" : "") + waiting,
      button: "Welcome back!",
    });
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(function boot() {
  const saved = readJSON(SAVE_KEY, null);
  if (saved) {
    try {
      city = City.fromSave(saved);
    } catch (e) {
      console.error("Save unreadable", e);
    }
  }
  const fresh = !city;
  if (fresh) city = City.create();
  renderer = new CityRenderer(city);
  viewport.lookAt(city.center());
  if (fresh) {
    saveGame();
    showWelcome(true);
  } else {
    catchUp();
    if (prefs.seenVersion !== VERSION) showWhatsNew(prefs.seenVersion);
    if (city.tierReached >= SAFETY_TIER) showSafetyIntro();
  }
  prefs.seenVersion = VERSION;
  savePrefs();
  const m = location.hash.match(/^#visit=(.+)$/);
  if (m) startVisit(m[1]);
  updateTopbar();

  online.onChange = (event) => {
    if (event === "SIGNED_IN") offerCloudTown(false);
    if (event === "USER_UPDATED" && online.email) toast("☁️ Your town is protected");
  };
  online.start().then((ok) => {
    if (!ok) return;
    const t = location.hash.match(/^#town=([^&]+)/);
    if (t) visitHandle(t[1]).then((found) => found || history.replaceState(null, "", location.pathname + location.search));
    offerCloudTown(false).then(() => syncOnline(true));
  });
  requestAnimationFrame(loop);

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
