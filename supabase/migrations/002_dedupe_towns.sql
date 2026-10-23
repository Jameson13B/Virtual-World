-- Fix #9: duplicate and stale towns on the leaderboard.
-- Lets a player delete their own leaderboard card and save. The game uses this to
-- retire the silent (anonymous) account a phone was using after it signs into an
-- email account, and to leave the leaderboard after starting a new town.
-- Safe to run more than once.

drop policy if exists "delete own profile" on public.profiles;
create policy "delete own profile" on public.profiles for delete to authenticated
  using ((select auth.uid()) = id);

-- (saves already has a "for all" policy that covers delete.)

create index if not exists profiles_seed_idx on public.profiles (seed);
create index if not exists profiles_updated_idx on public.profiles (updated_at desc);
