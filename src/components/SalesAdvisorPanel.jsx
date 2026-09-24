import { useEffect, useRef, useState } from 'react'
import { askSalesAdvisor } from '../lib/salesAdvisor.js'
import { addActivity } from '../lib/clientsApi.js'
import { fmtDateTime } from '../lib/pricing.js'

// Free-form chat, not a per-opportunity tool — grounded server-side in
// a live pipeline snapshot (see lib/salesAdvisor.js). Nothing here is
// saved anywhere automatically: closing the panel or reloading the
// page clears the conversation. "Save to a lead" is the one deliberate
// exception — logging a specific reply, or the whole conversation, to
// a chosen client's activity log on request.
function buildMessageNote(userText, assistantText) {
  const lines = [`Sales guru advice (saved from chat, ${fmtDateTime(new Date().toISOString())}):`]
  if (userText) lines.push('', `Asked: ${userText}`)
  lines.push('', assistantText)
  return lines.join('\n')
}

function buildConversationNote(messages) {
  const lines = [`Sales guru conversation (saved from chat, ${fmtDateTime(new Date().toISOString())}):`, '']
  messages.forEach((m) => lines.push(`${m.role === 'user' ? 'You' : 'Guru'}: ${m.content}`, ''))
  return lines.join('\n').trim()
}

export default function SalesAdvisorPanel({ session, userId, opportunities, onClose, onSaved }) {
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [savingKey, setSavingKey] = useState(null) // message index, or 'all'
  const [selectedClientId, setSelectedClientId] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedKeys, setSavedKeys] = useState(new Set())
  const bottomRef = useRef(null)

  const leadOptions = (opportunities || [])
    .filter((o) => o.clients?.id && o.stage !== 'won' && o.stage !== 'lost')
    .map((o) => ({ clientId: o.clients.id, label: `${o.clients.business_name || 'Untitled prospect'} — ${o.stage}` }))

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, sending])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleSend() {
    const text = draft.trim()
    if (!text || sending) return
    const next = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setDraft('')
    setSending(true)
    setError('')
    try {
      const reply = await askSalesAdvisor(next, session.access_token)
      setMessages((m) => [...m, { role: 'assistant', content: reply }])
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  function handleReset() {
    setMessages([])
    setError('')
    setSavingKey(null)
    setSavedKeys(new Set())
  }

  function openSavePicker(key) {
    setSavingKey(key)
    setSelectedClientId(leadOptions[0]?.clientId || '')
  }

  async function handleConfirmSave() {
    if (!selectedClientId || saving) return
    setSaving(true)
    setError('')
    try {
      const text = savingKey === 'all'
        ? buildConversationNote(messages)
        : buildMessageNote(messages[savingKey - 1]?.role === 'user' ? messages[savingKey - 1].content : '', messages[savingKey].content)
      await addActivity(selectedClientId, text, userId)
      setSavedKeys((s) => new Set(s).add(savingKey))
      setSavingKey(null)
      onSaved?.()
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
        <div className="flex h-[85vh] w-full max-w-[640px] flex-col overflow-hidden rounded-md bg-paper shadow-card">
          <div className="flex items-center justify-between gap-3 border-b border-stone px-5 py-4">
            <div>
              <h2 className="font-display text-lg font-semibold">Sales guru</h2>
              <p className="mt-0.5 text-[11.5px] text-slate">Tactical advice, grounded in your live pipeline. Only saved if you choose to.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {messages.length > 0 && (
                <>
                  <button onClick={() => openSavePicker('all')} className="text-[11.5px] font-semibold text-petrol underline underline-offset-2 hover:text-petrol-dark">
                    Save conversation to a lead
                  </button>
                  <button onClick={handleReset} className="text-[11.5px] font-semibold text-slate underline underline-offset-2 hover:text-ink">
                    New conversation
                  </button>
                </>
              )}
              <button onClick={onClose} className="rounded border border-stone p-1.5 hover:bg-paper-dim" aria-label="Close">✕</button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {messages.length === 0 && (
              <div className="rounded-[6px] border border-stone bg-paper-dim p-3.5 text-[12.5px] leading-relaxed text-slate">
                Ask about chasing a specific prospect, handling an objection, what to prioritise this week, how to
                follow up after a proposal's gone quiet — anything sales-strategy related. It knows your pipeline's
                current shape (stage counts, values, what's gone stalest) but not every prospect's full history —
                paste in details on request if you want advice tailored to one specific deal. Any reply worth
                keeping can be saved straight to that lead's activity log.
              </div>
            )}

            <div className="flex flex-col gap-3">
              {messages.map((m, i) => (
                <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap rounded-[8px] px-3.5 py-2.5 text-[13px] leading-relaxed ${
                      m.role === 'user' ? 'bg-petrol text-white' : 'border border-stone bg-white'
                    }`}
                  >
                    {m.content}
                  </div>
                  {m.role === 'assistant' && (
                    <div className="mt-1">
                      {savedKeys.has(i) ? (
                        <span className="text-[11px] text-slate">Saved ✓</span>
                      ) : (
                        <button onClick={() => openSavePicker(i)} className="text-[11px] font-semibold text-petrol underline underline-offset-2 hover:text-petrol-dark">
                          Save to a lead…
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div className="rounded-[8px] border border-stone bg-white px-3.5 py-2.5 text-[13px] text-slate">Thinking…</div>
                </div>
              )}
            </div>
            <div ref={bottomRef} />
          </div>

          {savingKey !== null && (
            <div className="mx-5 mb-3 flex flex-wrap items-center gap-2 rounded-[6px] border border-stone bg-paper-dim p-3">
              {leadOptions.length === 0 ? (
                <p className="text-[12.5px] text-slate">No open leads to save to yet — add one first.</p>
              ) : (
                <>
                  <label className="text-[12px] font-semibold">Save {savingKey === 'all' ? 'this conversation' : 'this reply'} to:</label>
                  <select value={selectedClientId} onChange={(e) => setSelectedClientId(e.target.value)} className="field-input w-auto flex-1">
                    {leadOptions.map((o) => <option key={o.clientId} value={o.clientId}>{o.label}</option>)}
                  </select>
                  <button onClick={handleConfirmSave} disabled={saving} className="btn btn-primary px-2.5 py-1 text-[12px] disabled:opacity-50">
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </>
              )}
              <button onClick={() => setSavingKey(null)} className="btn btn-ghost px-2.5 py-1 text-[12px]">Cancel</button>
            </div>
          )}

          {error && (
            <p className="mx-5 mb-2 rounded-[6px] border border-status-churned/30 bg-status-churned/10 p-2.5 text-[12.5px] text-status-churned">{error}</p>
          )}

          <div className="flex gap-2 border-t border-stone px-5 py-3.5">
            <textarea
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              placeholder="Ask your sales guru…"
              className="field-input flex-1 resize-y"
            />
            <button onClick={handleSend} disabled={sending || !draft.trim()} className="btn btn-primary shrink-0 disabled:opacity-50">
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
