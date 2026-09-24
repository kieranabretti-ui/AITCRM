import { useEffect, useRef, useState } from 'react'
import { askSalesAdvisor } from '../lib/salesAdvisor.js'

// Free-form chat, not a per-opportunity tool — grounded server-side in
// a live pipeline snapshot (see lib/salesAdvisor.js), but nothing
// typed here is saved anywhere: closing the panel or reloading the
// page clears the conversation.
export default function SalesAdvisorPanel({ session, onClose }) {
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef(null)

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
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink/40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
        <div className="flex h-[85vh] w-full max-w-[640px] flex-col overflow-hidden rounded-md bg-paper shadow-card">
          <div className="flex items-center justify-between gap-3 border-b border-stone px-5 py-4">
            <div>
              <h2 className="font-display text-lg font-semibold">Sales guru</h2>
              <p className="mt-0.5 text-[11.5px] text-slate">Tactical advice, grounded in your live pipeline. Nothing here is saved or sent.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {messages.length > 0 && (
                <button onClick={handleReset} className="text-[11.5px] font-semibold text-slate underline underline-offset-2 hover:text-ink">
                  New conversation
                </button>
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
                paste in details on request if you want advice tailored to one specific deal.
              </div>
            )}

            <div className="flex flex-col gap-3">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap rounded-[8px] px-3.5 py-2.5 text-[13px] leading-relaxed ${
                      m.role === 'user' ? 'bg-petrol text-white' : 'border border-stone bg-white'
                    }`}
                  >
                    {m.content}
                  </div>
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
