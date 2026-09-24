// Customer health score — pure scoring logic, no side effects, no
// network calls, same pattern as lib/sla.js/lib/safety.js. Called by
// the daily health-score scheduled function once per active client.
//
// Deliberately a deterministic weighted formula, not a per-client LLM
// call: every input here is an objective count or date, not something
// that needs language understanding — a rules-based score is cheaper,
// instant, fully explainable (see `factors` below), and never
// hallucinates a number that then drives a business decision. The
// per-factor breakdown is what the CRM shows on the client record, so
// "why is this score 42" is always answerable from the data, not from
// asking an LLM to justify itself after the fact.
//
// Score starts at 100 and each factor only ever deducts (a quiet,
// unremarkable account should sit near 100) — bands: 80+ Healthy,
// 60-79 Watch, 40-59 At risk, <40 Critical.

function clampDeduction(points, cap) {
  return -Math.min(cap, Math.max(0, Math.round(points)))
}

function scoreLabel(score) {
  if (score >= 80) return 'Healthy'
  if (score >= 60) return 'Watch'
  if (score >= 40) return 'At risk'
  return 'Critical'
}

const RENEWAL_DEDUCTIONS = { 'due-30': 5, 'due-60': 3, 'due-90': 1, overdue: 8 }

// { ticketsLast30, ticketsPrev30, slaBreaches90, securityIncidents90,
//   backupFailures90, unresolvedCount, renewalUrgency } -> deterministic
// counts computed by the caller (health-score.js) from tickets/clients.
function computeHealthScore({
  ticketsLast30 = 0, ticketsPrev30 = 0,
  slaBreaches90 = 0, securityIncidents90 = 0, backupFailures90 = 0,
  unresolvedCount = 0, renewalUrgency = null,
}) {
  const factors = {}

  // 1. Ticket volume trend — rising volume is an early warning sign
  // even before anything has technically gone wrong.
  let volumePoints = 0
  let volumeDetail = `${ticketsLast30} tickets in the last 30 days vs ${ticketsPrev30} in the previous 30`
  if (ticketsPrev30 > 0 && ticketsLast30 > ticketsPrev30) {
    const increasePct = (ticketsLast30 - ticketsPrev30) / ticketsPrev30
    volumePoints = clampDeduction(increasePct * 15, 15)
    volumeDetail += ` (+${Math.round(increasePct * 100)}%)`
  } else if (ticketsPrev30 === 0 && ticketsLast30 >= 3) {
    volumePoints = -5
    volumeDetail += ' (new activity, no prior baseline)'
  }
  factors.ticket_volume_trend = { label: 'Ticket volume trend', points: volumePoints, detail: volumeDetail }

  // 2. SLA breaches — a direct, contractual failure.
  factors.sla_breaches = {
    label: 'SLA breaches (90d)',
    points: clampDeduction(slaBreaches90 * 8, 30),
    detail: `${slaBreaches90} breached`,
  }

  // 3. Security incidents — weighted heaviest; even one is significant.
  factors.security_incidents = {
    label: 'Security incidents (90d)',
    points: clampDeduction(securityIncidents90 * 15, 40),
    detail: `${securityIncidents90} incident${securityIncidents90 === 1 ? '' : 's'}`,
  }

  // 4. Backup failures — a business-continuity risk, not just a support load.
  factors.backup_failures = {
    label: 'Backup failures (90d)',
    points: clampDeduction(backupFailures90 * 10, 30),
    detail: `${backupFailures90} failure${backupFailures90 === 1 ? '' : 's'}`,
  }

  // 5. Unresolved tickets — a small standing backlog is normal; only
  // penalise beyond that.
  factors.unresolved_tickets = {
    label: 'Unresolved tickets',
    points: clampDeduction((unresolvedCount - 2) * 3, 20),
    detail: `${unresolvedCount} open`,
  }

  // 6. Contract renewal proximity — not a fault of the client, but a
  // reason this account needs attention sooner rather than later,
  // especially if something else above is also off.
  factors.renewal_proximity = {
    label: 'Contract renewal proximity',
    points: renewalUrgency ? -RENEWAL_DEDUCTIONS[renewalUrgency] : 0,
    detail: renewalUrgency === 'overdue' ? 'renewal date has passed' : renewalUrgency ? `renews within ${renewalUrgency.replace('due-', '')} days` : 'not approaching renewal',
  }

  const totalDeduction = Object.values(factors).reduce((sum, f) => sum + f.points, 0)
  const score = Math.max(0, Math.min(100, 100 + totalDeduction))

  return { score, label: scoreLabel(score), factors }
}

module.exports = { computeHealthScore, scoreLabel }
