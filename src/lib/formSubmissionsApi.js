import { supabase } from './supabase.js'

// Read-only from the app's side — every row is written by
// dorset-lead-webhook.js using the service-role key (see migration
// 011). Newest first, since the point of this page is "what just
// happened," capped at a sane page size rather than every row ever.
export async function fetchFormSubmissions() {
  const { data, error } = await supabase
    .from('form_submissions')
    .select('*, clients(id, business_name)')
    .order('received_at', { ascending: false })
    .limit(200)
  if (error) throw error
  return data
}
