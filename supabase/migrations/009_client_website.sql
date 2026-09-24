-- A-IT Client Manager — client website field migration
--
-- Run this once, in full, AFTER 008_next_actions.sql is already
-- applied. Adds a website URL to clients — used as the input for the
-- Sales page's website contact finder (see
-- netlify/functions/lib/websiteContactFinder.js) and generally useful
-- to have on file.

alter table public.clients
  add column website text default '';
