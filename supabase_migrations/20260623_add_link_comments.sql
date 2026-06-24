-- Safe, one-time migration for an existing database.
-- Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
alter table public.links add column if not exists comment text;

-- Ask PostgREST to reload its schema cache immediately.
notify pgrst, 'reload schema';
