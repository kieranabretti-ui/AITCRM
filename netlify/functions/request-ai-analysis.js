// "Request another AI analysis" — a technician's manual override to
// get a fresh look at a ticket right now, bypassing the relevance
// check and comment cooldown (see lib/relevance.js, lib/copilot.js).
// Also the one way to force a re-analysis on a ticket that currently
// has ai_disabled set, since a human explicitly asking for one is a
// deliberate one-off exception to that switch, not a reason to ignore it.
//
// Required environment variables — same as jira-webhook.js/sla-check.js:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY,
//   JIRA_BASE_URL, JIRA_SERVICE_EMAIL, JIRA_API_TOKEN
const { createClient } = require('@supabase/supabase-js')
const { runAiAnalysis } = require('./lib/copilot.js')

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server is not configured (missing Supabase env vars).' }) }
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || ''
  const callerToken = authHeader.replace(/^Bearer\s+/i, '')
  if (!callerToken) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Missing auth token.' }) }
  }

  let ticketId
  try {
    ({ ticketId } = JSON.parse(event.body || '{}'))
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) }
  }
  if (!ticketId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'ticketId is required.' }) }
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Verify the caller is a signed-in team member (any role — this
  // mirrors is_team_member(), not the owner-only gate invite-user.js
  // uses, since any technician should be able to ask for another look).
  const { data: callerData, error: callerError } = await admin.auth.getUser(callerToken)
  if (callerError || !callerData?.user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Your session has expired — sign in again.' }) }
  }
  const { data: profile, error: profileError } = await admin.from('profiles').select('id').eq('id', callerData.user.id).maybeSingle()
  if (profileError || !profile) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Only signed-in team members can request an AI analysis.' }) }
  }

  const { data: ticket, error: ticketError } = await admin.from('tickets').select('*').eq('id', ticketId).maybeSingle()
  if (ticketError || !ticket) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Ticket not found.' }) }
  }

  const fields = {
    jiraIssueKey: ticket.jira_issue_key,
    jiraIssueId: ticket.jira_issue_id,
    summary: ticket.summary,
    description: ticket.description,
    jiraStatus: ticket.jira_status,
    priorityName: '',
    requesterEmail: ticket.requester_email,
    requesterName: ticket.requester_name,
    requesterAccountId: null,
    resolved: Boolean(ticket.resolved_at),
  }

  const result = await runAiAnalysis(admin, {
    ticketRowId: ticket.id,
    fields,
    clientId: ticket.client_id,
    triggerEvent: 'manual_request',
    existingTicket: ticket,
    force: true,
  })

  if (!result.ran) {
    const detail = result.error ? `: ${result.error}` : ''
    return { statusCode: 502, body: JSON.stringify({ error: `AI analysis could not run (${result.reason})${detail}` }) }
  }
  return { statusCode: 200, body: JSON.stringify({ ok: true }) }
}
