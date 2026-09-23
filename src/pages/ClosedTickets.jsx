import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { fetchClosedTickets } from '../lib/ticketsApi.js'
import { fetchClients } from '../lib/clientsApi.js'
import { fmtDate } from '../lib/pricing.js'
import { SeverityBadge } from '../components/Badges.jsx'
import TicketDrawer from '../components/TicketDrawer.jsx'

export default function ClosedTickets() {
  const { session, user } = useAuth()
  const [tickets, setTickets] = useState([])
  const [clientsById, setClientsById] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [openTicket, setOpenTicket] = useState(null)

  function reload() {
    Promise.all([fetchClosedTickets(), fetchClients()])
      .then(([t, c]) => {
        setTickets(t)
        setClientsById(Object.fromEntries(c.map((cl) => [cl.id, cl])))
      })
      .catch((err) => setError(err.message || 'Could not load closed tickets.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    reload()
  }, [])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return tickets
    return tickets.filter((t) => (clientsById[t.client_id]?.business_name || 'unmatched').toLowerCase().includes(q))
  }, [tickets, clientsById, search])

  if (loading) return <div className="py-24 text-center text-slate">Loading closed tickets…</div>

  return (
    <div>
      <h1 className="mb-2 font-display text-2xl font-semibold">Closed tickets</h1>
      <p className="mb-6 max-w-[60ch] text-slate">
        Every resolved support ticket, most recently closed first. Jira holds the full conversation — this is a
        quick lookup by company.
      </p>

      <input
        type="text"
        placeholder="Search by company…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="field-input mb-4 max-w-[320px]"
      />

      {error && (
        <p className="mb-5 rounded-[6px] border border-status-churned/30 bg-status-churned/10 p-3 text-[13px] text-status-churned">
          {error}
        </p>
      )}

      {visible.length === 0 ? (
        <div className="card p-16 text-center">
          <h2 className="font-display text-lg font-semibold">No closed tickets{search ? ' match that search' : ' yet'}</h2>
          <p className="mx-auto mt-2 max-w-[40ch] text-slate">
            {search ? 'Try a different company name.' : 'Resolved tickets will show up here once Jira reports them as closed.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-stone">
          {visible.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setOpenTicket(t)}
              className="flex w-full flex-wrap items-center gap-2.5 border-b border-stone bg-white px-4 py-3 text-left last:border-b-0 hover:bg-paper-dim"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13.5px] font-semibold">{t.summary || t.jira_issue_key}</span>
                  <SeverityBadge severity={t.severity} />
                </div>
                <div className="text-[12px] text-slate">
                  {t.jira_issue_key} · {clientsById[t.client_id]?.business_name || 'Unmatched'}
                </div>
              </div>
              <span className="whitespace-nowrap text-[11.5px] text-slate">Closed {fmtDate(t.resolved_at?.slice(0, 10))}</span>
            </button>
          ))}
        </div>
      )}

      {openTicket && (
        <TicketDrawer
          ticket={openTicket}
          session={session}
          userId={user.id}
          onClose={() => setOpenTicket(null)}
          onChanged={reload}
        />
      )}
    </div>
  )
}
