-- A-IT Client Manager — Supabase schema
--
-- Run this once, in full, in your Supabase project's SQL Editor
-- (Project → SQL Editor → New query → paste this whole file → Run).
-- It's safe to run on a brand-new project; it creates everything from
-- scratch and enables Row Level Security throughout.
--
-- How accounts work:
--   The FIRST person to sign in (you) is made 'owner' automatically —
--   see handle_new_user() below. Everyone you invite after that lands
--   as 'staff'. Only 'owner' can invite/remove people and change roles;
--   both roles have full read/write on client records.

-- ---------------------------------------------------------------
-- profiles — one row per team member, extends auth.users
-- ---------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'staff' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Any signed-in team member can see who else is on the team.
create policy "profiles readable by team members"
  on public.profiles for select
  to authenticated
  using (true);

-- Only an owner can change someone's role (e.g. promote a colleague).
create policy "profiles updatable by owners"
  on public.profiles for update
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner'));

-- New auth.users rows are turned into profiles automatically. The
-- first-ever signup becomes 'owner'; everyone after is 'staff'.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (
    new.id,
    new.email,
    case when (select count(*) from public.profiles) = 0 then 'owner' else 'staff' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Shared helper: is the current request from a known team member?
create function public.is_team_member()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (select 1 from public.profiles where id = auth.uid());
$$;

-- ---------------------------------------------------------------
-- clients
-- ---------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  contact_name text default '',
  contact_email text default '',
  contact_phone text default '',
  secondary_contact_name text default '',
  secondary_contact_phone text default '',
  site_address text default '',
  tier text not null default 'gold' check (tier in ('silver', 'gold', 'platinum')),
  device_count integer not null default 0,
  sla_addon boolean not null default false,
  status text not null default 'lead' check (status in ('lead', 'onboarding', 'active', 'paused', 'churned')),
  start_date date,
  last_reviewed_date date,
  direct_debit boolean not null default false,
  platform text default '',
  on_site_server boolean not null default false,
  lead_source text default '',
  lead_source_detail text default '',
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id)
);

alter table public.clients enable row level security;

create policy "clients readable by team members"
  on public.clients for select to authenticated
  using (public.is_team_member());

create policy "clients writable by team members"
  on public.clients for insert to authenticated
  with check (public.is_team_member());

create policy "clients updatable by team members"
  on public.clients for update to authenticated
  using (public.is_team_member()) with check (public.is_team_member());

create policy "clients deletable by team members"
  on public.clients for delete to authenticated
  using (public.is_team_member());

-- ---------------------------------------------------------------
-- client_activity — dated log entries per client
-- ---------------------------------------------------------------
create table public.client_activity (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id)
);

alter table public.client_activity enable row level security;

create policy "activity readable by team members"
  on public.client_activity for select to authenticated
  using (public.is_team_member());

create policy "activity insertable by team members"
  on public.client_activity for insert to authenticated
  with check (public.is_team_member());

create policy "activity deletable by team members"
  on public.client_activity for delete to authenticated
  using (public.is_team_member());

-- ---------------------------------------------------------------
-- client_contracts — metadata for signed contracts; files live in
-- the "contracts" Storage bucket (created below) under
-- <client_id>/<uuid>-<filename>.
-- ---------------------------------------------------------------
create table public.client_contracts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  filename text not null,
  storage_path text not null,
  size_bytes bigint,
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid references auth.users (id)
);

alter table public.client_contracts enable row level security;

create policy "contracts readable by team members"
  on public.client_contracts for select to authenticated
  using (public.is_team_member());

create policy "contracts insertable by team members"
  on public.client_contracts for insert to authenticated
  with check (public.is_team_member());

create policy "contracts deletable by team members"
  on public.client_contracts for delete to authenticated
  using (public.is_team_member());

-- ---------------------------------------------------------------
-- Storage bucket for signed contract PDFs (private — access only via
-- the policies below, never a public URL)
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('contracts', 'contracts', false)
on conflict (id) do nothing;

create policy "contract files readable by team members"
  on storage.objects for select to authenticated
  using (bucket_id = 'contracts' and public.is_team_member());

create policy "contract files uploadable by team members"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'contracts' and public.is_team_member());

create policy "contract files deletable by team members"
  on storage.objects for delete to authenticated
  using (bucket_id = 'contracts' and public.is_team_member());

-- ---------------------------------------------------------------
-- Support desk (Jira Service Management integration) — see
-- supabase/migrations/002_support_desk.sql for the standalone version
-- of this block, used to upgrade an already-live database. New
-- projects get it in this same run.
-- ---------------------------------------------------------------

