-- A-IT Client Manager — physical mailer tracking migration
--
-- Run this once, in full, AFTER 013_registered_address.sql is already
-- applied. Adds mailer_sent_at to sales_opportunities: set when a team
-- member ticks "I've sent a mailer" in the opportunity drawer, cleared
-- when unticked. Purely a manual record — nothing in this app sends,
-- schedules, or tracks delivery of physical mail; this just lets the
-- team note that a postal mailer went out to this lead, independent
-- of (and unrelated to) the existing email outreach tracking.

alter table public.sales_opportunities
  add column mailer_sent_at timestamptz;
