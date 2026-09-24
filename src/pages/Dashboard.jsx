import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { fetchClients } from '../lib/clientsApi.js'
import {
  TIERS, STATUSES, gbp, computeMrr, mrrDisplay, isMrrUnknown,
  computeNextReviewDate, reviewUrgency, reviewDaysOut, renewalUrgency, renewalDaysOut, fmtDate,
} from '../lib/pricing.js'
import { TierBadge, StatusBadge, ReviewBadge, SlaPill, RenewalBadge, HealthScoreBadge } from '../components/Badges.jsx'
import ClientDrawer from '../components/ClientDrawer.jsx'

export default function Dashboard() {
  const { user, session } = useAuth()
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [tierFilter, setTierFilter] = useState('all')
  const [renewalFilter, setRenewalFilter] = useState(false)
  const [sort, setSort] = useState('name')

  const [drawer, setDrawer] = useState(null) // { mode: 'add'|'view'|'edit', client }

  async function reload() {
    try {
      setClients(await fetchClients())
      setLoadError('')
    } catch (err) {
      setLoadError(err.message || 'Could not load clients.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  const active = useMemo(() => clients.filter((c) => c.status === 'active'), [clients])
  const devices = useMemo(() => active.reduce((s, c) => s + (Number(c.device_count) || 0), 0), [active])
  const mrr = useMemo(() => active.reduce((s, c) => s + computeMrr(c), 0), [active])
  const mix = useMemo(() => {
    const m = { silver: 0, gold: 0, platinum: 0 }
    active.forEach((c) => { if (m[c.tier] !== undefined) m[c.tier]++ })
    return m
  }, [active])

  const overdueCount = active.filter((c) => reviewUrgency(c) === 'overdue').length
  const dueSoonCount = active.filter((c) => reviewUrgency(c) === 'due-soon').length
  const unknownCount = active.filter((c) => reviewUrgency(c) === 'unknown').length
  const renewalTotal = overdueCount + dueSoonCount + unknownCount
  const renewalParts = []
  if (overdueCount) renewalParts.push(`${overdueCount} overdue`)
  if (unknownCount) renewalParts.push(`${unknownCount} no review date`)
  if (dueSoonCount) renewalParts.push(`${dueSoonCount} due soon`)
  const renewalClass = overdueCount + unknownCount > 0 ? 'text-status-churned' : dueSoonCount > 0 ? 'text-status-onboarding' : 'text-status-active'

  const dueList = useMemo(
    () => clients.filter((c) => c.status === 'active' && reviewUrgency(c)).sort((a, b) => reviewDaysOut(a) - reviewDaysOut(b)),
    [clients],
  )

  const renewalList = useMemo(
    () => clients.filter((c) => c.status === 'active' && renewalUrgency(c)).sort((a, b) => renewalDaysOut(a) - renewalDaysOut(b)),
    [clients],
  )
  const renewalOverdueCount = renewalList.filter((c) => renewalUrgency(c) === 'overdue').length

  const atRiskList = useMemo(
    () => clients.filter((c) => c.status === 'active' && c.health_score != null && c.health_score < 60)
      .sort((a, b) => a.health_score - b.health_score),
    [clients],
  )

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = clients.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false
      if (tierFilter !== 'all' && c.tier !== tierFilter) return false
      if (renewalFilter && !reviewUrgency(c)) return false
      if (q) {
        const hay = `${c.business_name || ''} ${c.contact_name || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    list = list.slice().sort((a, b) => {
      if (sort === 'mrr') return computeMrr(b) - computeMrr(a)
      if (sort === 'review') return reviewDaysOut(a) - reviewDaysOut(b)
      if (sort === 'recent') return new Date(b.created_at) - new Date(a.created_at)
      return (a.business_name || '').localeCompare(b.business_name || '')
    })
    return list
  }, [clients, search, statusFilter, tierFilter, renewalFilter, sort])

  if (loading) return <div className="py-24 text-center text-slate">Loading clients…</div>

  return (
    <div>
      {loadError && (
        <p className="mb-5 rounded-[6px] border border-status-churned/30 bg-status-churned/10 p-3 text-[13px] text-status-churned">
          {loadError}
        </p>
      )}

      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold">Clients</h1>
        <button className="btn btn-primary" onClick={() => setDrawer({ mode: 'add', client: null })}>
          + Add client
        </button>
      </div>

      {/* Stats */}
      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <button
          type="button"
          onClick={() => setStatusFilter(statusFilter === 'active' ? 'all' : 'active')}
          className={`card p-4 text-left transition-colors ${statusFilter === 'active' ? 'border-petrol bg-petrol/5' : 'hover:bg-paper-dim'}`}
        >
          <div className="eyebrow">Active clients</div>
          <div className="mt-1.5 font-display text-2xl font-bold tabular-nums">{active.length}</div>
          <div className="mt-0.5 text-[12px] text-slate">{clients.length} total on file</div>
        </button>
        <div className="card p-4">
          <div className="eyebrow">Devices managed</div>
          <div className="mt-1.5 font-display text-2xl font-bold tabular-nums">{devices}</div>
          <div className="mt-0.5 text-[12px] text-slate">across active clients</div>
        </div>
        <div className="card p-4">
          <div className="eyebrow">Monthly recurring revenue</div>
          <div className="mt-1.5 font-display text-2xl font-bold tabular-nums">{gbp(mrr)}</div>
          <div className="mt-0.5 text-[12px] text-slate">from active clients</div>
        </div>
        <button
          type="button"
          onClick={() => setRenewalFilter((v) => !v)}
          className={`card p-4 text-left transition-colors ${renewalFilter ? 'border-status-onboarding bg-status-onboarding/10' : 'hover:bg-paper-dim'}`}
        >
          <div className="eyebrow">Reviews due</div>
          <div className={`mt-1.5 font-display text-2xl font-bold tabular-nums ${renewalClass}`}>{renewalTotal}</div>
          <div className="mt-0.5 text-[12px] text-slate">{renewalParts.length ? renewalParts.join(', ') : 'nothing due soon'}</div>
        </button>
        <div className="card p-4">
          <div className="eyebrow">Tier mix</div>
          <div className="mt-2 flex gap-3 text-[12.5px]">
            <span className="flex items-baseline gap-1"><b className="font-display text-base">{mix.silver}</b> Silver</span>
            <span className="flex items-baseline gap-1"><b className="font-display text-base text-brass-dark">{mix.gold}</b> Gold</span>
            <span className="flex items-baseline gap-1"><b className="font-display text-base text-petrol">{mix.platinum}</b> Platinum</span>
          </div>
        </div>
      </section>

      {/* Reviews due soon panel */}
      {dueList.length > 0 && (
        <section className={`mb-6 overflow-hidden rounded-md border ${overdueCount + unknownCount > 0 ? 'border-status-churned' : 'border-status-onboarding'}`}>
          <div className={`flex items-center justify-between px-4 py-2.5 ${overdueCount + unknownCount > 0 ? 'bg-status-churned/10' : 'bg-status-onboarding/10'}`}>
            <h2 className={`text-[13px] font-bold ${overdueCount + unknownCount > 0 ? 'text-status-churned' : 'text-status-onboarding'}`}>
              ⚠ Reviews due soon
            </h2>
            <span className="rounded-full bg-white px-2 font-mono text-[11px]">{dueList.length}</span>
          </div>
          <div className="bg-white">
            {dueList.map((c) => {
              const due = computeNextReviewDate(c)
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setDrawer({ mode: 'view', client: c })}
                  className="flex w-full items-center gap-3 border-t border-stone px-4 py-2.5 text-left hover:bg-paper-dim"
                >
                  <TierBadge tier={c.tier} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-semibold">{c.business_name || 'Untitled client'}</span>
                    <span className="block text-[12px] text-slate">{c.contact_name}</span>
                  </span>
                  <ReviewBadge client={c} />
                  <span className="whitespace-nowrap text-[12px] text-slate">
                    <b className="text-ink">{due ? fmtDate(due) : 'no review on record'}</b>
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* Contract renewals due panel */}
      {renewalList.length > 0 && (
        <section className={`mb-6 overflow-hidden rounded-md border ${renewalOverdueCount > 0 ? 'border-status-churned' : 'border-status-onboarding'}`}>
          <div className={`flex items-center justify-between px-4 py-2.5 ${renewalOverdueCount > 0 ? 'bg-status-churned/10' : 'bg-status-onboarding/10'}`}>
            <h2 className={`text-[13px] font-bold ${renewalOverdueCount > 0 ? 'text-status-churned' : 'text-status-onboarding'}`}>
              ⚠ Contract renewals due
            </h2>
            <span className="rounded-full bg-white px-2 font-mono text-[11px]">{renewalList.length}</span>
          </div>
          <div className="bg-white">
            {renewalList.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setDrawer({ mode: 'view', client: c })}
                className="flex w-full items-center gap-3 border-t border-stone px-4 py-2.5 text-left hover:bg-paper-dim"
              >
                <TierBadge tier={c.tier} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold">{c.business_name || 'Untitled client'}</span>
                  <span className="block text-[12px] text-slate">{c.contract_value_annual ? gbp(c.contract_value_annual) + '/yr' : c.contact_name}</span>
                </span>
                <RenewalBadge client={c} />
                <span className="whitespace-nowrap text-[12px] text-slate">
                  <b className="text-ink">{fmtDate(c.contract_renewal_date)}</b>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* At-risk clients (AI health score) panel */}
      {atRiskList.length > 0 && (
        <section className="mb-6 overflow-hidden rounded-md border border-status-churned">
          <div className="flex items-center justify-between bg-status-churned/10 px-4 py-2.5">
            <h2 className="text-[13px] font-bold text-status-churned">⚠ At-risk clients</h2>
            <span className="rounded-full bg-white px-2 font-mono text-[11px]">{atRiskList.length}</span>
          </div>
          <div className="bg-white">
            {atRiskList.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setDrawer({ mode: 'view', client: c })}
                className="flex w-full items-center gap-3 border-t border-stone px-4 py-2.5 text-left hover:bg-paper-dim"
              >
                <TierBadge tier={c.tier} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold">{c.business_name || 'Untitled client'}</span>
                  <span className="block text-[12px] text-slate">{c.contact_name}</span>
                </span>
                <HealthScoreBadge score={c.health_score} label={c.health_score_label} />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <input
          type="text"
          placeholder="Search business or contact name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="field-input max-w-[260px] flex-1"
        />
        <Chips value={statusFilter} onChange={setStatusFilter} options={[{ id: 'all', label: 'All statuses' }, ...STATUSES]} keyField="statusFilter" />
        <Chips value={tierFilter} onChange={setTierFilter} options={[{ id: 'all', label: 'All tiers' }, ...TIERS.map((t) => ({ id: t.id, label: t.name }))]} />
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="field-input w-auto">
          <option value="name">Sort: Name</option>
          <option value="mrr">Sort: MRR (high–low)</option>
          <option value="review">Sort: Next review</option>
          <option value="recent">Sort: Recently added</option>
        </select>
      </div>

      {/* Table (desktop) */}
      {clients.length === 0 ? (
        <div className="card p-16 text-center">
          <h2 className="font-display text-lg font-semibold">No clients yet</h2>
          <p className="mx-auto mt-2 max-w-[40ch] text-slate">
            Add your first client to start tracking packages, SLAs, endpoints and contacts in one place.
          </p>
          <button className="btn btn-primary mt-5" onClick={() => setDrawer({ mode: 'add', client: null })}>
            Add your first client
          </button>
        </div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-md border border-stone md:block">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-paper-dim">
                  {['Client', 'Tier', 'Devices', 'MRR', 'Status', 'Health', 'Next review'].map((h, i) => (
                    <th key={h} className={`border-b border-stone px-3.5 py-3 font-mono text-[10.5px] uppercase tracking-wideish text-slate ${i === 2 ? 'text-center' : i === 3 ? 'text-right' : ''}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr><td colSpan={7} className="p-6 text-center text-slate">No clients match these filters.</td></tr>
                ) : visible.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setDrawer({ mode: 'view', client: c })}
                    className="cursor-pointer border-b border-stone last:border-b-0 hover:bg-paper-dim"
                  >
                    <td className="px-3.5 py-3">
                      <div className="font-semibold">{c.business_name || 'Untitled client'}</div>
                      <div className="text-[12px] text-slate">{c.contact_name}</div>
                    </td>
                    <td className="px-3.5 py-3"><TierBadge tier={c.tier} /> <SlaPill show={c.sla_addon} /></td>
                    <td className="px-3.5 py-3 text-center tabular-nums">{c.device_count || 0}</td>
                    <td className={`px-3.5 py-3 text-right tabular-nums ${isMrrUnknown(c) ? 'text-slate' : ''}`}>{mrrDisplay(c)}</td>
                    <td className="px-3.5 py-3"><StatusBadge status={c.status} /></td>
                    <td className="px-3.5 py-3">{c.status === 'active' ? <HealthScoreBadge score={c.health_score} label={c.health_score_label} /> : null}</td>
                    <td className="px-3.5 py-3 text-slate">
                      {fmtDate(computeNextReviewDate(c)) || '—'} <ReviewBadge client={c} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cards (mobile) */}
          <div className="flex flex-col gap-2.5 md:hidden">
            {visible.map((c) => (
              <button
                key={c.id}
                onClick={() => setDrawer({ mode: 'view', client: c })}
                className="card p-4 text-left"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{c.business_name || 'Untitled client'}</div>
                    <div className="text-[12px] text-slate">{c.contact_name}</div>
                  </div>
                  <StatusBadge status={c.status} />
                </div>
                <div className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1.5 text-[12.5px] text-slate">
                  <span><TierBadge tier={c.tier} /> <SlaPill show={c.sla_addon} /></span>
                  <span><b className="text-ink">{c.device_count || 0}</b> devices</span>
                  <span><b className="text-ink">{mrrDisplay(c)}</b>{isMrrUnknown(c) ? '' : '/mo'}</span>
                  {c.status === 'active' && (
                    <span>Review {fmtDate(computeNextReviewDate(c)) || '—'} <ReviewBadge client={c} /></span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </>
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

function Chips({ value, onChange, options }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`rounded-full border px-3 py-1.5 text-[12.5px] ${value === o.id ? 'border-ink bg-ink text-paper' : 'border-stone bg-white text-slate hover:bg-paper-dim'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
