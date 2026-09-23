import { useEffect, useState } from 'react'
import { CATEGORIES } from '../lib/categories.js'
import {
  fetchTicketActivity, setAiDisabledForTicket, overrideSeverity, overrideCategory,
  unlockSeverity, unlockCategory, recordHumanDecision, dismissDraftReply,
  requestAiAnalysis, approveDraftReply,
} from '../lib/ticketsApi.js'
import { fmtDateTime } from '../lib/pricing.js'
import { SeverityBadge, SlaStateBadge, ConfidenceBadge, RiskBadge, EscalationBadge } from './Badges.jsx'

const SEVERITIES = ['P1', 'P2', 'P3', 'P4']

const TRIGGER_LABELS = {
  ticket_created: 'Ticket created',
  customer_reply: 'Customer replied',
  technician_comment: 'Technician commented',
  status_changed: 'Status changed',
  priority_changed: 'Priority changed',
  assignee_changed: 'Reassigned',
  fields_updated: 'Fields updated',
  sla_risk: 'SLA risk',
  manual_request: 'Manually requested',
  human_approval: 'Human approval',
}

export default function TicketDrawer({ ticket: initialTicket, session, userId, onClose, onChanged }) {
  const [ticket, setTicket] = useState(initialTicket)
  const [activity, setActivity] = useState([])
  const [loadingActivity, setLoadingActivity] = useState(true)
  const [error, setError] = useState('')
  const [requesting, setRequesting] = useState(false)
  const [approving, setApproving] = useState(false)
  const [dismissingReply, setDismissingReply] = useState(false)

  function reloadActivity() {
    setLoadingActivity(true)
    fetchTicketActivity(ticket.id)
      .then((rows) => setActivity(rows))
      .catch(() => setActivity([]))
      .finally(() => setLoadingActivity(false))
  }

  useEffect(() => {
    reloadActivity()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.id])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function patch(fields) {
    setTicket((t) => ({ ...t, ...fields }))
    onChanged?.()
  }

  async function handleToggleAiDisabled() {
    const next = !ticket.ai_disabled
    try {
      await setAiDisabledForTicket(ticket.id, next)
      patch({ ai_disabled: next })
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleSeverityChange(value) {
    try {
      await overrideSeverity(ticket.id, value)
      patch({ severity: value, severity_locked: true })
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleCategoryChange(value) {
    try {
      await overrideCategory(ticket.id, value)
      patch({ category: value, category_locked: true })
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleUnlockSeverity() {
    try {
      await unlockSeverity(ticket.id)
      patch({ severity_locked: false })
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleUnlockCategory() {
    try {
      await unlockCategory(ticket.id)
      patch({ category_locked: false })
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleRequestAnalysis() {
    setRequesting(true)
    setError('')
    try {
      await requestAiAnalysis(ticket.id, session.access_token)
      // The analysis ran server-side — nothing in our local ticket
      // object reflects it yet without a re-fetch, which the parent
      // list will pick up; the activity log is what we can refresh now.
      reloadActivity()
    } catch (err) {
      setError(err.message)
    } finally {
      setRequesting(false)
    }
  }

  async function handleApproveReply() {
    setApproving(true)
    setError('')
    try {
      await approveDraftReply(ticket.id, session.access_token)
      patch({ ai_draft_reply_status: 'sent' })
      reloadActivity()
    } catch (err) {
      setError(err.message)
    } finally {
      setApproving(false)
    }
  }

  async function handleDismissReply() {
    setDismissingReply(true)
    try {
      await dismissDraftReply(ticket.id)
      patch({ ai_draft_reply_status: 'dismissed' })
    } catch (err) {
      setError(err.message)
    } finally {
      setDismissingReply(false)
    }
  }

  async function handleDecision(row, decision) {
    try {
      await recordHumanDecision(row.id, decision, userId)
      setActivity((rows) => rows.map((r) => (r.id === row.id ? { ...r, human_decision: decision, human_decision_by: userId, human_decision_at: new Date().toISOString() } : r)))
    } catch (err) {
      setError(err.message)
    }
  }

  const causes = Array.isArray(ticket.ai_possible_causes) ? ticket.ai_possible_causes : []
  const steps = Array.isArray(ticket.ai_recommended_steps) ? ticket.ai_recommended_steps : []
  const hasAnalysis = Boolean(ticket.ai_last_analysis_at)

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink/40" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[560px] flex-col bg-paper shadow-card">
        <div className="flex items-start justify-between gap-3 border-b border-stone px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate font-display text-lg font-semibold">{ticket.summary || ticket.jira_issue_key}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11.5px] text-slate">{ticket.jira_issue_key}</span>
              <SeverityBadge severity={ticket.severity} />
              <SlaStateBadge state={ticket.sla_state} />
              {ticket.category && <span className="rounded bg-paper-dim px-1.5 py-0.5 text-[11px] text-slate">{ticket.category}</span>}
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 rounded border border-stone p-1.5 hover:bg-paper-dim" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {error && (
            <p className="mb-4 rounded-[6px] border border-status-churned/30 bg-status-churned/10 p-3 text-[13px] text-status-churned">
              {error}
            </p>
          )}

          {ticket.jira_url && (
            <a href={ticket.jira_url} target="_blank" rel="noopener noreferrer" className="mb-5 inline-block text-[12.5px] font-semibold text-petrol underline underline-offset-2">
              Open original ticket in Jira ↗
            </a>
          )}

          {/* AI Summary + recommendation */}
          <section className="mb-5 rounded-md border border-stone bg-white p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="eyebrow">AI copilot</div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-[11.5px] text-slate">
                  <input type="checkbox" checked={!ticket.ai_disabled} onChange={handleToggleAiDisabled} className="h-3.5 w-3.5 accent-petrol" />
                  Analysis enabled
                </label>
                <button onClick={handleRequestAnalysis} disabled={requesting} className="btn btn-ghost px-2.5 py-1 text-[11.5px] disabled:opacity-50">
                  {requesting ? 'Analysing…' : 'Request another analysis'}
                </button>
              </div>
            </div>

            {!hasAnalysis ? (
              <p className="text-[12.5px] text-slate">No AI analysis yet.</p>
            ) : (
              <>
                <div className="mb-3 flex flex-wrap gap-1.5">
                  <ConfidenceBadge confidence={ticket.ai_confidence_label} />
                  <RiskBadge risk={ticket.ai_risk} />
                  <EscalationBadge escalation={ticket.ai_escalation_recommendation} />
                </div>

                <Field label="AI summary">{ticket.ai_summary}</Field>
                <Field label="Recommended next step">
                  <span className="font-semibold text-petrol-dark">{ticket.ai_recommended_action || '—'}</span>
                </Field>
                {steps.length > 1 && (
                  <Field label="Other steps">
                    <ol className="list-decimal space-y-0.5 pl-4">
                      {steps.slice(1).map((s, i) => <li key={i}>{s}</li>)}
                    </ol>
                  </Field>
                )}
                <Field label="Likely cause">{ticket.ai_likely_cause}</Field>
                {causes.length > 0 && (
                  <Field label="Other possible causes">
                    <ul className="list-disc space-y-0.5 pl-4">
                      {causes.map((c, i) => <li key={i}>{c}</li>)}
                    </ul>
                  </Field>
                )}
                <p className="mt-2 text-[11px] text-slate">Last analysed {fmtDateTime(ticket.ai_last_analysis_at)}</p>
              </>
            )}
          </section>

          {/* Human override controls */}
          <section className="mb-5 rounded-md border border-stone bg-white p-4">
            <div className="eyebrow mb-3">Override</div>
            <div className="grid grid-cols-2 gap-3.5">
              <div>
                <label className="mb-1 flex items-center justify-between text-[11.5px] font-semibold">
                  Severity
                  {ticket.severity_locked && (
                    <button onClick={handleUnlockSeverity} className="text-[10.5px] font-normal text-petrol underline underline-offset-2">
                      Hand back to AI
                    </button>
                  )}
                </label>
                <select value={ticket.severity || ''} onChange={(e) => handleSeverityChange(e.target.value)} className="field-input">
                  {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 flex items-center justify-between text-[11.5px] font-semibold">
                  Category
                  {ticket.category_locked && (
                    <button onClick={handleUnlockCategory} className="text-[10.5px] font-normal text-petrol underline underline-offset-2">
                      Hand back to AI
                    </button>
                  )}
                </label>
                <select value={ticket.category || ''} onChange={(e) => handleCategoryChange(e.target.value)} className="field-input">
                  <option value="">—</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
          </section>

          {/* Suggested customer reply */}
          {ticket.ai_draft_reply_status === 'pending' && ticket.ai_draft_reply && (
            <section className="mb-5 rounded-md border border-status-onboarding bg-status-onboarding/5 p-4">
              <div className="mb-2 text-[13px] font-bold text-status-onboarding">Suggested customer reply — needs approval</div>
              <p className="mb-3 whitespace-pre-wrap rounded-[6px] border border-stone bg-white p-3 text-[13px]">{ticket.ai_draft_reply}</p>
              <div className="flex gap-2">
                <button onClick={handleApproveReply} disabled={approving} className="btn btn-primary px-2.5 py-1 text-[12px] disabled:opacity-50">
                  {approving ? 'Sending…' : 'Approve & send'}
                </button>
                <button onClick={handleDismissReply} disabled={dismissingReply} className="btn btn-ghost px-2.5 py-1 text-[12px] disabled:opacity-50">
                  Dismiss
                </button>
              </div>
            </section>
          )}
          {ticket.ai_draft_reply_status === 'sent' && (
            <p className="mb-5 text-[12px] text-slate">A drafted reply was sent to the customer.</p>
          )}

          {/* AI activity timeline */}
          <section>
            <div className="eyebrow mb-2.5">AI activity</div>
            {loadingActivity ? (
              <p className="text-[12.5px] text-slate">Loading…</p>
            ) : activity.length === 0 ? (
              <p className="text-[12.5px] text-slate">No AI activity recorded yet.</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {activity.map((row) => (
                  <ActivityRow key={row.id} row={row} onDecision={(decision) => handleDecision(row, decision)} />
                ))}
              </div>
            )}
          </section>
        </div>
      </aside>
    </>
  )
}

function Field({ label, children }) {
  if (!children) return null
  return (
    <div className="mb-2.5">
      <div className="font-mono text-[10px] uppercase tracking-wideish text-slate">{label}</div>
      <div className="mt-0.5 text-[13px] leading-relaxed">{children}</div>
    </div>
  )
}

function ActivityRow({ row, onDecision }) {
  const a = row.analysis || {}
  const canDecide = row.decision === 'analysis' && !row.human_decision
  return (
    <div className="rounded-[6px] border border-stone bg-white p-3">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11.5px] font-semibold">{TRIGGER_LABELS[row.trigger_event] || row.trigger_event || 'Update'}</span>
        <span className="text-[11px] text-slate">{fmtDateTime(row.created_at)}</span>
      </div>
      {a.current_understanding && <p className="mb-1.5 text-[12.5px]">{a.current_understanding}</p>}
      {a.technician_feedback && (
        <p className="mb-1.5 rounded-[4px] bg-paper-dim p-2 text-[12px] italic">“{a.technician_feedback}”</p>
      )}
      <div className="mb-1.5 flex flex-wrap gap-1.5">
        <ConfidenceBadge confidence={a.confidence} />
        <RiskBadge risk={a.risk} />
        <EscalationBadge escalation={a.escalation} />
        {row.decision === 'analysis_no_change' && <span className="rounded-full bg-paper-dim px-2 py-0.5 text-[10.5px] text-slate">No change</span>}
        {row.decision === 'ai_unavailable' && <span className="rounded-full bg-status-churned/10 px-2 py-0.5 text-[10.5px] text-status-churned">AI unavailable</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[10.5px] text-slate">
        {row.jira_modified && <span>Jira updated</span>}
        {row.customer_contacted && <span>· Customer contacted</span>}
        {row.escalated && <span>· Escalated{row.escalation_reason ? ` (${row.escalation_reason})` : ''}</span>}
      </div>
      {row.human_decision ? (
        <p className="mt-1.5 text-[11px] text-petrol-dark">
          {row.human_decision === 'marked_incorrect' ? 'Marked incorrect' : row.human_decision === 'completed' ? 'Marked completed' : row.human_decision === 'dismissed' ? 'Dismissed' : 'Approved'} by a team member
        </p>
      ) : canDecide ? (
        <div className="mt-2 flex gap-3">
          <button onClick={() => onDecision('completed')} className="text-[11px] font-semibold text-petrol underline underline-offset-2">Mark completed</button>
          <button onClick={() => onDecision('dismissed')} className="text-[11px] font-semibold text-slate underline underline-offset-2">Dismiss</button>
          <button onClick={() => onDecision('marked_incorrect')} className="text-[11px] font-semibold text-status-churned underline underline-offset-2">Mark incorrect</button>
        </div>
      ) : null}
    </div>
  )
}
