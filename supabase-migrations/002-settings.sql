-- Migration 002: Settings page - password provenance + AI preferences.
-- Run this once in the Supabase SQL editor before deploying the Settings page.
--
-- password_set_at: when the user last set a password themselves. Accounts
-- auto-created by "Sign in with Google" get a random placeholder password
-- hash, and this column is how the Settings page tells "Change password"
-- (set) from "Set password" (null). The backfill marks every existing
-- account as having set its password at signup - the safe default, since
-- the alternative would let a session holder replace an email user's
-- password without knowing the current one. If you know a specific existing
-- account was created via Google sign-in only, null its row by hand:
--   update public.users set password_set_at = null where email = '...';
--
-- ai_prefs: the AI feature preferences from the Settings page, as one JSON
-- object so future preference fields don't need further migrations.

alter table public.users
  add column if not exists password_set_at timestamptz,
  add column if not exists ai_prefs jsonb;

update public.users
  set password_set_at = created_at
  where password_set_at is null;
