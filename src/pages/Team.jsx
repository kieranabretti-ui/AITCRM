import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'

export default function Team() {
  const { session, user } = useAuth()
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [message, setMessage] = useState(null) // { type: 'ok'|'error', text }
  const [removingId, setRemovingId] = useState(null)
  const [confirmingId, setConfirmingId] = useState(null)

  async function reload() {
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: true })
    setMembers(data || [])
    setLoading(false)
  }

  useEffect(() => {
    reload()
  }, [])

  async function callFunction(path, body) {
    const res = await fetch(`/.netlify/functions/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error || 'Something went wrong.')
    return json
  }

  async function handleInvite(e) {
    e.preventDefault()
    setMessage(null)
    setInviting(true)
    try {
      await callFunction('invite-user', { email: email.trim() })
      setMessage({ type: 'ok', text: `Invite sent to ${email.trim()}.` })
      setEmail('')
      reload()
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setInviting(false)
    }
  }

  async function handleRemove(memberId) {
    setRemovingId(memberId)
    setMessage(null)
    try {
      await callFunction('remove-user', { userId: memberId })
      setConfirmingId(null)
      reload()
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setRemovingId(null)
    }
  }

  if (loading) return <div className="py-24 text-center text-slate">Loading team…</div>

  return (
    <div className="max-w-[640px]">
      <h1 className="mb-6 font-display text-2xl font-semibold">Team</h1>

      <section className="card mb-8 p-5">
        <h2 className="eyebrow mb-3">Invite someone</h2>
        <form onSubmit={handleInvite} className="flex gap-2.5">
          <input
            type="email"
            required
            placeholder="colleague@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field-input flex-1"
          />
          <button type="submit" disabled={inviting} className="btn btn-primary shrink-0">
            {inviting ? 'Sending…' : 'Send invite'}
          </button>
        </form>
        <p className="mt-2.5 text-[12px] text-slate">
          They’ll get an email with a link to set their own password. Until they do, they can’t sign in.
        </p>
        {message && (
          <p className={`mt-3 rounded-[4px] border p-2.5 text-[12.5px] ${message.type === 'ok' ? 'border-petrol/30 bg-petrol/10 text-petrol-dark' : 'border-status-churned/30 bg-status-churned/10 text-status-churned'}`}>
            {message.text}
          </p>
        )}
      </section>

      <section>
        <h2 className="eyebrow mb-3">Current team ({members.length})</h2>
        <div className="overflow-hidden rounded-md border border-stone">
          {members.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-3 border-b border-stone bg-white px-4 py-3 last:border-b-0">
              <div className="min-w-0">
                <div className="truncate text-[13.5px] font-medium">{m.email}</div>
                <div className="text-[11.5px] text-slate">
                  {m.role === 'owner' ? 'Owner' : 'Staff'} · joined {new Date(m.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
              </div>
              {m.id !== user.id && m.role !== 'owner' && (
                confirmingId === m.id ? (
                  <div className="flex shrink-0 gap-2">
                    <button className="btn btn-ghost px-2.5 py-1 text-[12px]" onClick={() => setConfirmingId(null)}>Cancel</button>
                    <button
                      className="btn btn-danger px-2.5 py-1 text-[12px]"
                      disabled={removingId === m.id}
                      onClick={() => handleRemove(m.id)}
                    >
                      {removingId === m.id ? 'Removing…' : 'Confirm remove'}
                    </button>
                  </div>
                ) : (
                  <button className="shrink-0 text-[12px] font-semibold text-status-churned" onClick={() => setConfirmingId(m.id)}>
                    Remove
                  </button>
                )
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
