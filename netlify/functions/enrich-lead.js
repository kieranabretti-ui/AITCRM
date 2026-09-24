// Auto-run when a Companies House lead is added as an opportunity (see
// LeadFinderPanel.jsx) — Companies House never gives a website, so this
// guesses one from the company name (lib/domainGuesser.js, an
// unverified heuristic — never a search-engine query or third-party
// platform) and, if a plausible match turns up, runs the same
// single-site contact lookup used elsewhere (lib/websiteContactFinder.js)
// against it. Auth-gated the same way as the other on-demand lookups:
// any signed-in team member.
const { createClient } = require('@supabase/supabase-js')
const { findCompanyWebsite } = require('./lib/domainGuesser.js')
const { findContactInfo } = require('./lib/websiteContactFinder.js')

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server is not configured (missing Supabase env vars).' }) }
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || ''
  const callerToken = authHeader.replace(/^Bearer\s+/i, '')
  if (!callerToken) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Missing auth token.' }) }
  }

  let companyName
  try {
    ({ companyName } = JSON.parse(event.body || '{}'))
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) }
  }
  if (!companyName || !companyName.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: 'A company name is required.' }) }
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
    return { statusCode: 403, body: JSON.stringify({ error: 'Only signed-in team members can use this.' }) }
  }

  try {
    const website = await findCompanyWebsite(companyName)
    if (!website) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, website: null }) }
    }
    const contactInfo = await findContactInfo(website).catch(() => null)
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        website,
        guessed: true,
        emails: contactInfo?.emails || [],
        phones: contactInfo?.phones || [],
        employeeCountHint: contactInfo?.employeeCountHint || null,
        pagesChecked: contactInfo?.pagesChecked || [],
      }),
    }
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: err.message }) }
  }
}
