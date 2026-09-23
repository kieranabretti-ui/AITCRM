// Customer matching for inbound Jira tickets — server-side only (called
// from jira-webhook.js with an admin/service-role Supabase client, since
// Jira's request carries no CRM session).
//
// Priority, per spec: exact contact-email match -> approved-domain match
// -> a remembered Jira mapping -> unmatched (never guess). A result of
// more than one candidate at any step is "ambiguous", not a guess.
const { escapeLike, cleanEmail, emailDomain } = require('./text.js')

async function matchCustomer(admin, { requesterEmail, jiraAccountId }) {
  const email = cleanEmail(requesterEmail)
  const domain = emailDomain(email)

  if (email) {
    const { data, error } = await admin.from('clients').select('id').ilike('contact_email', escapeLike(email))
    if (error) throw error
    if (data.length === 1) return { clientId: data[0].id, matchStatus: 'matched', matchedVia: 'contact_email' }
    if (data.length > 1) return { clientId: null, matchStatus: 'ambiguous', matchedVia: 'contact_email' }
  }

  if (domain) {
    const { data, error } = await admin.from('client_email_domains').select('client_id').ilike('domain', escapeLike(domain))
    if (error) throw error
    if (data.length === 1) return { clientId: data[0].client_id, matchStatus: 'matched', matchedVia: 'domain' }
    if (data.length > 1) return { clientId: null, matchStatus: 'ambiguous', matchedVia: 'domain' }
  }

  if (jiraAccountId) {
    const { data, error } = await admin
      .from('jira_customer_mappings')
      .select('client_id')
      .eq('jira_account_id', jiraAccountId)
      .maybeSingle()
    if (error) throw error
    if (data) return { clientId: data.client_id, matchStatus: 'matched', matchedVia: 'jira_mapping' }
  }

  if (email) {
    const { data, error } = await admin
      .from('jira_customer_mappings')
      .select('client_id')
      .ilike('jira_email', escapeLike(email))
      .maybeSingle()
    if (error) throw error
    if (data) return { clientId: data.client_id, matchStatus: 'matched', matchedVia: 'jira_mapping' }
  }

  // No confident single match. Never guess across multiple plausible
  // clients — this ticket goes to the unmatched queue for a human.
  return { clientId: null, matchStatus: 'unmatched', matchedVia: null }
}

// Called once a ticket is matched (auto or manual) so the same requester
// resolves instantly next time — this is what "remember the mapping" means.
async function rememberMapping(admin, { jiraAccountId, jiraEmail, clientId, userId }) {
  const email = cleanEmail(jiraEmail)
  if (!jiraAccountId && !email) return
  const row = { jira_account_id: jiraAccountId || null, jira_email: email || null, client_id: clientId, created_by: userId || null }
  const { error } = await admin
    .from('jira_customer_mappings')
    .upsert(row, { onConflict: jiraAccountId ? 'jira_account_id' : 'jira_email' })
  if (error) throw error
}

module.exports = { matchCustomer, rememberMapping }
