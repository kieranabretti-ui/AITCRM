// SLA state for the £10/device response SLA (clients.sla_addon) — a
// response-time commitment, not a resolution guarantee (see spec).
// Phase 1 computes this opportunistically at sync time; Phase 2's
// scheduled sla-check.js keeps it current between webhook deliveries.
const SLA_RESPONSE_HOURS = 2
const AT_RISK_WINDOW_MINUTES = 30

function computeSla({ hasSlaAddon, createdAt, firstResponseAt }) {
  if (!hasSlaAddon) return { slaDueAt: null, slaState: 'not_applicable' }

  const created = new Date(createdAt)
  const dueAt = new Date(created.getTime() + SLA_RESPONSE_HOURS * 3600_000)

  if (firstResponseAt && new Date(firstResponseAt) <= dueAt) {
    return { slaDueAt: dueAt.toISOString(), slaState: 'within_sla' }
  }

  const now = Date.now()
  if (now > dueAt.getTime()) return { slaDueAt: dueAt.toISOString(), slaState: 'breached' }
  if (dueAt.getTime() - now <= AT_RISK_WINDOW_MINUTES * 60_000) {
    return { slaDueAt: dueAt.toISOString(), slaState: 'at_risk' }
  }
  return { slaDueAt: dueAt.toISOString(), slaState: 'within_sla' }
}

module.exports = { computeSla, SLA_RESPONSE_HOURS }
