-- Migration 011: multi-tenant workspaces (invite-only client access).
-- Run this once in the Supabase SQL editor. Safe to re-run.
--
-- Model: a workspace owns the ad connections; users belong to workspaces as
-- 'owner' (the agency) or 'client' (invited, read-mostly). Clients never
-- OAuth - their workspace's data flows through the agency's connections.
-- The backfill folds everything that exists today into one "Leadly (Agency)"
-- workspace with every current user as an owner.

create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  billing_exempt boolean not null default false,
  created_at     timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  role         text not null check (role in ('owner', 'client')),
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- Single-use invite links, minted by an owner for one workspace.
create table if not exists public.workspace_invites (
  token        text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by   uuid not null references public.users(id) on delete cascade,
  used_by      uuid references public.users(id),
  used_at      timestamptz,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '14 days'
);

-- "Ask Pulse to request a change": what a client asked for, awaiting the owner.
create table if not exists public.change_requests (
  id           bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  requested_by uuid not null references public.users(id),
  request      text not null,
  entity_type  text,
  entity_id    text,
  action       text,
  value        text,
  status       text not null default 'open',  -- open | done | dismissed
  created_at   timestamptz not null default now()
);

-- Scope the data tables to a workspace. ad_accounts and selected_metrics are
-- children of connected_accounts, but they carry the column too so RLS can
-- check each row directly.
alter table public.connected_accounts add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.ad_accounts        add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.selected_metrics   add column if not exists workspace_id uuid references public.workspaces(id);
alter table public.alert_rules        add column if not exists workspace_id uuid references public.workspaces(id);

-- Backfill: one agency workspace, every existing user an owner of it, and
-- every existing connection/metric/alert scoped to it.
do $$
declare ws uuid;
begin
  select id into ws from public.workspaces where name = 'Leadly (Agency)' limit 1;
  if ws is null then
    insert into public.workspaces (name, billing_exempt) values ('Leadly (Agency)', true) returning id into ws;
  end if;
  insert into public.workspace_members (workspace_id, user_id, role)
    select ws, id, 'owner' from public.users
    on conflict do nothing;
  update public.connected_accounts set workspace_id = ws where workspace_id is null;
  update public.ad_accounts ad set workspace_id = ws where ad.workspace_id is null;
  update public.selected_metrics sm set workspace_id = ws where sm.workspace_id is null;
  update public.alert_rules set workspace_id = ws where workspace_id is null;
end $$;

-- RLS: deny-all to the anon key (the app talks through the service key,
-- which bypasses these); membership-scoped reads for any future
-- authenticated direct access.
alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.change_requests   enable row level security;

drop policy if exists workspaces_member_read on public.workspaces;
create policy workspaces_member_read on public.workspaces for select
  using (id in (select workspace_id from public.workspace_members where user_id = auth.uid()));

drop policy if exists members_self_read on public.workspace_members;
create policy members_self_read on public.workspace_members for select
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));

drop policy if exists change_requests_member_read on public.change_requests;
create policy change_requests_member_read on public.change_requests for select
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
