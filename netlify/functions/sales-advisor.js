// "Ask your sales guru" on the Sales page — a free-form chat for
// tactical sales advice (chasing prospects, outreach cadence,
// objection handling, prioritisation), grounded in a live snapshot of
// the real pipeline. Not the same thing as sales-draft.js: that writes
// one email for one opportunity; this is a conversation that never
// touches any record and is never persisted — each request carries
// its own history, kept only in the browser tab. Auth-gated the same
// way as the other on-demand AI actions: any signed-in team member.
//
// Required environment variables: SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY (same key already used
// by the other AI features — nothing new to configure).
const { createClient } = require('@supabase/supabase-js')
const { askSalesAdvisor } = require('./lib/salesAdvisor.js')

const MAX_HISTORY_MESSAGES = 24
const MAX_MESSAGE_CHARS = 4_000

function validMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return false
  if (messages.length > MAX_HISTORY_MESSAGES) return false
  if (messages[messages.length - 1].role !== 'user') return false
  return messages.every(
    (m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim() && m.content.length <= MAX_MESSAGE_CHARS,
  )
}

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

  let messages
  try {
    ({ messages } = JSON.parse(event.body || '{}'))
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) }
  }
  if (!validMessages(messages)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'A valid conversation history is required.' }) }
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
    return { statusCode: 403, body: JSON.stringify({ error: 'Only signed-in team members can use this.' }) }
  }

  // Fetched fresh, server-side, rather than trusted from the client —
  // the same reason sales-draft.js re-fetches the opportunity itself
  // instead of taking it as request input.
  const { data: opportunities, error: oppError } = await admin
    .from('sales_opportunities')
    .select('stage, estimated_value_annual, updated_at, clients(business_name)')
  if (oppError) {
    return { statusCode: 500, body: JSON.stringify({ error: `Could not load the pipeline: ${oppError.message}` }) }
  }

  const result = await askSalesAdvisor({ messages, opportunities: opportunities || [] })
  if (!result.ok) {
    const detail = result.error ? `: ${result.error}` : ''
    return { statusCode: 502, body: JSON.stringify({ error: `Could not get a reply (${result.reason})${detail}` }) }
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, reply: result.reply }) }
}
