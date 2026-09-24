import { useEffect, useRef, useState } from 'react'
import {
  TIERS, STATUSES, LEAD_SOURCES, gbp, computeMrr, mrrDisplay, isMrrUnknown,
  computeNextReviewDate, reviewCadenceDays, fmtDate, fmtDateTime, fmtBytes, tierName, leadSourceLabel,
} from '../lib/pricing.js'
import { TierBadge, StatusBadge, ReviewBadge, SeverityBadge, SlaStateBadge, RenewalBadge, HealthScoreBadge } from './Badges.jsx'
import {
  createClient, updateClient, deleteClient, addActivity, removeActivity,
  uploadContract, removeContract, contractUrl,
} from '../lib/clientsApi.js'
import { fetchTicketsForClient } from '../lib/ticketsApi.js'
import TicketDrawer from './TicketDrawer.jsx'

const emptyForm = {
  business_name: '', contact_name: '', contact_email: '', contact_phone: '',
  secondary_contact_name: '', secondary_contact_phone: '', site_address: '',
  tier: 'gold', device_count: '', sla_addon: false, status: 'lead',
  start_date: '', direct_debit: false, platform: '', on_site_server: false,
  lead_source: '', lead_source_detail: '', notes: '',
  contract_start_date: '', contract_renewal_date: '', notice_period_days: '',
  contract_value_annual: '', services_included: '', price_increase_pct: '',
  auto_renewal: true, contract_sla_terms: '',
}

// services_included is stored as a jsonb array — the edit form just
// works with a comma-separated string, split/joined at the boundary.
function servicesToText(arr) { return Array.isArray(arr) ? arr.join(', ') : '' }
function textToServices(text) { return text.split(',').map((s) => s.trim()).filter(Boolean) }

// Every place form state is (re)built from a client record needs the
// same services_included array->text conversion — one helper instead
// of four inline spreads drifting out of sync.
function toFormState(client) {
  if (!client) return emptyForm
  return { ...emptyForm, ...client, services_included: servicesToText(client.services_included) }
}

