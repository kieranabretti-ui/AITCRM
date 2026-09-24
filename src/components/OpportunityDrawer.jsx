import { useEffect, useState } from 'react'
import { fetchOpportunity, updateOpportunity, updateStage, deleteOpportunity, requestSalesDraft } from '../lib/salesApi.js'
import { updateClient } from '../lib/clientsApi.js'
import { findContactInfo } from '../lib/contactFinder.js'
import { STAGES, DRAFT_GOALS } from '../lib/sales.js'
import { fmtDateTime } from '../lib/pricing.js'
import { TierBadge } from './Badges.jsx'

export default function OpportunityDrawer({ opportunityId, session, onClose, onChanged }) {
  const [opp, setOpp] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ estimated_value_annual: '', expected_close_date: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [lostReason, setLostReason] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [goal, setGoal] = useState(DRAFT_GOALS[0].id)
  const [drafting, setDrafting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [websiteInput, setWebsiteInput] = useState('')
  const [finding, setFinding] = useState(false)
  const [contactResult, setContactResult] = useState(null)
  const [copiedField, setCopiedField] = useState('')

  function load() {
    setLoading(true)
    fetchOpportunity(opportunityId)
      .then((o) => {
        setOpp(o)
        setForm({
          estimated_value_annual: o.estimated_value_annual ?? '',
          expected_close_date: o.expected_close_date || '',
          notes: o.notes || '',
        })
        setLostReason(o.lost_reason || '')
        setWebsiteInput(o.clients?.website || '')
      })
      .catch((err) => setError(err.message || 'Could not load this opportunity.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opportunityId])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleStageChange(stage) {
    try {
      await updateStage(opportunityId, stage, stage === 'lost' ? lostReason : undefined)
      setOpp((o) => ({ ...o, stage }))
      onChanged?.()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleSaveDetails() {
    setSaving(true)
    setError('')
    try {
      const fields = {
        estimated_value_annual: form.estimated_value_annual === '' ? null : Number(form.estimated_value_annual),
        expected_close_date: form.expected_close_date || null,
        notes: form.notes,
      }
      if (opp.stage === 'lost') fields.lost_reason = lostReason
      await updateOpportunity(opportunityId, fields)
      setOpp((o) => ({ ...o, ...fields }))
      onChanged?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    try {
      await deleteOpportunity(opportunityId)
      onChanged?.()
      onClose()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleGenerateDraft() {
    setDrafting(true)
    setError('')
    try {
      const goalPrompt = DRAFT_GOALS.find((g) => g.id === goal)?.prompt || goal
      const { draft } = await requestSalesDraft(opportunityId, goalPrompt, session.access_token)
      setOpp((o) => ({ ...o, ai_draft_message: draft, ai_draft_generated_at: new Date().toISOString() }))
    } catch (err) {
      setError(err.message)
    } finally {
      setDrafting(false)
    }
  }

  function handleCopyDraft() {
    if (!opp?.ai_draft_message) return
    const { subject, body } = opp.ai_draft_message
    navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  async function handleFindContact() {
    if (!websiteInput.trim()) { setError('Enter the company\'s website first.'); return }
    setFinding(true)
    setError('')
    setContactResult(null)
    try {
      if (websiteInput !== (opp.clients?.website || '') && opp.clients?.id) {
        await updateClient(opp.clients.id, { website: websiteInput.trim() })
        setOpp((o) => ({ ...o, clients: { ...o.clients, website: websiteInput.trim() } }))
      }
      const result = await findContactInfo(websiteInput.trim(), session.access_token)
      setContactResult(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setFinding(false)
    }
  }

  function handleCopyField(value, field) {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedField(field)
      setTimeout(() => setCopiedField(''), 2000)
    })
  }

  if (loading) {
    return (
      <>
        <div className="fixed inset-0 z-40 bg-ink/40" onClick={onClose} />
        <aside className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[520px] items-center justify-center bg-paper shadow-card">
          <p className="text-slate">Loading…</p>
        </aside>
      </>
    )
  }
  if (!opp) return null

  const client = opp.clients || {}

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink/40" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[520px] flex-col bg-paper shadow-card">
        <div className="flex items-start justify-between gap-3 border-b border-stone px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate font-display text-lg font-semibold">{client.business_name || 'Untitled prospect'}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <TierBadge tier={client.tier} />
              {client.contact_name && <span className="text-[12px] text-slate">{client.contact_name}</span>}
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 rounded border border-stone p-1.5 hover:bg-paper-dim" aria-label="Close">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {error && (
            <p className="mb-4 rounded-[6px] border border-status-churned/30 bg-status-churned/10 p-3 text-[13px] text-status-churned">{error}</p>
          )}

          <div className="mb-5 grid grid-cols-2 gap-x-5 gap-y-2 text-[12.5px]">
            {client.contact_email && <div><span className="text-slate">Email: </span>{client.contact_email}</div>}
            {client.device_count ? <div><span className="text-slate">Devices: </span>{client.device_count}</div> : null}
            {client.website && (
              <div className="col-span-2">
                <span className="text-slate">Website: </span>
                <a href={/^https?:\/\//.test(client.website) ? client.website : `https://${client.website}`} target="_blank" rel="noopener noreferrer" className="text-petrol underline underline-offset-2">
                  {client.website}
                </a>
              </div>
            )}
          </div>

          <div className="mb-5 rounded-md border border-stone bg-white p-4">
            <label className="mb-1.5 block text-[11.5px] font-semibold">Stage</label>
            <select value={opp.stage} onChange={(e) => handleStageChange(e.target.value)} className="field-input">
              {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            {opp.stage === 'lost' && (
              <div className="mt-3">
                <label className="mb-1.5 block text-[11.5px] font-semibold">Lost reason</label>
                <input type="text" value={lostReason} onChange={(e) => setLostReason(e.target.value)} className="field-input" placeholder="e.g. went with a competitor, budget, timing…" />
              </div>
            )}

            <div className="mt-3.5 grid grid-cols-2 gap-3.5">
              <div>
                <label className="mb-1.5 block text-[11.5px] font-semibold">Estimated annual value (£)</label>
                <input type="number" value={form.estimated_value_annual} onChange={(e) => setForm((f) => ({ ...f, estimated_value_annual: e.target.value }))} className="field-input" />
              </div>
              <div>
                <label className="mb-1.5 block text-[11.5px] font-semibold">Expected close date</label>
                <input type="date" value={form.expected_close_date} onChange={(e) => setForm((f) => ({ ...f, expected_close_date: e.target.value }))} className="field-input" />
              </div>
            </div>
            <div className="mt-3.5">
              <label className="mb-1.5 block text-[11.5px] font-semibold">Notes</label>
              <textarea rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="field-input resize-y" placeholder="Where things stand, what they care about, objections raised…" />
            </div>
            <button onClick={handleSaveDetails} disabled={saving} className="btn btn-primary mt-3 px-2.5 py-1 text-[12px] disabled:opacity-50">
              {saving ? 'Saving…' : 'Save details'}
            </button>
          </div>

          <div className="mb-5 rounded-md border border-stone bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="eyebrow">AI sales assistant</div>
            </div>
            <div className="flex gap-2">
              <select value={goal} onChange={(e) => setGoal(e.target.value)} className="field-input flex-1">
                {DRAFT_GOALS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
              </select>
              <button onClick={handleGenerateDraft} disabled={drafting} className="btn btn-primary shrink-0 px-2.5 py-1 text-[12px] disabled:opacity-50">
                {drafting ? 'Drafting…' : opp.ai_draft_message ? 'Redraft' : 'Draft with AI'}
              </button>
            </div>

            {opp.ai_draft_message && (
              <div className="mt-3.5 rounded-[6px] border border-stone bg-paper-dim p-3">
                <div className="mb-2 text-[12.5px]"><span className="font-semibold">Subject: </span>{opp.ai_draft_message.subject}</div>
                <p className="mb-2 whitespace-pre-wrap rounded-[6px] border border-stone bg-white p-3 text-[13px]">{opp.ai_draft_message.body}</p>
                {opp.ai_draft_message.key_points?.length > 0 && (
                  <div className="mb-2">
                    <div className="font-mono text-[10px] uppercase tracking-wideish text-slate">Key points</div>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px]">
                      {opp.ai_draft_message.key_points.map((k, i) => <li key={i}>{k}</li>)}
                    </ul>
                  </div>
                )}
                {opp.ai_draft_message.follow_up_suggestion && (
                  <p className="mb-2 text-[12px] text-slate"><span className="font-semibold text-ink">Next: </span>{opp.ai_draft_message.follow_up_suggestion}</p>
                )}
                <div className="flex items-center gap-2">
                  <button onClick={handleCopyDraft} className="btn btn-ghost px-2.5 py-1 text-[12px]">
                    {copied ? 'Copied ✓' : 'Copy subject + body'}
                  </button>
                  <span className="text-[11px] text-slate">Draft only — review and send it yourself.</span>
                </div>
                {opp.ai_draft_generated_at && (
                  <p className="mt-2 text-[10.5px] text-slate">Generated {fmtDateTime(opp.ai_draft_generated_at)}</p>
                )}
              </div>
            )}
          </div>

          <div className="mb-5 rounded-md border border-stone bg-white p-4">
            <div className="eyebrow mb-3">Find contact info</div>
            <p className="mb-3 text-[11.5px] leading-relaxed text-slate">
              Reads this company's own website — never a third-party platform — for the general email/phone/employee
              count they've chosen to publish. Best-effort, not verified; check it before you use it.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="company-website.co.uk"
                value={websiteInput}
                onChange={(e) => setWebsiteInput(e.target.value)}
                className="field-input flex-1"
              />
              <button onClick={handleFindContact} disabled={finding} className="btn btn-primary shrink-0 px-2.5 py-1 text-[12px] disabled:opacity-50">
                {finding ? 'Looking…' : 'Find contact info'}
              </button>
            </div>

            {contactResult && (
              <div className="mt-3.5 rounded-[6px] border border-stone bg-paper-dim p-3">
                {contactResult.emails.length === 0 && contactResult.phones.length === 0 && !contactResult.employeeCountHint ? (
                  <p className="text-[12.5px] text-slate">Nothing published on their site that we could find.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {contactResult.emails.map((email) => (
                      <div key={email} className="flex items-center justify-between gap-2">
                        <span className="text-[12.5px]">{email}</span>
                        <button onClick={() => handleCopyField(email, email)} className="text-[11px] font-semibold text-petrol underline underline-offset-2">
                          {copiedField === email ? 'Copied ✓' : 'Copy'}
                        </button>
                      </div>
                    ))}
                    {contactResult.phones.map((phone) => (
                      <div key={phone} className="flex items-center justify-between gap-2">
                        <span className="text-[12.5px]">{phone}</span>
                        <button onClick={() => handleCopyField(phone, phone)} className="text-[11px] font-semibold text-petrol underline underline-offset-2">
                          {copiedField === phone ? 'Copied ✓' : 'Copy'}
                        </button>
                      </div>
                    ))}
                    {contactResult.employeeCountHint && (
                      <div className="text-[12.5px]"><span className="text-slate">Mentioned on their site: </span>{contactResult.employeeCountHint}</div>
                    )}
                  </div>
                )}
                <p className="mt-2 text-[10.5px] text-slate">Checked {contactResult.pagesChecked.join(', ')} on {contactResult.sourceUrl}</p>
              </div>
            )}
          </div>

          {(client.client_activity?.length > 0) && (
            <div className="mb-5 rounded-md border border-stone bg-white p-4">
              <div className="eyebrow mb-3">Activity</div>
              <div className="flex flex-col gap-2.5">
                {[...client.client_activity].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map((a) => (
                  <div key={a.id} className="flex gap-2.5">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-petrol" />
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[10.5px] text-slate">{fmtDateTime(a.created_at)}</div>
                      <div className="whitespace-pre-wrap text-[13px]">{a.text}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {confirmingDelete ? (
            <div className="flex items-center justify-between gap-3 rounded-[6px] border border-status-churned bg-status-churned/10 p-3">
              <p className="text-[12.5px] font-semibold text-status-churned">Delete this opportunity?</p>
              <div className="flex shrink-0 gap-2">
                <button className="btn btn-ghost px-2.5 py-1 text-[12px]" onClick={() => setConfirmingDelete(false)}>Cancel</button>
                <button className="btn btn-danger px-2.5 py-1 text-[12px]" onClick={handleDelete}>Delete</button>
              </div>
            </div>
          ) : (
            <button className="text-[12px] font-semibold text-status-churned" onClick={() => setConfirmingDelete(true)}>
              Delete opportunity
            </button>
          )}
        </div>
      </aside>
    </>
  )
}
