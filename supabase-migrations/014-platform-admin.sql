-- Migration 014: platform admin (agency-access spec).
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- Adds: user_roles (platform_admin), admin_sessions (logged "enter
-- workspace" visits), audit_log, an 'agency' member role for Leadly
-- teammates inside client workspaces, invite links that carry their
-- intended role and expire after 7 days, and a per-workspace Managed-mode
-- flag. Bootstraps kennethtay1993@gmail.com as the first platform admin.

-- Platform-level roles, separate from per-workspace membership roles.
create table if not exists public.user_roles (
  user_id    uuid primary key references public.users(id) on delete cascade,
  role       text not null check (role in ('platform_admin')),
  created_at timestamptz not null default now()
);

-- Every admin visit into a client workspace is a logged session.
create table if not exists public.admin_sessions (
  id            bigint generated always as identity primary key,
  admin_user_id uuid not null references public.users(id) on delete cascade,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz
);

-- Admin/owner actions worth keeping a paper trail for.
create table if not exists public.audit_log (
  id            bigint generated always as identity primary key,
  actor_user_id uuid references public.users(id),
  action        text not null,
  workspace_id  uuid references public.workspaces(id),
  detail        jsonb,
  created_at    timestamptz not null default now()
);

-- Member roles: owner (the client business), agency (Leadly teammates),
-- client/member (invited read-mostly users; both behave identically).
alter table public.workspace_members drop constraint if exists workspace_members_role_check;
alter table public.workspace_members
  add constraint workspace_members_role_check check (role in ('owner', 'agency', 'client', 'member'));

-- Invites carry the role they grant and now expire after 7 days (or first
-- use). Existing unused invites keep their original expiry.
alter table public.workspace_invites
  add column if not exists role text not null default 'client'
    check (role in ('owner', 'agency', 'client', 'member'));
alter table public.workspace_invites alter column expires_at set default now() + interval '7 days';

-- Managed mode: Leadly runs the campaigns; clients get read-mostly controls.
alter table public.workspaces add column if not exists managed boolean not null default true;

-- Bootstrap the first platform admin.
insert into public.user_roles (user_id, role)
  select id, 'platform_admin' from public.users where email = 'kennethtay1993@gmail.com'
  on conflict do nothing;

-- RLS: deny-all to the anon key (the app talks through the service key).
alter table public.user_roles     enable row level security;
alter table public.admin_sessions enable row level security;
alter table public.audit_log      enable row level security;
