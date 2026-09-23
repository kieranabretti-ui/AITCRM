import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchOpenTickets } from '../lib/ticketsApi.js'
import { fetchClients } from '../lib/clientsApi.js'
import { fmtDateTime } from '../lib/pricing.js'
import { SeverityBadge, SlaStateBadge, MatchStatusBadge } from '../components/Badges.jsx'

// Phase 1: what's knowable from Jira sync alone (open/unassigned/unmatched
// counts, a recent-activity list). P1/P2 counts, SLA-at-risk totals and AI
// escalations land in Phase 2 once classification exists.
export default function Support() {
  const [tickets, setTickets] = useState([])
  const [clientsById, setClientsById] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([fetchOpenTickets(), fetchClients()])
      .then(([t, c]) => {
        setTickets(t)
        setClientsById(Object.fromEntries(c.map((cl) => [cl.id, cl])))
      })
      .catch((err) => setError(err.message || 'Could not load support data.'))
      .finally(() => setLoading(false))
  }, [])

  const open = useMemo(() => tickets.filter((t) => !t.resolved_at), [tickets])
  const unassigned = useMemo(() => open.filter((t) => !t.assigned_staff_id), [open])
  const unmatched = useMemo(() => tickets.filter((t) => t.match_status !== 'matched'), [tickets])
  const recent = useMemo(() => tickets.slice(0, 12), [tickets])

  if (loading) return <div className="py-24 text-center text-slate">Loading support activity…</div>

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold">Support</h1>
        {unmatched.length > 0 && (
          <Link to="/tickets/unmatched" className="btn btn-primary">
            Review {unmatched.length} unmatched ↗
          </Link>
        )}
      </div>

      {error && (
        <p className="mb-5 rounded-[6px] border border-status-churned/30 bg-status-churned/10 p-3 text-[13px] text-status-churned">
          {error}
        </p>
      )}

      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="card p-4">
          <div className="eyebrow">Open tickets</div>
          <div className="mt-1.5 font-display text-2xl font-bold tabular-nums">{open.length}</div>
        </div>
        <div className="card p-4">
          <div className="eyebrow">Unassigned</div>
          <div className="mt-1.5 font-display text-2xl font-bold tabular-nums">{unassigned.length}</div>
          <div className="mt-0.5 text-[12px] text-slate">of open tickets</div>
        </div>
        <Link to="/tickets/unmatched" className="card p-4 transition-colors hover:bg-paper-dim">
          <div className="eyebrow">Unmatched customer</div>
          <div className={`mt-1.5 font-display text-2xl font-bold tabular-nums ${unmatched.length ? 'text-status-onboarding' : ''}`}>
            {unmatched.length}
          </div>
          <div className="mt-0.5 text-[12px] text-slate">awaiting manual link</div>
        </Link>
      </section>

      <h2 className="eyebrow mb-3">Recent activity</h2>
      {recent.length === 0 ? (
        <div className="card p-16 text-center">
          <h2 className="font-display text-lg font-semibold">No tickets synced yet</h2>
          <p className="mx-auto mt-2 max-w-[40ch] text-slate">
            Tickets appear here once Jira Service Management starts sending webhook events.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-stone">
          {recent.map((t) => (
            <a
              key={t.id}
              href={t.jira_url || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-wrap items-center gap-2.5 border-b border-stone bg-white px-4 py-3 last:border-b-0 hover:bg-paper-dim"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13.5px] font-semibold">{t.summary || t.jira_issue_key}</span>
                  <SeverityBadge severity={t.severity} />
                  <MatchStatusBadge status={t.match_status} />
                </div>
                <div className="text-[12px] text-slate">
                  {t.jira_issue_key} · {clientsById[t.client_id]?.business_name || 'Unmatched'} · {t.jira_status || 'Unknown status'}
                </div>
              </div>
              <SlaStateBadge state={t.sla_state} />
              <span className="whitespace-nowrap text-[11.5px] text-slate">{fmtDateTime(t.last_synced_at)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
