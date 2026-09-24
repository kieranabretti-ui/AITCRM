-- A-IT Client Manager — AI next-action suggestions migration
--
-- Run this once, in full, AFTER 007_sales_pipeline.sql is already
-- applied. Adds the single most useful next action the health-score
-- scheduled function suggests per client — see
-- netlify/functions/lib/nextAction.js for the (deterministic,
-- explainable) logic and netlify/functions/health-score.js for the
-- job that writes these, now scoring onboarding clients too, not just
-- active ones.

alter table public.clients
  add column next_action text,
  add column next_action_priority text
    check (next_action_priority is null or next_action_priority in ('low', 'medium', 'high')),
  add column next_action_computed_at timestamptz;
