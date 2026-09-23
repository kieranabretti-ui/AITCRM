import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

// Reached from the link in an invite email. Supabase's client library
// picks up the temporary session encoded in the URL automatically on
// load — this page's only job is to let that brand-new account set its
// own password, then send them into the app.
export default function AcceptInvite() {
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setReady(Boolean(data.session)))
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords don’t match.')
      return
    }
    setStatus('submitting')
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      setStatus('error')
      setError(updateError.message)
      return
    }
    navigate('/', { replace: true })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper-dim px-6">
      <div className="w-full max-w-[380px] rounded-md border border-stone bg-white p-8 shadow-card">
        <div className="mb-6">
          <div className="font-display text-xl font-bold">
            <span className="text-ink">A</span>
            <span className="text-petrol">-IT</span>
          </div>
          <p className="eyebrow mt-2">Set up your account</p>
        </div>

        {!ready ? (
          <p className="text-[13.5px] text-slate">
            Checking your invite link… if this doesn’t update in a few seconds, the link may have
            expired — ask for a fresh invite.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-[13.5px] text-ink/75">You’re in — set a password to finish creating your account.</p>
            {error && (
              <p className="rounded-[4px] border border-status-churned/30 bg-status-churned/10 p-3 text-[13px] text-status-churned">
                {error}
              </p>
            )}
            <div>
              <label htmlFor="password" className="mb-1 block text-[13px] font-semibold">
                New password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="field-input"
              />
            </div>
            <div>
              <label htmlFor="confirm" className="mb-1 block text-[13px] font-semibold">
                Confirm password
              </label>
              <input
                id="confirm"
                type="password"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="field-input"
              />
            </div>
            <button type="submit" disabled={status === 'submitting'} className="btn btn-primary w-full">
              {status === 'submitting' ? 'Setting up…' : 'Set password & continue'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
