import { STATUSES, reviewUrgency, renewalUrgency } from '../lib/pricing.js'

const TIER_CLASSES = {
  silver: 'bg-paper-dim text-slate',
  gold: 'bg-brass/15 text-brass-dark',
  platinum: 'bg-petrol/15 text-petrol',
}
const TIER_NAMES = { silver: 'Silver', gold: 'Gold', platinum: 'Platinum' }

export function TierBadge({ tier }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${TIER_CLASSES[tier] || TIER_CLASSES.silver}`}>
      {TIER_NAMES[tier] || tier}
    </span>
  )
}

const STATUS_CLASSES = {
  lead: 'bg-status-lead/10 text-status-lead',
  onboarding: 'bg-status-onboarding/10 text-status-onboarding',
  active: 'bg-status-active/10 text-status-active',
  paused: 'bg-status-paused/10 text-status-paused',
  churned: 'bg-status-churned/10 text-status-churned',
}

export function StatusBadge({ status }) {
  const label = STATUSES.find((s) => s.id === status)?.label || status
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${STATUS_CLASSES[status] || ''}`}>
      {label}
    </span>
  )
}

export function ReviewBadge({ client }) {
  const u = reviewUrgency(client)
  if (u === 'overdue')
    return <span className="rounded-full bg-status-churned/10 px-2 py-0.5 text-[10.5px] font-semibold text-status-churned">Overdue</span>
  if (u === 'due-soon')
    return <span className="rounded-full bg-status-onboarding/10 px-2 py-0.5 text-[10.5px] font-semibold text-status-onboarding">Due soon</span>
  if (u === 'unknown')
    return <span className="rounded-full bg-status-onboarding/10 px-2 py-0.5 text-[10.5px] font-semibold text-status-onboarding">No review date</span>
  return null
}

export function SlaPill({ show }) {
  if (!show) return null
  return <span className="rounded bg-brass/15 px-1.5 py-0.5 font-mono text-[10.5px] text-brass-dark">+SLA</span>
}

const SEVERITY_CLASSES = {
  P1: 'bg-status-churned/10 text-status-churned',
  P2: 'bg-status-onboarding/10 text-status-onboarding',
  P3: 'bg-status-lead/10 text-status-lead',
  P4: 'bg-paper-dim text-slate',
}

export function SeverityBadge({ severity }) {
  if (!severity) return null
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold ${SEVERITY_CLASSES[severity] || SEVERITY_CLASSES.P4}`}>
      {severity}
    </span>
  )
}

const SLA_STATE_LABELS = { within_sla: 'Within SLA', at_risk: 'SLA at risk', breached: 'SLA breached' }
const SLA_STATE_CLASSES = {
  within_sla: 'bg-status-active/10 text-status-active',
  at_risk: 'bg-status-onboarding/10 text-status-onboarding',
  breached: 'bg-status-churned/10 text-status-churned',
}

export function SlaStateBadge({ state }) {
  if (!state || state === 'not_applicable') return null
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${SLA_STATE_CLASSES[state] || ''}`}>
      {SLA_STATE_LABELS[state] || state}
    </span>
  )
}

export function MatchStatusBadge({ status }) {
  if (status !== 'unmatched' && status !== 'ambiguous') return null
  return (
    <span className="inline-flex items-center rounded-full bg-status-onboarding/10 px-2.5 py-0.5 text-[11px] font-semibold text-status-onboarding">
      {status === 'ambiguous' ? 'Ambiguous match' : 'Unmatched'}
    </span>
  )
}

const CONFIDENCE_CLASSES = {
  High: 'bg-status-active/10 text-status-active',
  Medium: 'bg-status-onboarding/10 text-status-onboarding',
  Low: 'bg-status-churned/10 text-status-churned',
}

export function ConfidenceBadge({ confidence }) {
  if (!confidence) return null
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${CONFIDENCE_CLASSES[confidence] || ''}`}>
      {confidence} confidence
    </span>
  )
}

const RISK_CLASSES = {
  Low: 'bg-status-active/10 text-status-active',
  Medium: 'bg-status-onboarding/10 text-status-onboarding',
  High: 'bg-status-churned/10 text-status-churned',
}

export function RiskBadge({ risk }) {
  if (!risk) return null
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${RISK_CLASSES[risk] || ''}`}>
      {risk} risk
    </span>
  )
}

const ESCALATION_CLASSES = {
  None: 'bg-paper-dim text-slate',
  Technician: 'bg-status-lead/10 text-status-lead',
  'Senior Technician': 'bg-status-onboarding/10 text-status-onboarding',
  'Security Escalation': 'bg-status-churned/10 text-status-churned',
}

export function EscalationBadge({ escalation }) {
  if (!escalation || escalation === 'None') return null
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${ESCALATION_CLASSES[escalation] || ''}`}>
      {escalation}
    </span>
  )
}

const RENEWAL_LABELS = { 'due-90': '90 days', 'due-60': '60 days', 'due-30': '30 days', overdue: 'Overdue' }
const RENEWAL_CLASSES = {
  'due-90': 'bg-status-lead/10 text-status-lead',
  'due-60': 'bg-status-onboarding/10 text-status-onboarding',
  'due-30': 'bg-status-churned/10 text-status-churned',
  overdue: 'bg-status-churned text-white',
}

export function RenewalBadge({ client }) {
  const u = renewalUrgency(client)
  if (!u) return null
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${RENEWAL_CLASSES[u]}`}>
      {u === 'overdue' ? RENEWAL_LABELS[u] : `Renews in ${RENEWAL_LABELS[u]}`}
    </span>
  )
}

// Score bands: 80+ Healthy, 60-79 Watch, 40-59 At risk, <40 Critical —
// matches lib/healthScore.js's own thresholds (kept here for display
// only; the server owns the actual scoring).
function healthBand(score) {
  if (score == null) return null
  if (score >= 80) return 'Healthy'
  if (score >= 60) return 'Watch'
  if (score >= 40) return 'At risk'
  return 'Critical'
}

const HEALTH_CLASSES = {
  Healthy: 'bg-status-active/10 text-status-active',
  Watch: 'bg-status-lead/10 text-status-lead',
  'At risk': 'bg-status-onboarding/10 text-status-onboarding',
  Critical: 'bg-status-churned/10 text-status-churned',
}

export function HealthScoreBadge({ score, label }) {
  if (score == null) return null
  const band = label || healthBand(score)
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${HEALTH_CLASSES[band] || ''}`}>
      <span className="font-mono tabular-nums">{score}</span> {band}
    </span>
  )
}

const NEXT_ACTION_DOT_CLASSES = {
  high: 'bg-status-churned',
  medium: 'bg-status-onboarding',
  low: 'bg-slate',
}

// A priority dot + the suggestion text, not a pill — this reads as a
// sentence in a table row or client view, not another badge competing
// with severity/health for attention.
export function NextActionNote({ action, priority }) {
  if (!action) return null
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-ink/80">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${NEXT_ACTION_DOT_CLASSES[priority] || NEXT_ACTION_DOT_CLASSES.low}`} />
      {action}
    </span>
  )
}
