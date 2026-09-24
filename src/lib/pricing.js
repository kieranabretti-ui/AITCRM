// Kept in sync with the A-IT site's own src/lib/pricing.js.
export const TIERS = [
  { id: 'silver', name: 'Silver', price: 15 },
  { id: 'gold', name: 'Gold', price: 18 },
  { id: 'platinum', name: 'Platinum', price: 25 },
]
export const TIER_PRICE = { silver: 15, gold: 18, platinum: 25 }
export const SLA_ADDON_PRICE = 10

export const STATUSES = [
  { id: 'lead', label: 'Lead' },
  { id: 'onboarding', label: 'Onboarding' },
  { id: 'active', label: 'Active' },
  { id: 'paused', label: 'Paused' },
  { id: 'churned', label: 'Churned' },
]

export const LEAD_SOURCES = [
  { id: '', label: 'Not set' },
  { id: 'google_ads', label: 'Google Ads' },
  { id: 'referral', label: 'Referral' },
  { id: 'word_of_mouth', label: 'Word of mouth' },
  { id: 'website', label: 'Website enquiry' },
  { id: 'other', label: 'Other' },
]

export function leadSourceLabel(id) {
  return LEAD_SOURCES.find((s) => s.id === id)?.label || ''
}

export function tierName(id) {
  return TIERS.find((t) => t.id === id)?.name || id
}

export function gbp(n) {
  const amount = Number.isFinite(n) ? n : 0
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function computeMrr(c) {
  const base = (TIER_PRICE[c.tier] || 0) * (Number(c.device_count) || 0)
  const sla = c.sla_addon ? SLA_ADDON_PRICE * (Number(c.device_count) || 0) : 0
  return base + sla
}

export function isMrrUnknown(c) {
  return (c.status === 'lead' || c.status === 'onboarding') && !(Number(c.device_count) > 0)
}

export function mrrDisplay(c) {
  return isMrrUnknown(c) ? 'TBC' : gbp(computeMrr(c))
}

// Review cadence: Gold and Platinum commit to a quarterly strategic
// security review; Silver's only recurring touchpoint is the monthly
// reporting pack.
export function reviewCadenceDays(tier) {
  return tier === 'silver' ? 30 : 91
}

export const REVIEW_WINDOW_DAYS = 30

export function computeNextReviewDate(c) {
  const baseline = c.last_reviewed_date || c.start_date || ''
  if (!baseline) return null
  const d = new Date(baseline + 'T00:00:00')
  if (isNaN(d.getTime())) return null
  d.setDate(d.getDate() + reviewCadenceDays(c.tier))
  return d.toISOString().slice(0, 10)
}

export function reviewDaysOut(c) {
  const due = computeNextReviewDate(c)
  if (!due) return -99999
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dueDate = new Date(due + 'T00:00:00')
  return Math.round((dueDate.getTime() - today.getTime()) / 86400000)
}

export function reviewUrgency(c) {
  if (!c || c.status !== 'active') return null
  if (!computeNextReviewDate(c)) return 'unknown'
  const days = reviewDaysOut(c)
  if (days < 0) return 'overdue'
  if (days <= REVIEW_WINDOW_DAYS) return 'due-soon'
  return null
}

// Contract renewal warnings — same day-counting approach as the review
// cadence above, but with three widening windows instead of one, per
// spec: flag at 90/60/30 days out, then overdue past the renewal date
// itself (relevant for an auto_renewal: false contract that's lapsed
// without a new term being agreed).
export function renewalDaysOut(c) {
  if (!c?.contract_renewal_date) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(c.contract_renewal_date + 'T00:00:00')
  if (isNaN(due.getTime())) return null
  return Math.round((due.getTime() - today.getTime()) / 86400000)
}

export function renewalUrgency(c) {
  if (!c || c.status !== 'active') return null
  const days = renewalDaysOut(c)
  if (days === null) return null
  if (days < 0) return 'overdue'
  if (days <= 30) return 'due-30'
  if (days <= 60) return 'due-60'
  if (days <= 90) return 'due-90'
  return null
}

export function fmtDate(d) {
  if (!d) return ''
  const dt = new Date(d + 'T00:00:00')
  if (isNaN(dt.getTime())) return d
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function fmtDateTime(iso) {
  if (!iso) return ''
  const dt = new Date(iso)
  if (isNaN(dt.getTime())) return ''
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function fmtBytes(n) {
  n = Number(n) || 0
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB'
  return (n / (1024 * 1024)).toFixed(1) + ' MB'
}
