-- Migration 010: Leadly Studio (creative generation).
-- Run this once in the Supabase SQL editor.
--
-- One generic per-user document table instead of a table per concept: the
-- Studio's records (generation jobs, edit chains, animate runs, uploaded
-- reference images, context docs, brand guideline files) are all small JSON
-- documents that are only ever read back whole, by id or newest-first.
-- kind = job | chain | motion | upload | doc | brand.

create table public.studio_records (
  user_id     uuid not null references public.users(id) on delete cascade,
  kind        text not null,
  id          text not null,
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, kind, id)
);

alter table public.studio_records enable row level security;
create index studio_records_recent_idx on public.studio_records (user_id, kind, updated_at desc);
