// "Find contact info" on a Sales opportunity — looks up one company's
// own website for general contact details they've published themselves
// (see lib/websiteContactFinder.js for exactly what this does and
// doesn't do). Auth-gated the same way as the other on-demand lookups:
// any signed-in team member.
const { createClient } = require('@supabase/supabase-js')
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

  let url
  try {
    ({ url } = JSON.parse(event.body || '{}'))
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) }
  }
  if (!url) {
    return { statusCode: 400, body: JSON.stringify({ error: 'A website URL is required.' }) }
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
    const result = await findContactInfo(url)
    return { statusCode: 200, body: JSON.stringify({ ok: true, ...result }) }
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: err.message }) }
  }
}
