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
const { loadSettings } = require('./lib/settings.js')
const { triageTicket } = require('./lib/aiTriage.js')
const { confidenceBand, evaluateEscalation, normalizeSeverity, normalizeCategory } = require('./lib/safety.js')
const jiraClient = require('./lib/jiraClient.js')

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
      .select('id, client_id, match_status, created_at, first_response_at, severity, ai_confidence')
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

    // "Time to first human response" (spec) — a comment on this ticket
    // from anyone other than the requester (and, per the loop guard
    // above, not our own bot) is a staff reply. Record only the first
    // one; later replies don't move it.
    let firstResponseAt = existing?.first_response_at || null
    if (!firstResponseAt && webhookEvent === 'comment_created') {
      const commentAuthorEmail = cleanEmail(payload.comment?.author?.emailAddress)
      if (commentAuthorEmail && commentAuthorEmail !== fields.requesterEmail) {
        firstResponseAt = new Date().toISOString()
      }
    }

    let slaDueAt = null
    let slaState = 'not_applicable'
    if (clientId) {
      const { data: client } = await admin.from('clients').select('sla_addon').eq('id', clientId).maybeSingle()
      const createdAt = existing?.created_at || new Date().toISOString()
      const sla = computeSla({ hasSlaAddon: Boolean(client?.sla_addon), createdAt, firstResponseAt })
      slaDueAt = sla.slaDueAt
      slaState = sla.slaState
    }

    // Once the AI has classified this ticket (ai_confidence set), its
    // severity judgement stands — a later issue_updated event (a status
    // or assignment change, say) must not silently overwrite it back to
    // the raw Jira-priority fallback used only before AI classification.
    const severity = existing?.ai_confidence != null ? existing.severity : severityFromPriority(fields.priorityName)

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
      severity,
      first_response_at: firstResponseAt,
      sla_due_at: slaDueAt,
      sla_state: slaState,
      resolved_at: fields.resolved ? new Date().toISOString() : null,
      jira_url: jiraUrl,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const { data: upserted, error: upsertError } = await admin
      .from('tickets')
      .upsert(row, { onConflict: 'jira_issue_key' })
      .select('id')
      .single()
    if (upsertError) throw upsertError

    // AI triage runs once, on creation — not on every update — so cost
    // is predictable and the bot never iterates endlessly on one ticket
    // (see spec: escalate after the first attempt rather than retry).
    if (webhookEvent === 'jira:issue_created') {
      await runAiTriage(admin, { ticketRowId: upserted.id, fields, clientId })
    }

    await markEvent(admin, eventId, 'processed')
    return { statusCode: 200, body: JSON.stringify({ ok: true, matchStatus }) }
  } catch (err) {
    await markEvent(admin, eventId, 'failed', err.message)
    // 500 so Jira's own delivery retries resend this event later —
    // there is no separate queue, Jira's retry IS the retry here.
    return { statusCode: 500, body: JSON.stringify({ error: 'Processing failed, will retry.' }) }
  }
}

// Runs the AI classification for one newly-created ticket and applies
// its result. Never throws — a Claude or Jira-write failure here must
// not stop the ticket from having synced (it already has, by this
// point); it falls back to a human-escalation state instead.
async function runAiTriage(admin, { ticketRowId, fields, clientId }) {
  const settings = await loadSettings(admin)
  if (!settings.ai_enabled) return

  let client = null
  let priorTickets = []
  if (clientId) {
    const [clientRes, priorRes] = await Promise.all([
      admin.from('clients').select('business_name, tier, sla_addon, status').eq('id', clientId).maybeSingle(),
      admin
        .from('tickets')
        .select('severity, summary, jira_issue_key, jira_status')
        .eq('client_id', clientId)
        .neq('jira_issue_key', fields.jiraIssueKey)
        .order('created_at', { ascending: false })
        .limit(5),
    ])
    client = clientRes.data
    priorTickets = priorRes.data || []
  }

  const result = await triageTicket({ ticket: fields, client, priorTickets })

  if (!result.ok) {
    // Spec: if Claude is unavailable, process the ticket normally
    // without AI and escalate for manual triage — never leave it
    // silently unclassified in a queue nobody's watching.
    await admin.from('tickets').update({ assigned_queue: settings.escalation_queue }).eq('id', ticketRowId)
    await admin.from('ai_audit_log').insert({
      ticket_id: ticketRowId,
      decision: 'ai_unavailable',
      action_taken: 'escalated_no_ai',
      escalated: true,
      escalation_reason: `AI unavailable (${result.reason})`,
    })
    return
  }

  const severity = normalizeSeverity(result.severity) || severityFromPriority(fields.priorityName) || 'P3'
  const category = normalizeCategory(result.category)
  const band = confidenceBand(result.confidence, settings.confidence_threshold)
  const escalation = evaluateEscalation({
    severity, category, confidenceBand: band, description: fields.description,
    automationAttempts: 0, maxAttempts: settings.max_automation_attempts,
    aiText: `${result.reasoning} ${result.customerResponse}`,
  })
  const queue = escalation.escalate ? settings.escalation_queue : (settings.routing_map[category] || settings.routing_map.Other)

  await admin.from('tickets').update({
    severity,
    category,
    ai_classification: { reasoning: result.reasoning, suggested_labels: result.suggestedLabels, escalated: escalation.escalate, escalation_reason: escalation.reason },
    ai_confidence: result.confidence,
    assigned_queue: queue,
  }).eq('id', ticketRowId)

  // Jira write-back is best-effort: a missing service-account token or
  // a transient Jira error must not undo the classification we already
  // stored, and must not stop the audit log from recording what happened.
  let customerContacted = false
  if (jiraClient.isConfigured()) {
    try {
      const labels = ['ai-triaged', ...result.suggestedLabels]
      if (escalation.escalate) labels.push('needs-human-review')
      await jiraClient.addLabels(fields.jiraIssueKey, labels)

      if (escalation.escalate) {
        await jiraClient.addInternalComment(
          fields.jiraIssueKey,
          `AI triage: ${severity} / ${category} (confidence ${result.confidence}%).\n${result.reasoning}\nEscalated to a human: ${escalation.reason}.`,
        )
      } else {
        await jiraClient.addInternalComment(
          fields.jiraIssueKey,
          `AI triage: ${severity} / ${category} (confidence ${result.confidence}%).\n${result.reasoning}`,
        )
        if (settings.auto_responses_enabled && band === 'high' && result.customerResponse) {
          await jiraClient.addCustomerComment(fields.jiraIssueKey, result.customerResponse)
          customerContacted = true
        }
      }
    } catch (err) {
      console.error('[jira-webhook] Jira write-back failed:', err.message)
    }
  }

  await admin.from('ai_audit_log').insert({
    ticket_id: ticketRowId,
    decision: 'classified',
    severity,
    category,
    confidence: result.confidence,
    action_taken: escalation.escalate ? 'escalated' : customerContacted ? 'auto_responded' : 'labeled_only',
    customer_contacted: customerContacted,
    escalated: escalation.escalate,
    escalation_reason: escalation.reason,
  })
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
