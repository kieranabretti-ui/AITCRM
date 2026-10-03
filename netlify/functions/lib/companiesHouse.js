// Companies House Advanced Search — server-side only. Replaces the
// "scrape business websites for leads" idea entirely: this only ever
// reads the UK's official, free, structured company register via its
// public API, never a third-party site's HTML. It returns company
// name, registered office address, SIC code(s), status and
// incorporation date — deliberately nothing more.
//
// It does NOT and cannot return employee count or named contact
// details — Companies House simply doesn't hold that data (it isn't a
// marketing database). See lib/leadFinder.js on the client for how
// that limitation is surfaced rather than papered over.
//
// Auth: HTTP Basic, username = API key, password blank. Required env
// var: COMPANIES_HOUSE_API_KEY — a free key from
// https://developer.company-information.service.gov.uk (sign in,
// "Your applications" -> "Create new key" -> API key). Rate limit is
// generous (600 requests/5 min) for this on-demand, user-triggered use.
const BASE_URL = 'https://api.company-information.service.gov.uk'
const MAX_SIZE = 100

function authHeader() {
  const key = process.env.COMPANIES_HOUSE_API_KEY
  if (!key) return null
  return 'Basic ' + Buffer.from(`${key}:`).toString('base64')
}

function isConfigured() {
  return Boolean(authHeader())
}

// Same shape produced by src/lib/leadFinder.js's client-side
// formatAddress() — kept in sync manually since this file is CommonJS
// (Netlify Functions) and that one is an ES module (browser bundle).
function formatAddress(address) {
  if (!address) return ''
  return [address.line1, address.line2, address.locality, address.region, address.postcode]
    .filter(Boolean)
    .join(', ')
}

function normalizeCompany(item) {
  const addr = item.registered_office_address || {}
  return {
    companyNumber: item.company_number,
    companyName: item.company_name,
    companyStatus: item.company_status || '',
    companyType: item.company_type || '',
    incorporatedOn: item.date_of_creation || null,
    sicCodes: Array.isArray(item.sic_codes) ? item.sic_codes : [],
    address: {
      line1: addr.address_line_1 || '',
      line2: addr.address_line_2 || '',
      locality: addr.locality || '',
      region: addr.region || '',
      postcode: addr.postal_code || '',
      country: addr.country || '',
    },
  }
}

// One locality per Companies House call (it's a single partial-match
// filter, not a list) — this loops over a handful of Dorset localities
// and merges the results, deduped by company number, since "find
// businesses in Dorset" is naturally a multi-town search.
async function searchCompanies({ localities, sicCodes, companyStatus, size }) {
  const auth = authHeader()
  if (!auth) throw new Error('Companies House API key is not configured (COMPANIES_HOUSE_API_KEY).')

  const perLocalitySize = Math.min(MAX_SIZE, Math.max(1, size || 50))
  const byNumber = new Map()

  for (const location of localities) {
    const params = new URLSearchParams()
    if (location) params.set('location', location)
    if (companyStatus) params.set('company_status', companyStatus)
    if (sicCodes?.length) params.set('sic_codes', sicCodes.join(','))
    params.set('size', String(perLocalitySize))

    const res = await fetch(`${BASE_URL}/advanced-search/companies?${params.toString()}`, {
      headers: { Authorization: auth, Accept: 'application/json' },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Companies House API ${res.status}: ${text.slice(0, 300)}`)
    }
    const data = await res.json()
    for (const item of data.items || []) {
      const normalized = normalizeCompany(item)
      if (!byNumber.has(normalized.companyNumber)) byNumber.set(normalized.companyNumber, normalized)
    }
  }

  return Array.from(byNumber.values())
}

// Basic company-name search (distinct from the locality-based advanced
// search above) — used only by the registered-address backfill tool to
// find a candidate company number for an existing client that was
// added before company_number was captured. Returns name-match
// candidates only (no registered address — call getCompanyProfile() on
// a chosen company number for that), since the search endpoint's
// address_snippet isn't structured into line1/postcode the way the
// rest of this app expects.
async function searchByName(name, size) {
  const auth = authHeader()
  if (!auth) throw new Error('Companies House API key is not configured (COMPANIES_HOUSE_API_KEY).')
  if (!name?.trim()) return []

  const params = new URLSearchParams()
  params.set('q', name.trim())
  params.set('items_per_page', String(Math.min(20, Math.max(1, size || 5))))

  const res = await fetch(`${BASE_URL}/search/companies?${params.toString()}`, {
    headers: { Authorization: auth, Accept: 'application/json' },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Companies House API ${res.status}: ${text.slice(0, 300)}`)
  }
  const data = await res.json()
  return (data.items || []).map((item) => ({
    companyNumber: item.company_number,
    companyName: item.title,
    companyStatus: item.company_status || '',
  }))
}

// The full company profile — same fields as a searchCompanies() item
// (registered_office_address included), for one known company number.
async function getCompanyProfile(companyNumber) {
  const auth = authHeader()
  if (!auth) throw new Error('Companies House API key is not configured (COMPANIES_HOUSE_API_KEY).')

  const res = await fetch(`${BASE_URL}/company/${encodeURIComponent(companyNumber)}`, {
    headers: { Authorization: auth, Accept: 'application/json' },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Companies House API ${res.status}: ${text.slice(0, 300)}`)
  }
  return normalizeCompany(await res.json())
}

module.exports = { isConfigured, searchCompanies, searchByName, getCompanyProfile, formatAddress }
