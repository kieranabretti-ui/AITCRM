// Scheduled function (see netlify.toml) — recomputes every onboarding
// or active client's health score and AI-suggested next action once a
// day, from ticket history, SLA breaches, and contract/review
// proximity. See lib/healthScore.js and lib/nextAction.js for the
// (deterministic, explainable) logic itself; this file is just the
// data-gathering both draw on, gathered once per client and reused for
// both so it isn't queried twice.
const { createClient } = require('@supabase/supabase-js')
const { computeHealthScore } = require('./lib/healthScore.js')
const { computeNextAction } = require('./lib/nextAction.js')

// Mirrors src/lib/pricing.js's renewalUrgency/reviewUrgency —
// reimplemented here rather than imported since the frontend is an ES
// module and this function is CommonJS; keep these in sync if the
// thresholds change.
function renewalUrgency(client) {
  if (!client?.contract_renewal_date) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(client.contract_renewal_date + 'T00:00:00')
  if (isNaN(due.getTime())) return null
  const days = Math.round((due.getTime() - today.getTime()) / 86400000)
  if (days < 0) return 'overdue'
  if (days <= 30) return 'due-30'
  if (days <= 60) return 'due-60'
  if (days <= 90) return 'due-90'
  return null
}

function reviewCadenceDays(tier) {
  return tier === 'silver' ? 30 : 91
}

function reviewUrgency(client) {
  if (client?.status !== 'active') return null
  const baseline = client.last_reviewed_date || client.start_date
  if (!baseline) return 'unknown'
  const due = new Date(baseline + 'T00:00:00')
  if (isNaN(due.getTime())) return 'unknown'
  due.setDate(due.getDate() + reviewCadenceDays(client.tier))
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.round((due.getTime() - today.getTime()) / 86400000)
  if (days < 0) return 'overdue'
  if (days <= 30) return 'due-soon'
  return null
}

async function countTickets(admin, clientId, filters) {
  let query = admin.from('tickets').select('id', { count: 'exact', head: true }).eq('client_id', clientId)
  for (const [fn, ...args] of filters) query = query[fn](...args)
  const { count, error } = await query
  if (error) throw error
  return count || 0
}

exports.handler = async () => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[health-score] missing Supabase env vars')
    return { statusCode: 500 }
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: clients, error } = await admin
    .from('clients')
    .select('id, status, tier, start_date, last_reviewed_date, contract_renewal_date')
    .in('status', ['active', 'onboarding'])
  if (error) {
    console.error('[health-score] could not load onboarding/active clients:', error.message)
    return { statusCode: 500 }
  }

  const now = Date.now()
  const iso = (daysAgo) => new Date(now - daysAgo * 86400_000).toISOString()

  let scored = 0
  for (const client of clients || []) {
    try {
      const [ticketsLast30, ticketsPrev30, slaBreaches90, securityIncidents90, backupFailures90, unresolvedCount] = await Promise.all([
        countTickets(admin, client.id, [['gte', 'created_at', iso(30)]]),
        countTickets(admin, client.id, [['gte', 'created_at', iso(60)], ['lt', 'created_at', iso(30)]]),
        countTickets(admin, client.id, [['eq', 'sla_state', 'breached'], ['gte', 'created_at', iso(90)]]),
        countTickets(admin, client.id, [['eq', 'category', 'Security'], ['gte', 'created_at', iso(90)]]),
        countTickets(admin, client.id, [['eq', 'category', 'Backup'], ['gte', 'created_at', iso(90)]]),
        countTickets(admin, client.id, [['is', 'resolved_at', null]]),
      ])

      const renewal = renewalUrgency(client)

      const healthResult = computeHealthScore({
        ticketsLast30, ticketsPrev30, slaBreaches90, securityIncidents90, backupFailures90,
        unresolvedCount, renewalUrgency: renewal,
      })

      const nextActionResult = computeNextAction({
        status: client.status,
        startDate: client.start_date,
        healthScore: healthResult.score,
        renewalUrgency: renewal,
        unresolvedCount,
        reviewUrgency: reviewUrgency(client),
      })

      const { error: updateError } = await admin.from('clients').update({
        health_score: healthResult.score,
        health_score_label: healthResult.label,
        health_score_factors: healthResult.factors,
        health_score_computed_at: new Date().toISOString(),
        next_action: nextActionResult.action,
        next_action_priority: nextActionResult.priority,
        next_action_computed_at: new Date().toISOString(),
      }).eq('id', client.id)
      if (updateError) throw updateError

      scored++
    } catch (err) {
      // One client's data hiccup shouldn't stop the rest of the run —
      // log it and keep going.
      console.error(`[health-score] could not score client ${client.id}:`, err.message)
    }
  }

  console.log(`[health-score] scored ${scored}/${(clients || []).length} onboarding/active clients`)
  return { statusCode: 200, body: JSON.stringify({ scored, total: (clients || []).length }) }
}
