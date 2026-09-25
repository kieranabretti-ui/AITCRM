import { supabase } from './supabase.js'

// Every opportunity is embedded with its client's basics (business
// name, tier, status) so the Sales board never needs a second round
// trip just to show whose deal it is.
export async function fetchOpportunities() {
  const { data, error } = await supabase
    .from('sales_opportunities')
    .select('*, clients(id, business_name, contact_name, contact_email, tier, status, device_count)')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data
}

export async function fetchOpportunity(id) {
  const { data, error } = await supabase
    .from('sales_opportunities')
    .select('*, clients(*, client_activity(*))')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

// Creating an opportunity for a brand-new prospect also creates their
// client record (status 'lead') — one entity for contact info and
// business details, no separate "prospect" form to fill in twice.
export async function createOpportunityForNewLead(clientFields, opportunityFields, userId) {
  const { data: client, error: clientError } = await supabase
    .from('clients')
    .insert({ ...clientFields, status: 'lead', created_by: userId })
    .select()
    .single()
  if (clientError) throw clientError

  return createOpportunity(client.id, opportunityFields, userId)
}

export async function createOpportunity(clientId, fields, userId) {
  const { data, error } = await supabase
    .from('sales_opportunities')
    .insert({ ...fields, client_id: clientId, created_by: userId })
    .select('*, clients(id, business_name, contact_name, contact_email, tier, status, device_count)')
    .single()
  if (error) throw error
  return data
}

export async function updateOpportunity(id, fields) {
  const { error } = await supabase
    .from('sales_opportunities')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function updateStage(id, stage, lostReason) {
  const fields = { stage, updated_at: new Date().toISOString() }
  if (stage === 'lost') fields.lost_reason = lostReason || ''
  const { error } = await supabase.from('sales_opportunities').update(fields).eq('id', id)
  if (error) throw error

  // Winning a deal is exactly the moment a prospect becomes a real
  // client — promote them onto the Clients page (status: onboarding)
  // rather than leaving them stuck as a lead until someone remembers
  // to edit the client record by hand.
  if (stage === 'won') {
    const { data: opp, error: oppError } = await supabase
      .from('sales_opportunities')
      .select('client_id, clients(status, start_date)')
      .eq('id', id)
      .maybeSingle()
    if (oppError) throw oppError
    if (opp?.clients?.status === 'lead') {
      const promoteFields = { status: 'onboarding' }
      if (!opp.clients.start_date) promoteFields.start_date = new Date().toISOString().slice(0, 10)
      const { error: promoteError } = await supabase.from('clients').update(promoteFields).eq('id', opp.client_id)
      if (promoteError) throw promoteError
    }
  }
}

export async function deleteOpportunity(id) {
  const { error } = await supabase.from('sales_opportunities').delete().eq('id', id)
  if (error) throw error
}

async function callFunction(path, body, accessToken) {
  const res = await fetch(`/.netlify/functions/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'Something went wrong.')
  return json
}

// Needs the Anthropic service credentials, so it's a Netlify Function
// rather than a direct table write — see sales-draft.js.
export async function requestSalesDraft(opportunityId, goal, accessToken) {
  return callFunction('sales-draft', { opportunityId, goal }, accessToken)
}

// Needs the Resend service credentials, so it's a Netlify Function
// rather than a direct table write — see send-outreach-email.js. This
// is the one call in the app that actually delivers an email; always
// a deliberate click on an already-drafted, human-reviewed message.
export async function sendOutreachEmail(opportunityId, subject, body, accessToken) {
  return callFunction('send-outreach-email', { opportunityId, subject, body }, accessToken)
}
