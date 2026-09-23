import { STATUSES, reviewUrgency } from '../lib/pricing.js'

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
