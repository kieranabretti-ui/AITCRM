import { supabase } from './supabase.js'

export async function fetchClients() {
  const { data, error } = await supabase
    .from('clients')
    .select('*, client_activity(*), client_contracts(*)')
    .order('business_name', { ascending: true })
  if (error) throw error
  return data.map(normalizeClient)
}

function normalizeClient(row) {
  return {
    ...row,
    activity: (row.client_activity || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
    contracts: (row.client_contracts || []).slice().sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at)),
  }
}

export async function createClient(fields, userId) {
  const { data, error } = await supabase
    .from('clients')
    .insert({ ...fields, created_by: userId })
    .select()
    .single()
  if (error) throw error
  return normalizeClient({ ...data, client_activity: [], client_contracts: [] })
}

export async function updateClient(id, fields) {
  const { error } = await supabase
    .from('clients')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function deleteClient(id) {
  const { error } = await supabase.from('clients').delete().eq('id', id)
  if (error) throw error
}

export async function addActivity(clientId, text, userId) {
  const { data, error } = await supabase
    .from('client_activity')
    .insert({ client_id: clientId, text, created_by: userId })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function removeActivity(activityId) {
  const { error } = await supabase.from('client_activity').delete().eq('id', activityId)
  if (error) throw error
}

export async function uploadContract(clientId, file, userId) {
  const path = `${clientId}/${crypto.randomUUID()}-${file.name}`
  const { error: uploadError } = await supabase.storage.from('contracts').upload(path, file, {
    contentType: 'application/pdf',
  })
  if (uploadError) throw uploadError

  const { data, error: insertError } = await supabase
    .from('client_contracts')
    .insert({
      client_id: clientId,
      filename: file.name,
      storage_path: path,
      size_bytes: file.size,
      uploaded_by: userId,
    })
    .select()
    .single()
  if (insertError) throw insertError
  return data
}

export async function contractUrl(storagePath) {
  const { data, error } = await supabase.storage.from('contracts').createSignedUrl(storagePath, 300)
  if (error) throw error
  return data.signedUrl
}

export async function removeContract(contractId, storagePath) {
  await supabase.storage.from('contracts').remove([storagePath])
  const { error } = await supabase.from('client_contracts').delete().eq('id', contractId)
  if (error) throw error
}
