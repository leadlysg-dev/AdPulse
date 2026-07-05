-- Migration 001: optional cost-per-result goal per tracked metric.
-- Run this in the Supabase SQL editor if you already created the tables
-- from supabase-schema.sql before this column existed. (Fresh installs
-- running the current supabase-schema.sql don't need it.)

alter table public.selected_metrics
  add column if not exists target_cost_per numeric;
