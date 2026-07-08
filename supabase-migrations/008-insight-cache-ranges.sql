-- Migration 008: allow the new date ranges in the AI insight cache.
-- Run this once in the Supabase SQL editor.
--
-- The Reporting rebuild adds yesterday / last 90 days / year-to-date range
-- presets. The ai_insight_cache table's range column has a CHECK constraint
-- listing the old four; without this migration, insight caching for the new
-- ranges fails (the code degrades gracefully and just skips caching, but
-- every view then costs an Anthropic call).

alter table public.ai_insight_cache
  drop constraint if exists ai_insight_cache_range_check;

alter table public.ai_insight_cache
  add constraint ai_insight_cache_range_check
  check (range in ('yesterday', 'last_7d', 'last_30d', 'last_90d', 'ytd', 'this_month', 'last_month'));
