-- A-IT Client Manager — Support Desk (Jira integration) migration
--
-- Run this once, in full, in your Supabase project's SQL Editor, AFTER
-- the base schema.sql is already applied (this is an additive migration
-- for an already-live database — it does not touch clients/profiles/etc).
--
-- Adds: tickets, client_email_domains, jira_customer_mappings,
-- webhook_events. Jira remains the source of truth for ticket status and
-- conversation; these tables are a synced summary plus the data needed
-- for customer matching and webhook idempotency.

-- ---------------------------------------------------------------
-- tickets — synced representation of Jira Service Management issues
-- ---------------------------------------------------------------
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

-- ---------------------------------------------------------------
-- client_email_domains — approved domains per client, for priority-2
-- customer matching (a client may have more than one domain).
-- ---------------------------------------------------------------
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

-- ---------------------------------------------------------------
-- jira_customer_mappings — remembered requester -> client links, so a
-- manual match (or an automatic one) is never re-asked for.
-- ---------------------------------------------------------------
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

-- ---------------------------------------------------------------
-- webhook_events — dedup log for inbound Jira webhooks. Written only
-- by the jira-webhook function (service_role, bypasses RLS below);
-- team members can read it to debug sync issues.
-- ---------------------------------------------------------------
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
