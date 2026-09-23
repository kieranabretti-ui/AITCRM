import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { fetchClients } from '../lib/clientsApi.js'
import { fetchUnmatchedTickets, linkTicketToClient } from '../lib/ticketsApi.js'
import { fmtDate } from '../lib/pricing.js'
import { MatchStatusBadge, SeverityBadge } from '../components/Badges.jsx'

export default function UnmatchedTickets() {
  const { user } = useAuth()
  const [tickets, setTickets] = useState([])
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [linkingId, setLinkingId] = useState(null)
  const [queries, setQueries] = useState({}) // { [ticketId]: searchText }
  const [error, setError] = useState('')

  async function reload() {
    try {
      const [t, c] = await Promise.all([fetchUnmatchedTickets(), fetchClients()])
      setTickets(t)
      setClients(c)
      setError('')
    } catch (err) {
      setError(err.message || 'Could not load unmatched tickets.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  async function handleLink(ticket, clientId) {
    setLinkingId(ticket.id)
    try {
      await linkTicketToClient(ticket, clientId, user.id)
      setTickets((prev) => prev.filter((t) => t.id !== ticket.id))
    } catch (err) {
      setError(err.message || 'Could not link this ticket.')
    } finally {
      setLinkingId(null)
    }
  }

  if (loading) return <div className="py-24 text-center text-slate">Loading unmatched tickets…</div>

  return (
    <div>
      <h1 className="mb-2 font-display text-2xl font-semibold">Unmatched tickets</h1>
      <p className="mb-6 max-w-[60ch] text-slate">
        Jira tickets we couldn't confidently match to a client. Link each one below — the requester's
        email is remembered afterwards, so future tickets from them match automatically.
      </p>

      {error && (
        <p className="mb-5 rounded-[6px] border border-status-churned/30 bg-status-churned/10 p-3 text-[13px] text-status-churned">
          {error}
        </p>
      )}

      {tickets.length === 0 ? (
        <div className="card p-16 text-center">
          <h2 className="font-display text-lg font-semibold">Nothing to review</h2>
          <p className="mx-auto mt-2 max-w-[40ch] text-slate">Every Jira ticket has a matched customer.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {tickets.map((t) => (
            <TicketRow
              key={t.id}
              ticket={t}
              clients={clients}
              query={queries[t.id] || ''}
              onQueryChange={(v) => setQueries((q) => ({ ...q, [t.id]: v }))}
              linking={linkingId === t.id}
              onLink={(clientId) => handleLink(t, clientId)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TicketRow({ ticket, clients, query, onQueryChange, linking, onLink }) {
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return clients.filter((c) => (c.business_name || '').toLowerCase().includes(q)).slice(0, 6)
  }, [clients, query])

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{ticket.summary || ticket.jira_issue_key}</span>
            <SeverityBadge severity={ticket.severity} />
            <MatchStatusBadge status={ticket.match_status} />
          </div>
          <div className="mt-1 text-[12.5px] text-slate">
            {ticket.jira_issue_key} · {ticket.requester_name || ticket.requester_email || 'Unknown requester'}
            {ticket.requester_email ? ` (${ticket.requester_email})` : ''} · {fmtDate(ticket.created_at?.slice(0, 10))}
          </div>
          {ticket.jira_url && (
            <a href={ticket.jira_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-[12px] font-semibold text-petrol underline underline-offset-2">
              Open in Jira ↗
            </a>
          )}
        </div>

        <div className="w-full shrink-0 sm:w-[260px]">
          <input
            type="text"
            placeholder="Search client to link…"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            className="field-input"
            disabled={linking}
          />
          {matches.length > 0 && (
            <div className="mt-1.5 overflow-hidden rounded-[6px] border border-stone bg-white">
              {matches.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={linking}
                  onClick={() => onLink(c.id)}
                  className="block w-full border-b border-stone px-3 py-2 text-left text-[12.5px] last:border-b-0 hover:bg-paper-dim disabled:opacity-50"
                >
                  {c.business_name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
