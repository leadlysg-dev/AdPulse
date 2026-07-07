-- Migration 007: manager (MCC) routing for Google Ads accounts.
-- Run this once in the Supabase SQL editor.
--
-- Google Ads accounts reached through a manager (MCC) account can only be
-- queried with a login-customer-id header naming that manager. The connect
-- flow now expands managers into their client accounts and records which
-- manager each account was reached through; this column stores it.
-- Accounts the user accesses directly keep their own id here, so the value
-- is always safe to send.
--
-- The code degrades gracefully if this hasn't run (it retries the save
-- without the column and logs a warning), but MCC-managed accounts won't
-- report data until it exists.

alter table public.ad_accounts
  add column if not exists login_customer_id text;
