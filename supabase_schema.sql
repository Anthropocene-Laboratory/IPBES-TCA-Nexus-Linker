-- =====================================================================
-- TCA <-> Nexus Linker — Supabase schema + Row Level Security (authenticated)
-- Run once: SQL Editor -> New query -> paste -> Run.
--
-- Identity = Supabase Auth (magic-link email). Each link is bound to a
-- verified account (auth.uid()); RLS lets an expert modify ONLY their own
-- links, so no one can change another expert's choices.
--
-- WARNING: this drops and recreates the tables (resets existing data).
-- =====================================================================

drop table if exists public.links cascade;
drop table if exists public.experts cascade;

-- ---- Tables ----------------------------------------------------------

-- Expert profile, tied 1:1 to the Supabase Auth user.
create table public.experts (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text not null,
  email      text,
  created_at timestamptz not null default now()
);

-- One row = one expert linking one (TCA action, Nexus option) pair with a force.
create table public.links (
  id              uuid primary key default gen_random_uuid(),
  expert_id       uuid not null references public.experts (id) on delete cascade,
  tca_action_id   text not null,                 -- e.g. 'TCA5-A01'
  nexus_option_id text not null,                 -- e.g. Nexus code 'B01'
  strength        text not null check (strength in ('primary', 'secondary')),
  comment         text,                          -- optional: why this link

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (expert_id, tca_action_id, nexus_option_id)
);

create index links_tca_idx   on public.links (tca_action_id);
create index links_nexus_idx on public.links (nexus_option_id);

-- ---- Row Level Security ---------------------------------------------

alter table public.experts enable row level security;
alter table public.links   enable row level security;

-- experts: any authenticated user can read all profiles (for attribution);
-- each user creates/updates only their own profile row.
drop policy if exists "experts_read"       on public.experts;
drop policy if exists "experts_insert_own" on public.experts;
drop policy if exists "experts_update_own" on public.experts;
create policy "experts_read"       on public.experts for select to authenticated using (true);
create policy "experts_insert_own" on public.experts for insert to authenticated with check (id = auth.uid());
create policy "experts_update_own" on public.experts for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- links: any authenticated user can read all links (to see agreement and the
-- flow graph); each user may insert/update/delete ONLY their own links.
drop policy if exists "links_read"       on public.links;
drop policy if exists "links_insert_own" on public.links;
drop policy if exists "links_update_own" on public.links;
drop policy if exists "links_delete_own" on public.links;
create policy "links_read"       on public.links for select to authenticated using (true);
create policy "links_insert_own" on public.links for insert to authenticated with check (expert_id = auth.uid());
create policy "links_update_own" on public.links for update to authenticated using (expert_id = auth.uid()) with check (expert_id = auth.uid());
create policy "links_delete_own" on public.links for delete to authenticated using (expert_id = auth.uid());

-- ---- Realtime (live agreement + flow graph across experts) -----------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'links'
  ) then
    alter publication supabase_realtime add table public.links;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'experts'
  ) then
    alter publication supabase_realtime add table public.experts;
  end if;
end $$;

-- =====================================================================
-- OPTIONAL: restrict sign-up to an invited allow-list of expert emails.
-- Uncomment, run, then add emails to public.allowed_emails.
-- =====================================================================
-- create table if not exists public.allowed_emails ( email text primary key );
-- create or replace function public.enforce_allowed_email()
-- returns trigger language plpgsql security definer as $$
-- begin
--   if not exists (select 1 from public.allowed_emails a where lower(a.email) = lower(new.email)) then
--     raise exception 'Email % is not on the invited expert list', new.email;
--   end if;
--   return new;
-- end; $$;
-- drop trigger if exists trg_enforce_allowed_email on auth.users;
-- create trigger trg_enforce_allowed_email
--   before insert on auth.users
--   for each row execute function public.enforce_allowed_email();
