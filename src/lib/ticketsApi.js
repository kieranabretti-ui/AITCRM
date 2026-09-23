import { supabase } from './supabase.js'

// Tickets are a synced summary of Jira issues (see jira-webhook.js) —
// this module only ever reads them and adjusts the CRM-side fields
// (client link, assignment). Status/priority/content stay Jira's.

export async function fetchTicketsForClient(clientId) {
  const { data, error } = await supabase
    .from('tickets')
    .select('*')
    .eq('client_id', clientId)
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
    .order('created_at', { ascending: false })
    .limit(200)
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
