import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { fetchOpportunities, createOpportunity, createOpportunityForNewLead } from '../lib/salesApi.js'
import { fetchClients } from '../lib/clientsApi.js'
import { STAGES, computeLastAction } from '../lib/sales.js'
import { gbp, fmtDate, fmtDateTime } from '../lib/pricing.js'
import { TierBadge } from '../components/Badges.jsx'
import OpportunityDrawer from '../components/OpportunityDrawer.jsx'
import LeadFinderPanel from '../components/LeadFinderPanel.jsx'
import SalesAdvisorPanel from '../components/SalesAdvisorPanel.jsx'

// Which stage columns are collapsed — a per-browser convenience like
// the lead finder's persisted search, not shared data, so
// localStorage is the right place for it.
const COLLAPSED_STAGES_KEY = 'aitcrm.sales.collapsedStages.v1'

function loadCollapsedStages() {
  try {
    const raw = localStorage.getItem(COLLAPSED_STAGES_KEY)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    return new Set()
  }
}

function saveCollapsedStages(set) {
  try {
    localStorage.setItem(COLLAPSED_STAGES_KEY, JSON.stringify(Array.from(set)))
  } catch {
    // Private browsing / storage disabled — collapse state just won't persist.
  }
}

export default function Sales() {
  const { user, session } = useAuth()
  const [opportunities, setOpportunities] = useState([])
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [showLeadFinder, setShowLeadFinder] = useState(false)
  const [showAdvisor, setShowAdvisor] = useState(false)
  const [search, setSearch] = useState('')
  const [collapsedStages, setCollapsedStages] = useState(loadCollapsedStages)

  function reload() {
    Promise.all([fetchOpportunities(), fetchClients()])
      .then(([o, c]) => { setOpportunities(o); setClients(c) })
      .catch((err) => setError(err.message || 'Could not load the sales pipeline.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    reload()
  }, [])

  function toggleStage(stageId) {
    setCollapsedStages((prev) => {
      const next = new Set(prev)
      if (next.has(stageId)) next.delete(stageId)
      else next.add(stageId)
      saveCollapsedStages(next)
      return next
    })
  }

  // Matches business name, contact name, or contact email — the three
  // things someone's actually likely to type in when hunting for one
  // lead among many.
  const filteredOpportunities = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return opportunities
    return opportunities.filter((o) => {
      const c = o.clients || {}
      return (
        (c.business_name || '').toLowerCase().includes(q) ||
        (c.contact_name || '').toLowerCase().includes(q) ||
        (c.contact_email || '').toLowerCase().includes(q)
      )
    })
  }, [opportunities, search])

  const byStage = useMemo(() => {
    const grouped = Object.fromEntries(STAGES.map((s) => [s.id, []]))
    filteredOpportunities.forEach((o) => { if (grouped[o.stage]) grouped[o.stage].push(o) })
    return grouped
  }, [filteredOpportunities])

  // Always reflects the real pipeline, not the current search — a
  // search is a lookup, not a reason for the headline numbers to move.
  const openPipelineValue = useMemo(
    () => opportunities.filter((o) => o.stage !== 'won' && o.stage !== 'lost').reduce((s, o) => s + (Number(o.estimated_value_annual) || 0), 0),
    [opportunities],
  )

  if (loading) return <div className="py-24 text-center text-slate">Loading pipeline…</div>

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Sales</h1>
          <p className="mt-1 text-[13px] text-slate">{gbp(openPipelineValue)} in open pipeline · {opportunities.length} opportunities</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost" onClick={() => setShowAdvisor(true)}>Ask your sales guru</button>
          <button className="btn btn-ghost" onClick={() => setShowLeadFinder(true)}>Find leads</button>
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ New opportunity</button>
        </div>
      </div>

      {error && (
        <p className="mb-5 rounded-[6px] border border-status-churned/30 bg-status-churned/10 p-3 text-[13px] text-status-churned">{error}</p>
      )}

      {opportunities.length > 0 && (
        <div className="relative mb-4 max-w-[320px]">
          <input
            type="text"
            placeholder="Search leads by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="field-input pr-8"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate hover:text-ink"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {opportunities.length === 0 ? (
        <div className="card p-16 text-center">
          <h2 className="font-display text-lg font-semibold">No opportunities yet</h2>
          <p className="mx-auto mt-2 max-w-[40ch] text-slate">Add your first prospect to start tracking the pipeline.</p>
          <button className="btn btn-primary mt-5" onClick={() => setShowNew(true)}>+ New opportunity</button>
        </div>
      ) : (
        <div className="flex gap-3.5 overflow-x-auto pb-2">
          {STAGES.map((stage) => {
            const rows = byStage[stage.id] || []
            const value = rows.reduce((s, o) => s + (Number(o.estimated_value_annual) || 0), 0)
            const collapsed = collapsedStages.has(stage.id)
            return (
              <div key={stage.id} className="w-[260px] shrink-0">
                <button
                  type="button"
                  onClick={() => toggleStage(stage.id)}
                  aria-expanded={!collapsed}
                  className="mb-2.5 flex w-full items-center justify-between gap-2 px-1 text-left"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="shrink-0 text-[10px] text-slate">{collapsed ? '▸' : '▾'}</span>
                    <h2 className="truncate text-[12.5px] font-bold uppercase tracking-wideish text-slate">{stage.label}</h2>
                  </span>
                  <span className="shrink-0 rounded-full bg-paper-dim px-2 font-mono text-[11px]">{rows.length}</span>
                </button>
                {!collapsed && (
                <div className="flex flex-col gap-2">
                  {rows.map((o) => {
                    const lastAction = computeLastAction(o)
                    return (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => setOpenId(o.id)}
                        className="card p-3 text-left hover:border-petrol"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="min-w-0 truncate text-[13px] font-semibold">{o.clients?.business_name || 'Untitled prospect'}</span>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {o.outreach_sent_at && (
                              <span
                                className="rounded-full bg-petrol/10 px-1.5 py-0.5 text-[10px] font-semibold text-petrol"
                                title={`Outreach email sent ${fmtDateTime(o.outreach_sent_at)}`}
                              >
                                ✉ Sent
                              </span>
                            )}
                            <TierBadge tier={o.clients?.tier} />
                          </div>
                        </div>
                        {o.clients?.contact_name && <div className="mt-0.5 truncate text-[11.5px] text-slate">{o.clients.contact_name}</div>}
                        <div className="mt-2 flex items-center justify-between text-[12px]">
                          <span className="font-semibold text-petrol-dark">{o.estimated_value_annual ? gbp(o.estimated_value_annual) : '—'}</span>
                          {o.expected_close_date && <span className="text-slate">{fmtDate(o.expected_close_date)}</span>}
                        </div>
                        {o.ai_draft_message && <div className="mt-1.5 text-[10.5px] text-petrol">AI draft ready</div>}
                        {lastAction && (
                          <div className="mt-1.5 truncate text-[10.5px] text-slate" title={lastAction.label}>
                            {lastAction.label} · {fmtDateTime(lastAction.at)}
                          </div>
                        )}
                      </button>
                    )
                  })}
                  {rows.length === 0 && (
                    <div className="rounded-md border border-dashed border-stone p-3 text-center text-[11.5px] text-slate">
                      {search.trim() ? 'No matches' : 'Empty'}
                    </div>
                  )}
                </div>
                )}
                {value > 0 && <div className="mt-2 px-1 text-[11px] text-slate">{gbp(value)} total</div>}
              </div>
            )
          })}
        </div>
      )}

      {openId && (
        <OpportunityDrawer
          opportunityId={openId}
          session={session}
          onClose={() => setOpenId(null)}
          onChanged={reload}
        />
      )}

      {showNew && (
        <NewOpportunityModal
          clients={clients}
          userId={user.id}
          onClose={() => setShowNew(false)}
          onCreated={(opp) => { setShowNew(false); reload(); setOpenId(opp.id) }}
        />
      )}

      {showLeadFinder && (
        <LeadFinderPanel
          session={session}
          userId={user.id}
          onClose={() => setShowLeadFinder(false)}
          onLeadAdded={reload}
        />
      )}

      {showAdvisor && (
        <SalesAdvisorPanel
          session={session}
          userId={user.id}
          opportunities={opportunities}
          onClose={() => setShowAdvisor(false)}
          onSaved={reload}
        />
      )}
    </div>
  )
}

