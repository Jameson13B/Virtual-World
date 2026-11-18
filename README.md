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
🎒 the town sends the 🏠 homes, 🏪 shops and 🏭 factories it needs (homes need jobs, shops need customers)
        ↓  you pick the empty lot for each one
🏗️ buildings go up
👥 people move in → 💰 taxes + shop income, 🧱 from factories → ⬆️ upgrades → bigger tiers
```

- **Maps:** a new town starts by picking its land: 🌲 Woodland, 🏖️ Beach, 🏞️ Grand River, ⛰️ Mountains, 🌊 Great Bay, 🛶 Lake Country or 🏝️ Islands. Each card previews the exact map you'll get, and 🎲 deals new ones, so two towns of the same type never match. Roads and lots stay on dry land, but a road can bridge up to 600 units of water and tunnel through up to 400 of rock. Towns from before maps existed stay on the classic flat forest.
- **Scanning:** what a code is for decides the reward. Wi-Fi codes give power and coins, contact cards bring families, product barcodes bring goods, and restaurant menus, parking meters, museums and social links each have their own flavor. The exact contents of a code decide the amounts and the rare drops, so the same sticker gives every player the same reward. Each code counts once per town, and URLs ignore `?query` strings so one restaurant's 30 table codes count as one.
- **Building:** empty lots don't build themselves. At the pace lots used to develop, the town adds whatever demand calls for to the bag (`City.plots`), never more than there are empty lots, and the player places each one by tapping an empty lot or from 🎒 Items ("Place them all for me" scatters them at random). Any finished building, special or station can be moved later for free: 🚚 Move or swap in its sheet, then tap an empty lot to move it there or another building to swap the two (levels and stored 💰/🧱 go along).
- **Rare drops:** parks, fountains, schools, clinics, fire stations, libraries, a Sky Tower, a stadium and a Ferris wheel. Place them on an empty lot, or on top of a home, shop or factory to replace it, to raise ✨ appeal, which makes the town grow faster. A placed special can go back in the bag at any time.
- **Factories:** from Town (40 people) on, about 1 in 4 job buildings is a 🏭 factory. Factories fill up with 🧱 and show a 📦 crate to tap, a small boost on top of scanning.
- **Traffic:** cars are residents on real trips that follow the phone's clock: home → work in the morning, errands at lunch, work → home in the evening, parks and specials at night. They pull out of one building and disappear into another. A shopper who stops at a shop spends 💰 (1 per shop level) into its bag. Tap a car to see who's driving and follow it.
- **Tiers:** Hamlet → Village (10 people) → Town (40) → City (120) → Metropolis (400) → Megalopolis (1,000) → Metroplex (2,500) → Capital (5,000) → Global City (10,000).
- **Offline progress:** the town keeps working for 15 minutes after the player's last tap, open or closed, then rests until they're back.
- **Social:** your town's name is your username, so you're on the 🏆 world leaderboard automatically. Add friends and visit anyone's town by name or link (read-only). If two towns share a name, the newer one gets a number added (oakstead2). Each scan also tells you how many explorers have found that code before you.
- **Cloud save:** every player gets a silent account, so progress backs up automatically. Adding an email makes the town recoverable on a new phone.
- **Two looks:** the classic top-down map, or the new low-poly 3D look (beta) with map views by zone, level and fire/police coverage, level badges and day & night. Switch in ⚙️ Settings → Look & feel; the choice is saved per device.
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
js/game/terrain.js           map types: deterministic oceans, rivers, lakes, hills, mountains
js/game/layout.js            deterministic road growth + building lots
js/game/city.js              economy, tiers, specials, save/share codes
js/game/rewards.js           scan classification and rewards
js/game/render.js            classic look: map rendering (lots, construction, forest, bubbles)
js/game/models.js            classic look: fake-3D models for every building
js/game/lowpoly/             3D look (beta), loaded only when switched on:
  index.js, renderer.js        entry point; the scene, camera, lights, lots and lenses
  ground.js, roads3d.js        terrain, water, roads, bridges, tunnels, ghost roads
  models3d.js, kit.js          low-poly building models and the kit they're built with
  trees3d.js, vehicles3d.js    instanced forest, cars and trucks
  overlay.js                   bubbles, badges and labels drawn over the 3D view
js/game/scanner.js           camera scanning (BarcodeDetector or jsQR) + photo fallback
js/game/touch.js             pan / pinch / tap
js/game/online.js            Supabase: accounts, leaderboard, friends, cloud save
js/game/config.js            your Supabase URL + anon key (empty = offline)
js/game/game.js              loop, menus, sharing, extras
supabase/schema.sql          database tables + security rules
netlify.toml                 hosting config
vendor/jsQR.js               QR decoder (for iPhones, which lack BarcodeDetector)
vendor/supabase.js           supabase-js 2.45.4
vendor/three.module.min.js   three.js r169 (3D look only)
sandbox.html + js/main.js    the original editor/driving/AI sandbox (hidden extra)
```

### How cities stay unique but shareable

`CityLayout.roadOptions()` proposes the k-th road's options from the town's seed and the roads that already exist;
the player's pick is saved in the road graph. A pending choice waits (even offline) until the player picks.
Its geometry, and the terrain from the town's map type and seed, use only `+ - * /`, `sqrt` and `floor`, which give identical results on every device,
so a town rebuilt from a share code matches on any phone. Share codes also carry the road graph itself,
so future changes to the growth algorithm won't break old links.

### The two looks

game.js only talks to a renderer through `draw()`, `pickMarker()`, `lotAt()`, `choiceAt()`, `anchor()`, `borders` and `dispose()`;
`makeRenderer()` picks `CityRenderer` (classic) or the 3D one from `prefs.look`. To keep just one look later:

- **Keep 3D:** delete `render.js` and `models.js` (move `wildTreeAt`/`TREE_CELL` into `lowpoly/trees3d.js` first), their `<script>` tags, the classic branch in `makeRenderer()` and the toggle in `openSettings()`, and default `prefs.look` to `"lowpoly"` (load it at boot).
- **Keep classic:** delete `js/game/lowpoly/` and `vendor/three.module.min.js`, the 3D branch in `makeRenderer()`, the toggle, `#city3d`, the 🗺️ lens button and `#lensLegend`.

### Reading feedback

Players send feedback from ⚙️ Settings → 💬 Send feedback (and get asked once after 10 minutes in the 3D look).
It lands in the `feedback` table: Supabase → **Table Editor → feedback**, or in the SQL Editor:

```sql
-- the look vote so far
select prefers, count(*), round(avg(rating), 1) as avg_rating from public.feedback group by prefers;
-- newest messages
select created_at, prefers, rating, look, message, city_name, pop from public.feedback order by created_at desc limit 50;
```

Players can add feedback but can't read anyone's, including their own.

### Tuning

- **Pacing:** `City.roadCost()`, `#demand()` (demand formulas), `tick()` (growth rates, shop income), `factoryRate()` and `INDUSTRY_SHARE` (factories), and the `TIERS` and `SPECIALS` tables in `js/game/city.js`.
- **Maps:** the `TERRAIN_SHAPES` height functions, `BRIDGE_MAX` / `TUNNEL_MAX` and the `TERRAIN_COLORS` in `js/game/terrain.js`. Changing a shape moves the land under existing towns of that type, so add a new type instead.
- **Rewards:** the `SCAN_KINDS` and `URL_FLAVORS` tables in `js/game/rewards.js`.
