// Receives Jira Service Management webhook events and syncs them into
// the tickets table. Jira stays the source of truth for ticket status
// and conversation — this function only maintains the CRM's synced
// summary and runs customer matching (see lib/customerMatch.js).
//
// Required environment variables (Netlify: Site configuration ->
// Environment variables — never VITE_-prefixed):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  same as invite-user.js
//   JIRA_BASE_URL          e.g. https://your-org.atlassian.net
//   JIRA_WEBHOOK_SECRET    shared secret configured on the Jira side —
//                          sent either as header X-Webhook-Secret or as
//                          a ?secret= query param on the webhook URL
//   JIRA_SERVICE_EMAIL     the dedicated Jira service account's email —
//                          used to recognise (and skip) the bot's own
//                          Jira writes, so it never reacts to itself
const { createClient } = require('@supabase/supabase-js')
const { severityFromPriority, buildJiraUrl, extractTicketFields } = require('./lib/jira.js')
const { matchCustomer } = require('./lib/customerMatch.js')
const { computeSla } = require('./lib/sla.js')
const { cleanEmail } = require('./lib/text.js')

const HANDLED_EVENTS = new Set(['jira:issue_created', 'jira:issue_updated', 'comment_created'])

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JIRA_BASE_URL, JIRA_WEBHOOK_SECRET, JIRA_SERVICE_EMAIL } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !JIRA_WEBHOOK_SECRET) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server is not configured (missing env vars).' }) }
  }

  const providedSecret = event.headers['x-webhook-secret'] || new URLSearchParams(event.queryStringParameters || {}).get('secret')
  if (!timingSafeEqual(providedSecret || '', JIRA_WEBHOOK_SECRET)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid webhook secret.' }) }
  }

  let payload
  try {
    payload = JSON.parse(event.body || '{}')
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body.' }) }
  }

  // Temporary — set DEBUG_WEBHOOK=1 in Netlify while wiring up Jira's
  // automation rule, so a payload-shape mismatch shows up in the
  // function log instead of silently no-op'ing. Logs shape only
  // (field names), never ticket content. Unset once confirmed working.
  if (process.env.DEBUG_WEBHOOK) {
    console.log('[jira-webhook] payload shape', JSON.stringify({
      topLevelKeys: Object.keys(payload),
      webhookEvent: payload.webhookEvent,
      hasIssue: Boolean(payload.issue),
      issueKey: payload.issue?.key,
      issueFieldKeys: payload.issue?.fields ? Object.keys(payload.issue.fields) : null,
    }))
  }

  const webhookEvent = payload.webhookEvent
  const issue = payload.issue
  if (!webhookEvent || !issue?.key) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'no issue in payload' }) }
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Idempotency: Jira Cloud webhooks don't guarantee a unique delivery
  // id, so the dedup key is the event type + issue + delivery
  // timestamp — a retried delivery resends the same payload, so the
  // same key, and the unique-constraint insert below rejects it.
  const eventId = payload.id ? String(payload.id) : `${webhookEvent}:${issue.id}:${payload.timestamp || ''}`
  const { error: dedupeError } = await admin
    .from('webhook_events')
    .insert({ jira_event_id: eventId, jira_issue_key: issue.key, event_type: webhookEvent, status: 'received' })
  if (dedupeError) {
    if (dedupeError.code === '23505') {
      return { statusCode: 200, body: JSON.stringify({ ok: true, duplicate: true }) }
    }
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not record webhook event.' }) }
  }

  try {
    if (!HANDLED_EVENTS.has(webhookEvent)) {
      await markEvent(admin, eventId, 'skipped')
      return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: webhookEvent }) }
    }

    // Loop guard: never react to a change made by our own Jira service
    // account — otherwise the bot's own writes re-trigger this webhook.
    const actorEmail = cleanEmail(payload.user?.emailAddress)
    if (JIRA_SERVICE_EMAIL && actorEmail && actorEmail === cleanEmail(JIRA_SERVICE_EMAIL)) {
      await markEvent(admin, eventId, 'skipped')
      return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'self-triggered' }) }
    }

    const fields = extractTicketFields(issue)
    const jiraUrl = buildJiraUrl(JIRA_BASE_URL, fields.jiraIssueKey)

    const { data: existing } = await admin
      .from('tickets')
      .select('id, client_id, match_status, created_at')
      .eq('jira_issue_key', fields.jiraIssueKey)
      .maybeSingle()

    const needsMatch = !existing || existing.match_status !== 'matched'
    let clientId = existing?.client_id ?? null
    let matchStatus = existing?.match_status ?? 'unmatched'
    if (needsMatch) {
      const match = await matchCustomer(admin, { requesterEmail: fields.requesterEmail, jiraAccountId: fields.requesterAccountId })
      clientId = match.clientId
      matchStatus = match.matchStatus
    }

    let slaDueAt = null
    let slaState = 'not_applicable'
    if (clientId) {
      const { data: client } = await admin.from('clients').select('sla_addon').eq('id', clientId).maybeSingle()
      const createdAt = existing?.created_at || new Date().toISOString()
      const sla = computeSla({ hasSlaAddon: Boolean(client?.sla_addon), createdAt, firstResponseAt: null })
      slaDueAt = sla.slaDueAt
      slaState = sla.slaState
    }

    const row = {
      jira_issue_key: fields.jiraIssueKey,
      jira_issue_id: fields.jiraIssueId,
      client_id: clientId,
      match_status: matchStatus,
      requester_email: fields.requesterEmail,
      requester_name: fields.requesterName,
      summary: fields.summary,
      description: fields.description,
      jira_status: fields.jiraStatus,
      severity: severityFromPriority(fields.priorityName),
      sla_due_at: slaDueAt,
      sla_state: slaState,
      resolved_at: fields.resolved ? new Date().toISOString() : null,
      jira_url: jiraUrl,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const { error: upsertError } = await admin.from('tickets').upsert(row, { onConflict: 'jira_issue_key' })
    if (upsertError) throw upsertError

    await markEvent(admin, eventId, 'processed')
    return { statusCode: 200, body: JSON.stringify({ ok: true, matchStatus }) }
  } catch (err) {
    await markEvent(admin, eventId, 'failed', err.message)
    // 500 so Jira's own delivery retries resend this event later —
    // there is no separate queue, Jira's retry IS the retry here.
    return { statusCode: 500, body: JSON.stringify({ error: 'Processing failed, will retry.' }) }
  }
}

async function markEvent(admin, eventId, status, error) {
  await admin
    .from('webhook_events')
    .update({ status, error: error || null, processed_at: new Date().toISOString() })
    .eq('jira_event_id', eventId)
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return result === 0
}
