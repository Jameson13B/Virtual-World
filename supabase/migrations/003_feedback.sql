-- Player feedback from the game (⚙️ Settings → 💬 Send feedback), mostly about
-- which look people prefer. Players can only add feedback, never read it:
-- read it in Supabase → Table Editor → feedback, or with SQL (see README).
-- Safe to run more than once.

create table if not exists public.feedback (
  id         bigint generated always as identity primary key,
  user_id    uuid default auth.uid() references auth.users on delete set null,
  prefers    text check (prefers in ('3d', 'classic', 'both')),
  rating     smallint check (rating between 1 and 5),
  message    text not null default '' check (char_length(message) <= 2000),
  look       text not null default '' check (char_length(look) <= 16),
  version    text not null default '' check (char_length(version) <= 16),
  device     text not null default '' check (char_length(device) <= 200),
  city_name  text not null default '' check (char_length(city_name) <= 24),
  pop        integer,
  created_at timestamptz not null default now()
);
create index if not exists feedback_created_idx on public.feedback (created_at desc);

alter table public.feedback enable row level security;
drop policy if exists "send own feedback" on public.feedback;
create policy "send own feedback" on public.feedback for insert to authenticated
  with check ((select auth.uid()) = user_id);
