import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { supabase, supabaseConfigured } from '../lib/supabase.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  // Tracks which user's profile is currently loaded, so a same-user
  // token refresh (Supabase does this automatically whenever the tab
  // regains focus/visibility, firing onAuthStateChange with a new
  // session object every time) doesn't re-trigger the loading gate
  // below. ProtectedRoute unmounts the whole app while loading is
  // true, which was wiping out any open drawer or chat every time you
  // tabbed back in — this makes "loading" mean "signing in", not
  // "session object changed".
  const loadedUserId = useRef(null)

  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false)
      return
    }

    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      if (!data.session) setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      if (!newSession) {
        setProfile(null)
        loadedUserId.current = null
        setLoading(false)
      }
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session) return
    if (loadedUserId.current === session.user.id) return
    let active = true
    setLoading(true)
    supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => {
        if (!active) return
        setProfile(data || null)
        loadedUserId.current = session.user.id
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [session])

  const value = {
    session,
    user: session?.user || null,
    profile,
    isOwner: profile?.role === 'owner',
    loading,
    configured: supabaseConfigured,
    signOut: () => supabase.auth.signOut(),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
