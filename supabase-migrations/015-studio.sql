-- Migration 015: Leadly Studio (built from scratch).
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- platform_settings holds the encrypted API keys (FAL_KEY, FAL_ADMIN_KEY,
-- ANTHROPIC_API_KEY) - values are AES-256-GCM ciphertext, encrypted and
-- decrypted only inside server functions; no key ever reaches the browser.
-- Per-workspace: a monthly credit budget, an unlock flag, a brand kit, a
-- spend ledger, and the async job table. Outputs live in the 'studio'
-- storage bucket under <workspace_id>/... paths.

create table if not exists public.platform_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

alter table public.workspaces add column if not exists studio_enabled boolean not null default false;
alter table public.workspaces add column if not exists studio_budget  numeric not null default 0;
alter table public.workspaces add column if not exists brand_kit      jsonb;

-- Every charged job writes a ledger row; month spend is summed from here.
create table if not exists public.studio_spend (
  id           bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id       uuid,
  amount       numeric not null,
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists studio_spend_ws_month on public.studio_spend (workspace_id, created_at);

-- Async jobs: queued -> generating -> done | partial | error, with
-- per-placement state inside placements jsonb.
create table if not exists public.studio_jobs (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by   uuid references public.users(id),
  status       text not null default 'queued',
  cost         numeric not null default 0,
  model        text,
  template_id  text,
  spec         jsonb,
  inputs       jsonb,
  placements   jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists studio_jobs_ws on public.studio_jobs (workspace_id, created_at desc);

-- Storage bucket for outputs (public read - paths embed the workspace uuid
-- and a random id, and ad creatives are made to be published).
insert into storage.buckets (id, name, public)
  values ('studio', 'studio', true)
  on conflict (id) do nothing;

alter table public.platform_settings enable row level security;
alter table public.studio_spend      enable row level security;
alter table public.studio_jobs       enable row level security;
