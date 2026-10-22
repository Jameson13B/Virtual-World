// ---------------------------------------------------------------------------
// Turning a scanned code into a reward.
//
// What the code *is for* decides the flavour (a Wi-Fi code powers the city, a
// contact card brings a family, a product barcode brings goods…). The exact
// contents decide the amounts and the rare drops, so the same sticker gives
// the same reward to everyone, and each place only counts once per player.
// ---------------------------------------------------------------------------

const SCAN_KINDS = {
  url: { icon: "🌐", label: "Website code", materials: [20, 35], coins: [5, 15] },
  wifi: { icon: "📶", label: "Wi-Fi code", materials: [10, 20], coins: [20, 40], flavor: "Free power for the grid!" },
  contact: { icon: "👪", label: "Contact card", materials: [10, 20], coins: [10, 20], pop: [3, 8], flavor: "A new family is moving in!" },
  event: { icon: "🎉", label: "Event invite", materials: [15, 25], coins: [25, 45], flavor: "The town throws a festival!" },
  geo: { icon: "🧭", label: "Map location", materials: [35, 55], flavor: "Surveyors found new land." },
  phone: { icon: "📞", label: "Phone / SMS / email", materials: [10, 20], coins: [15, 30], flavor: "Business is calling." },
  payment: { icon: "💳", label: "Payment code", materials: [5, 10], coins: [40, 70], flavor: "Investors noticed your town." },
  product: { icon: "📦", label: "Product barcode", materials: [8, 15], coins: [10, 25], flavor: "A shipment of goods arrived." },
  text: { icon: "📝", label: "Mystery code", materials: [15, 30], coins: [5, 10], flavor: "Someone left a note…" },
};

// Extra flavour for websites, matched against the domain + path.
const URL_FLAVORS = [
  { re: /menu|food|order|restaurant|cafe|coffee|pizza|burger|toasttab|resy|opentable|doordash|ubereats|grubhub/, icon: "🍔", label: "Restaurant menu", coins: 15, flavor: "Hungry citizens are happy citizens." },
  { re: /park|meter|parkmobile|paybyphone|passport|spothero/, icon: "🅿️", label: "Parking meter", materials: 15, flavor: "Asphalt for new roads!" },
  { re: /museum|gallery|library|\.edu|\.gov|wiki|history|tour|heritage|zoo|aquarium/, icon: "🏛️", label: "Culture spot", rare: 2, flavor: "Culture attracts landmarks." },
  { re: /instagram|facebook|tiktok|linktr|twitter|x\.com|youtube|snapchat|threads/, icon: "📣", label: "Social link", pop: 3, flavor: "Word is spreading about your town." },
  { re: /bus|train|transit|metro|subway|rail|ticket|airport|flight/, icon: "🚌", label: "Transit code", materials: 20, flavor: "Better transit, more roads." },
  { re: /shop|store|product|item|sale|coupon|deal|amazon|ebay|etsy/, icon: "🛍️", label: "Shopping code", coins: 20, flavor: "Shoppers are coming to town." },
];

const RARITY_INFO = {
  uncommon: { label: "Uncommon", color: "#22c55e" },
  rare: { label: "Rare", color: "#3b82f6" },
  legendary: { label: "Legendary", color: "#f59e0b" },
};

const Rewards = {
  classify(text, format = "qr_code") {
    const t = text.trim();
    const lower = t.toLowerCase();
    if (format !== "qr_code" && /^\d{6,14}$/.test(t)) return { kind: "product", key: "product:" + t };
    if (/^wifi:/i.test(t)) {
      const ssid = (t.match(/S:([^;]*)/i) || [])[1] || t;
      return { kind: "wifi", key: "wifi:" + ssid.toLowerCase() };
    }
    if (/^(begin:vcard|mecard:)/i.test(t)) return { kind: "contact", key: "contact:" + lower };
    if (/^begin:(vevent|vcalendar)/i.test(t)) return { kind: "event", key: "event:" + lower };
    if (/^geo:/i.test(t)) return { kind: "geo", key: "geo:" + lower };
    if (/^(tel:|sms:|smsto:|mailto:|matmsg:)/i.test(t)) return { kind: "phone", key: "phone:" + lower };
    if (/^(bitcoin:|ethereum:|upi:|venmo|https?:\/\/(www\.)?(venmo|paypal|cash\.app|paypal\.me))/i.test(t)) {
      return { kind: "payment", key: "payment:" + lower.split("?")[0] };
    }
    const url = Rewards.parseUrl(t);
    if (url) {
      // One reward per page: ignore query strings like ?table=12
      const path = url.pathname.replace(/\/+$/, "");
      return { kind: "url", key: "url:" + url.hostname.replace(/^www\./, "") + path, host: url.hostname, path };
    }
    return { kind: "text", key: "text:" + lower };
  },

  parseUrl(t) {
    try {
      if (/^https?:\/\//i.test(t)) return new URL(t);
      if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(t)) return new URL("https://" + t);
    } catch {}
    return null;
  },

  evaluate(text, format, city) {
    const c = Rewards.classify(text, format);
    const kind = SCAN_KINDS[c.kind];
    const rng = createRNG(hashString(c.key) >>> 0);
    const range = (r) => (r ? Math.round(lerp(r[0], r[1], rng())) : 0);

    let icon = kind.icon, label = kind.label, flavor = kind.flavor || "";
    let materials = range(kind.materials);
    let coins = range(kind.coins);
    let pop = range(kind.pop);
    let rareBoost = 1;

    if (c.kind === "url") {
      const f = URL_FLAVORS.find((f) => f.re.test(c.host + c.path));
      if (f) {
        icon = f.icon;
        label = f.label;
        flavor = f.flavor;
        materials += f.materials || 0;
        coins += f.coins || 0;
        pop += f.pop || 0;
        rareBoost = f.rare || 1;
      } else {
        flavor = "Visitors found your town online.";
      }
    }

    // Rewards grow with your city so scans always matter.
    const growth = 1 + Math.max(0, city.roadCount - 1) * 0.08;
    materials = Math.round(materials * growth);
    coins = Math.round(coins * growth);

    // Rare drops: the roll is part of the code, so a lucky sticker stays lucky.
    const roll = rng();
    let rarity = null;
    if (roll < 0.02 * rareBoost) rarity = "legendary";
    else if (roll < 0.08 * rareBoost) rarity = "rare";
    else if (roll < 0.25 * rareBoost) rarity = "uncommon";
    let item = null;
    if (rarity) {
      const pool = SPECIAL_IDS.filter((id) => SPECIALS[id].rarity === rarity);
      item = pool[Math.floor(rng() * pool.length)];
    }

    return { key: c.key, kind: c.kind, icon, label, flavor, materials, coins, pop, item, rarity };
  },
};
