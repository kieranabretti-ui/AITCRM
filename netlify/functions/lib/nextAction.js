// AI next-action suggestion — pure logic, no side effects, no network
// calls, same pattern as lib/healthScore.js/lib/sla.js. Called by the
// daily health-score scheduled function once per onboarding/active
// client, right after it computes that client's health score, so it
// can reuse the same gathered signals.
//
// Deterministic on purpose, for the same reason the health score is:
// every input here is an objective fact (a status, a day count, a
// score already computed elsewhere, a renewal window), not something
// that needs language understanding — a rules engine is instant,
// free, and its reasoning is always inspectable, unlike asking an LLM
// to invent a recommendation from the same numbers it would otherwise
// just be restating.
//
// Returns the single highest-priority suggestion, not a list — the
// point is to tell a technician the one most useful thing to do next,
// not to enumerate everything that could theoretically be checked.

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 }

function daysSince(dateStr) {
  if (!dateStr) return null
  const then = new Date(dateStr + 'T00:00:00')
  if (isNaN(then.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((today.getTime() - then.getTime()) / 86400000)
}

// { status, startDate, healthScore, healthLabel, renewalUrgency,
//   unresolvedCount, reviewUrgency } -> { action, priority } | null
function computeNextAction({
  status, startDate, healthScore = null, renewalUrgency = null, unresolvedCount = 0, reviewUrgency = null,
}) {
  const candidates = []

  if (status === 'onboarding') {
    const days = daysSince(startDate)
    if (days !== null && days > 30) {
      candidates.push({ priority: 'high', action: `Onboarding has been open ${days} days — check in and confirm what's blocking go-live.` })
    } else if (days !== null && days > 14) {
      candidates.push({ priority: 'medium', action: `Onboarding started ${days} days ago — confirm progress against the onboarding checklist.` })
    } else {
      candidates.push({ priority: 'low', action: 'Onboarding in progress — no action needed yet.' })
    }
  }

  if (healthScore !== null && healthScore < 40) {
    candidates.push({ priority: 'high', action: `Health score critical (${healthScore}) — schedule a review call to address recent issues.` })
  } else if (healthScore !== null && healthScore < 60) {
    candidates.push({ priority: 'medium', action: `Health score at risk (${healthScore}) — review recent tickets and SLA performance.` })
  }

  if (renewalUrgency === 'overdue') {
    candidates.push({ priority: 'high', action: 'Contract renewal date has passed — confirm renewal status urgently.' })
  } else if (renewalUrgency === 'due-30') {
    candidates.push({ priority: 'high', action: 'Contract renews within 30 days — start the renewal conversation if you haven\'t already.' })
  } else if (renewalUrgency === 'due-60') {
    candidates.push({ priority: 'medium', action: 'Contract renews within 60 days — plan the renewal conversation.' })
  }

  if (unresolvedCount >= 5) {
    candidates.push({ priority: 'medium', action: `${unresolvedCount} unresolved tickets — check whether any need escalation.` })
  }

  if (reviewUrgency === 'overdue') {
    candidates.push({ priority: 'medium', action: 'The scheduled account review is overdue — book it in.' })
  }

  if (candidates.length === 0) {
    return { action: 'No action needed — account looks healthy.', priority: 'low' }
  }

  candidates.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
  return candidates[0]
}

module.exports = { computeNextAction }
