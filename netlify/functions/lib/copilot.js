// The AI copilot's "run one analysis" engine — the one place that
// gathers context, calls the AI, and applies the result. Called from
// three places: jira-webhook.js (event-driven, the normal path),
// sla-check.js (when a ticket newly crosses into SLA risk), and
// request-ai-analysis.js (a technician manually asking for another
// look). Keeping it here means all three stay in lockstep instead of
// three copies of the same decision logic drifting apart.
//
// Modular on purpose: everything Claude gets to reason about is
// assembled here from Jira + CRM data + ticket history. When richer
// signals exist later (Microsoft Graph, ESET, RMM, backup APIs, DNS/
// network checks), they plug in as more fields on the context this
// function builds — analyzeTicket()'s prompt-builder and tool schema
// don't need to change shape to accommodate that.
const { severityFromPriority } = require('./jira.js')
const { loadSettings } = require('./settings.js')
const { analyzeTicket } = require('./aiTechnician.js')
const { confidenceBand, evaluateEscalation, normalizeSeverity, normalizeCategory } = require('./safety.js')
const jiraClient = require('./jiraClient.js')

// Confidence is now a High/Medium/Low label (spec: prefer honest
// uncertainty over a false-precision percentage) — this is only the
// numeric stand-in the existing confidence-threshold/escalation-gate
// settings expect, so admin settings and automation limits keep working
// unchanged.
const CONFIDENCE_NUMERIC = { High: 90, Medium: 65, Low: 20 }

const ESCALATION_VALUES = ['None', 'Technician', 'Senior Technician', 'Security Escalation']

function sanitizeLabel(label) {
  return String(label || '').trim().toLowerCase().replace(/\s+/g, '-').slice(0, 60)
}

