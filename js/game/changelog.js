// ---------------------------------------------------------------------------
// "What's new": player-facing notes, newest first. Bump VERSION in game.js and
// add an entry here for every deploy with changes players would notice.
// ---------------------------------------------------------------------------
"use strict";

const CHANGELOG = [
  {
    version: "0.9.0",
    notes: [
      "🛣️ You choose where roads go! When you have enough 🧱, pick one of 2 ghost roads on the map – each shows how many new lots it opens",
      "🏙️ From City on, you get 3 roads to choose from",
      "⏸️ Road building waits for your pick, even while you're away – your 🧱 keeps piling up meanwhile",
    ],
  },
  {
    version: "0.8.0",
    notes: [
      "🏭 Factories! From Town on, some job buildings become factories that make 🧱 – tap their 📦 crates (the 🚚 collector grabs them too)",
      "🏟️ Special buildings got real 3D models: a spinning Ferris wheel, splashing fountain, Sky Tower with a revolving restaurant, a stadium doing the wave and more",
      "✨ Tap a special building for its new info card",
      "🎒 Place specials on top of homes and shops to replace them, or send a placed special back to your bag",
      "💰 Big numbers now read 1.2M and 3.4B instead of piling up as thousands of K",
      "🌙 Your town keeps growing for 1 hour while you're away (was 3) – check in more often",
      "🏪 Shops earn coins half as fast, so they take about twice as long to fill up",
    ],
  },
  {
    version: "0.7.0",
    notes: [
      "📷 Scans and the 🎁 daily gift now grow with your town – a scan is worth about a third of a road at any size",
      "🌉 Three new tiers past Megalopolis: Metroplex (2,500 people), Capital (5,000) and Global City (10,000), each with a big 🧱 reward",
    ],
  },
  {
    version: "0.6.3",
    notes: [
      "💰 A shop's money bag appears once it's a quarter full, so every tap is worth it",
    ],
  },
  {
    version: "0.6.2",
    notes: [
      "🚚🚚 Megalopolis towns hire two collectors at once – they start on opposite sides of town",
    ],
  },
  {
    version: "0.6.1",
    notes: [
      "🏪 The market now restocks every 6 hours – check in more often for more materials",
      "🚚 The collector is easier to spot: a green armored truck with a gold halo, and a 🚚 button that follows it",
    ],
  },
  {
    version: "0.6.0",
    notes: [
      "🚚 Hire the collector in 🏪 Market: it drives past every shop and collects the 💰 for you (keeps 15%). Unlocks at Town",
      "🔄 Twist with two fingers to rotate the map – tap 🧭 to point north again",
    ],
  },
  {
    version: "0.5.0",
    notes: [
      "⚖️ Steadier growth: people move in more gradually, and each new road costs a bit more than the last",
      "🏪 The market now has a daily stock – one road's worth of materials, restocked every day",
      "⬆️ Upgrades cost more and unlock at Town (40 people) and City (120 people)",
    ],
  },
  {
    version: "0.4.0",
    notes: [
      "🏆 Tap your tier badge (Hamlet, Village, …) to see the next milestone",
      "✨ Tap ✨ to see what appeal does and how to raise it",
      "🚗 Traffic now grows with your roads – big towns get up to 60 cars",
      "📰 This little \"What's new\" note, also in ⚙️ Settings",
    ],
  },
  {
    version: "0.3.3",
    notes: [
      "📱 iPhone Home Screen app: taps land where you tap, and the bottom bar fits the screen",
    ],
  },
  {
    version: "0.3.0",
    notes: [
      "🔑 New phone? Sign in with a 6-digit code from your email",
      "🏆 The leaderboard shows each town once, starting at 10 people",
    ],
  },
];

// -1, 0 or 1, comparing "1.2.3"-style versions.
function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}
