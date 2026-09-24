// Heuristic website finder — server-side only. Companies House gives a
// company name and a registered address, never a website, so when the
// lead finder wants to auto-discover one this is the only source it's
// allowed to use: guessing plausible domains directly from the company
// name and fetching each one to check the name actually shows up there.
//
// Deliberately NOT a search-engine query (Google/Bing) or any
// third-party platform — those were ruled out for the same reasons as
// the original "scrape LinkedIn" ask (ToS risk sitting on A-IT's own
// name). This only ever fetches domains it has itself constructed from
// the company name, the same way a person might type a guess into the
// address bar — and it verifies before trusting a guess, rather than
// assuming the first domain that resolves is the right one.
//
// This is inherently unreliable: it will miss real sites that don't
// follow a predictable domain pattern, and can occasionally match an
// unrelated business that happens to share enough wording. Callers
// must treat the result as an unverified guess, never a confirmed
// match — see enrich-lead.js, which labels it as such.
const { normalizeUrl, assertPublicHost, USER_AGENT } = require('./websiteContactFinder.js')

const PROBE_TIMEOUT_MS = 4_000
const MAX_PROBE_BYTES = 200_000
const MAX_CANDIDATES = 6
const MIN_SINGLE_WORD_LENGTH = 6

const LEGAL_SUFFIXES = ['LIMITED', 'LTD', 'LLP', 'PLC', 'CIC', 'LP', 'UNLIMITED']

// "Harbourview Legal Limited" -> ['HARBOURVIEW', 'LEGAL']
function significantWords(companyName) {
  let n = (companyName || '').toUpperCase()
  n = n.replace(/\(.*?\)/g, ' ')
  n = n.replace(/&/g, ' AND ')
  n = n.replace(/[^A-Z0-9 ]/g, ' ')
  let words = n.split(/\s+/).filter(Boolean)
  while (words.length > 1 && LEGAL_SUFFIXES.includes(words[words.length - 1])) {
    words.pop()
  }
  return words
}

function candidateDomains(companyName) {
  const words = significantWords(companyName).filter((w) => w !== 'AND')
  if (words.length === 0) return []
  const lower = words.map((w) => w.toLowerCase())

  const bases = Array.from(new Set([lower.join(''), lower.join('-')].filter(Boolean)))
  // .co.uk first for every base, then .com for every base — a UK
  // company is more likely on .co.uk, so try that before burning
  // probes on .com guesses.
  const domains = [...bases.map((b) => `${b}.co.uk`), ...bases.map((b) => `${b}.com`)]
  return domains.slice(0, MAX_CANDIDATES)
}

async function probeFetch(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    })
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') || ''
    if (!contentType.includes('text/html')) return null
    const reader = res.body?.getReader()
    if (!reader) return (await res.text()).slice(0, MAX_PROBE_BYTES)
    const decoder = new TextDecoder()
    let text = ''
    let bytes = 0
    while (bytes < MAX_PROBE_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.length
      text += decoder.decode(value, { stream: true })
    }
    await reader.cancel().catch(() => {})
    return text
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

// { companyName } -> origin string, or null if nothing confidently matched
async function findCompanyWebsite(companyName) {
  const words = significantWords(companyName).filter((w) => w !== 'AND')
  if (words.length === 0) return null
  if (words.length === 1 && words[0].length < MIN_SINGLE_WORD_LENGTH) return null

  const requiredMatches = Math.max(1, Math.ceil(words.length * 0.6))

  for (const domain of candidateDomains(companyName)) {
    let url
    try {
      url = normalizeUrl(domain)
      await assertPublicHost(url.hostname)
    } catch {
      continue
    }

    const html = await probeFetch(url.origin + '/')
    if (!html) continue

    const lower = html.toLowerCase()
    const matched = words.filter((w) => lower.includes(w.toLowerCase())).length
    if (matched >= requiredMatches) return url.origin
  }

  return null
}

module.exports = { findCompanyWebsite }
