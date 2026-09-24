// "Draft with AI" on the Sales page — generates one outreach/follow-up
// email for a sales opportunity and stores it as a draft for a human
// to review, edit, and send themselves (this app has no email-sending
// integration, and sales outreach is not something to automate
// unsupervised even if it did). Auth-gated the same way as
// request-ai-analysis.js: any signed-in team member, not owner-only.
//
// Required environment variables — same ANTHROPIC_* as the support
// copilot:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
const { createClient } = require('@supabase/supabase-js')
const { draftSalesMessage } = require('./lib/salesAssistant.js')

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

  let opportunityId, goal
  try {
    ({ opportunityId, goal } = JSON.parse(event.body || '{}'))
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) }
  }
  if (!opportunityId || !goal) {
    return { statusCode: 400, body: JSON.stringify({ error: 'opportunityId and goal are required.' }) }
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
    return { statusCode: 403, body: JSON.stringify({ error: 'Only signed-in team members can request an AI draft.' }) }
  }

  const { data: opportunity, error: oppError } = await admin
    .from('sales_opportunities')
    .select('*')
    .eq('id', opportunityId)
    .maybeSingle()
  if (oppError || !opportunity) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Opportunity not found.' }) }
  }

  const { data: client, error: clientError } = await admin
    .from('clients')
    .select('*, client_activity(*)')
    .eq('id', opportunity.client_id)
    .maybeSingle()
  if (clientError || !client) {
    return { statusCode: 404, body: JSON.stringify({ error: 'The client this opportunity belongs to was not found.' }) }
  }
  client.activity = (client.client_activity || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

  const result = await draftSalesMessage({ client, opportunity, goal })
  if (!result.ok) {
    const detail = result.error ? `: ${result.error}` : ''
    return { statusCode: 502, body: JSON.stringify({ error: `Could not generate a draft (${result.reason})${detail}` }) }
  }

  const draft = {
    subject: result.subject,
    body: result.body,
    key_points: result.keyPoints,
    follow_up_suggestion: result.followUpSuggestion,
  }
  const { error: updateError } = await admin.from('sales_opportunities').update({
    ai_draft_message: draft,
    ai_draft_generated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', opportunityId)
  if (updateError) {
    return { statusCode: 500, body: JSON.stringify({ error: `Draft generated but could not be saved: ${updateError.message}` }) }
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, draft }) }
}
