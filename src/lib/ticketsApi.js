import { supabase } from './supabase.js'

// Tickets are a synced summary of Jira issues (see jira-webhook.js) —
// this module only ever reads them and adjusts the CRM-side fields
// (client link, assignment). Status/priority/content stay Jira's.

// Active only (resolved_at is null) — completed tickets are stowed away
// rather than cluttering the customer's live support view. Jira remains
// the full historical record for anyone who needs to look one up.
export async function fetchTicketsForClient(clientId) {
  const { data, error } = await supabase
    .from('tickets')
    .select('*')
    .eq('client_id', clientId)
    .is('resolved_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function fetchUnmatchedTickets() {
  const { data, error } = await supabase
    .from('tickets')
    .select('*')
    .in('match_status', ['unmatched', 'ambiguous'])
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function fetchOpenTickets() {
  const { data, error } = await supabase
    .from('tickets')
    .select('*')
    .is('resolved_at', null)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error
  return data
}

// The archive counterpart to fetchOpenTickets — everything stowed away
// from the live views, most recently closed first.
export async function fetchClosedTickets() {
  const { data, error } = await supabase
    .from('tickets')
    .select('*')
    .not('resolved_at', 'is', null)
    .order('resolved_at', { ascending: false })
    .limit(500)
  if (error) throw error
  return data
}

// Only escalations for tickets that are still open — once a ticket is
// resolved, its past escalation isn't something anyone needs to act on
// anymore. `!inner` turns the embed into an inner join so the
// resolved_at filter on the joined ticket actually excludes rows,
// rather than just nulling out the nested object.
export async function fetchRecentEscalations() {
  const { data, error } = await supabase
    .from('ai_audit_log')
    .select('id, ticket_id, decision, severity, category, confidence, action_taken, escalation_reason, created_at, tickets!inner(summary, jira_issue_key, jira_url, client_id, resolved_at)')
    .eq('escalated', true)
    .is('tickets.resolved_at', null)
    .order('created_at', { ascending: false })
    .limit(10)
  if (error) throw error
  return data
}

// Manual "link this Jira ticket to a client" action — a normal
// RLS-protected write any team member can do (no service-role
// escalation needed, unlike jira-webhook.js which has no user
// session to run under). Also remembers the mapping so the next
// ticket from this requester matches automatically.
export async function linkTicketToClient(ticket, clientId, userId) {
  const { error: updateError } = await supabase
    .from('tickets')
    .update({ client_id: clientId, match_status: 'matched', updated_at: new Date().toISOString() })
    .eq('id', ticket.id)
  if (updateError) throw updateError

  if (ticket.requester_email) {
    const { error: mapError } = await supabase
      .from('jira_customer_mappings')
      .upsert(
        { jira_email: ticket.requester_email.toLowerCase(), client_id: clientId, created_by: userId },
        { onConflict: 'jira_email' },
      )
    if (mapError) throw mapError
  }
}
