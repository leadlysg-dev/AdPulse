-- Migration 003: cached AI insight summary per user.
-- Run this once in the Supabase SQL editor before deploying the AI insights
-- feature.
--
-- Holds the most recent Claude-generated performance summary as one JSON
-- object: { periodKey, prefsHash, summary, generatedAt }. The get-ai-insights
-- function returns this cache for repeat visits in the same period, so the
-- Anthropic API is only called when a fresh period starts, preferences
-- change, or the user explicitly refreshes (rate-limited server-side).

alter table public.users
  add column if not exists ai_insight jsonb;
