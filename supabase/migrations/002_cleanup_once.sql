-- One-time cleanup for #9. Run once after 002_dedupe_towns.sql.
-- Look at what it will remove first: run just the SELECTs, then the DELETEs.

-- 1. Copies of the same town (same seed) held by silent/anonymous accounts,
--    when a more recently updated copy exists. Keeps the newest copy.
select p.handle, p.city_name, p.pop, p.updated_at
from public.profiles p
join auth.users u on u.id = p.id
where u.is_anonymous
  and exists (
    select 1 from public.profiles q
    where q.seed = p.seed and q.id <> p.id and q.updated_at > p.updated_at
  );

delete from public.profiles p
using auth.users u
where u.id = p.id
  and u.is_anonymous
  and exists (
    select 1 from public.profiles q
    where q.seed = p.seed and q.id <> p.id and q.updated_at > p.updated_at
  );

-- 2. Towns that never reached Village (10 people). They rejoin automatically
--    once they reach 10.
select handle, city_name, pop, updated_at from public.profiles where pop < 10;
delete from public.profiles where pop < 10;
