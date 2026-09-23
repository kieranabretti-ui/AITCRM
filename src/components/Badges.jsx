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
