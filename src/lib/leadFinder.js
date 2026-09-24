// Companies House is locality-based (partial match against the
// registered office address), not county-based — "Dorset" itself
// often won't appear as a locality value, so this is the practical
// substitute: the towns that make up Dorset Council and the BCP
// (Bournemouth, Christchurch & Poole) unitary authority area. Editable
// in the panel — this is just a sensible starting selection.
export const DORSET_LOCALITIES = [
  'Bournemouth', 'Poole', 'Christchurch', 'Dorchester', 'Weymouth',
  'Blandford Forum', 'Bridport', 'Sherborne', 'Shaftesbury', 'Wimborne Minster',
  'Ferndown', 'Verwood', 'Swanage', 'Gillingham', 'Wareham', 'Sturminster Newton',
]

// A starting point, not a complete list — businesses that tend to be
// office-based, client-data-sensitive, and a plausible fit for managed
// IT/cybersecurity support. Freely editable/extendable in the panel.
export const SIC_PRESETS = [
  { code: '69102', label: 'Solicitors' },
  { code: '69201', label: 'Accounting & auditing' },
  { code: '86210', label: 'General medical practice' },
  { code: '86230', label: 'Dental practice' },
  { code: '71111', label: 'Architectural activities' },
  { code: '71121', label: 'Engineering design/consultancy' },
  { code: '70221', label: 'Financial management consultancy' },
  { code: '70229', label: 'Management consultancy' },
  { code: '68310', label: 'Estate agencies' },
  { code: '65120', label: 'Insurance (non-life)' },
  { code: '82990', label: 'Other business support services' },
  { code: '41202', label: 'Construction of commercial buildings' },
]

export const COMPANY_STATUSES = [
  { id: 'active', label: 'Active only' },
  { id: '', label: 'Any status' },
]

async function callFunction(path, body, accessToken) {
  const res = await fetch(`/.netlify/functions/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'Something went wrong.')
  return json
}

// Needs the Companies House API key (server-side only), so this goes
// through a Netlify Function rather than a direct external call from
// the browser — see lead-finder.js.
export async function searchLeads({ localities, sicCodes, companyStatus }, accessToken) {
  const { results } = await callFunction('lead-finder', { localities, sicCodes, companyStatus }, accessToken)
  return results
}

export function formatAddress(address) {
  if (!address) return ''
  return [address.line1, address.line2, address.locality, address.region, address.postcode]
    .filter(Boolean)
    .join(', ')
}