-- tickets — synced representation of Jira Service Management issues
create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  jira_issue_key text not null unique,
  jira_issue_id text not null,
  client_id uuid references public.clients (id) on delete set null,
  requester_email text default '',
  requester_name text default '',
  summary text default '',
  description text default '',
  category text default '',
  severity text check (severity in ('P1', 'P2', 'P3', 'P4')),
  jira_status text default '',
  sla_state text not null default 'not_applicable'
    check (sla_state in ('within_sla', 'at_risk', 'breached', 'not_applicable')),
  sla_due_at timestamptz,
  assigned_staff_id uuid references public.profiles (id) on delete set null,
  assigned_queue text default '',
  ai_classification jsonb,
  ai_confidence numeric check (ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 100)),
  match_status text not null default 'unmatched'
    check (match_status in ('matched', 'unmatched', 'ambiguous')),
  first_response_at timestamptz,
  resolved_at timestamptz,
  jira_url text default '',
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tickets_client_id_idx on public.tickets (client_id);
create index tickets_match_status_idx on public.tickets (match_status) where match_status <> 'matched';
create index tickets_jira_status_idx on public.tickets (jira_status);

alter table public.tickets enable row level security;

create policy "tickets readable by team members"
  on public.tickets for select to authenticated
  using (public.is_team_member());

create policy "tickets writable by team members"
  on public.tickets for insert to authenticated
  with check (public.is_team_member());

create policy "tickets updatable by team members"
  on public.tickets for update to authenticated
  using (public.is_team_member()) with check (public.is_team_member());

create policy "tickets deletable by team members"
  on public.tickets for delete to authenticated
  using (public.is_team_member());

-- client_email_domains — approved domains per client, for priority-2
-- customer matching (a client may have more than one domain).
create table public.client_email_domains (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  domain text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id)
);

-- A domain should resolve to exactly one client — case-insensitive.
create unique index client_email_domains_domain_idx on public.client_email_domains (lower(domain));

alter table public.client_email_domains enable row level security;

create policy "domains readable by team members"
  on public.client_email_domains for select to authenticated
  using (public.is_team_member());

create policy "domains writable by team members"
  on public.client_email_domains for insert to authenticated
  with check (public.is_team_member());

create policy "domains deletable by team members"
  on public.client_email_domains for delete to authenticated
  using (public.is_team_member());

-- jira_customer_mappings — remembered requester -> client links, so a
-- manual match (or an automatic one) is never re-asked for.
create table public.jira_customer_mappings (
  id uuid primary key default gen_random_uuid(),
  jira_account_id text,
  jira_email text,
  client_id uuid not null references public.clients (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id)
);

create unique index jira_customer_mappings_account_idx
  on public.jira_customer_mappings (jira_account_id) where jira_account_id is not null;
create unique index jira_customer_mappings_email_idx
  on public.jira_customer_mappings (lower(jira_email)) where jira_email is not null;

alter table public.jira_customer_mappings enable row level security;

create policy "mappings readable by team members"
  on public.jira_customer_mappings for select to authenticated
  using (public.is_team_member());

create policy "mappings writable by team members"
  on public.jira_customer_mappings for insert to authenticated
  with check (public.is_team_member());

create policy "mappings deletable by team members"
  on public.jira_customer_mappings for delete to authenticated
  using (public.is_team_member());

-- webhook_events — dedup log for inbound Jira webhooks. Written only
-- by the jira-webhook function (service_role, bypasses RLS below);
-- team members can read it to debug sync issues.
create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  jira_event_id text not null unique,
  jira_issue_key text,
  event_type text not null,
  status text not null default 'received'
    check (status in ('received', 'processed', 'failed', 'skipped')),
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index webhook_events_issue_key_idx on public.webhook_events (jira_issue_key);

alter table public.webhook_events enable row level security;

create policy "webhook events readable by team members"
  on public.webhook_events for select to authenticated
  using (public.is_team_member());

-- ---------------------------------------------------------------
-- AI triage (Phase 2) — see supabase/migrations/003_ai_triage.sql for
-- the standalone version used to upgrade an already-live database.
-- ---------------------------------------------------------------

-- settings — small key/value store for admin-configurable behaviour.
create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

alter table public.settings enable row level security;

create policy "settings readable by team members"
  on public.settings for select to authenticated
  using (public.is_team_member());

create policy "settings writable by owners"
  on public.settings for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner'));

insert into public.settings (key, value) values
  ('ai_enabled', 'true'),
  ('confidence_threshold', '{"high": 85, "medium": 50}'),
  ('sla_warning_minutes', '30'),
  ('max_automation_attempts', '2'),
  ('auto_responses_enabled', 'true'),
  ('escalation_queue', '"Escalation"'),
  ('routing_map', '{
    "Security": "Security",
    "Account & Access": "Security",
    "Microsoft 365": "Microsoft 365",
    "Backup": "Backup/Infrastructure",
    "Network": "Support",
    "Endpoint": "Support",
    "Hardware": "Support",
    "Software": "Support",
    "New User": "Support",
    "User Change": "Support",
    "Other": "Support"
  }')
