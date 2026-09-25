-- A-IT Client Manager — reply tracking / follow-up cadence migration
--
-- Run this once, in full, AFTER 011_form_submissions.sql is already
-- applied. Adds replied_at to sales_opportunities: set when a team
-- member ticks "They've replied" in the opportunity drawer, cleared
-- automatically whenever a new outreach email is sent (see
-- send-outreach-email.js — a fresh send starts a fresh cadence).
--
-- This is what isFollowUpDue() in lib/sales.js checks, alongside
-- outreach_sent_at, to flag an opportunity as due a follow-up once
-- FOLLOW_UP_DUE_DAYS have passed with no reply marked — a visual flag
-- only. Nothing in this app sends a follow-up on its own; a human
-- still drafts (or redrafts) and clicks Send every time.

alter table public.sales_opportunities
  add column replied_at timestamptz;
