-- A-IT Client Manager — Contract management migration
--
-- Run this once, in full, AFTER 004_ai_copilot.sql is already applied.
-- Adds contract terms directly to clients — one client, one live
-- contract, same pattern as tier/device_count/sla_addon already there.
-- (Signed contract PDF uploads are a separate thing — see
-- client_contracts in the base schema; this is the commercial terms
-- data, not the file.)

alter table public.clients
  add column contract_start_date date,
  add column contract_renewal_date date,
  add column notice_period_days integer,
  add column contract_value_annual numeric(12, 2),
  add column services_included jsonb not null default '[]'::jsonb,
  add column price_increase_pct numeric(5, 2),
  add column auto_renewal boolean not null default true,
  add column contract_sla_terms text default '';

-- Powers the Dashboard's renewal-warning panel and the health score's
-- renewal-proximity factor — only active clients with a renewal date
-- in the future are ever queried by either.
create index clients_contract_renewal_date_idx on public.clients (contract_renewal_date)
  where contract_renewal_date is not null;
