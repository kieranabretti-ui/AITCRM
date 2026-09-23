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

// Fetches one ticket fresh — used when opening TicketDrawer from a row
// that only carries a partial projection (e.g. the escalations list's
// embedded join), so the drawer always shows the full current record.
export async function fetchTicketById(ticketId) {
  const { data, error } = await supabase.from('tickets').select('*').eq('id', ticketId).single()
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

// --- AI copilot: human-override actions --------------------------
//
// Everything below is a normal RLS-protected write any team member can
// make directly (tickets/ai_audit_log are both team-writable — see
// migrations 002/004) — no service-role function needed, same as
// linkTicketToClient above. The two exceptions (requesting a fresh
// analysis, approving a draft reply) need the Jira/Claude service
// credentials and go through their own Netlify Functions instead.

// The copilot's own chronological activity for one ticket — what the
// CRM's "AI Activity" timeline reads from.
export async function fetchTicketActivity(ticketId) {
  const { data, error } = await supabase
    .from('ai_audit_log')
    .select('*')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) throw error
  return data
}

// Disable/re-enable AI analysis for one ticket — the per-ticket
// counterpart to the global "AI support bot enabled" switch in admin
// settings. jira-webhook.js and sla-check.js both check this before
// running an analysis.
export async function setAiDisabledForTicket(ticketId, disabled) {
  const { error } = await supabase.from('tickets').update({ ai_disabled: disabled }).eq('id', ticketId)
  if (error) throw error
}

// Overriding severity/category also locks it — otherwise the next AI
// analysis would silently write straight over the technician's own
// call (see lib/copilot.js's severity_locked/category_locked guard).
export async function overrideSeverity(ticketId, severity) {
  const { error } = await supabase.from('tickets').update({ severity, severity_locked: true }).eq('id', ticketId)
  if (error) throw error
}

export async function overrideCategory(ticketId, category) {
  const { error } = await supabase.from('tickets').update({ category, category_locked: true }).eq('id', ticketId)
  if (error) throw error
}

// Hand override control back to the AI.
export async function unlockSeverity(ticketId) {
  const { error } = await supabase.from('tickets').update({ severity_locked: false }).eq('id', ticketId)
  if (error) throw error
}

export async function unlockCategory(ticketId) {
  const { error } = await supabase.from('tickets').update({ category_locked: false }).eq('id', ticketId)
  if (error) throw error
}

// Dismiss / mark incorrect / mark completed on one AI audit log entry
// (a specific past recommendation) — purely a record of the human
// decision, per the spec's audit-log requirement.
export async function recordHumanDecision(auditLogId, decision, userId) {
  const { error } = await supabase
    .from('ai_audit_log')
    .update({ human_decision: decision, human_decision_by: userId, human_decision_at: new Date().toISOString() })
    .eq('id', auditLogId)
  if (error) throw error
}

// Dismissing a pending draft reply needs no Jira call — nothing was
// ever sent, so this is a pure CRM-side write, unlike approving one.
export async function dismissDraftReply(ticketId) {
  const { error } = await supabase.from('tickets').update({ ai_draft_reply_status: 'dismissed' }).eq('id', ticketId)
  if (error) throw error
}

async function callFunction(path, body, accessToken) {
  const res = await fetch(`/.netlify/functions/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'Something went wrong.')
  return json
}

// Bypasses the relevance check and comment cooldown to force an
// immediate re-analysis — needs the Claude/Jira service credentials,
// so it's a Netlify Function rather than a direct table write.
export async function requestAiAnalysis(ticketId, accessToken) {
  return callFunction('request-ai-analysis', { ticketId }, accessToken)
}

// Posts the ticket's pending AI-drafted reply to the customer via the
// Jira service account — the one path (besides full auto-send for the
// safest tier) by which a drafted reply actually reaches the customer.
export async function approveDraftReply(ticketId, accessToken) {
  return callFunction('approve-draft-reply', { ticketId }, accessToken)
}
