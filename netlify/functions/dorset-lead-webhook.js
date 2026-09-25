// Turns a /dorset-it-support landing page submission into a lead here:
// a client (status: lead) plus a sales_opportunity (stage: new) — the
// same shape "+ New opportunity" and the Companies House lead finder
// create, so it shows up on the Sales pipeline like any other lead.
//
// Primary caller: the aitmsp site's own relay-lead.js Netlify
// Function, which the React form calls directly at submit time — see
// that file for why (in short: a Netlify Forms "Outgoing webhook"
// notification has two failure modes invisible from outside the
// Netlify dashboard — whether it's configured correctly, and whether
// Netlify's own spam classifier silently dropped a real submission
// before the webhook fired — so the form no longer depends on one).
// This function still tolerates being called that way too (the
// Netlify-Forms-wrapped `{payload: {form_name, data: {...}}}` shape)
// in case that notification is ever added back — same secret either
// way, so there's nothing extra to configure for it to keep working.
//
// This is a genuinely public endpoint (called server-to-server, never
// a signed-in team member), so it can't use the normal Supabase-
// session auth every other write in this app requires — RLS only
// allows authenticated team members to insert into
// clients/sales_opportunities. Auth here is a shared secret instead,
// same pattern as jira-webhook.js.
//
// Every request that reaches this function — including a bad secret,
// an unparsable body, or a payload that doesn't turn into a lead —
// gets one row in form_submissions (migration 011). That's what the
// CRM's "Form Submissions" page reads: whether a landing-page
// submission isn't reaching the CRM is now visible right there,
// instead of only inferrable from Netlify's own function logs, which
// aren't reachable from inside this app.
//
// Required environment variables (Netlify: Site configuration ->
// Environment variables — never VITE_-prefixed):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   DORSET_LEAD_WEBHOOK_SECRET   shared secret — the exact same value
//                                set on the aitmsp site as its own
//                                DORSET_LEAD_WEBHOOK_SECRET (see README)
const { createClient } = require('@supabase/supabase-js')

const FORM_NAME = 'dorset-it-support'

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return result === 0
}

// Three shapes land here in practice: relay-lead.js sends the form
// fields flat at the top level ({name, email, ...}, no wrapper at
// all); Netlify's own docs describe its outgoing-webhook body as the
// submission fields "in a key called payload"; concrete examples
// elsewhere show those same fields at the top level instead, still
// nested one level under a "data" key. Rather than bet on one and
// silently drop every submission if that's wrong, accept all three:
// unwrap a "payload" wrapper if present, then use a nested "data" key
// if present, and otherwise treat what's left as the data itself.
function extractLeadData(body) {
  const submission = body?.payload && typeof body.payload === 'object' ? body.payload : body
  const data = submission?.data && typeof submission.data === 'object' ? submission.data : submission
  return { submission, data: data || {} }
}

function buildLeadNote(data) {
  const lines = ['Enquiry via the Dorset IT Support Google Ads landing page (a-it.uk/dorset-it-support).']
  if (data.interest) lines.push(`What they're looking for: ${data.interest}`)
  if (data.devices) lines.push(`Approx. devices/employees given: ${data.devices}`)
  return lines.join('\n')
}

// Best-effort audit trail — a logging failure here must never affect
// the real response to the caller (the aitmsp relay), so this always
// swallows its own errors rather than throwing.
async function recordSubmission(admin, fields) {
  try {
    await admin.from('form_submissions').insert({ source: FORM_NAME, ...fields })
  } catch (err) {
    console.error('[dorset-lead-webhook] could not record submission:', err.message)
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DORSET_LEAD_WEBHOOK_SECRET } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !DORSET_LEAD_WEBHOOK_SECRET) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server is not configured (missing env vars).' }) }
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    await recordSubmission(admin, {
      raw_payload: { _unparsable_body: (event.body || '').slice(0, 2000) },
      status: 'error',
      status_detail: 'Invalid JSON body.',
    })
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body.' }) }
  }

  const { submission, data } = extractLeadData(body)
  const submittedFields = {
    submitted_name: (data.name || '').trim(),
    submitted_email: (data.email || '').trim(),
    submitted_company: (data.company || '').trim(),
  }

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

  const providedSecret = event.headers['x-webhook-secret'] || new URLSearchParams(event.queryStringParameters || {}).get('secret')
  if (!timingSafeEqual(providedSecret || '', DORSET_LEAD_WEBHOOK_SECRET)) {
    // Recorded, not just rejected — a secret mismatch between the
    // aitmsp and CRM sites is one of the most likely reasons real
    // submissions never became leads, and this is the only way to
    // actually see that's what's happening rather than guess. Never
    // echoes the secret itself anywhere.
    await recordSubmission(admin, {
      raw_payload: body,
      status: 'error',
      status_detail: 'Invalid or missing webhook secret — check DORSET_LEAD_WEBHOOK_SECRET matches on both sites.',
      ...submittedFields,
    })
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid webhook secret.' }) }
  }

  if (submission?.form_name && submission.form_name !== FORM_NAME) {
    await recordSubmission(admin, {
      raw_payload: body,
      status: 'skipped',
      status_detail: `Not the ${FORM_NAME} form.`,
      ...submittedFields,
    })
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: `not the ${FORM_NAME} form` }) }
  }

  // Netlify's own spam filtering (the data-netlify-honeypot field on
  // this form) already keeps flagged spam out of notifications, but a
  // submission missing the basics isn't a lead this app can do
  // anything with — skip rather than create an empty client record.
  const { submitted_email: email, submitted_name: name, submitted_company: company } = submittedFields
  if (!email || (!name && !company)) {
    await recordSubmission(admin, {
      raw_payload: body,
      status: 'skipped',
      status_detail: 'Missing name/company or email.',
      ...submittedFields,
    })
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'missing name/company or email' }) }
  }

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

    await recordSubmission(admin, {
      raw_payload: body,
      status: 'lead_created',
      client_id: client.id,
      ...submittedFields,
    })
    return { statusCode: 200, body: JSON.stringify({ ok: true, clientId: client.id }) }
  } catch (err) {
    console.error('[dorset-lead-webhook] failed to create lead:', err.message)
    await recordSubmission(admin, {
      raw_payload: body,
      status: 'error',
      status_detail: err.message,
      ...submittedFields,
    })
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not create the lead.' }) }
  }
}
