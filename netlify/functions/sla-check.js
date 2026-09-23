// Scheduled function (see netlify.toml) — Jira webhooks are event-driven,
// so nothing fires when a deadline simply elapses. This periodically
// recomputes sla_state for open SLA tickets and escalates any that have
// newly crossed into "at risk" or "breached" since the last run.
const { createClient } = require('@supabase/supabase-js')
const { computeSla } = require('./lib/sla.js')
const { loadSettings } = require('./lib/settings.js')
const { runAiAnalysis } = require('./lib/copilot.js')
const jiraClient = require('./lib/jiraClient.js')

exports.handler = async () => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[sla-check] missing Supabase env vars')
    return { statusCode: 500 }
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const settings = await loadSettings(admin)

  const { data: openTickets, error } = await admin
    .from('tickets')
    .select(`
      id, jira_issue_key, jira_issue_id, sla_state, created_at, first_response_at, client_id,
      summary, description, jira_status, requester_email, requester_name, severity, category,
      ai_disabled, severity_locked, category_locked, ai_last_analysis_at,
      ai_summary, ai_likely_cause, ai_recommended_action, ai_confidence_label, ai_risk, ai_escalation_recommendation
    `)
    .neq('sla_state', 'not_applicable')
    .is('resolved_at', null)
  if (error) {
    console.error('[sla-check] could not load open SLA tickets:', error.message)
    return { statusCode: 500 }
  }

  let checked = 0
  let escalated = 0
  for (const ticket of openTickets || []) {
    checked++
    const sla = computeSla({ hasSlaAddon: true, createdAt: ticket.created_at, firstResponseAt: ticket.first_response_at })
    if (sla.slaState === ticket.sla_state) continue // no change

    await admin.from('tickets').update({ sla_state: sla.slaState, sla_due_at: sla.slaDueAt }).eq('id', ticket.id)

    const newlyUrgent = sla.slaState === 'at_risk' || sla.slaState === 'breached'
    if (!newlyUrgent) continue

    escalated++
    await admin.from('tickets').update({ assigned_queue: settings.escalation_queue }).eq('id', ticket.id)
    await admin.from('ai_audit_log').insert({
      ticket_id: ticket.id,
      decision: 'sla_check',
      action_taken: `sla_${sla.slaState}`,
      escalated: true,
      escalation_reason: `SLA ${sla.slaState === 'breached' ? 'breached' : 'approaching breach'}`,
    })

    if (jiraClient.isConfigured()) {
      try {
        await jiraClient.addInternalComment(
          ticket.jira_issue_key,
          sla.slaState === 'breached'
            ? 'SLA response deadline has been breached — this ticket needs immediate attention.'
            : 'SLA response deadline is approaching — please respond soon to stay within the response commitment.',
        )
      } catch (err) {
        console.error('[sla-check] Jira comment failed:', err.message)
      }
    }

    // Newly at-risk/breached is exactly the kind of "has anything
    // changed?" moment the copilot should re-evaluate for — SLA
    // pressure alone can be reason enough to bump its own escalation
    // recommendation, even with no new Jira activity to react to.
    await runAiAnalysis(admin, {
      ticketRowId: ticket.id,
      fields: {
        jiraIssueKey: ticket.jira_issue_key,
        jiraIssueId: ticket.jira_issue_id,
        summary: ticket.summary,
        description: ticket.description,
        jiraStatus: ticket.jira_status,
        priorityName: '',
        requesterEmail: ticket.requester_email,
        requesterName: ticket.requester_name,
        requesterAccountId: null,
        resolved: false,
      },
      clientId: ticket.client_id,
      triggerEvent: 'sla_risk',
      existingTicket: ticket,
    })
  }

  console.log(`[sla-check] checked ${checked} open SLA tickets, escalated ${escalated}`)
  return { statusCode: 200, body: JSON.stringify({ checked, escalated }) }
}
