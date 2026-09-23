// Minimal Jira Cloud REST client for the bot's own writes — server-side
// only. Authenticates as the dedicated service account (JIRA_SERVICE_EMAIL
// + JIRA_API_TOKEN), never a human's credentials.
//
// Deliberately small: only what the AI triage flow needs (a comment, a
// label). No transitions, no field edits beyond labels — anything that
// could touch a Jira workflow or a field this bot doesn't own stays a
// human action, per the "never autonomously..." safety list.
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

async function addLabels(issueKey, labels) {
  if (!labels?.length) return null
  return jiraFetch(`/rest/api/3/issue/${encodeURIComponent(issueKey)}`, {
    method: 'PUT',
    body: JSON.stringify({ update: { labels: labels.map((l) => ({ add: l })) } }),
  })
}

module.exports = { isConfigured, addInternalComment, addCustomerComment, addLabels }
