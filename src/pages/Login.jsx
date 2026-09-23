import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'

export default function Login() {
  const { session } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState('idle') // idle | submitting | error
  const [error, setError] = useState('')

  if (session) return <Navigate to="/" replace />

  async function handleSubmit(e) {
    e.preventDefault()
    setStatus('submitting')
    setError('')
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) {
      setStatus('error')
      setError(
        signInError.message === 'Invalid login credentials'
          ? 'Incorrect email or password.'
          : signInError.message,
      )
      return
    }
    setStatus('idle')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper-dim px-6">
      <div className="w-full max-w-[380px] rounded-md border border-stone bg-white p-8 shadow-card">
        <div className="mb-6">
          <div className="font-display text-xl font-bold">
            <span className="text-ink">A</span>
            <span className="text-petrol">-IT</span>
          </div>
          <p className="eyebrow mt-2">Client Manager</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <p className="rounded-[4px] border border-status-churned/30 bg-status-churned/10 p-3 text-[13px] text-status-churned">
              {error}
            </p>
          )}
          <div>
            <label htmlFor="email" className="mb-1 block text-[13px] font-semibold">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field-input"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-[13px] font-semibold">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="field-input"
            />
          </div>
          <button type="submit" disabled={status === 'submitting'} className="btn btn-primary w-full">
            {status === 'submitting' ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-center text-[12px] text-slate">
          Accounts are invite-only — ask whoever set this up for you if you need access.
        </p>
      </div>
    </div>
  )
}
