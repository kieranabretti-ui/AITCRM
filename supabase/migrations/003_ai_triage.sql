-- A-IT Client Manager — AI triage (Phase 2) migration
--
-- Run this once, in full, AFTER 002_support_desk.sql is already applied.
-- Adds: settings (admin-configurable knobs, owner-write/team-read) and
-- ai_audit_log (every AI decision, for review and debugging).

-- ---------------------------------------------------------------
-- settings — small key/value store for admin-configurable behaviour.
-- One flexible table instead of five single-purpose ones; each key's
-- shape is documented where it's read (see netlify/functions/lib).
-- ---------------------------------------------------------------
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

-- Only an owner can change automation behaviour — mirrors the
-- profiles-updatable-by-owners policy in the base schema.
create policy "settings writable by owners"
  on public.settings for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner'));

-- Sane defaults so the bot behaves sensibly before anyone visits the
-- admin settings page. All editable there afterwards.
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

-- ---------------------------------------------------------------
-- ai_audit_log — every AI decision, for review and debugging.
-- Written only by server-side functions (service_role, bypasses RLS);
-- team members can read it. No customer-message content is stored
-- here, only the decision (see spec: minimal sensitive data).
-- ---------------------------------------------------------------
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
