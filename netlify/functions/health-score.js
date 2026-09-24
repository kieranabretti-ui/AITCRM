// Scheduled function (see netlify.toml) — recomputes every active
// client's health score once a day from ticket history, SLA breaches,
// and contract renewal proximity. See lib/healthScore.js for the
// (deterministic, explainable) scoring formula itself; this file is
// just the data-gathering around it.
const { createClient } = require('@supabase/supabase-js')
const { computeHealthScore } = require('./lib/healthScore.js')

// Mirrors src/lib/pricing.js's renewalUrgency — reimplemented here
// rather than imported since the frontend is an ES module and this
// function is CommonJS; keep the two in sync if the thresholds change.
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
    .select('id, contract_renewal_date')
    .eq('status', 'active')
  if (error) {
    console.error('[health-score] could not load active clients:', error.message)
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

      const result = computeHealthScore({
        ticketsLast30, ticketsPrev30, slaBreaches90, securityIncidents90, backupFailures90,
        unresolvedCount, renewalUrgency: renewalUrgency(client),
      })

      const { error: updateError } = await admin.from('clients').update({
        health_score: result.score,
        health_score_label: result.label,
        health_score_factors: result.factors,
        health_score_computed_at: new Date().toISOString(),
      }).eq('id', client.id)
      if (updateError) throw updateError

      scored++
    } catch (err) {
      // One client's data hiccup shouldn't stop the rest of the run —
      // log it and keep going.
      console.error(`[health-score] could not score client ${client.id}:`, err.message)
    }
  }

  console.log(`[health-score] scored ${scored}/${(clients || []).length} active clients`)
  return { statusCode: 200, body: JSON.stringify({ scored, total: (clients || []).length }) }
}
