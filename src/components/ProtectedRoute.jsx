import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

export default function ProtectedRoute({ ownerOnly = false }) {
  const { session, isOwner, loading, configured } = useAuth()

  if (!configured) {
    return (
      <div className="mx-auto max-w-[52ch] px-6 py-24 text-center">
        <h1 className="font-display text-2xl font-semibold">Not configured yet</h1>
        <p className="mt-3 text-ink/70">
          This app needs a Supabase project connected before anyone can sign in — set{' '}
          <code className="font-mono text-sm">VITE_SUPABASE_URL</code> and{' '}
          <code className="font-mono text-sm">VITE_SUPABASE_ANON_KEY</code>. See the README.
        </p>
      </div>
    )
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-slate">Loading…</div>
  }

  if (!session) return <Navigate to="/login" replace />
  if (ownerOnly && !isOwner) return <Navigate to="/" replace />

  return <Outlet />
}
