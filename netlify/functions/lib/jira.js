// Jira payload parsing — server-side only. No network calls live here;
// this just shapes a Jira webhook payload into what tickets needs.
const { cleanEmail } = require('./text.js')

// Jira Cloud priority names -> our P1-P4 scale. This is only the
// Phase-1 fallback severity (raw Jira priority, not AI judgement) —
// Phase 2's classifier is free to override it with real context.
const PRIORITY_TO_SEVERITY = {
  highest: 'P1',
  blocker: 'P1',
  critical: 'P1',
  high: 'P2',
  medium: 'P3',
  low: 'P4',
  lowest: 'P4',
}

function severityFromPriority(priorityName) {
  if (!priorityName) return null
  return PRIORITY_TO_SEVERITY[priorityName.trim().toLowerCase()] || null
}

// The reverse of the map above, for writing the AI's own severity
// classification back onto Jira's native Priority field — standard
// Jira Cloud priority names. If a project uses a custom priority
// scheme, this write is best-effort (see jiraClient.setPriority) and
// simply fails harmlessly like any other Jira write-back; the CRM's
// own severity still reflects the AI's judgement either way.
const SEVERITY_TO_PRIORITY = { P1: 'Highest', P2: 'High', P3: 'Medium', P4: 'Low' }

function priorityNameForSeverity(severity) {
  return SEVERITY_TO_PRIORITY[severity] || null
}

// Jira Cloud issue descriptions are Atlassian Document Format (a JSON
// tree), not plain text. This is a best-effort flatten — good enough
// for a CRM summary; the full formatted version stays in Jira.
function adfToText(node, depth = 0) {
  if (!node || depth > 20) return ''
  if (typeof node === 'string') return node
  if (node.type === 'text') return node.text || ''
  const children = Array.isArray(node.content) ? node.content.map((n) => adfToText(n, depth + 1)) : []
  const joined = children.join(node.type === 'paragraph' ? '' : ' ')
  return node.type === 'paragraph' || node.type === 'heading' ? joined + '\n' : joined
}

function descriptionToText(description) {
  if (!description) return ''
  if (typeof description === 'string') return description
  try {
    return adfToText(description).trim()
  } catch {
    return ''
  }
}

function buildJiraUrl(baseUrl, issueKey) {
  if (!baseUrl || !issueKey) return ''
  return `${baseUrl.replace(/\/$/, '')}/browse/${issueKey}`
}

// Pulls the fields tickets cares about out of a Jira issue object
// (payload.issue from any of the webhook events we handle).
function extractTicketFields(issue) {
  const fields = issue?.fields || {}
  const reporter = fields.reporter || {}
  return {
    jiraIssueKey: issue.key,
    jiraIssueId: String(issue.id),
    summary: fields.summary || '',
    description: descriptionToText(fields.description),
    jiraStatus: fields.status?.name || '',
    priorityName: fields.priority?.name || '',
    requesterEmail: cleanEmail(reporter.emailAddress),
    requesterName: reporter.displayName || '',
    requesterAccountId: reporter.accountId || null,
    resolved: Boolean(fields.resolution),
  }
}

module.exports = { severityFromPriority, priorityNameForSeverity, descriptionToText, buildJiraUrl, extractTicketFields }
