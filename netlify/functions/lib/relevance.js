// Pure decision logic for whether a Jira webhook event warrants a fresh
// AI analysis — no side effects, no network calls. This is what keeps
// the copilot from spamming a ticket: skip trivial metadata churn
// (watchers, rank, sprint moves...), and debounce a burst of updates
// to the same ticket in quick succession.
//
// This only decides whether to RUN the analysis. Whether the result of
// that analysis is worth a new Jira comment is a separate, later
// decision (see lib/copilot.js's material-change check) — a relevant
// event can still turn out to need no new comment if nothing the AI
// would say has actually changed.

const RELEVANT_FIELDS = new Set([
  'status', 'priority', 'assignee', 'description', 'summary', 'resolution', 'labels', 'attachment',
])

const MIN_REANALYSIS_INTERVAL_MS = 30_000

// { webhookEvent, payload, existingTicket, requesterEmail, commentAuthorEmail }
// -> { relevant: boolean, trigger: string|null }
function isRelevantForAnalysis({ webhookEvent, payload, existingTicket, requesterEmail, commentAuthorEmail }) {
  if (webhookEvent === 'jira:issue_created') {
    return { relevant: true, trigger: 'ticket_created' }
  }

  if (webhookEvent === 'comment_created') {
    const isCustomer = Boolean(commentAuthorEmail) && Boolean(requesterEmail) && commentAuthorEmail === requesterEmail
    return { relevant: true, trigger: isCustomer ? 'customer_reply' : 'technician_comment' }
  }

  if (webhookEvent === 'jira:issue_updated') {
    const items = payload.changelog?.items || []
    const changedFields = items.map((i) => String(i.field || '').toLowerCase()).filter((f) => RELEVANT_FIELDS.has(f))
    if (changedFields.length === 0) return { relevant: false, trigger: null }

    if (existingTicket?.ai_last_analysis_at) {
      const msSinceLastAnalysis = Date.now() - new Date(existingTicket.ai_last_analysis_at).getTime()
      if (msSinceLastAnalysis < MIN_REANALYSIS_INTERVAL_MS) return { relevant: false, trigger: null }
    }

    const trigger = changedFields.includes('status') ? 'status_changed'
      : changedFields.includes('priority') ? 'priority_changed'
      : changedFields.includes('assignee') ? 'assignee_changed'
      : 'fields_updated'
    return { relevant: true, trigger }
  }

  return { relevant: false, trigger: null }
}

// Human-readable "field changed from X to Y" lines for the ones that
// mattered — fed to the AI so it knows what just happened, not just
// that something did.
function describeChangelog(payload) {
  const items = payload.changelog?.items || []
  return items
    .filter((i) => RELEVANT_FIELDS.has(String(i.field || '').toLowerCase()))
    .map((i) => `${i.field} changed from "${i.fromString ?? i.from ?? '(none)'}" to "${i.toString ?? i.to ?? '(none)'}"`)
}

module.exports = { isRelevantForAnalysis, describeChangelog, RELEVANT_FIELDS }
