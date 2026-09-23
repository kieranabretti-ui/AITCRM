import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// The anon key is safe to ship to the browser by design — it's the
// public half of Supabase's auth model, meaningless without a signed-in
// session, and every table it can touch is locked down by the RLS
// policies in supabase/schema.sql. Never put the service_role key here.
export const supabaseConfigured = Boolean(url && anonKey)

export const supabase = supabaseConfigured
  ? createClient(url, anonKey)
  : null
