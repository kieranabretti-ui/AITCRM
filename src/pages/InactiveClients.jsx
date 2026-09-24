import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { fetchClients } from '../lib/clientsApi.js'
import { mrrDisplay, isMrrUnknown, fmtDate } from '../lib/pricing.js'
import { TierBadge, StatusBadge } from '../components/Badges.jsx'
import ClientDrawer from '../components/ClientDrawer.jsx'

export default function InactiveClients() {
  const { user, session } = useAuth()
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [drawer, setDrawer] = useState(null) // { mode: 'view', client }

  function reload() {
    fetchClients()
      .then(setClients)
      .catch((err) => setError(err.message || 'Could not load clients.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    reload()
  }, [])

  const inactive = useMemo(() => clients.filter((c) => c.status === 'paused' || c.status === 'churned'), [clients])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return inactive
      .filter((c) => (statusFilter === 'all' || c.status === statusFilter))
      .filter((c) => !q || `${c.business_name || ''} ${c.contact_name || ''}`.toLowerCase().includes(q))
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
  }, [inactive, search, statusFilter])

  if (loading) return <div className="py-24 text-center text-slate">Loading…</div>

  return (
    <div>
      <h1 className="mb-2 font-display text-2xl font-semibold">Paused &amp; churned</h1>
      <p className="mb-6 max-w-[60ch] text-slate">
        Clients not currently on the active roster. The Clients page only shows onboarding and active accounts —
        this is where a paused or churned one lives instead, still fully on file.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <input
          type="text"
          placeholder="Search business or contact name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="field-input max-w-[260px] flex-1"
        />
        <div className="flex flex-wrap gap-1.5">
          {[{ id: 'all', label: 'All' }, { id: 'paused', label: 'Paused' }, { id: 'churned', label: 'Churned' }].map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setStatusFilter(o.id)}
              aria-pressed={statusFilter === o.id}
              className={`rounded-full border px-3 py-1.5 text-[12.5px] ${statusFilter === o.id ? 'border-ink bg-ink text-paper' : 'border-stone bg-white text-slate hover:bg-paper-dim'}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="mb-5 rounded-[6px] border border-status-churned/30 bg-status-churned/10 p-3 text-[13px] text-status-churned">{error}</p>
      )}

      {visible.length === 0 ? (
        <div className="card p-16 text-center">
          <h2 className="font-display text-lg font-semibold">Nothing here{search ? ' matches that search' : ''}</h2>
          <p className="mx-auto mt-2 max-w-[40ch] text-slate">
            {search ? 'Try a different name.' : 'Paused and churned clients will show up here.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-stone">
          {visible.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setDrawer({ mode: 'view', client: c })}
              className="flex w-full flex-wrap items-center gap-2.5 border-b border-stone bg-white px-4 py-3 text-left last:border-b-0 hover:bg-paper-dim"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13.5px] font-semibold">{c.business_name || 'Untitled client'}</span>
                  <TierBadge tier={c.tier} />
                  <StatusBadge status={c.status} />
                </div>
                <div className="text-[12px] text-slate">{c.contact_name} · {isMrrUnknown(c) ? 'MRR unknown' : `was ${mrrDisplay(c)}/mo`}</div>
              </div>
              <span className="whitespace-nowrap text-[11.5px] text-slate">Updated {fmtDate(c.updated_at?.slice(0, 10))}</span>
            </button>
          ))}
        </div>
      )}

      {drawer && (
        <ClientDrawer
          mode={drawer.mode}
          client={drawer.client}
          userId={user.id}
          session={session}
          onClose={() => setDrawer(null)}
          onChanged={reload}
        />
      )}
    </div>
  )
}
