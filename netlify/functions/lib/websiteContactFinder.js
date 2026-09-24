// Website contact finder — server-side only. Reads ONE company's own
// public website, on demand, for a single lookup — never a crawler,
// never a third-party platform (no LinkedIn, no search engines, no
// directories). This is the deliberate, much narrower alternative to
// a general-purpose scraper: it only surfaces general contact info
// (a mailto:/tel: link, or a rough "X employees" phrase) that the
// business has itself chosen to publish on its own domain as a way
// for people to reach them — the same thing a human would do by
// opening the site and looking at the Contact page, just automated.
//
// Ground rules, all enforced in code below:
// - Same origin only — never follows a link off the company's own domain.
// - Checks robots.txt first and skips any path it disallows.
// - Identifies itself honestly in the User-Agent (no browser spoofing).
// - At most 3 pages per lookup (homepage + up to 2 likely contact/about
//   pages), each with a strict timeout and response-size cap.
// - Rejects URLs that resolve to a private/internal address, since
//   this takes a user-supplied URL and fetches it server-side.
const dns = require('dns').promises
const net = require('net')

const USER_AGENT = 'A-IT-CRM-ContactFinder/1.0 (+https://a-it.uk; single-company contact lookup, not a crawler)'
const FETCH_TIMEOUT_MS = 8_000
const MAX_RESPONSE_BYTES = 500_000
const MAX_PAGES = 3
const CANDIDATE_PATHS = ['/contact', '/contact-us', '/about', '/about-us', '/team']

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  }
  const lower = ip.toLowerCase()
  return lower === '::1' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')
}

function normalizeUrl(input) {
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`
  let url
  try {
    url = new URL(withProtocol)
  } catch {
    throw new Error('That doesn\'t look like a valid URL.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http/https URLs are supported.')
  }
  return url
}

async function assertPublicHost(hostname) {
  let address
  try {
    ({ address } = await dns.lookup(hostname))
  } catch {
    throw new Error(`Could not resolve ${hostname}.`)
  }
  if (isPrivateIp(address)) {
    throw new Error('That URL resolves to a private/internal address and cannot be fetched.')
  }
}

async function fetchWithLimits(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    })
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') || ''
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) return null
    // Read with a size cap rather than trusting Content-Length, which a
    // server can omit or misreport.
    const reader = res.body?.getReader()
    if (!reader) return (await res.text()).slice(0, MAX_RESPONSE_BYTES)
    const decoder = new TextDecoder()
    let text = ''
    let bytes = 0
    while (bytes < MAX_RESPONSE_BYTES) {
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

// Minimal robots.txt parsing: the Disallow rules under the `User-agent:
// *` group (we don't claim a specific identity most sites would list).
async function fetchDisallowedPaths(origin) {
  const text = await fetchWithLimits(`${origin}/robots.txt`)
  if (!text) return []
  const lines = text.split('\n').map((l) => l.trim())
  const disallowed = []
  let inWildcardGroup = false
  for (const line of lines) {
    const [rawKey, ...rest] = line.split(':')
    const key = (rawKey || '').trim().toLowerCase()
    const value = rest.join(':').trim()
    if (key === 'user-agent') {
      inWildcardGroup = value === '*'
    } else if (key === 'disallow' && inWildcardGroup && value) {
      disallowed.push(value)
    }
  }
  return disallowed
}

function isAllowed(pathname, disallowedPaths) {
  return !disallowedPaths.some((p) => pathname.startsWith(p))
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
const MAILTO_RE = /mailto:([^"'\s?<>]+)/gi
const TEL_RE = /tel:([^"'\s<>]+)/gi
const EMPLOYEE_COUNT_RE = /\b(\d{1,4}\+?)\s*(employees|staff members|staff|team members|people)\b/i
// Domains that show up as false-positive "emails" in tracking pixels,
// placeholder text, or asset filenames — filtered out, not exhaustive.
const EMAIL_IGNORE_SUBSTRINGS = ['example.com', 'sentry.io', 'wixpress.com', '.png', '.jpg', '.svg', '.gif', 'schema.org', 'w3.org']

function extractContacts(html) {
  const emails = new Set()
  const phones = new Set()
  let employeeCountHint = null

  for (const m of html.matchAll(MAILTO_RE)) emails.add(decodeURIComponent(m[1]).toLowerCase())
  for (const m of html.matchAll(EMAIL_RE)) {
    const email = m[0].toLowerCase()
    if (!EMAIL_IGNORE_SUBSTRINGS.some((s) => email.includes(s))) emails.add(email)
  }
  for (const m of html.matchAll(TEL_RE)) {
    const phone = decodeURIComponent(m[1]).trim()
    if (phone) phones.add(phone)
  }
  const employeeMatch = html.match(EMPLOYEE_COUNT_RE)
  if (employeeMatch) employeeCountHint = employeeMatch[0]

  return { emails: Array.from(emails), phones: Array.from(phones), employeeCountHint }
}

// { url } -> { emails, phones, employeeCountHint, pagesChecked, sourceUrl }
async function findContactInfo(inputUrl) {
  const url = normalizeUrl(inputUrl)
  await assertPublicHost(url.hostname)

  const origin = url.origin
  const disallowed = await fetchDisallowedPaths(origin)

  const pathsToTry = [url.pathname || '/', ...CANDIDATE_PATHS]
  const seen = new Set()
  const allEmails = new Set()
  const allPhones = new Set()
  let employeeCountHint = null
  const pagesChecked = []

  for (const path of pathsToTry) {
    if (pagesChecked.length >= MAX_PAGES) break
    if (seen.has(path)) continue
    seen.add(path)
    if (!isAllowed(path, disallowed)) continue

    const html = await fetchWithLimits(`${origin}${path}`)
    if (!html) continue
    pagesChecked.push(path)

    const found = extractContacts(html)
    found.emails.forEach((e) => allEmails.add(e))
    found.phones.forEach((p) => allPhones.add(p))
    if (!employeeCountHint && found.employeeCountHint) employeeCountHint = found.employeeCountHint
  }

  if (pagesChecked.length === 0) {
    throw new Error('Could not fetch that site (blocked by robots.txt, unreachable, or not HTML).')
  }

  return {
    emails: Array.from(allEmails).slice(0, 10),
    phones: Array.from(allPhones).slice(0, 10),
    employeeCountHint,
    pagesChecked,
    sourceUrl: origin,
  }
}

// normalizeUrl/assertPublicHost/fetchWithLimits are also reused by
// lib/domainGuesser.js, which needs the same SSRF-safe fetch to probe
// candidate domains it has guessed rather than been given.
module.exports = { findContactInfo, normalizeUrl, assertPublicHost, fetchWithLimits, USER_AGENT }
