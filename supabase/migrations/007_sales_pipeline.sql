-- A-IT Client Manager — Sales pipeline migration
--
-- Run this once, in full, AFTER 006_health_score.sql is already applied.
-- Adds sales_opportunities — pipeline-stage tracking layered on top of
-- clients (every opportunity belongs to a client record; a brand-new
-- prospect is simply a client created with status 'lead'), so contact
-- info, notes and activity all live in one place rather than a
-- parallel "prospect" entity.

create table public.sales_opportunities (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  stage text not null default 'new'
    check (stage in ('new', 'qualified', 'proposal_sent', 'negotiation', 'won', 'lost')),
  estimated_value_annual numeric(12, 2),
  expected_close_date date,
  notes text default '',
  lost_reason text default '',
  -- {subject, body, key_points[], follow_up_suggestion} — see
  -- lib/salesAssistant.js. Structured rather than plain text since the
  -- Sales page renders each part separately.
  ai_draft_message jsonb,
  ai_draft_generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id)
);

create index sales_opportunities_client_id_idx on public.sales_opportunities (client_id);
create index sales_opportunities_stage_idx on public.sales_opportunities (stage) where stage not in ('won', 'lost');

alter table public.sales_opportunities enable row level security;

create policy "opportunities readable by team members"
  on public.sales_opportunities for select to authenticated
  using (public.is_team_member());

create policy "opportunities writable by team members"
  on public.sales_opportunities for insert to authenticated
  with check (public.is_team_member());

create policy "opportunities updatable by team members"
  on public.sales_opportunities for update to authenticated
  using (public.is_team_member()) with check (public.is_team_member());

create policy "opportunities deletable by team members"
  on public.sales_opportunities for delete to authenticated
  using (public.is_team_member());
