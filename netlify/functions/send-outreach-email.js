// Sends an AI-drafted (or hand-edited) outreach email for a sales
// opportunity — the one place in this app that actually delivers an
// email rather than just drafting one. Always a deliberate, signed-in
// human action from the Sales page's "Send email" button, never
// triggered automatically by the lead finder, enrichment, or anything
// else — see OpportunityDrawer.jsx, the sole caller.
//
// Auth-gated the same way as sales-draft.js: any signed-in team
// member, not owner-only.
//
// Required environment variables (Netlify: Site configuration ->
// Environment variables):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   RESEND_API_KEY, OUTREACH_FROM_EMAIL   see lib/emailSender.js
const { createClient } = require('@supabase/supabase-js')
const { isConfigured, sendEmail } = require('./lib/emailSender.js')

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server is not configured (missing Supabase env vars).' }) }
  }
  if (!isConfigured()) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Email sending is not configured (missing RESEND_API_KEY / OUTREACH_FROM_EMAIL).' }) }
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || ''
  const callerToken = authHeader.replace(/^Bearer\s+/i, '')
  if (!callerToken) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Missing auth token.' }) }
  }

  let opportunityId, subject, body
  try {
    ({ opportunityId, subject, body } = JSON.parse(event.body || '{}'))
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) }
  }
  subject = (subject || '').trim()
  body = (body || '').trim()
  if (!opportunityId || !subject || !body) {
    return { statusCode: 400, body: JSON.stringify({ error: 'opportunityId, subject and body are required.' }) }
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: callerData, error: callerError } = await admin.auth.getUser(callerToken)
  if (callerError || !callerData?.user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Your session has expired — sign in again.' }) }
  }
  const { data: profile, error: profileError } = await admin.from('profiles').select('id').eq('id', callerData.user.id).maybeSingle()
  if (profileError || !profile) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Only signed-in team members can send an outreach email.' }) }
  }

  const { data: opportunity, error: oppError } = await admin
    .from('sales_opportunities')
    .select('id, client_id')
    .eq('id', opportunityId)
    .maybeSingle()
  if (oppError || !opportunity) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Opportunity not found.' }) }
  }

  const { data: client, error: clientError } = await admin
    .from('clients')
    .select('id, business_name, contact_email')
    .eq('id', opportunity.client_id)
    .maybeSingle()
  if (clientError || !client) {
    return { statusCode: 404, body: JSON.stringify({ error: 'The client this opportunity belongs to was not found.' }) }
  }
  if (!client.contact_email || !EMAIL_RE.test(client.contact_email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'This lead has no valid contact email on file yet — find one first.' }) }
  }

  const result = await sendEmail({ to: client.contact_email, subject, text: body })
  if (!result.ok) {
    const detail = result.error ? `: ${result.error}` : ''
    return { statusCode: 502, body: JSON.stringify({ error: `Could not send the email (${result.reason})${detail}` }) }
  }

  const sentAt = new Date().toISOString()
  const { error: updateError } = await admin.from('sales_opportunities').update({
    outreach_sent_at: sentAt,
    outreach_sent_to: client.contact_email,
    outreach_sent_subject: subject,
    outreach_sent_body: body,
    updated_at: sentAt,
  }).eq('id', opportunityId)
  if (updateError) {
    // The email is already sent at this point — surfacing this as a
    // partial-success message rather than a plain error, since a
    // retry from the UI would send a second email.
    return { statusCode: 200, body: JSON.stringify({ ok: true, sentAt, warning: `Email sent, but the record couldn't be saved: ${updateError.message}` }) }
  }

  await admin.from('client_activity').insert({
    client_id: client.id,
    text: `Outreach email sent to ${client.contact_email}\nSubject: ${subject}`,
    created_by: callerData.user.id,
  })

  return { statusCode: 200, body: JSON.stringify({ ok: true, sentAt }) }
}
