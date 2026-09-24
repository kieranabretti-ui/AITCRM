// "Find leads" on the Sales page — searches the UK's official
// Companies House register (never a scrape of any other site) for
// companies whose registered office is in one of the given Dorset-area
// localities, optionally narrowed by SIC code. Auth-gated the same way
// as the other on-demand AI/lookup actions: any signed-in team member.
//
// Required environment variable: COMPANIES_HOUSE_API_KEY (see
// lib/companiesHouse.js for where to get one — it's free).
const { createClient } = require('@supabase/supabase-js')
const companiesHouse = require('./lib/companiesHouse.js')

const MAX_LOCALITIES_PER_REQUEST = 8

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server is not configured (missing Supabase env vars).' }) }
  }
  if (!companiesHouse.isConfigured()) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Companies House API key is not configured (COMPANIES_HOUSE_API_KEY).' }) }
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || ''
  const callerToken = authHeader.replace(/^Bearer\s+/i, '')
  if (!callerToken) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Missing auth token.' }) }
  }

  let localities, sicCodes, companyStatus
  try {
    ({ localities, sicCodes, companyStatus } = JSON.parse(event.body || '{}'))
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) }
  }
  if (!Array.isArray(localities) || localities.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'At least one locality is required.' }) }
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
    return { statusCode: 403, body: JSON.stringify({ error: 'Only signed-in team members can search for leads.' }) }
  }

  try {
    const results = await companiesHouse.searchCompanies({
      localities: localities.slice(0, MAX_LOCALITIES_PER_REQUEST),
      sicCodes: Array.isArray(sicCodes) ? sicCodes.filter(Boolean) : [],
      companyStatus: companyStatus || 'active',
      size: 50,
    })
    return { statusCode: 200, body: JSON.stringify({ ok: true, results }) }
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: err.message }) }
  }
}
