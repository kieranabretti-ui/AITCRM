// Receives the Netlify Forms "outgoing webhook" notification for the
// aitmsp marketing site's /dorset-it-support Google Ads landing page
// form, and turns each real submission into a lead here: a client
// (status: lead) plus a sales_opportunity (stage: new) — the same
// shape "+ New opportunity" and the Companies House lead finder
// create, so it shows up on the Sales pipeline like any other lead.
//
// This is a genuinely public endpoint (Netlify's own servers call it,
// not a signed-in team member), so it can't use the normal
// Supabase-session auth every other write in this app requires — RLS
// only allows authenticated team members to insert into clients/
// sales_opportunities. Auth here is a shared secret instead, same
// pattern as jira-webhook.js: baked into the webhook URL you paste
// into the aitmsp site's Netlify dashboard (Site configuration ->
// Forms -> Form notifications -> Outgoing webhook), since that UI
// only lets you configure a URL, not custom headers.
//
// Required environment variables (Netlify: Site configuration ->
// Environment variables — never VITE_-prefixed):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   DORSET_LEAD_WEBHOOK_SECRET   shared secret — put it in the
//                                webhook URL as ?secret=... (see README)
const { createClient } = require('@supabase/supabase-js')

const FORM_NAME = 'dorset-it-support'

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return result === 0
}

// Netlify's own docs describe the outgoing-webhook body as the
// submission fields "in a key called payload" — but concrete examples
// elsewhere show those same fields at the top level. Rather than bet
// on one shape and silently drop every submission if that's wrong,
// accept either.
function unwrapPayload(body) {
  return body?.payload && typeof body.payload === 'object' ? body.payload : body
}

function buildLeadNote(data) {
  const lines = ['Enquiry via the Dorset IT Support Google Ads landing page (a-it.uk/dorset-it-support).']
  if (data.interest) lines.push(`What they're looking for: ${data.interest}`)
  if (data.devices) lines.push(`Approx. devices/employees given: ${data.devices}`)
  return lines.join('\n')
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DORSET_LEAD_WEBHOOK_SECRET } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !DORSET_LEAD_WEBHOOK_SECRET) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server is not configured (missing env vars).' }) }
  }

  const providedSecret = event.headers['x-webhook-secret'] || new URLSearchParams(event.queryStringParameters || {}).get('secret')
  if (!timingSafeEqual(providedSecret || '', DORSET_LEAD_WEBHOOK_SECRET)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid webhook secret.' }) }
  }

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body.' }) }
  }

  const submission = unwrapPayload(body)
  const data = submission?.data || {}

  // Temporary diagnostic — set DEBUG_WEBHOOK=1 in Netlify while
  // confirming this is wired up correctly, so a payload-shape mismatch
  // shows up in the function log instead of silently dropping every
  // submission. Logs shape only (field names), never lead content.
  // Unset once confirmed working. Same pattern as jira-webhook.js.
  if (process.env.DEBUG_WEBHOOK) {
    console.log('[dorset-lead-webhook] payload shape', JSON.stringify({
      topLevelKeys: Object.keys(body),
      formName: submission?.form_name,
      dataKeys: Object.keys(data),
    }))
  }

  if (submission?.form_name && submission.form_name !== FORM_NAME) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: `not the ${FORM_NAME} form` }) }
  }

  // Netlify's own spam filtering (the data-netlify-honeypot field on
  // this form) already keeps flagged spam out of notifications, but a
  // submission missing the basics isn't a lead this app can do
  // anything with — skip rather than create an empty client record.
  const email = (data.email || '').trim()
  const name = (data.name || '').trim()
  const company = (data.company || '').trim()
  if (!email || (!name && !company)) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'missing name/company or email' }) }
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    const { data: client, error: clientError } = await admin
      .from('clients')
      .insert({
        business_name: company || `${name} (Dorset IT Support enquiry)`,
        contact_name: name,
        contact_email: email,
        contact_phone: (data.phone || '').trim(),
        status: 'lead',
        lead_source: 'google_ads',
        lead_source_detail: 'dorset-it-support landing page',
        notes: buildLeadNote(data),
      })
      .select('id')
      .single()
    if (clientError) throw clientError

    const { error: oppError } = await admin
      .from('sales_opportunities')
      .insert({ client_id: client.id, stage: 'new', notes: buildLeadNote(data) })
    if (oppError) throw oppError

    return { statusCode: 200, body: JSON.stringify({ ok: true, clientId: client.id }) }
  } catch (err) {
    // 500 so Netlify's own delivery retries resend this later — there
    // is no separate queue, the retry IS the retry here (same
    // reasoning as jira-webhook.js).
    console.error('[dorset-lead-webhook] failed to create lead:', err.message)
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not create the lead, will retry.' }) }
  }
}
