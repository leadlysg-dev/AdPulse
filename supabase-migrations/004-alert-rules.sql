-- Migration 004: alert rules created by the AI assistant.
-- Run this once in the Supabase SQL editor before deploying the assistant.
--
-- One row per rule, tied to the user (cascade-deleted with the account).
-- The check constraints mirror the assistant's strict tool schema, so an
-- invalid rule can never be written. description is the plain-English
-- snapshot shown in the My Alerts list, e.g. "Meta CPA falls below $10 in
-- a day".
--
-- Note: this migration only stores rules. Checking them on a schedule and
-- delivering notifications is a separate follow-up step - the app has no
-- scheduled job or notification channel yet.

create table public.alert_rules (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  metric      text not null check (metric in ('cpa', 'roas', 'spend', 'ctr', 'conversions')),
  channel     text not null default 'all' check (channel in ('meta', 'google', 'all')),
  comparison  text not null check (comparison in ('below', 'above')),
  threshold   numeric not null,
  timeframe   text not null default 'day' check (timeframe in ('day', 'week', 'month')),
  enabled     boolean not null default true,
  description text not null,
  created_at  timestamptz not null default now()
);

-- Lock down for the public anon key, same as every other table; the
-- functions' secret key bypasses RLS.
alter table public.alert_rules enable row level security;

create index alert_rules_user_id_idx on public.alert_rules (user_id);
