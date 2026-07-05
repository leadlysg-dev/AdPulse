-- AdPulse schema for Supabase Postgres.
-- Paste this whole file into the Supabase SQL editor and run it once.
--
-- Replaces the Netlify Blobs one-JSON-blob-per-customer storage with four
-- normalized tables. The Netlify functions connect with the service/secret
-- key (SUPABASE_SECRET_KEY), which bypasses RLS; enabling RLS with no
-- policies means the public anon key can read nothing.

create table public.users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,          -- stored lowercase; the lookup key
  password_hash text not null,                 -- scrypt "salt:hash"
  created_at    timestamptz not null default now()
);

create table public.connected_accounts (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references public.users(id) on delete cascade,
  provider               text not null check (provider in ('meta', 'google')),
  access_token           text,
  refresh_token          text,                 -- google only; null for meta
  selected_ad_account_id text,
  connected_at           timestamptz,
  unique (user_id, provider)                   -- one row per provider per customer
);

create table public.ad_accounts (
  id                   bigint generated always as identity primary key,
  connected_account_id uuid not null references public.connected_accounts(id) on delete cascade,
  external_id          text not null,          -- e.g. "act_1234567890"
  name                 text,
  position             int not null default 0, -- preserves the picker's display order
  unique (connected_account_id, external_id)
);

create table public.selected_metrics (
  id                   bigint generated always as identity primary key,
  connected_account_id uuid not null references public.connected_accounts(id) on delete cascade,
  metric_id            text not null,          -- raw Meta action_type
  label                text not null,          -- friendly-name snapshot from the picker
  position             int not null default 0, -- selection order drives chart colors
  unique (connected_account_id, metric_id)
);

-- Lock everything down for the public anon key. The functions' secret key
-- bypasses RLS, so no policies are needed.
alter table public.users              enable row level security;
alter table public.connected_accounts enable row level security;
alter table public.ad_accounts        enable row level security;
alter table public.selected_metrics   enable row level security;

-- Helpful indexes for the access patterns the functions use.
create index connected_accounts_user_id_idx on public.connected_accounts (user_id);
create index ad_accounts_connected_account_id_idx on public.ad_accounts (connected_account_id);
create index selected_metrics_connected_account_id_idx on public.selected_metrics (connected_account_id);
