-- Migration 012: workspace-level tracked metrics.
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- Which numbers this workspace keeps an eye on - drives the Pulse KPI
-- cards and both tabs' table columns. JSON array of metric ids, e.g.
-- ["spend","enquiries","cpe","event:offsite_conversion.custom.123"].
alter table public.workspaces
  add column if not exists tracked_metrics jsonb;
