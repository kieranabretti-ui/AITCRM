// On-demand, re-runnable backfill for clients that were added before
// company_number/registered_address existed (mostly: leads added via
// the Companies House lead finder back when it wrote the registered
// office into site_address instead — see 013_registered_address.sql).
//
// Only ever touches clients where company_number is still null, so
// it's safe to call again later — it simply has nothing left to do
// once every client either has a company_number or was skipped.
//
// Matching is deliberately conservative: a Companies House name search
// for the client's business_name, normalized the same way
// lib/domainGuesser.js normalizes names for its website-guessing logic
// (strip legal suffixes/punctuation, uppercase). Only an EXACT
// normalized match, and only when there's exactly one of them, is
// treated as confident enough to write back automatically — anything
// ambiguous or unmatched is left alone and reported, never guessed.
const { createClient } = require('@supabase/supabase-js')
const companiesHouse = require('./lib/companiesHouse.js')
const { significantWords } = require('./lib/domainGuesser.js')

const DEFAULT_BATCH_SIZE = 15
const MAX_BATCH_SIZE = 40

function normalizedName(name) {
  return significantWords(name).join(' ')
}

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

  let limit, excludeIds
  try {
    ({ limit, excludeIds } = JSON.parse(event.body || '{}'))
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body.' }) }
  }
  const batchSize = Math.min(MAX_BATCH_SIZE, Math.max(1, limit || DEFAULT_BATCH_SIZE))
  const seenIds = Array.isArray(excludeIds) ? excludeIds.filter(Boolean) : []

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

  let query = admin
    .from('clients')
    .select('id, business_name')
    .is('company_number', null)
    .order('created_at', { ascending: true })
    .limit(batchSize)
  if (seenIds.length) query = query.not('id', 'in', `(${seenIds.join(',')})`)

  const { data: candidates, error: fetchError } = await query
  if (fetchError) {
    return { statusCode: 500, body: JSON.stringify({ error: fetchError.message }) }
  }

  const results = { updated: 0, noMatch: 0, ambiguous: 0, failed: 0, processed: candidates.length }

  for (const client of candidates) {
    try {
      const matches = await companiesHouse.searchByName(client.business_name, 5)
      const target = normalizedName(client.business_name)
      const exact = matches.filter((m) => normalizedName(m.companyName) === target)

      if (exact.length === 0) {
        results.noMatch += 1
        continue
      }
      if (exact.length > 1) {
        results.ambiguous += 1
        continue
      }

      const chProfile = await companiesHouse.getCompanyProfile(exact[0].companyNumber)
      const address = companiesHouse.formatAddress(chProfile.address)

      const { error: updateError } = await admin
        .from('clients')
        .update({ company_number: chProfile.companyNumber, registered_address: address })
        .eq('id', client.id)
      if (updateError) throw updateError

      await admin.from('client_activity').insert({
        client_id: client.id,
        text: `Registered address added via Companies House backfill (company no. ${chProfile.companyNumber}): ${address || 'no address on file'}`,
        created_by: callerData.user.id,
      })

      results.updated += 1
    } catch {
      results.failed += 1
    }
  }

  const { count: remaining } = await admin
    .from('clients')
    .select('id', { count: 'exact', head: true })
    .is('company_number', null)

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, ...results, processedIds: candidates.map((c) => c.id), remaining: remaining ?? 0 }),
  }
}
