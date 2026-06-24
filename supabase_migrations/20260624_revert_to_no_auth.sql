-- =====================================================================
-- Revert to NO-AUTH (name-based identity) for a trusted pilot.
-- Non-destructive: keeps existing experts/links rows.
-- Run once in Supabase -> SQL Editor -> New query.
-- =====================================================================

-- 1. Allow client-generated UUIDs (drop the FK to auth.users).
alter table public.experts drop constraint if exists experts_id_fkey;

-- 2. Make sure the link rationale column exists.
alter table public.links add column if not exists comment text;

-- 3. Permissive RLS: anon (public key) may read/write.
drop policy if exists "experts_read"        on public.experts;
drop policy if exists "experts_insert_own"  on public.experts;
drop policy if exists "experts_update_own"  on public.experts;
drop policy if exists "experts_all"         on public.experts;
create policy "experts_all" on public.experts for all to anon, authenticated using (true) with check (true);

drop policy if exists "links_read"       on public.links;
drop policy if exists "links_insert_own" on public.links;
drop policy if exists "links_update_own" on public.links;
drop policy if exists "links_delete_own" on public.links;
drop policy if exists "links_all"        on public.links;
create policy "links_all" on public.links for all to anon, authenticated using (true) with check (true);
