// Pure safety/escalation logic for AI triage — no side effects, no
// network calls, so this is the one file worth reading closely to
// verify the bot's safety boundaries. Everything here is a decision;
// the actual Jira/Claude calls live elsewhere.

const CATEGORIES = [
  'Security', 'Microsoft 365', 'Endpoint', 'Backup', 'Network',
  'Account & Access', 'Hardware', 'Software', 'New User', 'User Change', 'Other',
]

const SEVERITIES = ['P1', 'P2', 'P3', 'P4']

// The bot has no code path to actually perform any of these (the Jira
// client only exposes addComment/addLabels) — this list is the second,
// belt-and-braces layer: it also blocks the AI from ever being asked to
// suggest one as something it will do, and flags a response that claims
// one happened (see containsDestructiveClaim below).
const NEVER_AUTONOMOUS = [
  'disable a user account', 'reset MFA', 'wipe a device', 'delete data',
  'disable a security product', 'change a security policy', 'change Conditional Access',
  'change firewall rules', 'change DNS', 'delete backups', 'restore data',
  'make a destructive change', 'approve a financial or commercial change',
]

const LEGAL_KEYWORDS = /\b(lawyer|legal action|gdpr|data breach notif|regulator|ico\b|sue|sued|lawsuit|compliance violation|data protection act)\b/i
const DESTRUCTIVE_CLAIM = /\b(i(?:'ve| have) (disabled|reset|wiped|deleted|restored|changed the (firewall|dns|conditional access|policy))|account (has been|is now) disabled|mfa (has been|was) reset)\b/i

function confidenceBand(confidence, thresholds) {
  if (confidence == null) return 'low'
  if (confidence >= thresholds.high) return 'high'
  if (confidence >= thresholds.medium) return 'medium'
  return 'low'
}

// The single gate every AI decision passes through before any action is
// taken. Returns { escalate, reason } — reason is null only when
// escalate is false. Prefers escalating: any doubt, any P1/security
// signal, any policy-listed trigger wins over automation.
function evaluateEscalation({ severity, category, confidenceBand: band, description, automationAttempts, maxAttempts, aiText }) {
  if (severity === 'P1') return { escalate: true, reason: 'P1 severity' }
  if (category === 'Security' || category === 'Account & Access') return { escalate: true, reason: 'Security-related category' }
  if (band === 'low') return { escalate: true, reason: 'Low AI confidence' }
  if (LEGAL_KEYWORDS.test(description || '')) return { escalate: true, reason: 'Mentions legal/regulatory/data-loss concerns' }
  if ((automationAttempts || 0) >= (maxAttempts ?? 2)) return { escalate: true, reason: 'Exceeded automated-attempt limit' }
  if (aiText && DESTRUCTIVE_CLAIM.test(aiText)) return { escalate: true, reason: 'AI response claimed a destructive action — blocked and escalated' }
  return { escalate: false, reason: null }
}

function normalizeCategory(value) {
  const match = CATEGORIES.find((c) => c.toLowerCase() === String(value || '').trim().toLowerCase())
  return match || 'Other'
}

function normalizeSeverity(value) {
  const v = String(value || '').trim().toUpperCase()
  return SEVERITIES.includes(v) ? v : null
}

module.exports = { CATEGORIES, SEVERITIES, NEVER_AUTONOMOUS, confidenceBand, evaluateEscalation, normalizeCategory, normalizeSeverity }
