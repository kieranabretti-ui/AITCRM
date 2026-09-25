-- A-IT Client Manager — outreach email tracking migration
--
-- Run this once, in full, AFTER 009_client_website.sql is already
-- applied. Records when an AI-drafted outreach email (see
-- lib/salesAssistant.js + netlify/functions/send-outreach-email.js)
-- was actually sent for an opportunity, and exactly what was sent —
-- kept on the opportunity itself rather than only in client_activity
-- so the Sales page can show "sent" state and block an accidental
-- silent resend without a round trip to the activity log.

alter table public.sales_opportunities
  add column outreach_sent_at timestamptz,
  add column outreach_sent_to text,
  add column outreach_sent_subject text,
  add column outreach_sent_body text;
