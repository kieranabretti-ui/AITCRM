// "Approve AI draft reply" — the one path by which an AI-drafted
// customer-facing message actually reaches the customer, other than
// the fully-automatic low-risk path already gated inside
// lib/copilot.js (high confidence, no escalation, and the AI itself
// flagged the reply as needing no approval). Everything else sits as
// ticket.ai_draft_reply/ai_draft_reply_status = 'pending' until a human
// calls this. Posting to Jira needs the service-account credentials,
// which is why this can't just be a normal RLS-protected client write
// like the other human-override actions in ticketsApi.js.
//
// Required environment variables — same as jira-webhook.js:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JIRA_BASE_URL,
//   JIRA_SERVICE_EMAIL, JIRA_API_TOKEN
const { createClient } = require('@supabase/supabase-js')
const jiraClient = require('./lib/jiraClient.js')

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server is not configured (missing Supabase env vars).' }) }
  }
  if (!jiraClient.isConfigured()) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Jira write credentials are not configured.' }) }
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

  const { data: callerData, error: callerError } = await admin.auth.getUser(callerToken)
  if (callerError || !callerData?.user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Your session has expired — sign in again.' }) }
  }
  const { data: profile, error: profileError } = await admin.from('profiles').select('id').eq('id', callerData.user.id).maybeSingle()
  if (profileError || !profile) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Only signed-in team members can approve a reply.' }) }
  }

  const { data: ticket, error: ticketError } = await admin
    .from('tickets')
    .select('id, jira_issue_key, ai_draft_reply, ai_draft_reply_status')
    .eq('id', ticketId)
    .maybeSingle()
  if (ticketError || !ticket) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Ticket not found.' }) }
  }
  if (ticket.ai_draft_reply_status !== 'pending' || !ticket.ai_draft_reply) {
    return { statusCode: 400, body: JSON.stringify({ error: 'There is no pending AI draft reply on this ticket.' }) }
  }

  try {
    await jiraClient.addCustomerComment(ticket.jira_issue_key, ticket.ai_draft_reply)
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: `Could not post to Jira: ${err.message}` }) }
  }

  await admin.from('tickets').update({ ai_draft_reply_status: 'sent' }).eq('id', ticket.id)
  await admin.from('ai_audit_log').insert({
    ticket_id: ticket.id,
    trigger_event: 'human_approval',
    decision: 'human_approved_reply',
    action_taken: 'customer_reply_sent',
    customer_contacted: true,
    jira_modified: true,
    human_approval_required: true,
    human_decision: 'approved',
    human_decision_by: callerData.user.id,
    human_decision_at: new Date().toISOString(),
  })

  return { statusCode: 200, body: JSON.stringify({ ok: true }) }
}
