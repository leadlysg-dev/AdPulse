-- ═══════════════════════════════════════════════════════════════════════
-- LEADLY PULSE INTERNAL — FULL RESET
-- Drops every app table and rebuilds the schema from scratch for the
-- internal single-operator build.
--
-- REMOVED from the original SaaS schema (features stripped in this build):
--   workspace_invites, change_requests  (invites / client-sharing)
--   sc_properties                       (SEO / Search Console)
--   alert_rules                         (alerts / automations)
--   ad_change_log                       (audit log)
--   user_roles, admin_sessions, audit_log (platform admin)
--   platform_settings, studio_spend, studio_jobs (Leadly Studio)
--   The 'gbp' provider on connected_accounts (Google Business Profile)
-- studio_records is KEPT: it doubles as a small per-user KV cache
-- (pulse-chips daily suggestions).
-- workspaces + workspace_members are KEPT: the data layer keys the metrics
-- config by workspace; the app self-bootstraps a single workspace on first
-- write.
--
-- ⚠ DESTRUCTIVE ON PURPOSE. Running this deletes all app data.
-- Paste the whole file into the Supabase SQL editor and run it once.
-- ═══════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── 1 · Drop everything (including removed-feature tables) ──────────────
drop table if exists public.user_roles         cascade;
drop table if exists public.admin_sessions     cascade;
drop table if exists public.audit_log          cascade;
drop table if exists public.workspace_invites  cascade;
drop table if exists public.change_requests    cascade;
drop table if exists public.workspace_members  cascade;
drop table if exists public.studio_records     cascade;
drop table if exists public.studio_jobs        cascade;
drop table if exists public.studio_spend       cascade;
drop table if exists public.platform_settings  cascade;
drop table if exists public.ad_change_log      cascade;
drop table if exists public.alert_rules        cascade;
drop table if exists public.ai_insight_cache   cascade;
drop table if exists public.sc_properties      cascade;
drop table if exists public.selected_metrics   cascade;
drop table if exists public.ad_accounts        cascade;
drop table if exists public.connected_accounts cascade;
drop table if exists public.workspaces         cascade;
drop table if exists public.users              cascade;

-- ── 2 · Users ───────────────────────────────────────────────────────────
create table public.users (
  id              uuid primary key default gen_random_uuid(),
  email           text not null unique,        -- stored lowercase; the lookup key
  password_hash   text not null,               -- scrypt "salt:hash"
  password_set_at timestamptz,                 -- null = Google-only sign-in so far
  ai_prefs        jsonb,
  created_at      timestamptz not null default now()
);

-- ── 3 · Workspace (single, self-bootstrapped) ───────────────────────────
create table public.workspaces (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  billing_exempt  boolean not null default false,
  tracked_metrics jsonb,                        -- superseded by metrics_config
  metrics_config  jsonb,                        -- onboarding-set metrics
  created_at      timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  role         text not null check (role in ('owner', 'agency', 'client', 'member')),
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- ── 4 · Ad connections ─────────────────────────────────────────────────
create table public.connected_accounts (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references public.users(id) on delete cascade,
  provider               text not null check (provider in ('meta', 'google')),
  access_token           text,
  refresh_token          text,
  selected_ad_account_id text,
  connected_at           timestamptz,
  can_manage             boolean,
  workspace_id           uuid references public.workspaces(id),
  unique (user_id, provider)
);

create table public.ad_accounts (
  id                   bigint generated always as identity primary key,
  connected_account_id uuid not null references public.connected_accounts(id) on delete cascade,
  external_id          text not null,
  name                 text,
  position             int not null default 0,
  login_customer_id    text,                    -- MCC routing for Google Ads
  workspace_id         uuid references public.workspaces(id),
  unique (connected_account_id, external_id)
);

create table public.selected_metrics (
  id                   bigint generated always as identity primary key,
  connected_account_id uuid not null references public.connected_accounts(id) on delete cascade,
  metric_id            text not null,
  label                text not null,
  position             int not null default 0,
  target_cost_per      numeric,
  workspace_id         uuid references public.workspaces(id),
  unique (connected_account_id, metric_id)
);

-- ── 5 · AI cache tables ─────────────────────────────────────────────────
create table public.ai_insight_cache (
  user_id      uuid not null references public.users(id) on delete cascade,
  range        text not null check (range in ('yesterday', 'last_7d', 'last_30d', 'last_90d', 'ytd', 'this_month', 'last_month')),
  prefs_hash   text not null,
  data_hash    text not null,
  summary      text not null,
  generated_at timestamptz not null default now(),
  primary key (user_id, range)
);

-- Generic per-user KV documents; used today as the pulse-chips daily cache.
create table public.studio_records (
  user_id    uuid not null references public.users(id) on delete cascade,
  kind       text not null,          -- e.g. pulse-chips
  id         text not null,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, id)
);

-- ── 6 · Indexes ─────────────────────────────────────────────────────────
create index connected_accounts_user_id_idx            on public.connected_accounts (user_id);
create index ad_accounts_connected_account_id_idx      on public.ad_accounts (connected_account_id);
create index selected_metrics_connected_account_id_idx on public.selected_metrics (connected_account_id);
create index studio_records_recent_idx                 on public.studio_records (user_id, kind, updated_at desc);

-- ── 7 · RLS: deny-all to the anon key (the app uses the service key) ────
alter table public.users              enable row level security;
alter table public.workspaces         enable row level security;
alter table public.workspace_members  enable row level security;
alter table public.connected_accounts enable row level security;
alter table public.ad_accounts        enable row level security;
alter table public.selected_metrics   enable row level security;
alter table public.ai_insight_cache   enable row level security;
alter table public.studio_records     enable row level security;

-- ── 8 · First account ───────────────────────────────────────────────────
-- No seed user needed: create the operator account from the login page
-- ("Create the account"), optionally restricted via ALLOWED_LOGIN_EMAILS.
-- The app bootstraps its single workspace on the first write.
