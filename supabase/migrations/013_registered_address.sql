-- A-IT Client Manager — registered company details migration
--
-- Run this once, in full, AFTER 012_lead_replied.sql is already
-- applied. Adds two columns to clients:
--
--   company_number     the Companies House company number, when known
--                       (exact, official — set by the lead finder on
--                       import, or by the registered-address backfill
--                       tool for pre-existing leads)
--   registered_address  the registered office address Companies House
--                       has on file, formatted as a single line
--
-- These are deliberately separate from the existing site_address
-- column, which is a free-text field for where a client actually
-- trades/operates — the lead finder was previously writing the
-- registered office into site_address, which conflates the two and is
-- often wrong (many companies' registered office is their
-- accountant's address, not their trading premises). New leads now
-- get registered_address + company_number instead, and site_address
-- is left for a team member to fill in with the real trading address.

alter table public.clients
  add column company_number text,
  add column registered_address text;
