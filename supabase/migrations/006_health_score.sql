-- A-IT Client Manager — Customer health score migration
--
-- Run this once, in full, AFTER 005_contracts.sql is already applied.
-- Adds the composite health score the daily health-score scheduled
-- function computes for every active client — see
-- netlify/functions/lib/healthScore.js for the scoring logic and
-- netlify/functions/health-score.js for the job that writes these.

alter table public.clients
  add column health_score integer check (health_score is null or (health_score >= 0 and health_score <= 100)),
  add column health_score_label text
    check (health_score_label is null or health_score_label in ('Healthy', 'Watch', 'At risk', 'Critical')),
  add column health_score_factors jsonb,
  add column health_score_computed_at timestamptz;

-- Powers the Dashboard's "At-risk clients" panel — only clients that
-- have ever been scored and are below the healthy band are queried.
create index clients_health_score_idx on public.clients (health_score) where health_score is not null;
