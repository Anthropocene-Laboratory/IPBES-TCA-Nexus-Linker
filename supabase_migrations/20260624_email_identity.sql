-- =====================================================================
-- Treat one email as ONE expert (dedupe by normalized email).
-- Different names with the same email -> a single expert row.
-- Run once in Supabase -> SQL Editor -> New query.
-- =====================================================================

-- Let the DB generate the id, so the app can upsert on email (not id).
alter table public.experts alter column id set default gen_random_uuid();

-- Normalize any existing emails (trim + lowercase).
update public.experts set email = lower(trim(email)) where email is not null;

-- One row per email (case-insensitive thanks to app-side normalization).
create unique index if not exists experts_email_unique on public.experts (email);