on conflict (key) do nothing;

-- ai_audit_log — every AI decision, for review and debugging.
create table public.ai_audit_log (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references public.tickets (id) on delete cascade,
  created_at timestamptz not null default now(),
  decision text not null,
  severity text,
  category text,
  confidence numeric,
  action_taken text not null,
  customer_contacted boolean not null default false,
  escalated boolean not null default false,
  escalation_reason text
);

create index ai_audit_log_ticket_id_idx on public.ai_audit_log (ticket_id);
create index ai_audit_log_created_at_idx on public.ai_audit_log (created_at desc);

alter table public.ai_audit_log enable row level security;

create policy "audit log readable by team members"
  on public.ai_audit_log for select to authenticated
  using (public.is_team_member());

-- ---------------------------------------------------------------
-- AI service-desk copilot (Phase 3) — see
-- supabase/migrations/004_ai_copilot.sql for the standalone version of
-- this block, used to upgrade an already-live database. New projects
-- get it in this same run.
-- ---------------------------------------------------------------

alter table public.tickets
  add column ai_disabled boolean not null default false,
  add column severity_locked boolean not null default false,
  add column category_locked boolean not null default false,
  add column ai_confidence_label text check (ai_confidence_label in ('High', 'Medium', 'Low')),
  add column ai_summary text,
  add column ai_likely_cause text,
  add column ai_possible_causes jsonb not null default '[]'::jsonb,
  add column ai_recommended_action text,
  add column ai_recommended_steps jsonb not null default '[]'::jsonb,
  add column ai_evidence jsonb not null default '[]'::jsonb,
  add column ai_risk text check (ai_risk in ('Low', 'Medium', 'High')),
  add column ai_escalation_recommendation text not null default 'None'
    check (ai_escalation_recommendation in ('None', 'Technician', 'Senior Technician', 'Security Escalation')),
  add column ai_last_analysis_at timestamptz,
  add column ai_draft_reply text,
  add column ai_draft_reply_status text not null default 'none'
    check (ai_draft_reply_status in ('none', 'pending', 'sent', 'dismissed'));

create index tickets_ai_disabled_idx on public.tickets (ai_disabled) where ai_disabled;

alter table public.ai_audit_log
  add column trigger_event text,
  add column analysis jsonb,
  add column jira_modified boolean not null default false,
  add column human_approval_required boolean not null default false,
  add column human_decision text
    check (human_decision is null or human_decision in ('approved', 'dismissed', 'marked_incorrect', 'completed')),
  add column human_decision_by uuid references public.profiles (id) on delete set null,
  add column human_decision_at timestamptz;

create policy "audit log updatable by team members"
  on public.ai_audit_log for update to authenticated
  using (public.is_team_member()) with check (public.is_team_member());

-- ---------------------------------------------------------------
-- Contract management (Phase 4) — see
-- supabase/migrations/005_contracts.sql for the standalone version.
-- ---------------------------------------------------------------

alter table public.clients
  add column contract_start_date date,
  add column contract_renewal_date date,
  add column notice_period_days integer,
  add column contract_value_annual numeric(12, 2),
  add column services_included jsonb not null default '[]'::jsonb,
  add column price_increase_pct numeric(5, 2),
  add column auto_renewal boolean not null default true,
  add column contract_sla_terms text default '';

create index clients_contract_renewal_date_idx on public.clients (contract_renewal_date)
  where contract_renewal_date is not null;

-- ---------------------------------------------------------------
-- Customer health score (Phase 4) — see
-- supabase/migrations/006_health_score.sql for the standalone version.
-- ---------------------------------------------------------------

alter table public.clients
  add column health_score integer check (health_score is null or (health_score >= 0 and health_score <= 100)),
  add column health_score_label text
    check (health_score_label is null or health_score_label in ('Healthy', 'Watch', 'At risk', 'Critical')),
  add column health_score_factors jsonb,
  add column health_score_computed_at timestamptz;

create index clients_health_score_idx on public.clients (health_score) where health_score is not null;

-- ---------------------------------------------------------------
-- Sales pipeline (Phase 4) — see
-- supabase/migrations/007_sales_pipeline.sql for the standalone version.
-- ---------------------------------------------------------------

create table public.sales_opportunities (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  stage text not null default 'new'
    check (stage in ('new', 'qualified', 'proposal_sent', 'negotiation', 'won', 'lost')),
  estimated_value_annual numeric(12, 2),
  expected_close_date date,
  notes text default '',
  lost_reason text default '',
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
