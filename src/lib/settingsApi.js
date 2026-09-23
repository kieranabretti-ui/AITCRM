import { supabase } from './supabase.js'

export async function fetchSettings() {
  const { data, error } = await supabase.from('settings').select('key, value')
  if (error) throw error
  return Object.fromEntries(data.map((r) => [r.key, r.value]))
}

export async function updateSetting(key, value, userId) {
  const { error } = await supabase
    .from('settings')
    .upsert({ key, value, updated_at: new Date().toISOString(), updated_by: userId }, { onConflict: 'key' })
  if (error) throw error
}
