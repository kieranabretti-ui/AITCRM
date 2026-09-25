-- A-IT Client Manager — form submissions audit trail migration
--
-- Run this once, in full, AFTER 010_outreach_email.sql is already
-- applied. Records every request dorset-lead-webhook.js receives —
-- not just the ones that successfully become a lead. Before this,
-- a misconfigured secret, a payload-shape mismatch, or any other
-- failure meant a form submission just vanished with nothing to see
-- anywhere in the app — the only way to know something arrived (or
-- didn't, or why not) was Netlify's own function logs, which aren't
-- visible from here. This table makes every attempt visible on the
-- new Form Submissions page instead.

create table public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'dorset-it-support',
  -- 'lead_created': became a client + opportunity, same as before.
  -- 'skipped': recognised as not-this-form, or missing the basics
  --            needed to create a lead — not an error, just not actionable.
  -- 'error':   auth failure, unparsable body, or a database error —
  --            these are the ones actually worth investigating.
  status text not null check (status in ('lead_created', 'skipped', 'error')),
  status_detail text not null default '',
  -- Pulled out of raw_payload for the list view, whatever shape the
  -- payload happened to arrive in — see extractLeadData() in
  -- dorset-lead-webhook.js. Empty when the body couldn't be parsed
  -- at all.
  submitted_name text not null default '',
  submitted_email text not null default '',
  submitted_company text not null default '',
  -- The full payload as received, for anyone who needs more than the
  -- three fields above — e.g. confirming exactly what shape aitmsp's
  -- relay-lead.js actually sent.
  raw_payload jsonb not null default '{}'::jsonb,
  client_id uuid references public.clients (id) on delete set null,
  received_at timestamptz not null default now()
);

create index form_submissions_received_at_idx on public.form_submissions (received_at desc);

alter table public.form_submissions enable row level security;

-- Read-only from the app's side — every row here is written by
-- dorset-lead-webhook.js using the service-role key, which bypasses
-- RLS entirely (the same pattern clients/sales_opportunities already
-- rely on for that function). No insert/update/delete policy is
-- needed or intended for signed-in team members; this is an audit
-- trail, not something anyone edits by hand.
create policy "form submissions readable by team members"
  on public.form_submissions for select to authenticated
  using (public.is_team_member());
