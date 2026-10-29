# 🏕️ Virtual World

A phone-first idle city builder that grows when you go out into the real world.
You start with one road and a couple of buildings in the middle of nowhere, then
feed your town by scanning QR codes wherever you find them.

Its roads, buildings and rendering engine come from freeCodeCamp's
[Create a Virtual World with JavaScript](https://www.freecodecamp.org/news/create-a-virtual-world-with-javascript/) course.

## The game loop

```
📷 scan codes / 🎁 daily gift / 🏪 market
        ↓  🧱 materials
🛣️ pick your next road from 2 options (3 from City); each player's road network is unique
        ↓  new empty lots
🏠 homes, 🏪 shops and 🏭 factories develop by demand (homes need jobs, shops need customers)
        ↓
👥 people move in → 💰 taxes + shop income, 🧱 from factories → ⬆️ upgrades → bigger tiers
```

- **Scanning:** what a code is for decides the reward. Wi-Fi codes give power and coins, contact cards bring families, product barcodes bring goods, and restaurant menus, parking meters, museums and social links each have their own flavor. The exact contents of a code decide the amounts and the rare drops, so the same sticker gives every player the same reward. Each code counts once per town, and URLs ignore `?query` strings so one restaurant's 30 table codes count as one.
- **Rare drops:** parks, fountains, schools, clinics, fire stations, libraries, a Sky Tower, a stadium and a Ferris wheel. Place them on an empty lot, or on top of a home, shop or factory to replace it, to raise ✨ appeal, which makes the town grow faster. A placed special can go back in the bag at any time.
- **Factories:** from Town (40 people) on, about 1 in 4 job buildings is a 🏭 factory. Factories fill up with 🧱 and show a 📦 crate to tap, a small boost on top of scanning.
- **Tiers:** Hamlet → Village (10 people) → Town (40) → City (120) → Metropolis (400) → Megalopolis (1,000) → Metroplex (2,500) → Capital (5,000) → Global City (10,000).
- **Offline progress:** the town keeps growing for up to 1 hour while the app is closed.
- **Social:** your town's name is your username, so you're on the 🏆 world leaderboard automatically. Add friends and visit anyone's town by name or link (read-only). If two towns share a name, the newer one gets a number added (oakstead2). Each scan also tells you how many explorers have found that code before you.
- **Cloud save:** every player gets a silent account, so progress backs up automatically. Adding an email makes the town recoverable on a new phone.
- **Hidden extras:** in ⚙️ Settings, tap the version number 5 times. That unlocks driving around your town, typing a code to simulate a scan, fast-forwarding time, the sandbox editor and AI car training.

## Run it

```bash
cd ~/virtual-world && python3 -m http.server 8000
```

- **Desktop:** open http://localhost:8000. Live camera scanning works on `localhost`.
- **Phone on the same Wi-Fi:** open `http://<your-computer-ip>:8000`. Without HTTPS the live camera is blocked, so the scanner falls back to **📸 Take a photo**, which works everywhere.
- **Full live-camera experience:** host it on HTTPS (see below). It is also an installable app: use *Add to Home Screen*.

Without `js/game/config.js` filled in, everything works offline and the online features stay hidden.

## Go online (Netlify + Supabase)

**1. Supabase (accounts, leaderboard, friends, cloud saves)** – free tier is plenty.
1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor** → paste all of `supabase/schema.sql` → **Run**. (Already set up? Run any new files in `supabase/migrations/` in order instead.)
3. **Authentication → Sign In / Providers** → turn on **Allow anonymous sign-ins** (Email stays on).
4. *(Optional, needs custom SMTP)* **Authentication → Emails → Magic link** → add `Your code: {{ .Token }}`, so players switching phones can type a code. Without it, players tap the **Sign in** link in the email instead, which works fine.
5. **Project Settings → API** → copy the **Project URL** and the **anon / publishable key** into `js/game/config.js`. The anon key is designed to be public; the row level security in `schema.sql` is what protects the data.

**2. Netlify (HTTPS hosting, so the live camera works on phones)**
- Quickest: open [app.netlify.com/drop](https://app.netlify.com/drop) and drag the `virtual-world` folder onto it. To update later, drag it onto the site's **Deploys** page again.
- Or put the folder in a GitHub repo and use **Add new site → Import from Git** for automatic deploys. `netlify.toml` already says there's no build step.

**3. Connect them:** in Supabase → **Authentication → URL Configuration**, set **Site URL** to your Netlify address (e.g. `https://your-town.netlify.app`) so email links come back to the game.

Notes: Supabase's built-in email sender only allows a few emails per hour – fine for testing, add your own SMTP before a real launch. Leaderboard numbers come from players' phones, so a determined cheater can fake them; scans are stored as hashes, which leaves room for server-side checks later.

## Code map

```
index.html, css/game.css     the game (phone UI)
js/game/layout.js            deterministic road growth + building lots
js/game/city.js              economy, tiers, specials, save/share codes
js/game/rewards.js           scan classification and rewards
js/game/render.js            map rendering (lots, construction, forest, bubbles)
js/game/models.js            3D models for every building: homes, shops, factories, specials
js/game/scanner.js           camera scanning (BarcodeDetector or jsQR) + photo fallback
js/game/touch.js             pan / pinch / tap
js/game/online.js            Supabase: accounts, leaderboard, friends, cloud save
js/game/config.js            your Supabase URL + anon key (empty = offline)
js/game/game.js              loop, menus, sharing, extras
supabase/schema.sql          database tables + security rules
netlify.toml                 hosting config
vendor/jsQR.js               QR decoder (for iPhones, which lack BarcodeDetector)
vendor/supabase.js           supabase-js 2.45.4
sandbox.html + js/main.js    the original editor/driving/AI sandbox (hidden extra)
```

### How cities stay unique but shareable

`CityLayout.roadOptions()` proposes the k-th road's options from the town's seed and the roads that already exist;
the player's pick is saved in the road graph. A pending choice waits (even offline) until the player picks.
Its geometry uses only `+ - * /` and `sqrt`, which give identical results on every device,
so a town rebuilt from a share code matches on any phone. Share codes also carry the road graph itself,
so future changes to the growth algorithm won't break old links.

### Tuning

- **Pacing:** `City.roadCost()`, `#develop()` (demand formulas), `tick()` (growth rates, shop income), `factoryRate()` and `INDUSTRY_SHARE` (factories), and the `TIERS` and `SPECIALS` tables in `js/game/city.js`.
- **Rewards:** the `SCAN_KINDS` and `URL_FLAVORS` tables in `js/game/rewards.js`.
