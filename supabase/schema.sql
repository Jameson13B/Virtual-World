-- Virtual World: online features (usernames, leaderboard, friends, cloud saves,
-- and "how many explorers found this code").
-- Paste into Supabase → SQL Editor → Run. Safe to run again.

-- Public town cards, shown on leaderboards and when someone visits by username.
create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  handle      text not null unique check (handle ~ '^[a-z0-9_]{3,16}$'),
  city_name   text not null default '' check (char_length(city_name) <= 24),
  seed        bigint,
  pop         integer not null default 0 check (pop between 0 and 10000000),
  tier        smallint not null default 0,
  roads       integer not null default 1,
  scans       integer not null default 0,
  share_code  text check (char_length(share_code) <= 300000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists profiles_pop_idx on public.profiles (pop desc);

-- One-way follows ("friends").
create table if not exists public.follows (
  follower   uuid not null references public.profiles (id) on delete cascade,
  followee   uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, followee),
  check (follower <> followee)
);

-- Private full save, so a town survives a lost or new phone.
create table if not exists public.saves (
  user_id    uuid primary key references auth.users on delete cascade,
  data       jsonb not null check (pg_column_size(data) < 3000000),
  pop        integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Codes each player has scanned. Only a SHA-256 hash is stored, never the code itself.
create table if not exists public.scans (
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  code_hash  text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  kind       text not null default 'text' check (char_length(kind) <= 16),
  created_at timestamptz not null default now(),
  primary key (user_id, code_hash)
);
create index if not exists scans_hash_idx on public.scans (code_hash);

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
drop trigger if exists saves_touch on public.saves;
create trigger saves_touch before update on public.saves
  for each row execute function public.touch_updated_at();

-- How many players have found a code (without revealing who).
create or replace function public.code_finders(h text) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.scans where code_hash = h;
$$;
revoke all on function public.code_finders(text) from public;
grant execute on function public.code_finders(text) to anon, authenticated;

-- Row level security
alter table public.profiles enable row level security;
alter table public.follows  enable row level security;
alter table public.saves    enable row level security;
alter table public.scans    enable row level security;

drop policy if exists "profiles are public"  on public.profiles;
drop policy if exists "insert own profile"   on public.profiles;
drop policy if exists "update own profile"   on public.profiles;
create policy "profiles are public" on public.profiles for select using (true);
create policy "insert own profile"  on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "update own profile"  on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists "see own follows"   on public.follows;
drop policy if exists "follow as self"    on public.follows;
drop policy if exists "unfollow as self"  on public.follows;
create policy "see own follows"  on public.follows for select to authenticated
  using ((select auth.uid()) in (follower, followee));
create policy "follow as self"   on public.follows for insert to authenticated with check ((select auth.uid()) = follower);
create policy "unfollow as self" on public.follows for delete to authenticated using ((select auth.uid()) = follower);

drop policy if exists "own save" on public.saves;
create policy "own save" on public.saves for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "see own scans"    on public.scans;
drop policy if exists "record own scans" on public.scans;
create policy "see own scans"    on public.scans for select to authenticated using ((select auth.uid()) = user_id);
create policy "record own scans" on public.scans for insert to authenticated with check ((select auth.uid()) = user_id);
