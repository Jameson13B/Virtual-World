// ---------------------------------------------------------------------------
// Online features (Supabase): usernames, leaderboard, friends, cloud saves and
// "how many explorers found this code". Everything here is optional: with no
// config, or no connection, the game plays exactly the same offline.
// ---------------------------------------------------------------------------
"use strict";

const HANDLE_RE = /^[a-z0-9_]{3,16}$/;
const PROFILE_COLS = "id, handle, city_name, pop, tier, roads, scans, updated_at";

class Online {
  constructor(config = {}) {
    this.enabled = !!(config.supabaseUrl && config.supabaseAnonKey && window.supabase);
    this.sb = this.enabled
      ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        })
      : null;
    this.user = null;
    this.profile = null;
    this.listening = false;
    this.onChange = () => {};
  }

  get ready() {
    return !!this.user;
  }
  get handle() {
    return this.profile ? this.profile.handle : null;
  }
  get email() {
    return this.user && !this.user.is_anonymous ? this.user.email || this.user.new_email : null;
  }
  get pendingEmail() {
    return this.user ? this.user.new_email || null : null;
  }

  // Signs in silently (anonymous account) so scans and saves work right away.
  async start() {
    if (!this.enabled) return false;
    try {
      const { data } = await this.sb.auth.getSession();
      let user = data.session ? data.session.user : null;
      if (!user) {
        const res = await this.sb.auth.signInAnonymously();
        if (res.error) throw res.error;
        user = res.data.user;
      }
      await this.#setUser(user);
      if (!this.listening) {
        this.listening = true;
        this.sb.auth.onAuthStateChange((event, session) => {
          const u = session ? session.user : null;
          if ((u && u.id) === (this.user && this.user.id) && event !== "USER_UPDATED") return;
          // Supabase calls inside this callback can deadlock, so defer them.
          setTimeout(() => this.#setUser(u).then(() => this.onChange(event)), 0);
        });
      }
      return true;
    } catch (e) {
      console.warn("Online features unavailable:", e.message || e);
      return false;
    }
  }

  async #setUser(user) {
    this.user = user;
    this.profile = null;
    if (!user) return;
    const { data } = await this.sb.from("profiles").select(PROFILE_COLS).eq("id", user.id).maybeSingle();
    this.profile = data || null;
  }

  // Usernames are the town name: "Maple Hill" → "maplehill". Also used for what players type.
  static normalizeHandle(h) {
    const slug = String(h || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 16);
    return slug.length >= 3 ? slug : (slug + "town").slice(0, 16);
  }

  // Whether a handle already belongs to this town name (exact, or with a number added).
  static handleMatches(handle, name) {
    const base = Online.normalizeHandle(name);
    if (handle === base) return true;
    return [15, 12].some((k) => {
      const prefix = base.slice(0, k);
      return handle.startsWith(prefix) && /^\d+$/.test(handle.slice(prefix.length));
    });
  }

  #cardFor(city) {
    return {
      city_name: city.name.slice(0, 24),
      seed: city.seed,
      pop: Math.floor(city.pop),
      tier: city.tier,
      roads: city.roadCount,
      scans: city.stats.scans,
      share_code: city.toShareCode(),
    };
  }

  // Gives the player a username made from their town name. If another town already
  // has that name, a number is added (oakstead, oakstead2, …).
  async #claimTownHandle(city) {
    const base = Online.normalizeHandle(city.name);
    const tries = [base];
    for (let n = 2; n <= 9; n++) tries.push(base.slice(0, 15) + n);
    for (let i = 0; i < 3; i++) tries.push(base.slice(0, 12) + Math.floor(1000 + Math.random() * 9000));
    for (const handle of tries) {
      if (!HANDLE_RE.test(handle)) continue;
      const row = { id: this.user.id, handle, ...this.#cardFor(city) };
      const { data, error } = await this.sb.from("profiles").upsert(row).select(PROFILE_COLS).single();
      if (!error) {
        this.profile = data;
        return;
      }
      if (error.code !== "23505") throw error;
    }
  }

  // Pushes the public town card and the private full save.
  async publish(city) {
    if (!this.ready) return;
    if (!this.profile || !Online.handleMatches(this.profile.handle, city.name)) await this.#claimTownHandle(city);
    const jobs = [this.sb.from("saves").upsert({ user_id: this.user.id, data: city.toSave(), pop: Math.floor(city.pop) })];
    if (this.profile) jobs.push(this.sb.from("profiles").update(this.#cardFor(city)).eq("id", this.user.id));
    const results = await Promise.all(jobs);
    for (const r of results) if (r.error) console.warn("Sync failed:", r.error.message);
  }

  async cloudSave() {
    if (!this.ready) return null;
    const { data } = await this.sb.from("saves").select("data, pop, updated_at").eq("user_id", this.user.id).maybeSingle();
    return data || null;
  }

  async leaderboard(limit = 50) {
    const { data, error } = await this.sb.from("profiles").select(PROFILE_COLS).order("pop", { ascending: false }).limit(limit);
    if (error) throw error;
    return data;
  }

  async myRank(pop) {
    const { count, error } = await this.sb.from("profiles").select("id", { count: "exact", head: true }).gt("pop", Math.floor(pop));
    return error ? null : count + 1;
  }

  async friends() {
    if (!this.ready) return [];
    const { data, error } = await this.sb
      .from("follows")
      .select("followee, town:profiles!follows_followee_fkey(" + PROFILE_COLS + ")")
      .eq("follower", this.user.id);
    if (error) throw error;
    return data.map((r) => r.town).filter(Boolean).sort((a, b) => b.pop - a.pop);
  }

  // Returns null on success, or a message for the player.
  async follow(raw) {
    const handle = Online.normalizeHandle(raw);
    if (!this.profile) return "Still joining the leaderboard – try again in a moment";
    if (handle === this.profile.handle) return "That's you! 😄";
    const { data } = await this.sb.from("profiles").select("id").eq("handle", handle).maybeSingle();
    if (!data) return "No town called " + raw.trim();
    const { error } = await this.sb.from("follows").insert({ follower: this.user.id, followee: data.id });
    if (error && error.code !== "23505") return "Couldn't add " + raw.trim();
    return null;
  }

  async unfollow(id) {
    await this.sb.from("follows").delete().eq("follower", this.user.id).eq("followee", id);
  }

  async townByHandle(raw) {
    const handle = Online.normalizeHandle(raw);
    const { data } = await this.sb.from("profiles").select("handle, share_code").eq("handle", handle).maybeSingle();
    return data && data.share_code ? data : null;
  }

  // Records a scan (hashed) and returns how many players have found that code.
  async recordScan(key, kind) {
    if (!this.ready || !crypto.subtle) return null;
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
    const hash = Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
    const ins = await this.sb.from("scans").insert({ code_hash: hash, kind: String(kind).slice(0, 16) });
    if (ins.error && ins.error.code !== "23505") return null;
    const { data, error } = await this.sb.rpc("code_finders", { h: hash });
    return error ? null : data;
  }

  // Attaches an email to this (anonymous) account so the town can be recovered.
  async linkEmail(email) {
    const { error } = await this.sb.auth.updateUser({ email }, { emailRedirectTo: location.origin + location.pathname });
    return error ? error.message : null;
  }

  async sendLoginCode(email) {
    const { error } = await this.sb.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname },
    });
    return error ? error.message : null;
  }

  async verifyLoginCode(email, token) {
    const { data, error } = await this.sb.auth.verifyOtp({ email, token, type: "email" });
    if (error) return error.message;
    await this.#setUser(data.user);
    return null;
  }

  async signOut() {
    await this.sb.auth.signOut();
    await this.start();
  }
}