export default function ClientDrawer({ mode: initialMode, client, userId, session, onClose, onChanged }) {
  const [mode, setMode] = useState(initialMode === 'add' ? 'edit' : 'view')
  const [current, setCurrent] = useState(client)
  const [form, setForm] = useState(toFormState(client))
  const [saving, setSaving] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewDate, setReviewDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [activityDraft, setActivityDraft] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [contractLinks, setContractLinks] = useState({})
  const fileInputRef = useRef(null)
  const [tickets, setTickets] = useState([])
  const [ticketsLoading, setTicketsLoading] = useState(false)
  const [openTicket, setOpenTicket] = useState(null)

  function reloadTickets() {
    if (!current?.id) return
    fetchTicketsForClient(current.id).then(setTickets).catch(() => {})
  }

  const isNew = !current

  useEffect(() => {
    if (!current?.id) return
    let active = true
    setTicketsLoading(true)
    fetchTicketsForClient(current.id)
      .then((rows) => { if (active) setTickets(rows) })
      .catch(() => { if (active) setTickets([]) })
      .finally(() => { if (active) setTicketsLoading(false) })
    return () => { active = false }
  }, [current?.id])

  async function handleSave(e) {
    e.preventDefault()
    if (!form.business_name.trim()) return
    setSaving(true)
    const payload = {
      business_name: form.business_name.trim(),
      contact_name: form.contact_name || '',
      contact_email: form.contact_email || '',
      contact_phone: form.contact_phone || '',
      secondary_contact_name: form.secondary_contact_name || '',
      secondary_contact_phone: form.secondary_contact_phone || '',
      site_address: form.site_address || '',
      tier: form.tier || 'gold',
      device_count: Number(form.device_count) || 0,
      sla_addon: !!form.sla_addon,
      status: form.status || 'lead',
      start_date: form.start_date || null,
      direct_debit: !!form.direct_debit,
      platform: form.platform || '',
      on_site_server: !!form.on_site_server,
      lead_source: form.lead_source || '',
      lead_source_detail: form.lead_source_detail || '',
      notes: form.notes || '',
      contract_start_date: form.contract_start_date || null,
      contract_renewal_date: form.contract_renewal_date || null,
      notice_period_days: form.notice_period_days === '' ? null : Number(form.notice_period_days),
      contract_value_annual: form.contract_value_annual === '' ? null : Number(form.contract_value_annual),
      services_included: textToServices(form.services_included || ''),
      price_increase_pct: form.price_increase_pct === '' ? null : Number(form.price_increase_pct),
      auto_renewal: !!form.auto_renewal,
      contract_sla_terms: form.contract_sla_terms || '',
    }
    try {
      let saved
      if (isNew) {
        saved = await createClient(payload, userId)
      } else {
        await updateClient(current.id, payload)
        saved = { ...current, ...payload }
      }
      setCurrent(saved)
      setForm(toFormState(saved))
      setMode('view')
      onChanged()
    } catch (err) {
      setUploadError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    await deleteClient(current.id)
    onChanged()
    onClose()
  }

  async function handleMarkReviewed() {
    const nextDue = computeNextReviewDate({ ...current, last_reviewed_date: reviewDate })
    const text = `Reviewed on ${fmtDate(reviewDate)}${nextDue ? ` — next review due ${fmtDate(nextDue)}.` : '.'}`
    const row = await addActivity(current.id, text, userId)
    await updateClient(current.id, { last_reviewed_date: reviewDate })
    const updated = { ...current, last_reviewed_date: reviewDate, activity: [row, ...(current.activity || [])] }
    setCurrent(updated)
    setForm(toFormState(updated))
    setReviewOpen(false)
    onChanged()
  }

  async function handleAddActivity() {
    const text = activityDraft.trim()
    if (!text) return
    const row = await addActivity(current.id, text, userId)
    setActivityDraft('')
    setCurrent((c) => ({ ...c, activity: [row, ...(c.activity || [])] }))
    onChanged()
  }

  async function handleRemoveActivity(id) {
    await removeActivity(id)
    setCurrent((c) => ({ ...c, activity: (c.activity || []).filter((a) => a.id !== id) }))
    onChanged()
  }

  async function handleUpload(file) {
    if (!file) return
    setUploadError('')
    if (file.type !== 'application/pdf') { setUploadError('Only PDF files are accepted.'); return }
    if (file.size > 20 * 1024 * 1024) { setUploadError('That file is over the 20MB limit.'); return }
    setUploading(true)
    try {
      const row = await uploadContract(current.id, file, userId)
      setCurrent((c) => ({ ...c, contracts: [row, ...(c.contracts || [])] }))
      onChanged()
    } catch (err) {
      setUploadError(err.message)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleRemoveContract(contract) {
    await removeContract(contract.id, contract.storage_path)
    setCurrent((c) => ({ ...c, contracts: (c.contracts || []).filter((f) => f.id !== contract.id) }))
    onChanged()
  }

  async function handleViewContract(contract) {
    if (contractLinks[contract.id]) {
      window.open(contractLinks[contract.id], '_blank', 'noopener')
      return
    }
    const url = await contractUrl(contract.storage_path)
    setContractLinks((m) => ({ ...m, [contract.id]: url }))
    window.open(url, '_blank', 'noopener')
  }

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink/40" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[480px] flex-col bg-paper shadow-card">
        <div className="flex items-center justify-between gap-3 border-b border-stone px-5 py-4">
          <h2 className="font-display text-lg font-semibold">
            {mode === 'edit' ? (isNew ? 'Add client' : 'Edit client') : current.business_name || 'Untitled client'}
          </h2>
          <button onClick={onClose} className="rounded border border-stone p-1.5 hover:bg-paper-dim" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {mode === 'view' ? (
            <ViewBody
              c={current}
              confirmingDelete={confirmingDelete}
              setConfirmingDelete={setConfirmingDelete}
              onDelete={handleDelete}
              reviewOpen={reviewOpen}
              setReviewOpen={setReviewOpen}
              reviewDate={reviewDate}
              setReviewDate={setReviewDate}
              onMarkReviewed={handleMarkReviewed}
              activityDraft={activityDraft}
              setActivityDraft={setActivityDraft}
              onAddActivity={handleAddActivity}
              onRemoveActivity={handleRemoveActivity}
              uploading={uploading}
              uploadError={uploadError}
              fileInputRef={fileInputRef}
              onUpload={handleUpload}
              onRemoveContract={handleRemoveContract}
              onViewContract={handleViewContract}
              tickets={tickets}
              ticketsLoading={ticketsLoading}
              onOpenTicket={setOpenTicket}
            />
          ) : (
            <EditForm form={form} setForm={setForm} />
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-stone px-5 py-3.5">
          {mode === 'view' ? (
            <>
              <button className="btn btn-danger" onClick={() => setConfirmingDelete(true)}>Delete</button>
              <button className="btn btn-primary" onClick={() => setMode('edit')}>Edit client</button>
            </>
          ) : (
            <>
              <button
                className="btn btn-ghost"
                onClick={() => (isNew ? onClose() : (setForm(toFormState(current)), setMode('view')))}
              >
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save client'}
              </button>
            </>
          )}
        </div>
      </aside>

      {openTicket && (
        <TicketDrawer
          ticket={openTicket}
          session={session}
          userId={userId}
          onClose={() => setOpenTicket(null)}
          onChanged={reloadTickets}
        />
      )}
    </>
  )
}

function ViewItem({ label, children }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-wideish text-slate">{label}</div>
      <div className="mt-0.5 text-[13.5px]">{children || <span className="text-slate">—</span>}</div>
    </div>
  )
}

function ViewBody({
  c, confirmingDelete, setConfirmingDelete, onDelete, reviewOpen, setReviewOpen, reviewDate, setReviewDate,
  onMarkReviewed, activityDraft, setActivityDraft, onAddActivity, onRemoveActivity,
  uploading, uploadError, fileInputRef, onUpload, onRemoveContract, onViewContract,
  tickets, ticketsLoading, onOpenTicket,
}) {
  const nextDue = computeNextReviewDate(c)
  const previewDue = computeNextReviewDate({ ...c, last_reviewed_date: reviewDate })

  return (
    <>
      {confirmingDelete && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-[6px] border border-status-churned bg-status-churned/10 p-3">
          <p className="text-[12.5px] font-semibold text-status-churned">Delete {c.business_name || 'this client'} for good?</p>
          <div className="flex shrink-0 gap-2">
            <button className="btn btn-ghost px-2.5 py-1 text-[12px]" onClick={() => setConfirmingDelete(false)}>Cancel</button>
            <button className="btn btn-danger px-2.5 py-1 text-[12px]" onClick={onDelete}>Delete permanently</button>
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <TierBadge tier={c.tier} />
        {c.sla_addon && <span className="rounded bg-brass/15 px-2 py-0.5 text-[11px] font-semibold text-brass-dark">+ Premium SLA</span>}
        <StatusBadge status={c.status} />
        <RenewalBadge client={c} />
        {c.status === 'active' && <HealthScoreBadge score={c.health_score} label={c.health_score_label} />}
      </div>

      <div className="mb-5 flex items-baseline justify-between rounded-[6px] border border-stone bg-paper-dim p-3.5">
        <span className="text-[12.5px] text-slate">Monthly recurring revenue</span>
        <span className={`font-display text-xl font-bold tabular-nums ${isMrrUnknown(c) ? 'text-slate' : 'text-petrol'}`}>{mrrDisplay(c)}</span>
      </div>

      <div className="grid grid-cols-2 gap-x-5 gap-y-3.5">
        <ViewItem label="Primary contact">{c.contact_name}</ViewItem>
        <ViewItem label="Contact email">{c.contact_email}</ViewItem>
        <ViewItem label="Contact phone">{c.contact_phone}</ViewItem>
        <ViewItem label="Devices / endpoints">{c.device_count}</ViewItem>
        <ViewItem label="Secondary contact">{c.secondary_contact_name}</ViewItem>
        <ViewItem label="Secondary phone">{c.secondary_contact_phone}</ViewItem>
        <ViewItem label="Site address">{c.site_address}</ViewItem>
        <ViewItem label="Start date">{fmtDate(c.start_date)}</ViewItem>
        <ViewItem label="Next review">
          <span className="flex flex-wrap items-center gap-1.5">
            {fmtDate(nextDue) || <span className="text-slate">—</span>}
            <ReviewBadge client={c} />
          </span>
          {reviewOpen ? (
            <div className="mt-2 flex flex-col gap-2.5 rounded-[6px] border border-stone bg-paper-dim p-3">
              <div>
                <label className="mb-1 block text-[11px] font-semibold">Reviewed on</label>
                <input type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} className="field-input max-w-[180px]" />
              </div>
              <p className="text-[11.5px] leading-relaxed text-slate">
                Next review will be set to <b className="text-ink">{fmtDate(previewDue) || '—'}</b> — {reviewCadenceDays(c.tier)} days later,
                per the {tierName(c.tier)} cadence.
              </p>
              <div className="flex gap-2">
                <button className="btn btn-primary px-2.5 py-1 text-[12px]" onClick={onMarkReviewed}>Save</button>
                <button className="btn btn-ghost px-2.5 py-1 text-[12px]" onClick={() => setReviewOpen(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button className="mt-1 text-[11.5px] font-semibold text-petrol underline underline-offset-2" onClick={() => setReviewOpen(true)}>
              Mark reviewed…
            </button>
          )}
        </ViewItem>
        <ViewItem label="Direct Debit set up">{c.direct_debit ? 'Yes' : 'No'}</ViewItem>
        <ViewItem label="Platform">{platformLabel(c.platform)}</ViewItem>
        <ViewItem label="On-site server">{c.on_site_server ? 'Yes' : 'No'}</ViewItem>
        <ViewItem label="Lead source">
          {leadSourceLabel(c.lead_source)}{c.lead_source_detail ? ` — ${c.lead_source_detail}` : ''}
        </ViewItem>
        <ViewItem label="Last reviewed">{fmtDate(c.last_reviewed_date)}</ViewItem>
      </div>

      <div className="mt-5 border-t border-stone pt-4">
        <div className="mb-2.5 font-mono text-[10px] uppercase tracking-wideish text-slate">Contract</div>
        <div className="grid grid-cols-2 gap-x-5 gap-y-3.5">
          <ViewItem label="Start date">{fmtDate(c.contract_start_date)}</ViewItem>
          <ViewItem label="Renewal date">
            <span className="flex flex-wrap items-center gap-1.5">
              {fmtDate(c.contract_renewal_date) || <span className="text-slate">—</span>}
              <RenewalBadge client={c} />
            </span>
          </ViewItem>
          <ViewItem label="Notice period">{c.notice_period_days ? `${c.notice_period_days} days` : ''}</ViewItem>
          <ViewItem label="Annual value">{c.contract_value_annual ? gbp(c.contract_value_annual) : ''}</ViewItem>
          <ViewItem label="Annual price increase">{c.price_increase_pct ? `${c.price_increase_pct}%` : ''}</ViewItem>
          <ViewItem label="Auto-renewal">{c.contract_renewal_date ? (c.auto_renewal ? 'Yes' : 'No') : ''}</ViewItem>
        </div>
        {c.services_included?.length > 0 && (
          <div className="mt-3.5">
            <div className="font-mono text-[10px] uppercase tracking-wideish text-slate">Services included</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {c.services_included.map((s) => (
                <span key={s} className="rounded bg-paper-dim px-2 py-0.5 text-[11.5px]">{s}</span>
              ))}
            </div>
          </div>
        )}
        {c.contract_sla_terms && (
          <div className="mt-3.5">
            <div className="font-mono text-[10px] uppercase tracking-wideish text-slate">Contractual SLA terms</div>
            <div className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed">{c.contract_sla_terms}</div>
          </div>
        )}
      </div>

      {c.status === 'active' && c.health_score != null && (
        <div className="mt-5 border-t border-stone pt-4">
          <div className="mb-2.5 flex items-center justify-between">
            <div className="font-mono text-[10px] uppercase tracking-wideish text-slate">Health score</div>
            <HealthScoreBadge score={c.health_score} label={c.health_score_label} />
          </div>
          {c.health_score_factors && Object.keys(c.health_score_factors).length > 0 && (
            <div className="flex flex-col gap-1.5">
              {Object.entries(c.health_score_factors).map(([key, f]) => (
                <div key={key} className="flex items-center justify-between gap-2 text-[12.5px]">
                  <span className="text-slate">{f.label || key}</span>
                  <span className={f.points < 0 ? 'font-mono text-status-churned' : 'font-mono text-slate'}>
                    {f.points > 0 ? '+' : ''}{f.points}
                  </span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-[11px] text-slate">
            Computed daily from ticket volume, SLA breaches, security incidents, backup failures, unresolved tickets and contract renewal proximity.
          </p>
        </div>
      )}

      <div className="mt-5 border-t border-stone pt-4">
        <div className="mb-2.5 flex items-center justify-between">
          <div className="font-mono text-[10px] uppercase tracking-wideish text-slate">Support</div>
          {tickets.length > 0 && <span className="text-[11.5px] text-slate">{tickets.length} open ticket{tickets.length === 1 ? '' : 's'}</span>}
        </div>
        {ticketsLoading ? (
          <p className="mb-1 text-[12.5px] text-slate">Loading tickets…</p>
        ) : tickets.length === 0 ? (
          <p className="mb-1 text-[12.5px] text-slate">No open support tickets. Completed tickets stay in Jira.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {tickets.slice(0, 6).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onOpenTicket(t)}
                className="flex items-center gap-2.5 rounded-[6px] border border-stone bg-white p-2.5 text-left hover:border-petrol"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold">{t.summary || t.jira_issue_key}</div>
                  <div className="text-[11.5px] text-slate">
                    {t.jira_issue_key} · {t.jira_status || 'Unknown status'} · {fmtDate(t.created_at?.slice(0, 10))}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <SeverityBadge severity={t.severity} />
                  <SlaStateBadge state={t.sla_state} />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-5 border-t border-stone pt-4">
        <div className="mb-2.5 font-mono text-[10px] uppercase tracking-wideish text-slate">Activity</div>
        {(!c.activity || c.activity.length === 0) ? (
          <p className="mb-3 text-[12.5px] text-slate">No activity logged yet.</p>
        ) : (
          <div className="mb-3 flex flex-col gap-2.5">
            {c.activity.map((a) => (
              <div key={a.id} className="group flex gap-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-petrol" />
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[10.5px] text-slate">{fmtDateTime(a.created_at)}</div>
                  <div className="whitespace-pre-wrap text-[13px]">{a.text}</div>
                </div>
                <button
                  onClick={() => onRemoveActivity(a.id)}
                  className="shrink-0 text-[11px] text-slate opacity-0 group-hover:opacity-100 hover:text-status-churned"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <textarea
            rows={1}
            value={activityDraft}
            onChange={(e) => setActivityDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onAddActivity() } }}
            placeholder="Log a call, a ticket, an on-site visit…"
            className="field-input flex-1 resize-y"
          />
          <button onClick={onAddActivity} disabled={!activityDraft.trim()} className="btn btn-primary shrink-0 disabled:opacity-50">Log</button>
        </div>
      </div>

      <div className="mt-5 border-t border-stone pt-4">
        <div className="mb-2.5 font-mono text-[10px] uppercase tracking-wideish text-slate">Signed contracts</div>
        {(!c.contracts || c.contracts.length === 0) ? (
          <p className="mb-3 text-[12.5px] text-slate">No signed contract uploaded yet.</p>
        ) : (
          <div className="mb-3 flex flex-col gap-2">
            {c.contracts.map((f) => (
              <div key={f.id} className="flex items-center gap-2.5 rounded-[6px] border border-stone bg-white p-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold">{f.filename}</div>
                  <div className="text-[11.5px] text-slate">{fmtBytes(f.size_bytes)} · uploaded {fmtDateTime(f.uploaded_at)}</div>
                </div>
                <button onClick={() => onViewContract(f)} className="shrink-0 text-[12px] font-semibold text-petrol">View</button>
                <button
                  onClick={() => onRemoveContract(f)}
                  aria-label={`Remove ${f.filename}`}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-stone text-slate hover:border-status-churned hover:bg-status-churned/10 hover:text-status-churned"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <input ref={fileInputRef} type="file" accept="application/pdf" hidden onChange={(e) => onUpload(e.target.files?.[0])} />
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className="w-full rounded-[6px] border border-dashed border-stone bg-paper-dim py-2.5 text-[12.5px] font-semibold hover:border-petrol hover:text-petrol disabled:opacity-60"
        >
          {uploading ? 'Uploading…' : '↑ Upload signed contract'}
        </button>
        <p className="mt-1.5 text-center text-[11px] text-slate">PDF only, up to 20MB</p>
        {uploadError && <p className="mt-2 text-[12px] text-status-churned">{uploadError}</p>}
      </div>

      {c.notes && (
        <div className="mt-5 border-t border-stone pt-4">
          <div className="font-mono text-[10px] uppercase tracking-wideish text-slate">Notes</div>
          <div className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed">{c.notes}</div>
        </div>
      )}
    </>
  )
}

function platformLabel(p) {
  return p === 'm365' ? 'Microsoft 365' : p === 'google' ? 'Google Workspace' : p === 'other' ? 'Other' : ''
}

function EditForm({ form, setForm }) {
  function set(key, value) { setForm((f) => ({ ...f, [key]: value })) }

  return (
    <form className="space-y-5" onSubmit={(e) => e.preventDefault()}>
      <fieldset>
        <Legend>Business</Legend>
        <Field label="Business name *" value={form.business_name} onChange={(v) => set('business_name', v)} />
        <Field label="Site address" value={form.site_address} onChange={(v) => set('site_address', v)} />
      </fieldset>

      <fieldset>
        <Legend>Primary contact</Legend>
        <div className="grid grid-cols-2 gap-3.5">
          <Field label="Contact name" value={form.contact_name} onChange={(v) => set('contact_name', v)} />
          <Field type="email" label="Contact email" value={form.contact_email} onChange={(v) => set('contact_email', v)} />
        </div>
        <Field type="tel" label="Contact phone" value={form.contact_phone} onChange={(v) => set('contact_phone', v)} />
      </fieldset>

      <fieldset>
        <Legend>Secondary / emergency contact</Legend>
        <div className="grid grid-cols-2 gap-3.5">
          <Field label="Name" value={form.secondary_contact_name} onChange={(v) => set('secondary_contact_name', v)} />
          <Field type="tel" label="Phone" value={form.secondary_contact_phone} onChange={(v) => set('secondary_contact_phone', v)} />
        </div>
      </fieldset>

      <fieldset>
        <Legend>Package</Legend>
        <label className="mb-1.5 block text-[12.5px] font-semibold">Package tier</label>
        <div className="mb-3.5 flex gap-2">
          {TIERS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => set('tier', t.id)}
              className={`flex-1 rounded-md border p-2.5 text-center ${form.tier === t.id ? 'border-petrol bg-petrol/5' : 'border-stone bg-white'}`}
            >
              <div className="text-[13px] font-bold">{t.name}</div>
              <div className="text-[11px] text-slate">{gbp(t.price)}/device</div>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3.5">
          <Field type="number" label="Devices / endpoints *" value={form.device_count} onChange={(v) => set('device_count', v)} />
          <div>
            <label className="mb-1.5 block text-[12.5px] font-semibold">&nbsp;</label>
            <label className="flex items-center gap-2 pt-2 text-[13px]">
              <input type="checkbox" checked={form.sla_addon} onChange={(e) => set('sla_addon', e.target.checked)} className="h-4 w-4 accent-petrol" />
              Premium SLA (+{gbp(10)}/device)
            </label>
          </div>
        </div>
      </fieldset>

      <div className="flex items-baseline justify-between rounded-[6px] border border-stone bg-paper-dim p-3.5">
        <span className="text-[12.5px] text-slate">Monthly recurring revenue</span>
        <span className="font-display text-xl font-bold tabular-nums">{gbp(computeMrr(form))}</span>
      </div>

      <fieldset>
        <Legend>Status &amp; dates</Legend>
        <div className="mb-3.5">
          <label className="mb-1.5 block text-[12.5px] font-semibold">Status</label>
          <select value={form.status} onChange={(e) => set('status', e.target.value)} className="field-input">
            {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <Field type="date" label="Start date" value={form.start_date} onChange={(v) => set('start_date', v)} />
        <p className="mb-3.5 mt-[-8px] text-[11.5px] leading-relaxed text-slate">
          Next review is calculated automatically from the last review date (or start date, until there’s been one)
          plus this plan’s review cadence — {reviewCadenceDays(form.tier)} days for {tierName(form.tier)}. Use “Mark
          reviewed…” on the client to log one.
        </p>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={form.direct_debit} onChange={(e) => set('direct_debit', e.target.checked)} className="h-4 w-4 accent-petrol" />
          Direct Debit set up
        </label>
      </fieldset>

      <fieldset>
        <Legend>Environment</Legend>
        <div className="mb-3.5">
          <label className="mb-1.5 block text-[12.5px] font-semibold">Email &amp; productivity platform</label>
          <select value={form.platform} onChange={(e) => set('platform', e.target.value)} className="field-input">
            <option value="">Not set</option>
            <option value="m365">Microsoft 365</option>
            <option value="google">Google Workspace</option>
            <option value="other">Other</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={form.on_site_server} onChange={(e) => set('on_site_server', e.target.checked)} className="h-4 w-4 accent-petrol" />
          Has an on-site server
        </label>
      </fieldset>

      <fieldset>
        <Legend>Contract</Legend>
        <div className="grid grid-cols-2 gap-3.5">
          <Field type="date" label="Contract start" value={form.contract_start_date} onChange={(v) => set('contract_start_date', v)} />
          <Field type="date" label="Renewal date" value={form.contract_renewal_date} onChange={(v) => set('contract_renewal_date', v)} />
        </div>
        <div className="grid grid-cols-2 gap-3.5">
          <Field type="number" label="Notice period (days)" value={form.notice_period_days} onChange={(v) => set('notice_period_days', v)} />
          <Field type="number" label="Annual contract value (£)" value={form.contract_value_annual} onChange={(v) => set('contract_value_annual', v)} />
        </div>
        <div className="grid grid-cols-2 gap-3.5">
          <Field type="number" label="Annual price increase (%)" value={form.price_increase_pct} onChange={(v) => set('price_increase_pct', v)} />
          <div>
            <label className="mb-1.5 block text-[12.5px] font-semibold">&nbsp;</label>
            <label className="flex items-center gap-2 pt-2 text-[13px]">
              <input type="checkbox" checked={form.auto_renewal} onChange={(e) => set('auto_renewal', e.target.checked)} className="h-4 w-4 accent-petrol" />
              Auto-renews
            </label>
          </div>
        </div>
        <Field label="Services included (comma-separated)" value={form.services_included} onChange={(v) => set('services_included', v)} />
        <label className="mb-1.5 block text-[12.5px] font-semibold">Contractual SLA terms</label>
        <textarea
          rows={2}
          value={form.contract_sla_terms}
          onChange={(e) => set('contract_sla_terms', e.target.value)}
          placeholder="e.g. 4hr response, 99.9% uptime guarantee…"
          className="field-input mb-3.5 resize-y"
        />
      </fieldset>

      <fieldset>
        <Legend>Lead source</Legend>
        <div className="grid grid-cols-2 gap-3.5">
          <div>
            <label className="mb-1.5 block text-[12.5px] font-semibold">How did they find you?</label>
            <select value={form.lead_source} onChange={(e) => set('lead_source', e.target.value)} className="field-input">
              {LEAD_SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <Field label="Detail (optional)" value={form.lead_source_detail} onChange={(v) => set('lead_source_detail', v)} />
        </div>
      </fieldset>

      <fieldset>
        <Legend>Notes</Legend>
        <textarea
          rows={4}
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
          placeholder="Anything worth remembering — incidents, preferences, quirks of the setup…"
          className="field-input resize-y"
        />
      </fieldset>
    </form>
  )
}

function Legend({ children }) {
  return <legend className="mb-3.5 w-full border-b border-stone pb-2 font-mono text-[10.5px] uppercase tracking-wideish text-brass-dark">{children}</legend>
}

function Field({ label, value, onChange, type = 'text' }) {
  return (
    <div className="mb-3.5">
      <label className="mb-1.5 block text-[12.5px] font-semibold">{label}</label>
      <input type={type} value={value || ''} onChange={(e) => onChange(e.target.value)} className="field-input" />
    </div>
  )
}
