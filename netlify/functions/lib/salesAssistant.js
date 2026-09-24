// AI sales assistant — server-side only. Drafts a single outreach/
// follow-up message for one sales opportunity, using the same
// structured (forced tool-call) pattern as the support copilot in
// aiTechnician.js, but far narrower in scope: this never touches an
// existing ticket, never contacts anyone itself, and never runs
// automatically — it's called once, on request, from the Sales page,
// and its output always sits as a draft for a human to read, edit and
// send themselves. There is no email-sending integration in this app;
// producing text is the entire extent of what this does.
//
// Required env var: ANTHROPIC_API_KEY. Optional: ANTHROPIC_MODEL.
// On any failure this returns { ok: false, reason }, never throws.
const { SLA_RESPONSE_HOURS } = require('./sla.js')
const { buildPriceFacts } = require('./pricingFacts.js')

const DEFAULT_MODEL = 'claude-opus-5'
const REQUEST_TIMEOUT_MS = 25_000

const SYSTEM_PROMPT = `You are the sales assistant for A-IT, a UK managed IT and cybersecurity provider for small and medium businesses. You draft a single outreach or follow-up email for one prospect, for a member of A-IT's team to review, edit, and send themselves — you never send anything, and you have no access to any system beyond what's described in this prompt.

${buildPriceFacts()}

## Rules — these are not optional

- Never invent a fact about the prospect's business, their current IT setup, a conversation that didn't happen, or a commitment A-IT hasn't made. If you don't know something, don't claim it.
- Never promise a specific response time, project timeline, or outcome A-IT hasn't actually committed to — the ${SLA_RESPONSE_HOURS}-hour response SLA is the one concrete commitment you may cite, and only for clients who have (or are being offered) that add-on.
- Never discount, negotiate, or invent pricing beyond the published figures above. If the opportunity notes mention a specific quoted price, you may reference that figure; otherwise stick to the standard per-device rates.
- Keep it concise, professional, and free of hard-sell pressure tactics (no artificial urgency, no fake scarcity). British business tone — direct, warm, not salesy.
- Write only the one email requested for the stated goal; do not draft a whole sequence.
- If the opportunity has very little information to go on, write a shorter, more general message rather than inventing specifics to fill the gap.

Respond only by calling the submit_draft tool.`

function buildUserPrompt({ client, opportunity, goal }) {
  const lines = [`Goal: ${goal}`, '', 'Prospect / client:']
  lines.push(`- Business: ${client.business_name || '(name not yet on file)'}`)
  if (client.contact_name) lines.push(`- Contact: ${client.contact_name}`)
  if (client.site_address) lines.push(`- Location: ${client.site_address}`)
  if (client.device_count) lines.push(`- Approx. devices/endpoints: ${client.device_count}`)
  if (client.platform) lines.push(`- Platform: ${client.platform === 'm365' ? 'Microsoft 365' : client.platform === 'google' ? 'Google Workspace' : client.platform}`)
  if (client.lead_source) lines.push(`- How they found A-IT: ${client.lead_source}${client.lead_source_detail ? ` (${client.lead_source_detail})` : ''}`)
  if (client.notes) lines.push(`- Notes on file: ${client.notes}`)

  lines.push('', 'Opportunity:', `- Stage: ${opportunity.stage}`)
  if (opportunity.estimated_value_annual) lines.push(`- Estimated annual value: £${opportunity.estimated_value_annual}`)
  if (opportunity.expected_close_date) lines.push(`- Expected close date: ${opportunity.expected_close_date}`)
  if (opportunity.notes) lines.push(`- Opportunity notes: ${opportunity.notes}`)

  if (client.activity?.length) {
    lines.push('', 'Recent activity log (most recent first):')
    client.activity.slice(0, 8).forEach((a) => lines.push(`- ${a.created_at?.slice(0, 10)}: ${a.text}`))
  }

  return lines.join('\n')
}

const DRAFT_TOOL = {
  name: 'submit_draft',
  description: 'Submit the drafted outreach/follow-up email.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      subject: { type: 'string', description: 'Email subject line.' },
      body: { type: 'string', description: 'The full email body, ready to send as-is or lightly edited.' },
      key_points: { type: 'array', items: { type: 'string' }, description: 'A short bullet list (for the technician\'s own quick reference) of the main points the email makes.' },
      follow_up_suggestion: { type: 'string', description: 'A brief, concrete suggestion for what to do next (e.g. when to follow up if there\'s no reply).' },
    },
    required: ['subject', 'body', 'key_points', 'follow_up_suggestion'],
    additionalProperties: false,
  },
}

async function draftSalesMessage({ client, opportunity, goal }) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { ok: false, reason: 'not_configured' }

  let AnthropicCtor
  try {
    const AnthropicSDK = require('@anthropic-ai/sdk')
    AnthropicCtor = AnthropicSDK.default || AnthropicSDK
  } catch {
    return { ok: false, reason: 'sdk_missing' }
  }
  const anthropicClient = new AnthropicCtor({ apiKey, timeout: REQUEST_TIMEOUT_MS })

  try {
    const response = await anthropicClient.messages.create({
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: 1536,
      output_config: { effort: 'low' },
      system: SYSTEM_PROMPT,
      tools: [DRAFT_TOOL],
      tool_choice: { type: 'tool', name: 'submit_draft' },
      messages: [{ role: 'user', content: buildUserPrompt({ client, opportunity, goal }) }],
    })

    if (response.stop_reason === 'refusal') return { ok: false, reason: 'refusal' }

    const toolUse = response.content.find((b) => b.type === 'tool_use' && b.name === 'submit_draft')
    if (!toolUse) return { ok: false, reason: 'no_tool_call' }

    const input = toolUse.input
    return {
      ok: true,
      subject: input.subject,
      body: input.body,
      keyPoints: Array.isArray(input.key_points) ? input.key_points : [],
      followUpSuggestion: input.follow_up_suggestion,
    }
  } catch (err) {
    const reason = err?.status === 429 ? 'rate_limited' : err?.status >= 500 ? 'anthropic_unavailable' : 'api_error'
    return { ok: false, reason, error: err?.message }
  }
}

module.exports = { draftSalesMessage }
