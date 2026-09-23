-- A-IT Client Manager — AI service-desk copilot migration
--
-- Run this once, in full, AFTER 003_ai_triage.sql is already applied.
-- Extends the existing AI triage into a continuous, lifecycle-long
-- technical copilot: it adds the AI's "current understanding" of each
-- ticket (for the CRM's ticket view), the human-override locks that
-- stop the bot silently re-overwriting a technician's own judgement,
-- and the richer audit trail the copilot's activity log reads from.
--
-- Nothing here changes who Jira trusts (still the dedicated service
-- account) or how RLS gates writes (still is_team_member()/owner()).

-- ---------------------------------------------------------------
-- tickets — the AI's current understanding, plus human-override locks
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

-- ai_disabled tickets are exactly the ones a human has asked the
-- copilot to leave alone — worth its own index since the webhook
-- checks it on every relevant event.
create index tickets_ai_disabled_idx on public.tickets (ai_disabled) where ai_disabled;

-- ---------------------------------------------------------------
-- ai_audit_log — trigger, full structured analysis, and the human
-- decision (if any) alongside the automated one, so this one table
-- serves both the audit trail and the CRM's per-ticket "AI Activity".
-- ---------------------------------------------------------------
alter table public.ai_audit_log
  add column trigger_event text,
  add column analysis jsonb,
  add column jira_modified boolean not null default false,
  add column human_approval_required boolean not null default false,
  add column human_decision text
    check (human_decision is null or human_decision in ('approved', 'dismissed', 'marked_incorrect', 'completed')),
  add column human_decision_by uuid references public.profiles (id) on delete set null,
  add column human_decision_at timestamptz;

-- Audit log rows were previously written only by service-role functions
-- (which bypass RLS). Human-override actions (dismiss / mark incorrect /
-- mark completed / approve a draft reply) now come from a signed-in
-- team member's own session, so they need a normal update policy —
-- scoped the same way as everything else in this app: any team member.
create policy "audit log updatable by team members"
  on public.ai_audit_log for update to authenticated
  using (public.is_team_member()) with check (public.is_team_member());
