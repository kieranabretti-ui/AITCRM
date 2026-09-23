// Server-side only — see invite-user.js for the required env vars and
// why this can't run in the browser.
const { createClient } = require('@supabase/supabase-js')

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

  let userId
  try {
    ({ userId } = JSON.parse(event.body || '{}'))
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) }
  }
  if (!userId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing userId.' }) }
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: callerData, error: callerError } = await admin.auth.getUser(callerToken)
  if (callerError || !callerData?.user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Your session has expired — sign in again.' }) }
  }
  if (callerData.user.id === userId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'You can’t remove your own account here.' }) }
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role')
    .eq('id', callerData.user.id)
    .single()
  if (profileError || profile?.role !== 'owner') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Only an owner can remove team members.' }) }
  }

  // Deleting the auth user cascades to profiles (see schema.sql's
  // "on delete cascade" on profiles.id), so no separate cleanup needed.
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId)
  if (deleteError) {
    return { statusCode: 400, body: JSON.stringify({ error: deleteError.message }) }
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) }
}
