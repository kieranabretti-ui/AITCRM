// Minimal Jira Cloud REST client for the bot's own writes — server-side
// only. Authenticates as the dedicated service account (JIRA_SERVICE_EMAIL
// + JIRA_API_TOKEN), never a human's credentials.
//
// Deliberately small: only what the AI copilot flow needs (read the
// comment thread, write a comment, apply labels, and set the two
// fields explicitly allowed to auto-amend — Priority and, via a
// label, category). No transitions, no other field edits — anything
// that could touch a Jira workflow or a field this bot doesn't
// explicitly own stays a human action, per the "never autonomously..."
// safety list.
const { cleanEmail } = require('./text.js')
const { descriptionToText } = require('./jira.js')

function jiraAuthHeader() {
  const { JIRA_SERVICE_EMAIL, JIRA_API_TOKEN } = process.env
  if (!JIRA_SERVICE_EMAIL || !JIRA_API_TOKEN) return null
  return 'Basic ' + Buffer.from(`${JIRA_SERVICE_EMAIL}:${JIRA_API_TOKEN}`).toString('base64')
}

function isConfigured() {
  return Boolean(process.env.JIRA_BASE_URL && jiraAuthHeader())
}

async function jiraFetch(path, options) {
  const auth = jiraAuthHeader()
  if (!auth || !process.env.JIRA_BASE_URL) {
    throw new Error('Jira write credentials are not configured (JIRA_SERVICE_EMAIL / JIRA_API_TOKEN).')
  }
  const res = await fetch(`${process.env.JIRA_BASE_URL.replace(/\/$/, '')}${path}`, {
    ...options,
    headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json', ...options?.headers },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Jira API ${options?.method || 'GET'} ${path} failed: ${res.status} ${text.slice(0, 300)}`)
  }
  return res.status === 204 ? null : res.json().catch(() => null)
}

// Plain text -> the minimal Atlassian Document Format Jira Cloud
// requires for comment bodies.
function textToAdf(text) {
  return {
    type: 'doc',
    version: 1,
    content: text.split('\n').map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })),
  }
}

// Two separate, explicitly-named functions rather than one with an
// `internal` boolean flag — a stray true/false here is exactly the kind
// of mistake that would leak an internal AI note to a customer, so the
// call site has to say which one it means, not pass a flag that could
// be gotten backwards.
//
// JSM's visibility property: `internal: true` = staff-only (not shown
// in the customer portal), `internal: false` = visible to the customer.
async function addInternalComment(issueKey, text) {
  return jiraFetch(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, {
    method: 'POST',
    body: JSON.stringify({
      body: textToAdf(text),
      properties: [{ key: 'sd.public.comment', value: { internal: true } }],
    }),
  })
}

async function addCustomerComment(issueKey, text) {
  return jiraFetch(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, {
    method: 'POST',
    body: JSON.stringify({
      body: textToAdf(text),
      properties: [{ key: 'sd.public.comment', value: { internal: false } }],
    }),
  })
}

// `removeLabels` is optional — used to swap out a stale "category-…"
// label when the AI reclassifies a ticket's category, so labels don't
// just accumulate every time it changes its mind.
async function addLabels(issueKey, labels, removeLabels) {
  if (!labels?.length && !removeLabels?.length) return null
  const update = [...(labels || []).map((l) => ({ add: l })), ...(removeLabels || []).map((l) => ({ remove: l }))]
  return jiraFetch(`/rest/api/3/issue/${encodeURIComponent(issueKey)}`, {
    method: 'PUT',
    body: JSON.stringify({ update: { labels: update } }),
  })
}

// Writes the AI's severity classification onto Jira's own native
// Priority field (see lib/jira.js's priorityNameForSeverity) — this is
// the one field edit beyond labels/comments this bot makes, since
// severity is explicitly one of the low-risk metadata fields the
// spec allows the AI to amend automatically. Still just a field value,
// never a transition/workflow change.
async function setPriority(issueKey, priorityName) {
  if (!priorityName) return null
  return jiraFetch(`/rest/api/3/issue/${encodeURIComponent(issueKey)}`, {
    method: 'PUT',
    body: JSON.stringify({ fields: { priority: { name: priorityName } } }),
  })
}

// Full comment thread, oldest first — this is how the copilot "reads
// all customer replies, technician replies" across the ticket's whole
// lifecycle rather than just reacting to the one comment in a webhook
// payload. Read-only; capped at 50, which is generous for a support
// ticket and keeps the AI's context bounded.
async function getComments(issueKey) {
  const data = await jiraFetch(
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment?orderBy=created&maxResults=50`,
    { method: 'GET' },
  )
  return (data?.comments || []).map((c) => ({
    id: c.id,
    authorEmail: cleanEmail(c.author?.emailAddress),
    authorName: c.author?.displayName || '',
    text: descriptionToText(c.body),
    created: c.created,
    internal: c.properties?.find((p) => p.key === 'sd.public.comment')?.value?.internal ?? null,
  }))
}

module.exports = { isConfigured, addInternalComment, addCustomerComment, addLabels, setPriority, getComments }
