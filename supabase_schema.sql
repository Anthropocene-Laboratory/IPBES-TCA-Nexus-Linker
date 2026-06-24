-- =====================================================================
-- TCA <-> Nexus Linker — Supabase schema (no-auth, name-based pilot)
-- Run once on a FRESH project: SQL Editor -> New query -> paste -> Run.
--
-- No authentication: each expert types a display name + email (declarative).
-- Access uses the public anon key, so anyone with the app URL (and the optional
-- shared access code, VITE_ACCESS_CODE) can read/write. Fine for a trusted
-- pilot; switch to Supabase Auth for official, tamper-proof attribution.
--
-- WARNING: this drops and recreates the tables (resets existing data).
-- To convert an EXISTING auth-based DB without data loss, run instead:
--   supabase_migrations/20260624_revert_to_no_auth.sql
-- =====================================================================

drop table if exists public.links cascade;
drop table if exists public.experts cascade;

create table public.experts (
  id         uuid primary key,            -- client-generated browser UUID
  name       text not null,
  email      text,
  created_at timestamptz not null default now()
);

create table public.links (
  id              uuid primary key default gen_random_uuid(),
  expert_id       uuid not null references public.experts (id) on delete cascade,
  tca_action_id   text not null,
  nexus_option_id text not null,
  strength        text not null check (strength in ('primary', 'secondary')),
  comment         text,                    -- optional: why this link
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (expert_id, tca_action_id, nexus_option_id)
);

create index links_tca_idx   on public.links (tca_action_id);
create index links_nexus_idx on public.links (nexus_option_id);

alter table public.experts enable row level security;
alter table public.links   enable row level security;

drop policy if exists "experts_all" on public.experts;
drop policy if exists "links_all"   on public.links;
create policy "experts_all" on public.experts for all to anon, authenticated using (true) with check (true);
create policy "links_all"   on public.links   for all to anon, authenticated using (true) with check (true);

-- Realtime (live agreement + flow graph)
do $$
begin
  if not exists (select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'links') then
    alter publication supabase_realtime add table public.links;
  end if;
  if not exists (select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'experts') then
    alter publication supabase_realtime add table public.experts;
  end if;
end $$;