// Renders the exact "AI TECHNICAL ANALYSIS" format from the spec as
// the body of an internal (staff-only) Jira comment.
function formatAnalysisComment(result, escalation) {
  const lines = ['AI TECHNICAL ANALYSIS', '', 'Current understanding:', result.currentUnderstanding || '(none given)', '']

  if (result.technicianFeedback) {
    lines.push('Response to latest technician action:', result.technicianFeedback, '')
  }

  lines.push('Likely cause:', result.likelyCause || '(none given)', '')

  if (result.otherPossibilities?.length) {
    lines.push('Other possibilities:')
    result.otherPossibilities.forEach((p) => lines.push(`- ${p}`))
    lines.push('')
  }

  lines.push('Recommended next steps:')
  const steps = result.recommendedNextSteps?.length ? result.recommendedNextSteps : ['None — insufficient information to recommend a specific step yet.']
  steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`))
  lines.push('')

  if (result.evidence?.length) {
    lines.push('Evidence:')
    result.evidence.forEach((e) => lines.push(`- ${e}`))
    lines.push('')
  }

  lines.push('Confidence:', result.confidence, '', 'Risk:', result.risk, '', 'Escalation:', escalation)
  return lines.join('\n')
}

// Runs one analysis pass for a ticket and applies its result. Never
// throws — a Claude or Jira-write failure here must not stop the
// ticket sync that already happened; it falls back to a human
// escalation state instead.
//
// existingTicket needs at least: severity, category, ai_disabled,
// severity_locked, category_locked, ai_last_analysis_at, ai_summary,
// ai_likely_cause, ai_recommended_action, ai_confidence_label, ai_risk,
// ai_escalation_recommendation (all present once select('*') is used,
// or the specific columns jira-webhook.js/request-ai-analysis.js ask for).
async function runAiAnalysis(admin, { ticketRowId, fields, clientId, triggerEvent, existingTicket, changelogLines = [], latestComment = null, force = false }) {
  const settings = await loadSettings(admin)
  if (!settings.ai_enabled) return { ran: false, reason: 'ai_disabled_globally' }
  if (existingTicket?.ai_disabled && !force) return { ran: false, reason: 'ai_disabled_for_ticket' }

  let client = null
  let priorTickets = []
  if (clientId) {
    const [clientRes, priorRes] = await Promise.all([
      admin.from('clients').select('business_name, tier, sla_addon, status, device_count').eq('id', clientId).maybeSingle(),
      admin
        .from('tickets')
        .select('severity, category, summary, jira_issue_key, jira_status, created_at')
        .eq('client_id', clientId)
        .neq('jira_issue_key', fields.jiraIssueKey)
        .order('created_at', { ascending: false })
        .limit(8),
    ])
    client = clientRes.data
    priorTickets = priorRes.data || []
  }

  let comments = []
  if (jiraClient.isConfigured()) {
    try {
      comments = await jiraClient.getComments(fields.jiraIssueKey)
    } catch (err) {
      console.error(`[copilot] could not load comment history for ${fields.jiraIssueKey}:`, err.message)
    }
  }
  // Don't feed the AI its own past internal comments as "conversation"
  // — it already gets a clean summary of its last analysis below, and
  // re-reading its own words as if they were a new voice in the thread
  // risks it treating its own guess as independent corroboration.
  const botEmail = (process.env.JIRA_SERVICE_EMAIL || '').trim().toLowerCase()
  const humanComments = botEmail ? comments.filter((c) => c.authorEmail !== botEmail) : comments

  const priorAnalysis = existingTicket?.ai_last_analysis_at ? {
    summary: existingTicket.ai_summary,
    likelyCause: existingTicket.ai_likely_cause,
    recommendedAction: existingTicket.ai_recommended_action,
    confidence: existingTicket.ai_confidence_label,
    risk: existingTicket.ai_risk,
    escalation: existingTicket.ai_escalation_recommendation,
    severity: existingTicket.severity,
    category: existingTicket.category,
  } : null

  const result = await analyzeTicket({ ticket: fields, client, priorTickets, comments: humanComments, priorAnalysis, triggerEvent, changelogLines, latestComment })

  if (!result.ok) {
    // Spec: if Claude is unavailable, keep the ticket synced normally
    // and escalate for manual attention — never leave it silently
    // unanalysed in a queue nobody's watching.
    console.error(`[copilot] AI analysis failed for ${fields.jiraIssueKey}: ${result.reason} — ${result.error || 'no further detail'}`)
    await admin.from('tickets').update({ assigned_queue: settings.escalation_queue }).eq('id', ticketRowId)
    await admin.from('ai_audit_log').insert({
      ticket_id: ticketRowId,
      trigger_event: triggerEvent,
      decision: 'ai_unavailable',
      action_taken: 'escalated_no_ai',
      escalated: true,
      escalation_reason: `AI unavailable (${result.reason})${result.error ? `: ${result.error.slice(0, 200)}` : ''}`,
    })
    return { ran: false, reason: result.reason }
  }

  const confidenceNumeric = CONFIDENCE_NUMERIC[result.confidence] ?? 20
  const severity = normalizeSeverity(result.severity) || existingTicket?.severity || severityFromPriority(fields.priorityName) || 'P3'
  const category = normalizeCategory(result.category)
  const band = confidenceBand(confidenceNumeric, settings.confidence_threshold)
  const escalationGate = evaluateEscalation({
    severity, category, confidenceBand: band, description: fields.description,
    automationAttempts: 0, maxAttempts: settings.max_automation_attempts,
    aiText: `${result.currentUnderstanding} ${result.likelyCause} ${(result.recommendedNextSteps || []).join(' ')} ${result.customerReplyDraft}`,
  })
  const aiEscalation = ESCALATION_VALUES.includes(result.escalation) ? result.escalation : 'None'
  // The safety gate can only push escalation up, never down — an AI
  // that under-called its own escalation on a P1/security/low-confidence
  // ticket still gets escalated.
  const finalEscalation = escalationGate.escalate ? (aiEscalation === 'None' ? 'Technician' : aiEscalation) : aiEscalation

  const materialChange = Boolean(result.materialChange)
    || !priorAnalysis
    || severity !== priorAnalysis.severity
    || category !== priorAnalysis.category
    || finalEscalation !== priorAnalysis.escalation
    || result.risk !== priorAnalysis.risk

  // Low-risk metadata the AI may always amend. Severity/category are
  // the two fields a human can lock (see ticketsApi.js overrideSeverity/
  // overrideCategory) — once locked, the AI keeps analysing and keeps
  // logging what it *would* recommend, it just stops silently
  // overwriting the technician's own call.
  const ticketUpdate = {
    ai_confidence: confidenceNumeric,
    ai_confidence_label: result.confidence,
    ai_summary: result.currentUnderstanding,
    ai_likely_cause: result.likelyCause,
    ai_possible_causes: result.otherPossibilities || [],
    ai_recommended_action: (result.recommendedNextSteps || [])[0] || '',
    ai_recommended_steps: result.recommendedNextSteps || [],
    ai_evidence: result.evidence || [],
    ai_risk: result.risk,
    ai_escalation_recommendation: finalEscalation,
    ai_last_analysis_at: new Date().toISOString(),
    assigned_queue: escalationGate.escalate ? settings.escalation_queue : (settings.routing_map[category] || settings.routing_map.Other),
  }
  if (!existingTicket?.severity_locked) ticketUpdate.severity = severity
  if (!existingTicket?.category_locked) ticketUpdate.category = category
  if (result.customerReplyDraft) {
    ticketUpdate.ai_draft_reply = result.customerReplyDraft
    ticketUpdate.ai_draft_reply_status = 'pending'
  }

  await admin.from('tickets').update(ticketUpdate).eq('id', ticketRowId)

  // Jira write-back is best-effort: a missing service-account token or
  // a transient Jira error must not undo the analysis already stored,
  // and must not stop the audit log from recording what happened.
  let jiraModified = false
  let customerContacted = false
  if ((materialChange || force) && jiraClient.isConfigured()) {
    try {
      const labels = ['ai-analyzed', ...(result.suggestedLabels || []).map(sanitizeLabel).filter(Boolean)]
      if (escalationGate.escalate) labels.push('needs-human-review')
      await jiraClient.addLabels(fields.jiraIssueKey, labels)
      await jiraClient.addInternalComment(fields.jiraIssueKey, formatAnalysisComment(result, finalEscalation))
      jiraModified = true

      // Auto-send only the AI's own safest tier: high confidence, no
      // escalation in play, and the AI itself flagged the reply as
      // needing no approval (a pure acknowledgement/info-request).
      // Anything else sits as a pending draft for a human to approve.
      const safeToAutoSend = settings.auto_responses_enabled && band === 'high' && !escalationGate.escalate
        && result.customerReplyDraft && result.customerReplyRequiresApproval === false
      if (safeToAutoSend) {
        await jiraClient.addCustomerComment(fields.jiraIssueKey, result.customerReplyDraft)
        customerContacted = true
        await admin.from('tickets').update({ ai_draft_reply_status: 'sent' }).eq('id', ticketRowId)
      }
    } catch (err) {
      console.error(`[copilot] Jira write-back failed for ${fields.jiraIssueKey}:`, err.message)
    }
  }

  await admin.from('ai_audit_log').insert({
    ticket_id: ticketRowId,
    trigger_event: triggerEvent,
    decision: materialChange ? 'analysis' : 'analysis_no_change',
    severity,
    category,
    confidence: confidenceNumeric,
    analysis: {
      current_understanding: result.currentUnderstanding,
      likely_cause: result.likelyCause,
      other_possibilities: result.otherPossibilities,
      recommended_next_steps: result.recommendedNextSteps,
      evidence: result.evidence,
      confidence: result.confidence,
      risk: result.risk,
      escalation: finalEscalation,
      technician_feedback: result.technicianFeedback || null,
    },
    action_taken: materialChange ? (escalationGate.escalate ? 'escalated' : customerContacted ? 'auto_responded' : 'commented') : 'no_change',
    customer_contacted: customerContacted,
    escalated: escalationGate.escalate,
    escalation_reason: escalationGate.reason,
    jira_modified: jiraModified,
    human_approval_required: Boolean(result.customerReplyDraft) && result.customerReplyRequiresApproval !== false,
  })

  return { ran: true, materialChange, escalated: escalationGate.escalate }
}

module.exports = { runAiAnalysis, formatAnalysisComment, CONFIDENCE_NUMERIC }