function NewOpportunityModal({ clients, userId, onClose, onCreated }) {
  const [query, setQuery] = useState('')
  const [selectedClient, setSelectedClient] = useState(null)
  const [newProspect, setNewProspect] = useState(false)
  const [form, setForm] = useState({ business_name: '', contact_name: '', contact_email: '', estimated_value_annual: '', expected_close_date: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return clients.filter((c) => (c.business_name || '').toLowerCase().includes(q)).slice(0, 6)
  }, [clients, query])

  async function handleCreate() {
    setSaving(true)
    setError('')
    const oppFields = {
      estimated_value_annual: form.estimated_value_annual === '' ? null : Number(form.estimated_value_annual),
      expected_close_date: form.expected_close_date || null,
      notes: form.notes,
    }
    try {
      let opp
      if (newProspect) {
        if (!form.business_name.trim()) throw new Error('Business name is required.')
        opp = await createOpportunityForNewLead(
          { business_name: form.business_name.trim(), contact_name: form.contact_name, contact_email: form.contact_email },
          oppFields,
          userId,
        )
      } else {
        if (!selectedClient) throw new Error('Pick a client, or switch to "New prospect".')
        opp = await createOpportunity(selectedClient.id, oppFields, userId)
      }
      onCreated(opp)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink/40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
        <div className="max-h-[85vh] w-full max-w-[440px] overflow-y-auto rounded-md bg-paper p-5 shadow-card">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">New opportunity</h2>
            <button onClick={onClose} className="rounded border border-stone p-1.5 hover:bg-paper-dim" aria-label="Close">✕</button>
          </div>

          {error && (
            <p className="mb-3.5 rounded-[6px] border border-status-churned/30 bg-status-churned/10 p-3 text-[13px] text-status-churned">{error}</p>
          )}

          {!newProspect ? (
            <>
              <label className="mb-1.5 block text-[12.5px] font-semibold">Client</label>
              {selectedClient ? (
                <div className="mb-3.5 flex items-center justify-between rounded-[6px] border border-petrol bg-petrol/5 p-2.5">
                  <span className="text-[13px] font-semibold">{selectedClient.business_name}</span>
                  <button onClick={() => setSelectedClient(null)} className="text-[11.5px] text-slate underline underline-offset-2">Change</button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    placeholder="Search existing clients…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="field-input mb-1.5"
                  />
                  {matches.length > 0 && (
                    <div className="mb-3.5 overflow-hidden rounded-[6px] border border-stone bg-white">
                      {matches.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => { setSelectedClient(c); setQuery('') }}
                          className="block w-full border-b border-stone px-3 py-2 text-left text-[12.5px] last:border-b-0 hover:bg-paper-dim"
                        >
                          {c.business_name}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              <button onClick={() => setNewProspect(true)} className="mb-3.5 text-[12px] font-semibold text-petrol underline underline-offset-2">
                + This is a new prospect, not in Clients yet
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setNewProspect(false)} className="mb-2 text-[11.5px] text-slate underline underline-offset-2">← Pick an existing client instead</button>
              <Field label="Business name *" value={form.business_name} onChange={(v) => setForm((f) => ({ ...f, business_name: v }))} />
              <Field label="Contact name" value={form.contact_name} onChange={(v) => setForm((f) => ({ ...f, contact_name: v }))} />
              <Field type="email" label="Contact email" value={form.contact_email} onChange={(v) => setForm((f) => ({ ...f, contact_email: v }))} />
              <p className="mb-3.5 text-[11px] text-slate">Creates a new client record (status: Lead) alongside this opportunity.</p>
            </>
          )}

          <div className="grid grid-cols-2 gap-3.5">
            <Field type="number" label="Est. annual value (£)" value={form.estimated_value_annual} onChange={(v) => setForm((f) => ({ ...f, estimated_value_annual: v }))} />
            <Field type="date" label="Expected close" value={form.expected_close_date} onChange={(v) => setForm((f) => ({ ...f, expected_close_date: v }))} />
          </div>
          <label className="mb-1.5 block text-[12.5px] font-semibold">Notes</label>
          <textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="field-input mb-4 resize-y" />

          <div className="flex justify-end gap-2">
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handleCreate} disabled={saving}>{saving ? 'Creating…' : 'Create opportunity'}</button>
          </div>
        </div>
      </div>
    </>
  )
}

function Field({ label, value, onChange, type = 'text' }) {
  return (
    <div className="mb-3.5">
      <label className="mb-1.5 block text-[12.5px] font-semibold">{label}</label>
      <input type={type} value={value || ''} onChange={(e) => onChange(e.target.value)} className="field-input" />
    </div>
  )
}
