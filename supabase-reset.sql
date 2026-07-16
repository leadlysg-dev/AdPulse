-- ═══════════════════════════════════════════════════════════════════════
-- LEADLY PULSE — FULL RESET
-- Drops every app table and rebuilds the schema from scratch: the base
-- schema with migrations 001–011 already folded in, plus a bootstrap owner
-- account (signup is invite-only, so a wiped database would otherwise be
-- unenterable).
--
-- ⚠ DESTRUCTIVE ON PURPOSE. Running this deletes all app data.
-- Paste the whole file into the Supabase SQL editor and run it once.
-- ═══════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── 1 · Drop everything ─────────────────────────────────────────────────
drop table if exists public.workspace_invites  cascade;
drop table if exists public.change_requests    cascade;
drop table if exists public.workspace_members  cascade;
drop table if exists public.studio_records     cascade;
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

-- ── 3 · Workspaces (multi-tenant, invite-only) ─────────────────────────
create table public.workspaces (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  billing_exempt  boolean not null default false,
  tracked_metrics jsonb,                        -- ids the Pulse tab keeps an eye on
  created_at      timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  role         text not null check (role in ('owner', 'client')),
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.workspace_invites (
  token        text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by   uuid not null references public.users(id) on delete cascade,
  used_by      uuid references public.users(id),
  used_at      timestamptz,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '14 days'
);

create table public.change_requests (
  id           bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  requested_by uuid not null references public.users(id),
  request      text not null,
  entity_type  text,
  entity_id    text,
  action       text,
  value        text,
  status       text not null default 'open',   -- open | done | dismissed
  created_at   timestamptz not null default now()
);

-- ── 4 · Ad connections ─────────────────────────────────────────────────
create table public.connected_accounts (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references public.users(id) on delete cascade,
  -- 'gbp' included: the original schema predated Google Business Profile
  provider               text not null check (provider in ('meta', 'google', 'gbp')),
  access_token           text,
  refresh_token          text,
  selected_ad_account_id text,
  selected_sc_site_url   text,
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

create table public.sc_properties (
  id                   bigint generated always as identity primary key,
  connected_account_id uuid not null references public.connected_accounts(id) on delete cascade,
  site_url             text not null,
  permission           text,
  position             int not null default 0,
  unique (connected_account_id, site_url)
);

-- ── 5 · AI + alerts + audit + studio ───────────────────────────────────
create table public.ai_insight_cache (
  user_id      uuid not null references public.users(id) on delete cascade,
  range        text not null check (range in ('yesterday', 'last_7d', 'last_30d', 'last_90d', 'ytd', 'this_month', 'last_month')),
  prefs_hash   text not null,
  data_hash    text not null,
  summary      text not null,
  generated_at timestamptz not null default now(),
  primary key (user_id, range)
);

create table public.alert_rules (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  metric       text not null check (metric in ('cpa', 'roas', 'spend', 'ctr', 'conversions')),
  channel      text not null default 'all' check (channel in ('meta', 'google', 'all')),
  comparison   text not null check (comparison in ('below', 'above')),
  threshold    numeric not null,
  timeframe    text not null default 'day' check (timeframe in ('day', 'week', 'month')),
  enabled      boolean not null default true,
  description  text not null,
  workspace_id uuid references public.workspaces(id),
  created_at   timestamptz not null default now()
);

create table public.ad_change_log (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.users(id) on delete cascade,
  channel     text not null,
  account_id  text not null,
  entity_type text not null,
  entity_id   text not null,
  entity_name text,
  action      text not null,
  old_value   text,
  new_value   text,
  api_result  text,
  created_at  timestamptz not null default now()
);

create table public.studio_records (
  user_id    uuid not null references public.users(id) on delete cascade,
  kind       text not null,          -- job | chain | motion | upload | doc | brand | pulse-chips | automations
  id         text not null,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, id)
);

-- ── 6 · Indexes ─────────────────────────────────────────────────────────
create index connected_accounts_user_id_idx           on public.connected_accounts (user_id);
create index ad_accounts_connected_account_id_idx     on public.ad_accounts (connected_account_id);
create index selected_metrics_connected_account_id_idx on public.selected_metrics (connected_account_id);
create index sc_properties_connected_account_id_idx   on public.sc_properties (connected_account_id);
create index alert_rules_user_id_idx                  on public.alert_rules (user_id);
create index ad_change_log_user_id_idx                on public.ad_change_log (user_id, created_at desc);
create index studio_records_recent_idx                on public.studio_records (user_id, kind, updated_at desc);

-- ── 7 · RLS: deny-all to the anon key (the app uses the service key) ────
alter table public.users              enable row level security;
alter table public.workspaces         enable row level security;
alter table public.workspace_members  enable row level security;
alter table public.workspace_invites  enable row level security;
alter table public.change_requests    enable row level security;
alter table public.connected_accounts enable row level security;
alter table public.ad_accounts        enable row level security;
alter table public.selected_metrics   enable row level security;
alter table public.sc_properties      enable row level security;
alter table public.ai_insight_cache   enable row level security;
alter table public.alert_rules        enable row level security;
alter table public.ad_change_log      enable row level security;
alter table public.studio_records     enable row level security;

create policy workspaces_member_read on public.workspaces for select
  using (id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
create policy members_self_read on public.workspace_members for select
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
create policy change_requests_member_read on public.change_requests for select
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));

-- ── 8 · Bootstrap: your owner account + the agency workspace ────────────
-- Signup is invite-only and Google sign-in only accepts EXISTING accounts,
-- so the wiped database needs its first user seeded here. The password hash
-- is valid-shaped but unusable - sign in with Google, then set a real
-- password from Settings if you want one.
do $$
declare uid uuid; ws uuid;
begin
  insert into public.users (email, password_hash, password_set_at)
  values (
    'kennethtay1993@gmail.com',
    '00000000000000000000000000000000:' || repeat('0', 128),
    null
  )
  returning id into uid;

  insert into public.workspaces (name, billing_exempt)
  values ('Leadly (Agency)', true)
  returning id into ws;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws, uid, 'owner');
end $$;

-- ── 9 · See the result ──────────────────────────────────────────────────
select w.name as workspace, w.billing_exempt, u.email, m.role
from public.workspaces w
join public.workspace_members m on m.workspace_id = w.id
join public.users u on u.id = m.user_id;
