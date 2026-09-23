// Server-side only. Holds the Supabase service_role key — this file
// never ships to the browser (Netlify Functions run on the server),
// unlike everything under src/, which does.
//
// Required environment variables (set in Netlify: Site configuration
// → Environment variables — NOT in .env, which only reaches the
// browser build):
//   SUPABASE_URL               same value as VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY  Project Settings → API → service_role
//   SITE_URL                   this app's own deployed URL, e.g.
//                              https://crm.a-it.uk (used for the
//                              invite email's link)
const { createClient } = require('@supabase/supabase-js')

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server is not configured (missing Supabase env vars).' }) }
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || ''
  const callerToken = authHeader.replace(/^Bearer\s+/i, '')
  if (!callerToken) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Missing auth token.' }) }
  }

  let email
  try {
    ({ email } = JSON.parse(event.body || '{}'))
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) }
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Enter a valid email address.' }) }
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Verify the caller is who their token says, then that they're an owner.
  const { data: callerData, error: callerError } = await admin.auth.getUser(callerToken)
  if (callerError || !callerData?.user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Your session has expired — sign in again.' }) }
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role')
    .eq('id', callerData.user.id)
    .single()
  if (profileError || profile?.role !== 'owner') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Only an owner can invite new team members.' }) }
  }

  const redirectTo = SITE_URL ? `${SITE_URL.replace(/\/$/, '')}/invite` : undefined
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo })
  if (inviteError) {
    return { statusCode: 400, body: JSON.stringify({ error: inviteError.message }) }
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) }
}
